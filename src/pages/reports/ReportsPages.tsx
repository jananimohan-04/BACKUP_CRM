import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Upload, Factory, Boxes, Gauge, TrendingUp, Play } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui/Card';
import { FormField, inputClass } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { supabase } from '@/lib/supabase';
import { exportCsv } from '@/lib/reportExport';
import { formatINR, todayISO } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { intersectRange } from '@/lib/globalDate';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';

type Section = 'Overview' | 'Sales' | 'Production' | 'Inventory' | 'Machine Utilization' | 'Profitability' | 'Custom Reports';
type ReportData = {
  invoices: any[]; orders: any[]; workOrders: any[]; machines: any[]; jobs: any[];
  customers: any[]; inventory: any; pnl: any;
};
const sections: Section[] = ['Overview', 'Sales', 'Production', 'Inventory', 'Machine Utilization', 'Profitability', 'Custom Reports'];
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const money = (n: number | string | null | undefined) => formatINR(n ?? 0, { decimals: 'auto' });
const isOpen = (s: string | null | undefined) => !['Completed','Delivered','Cancelled','Closed','Dispatched'].includes(String(s || ''));

function ReportsPage({ initialSection = 'Overview' as Section }) {
  const { company } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>(initialSection);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  // Global Topbar range intersects the report's own From/To (server-side filters below).
  const { from: globalFrom, to: globalTo } = useGlobalDateFilter();
  const { from: effFrom, to: effTo } = intersectRange(from, to, globalFrom, globalTo);
  const [customer, setCustomer] = useState('');
  const [machine, setMachine] = useState('');
  const [data, setData] = useState<ReportData>({ invoices: [], orders: [], workOrders: [], machines: [], jobs: [], customers: [], inventory: null, pnl: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!effFrom || !effTo || effFrom > effTo) { setError('Choose a valid date range.'); return; }
    setLoading(true); setError('');
    try {
      const invQ = supabase.from('cnc_invoices').select('id,invoice_no,invoice_type,invoice_date,customer_name,customer_id,amount,status,cancelled,part_name,quantity').gte('invoice_date', effFrom).lte('invoice_date', effTo).order('invoice_date', { ascending: false }).limit(2000);
      const soQ = supabase.from('cnc_sales_orders').select('id,order_no,order_date,created_at,customer,part_name,part_no,quantity,value,total_value,status').gte('order_date', effFrom).lte('order_date', effTo).order('order_date', { ascending: false }).limit(2000);
      const woQ = supabase.from('cnc_work_orders').select('id,wo_no,customer,part_name,part_no,quantity,completed,rejected,status,start_date,due_date,created_at,sales_order').gte('created_at', `${effFrom}T00:00:00`).lte('created_at', `${effTo}T23:59:59`).order('created_at', { ascending: false }).limit(2000);
      const jobsQ = supabase.from('cnc_job_cards').select('id,work_order,machine,qty_planned,qty_completed,qty_rejected,cycle_time,setup_time,status,created_at').gte('created_at', `${effFrom}T00:00:00`).lte('created_at', `${effTo}T23:59:59`).limit(5000);
      const [inv, so, wo, mc, jc, cu, inventory, pnl] = await Promise.all([
        invQ, soQ, woQ,
        supabase.from('cnc_machines').select('id,code,name,type,status,utilization,spindle_hours').order('code'),
        jobsQ,
        supabase.from('cnc_customers').select('id,name').order('name').limit(2000),
        supabase.rpc('erp_inventory_summary'),
        supabase.rpc('erp_profit_and_loss', { p_from: effFrom, p_to: effTo }),
      ]);
      const failures = [inv, so, wo, mc, jc, cu].filter(x => x.error);
      if (failures.length) throw failures[0].error;
      if (inventory.error) throw inventory.error;
      if (pnl.error) throw pnl.error;
      setData({ invoices: inv.data || [], orders: so.data || [], workOrders: wo.data || [], machines: mc.data || [], jobs: jc.data || [], customers: cu.data || [], inventory: inventory.data, pnl: pnl.data });
    } catch (e) {
      setData({ invoices: [], orders: [], workOrders: [], machines: [], jobs: [], customers: [], inventory: null, pnl: null });
      setError(e instanceof Error ? e.message : 'Unable to generate report. Please try again.');
    } finally { setLoading(false); }
  }, [company?.id, effFrom, effTo]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSection(initialSection); }, [initialSection]);

  const filteredInvoices = useMemo(() => data.invoices.filter(x => !customer || x.customer_id === customer || x.customer_name === data.customers.find(c => c.id === customer)?.name), [data.invoices, data.customers, customer]);
  const filteredOrders = useMemo(() => data.orders.filter(x => !customer || x.customer === data.customers.find(c => c.id === customer)?.name), [data.orders, data.customers, customer]);
  const filteredWos = useMemo(() => data.workOrders.filter(x => (!customer || x.customer === data.customers.find(c => c.id === customer)?.name)), [data.workOrders, data.customers, customer]);
  const filteredJobs = useMemo(() => data.jobs.filter(x => (!machine || x.machine === machine) && (!customer || filteredWos.some(w => w.wo_no === x.work_order))), [data.jobs, filteredWos, machine, customer]);
  const salesTotal = filteredInvoices.filter(x => !x.cancelled && x.invoice_type !== 'Proforma Invoice').reduce((n,x) => n + Number(x.amount || 0) * (x.invoice_type === 'Credit Note' ? -1 : 1), 0);
  const productionTotal = filteredWos.reduce((n,x) => n + Number(x.completed || 0), 0);
  const rejectedTotal = filteredWos.reduce((n,x) => n + Number(x.rejected || 0), 0);
  const fgValue = Number(data.inventory?.by_category?.find((x:any) => x.code === 'FG')?.value || 0);
  const selectedMachines = data.machines.filter(x => !machine || x.code === machine || x.id === machine);
  const utilizationRows = selectedMachines.map(x => ({ ...x, utilizationValue: Number(x.utilization) })).filter(x => Number.isFinite(x.utilizationValue));
  const avgUtil = utilizationRows.length ? utilizationRows.reduce((n,x) => n + x.utilizationValue, 0) / utilizationRows.length : null;
  const profit = Number(data.pnl?.totals?.net_profit || 0);
  const profitMargin = Number(data.pnl?.totals?.income || 0) ? profit * 100 / Number(data.pnl.totals.income) : null;
  const products = useMemo(() => {
    const grouped = new Map<string, { qty:number; value:number }>();
    for (const o of filteredOrders) { const name=o.part_name || 'Unspecified'; const p=grouped.get(name)||{qty:0,value:0}; p.qty+=Number(o.quantity||0);p.value+=Number(o.total_value??o.value??0);grouped.set(name,p); }
    return [...grouped.entries()].map(([name,v])=>({name,...v})).sort((a,b)=>b.value-a.value).slice(0,8);
  }, [filteredOrders]);
  const trend = useMemo(() => {
    const groups = new Map<string,{sales:number;orders:number}>();
    for (const invoice of filteredInvoices) { if (invoice.cancelled || invoice.invoice_type === 'Proforma Invoice' || !invoice.invoice_date) continue; const k=String(invoice.invoice_date).slice(0,7);const x=groups.get(k)||{sales:0,orders:0};x.sales+=Number(invoice.amount||0)*(invoice.invoice_type==='Credit Note'?-1:1);x.orders+=1;groups.set(k,x); }
    return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([month,v])=>({month,...v}));
  }, [filteredInvoices]);
  const categoryValues = data.inventory?.by_category || [];
  const maxCategory = Math.max(1, ...categoryValues.map((x:any)=>Number(x.value||0)));
  const pendingWos = filteredWos.filter(w=>isOpen(w.status));
  const overdueWos = pendingWos.filter(w=>w.due_date && w.due_date < todayISO());
  const topCustomer = Object.entries(filteredInvoices.reduce<Record<string,number>>((a,x)=>{if(!x.cancelled&&x.invoice_type!=='Proforma Invoice'){const k=x.customer_name||'Unspecified';a[k]=(a[k]||0)+Number(x.amount||0)*(x.invoice_type==='Credit Note'?-1:1)}return a},{})).sort((a,b)=>b[1]-a[1])[0];

  const exportReport = () => exportCsv(`ERP_Report_${section.replace(/ /g,'_')}_${todayISO()}`,[
    ['Report',section],['Company',company?.company_name||'Current authorized company'],['Date From',from],['Date To',to],['Company',data.customers.find(c=>c.id===customer)?.name||'All'],['Machine',machine||'All'],[],
    ['KPI','Value'],['Invoiced Sales',salesTotal],['Production Completed Qty',productionTotal],['Finished Goods Stock Value',fgValue],['Machine Utilization %',avgUtil??''],['Net Profit (P&L)',data.pnl?.totals?.net_profit||''],[],
    ['Sales Trend Month','Invoiced','Invoices'],...trend.map(x=>[x.month,x.sales,x.orders]),[],['Product','Quantity','Sales Value'],...products.map(x=>[x.name,x.qty,x.value]),[],['Recent Sales Order','Date','Company','Value','Status'],...filteredOrders.slice(0,20).map(x=>[x.order_no,x.order_date,x.customer,x.total_value??x.value,x.status]),[],['Work Order','Date','Part','Quantity','Completed','Rejected','Status'],...filteredWos.slice(0,20).map(x=>[x.wo_no,x.created_at,x.part_name,x.quantity,x.completed,x.rejected,x.status]),[],['Inventory Category','Products','Stock Value'],...categoryValues.map((x:any)=>[x.name,x.items,x.value]),[],['Machine','Status','Utilization %'],...utilizationRows.map(x=>[x.code,x.status,x.utilizationValue]),[],['P&L Account','Type','Amount'],...(data.pnl?.rows||[]).map((x:any)=>[x.name,x.account_type,x.amount]),
  ]);

  const exportReportRef = useRef(exportReport);
  exportReportRef.current = exportReport;
  const loadRef = useRef(load);
  loadRef.current = load;

  const { setHeader, setTabActions, setHeaderCenter } = useHeaderKpis();

  useEffect(() => {
    setHeader({ title: 'Reports' });
    setHeaderCenter(
      <div className="flex items-center gap-1.5 min-w-0">
        <input
          type="date"
          aria-label="Date From"
          title="Date From"
          className="h-7 px-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-brand-500"
          value={from}
          onChange={e => setFrom(e.target.value)}
        />
        <input
          type="date"
          aria-label="Date To"
          title="Date To"
          className="h-7 px-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-brand-500"
          value={to}
          onChange={e => setTo(e.target.value)}
        />
        <select
          aria-label="Company"
          title="Company"
          className="h-7 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-brand-500 max-w-[150px] truncate"
          value={customer}
          onChange={e => setCustomer(e.target.value)}
        >
          <option value="">All Companies</option>
          {data.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          aria-label="Machine"
          title="Machine"
          className="h-7 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-brand-500 max-w-[150px] truncate"
          value={machine}
          onChange={e => setMachine(e.target.value)}
        >
          <option value="">All Machines</option>
          {data.machines.map(m => <option key={m.id} value={m.code}>{m.code} · {m.name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void loadRef.current()}
          disabled={loading}
          className="h-7 px-2.5 text-xs font-bold text-white bg-gradient-to-b from-brand-600 to-brand-700 hover:from-brand-500 hover:to-brand-700 rounded-md shadow-sm flex items-center gap-1 active:scale-[0.98] transition disabled:opacity-50 cursor-pointer shrink-0"
        >
          <Play size={11} className="fill-white" />
          <span>{loading ? 'Generating…' : 'Generate Report'}</span>
        </button>
      </div>
    );
    setTabActions(
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload size={14} />}
          onClick={() => exportReportRef.current()}
          disabled={loading}
          className="h-7 py-1 text-xs px-2.5 shadow-sm"
        >
          Export Report
        </Button>
      </div>
    );
    return () => {
      setHeader(null);
      setHeaderCenter(null);
      setTabActions(null);
    };
  }, [setHeader, setHeaderCenter, setTabActions, from, to, customer, machine, data.customers, data.machines, loading]);

  return <div className="px-4 lg:px-6 pt-2 pb-4 lg:pb-6 bg-grid min-h-full space-y-2">
    <div className="lg:hidden">
      <PageHeader title="Reports" description="Real-time insights from sales, production, inventory and accounting records." actions={<Button variant="secondary" size="sm" icon={<Upload size={14}/>} onClick={exportReport} disabled={loading}><span>Export Report</span></Button>} />
    </div>
    {error && <div className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">Unable to generate report. Please try again. <span className="text-xs">{error}</span></div>}
    <div className="lg:hidden">
      <Card className="p-3"><div className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <FormField label="Date From"><input type="date" className={inputClass} value={from} onChange={e=>setFrom(e.target.value)}/></FormField>
        <FormField label="Date To"><input type="date" className={inputClass} value={to} onChange={e=>setTo(e.target.value)}/></FormField>
        <FormField label="Company"><select className={inputClass} value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">All Companies</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></FormField>
        <FormField label="Machine"><select className={inputClass} value={machine} onChange={e=>setMachine(e.target.value)}><option value="">All Machines</option>{data.machines.map(m=><option key={m.id} value={m.code}>{m.code} · {m.name}</option>)}</select></FormField>
        <Button onClick={()=>void load()} disabled={loading}>{loading?'Generating…':'Generate Report'}</Button>
      </div></Card>
    </div>
    <div className="flex gap-1 overflow-x-auto border-b">{sections.map(s=><button key={s} onClick={()=>{setSection(s);const path:Record<Section,string>={Overview:'/reports/production',Sales:'/reports/sales',Production:'/reports/production',Inventory:'/reports/inventory','Machine Utilization':'/reports/machine-utilization',Profitability:'/reports/cost-analysis','Custom Reports':'/reports/quality'};navigate(path[s]);}} className={'px-4 py-2 text-xs font-semibold border-b-2 whitespace-nowrap '+(section===s?'border-brand-600 text-brand-700':'border-transparent text-slate-500')}>{s}</button>)}</div>
    {loading ? <Card className="p-12 text-center text-sm text-slate-500"><BarChart3 className="inline mr-2" size={18}/>Generating report from current ERP records…</Card> : <>
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <Metric title="Total Sales" value={money(salesTotal)} icon={<TrendingUp size={18}/>} tone="blue" note="Posted invoice totals in range"/>
        <Metric title="Total Production" value={`${productionTotal.toLocaleString('en-IN')} Nos`} icon={<Factory size={18}/>} tone="green" note="Completed work order quantity"/>
        <Metric title="FG Stock Value" value={money(fgValue)} icon={<Boxes size={18}/>} tone="orange" note="Current inventory valuation"/>
        <Metric title="Machine Utilization" value={avgUtil===null?'—':`${avgUtil.toFixed(1)}%`} icon={<Gauge size={18}/>} tone="purple" note="Machine master utilization values"/>
        <Metric title="Profitability" value={profitMargin===null?'—':`${profitMargin.toFixed(1)}%`} icon={<TrendingUp size={18}/>} tone="rose" note={`P&L net ${money(profit)}`}/>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="p-4 xl:col-span-2"><div className="flex justify-between items-center mb-4"><h2 className="font-bold text-sm">Sales Trend</h2><Button size="sm" variant="secondary" onClick={()=>navigate('/finance/invoices')}>View Details</Button></div>{trend.length? <div className="flex items-end gap-3 h-44 border-b border-slate-200 px-2">{trend.map(x=><div key={x.month} className="flex-1 h-full flex flex-col justify-end items-center gap-1"><div title={money(x.sales)} className="w-full max-w-12 rounded-t bg-blue-500" style={{height:`${Math.max(4,x.sales/Math.max(1,...trend.map(y=>y.sales))*82)}%`}}/><span className="text-[10px] text-slate-500">{x.month}</span></div>)}</div>:<Empty/>}<p className="text-xs text-slate-500 mt-3">Invoice value and invoice count grouped by invoice month.</p></Card>
        <Card className="p-4"><h2 className="font-bold text-sm mb-4">Production Output</h2><OutputBar label="Completed" value={productionTotal} max={Math.max(1,productionTotal+rejectedTotal)} color="bg-emerald-500"/><OutputBar label="Rejected" value={rejectedTotal} max={Math.max(1,productionTotal+rejectedTotal)} color="bg-rose-500"/><OutputBar label="In Progress Qty" value={pendingWos.reduce((n,w)=>n+Math.max(0,Number(w.quantity||0)-Number(w.completed||0)-Number(w.rejected||0)),0)} max={Math.max(1,Number(data.workOrders.reduce((n,w)=>n+Number(w.quantity||0),0)))} color="bg-amber-400"/></Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="p-4"><h2 className="font-bold text-sm mb-3">Inventory Value by Category</h2>{categoryValues.length?categoryValues.map((x:any)=><div key={x.code} className="mb-3"><div className="flex justify-between text-xs mb-1"><span>{x.name}</span><b>{money(x.value)}</b></div><div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-blue-500" style={{width:`${Math.max(1,Number(x.value||0)/maxCategory*100)}%`}}/></div></div>):<Empty/>}</Card>
        <Card className="p-4"><div className="flex items-center justify-between mb-3"><h2 className="font-bold text-sm">Machine Utilization</h2><Button size="sm" variant="secondary" onClick={()=>navigate('/reports/machine-utilization')}>Details</Button></div>{utilizationRows.length?utilizationRows.slice(0,8).map(m=><div key={m.id} className="mb-3"><div className="flex justify-between text-xs mb-1"><span>{m.code} · {m.name}</span><b>{m.utilizationValue.toFixed(1)}%</b></div><div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-violet-500" style={{width:`${Math.max(0,Math.min(100,m.utilizationValue))}%`}}/></div></div>):<Empty>No machine utilization values are configured.</Empty>}</Card>
        <Card className="p-4"><h2 className="font-bold text-sm mb-3">Profitability Analysis</h2>{data.pnl?.rows?.filter((x:any)=>['INCOME','EXPENSE'].includes(x.account_type)).slice(0,8).map((x:any)=><div key={x.id} className="flex justify-between border-b py-2 text-xs"><span>{x.name}</span><b>{money(x.amount)}</b></div>)}{!data.pnl?.rows?.length&&<Empty>No accounting profit and loss entries for this period.</Empty>}<div className="flex justify-between pt-3 text-sm font-bold"><span>Net Profit</span><span>{money(profit)}</span></div><p className="text-[10px] text-slate-500 mt-2">Source: company Profit &amp; Loss report.</p></Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="p-4"><h2 className="font-bold text-sm mb-3">Top Performing Products</h2>{products.length?<div className="overflow-auto"><table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="py-2">Part</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Sales Value</th></tr></thead><tbody>{products.map(x=><tr key={x.name} className="border-t"><td className="py-2">{x.name}</td><td className="py-2 text-right">{x.qty.toLocaleString('en-IN')}</td><td className="py-2 text-right">{money(x.value)}</td></tr>)}</tbody></table></div>:<Empty/>}</Card>
        <Card className="p-4"><div className="flex justify-between mb-3"><h2 className="font-bold text-sm">Recent Sales Orders</h2><Button size="sm" variant="secondary" onClick={()=>navigate('/sales/orders')}>View Details</Button></div>{filteredOrders.slice(0,6).map(o=><div key={o.id} className="grid grid-cols-[1fr_auto] gap-2 border-t py-2 text-xs"><span><b>{o.order_no}</b><span className="text-slate-500"> · {o.customer}</span></span><b>{money(o.total_value??o.value)}</b></div>)}{!filteredOrders.length&&<Empty/>}</Card>
        <Card className="p-4"><div className="flex justify-between mb-3"><h2 className="font-bold text-sm">Recent Production Orders</h2><Button size="sm" variant="secondary" onClick={()=>navigate('/production/work-orders')}>View Details</Button></div>{filteredWos.slice(0,6).map(w=><div key={w.id} className="grid grid-cols-[1fr_auto] gap-2 border-t py-2 text-xs"><span><b>{w.part_name}</b><span className="text-slate-500">{w.customer ? ` · ${w.customer}` : ''}</span></span><Badge variant={isOpen(w.status)?'warning':'success'}>{w.status||'Unknown'}</Badge></div>)}{!filteredWos.length&&<Empty/>}</Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><Insight label="Overdue production" value={overdueWos.length?`${overdueWos.length} work orders past due`:'No overdue work orders in this period'} tone={overdueWos.length?'rose':'green'}/><Insight label="Top invoiced company" value={topCustomer?`${topCustomer[0]} · ${money(topCustomer[1])}`:'No invoiced company data'} tone="blue"/><Insight label="Inventory attention" value={Number(data.inventory?.low_stock||0)+Number(data.inventory?.out_of_stock||0)?`${Number(data.inventory.low_stock||0)} low and ${Number(data.inventory.out_of_stock||0)} out of stock`:'No low or out-of-stock products'} tone={Number(data.inventory?.low_stock||0)+Number(data.inventory?.out_of_stock||0)?'amber':'green'}/></div>
    </>}
  </div>;
}

function Metric({title,value,icon,tone,note}:{title:string;value:string;icon:any;tone:string;note:string}){const colors:Record<string,string>={blue:'bg-blue-50 text-blue-600',green:'bg-emerald-50 text-emerald-600',orange:'bg-orange-50 text-orange-600',purple:'bg-violet-50 text-violet-600',rose:'bg-rose-50 text-rose-600'};return <Card className="p-3"><div className="flex items-center gap-3"><div className={`rounded-lg p-2 ${colors[tone]||colors.blue}`}>{icon}</div><div className="min-w-0"><div className="text-xs text-slate-500">{title}</div><div className="font-bold text-lg truncate">{value}</div></div></div><div className="mt-3 text-[10px] text-slate-500">{note}</div></Card>}
function OutputBar({label,value,max,color}:{label:string;value:number;max:number;color:string}){return <div className="mb-4"><div className="flex justify-between text-xs mb-1"><span>{label}</span><b>{Number(value).toLocaleString('en-IN')}</b></div><div className="h-2 bg-slate-100 rounded"><div className={`h-2 ${color} rounded`} style={{width:`${Math.min(100,Math.max(0,value/max*100))}%`}}/></div></div>}
function Insight({label,value,tone}:{label:string;value:string;tone:string}){const c:Record<string,string>={rose:'border-rose-200 bg-rose-50',green:'border-emerald-200 bg-emerald-50',blue:'border-blue-200 bg-blue-50',amber:'border-amber-200 bg-amber-50'};return <Card className={`p-3 border ${c[tone]||c.blue}`}><div className="text-[10px] uppercase text-slate-500">{label}</div><div className="text-sm font-semibold mt-1">{value}</div></Card>}
function Empty({children='No data available for the selected period.'}:{children?:string}){return <div className="py-8 text-center text-xs text-slate-500">{children}</div>}
export function ProductionReportsPage(){return <ReportsPage initialSection="Production"/>}
export function SalesReportsPage(){return <ReportsPage initialSection="Sales"/>}
export function InventoryReportsPage(){return <ReportsPage initialSection="Inventory"/>}
export function QualityReportsPage(){return <ReportsPage initialSection="Custom Reports"/>}
export function MachineUtilizationReportsPage(){return <ReportsPage initialSection="Machine Utilization"/>}
export function CostAnalysisReportsPage(){return <ReportsPage initialSection="Profitability"/>}

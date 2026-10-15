// Order Quantity Tracking report: one reconciled row per sales order —
// Ordered / Good / Rejected / Remaining / FG Available / Delivered /
// Invoiced / Invoiceable — plus a rejection breakdown (type, reason,
// machine, operator, date). All quantities come from the shared
// reconciliation in src/lib/orderQuantities.ts, the same source every
// pipeline card, modal and detail view uses.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, PackageSearch, Search } from 'lucide-react';
import { Button, Card } from '@/components/ui/Card';
import { FormField, inputClass } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { QtySummaryGrid } from '@/components/ui/QuantitySummary';
import { supabase } from '@/lib/supabase';
import { exportCsv } from '@/lib/reportExport';
import { todayISO } from '@/lib/format';
import { summarizeSalesOrder, type OrderQtySummary } from '@/lib/orderQuantities';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';

const fmt = (n: number) => Number(n || 0).toLocaleString('en-IN');

export function QuantityTrackingPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [wos, setWos] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [batchesAvailable, setBatchesAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [customer, setCustomer] = useState('');
  const [search, setSearch] = useState('');
  const [hideComplete, setHideComplete] = useState(false);
  const [selected, setSelected] = useState<OrderQtySummary | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'rejections'>('orders');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const soQ = (cols: string) => supabase.from('cnc_sales_orders').select(cols).order('created_at', { ascending: false }).limit(1000);
        let so = await soQ('id,order_no,lead_no,order_date,customer,part_name,part_no,quantity,status');
        if (so.error) so = await soQ('id,order_no,order_date,customer,part_name,part_no,quantity,status');
        const [wo, dc, inv, cu, bq] = await Promise.all([
          supabase.from('cnc_work_orders').select('sales_order,completed,rejected').limit(5000),
          supabase.from('cnc_deliveries').select('id,delivery_no,delivery_date,sales_order_id,sales_order_no,dispatch_qty,quantity,status').limit(5000),
          supabase.from('cnc_invoices').select('id,invoice_no,invoice_type,invoice_date,sales_order_id,delivery_id,dc_no,quantity,cancelled').limit(5000),
          supabase.from('cnc_customers').select('id,name').order('name').limit(2000),
          supabase.from('cnc_production_batches').select('*').order('created_at', { ascending: false }).limit(5000),
        ]);
        if (cancelled) return;
        const fail = [so, wo, dc, inv, cu].find((x) => x.error);
        if (fail) throw fail.error;
        setOrders(so.data || []);
        setWos(wo.data || []);
        setDeliveries(dc.data || []);
        setInvoices(inv.data || []);
        setCustomers(cu.data || []);
        if (bq.error) {
          setBatchesAvailable(false);
          setBatches([]);
        } else {
          setBatchesAvailable(true);
          setBatches(bq.data || []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load quantity tracking.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo<OrderQtySummary[]>(
    () => orders.map((o) => summarizeSalesOrder(o, wos, deliveries, invoices, batches)),
    [orders, wos, deliveries, invoices, batches],
  );

  const filtered = useMemo(() => rows.filter((q) => {
    if (customer && q.customer !== customers.find((c) => c.id === customer)?.name) return false;
    if (hideComplete && q.remaining <= 0 && q.invoiceable <= 0) return false;
    if (search) {
      const s = search.trim().toLowerCase();
      const hay = [q.soNo, q.customer, q.product].join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [rows, customers, customer, search, hideComplete]);

  const totals = useMemo(() => filtered.reduce((a, q) => ({
    ordered: a.ordered + q.ordered, good: a.good + q.good, rejected: a.rejected + q.rejected,
    remaining: a.remaining + q.remaining, fgAvailable: a.fgAvailable + q.fgAvailable,
    delivered: a.delivered + q.delivered, invoiced: a.invoiced + q.invoiced,
  }), { ordered: 0, good: 0, rejected: 0, remaining: 0, fgAvailable: 0, delivered: 0, invoiced: 0 }), [filtered]);

  const rejections = useMemo(() => {
    if (batchesAvailable && batches.length > 0) {
      return batches.filter((b) => Number(b.rejected_qty) > 0).slice(0, 100);
    }
    return [];
  }, [batches, batchesAvailable]);

  // Display rule: unique number only (backend order/delivery numbers stay stored).
  const uniqueOf = (orderNo: string) =>
    orders.find((x) => String(x.order_no) === String(orderNo))?.lead_no || orderNo;

  const exportReport = () => exportCsv(`Order_Quantity_Tracking_${todayISO()}`, [
    ['Company ID', 'Date', 'Company', 'Product', 'Status', 'Ordered Qty', 'Good Qty', 'Rejected Qty', 'Remaining to Produce', 'FG Available', 'Delivered Qty', 'Invoiced Qty', 'Invoiceable Qty', 'Progress %'],
    ...filtered.map((q) => {
      const o = orders.find((x) => String(x.order_no) === q.soNo);
      return [uniqueOf(q.soNo), o?.order_date || '', q.customer, q.product, o?.status || '', q.ordered, q.good, q.rejected, q.remaining, q.fgAvailable, q.delivered, q.invoiced, q.invoiceable, q.ordered > 0 ? Math.round((q.good / q.ordered) * 100) : 0];
    }),
    [],
    ['Rejection: Batch', 'Date', 'Company ID', 'Product', 'Rejected Qty', 'Rejection Type', 'Rejection Reason', 'Machine', 'Operator'],
    ...rejections.map((b: any) => [b.batch_no, String(b.created_at || '').slice(0, 10), uniqueOf(b.sales_order_no), b.product_name, Number(b.rejected_qty), b.rejection_type, b.rejection_reason, b.machine, b.operator]),
  ]);

  const exportReportRef = useRef(exportReport);
  exportReportRef.current = exportReport;

  const { setHeader, setTabActions, setHeaderCenter, setTabs } = useHeaderKpis();

  useEffect(() => {
    setHeader({ title: 'Order Quantity Tracking' });
    setHeaderCenter(null);
    setTabs([
      {
        label: 'Order Quantity Tracking',
        active: activeTab === 'orders',
        onClick: () => setActiveTab('orders'),
      },
      {
        label: 'Rejection Breakdown',
        active: activeTab === 'rejections',
        onClick: () => setActiveTab('rejections'),
      },
    ]);
    setTabActions(
      <div className="flex items-center gap-2">
        <select
          aria-label="Company"
          title="Company"
          className="h-7 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-brand-500 max-w-[130px] truncate"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
        >
          <option value="">All Companies</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={activeTab === 'orders' ? 'Order no, product…' : 'Search rejections…'}
            className="h-7 w-28 xl:w-40 pl-7 pr-2 text-xs rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500/30 focus:border-brand-500 transition-all placeholder:text-slate-400"
          />
        </div>
        {activeTab === 'orders' && (
          <label className="hidden xl:inline-flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideComplete}
              onChange={(e) => setHideComplete(e.target.checked)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span>Hide complete</span>
          </label>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={14} />}
          onClick={() => exportReportRef.current()}
          disabled={loading}
          className="h-7 py-1 text-xs px-2.5 shadow-sm"
        >
          Export CSV
        </Button>
      </div>
    );
    return () => {
      setHeader(null);
      setHeaderCenter(null);
      setTabs([]);
      setTabActions(null);
    };
  }, [setHeader, setHeaderCenter, setTabs, setTabActions, activeTab, customer, customers, search, hideComplete, loading]);

  const summaryBoxes = [
    { label: 'Ordered', value: totals.ordered, tone: 'border-blue-200 bg-blue-50/60 text-blue-900', labelTone: 'text-blue-700' },
    { label: 'Good', value: totals.good, tone: 'border-emerald-200 bg-emerald-50/60 text-emerald-900', labelTone: 'text-emerald-700' },
    { label: 'Rejected', value: totals.rejected, tone: 'border-rose-200 bg-rose-50/60 text-rose-900', labelTone: 'text-rose-700' },
    { label: 'Remaining', value: totals.remaining, tone: 'border-amber-200 bg-amber-50/60 text-amber-900', labelTone: 'text-amber-700' },
    { label: 'FG Available', value: totals.fgAvailable, tone: 'border-violet-200 bg-violet-50/60 text-violet-900', labelTone: 'text-violet-700' },
    { label: 'Delivered', value: totals.delivered, tone: 'border-slate-200 bg-slate-50 text-slate-900', labelTone: 'text-slate-600' },
    { label: 'Invoiced', value: totals.invoiced, tone: 'border-slate-200 bg-slate-50 text-slate-900', labelTone: 'text-slate-600' },
  ];

  return (
    <div className="p-3 sm:p-4 lg:px-4 lg:pt-1.5 lg:pb-4 bg-grid min-h-full space-y-2">
      <div className="lg:hidden">
        <PageHeader
          title="Order Quantity Tracking"
          description="Partial production, rejections, batch deliveries and invoice quantities — reconciled from live ERP rows."
          actions={<Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportReport} disabled={loading}><span>Export CSV</span></Button>}
        />
        <div className="flex gap-2 border-b border-slate-200 my-2">
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`pb-2 text-xs font-bold border-b-2 ${activeTab === 'orders' ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500'}`}
          >
            Order Quantity Tracking
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rejections')}
            className={`pb-2 text-xs font-bold border-b-2 ${activeTab === 'rejections' ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500'}`}
          >
            Rejection Breakdown
          </button>
        </div>
      </div>
      {error && <div className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</div>}
      <div className="lg:hidden">
        <Card className="p-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <FormField label="Company">
              <select className={inputClass} value={customer} onChange={(e) => setCustomer(e.target.value)}>
                <option value="">All Companies</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Search Order / Product">
              <input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order no, company, product…" />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-slate-600 pb-2">
              <input type="checkbox" checked={hideComplete} onChange={(e) => setHideComplete(e.target.checked)} />
              Hide fully complete orders
            </label>
            <div className="text-xs text-slate-500 pb-2">{loading ? 'Loading…' : `${filtered.length} orders`}{!batchesAvailable && ' · per-batch traceability needs migration 20260929010000'}</div>
          </div>
        </Card>
      </div>

      {activeTab === 'orders' && (
        <>
          {/* Small compact summary boxes immediately below top line */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {summaryBoxes.map((b) => (
              <div
                key={b.label}
                className={`flex items-center justify-between px-3 py-1.5 rounded-lg border shadow-xs ${b.tone}`}
              >
                <span className={`text-[10px] font-bold uppercase tracking-wider ${b.labelTone}`}>{b.label}</span>
                <span className="text-sm font-black tabular-nums">{fmt(Number(b.value))}</span>
              </div>
            ))}
          </div>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[1100px]">
                <thead>
                  <tr className="text-left text-slate-500 uppercase text-[10px] border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2">Company ID</th><th className="px-3 py-2">Company</th><th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Good</th>
                    <th className="px-3 py-2 text-right">Rejected</th><th className="px-3 py-2 text-right">Remaining</th>
                    <th className="px-3 py-2 text-right">FG Avail</th><th className="px-3 py-2 text-right">Delivered</th>
                    <th className="px-3 py-2 text-right">Invoiced</th><th className="px-3 py-2 text-right">Invoiceable</th>
                    <th className="px-3 py-2">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={12} className="px-3 py-6 text-center text-slate-500"><PackageSearch className="inline mr-2" size={16} />Loading live quantities…</td></tr>}
                  {!loading && filtered.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-slate-500">No orders match the filters.</td></tr>}
                  {filtered.map((q) => (
                    <tr key={`${q.soId ?? ''}-${q.soNo}`} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => setSelected(selected?.soNo === q.soNo ? null : q)}>
                      <td className="px-3 py-2 font-mono font-semibold">{uniqueOf(q.soNo)}</td>
                      <td className="px-3 py-2">{q.customer || '—'}</td>
                      <td className="px-3 py-2">{q.product || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(q.ordered)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">{fmt(q.good)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-rose-600">{fmt(q.rejected)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(q.remaining)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(q.fgAvailable)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(q.delivered)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(q.invoiced)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(q.invoiceable)}</td>
                      <td className="px-3 py-2 min-w-[110px]">
                        <div className="h-1.5 rounded-full bg-slate-200/70 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(q.progress * 100)}%` }} /></div>
                        <span className="text-[10px] text-slate-500 tabular-nums">{Math.round(q.progress * 100)}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selected && (
              <div className="border-t border-slate-200 bg-violet-50/40 p-4">
                <h3 className="font-bold text-sm text-violet-900 uppercase mb-2">Quantity Tracking — {selected.soNo}</h3>
                <QtySummaryGrid q={selected} />
              </div>
            )}
          </Card>
        </>
      )}

      {activeTab === 'rejections' && (
        <Card className="p-4">
          <h2 className="font-bold text-sm mb-3">Rejection Breakdown {batchesAvailable ? '' : '(work-order totals — per-batch detail needs migration 20260929010000)'}</h2>
          {batchesAvailable && rejections.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[900px]">
                <thead><tr className="text-left text-slate-500 uppercase text-[10px] border-b border-slate-200"><th className="py-2">Batch</th><th className="py-2">Date</th><th className="py-2">Company ID</th><th className="py-2">Product</th><th className="py-2 text-right">Rejected</th><th className="py-2">Type</th><th className="py-2">Reason</th><th className="py-2">Machine</th><th className="py-2">Operator</th></tr></thead>
                <tbody>
                  {rejections.map((b: any) => (
                    <tr key={b.id || b.batch_no} className="border-t border-slate-100">
                      <td className="py-2 font-mono font-semibold">{b.batch_no}</td>
                      <td className="py-2">{String(b.created_at || '').slice(0, 10)}</td>
                      <td className="py-2 font-mono">{uniqueOf(b.sales_order_no) || '—'}</td>
                      <td className="py-2">{b.product_name || '—'}</td>
                      <td className="py-2 text-right tabular-nums font-semibold text-rose-600">{fmt(Number(b.rejected_qty))}</td>
                      <td className="py-2">{b.rejection_type || '—'}</td>
                      <td className="py-2">{b.rejection_reason || '—'}</td>
                      <td className="py-2">{b.machine || '—'}</td>
                      <td className="py-2">{b.operator || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[700px]">
                <thead><tr className="text-left text-slate-500 uppercase text-[10px] border-b border-slate-200"><th className="py-2">Company ID</th><th className="py-2">Company</th><th className="py-2">Product</th><th className="py-2 text-right">Rejected Qty</th><th className="py-2 text-right">Good Qty</th></tr></thead>
                <tbody>
                  {filtered.filter((q) => q.rejected > 0).map((q) => (
                    <tr key={`${q.soId ?? ''}-${q.soNo}`} className="border-t border-slate-100">
                      <td className="py-2 font-mono font-semibold">{uniqueOf(q.soNo)}</td>
                      <td className="py-2">{q.customer || '—'}</td>
                      <td className="py-2">{q.product || '—'}</td>
                      <td className="py-2 text-right tabular-nums font-semibold text-rose-600">{fmt(q.rejected)}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(q.good)}</td>
                    </tr>
                  ))}
                  {!filtered.some((q) => q.rejected > 0) && <tr><td colSpan={5} className="py-6 text-center text-slate-500">No rejections recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

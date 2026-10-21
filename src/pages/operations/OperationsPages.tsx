import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Upload, Eye, Plus, Printer, Search } from 'lucide-react';
import { Badge, Button, Card, statusToVariant } from '@/components/ui/Card';
import { FormField, inputClass, Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { supabase } from '@/lib/supabase';
import { exportCsv, escapeHtml, printHtml } from '@/lib/reportExport';
import { formatDate, todayISO } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { intersectRange } from '@/lib/globalDate';
import { downloadBrandedDocument } from '@/lib/brandedDocument';

type Delivery = Record<string, any> & { id: string; delivery_no: string; delivery_date: string | null; customer_name: string | null; part_name: string | null; quantity: number | null; dispatch_qty: number | null; status: string | null; sales_order_id: string | null; sales_order_no: string | null };
type SalesOrder = { id: string; order_no: string; lead_no?: string | null; customer: string; customer_id: string | null; part_name: string; part_no: string | null; quantity: number; delivered: number | null; delivery_date: string | null };
// Display rule: screens show the UNIQUE number only (lead_no); backend
// order/delivery numbers stay stored and are used for documents.
const PAGE_SIZE = 10;
const tabs = ['All Deliveries', 'Pending Deliveries', 'Partially Delivered', 'Delivered', 'Returns'];
const quantity = (d: Delivery) => Number(d.dispatch_qty ?? d.quantity ?? 0);
const uniqueForOrder = (so: SalesOrder | undefined | null) => so?.lead_no || so?.order_no || '—';
const uniqueForDelivery = (r: Delivery, so?: SalesOrder | null) =>
  so?.lead_no || r.sales_order_no || r.delivery_no || '—';
const orderDelivered = (records: Delivery[], orderId: string | null) => orderId
  ? records.filter(x => x.sales_order_id === orderId && !['Cancelled', 'Returned', 'Return'].includes(String(x.status))).reduce((n, x) => n + quantity(x), 0)
  : 0;
/** Good produced for an order from live work-order rows (rejected excluded). */
const woGoodFor = (wos: any[], orderNo: string | null) => {
  const rows = orderNo ? wos.filter(w => String(w.sales_order || '') === String(orderNo)) : [];
  return { hasRows: rows.length > 0, good: rows.reduce((n, w) => n + Number(w.completed || 0), 0) };
};
const statusFor = (d: Delivery, records: Delivery[] = [], order?: SalesOrder) => {
  if (d.status === 'Cancelled' || d.status === 'Returned' || d.status === 'Return') return 'Returned';
  const delivered = orderDelivered(records, d.sales_order_id);
  if (order && delivered >= Number(order.quantity || 0)) return 'Delivered';
  if (order && delivered > 0) return 'Partially Delivered';
  if (d.status === 'Ready for Invoice') return 'Ready for Invoice';
  return d.status === 'Delivered' || d.status === 'Billed' ? 'Delivered' : 'Pending';
};

export function DeliveriesPage() {
  const { company } = useAuth();
  const { from: globalFrom, to: globalTo } = useGlobalDateFilter();
  const navigate = useNavigate();
  const [records, setRecords] = useState<Delivery[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [invoiceLinks, setInvoiceLinks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState(tabs[0]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [edit, setEdit] = useState<Delivery | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ sales_order_id: '', delivery_no: '', delivery_date: todayISO(), quantity: '', delivery_address: '', vehicle_no: '', transport: '', driver_contact: '', remarks: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // Read the canonical table shared with the Pipeline; RLS supplies company scope.
      const [d, inv, wo] = await Promise.all([
        supabase.from('cnc_deliveries').select('*').order('delivery_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000),
        supabase.from('cnc_invoices').select('id,invoice_no,delivery_id,dc_no').limit(2000),
        supabase.from('cnc_work_orders').select('sales_order,completed,rejected').limit(5000),
      ]);
      // lead_no is newer than some databases: retry without it rather than failing the page.
      let so = await supabase.from('cnc_sales_orders').select('id,order_no,lead_no,customer,customer_id,part_name,part_no,quantity,delivered,delivery_date').order('created_at', { ascending: false }).limit(2000);
      if (so.error) {
        so = await supabase.from('cnc_sales_orders').select('id,order_no,customer,customer_id,part_name,part_no,quantity,delivered,delivery_date').order('created_at', { ascending: false }).limit(2000) as any;
      }
      if (d.error) throw d.error;
      if (so.error) throw so.error;
      setRecords((d.data || []) as Delivery[]);
      setOrders((so.data || []) as SalesOrder[]);
      setWorkOrders(wo.error ? [] : (wo.data || []));
      if (!inv.error) {
        const links: Record<string, string> = {};
        for (const row of inv.data || []) {
          if (row.delivery_id) links[String(row.delivery_id)] = row.invoice_no || '';
          if (row.dc_no) links[`dc:${row.dc_no}`] = row.invoice_no || '';
        }
        setInvoiceLinks(links);
      }
    } catch (e) {
      setRecords([]); setOrders([]); setError(e instanceof Error ? e.message : 'Unable to load delivery challans. Please try again.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load, company?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // The global Topbar date range intersects this page's own From/To.
    const { from: effFrom, to: effTo } = intersectRange(from, to, globalFrom, globalTo);
    return records.filter(r => {
      const so = orders.find(x => x.id === r.sales_order_id);
      const rowStatus = statusFor(r, records, so);
      const text = [r.delivery_no, r.invoice_no, r.customer_name, so?.customer, r.project_name, r.part_name, r.sales_order_no, so?.part_no].filter(Boolean).join(' ').toLowerCase();
      const date = String(r.delivery_date || '').slice(0, 10);
      return (!q || text.includes(q)) && (!effFrom || date >= effFrom) && (!effTo || date <= effTo)
        && (!customer || (r.customer_name || so?.customer) === customer)
        && (!status || rowStatus === status)
        && (tab === tabs[0] || rowStatus === tab.replace(' Deliveries', '') || (tab === 'Returns' && rowStatus === 'Returned'));
    });
  }, [records, orders, search, from, to, globalFrom, globalTo, customer, status, tab]);
  const customers = useMemo(() => [...new Set(records.map(r => r.customer_name).filter(Boolean))] as string[], [records]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const summary = useMemo(() => ({
    total: records.length,
    dispatched: records.reduce((n, r) => n + quantity(r), 0),
    pending: orders.reduce((n, o) => n + Math.max(0, Number(o.quantity || 0) - orderDelivered(records, o.id)), 0),
    partial: orders.filter(o => orderDelivered(records, o.id) > 0 && orderDelivered(records, o.id) < Number(o.quantity || 0)).length,
    delivered: orders.filter(o => Number(o.quantity || 0) > 0 && orderDelivered(records, o.id) >= Number(o.quantity || 0)).length,
  }), [records, orders]);

  const startNew = () => {
    setEdit(null);
    setForm({ sales_order_id: '', delivery_no: '', delivery_date: todayISO(), quantity: '', delivery_address: '', vehicle_no: '', transport: '', driver_contact: '', remarks: '' });
    setFormOpen(true);
  };
  /** Prefill = remaining order qty clamped by good-produced availability. */
  const prefillQty = (so: SalesOrder | undefined) => {
    if (!so) return '';
    const sent = records.filter(r => r.sales_order_id === so.id && !['Cancelled', 'Returned', 'Return'].includes(String(r.status))).reduce((n, r) => n + quantity(r), 0);
    const rem = Math.max(0, Number(so.quantity || 0) - sent);
    const { hasRows, good } = woGoodFor(workOrders, so.order_no);
    if (!hasRows) return String(rem);
    return String(Math.max(0, Math.min(rem, good - sent)));
  };
  const formAvail = useMemo(() => {
    const so = orders.find(x => x.id === form.sales_order_id);
    if (!so) return null;
    const sent = records.filter(r => r.sales_order_id === so.id && !['Cancelled', 'Returned', 'Return'].includes(String(r.status)) && r.id !== edit?.id).reduce((n, r) => n + quantity(r), 0);
    const { hasRows, good } = woGoodFor(workOrders, so.order_no);
    if (!hasRows) return null;
    return Math.max(0, good - sent);
  }, [orders, records, workOrders, form.sales_order_id, edit?.id]);
  const save = async () => {
    const so = orders.find(x => x.id === form.sales_order_id);
    const qty = Number(form.quantity);
    if (!so || !Number.isFinite(qty) || qty <= 0 || !form.delivery_no.trim()) { setError('Select a sales order, enter a DC number, and provide a positive quantity.'); return; }
    const already = records.filter(x => x.sales_order_id === so.id && x.id !== edit?.id && !['Cancelled', 'Returned'].includes(String(x.status))).reduce((n, x) => n + quantity(x), 0);
    const remaining = Math.max(0, Number(so.quantity || 0) - already);
    if (qty > remaining) { setError(`Dispatch quantity exceeds the remaining order quantity of ${remaining}.`); return; }
    // Good-produced cap: never dispatch more than produced good minus delivered.
    // Orders without work-order rows (trade/stock deliveries) skip this check.
    const { hasRows, good } = woGoodFor(workOrders, so.order_no);
    if (hasRows) {
      const avail = Math.max(0, good - already);
      if (qty > avail) { setError(`Only ${avail} good finished goods are produced for this order (${good} good minus ${already} delivered). Rejected quantity can never be dispatched.`); return; }
    }
    // Where the finished part is in the item master, reject dispatches that exceed current FG stock.
    if (so.part_no) {
      const { data: part, error: partError } = await supabase.from('cnc_parts').select('id,stock_qty').eq('part_no', so.part_no).maybeSingle();
      if (partError) { setError(partError.message); return; }
      const available = Number(part?.stock_qty || 0) + (edit ? quantity(edit) : 0);
      if (part && qty > available) { setError(`Only ${available} finished goods are currently available for this delivery.`); return; }
    }
    setBusy(true); setError('');
    const payload = {
      delivery_no: form.delivery_no.trim(), sales_order_id: so.id, sales_order_no: so.order_no,
      customer_id: so.customer_id, customer_name: so.customer, part_name: so.part_name,
      quantity: qty, dispatch_qty: qty, delivery_date: form.delivery_date || null,
      delivery_address: form.delivery_address, vehicle_no: form.vehicle_no, transport: form.transport,
      driver_contact: form.driver_contact, remarks: form.remarks, status: edit?.status || 'Pending',
    };
    try {
      const result = edit
        ? await supabase.from('cnc_deliveries').update(payload).eq('id', edit.id).select('*').single()
        : await supabase.from('cnc_deliveries').insert(payload).select('*').single();
      if (result.error) throw result.error;
      setFormOpen(false); setEdit(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save the delivery challan.'); }
    finally { setBusy(false); }
  };
  const exportRows = () => exportCsv('Delivery_Challans_' + todayISO(), [
    ['Company ID', 'Date', 'Company', 'Sales Order', 'Part', 'Order Qty', 'Delivered Qty', 'Pending Qty', 'Status', 'Invoice No'],
    ...filtered.map(r => { const so = orders.find(x => x.id === r.sales_order_id); const delivered = orderDelivered(records, r.sales_order_id);
      return [uniqueForDelivery(r, so), r.delivery_date || '', r.customer_name || '', uniqueForOrder(so), r.part_name || '', so?.quantity ?? '', delivered, Math.max(0, Number(so?.quantity || 0) - delivered), statusFor(r, records, so), invoiceLinks[r.id] || invoiceLinks[`dc:${r.delivery_no}`] || '']; }),
  ]);
  const printSelected = (r: Delivery) => printHtml(`Delivery Challan ${r.delivery_no}`, `<h1>ARGUS CNC</h1><h2>Delivery Challan</h2><p><b>DC:</b> ${escapeHtml(r.delivery_no)} &nbsp; <b>Date:</b> ${escapeHtml(formatDate(r.delivery_date))}</p><p><b>Company:</b> ${escapeHtml(r.customer_name || '')}<br/><b>Sales Order:</b> ${escapeHtml(r.sales_order_no || '')}<br/><b>Part:</b> ${escapeHtml(r.part_name || '')}<br/><b>Quantity:</b> ${quantity(r)}<br/><b>Vehicle:</b> ${escapeHtml(r.vehicle_no || '')}</p>`);
  const downloadChallan = async (r: Delivery) => {
    const so = orders.find(x => x.id === r.sales_order_id);
    const qty = quantity(r);
    await downloadBrandedDocument({
      companyName: company?.company_name || 'ARGUS CNC',
      title: 'Delivery Challan',
      documentNo: r.delivery_no,
      date: r.delivery_date,
      details: [
        ['Company', r.customer_name || so?.customer],
        ['Delivery Address', r.delivery_address],
        ['Sales Order', r.sales_order_no || so?.order_no],
        ['Project', r.project_name],
        ['Vehicle', r.vehicle_no],
        ['Transport', r.transport],
        ['Driver Contact', r.driver_contact],
        ['Remarks', r.remarks],
      ],
      columns: ['#', 'Description', 'Quantity', 'Unit'],
      rows: [[1, r.part_name || so?.part_name || '—', qty, r.unit || 'pcs']],
    });
  };

  return <div className="p-4 lg:p-6 bg-grid min-h-full space-y-4">
    <PageHeader title="Delivery" description="Create and manage delivery challans, track partial deliveries and pending quantities." actions={<><Button variant="secondary" size="sm" icon={<Upload size={14}/>} onClick={exportRows}>Export</Button><Button variant="secondary" size="sm" icon={<Printer size={14}/>} onClick={() => selected ? printSelected(selected) : window.print()}>Print</Button><Button size="sm" icon={<Plus size={14}/>} onClick={startNew}>New Delivery Challan</Button></>}/>
    {error && <div className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</div>}
    <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">{[
      ['Total DCs', summary.total], ['Total Qty Dispatched', summary.dispatched], ['Pending Delivery', summary.pending], ['Partially Delivered', summary.partial], ['Fully Delivered', summary.delivered],
    ].map(([label, value]) => <Card key={String(label)} className="p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-bold text-slate-800 mt-1">{loading ? '—' : Number(value).toLocaleString('en-IN')}</div></Card>)}</div>
    <div className="flex overflow-auto border-b">{tabs.map(x => <button key={x} onClick={() => { setTab(x); setPage(1); }} className={'px-4 py-2 text-xs font-semibold border-b-2 whitespace-nowrap ' + (tab === x ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500')}>{x}</button>)}</div>
    <Card className="p-3"><div className="grid grid-cols-2 lg:grid-cols-7 gap-2 items-end">
      <FormField label="From Date"><input type="date" className={inputClass} value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}/></FormField>
      <FormField label="To Date"><input type="date" className={inputClass} value={to} onChange={e => { setTo(e.target.value); setPage(1); }}/></FormField>
      <FormField label="Company"><select className={inputClass} value={customer} onChange={e => { setCustomer(e.target.value); setPage(1); }}><option value="">All Companies</option>{customers.map(x => <option key={x}>{x}</option>)}</select></FormField>
      <FormField label="Status"><select className={inputClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All</option>{tabs.slice(1).map(x => <option key={x} value={x === 'Pending Deliveries' ? 'Pending' : x === 'Returns' ? 'Returned' : x}>{x}</option>)}</select></FormField>
      <FormField label="Search"><div className="relative"><Search size={15} className="absolute left-3 top-2.5 text-slate-400"/><input className={inputClass + ' pl-9'} placeholder="DC, company, part, SO..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}/></div></FormField>
      <Button variant="secondary" onClick={() => { setFrom(''); setTo(''); setCustomer(''); setStatus(''); setSearch(''); setTab(tabs[0]); }}>Clear</Button>
    </div></Card>
    <Card className="overflow-hidden"><div className="overflow-auto"><table className="w-full text-left"><thead><tr className="bg-slate-50 border-b text-[10px] uppercase text-slate-500"><th className="p-3">#</th><th className="p-3">Company ID</th><th className="p-3">Date</th><th className="p-3">Company</th><th className="p-3">Project / SO</th><th className="p-3">Part Name</th><th className="p-3 text-right">Order Qty</th><th className="p-3 text-right">Delivered Qty</th><th className="p-3 text-right">Pending Qty</th><th className="p-3">Status</th><th className="p-3">Invoice No</th><th className="p-3">Actions</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={12} className="p-10 text-center text-slate-500">Loading delivery challans…</td></tr> : visible.map((r, i) => { const so = orders.find(x => x.id === r.sales_order_id); const q = orderDelivered(records, r.sales_order_id); const rowStatus = statusFor(r, records, so); return <tr key={r.id} className="border-b hover:bg-slate-50"><td className="p-3 text-xs">{(page - 1) * PAGE_SIZE + i + 1}</td><td className="p-3 font-mono text-xs">{uniqueForDelivery(r, so)}</td><td className="p-3 text-xs">{formatDate(r.delivery_date) || '—'}</td><td className="p-3 text-sm">{r.customer_name || so?.customer || '—'}</td><td className="p-3 text-xs">{uniqueForOrder(so)}</td><td className="p-3 text-sm">{r.part_name || so?.part_name || '—'}</td><td className="p-3 text-right text-xs">{so?.quantity ?? '—'}</td><td className="p-3 text-right text-xs">{q}</td><td className="p-3 text-right text-xs">{so ? Math.max(0, Number(so.quantity || 0) - q) : '—'}</td><td className="p-3"><Badge variant={statusToVariant(rowStatus)} dot>{rowStatus}</Badge></td><td className="p-3 text-xs">{invoiceLinks[r.id] || invoiceLinks[`dc:${r.delivery_no}`] || '—'}</td><td className="p-3"><Button variant="secondary" size="sm" onClick={() => setSelected(r)} aria-label="View delivery"><Eye size={14}/></Button></td></tr>; })}
      {!loading && visible.length === 0 && <tr><td colSpan={12} className="p-10 text-center text-slate-500">No delivery challans found for these filters.</td></tr>}
    </tbody></table></div><div className="flex items-center justify-between border-t p-3 text-xs text-slate-500"><span>{filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} entries</span><div className="flex items-center gap-3"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>{page}/{pages}</span><button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div></div></Card>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card className="p-4"><h3 className="font-semibold text-sm mb-3">Delivery Summary (This Month)</h3>{tabs.slice(1,4).map((x, i) => { const n = records.filter(r => String(r.delivery_date || '').slice(0,7) === todayISO().slice(0,7) && statusFor(r, records, orders.find(x => x.id === r.sales_order_id)) === ['Pending','Partially Delivered','Delivered'][i]).length; return <div key={x} className="flex justify-between py-1.5 text-sm"><span>{x}</span><b>{n}</b></div>; })}</Card>
      <Card className="p-4"><h3 className="font-semibold text-sm mb-3">Top Companies (Delivery Qty)</h3>{Object.entries(records.reduce<Record<string, number>>((a, r) => { const key = r.customer_name || '—'; a[key] = (a[key] || 0) + quantity(r); return a; }, {})).sort((a,b) => b[1]-a[1]).slice(0,5).map(([name, qty]) => <div key={name} className="flex justify-between py-1.5 text-sm"><span>{name}</span><b>{qty.toLocaleString('en-IN')}</b></div>)}</Card>
      <Card className="p-4"><h3 className="font-semibold text-sm mb-3">Pending Deliveries</h3>{orders.filter(o => Math.max(0, Number(o.quantity || 0) - orderDelivered(records, o.id)) > 0).slice(0,8).map(o => <button key={o.id} className="w-full flex justify-between border-t py-2 text-left text-xs hover:text-brand-700" onClick={() => navigate('/sales/orders')}><span>{o.customer} · {o.part_name}<span className="block text-slate-500">{o.order_no} · Due {formatDate(o.delivery_date) || '—'}</span></span><b>{Math.max(0, Number(o.quantity || 0) - orderDelivered(records, o.id))} pending</b></button>)}{!orders.some(o => Number(o.quantity || 0) > orderDelivered(records, o.id)) && <div className="text-xs text-slate-500 py-4">No pending deliveries.</div>}</Card>
      <Card className="p-4"><h3 className="font-semibold text-sm mb-3">Recent Delivery Challans</h3>{records.slice(0,8).map(r => { const so = orders.find(x => x.id === r.sales_order_id); return <button key={r.id} className="w-full flex justify-between border-t py-2 text-left text-xs hover:text-brand-700" onClick={() => setSelected(r)}><span>{uniqueForDelivery(r, so)} · {r.customer_name}<span className="block text-slate-500">{r.part_name} · {formatDate(r.delivery_date)}</span></span><b>{quantity(r)}</b></button>; })}{!records.length && <div className="text-xs text-slate-500 py-4">No recent delivery challans.</div>}</Card>
    </div>
    <Modal open={!!selected} onClose={() => setSelected(null)} title={'Delivery Challan ' + (selected ? uniqueForDelivery(selected, orders.find(x => x.id === selected.sales_order_id)) : '')} subtitle="Record from the shared Sales Pipeline delivery table" size="lg" footer={<>{selected && !(invoiceLinks[selected.id] || invoiceLinks[`dc:${selected.delivery_no}`]) && <Button onClick={() => navigate(`/finance/invoices?delivery=${encodeURIComponent(selected.id)}`)}>Create Invoice</Button>}{selected && <Button variant="secondary" icon={<Download size={14}/>} onClick={() => void downloadChallan(selected)}>Download DC</Button>}<Button variant="secondary" onClick={() => selected && printSelected(selected)}>Print DC</Button><Button variant="secondary" onClick={() => { if (!selected) return; setEdit(selected); setForm({ sales_order_id: selected.sales_order_id || '', delivery_no: selected.delivery_no || '', delivery_date: String(selected.delivery_date || '').slice(0,10) || todayISO(), quantity: String(quantity(selected)), delivery_address: selected.delivery_address || '', vehicle_no: selected.vehicle_no || '', transport: selected.transport || '', driver_contact: selected.driver_contact || '', remarks: selected.remarks || '' }); setSelected(null); setFormOpen(true); }}>Edit details</Button><Button onClick={() => setSelected(null)}>Close</Button></>}>
      {selected && (() => { const so = orders.find(x => x.id === selected.sales_order_id); return <div className="grid grid-cols-2 gap-3 text-sm">{[['Company',selected.customer_name],['Sales Order',uniqueForOrder(so)],['Part',selected.part_name],['Quantity',quantity(selected)],['Date',formatDate(selected.delivery_date)],['Address',selected.delivery_address],['Vehicle',selected.vehicle_no],['Transport',selected.transport],['Invoice',invoiceLinks[selected.id] || invoiceLinks[`dc:${selected.delivery_no}`] || 'Not Created'],['Remarks',selected.remarks]].map(([k,v])=><div key={String(k)} className="border-b py-2"><div className="text-xs text-slate-500">{k}</div><div>{v || '—'}</div></div>)}</div>; })()}
    </Modal>
    <Modal open={formOpen} onClose={() => setFormOpen(false)} title={edit ? 'Edit Delivery Challan' : 'New Delivery Challan'} subtitle="Saves to cnc_deliveries, the same records used by the Sales Pipeline." size="lg" footer={<><Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button><Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : edit ? 'Save Changes' : 'Create Challan'}</Button></>}>
      <div className="grid grid-cols-2 gap-3"><FormField label="Sales Order" required><select className={inputClass} value={form.sales_order_id} disabled={!!edit} onChange={e => { const so=orders.find(x=>x.id===e.target.value); setForm({...form,sales_order_id:e.target.value,delivery_no:form.delivery_no || `DLV-${todayISO().replace(/-/g,'')}-${crypto.randomUUID().slice(0,6).toUpperCase()}`,quantity:prefillQty(so)}); }}><option value="">Choose Sales Order</option>{orders.map(o=><option key={o.id} value={o.id}>{o.lead_no || o.order_no} · {o.customer} · {o.part_name}</option>)}</select></FormField><FormField label="DC No" required><input className={inputClass} value={form.delivery_no} onChange={e=>setForm({...form,delivery_no:e.target.value})}/></FormField><FormField label="Date"><input type="date" className={inputClass} value={form.delivery_date} onChange={e=>setForm({...form,delivery_date:e.target.value})}/></FormField><FormField label="Dispatch Qty" required><input type="number" min="0" className={inputClass} value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/>{formAvail != null && <p className="text-[11px] font-semibold text-violet-700 mt-1">Available for Delivery: {formAvail} pcs (good produced minus delivered)</p>}</FormField><FormField label="Delivery Address"><input className={inputClass} value={form.delivery_address} onChange={e=>setForm({...form,delivery_address:e.target.value})}/></FormField><FormField label="Vehicle"><input className={inputClass} value={form.vehicle_no} onChange={e=>setForm({...form,vehicle_no:e.target.value})}/></FormField><FormField label="Transport"><input className={inputClass} value={form.transport} onChange={e=>setForm({...form,transport:e.target.value})}/></FormField><FormField label="Driver Contact"><input className={inputClass} value={form.driver_contact} onChange={e=>setForm({...form,driver_contact:e.target.value})}/></FormField><div className="col-span-2"><FormField label="Remarks"><input className={inputClass} value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})}/></FormField></div></div>
    </Modal>
  </div>;
}

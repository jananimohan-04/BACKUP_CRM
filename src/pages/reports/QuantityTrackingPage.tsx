// Order Quantity Tracking report: one reconciled row per sales order —
// Ordered / Good / Rejected / Remaining / FG Available / Delivered /
// Invoiced / Invoiceable — plus a rejection breakdown (type, reason,
// machine, operator, date). All quantities come from the shared
// reconciliation in src/lib/orderQuantities.ts, the same source every
// pipeline card, modal and detail view uses.

import { useEffect, useMemo, useState } from 'react';
import { Download, PackageSearch } from 'lucide-react';
import { Button, Card } from '@/components/ui/Card';
import { FormField, inputClass } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { QtySummaryGrid } from '@/components/ui/QuantitySummary';
import { supabase } from '@/lib/supabase';
import { exportCsv } from '@/lib/reportExport';
import { todayISO } from '@/lib/format';
import { summarizeSalesOrder, type OrderQtySummary } from '@/lib/orderQuantities';

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

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full space-y-4">
      <PageHeader
        title="Order Quantity Tracking"
        description="Partial production, rejections, batch deliveries and invoice quantities — reconciled from live ERP rows."
        actions={<Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportReport} disabled={loading}><span>Export CSV</span></Button>}
      />
      {error && <div className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</div>}
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
      <div className="grid grid-cols-2 xl:grid-cols-7 gap-3">
        {[['Ordered', totals.ordered, 'blue'], ['Good', totals.good, 'emerald'], ['Rejected', totals.rejected, 'rose'], ['Remaining', totals.remaining, 'amber'], ['FG Available', totals.fgAvailable, 'violet'], ['Delivered', totals.delivered, 'slate'], ['Invoiced', totals.invoiced, 'slate']].map(([label, v, tone]) => (
          <Card key={label as string} className="p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
            <div className="font-bold text-lg tabular-nums">{fmt(Number(v))}</div>
          </Card>
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
    </div>
  );
}

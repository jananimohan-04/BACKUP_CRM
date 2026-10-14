import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { REJECTION_TYPES, recordProductionBatch, summarizeSalesOrder, type OrderQtySummary } from '@/lib/orderQuantities';
import { PagerFooter, usePager } from '@/components/ui/TablePager';
import { tint } from '@/lib/entryTints';
import { compactInput, inlineLbl } from '@/lib/compactFields';

// Rejected: one row per order (company + order) with how much was ordered, finished, rejected and what is left. The rejections
// themselves are kept as production batches (the same records the order's quantity tracking reads), so they reduce what can
// be delivered without creating anything on the pipeline board. An order is listed once; all its rejections open together.

const itemsOf = (so: any): { name: string; qty: number }[] => {
  try {
    const raw = typeof so?.items === 'string' ? JSON.parse(so.items) : so?.items;
    if (Array.isArray(raw)) return raw.map((it: any) => ({ name: String(it.partName || it.productName || it.part_name || it.description || '').trim(), qty: Number(it.quantity ?? it.qty) || 0 })).filter(x => x.name);
  } catch { /* fall back to the single product */ }
  return so?.part_name ? [{ name: String(so.part_name), qty: Number(so.quantity) || 0 }] : [];
};

interface Line { id?: string; product: string; qty: string; type: string; reason: string; notes: string }
const emptyLine = (): Line => ({ product: '', qty: '', type: '', reason: '', notes: '' });
const lineOf = (b: any): Line => ({ id: String(b.id), product: String(b.product_name ?? ''), qty: String(b.rejected_qty ?? ''), type: String(b.rejection_type ?? ''), reason: String(b.rejection_reason ?? ''), notes: String(b.notes ?? '') });

const Tile = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
  <div className={`rounded-lg border px-3 py-2 ${tone}`} data-testid="rej-tile">
    <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
    <p className="text-xl font-bold tabular-nums">{value}</p>
  </div>
);

function Summary({ q }: { q: OrderQtySummary | null }) {
  if (!q) return null;
  return (
    <div className="space-y-2" data-testid="rej-summary">
      <div className="grid grid-cols-4 gap-2">
        <Tile label="Ordered" value={q.ordered} tone="border-blue-200 bg-blue-50 text-blue-800" />
        <Tile label="Finished" value={q.good} tone="border-emerald-200 bg-emerald-50 text-emerald-800" />
        <Tile label="Rejected" value={q.rejected} tone="border-red-200 bg-red-50 text-red-700" />
        <Tile label="Remaining" value={q.remaining} tone="border-amber-200 bg-amber-50 text-amber-800" />
      </div>
      {q.products.length > 1 && (
        <table className="w-full text-xs">
          <thead className="text-slate-500"><tr><th className="py-1 text-left">Product</th><th className="py-1 text-right">Ordered</th><th className="py-1 text-right">Finished</th><th className="py-1 text-right">Rejected</th><th className="py-1 text-right">Remaining</th></tr></thead>
          <tbody>
            {q.products.map(p => (
              <tr key={p.name} className="border-t border-slate-100">
                <td className="py-1 font-medium text-slate-800">{p.name}</td><td className="py-1 text-right tabular-nums">{p.ordered}</td>
                <td className="py-1 text-right tabular-nums">{p.good}</td><td className="py-1 text-right tabular-nums text-red-600">{p.rejected}</td><td className="py-1 text-right tabular-nums">{p.remaining}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function RejectedModule({ onBack, refreshSignal, onChanged }: { onBack: () => void; refreshSignal?: number; onChanged?: () => void }) {
  const { profile } = useAuth() as any;
  const { companyFilter, setCompanyFilter, companyOptions } = useHeaderKpis();
  const [batches, setBatches] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [wos, setWos] = useState<any[]>([]);
  const [dcs, setDcs] = useState<any[]>([]);
  const [invs, setInvs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  // add / edit: the form; view: read-only detail of one order.
  // The entry form is inline on the Rejected page, so it starts open with a blank add
  // dialog. The popup is used only for viewing / editing an existing group (mode !== 'add'),
  // which is why the initial value is exactly what openAdd() builds.
  const [dlg, setDlg] = useState<null | { mode: 'add' | 'edit' | 'view'; company: string; orderNo: string; lines: Line[]; origIds: string[] }>({ mode: 'add', company: '', orderNo: '', lines: [emptyLine()], origIds: [] });
  // Inline confirmation shown after a successful save (the form stays on screen).
  const [savedNote, setSavedNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [b, o, w, d, i] = await Promise.all([
      supabase.from('cnc_production_batches').select('*').order('created_at', { ascending: false }),
      supabase.from('cnc_sales_orders').select('*'),
      supabase.from('cnc_work_orders').select('*'),
      supabase.from('cnc_deliveries').select('*'),
      supabase.from('cnc_invoices').select('*'),
    ]);
    setMissing(!!b.error);
    setBatches(b.error ? [] : (b.data ?? []));
    setOrders(o.data ?? []); setWos(w.data ?? []); setDcs(d.data ?? []); setInvs(i.data ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load, refreshSignal]);

  const rejected = useMemo(() => batches.filter(b => Number(b.rejected_qty) > 0), [batches]);
  const orderByNo = useMemo(() => new Map(orders.map(o => [String(o.order_no), o])), [orders]);
  const summaryOf = useCallback((orderNo: string): OrderQtySummary | null => {
    const o = orderByNo.get(orderNo); if (!o) return null;
    try { return summarizeSalesOrder(o, wos, dcs, invs, batches); } catch { return null; }
  }, [orderByNo, wos, dcs, invs, batches]);

  // One entry per order that has rejections.
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const b of rejected) { const k = String(b.sales_order_no ?? ''); m.set(k, [...(m.get(k) ?? []), b]); }
    return [...m.entries()].map(([orderNo, rows]) => {
      const o = orderByNo.get(orderNo);
      return { orderNo, rows, company: String(o?.customer || o?.customer_name || ''), ref: String(o?.lead_no || orderNo), total: rows.reduce((n, r) => n + (Number(r.rejected_qty) || 0), 0), q: summaryOf(orderNo), last: String(rows[0]?.created_at ?? '') };
    }).sort((a, b) => b.last.localeCompare(a.last));
  }, [rejected, orderByNo, summaryOf]);

  const q = search.trim().toLowerCase();
  const shown = groups.filter(g => {
    const matchesSearch = !q || `${g.company} ${g.ref} ${g.orderNo} ${g.rows.map(r => `${r.product_name} ${r.rejection_type} ${r.rejection_reason}`).join(' ')}`.toLowerCase().includes(q);
    const matchesCompany = !companyFilter || companyFilter === 'All Companies' ||
      g.company.trim().toLowerCase() === companyFilter.trim().toLowerCase();
    return matchesSearch && matchesCompany;
  });
  const grand = shown.reduce((n, g) => n + g.total, 0);

  const companies = useMemo(() => {
    const set = new Set<string>();
    orders.forEach(o => {
      const c = String(o.customer || o.customer_name || '').trim();
      if (c) set.add(c);
    });
    companyOptions.forEach(c => {
      if (c && c !== 'All Companies') set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [orders, companyOptions]);

  const openAdd = () => setDlg({ mode: 'add', company: '', orderNo: '', lines: [emptyLine()], origIds: [] });
  const openGroup = (g: (typeof groups)[number], mode: 'view' | 'edit') => setDlg({ mode, company: g.company, orderNo: g.orderNo, lines: g.rows.map(lineOf), origIds: g.rows.map(r => String(r.id)) });

  const chosenOrder = dlg ? orderByNo.get(dlg.orderNo) ?? null : null;
  const dlgSummary = dlg?.orderNo ? summaryOf(dlg.orderNo) : null;
  const baseProducts = chosenOrder ? itemsOf(chosenOrder) : [];
  const products = [...baseProducts, ...(dlg?.lines ?? []).filter(l => l.product && !baseProducts.some(p => p.name === l.product)).map(l => ({ name: l.product, qty: 0 }))];
  const companyOrders = dlg ? orders.filter(o => String(o.customer || o.customer_name || '').trim() === dlg.company) : [];

  const setLine = (i: number, patch: Partial<Line>) => setDlg(d => d && ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  // An order is listed once: choosing one that already has rejections loads them, so more are added to the same order.
  const pickOrder = (orderNo: string) => setDlg(d => {
    if (!d) return d;
    const existing = rejected.filter(b => String(b.sales_order_no ?? '') === orderNo);
    return { ...d, orderNo, lines: existing.length ? existing.map(lineOf) : [emptyLine()], origIds: existing.map(r => String(r.id)) };
  });

  const save = async () => {
    if (!dlg || dlg.mode === 'view') return;
    if (!dlg.company) return alert('Select the company.');
    if (!chosenOrder) return alert('Select the order.');
    if (dlg.lines.length === 0) return alert('Add at least one rejection.');
    for (let i = 0; i < dlg.lines.length; i++) {
      const l = dlg.lines[i]; const n = Number(l.qty); const at = dlg.lines.length > 1 ? ` (rejection ${i + 1})` : '';
      if (!l.product) return alert(`Select the product${at}.`);
      if (!Number.isFinite(n) || n <= 0) return alert(`Enter how many were rejected, more than 0${at}.`);
      if (!l.type) return alert(`Select the rejection type${at}.`);
      if (!l.reason.trim()) return alert(`Enter the rejection reason${at}.`);
    }
    setSaving(true);
    try {
      const soId = chosenOrder.id != null ? String(chosenOrder.id) : null; const soNo = String(chosenOrder.order_no);
      // Removed lines go, changed lines are updated, new lines become new batches.
      const keep = new Set(dlg.lines.map(l => l.id).filter(Boolean) as string[]);
      for (const id of dlg.origIds.filter(x => !keep.has(x))) {
        const r = await supabase.from('cnc_production_batches').delete().eq('id', id).select('id');
        if (r.error) throw r.error;
      }
      for (const l of dlg.lines) {
        const n = Number(l.qty);
        if (l.id) {
          const r = await supabase.from('cnc_production_batches').update({ sales_order_id: soId, sales_order_no: soNo, product_name: l.product, gross_qty: n, rejected_qty: n, rejection_type: l.type, rejection_reason: l.reason.trim(), notes: l.notes.trim() || null }).eq('id', l.id).select('id');
          if (r.error || (r.data ?? []).length === 0) throw r.error ?? new Error('A rejection could not be updated.');
        } else {
          const res: any = await recordProductionBatch({
            salesOrderId: soId, salesOrderNo: soNo, productName: l.product, batchNo: `REJ-${Date.now().toString().slice(-6)}`, grossQty: n, goodQty: 0, rejectedQty: n, reworkQty: 0,
            rejectionType: l.type, rejectionReason: l.reason.trim(), notes: l.notes.trim() || null, createdBy: profile?.email ?? null,
            idempotencyKey: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `rej-${Date.now()}-${Math.random()}`,
          });
          if (res?.pendingMigration) return alert('Batch storage is not provisioned. Apply the production-batches migration (20260929010000_production_batches.sql) first.');
          if (!res?.saved) return alert('Unable to record a rejection. Nothing more was saved.');
        }
      }
      setSavedNote(soNo);
      openAdd();
      await load(); onChanged?.();
    } catch (e: any) {
      alert(`Unable to save the rejections: ${e?.message ?? e}`);
    } finally { setSaving(false); }
  };

  const removeGroup = async (g: (typeof groups)[number]) => {
    if (!window.confirm(`Remove all ${g.rows.length} rejection(s) (${g.total} pcs) of ${g.company} · ${g.ref}? The quantity goes back to the order.`)) return;
    const res = await supabase.from('cnc_production_batches').delete().in('id', g.rows.map(r => r.id)).select('id');
    if (res.error || (res.data ?? []).length === 0) return alert(`Could not remove them: ${res.error?.message ?? 'nothing was deleted'}`);
    await load(); onChanged?.();
  };

  const view = dlg?.mode === 'view';

  const pager = usePager(shown, `${search}||${companyFilter}`);

  const searchInput = (
    <div className="relative shrink-0">
      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 pr-2.5 py-1 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-brand-500 bg-white shadow-sm w-36 sm:w-44" />
    </div>
  );

  // The rejection form itself: company / order picker, per-order summary and the
  // rejection line rows. Shared by the always-visible Add Rejected card above the table
  // and by the popup used to view or edit an existing group, so the fields and the
  // validation behind save() exist in exactly one place.
  const rejDialogBody = (<>
        {dlg && (
          <div className="space-y-4" data-testid="rej-dialog">
            {view || dlg.mode === 'edit' ? (
              <p className="text-base font-bold text-slate-900">{dlg.company} <span className="font-mono text-sm font-medium text-slate-500">({chosenOrder?.lead_no || dlg.orderNo})</span></p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 shrink-0 mr-1">
                  <button type="button" onClick={onBack} title="Back to Pipeline" className="p-1 hover:bg-slate-200/80 rounded-md transition-colors text-slate-600 shrink-0 cursor-pointer">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <h2 className="text-sm font-bold text-slate-800 shrink-0">Rejected</h2>
                  <span className="h-5 w-px shrink-0 bg-slate-300 ml-1" aria-hidden="true" />
                </div>
                <div className="flex items-center gap-1.5"><span className={inlineLbl}>Company *</span>
                  <select className={`${compactInput} w-[14rem]`} value={dlg.company} onChange={e => setDlg({ ...dlg, company: e.target.value, orderNo: '', lines: [emptyLine()], origIds: [] })}>
                    <option value="">Select company</option>
                    {companies.map(c => <option key={c} value={c}>{c}</option>)}
                  </select></div>
                <div className="flex items-center gap-1.5"><span className={inlineLbl}>Order *</span>
                  <select className={`${compactInput} w-[16rem]`} value={dlg.orderNo} disabled={!dlg.company} onChange={e => pickOrder(e.target.value)}>
                    <option value="">Select order</option>
                    {companyOrders.map(o => <option key={o.id} value={o.order_no}>{o.lead_no || o.order_no}{o.lead_no ? ` (${o.order_no})` : ''}</option>)}
                  </select></div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="h-6 w-px shrink-0 bg-slate-300 mx-0.5" aria-hidden="true" />
                  {searchInput}
                </div>
              </div>
            )}

            <Summary q={dlgSummary} />

            {dlg.mode === 'add' && dlg.origIds.length > 0 && (
              <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2" data-testid="rej-existing">This order already has {dlg.origIds.length} rejection{dlg.origIds.length === 1 ? '' : 's'}. They are shown below, so add the new one to the same order.</p>
            )}

            {view ? (
              <table className="w-full text-xs">
                <thead className="text-slate-500"><tr><th className="py-1 text-left">Date</th><th className="py-1 text-left">Product</th><th className="py-1 text-right">Rejected</th><th className="py-1 text-left pl-3">Type</th><th className="py-1 text-left">Reason</th><th className="py-1 text-left">Notes</th></tr></thead>
                <tbody>
                  {(rejected.filter(b => String(b.sales_order_no ?? '') === dlg.orderNo)).map(b => (
                    <tr key={b.id} className="border-t border-slate-100" data-testid="rej-view-line">
                      <td className="py-1.5 whitespace-nowrap">{String(b.created_at ?? '').slice(0, 10)}</td><td className="py-1.5 font-medium text-slate-800">{b.product_name}</td>
                      <td className="py-1.5 text-right font-bold text-red-600 tabular-nums">{b.rejected_qty}</td><td className="py-1.5 pl-3">{b.rejection_type}</td><td className="py-1.5">{b.rejection_reason}</td><td className="py-1.5 text-slate-500">{b.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <>
                <div className="space-y-3">
                  {dlg.lines.map((l, i) => (
                    <div key={l.id ?? `new-${i}`} className="rounded-lg border border-slate-200 bg-white/60 px-2.5 py-2" data-testid="rejection-line">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-500">Rejection {i + 1}{l.id ? '' : ' · new'}</span>
                        <div className="flex items-center gap-1.5"><span className={inlineLbl}>Product *</span>
                          <select className={`${compactInput} w-[13rem]`} value={l.product} disabled={!dlg.orderNo} onChange={e => setLine(i, { product: e.target.value })}>
                            <option value="">Select product</option>
                            {products.map(p => <option key={p.name} value={p.name}>{p.name}{p.qty ? ` · ordered ${p.qty}` : ''}</option>)}
                          </select></div>
                        <div className="flex items-center gap-1.5"><span className={inlineLbl}>Rejected Qty *</span>
                          <input type="number" min={0} className={`${compactInput} w-[5rem]`} value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} placeholder="Qty" /></div>
                        <div className="flex items-center gap-1.5"><span className={inlineLbl}>Type *</span>
                          <select className={`${compactInput} w-[10rem]`} value={l.type} onChange={e => setLine(i, { type: e.target.value })}>
                            <option value="">Select type</option>
                            {REJECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select></div>
                        <div className="flex items-center gap-1.5"><span className={inlineLbl}>Reason *</span>
                          <input className={`${compactInput} w-[11rem]`} value={l.reason} onChange={e => setLine(i, { reason: e.target.value })} placeholder="e.g. Oversize by 0.05mm" /></div>
                        <div className="flex items-center gap-1.5"><span className={inlineLbl}>Notes</span>
                          <input className={`${compactInput} w-[9rem]`} value={l.notes} onChange={e => setLine(i, { notes: e.target.value })} placeholder="Optional" /></div>
                        {dlg.lines.length > 1 && (
                          <button type="button" aria-label={`Remove rejection ${i + 1}`} className="shrink-0 text-[11px] font-semibold text-red-600 hover:underline"
                            onClick={() => setDlg(d => d && ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))}>Remove</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" disabled={!dlg.orderNo} onClick={() => setDlg(d => d && ({ ...d, lines: [...d.lines, emptyLine()] }))} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-800 disabled:opacity-40">
                  <Plus size={14} /> Add another rejection for this order
                </button>
              </>
            )}
          </div>
        )}
  </>);
 
  return (
    <div className="flex flex-col gap-2.5" data-testid="rejected-list">
      {dlg?.mode !== 'add' && (
        <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-rose-400/30 px-3 py-2 flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={onBack} className="p-1 hover:bg-slate-200 rounded-md transition-colors text-slate-600 shrink-0"><ArrowLeft className="w-4 h-4" /></button>
            <h2 className="text-sm font-bold text-slate-800 shrink-0">Rejected</h2>
          </div>
          {searchInput}
        </div>
      )}
      {/* Always-visible Add Rejected entry form. The same form the "Add Rejected" popup
          showed, refactored to sit above the table - view / edit still use the popup. */}
      {dlg?.mode === 'add' && (
        <section className={`rounded-xl shadow-sm border ${tint('Rejected').panel}`} data-testid="rej-entry-form">
          <div className="space-y-3 p-4">
            {savedNote && (
              <div role="status" data-testid="rej-saved-note" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                <span>&#10003; Rejections for {savedNote} saved. The list below has been refreshed.</span>
                <button type="button" onClick={() => setSavedNote('')} className="font-bold underline hover:text-emerald-900">Dismiss</button>
              </div>
            )}
            {rejDialogBody}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <Button variant="secondary" size="sm" onClick={openAdd}>Clear / Reset</Button>
              <Button size="sm" onClick={() => void save()} disabled={saving} className="!bg-rose-600 hover:!bg-rose-500 text-white shadow-md shadow-rose-500/25 !border-rose-600">{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        </section>
      )}
      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-rose-400/30 overflow-hidden flex flex-col">
      <div className="overflow-x-auto">
        {missing && <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Rejections are stored with production batches. Apply the production-batches migration (20260929010000_production_batches.sql) to use this list.</p>}
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <table className="erp-table erp-table-rose w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <th className="p-3 font-semibold">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Company (Order)</span>
                    <select
                      aria-label="Filter by Company"
                      title="Filter by Company"
                      value={companyFilter || 'All Companies'}
                      onChange={e => setCompanyFilter(e.target.value)}
                      className="text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[125px] truncate shadow-xs"
                    >
                      <option value="All Companies">All</option>
                      {companies.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="p-3 font-semibold text-right">Ordered</th><th className="p-3 font-semibold text-right">Finished</th>
                <th className="p-3 font-semibold text-right">Rejected</th><th className="p-3 font-semibold text-right">Remaining</th>
                <th className="p-3 font-semibold text-right">Entries</th><th className="p-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map(g => (
                <tr key={g.orderNo} className="border-b border-slate-100 hover:bg-slate-50 transition-colors" data-testid="rejected-row">
                  <td className="p-3">
                    <div className="font-semibold text-brand-700 text-sm">{g.company || '—'}</div>
                    <div className="font-mono text-xs text-slate-500">({g.ref}{g.ref !== g.orderNo ? ` · ${g.orderNo}` : ''})</div>
                  </td>
                  <td className="p-3 text-sm text-right tabular-nums">{g.q ? g.q.ordered : '—'}</td>
                  <td className="p-3 text-sm text-right tabular-nums text-emerald-700">{g.q ? g.q.good : '—'}</td>
                  <td className="p-3 text-sm font-bold text-right tabular-nums text-red-600">{g.total}</td>
                  <td className="p-3 text-sm text-right tabular-nums text-amber-700">{g.q ? g.q.remaining : '—'}</td>
                  <td className="p-3 text-sm text-right tabular-nums text-slate-500">{g.rows.length}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => openGroup(g, 'view')}>View</Button>
                      <Button variant="secondary" size="sm" onClick={() => openGroup(g, 'edit')}>Edit</Button>
                      <Button variant="secondary" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => void removeGroup(g)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-slate-500">No rejections recorded.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <PagerFooter pager={pager} />
      </div>

      <Modal open={!!dlg && dlg.mode !== 'add'} onClose={openAdd} title={view ? 'View Rejected' : dlg?.mode === 'edit' ? 'Edit Rejected' : 'Add Rejected'} size="lg" width={820}
        footer={view
          ? <Button variant="secondary" onClick={openAdd}>Close</Button>
          : <><Button variant="secondary" onClick={openAdd}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : dlg?.mode === 'edit' ? 'Save Changes' : 'Save'}</Button></>}>
        {rejDialogBody}
      </Modal>
    </div>
  );
}
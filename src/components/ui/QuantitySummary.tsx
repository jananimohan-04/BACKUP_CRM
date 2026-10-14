// Compact quantity displays shared by the pipeline, modals, detail views and
// the Order Tracking report. Labels always name the quantity type — never a
// bare "Quantity". Rejected quantity is shown for traceability but is never
// part of FG stock, DC quantity or invoice quantity.

import type { OrderQtySummary } from '@/lib/orderQuantities';

const fmt = (n: number) => Number(n || 0).toLocaleString('en-IN');

const tones: Record<string, string> = {
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
};

export function QtyBadge({ label, value, tone = 'slate', compact = false }: { label: string; value: string | number; tone?: keyof typeof tones; compact?: boolean }) {
  return (
    <div className={compact ? `rounded-lg border px-1.5 py-0.5 ${(tones as any)[tone] ?? tones.slate}` : `rounded-lg border px-2 py-1 ${(tones as any)[tone] ?? tones.slate}`}>
      <p className="text-[9px] font-bold uppercase tracking-widest opacity-70">{label}</p>
      <p className={compact ? 'text-xs font-extrabold tabular-nums leading-tight' : 'text-sm font-extrabold tabular-nums leading-tight'}>{value}</p>
    </div>
  );
}

/** ORDERED / GOOD / REJECTED / REMAINING / FG AVAILABLE / DELIVERED / INVOICED. */
export function QtySummaryGrid({ q, compact = false }: { q: OrderQtySummary; compact?: boolean }) {
  return (
    <div className={compact ? 'grid grid-cols-4 md:grid-cols-7 gap-1' : 'grid grid-cols-4 md:grid-cols-7 gap-2'}>
      <QtyBadge label="Ordered" value={`${fmt(q.ordered)}`} tone="blue" compact={compact} />
      <QtyBadge label="Finished" value={`${fmt(q.good)}`} tone="emerald" compact={compact} />
      <QtyBadge label="Rejected" value={`${fmt(q.rejected)}`} tone="rose" compact={compact} />
      <QtyBadge label="Remaining" value={`${fmt(q.remaining)}`} tone="amber" compact={compact} />
      <QtyBadge label="FG Available" value={`${fmt(q.fgAvailable)}`} tone="violet" compact={compact} />
      <QtyBadge label="Delivered" value={`${fmt(q.delivered)}`} tone="slate" compact={compact} />
      <QtyBadge label="Invoiced" value={`${fmt(q.invoiced)}`} tone="slate" compact={compact} />
    </div>
  );
}

/** Thin GOOD / ORDERED progress bar. Never uses gross produced quantity. */
export function QtyProgress({ q }: { q: OrderQtySummary }) {
  const pct = Math.round(q.progress * 100);
  return (
    <div>
      <div className="flex justify-between text-[10px] font-semibold text-slate-500 mb-0.5">
        <span>{fmt(q.good)} / {fmt(q.ordered)} completed</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200/70 overflow-hidden">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

/** Full reconciliation: production batches, deliveries, invoices, remainders. */
export function QtyBreakdown({ q }: { q: OrderQtySummary }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Production</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div><span className="text-slate-500">Gross Produced:</span> <b className="tabular-nums">{fmt(q.grossProduced)}</b></div>
          <div><span className="text-slate-500">Good:</span> <b className="tabular-nums text-emerald-700">{fmt(q.good)}</b></div>
          <div><span className="text-slate-500">Rejected:</span> <b className="tabular-nums text-rose-700">{fmt(q.rejected)}</b></div>
          <div><span className="text-slate-500">Remaining to Produce:</span> <b className="tabular-nums">{fmt(q.remaining)}</b></div>
        </div>
        {q.batches.length > 0 && (
          <div className="mt-2 space-y-1">
            {q.batches.map((b: any) => (
              <div key={b.id || b.batch_no} className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs border-t border-slate-100 pt-1">
                <span className="font-mono font-semibold">{b.batch_no}</span>
                <span>Good <b className="tabular-nums">{fmt(Number(b.good_qty))}</b></span>
                <span>Rejected <b className="tabular-nums">{fmt(Number(b.rejected_qty))}</b></span>
                {b.rejection_type && <span className="text-slate-500">{b.rejection_type}{b.rejection_reason ? ` — ${b.rejection_reason}` : ''}</span>}
                {b.machine && <span className="text-slate-500">Mc: {b.machine}</span>}
              </div>
            ))}
          </div>
        )}
        {!q.batchesTracked && q.good + q.rejected > 0 && (
          <p className="text-[11px] text-slate-400 mt-1">Per-batch traceability needs migration 20260929010000_production_batches.sql.</p>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Finished Goods</p>
        <p className="text-xs">Available: <b className="tabular-nums">{fmt(q.fgAvailable)} pcs</b> <span className="text-slate-400">(good only — rejected never enters stock)</span></p>
      </div>
      {q.products && q.products.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Product Breakdown</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <thead><tr className="text-left text-slate-500 uppercase text-[10px] border-b border-slate-200">
                <th className="py-1 pr-2">Product</th><th className="py-1 pr-2 text-right">Ordered</th>
                <th className="py-1 pr-2 text-right">Good</th><th className="py-1 pr-2 text-right">Rejected</th>
                <th className="py-1 pr-2 text-right">Remaining</th><th className="py-1 pr-2 text-right">Delivered</th>
                <th className="py-1 pr-2 text-right">Invoiced</th><th className="py-1 text-right">Available</th>
              </tr></thead>
              <tbody>
                {q.products.map((p) => (
                  <tr key={p.name} className="border-t border-slate-100">
                    <td className="py-1 pr-2 font-medium">{p.name}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmt(p.ordered)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums font-semibold text-emerald-700">{fmt(p.good)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums font-semibold text-rose-600">{fmt(p.rejected)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmt(p.remaining)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmt(p.delivered)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmt(p.invoiced)}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(p.available)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Delivery ({q.deliveries.length} challan{q.deliveries.length === 1 ? '' : 's'})</p>
        {q.deliveries.length === 0 && <p className="text-xs text-slate-400">Nothing dispatched yet.</p>}
        {q.deliveries.map((d: any) => (
          <div key={d.id} className="flex justify-between text-xs border-t border-slate-100 py-0.5">
            <span className="font-mono">{d.delivery_no} <span className="text-slate-400">{String(d.delivery_date || '').slice(0, 10)}</span></span>
            <b className="tabular-nums">{fmt(Number(d.dispatch_qty ?? d.quantity))} pcs</b>
          </div>
        ))}
        <p className="text-xs mt-1">Total Delivered: <b className="tabular-nums">{fmt(q.delivered)} pcs</b></p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Invoice ({q.invoices.length})</p>
        {q.invoices.length === 0 && <p className="text-xs text-slate-400">Nothing invoiced yet.</p>}
        {q.invoices.map((i: any) => (
          <div key={i.id} className="flex justify-between text-xs border-t border-slate-100 py-0.5">
            <span className="font-mono">{i.invoice_no || 'Draft'} <span className="text-slate-400">{String(i.invoice_date || '').slice(0, 10)}</span></span>
            <b className="tabular-nums">{fmt(Number(i.quantity))} pcs</b>
          </div>
        ))}
        <p className="text-xs mt-1">Total Invoiced: <b className="tabular-nums">{fmt(q.invoiced)} pcs</b> · Still Invoiceable: <b className="tabular-nums">{fmt(q.invoiceable)} pcs</b></p>
      </div>
      <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700 mb-1">Remaining</p>
        <p className="text-xs">Production: <b className="tabular-nums">{fmt(q.remaining)}</b> · Delivery: <b className="tabular-nums">{fmt(q.fgAvailable)}</b> · Invoice: <b className="tabular-nums">{fmt(q.invoiceable)}</b></p>
      </div>
    </div>
  );
}

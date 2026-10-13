import { useState } from 'react';
import { ArrowLeft, Calculator, Cog, Package, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { calcWorkings, emptyWorkings, rowCost, type WorkRow, type Workings } from '@/lib/quotationWorkings';
import { MetalCalculatorPage, type BomMetalItem } from './MetalCalculatorPage';

const cell = 'w-full h-8 px-2 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-orange-500';
const numeric = (v: string) => v.replace(/[^0-9.,]/g, '');
let seq = 0;
const newRow = (description = '', qty = '', rate = ''): WorkRow => ({ id: `wk${++seq}`, description, qty, rate });
const inr = (n: number) => formatINR(n, { decimals: 'always' });

type Key = 'materials' | 'processes' | 'others';

/** Full-page cost workings for one quotation line: metal calculator -> BOM, process costing, other expenses,
 *  profit margin. "Save & Return to Quote" sets the line's unit price to the cost of one unit. */
export function ProductWorkingsPage({ title, initial, onBack, onSave }: {
  title: string; initial?: Workings; onBack: () => void; onSave: (w: Workings, unitPrice: number, leave: boolean) => void;
}) {
  const [w, setW] = useState<Workings>(() => initial ?? emptyWorkings());
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const r = calcWorkings(w);
  const change = (fn: (p: Workings) => Workings) => { setW(fn); setDirty(true); };
  const setRows = (k: Key, rows: WorkRow[]) => change(p => ({ ...p, [k]: rows }));
  const upd = (k: Key, id: string, patch: Partial<WorkRow>) => setRows(k, w[k].map(x => (x.id === id ? { ...x, ...patch } : x)));
  const del = (k: Key, id: string) => setRows(k, w[k].filter(x => x.id !== id));

  const addMetal = (it: BomMetalItem) => {
    change(p => ({ ...p, materials: [...p.materials, newRow(it.description, String(it.weightKg), it.ratePerKg !== null ? String(it.ratePerKg) : '')] }));
    setNote(it.ratePerKg === null ? 'Metal added to the BOM. Enter its rate (₹/kg) in the sheet below.' : 'Metal added to the BOM.');
  };
  const back = () => { if (!dirty || window.confirm('Leave without saving this product\'s workings?')) onBack(); };
  const save = (leave: boolean) => {
    if (r.issues.length) { setNote(r.issues[0]); return; }
    onSave(w, r.total, leave);
    if (!leave) { setDirty(false); setNote(`Saved. Unit price ${inr(r.total)} applied to the quotation line.`); }
  };

  const header = (k: Key, label: string, cls: string, color: string) => (
    <tr className={cls}><td colSpan={5} className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider ${color}`}>{label}</td></tr>
  );
  const rowsOf = (k: Key, empty: string, editable = true) => w[k].length === 0
    ? <tr><td colSpan={5} className="px-3 py-3 text-center text-xs italic text-slate-400">{empty}</td></tr>
    : w[k].map((row, i) => {
      const c = rowCost(row);
      return (
        <tr key={row.id} className="border-t border-slate-100" data-testid={`${k}-row`}>
          {editable ? <>
            <td className="px-3 py-1.5"><input className={cell} aria-label={`${k} ${i + 1} description`} value={row.description} onChange={e => upd(k, row.id, { description: e.target.value })} /></td>
            <td className="px-2 py-1.5 w-28"><input className={cell} inputMode="decimal" aria-label={`${k} ${i + 1} qty`} value={row.qty} onChange={e => upd(k, row.id, { qty: numeric(e.target.value) })} /></td>
            <td className="px-2 py-1.5 w-28"><input className={cell} inputMode="decimal" aria-label={`${k} ${i + 1} rate`} value={row.rate} onChange={e => upd(k, row.id, { rate: numeric(e.target.value) })} /></td>
          </> : <>
            <td className="px-3 py-2 text-xs text-slate-700">{row.description || '—'}</td>
            <td className="px-2 py-2 w-28 text-xs font-mono">{row.qty || '—'}</td>
            <td className="px-2 py-2 w-28 text-xs font-mono">{row.rate || '—'}</td>
          </>}
          <td className={`px-2 py-1.5 w-28 text-right font-mono text-xs ${Number.isNaN(c) ? 'text-red-500' : 'text-slate-800'}`}>{Number.isNaN(c) ? '—' : inr(c)}</td>
          <td className="px-2 py-1.5 w-10 text-center"><button type="button" aria-label={`Remove ${k} ${i + 1}`} onClick={() => del(k, row.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td>
        </tr>
      );
    });

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4" data-testid="product-workings">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-start gap-3 min-w-0">
          <button type="button" onClick={back} className="flex items-center gap-2 h-9 px-3 rounded-full border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-slate-100"><ArrowLeft size={15} /> Back to Quotation</button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Calculator size={20} className="text-orange-500 shrink-0" /> <span className="truncate">Product Workings: {title.trim() || 'Untitled product'}</span></h1>
            <p className="text-xs text-slate-500 mt-0.5">Configure raw material dimensions, machining operations, bought-out items &amp; profit margin</p>
          </div>
        </div>
        <button type="button" data-testid="save-return" onClick={() => save(true)} className="flex items-center gap-2 h-10 px-5 rounded-lg bg-orange-500 text-white text-sm font-bold shadow hover:bg-orange-600"><Save size={16} /> Save &amp; Return to Quote</button>
      </div>

      {note && <div role="status" className="text-sm rounded-lg px-3 py-2 border bg-emerald-50 border-emerald-200 text-emerald-800 flex justify-between"><span>{note}</span><button aria-label="Dismiss" onClick={() => setNote(null)}>×</button></div>}

      {/* 1. metal calculator */}
      <MetalCalculatorPage embedded={{ onAdd: addMetal }} />

      {/* 2 + 3. process and other expenses */}
      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div><h2 className="flex items-center gap-2 text-sm font-bold text-slate-800"><Cog size={15} className="text-rose-500" /> Process Costing (Machinery/Labour)</h2><p className="text-[11px] text-slate-500">Click Add Operation to type an operation, hours and rate.</p></div>
            <button type="button" data-testid="add-process" onClick={() => setRows('processes', [...w.processes, newRow()])} className="flex items-center gap-1 h-8 px-3 rounded-md bg-rose-600 text-white text-xs font-bold"><Plus size={13} /> Add Operation</button>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden"><table className="w-full">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="text-left px-3 py-2">Process Operation</th><th className="px-2 py-2 w-28 text-left">Hours / Qty</th><th className="px-2 py-2 w-28 text-left">Rate (₹)</th><th className="px-2 py-2 w-28 text-right">Total Cost</th><th className="w-10" /></tr></thead>
            <tbody>{rowsOf('processes', 'No operations configured. Click "Add Operation" above.')}</tbody></table></div>
          <p className="flex justify-between text-xs font-bold text-slate-600 mt-3 px-1"><span>TOTAL PROCESS COST:</span><span className="font-mono text-rose-600" data-testid="total-process">{inr(r.processes)}</span></p>
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div><h2 className="flex items-center gap-2 text-sm font-bold text-slate-800"><Package size={15} className="text-amber-600" /> Other Expenses (Bought Out)</h2><p className="text-[11px] text-slate-500">Consumables, packaging, paints, hardware.</p></div>
            <button type="button" data-testid="add-other" onClick={() => setRows('others', [...w.others, newRow()])} className="flex items-center gap-1 h-8 px-3 rounded-md border border-amber-300 bg-white text-amber-700 text-xs font-bold"><Plus size={13} /> Add Item</button>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden"><table className="w-full">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="text-left px-3 py-2">Item Detail</th><th className="px-2 py-2 w-28 text-left">Qty</th><th className="px-2 py-2 w-28 text-left">Unit Cost (₹)</th><th className="px-2 py-2 w-28 text-right">Total Cost</th><th className="w-10" /></tr></thead>
            <tbody>{rowsOf('others', 'No other expense items added. Click "Add Item" above.')}</tbody></table></div>
          <p className="flex justify-between text-xs font-bold text-slate-600 mt-3 px-1"><span>TOTAL OTHER EXPENSES:</span><span className="font-mono text-amber-600" data-testid="total-other">{inr(r.others)}</span></p>
        </section>
      </div>

      {/* 4. calculations sheet */}
      <section className="rounded-xl border border-indigo-100 bg-indigo-50/20 p-4">
        <h2 className="text-sm font-bold text-slate-800">Product Calculations Sheet</h2>
        <p className="text-[11px] text-slate-500 mb-3">Review raw materials, machining processes, and bought-out hardware for this active product.</p>
        <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="text-left px-3 py-2">Line item / description</th><th className="px-2 py-2 w-28 text-left">Qty / factor</th><th className="px-2 py-2 w-28 text-left">Unit rate (₹)</th><th className="px-2 py-2 w-28 text-right">Total cost</th><th className="w-10">Action</th></tr></thead>
            <tbody>
              {header('materials', '1. Metal shape components (raw materials)', 'bg-orange-50', 'text-orange-700')}
              {rowsOf('materials', 'No metal components added. Use the parameters card above to "Add Metal Item to Product BOM".')}
              {header('processes', '2. Process operations (labor/machining)', 'bg-indigo-50', 'text-indigo-700')}
              {rowsOf('processes', 'No processes configured.', false)}
              {header('others', '3. Other expenses (bought out / packaging)', 'bg-amber-50', 'text-amber-700')}
              {rowsOf('others', 'No other expenses configured.', false)}
            </tbody>
          </table>
          <div className="px-4 py-3 text-xs space-y-1.5 border-t border-slate-100 max-w-md ml-auto" data-testid="workings-summary">
            <p className="flex justify-between"><span>Materials Subtotal:</span><span className="font-mono">{inr(r.materials)}</span></p>
            <p className="flex justify-between"><span>Processes Subtotal:</span><span className="font-mono">{inr(r.processes)}</span></p>
            <p className="flex justify-between"><span>Other Expenses Subtotal:</span><span className="font-mono">{inr(r.others)}</span></p>
            <p className="flex justify-between items-center"><span>Profit Margin:</span>
              <span className="flex items-center gap-1"><input className={`${cell} !w-16 text-right`} inputMode="decimal" aria-label="Profit margin percent" value={w.marginPct} onChange={e => change(p => ({ ...p, marginPct: numeric(e.target.value) }))} />%</span></p>
            <p className="flex justify-between"><span>Profit Amount:</span><span className="font-mono">{inr(r.profit)}</span></p>
          </div>
          <div className="flex justify-between items-center px-4 py-3 bg-orange-50 border-t border-orange-100">
            <span className="text-xs font-bold text-orange-700 uppercase">Product total estimated cost (per unit):</span>
            <span className="font-mono text-xl font-extrabold text-orange-600" data-testid="workings-total">{inr(r.total)}</span>
          </div>
        </div>
        {r.issues.map(m => <p key={m} className="text-xs text-red-600 mt-2">{m}</p>)}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" data-testid="save-calcs" onClick={() => save(false)} className="flex items-center gap-2 h-9 px-4 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700"><Save size={15} /> Save Calculations</button>
          <button type="button" data-testid="clear-sheet" onClick={() => { change(() => emptyWorkings()); setNote(null); }} className="flex items-center gap-2 h-9 px-4 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><RotateCcw size={14} /> Clear Sheet</button>
        </div>
      </section>
    </div>
  );
}

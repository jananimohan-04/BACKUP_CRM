import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Card';
import { Time24 } from '@/components/ui/Time24';
import { supabase } from '@/lib/supabase';
import { insertTolerant } from '@/lib/partRouting';
import { generateJobNo } from '@/lib/jobCards';
import { parseYmd, ymd } from '@/lib/operationPlans';
import { buildRunPartChoices, ensureRunWorkOrder } from '@/lib/partOrders';

// One entry window for the four add popups (Actual / Planned, timeline and list). Line by line: Part, Qty, Process,
// Operator, Date, Start, End. The "+" on a line adds the next line straight after it: same part / qty / process /
// operator, starting when this one ends and running for the same time (09:00-10:00 gives 10:00-11:00).
//   mode "actual": records runs that really happened (finished qty, job cards, the part's finished total).
//   mode "plan":   plans future slots (planned qty, operation plans).

interface RunRow { key: string; partKey: string; qty: string; process: string; operator: string; date: string; start: string; end: string }
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r-${Date.now()}-${Math.random()}`);
const toMin = (hhmm: string) => { const [h, m] = (hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const toHhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const cell = 'h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm focus:border-brand-500 focus:outline-none';
const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** The line that follows `r`: same work, next slot of the same length (rolls to the next day at midnight). */
function nextRow(r: RunRow): RunRow {
  const startMin = toMin(r.start);
  const endMin = toMin(r.end);
  const len = endMin > startMin ? endMin - startMin : 60;
  let date = r.date;
  let s = endMin;
  if (s >= 24 * 60 - 1) {
    const d = parseYmd(r.date || ymd(new Date()));
    d.setDate(d.getDate() + 1);
    date = ymd(d);
    s = 0;
  }
  const e = Math.min(24 * 60 - 1, s + len);
  return { ...r, key: newKey(), date, start: toHhmm(s), end: toHhmm(e) };
}

interface RefData {
  salesOrders: any[]; inwards: any[]; wos: any[]; jobs: any[];
  processes: { name: string; machine: string }[]; operators: string[];
}
const EMPTY_REF: RefData = { salesOrders: [], inwards: [], wos: [], jobs: [], processes: [], operators: [] };

export function AddRunsModal({ open, onClose, initial, mode = 'actual', onSaved }: {
  open: boolean;
  onClose: () => void;
  initial: { date: string; start: string; end: string };
  mode?: 'actual' | 'plan';
  /** Called after saving, with the first line's date, so the page can reload and jump to it. */
  onSaved: (firstDate: string) => void;
}) {
  const plan = mode === 'plan';
  const blank = (): RunRow => ({ key: newKey(), partKey: '', qty: '', process: '', operator: '', date: initial.date, start: initial.start, end: initial.end });
  const [rows, setRows] = useState<RunRow[]>([blank()]);
  const [saving, setSaving] = useState(false);
  const [ref, setRef] = useState<RefData>(EMPTY_REF);

  // Everything the lines choose from is read fresh each time the window opens.
  useEffect(() => {
    if (!open) return;
    setRows([blank()]);
    let off = false;
    void (async () => {
      const [so, inw, w, p, jc, pl] = await Promise.all([
        supabase.from('cnc_sales_orders').select('id,order_no,customer,part_name,part_no,part_number,quantity,items,status,created_at,order_date'),
        supabase.from('cnc_inwards').select('*').neq('status', 'Deleted'),
        supabase.from('cnc_work_orders').select('*'),
        supabase.from('cnc_processes').select('*'),
        supabase.from('cnc_job_cards').select('work_order,op_no,operator'),
        supabase.from('cnc_operation_plans').select('operator'),
      ]);
      if (off) return;
      const seen = new Set<string>();
      const names = new Map<string, string>();
      [...(jc.data ?? []), ...(pl.error ? [] : (pl.data ?? []))].forEach((x: any) => {
        const t = String(x.operator ?? '').trim();
        if (t && t !== '—' && t !== '-' && !names.has(t.toLowerCase())) names.set(t.toLowerCase(), t);
      });
      setRef({
        salesOrders: so.error ? [] : (so.data ?? []),
        inwards: inw.error ? [] : (inw.data ?? []),
        wos: w.error ? [] : (w.data ?? []),
        jobs: jc.error ? [] : (jc.data ?? []),
        processes: ((p.data ?? []) as any[]).map((x) => ({ name: String(x.process_name ?? '').trim(), machine: String(x.machine_type ?? '').trim() }))
          .filter((x) => x.name && !seen.has(x.name) && !!seen.add(x.name)).sort((a, b) => a.name.localeCompare(b.name)),
        operators: [...names.values()].sort((a, b) => a.localeCompare(b)),
      });
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial.date, initial.start, initial.end]);

  const parts = useMemo(() => buildRunPartChoices(ref.salesOrders, ref.inwards, ref.wos), [ref.salesOrders, ref.inwards, ref.wos]);
  const upd = (key: string, patch: Partial<RunRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addAfter = (key: string) => setRows((rs) => {
    const i = rs.findIndex((r) => r.key === key);
    return i < 0 ? rs : [...rs.slice(0, i + 1), nextRow(rs[i]), ...rs.slice(i + 1)];
  });
  const remove = (key: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const save = async () => {
    // Check every line first, so a mistake on line 5 does not leave lines 1-4 half-saved.
    for (const [i, r] of rows.entries()) {
      const n = i + 1;
      if (!parts.find((p) => p.key === r.partKey)) return alert(`Line ${n}: select the part.`);
      if (!(Number(r.qty) > 0)) return alert(`Line ${n}: enter the ${plan ? 'planned' : 'finished'} quantity.`);
      const s = new Date(`${r.date}T${r.start}:00`);
      const e = new Date(`${r.date}T${r.end}:00`);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return alert(`Line ${n}: set a valid date and times.`);
      if (e.getTime() <= s.getTime()) return alert(`Line ${n}: the end must be after the start.`);
      if (!plan && e.getTime() > Date.now() + 60000) return alert(`Line ${n}: a run cannot end in the future. Use the Planned Timeline to plan ahead.`);
    }
    setSaving(true);
    try {
      const localWos = [...ref.wos]; // orders started during this save are reused by the lines after them
      const woByPart = new Map<string, any>();
      const opByWo = new Map<string, number>();
      const seqState = new Map<string, { ops: any[]; maxSeq: number; bySeq: Map<string, number> }>();
      for (const r of rows) {
        const part = parts.find((p) => p.key === r.partKey)!;
        let wo = woByPart.get(part.key);
        if (!wo) {
          wo = await ensureRunWorkOrder(part, localWos, plan ? 'Planned' : 'In Progress');
          if (!localWos.includes(wo)) localWos.push(wo);
          woByPart.set(part.key, wo);
          opByWo.set(wo.wo_no, Math.max(0, ...ref.jobs.filter((j) => String(j.work_order) === String(wo.wo_no)).map((j) => Number(j.op_no) || 0)));
        }
        const qty = Number(r.qty);
        const s = new Date(`${r.date}T${r.start}:00`);
        const e = new Date(`${r.date}T${r.end}:00`);
        const proc = ref.processes.find((p) => p.name === r.process);

        if (plan) {
          // The operation this slot belongs to: the order's own operation for that process, else the next free number.
          let st = seqState.get(wo.id);
          if (!st) {
            const [ops, pls] = await Promise.all([
              supabase.from('cnc_work_order_operations').select('id,operation_sequence,process_name,process_code').eq('work_order_id', wo.id),
              supabase.from('cnc_operation_plans').select('operation_sequence,process_name').eq('work_order_id', wo.id),
            ]);
            const opRows = ops.error ? [] : (ops.data ?? []);
            const bySeq = new Map<string, number>();
            opRows.forEach((o: any) => bySeq.set(String(o.process_name || o.process_code || '').toLowerCase(), Number(o.operation_sequence) || 0));
            (pls.error ? [] : (pls.data ?? [])).forEach((x: any) => { const k = String(x.process_name || '').toLowerCase(); if (k && !bySeq.has(k)) bySeq.set(k, Number(x.operation_sequence) || 0); });
            st = { ops: opRows, maxSeq: Math.max(0, ...bySeq.values()), bySeq };
            seqState.set(wo.id, st);
          }
          const key = r.process.toLowerCase();
          let seq = r.process ? st.bySeq.get(key) : 0;
          if (seq === undefined) { st.maxSeq += 1; seq = st.maxSeq; st.bySeq.set(key, seq); }
          await insertTolerant('cnc_operation_plans', [{
            id: crypto.randomUUID(), work_order_id: wo.id,
            operation_id: st.ops.find((o: any) => Number(o.operation_sequence) === seq)?.id ?? null,
            operation_sequence: seq || 0, process_name: r.process, machine: proc?.machine || '', operator: r.operator.trim(),
            plan_date: r.date, start_time: r.start, end_time: r.end, quantity: qty,
          }]);
        } else {
          const opNo = (opByWo.get(wo.wo_no) ?? 0) + 10;
          opByWo.set(wo.wo_no, opNo);
          await insertTolerant('cnc_job_cards', [{
            id: crypto.randomUUID(), job_no: await generateJobNo(), work_order: wo.wo_no, part_name: wo.part_name,
            op_no: opNo, operation: r.process || 'Machining', machine: proc?.machine || '', operator: r.operator.trim() || null,
            qty_planned: part.ordered, qty_completed: qty, qty_rejected: 0, cycle_time: 0, setup_time: 0,
            status: 'Completed', actual_start: s.toISOString(), actual_end: e.toISOString(), completed_at: e.toISOString(), created_at: s.toISOString(),
          }]);
          wo.completed = (Number(wo.completed) || 0) + qty;
          const target = Number(wo.quantity) || 0;
          wo.status = target > 0 && wo.completed >= target ? 'Completed' : 'In Progress';
          const up = await supabase.from('cnc_work_orders').update({ completed: wo.completed, status: wo.status }).eq('id', wo.id);
          if (up.error) throw new Error(`A run was saved but the finished quantity could not be updated: ${up.error.message}`);
        }
      }
      onSaved(rows[0].date);
      onClose();
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      alert(plan && /cnc_operation_plans|relation|schema cache/.test(msg) && /does not exist|Could not find the table/.test(msg)
        ? 'The planning table is not provisioned yet. Run migration 20261009000000_operation_plans.sql in Supabase.'
        : /'(actual_start|actual_end|completed_at)' column/.test(msg)
          ? `Your database has no actual start / end on job cards yet (${msg}). Run in the Supabase SQL editor:\n\nalter table public.cnc_job_cards add column if not exists actual_start timestamptz, add column if not exists actual_end timestamptz, add column if not exists completed_at timestamptz;\nnotify pgrst, 'reload schema';`
          : `Could not save the ${plan ? 'plans' : 'runs'}: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const qtyHead = plan ? 'Planned qty' : 'Finished qty';
  const cols = 'grid grid-cols-[minmax(240px,2.4fr)_96px_minmax(130px,1fr)_minmax(110px,1fr)_130px_92px_92px_64px] items-center gap-2';
  const noun = plan ? 'plan' : 'run';
  return (
    <Modal open={open} onClose={onClose} title={plan ? 'Add planned operations' : 'Add actual runs'} size="3xl"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : `Save ${rows.length} ${noun}${rows.length > 1 ? 's' : ''}`}</Button></>}>
      <div className="space-y-2">
        <div className={`${cols} px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500`}>
          <span>Part name</span><span title={plan ? 'Pieces planned for this slot' : 'Pieces finished in this run'}>{qtyHead}</span><span>Process</span><span>Operator</span><span>Date</span><span>Start</span><span>End</span><span />
        </div>
        {rows.map((r) => {
          const part = parts.find((p) => p.key === r.partKey);
          return (
            <div key={r.key} className={cols}>
              <select className={cell} value={r.partKey} title={part?.label ?? ''} onChange={(e) => upd(r.key, { partKey: e.target.value })}>
                <option value="">Select part…</option>
                {parts.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <input type="number" min="0" inputMode="decimal" className={cell} value={r.qty} onChange={(e) => upd(r.key, { qty: e.target.value })}
                placeholder={plan ? 'Planned' : 'Finished'} aria-label={plan ? 'Planned quantity' : 'Finished quantity'}
                title={part ? `${plan ? 'Planned' : 'Finished'} quantity (${part.remaining} remaining)` : `${plan ? 'Planned' : 'Finished'} quantity`} />
              <select className={cell} value={r.process} onChange={(e) => upd(r.key, { process: e.target.value })}>
                <option value="">Process…</option>
                {ref.processes.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <input className={cell} list="add-runs-operators" value={r.operator} onChange={(e) => upd(r.key, { operator: e.target.value })} placeholder="Operator" />
              <input type="date" aria-label="Date" className={cell} value={r.date} onChange={(e) => upd(r.key, { date: e.target.value })} />
              <div className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white text-sm"><Time24 label="Start" value={r.start} onChange={(v) => upd(r.key, { start: v })} /></div>
              <div className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white text-sm"><Time24 label="End" value={r.end} onChange={(v) => upd(r.key, { end: v })} /></div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => addAfter(r.key)} title="Add the next line (starts when this one ends)" aria-label="Add next line"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white hover:bg-brand-700"><Plus size={16} /></button>
                {rows.length > 1 && (
                  <button type="button" onClick={() => remove(r.key)} title="Remove this line" aria-label="Remove line"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                )}
              </div>
            </div>
          );
        })}
        <datalist id="add-runs-operators">{ref.operators.map((o) => <option key={o} value={o} />)}</datalist>
      </div>
    </Modal>
  );
}

/** First line of an actual run: the last whole hour (a run cannot end in the future); just after midnight, yesterday evening. */
export function defaultActualSlot(): { date: string; start: string; end: string } {
  const now = new Date();
  const h = now.getHours();
  if (h >= 1) return { date: ymd(now), start: `${String(h - 1).padStart(2, '0')}:00`, end: `${String(h).padStart(2, '0')}:00` };
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return { date: ymd(y), start: '22:00', end: '23:00' };
}

/** First line of a plan: the day shown (or today), 08:00-09:00. */
export const defaultPlanSlot = (date?: string): { date: string; start: string; end: string } => ({ date: date || ymd(new Date()), start: '08:00', end: '09:00' });

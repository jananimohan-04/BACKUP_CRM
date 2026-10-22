import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { Time24 } from '@/components/ui/Time24';
import { supabase } from '@/lib/supabase';
import { insertTolerant } from '@/lib/partRouting';
import { generateJobNo } from '@/lib/jobCards';
import { fmtTime24, ymd } from '@/lib/operationPlans';
import { CalendarNav, TimelineGrid, colorForMachine, minToHhmm, useCalendarNav, type GridBlock } from './TimelineGrid';
import { dt, dur, jobSpan, splitByDay, useTimelineData } from './ComparisonPage';
import { ProductPartSelect } from '@/components/ProductPartSelect';
import { ensureRunWorkOrder, type PartChoice } from '@/lib/partOrders';

// Actual timeline: when each job card really ran (actual start to actual end), on the same calendar as the plan,
// with the machine and the man (operator) on every block and filters for both.

const man = (j: any) => { const v = String(j.operator ?? '').trim(); return v && v !== '—' && v !== '-' ? v : ''; };

export function ActualTimeline() {
  const data = useTimelineData();
  const nav = useCalendarNav();
  const [machine, setMachine] = useState('All');
  const [operator, setOperator] = useState('All');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<any | null>(null);
  const [signal, setSignal] = useState(0);
  const q = search.trim().toLowerCase();

  // Add an actual run by dragging a time range on the calendar.
  const [ops, setOps] = useState<any[]>([]);
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [inwards, setInwards] = useState<any[]>([]);
  const [processes, setProcesses] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const emptyRun = { item: '', qty: '', rejected: '', process: '', machine: '', operator: '', date: '', start: '08:00', endDate: '', end: '12:00' };
  const [run, setRun] = useState(emptyRun);
  const [pickedPart, setPickedPart] = useState<PartChoice | null>(null);
  useEffect(() => {
    void (async () => {
      const [o, p, so, inw] = await Promise.all([
        supabase.from('cnc_work_order_operations').select('*'), supabase.from('cnc_processes').select('process_name'),
        supabase.from('cnc_sales_orders').select('id,order_no,customer,part_name,part_no,part_number,quantity,items,status,created_at,order_date').order('created_at', { ascending: false }),
        supabase.from('cnc_inwards').select('*').order('created_at', { ascending: false }),
      ]);
      setOps(o.error ? [] : (o.data ?? []));
      setSalesOrders(so.error ? [] : (so.data ?? []));
      setInwards(inw.error ? [] : (inw.data ?? []));
      setProcesses([...new Set((p.data ?? []).map((x: any) => String(x.process_name ?? '').trim()).filter(Boolean))].sort());
    })();
  }, []);
  const openRun = useCallback((r: { date: string; start: string; end: string }) => {
    setPickedPart(null);
    setRun({ ...emptyRun, date: r.date, start: r.start, endDate: r.date, end: r.end });
    setShowAdd(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Everything that can be produced, once each: the products on open sales orders and inward items,
  // minus those already fully finished. (Work orders stay in the background; the person never picks one.)
  const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
  // A product is identified by its name: the same product on a sales order and on an inward is one item.
  const woFor = (_customer: unknown, part: unknown) => data.wos.filter(w => String(w.status) !== 'Cancelled' && lc(w.part_name) === lc(part));
  const stampOf = (iso: unknown) => {
    const d = new Date(String(iso ?? '')); if (Number.isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const pendingSrc = pickedPart;
  const saveRun = async () => {
    const src = pickedPart;
    if (!src) return alert('Select the product and part.');
    const good = Number(run.qty) || 0; const rej = Number(run.rejected) || 0;
    if (run.qty.trim() === '' || good < 0 || rej < 0 || (good <= 0 && rej <= 0)) return alert('Enter the finished quantity.');
    if (!run.machine.trim()) return alert('Select the machine.');
    const start = new Date(`${run.date}T${run.start}:00`); const end = new Date(`${run.endDate || run.date}T${run.end}:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return alert('Set a valid start and end.');
    if (end.getTime() <= start.getTime()) return alert('The end must be after the start.');
    if (end.getTime() > Date.now() + 60000) return alert('An actual run cannot end in the future. Use the Planned Timeline to plan ahead.');
    setSaving(true);
    try {
      // The finished quantity is kept on this part's production order (behind the scenes): reuse the open one, else start one.
      const wo: any = await ensureRunWorkOrder(src, data.wos);
      const jobsOfWo = data.jobs.filter(j => String(j.work_order) === String(wo.wo_no));
      await insertTolerant('cnc_job_cards', [{
        id: crypto.randomUUID(), job_no: await generateJobNo(), work_order: wo.wo_no, part_name: wo.part_name,
        op_no: (Math.max(0, ...jobsOfWo.map(j => Number(j.op_no) || 0)) || 0) + 10, operation: run.process || 'Machining',
        machine: run.machine.trim(), operator: run.operator.trim() || null,
        qty_planned: src.ordered, qty_completed: good, qty_rejected: rej, cycle_time: 0, setup_time: 0,
        status: 'Completed', actual_start: start.toISOString(), actual_end: end.toISOString(), completed_at: end.toISOString(), created_at: start.toISOString(),
      }]);
      const completed = (Number(wo.completed) || 0) + good;
      const target = Number(wo.quantity) || 0;
      const { error: upErr } = await supabase.from('cnc_work_orders').update({
        completed, rejected: (Number(wo.rejected) || 0) + rej, status: target > 0 && completed >= target ? 'Completed' : 'In Progress',
      }).eq('id', wo.id);
      if (upErr) throw new Error(`The run was saved but the finished quantity could not be updated: ${upErr.message}`);
      setShowAdd(false);
      await data.reload();
      nav.setAnchor(run.date);
    } catch (e: any) {
      alert(/'(actual_start|actual_end|completed_at)' column/.test(String(e?.message))
        ? `Your database has no actual start / end on job cards yet (${e?.message}). In the Supabase SQL editor run:

alter table public.cnc_job_cards add column if not exists actual_start timestamptz, add column if not exists actual_end timestamptz, add column if not exists completed_at timestamptz;
notify pgrst, 'reload schema';

Then save the run again.`
        : `Could not save the run: ${e?.message ?? e}`);
    } finally { setSaving(false); }
  };

  const blocks: GridBlock[] = useMemo(() => {
    const out: GridBlock[] = [];
    const now = new Date();
    for (const j of data.jobs) {
      if (machine !== 'All' && j.machine !== machine) continue;
      if (operator !== 'All' && man(j) !== operator) continue;
      const wo = data.woByNo.get(String(j.work_order));
      if (q && !`${j.work_order} ${j.part_name ?? ''} ${wo?.customer ?? ''} ${j.operation ?? ''} ${j.machine ?? ''} ${man(j)}`.toLowerCase().includes(q)) continue;
      const span = jobSpan(j, now); if (!span) continue;
      splitByDay(span.start, span.end).forEach((s, i) => out.push({
        id: `${j.id}-${i}`, date: s.date, startMin: s.startMin, endMin: s.endMin,
        className: colorForMachine(j.machine ?? '', data.machines), ring: span.running,
        title: `${j.part_name || j.work_order} · ${wo?.customer ?? ''} · ${j.operation ?? ''} · ${j.machine ?? ''}${man(j) ? ` · ${man(j)}` : ''}${Number(j.qty_completed) ? ` · ${j.qty_completed} pcs` : ''}`,
        lines: [
          `${j.part_name || j.work_order}${Number(j.qty_completed) ? ` · ${j.qty_completed} pcs` : ''}`,
          `${j.machine ?? '—'}${man(j) ? ` · ${man(j)}` : ''}`,
          `${fmtTime24(minToHhmm(s.startMin))}–${span.running && s.date === ymd(now) ? 'now' : fmtTime24(minToHhmm(Math.min(s.endMin, 24 * 60 - 1)))}${span.running ? ' · Running' : ''}`,
        ],
        onClick: () => setPicked(j),
      }));
    }
    return out;
  }, [data.jobs, data.woByNo, machine, operator, q]);

  const hoursInView = blocks.filter(b => nav.days.includes(b.date)).reduce((n, b) => n + (b.endMin - b.startMin) / 60, 0);
  const anyActual = data.jobs.some(j => j.actual_start);

  return (
    <div className="space-y-4" data-testid="actual-timeline">
      <div className="flex flex-wrap items-center gap-3">
        <CalendarNav nav={nav} onToday={() => { nav.setAnchor(ymd(new Date())); setSignal(s => s + 1); }} loading={data.loading} />
        <select aria-label="Machine filter" value={machine} onChange={e => setMachine(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm">
          <option value="All">All machines</option>
          {data.machines.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="Operator filter" value={operator} onChange={e => setOperator(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm">
          <option value="All">All operators</option>
          {data.operators.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input aria-label="Search" placeholder="Search work order, product, company…" value={search} onChange={e => setSearch(e.target.value)} className="h-9 w-64 rounded-lg border border-slate-200 bg-white px-3 text-sm" />
        <Badge variant="neutral">{Math.round(hoursInView * 10) / 10} h run in view</Badge>
      </div>
      <TimelineGrid key={signal} days={nav.days} blocks={blocks} testId="actual-grid" onDragRange={openRun} />
      {!data.loading && !anyActual && (
        <p className="text-sm text-slate-500">Nothing has run yet. A job shows here from the moment it is started in Production → Job Cards until it is completed. Drag on the calendar to add a run, or use the Job Board tab to assign jobs to machines and operators.</p>
      )}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add actual run" size="lg"
        footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button variant="primary" onClick={saveRun} disabled={saving}>{saving ? 'Saving…' : 'Save Run'}</Button></>}>
        <div className="space-y-4">
          <ProductPartSelect salesOrders={salesOrders} inwards={inwards} workOrders={data.wos} value={run.item} onChange={c => { setPickedPart(c); setRun(r => ({ ...r, item: c?.key ?? '' })); }} />
          <div className="grid grid-cols-2 gap-4">
            <FormField label={`Finished Qty${pendingSrc ? ` (${pendingSrc.remaining} remaining)` : ''}`} required>
              <input type="number" min="0" inputMode="decimal" className={inputClass} value={run.qty} onChange={e => setRun(r => ({ ...r, qty: e.target.value }))} placeholder="Pieces finished in this run" />
            </FormField>
            <FormField label="Rejected Qty">
              <input type="number" min="0" inputMode="decimal" className={inputClass} value={run.rejected} onChange={e => setRun(r => ({ ...r, rejected: e.target.value }))} placeholder="0" />
            </FormField>
          </div>
          <FormField label="Process (optional)">
            <select className={inputClass} value={run.process} onChange={e => setRun(r => ({ ...r, process: e.target.value }))}>
              <option value="">-- No process (just a machine) --</option>
              {processes.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Machine" required>
              <input className={inputClass} list="actual-machines" value={run.machine} onChange={e => setRun(r => ({ ...r, machine: e.target.value }))} placeholder="Select or type a machine" />
              <datalist id="actual-machines">{data.machines.map(m => <option key={m} value={m} />)}</datalist>
            </FormField>
            <FormField label="Operator (man)">
              <input className={inputClass} list="actual-operators" value={run.operator} onChange={e => setRun(r => ({ ...r, operator: e.target.value }))} placeholder="Select or type the operator" />
              <datalist id="actual-operators">{data.operators.map(m => <option key={m} value={m} />)}</datalist>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Started" required>
              <div className="flex items-center gap-2">
                <input type="date" aria-label="Run start date" className={inputClass} value={run.date} onChange={e => setRun(r => ({ ...r, date: e.target.value, endDate: r.endDate < e.target.value ? e.target.value : r.endDate }))} />
                <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white text-sm"><Time24 label="Run start" value={run.start} onChange={v => setRun(r => ({ ...r, start: v }))} /></div>
              </div>
            </FormField>
            <FormField label="Ended" required>
              <div className="flex items-center gap-2">
                <input type="date" aria-label="Run end date" className={inputClass} value={run.endDate} min={run.date || undefined} onChange={e => setRun(r => ({ ...r, endDate: e.target.value }))} />
                <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white text-sm"><Time24 label="Run end" value={run.end} onChange={v => setRun(r => ({ ...r, end: v }))} /></div>
              </div>
            </FormField>
          </div>
          <p className="text-xs text-slate-500">This records when the work really ran. The finished quantity is added to the item's finished total, so the Inward and Finished Goods cards on the Sales Pipeline update.</p>
        </div>
      </Modal>

      <Modal open={!!picked} onClose={() => setPicked(null)} title="Actual run" size="sm" footer={<Button variant="secondary" onClick={() => setPicked(null)}>Close</Button>}>
        {picked && (() => {
          const span = jobSpan(picked, new Date());
          const wo = data.woByNo.get(String(picked.work_order));
          return (
            <div className="space-y-1.5 text-sm">
              <p><b>{picked.part_name}</b> {wo?.customer ? `(${wo.customer})` : ''}</p>
              <p>{picked.operation || '—'}</p>
              <p>Machine {picked.machine || '—'} · Operator {man(picked) || '—'}</p>
              <p>Started {dt(span?.start ?? null)} · {span?.running ? 'still running' : `ended ${dt(span?.end ?? null)}`}</p>
              <p>Run time {span ? dur((span.end.getTime() - span.start.getTime()) / 60000) : '—'}</p>
              <p>Qty: planned {picked.qty_planned ?? 0} · completed {picked.qty_completed ?? 0} · rejected {picked.qty_rejected ?? 0}</p>
              <p>Status: {picked.status}</p>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { Time24 } from '@/components/ui/Time24';
import { supabase } from '@/lib/supabase';
import { insertTolerant } from '@/lib/partRouting';
import { generateJobNo } from '@/lib/jobCards';
import { fmtTime24, ymd } from '@/lib/operationPlans';
import { CalendarNav, TimelineGrid, colorFor, minToHhmm, useCalendarNav, type GridBlock } from './TimelineGrid';
import { dt, dur, jobSpan, splitByDay, useTimelineData } from './ComparisonPage';

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
  const [processes, setProcesses] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const emptyRun = { woNo: '', seq: '', process: '', machine: '', operator: '', date: '', start: '08:00', endDate: '', end: '12:00' };
  const [run, setRun] = useState(emptyRun);
  useEffect(() => {
    void (async () => {
      const [o, p] = await Promise.all([supabase.from('cnc_work_order_operations').select('*'), supabase.from('cnc_processes').select('process_name')]);
      setOps(o.error ? [] : (o.data ?? []));
      setProcesses([...new Set((p.data ?? []).map((x: any) => String(x.process_name ?? '').trim()).filter(Boolean))].sort());
    })();
  }, []);
  const openRun = useCallback((r: { date: string; start: string; end: string }) => {
    setRun({ ...emptyRun, date: r.date, start: r.start, endDate: r.date, end: r.end });
    setShowAdd(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const runWo = data.woByNo.get(run.woNo);
  const runOps = ops.filter(o => runWo && String(o.work_order_id) === String(runWo.id)).sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0));
  const pickRunWo = (woNo: string) => {
    const wo = data.woByNo.get(woNo);
    const list = ops.filter(o => wo && String(o.work_order_id) === String(wo.id)).sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0));
    const first = list.length === 1 ? list[0] : null;
    setRun(r => ({ ...r, woNo, seq: first ? String(first.operation_sequence) : '', process: first ? (first.process_name || first.process_code || '') : '', machine: first?.machine || r.machine, operator: first?.operator || r.operator }));
  };
  const pickRunOp = (seq: string) => {
    const op = runOps.find(o => String(o.operation_sequence) === seq);
    setRun(r => ({ ...r, seq, process: op ? (op.process_name || op.process_code || '') : '', machine: op?.machine || r.machine, operator: op?.operator || r.operator }));
  };
  const saveRun = async () => {
    if (!run.woNo) return alert('Select the work order.');
    if (runOps.length > 0 && !run.seq) return alert('Select the operation that ran.');
    if (!run.machine.trim()) return alert('Select the machine.');
    const start = new Date(`${run.date}T${run.start}:00`); const end = new Date(`${run.endDate || run.date}T${run.end}:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return alert('Set a valid start and end.');
    if (end.getTime() <= start.getTime()) return alert('The end must be after the start.');
    if (end.getTime() > Date.now() + 60000) return alert('An actual run cannot end in the future. Use the Planned Timeline to plan ahead.');
    setSaving(true);
    try {
      const op = runOps.find(o => String(o.operation_sequence) === run.seq);
      const jobsOfWo = data.jobs.filter(j => String(j.work_order) === run.woNo);
      const opNo = op ? (Number(op.operation_sequence) || 0) * 10 : (Math.max(0, ...jobsOfWo.map(j => Number(j.op_no) || 0)) || 0) + 10;
      await insertTolerant('cnc_job_cards', [{
        id: crypto.randomUUID(), job_no: await generateJobNo(), work_order: run.woNo, part_name: runWo?.part_name ?? '', op_no: opNo,
        operation: op ? (op.process_name || op.process_code || 'Machining') : (run.process || 'Machining'),
        machine: run.machine.trim(), operator: run.operator.trim() || null,
        qty_planned: Number(op?.planned_qty ?? runWo?.quantity) || 0, qty_completed: 0, qty_rejected: 0, cycle_time: 0, setup_time: 0,
        status: 'Completed', actual_start: start.toISOString(), actual_end: end.toISOString(), completed_at: end.toISOString(), created_at: start.toISOString(),
      }]);
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
        className: colorFor(String(j.work_order)), ring: span.running,
        title: `${j.work_order} · ${j.operation ?? ''} · ${j.machine ?? ''}${man(j) ? ` · ${man(j)}` : ''}`,
        lines: [
          `${j.work_order}${j.operation ? ` · ${j.operation}` : ''}`,
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
          <FormField label="Work Order" required>
            <select className={inputClass} value={run.woNo} onChange={e => pickRunWo(e.target.value)}>
              <option value="">-- Select work order --</option>
              {data.wos.filter(w => !['Cancelled'].includes(String(w.status))).map(w => <option key={w.id} value={w.wo_no}>{w.wo_no} - {w.part_name} - {w.customer} - Qty {w.quantity}</option>)}
            </select>
          </FormField>
          {run.woNo && runOps.length > 0 && (
            <FormField label="Operation" required>
              <select className={inputClass} value={run.seq} onChange={e => pickRunOp(e.target.value)}>
                <option value="">-- Select operation --</option>
                {runOps.map(o => <option key={o.id} value={o.operation_sequence}>Seq {o.operation_sequence} - {o.process_name || o.process_code}</option>)}
              </select>
            </FormField>
          )}
          {run.woNo && runOps.length === 0 && (
            <FormField label="Process (optional)">
              <select className={inputClass} value={run.process} onChange={e => setRun(r => ({ ...r, process: e.target.value }))}>
                <option value="">-- No process (just a machine) --</option>
                {processes.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </FormField>
          )}
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
          <p className="text-xs text-slate-500">This records when the operation really ran, as a completed job card. Good and rejected quantities are entered in Production → Job Cards as usual.</p>
        </div>
      </Modal>

      <Modal open={!!picked} onClose={() => setPicked(null)} title="Actual run" size="sm" footer={<Button variant="secondary" onClick={() => setPicked(null)}>Close</Button>}>
        {picked && (() => {
          const span = jobSpan(picked, new Date());
          const wo = data.woByNo.get(String(picked.work_order));
          return (
            <div className="space-y-1.5 text-sm">
              <p><b>{picked.work_order}</b> — {picked.part_name} {wo?.customer ? `(${wo.customer})` : ''}</p>
              <p>Job {picked.job_no} · {picked.operation || '—'}</p>
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

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
import { AddRunsModal, defaultActualSlot } from './AddRunsModal';

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

  // Add actual runs line by line (Add runs button, or drag a time range on the calendar to start from that slot).
  const [showAdd, setShowAdd] = useState(false);
  const [slot, setSlot] = useState(defaultActualSlot());
  const openRun = useCallback((r: { date: string; start: string; end: string }) => {
    setSlot(r);
    setShowAdd(true);
  }, []);
  // The first line starts on the last whole hour (a run cannot end in the future); just after midnight it uses yesterday evening.
  const openAddButton = () => { setSlot(defaultActualSlot()); setShowAdd(true); };

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
        <Button variant="primary" onClick={openAddButton} className="ml-auto" aria-label="Add runs">+ Add runs</Button>
      </div>
      <TimelineGrid key={signal} days={nav.days} blocks={blocks} testId="actual-grid" onDragRange={openRun} />
      {!data.loading && !anyActual && (
        <p className="text-sm text-slate-500">Nothing has run yet. A job shows here from the moment it is started in Production → Job Cards until it is completed. Press Add runs (or drag on the calendar) to add a run, or use the Job Board tab to assign jobs to machines and operators.</p>
      )}
      <AddRunsModal open={showAdd} onClose={() => setShowAdd(false)} initial={slot} mode="actual" onSaved={(firstDate) => { void data.reload(); nav.setAnchor(firstDate); }} />

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

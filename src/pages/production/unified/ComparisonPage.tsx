import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Badge, Button } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { fmtTime24, isMissingTable, toMinutes, ymd } from '@/lib/operationPlans';
import { CalendarNav, TimelineGrid, colorFor, minToHhmm, useCalendarNav, type GridBlock } from './TimelineGrid';

// Comparison: the planned timeline set against what actually ran (job cards' actual start / end), operation by
// operation, with how late or early each one started and finished.

export interface PlanRow { id: string; work_order_id: string; operation_sequence: number; process_name: string; machine: string; operator?: string; plan_date: string; start_time: string; end_time: string }

const hh = (t: unknown) => String(t ?? '').slice(0, 5);
const minOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** Split a time span into one piece per calendar day (local time). */
export function splitByDay(start: Date, end: Date): { date: string; startMin: number; endMin: number }[] {
  const out: { date: string; startMin: number; endMin: number }[] = [];
  if (!(end.getTime() > start.getTime())) return out;
  let cur = new Date(start);
  for (let guard = 0; guard < 400 && cur.getTime() < end.getTime(); guard++) {
    const dayEnd = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    const segEnd = end.getTime() < dayEnd.getTime() ? end : dayEnd;
    out.push({ date: ymd(cur), startMin: minOfDay(cur), endMin: segEnd === dayEnd ? 24 * 60 : minOfDay(segEnd) });
    cur = dayEnd;
  }
  return out;
}

export const dur = (mins: number) => {
  const a = Math.abs(Math.round(mins)); const h = Math.floor(a / 60); const m = a % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};
const signed = (mins: number) => (Math.round(mins) === 0 ? 'on time' : `${mins > 0 ? '+' : '−'}${dur(mins)}`);
export const dt = (d: Date | null) => (d ? `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${fmtTime24(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`)}` : '—');
// Job cards are linked to an operation by (work order, op_no = operation sequence x 10).
export const seqOfJob = (j: any) => Math.round((Number(j.op_no) || 0) / 10);

export function useTimelineData() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [wos, setWos] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const [p, w, j] = await Promise.all([
      supabase.from('cnc_operation_plans').select('*'),
      supabase.from('cnc_work_orders').select('id,wo_no,part_name,customer,status,quantity'),
      supabase.from('cnc_job_cards').select('*'),
    ]);
    setMissing(!!p.error && isMissingTable(p.error));
    setPlans(p.error ? [] : ((p.data ?? []) as PlanRow[]));
    setWos(w.data ?? []);
    setJobs((j.data ?? []).filter((x: any) => String(x.status ?? '') !== 'Cancelled'));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const woById = useMemo(() => new Map(wos.map(w => [String(w.id), w])), [wos]);
  const woByNo = useMemo(() => new Map(wos.map(w => [String(w.wo_no), w])), [wos]);
  const machines = useMemo(() => [...new Set([...plans.map(p => p.machine), ...jobs.map(j => j.machine)].map(v => String(v ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [plans, jobs]);
  const operators = useMemo(() => [...new Map([...plans.map(p => p.operator), ...jobs.map(j => j.operator)].map(v => String(v ?? '').trim()).filter(v => v && v !== '—' && v !== '-').map(v => [v.toLowerCase(), v] as const)).values()].sort((a, b) => a.localeCompare(b)), [plans, jobs]);
  return { plans, wos, jobs, missing, loading, woById, woByNo, machines, operators, reload: load };
}

/** Where a job card really ran: actual_start to actual_end (still running = until now). */
export function jobSpan(j: any, now: Date): { start: Date; end: Date; running: boolean } | null {
  if (!j.actual_start) return null;
  const start = new Date(j.actual_start); if (Number.isNaN(start.getTime())) return null;
  const endRaw = j.actual_end ? new Date(j.actual_end) : null;
  const running = !endRaw || Number.isNaN(endRaw.getTime());
  return { start, end: running ? now : endRaw!, running };
}

interface CompareRow {
  key: string; woNo: string; part: string; customer: string; operation: string; machine: string; operator: string;
  plannedStart: Date | null; plannedEnd: Date | null; plannedMin: number;
  actualStart: Date | null; actualEnd: Date | null; actualMin: number; running: boolean;
  status: string; group: 'Unplanned' | 'Overdue' | 'Should be running' | 'Upcoming' | 'In progress' | 'On time' | 'Early' | 'Late';
  tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; startDelta: number | null; endDelta: number | null;
  plans: PlanRow[]; jobs: any[];
}

const STATUS_FILTERS = ['All', 'Late / overdue', 'On time', 'In progress', 'Upcoming', 'Unplanned'] as const;
const LATE_MIN = 15; // minutes of slack before something counts as late

const monthRange = () => { const d = new Date(); return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)), to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }; };
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function ComparisonTimeline() {
  const data = useTimelineData();
  const nav = useCalendarNav();
  const [machine, setMachine] = useState('All');
  const [operator, setOperator] = useState('All');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<typeof STATUS_FILTERS[number]>('All');
  const [range, setRange] = useState(monthRange());
  const [mode, setMode] = useState<'table' | 'calendar'>('table');
  const [signal, setSignal] = useState(0);
  const [picked, setPicked] = useState<CompareRow | null>(null);
  const q = search.trim().toLowerCase();

  const keyOf = (woNo: string, seq: number) => `${woNo}::${seq}`;

  // Every operation that has a plan and / or a run, with how the two compare.
  const all: CompareRow[] = useMemo(() => {
    const now = new Date();
    type Group = { woNo: string; seq: number; plans: PlanRow[]; jobs: any[] };
    const map = new Map<string, Group>();
    for (const p of data.plans) {
      const wo = data.woById.get(String(p.work_order_id)); if (!wo) continue;
      const k = keyOf(wo.wo_no, Number(p.operation_sequence) || 0);
      const e: Group = map.get(k) ?? { woNo: wo.wo_no, seq: Number(p.operation_sequence) || 0, plans: [], jobs: [] }; e.plans.push(p); map.set(k, e);
    }
    for (const j of data.jobs) {
      if (!j.actual_start) continue;
      const k = keyOf(String(j.work_order), seqOfJob(j));
      const e: Group = map.get(k) ?? { woNo: String(j.work_order), seq: seqOfJob(j), plans: [], jobs: [] }; e.jobs.push(j); map.set(k, e);
    }
    const out: CompareRow[] = [];
    for (const [k, e] of map) {
      const wo = data.woByNo.get(e.woNo);
      const mach = e.plans[0]?.machine || e.jobs[0]?.machine || '';
      const opName = e.plans[0]?.process_name || e.jobs[0]?.operation || '';
      const man = String(e.plans.find(p => p.operator)?.operator || e.jobs.find(j => j.operator && j.operator !== '—' && j.operator !== '-')?.operator || '').trim();
      const segs = e.plans.map(p => ({ s: new Date(`${String(p.plan_date).slice(0, 10)}T${hh(p.start_time)}:00`), e: new Date(`${String(p.plan_date).slice(0, 10)}T${hh(p.end_time)}:00`) }));
      const plannedStart = segs.length ? new Date(Math.min(...segs.map(x => x.s.getTime()))) : null;
      const plannedEnd = segs.length ? new Date(Math.max(...segs.map(x => x.e.getTime()))) : null;
      const plannedMin = segs.reduce((n, x) => n + (x.e.getTime() - x.s.getTime()) / 60000, 0);
      const spans = e.jobs.map(j => jobSpan(j, now)).filter(Boolean) as { start: Date; end: Date; running: boolean }[];
      const actualStart = spans.length ? new Date(Math.min(...spans.map(x => x.start.getTime()))) : null;
      const running = spans.some(x => x.running);
      const actualEnd = spans.length && !running ? new Date(Math.max(...spans.map(x => x.end.getTime()))) : null;
      const actualMin = spans.reduce((n, x) => n + (x.end.getTime() - x.start.getTime()) / 60000, 0);
      const startDelta = plannedStart && actualStart ? (actualStart.getTime() - plannedStart.getTime()) / 60000 : null;
      const endDelta = plannedEnd && actualEnd ? (actualEnd.getTime() - plannedEnd.getTime()) / 60000 : null;
      let label = ''; let group: CompareRow['group'] = 'Upcoming'; let tone: CompareRow['tone'] = 'neutral';
      if (!plannedStart) { label = 'Unplanned'; group = 'Unplanned'; tone = 'info'; }
      else if (!actualStart) {
        if (plannedEnd! < now) { label = 'Not started — overdue'; group = 'Overdue'; tone = 'bad'; }
        else if (plannedStart <= now) { label = 'Should be running'; group = 'Should be running'; tone = 'warn'; }
        else { label = 'Upcoming'; group = 'Upcoming'; tone = 'neutral'; }
      } else if (running) { label = 'In progress'; group = 'In progress'; tone = 'info'; }
      else if ((endDelta ?? 0) > LATE_MIN) { label = `Finished late (${signed(endDelta!)})`; group = 'Late'; tone = 'bad'; }
      else if ((endDelta ?? 0) < -LATE_MIN) { label = `Finished early (${signed(endDelta!)})`; group = 'Early'; tone = 'ok'; }
      else { label = 'Finished on time'; group = 'On time'; tone = 'ok'; }
      out.push({ key: k, woNo: e.woNo, part: wo?.part_name ?? '', customer: wo?.customer ?? '', operation: opName, machine: mach, operator: man, plannedStart, plannedEnd, plannedMin, actualStart, actualEnd, actualMin, running, status: label, group, tone, startDelta, endDelta, plans: e.plans, jobs: e.jobs });
    }
    return out.sort((a, b) => (a.plannedStart ?? a.actualStart ?? new Date(0)).getTime() - (b.plannedStart ?? b.actualStart ?? new Date(0)).getTime());
  }, [data.plans, data.jobs, data.woById, data.woByNo]);

  const rows = useMemo(() => all.filter(r => {
    // In range when its plan or its run touches the chosen dates.
    const from = new Date(`${range.from}T00:00:00`).getTime(); const to = new Date(`${range.to}T23:59:59`).getTime();
    const touches = (a: Date | null, b: Date | null) => !!a && !!b && a.getTime() <= to && b.getTime() >= from;
    if (!touches(r.plannedStart, r.plannedEnd) && !touches(r.actualStart, r.actualEnd ?? new Date())) return false;
    if (machine !== 'All' && r.machine !== machine) return false;
    if (operator !== 'All' && r.operator !== operator) return false;
    if (status === 'Late / overdue' && !['Late', 'Overdue'].includes(r.group)) return false;
    if (status === 'On time' && !['On time', 'Early'].includes(r.group)) return false;
    if (status === 'In progress' && !['In progress', 'Should be running'].includes(r.group)) return false;
    if (status === 'Upcoming' && r.group !== 'Upcoming') return false;
    if (status === 'Unplanned' && r.group !== 'Unplanned') return false;
    if (q && !`${r.woNo} ${r.part} ${r.customer} ${r.operation} ${r.machine} ${r.operator}`.toLowerCase().includes(q)) return false;
    return true;
  }), [all, range, machine, operator, status, q]);

  const kpi = useMemo(() => {
    const finished = rows.filter(r => ['On time', 'Early', 'Late'].includes(r.group));
    const onTime = finished.filter(r => r.group !== 'Late').length;
    const starts = rows.map(r => r.startDelta).filter((v): v is number => v != null);
    const planned = rows.reduce((n, r) => n + r.plannedMin, 0);
    const actual = rows.reduce((n, r) => n + r.actualMin, 0);
    return {
      total: rows.length,
      onTimePct: finished.length ? Math.round((onTime / finished.length) * 100) : null,
      finished: finished.length,
      avgStart: starts.length ? starts.reduce((a, b) => a + b, 0) / starts.length : null,
      planned, actual, variancePct: planned > 0 ? Math.round(((actual - planned) / planned) * 100) : null,
      overdue: rows.filter(r => r.group === 'Overdue').length,
      late: rows.filter(r => r.group === 'Late').length,
      unplanned: rows.filter(r => r.group === 'Unplanned').length,
    };
  }, [rows]);

  const byMachine = useMemo(() => {
    const m = new Map<string, { machine: string; ops: number; planned: number; actual: number; late: number }>();
    for (const r of rows) {
      const k = r.machine || '—';
      const e = m.get(k) ?? { machine: k, ops: 0, planned: 0, actual: 0, late: 0 };
      e.ops += 1; e.planned += r.plannedMin; e.actual += r.actualMin; if (['Late', 'Overdue'].includes(r.group)) e.late += 1;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.planned - a.planned);
  }, [rows]);

  const visibleKeys = useMemo(() => new Set(rows.map(r => r.key)), [rows]);
  const blocks: GridBlock[] = useMemo(() => {
    const out: GridBlock[] = [];
    for (const p of data.plans) {
      const wo = data.woById.get(String(p.work_order_id)); if (!wo) continue;
      if (!visibleKeys.has(keyOf(wo.wo_no, Number(p.operation_sequence) || 0))) continue;
      out.push({
        id: `p-${p.id}`, date: String(p.plan_date).slice(0, 10), startMin: toMinutes(hh(p.start_time)), endMin: toMinutes(hh(p.end_time)), lane: 0, lanes: 2, ghost: true,
        className: colorFor(wo.wo_no), title: `Planned · ${wo.wo_no} · ${p.process_name}`,
        lines: [`Planned · ${wo.wo_no}`, `${p.machine} · ${fmtTime24(hh(p.start_time))}–${fmtTime24(hh(p.end_time))}`],
      });
    }
    const now = new Date();
    for (const j of data.jobs) {
      if (!visibleKeys.has(keyOf(String(j.work_order), seqOfJob(j)))) continue;
      const span = jobSpan(j, now); if (!span) continue;
      splitByDay(span.start, span.end).forEach((s, i) => out.push({
        id: `a-${j.id}-${i}`, date: s.date, startMin: s.startMin, endMin: s.endMin, lane: 1, lanes: 2,
        className: colorFor(String(j.work_order)), ring: false, title: `Actual · ${j.work_order} · ${j.operation ?? ''}`,
        lines: [`Actual · ${j.work_order}`, `${j.machine ?? '—'} · ${fmtTime24(minToHhmm(s.startMin))}–${span.running && s.date === ymd(now) ? 'now' : fmtTime24(minToHhmm(Math.min(s.endMin, 24 * 60 - 1)))}`],
      }));
    }
    return out;
  }, [data.plans, data.jobs, data.woById, visibleKeys]);

  const toneClass: Record<CompareRow['tone'], string> = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200', warn: 'bg-amber-50 text-amber-700 border-amber-200',
    bad: 'bg-red-50 text-red-700 border-red-200', info: 'bg-blue-50 text-blue-700 border-blue-200', neutral: 'bg-slate-50 text-slate-600 border-slate-200',
  };

  const setPreset = (p: 'week' | 'month' | 'last30') => {
    const t = new Date();
    if (p === 'month') setRange(monthRange());
    else if (p === 'last30') { const f = new Date(t); f.setDate(f.getDate() - 30); setRange({ from: ymd(f), to: ymd(t) }); }
    else { const dow = t.getDay(); const mon = new Date(t); mon.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1)); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); setRange({ from: ymd(mon), to: ymd(sun) }); }
  };

  const exportCsv = () => {
    const head = ['Work order', 'Product', 'Company', 'Operation', 'Machine', 'Planned start', 'Planned end', 'Planned (min)', 'Actual start', 'Actual end', 'Actual (min)', 'Start variance (min)', 'Finish variance (min)', 'Status'];
    const lines = [head, ...rows.map(r => [r.woNo, r.part, r.customer, r.operation, r.machine, r.plannedStart?.toISOString() ?? '', r.plannedEnd?.toISOString() ?? '', Math.round(r.plannedMin), r.actualStart?.toISOString() ?? '', r.actualEnd?.toISOString() ?? '', Math.round(r.actualMin), r.startDelta == null ? '' : Math.round(r.startDelta), r.endDelta == null ? '' : Math.round(r.endDelta), r.status])];
    const blob = new Blob([lines.map(l => l.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `planned-vs-actual_${range.from}_${range.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const card = (label: string, value: string, sub: string, tone = 'text-slate-900') => (
    <div className="bg-white rounded-xl border border-slate-200 p-4" data-testid="cmp-kpi">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="comparison-timeline">
      <div className="flex flex-wrap items-end gap-3">
        <div><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">From</span>
          <input type="date" aria-label="Comparison from" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value, to: r.to < e.target.value ? e.target.value : r.to }))} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm" /></div>
        <div><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">To</span>
          <input type="date" aria-label="Comparison to" value={range.to} min={range.from} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm" /></div>
        <div className="flex gap-1">
          {([['week', 'This week'], ['month', 'This month'], ['last30', 'Last 30 days']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPreset(k)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">{l}</button>
          ))}
        </div>
        <select aria-label="Machine filter" value={machine} onChange={e => setMachine(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm">
          <option value="All">All machines</option>
          {data.machines.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="Operator filter" value={operator} onChange={e => setOperator(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm">
          <option value="All">All operators</option>
          {data.operators.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="Status filter" value={status} onChange={e => setStatus(e.target.value as typeof status)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm">
          {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === 'All' ? 'All statuses' : s}</option>)}
        </select>
        <input aria-label="Search" placeholder="Search work order, product, company…" value={search} onChange={e => setSearch(e.target.value)} className="h-9 w-60 rounded-lg border border-slate-200 bg-white px-3 text-sm" />
        {data.loading && <Badge variant="neutral">Loading…</Badge>}
        <span className="flex-1" />
        <div className="flex bg-white rounded-lg border border-slate-200 p-1">
          {(['table', 'calendar'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 text-sm font-medium rounded-md ${mode === m ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{m === 'table' ? 'Table' : 'Calendar'}</button>
          ))}
        </div>
        <Button variant="secondary" className="bg-white" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {card('Operations', String(kpi.total), `${kpi.finished} finished`)}
        {card('On-time finish', kpi.onTimePct == null ? '—' : `${kpi.onTimePct}%`, kpi.finished ? `${kpi.finished - kpi.late} of ${kpi.finished} within ${LATE_MIN} min` : 'nothing finished yet', kpi.onTimePct != null && kpi.onTimePct < 70 ? 'text-red-600' : 'text-emerald-700')}
        {card('Avg start delay', kpi.avgStart == null ? '—' : signed(kpi.avgStart), 'actual vs planned start', kpi.avgStart != null && kpi.avgStart > LATE_MIN ? 'text-red-600' : 'text-slate-900')}
        {card('Planned vs actual', `${Math.round(kpi.planned / 6) / 10} h / ${Math.round(kpi.actual / 6) / 10} h`, kpi.variancePct == null ? 'no planned hours' : `${kpi.variancePct > 0 ? '+' : ''}${kpi.variancePct}% hours`)}
        {card('Late / overdue', String(kpi.late + kpi.overdue), `${kpi.late} finished late · ${kpi.overdue} not started`, kpi.late + kpi.overdue > 0 ? 'text-red-600' : 'text-slate-900')}
        {card('Unplanned runs', String(kpi.unplanned), 'ran without a plan')}
      </div>

      {mode === 'calendar' ? (
        <>
          <div className="flex items-center gap-3">
            <CalendarNav nav={nav} onToday={() => { nav.setAnchor(ymd(new Date())); setSignal(s => s + 1); }} />
            <span className="text-xs text-slate-500">Dashed left lane = plan, solid right lane = what ran. Showing the operations in the filters above.</span>
          </div>
          <TimelineGrid key={signal} days={nav.days} blocks={blocks} testId="comparison-grid" />
        </>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-auto">
          <table className="w-full text-xs min-w-[1000px]" data-testid="comparison-table">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="p-2 text-left">Work order</th><th className="p-2 text-left">Operation</th><th className="p-2 text-left">Machine</th>
                <th className="p-2 text-left">Planned start → end</th><th className="p-2 text-right">Planned</th>
                <th className="p-2 text-left">Actual start → end</th><th className="p-2 text-right">Actual</th>
                <th className="p-2 text-right">Start</th><th className="p-2 text-right">Finish</th><th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} className="border-t hover:bg-slate-50/70 cursor-pointer" data-testid="comparison-row" onClick={() => setPicked(r)}>
                  <td className="p-2"><div className="font-mono font-semibold text-slate-800">{r.woNo}</div><div className="text-[10px] text-slate-500">{r.part}{r.customer ? ` · ${r.customer}` : ''}</div></td>
                  <td className="p-2">{r.operation || '—'}</td>
                  <td className="p-2">{r.machine || '—'}{r.operator ? <div className="text-[10px] text-slate-500">{r.operator}</div> : null}</td>
                  <td className="p-2 whitespace-nowrap">{r.plannedStart ? `${dt(r.plannedStart)} → ${dt(r.plannedEnd)}` : '—'}</td>
                  <td className="p-2 text-right">{r.plannedMin ? dur(r.plannedMin) : '—'}</td>
                  <td className="p-2 whitespace-nowrap">{r.actualStart ? `${dt(r.actualStart)} → ${r.running ? 'running' : dt(r.actualEnd)}` : '—'}</td>
                  <td className="p-2 text-right">{r.actualMin ? dur(r.actualMin) : '—'}</td>
                  <td className={`p-2 text-right whitespace-nowrap ${r.startDelta != null && r.startDelta > LATE_MIN ? 'text-red-600 font-semibold' : ''}`}>{r.startDelta != null ? signed(r.startDelta) : '—'}</td>
                  <td className={`p-2 text-right whitespace-nowrap ${r.endDelta != null && r.endDelta > LATE_MIN ? 'text-red-600 font-semibold' : ''}`}>{r.endDelta != null ? signed(r.endDelta) : '—'}</td>
                  <td className="p-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass[r.tone]}`}>{r.status}</span></td>
                </tr>
              ))}
              {!data.loading && rows.length === 0 && (
                <tr><td colSpan={10} className="p-8 text-center text-slate-500">{data.missing ? 'The planning table is not provisioned yet (run migration 20261009000000_operation_plans.sql).' : 'Nothing to compare in these dates. Plan an operation, start its job card in Production, or widen the dates.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {byMachine.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-auto" data-testid="comparison-machines">
          <p className="px-3 pt-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">By machine</p>
          <table className="w-full text-xs">
            <thead className="text-slate-500"><tr>
              <th className="p-2 text-left">Machine</th><th className="p-2 text-right">Operations</th><th className="p-2 text-right">Planned</th><th className="p-2 text-right">Actual</th><th className="p-2 text-right">Actual vs plan</th><th className="p-2 text-right">Late / overdue</th>
            </tr></thead>
            <tbody>
              {byMachine.map(m => (
                <tr key={m.machine} className="border-t">
                  <td className="p-2 font-semibold text-slate-800">{m.machine}</td>
                  <td className="p-2 text-right">{m.ops}</td>
                  <td className="p-2 text-right">{m.planned ? dur(m.planned) : '—'}</td>
                  <td className="p-2 text-right">{m.actual ? dur(m.actual) : '—'}</td>
                  <td className="p-2 text-right">{m.planned > 0 ? `${Math.round((m.actual / m.planned) * 100)}%` : '—'}</td>
                  <td className={`p-2 text-right ${m.late ? 'text-red-600 font-semibold' : ''}`}>{m.late}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!picked} onClose={() => setPicked(null)} title="Planned vs actual" size="lg" footer={<Button variant="secondary" onClick={() => setPicked(null)}>Close</Button>}>
        {picked && (
          <div className="space-y-4 text-sm" data-testid="cmp-detail">
            <div>
              <p><b>{picked.woNo}</b> — {picked.part} {picked.customer ? `(${picked.customer})` : ''}</p>
              <p className="text-slate-600">{picked.operation || '—'} · {picked.machine || '—'}{picked.operator ? ` · ${picked.operator}` : ''}</p>
              <p className="mt-1"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass[picked.tone]}`}>{picked.status}</span></p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Planned slots</p>
                {picked.plans.length === 0 ? <p className="text-xs text-slate-400">Not planned</p> : (
                  <ul className="text-xs space-y-0.5 max-h-56 overflow-auto">
                    {[...picked.plans].sort((a, b) => `${a.plan_date}${a.start_time}`.localeCompare(`${b.plan_date}${b.start_time}`)).map(p => (
                      <li key={p.id}>{String(p.plan_date).slice(0, 10)} · {fmtTime24(hh(p.start_time))} – {fmtTime24(hh(p.end_time))}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Actual runs</p>
                {picked.jobs.length === 0 ? <p className="text-xs text-slate-400">Not started</p> : (
                  <ul className="text-xs space-y-0.5 max-h-56 overflow-auto">
                    {picked.jobs.map(j => { const sp = jobSpan(j, new Date()); return (
                      <li key={j.id}>{j.job_no} · {dt(sp?.start ?? null)} → {sp?.running ? 'running' : dt(sp?.end ?? null)} · {j.qty_completed ?? 0}/{j.qty_planned ?? 0} pcs{j.operator && j.operator !== '—' ? ` · ${j.operator}` : ''}</li>
                    ); })}
                  </ul>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Planned</p><p className="font-bold">{picked.plannedMin ? dur(picked.plannedMin) : '—'}</p></div>
              <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Actual</p><p className="font-bold">{picked.actualMin ? dur(picked.actualMin) : '—'}</p></div>
              <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Difference</p><p className="font-bold">{picked.plannedMin && picked.actualMin ? signed(picked.actualMin - picked.plannedMin) : '—'}</p></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

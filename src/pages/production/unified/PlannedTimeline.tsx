import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge, Button } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { PlanEditor } from './PlanEditor';
import {
  addDays, emptyPlan, expandPlan, fmtTime24, isMissingTable, parseYmd, planError, segmentHours, toMinutes, ymd,
  type PlanDraft,
} from '@/lib/operationPlans';

// Planned timeline: every planned slot of every work-order operation on a week / day calendar.
// Plan an operation over a date range with several time slots a day; slots of one machine that overlap are flagged.

const HOUR_PX = 44;
const MACHINE_PALETTE = [
  'bg-blue-600 border-blue-800 text-white shadow-sm hover:bg-blue-700',
  'bg-emerald-600 border-emerald-800 text-white shadow-sm hover:bg-emerald-700',
  'bg-purple-600 border-purple-800 text-white shadow-sm hover:bg-purple-700',
  'bg-amber-600 border-amber-800 text-white shadow-sm hover:bg-amber-700',
  'bg-rose-600 border-rose-800 text-white shadow-sm hover:bg-rose-700',
  'bg-cyan-700 border-cyan-900 text-white shadow-sm hover:bg-cyan-800',
  'bg-orange-600 border-orange-800 text-white shadow-sm hover:bg-orange-700',
  'bg-indigo-600 border-indigo-800 text-white shadow-sm hover:bg-indigo-700',
  'bg-teal-700 border-teal-900 text-white shadow-sm hover:bg-teal-800',
  'bg-fuchsia-600 border-fuchsia-800 text-white shadow-sm hover:bg-fuchsia-700',
  'bg-lime-700 border-lime-900 text-white shadow-sm hover:bg-lime-800',
  'bg-pink-600 border-pink-800 text-white shadow-sm hover:bg-pink-700',
  'bg-sky-700 border-sky-900 text-white shadow-sm hover:bg-sky-800',
  'bg-violet-700 border-violet-900 text-white shadow-sm hover:bg-violet-800',
];

const colorForMachine = (machine: string, machineList: string[] = []) => {
  const clean = (machine || '').trim().toUpperCase();
  if (!clean) return 'bg-slate-700 border-slate-900 text-white';
  const idx = machineList.findIndex(m => m.trim().toUpperCase() === clean);
  if (idx >= 0) return MACHINE_PALETTE[idx % MACHINE_PALETTE.length];
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  return MACHINE_PALETTE[Math.abs(hash) % MACHINE_PALETTE.length];
};
const colorFor = (key: string) => colorForMachine(key);

interface PositionedRow {
  row: PlanRow;
  lane: number;
  lanes: number;
  top: number;
  height: number;
}

function layoutDayRows(dayRows: PlanRow[]): PositionedRow[] {
  if (dayRows.length === 0) return [];

  // Sort by start_time ascending, then by duration descending
  const sorted = [...dayRows].map(r => {
    const start = toMinutes(hh(r.start_time));
    let end = toMinutes(hh(r.end_time));
    if (end <= start) end = Math.min(24 * 60, start + 30);
    return { r, start, end };
  }).sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const clusters: (typeof sorted)[] = [];
  let currentCluster: typeof sorted = [];
  let clusterEnd = -1;

  for (const item of sorted) {
    if (currentCluster.length === 0) {
      currentCluster.push(item);
      clusterEnd = item.end;
    } else if (item.start < clusterEnd) {
      currentCluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterEnd = item.end;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const result: PositionedRow[] = [];

  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    const itemAssignments: { item: typeof sorted[0]; lane: number }[] = [];

    for (const item of cluster) {
      let placedLane = -1;
      for (let l = 0; l < laneEnds.length; l++) {
        if (laneEnds[l] <= item.start) {
          placedLane = l;
          laneEnds[l] = item.end;
          break;
        }
      }
      if (placedLane === -1) {
        placedLane = laneEnds.length;
        laneEnds.push(item.end);
      }
      itemAssignments.push({ item, lane: placedLane });
    }

    const totalLanes = Math.max(1, laneEnds.length);

    for (const { item, lane } of itemAssignments) {
      const top = (item.start / 60) * HOUR_PX;
      const height = Math.max(22, ((item.end - item.start) / 60) * HOUR_PX - 2);
      result.push({
        row: item.r,
        lane,
        lanes: totalLanes,
        top,
        height,
      });
    }
  }

  return result;
}
const hh = (t: unknown) => String(t ?? '').slice(0, 5);
const SNAP = 30; // minutes
const snap = (min: number) => Math.max(0, Math.min(24 * 60, Math.round(min / SNAP) * SNAP));
const minToHhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayLabel = (s: string) => parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });

interface PlanRow {
  id: string; work_order_id: string; operation_sequence: number; process_name: string; machine: string; operator?: string;
  plan_date: string; start_time: string; end_time: string; quantity?: number | null;
}

export function PlannedTimeline() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [wos, setWos] = useState<any[]>([]);
  const [ops, setOps] = useState<any[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [operators, setOperators] = useState<string[]>([]);
  const [operatorFilter, setOperatorFilter] = useState('All');
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'Week' | 'Day'>('Week');
  const [anchor, setAnchor] = useState(ymd(new Date()));
  const [machineFilter, setMachineFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<PlanRow | null>(null);
  // Drag on the calendar to plan: the dragged range becomes the first time slot.
  const [drag, setDrag] = useState<{ date: string; a: number; b: number } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });

  const [showPlan, setShowPlan] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ woId: string; seq: string; process: string; machine: string; operator: string; qty: string; plan: PlanDraft }>({ woId: '', seq: '', process: '', machine: '', operator: '', qty: '', plan: emptyPlan() });

  const [editForm, setEditForm] = useState<{
    woId: string;
    seq: string;
    process: string;
    machine: string;
    operator: string;
    qty: string;
    date: string;
    startTime: string;
    endTime: string;
    applyToAll: boolean;
  }>({
    woId: '',
    seq: '',
    process: '',
    machine: '',
    operator: '',
    qty: '',
    date: '',
    startTime: '',
    endTime: '',
    applyToAll: false,
  });
  const [updatingSlot, setUpdatingSlot] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, w, o, m, pr, jc] = await Promise.all([
      supabase.from('cnc_operation_plans').select('*').order('plan_date').order('start_time'),
      supabase.from('cnc_work_orders').select('id,wo_no,part_name,customer,status,quantity,completed,created_at').order('created_at', { ascending: false }).not('status', 'in', '("Completed","Dispatched","Cancelled")'),
      supabase.from('cnc_work_order_operations').select('*'),
      supabase.from('cnc_machines').select('code'),
      supabase.from('cnc_processes').select('machine_type'),
      supabase.from('cnc_job_cards').select('operator'),
    ]);
    setMissing(!!p.error && isMissingTable(p.error));
    setRows(p.error ? [] : ((p.data ?? []) as PlanRow[]));
    // Work orders still to be produced, one entry per work order number. A work order whose whole
    // quantity is done has moved to Finished Goods, so it is no longer offered for planning.
    const seenWo = new Set<string>();
    setWos((w.data ?? []).filter((x: any) => {
      const key = String(x.wo_no ?? x.id).trim().toLowerCase();
      if (seenWo.has(key)) return false;
      const qty = Number(x.quantity) || 0;
      if (qty > 0 && (Number(x.completed) || 0) >= qty) return false;
      seenWo.add(key);
      return true;
    }));
    setOps(o.error ? [] : (o.data ?? []));
    const set = new Set<string>();
    [...(m.data ?? []).map((x: any) => x.code), ...(pr.data ?? []).map((x: any) => x.machine_type)].forEach(v => { const t = String(v ?? '').trim(); if (t) set.add(t); });
    setMachines([...set].sort((a, b) => a.localeCompare(b)));
    // Operators come from job history and from earlier plans (never from login users).
    const men = new Map<string, string>();
    [...(jc.data ?? []).map((x: any) => x.operator), ...(((p.data ?? []) as PlanRow[]).map(x => x.operator))].forEach(v => { const t = String(v ?? '').trim(); if (t && t !== '—' && t !== '-' && !men.has(t.toLowerCase())) men.set(t.toLowerCase(), t); });
    setOperators([...men.values()].sort((a, b) => a.localeCompare(b)));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const t = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()); }, 60000);
    return () => clearInterval(t);
  }, []);

  // Bring the working part of the day into view: the current time for today, else the morning.
  const scrollToNow = useCallback((toToday: boolean) => {
    const el = scrollRef.current; if (!el) return;
    const d = new Date(); const now = d.getHours() * 60 + d.getMinutes();
    el.scrollTop = Math.max(0, ((toToday ? now : 7 * 60) / 60 - (toToday ? 2 : 0)) * HOUR_PX);
  }, []);
  useEffect(() => { scrollToNow(true); }, [scrollToNow, loading]);

  const woById = useMemo(() => new Map(wos.map(w => [String(w.id), w])), [wos]);
  const days = useMemo(() => {
    if (view === 'Day') return [anchor];
    const d = parseYmd(anchor); const dow = d.getDay();
    const monday = addDays(anchor, dow === 0 ? -6 : 1 - dow);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [view, anchor]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => rows.filter(r => {
    if (machineFilter !== 'All' && r.machine !== machineFilter) return false;
    if (operatorFilter !== 'All' && (r.operator ?? '') !== operatorFilter) return false;
    if (!q) return true;
    const wo = woById.get(String(r.work_order_id));
    return `${wo?.wo_no ?? ''} ${wo?.part_name ?? ''} ${wo?.customer ?? ''} ${r.process_name} ${r.machine} ${r.operator ?? ''}`.toLowerCase().includes(q);
  }), [rows, machineFilter, operatorFilter, q, woById]);

  // Same machine, same day, overlapping times. One operator may run several
  // machines at once, so the man is deliberately ignored here.
  const overlaps = (cand: { machine: string; operator?: string; date: string; start: string; end: string }, ignoreWo?: string, ignoreSeq?: number) =>
    rows.filter(r => (r.machine && r.machine === cand.machine) && String(r.plan_date).slice(0, 10) === cand.date
      && !(ignoreWo && String(r.work_order_id) === ignoreWo && Number(r.operation_sequence) === ignoreSeq)
      && toMinutes(hh(r.start_time)) < toMinutes(cand.end) && toMinutes(cand.start) < toMinutes(hh(r.end_time)));

  const clash = useMemo(() => {
    const set = new Set<string>();
    for (const r of shown) {
      const mine = { machine: r.machine, operator: r.operator ?? '', date: String(r.plan_date).slice(0, 10), start: hh(r.start_time), end: hh(r.end_time) };
      if (overlaps(mine).some(o => o.id !== r.id)) set.add(r.id);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, rows]);

  const opsForWo = ops.filter(o => String(o.work_order_id) === form.woId).sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0));
  const segments = expandPlan(form.plan);
  const conflicts = (form.machine || form.operator) ? segments.flatMap(s => overlaps({ machine: form.machine, operator: form.operator.trim(), date: s.date, start: s.start, end: s.end }).map(o => ({ s, o }))) : [];

  const openPlan = (pre?: { date: string; start: string; end: string }) => {
    setForm({
      woId: '', seq: '', process: '', machine: '', operator: '', qty: '',
      plan: pre ? { from: pre.date, to: pre.date, slots: [{ start: pre.start, end: pre.end }] } : { ...emptyPlan(), from: anchor, to: anchor },
    });
    setShowPlan(true);
  };

  const yToMin = (e: React.MouseEvent, el: HTMLElement) => snap(((e.clientY - el.getBoundingClientRect().top) / HOUR_PX) * 60);
  const endDrag = useCallback(() => {
    const d = dragRef.current; dragRef.current = null; setDrag(null);
    if (!d) return;
    let a = Math.min(d.a, d.b); let b = Math.max(d.a, d.b);
    if (b - a < SNAP) b = Math.min(24 * 60, a + 60); // a plain click plans one hour
    if (b > 24 * 60 - 1) { b = 24 * 60 - 1; a = Math.min(a, b - SNAP); }
    openPlan({ date: d.date, start: minToHhmm(a), end: minToHhmm(b) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);
  useEffect(() => {
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [endDrag]);
  const pickWo = (id: string) => {
    const list = ops.filter(o => String(o.work_order_id) === id).sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0));
    const first = list.length === 1 ? list[0] : null;
    const wo = wos.find(w => String(w.id) === String(id));
    setForm(f => ({ ...f, woId: id, seq: first ? String(first.operation_sequence) : '', process: first ? (first.process_name || first.process_code || '') : '', machine: first?.machine || '', operator: first?.operator || '', qty: f.qty || (wo?.quantity != null ? String(wo.quantity) : '') }));
  };
  const pickOp = (seq: string) => {
    const op = opsForWo.find(o => String(o.operation_sequence) === seq);
    setForm(f => ({ ...f, seq, process: op ? (op.process_name || op.process_code || '') : '', machine: op?.machine || f.machine, operator: op?.operator || f.operator }));
  };

  const savePlan = async () => {
    if (!form.woId) return alert('Select a work order.');
    if (opsForWo.length > 0 && !form.seq) return alert('Select the operation to plan.');
    if (!form.machine.trim()) return alert('Select the machine.');
    const err = planError(form.plan);
    if (err) return alert(err);
    if (conflicts.length > 0 && !window.confirm(`${form.machine}${form.operator.trim() ? ' / ' + form.operator.trim() : ''} is already planned at the same time on ${conflicts.length} slot(s). Plan anyway?`)) return;
    setSaving(true);
    try {
      const qtyNum = form.qty.trim() === '' ? null : Number(form.qty);
      const out = expandPlan(form.plan).map(s => ({
        id: crypto.randomUUID(), work_order_id: form.woId,
        operation_id: opsForWo.find(o => String(o.operation_sequence) === form.seq)?.id ?? null,
        operation_sequence: Number(form.seq) || 0, process_name: form.process, machine: form.machine.trim(), operator: form.operator.trim(),
        plan_date: s.date, start_time: s.start, end_time: s.end, quantity: qtyNum,
      }));
      let rows: any[] = out;
      let r = await supabase.from('cnc_operation_plans').insert(rows);
      // Databases missing the quantity column save the plan without it.
      if (r.error && /'quantity' column/.test(String(r.error.message))) {
        rows = rows.map(({ quantity: _q, ...rest }: any) => rest);
        r = await supabase.from('cnc_operation_plans').insert(rows);
        if (!r.error && qtyNum != null) alert('Saved without the quantity: run migration 20261016000000_operation_plans_qty.sql in Supabase to keep quantities on plans.');
      }
      // Databases that have not run the operator migration yet save the plan without the man.
      if (r.error && /'operator' column/.test(String(r.error.message))) {
        rows = rows.map(({ operator: _o, ...rest }: any) => rest);
        r = await supabase.from('cnc_operation_plans').insert(rows);
        if (!r.error && form.operator.trim()) alert('Saved without the operator: run migration 20261009010000_operation_plans_operator.sql in Supabase to keep the man on plans.');
      }
      if (r.error) throw r.error;
      setShowPlan(false);
      await load();
    } catch (e: any) {
      alert(isMissingTable(e) ? 'The planning table is not provisioned yet. Run migration 20261009000000_operation_plans.sql in Supabase.' : `Could not save the plan: ${e?.message ?? e}`);
    } finally { setSaving(false); }
  };

  const removeSlot = async (r: PlanRow, all: boolean) => {
    if (!window.confirm(all ? 'Remove the whole plan of this operation?' : 'Remove this planned slot?')) return;
    const q = supabase.from('cnc_operation_plans').delete();
    const res = all ? await q.eq('work_order_id', r.work_order_id).eq('operation_sequence', r.operation_sequence) : await q.eq('id', r.id);
    if (res.error) return alert(`Could not remove: ${res.error.message}`);
    setPicked(null);
    await load();
  };

  useEffect(() => {
    if (picked) {
      setEditForm({
        woId: String(picked.work_order_id ?? ''),
        seq: picked.operation_sequence != null ? String(picked.operation_sequence) : '',
        process: picked.process_name || '',
        machine: picked.machine || '',
        operator: picked.operator || '',
        qty: picked.quantity != null ? String(picked.quantity) : '',
        date: String(picked.plan_date).slice(0, 10),
        startTime: hh(picked.start_time),
        endTime: hh(picked.end_time),
        applyToAll: false,
      });
    }
  }, [picked]);

  const editOpsForWo = useMemo(() => {
    const curWo = editForm.woId || String(picked?.work_order_id || '');
    return ops.filter(o => String(o.work_order_id) === curWo).sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0));
  }, [ops, editForm.woId, picked?.work_order_id]);

  const pickEditWo = (id: string) => {
    const list = ops.filter(o => String(o.work_order_id) === id).sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0));
    const first = list.length === 1 ? list[0] : null;
    setEditForm(f => ({
      ...f,
      woId: id,
      seq: first ? String(first.operation_sequence) : '',
      process: first ? (first.process_name || first.process_code || '') : '',
      machine: first?.machine || f.machine,
      operator: first?.operator || f.operator,
    }));
  };

  const pickEditOp = (seq: string) => {
    const op = editOpsForWo.find(o => String(o.operation_sequence) === seq);
    setEditForm(f => ({
      ...f,
      seq,
      process: op ? (op.process_name || op.process_code || '') : '',
      machine: op?.machine || f.machine,
      operator: op?.operator || f.operator,
    }));
  };

  const editConflicts = useMemo(() => {
    if (!picked || (!editForm.machine && !editForm.operator) || !editForm.date || !editForm.startTime || !editForm.endTime) return [];
    if (toMinutes(editForm.endTime) <= toMinutes(editForm.startTime)) return [];
    return overlaps({
      machine: editForm.machine.trim(),
      operator: editForm.operator.trim(),
      date: editForm.date,
      start: editForm.startTime,
      end: editForm.endTime,
    }).filter(o => o.id !== picked.id);
  }, [picked, editForm.machine, editForm.operator, editForm.date, editForm.startTime, editForm.endTime, rows]);

  const slotDurationHours = useMemo(() => {
    if (!editForm.startTime || !editForm.endTime) return 0;
    const start = toMinutes(editForm.startTime);
    const end = toMinutes(editForm.endTime);
    if (end <= start) return 0;
    return Math.round(((end - start) / 60) * 10) / 10;
  }, [editForm.startTime, editForm.endTime]);

  const saveEditedSlot = async () => {
    if (!picked) return;
    if (!editForm.woId) return alert('Select a work order.');
    if (editOpsForWo.length > 0 && !editForm.seq) return alert('Select the operation.');
    if (!editForm.machine.trim()) return alert('Select or type the machine.');
    if (!editForm.date) return alert('Select the plan date.');
    if (!editForm.startTime || !editForm.endTime) return alert('Select start and end time.');
    if (toMinutes(editForm.endTime) <= toMinutes(editForm.startTime)) {
      return alert('End time must be after start time.');
    }
    if (editConflicts.length > 0 && !window.confirm(`${editForm.machine}${editForm.operator.trim() ? ' / ' + editForm.operator.trim() : ''} is already planned at this time on another operation. Save anyway?`)) {
      return;
    }

    setUpdatingSlot(true);
    try {
      const opObj = ops.find(o => String(o.work_order_id) === editForm.woId && String(o.operation_sequence) === editForm.seq);
      const processName = opObj?.process_name || opObj?.process_code || editForm.process || picked.process_name;

      if (editForm.applyToAll && picked.work_order_id && picked.operation_sequence != null) {
        let res = await supabase.from('cnc_operation_plans').update({
          machine: editForm.machine.trim(),
          operator: editForm.operator.trim(),
          process_name: processName,
        }).eq('work_order_id', picked.work_order_id).eq('operation_sequence', picked.operation_sequence);

        if (res.error && /'operator' column/.test(String(res.error.message))) {
          await supabase.from('cnc_operation_plans').update({
            machine: editForm.machine.trim(),
            process_name: processName,
          }).eq('work_order_id', picked.work_order_id).eq('operation_sequence', picked.operation_sequence);
        }
      }

      const qtyNum = editForm.qty.trim() === '' ? null : Number(editForm.qty);
      const payload: any = {
        work_order_id: editForm.woId,
        operation_id: opObj?.id ?? null,
        operation_sequence: Number(editForm.seq) || 0,
        process_name: processName,
        machine: editForm.machine.trim(),
        operator: editForm.operator.trim(),
        plan_date: editForm.date,
        start_time: editForm.startTime,
        end_time: editForm.endTime,
        quantity: qtyNum,
      };
      let r = await supabase.from('cnc_operation_plans').update(payload).eq('id', picked.id);

      if (r.error && /'quantity' column/.test(String(r.error.message))) {
        delete payload.quantity;
        r = await supabase.from('cnc_operation_plans').update(payload).eq('id', picked.id);
      }

      if (r.error && /'operator' column/.test(String(r.error.message))) {
        delete payload.operator;
        r = await supabase.from('cnc_operation_plans').update(payload).eq('id', picked.id);
      }

      if (r.error) throw r.error;

      setPicked(null);
      await load();
    } catch (e: any) {
      alert(`Could not update slot: ${e?.message ?? e}`);
    } finally {
      setUpdatingSlot(false);
    }
  };

  const step = (n: number) => setAnchor(a => addDays(a, view === 'Week' ? n * 7 : n));
  const title = view === 'Day' ? dayLabel(days[0]) : `${dayLabel(days[0])} – ${dayLabel(days[6])}`;
  const today = ymd(new Date());
  // Slots happening right now (recomputed every render; nowMin ticks each minute).
  const runningNow = rows.filter(r =>
    String(r.plan_date).slice(0, 10) === today
    && toMinutes(hh(r.start_time)) <= nowMin && nowMin < toMinutes(hh(r.end_time)));
  const totalHours = shown.filter(r => days.includes(String(r.plan_date).slice(0, 10))).reduce((n, r) => n + segmentHours({ start: hh(r.start_time), end: hh(r.end_time) }), 0);

  return (
    <div className="space-y-4" data-testid="planned-timeline">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center bg-white rounded-lg border border-slate-200">
          <button aria-label="Previous" className="p-2 text-slate-600 hover:bg-slate-50 border-r border-slate-200" onClick={() => step(-1)}><ChevronLeft size={16} /></button>
          <div className="px-4 py-1.5 text-sm font-medium text-slate-700 min-w-[210px] text-center">{title}</div>
          <button aria-label="Next" className="p-2 text-slate-600 hover:bg-slate-50 border-l border-slate-200" onClick={() => step(1)}><ChevronRight size={16} /></button>
        </div>
        <Button variant="secondary" className="bg-white" onClick={() => { setAnchor(today); setTimeout(() => scrollToNow(true), 0); }}>Today</Button>
        <div className="flex bg-white rounded-lg border border-slate-200 p-1">
          {(['Week', 'Day'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1 text-sm font-medium rounded-md ${view === v ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{v}</button>
          ))}
        </div>
        <select aria-label="Machine filter" value={machineFilter} onChange={e => setMachineFilter(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm">
          <option value="All">All machines</option>
          {machines.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="Operator filter" value={operatorFilter} onChange={e => setOperatorFilter(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm">
          <option value="All">All operators</option>
          {operators.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input aria-label="Search plans" placeholder="Search work order, product, company…" value={search} onChange={e => setSearch(e.target.value)} className="h-9 w-64 rounded-lg border border-slate-200 bg-white px-3 text-sm" />
        <Badge variant="neutral">{Math.round(totalHours * 10) / 10} h planned in view</Badge>
        <Badge variant={runningNow.length > 0 ? 'success' : 'neutral'} dot={runningNow.length > 0}>{runningNow.length} running now</Badge>
        {loading && <Badge variant="neutral">Loading…</Badge>}
        <span className="flex-1" />
        <Button variant="primary" className="bg-brand-500 hover:bg-brand-600 text-white border-0 shadow-sm" onClick={() => openPlan()}><Plus size={16} /> Plan Operation</Button>
      </div>

      {missing && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          The planning table is not provisioned yet. Run migration 20261009000000_operation_plans.sql in Supabase to save plans.
        </p>
      )}

      <div ref={scrollRef} className="bg-white rounded-xl border border-slate-200 overflow-auto max-h-[68vh]">
        <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="sticky top-0 z-20 bg-white border-b border-slate-200" />
          {days.map(d => (
            <div key={d} className={`sticky top-0 z-20 border-b border-l border-slate-200 px-2 py-2 text-center text-xs font-semibold ${d === today ? 'bg-blue-50 text-blue-700' : 'bg-white text-slate-600'}`}>{dayLabel(d)}</div>
          ))}
          <div className="relative" style={{ height: 24 * HOUR_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-2 text-[10px] text-slate-400" style={{ top: h * HOUR_PX }}>{h === 0 ? '' : fmtTime24(`${h}:00`)}</div>
            ))}
          </div>
          {days.map(d => {
            const dayRows = shown.filter(r => String(r.plan_date).slice(0, 10) === d);
            return (
              <div key={d} className="relative border-l border-slate-200 cursor-crosshair select-none" style={{ height: 24 * HOUR_PX }} data-testid="plan-day" data-date={d}
                onMouseDown={e => { if ((e.target as HTMLElement).closest('[data-testid="plan-block"]')) return; const m = yToMin(e, e.currentTarget); const v = { date: d, a: m, b: m }; dragRef.current = v; setDrag(v); }}
                onMouseMove={e => { if (!dragRef.current || dragRef.current.date !== d) return; const v = { ...dragRef.current, b: yToMin(e, e.currentTarget) }; dragRef.current = v; setDrag(v); }}>
                {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: h * HOUR_PX }} />)}
                {drag && drag.date === d && (
                  <div className="absolute left-0.5 right-0.5 rounded-md border-2 border-dashed border-brand-500 bg-brand-100/60 pointer-events-none z-10" data-testid="plan-drag"
                    style={{ top: (Math.min(drag.a, drag.b) / 60) * HOUR_PX, height: Math.max(SNAP, Math.abs(drag.b - drag.a)) / 60 * HOUR_PX }}>
                    <span className="text-[10px] font-bold text-brand-700 px-1">{fmtTime24(minToHhmm(Math.min(drag.a, drag.b)))} – {fmtTime24(minToHhmm(Math.min(24 * 60 - 1, Math.max(Math.max(drag.a, drag.b), Math.min(drag.a, drag.b) + SNAP))))}</span>
                  </div>
                )}
                {d === today && <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: (nowMin / 60) * HOUR_PX }}><div className="h-0.5 bg-red-500" /><div className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" /></div>}
                {layoutDayRows(dayRows).map(({ row: r, lane, lanes, top, height }) => {
                  const wo = woById.get(String(r.work_order_id));
                  const width = `calc(${(1 / lanes) * 100}% - 4px)`;
                  const left = `calc(${(lane / lanes) * 100}% + 2px)`;
                  return (
                    <button key={r.id} type="button" data-testid="plan-block" onClick={() => setPicked(r)} title={`${wo?.wo_no ?? ''} · ${r.process_name} · Machine: ${r.machine} · Operator: ${r.operator || '—'} · ${fmtTime24(hh(r.start_time))}–${fmtTime24(hh(r.end_time))}`}
                      className={`absolute overflow-hidden rounded-md border-l-[4px] px-2 py-1 text-left shadow-md transition-all z-10 ${colorForMachine(r.machine, machines)} ${clash.has(r.id) ? 'ring-2 ring-red-500' : ''}`}
                      style={{ top, height, left, width }}>
                      <div className="font-bold text-xs truncate leading-snug">{wo?.wo_no ?? 'Work order'}{r.process_name ? ` · ${r.process_name}` : ''}</div>
                      <div className="truncate text-[11px] font-semibold leading-snug opacity-95">
                        <span className="font-black uppercase bg-black/30 px-1 py-0.5 rounded text-[11px] mr-1 inline-block">{r.machine || '—'}</span>
                        {r.operator ? `${r.operator} · ` : ''}{fmtTime24(hh(r.start_time))}–{fmtTime24(hh(r.end_time))}{r.quantity != null ? ` · Qty ${r.quantity}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {!loading && rows.length === 0 && !missing && <p className="text-sm text-slate-500">Nothing is planned yet. Drag on the calendar to plan a time, use Plan Operation, or plan an operation while releasing a work order in Production.</p>}

      <Modal open={showPlan} onClose={() => setShowPlan(false)} title="Plan Operation" size="lg"
        footer={<><Button variant="secondary" onClick={() => setShowPlan(false)}>Cancel</Button><Button variant="primary" onClick={savePlan} disabled={saving}>{saving ? 'Saving…' : 'Save Plan'}</Button></>}>
        <div className="space-y-4">
          <FormField label="Work Order" required>
            <select className={inputClass} value={form.woId} onChange={e => pickWo(e.target.value)}>
              <option value="">-- Select work order --</option>
              {wos.map(w => <option key={w.id} value={w.id}>{w.wo_no} - {w.part_name} - {w.customer} - Qty {w.quantity}</option>)}
            </select>
          </FormField>
          {form.woId && opsForWo.length > 0 && (
            <FormField label="Operation" required>
              <select className={inputClass} value={form.seq} onChange={e => pickOp(e.target.value)}>
                <option value="">-- Select operation --</option>
                {opsForWo.map(o => <option key={o.id} value={o.operation_sequence}>Seq {o.operation_sequence} - {o.process_name || o.process_code}</option>)}
              </select>
            </FormField>
          )}
          <FormField label="Machine" required>
            <input className={inputClass} list="plan-machines" value={form.machine} onChange={e => setForm(f => ({ ...f, machine: e.target.value }))} placeholder="Select or type a machine" />
            <datalist id="plan-machines">{machines.map(m => <option key={m} value={m} />)}</datalist>
          </FormField>
          <FormField label="Operator (man)">
            <input className={inputClass} list="plan-operators" value={form.operator} onChange={e => setForm(f => ({ ...f, operator: e.target.value }))} placeholder="Select or type the operator" />
            <datalist id="plan-operators">{operators.map(m => <option key={m} value={m} />)}</datalist>
          </FormField>
          <FormField label="Quantity (pcs)">
            <input type="number" min={0} className={inputClass} value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} placeholder="e.g. 100" />
          </FormField>
          <PlanEditor value={form.plan} onChange={plan => setForm(f => ({ ...f, plan }))} />
          {conflicts.length > 0 && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="plan-conflict">
              {form.machine} is already planned at these times: {conflicts.slice(0, 3).map(c => `${woById.get(String(c.o.work_order_id))?.wo_no ?? 'another order'} on ${dayLabel(c.s.date)} ${fmtTime24(hh(c.o.start_time))}–${fmtTime24(hh(c.o.end_time))}`).join('; ')}{conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ''}.
            </p>
          )}
        </div>
      </Modal>

      <Modal open={!!picked} onClose={() => setPicked(null)} title="Edit Planned Slot" size="md"
        subtitle={picked ? (() => {
          const wo = woById.get(String(picked.work_order_id));
          return `${wo?.wo_no ?? 'Work order'} · ${wo?.part_name ?? ''} ${wo?.customer ? `(${wo.customer})` : ''}`;
        })() : undefined}
        footer={picked ? (
          <div className="flex flex-wrap items-center justify-between w-full gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                icon={<Trash2 size={14} />}
                onClick={() => removeSlot(picked, false)}
                disabled={updatingSlot}
              >
                Remove slot
              </Button>
              <Button
                variant="secondary"
                className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                icon={<Trash2 size={14} />}
                onClick={() => removeSlot(picked, true)}
                disabled={updatingSlot}
              >
                Remove whole plan
              </Button>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="secondary" onClick={() => setPicked(null)} disabled={updatingSlot}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="bg-brand-500 hover:bg-brand-600 text-white"
                onClick={saveEditedSlot}
                disabled={updatingSlot}
              >
                {updatingSlot ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        ) : undefined}>
        {picked && (() => {
          const same = rows.filter(r => r.work_order_id === picked.work_order_id && r.operation_sequence === picked.operation_sequence);
          return (
            <div className="space-y-4">
              <FormField label="Work Order" required>
                <select className={inputClass} value={editForm.woId} onChange={e => pickEditWo(e.target.value)}>
                  <option value="">-- Select work order --</option>
                  {wos.map(w => <option key={w.id} value={w.id}>{w.wo_no} - {w.part_name} - {w.customer} - Qty {w.quantity}</option>)}
                </select>
              </FormField>

              {editOpsForWo.length > 0 && (
                <FormField label="Operation" required>
                  <select className={inputClass} value={editForm.seq} onChange={e => pickEditOp(e.target.value)}>
                    <option value="">-- Select operation --</option>
                    {editOpsForWo.map(o => <option key={o.id} value={o.operation_sequence}>Seq {o.operation_sequence} - {o.process_name || o.process_code}</option>)}
                  </select>
                </FormField>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField label="Machine" required>
                  <input className={inputClass} list="plan-machines-edit" value={editForm.machine} onChange={e => setEditForm(f => ({ ...f, machine: e.target.value }))} placeholder="Select or type a machine" />
                  <datalist id="plan-machines-edit">{machines.map(m => <option key={m} value={m} />)}</datalist>
                </FormField>

                <FormField label="Operator (man)">
                  <input className={inputClass} list="plan-operators-edit" value={editForm.operator} onChange={e => setEditForm(f => ({ ...f, operator: e.target.value }))} placeholder="Select or type the operator" />
                  <datalist id="plan-operators-edit">{operators.map(m => <option key={m} value={m} />)}</datalist>
                </FormField>

                <FormField label="Quantity (pcs)">
                  <input type="number" min={0} className={inputClass} value={editForm.qty} onChange={e => setEditForm(f => ({ ...f, qty: e.target.value }))} placeholder="e.g. 100" />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <FormField label="Date" required>
                  <input type="date" className={inputClass} value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} />
                </FormField>

                <FormField label="Start Time" required>
                  <input type="time" className={inputClass} value={editForm.startTime} onChange={e => setEditForm(f => ({ ...f, startTime: e.target.value }))} />
                </FormField>

                <FormField label="End Time" required>
                  <input type="time" className={inputClass} value={editForm.endTime} onChange={e => setEditForm(f => ({ ...f, endTime: e.target.value }))} />
                </FormField>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
                <span>Duration: <b className="text-slate-700">{slotDurationHours > 0 ? `${slotDurationHours} hrs` : '—'}</b></span>
                <span>Operation has <b className="text-slate-700">{same.length}</b> planned slot{same.length === 1 ? '' : 's'} in total</span>
              </div>

              {same.length > 1 && (
                <label className="flex items-center gap-2 text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                    checked={editForm.applyToAll}
                    onChange={e => setEditForm(f => ({ ...f, applyToAll: e.target.checked }))}
                  />
                  <span>Apply updated machine ({editForm.machine || '—'}) and operator ({editForm.operator || '—'}) to all {same.length} slots of this operation</span>
                </label>
              )}

              {clash.has(picked.id) && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  ⚠️ Another scheduled plan uses this machine at the same time.
                </p>
              )}

              {editConflicts.length > 0 && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="plan-edit-conflict">
                  ⚠️ Conflict: {editForm.machine}{editForm.operator.trim() ? ' / ' + editForm.operator.trim() : ''} is already planned at this time on {editConflicts.slice(0, 2).map(c => `${woById.get(String(c.work_order_id))?.wo_no ?? 'another order'} (${fmtTime24(hh(c.start_time))}–${fmtTime24(hh(c.end_time))})`).join('; ')}{editConflicts.length > 2 ? ` and ${editConflicts.length - 2} more` : ''}.
                </p>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

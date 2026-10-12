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
const PALETTE = ['bg-blue-100 border-blue-400 text-blue-900', 'bg-emerald-100 border-emerald-400 text-emerald-900', 'bg-amber-100 border-amber-400 text-amber-900',
  'bg-violet-100 border-violet-400 text-violet-900', 'bg-rose-100 border-rose-400 text-rose-900', 'bg-cyan-100 border-cyan-400 text-cyan-900'];
const colorFor = (key: string) => PALETTE[[...key].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];
const hh = (t: unknown) => String(t ?? '').slice(0, 5);
const SNAP = 30; // minutes
const snap = (min: number) => Math.max(0, Math.min(24 * 60, Math.round(min / SNAP) * SNAP));
const minToHhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayLabel = (s: string) => parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });

interface PlanRow {
  id: string; work_order_id: string; operation_sequence: number; process_name: string; machine: string; operator?: string;
  plan_date: string; start_time: string; end_time: string;
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
  const [form, setForm] = useState<{ woId: string; seq: string; process: string; machine: string; operator: string; plan: PlanDraft }>({ woId: '', seq: '', process: '', machine: '', operator: '', plan: emptyPlan() });

  const load = useCallback(async () => {
    setLoading(true);
    const [p, w, o, m, pr, jc] = await Promise.all([
      supabase.from('cnc_operation_plans').select('*').order('plan_date').order('start_time'),
      supabase.from('cnc_work_orders').select('id,wo_no,part_name,customer,status,quantity').not('status', 'in', '("Completed","Dispatched","Cancelled")'),
      supabase.from('cnc_work_order_operations').select('*'),
      supabase.from('cnc_machines').select('code'),
      supabase.from('cnc_processes').select('machine_type'),
      supabase.from('cnc_job_cards').select('operator'),
    ]);
    setMissing(!!p.error && isMissingTable(p.error));
    setRows(p.error ? [] : ((p.data ?? []) as PlanRow[]));
    setWos(w.data ?? []);
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

  // Same machine, same day, overlapping times.
  // Same machine or same man, same day, overlapping times.
  const overlaps = (cand: { machine: string; operator?: string; date: string; start: string; end: string }, ignoreWo?: string, ignoreSeq?: number) =>
    rows.filter(r => ((r.machine && r.machine === cand.machine) || (!!cand.operator && !!r.operator && r.operator === cand.operator)) && String(r.plan_date).slice(0, 10) === cand.date
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
      woId: '', seq: '', process: '', machine: '', operator: '',
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
    setForm(f => ({ ...f, woId: id, seq: first ? String(first.operation_sequence) : '', process: first ? (first.process_name || first.process_code || '') : '', machine: first?.machine || '', operator: first?.operator || '' }));
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
      const out = expandPlan(form.plan).map(s => ({
        id: crypto.randomUUID(), work_order_id: form.woId,
        operation_id: opsForWo.find(o => String(o.operation_sequence) === form.seq)?.id ?? null,
        operation_sequence: Number(form.seq) || 0, process_name: form.process, machine: form.machine.trim(), operator: form.operator.trim(),
        plan_date: s.date, start_time: s.start, end_time: s.end,
      }));
      let r = await supabase.from('cnc_operation_plans').insert(out);
      // Databases that have not run the operator migration yet save the plan without the man.
      if (r.error && /'operator' column/.test(String(r.error.message))) {
        r = await supabase.from('cnc_operation_plans').insert(out.map(({ operator: _o, ...rest }) => rest));
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

  const step = (n: number) => setAnchor(a => addDays(a, view === 'Week' ? n * 7 : n));
  const title = view === 'Day' ? dayLabel(days[0]) : `${dayLabel(days[0])} – ${dayLabel(days[6])}`;
  const today = ymd(new Date());
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
                {dayRows.map(r => {
                  const wo = woById.get(String(r.work_order_id));
                  const top = (toMinutes(hh(r.start_time)) / 60) * HOUR_PX;
                  const height = Math.max(18, segmentHours({ start: hh(r.start_time), end: hh(r.end_time) }) * HOUR_PX - 2);
                  return (
                    <button key={r.id} type="button" data-testid="plan-block" onClick={() => setPicked(r)} title={`${wo?.wo_no ?? ''} · ${r.process_name} · ${r.machine}`}
                      className={`absolute left-0.5 right-0.5 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-[10px] leading-tight shadow-sm hover:brightness-95 ${colorFor(String(r.work_order_id))} ${clash.has(r.id) ? 'ring-2 ring-red-500' : ''}`}
                      style={{ top, height }}>
                      <div className="font-bold truncate">{wo?.wo_no ?? 'Work order'}{r.process_name ? ` · ${r.process_name}` : ''}</div>
                      <div className="truncate">{r.machine}{r.operator ? ` · ${r.operator}` : ''} · {fmtTime24(hh(r.start_time))}–{fmtTime24(hh(r.end_time))}</div>
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
          <PlanEditor value={form.plan} onChange={plan => setForm(f => ({ ...f, plan }))} />
          {conflicts.length > 0 && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="plan-conflict">
              {form.machine} is already planned at these times: {conflicts.slice(0, 3).map(c => `${woById.get(String(c.o.work_order_id))?.wo_no ?? 'another order'} on ${dayLabel(c.s.date)} ${fmtTime24(hh(c.o.start_time))}–${fmtTime24(hh(c.o.end_time))}`).join('; ')}{conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ''}.
            </p>
          )}
        </div>
      </Modal>

      <Modal open={!!picked} onClose={() => setPicked(null)} title="Planned slot" size="sm"
        footer={picked ? <><Button variant="secondary" onClick={() => setPicked(null)}>Close</Button>
          <Button variant="secondary" icon={<Trash2 size={14} />} onClick={() => removeSlot(picked, false)}>Remove slot</Button>
          <Button variant="secondary" icon={<Trash2 size={14} />} onClick={() => removeSlot(picked, true)}>Remove whole plan</Button></> : undefined}>
        {picked && (() => {
          const wo = woById.get(String(picked.work_order_id));
          const same = rows.filter(r => r.work_order_id === picked.work_order_id && r.operation_sequence === picked.operation_sequence);
          return (
            <div className="space-y-1.5 text-sm">
              <p><b>{wo?.wo_no ?? 'Work order'}</b> — {wo?.part_name} {wo?.customer ? `(${wo.customer})` : ''}</p>
              <p>Operation: {picked.process_name || '—'}{picked.operation_sequence ? ` (Seq ${picked.operation_sequence})` : ''}</p>
              <p>Machine: {picked.machine || '—'}</p>
              <p>Operator: {picked.operator || '—'}</p>
              <p>{dayLabel(String(picked.plan_date).slice(0, 10))}, {fmtTime24(hh(picked.start_time))} – {fmtTime24(hh(picked.end_time))}</p>
              <p className="text-xs text-slate-500">This operation has {same.length} planned slot{same.length === 1 ? '' : 's'} in all.</p>
              {clash.has(picked.id) && <p className="text-xs text-red-600">Another plan uses this machine at the same time.</p>}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

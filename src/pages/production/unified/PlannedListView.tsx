import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Download, Trash2, Edit2, Calendar, Clock, Layers, Users, Cpu, CheckCircle2, AlertCircle, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { exportCsv } from '@/lib/reportExport';
import { todayISO } from '@/lib/format';
import { formatWorkOrderOption } from '@/lib/workOrderFormat';
import { fmtTime24, parseYmd, toMinutes, ymd } from '@/lib/operationPlans';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Card';

interface PlanRow {
  id: string;
  work_order_id: string;
  operation_sequence: number;
  process_name: string;
  machine: string;
  operator?: string;
  plan_date: string;
  start_time: string;
  end_time: string;
  quantity?: number | null;
}

const hh = (t: unknown) => String(t ?? '').slice(0, 5);

export function PlannedListView() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [wos, setWos] = useState<any[]>([]);
  const [operations, setOperations] = useState<any[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [operators, setOperators] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [fMachine, setFMachine] = useState('All');
  const [fOperator, setFOperator] = useState('All');
  const [fStatus, setFStatus] = useState('All');

  // Edit / Delete modal state
  const [picked, setPicked] = useState<PlanRow | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    date: '',
    startTime: '',
    endTime: '',
    machine: '',
    operator: '',
    qty: '',
    applyToAll: false,
  });

  // Add Plan modal state
  const [showAdd, setShowAdd] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    woId: '',
    operationSeq: '1',
    processName: 'Machining',
    machine: '',
    operator: '',
    planDate: todayISO(),
    startTime: '08:00',
    endTime: '10:00',
    qty: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, w, m, pr, jc, opRes] = await Promise.all([
        supabase.from('cnc_operation_plans').select('*').order('plan_date', { ascending: false }).order('start_time', { ascending: true }),
        supabase.from('cnc_work_orders').select('*'),
        supabase.from('cnc_machines').select('code'),
        supabase.from('cnc_processes').select('machine_type'),
        supabase.from('cnc_job_cards').select('operator'),
        supabase.from('cnc_work_order_operations').select('id,work_order_id,operation_sequence,process_name,process_code,machine,operator'),
      ]);

      const planList = p.error ? [] : ((p.data ?? []) as PlanRow[]);
      setPlans(planList);
      setWos(w.data ?? []);
      setOperations(opRes.error ? [] : (opRes.data ?? []));

      const machineSet = new Set<string>();
      [...(m.data ?? []).map((x: any) => x.code), ...(pr.data ?? []).map((x: any) => x.machine_type)].forEach((v) => {
        const t = String(v ?? '').trim();
        if (t) machineSet.add(t);
      });
      setMachines([...machineSet].sort((a, b) => a.localeCompare(b)));

      const opSet = new Map<string, string>();
      [...(jc.data ?? []).map((x: any) => x.operator), ...planList.map((x) => x.operator)].forEach((v) => {
        const t = String(v ?? '').trim();
        if (t && t !== '—' && t !== '-' && !opSet.has(t.toLowerCase())) opSet.set(t.toLowerCase(), t);
      });
      setOperators([...opSet.values()].sort((a, b) => a.localeCompare(b)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const woMap = useMemo(() => new Map(wos.map((w) => [String(w.id), w])), [wos]);
  const today = todayISO();

  // Quick range helpers
  const setQuickRange = (type: 'today' | 'week' | 'month' | 'all') => {
    const now = new Date();
    if (type === 'today') {
      setFDateFrom(today);
      setFDateTo(today);
    } else if (type === 'week') {
      const day = now.getDay();
      const diffToMon = day === 0 ? -6 : 1 - day;
      const mon = new Date(now);
      mon.setDate(now.getDate() + diffToMon);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      setFDateFrom(ymd(mon));
      setFDateTo(ymd(sun));
    } else if (type === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFDateFrom(ymd(first));
      setFDateTo(ymd(last));
    } else {
      setFDateFrom('');
      setFDateTo('');
    }
  };

  const getStatus = (planDate: string) => {
    const d = String(planDate).slice(0, 10);
    if (d === today) return 'Today';
    if (d > today) return 'Upcoming';
    return 'Past';
  };

  const calcDurationMins = (start: string, end: string) => {
    const s = toMinutes(hh(start));
    const e = toMinutes(hh(end));
    return e > s ? e - s : 24 * 60 - s + e;
  };

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  const filteredPlans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter((p) => {
      const wo = woMap.get(String(p.work_order_id));
      const pDate = String(p.plan_date).slice(0, 10);
      const status = getStatus(pDate);

      if (fDateFrom && pDate < fDateFrom) return false;
      if (fDateTo && pDate > fDateTo) return false;
      if (fMachine !== 'All' && p.machine !== fMachine) return false;
      if (fOperator !== 'All' && String(p.operator ?? '').toLowerCase() !== fOperator.toLowerCase()) return false;
      if (fStatus !== 'All' && status !== fStatus) return false;

      if (q) {
        const woNo = String(wo?.wo_no ?? '').toLowerCase();
        const part = String(wo?.part_name ?? '').toLowerCase();
        const cust = String(wo?.customer ?? '').toLowerCase();
        const proc = String(p.process_name ?? '').toLowerCase();
        const mach = String(p.machine ?? '').toLowerCase();
        const op = String(p.operator ?? '').toLowerCase();
        if (!woNo.includes(q) && !part.includes(q) && !cust.includes(q) && !proc.includes(q) && !mach.includes(q) && !op.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [plans, woMap, search, fDateFrom, fDateTo, fMachine, fOperator, fStatus]);

  // KPIs
  const totalPlannedHours = useMemo(() => {
    const totalMins = filteredPlans.reduce((sum, p) => sum + calcDurationMins(p.start_time, p.end_time), 0);
    return Math.round((totalMins / 60) * 10) / 10;
  }, [filteredPlans]);

  const todayCount = useMemo(() => filteredPlans.filter((p) => String(p.plan_date).slice(0, 10) === today).length, [filteredPlans, today]);
  const upcomingCount = useMemo(() => filteredPlans.filter((p) => String(p.plan_date).slice(0, 10) > today).length, [filteredPlans, today]);
  const activeMachinesCount = useMemo(() => new Set(filteredPlans.map((p) => p.machine).filter(Boolean)).size, [filteredPlans]);

  // Export CSV
  const handleExport = () => {
    if (!filteredPlans.length) return;
    const rows = [
      ['#', 'Product / Part', 'Customer', 'Operation', 'Process', 'Machine', 'Operator', 'Plan Date', 'Start Time', 'End Time', 'Duration (Hours)', 'Planned Qty', 'Status'],
      ...filteredPlans.map((p, i) => {
        const wo = woMap.get(String(p.work_order_id));
        const pDate = String(p.plan_date).slice(0, 10);
        const mins = calcDurationMins(p.start_time, p.end_time);
        return [
          i + 1,
          wo?.part_name || '',
          wo?.customer || '',
          p.operation_sequence ? `OP ${p.operation_sequence}` : '',
          p.process_name || '',
          p.machine || '',
          p.operator || '',
          pDate,
          fmtTime24(hh(p.start_time)),
          fmtTime24(hh(p.end_time)),
          (Math.round((mins / 60) * 100) / 100).toFixed(2),
          p.quantity ?? wo?.quantity ?? '',
          getStatus(pDate),
        ];
      }),
    ];
    exportCsv(`planned-operations_${todayISO()}`, rows);
  };

  const openEdit = (p: PlanRow) => {
    setPicked(p);
    setEditForm({
      date: String(p.plan_date).slice(0, 10),
      startTime: hh(p.start_time),
      endTime: hh(p.end_time),
      machine: p.machine || '',
      operator: p.operator || '',
      qty: p.quantity != null ? String(p.quantity) : '',
      applyToAll: false,
    });
  };

  const saveEdit = async () => {
    if (!picked) return;
    setSavingEdit(true);
    try {
      const qtyNum = editForm.qty.trim() === '' ? null : Number(editForm.qty) || 0;
      if (editForm.applyToAll) {
        let res = await supabase
          .from('cnc_operation_plans')
          .update({
            machine: editForm.machine.trim(),
            operator: editForm.operator.trim(),
            quantity: qtyNum,
          })
          .eq('work_order_id', picked.work_order_id)
          .eq('operation_sequence', picked.operation_sequence);

        if (res.error && /'quantity' column/.test(String(res.error.message))) {
          await supabase
            .from('cnc_operation_plans')
            .update({ machine: editForm.machine.trim(), operator: editForm.operator.trim() })
            .eq('work_order_id', picked.work_order_id)
            .eq('operation_sequence', picked.operation_sequence);
        }
      }

      const payload: any = {
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
      alert(`Could not update plan slot: ${e?.message ?? e}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const removeSlot = async (p: PlanRow) => {
    if (!window.confirm('Delete this planned operation slot?')) return;
    try {
      const res = await supabase.from('cnc_operation_plans').delete().eq('id', p.id);
      if (res.error) throw res.error;
      await load();
    } catch (e: any) {
      alert(`Could not delete: ${e?.message ?? e}`);
    }
  };

  const openAddModal = () => {
    const defaultWo = wos[0];
    const defaultWoOps = defaultWo
      ? operations.filter((o) => String(o.work_order_id) === String(defaultWo.id)).sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0))
      : [];
    const firstOp = defaultWoOps[0];
    setAddForm({
      woId: defaultWo ? String(defaultWo.id) : '',
      operationSeq: firstOp ? String(firstOp.operation_sequence) : '1',
      processName: firstOp ? (firstOp.process_name || firstOp.process_code || 'Machining') : 'Machining',
      machine: firstOp?.machine || machines[0] || '',
      operator: firstOp?.operator || '',
      planDate: todayISO(),
      startTime: '08:00',
      endTime: '10:00',
      qty: defaultWo?.quantity != null ? String(defaultWo.quantity) : '',
    });
    setShowAdd(true);
  };

  const onAddWoChange = (woId: string) => {
    const selWo = wos.find((w) => String(w.id) === String(woId));
    const woOps = operations.filter((o) => String(o.work_order_id) === String(woId)).sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0));
    const firstOp = woOps[0];
    setAddForm((f) => ({
      ...f,
      woId,
      operationSeq: firstOp ? String(firstOp.operation_sequence) : '1',
      processName: firstOp ? (firstOp.process_name || firstOp.process_code || 'Machining') : 'Machining',
      machine: firstOp?.machine || f.machine || machines[0] || '',
      operator: firstOp?.operator || f.operator,
      qty: selWo?.quantity != null ? String(selWo.quantity) : f.qty,
    }));
  };

  const onAddOpChange = (seq: string) => {
    const op = operations.find((o) => String(o.work_order_id) === String(addForm.woId) && String(o.operation_sequence) === seq);
    setAddForm((f) => ({
      ...f,
      operationSeq: seq,
      processName: op ? (op.process_name || op.process_code || f.processName) : f.processName,
      machine: op?.machine || f.machine,
      operator: op?.operator || f.operator,
    }));
  };

  const saveAddPlan = async () => {
    if (!addForm.woId) return alert('Please select a Work Order.');
    if (!addForm.machine.trim()) return alert('Please specify a Machine.');
    if (!addForm.planDate) return alert('Please specify a Plan Date.');
    if (!addForm.startTime || !addForm.endTime) return alert('Please specify Start and End times.');

    setSavingAdd(true);
    try {
      const qtyNum = addForm.qty.trim() === '' ? null : Number(addForm.qty) || 0;
      const opSeq = Number(addForm.operationSeq) || 1;
      const newRow = {
        id: crypto.randomUUID(),
        work_order_id: addForm.woId,
        operation_sequence: opSeq,
        process_name: addForm.processName.trim() || 'Machining',
        machine: addForm.machine.trim(),
        operator: addForm.operator.trim(),
        plan_date: addForm.planDate,
        start_time: addForm.startTime,
        end_time: addForm.endTime,
        quantity: qtyNum,
      };

      let res = await supabase.from('cnc_operation_plans').insert([newRow]);
      if (res.error && /'quantity' column/.test(String(res.error.message))) {
        const { quantity: _q, ...rest } = newRow;
        res = await supabase.from('cnc_operation_plans').insert([rest]);
      }
      if (res.error && /'operator' column/.test(String(res.error.message))) {
        const { operator: _o, ...rest } = newRow;
        res = await supabase.from('cnc_operation_plans').insert([rest]);
      }
      if (res.error) throw res.error;

      setShowAdd(false);
      await load();
    } catch (e: any) {
      alert(`Could not save plan: ${e?.message ?? e}`);
    } finally {
      setSavingAdd(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Compact KPI Boxes */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-xs flex items-center justify-between gap-2 hover:border-slate-300 transition-colors">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">Total Planned</span>
            <span className="text-base font-bold tabular-nums text-slate-900 leading-tight">{filteredPlans.length}</span>
          </div>
          <span className="p-1.5 rounded-md bg-blue-50 text-blue-600 shrink-0"><Layers size={15} /></span>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-xs flex items-center justify-between gap-2 hover:border-slate-300 transition-colors">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">Planned Hours</span>
            <span className="text-base font-bold tabular-nums text-indigo-700 leading-tight">{totalPlannedHours} h</span>
          </div>
          <span className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 shrink-0"><Clock size={15} /></span>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-xs flex items-center justify-between gap-2 hover:border-slate-300 transition-colors">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">Today's Plans</span>
            <span className="text-base font-bold tabular-nums text-amber-600 leading-tight">{todayCount}</span>
          </div>
          <span className="p-1.5 rounded-md bg-amber-50 text-amber-600 shrink-0"><Calendar size={15} /></span>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-xs flex items-center justify-between gap-2 hover:border-slate-300 transition-colors">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">Upcoming</span>
            <span className="text-base font-bold tabular-nums text-emerald-600 leading-tight">{upcomingCount}</span>
          </div>
          <span className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 shrink-0"><CheckCircle2 size={15} /></span>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-xs flex items-center justify-between gap-2 hover:border-slate-300 transition-colors">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">Active Machines</span>
            <span className="text-base font-bold tabular-nums text-purple-700 leading-tight">{activeMachinesCount}</span>
          </div>
          <span className="p-1.5 rounded-md bg-purple-50 text-purple-600 shrink-0"><Cpu size={15} /></span>
        </div>
      </div>

      {/* Filter and Action Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm space-y-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search product, customer, process, machine…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-brand-500 focus:bg-white"
            />
          </div>

          {/* Quick Dates */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {(['all', 'today', 'week', 'month'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setQuickRange(r)}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  (r === 'all' && !fDateFrom && !fDateTo) ||
                  (r === 'today' && fDateFrom === today && fDateTo === today)
                    ? 'bg-white font-semibold text-brand-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {r === 'all' ? 'All Dates' : r === 'today' ? 'Today' : r === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-1 text-xs">
            <input
              type="date"
              value={fDateFrom}
              onChange={(e) => setFDateFrom(e.target.value)}
              className="h-9 px-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-brand-500"
              title="From date"
            />
            <span className="text-slate-400">→</span>
            <input
              type="date"
              value={fDateTo}
              onChange={(e) => setFDateTo(e.target.value)}
              className="h-9 px-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-brand-500"
              title="To date"
            />
          </div>

          {/* Machine Filter */}
          <select
            value={fMachine}
            onChange={(e) => setFMachine(e.target.value)}
            className="h-9 px-2.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-brand-500 cursor-pointer"
          >
            <option value="All">All Machines</option>
            {machines.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {/* Operator Filter */}
          <select
            value={fOperator}
            onChange={(e) => setFOperator(e.target.value)}
            className="h-9 px-2.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-brand-500 cursor-pointer"
          >
            <option value="All">All Operators</option>
            {operators.map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
            className="h-9 px-2.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-brand-500 cursor-pointer"
          >
            <option value="All">All Statuses</option>
            <option value="Today">Today</option>
            <option value="Upcoming">Upcoming</option>
            <option value="Past">Past</option>
          </select>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExport}
            disabled={!filteredPlans.length}
            className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-xs flex items-center gap-1.5 shrink-0 transition disabled:opacity-40 cursor-pointer"
          >
            <Download size={13} />
            <span>Export CSV</span>
          </button>

          {/* Add Plan */}
          <button
            type="button"
            onClick={openAddModal}
            className="h-9 px-3.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg shadow-xs flex items-center gap-1.5 shrink-0 transition cursor-pointer"
          >
            <Plus size={14} />
            <span>Add Plan</span>
          </button>
        </div>
      </div>

      {/* List Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[640px]">
          <table className="w-full text-xs min-w-[1050px]">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] sticky top-0 z-10 shadow-xs border-b border-slate-200">
              <tr className="text-left">
                <th className="py-2.5 px-3 w-12 text-center">#</th>
                <th className="py-2.5 px-3">Product / Part & Customer</th>
                <th className="py-2.5 px-3">Operation / Process</th>
                <th className="py-2.5 px-3">Plan Date</th>
                <th className="py-2.5 px-3">Time Window</th>
                <th className="py-2.5 px-3">Duration</th>
                <th className="py-2.5 px-3">Machine</th>
                <th className="py-2.5 px-3">Operator</th>
                <th className="py-2.5 px-3 text-right">Qty</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPlans.map((p, idx) => {
                const wo = woMap.get(String(p.work_order_id));
                const pDate = String(p.plan_date).slice(0, 10);
                const status = getStatus(pDate);
                const durationMins = calcDurationMins(p.start_time, p.end_time);

                return (
                  <tr key={p.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900 truncate max-w-[260px]" title={wo?.part_name}>{wo?.part_name || '—'}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[260px]">
                        {wo?.is_part_order === true && wo?.product_name ? `Part of ${wo.product_name}` : ''}{wo?.customer ? `${wo?.is_part_order === true && wo?.product_name ? ' · ' : ''}${wo.customer}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-800">
                        {p.operation_sequence != null ? `OP ${p.operation_sequence}: ` : ''}{p.process_name || 'Process'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="font-medium text-slate-800">
                        {pDate ? parseYmd(pDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-slate-700">
                      {fmtTime24(hh(p.start_time))} – {fmtTime24(hh(p.end_time))}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-700 whitespace-nowrap">
                      {formatDuration(durationMins)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                        {p.machine || '—'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 font-medium whitespace-nowrap">
                      {p.operator || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-800">
                      {p.quantity != null ? `${p.quantity} pcs` : wo?.quantity ? `${wo.quantity} pcs` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          status === 'Today'
                            ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                            : status === 'Upcoming'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          title="Edit slot"
                          className="p-1.5 rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition cursor-pointer"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSlot(p)}
                          title="Delete slot"
                          className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && filteredPlans.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <Calendar size={32} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-600">No planned operations match these filters</p>
                    <p className="text-xs text-slate-400 mt-0.5">Use the Planned Timeline tab to schedule operations</p>
                  </td>
                </tr>
              )}
              {loading && filteredPlans.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400 text-xs">Loading planned operations…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Slot Modal */}
      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title="Edit Planned Slot"
        size="md"
        footer={
          <div className="flex items-center justify-between w-full">
            <button
              type="button"
              onClick={() => { if (picked) void removeSlot(picked); setPicked(null); }}
              className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1"
            >
              Delete Slot
            </button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPicked(null)}>Cancel</Button>
              <Button onClick={() => void saveEdit()} disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        }
      >
        {picked && (
          <div className="space-y-3.5 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="font-bold text-slate-900">{woMap.get(String(picked.work_order_id))?.part_name}</div>
              <div className="text-slate-600 font-medium">{picked.process_name}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Plan Date" required>
                <input
                  type="date"
                  className={inputClass}
                  value={editForm.date}
                  onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                />
              </FormField>

              <FormField label="Planned Qty">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={editForm.qty}
                  placeholder="Leave blank for all"
                  onChange={(e) => setEditForm((f) => ({ ...f, qty: e.target.value }))}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Start Time (24h)" required>
                <input
                  type="time"
                  className={inputClass}
                  value={editForm.startTime}
                  onChange={(e) => setEditForm((f) => ({ ...f, startTime: e.target.value }))}
                />
              </FormField>

              <FormField label="End Time (24h)" required>
                <input
                  type="time"
                  className={inputClass}
                  value={editForm.endTime}
                  onChange={(e) => setEditForm((f) => ({ ...f, endTime: e.target.value }))}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Machine" required>
                <input
                  className={inputClass}
                  list="edit-machines-list"
                  value={editForm.machine}
                  onChange={(e) => setEditForm((f) => ({ ...f, machine: e.target.value }))}
                />
                <datalist id="edit-machines-list">
                  {machines.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </FormField>

              <FormField label="Operator">
                <input
                  className={inputClass}
                  list="edit-operators-list"
                  value={editForm.operator}
                  onChange={(e) => setEditForm((f) => ({ ...f, operator: e.target.value }))}
                />
                <datalist id="edit-operators-list">
                  {operators.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </FormField>
            </div>

            <label className="flex items-center gap-2 pt-1 text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={editForm.applyToAll}
                onChange={(e) => setEditForm((f) => ({ ...f, applyToAll: e.target.checked }))}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span>Apply machine & operator to all slots of this operation</span>
            </label>
          </div>
        )}
      </Modal>

      {/* Add Plan Modal */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add Planned Operation Slot"
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="secondary" onClick={() => setShowAdd(false)} disabled={savingAdd}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="bg-brand-600 hover:bg-brand-700 text-white"
              onClick={saveAddPlan}
              disabled={savingAdd}
            >
              {savingAdd ? 'Saving…' : 'Add Planned Slot'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <FormField label="Work Order" required>
            <select
              className={inputClass}
              value={addForm.woId}
              onChange={(e) => onAddWoChange(e.target.value)}
            >
              <option value="">-- Select Work Order --</option>
              {wos.map((w) => (
                <option key={w.id} value={w.id}>
                  {formatWorkOrderOption(w)}
                </option>
              ))}
            </select>
          </FormField>

          {addForm.woId && operations.filter((o) => String(o.work_order_id) === String(addForm.woId)).length > 0 && (
            <FormField label="Operation Sequence & Process" required>
              <select
                className={inputClass}
                value={addForm.operationSeq}
                onChange={(e) => onAddOpChange(e.target.value)}
              >
                {operations
                  .filter((o) => String(o.work_order_id) === String(addForm.woId))
                  .sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0))
                  .map((o) => (
                    <option key={o.id} value={o.operation_sequence}>
                      Op #{o.operation_sequence} — {o.process_name || o.process_code || 'Machining'}
                    </option>
                  ))}
              </select>
            </FormField>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Process Name" required>
              <input
                type="text"
                className={inputClass}
                value={addForm.processName}
                placeholder="e.g. CNC Milling, Turning, Drilling"
                onChange={(e) => setAddForm((f) => ({ ...f, processName: e.target.value }))}
              />
            </FormField>

            <FormField label="Planned Quantity (pcs)">
              <input
                type="number"
                min="0"
                className={inputClass}
                value={addForm.qty}
                placeholder="Leave blank for entire batch"
                onChange={(e) => setAddForm((f) => ({ ...f, qty: e.target.value }))}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FormField label="Plan Date" required>
              <input
                type="date"
                className={inputClass}
                value={addForm.planDate}
                onChange={(e) => setAddForm((f) => ({ ...f, planDate: e.target.value }))}
              />
            </FormField>

            <FormField label="Start Time (24h)" required>
              <input
                type="time"
                className={inputClass}
                value={addForm.startTime}
                onChange={(e) => setAddForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </FormField>

            <FormField label="End Time (24h)" required>
              <input
                type="time"
                className={inputClass}
                value={addForm.endTime}
                onChange={(e) => setAddForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Machine" required>
              <input
                className={inputClass}
                list="add-machines-list"
                value={addForm.machine}
                placeholder="Select or enter machine"
                onChange={(e) => setAddForm((f) => ({ ...f, machine: e.target.value }))}
              />
              <datalist id="add-machines-list">
                {machines.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </FormField>

            <FormField label="Operator (Man)">
              <input
                className={inputClass}
                list="add-operators-list"
                value={addForm.operator}
                placeholder="Select or enter operator"
                onChange={(e) => setAddForm((f) => ({ ...f, operator: e.target.value }))}
              />
              <datalist id="add-operators-list">
                {operators.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </FormField>
          </div>
        </div>
      </Modal>
    </div>
  );
}

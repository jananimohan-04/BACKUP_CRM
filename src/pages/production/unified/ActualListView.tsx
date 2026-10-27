import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Download, Calendar, Clock, Play, CheckCircle2, Layers, Cpu, Plus, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { exportCsv } from '@/lib/reportExport';
import { todayISO } from '@/lib/format';
import { AddRunsModal, defaultActualSlot } from './AddRunsModal';
import { fmtTime24, parseYmd, ymd } from '@/lib/operationPlans';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Card';
import { dt, dur, jobSpan } from './ComparisonPage';

interface JobCard {
  id: string;
  job_no: string;
  work_order: string;
  operation: string;
  part_name?: string;
  op_no?: number;
  machine: string;
  operator?: string;
  actual_start?: string | null;
  actual_end?: string | null;
  completed_at?: string | null;
  status: string;
  qty_planned?: number | null;
  qty_completed?: number | null;
  qty_rejected?: number | null;
  created_at: string;
}

export function ActualListView() {
  const [jobs, setJobs] = useState<JobCard[]>([]);
  const [wos, setWos] = useState<any[]>([]);
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [inwards, setInwards] = useState<any[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [operators, setOperators] = useState<string[]>([]);
  const [processes, setProcesses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [fMachine, setFMachine] = useState('All');
  const [fOperator, setFOperator] = useState('All');
  const [fStatus, setFStatus] = useState('All');
  const [fProduct, setFProduct] = useState('All');

  // Add Run modal state
  const [showAdd, setShowAdd] = useState(false);
  const [slot, setSlot] = useState(defaultActualSlot());

  // Edit Run modal state
  const [picked, setPicked] = useState<JobCard | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    date: todayISO(),
    startTime: '08:00',
    endTime: '16:00',
    operation: 'Machining',
    machine: '',
    operator: '',
    qtyCompleted: '0',
    qtyPlanned: '',
    qtyRejected: '0',
    status: 'Completed',
  });

  const today = todayISO();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [j, w, m, so, inw, proc] = await Promise.all([
        supabase.from('cnc_job_cards').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('cnc_work_orders').select('*'),
        supabase.from('cnc_machines').select('code'),
        supabase.from('cnc_sales_orders').select('*'),
        supabase.from('cnc_inwards').select('*').neq('status', 'Deleted'),
        supabase.from('cnc_processes').select('process_name'),
      ]);
      setSalesOrders(so.error ? [] : (so.data ?? []));
      setInwards(inw.error ? [] : (inw.data ?? []));

      const jobList = j.error ? [] : ((j.data ?? []) as JobCard[]).filter((x) => String(x.status ?? '') !== 'Cancelled');
      setJobs(jobList);
      setWos(w.data ?? []);

      const machSet = new Set<string>();
      [...(m.data ?? []).map((x: any) => x.code), ...jobList.map((x) => x.machine)].forEach((v) => {
        const t = String(v ?? '').trim();
        if (t) machSet.add(t);
      });
      setMachines([...machSet].sort((a, b) => a.localeCompare(b)));

      const opSet = new Map<string, string>();
      jobList.forEach((x) => {
        const n = String(x.operator ?? '').trim();
        if (n && n !== '—' && n !== '-' && !opSet.has(n.toLowerCase())) opSet.set(n.toLowerCase(), n);
      });
      setOperators([...opSet.values()].sort((a, b) => a.localeCompare(b)));

      const procSet = new Set<string>();
      (proc.error ? [] : (proc.data ?? [])).forEach((x: any) => {
        const p = String(x.process_name ?? '').trim();
        if (p) procSet.add(p);
      });
      jobList.forEach((x) => {
        const p = String(x.operation ?? '').trim();
        if (p) procSet.add(p);
      });
      setProcesses([...procSet].sort((a, b) => a.localeCompare(b)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const woMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const w of wos) {
      if (w.wo_no) map.set(String(w.wo_no).trim().toLowerCase(), w);
      map.set(String(w.id), w);
    }
    return map;
  }, [wos]);

  const productNames = useMemo(() => {
    const names = new Set<string>();
    jobs.forEach((j) => {
      const wo = woMap.get(String(j.work_order ?? '').trim().toLowerCase());
      const p = wo?.part_name || wo?.product_name || j.part_name;
      if (p) names.add(String(p).trim());
    });
    wos.forEach((w) => {
      if (w.part_name) names.add(String(w.part_name).trim());
      if (w.product_name) names.add(String(w.product_name).trim());
    });
    return Array.from(names).filter(Boolean).sort();
  }, [jobs, wos, woMap]);

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

  const now = new Date();

  // Filtered actual runs
  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      const wo = woMap.get(String(j.work_order ?? '').trim().toLowerCase());
      const span = jobSpan(j, now);
      const runDate = j.actual_start
        ? String(j.actual_start).slice(0, 10)
        : String(j.created_at).slice(0, 10);

      if (fDateFrom && runDate < fDateFrom) return false;
      if (fDateTo && runDate > fDateTo) return false;
      if (fMachine !== 'All' && j.machine !== fMachine) return false;
      if (fOperator !== 'All' && String(j.operator ?? '').toLowerCase() !== fOperator.toLowerCase()) return false;

      if (fProduct !== 'All') {
        const partName = String(wo?.part_name || j.part_name || '').toLowerCase();
        const productName = String(wo?.product_name ?? '').toLowerCase();
        const filterLower = fProduct.toLowerCase();
        if (!partName.includes(filterLower) && !productName.includes(filterLower)) return false;
      }

      const isRunning = span?.running || ['Running', 'In Progress'].includes(String(j.status));
      const isCompleted = String(j.status) === 'Completed' || !!j.actual_end;
      const isPaused = String(j.status) === 'Paused';

      if (fStatus === 'Running' && !isRunning) return false;
      if (fStatus === 'Completed' && !isCompleted) return false;
      if (fStatus === 'Paused' && !isPaused) return false;

      if (q) {
        const jNo = String(j.job_no ?? '').toLowerCase();
        const woNo = String(j.work_order ?? '').toLowerCase();
        const part = String(wo?.part_name ?? '').toLowerCase();
        const cust = String(wo?.customer ?? '').toLowerCase();
        const oper = String(j.operation ?? '').toLowerCase();
        const mach = String(j.machine ?? '').toLowerCase();
        const op = String(j.operator ?? '').toLowerCase();
        if (!jNo.includes(q) && !woNo.includes(q) && !part.includes(q) && !cust.includes(q) && !oper.includes(q) && !mach.includes(q) && !op.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [jobs, woMap, search, fDateFrom, fDateTo, fMachine, fOperator, fStatus, fProduct, now]);

  // KPIs
  const totalActualHours = useMemo(() => {
    let totalMins = 0;
    for (const j of filteredJobs) {
      const span = jobSpan(j, now);
      if (span) {
        const diffMs = span.end.getTime() - span.start.getTime();
        totalMins += Math.max(0, diffMs / 60000);
      }
    }
    return Math.round((totalMins / 60) * 10) / 10;
  }, [filteredJobs, now]);

  const runningCount = useMemo(() => {
    return filteredJobs.filter((j) => {
      const span = jobSpan(j, now);
      return span?.running || ['Running', 'In Progress'].includes(String(j.status));
    }).length;
  }, [filteredJobs, now]);

  const completedCount = useMemo(() => {
    return filteredJobs.filter((j) => String(j.status) === 'Completed' || !!j.actual_end).length;
  }, [filteredJobs]);

  const totalPartsProduced = useMemo(() => {
    return filteredJobs.reduce((sum, j) => sum + (Number(j.qty_completed) || 0), 0);
  }, [filteredJobs]);

  // Export CSV
  const handleExport = () => {
    if (!filteredJobs.length) return;
    const rows = [
      ['#', 'Product / Part', 'Customer', 'Operation', 'Machine', 'Operator', 'Start Time', 'End Time', 'Duration', 'Qty Completed', 'Qty Planned', 'Qty Rejected', 'Status'],
      ...filteredJobs.map((j, i) => {
        const wo = woMap.get(String(j.work_order ?? '').trim().toLowerCase());
        const span = jobSpan(j, now);
        const durationStr = span ? dur((span.end.getTime() - span.start.getTime()) / 60000) : '—';
        return [
          i + 1,
          wo?.part_name || '',
          wo?.customer || '',
          j.operation || '',
          j.machine || '',
          j.operator || '',
          span ? dt(span.start) : '',
          span ? (span.running ? 'Running' : dt(span.end)) : '',
          durationStr,
          j.qty_completed ?? '',
          j.qty_planned ?? '',
          j.qty_rejected ?? '',
          span?.running ? 'Running' : j.status,
        ];
      }),
    ];
    exportCsv(`actual-runs_${todayISO()}`, rows);
  };

  const openAddModal = () => { setSlot(defaultActualSlot()); setShowAdd(true); };

  const openEdit = (j: JobCard) => {
    setPicked(j);
    const startDate = j.actual_start ? new Date(j.actual_start) : (j.created_at ? new Date(j.created_at) : new Date());
    const endDate = j.actual_end ? new Date(j.actual_end) : startDate;

    const dateStr = !isNaN(startDate.getTime()) ? ymd(startDate) : todayISO();
    const startHhmm = !isNaN(startDate.getTime())
      ? `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`
      : '08:00';
    const endHhmm = !isNaN(endDate.getTime())
      ? `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`
      : '16:00';

    setEditForm({
      date: dateStr,
      startTime: startHhmm,
      endTime: endHhmm,
      operation: j.operation || 'Machining',
      machine: j.machine || '',
      operator: j.operator || '',
      qtyCompleted: j.qty_completed != null ? String(j.qty_completed) : '0',
      qtyPlanned: j.qty_planned != null ? String(j.qty_planned) : '',
      qtyRejected: j.qty_rejected != null ? String(j.qty_rejected) : '0',
      status: j.status || 'Completed',
    });
  };

  const saveEdit = async () => {
    if (!picked) return;
    setSavingEdit(true);
    try {
      const s = new Date(`${editForm.date}T${editForm.startTime}:00`);
      const e = new Date(`${editForm.date}T${editForm.endTime}:00`);
      const newQtyCompleted = Number(editForm.qtyCompleted) || 0;
      const oldQtyCompleted = Number(picked.qty_completed) || 0;
      const qtyDiff = newQtyCompleted - oldQtyCompleted;

      const payload: any = {
        operation: editForm.operation.trim() || 'Machining',
        machine: editForm.machine.trim(),
        operator: editForm.operator.trim() || null,
        qty_completed: newQtyCompleted,
        qty_planned: editForm.qtyPlanned.trim() === '' ? null : Number(editForm.qtyPlanned) || 0,
        qty_rejected: Number(editForm.qtyRejected) || 0,
        status: editForm.status,
        actual_start: !isNaN(s.getTime()) ? s.toISOString() : null,
        actual_end: !isNaN(e.getTime()) ? e.toISOString() : null,
        completed_at: editForm.status === 'Completed' ? (!isNaN(e.getTime()) ? e.toISOString() : new Date().toISOString()) : null,
      };

      const res = await supabase.from('cnc_job_cards').update(payload).eq('id', picked.id);
      if (res.error) throw res.error;

      if (qtyDiff !== 0 && picked.work_order) {
        const wo = woMap.get(String(picked.work_order).trim().toLowerCase());
        if (wo?.id) {
          const nextCompleted = Math.max(0, (Number(wo.completed) || 0) + qtyDiff);
          const target = Number(wo.quantity) || 0;
          const nextStatus = target > 0 && nextCompleted >= target ? 'Completed' : (nextCompleted > 0 ? 'In Progress' : wo.status);
          await supabase.from('cnc_work_orders').update({ completed: nextCompleted, status: nextStatus }).eq('id', wo.id);
        }
      }

      setPicked(null);
      await load();
    } catch (err: any) {
      alert(`Could not update actual run: ${err?.message ?? err}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const removeJob = async (j: JobCard) => {
    if (!window.confirm(`Delete actual run ${j.job_no || j.work_order || ''}? This will remove the actual run record.`)) return;
    try {
      const res = await supabase.from('cnc_job_cards').delete().eq('id', j.id);
      if (res.error) throw res.error;

      const completedQty = Number(j.qty_completed) || 0;
      if (completedQty > 0 && j.work_order) {
        const wo = woMap.get(String(j.work_order).trim().toLowerCase());
        if (wo?.id) {
          const nextCompleted = Math.max(0, (Number(wo.completed) || 0) - completedQty);
          const target = Number(wo.quantity) || 0;
          const nextStatus = target > 0 && nextCompleted >= target ? 'Completed' : (nextCompleted > 0 ? 'In Progress' : 'Planned');
          await supabase.from('cnc_work_orders').update({ completed: nextCompleted, status: nextStatus }).eq('id', wo.id);
        }
      }

      await load();
    } catch (err: any) {
      alert(`Could not delete actual run: ${err?.message ?? err}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Compact KPI Boxes */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-xs flex items-center justify-between gap-2 hover:border-slate-300 transition-colors">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">Total Actual Runs</span>
            <span className="text-base font-bold tabular-nums text-slate-900 leading-tight">{filteredJobs.length}</span>
          </div>
          <span className="p-1.5 rounded-md bg-blue-50 text-blue-600 shrink-0"><Layers size={15} /></span>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-xs flex items-center justify-between gap-2 hover:border-slate-300 transition-colors">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">Actual Hours Run</span>
            <span className="text-base font-bold tabular-nums text-indigo-700 leading-tight">{totalActualHours} h</span>
          </div>
          <span className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 shrink-0"><Clock size={15} /></span>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-xs flex items-center justify-between gap-2 hover:border-slate-300 transition-colors">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">Running Now</span>
            <span className="text-base font-bold tabular-nums text-emerald-600 leading-tight">{runningCount}</span>
          </div>
          <span className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 shrink-0 animate-pulse"><Play size={15} /></span>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-xs flex items-center justify-between gap-2 hover:border-slate-300 transition-colors">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">Completed Runs</span>
            <span className="text-base font-bold tabular-nums text-emerald-700 leading-tight">{completedCount}</span>
          </div>
          <span className="p-1.5 rounded-md bg-emerald-50 text-emerald-700 shrink-0"><CheckCircle2 size={15} /></span>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-xs flex items-center justify-between gap-2 hover:border-slate-300 transition-colors">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">Parts Produced</span>
            <span className="text-base font-bold tabular-nums text-purple-700 leading-tight">{totalPartsProduced.toLocaleString()}</span>
          </div>
          <span className="p-1.5 rounded-md bg-purple-50 text-purple-600 shrink-0"><Cpu size={15} /></span>
        </div>
      </div>

      {/* Filter and Action Bar - Consistent with DataTable style */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-3 border-b border-slate-100 bg-slate-50/50">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search job card, WO, product, customer, machine, operator…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all placeholder:text-slate-400"
            />
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-slate-400" />
            <input
              type="date"
              value={fDateFrom}
              onChange={(e) => setFDateFrom(e.target.value)}
              className="px-2 py-2 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              title="From date"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={fDateTo}
              onChange={(e) => setFDateTo(e.target.value)}
              className="px-2 py-2 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              title="To date"
            />
          </div>

          {/* Machine Filter */}
          <select
            value={fMachine}
            onChange={(e) => setFMachine(e.target.value)}
            className="px-3 py-2 text-sm font-medium bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 cursor-pointer appearance-none pr-8"
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
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
            className="px-3 py-2 text-sm font-medium bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 cursor-pointer appearance-none pr-8"
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
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
            className="px-3 py-2 text-sm font-medium bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 cursor-pointer appearance-none pr-8"
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
          >
            <option value="All">All Status</option>
            <option value="Running">Running Now</option>
            <option value="Completed">Completed</option>
            <option value="Paused">Paused</option>
          </select>

          {/* Quick Date Buttons */}
          <div className="flex items-center border border-slate-200 rounded-md overflow-hidden bg-white">
            {(['all', 'today', 'week', 'month'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setQuickRange(r)}
                className={`px-3 py-2 text-xs font-semibold transition border-r border-slate-200 last:border-r-0 ${
                  (r === 'all' && !fDateFrom && !fDateTo) ||
                  (r === 'today' && fDateFrom === today && fDateTo === today)
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {r === 'all' ? 'All' : r === 'today' ? 'Today' : r === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExport}
            disabled={!filteredJobs.length}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold tracking-wide text-slate-600 hover:text-brand-700 bg-white hover:bg-brand-50 rounded-md transition-colors border border-slate-200 hover:border-brand-200 shadow-sm disabled:opacity-40"
          >
            <Download size={14} />
            EXPORT
          </button>

          {/* Record Run */}
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-md shadow-sm transition cursor-pointer"
          >
            <Plus size={14} />
            Record Run
          </button>
        </div>
      </div>

      {/* List Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[640px]">
          <table className="w-full text-xs min-w-[1100px]">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[11px] sticky top-0 z-10 shadow-xs border-b border-slate-200">
              <tr className="text-left">
                <th className="py-2.5 px-3 w-12 text-center bg-slate-100 text-slate-700">#</th>
                <th className="py-2.5 px-3 bg-slate-100 text-slate-700">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Product / Part</span>
                    <select
                      aria-label="Filter by Product"
                      title="Filter by Product"
                      value={fProduct}
                      onChange={(e) => setFProduct(e.target.value)}
                      className="text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[120px] truncate shadow-xs"
                    >
                      <option value="All">All</option>
                      {productNames.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="py-2.5 px-3 bg-slate-100 text-slate-700">Operation / Process</th>
                <th className="py-2.5 px-3 bg-slate-100 text-slate-700">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Machine</span>
                    <select
                      aria-label="Filter by Machine"
                      title="Filter by Machine"
                      value={fMachine}
                      onChange={(e) => setFMachine(e.target.value)}
                      className="text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[90px] truncate shadow-xs"
                    >
                      <option value="All">All</option>
                      {machines.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="py-2.5 px-3 bg-slate-100 text-slate-700">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Operator</span>
                    <select
                      aria-label="Filter by Operator"
                      title="Filter by Operator"
                      value={fOperator}
                      onChange={(e) => setFOperator(e.target.value)}
                      className="text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[90px] truncate shadow-xs"
                    >
                      <option value="All">All</option>
                      {operators.map((op) => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="py-2.5 px-3 bg-slate-100 text-slate-700">Start Time</th>
                <th className="py-2.5 px-3 bg-slate-100 text-slate-700">End Time</th>
                <th className="py-2.5 px-3 bg-slate-100 text-slate-700">Duration</th>
                <th className="py-2.5 px-3 text-right bg-slate-100 text-slate-700">Parts Output</th>
                <th className="py-2.5 px-3 text-center bg-slate-100 text-slate-700">
                  <div className="flex items-center justify-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Status</span>
                    <select
                      aria-label="Filter by Status"
                      title="Filter by Status"
                      value={fStatus}
                      onChange={(e) => setFStatus(e.target.value)}
                      className="text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[80px] truncate shadow-xs"
                    >
                      <option value="All">All</option>
                      <option value="Running">Running</option>
                      <option value="Completed">Completed</option>
                      <option value="Paused">Paused</option>
                    </select>
                  </div>
                </th>
                <th className="py-2.5 px-3 text-center bg-slate-100 text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredJobs.map((j, idx) => {
                const wo = woMap.get(String(j.work_order ?? '').trim().toLowerCase());
                const span = jobSpan(j, now);
                const isRunning = span?.running || ['Running', 'In Progress'].includes(String(j.status));
                const durationMins = span ? Math.max(0, (span.end.getTime() - span.start.getTime()) / 60000) : 0;

                return (
                  <tr key={j.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900 truncate max-w-[260px]" title={wo?.part_name || j.part_name}>
                        {wo?.part_name || j.part_name || '—'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[260px]">
                        {wo?.is_part_order === true && wo?.product_name ? `Part of ${wo.product_name}` : ''}{wo?.customer ? `${wo?.is_part_order === true && wo?.product_name ? ' · ' : ''}${wo.customer}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-800">{j.operation || 'Operation'}</div>
                      {j.op_no != null && <div className="text-[10px] text-slate-400">Seq OP {j.op_no}</div>}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        {j.machine || '—'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 font-medium whitespace-nowrap">
                      {j.operator || '—'}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-slate-700">
                      {span?.start ? dt(span.start) : j.actual_start ? dt(new Date(j.actual_start)) : '—'}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {isRunning ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                          Running Now
                        </span>
                      ) : span?.end ? (
                        <span className="text-slate-700">{dt(span.end)}</span>
                      ) : j.actual_end ? (
                        <span className="text-slate-700">{dt(new Date(j.actual_end))}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800 whitespace-nowrap">
                      {durationMins > 0 ? dur(durationMins) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                      <span className="font-bold text-slate-900">{j.qty_completed ?? 0}</span>
                      <span className="text-slate-400"> / {j.qty_planned ?? wo?.quantity ?? '—'} pcs</span>
                      {Number(j.qty_rejected ?? 0) > 0 && (
                        <div className="text-[10px] font-semibold text-red-600">({j.qty_rejected} rejected)</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isRunning
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : j.status === 'Completed' || j.actual_end
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : j.status === 'Paused'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {isRunning ? 'Running' : j.status || 'Done'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <div className="inline-flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(j)}
                          title="Edit actual run"
                          className="p-1.5 rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition cursor-pointer"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeJob(j)}
                          title="Delete actual run"
                          className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && filteredJobs.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400">
                    <Calendar size={32} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-600">No actual run records match these filters</p>
                    <p className="text-xs text-slate-400 mt-0.5">Start job cards in Production or log runs in the Actual Timeline</p>
                  </td>
                </tr>
              )}
              {loading && filteredJobs.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400 text-xs">Loading actual run records…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Actual Run Modal */}
      <AddRunsModal open={showAdd} onClose={() => setShowAdd(false)} initial={slot} mode="actual" onSaved={() => { void load(); }} />

      {/* Edit Actual Run Modal */}
      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title="Edit Actual Run"
        size="md"
        footer={
          <div className="flex items-center justify-between w-full">
            <button
              type="button"
              onClick={() => { if (picked) void removeJob(picked); setPicked(null); }}
              className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1 cursor-pointer"
            >
              Delete Run
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
              <div className="flex items-center justify-between">
                <div className="font-bold text-slate-900">{woMap.get(String(picked.work_order ?? '').trim().toLowerCase())?.part_name || picked.part_name || 'Part'}</div>
                <span className="text-[11px] font-mono text-slate-500">{picked.job_no || picked.work_order}</span>
              </div>
              <div className="text-slate-600 font-medium mt-0.5">
                {woMap.get(String(picked.work_order ?? '').trim().toLowerCase())?.customer ? `${woMap.get(String(picked.work_order ?? '').trim().toLowerCase())?.customer} · ` : ''}{picked.operation || 'Machining'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Run Date" required>
                <input
                  type="date"
                  className={inputClass}
                  value={editForm.date}
                  onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                />
              </FormField>

              <FormField label="Status" required>
                <select
                  className={inputClass}
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="Completed">Completed</option>
                  <option value="Running">Running</option>
                  <option value="Paused">Paused</option>
                  <option value="In Progress">In Progress</option>
                </select>
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
              <FormField label="Operation / Process" required>
                <input
                  className={inputClass}
                  list="edit-actual-processes"
                  value={editForm.operation}
                  placeholder="e.g. Machining, Turning"
                  onChange={(e) => setEditForm((f) => ({ ...f, operation: e.target.value }))}
                />
                <datalist id="edit-actual-processes">
                  {processes.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </FormField>

              <FormField label="Machine" required>
                <input
                  className={inputClass}
                  list="edit-actual-machines"
                  value={editForm.machine}
                  placeholder="Select or enter machine"
                  onChange={(e) => setEditForm((f) => ({ ...f, machine: e.target.value }))}
                />
                <datalist id="edit-actual-machines">
                  {machines.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Operator">
                <input
                  className={inputClass}
                  list="edit-actual-operators"
                  value={editForm.operator}
                  placeholder="Select or enter operator"
                  onChange={(e) => setEditForm((f) => ({ ...f, operator: e.target.value }))}
                />
                <datalist id="edit-actual-operators">
                  {operators.map((op) => (
                    <option key={op} value={op} />
                  ))}
                </datalist>
              </FormField>

              <FormField label="Finished Qty (Completed)" required>
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={editForm.qtyCompleted}
                  onChange={(e) => setEditForm((f) => ({ ...f, qtyCompleted: e.target.value }))}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Planned Qty">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={editForm.qtyPlanned}
                  placeholder="Optional"
                  onChange={(e) => setEditForm((f) => ({ ...f, qtyPlanned: e.target.value }))}
                />
              </FormField>

              <FormField label="Rejected Qty">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={editForm.qtyRejected}
                  placeholder="0"
                  onChange={(e) => setEditForm((f) => ({ ...f, qtyRejected: e.target.value }))}
                />
              </FormField>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

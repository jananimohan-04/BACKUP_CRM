import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Download, Calendar, Clock, Play, CheckCircle2, Layers, Cpu, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { exportCsv } from '@/lib/reportExport';
import { todayISO } from '@/lib/format';
import { AddRunsModal, defaultActualSlot } from './AddRunsModal';
import { fmtTime24, parseYmd, ymd } from '@/lib/operationPlans';
import { generateJobNo } from '@/lib/jobCards';
import { insertTolerant } from '@/lib/partRouting';
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
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [fMachine, setFMachine] = useState('All');
  const [fOperator, setFOperator] = useState('All');
  const [fStatus, setFStatus] = useState('All');

  // Add Run modal state
  const [showAdd, setShowAdd] = useState(false);
  const [slot, setSlot] = useState(defaultActualSlot());
  const [savingAdd, setSavingAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    partKey: '',
    woId: '',
    workOrder: '',
    customer: '',
    partName: '',
    operation: 'Machining',
    machine: '',
    operator: '',
    date: todayISO(),
    startTime: '08:00',
    endTime: '16:00',
    status: 'Completed' as 'Completed' | 'Running',
    qtyPlanned: '',
    qtyCompleted: '',
    qtyRejected: '0',
  });

  const today = todayISO();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [j, w, m, so, inw] = await Promise.all([
        supabase.from('cnc_job_cards').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('cnc_work_orders').select('*'),
        supabase.from('cnc_machines').select('code'),
        supabase.from('cnc_sales_orders').select('*'),
        supabase.from('cnc_inwards').select('*').neq('status', 'Deleted'),
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
  }, [jobs, woMap, search, fDateFrom, fDateTo, fMachine, fOperator, fStatus, now]);

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
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] sticky top-0 z-10 shadow-xs border-b border-slate-200">
              <tr className="text-left">
                <th className="py-2.5 px-3 w-12 text-center">#</th>
                <th className="py-2.5 px-3">Product / Part & Customer</th>
                <th className="py-2.5 px-3">Operation / Process</th>
                <th className="py-2.5 px-3">Machine</th>
                <th className="py-2.5 px-3">Operator</th>
                <th className="py-2.5 px-3">Start Time</th>
                <th className="py-2.5 px-3">End Time</th>
                <th className="py-2.5 px-3">Duration</th>
                <th className="py-2.5 px-3 text-right">Parts Output</th>
                <th className="py-2.5 px-3 text-center">Status</th>
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
                  </tr>
                );
              })}

              {!loading && filteredJobs.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <Calendar size={32} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-600">No actual run records match these filters</p>
                    <p className="text-xs text-slate-400 mt-0.5">Start job cards in Production or log runs in the Actual Timeline</p>
                  </td>
                </tr>
              )}
              {loading && filteredJobs.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400 text-xs">Loading actual run records…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Actual Run Modal */}
      <AddRunsModal open={showAdd} onClose={() => setShowAdd(false)} initial={slot} mode="actual" onSaved={() => { void load(); }} />
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { Card, Badge } from '@/components/ui/Card';
import { Calendar, ChevronLeft, ChevronRight, Plus, User, Settings2, Clock, GripVertical, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { Time24 } from '@/components/ui/Time24';
import { PlannedTimeline } from './PlannedTimeline';
import { ComparisonTimeline } from './ComparisonPage';
import { ActualTimeline } from './ActualPage';
import { ActualListView } from './ActualListView';
import { PlannedListView } from './PlannedListView';
import { formatWorkOrderOption } from '@/lib/workOrderFormat';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';

function ActualScheduling() {
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const [machines, setMachines] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  // Machines as entered in the Process Master (cnc_processes.machine_type) —
  // this is the source for the Schedule Details machine dropdown.
  const [processes, setProcesses] = useState<any[]>([]);
  const [processMachines, setProcessMachines] = useState<string[]>([]);
  const [isNewOperator, setIsNewOperator] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'Day' | 'Week' | 'Month'>('Week');
  
  const [draggedJob, setDraggedJob] = useState<any>(null);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  
  const [showAddJob, setShowAddJob] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [operations, setOperations] = useState<any[]>([]);
  const [opsMissing, setOpsMissing] = useState(false);
  // Work-order customer lookup across ALL orders (scheduling list is filtered).
  const [woCustomerMap, setWoCustomerMap] = useState<Record<string, string>>({});
  const [woIdMap, setWoIdMap] = useState<Record<string, string>>({});
  // Edit / view state for the schedule modal.
  const [editingJob, setEditingJob] = useState<any>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const todayStr = currentDate.toISOString().split('T')[0];
  const [newJobForm, setNewJobForm] = useState({
    workOrder: '', operationId: '', operationSeq: '', processName: '',
    partName: '', partNo: '', customer: '', qty: '',
    machine: '', operator: '', setupTime: '0',
    date: todayStr, startTime: '08:00',
    endDate: todayStr, endTime: '08:00',
    cycleTime: '15'
  });

  // ---- schedule window helpers (no schema change: start is stored in
  // created_at, the block length comes from setup + qty x cycle) ----
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const parseLocal = (d: string, t: string) => new Date(`${d}T${t || '00:00'}`);
  const fmtLocalDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fmtLocalTime = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const formDurationMins = (f: { qty: string; cycleTime: string; setupTime: string }) =>
    (Number(f.setupTime) || 0) + (Number(f.qty) || 0) * (Number(f.cycleTime) || 0);
  // Recompute End = Start + duration. Used whenever the start side changes.
  const withEnd = <T extends { date: string; startTime: string; qty: string; cycleTime: string; setupTime: string; endDate: string; endTime: string }>(f: T): T => {
    if (!f.date || !f.startTime) return f;
    const end = parseLocal(f.date, f.startTime);
    if (isNaN(end.getTime())) return f;
    end.setMinutes(end.getMinutes() + Math.max(0, Math.round(formDurationMins(f))));
    return { ...f, endDate: fmtLocalDate(end), endTime: fmtLocalTime(end) };
  };
  // Manual End edit: keep one source of truth by re-deriving cycle time so the
  // saved block (setup + qty x cycle) exactly covers Start -> End.
  const withEndEdit = <T extends { date: string; startTime: string; qty: string; cycleTime: string; setupTime: string; endDate: string; endTime: string }>(f: T): T => {
    const start = parseLocal(f.date, f.startTime);
    const end = parseLocal(f.endDate, f.endTime);
    const qty = Number(f.qty) || 0;
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && qty > 0) {
      const total = Math.round((end.getTime() - start.getTime()) / 60000);
      if (total > 0) {
        const cycle = Math.max(0, Math.round(((total - (Number(f.setupTime) || 0)) / qty) * 100) / 100);
        return withEnd({ ...f, cycleTime: String(cycle) });
      }
    }
    return f;
  };
  const windowError = (f: { date: string; startTime: string; endDate: string; endTime: string }): string | null => {
    if (!f.date || !f.startTime || !f.endDate || !f.endTime) return 'Set the start and end date/time.';
    const start = parseLocal(f.date, f.startTime);
    const end = parseLocal(f.endDate, f.endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'Set a valid start and end date/time.';
    if (end.getTime() <= start.getTime()) return 'End must be after start.';
    return null;
  };

  const getActiveDates = () => {
    const d = new Date(currentDate);
    if (view === 'Day') {
      return [d];
    } else if (view === 'Week') {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      return Array.from({ length: 7 }).map((_, i) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        return date;
      });
    } else {
      // Month - return 30 days starting from 1st
      const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return Array.from({ length: daysInMonth }).map((_, i) => {
        const date = new Date(firstDay);
        date.setDate(firstDay.getDate() + i);
        return date;
      });
    }
  };

  
  const handleWorkOrderSelect = (woId: string) => {
    const wo = workOrders.find(w => w.wo_no === woId);
    const resetOp = { operationId: '', operationSeq: '', processName: '', setupTime: '0' };
    if (!wo) {
      setNewJobForm(prev => ({
        ...prev, workOrder: '', partName: '', partNo: '', customer: '', qty: '', ...resetOp,
      }));
      return;
    }
    const eligible = eligibleOpsForWO(wo);
    const base = {
      workOrder: wo.wo_no,
      partName: wo.part_name || '',
      partNo: wo.part_no || '',
      customer: wo.customer || '',
      qty: wo.quantity?.toString() || '',
      ...resetOp,
    };
    // Single eligible operation: select it immediately.
    if (eligible.length === 1) {
      setNewJobForm(prev => withEnd({ ...prev, ...base, ...operationPatch(eligible[0], remainingQtyFor(wo, eligible[0])) }));
    } else {
      setNewJobForm(prev => withEnd({ ...prev, ...base }));
    }
  };

  // Patch of auto-filled fields when an operation is chosen. Customer / Product /
  // Process / Sequence stay readonly; Target Qty defaults to the operation plan.
  // Machine comes from the Process Master: the operation's process machine_type.
  const machineTypeForOp = (op: any): string => {
    if (!op) return '';
    const proc = processes.find((p: any) =>
      (op.process_code && p.process_code === op.process_code) ||
      (op.process_name && p.process_name === op.process_name));
    return String(proc?.machine_type ?? '').trim();
  };
  const operationPatch = (op: any, remaining?: number | null) => {
    const fromMaster = machineTypeForOp(op);
    // The operation's own machine wins, then the Process Master machine type; the dropdown always offers the chosen value.
    const machine = [op.machine, fromMaster].map((v: any) => String(v ?? '').trim()).find((v) => v) ?? '';
    return {
      operationId: String(op.id),
      operationSeq: String(op.operation_sequence ?? ''),
      processName: op.process_name || op.process_code || '',
      qty: remaining != null ? String(remaining) : (op.planned_qty != null ? String(op.planned_qty) : ''),
      cycleTime: op.est_cycle_time != null ? String(op.est_cycle_time) : '15',
      setupTime: op.setup_time != null ? String(op.setup_time) : '0',
      machine,
      operator: op.operator || '',
    };
  };

  const handleOperationSelect = (opId: string) => {
    const wo = workOrders.find(w => w.wo_no === newJobForm.workOrder);
    if (!wo) return;
    const op = eligibleOpsForWO(wo).find(o => String(o.id) === opId);
    if (!op) return;
    setNewJobForm(prev => withEnd({ ...prev, ...operationPatch(op, remainingQtyFor(wo, op)) }));
  };

  const openAddJob = () => {
    setIsNewOperator(false);
    setEditingJob(null);
    setViewOnly(false);
    const d = currentDate.toISOString().split('T')[0];
    setNewJobForm(withEnd({
      workOrder: '', operationId: '', operationSeq: '', processName: '',
      partName: '', partNo: '', customer: '', qty: '',
      machine: '', operator: '', setupTime: '0',
      date: d, startTime: '08:00',
      endDate: d, endTime: '08:00',
      cycleTime: '15'
    }));
    setShowAddJob(true);
  };

  // Work orders eligible for scheduling: active flow statuses only. Legacy
  // Completed / Dispatched / Cancelled — and Draft orders awaiting release —
  // never appear here.
  const SCHEDULABLE_WO_STATUSES = ['Released', 'Planned', 'Planning', 'In Progress'];

  // Operation link: cnc_job_cards has no operation_id column (and we must not add
  // one), so a card is linked to its operation by (work_order = wo_no,
  // op_no = operation_sequence * 10) — the same convention the Production release
  // mirror uses. No duplicate scheduling table is created.
  const opNoFor = (op: any) => (Number(op.operation_sequence) || 0) * 10;

  const scheduledOpKeys = new Set(
    jobs.map((j: any) => `${j.work_order}::${Number(j.op_no)}`)
  );

  const selectedWOForForm = workOrders.find(w => w.wo_no === newJobForm.workOrder) || null;

  // An operation can be scheduled more than once (e.g. split over several machines) until its whole planned quantity is
  // on the board. null = no plan quantity, so it stays available.
  const scheduledQtyFor = (woNo: string, opNo: number) =>
    jobs.filter((j: any) => j.work_order === woNo && Number(j.op_no) === opNo).reduce((n: number, j: any) => n + (Number(j.qty_planned) || 0), 0);
  const remainingQtyFor = (wo: any, op: any): number | null => {
    const planned = Number(op?.planned_qty ?? wo?.quantity);
    if (!Number.isFinite(planned) || planned <= 0) return null;
    return Math.max(0, planned - scheduledQtyFor(wo.wo_no, opNoFor(op)));
  };

  const eligibleOpsForWO = (wo: any) => {
    if (!wo) return [];
    return operations
      .filter(op => String(op.work_order_id) === String(wo.id))
      .filter(op => !['Completed', 'Cancelled'].includes(op.status))
      .filter(op => { const r = remainingQtyFor(wo, op); return r === null || r > 0; })
      .sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0));
  };

  // Process Master machine types first, then machines from the Machine master and the current value.
  const machineOptions = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (v: any) => { const t = String(v ?? '').trim(); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); } };
    processMachines.forEach(add);
    machines.forEach((m: any) => add(m.code));
    add(newJobForm.machine);
    return out;
  })();

  // An order with no operations at all can still be scheduled: the job takes a machine (and optionally a process) directly.
  const woHasNoOps = (wo: any) => !!wo && !operations.some(op => String(op.work_order_id) === String(wo.id));

  const schedulableWOs = workOrders.filter(
    wo => SCHEDULABLE_WO_STATUSES.includes(wo.status)
  );

  const closeScheduleModal = () => {
    setShowAddJob(false);
    setEditingJob(null);
    setViewOnly(false);
  };

  // Open the schedule modal for an existing job (edit) or readonly (view).
  const openScheduleModal = (job: any, readonly: boolean) => {
    const op = operations.find(o => String(o.work_order_id) === String(woIdMap[job.work_order]) && opNoFor(o) === Number(job.op_no))
      ?? operations.find(o => opNoFor(o) === Number(job.op_no));
    const start = job.created_at ? new Date(job.created_at) : new Date();
    const startSafe = isNaN(start.getTime()) ? new Date() : start;
    setIsNewOperator(false);
    setNewJobForm(withEnd({
      workOrder: job.work_order || '',
      operationId: op ? String(op.id) : '',
      operationSeq: op ? String(op.operation_sequence ?? '') : '',
      processName: op ? (op.process_name || op.process_code || '') : (job.operation || ''),
      partName: job.part_name || '',
      partNo: workOrders.find(w => w.wo_no === job.work_order)?.part_no || '',
      customer: (job.work_order && woCustomerMap[job.work_order]) || '',
      qty: job.qty_planned != null ? String(job.qty_planned) : '',
      machine: job.machine || '',
      operator: job.operator && job.operator !== '—' && job.operator !== '-' ? job.operator : '',
      setupTime: job.setup_time != null ? String(job.setup_time) : '0',
      date: fmtLocalDate(startSafe),
      startTime: fmtLocalTime(startSafe),
      endDate: '',
      endTime: '',
      cycleTime: job.cycle_time != null ? String(job.cycle_time) : '15',
    }));
    setEditingJob(job);
    setViewOnly(readonly);
    setShowAddJob(true);
  };

  const handleAddJobSubmit = async () => {
    const qtyNum = Number(newJobForm.qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) return alert('Target Quantity must be greater than 0');
    const winErr = windowError(newJobForm);
    if (winErr) return alert(winErr);
    if (saving) return;

    // The operation may have been scheduled elsewhere since the popup opened.
    const d = new Date(newJobForm.date + 'T' + newJobForm.startTime);

    // Edit path: update the existing job card in place.
    if (editingJob && !viewOnly) {
      if (!newJobForm.machine || !newJobForm.date)
        return alert('Please select a Machine and set the Start Date');
      setSaving(true);
      const patch = {
        machine: newJobForm.machine,
        operator: newJobForm.operator || null,
        qty_planned: qtyNum,
        cycle_time: Number(newJobForm.cycleTime) || 0,
        setup_time: Number(newJobForm.setupTime) || 0,
        created_at: d.toISOString(),
      };
      const { error } = await supabase.from('cnc_job_cards').update(patch).eq('id', editingJob.id);
      setSaving(false);
      if (error) {
        alert('Error updating job: ' + error.message);
      } else {
        setSelectedJob({ ...editingJob, ...patch });
        closeScheduleModal();
        fetchData();
      }
      return;
    }

    const wo = workOrders.find(w => w.wo_no === newJobForm.workOrder);
    const direct = woHasNoOps(wo);
    if (!newJobForm.workOrder || (!direct && !newJobForm.operationId) || !newJobForm.machine || !newJobForm.date)
      return alert(direct ? 'Please select a Work Order and Machine, and set the Start Date' : 'Please select a Work Order, Operation and Machine, and set the Start Date');

    const op = direct ? null : operations.find(o => String(o.id) === newJobForm.operationId);
    // The operation may have been scheduled elsewhere since the popup opened.
    if (!direct && !op) return alert('Please choose an operation.');
    if (!direct && op) {
      const left = remainingQtyFor(wo, op);
      if (left !== null && qtyNum > left) return alert(`Only ${left} pcs of this operation are left to schedule.`);
    }
    // An order without operations numbers its jobs itself: 10, 20, 30 ...
    const directOpNo = (Math.max(0, ...jobs.filter((j: any) => j.work_order === newJobForm.workOrder).map((j: any) => Number(j.op_no) || 0)) || 0) + 10;

    // Create new job card, linked to its operation by (work_order, op_no).
    setSaving(true);
    const { error } = await supabase.from('cnc_job_cards').insert([{
      id: crypto.randomUUID(),
      job_no: `JC-${Math.floor(1000 + Math.random() * 9000)}`,
      work_order: newJobForm.workOrder,
      part_name: newJobForm.partName || wo?.part_name || '',
      op_no: op ? opNoFor(op) : directOpNo,
      operation: op ? (op.process_name || op.process_code || 'Machining') : (newJobForm.processName || 'Machining'),
      machine: newJobForm.machine,
      operator: newJobForm.operator || null,
      qty_planned: qtyNum,
      qty_completed: 0,
      qty_rejected: 0,
      cycle_time: Number(newJobForm.cycleTime) || 0,
      setup_time: Number(newJobForm.setupTime) || 0,
      status: 'Planned',
      // cnc_job_cards has no schedule-start column, so the scheduled start is stored in created_at
      created_at: d.toISOString()
    }]);
    setSaving(false);

    if (error) {
      alert('Error saving job: ' + error.message);
    } else {
      closeScheduleModal();
      fetchData();
    }
  };

  const activeDates = getActiveDates();
  
  // Calculate slots per day depending on view
  const getSlots = () => {
    if (view === 'Day') return [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]; // hourly
    if (view === 'Week') return [8, 10, 12, 14, 16]; // 2-hourly
    return [8]; // daily (dropped jobs start at 08:00 so they stay visible in Day/Week views)
  };
  
  const activeSlots = getSlots();

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const [machinesRes, jobsRes] = await Promise.all([
        supabase.from('cnc_machines').select('*').order('code'),
        supabase.from('cnc_job_cards').select('*')
      ]);

      if (machinesRes.error) throw machinesRes.error;
      if (jobsRes.error) throw jobsRes.error;

      setMachines(machinesRes.data || []);
      const jobsData = jobsRes.data || [];
      // Cancelled job cards keep audit history but never occupy the board.
      setJobs(jobsData.filter((j: any) => String(j.status ?? '') !== 'Cancelled'));
      
      // Operators come only from job history (never login users).
      // Skip placeholders like '—'.
      const opNames = new Map<string, string>();
      for (const j of jobsData) {
        const n = String(j.operator ?? '').trim();
        if (n && n !== '—' && n !== '-' && !opNames.has(n.toLowerCase())) opNames.set(n.toLowerCase(), n);
      }
      setOperators(Array.from(opNames.values()).map((name, i) => ({ id: `OP-${i}`, name, role: 'Operator', status: 'Available' })));
      
      const woRes = await supabase.from('cnc_work_orders').select('*').not('status', 'in', '("Completed","Dispatched","Cancelled")');
      if (woRes.error) console.error('Failed to load work orders:', woRes.error);
      if (woRes.data) setWorkOrders(woRes.data);

      // Customer names for Job Details (includes completed orders).
      try {
        const cmapRes = await supabase.from('cnc_work_orders').select('id,wo_no,customer');
        if (!cmapRes.error) {
          const cmap: Record<string, string> = {};
          const imap: Record<string, string> = {};
          for (const w of cmapRes.data ?? []) {
            if (w.wo_no) {
              cmap[w.wo_no] = (w as any).customer ?? '';
              imap[w.wo_no] = String((w as any).id);
            }
          }
          setWoCustomerMap(cmap);
          setWoIdMap(imap);
        }
      } catch (cmapErr) {
        console.error('Failed to load work order customers:', cmapErr);
      }

      // Work order operations from the Production module. Missing table (migration
      // not applied) only disables operation selection — the calendar still works.
      try {
        const opsRes = await supabase.from('cnc_work_order_operations').select('*').order('operation_sequence');
        if (opsRes.error) {
          if ((opsRes.error as any).code === 'PGRST205') setOpsMissing(true);
          else console.error('Failed to load work order operations:', opsRes.error);
          setOperations([]);
        } else {
          setOpsMissing(false);
          setOperations(opsRes.data || []);
        }
      } catch (opErr) {
        console.error('Failed to load work order operations:', opErr);
        setOperations([]);
      }
      // Process Master drives the Machine dropdown (machines are entered there).
      // Missing table only empties the dropdown — the calendar still works.
      try {
        const procRes = await supabase.from('cnc_processes').select('process_code,process_name,machine_type,status').order('process_code');
        if (!procRes.error) {
          const rows = procRes.data ?? [];
          setProcesses(rows);
          const seen = new Set<string>();
          const list: string[] = [];
          for (const p of rows) {
            if ((p.status ?? 'Active') !== 'Active') continue;
            const mt = String(p.machine_type ?? '').trim();
            if (mt && !seen.has(mt.toLowerCase())) { seen.add(mt.toLowerCase()); list.push(mt); }
          }
          setProcessMachines(list.sort((a, b) => a.localeCompare(b)));
        } else {
          setProcesses([]);
          setProcessMachines([]);
        }
      } catch (procErr) {
        console.error('Failed to load process master:', procErr);
        setProcesses([]);
        setProcessMachines([]);
      }
      setDbError(false);
    } catch (err) {
      console.error(err);
      setDbError(true);
    } finally {
      setLoading(false);
    }
  }

  // Calculate duration in hours based on qty and cycle time
  const calculateDurationHours = (job: any) => {
    const qty = Number(job.qty_planned) || 0;
    const cycleMins = Number(job.cycle_time) || 0;
    const setupMins = Number(job.setup_time) || 0;
    const totalMins = setupMins + (qty * cycleMins);
    return Math.max(1, Math.round((totalMins / 60) * 10) / 10);
  };

  // "2 h 30 min" for the scheduled block (setup + qty x cycle time).
  const formatDuration = (job: any) => {
    const mins = Math.round(calculateDurationHours(job) * 60);
    const h = Math.floor(mins / 60), m = mins % 60;
    return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
  };

  // Helper to format date strings
  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  // Scheduled end = start (created_at) + block length (setup + qty x cycle).
  const formatEndTime = (job: any) => {
    if (!job?.created_at) return '-';
    const end = new Date(job.created_at);
    if (isNaN(end.getTime())) return '-';
    end.setMinutes(end.getMinutes() + Math.round(calculateDurationHours(job) * 60));
    return end.toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  };

  // Unscheduled vs Scheduled Jobs. The global date range applies to the job's
  // scheduled start (created_at doubles as the start); All Time changes nothing.
  const isScheduled = (j: any) => j.machine && j.status !== 'Pending' && j.status !== 'New';
  const { inRange: inJobDateRange } = useGlobalDateFilter();
  const rangedJobs = useMemo(() => jobs.filter((j: any) => inJobDateRange(j.created_at)), [jobs, inJobDateRange]);
  const unscheduledJobs = rangedJobs.filter(j => !isScheduled(j));
  const scheduledJobs = rangedJobs.filter(isScheduled);

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, job: any) => {
    setDraggedJob(job);
    e.dataTransfer.setData('text/plain', job.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, machineCode: string, targetDate: Date, slotHour: number) => {
    e.preventDefault();
    if (!draggedJob) return;

    // Create a new start date/time
    const newStart = new Date(targetDate);
    newStart.setHours(slotHour, 0, 0, 0);

    // Keep the job's existing status (only unscheduled jobs become Planned).
    const nextStatus = draggedJob.status && !['Pending', 'New'].includes(draggedJob.status)
      ? draggedJob.status : 'Planned';

    // Optimistically update
    const updatedJobs = jobs.map(j => 
      j.id === draggedJob.id 
        ? { ...j, machine: machineCode, status: nextStatus, created_at: newStart.toISOString() } 
        : j
    );
    setJobs(updatedJobs);
    setDraggedJob(null);

    // Persist to Supabase.
    // NOTE: cnc_job_cards has no schedule-start column (and we must not add one), so the job's
    // scheduled start time is kept in created_at. Rescheduling therefore has to overwrite it.
    try {
      const { error } = await supabase.from('cnc_job_cards').update({
        machine: machineCode,
        status: nextStatus,
        created_at: newStart.toISOString()
      }).eq('id', draggedJob.id);

      if (error) throw error;
      fetchData(); // re-sync
    } catch (err) {
      console.error('Failed to update job schedule', err);
      alert('Error updating schedule. Reverting changes.');
      fetchData();
    }
  };

  // Drop onto an operator row: assign the operator (and move the start, like a machine drop).
  const handleOperatorDrop = async (e: React.DragEvent, operatorName: string, targetDate: Date, slotHour: number) => {
    e.preventDefault();
    if (!draggedJob) return;
    const newStart = new Date(targetDate);
    newStart.setHours(slotHour, 0, 0, 0);
    const nextStatus = draggedJob.status && !['Pending', 'New'].includes(draggedJob.status)
      ? draggedJob.status : 'Planned';
    setJobs(jobs.map(j =>
      j.id === draggedJob.id
        ? { ...j, operator: operatorName, status: nextStatus, created_at: newStart.toISOString() }
        : j
    ));
    setDraggedJob(null);
    try {
      const { error } = await supabase.from('cnc_job_cards').update({
        operator: operatorName,
        status: nextStatus,
        created_at: newStart.toISOString()
      }).eq('id', draggedJob.id);
      if (error) throw error;
      fetchData();
    } catch (err) {
      console.error('Failed to assign operator', err);
      alert('Error assigning operator. Reverting changes.');
      fetchData();
    }
  };

  const statusColors: Record<string, string> = {
    'Planned': 'bg-blue-200 text-blue-800 border-blue-300',
    'In Progress': 'bg-brand-200 text-brand-800 border-brand-300',
    'Setup': 'bg-emerald-200 text-emerald-800 border-emerald-300',
    'Completed': 'bg-purple-200 text-purple-800 border-purple-300',
    'Waiting': 'bg-orange-200 text-orange-800 border-orange-300',
    'Delayed': 'bg-red-200 text-red-800 border-red-300',
    'Maintenance': 'bg-slate-200 text-slate-800 border-slate-300',
    // Job Card module flow (shares this board; fallback stays Planned).
    'Draft': 'bg-slate-200 text-slate-700 border-slate-300',
    'Ready': 'bg-cyan-200 text-cyan-800 border-cyan-300',
    'Scheduled': 'bg-indigo-200 text-indigo-800 border-indigo-300',
    'On Hold': 'bg-amber-200 text-amber-800 border-amber-300',
    'Cancelled': 'bg-slate-200 text-slate-500 border-slate-300',
  };

  const getStatusColor = (status: string) => statusColors[status] || statusColors['Planned'];

  // Board rows follow the Process Master (same source as the dropdown).
  // A row enriches itself from the machine master when the value matches a code.
  const boardMachines = processMachines.map((mt, i) => {
    const m = machines.find((x: any) => x.code === mt)
      ?? machines.find((x: any) => String(x.code ?? '').toLowerCase() === mt.toLowerCase());
    return {
      id: m?.id ?? `PM-${i}`,
      code: mt,
      name: m?.name ?? mt,
      type: m?.type ?? '',
      status: m?.status ?? '',
    };
  });

  // Jobs scheduled on a machine value that no longer matches the Process Master
  // — shown in a fallback row so nothing vanishes.
  const unmappedJobs = scheduledJobs.filter(j => j.machine && !boardMachines.some(m => m.code === j.machine));

  // Shared schedule block for machine rows, the fallback row, and operator rows.
  const renderScheduleBlock = (job: any, date: Date, slotHour: number, slotIdx: number) => {
    const jobDate = new Date(job.created_at);
    if (isNaN(jobDate.getTime())) return null;
    const jDateStr = jobDate.toDateString();
    const dDateStr = date.toDateString();
    const jobHour = jobDate.getHours();

    const hourSpan = view === 'Day' ? 1 : view === 'Week' ? 2 : 24;
    const isMatch = view === 'Month' ? (jDateStr === dDateStr) : (jDateStr === dDateStr && (jobHour >= slotHour && jobHour < slotHour + hourSpan));
    if (!isMatch) return null;

    const dur = calculateDurationHours(job);
    const spanCols = view === 'Month' ? 1 : Math.ceil(dur / hourSpan);
    const pctWidth = spanCols * 100;
    const leftPct = slotIdx * (100 / activeSlots.length);

    return (
      <div
        key={job.id}
        draggable
        onDragStart={(e) => handleDragStart(e, job)}
        onClick={() => setSelectedJob(job)}
        className={`absolute top-1 bottom-1 z-10 ${getStatusColor(job.status)} border rounded p-1.5 text-[10px] sm:text-xs leading-tight overflow-hidden cursor-move shadow-sm hover:shadow-md transition-shadow`}
        style={{ left: `${leftPct}%`, width: view === 'Month' ? 'calc(100% - 4px)' : `calc(${(pctWidth / activeSlots.length)}% - 4px)`, minWidth: view === 'Month' ? 'auto' : '80px' }}
      >
        <div className="font-bold truncate text-[10px] sm:text-xs">{job.work_order || job.job_no}</div>
        {view !== 'Month' && <div className="truncate opacity-90">{job.part_name}</div>}
        {view !== 'Month' && <div className="truncate opacity-80 mt-0.5">{formatTime(job.created_at)} - {Math.round(dur)}h</div>}
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-[calc(100vh-4rem)]">
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Production Scheduling</h1>
          <p className="text-slate-500 text-sm">Plan machines and manpower. Drag and drop jobs to reschedule.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {dbError && <Badge variant="error">Failed to load schedule</Badge>}
          {loading && <Badge variant="neutral">Syncing...</Badge>}
          <div className="flex bg-white rounded-lg border border-slate-200 p-1">
            {['Day', 'Week', 'Month'].map(v => (
              <button 
                key={v}
                onClick={() => setView(v as any)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${view === v ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-white rounded-lg border border-slate-200">
            <button className="p-2 text-slate-600 hover:bg-slate-50 border-r border-slate-200" onClick={() => { const d = new Date(currentDate); if (view === 'Day') d.setDate(d.getDate() - 1); else if (view === 'Week') d.setDate(d.getDate() - 7); else d.setMonth(d.getMonth() - 1); setCurrentDate(d); }}><ChevronLeft size={18} /></button>
            <div className="px-4 py-1.5 text-sm font-medium text-slate-700 min-w-[200px] text-center flex items-center justify-center gap-2">
              <Calendar size={16} className="text-slate-400" />
              {view === 'Day' ? activeDates[0].toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : view === 'Month' ? activeDates[0].toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : `${activeDates[0].toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} - ${activeDates[activeDates.length - 1].toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}
            </div>
            <button className="p-2 text-slate-600 hover:bg-slate-50 border-l border-slate-200" onClick={() => { const d = new Date(currentDate); if (view === 'Day') d.setDate(d.getDate() + 1); else if (view === 'Week') d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + 1); setCurrentDate(d); }}><ChevronRight size={18} /></button>
          </div>

          <Button variant="secondary" className="bg-white" onClick={() => setCurrentDate(new Date())}>Today</Button>
          <Button variant="primary" className="bg-brand-500 hover:bg-brand-600 text-white border-0 shadow-sm" onClick={openAddJob}><Plus size={18} /> Add Job</Button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* MAIN GRID */}
        <div className="flex-1 space-y-6 overflow-hidden">
          
          {/* MACHINES GRID */}
          <Card className="overflow-hidden border border-slate-200 bg-white shadow-sm flex flex-col relative">
            <div className="flex items-center gap-2 p-3 border-b border-slate-200 bg-slate-50">
              <Settings2 size={18} className="text-blue-600" />
              <h2 className="font-bold text-slate-800 text-lg">Machines</h2>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[1200px]">
                {/* Header Row */}
                <div className="flex border-b border-slate-200 bg-white">
                  <div className="w-56 flex-shrink-0 border-r border-slate-200 bg-white sticky left-0 z-20"></div>
                  {activeDates.map(date => (
                    <div key={date.toISOString()} className={`flex-1 flex flex-col ${view === 'Month' ? 'min-w-[60px]' : view === 'Day' ? 'min-w-[1000px]' : 'min-w-[200px]'} border-r border-slate-100 last:border-r-0`}>
                      <div className="py-2 text-center border-b border-slate-100 h-12 flex flex-col justify-center">
                        <div className={`font-semibold text-slate-800 ${view === 'Month' ? 'text-xs' : ''}`}>{date.toLocaleDateString('en-US', { weekday: view === 'Month' ? 'narrow' : 'short' })}</div>
                        {view !== 'Month' && <div className="text-xs text-slate-500">{date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}
                        {view === 'Month' && <div className="text-xs text-slate-500">{date.getDate()}</div>}
                      </div>
                      <div className="flex text-[10px] text-slate-400 font-medium">
                        {view === 'Month' ? (
                           <div className="flex-1 text-center py-1">All Day</div>
                        ) : activeSlots.map(t => (
                          <div key={t} className="flex-1 text-center py-1 border-r border-slate-50 last:border-r-0">{String(t).padStart(2, '0')}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Machine Rows (Process Master machines only) */}
                {boardMachines.length === 0 && unmappedJobs.length === 0 && (
                  <div className="p-6 text-center text-sm text-slate-500">No machines entered in Process Master yet — add a machine type to a process first.</div>
                )}
                {boardMachines.map(machine => (
                  <div key={machine.id} className="flex border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors relative min-h-[70px]">
                    <div className="w-56 flex-shrink-0 p-3 border-r border-slate-200 bg-white sticky left-0 z-10 flex flex-col justify-center">
                      <div className="font-bold text-slate-800">{machine.code}</div>
                      <div className="text-xs text-slate-500">{machine.type ? `${machine.name} - ${machine.type}` : machine.name}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className={`w-2 h-2 rounded-full ${machine.status === 'Running' ? 'bg-emerald-500' : machine.status === 'Maintenance' ? 'bg-amber-500' : 'bg-slate-400'}`}></div>
                        <span className="text-[11px] font-medium text-slate-600">{machine.status}</span>
                      </div>
                    </div>
                    
                    {/* Time Slots for the Machine */}
                    {activeDates.map((date) => (
                      <div key={date.toISOString()} className={`flex-1 flex ${view === 'Month' ? 'min-w-[60px]' : view === 'Day' ? 'min-w-[1000px]' : 'min-w-[200px]'} border-r border-slate-100 last:border-r-0 relative`}>
                        {activeSlots.map((hour, slotIdx) => (
                          <div
                            key={hour}
                            className={`flex-1 border-r border-slate-50 border-dashed last:border-r-0 transition-colors hover:bg-blue-50/50 min-h-[50px] ${view==='Month' ? 'p-1' : ''}`}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, machine.code, date, hour)}
                          >
                            {scheduledJobs
                              .filter(j => j.machine === machine.code)
                              .map(job => renderScheduleBlock(job, date, hour, slotIdx))
                            }
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
                {unmappedJobs.length > 0 && (
                  <div className="flex border-b border-amber-200 last:border-b-0 bg-amber-50/40 relative min-h-[70px]">
                    <div className="w-56 flex-shrink-0 p-3 border-r border-slate-200 bg-white sticky left-0 z-10 flex flex-col justify-center">
                      <div className="font-bold text-amber-800">Other</div>
                      <div className="text-xs text-slate-500">Machine not in master — fix the machine value</div>
                    </div>
                    {activeDates.map((date) => (
                      <div key={date.toISOString()} className={`flex-1 flex ${view === 'Month' ? 'min-w-[60px]' : view === 'Day' ? 'min-w-[1000px]' : 'min-w-[200px]'} border-r border-slate-100 last:border-r-0 relative`}>
                        {activeSlots.map((hour, slotIdx) => (
                          <div
                            key={hour}
                            className={`flex-1 border-r border-slate-50 border-dashed last:border-r-0 transition-colors min-h-[50px] ${view==='Month' ? 'p-1' : ''}`}
                            onDragOver={handleDragOver}
                          >
                            {unmappedJobs.map(job => renderScheduleBlock(job, date, hour, slotIdx))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* OPERATORS GRID */}
          <Card className="overflow-hidden border border-slate-200 bg-white shadow-sm flex flex-col relative">
            <div className="flex items-center gap-2 p-3 border-b border-slate-200 bg-slate-50">
              <User size={18} className="text-purple-600" />
              <h2 className="font-bold text-slate-800 text-lg">Manpower / Operators</h2>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[1200px]">
                {/* Header Row */}
                <div className="flex border-b border-slate-200 bg-white">
                  <div className="w-56 flex-shrink-0 border-r border-slate-200 bg-white sticky left-0 z-20"></div>
                  {activeDates.map(date => (
                    <div key={date.toISOString()} className={`flex-1 flex flex-col ${view === 'Month' ? 'min-w-[60px]' : view === 'Day' ? 'min-w-[1000px]' : 'min-w-[200px]'} border-r border-slate-100 last:border-r-0`}>
                      <div className="py-2 text-center border-b border-slate-100 h-12 flex flex-col justify-center">
                        <div className={`font-semibold text-slate-800 ${view === 'Month' ? 'text-xs' : ''}`}>{date.toLocaleDateString('en-US', { weekday: view === 'Month' ? 'narrow' : 'short' })}</div>
                      </div>
                      <div className="flex text-[10px] text-slate-400 font-medium">
                        {view === 'Month' ? (
                           <div className="flex-1 text-center py-1">All Day</div>
                        ) : activeSlots.map(t => (
                          <div key={t} className="flex-1 text-center py-1 border-r border-slate-50 last:border-r-0">{String(t).padStart(2, '0')}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Operator Rows */}
                {operators.map(op => (
                  <div key={op.id} className="flex border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors relative min-h-[70px]">
                    <div className="w-56 flex-shrink-0 p-3 border-r border-slate-200 bg-white sticky left-0 z-10 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold flex-shrink-0">
                        {op.name.charAt(0)}
                      </div>
                      <div className="flex flex-col justify-center">
                        <div className="font-bold text-slate-800">{op.name}</div>
                        <div className="text-xs text-slate-500">{op.role}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className={`w-2 h-2 rounded-full ${op.status === 'Available' ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                          <span className="text-[11px] font-medium text-slate-600">{op.status}</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Time Slots for Operator */}
                    {activeDates.map((date) => (
                      <div key={date.toISOString()} className={`flex-1 flex ${view === 'Month' ? 'min-w-[60px]' : view === 'Day' ? 'min-w-[1000px]' : 'min-w-[200px]'} border-r border-slate-100 last:border-r-0 relative`}>
                        {activeSlots.map((hour, slotIdx) => (
                          <div
                            key={hour}
                            className="flex-1 border-r border-slate-50 border-dashed last:border-r-0 bg-slate-50/30 min-h-[50px] hover:bg-blue-50/50 transition-colors"
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleOperatorDrop(e, op.name, date, hour)}
                          >
                            {scheduledJobs
                              .filter(j => j.operator === op.name)
                              .map(job => renderScheduleBlock(job, date, hour, slotIdx))
                            }
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* RIGHT SIDEBAR */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-6">
          
          {/* Unscheduled Jobs */}
          <Card className="flex flex-col overflow-hidden max-h-[500px]">
            <div className="p-3 bg-slate-50 border-b border-slate-200 font-semibold text-slate-800 flex justify-between items-center">
              <span>Unscheduled Jobs</span>
              <span className="text-xs font-normal text-slate-500">(Drag to Schedule)</span>
            </div>
            <div className="p-3 overflow-y-auto space-y-3 bg-slate-50/50 flex-1">
              {unscheduledJobs.length === 0 ? (
                <div className="text-center p-4 text-slate-500 text-sm">All eligible jobs are scheduled.</div>
              ) : (
                unscheduledJobs.map(job => (
                  <div 
                    key={job.id} 
                    draggable 
                    onDragStart={(e) => handleDragStart(e, job)}
                    className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm cursor-move hover:border-blue-400 hover:shadow-md transition-all group"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold text-slate-800 text-sm">{job.work_order || job.job_no}</span>
                      <GripVertical size={14} className="text-slate-300 group-hover:text-slate-500" />
                    </div>
                    <div className="text-slate-600 text-sm mb-2 font-medium">{job.part_name}</div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-700">Qty: {job.qty_planned}</span>
                      <span className="flex items-center gap-1"><Clock size={12}/> ~{Math.round(calculateDurationHours(job))} hrs</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Job Details */}
          <Card className="flex flex-col overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 font-semibold text-slate-800">
              Job Details
            </div>
            <div className="p-4 bg-white min-h-[250px]">
              {selectedJob ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-slate-800 text-lg">{selectedJob.work_order || selectedJob.job_no}</h3>
                      <p className="text-slate-600 font-medium">{selectedJob.part_name}</p>
                    </div>
                    <Badge variant={selectedJob.status === 'In Progress' ? 'success' : 'neutral'}>{selectedJob.status}</Badge>
                  </div>
                  
                  <div className="grid grid-cols-[100px_1fr] gap-y-2 text-sm">
                    <span className="text-slate-500">Company</span>
                    <span className="font-medium text-slate-800">: {selectedJob.customer || woCustomerMap[selectedJob.work_order] || workOrders.find(w => w.wo_no === selectedJob.work_order)?.customer || 'Unknown'}</span>
                    
                    <span className="text-slate-500">Quantity</span>
                    <span className="font-medium text-slate-800">: {selectedJob.qty_planned} Nos</span>
                    
                    <span className="text-slate-500">Start Time</span>
                    <span className="font-medium text-slate-800">: {formatTime(selectedJob.created_at)}</span>

                    <span className="text-slate-500">End Time</span>
                    <span className="font-medium text-slate-800">: {formatEndTime(selectedJob)}</span>
                    
                    <span className="text-slate-500">Duration</span>
                    <span className="font-medium text-slate-800">: {formatDuration(selectedJob)}</span>

                    <span className="text-slate-500">Machine</span>
                    <span className="font-medium text-slate-800">: {selectedJob.machine || '-'}</span>
                    
                    <span className="text-slate-500">Operator</span>
                    <span className="font-medium text-slate-800">: {selectedJob.operator || '-'}</span>
                  </div>

                  <div className="pt-3 flex gap-2">
                    <Button variant="primary" className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={() => openScheduleModal(selectedJob, false)}>Edit</Button>
                    <Button variant="secondary" className="flex-1" onClick={() => openScheduleModal(selectedJob, true)}>View</Button>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                  <AlertTriangle size={32} className="opacity-50" />
                  <p className="text-sm text-center px-4">Select a scheduled job to view details</p>
                </div>
              )}
            </div>
          </Card>

          {/* Legend */}
          <Card className="flex flex-col overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 font-semibold text-slate-800">
              Legend
            </div>
            <div className="p-4 grid grid-cols-2 gap-3 bg-white">
              {Object.entries(statusColors).map(([status, color]) => (
                <div key={status} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded border ${color}`}></div>
                  <span className="text-xs font-medium text-slate-600">{status}</span>
                </div>
              ))}
            </div>
          </Card>

        </div>
      </div>

      {/* Add Job Modal */}
      <Modal open={showAddJob} onClose={closeScheduleModal} title={viewOnly ? 'View Scheduled Job' : editingJob ? 'Edit Scheduled Job' : 'Schedule New Job'} size="lg" footer={
        viewOnly ? (
          <Button variant="secondary" onClick={closeScheduleModal}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={closeScheduleModal}>Cancel</Button>
            <Button variant="primary" onClick={handleAddJobSubmit} disabled={saving}>{saving ? 'Saving...' : editingJob ? 'Save Changes' : 'Schedule Operation'}</Button>
          </>
        )
      }>
        <fieldset disabled={viewOnly} className="contents">
        <div className="space-y-4">
          {opsMissing && (
            <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Work order operations are not provisioned yet — apply the work-order-operations migration to schedule specific operations.
            </p>
          )}
          <FormField label="Select Production Order" required>
            <select className={inputClass} value={newJobForm.workOrder} onChange={e => handleWorkOrderSelect(e.target.value)}>
              <option value="">-- Select Order --</option>
              {schedulableWOs.map(wo => (
                <option key={wo.id} value={wo.wo_no}>
                  {formatWorkOrderOption(wo)}
                </option>
              ))}
            </select>
          </FormField>
          {workOrders.length > 0 && schedulableWOs.length === 0 && (
            <p className="text-xs text-slate-500">
              No released / planned work orders with unscheduled operations. Release a Work Order with operations in Production first.
            </p>
          )}
          {(() => {
            const done = selectedWOForForm && !woHasNoOps(selectedWOForForm) && eligibleOpsForWO(selectedWOForForm).length === 0;
            if (!done) return null;
            return (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Every operation of {selectedWOForForm.wo_no} is already scheduled for its full quantity. Edit or remove an existing job to change it.
              </p>
            );
          })()}

          {!woHasNoOps(selectedWOForForm) && (
          <FormField label="Select Operation" required>
            <select
              className={inputClass}
              value={newJobForm.operationId}
              onChange={e => handleOperationSelect(e.target.value)}
              disabled={!newJobForm.workOrder}
            >
              <option value="">-- Select Operation --</option>
              {selectedWOForForm && eligibleOpsForWO(selectedWOForForm).map(op => (
                <option key={op.id} value={op.id}>
                  Seq {op.operation_sequence} - {op.process_name || op.process_code}{op.machine ? ` (${op.machine})` : ''}{selectedWOForForm && remainingQtyFor(selectedWOForForm, op) != null ? ` · ${remainingQtyFor(selectedWOForForm, op)} pcs left` : ''}
                </option>
              ))}
            </select>
          </FormField>
          )}

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Company"><input className={inputClass + ' bg-slate-50'} value={newJobForm.customer} readOnly disabled/></FormField>
            <FormField label="Product"><input className={inputClass + ' bg-slate-50'} value={newJobForm.partName} readOnly disabled/></FormField>
            <FormField label="Process"><input className={inputClass + ' bg-slate-50'} value={newJobForm.processName} readOnly disabled placeholder="Auto-filled from operation"/></FormField>
            <FormField label="Operation Sequence"><input className={inputClass + ' bg-slate-50'} value={newJobForm.operationSeq} readOnly disabled placeholder="Auto-filled from operation"/></FormField>
            <FormField label="Target Quantity" required><input type="number" min="0" className={inputClass} value={newJobForm.qty} onChange={e => setNewJobForm(prev => withEnd({ ...prev, qty: e.target.value }))} /></FormField>
          </div>

          <div className="border-t border-slate-100 my-4 pt-4 font-semibold text-slate-700">Schedule Details</div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Machine" required>
              <select className={inputClass} value={newJobForm.machine} onChange={e => setNewJobForm({...newJobForm, machine: e.target.value})}>
                <option value="">-- Select Machine --</option>
                {machineOptions.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {machineOptions.length === 0 && (
                <p className="text-xs text-slate-500 mt-1">No machines entered in Process Master yet — add a machine type to a process first.</p>
              )}
            </FormField>
            <FormField label="Operator">
              {isNewOperator ? (
                <div className="flex items-center gap-2">
                  <input 
                    autoFocus
                    type="text" 
                    className={inputClass} 
                    placeholder="Enter new operator name" 
                    value={newJobForm.operator} 
                    onChange={e => setNewJobForm({...newJobForm, operator: e.target.value})} 
                  />
                  <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-800 shrink-0 px-2 py-1 bg-slate-100 rounded" onClick={() => { setIsNewOperator(false); setNewJobForm({...newJobForm, operator: ''}); }}>Cancel</button>
                </div>
              ) : (
                <select className={inputClass} value={newJobForm.operator} onChange={e => {
                  if (e.target.value === 'ADD_NEW') {
                    setIsNewOperator(true);
                    setNewJobForm({...newJobForm, operator: ''});
                  } else {
                    setNewJobForm({...newJobForm, operator: e.target.value});
                  }
                }}>
                  <option value="">-- Select Operator --</option>
                  {operators.map(o => (
                    <option key={o.id} value={o.name}>{o.name}</option>
                  ))}
                  <option value="ADD_NEW" className="font-bold text-brand-600 bg-brand-50">+ Add New Operator...</option>
                </select>
              )}
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Start Date & Time" required>
              <div className="flex items-stretch w-full text-sm font-medium rounded border border-slate-300 bg-white text-slate-800 shadow-sm transition-all overflow-hidden focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:border-brand-500">
                <input type="date" aria-label="Start date" className="min-w-0 flex-1 px-3 py-2 bg-transparent focus:outline-none" value={newJobForm.date} onChange={e => setNewJobForm(prev => withEnd({ ...prev, date: e.target.value }))} />
                <div className="w-px bg-slate-300 my-1.5 shrink-0" />
                <Time24 label="Start time" value={newJobForm.startTime} onChange={v => setNewJobForm(prev => withEnd({ ...prev, startTime: v }))} />
              </div>
            </FormField>
            <FormField label="End Date & Time" required>
              <div className="flex items-stretch w-full text-sm font-medium rounded border border-slate-300 bg-white text-slate-800 shadow-sm transition-all overflow-hidden focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:border-brand-500">
                <input type="date" aria-label="End date" className="min-w-0 flex-1 px-3 py-2 bg-transparent focus:outline-none" value={newJobForm.endDate} onChange={e => setNewJobForm(prev => withEndEdit({ ...prev, endDate: e.target.value }))} />
                <div className="w-px bg-slate-300 my-1.5 shrink-0" />
                <Time24 label="End time" value={newJobForm.endTime} onChange={v => setNewJobForm(prev => withEndEdit({ ...prev, endTime: v }))} />
              </div>
            </FormField>
          </div>
            <FormField label="Est. Cycle Time (mins)"><input type="number" className={inputClass} value={newJobForm.cycleTime} onChange={e => setNewJobForm(prev => withEnd({ ...prev, cycleTime: e.target.value }))} /></FormField>
            {windowError(newJobForm) && (
              <p className="text-xs font-medium text-red-600">{windowError(newJobForm)}</p>
            )}
        </div>
        </fieldset>
      </Modal>

    </div>
  );
}

// Scheduling has three views: what is planned, what actually ran, and the two compared.
// Planned is the new timeline; Actual keeps the machine scheduling board for now; Comparison follows.
export function SchedulingPage() {
  const [tab, setTab] = useState<'planned' | 'actual' | 'comparison' | 'board' | 'actual_list' | 'planned_list'>('planned');
  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'planned', label: 'Planned Timeline' }, { id: 'actual', label: 'Actual Timeline' }, { id: 'comparison', label: 'Comparison' }, { id: 'board', label: 'Job Board (Machines & Manpower)' }, { id: 'actual_list', label: 'Actual (List View)' }, { id: 'planned_list', label: 'Planned (List View)' },
  ];
  // Tabs live in the top bar on desktop (same line as date/profile); the local
  // row below stays only for smaller screens. Cleared on unmount.
  const { setTabs } = useHeaderKpis();
  useEffect(() => {
    setTabs(tabs.map(t => ({ label: t.label, active: t.id === tab, onClick: () => setTab(t.id) })));
    return () => setTabs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, setTabs]);
  return (
    <div className="space-y-4">
      <div className="flex lg:hidden gap-1 border-b border-slate-200 overflow-x-auto pb-1" role="tablist">
        {tabs.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-300 hover:text-white'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'planned' && <PlannedTimeline />}
      {tab === 'actual' && <ActualTimeline />}
      {tab === 'comparison' && <ComparisonTimeline />}
      {tab === 'board' && <ActualScheduling />}
      {tab === 'actual_list' && <ActualListView />}
      {tab === 'planned_list' && <PlannedListView />}
    </div>
  );
}

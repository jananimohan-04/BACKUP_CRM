// Job Card: release and manage production operations for shop-floor execution.
// A card always originates from an eligible Work Order Operation (never
// standalone text) and references it via work_order_id / operation_id
// (legacy rows keep the work_order + op_no convention).
//
// Flow: Draft → Ready → Scheduled → In Progress → Completed, with On Hold
// and Cancelled side states. Scheduling-compatible: the scheduled start
// lives in created_at (duration derives from setup + qty × cycle), machine
// assignment flows both ways with the Scheduling board.
// Quantities: Planned / Gross(=good+rejected) / Good / Rejected / Rework /
// Remaining — good and rejected stay separate; only good is downstream-eligible.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatINR } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, FormField, FormSection, inputClass } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { QtyBadge } from '@/components/ui/QuantitySummary';
import { exportCsv, printHtml } from '@/lib/reportExport';
import { downloadBrandedDocument } from '@/lib/brandedDocument';
import { REJECTION_TYPES } from '@/lib/orderQuantities';
import { insertTolerant } from '@/lib/partRouting';
import { formatWorkOrderOption } from '@/lib/workOrderFormat';
import {
  canTransition, durationMins, generateJobNo, grossOf, isActiveCard, isEligibleWO,
  isSelectableOp, recordJobResult, remainingOf, transitionJob, updateJobTolerant,
} from '@/lib/jobCards';
import {
  Plus, Eye, Pencil, Play, Pause, CheckCheck, Ban, Printer, Download, Upload, ClipboardList,
} from 'lucide-react';

const fmt = (n: number) => Number(n || 0).toLocaleString('en-IN');
const dstr = (v: any) => String(v || '').slice(0, 10) || '—';

const statusBadge = (s: string) => {
  const v = String(s ?? '');
  if (v === 'Completed') return 'success';
  if (v === 'In Progress') return 'info';
  if (v === 'On Hold') return 'warning';
  if (v === 'Cancelled') return 'error';
  if (v === 'Scheduled' || v === 'Ready') return 'brand';
  return 'neutral';
};

const endOf = (startIso: any, setupMin: any, qty: any, cycleMin: any): string => {
  if (!startIso) return '—';
  const d = new Date(startIso);
  if (isNaN(d.getTime())) return '—';
  d.setMinutes(d.getMinutes() + Math.round(durationMins(setupMin, qty, cycleMin)));
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
};

export function JobCardsTab({ workOrders }: { workOrders: any[] }) {
  const { company, profile } = useAuth() as any;
  const companyName: string = company?.company_name ?? 'ARGUS CNC';
  const userName: string = profile?.email ?? profile?.full_name ?? '';

  const [jobs, setJobs] = useState<any[]>([]);
  const [operations, setOperations] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [machines, setMachines] = useState<{ code: string; name: string }[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [fStatus, setFStatus] = useState('All');
  const [fMachine, setFMachine] = useState('All');
  const [fOperator, setFOperator] = useState('All');
  const [fProcess, setFProcess] = useState('All');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

  // create
  const [createOpen, setCreateOpen] = useState(false);
  const [woId, setWoId] = useState('');
  const [opId, setOpId] = useState('');
  const [machine, setMachine] = useState('');
  const [operator, setOperator] = useState('');
  const [plannedQty, setPlannedQty] = useState('');
  const [cycleTime, setCycleTime] = useState('');
  const [setupTime, setSetupTime] = useState('');
  const [schedDate, setSchedDate] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [creating, setCreating] = useState(false);

  // detail / edit / result / schedule / cancel
  const [viewId, setViewId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ machine: '', operator: '', plannedQty: '', cycleTime: '', setupTime: '' });
  const [resultOpen, setResultOpen] = useState(false);
  const [result, setResult] = useState({ gross: '', good: '', rejected: '', rework: '', type: '', reason: '', notes: '' });
  const [resultErr, setResultErr] = useState('');
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedForm, setSchedForm] = useState({ machine: '', date: '' });
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [j, o, p, m] = await Promise.all([
        supabase.from('cnc_job_cards').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('cnc_work_order_operations').select('*').order('operation_sequence').limit(5000),
        supabase.from('cnc_processes').select('process_code,process_name,cost_per_hour,cost_per_component,status').limit(1000),
        supabase.from('cnc_machines').select('code,name').order('code').limit(1000),
      ]);
      if (!j.error) setJobs(j.data ?? []);
      if (!o.error) setOperations(o.data ?? []);
      if (!p.error) setProcesses(p.data ?? []);
      if (!m.error) {
        setMachines((m.data ?? []).map((x: any) => ({ code: x.code, name: x.name ?? '' })).filter((x) => x.code));
      } else {
        const m2 = await supabase.from('cnc_machines').select('code').order('code').limit(1000);
        if (!m2.error) setMachines((m2.data ?? []).map((x: any) => ({ code: x.code, name: '' })).filter((x: any) => x.code));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const woByNo = useMemo(() => {
    const map: Record<string, any> = {};
    for (const w of workOrders ?? []) if (w.wo_no) map[String(w.wo_no)] = w;
    return map;
  }, [workOrders]);

  const opsByWoId = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const o of operations) {
      const k = String(o.work_order_id ?? '');
      if (!k) continue;
      if (!map[k]) map[k] = [];
      map[k].push(o);
    }
    return map;
  }, [operations]);

  const operators = useMemo(() => {
    const set = new Map<string, string>();
    for (const j of jobs) {
      const n = String(j.operator ?? '').trim();
      if (n && n !== '—' && n !== '-' && !set.has(n.toLowerCase())) set.set(n.toLowerCase(), n);
    }
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }, [jobs]);

  const machineOpts = useMemo(() => {
    const set = new Map<string, string>();
    for (const m of machines) if (!set.has(m.code)) set.set(m.code, m.name);
    for (const j of jobs) {
      const c = String(j.machine ?? '').trim();
      if (c && !set.has(c)) set.set(c, '');
    }
    return [...set.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
  }, [jobs, machines]);

  const processOpts = useMemo(() => {
    const set = new Map<string, string>();
    for (const j of jobs) {
      const n = String(j.operation ?? '').trim();
      if (n && !set.has(n)) set.set(n, n);
    }
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }, [jobs]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: jobs.length, Ready: 0, Scheduled: 0, 'In Progress': 0, 'On Hold': 0, Completed: 0 };
    for (const j of jobs) {
      const s = String(j.status ?? '');
      if (c[s] !== undefined && s !== 'total') c[s] += 1;
    }
    return c;
  }, [jobs]);

  const filtered = useMemo(() => jobs.filter((j) => {
    if (fStatus !== 'All' && String(j.status ?? '') !== fStatus) return false;
    if (fMachine !== 'All' && String(j.machine ?? '') !== fMachine) return false;
    if (fOperator !== 'All' && String(j.operator ?? '') !== fOperator) return false;
    if (fProcess !== 'All' && String(j.operation ?? '') !== fProcess) return false;
    const d = String(j.created_at || '').slice(0, 10);
    if (fFrom && d < fFrom) return false;
    if (fTo && d > fTo) return false;
    return true;
  }), [jobs, fStatus, fMachine, fOperator, fProcess, fFrom, fTo]);

  // ---------- create ----------
  const eligibleWOs = useMemo(() => (workOrders ?? []).filter((w) => {
    if (!isEligibleWO(w)) return false;
    const ops = opsByWoId[String(w.id)] ?? [];
    if (ops.length === 0) return false;
    const active = jobs.filter((j) => isActiveCard(j) && (String(j.work_order_id ?? '') === String(w.id) || (!j.work_order_id && String(j.work_order ?? '') === String(w.wo_no ?? ''))));
    return ops.some((op) => isSelectableOp(op, active));
  }), [workOrders, opsByWoId, jobs]);

  const selWO = useMemo(() => (workOrders ?? []).find((w) => String(w.id) === String(woId)) ?? null, [workOrders, woId]);
  const selOps = useMemo(() => {
    if (!selWO) return [];
    const ops = opsByWoId[String(selWO.id)] ?? [];
    const active = jobs.filter((j) => isActiveCard(j) && (String(j.work_order_id ?? '') === String(selWO.id) || (!j.work_order_id && String(j.work_order ?? '') === String(selWO.wo_no ?? ''))));
    return ops.map((op) => ({ op, ok: isSelectableOp(op, active) }));
  }, [selWO, opsByWoId, jobs]);

  const selOp = useMemo(() => selOps.find((x) => String(x.op.id) === String(opId))?.op ?? null, [selOps, opId]);

  const openCreate = () => {
    setWoId(''); setOpId(''); setMachine(''); setOperator('');
    setPlannedQty(''); setCycleTime(''); setSetupTime(''); setSchedDate('');
    setCreateErr(''); setCreateOpen(true);
  };

  const onSelectWO = (id: string) => {
    setWoId(id); setOpId('');
    setMachine(''); setOperator(''); setPlannedQty(''); setCycleTime(''); setSetupTime('');
    setCreateErr('');
  };

  const onSelectOp = (id: string) => {
    setOpId(id);
    const op = selOps.find((x) => String(x.op.id) === String(id))?.op;
    if (op && selWO) {
      setMachine(op.machine ?? '');
      setOperator(op.operator ?? '');
      setPlannedQty(String(op.planned_qty ?? selWO.quantity ?? ''));
      setCycleTime(String(op.est_cycle_time ?? ''));
      setSetupTime(String(op.setup_time ?? ''));
    }
    setCreateErr('');
  };

  const doCreate = async () => {
    if (creating) return;
    if (!selWO) { setCreateErr('Select a Work Order.'); return; }
    if (!selOp) { setCreateErr('Select an operation.'); return; }
    const active = jobs.filter((j) => isActiveCard(j));
    if (!isSelectableOp(selOp, active)) { setCreateErr('This operation already has an active Job Card.'); return; }
    const pq = plannedQty.trim() === '' ? Number(selWO.quantity) || 0 : Number(plannedQty);
    if (!Number.isFinite(pq) || pq <= 0) { setCreateErr('Planned Qty must be greater than 0.'); return; }
    setCreating(true);
    try {
      // Re-check duplicates at commit time (double-click / second tab safe).
      const dup = await supabase.from('cnc_job_cards').select('id,job_no')
        .eq('work_order_id', selWO.id).eq('operation_id', selOp.id)
        .not('status', 'in', '("Cancelled","Completed")').limit(1);
      if (!dup.error && (dup.data ?? []).length > 0) {
        setCreateErr(`This operation already has an active Job Card (${(dup.data ?? [])[0].job_no}).`);
        await load();
        return;
      }
      const seq = Number(selOp.operation_sequence) || 0;
      const jobNo = await generateJobNo();
      await insertTolerant('cnc_job_cards', [{
        id: crypto.randomUUID(),
        job_no: jobNo,
        work_order_id: selWO.id,
        operation_id: selOp.id,
        work_order: selWO.wo_no ?? '',
        sales_order_no: selWO.sales_order ?? '',
        customer: selWO.customer ?? '',
        part_name: selWO.part_name ?? selOp.process_name ?? '',
        part_no: selWO.part_no ?? null,
        op_no: seq > 0 ? seq * 10 : 10,
        operation: selOp.process_name || selOp.process_code || 'Machining',
        machine: machine.trim() || selOp.machine || null,
        operator: operator.trim() || selOp.operator || null,
        qty_planned: pq,
        qty_completed: 0,
        qty_rejected: 0,
        rework_qty: 0,
        cycle_time: cycleTime.trim() === '' ? Number(selOp.est_cycle_time) || 0 : Number(cycleTime),
        setup_time: setupTime.trim() === '' ? Number(selOp.setup_time) || 0 : Number(setupTime),
        status: 'Draft',
        created_by: userName || null,
        created_at: schedDate ? new Date(`${schedDate}T08:00:00`).toISOString() : new Date().toISOString(),
      }]);
      setCreateOpen(false);
      await load();
    } catch (e: any) {
      setCreateErr('Unable to create Job Card. No changes were saved. ' + (e?.message ?? e));
    } finally {
      setCreating(false);
    }
  };

  // ---------- transitions ----------
  const act = async (job: any, to: string, patch: Record<string, any> = {}) => {
    if (busy) return;
    if (!canTransition(job?.status, to)) return;
    setBusy(true);
    try {
      const extra: Record<string, any> = { ...patch, updated_by: userName || null };
      if (to === 'In Progress' && !job?.actual_start) extra.actual_start = new Date().toISOString();
      if (to === 'Completed') {
        if (!job?.actual_start) extra.actual_start = new Date().toISOString();
        extra.actual_end = new Date().toISOString();
        extra.completed_at = new Date().toISOString();
      }
      await updateJobTolerant(String(job.id), { status: to, ...extra });
      await load();
      if (viewId === String(job.id)) await loadBatches(String(job.id));
    } catch (e: any) {
      alert('Status change failed: ' + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const loadBatches = async (jobId: string) => {
    try {
      const r = await supabase.from('cnc_production_batches').select('*').eq('job_card_id', jobId).order('created_at');
      if (!r.error) setBatches(r.data ?? []);
      else setBatches([]);
    } catch {
      setBatches([]);
    }
  };

  const openDetail = (id: string) => {
    setViewId(id);
    void loadBatches(id);
  };

  const viewJob = viewId ? jobs.find((j) => String(j.id) === String(viewId)) : null;
  const viewWO = viewJob ? (woByNo[String(viewJob.work_order ?? '')] ?? null) : null;
  const viewOp = viewJob
    ? operations.find((o) => (viewJob.operation_id && String(o.id) === String(viewJob.operation_id))
      || (String(o.work_order_id ?? '') !== '' && String(o.work_order_id) === String(viewWO?.id ?? '') && Number(o.operation_sequence) * 10 === Number(viewJob.op_no)))
    : null;
  const viewProc = viewOp ? processes.find((p) => String(p.id) === String(viewOp.process_id ?? '')) : null;

  // ---------- record result ----------
  const openResult = () => {
    setResult({ gross: '', good: '', rejected: '', rework: '', type: '', reason: '', notes: '' });
    setResultErr('');
    setResultOpen(true);
  };

  const doRecordResult = async () => {
    if (!viewJob || busy) return;
    const g = Number(result.gross), good = Number(result.good), rej = Number(result.rejected), rw = Number(result.rework || 0);
    if (![g, good, rej].every((n) => Number.isFinite(n) && n >= 0) || !(g > 0 || good > 0 || rej > 0)) {
      setResultErr('Enter Gross, Good and Rejected quantities (0 or more, at least one greater than 0).');
      return;
    }
    if (!Number.isFinite(rw) || rw < 0) { setResultErr('Rework must be 0 or more.'); return; }
    if (Math.abs(g - (good + rej)) > 1e-9) { setResultErr(`Gross Produced (${g}) must equal Good (${good}) + Rejected (${rej}).`); return; }
    const planned = Number(viewJob.qty_planned) || 0;
    if (planned > 0 && Number(viewJob.qty_completed) + good > planned) {
      setResultErr(`Good quantity would exceed the planned ${planned} pcs. Record rework/remake separately.`);
      return;
    }
    if (rej > 0 && !result.type) { setResultErr('Select a Rejection Type for the rejected quantity.'); return; }
    if (rej > 0 && !result.reason.trim()) { setResultErr('Enter a Rejection Reason for the rejected quantity.'); return; }
    setBusy(true);
    try {
      await recordJobResult({ ...viewJob, _op: viewOp ? [viewOp] : [] }, viewWO, {
        gross: g, good, rejected: rej, rework: rw,
        rejectionType: result.type, rejectionReason: result.reason.trim(), notes: result.notes.trim(),
      }, userName);
      setResultOpen(false);
      await load();
      await loadBatches(String(viewJob.id));
    } catch (e: any) {
      setResultErr('Unable to record result. ' + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // ---------- schedule ----------
  const openSchedule = (job: any) => {
    setSchedForm({ machine: job.machine ?? '', date: String(job.created_at || '').slice(0, 10) });
    setSchedOpen(true);
  };

  const doSchedule = async () => {
    if (!viewJob || busy) return;
    if (!canTransition(viewJob.status, 'Scheduled')) return;
    if (!schedForm.machine.trim()) { alert('Select a machine.'); return; }
    if (!schedForm.date) { alert('Select a scheduled date.'); return; }
    setBusy(true);
    try {
      await updateJobTolerant(String(viewJob.id), {
        status: 'Scheduled',
        machine: schedForm.machine.trim(),
        created_at: new Date(`${schedForm.date}T08:00:00`).toISOString(),
        updated_by: userName || null,
      });
      setSchedOpen(false);
      await load();
    } catch (e: any) {
      alert('Scheduling failed: ' + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // ---------- edit ----------
  const openEdit = (job: any) => {
    setEditForm({
      machine: job.machine ?? '', operator: job.operator ?? '',
      plannedQty: String(job.qty_planned ?? ''), cycleTime: String(job.cycle_time ?? ''), setupTime: String(job.setup_time ?? ''),
    });
    setEditOpen(true);
  };

  const doEdit = async () => {
    if (!viewJob || busy) return;
    const pq = Number(editForm.plannedQty);
    if (!Number.isFinite(pq) || pq <= 0) { alert('Planned Qty must be greater than 0.'); return; }
    setBusy(true);
    try {
      await updateJobTolerant(String(viewJob.id), {
        machine: editForm.machine.trim() || null,
        operator: editForm.operator.trim() || null,
        qty_planned: pq,
        cycle_time: Number(editForm.cycleTime) || 0,
        setup_time: Number(editForm.setupTime) || 0,
        updated_by: userName || null,
      });
      setEditOpen(false);
      await load();
    } catch (e: any) {
      alert('Edit failed: ' + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // ---------- export / print / pdf ----------
  const exportRows = () => exportCsv(`Job_Cards_${new Date().toISOString().slice(0, 10)}`, [
    ['Job Card No', 'Work Order', 'Sales Order', 'Company', 'Product', 'Seq', 'Process', 'Machine', 'Operator', 'Planned', 'Good', 'Rejected', 'Rework', 'Remaining', 'Status', 'Scheduled Date'],
    ...filtered.map((j) => [j.job_no, j.work_order, j.sales_order_no, j.customer, j.part_name, j.op_no, j.operation, j.machine, j.operator, Number(j.qty_planned) || 0, Number(j.qty_completed) || 0, Number(j.qty_rejected) || 0, Number(j.rework_qty) || 0, remainingOf(j), j.status, j.machine ? dstr(j.created_at) : '']),
  ]);

  const jobPdf = (j: any) => {
    const wo = woByNo[String(j.work_order ?? '')] ?? null;
    const good = Number(j.qty_completed) || 0;
    const rej = Number(j.qty_rejected) || 0;
    return {
      companyName,
      title: 'JOB CARD',
      documentNo: j.job_no,
      date: dstr(j.created_at),
      details: [
        ['Job Card No.', j.job_no], ['Work Order No.', j.work_order || '—'],
        ['Sales Order No.', j.sales_order_no || wo?.sales_order || '—'],
        ['Company', j.customer || wo?.customer || '—'],
        ['Product', j.part_name || '—'], ['Product Code', j.part_no || wo?.part_no || '—'],
      ] as [string, string | number | null | undefined][],
      details2: [
        ['Operation Seq', j.op_no ?? '—'], ['Process', j.operation || '—'],
        ['Machine', j.machine || 'Not Assigned'], ['Operator', j.operator || 'Not Assigned'],
        ['Status', j.status || '—'], ['Scheduled Start', j.machine ? dstr(j.created_at) : '—'],
      ] as [string, string | number | null | undefined][],
      columns: ['Item', 'Value'],
      rows: [
        ['Planned Qty', fmt(Number(j.qty_planned) || 0)],
        ['Cycle Time (min/unit)', String(j.cycle_time ?? 0)],
        ['Setup Time (min)', String(j.setup_time ?? 0)],
        ['Estimated Duration', `${fmt(durationMins(j.setup_time, j.qty_planned, j.cycle_time))} min`],
        ['Gross Produced', fmt(good + rej)],
        ['Good Qty', fmt(good)],
        ['Rejected Qty', fmt(rej)],
        ['Rework Qty', fmt(Number(j.rework_qty) || 0)],
        ['Remaining Qty', fmt(remainingOf(j))],
        ['Rejection Type', j.rejection_type || '—'],
        ['Rejection Reason', j.rejection_reason || '—'],
      ] as (string | number)[][],
      totals: [
        ['Good Progress', `${fmt(good)} / ${fmt(Number(j.qty_planned) || 0)}`],
      ] as [string, string][],
    };
  };

  const printJob = (j: any) => {
    const p = jobPdf(j);
    const row = (k: string, v: any) => `<tr><td>${k}</td><td>${v ?? '—'}</td></tr>`;
    printHtml(`Job Card - ${j.job_no}`, `
      <h2>${companyName} — JOB CARD ${j.job_no}</h2>
      <p>Status: ${j.status || ''} | Date: ${dstr(j.created_at)}</p>
      <table><tbody>${p.details.map(([k, v]) => row(k, v)).join('')}</tbody></table>
      <table><tbody>${(p.details2 ?? []).map(([k, v]) => row(k, v)).join('')}</tbody></table>
      <table><thead><tr><th>Item</th><th>Value</th></tr></thead><tbody>${p.rows.map((r) => row(String(r[0]), r[1])).join('')}</tbody></table>
      <h3>Approval / Signatures</h3>
      <table><tbody>${row('Prepared By', '')}${row('Operator', '')}${row('Supervisor', '')}${row('Date', '')}${row('Signature', '')}</tbody></table>`);
  };

  const columns: Column<any>[] = [
    { key: 'job_no', label: 'Job Card No.', sortable: true, render: (r) => <button className="font-mono text-xs font-bold text-brand-700 hover:underline" onClick={() => openDetail(String(r.id))}>{r.job_no}</button> },
    { key: 'work_order', label: 'Work Order No.', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-600">{r.work_order || '—'}</span> },
    { key: 'sales_order_no', label: 'Sales Order No.', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-500">{r.sales_order_no || '—'}</span> },
    { key: 'customer', label: 'Company', sortable: true, render: (r) => <span className="text-xs">{r.customer || '—'}</span> },
    { key: 'part_name', label: 'Product', sortable: true, render: (r) => <span className="text-xs font-medium">{r.part_name || '—'}</span> },
    { key: 'op_no', label: 'Seq', sortable: true, align: 'right', render: (r) => <span className="font-mono text-xs">{r.op_no ?? '—'}</span> },
    { key: 'operation', label: 'Process', sortable: true, render: (r) => <span className="text-xs">{r.operation || '—'}</span> },
    { key: 'machine', label: 'Machine', sortable: true, render: (r) => <span className="font-mono text-xs">{r.machine || '—'}</span> },
    { key: 'operator', label: 'Operator', sortable: true, render: (r) => <span className="text-xs">{r.operator || 'Not Assigned'}</span> },
    { key: 'qty_planned', label: 'Planned', sortable: true, align: 'right', render: (r) => <span className="text-xs tabular-nums">{fmt(Number(r.qty_planned) || 0)}</span> },
    { key: 'qty_completed', label: 'Good', sortable: true, align: 'right', render: (r) => <span className="text-xs tabular-nums font-semibold text-emerald-700">{fmt(Number(r.qty_completed) || 0)}</span> },
    { key: 'qty_rejected', label: 'Rejected', sortable: true, align: 'right', render: (r) => <span className="text-xs tabular-nums font-semibold text-rose-600">{fmt(Number(r.qty_rejected) || 0)}</span> },
    {
      key: '__remaining', label: 'Remaining', sortable: false, align: 'right',
      render: (r) => <span className="text-xs tabular-nums">{fmt(remainingOf(r))}</span>,
    },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={statusBadge(r.status) as any} dot>{r.status || '—'}</Badge> },
    { key: 'created_at', label: 'Scheduled Date', sortable: true, render: (r) => <span className="text-xs">{r.machine ? dstr(r.created_at) : '—'}</span> },
    {
      key: '__actions', label: 'Actions', align: 'right',
      render: (r) => {
        const s = String(r.status ?? '');
        return (
          <span className="inline-flex items-center gap-1">
            <button title="View" onClick={() => openDetail(String(r.id))} className="p-1 text-slate-400 hover:text-brand-600"><Eye size={15} /></button>
            {canTransition(s, 'Ready') && <button title="Mark Ready" onClick={() => void act(r, 'Ready')} className="p-1 text-slate-400 hover:text-emerald-600"><CheckCheck size={15} /></button>}
            {canTransition(s, 'Scheduled') && s !== 'Ready' && <button title="Schedule" onClick={() => { setViewId(String(r.id)); openSchedule(r); }} className="p-1 text-slate-400 hover:text-blue-600"><ClipboardList size={15} /></button>}
            {canTransition(s, 'In Progress') && <button title="Start" onClick={() => void act(r, 'In Progress')} className="p-1 text-slate-400 hover:text-emerald-600"><Play size={15} /></button>}
            {canTransition(s, 'On Hold') && s === 'In Progress' && <button title="Hold" onClick={() => void act(r, 'On Hold')} className="p-1 text-slate-400 hover:text-amber-600"><Pause size={15} /></button>}
            {s === 'On Hold' && <button title="Resume" onClick={() => void act(r, r.actual_start ? 'In Progress' : 'Scheduled')} className="p-1 text-slate-400 hover:text-emerald-600"><Play size={15} /></button>}
            {canTransition(s, 'Completed') && <button title="Complete" onClick={() => void act(r, 'Completed')} className="p-1 text-slate-400 hover:text-violet-600"><CheckCheck size={15} /></button>}
          </span>
        );
      },
    },
  ];

  const stats: [string, number, string][] = [
    ['Total Job Cards', counts.total, 'text-slate-800'],
    ['Ready', counts.Ready, 'text-blue-700'],
    ['Scheduled', counts.Scheduled, 'text-brand-700'],
    ['In Progress', counts['In Progress'], 'text-violet-700'],
    ['On Hold', counts['On Hold'], 'text-amber-700'],
    ['Completed', counts.Completed, 'text-emerald-700'],
  ];

  return (
    <div className="p-4">
      <PageHeader
        title="Job Card"
        description="Release and manage production operations for shop-floor execution."
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Upload size={14} />} onClick={exportRows}>Export CSV</Button>
            <Button icon={<Plus size={14} />} onClick={openCreate}>Create Job Card</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-3">
        {stats.map(([label, v, cls]) => (
          <Card key={label} className="p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
            <div className={`font-bold text-xl tabular-nums ${cls}`}>{v}</div>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-3 mb-3">
        <FormField label="Status">
          <select className={inputClass} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="All">All Statuses</option>
            {Array.from(new Set(jobs.map((j) => String(j.status ?? '')))).filter(Boolean).sort().map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="Machine">
          <select className={inputClass} value={fMachine} onChange={(e) => setFMachine(e.target.value)}>
            <option value="All">All Machines</option>
            {machineOpts.map((m) => <option key={m.code} value={m.code}>{m.code}{m.name ? ` — ${m.name}` : ''}</option>)}
          </select>
        </FormField>
        <FormField label="Operator">
          <select className={inputClass} value={fOperator} onChange={(e) => setFOperator(e.target.value)}>
            <option value="All">All Operators</option>
            {operators.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </FormField>
        <FormField label="Process">
          <select className={inputClass} value={fProcess} onChange={(e) => setFProcess(e.target.value)}>
            <option value="All">All Processes</option>
            {processOpts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </FormField>
        <FormField label="From"><input type="date" className={inputClass} value={fFrom} onChange={(e) => setFFrom(e.target.value)} /></FormField>
        <FormField label="To"><input type="date" className={inputClass} value={fTo} onChange={(e) => setFTo(e.target.value)} /></FormField>
      </div>
      {loading ? (
        <Card className="p-12 text-center text-sm text-slate-500">Loading job cards…</Card>
      ) : jobs.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm font-semibold text-slate-700">No Job Cards yet.</p>
          <p className="text-xs text-slate-500 mt-1 mb-4">Release one from an eligible work order operation.</p>
          <Button icon={<Plus size={14} />} onClick={openCreate}>Create Job Card</Button>
        </Card>
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          searchKeys={['job_no', 'work_order', 'sales_order_no', 'customer', 'part_name', 'operation']}
          title="Job Cards"
        />
      )}

      {/* ---------- create ---------- */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Job Card"
        subtitle="From an eligible work order operation — never standalone"
        size="2xl"
        footer={
          <>
            <span className="flex-1" />
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button icon={<Plus size={14} />} disabled={creating} onClick={() => void doCreate()}>
              {creating ? 'Creating…' : 'Create Job Card'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {eligibleWOs.length === 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No eligible Work Order operations are available for Job Card creation.
            </p>
          )}
          <FormSection title="Work Order & Operation">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FormField label="Select Work Order" required>
                <select className={inputClass} value={woId} onChange={(e) => onSelectWO(e.target.value)}>
                  <option value="">Choose work order…</option>
                  {eligibleWOs.map((w) => (
                    <option key={w.id} value={w.id}>
                      {formatWorkOrderOption(w)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Select Operation" required>
                <select className={inputClass} value={opId} disabled={!selWO} onChange={(e) => onSelectOp(e.target.value)}>
                  <option value="">{selWO ? 'Choose operation…' : 'Select a work order first'}</option>
                  {selOps.filter((x) => x.ok).map(({ op }) => (
                    <option key={op.id} value={op.id}>
                      Seq {op.operation_sequence} – {op.process_name || op.process_code}
                    </option>
                  ))}
                  {selOps.filter((x) => !x.ok).map(({ op }) => (
                    <option key={op.id} value={op.id} disabled>
                      Seq {op.operation_sequence} – {op.process_name || op.process_code} (has active card)
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </FormSection>
          {selOp && selWO && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                {[
                  ['Company', selWO.customer || '—'], ['Product', selWO.part_name || '—'],
                  ['Product Code', selWO.part_no || '—'], ['Sales Order', selWO.sales_order || '—'],
                  ['Work Order', selWO.wo_no || '—'],
                  ['Sequence', `Seq ${selOp.operation_sequence}`],
                  ['Process', selOp.process_name || selOp.process_code || '—'],
                  ['Process Code', selOp.process_code || '—'],
                ].map(([k, v]) => (
                  <div key={k}><p className="text-[10px] uppercase tracking-wider text-slate-400">{k}</p><p className="font-semibold">{v}</p></div>
                ))}
              </div>
              <FormSection title="Execution Plan">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <FormField label="Machine">
                    <select className={inputClass} value={machine} onChange={(e) => setMachine(e.target.value)}>
                      <option value="">Not assigned yet</option>
                      {machineOpts.map((m) => <option key={m.code} value={m.code}>{m.code}{m.name ? ` — ${m.name}` : ''}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Operator">
                    <input className={inputClass} value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="Not Assigned" list="jc-operator-list" />
                    <datalist id="jc-operator-list">{operators.map((o) => <option key={o} value={o} />)}</datalist>
                  </FormField>
                  <FormField label="Planned Qty" required>
                    <input type="number" min={1} className={inputClass} value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} />
                  </FormField>
                  <FormField label="Cycle Time (min/unit)">
                    <input type="number" min={0} step={0.1} className={inputClass} value={cycleTime} onChange={(e) => setCycleTime(e.target.value)} />
                  </FormField>
                  <FormField label="Setup Time (min)">
                    <input type="number" min={0} step={0.5} className={inputClass} value={setupTime} onChange={(e) => setSetupTime(e.target.value)} />
                  </FormField>
                  <FormField label="Scheduled Date">
                    <input type="date" className={inputClass} value={schedDate} onChange={(e) => setSchedDate(e.target.value)} />
                  </FormField>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Estimated duration: {fmt(durationMins(setupTime || selOp.setup_time, plannedQty || selWO.quantity, cycleTime || selOp.est_cycle_time))} min ·
                  Job number auto-generates on save.
                </p>
              </FormSection>
            </>
          )}
          {createErr && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{createErr}</p>}
        </div>
      </Modal>

      {/* ---------- detail ---------- */}
      <Modal
        open={!!viewJob}
        onClose={() => setViewId(null)}
        title={viewJob ? `JOB CARD ${viewJob.job_no}` : 'Job Card'}
        subtitle={viewJob ? `${viewJob.work_order || ''} · ${viewJob.part_name || ''}` : ''}
        size="3xl"
        footer={
          viewJob ? (
            <>
              <Button variant="secondary" icon={<Printer size={14} />} onClick={() => printJob(viewJob)}>Print</Button>
              <Button variant="secondary" icon={<Download size={14} />} onClick={() => { downloadBrandedDocument(jobPdf(viewJob)).catch((e: any) => alert(e?.message ?? e)); }}>PDF</Button>
              <span className="flex-1" />
              {['Draft', 'Ready', 'Planned', 'Pending', 'New'].includes(String(viewJob.status ?? '')) && (
                <Button variant="secondary" icon={<Pencil size={14} />} onClick={() => openEdit(viewJob)}>Edit</Button>
              )}
              {canTransition(viewJob.status, 'Ready') && (
                <Button variant="secondary" icon={<CheckCheck size={14} />} disabled={busy} onClick={() => void act(viewJob, 'Ready')}>Mark Ready</Button>
              )}
              {canTransition(viewJob.status, 'Scheduled') && (
                <Button variant="secondary" icon={<ClipboardList size={14} />} onClick={() => openSchedule(viewJob)}>Schedule</Button>
              )}
              {canTransition(viewJob.status, 'In Progress') && (
                <Button icon={<Play size={14} />} disabled={busy} onClick={() => void act(viewJob, 'In Progress')}>Start</Button>
              )}
              {String(viewJob.status) === 'In Progress' && (
                <>
                  <Button variant="secondary" icon={<Pause size={14} />} disabled={busy} onClick={() => void act(viewJob, 'On Hold')}>Hold</Button>
                  <Button variant="secondary" onClick={openResult}>Record Result</Button>
                  <Button icon={<CheckCheck size={14} />} disabled={busy} onClick={() => void act(viewJob, 'Completed')}>Complete</Button>
                </>
              )}
              {String(viewJob.status) === 'On Hold' && (
                <Button icon={<Play size={14} />} disabled={busy} onClick={() => void act(viewJob, viewJob.actual_start ? 'In Progress' : 'Scheduled')}>Resume</Button>
              )}
              {canTransition(viewJob.status, 'Cancelled') && (
                <Button variant="secondary" icon={<Ban size={14} />} onClick={() => setCancelTarget(viewJob)}>Cancel</Button>
              )}
              <Button variant="secondary" onClick={() => setViewId(null)}>Close</Button>
            </>
          ) : undefined
        }
      >
        {viewJob && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusBadge(viewJob.status) as any} dot>{viewJob.status || '—'}</Badge>
              <span className="text-xs text-slate-500">
                Created {dstr(viewJob.created_at)}{viewJob.created_by ? ` by ${viewJob.created_by}` : ''}
                {viewJob.actual_start ? ` · Started ${dstr(viewJob.actual_start)}` : ''}
                {viewJob.completed_at ? ` · Completed ${dstr(viewJob.completed_at)}` : ''}
              </span>
            </div>
            <FormSection title="Section 1 — Job Information">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                {[
                  ['Job Card No.', viewJob.job_no], ['Work Order No.', viewJob.work_order || '—'],
                  ['Sales Order No.', viewJob.sales_order_no || viewWO?.sales_order || '—'],
                  ['Company', viewJob.customer || viewWO?.customer || '—'],
                  ['Product', viewJob.part_name || '—'], ['Product Code', viewJob.part_no || viewWO?.part_no || '—'],
                ].map(([k, v]) => (
                  <div key={k}><p className="text-[10px] uppercase tracking-wider text-slate-400">{k}</p><p className="font-semibold">{v}</p></div>
                ))}
              </div>
            </FormSection>
            <FormSection title="Section 2 — Operation">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {[
                  ['Operation Sequence', `Seq ${viewJob.op_no ?? '—'}`],
                  ['Process Code', viewOp?.process_code || viewProc?.processCode || '—'],
                  ['Process Name', viewJob.operation || '—'],
                  ['Machine', viewJob.machine || 'Not Assigned'],
                  ['Operator', viewJob.operator || 'Not Assigned'],
                ].map(([k, v]) => (
                  <div key={k}><p className="text-[10px] uppercase tracking-wider text-slate-400">{k}</p><p className="font-semibold">{v}</p></div>
                ))}
              </div>
              {viewOp && (
                <p className="text-[11px] text-slate-400 mt-2">
                  Work order operation recorded: completed {fmt(Number(viewOp.completed_qty) || 0)} · rejected {fmt(Number(viewOp.rejected_qty) || 0)} (reference only — card actuals below are authoritative for this card).
                </p>
              )}
            </FormSection>
            <FormSection title="Section 3 — Planning">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {[
                  ['Planned Qty', `${fmt(Number(viewJob.qty_planned) || 0)} pcs`],
                  ['Cycle Time', `${viewJob.cycle_time ?? 0} min/unit`],
                  ['Setup Time', `${viewJob.setup_time ?? 0} min`],
                  ['Estimated Duration', `${fmt(durationMins(viewJob.setup_time, viewJob.qty_planned, viewJob.cycle_time))} min`],
                  ['Scheduled Start', viewJob.machine ? dstr(viewJob.created_at) : '—'],
                  ['Scheduled End', viewJob.machine ? endOf(viewJob.created_at, viewJob.setup_time, viewJob.qty_planned, viewJob.cycle_time) : '—'],
                  ['Actual Start', viewJob.actual_start ? new Date(viewJob.actual_start).toLocaleString('en-IN', { hour12: false }) : '—'],
                  ['Actual End', viewJob.actual_end ? new Date(viewJob.actual_end).toLocaleString('en-IN', { hour12: false }) : '—'],
                ].map(([k, v]) => (
                  <div key={k}><p className="text-[10px] uppercase tracking-wider text-slate-400">{k}</p><p className="font-semibold tabular-nums">{v}</p></div>
                ))}
              </div>
            </FormSection>
            <FormSection title="Section 4 — Quantity">
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                <QtyBadge label="Planned" value={fmt(Number(viewJob.qty_planned) || 0)} tone="blue" />
                <QtyBadge label="Gross" value={fmt(grossOf(viewJob))} tone="slate" />
                <QtyBadge label="Good" value={fmt(Number(viewJob.qty_completed) || 0)} tone="emerald" />
                <QtyBadge label="Rejected" value={fmt(Number(viewJob.qty_rejected) || 0)} tone="rose" />
                <QtyBadge label="Rework" value={fmt(Number(viewJob.rework_qty) || 0)} tone="amber" />
                <QtyBadge label="Remaining" value={fmt(remainingOf(viewJob))} tone="violet" />
              </div>
              <div className="mt-2">
                <div className="flex justify-between text-[10px] font-semibold text-slate-500 mb-0.5">
                  <span>{fmt(Number(viewJob.qty_completed) || 0)} / {fmt(Number(viewJob.qty_planned) || 0)} good</span>
                  <span className="tabular-nums">{Number(viewJob.qty_planned) > 0 ? Math.round((Number(viewJob.qty_completed) / Number(viewJob.qty_planned)) * 100) : 0}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-200/70 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Number(viewJob.qty_planned) > 0 ? Math.min(100, (Number(viewJob.qty_completed) / Number(viewJob.qty_planned)) * 100) : 0}%` }} />
                </div>
              </div>
              {(viewJob.rejection_type || viewJob.rejection_reason) && (
                <p className="text-xs text-slate-600 mt-2">
                  Rejection: <b>{viewJob.rejection_type || '—'}</b>{viewJob.rejection_reason ? ` — ${viewJob.rejection_reason}` : ''}{viewJob.rejection_notes ? ` (${viewJob.rejection_notes})` : ''}
                </p>
              )}
              {batches.length > 0 && (
                <div className="mt-2 space-y-1">
                  {batches.map((b: any) => (
                    <div key={b.id} className="flex flex-wrap gap-x-3 text-xs border-t border-slate-100 pt-1">
                      <span className="font-mono font-semibold">{b.batch_no}</span>
                      <span>Good <b className="tabular-nums">{fmt(Number(b.good_qty))}</b></span>
                      <span>Rejected <b className="tabular-nums">{fmt(Number(b.rejected_qty))}</b></span>
                      {b.rejection_type && <span className="text-slate-500">{b.rejection_type}</span>}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-2">Rejected quantity never becomes Finished Goods, DC or invoice quantity — only good quantity moves downstream.</p>
            </FormSection>
          </div>
        )}
      </Modal>

      {/* ---------- edit (Draft / Ready only) ---------- */}
      <Modal
        open={editOpen} onClose={() => setEditOpen(false)} title="Edit Job Card" subtitle={viewJob?.job_no ?? ''} size="lg"
        footer={<><span className="flex-1" /><Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void doEdit()}>Save Changes</Button></>}
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Machine">
            <select className={inputClass} value={editForm.machine} onChange={(e) => setEditForm({ ...editForm, machine: e.target.value })}>
              <option value="">Not assigned yet</option>
              {machineOpts.map((m) => <option key={m.code} value={m.code}>{m.code}{m.name ? ` — ${m.name}` : ''}</option>)}
            </select>
          </FormField>
          <FormField label="Operator">
            <input className={inputClass} value={editForm.operator} onChange={(e) => setEditForm({ ...editForm, operator: e.target.value })} placeholder="Not Assigned" list="jc-edit-operator-list" />
            <datalist id="jc-edit-operator-list">{operators.map((o) => <option key={o} value={o} />)}</datalist>
          </FormField>
          <FormField label="Planned Qty" required>
            <input type="number" min={1} className={inputClass} value={editForm.plannedQty} onChange={(e) => setEditForm({ ...editForm, plannedQty: e.target.value })} />
          </FormField>
          <FormField label="Cycle Time (min/unit)">
            <input type="number" min={0} step={0.1} className={inputClass} value={editForm.cycleTime} onChange={(e) => setEditForm({ ...editForm, cycleTime: e.target.value })} />
          </FormField>
          <FormField label="Setup Time (min)">
            <input type="number" min={0} step={0.5} className={inputClass} value={editForm.setupTime} onChange={(e) => setEditForm({ ...editForm, setupTime: e.target.value })} />
          </FormField>
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Planned values only. Production results are recorded via Record Result, never by editing history.</p>
      </Modal>

      {/* ---------- record result ---------- */}
      <Modal
        open={resultOpen} onClose={() => setResultOpen(false)} title="Record Production Result" subtitle={viewJob ? `${viewJob.job_no} · incremental to current totals` : ''} size="lg"
        footer={<><span className="flex-1" /><Button variant="secondary" onClick={() => setResultOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void doRecordResult()}>{busy ? 'Saving…' : 'Save Result'}</Button></>}
      >
        {viewJob && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Current totals — Good <b className="tabular-nums">{fmt(Number(viewJob.qty_completed) || 0)}</b> ·
              Rejected <b className="tabular-nums">{fmt(Number(viewJob.qty_rejected) || 0)}</b> ·
              Planned <b className="tabular-nums">{fmt(Number(viewJob.qty_planned) || 0)}</b>. Enter this recording only; totals accumulate.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <FormField label="Gross Produced *" required><input type="number" min={0} className={inputClass} value={result.gross} onChange={(e) => setResult({ ...result, gross: e.target.value })} /></FormField>
              <FormField label="Good Qty *" required><input type="number" min={0} className={inputClass} value={result.good} onChange={(e) => setResult({ ...result, good: e.target.value })} /></FormField>
              <FormField label="Rejected Qty"><input type="number" min={0} className={inputClass} value={result.rejected} onChange={(e) => setResult({ ...result, rejected: e.target.value })} /></FormField>
              <FormField label="Rework Qty"><input type="number" min={0} className={inputClass} value={result.rework} onChange={(e) => setResult({ ...result, rework: e.target.value })} /></FormField>
              <FormField label="Rejection Type *"><select className={inputClass} value={result.type} onChange={(e) => setResult({ ...result, type: e.target.value })}><option value="">Select…</option>{REJECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></FormField>
              <div className="col-span-2 md:col-span-3"><FormField label="Rejection Reason *"><input className={inputClass} value={result.reason} onChange={(e) => setResult({ ...result, reason: e.target.value })} placeholder="e.g. Oversize by 0.05mm" /></FormField></div>
              <div className="col-span-2 md:col-span-4"><FormField label="Notes"><input className={inputClass} value={result.notes} onChange={(e) => setResult({ ...result, notes: e.target.value })} placeholder="Optional notes" /></FormField></div>
            </div>
            <p className="text-[11px] text-slate-400">Gross must equal Good + Rejected. Rejected stays traceable and never enters FG stock, DCs or invoices.</p>
            {resultErr && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{resultErr}</p>}
          </div>
        )}
      </Modal>

      {/* ---------- schedule ---------- */}
      <Modal
        open={schedOpen} onClose={() => setSchedOpen(false)} title="Schedule Job Card" subtitle={viewJob?.job_no ?? ''} size="lg"
        footer={<><span className="flex-1" /><Button variant="secondary" onClick={() => setSchedOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void doSchedule()}>Schedule</Button></>}
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Machine" required>
            <select className={inputClass} value={schedForm.machine} onChange={(e) => setSchedForm({ ...schedForm, machine: e.target.value })}>
              <option value="">Select machine…</option>
              {machineOpts.map((m) => <option key={m.code} value={m.code}>{m.code}{m.name ? ` — ${m.name}` : ''}</option>)}
            </select>
          </FormField>
          <FormField label="Scheduled Date" required>
            <input type="date" className={inputClass} value={schedForm.date} onChange={(e) => setSchedForm({ ...schedForm, date: e.target.value })} />
          </FormField>
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Scheduling uses the existing board relationship — the card appears on Scheduling positioned by this date. No duplicate schedule is created.</p>
      </Modal>

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={async () => {
          if (!cancelTarget || busy) return;
          setBusy(true);
          try {
            await transitionJob(cancelTarget, 'Cancelled', userName);
            setCancelTarget(null);
            if (viewId === String(cancelTarget.id)) setViewId(null);
            await load();
          } catch (e: any) {
            alert('Cancel failed: ' + (e?.message ?? e));
          } finally {
            setBusy(false);
          }
        }}
        title="Cancel this Job Card?"
        message={cancelTarget ? `${cancelTarget.job_no} · ${cancelTarget.work_order || ''} · Seq ${cancelTarget.op_no ?? ''} · ${cancelTarget.part_name || ''}. The record is kept for audit history.` : ''}
        confirmLabel="Cancel Job Card"
        danger
      />
    </div>
  );
}

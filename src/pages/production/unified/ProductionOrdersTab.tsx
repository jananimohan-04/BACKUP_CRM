import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/format';
import { Badge, Button, ProgressBar, statusToVariant, priorityToVariant } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, FormField, FormSection, inputClass } from '@/components/ui/Modal';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import {
  Plus, Eye, Pencil, X, ChevronUp, ChevronDown, Trash2, GitBranch,
} from 'lucide-react';
import { WorkOrderDetail } from './WorkOrderDetail';
import { fetchActiveRouting } from '@/lib/partRouting';
import { PlanEditor } from './PlanEditor';
import { emptyPlan, expandPlan, isMissingTable, planError, planFromRows, planIsBlank, type PlanDraft } from '@/lib/operationPlans';

export const WO_STATUSES = ['Draft', 'Planned', 'Released', 'In Progress', 'Completed', 'On Hold', 'Cancelled'];
// Rows created by older screens / other modules keep working (shown as-is).
const LEGACY_PLANNED = ['Planning', 'Planned'];
const EDITABLE_STATUSES = ['Draft', 'Planned', 'Planning'];

export interface OpDraft {
  key: string;
  processId: string;
  machine: string;
  plannedQty: string;
  cycleTime: string;
  setupTime: string;
  operator: string;
  /** Planned timeline of this operation: date range + time slots per day (optional). */
  plan?: PlanDraft;
  /** An existing plan that is not one regular range: kept untouched on save (edit it in Scheduling -> Planned). */
  planLocked?: boolean;
  /** Sequence of this operation when the order was opened, to carry its plan over if the order is re-sequenced. */
  origSeq?: number;
}

interface WOForm {
  salesOrderId: string;
  targetQty: string;
  startDate: string;
  finishDate: string;
  priority: string;
}

const EMPTY_WO_FORM: WOForm = {
  salesOrderId: '',
  targetQty: '',
  startDate: '',
  finishDate: '',
  priority: 'Normal',
};

const newOpKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

export function ProductionOrdersTab({ workOrders, refresh }: { workOrders: any[]; refresh: () => void }) {
  const { setTabActions } = useHeaderKpis();
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [processesMissing, setProcessesMissing] = useState(false);
  const [operations, setOperations] = useState<any[]>([]);
  const [opsMissing, setOpsMissing] = useState(false);
  const [planRows, setPlanRows] = useState<any[]>([]);
  const [machineCodes, setMachineCodes] = useState<string[]>([]);

  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('All Companies');
  const [productFilter, setProductFilter] = useState('All Products');
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editWO, setEditWO] = useState<any | null>(null);
  const [woForm, setWoForm] = useState<WOForm>(EMPTY_WO_FORM);
  const [opDrafts, setOpDrafts] = useState<OpDraft[]>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Part Routing reference stamped on operations created from the Active
  // revision. Existing/manual operations carry no reference and are untouched.
  const [routingRef, setRoutingRef] = useState<{ routingId: string; revision: number | null; productCode: string } | null>(null);

  const [detailWO, setDetailWO] = useState<any | null>(null);

  const fetchExtras = async () => {
    try {
      const { data: soData, error: soError } = await supabase
        .from('cnc_sales_orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (soError) console.error('Failed to load sales orders:', soError);
      else setSalesOrders(soData ?? []);
    } catch (err) {
      console.error('Failed to load sales orders:', err);
    }
    try {
      const { data, error } = await supabase
        .from('cnc_processes')
        .select('*')
        .order('process_code');
      if (error) {
        if ((error as any).code === 'PGRST205') setProcessesMissing(true);
        else console.error('Failed to load processes:', error);
        setProcesses([]);
      } else {
        setProcesses(data ?? []);
      }
    } catch (err) {
      console.error('Failed to load processes:', err);
    }
    try {
      const { data, error } = await supabase
        .from('cnc_work_order_operations')
        .select('*')
        .order('operation_sequence');
      if (error) {
        if ((error as any).code === 'PGRST205') setOpsMissing(true);
        else console.error('Failed to load operations:', error);
        setOperations([]);
      } else {
        setOperations(data ?? []);
      }
    } catch (err) {
      console.error('Failed to load operations:', err);
    }
    try {
      const { data } = await supabase.from('cnc_machines').select('code').order('code');
      if (data) setMachineCodes(data.map((m: any) => m.code).filter(Boolean));
    } catch {
      /* machine suggestions are optional */
    }
  };

  const loadPlans = async () => {
    try {
      const { data, error } = await supabase.from('cnc_operation_plans').select('*').order('plan_date').order('start_time');
      setPlanRows(error ? [] : (data ?? []));
    } catch { setPlanRows([]); }
  };

  useEffect(() => {
    fetchExtras();
    void loadPlans();
  }, []);

  const refreshOps = async () => {
    try {
      const { data } = await supabase.from('cnc_work_order_operations').select('*').order('operation_sequence');
      if (data) setOperations(data);
    } catch (err) {
      console.error('Failed to reload operations:', err);
    }
  };

  const opsByWO = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const op of operations) {
      const k = String(op.work_order_id ?? '');
      if (!map[k]) map[k] = [];
      map[k].push(op);
    }
    return map;
  }, [operations]);

  const customers = useMemo(
    () => Array.from(new Set((workOrders ?? []).map((w) => w.customer).filter(Boolean))).sort(),
    [workOrders]
  );
  const products = useMemo(
    () => Array.from(new Set((workOrders ?? []).map((w) => w.part_name).filter(Boolean))).sort(),
    [workOrders]
  );
  const statusOptions = useMemo(() => {
    const fromData = Array.from(new Set((workOrders ?? []).map((w) => w.status).filter(Boolean)));
    const ordered = [...WO_STATUSES];
    for (const s of fromData) if (!ordered.includes(s)) ordered.push(s);
    return ordered;
  }, [workOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (workOrders ?? []).filter((w) => {
      if (q) {
        const hay = `${w.wo_no ?? ''} ${w.sales_order ?? ''} ${w.customer ?? ''} ${w.part_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (customerFilter !== 'All Companies' && w.customer !== customerFilter) return false;
      if (productFilter !== 'All Products' && w.part_name !== productFilter) return false;
      if (statusFilter !== 'All Statuses' && w.status !== statusFilter) return false;
      if (dateFrom && (w.start_date ?? '').slice(0, 10) < dateFrom) return false;
      if (dateTo && (w.start_date ?? '').slice(0, 10) > dateTo) return false;
      return true;
    });
  }, [workOrders, search, customerFilter, productFilter, statusFilter, dateFrom, dateTo]);

  const stats = useMemo(() => {
    const list = workOrders ?? [];
    return {
      total: list.length,
      planned: list.filter((w) => ['Draft', 'Planned', ...LEGACY_PLANNED].includes(w.status)).length,
      inProgress: list.filter((w) => w.status === 'In Progress').length,
      completed: list.filter((w) => w.status === 'Completed').length,
    };
  }, [workOrders]);

  const clearFilters = () => {
    setSearch('');
    setCustomerFilter('All Companies');
    setProductFilter('All Products');
    setStatusFilter('All Statuses');
    setDateFrom('');
    setDateTo('');
  };
  const filtersActive =
    search.trim() !== '' || customerFilter !== 'All Companies' || productFilter !== 'All Products' ||
    statusFilter !== 'All Statuses' || dateFrom !== '' || dateTo !== '';

  const selectedSO = useMemo(
    () => salesOrders.find((s) => String(s.id) === woForm.salesOrderId) ?? null,
    [salesOrders, woForm.salesOrderId]
  );
  const activeProcesses = useMemo(
    () => processes.filter((p) => (p.status ?? 'Active') === 'Active'),
    [processes]
  );

  // ---------- create / edit ----------
  const openCreate = useCallback(() => {
    setEditWO(null);
    setWoForm({ ...EMPTY_WO_FORM, startDate: new Date().toISOString().slice(0, 10) });
    setOpDrafts([]);
    setRoutingRef(null);
    setFormErrors({});
    setShowForm(true);
  }, []);

  useEffect(() => {
    setTabActions(
      <Button icon={<Plus size={14} />} onClick={openCreate} size="sm" className="h-7 py-1 text-xs px-2.5 shadow-sm">
        Create Production Order
      </Button>
    );
    return () => setTabActions(null);
  }, [openCreate, setTabActions]);

  const openEdit = (wo: any) => {
    setEditWO(wo);
    setWoForm({
      salesOrderId: '',
      targetQty: String(wo.quantity ?? ''),
      startDate: (wo.start_date ?? '').slice(0, 10),
      finishDate: (wo.due_date ?? '').slice(0, 10),
      priority: wo.priority ?? 'Normal',
    });
    const existing = (opsByWO[String(wo.id)] ?? []).map((op) => {
      const mine = planRows.filter((r) => String(r.work_order_id) === String(wo.id) && Number(r.operation_sequence) === Number(op.operation_sequence));
      const plan = planFromRows(mine);
      return {
      origSeq: Number(op.operation_sequence) || 0,
      plan: mine.length > 0 ? plan : undefined,
      planLocked: false,
      key: newOpKey(),
      processId: op.process_id ?? '',
      machine: op.machine ?? '',
      plannedQty: String(op.planned_qty ?? ''),
      cycleTime: String(op.est_cycle_time ?? ''),
      setupTime: String(op.setup_time ?? ''),
      operator: op.operator ?? '',
    };
    });
    setOpDrafts(existing);
    // Preserve the routing reference when every operation still points at one revision.
    const allOps = opsByWO[String(wo.id)] ?? [];
    const stamped = allOps.filter((op) => op.routing_id != null);
    const uniform = stamped.length > 0 && stamped.length === allOps.length
      && new Set(stamped.map((op) => String(op.routing_id))).size === 1;
    setRoutingRef(uniform
      ? { routingId: String(stamped[0].routing_id), revision: stamped[0].routing_revision ?? null, productCode: wo.part_no ?? '' }
      : null);
    setFormErrors({});
    setShowForm(true);
  };

  const setField = (key: keyof WOForm, value: string) => {
    setWoForm((f) => ({ ...f, [key]: value }));
    setFormErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const handleSOSelect = (id: string) => {
    const so = salesOrders.find((s) => String(s.id) === id) ?? null;
    setWoForm((f) => ({
      ...f,
      salesOrderId: id,
      targetQty: so?.quantity != null ? String(so.quantity) : f.targetQty,
      finishDate: so?.delivery_date ? String(so.delivery_date).slice(0, 10) : f.finishDate,
    }));
    setFormErrors((e) => {
      const next = { ...e };
      delete next.salesOrderId;
      return next;
    });
  };

  const updateOpDraft = (key: string, patch: Partial<OpDraft>) => {
    setOpDrafts((list) => list.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  };

  const addOperation = () => {
    if (processesMissing || activeProcesses.length === 0) {
      setFormErrors((e) => ({ ...e, ops: 'Process Master is not available. Provision the cnc_processes table first.' }));
      return;
    }
    setOpDrafts((list) => [
      ...list,
      { key: newOpKey(), processId: '', machine: '', plannedQty: woForm.targetQty, cycleTime: '', setupTime: '', operator: '' },
    ]);
    setFormErrors((e) => {
      const next = { ...e };
      delete next.ops;
      return next;
    });
  };

  const removeOpDraft = (key: string) => {
    setOpDrafts((list) => list.filter((o) => o.key !== key));
  };

  // Fill operation drafts from the product's Active routing revision only.
  // Inactive/Draft revisions are never offered; rows stay editable afterwards.
  const loadRoutingIntoDrafts = async () => {
    const partNo = editWO ? (editWO.part_no ?? '') : (selectedSO?.part_number || selectedSO?.part_no || '');
    if (!String(partNo ?? '').trim()) {
      setFormErrors((e) => ({ ...e, ops: 'Select a sales order (product) first.' }));
      return;
    }
    if (processesMissing || activeProcesses.length === 0) {
      setFormErrors((e) => ({ ...e, ops: 'Process Master is not available. Provision the cnc_processes table first.' }));
      return;
    }
    const found = await fetchActiveRouting(String(partNo));
    if (!found || found.steps.length === 0) {
      setFormErrors((e) => ({ ...e, ops: `No Active routing for ${partNo}. Create and activate one under Production → Part Routing.` }));
      return;
    }
    const mapped = found.steps.map((s: any) => {
      const byId = processes.find((p) => String(p.id) === String(s.process_id ?? ''));
      const byCode = !byId && s.process_code
        ? processes.find((p) => String(p.process_code) === String(s.process_code))
        : null;
      const proc = byId ?? byCode;
      return {
        key: newOpKey(),
        processId: proc ? String(proc.id) : '',
        machine: s.machine ?? '',
        plannedQty: woForm.targetQty,
        cycleTime: String(s.cycle_time ?? ''),
        setupTime: String(s.setup_time ?? ''),
        operator: '',
      };
    });
    const missing = mapped.filter((m) => !m.processId);
    setOpDrafts(mapped);
    setRoutingRef({ routingId: String(found.header.id), revision: found.header.revision ?? null, productCode: found.header.product_code ?? '' });
    setFormErrors((e) => {
      const next = { ...e };
      if (missing.length > 0) {
        next.ops = `${missing.length} routing step(s) reference processes missing from Process Master — select replacements. Only the Active routing revision was loaded.`;
      } else {
        delete next.ops;
      }
      return next;
    });
  };

  const moveOpDraft = (key: string, dir: -1 | 1) => {
    setOpDrafts((list) => {
      const idx = list.findIndex((o) => o.key === key);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const validateWO = (): boolean => {
    const next: Record<string, string> = {};
    if (!editWO && !woForm.salesOrderId) next.salesOrderId = 'Sales Order is required.';
    const qty = Number(woForm.targetQty);
    if (woForm.targetQty.trim() === '') next.targetQty = 'Target Quantity is required.';
    else if (!Number.isFinite(qty) || qty <= 0) next.targetQty = 'Target Quantity must be greater than 0.';
    if (!woForm.startDate) next.startDate = 'Planned Start Date is required.';
    if (!woForm.finishDate) next.finishDate = 'Planned Finish Date is required.';
    if (woForm.startDate && woForm.finishDate && woForm.finishDate < woForm.startDate) {
      next.finishDate = 'Planned Finish must not be before Planned Start.';
    }
    opDrafts.forEach((o, i) => {
      const proc = processes.find((p) => String(p.id) === o.processId);
      if (!o.processId || !proc) next[`op_${o.key}`] = `Operation ${i + 1}: select a process from Process Master.`;
      if (o.plannedQty.trim() !== '') {
        const n = Number(o.plannedQty);
        if (!Number.isFinite(n) || n < 0) next[`op_${o.key}`] = `Operation ${i + 1}: Planned Qty must be 0 or more.`;
      }
      if (o.plan && !planIsBlank(o.plan)) {
        const pe = planError(o.plan);
        if (pe) next[`op_${o.key}`] = `Operation ${i + 1} plan: ${pe}`;
      }
      for (const [k, label] of [['cycleTime', 'Cycle Time'], ['setupTime', 'Setup Time']] as const) {
        if (o[k].trim() !== '') {
          const n = Number(o[k]);
          if (!Number.isFinite(n) || n < 0) next[`op_${o.key}`] = `Operation ${i + 1}: ${label} must be 0 or more.`;
        }
      }
    });
    setFormErrors(next);
    return Object.keys(next).length === 0;
  };

  const generateWoNo = () => {
    const d = new Date();
    const prefix = `WO-${d.getFullYear().toString().slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}-`;
    const existing = new Set((workOrders ?? []).map((w) => w.wo_no));
    for (let i = 0; i < 50; i++) {
      const candidate = `${prefix}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${prefix}${Date.now().toString().slice(-3)}`;
  };

  const handleSaveWO = async () => {
    if (!validateWO() || saving) return;
    setSaving(true);
    try {
      if (editWO) {
        // NOTE: cnc_work_orders has no notes/updated_at columns — keep the payload
        // to columns the table actually has (same set the legacy create used).
        const { error } = await supabase
          .from('cnc_work_orders')
          .update({
            quantity: Number(woForm.targetQty),
            start_date: woForm.startDate || null,
            due_date: woForm.finishDate || null,
            priority: woForm.priority,
          })
          .eq('id', editWO.id);
        if (error) throw error;
        await saveOpDrafts(String(editWO.id), editWO);
        await savePlans(String(editWO.id));
      } else {
        const so = selectedSO;
        const woId = crypto.randomUUID();
        const { error } = await supabase.from('cnc_work_orders').insert([{
          id: woId,
          wo_no: generateWoNo(),
          sales_order: so?.order_no ?? '',
          customer: so?.customer ?? '',
          part_name: so?.part_name ?? '',
          part_no: so?.part_number || so?.part_no || 'N/A',
          quantity: Number(woForm.targetQty),
          completed: 0,
          rejected: 0,
          start_date: woForm.startDate || null,
          due_date: woForm.finishDate || null,
          status: 'Draft',
          priority: woForm.priority,
        }]);
        if (error) throw error;
        await saveOpDrafts(woId, { wo_no: '', sales_order: so?.order_no ?? '' });
        await savePlans(woId);
      }
      setShowForm(false);
      refresh();
      refreshOps();
    } catch (err: any) {
      alert('Failed to save work order: ' + (err?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  // Planned timeline of the operations: replaced per work order. Plans that are not one regular range stay as they are
  // (re-numbered if the operations were re-ordered).
  const savePlans = async (workOrderId: string) => {
    const wanted = opDrafts.some((o) => o.plan && !planIsBlank(o.plan) && !planError(o.plan));
    const hadAny = planRows.some((r) => String(r.work_order_id) === workOrderId);
    if (!wanted && !hadAny) return;
    try {
      const out: any[] = [];
      opDrafts.forEach((o, i) => {
        const seq = i + 1;
        const proc = processes.find((p) => String(p.id) === o.processId);
        if (o.planLocked && o.origSeq) {
          planRows.filter((r) => String(r.work_order_id) === workOrderId && Number(r.operation_sequence) === o.origSeq).forEach((r) => {
            out.push({ id: crypto.randomUUID(), work_order_id: workOrderId, operation_sequence: seq, process_name: proc?.process_name ?? r.process_name ?? '',
              machine: r.machine ?? '', operator: r.operator ?? '', plan_date: String(r.plan_date).slice(0, 10), start_time: String(r.start_time).slice(0, 5), end_time: String(r.end_time).slice(0, 5) });
          });
        } else if (o.plan && !planIsBlank(o.plan)) {
          expandPlan(o.plan).forEach((seg) => out.push({
            id: crypto.randomUUID(), work_order_id: workOrderId, operation_sequence: seq, process_name: proc?.process_name ?? '',
            machine: o.machine.trim(), operator: o.operator.trim(), plan_date: seg.date, start_time: seg.start, end_time: seg.end,
          }));
        }
      });
      const del = await supabase.from('cnc_operation_plans').delete().eq('work_order_id', workOrderId);
      if (del.error) throw del.error;
      if (out.length > 0) {
        let ins = await supabase.from('cnc_operation_plans').insert(out);
        // Databases that have not run the operator migration yet keep the plan without the man.
        if (ins.error && /'operator' column/.test(String(ins.error.message))) ins = await supabase.from('cnc_operation_plans').insert(out.map(({ operator: _o, ...rest }) => rest));
        if (ins.error) throw ins.error;
      }
      void loadPlans();
    } catch (err: any) {
      alert(isMissingTable(err)
        ? 'The work order was saved, but its planned timeline was not: run migration 20261009000000_operation_plans.sql in Supabase first.'
        : `The work order was saved, but its planned timeline was not: ${err?.message ?? err}`);
    }
  };

  const saveOpDrafts = async (workOrderId: string, wo: { wo_no?: string; sales_order?: string }) => {
    if (opsMissing) return;
    const prev = opsByWO[workOrderId] ?? [];
    // Rebuild: simplest reliable sync is delete-all + re-insert in sequence order.
    if (prev.length > 0) {
      const { error } = await supabase.from('cnc_work_order_operations').delete().eq('work_order_id', workOrderId);
      if (error) throw error;
    }
    if (opDrafts.length === 0) return;
    const rows = opDrafts.map((o, i) => {
      const proc = processes.find((p) => String(p.id) === o.processId);
      return {
        id: crypto.randomUUID(),
        work_order_id: workOrderId,
        sales_order_id: editWO ? undefined : woForm.salesOrderId || null,
        sales_order_no: wo.sales_order ?? null,
        process_id: o.processId || null,
        process_code: proc?.process_code ?? '',
        process_name: proc?.process_name ?? '',
        operation_sequence: i + 1,
        machine: o.machine.trim() || null,
        operator: o.operator.trim() || null,
        planned_qty: o.plannedQty.trim() === '' ? Number(woForm.targetQty) || 0 : Number(o.plannedQty),
        completed_qty: 0,
        est_cycle_time: o.cycleTime.trim() === '' ? 0 : Number(o.cycleTime),
        setup_time: o.setupTime.trim() === '' ? 0 : Number(o.setupTime),
        status: 'Pending',
        routing_id: routingRef?.routingId ?? null,
        routing_revision: routingRef?.revision ?? null,
      };
    });
    // Tolerant: the routing reference columns arrive with the part-routing
    // migration — older databases save the same rows without them.
    let pending: any[] = rows;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase.from('cnc_work_order_operations').insert(pending);
      if (!error) return;
      const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(String((error as any)?.message || ''));
      if (m && (m[1] === 'routing_id' || m[1] === 'routing_revision') && pending.length && Object.prototype.hasOwnProperty.call(pending[0], m[1])) {
        pending = pending.map((r) => {
          const c = { ...r };
          delete c[m[1]];
          return c;
        });
        continue;
      }
      throw error;
    }
    throw new Error('Failed to save operations after retries.');
  };

  // ---------- table ----------
  const columns: Column<any>[] = [
    {
      key: 'wo_no',
      label: 'Work Order No.',
      sortable: true,
      render: (r) => <span className="font-mono text-xs font-semibold text-slate-700">{r.wo_no}</span>,
    },
    {
      key: 'sales_order',
      label: 'Sales Order No.',
      sortable: true,
      render: (r) => <span className="font-mono text-xs text-slate-500">{r.sales_order || '—'}</span>,
    },
    { key: 'customer', label: 'Company', sortable: true },
    {
      key: 'part_name',
      label: 'Product',
      sortable: true,
      render: (r) => <span className="font-medium text-slate-800">{r.part_name}</span>,
    },
    {
      key: 'quantity',
      label: 'Target Qty',
      sortable: true,
      align: 'right',
      render: (r) => <span className="font-semibold text-slate-700">{Number(r.quantity ?? 0).toLocaleString('en-IN')}</span>,
    },
    {
      key: 'completed',
      label: 'Completed Qty',
      sortable: true,
      align: 'right',
      render: (r) => <span className="text-slate-600">{Number(r.completed ?? 0).toLocaleString('en-IN')}</span>,
    },
    {
      key: 'start_date',
      label: 'Planned Start',
      sortable: true,
      render: (r) => <span className="text-slate-600 whitespace-nowrap">{r.start_date ? formatDate(r.start_date) : '—'}</span>,
    },
    {
      key: 'due_date',
      label: 'Planned Finish',
      sortable: true,
      render: (r) => <span className="text-slate-600 whitespace-nowrap">{r.due_date ? formatDate(r.due_date) : '—'}</span>,
    },
    {
      key: 'progress',
      label: 'Progress',
      render: (r) => {
        const qty = Number(r.quantity) || 0;
        const comp = Number(r.completed) || 0;
        const pct = qty > 0 ? Math.round((comp / qty) * 100) : 0;
        return (
          <div className="min-w-[120px]">
            <ProgressBar value={pct} color={pct >= 100 ? 'success' : pct > 0 ? 'brand' : 'neutral'} />
            <span className="text-[11px] text-slate-500">{pct}%</span>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Badge variant={statusToVariant(r.status)} dot>{r.status}</Badge>
          {r.priority && r.priority !== 'Normal' && (
            <Badge variant={priorityToVariant(r.priority)}>{r.priority}</Badge>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setDetailWO(r)}
            title="View work order"
            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
          >
            <Eye size={15} />
          </button>
          {EDITABLE_STATUSES.includes(r.status) && (
            <button
              onClick={() => openEdit(r)}
              title="Edit work order"
              className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
            >
              <Pencil size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const errText = (key: string) =>
    formErrors[key] ? <p className="text-xs font-medium text-red-600 mt-1">{formErrors[key]}</p> : null;

  const liveDetailWO = detailWO ? (workOrders ?? []).find((w) => w.id === detailWO.id) ?? detailWO : null;

  return (
    <div>
      <div className="flex lg:hidden flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <h1 className="text-xl font-bold text-slate-800 whitespace-nowrap">Production</h1>
        <p className="text-sm text-slate-500 whitespace-nowrap">Plan, release and track manufacturing work orders.</p>
        <div className="ml-auto">
          <Button icon={<Plus size={15} />} onClick={openCreate}>
            Create Production Order
          </Button>
        </div>
      </div>

      {opsMissing && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <span className="font-bold">Setup required: </span>
          the <span className="font-mono">cnc_work_order_operations</span> table does not exist yet. Apply{' '}
          <span className="font-mono">supabase/migrations/20260928000000_work_order_operations.sql</span> to
          the database. Work orders can still be created, but operations and release are disabled until then.
        </div>
      )}
      {processesMissing && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <span className="font-bold">Setup required: </span>
          Process Master (<span className="font-mono">cnc_processes</span>) is not provisioned, so no process
          can be selected for operations.
        </div>
      )}

      {/* Stats + filters share one line with no scrolling (compact widths throughout). */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-2.5 py-1.5 mb-2">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
          <div className="flex items-center gap-2 shrink-0">
            {[
              { l: 'Total', v: stats.total, c: 'text-slate-800' },
              { l: 'Planned', v: stats.planned, c: 'text-slate-600' },
              { l: 'In Progress', v: stats.inProgress, c: 'text-brand-600' },
              { l: 'Completed', v: stats.completed, c: 'text-emerald-600' },
            ].map((s) => (
              <span key={s.l} className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {s.l} <b className={`text-[13px] tabular-nums ${s.c}`}>{s.v}</b>
              </span>
            ))}
          </div>
          <span className="h-6 w-px bg-slate-200 shrink-0" aria-hidden="true" />
          <div className="flex items-center gap-1.5 shrink-0">
            <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} className={`${inputClass} w-28`} aria-label="Company">
              <option>All Companies</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className={`${inputClass} w-28`} aria-label="Product">
              <option>All Products</option>
              {products.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputClass} w-28`}>
              <option>All Statuses</option>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">From</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${inputClass} w-32`} />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">To</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${inputClass} w-32`} />
          </div>
          {filtersActive && (
            <button
              onClick={clearFilters}
              className="inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
            >
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        title="Work Orders"
        searchKeys={['wo_no', 'sales_order', 'customer', 'part_name', 'status']}
        onRowClick={(r) => setDetailWO(r)}
        emptyMessage="No work orders found"
      />

      {/* ---------- create / edit modal ---------- */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editWO ? `Edit Work Order ${editWO.wo_no}` : 'Create Production Order'}
        subtitle={editWO ? 'Update production details and operations.' : 'Convert a Sales Order into a Production Order with sequenced operations.'}
        size="2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSaveWO} disabled={saving}>
              {saving ? 'Saving...' : editWO ? 'Save Changes' : 'Create Work Order'}
            </Button>
          </>
        }
      >
        <FormSection title="Section 1 — Order Reference">
          {!editWO ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <FormField label="Sales Order" required>
                  <select value={woForm.salesOrderId} onChange={(e) => handleSOSelect(e.target.value)} className={`${inputClass} ${formErrors.salesOrderId ? 'border-red-400' : ''}`}>
                    <option value="">Select Sales Order...</option>
                    {salesOrders.map((so) => (
                      <option key={so.id} value={so.id}>
                        {so.order_no} — {so.customer} — {so.part_name} (Qty {so.quantity})
                      </option>
                    ))}
                  </select>
                </FormField>
                {errText('salesOrderId')}
              </div>
              <FormField label="Company">
                <input className={`${inputClass} bg-slate-50`} readOnly placeholder="Auto-filled from Sales Order" value={selectedSO?.customer ?? ''} />
              </FormField>
              <FormField label="Product">
                <input className={`${inputClass} bg-slate-50`} readOnly placeholder="Auto-filled from Sales Order" value={selectedSO?.part_name ?? ''} />
              </FormField>
              <FormField label="Sales Order Quantity">
                <input className={`${inputClass} bg-slate-50`} readOnly placeholder="Auto-filled" value={selectedSO?.quantity ?? ''} />
              </FormField>
              <FormField label="Delivery Date">
                <input className={`${inputClass} bg-slate-50`} readOnly placeholder="Auto-filled" value={selectedSO?.delivery_date ? formatDate(selectedSO.delivery_date) : ''} />
              </FormField>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sales Order</p><p className="font-mono font-semibold text-slate-800">{editWO.sales_order || '—'}</p></div>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Company</p><p className="font-semibold text-slate-800">{editWO.customer || '—'}</p></div>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Product</p><p className="font-semibold text-slate-800">{editWO.part_name || '—'}</p></div>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</p><p><Badge variant={statusToVariant(editWO.status)} dot>{editWO.status}</Badge></p></div>
            </div>
          )}
        </FormSection>

        <FormSection title="Section 2 — Production Details">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!editWO && (
              <FormField label="Work Order No." hint="Auto generated on save.">
                <input className={`${inputClass} bg-slate-50 font-mono`} readOnly placeholder="WO-YYMM-###" value="" />
              </FormField>
            )}
            <div>
              <FormField label="Target Quantity" required>
                <input
                  type="number" min="0" step="1"
                  value={woForm.targetQty}
                  onChange={(e) => setField('targetQty', e.target.value)}
                  placeholder="e.g. 50"
                  className={`${inputClass} ${formErrors.targetQty ? 'border-red-400' : ''}`}
                />
              </FormField>
              {errText('targetQty')}
            </div>
            <div>
              <FormField label="Planned Start Date" required>
                <input type="date" value={woForm.startDate} onChange={(e) => setField('startDate', e.target.value)} className={`${inputClass} ${formErrors.startDate ? 'border-red-400' : ''}`} />
              </FormField>
              {errText('startDate')}
            </div>
            <div>
              <FormField label="Planned Finish Date" required>
                <input type="date" value={woForm.finishDate} onChange={(e) => setField('finishDate', e.target.value)} className={`${inputClass} ${formErrors.finishDate ? 'border-red-400' : ''}`} />
              </FormField>
              {errText('finishDate')}
            </div>
            <FormField label="Priority">
              <select value={woForm.priority} onChange={(e) => setField('priority', e.target.value)} className={inputClass}>
                <option>Normal</option>
                <option>High</option>
                <option>Urgent</option>
              </select>
            </FormField>
          </div>
        </FormSection>

        <FormSection title="Section 3 — Operations / Processes">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-slate-500">Select processes from Process Master. Sequence follows row order.</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" icon={<GitBranch size={14} />} onClick={() => void loadRoutingIntoDrafts()}>Load Active Routing</Button>
              <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={addOperation}>Add Operation</Button>
            </div>
          </div>
          {routingRef && (
            <p className="text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5 mb-3">
              Operations from Part Routing {routingRef.productCode} Rev {routingRef.revision ?? '?'} (Active) — rows stay editable.
              <button type="button" onClick={() => setRoutingRef(null)} className="ml-2 underline hover:text-violet-900">clear reference</button>
            </p>
          )}
          {errText('ops')}
          {opDrafts.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
              No operations yet. {editWO ? '' : 'You can save as Draft and add operations later — at least one operation is required before release.'}
            </p>
          ) : (
            <div className="space-y-3">
              {opDrafts.map((o, i) => {
                const proc = processes.find((p) => String(p.id) === o.processId);
                return (
                  <div key={o.key} className="border border-slate-200 rounded-xl p-3 bg-white">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-7 h-7 rounded-lg bg-navy-900 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Sequence {i + 1}</span>
                      <span className="flex-1" />
                      <button onClick={() => moveOpDraft(o.key, -1)} disabled={i === 0} title="Move up" className="p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30"><ChevronUp size={15} /></button>
                      <button onClick={() => moveOpDraft(o.key, 1)} disabled={i === opDrafts.length - 1} title="Move down" className="p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30"><ChevronDown size={15} /></button>
                      <button onClick={() => removeOpDraft(o.key)} title="Remove operation" className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-1">
                        <FormField label="Process" required>
                          <select value={o.processId} onChange={(e) => updateOpDraft(o.key, { processId: e.target.value })} className={inputClass}>
                            <option value="">Select process...</option>
                            {activeProcesses.map((p) => (
                              <option key={p.id} value={p.id}>{p.process_code} — {p.process_name}</option>
                            ))}
                          </select>
                        </FormField>
                      </div>
                      <FormField label="Machine">
                        <input
                          value={o.machine}
                          onChange={(e) => updateOpDraft(o.key, { machine: e.target.value })}
                          placeholder={proc?.machine_type ? `e.g. ${proc.machine_type}` : 'Machine code'}
                          list="wo-machine-list"
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="Operator">
                        <input value={o.operator} onChange={(e) => updateOpDraft(o.key, { operator: e.target.value })} placeholder="Operator (optional)" className={inputClass} />
                      </FormField>
                      <FormField label="Planned Qty">
                        <input type="number" min="0" step="1" value={o.plannedQty} onChange={(e) => updateOpDraft(o.key, { plannedQty: e.target.value })} placeholder={woForm.targetQty || 'Target qty'} className={inputClass} />
                      </FormField>
                      <FormField label="Cycle Time (min)">
                        <input type="number" min="0" step="0.1" value={o.cycleTime} onChange={(e) => updateOpDraft(o.key, { cycleTime: e.target.value })} placeholder="min / pc" className={inputClass} />
                      </FormField>
                      <FormField label="Setup Time (min)">
                        <input type="number" min="0" step="0.5" value={o.setupTime} onChange={(e) => updateOpDraft(o.key, { setupTime: e.target.value })} placeholder="minutes" className={inputClass} />
                      </FormField>
                    </div>
                    <div className="mt-3 border-t border-slate-100 pt-3" data-testid="op-plan">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Planned timeline</span>
                        {o.planLocked ? (
                          <span className="text-[11px] text-slate-500">This operation already has a custom plan - edit it in Scheduling, Planned Timeline.</span>
                        ) : o.plan ? (
                          <button type="button" onClick={() => updateOpDraft(o.key, { plan: undefined })} className="text-[11px] font-semibold text-red-600 hover:underline">Clear plan</button>
                        ) : (
                          <button type="button" onClick={() => updateOpDraft(o.key, { plan: { ...emptyPlan(), from: woForm.startDate, to: woForm.finishDate || woForm.startDate } })}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-800"><Plus size={13} /> Plan dates &amp; time</button>
                        )}
                      </div>
                      {o.plan && <PlanEditor value={o.plan} onChange={(plan) => updateOpDraft(o.key, { plan })} />}
                    </div>
                    {formErrors[`op_${o.key}`] && <p className="text-xs font-medium text-red-600 mt-2">{formErrors[`op_${o.key}`]}</p>}
                  </div>
                );
              })}
              <datalist id="wo-machine-list">
                {machineCodes.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          )}
        </FormSection>
      </Modal>

      {liveDetailWO && (
        <WorkOrderDetail
          wo={liveDetailWO}
          ops={(opsByWO[String(liveDetailWO.id)] ?? []).slice().sort((a, b) => (a.operation_sequence ?? 0) - (b.operation_sequence ?? 0))}
          opsMissing={opsMissing}
          onClose={() => setDetailWO(null)}
          onChanged={() => {
            refresh();
            refreshOps();
          }}
          onEdit={(wo) => {
            setDetailWO(null);
            openEdit(wo);
          }}
        />
      )}
    </div>
  );
}

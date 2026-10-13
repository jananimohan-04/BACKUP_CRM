// Part Routing: standard manufacturing sequence per product (master data).
// A revisioned header (product + revision + Draft/Active/Inactive) owns
// sequenced steps. Exactly one revision is Active per product; work orders
// created from it stamp routing_id / routing_revision on their operations.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatINR, todayISO } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, FormField, FormSection, inputClass } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  Plus, Eye, Pencil, Trash2, ChevronUp, ChevronDown, Copy, CheckCheck, Ban, GitBranch,
} from 'lucide-react';
import {
  ROUTING_STATUSES, nextSequence, routingOpCost, insertTolerant, type RoutingStep,
} from '@/lib/partRouting';
import { isMissingRelation, num } from '@/lib/orderQuantities';

interface OpRow extends RoutingStep {
  key: string;
}

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const emptyOp = (): OpRow => ({
  key: newKey(),
  sequence: 10,
  process_id: null,
  process_code: '',
  process_name: '',
  process_category: '',
  machine: '',
  setup_time: 0,
  cycle_time: 0,
  cost_per_hour: 0,
  cost_per_component: 0,
  standard_qty: 1,
  instructions: '',
});

const statusBadge = (s: string) =>
  s === 'Active' ? 'success' : s === 'Draft' ? 'warning' : 'neutral';

/** Step-level rules shared by editor save and quick-activate. */
const stepErrors = (
  steps: { sequence: any; process_id: any; machine: any; setup_time: any; cycle_time: any; cost_per_hour: any; cost_per_component: any; standard_qty: any }[],
  procs: any[],
  mCodes: string[],
): string[] => {
  const errs: string[] = [];
  const seqs = steps.map((r) => Number(r.sequence));
  if (new Set(seqs).size !== seqs.length) errs.push('Sequence numbers must be unique.');
  if (seqs.some((s) => !Number.isFinite(s) || s <= 0)) errs.push('Sequence numbers must be greater than 0.');
  steps.forEach((r, i) => {
    const label = `Operation ${i + 1} (seq ${r.sequence})`;
    const proc = procs.find((p) => String(p.id) === String(r.process_id ?? ''));
    if (!r.process_id || !proc || (proc.status ?? 'Active') !== 'Active') {
      errs.push(`${label}: select a process from Process Master.`);
      return;
    }
    if (r.machine && !mCodes.includes(r.machine)) errs.push(`${label}: machine must come from the machine master.`);
    if (proc.machine_type && String(proc.machine_type).trim() !== '' && !r.machine) {
      errs.push(`${label}: process ${proc.process_code} requires a machine.`);
    }
    for (const [k, label2] of [['setup_time', 'Setup Time'], ['cycle_time', 'Cycle Time'], ['cost_per_hour', 'Cost Per Hour'], ['cost_per_component', 'Cost Per Component'], ['standard_qty', 'Standard Quantity']] as const) {
      const n = num((r as any)[k]);
      if (!Number.isFinite(n) || n < 0) errs.push(`${label}: ${label2} must be 0 or more.`);
    }
  });
  return errs;
};

const money = (v: number) => formatINR(Math.round(v * 100) / 100);

export function PartRoutingTab() {
  const { profile } = useAuth() as any;
  const userName: string = profile?.email ?? '';

  const [headers, setHeaders] = useState<any[]>([]);
  const [stepsByRouting, setStepsByRouting] = useState<Record<string, any[]>>({});
  const [parts, setParts] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [processesMissing, setProcessesMissing] = useState(false);
  const [machines, setMachines] = useState<{ code: string; name: string }[]>([]);
  const [routingsMissing, setRoutingsMissing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('All');
  const [productFilter, setProductFilter] = useState('All');

  // Editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ product_code: '', product_name: '', revision: '1', effective_from: todayISO(), status: 'Draft', notes: '' });
  const [opRows, setOpRows] = useState<OpRow[]>([]);
  const [previewQty, setPreviewQty] = useState('1');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Detail + confirms
  const [viewId, setViewId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{ h: any; to: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeProcesses = useMemo(
    () => processes.filter((p) => (p.status ?? 'Active') === 'Active'),
    [processes],
  );
  const machineCodes = useMemo(() => machines.map((m) => m.code).filter(Boolean), [machines]);

  const load = async () => {
    setLoading(true);
    try {
      const h = await supabase.from('cnc_part_routings').select('*').order('product_code').order('revision', { ascending: false });
      if (h.error) {
        if ((h.error as any).code === 'PGRST205' || isMissingRelation(h.error)) setRoutingsMissing(true);
        else console.error('Failed to load routings:', h.error);
        setHeaders([]);
      } else {
        setRoutingsMissing(false);
        setHeaders(h.data ?? []);
      }
      try {
        const s = await supabase.from('cnc_part_routing_steps').select('*').order('sequence').limit(5000);
        if (!s.error) {
          const map: Record<string, any[]> = {};
          for (const r of s.data ?? []) {
            const k = String(r.routing_id);
            if (!map[k]) map[k] = [];
            map[k].push(r);
          }
          setStepsByRouting(map);
        }
      } catch { /* steps stay empty */ }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    (async () => {
      try {
        const p = await supabase.from('cnc_parts').select('part_no, part_name').order('part_no').limit(2000);
        if (!p.error && p.data) setParts(p.data.filter((x: any) => x.part_no));
      } catch { /* parts list stays empty */ }
      try {
        const pr = await supabase.from('cnc_processes').select('*').order('process_code');
        if (pr.error) {
          if ((pr.error as any).code === 'PGRST205') setProcessesMissing(true);
          setProcesses([]);
        } else setProcesses(pr.data ?? []);
      } catch {
        setProcesses([]);
      }
      // Machine master: name column is optional in older databases.
      try {
        const m = await supabase.from('cnc_machines').select('code,name').order('code');
        if (!m.error && m.data) {
          setMachines(m.data.map((x: any) => ({ code: x.code, name: x.name ?? '' })).filter((x) => x.code));
        } else {
          const m2 = await supabase.from('cnc_machines').select('code').order('code');
          if (!m2.error && m2.data) setMachines(m2.data.map((x: any) => ({ code: x.code, name: '' })).filter((x: any) => x.code));
        }
      } catch { /* machine list stays empty */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const productsWithRoutings = useMemo(
    () => Array.from(new Set(headers.map((h) => h.product_code).filter(Boolean))).sort(),
    [headers],
  );

  const filtered = useMemo(() => headers.filter((h) => {
    if (statusFilter !== 'All' && h.status !== statusFilter) return false;
    if (productFilter !== 'All' && h.product_code !== productFilter) return false;
    return true;
  }), [headers, statusFilter, productFilter]);

  const rows = useMemo(() => filtered.map((h) => ({
    ...h,
    opsCount: (stepsByRouting[String(h.id)] ?? []).length,
  })), [filtered, stepsByRouting]);

  // ---------- editor ----------
  const openCreate = (presetProduct = '') => {
    setEditId(null);
    const maxRev = presetProduct
      ? Math.max(0, ...headers.filter((h) => h.product_code === presetProduct).map((h) => Number(h.revision) || 0))
      : 0;
    setForm({
      product_code: presetProduct,
      product_name: parts.find((p) => p.part_no === presetProduct)?.part_name ?? '',
      revision: String(maxRev + 1),
      effective_from: todayISO(), status: 'Draft', notes: '',
    });
    setOpRows([]);
    setPreviewQty('1');
    setErrors([]);
    setEditorOpen(true);
  };

  const openEdit = async (h: any) => {
    setEditId(String(h.id));
    setForm({
      product_code: h.product_code ?? '',
      product_name: h.product_name ?? '',
      revision: String(h.revision ?? 1),
      effective_from: (h.effective_from ?? todayISO()).slice(0, 10),
      status: h.status ?? 'Draft',
      notes: h.notes ?? '',
    });
    let steps = stepsByRouting[String(h.id)];
    if (!steps) {
      const s = await supabase.from('cnc_part_routing_steps').select('*').eq('routing_id', h.id).order('sequence');
      steps = s.error ? [] : (s.data ?? []);
    }
    setOpRows((steps ?? []).map((s: any) => ({
      key: newKey(),
      sequence: Number(s.sequence) || 10,
      process_id: s.process_id ?? null,
      process_code: s.process_code ?? '',
      process_name: s.process_name ?? '',
      process_category: s.process_category ?? '',
      machine: s.machine ?? '',
      setup_time: Number(s.setup_time) || 0,
      cycle_time: Number(s.cycle_time) || 0,
      cost_per_hour: Number(s.cost_per_hour) || 0,
      cost_per_component: Number(s.cost_per_component) || 0,
      standard_qty: Number(s.standard_qty) || 0,
      instructions: s.instructions ?? '',
    })));
    setPreviewQty('1');
    setErrors([]);
    setEditorOpen(true);
  };

  const handleProductSelect = (code: string) => {
    const part = parts.find((p) => p.part_no === code);
    const maxRev = Math.max(0, ...headers.filter((h) => h.product_code === code).map((h) => Number(h.revision) || 0));
    setForm((f) => ({
      ...f,
      product_code: code,
      product_name: part?.part_name ?? '',
      ...(editId ? {} : { revision: String(maxRev + 1) }),
    }));
  };

  const updateRow = (key: string, patch: Partial<OpRow>) => {
    setOpRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleProcessSelect = (key: string, processId: string) => {
    const p = processes.find((x) => String(x.id) === processId);
    if (!p) { updateRow(key, { process_id: null, process_code: '', process_name: '', process_category: '' }); return; }
    updateRow(key, {
      process_id: p.id,
      process_code: p.process_code ?? '',
      process_name: p.process_name ?? '',
      process_category: p.process_category ?? '',
      cost_per_hour: Number(p.cost_per_hour) || 0,
      cost_per_component: Number(p.cost_per_component) || 0,
    });
  };

  const addRow = () => {
    setOpRows((list) => [...list, { ...emptyOp(), sequence: nextSequence(list) }]);
  };

  const moveRow = (key: string, dir: -1 | 1) => {
    setOpRows((list) => {
      const sorted = [...list].sort((a, b) => a.sequence - b.sequence);
      const idx = sorted.findIndex((r) => r.key === key);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= sorted.length) return list;
      const a = sorted[idx].sequence;
      sorted[idx].sequence = sorted[j].sequence;
      sorted[j].sequence = a;
      return [...sorted].sort((x, y) => x.sequence - y.sequence);
    });
  };

  const previewN = Math.max(0, num(previewQty));
  const totals = useMemo(() => {
    const setup = opRows.reduce((s, r) => s + num(r.setup_time), 0);
    const cycle = opRows.reduce((s, r) => s + num(r.cycle_time), 0);
    const cost = opRows.reduce((s, r) => s + routingOpCost(r, previewN), 0);
    return { setup, cycle, cost };
  }, [opRows, previewN]);

  const validate = (targetStatus: string): string[] => {
    const errs: string[] = [];
    if (!form.product_code.trim()) errs.push('Product is required.');
    const rev = Number(form.revision);
    if (!Number.isInteger(rev) || rev < 1) errs.push('Revision must be a whole number of 1 or more.');
    const clash = headers.some((h) => h.product_code === form.product_code.trim()
      && Number(h.revision) === rev && String(h.id) !== String(editId ?? ''));
    if (clash) errs.push(`Revision ${rev} already exists for ${form.product_code.trim()}.`);
    errs.push(...stepErrors(opRows, processes, machineCodes));
    if (targetStatus === 'Active' && opRows.length === 0) errs.push('At least one operation is required before activation.');
    return errs;
  };

  const persist = async (targetStatus: string) => {
    const errs = validate(targetStatus);
    setErrors(errs);
    if (errs.length > 0 || saving) return;
    setSaving(true);
    try {
      const code = form.product_code.trim();
      const rev = Number(form.revision);
      let headerId = editId;
      const payload: any = {
        product_code: code,
        product_name: form.product_name.trim(),
        revision: rev,
        effective_from: form.effective_from || null,
        status: targetStatus === 'Active' ? 'Draft' : targetStatus,
        notes: form.notes.trim() || null,
        created_by: userName || null,
        updated_at: new Date().toISOString(),
      };
      if (!headerId) {
        const ins = await supabase.from('cnc_part_routings').insert([payload]).select('id').single();
        if (ins.error) throw ins.error;
        headerId = ins.data.id;
      } else {
        const upd = await supabase.from('cnc_part_routings').update(payload).eq('id', headerId);
        if (upd.error) throw upd.error;
        const del = await supabase.from('cnc_part_routing_steps').delete().eq('routing_id', headerId);
        if (del.error) throw del.error;
      }
      if (opRows.length > 0) {
        const ordered = [...opRows].sort((a, b) => a.sequence - b.sequence);
        await insertTolerant('cnc_part_routing_steps', ordered.map((r) => ({
          routing_id: headerId,
          sequence: Number(r.sequence),
          process_id: r.process_id || null,
          process_code: r.process_code,
          process_name: r.process_name,
          process_category: r.process_category || null,
          machine: r.machine || null,
          setup_time: num(r.setup_time),
          cycle_time: num(r.cycle_time),
          cost_per_hour: num(r.cost_per_hour),
          cost_per_component: num(r.cost_per_component),
          standard_qty: num(r.standard_qty),
          instructions: r.instructions.trim() || null,
        })));
      }
      if (targetStatus === 'Active') {
        await setActive(String(headerId), code);
      } else {
        await load();
        setEditorOpen(false);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      setErrors([/duplicate key|23505/i.test(msg)
        ? `Revision ${form.revision} already exists for ${form.product_code.trim()}.`
        : `Save failed: ${msg}`]);
    } finally {
      setSaving(false);
    }
  };

  /** Activate one revision; every other Active revision of the product retires. */
  const setActive = async (headerId: string, code?: string) => {
    const h = headers.find((x) => String(x.id) === String(headerId));
    const prodCode = code ?? h?.product_code;
    setBusyId(headerId);
    try {
      let steps = stepsByRouting[String(headerId)];
      if (!steps) {
        const s = await supabase.from('cnc_part_routing_steps').select('*').eq('routing_id', headerId).order('sequence');
        steps = s.error ? [] : (s.data ?? []);
      }
      const errs = stepErrors(steps ?? [], processes, machineCodes);
      if ((steps ?? []).length === 0) errs.push('Add at least one operation before activation.');
      if (errs.length > 0) {
        alert('Cannot activate:\n- ' + errs.join('\n- '));
        setConfirmToggle(null);
        return;
      }
      if (prodCode) {
        const others = headers.filter((x) => x.product_code === prodCode && x.status === 'Active' && String(x.id) !== String(headerId));
        for (const o of others) {
          const r = await supabase.from('cnc_part_routings').update({ status: 'Inactive', updated_at: new Date().toISOString() }).eq('id', o.id);
          if (r.error) throw r.error;
        }
      }
      const r = await supabase.from('cnc_part_routings').update({ status: 'Active', updated_at: new Date().toISOString() }).eq('id', headerId);
      if (r.error) throw r.error;
      await load();
      setEditorOpen(false);
      setConfirmToggle(null);
    } catch (e: any) {
      alert('Activation failed: ' + (e?.message ?? e));
    } finally {
      setBusyId(null);
    }
  };

  const setInactive = async (h: any) => {
    setBusyId(String(h.id));
    try {
      const r = await supabase.from('cnc_part_routings').update({ status: 'Inactive', updated_at: new Date().toISOString() }).eq('id', h.id);
      if (r.error) throw r.error;
      await load();
      setConfirmToggle(null);
    } catch (e: any) {
      alert('Failed: ' + (e?.message ?? e));
    } finally {
      setBusyId(null);
    }
  };

  const newRevision = async (h: any) => {
    if (saving) return;
    setSaving(true);
    try {
      const same = headers.filter((x) => x.product_code === h.product_code);
      const rev = Math.max(...same.map((x) => Number(x.revision) || 0)) + 1;
      const ins = await supabase.from('cnc_part_routings').insert([{
        product_code: h.product_code,
        product_name: h.product_name ?? '',
        revision: rev,
        effective_from: todayISO(),
        status: 'Draft',
        notes: '',
        created_by: userName || null,
        updated_at: new Date().toISOString(),
      }]).select('id').single();
      if (ins.error) throw ins.error;
      const newId = ins.data.id;
      let steps = stepsByRouting[String(h.id)];
      if (!steps) {
        const s = await supabase.from('cnc_part_routing_steps').select('*').eq('routing_id', h.id).order('sequence');
        steps = s.error ? [] : (s.data ?? []);
      }
      if ((steps ?? []).length > 0) {
        await insertTolerant('cnc_part_routing_steps', (steps ?? []).map((s: any) => ({
          routing_id: newId,
          sequence: Number(s.sequence),
          process_id: s.process_id ?? null,
          process_code: s.process_code ?? '',
          process_name: s.process_name ?? '',
          process_category: s.process_category ?? null,
          machine: s.machine ?? null,
          setup_time: Number(s.setup_time) || 0,
          cycle_time: Number(s.cycle_time) || 0,
          cost_per_hour: Number(s.cost_per_hour) || 0,
          cost_per_component: Number(s.cost_per_component) || 0,
          standard_qty: Number(s.standard_qty) || 0,
          instructions: s.instructions ?? null,
        })));
      }
      await load();
      const created = { ...(h as any), id: newId, revision: rev, status: 'Draft' };
      await openEdit(created);
    } catch (e: any) {
      alert('New revision failed: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async () => {
    const h = confirmDelete;
    if (!h) return;
    setBusyId(String(h.id));
    try {
      await supabase.from('cnc_part_routing_steps').delete().eq('routing_id', h.id);
      const r = await supabase.from('cnc_part_routings').delete().eq('id', h.id);
      if (r.error) throw r.error;
      await load();
      setConfirmDelete(null);
    } catch (e: any) {
      alert('Delete failed: ' + (e?.message ?? e));
    } finally {
      setBusyId(null);
    }
  };

  const viewHeader = viewId ? headers.find((h) => String(h.id) === String(viewId)) : null;
  const viewSteps: any[] = viewId ? (stepsByRouting[String(viewId)] ?? []) : [];
  const viewHistory = viewHeader
    ? headers.filter((h) => h.product_code === viewHeader.product_code).sort((a, b) => Number(b.revision) - Number(a.revision))
    : [];

  const columns: Column<any>[] = [
    { key: 'product_code', label: 'Product Code', sortable: true, render: (r) => <span className="font-mono text-xs font-semibold text-slate-700">{r.product_code}</span> },
    { key: 'product_name', label: 'Product Name', sortable: true },
    {
      key: 'revision', label: 'Rev', sortable: true, align: 'right',
      render: (r) => <span className="font-mono font-bold">R{r.revision}</span>,
    },
    { key: 'opsCount', label: 'Operations', sortable: true, align: 'right' },
    { key: 'effective_from', label: 'Effective From', sortable: true, render: (r) => String(r.effective_from || '—').slice(0, 10) },
    {
      key: 'status', label: 'Status', sortable: true,
      render: (r) => <Badge variant={statusBadge(r.status) as any} dot>{r.status}</Badge>,
    },
    { key: 'updated_at', label: 'Updated At', sortable: true, render: (r) => String(r.updated_at || r.created_at || '').slice(0, 10) },
    {
      key: '__actions', label: 'Actions', align: 'right',
      render: (r) => (
        <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button title="View detail" onClick={() => setViewId(String(r.id))} className="p-1 text-slate-400 hover:text-brand-600"><Eye size={15} /></button>
          <button title="Edit" onClick={() => void openEdit(r)} className="p-1 text-slate-400 hover:text-blue-600"><Pencil size={15} /></button>
          <button title="New revision" onClick={() => void newRevision(r)} className="p-1 text-slate-400 hover:text-violet-600"><GitBranch size={15} /></button>
          {r.status !== 'Active'
            ? <button title="Activate" disabled={busyId === String(r.id)} onClick={() => setConfirmToggle({ h: r, to: 'Active' })} className="p-1 text-slate-400 hover:text-emerald-600 disabled:opacity-40"><CheckCheck size={15} /></button>
            : <button title="Set inactive" disabled={busyId === String(r.id)} onClick={() => setConfirmToggle({ h: r, to: 'Inactive' })} className="p-1 text-slate-400 hover:text-amber-600 disabled:opacity-40"><Ban size={15} /></button>}
          {r.status === 'Draft' && (
            <button title="Delete draft" onClick={() => setConfirmDelete(r)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
          )}
        </span>
      ),
    },
  ];

  if (routingsMissing) {
    return (
      <div className="p-4">
        <Card className="p-8 text-center text-sm text-slate-500">
          Part Routing storage is not provisioned yet. Apply{' '}
          <span className="font-mono">supabase/migrations/20260929020000_part_routing.sql</span> to the database first.
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4">
      <PageHeader
        title="Part Routing"
        description="Define the standard manufacturing operations for each product."
        actions={<Button icon={<Plus size={14} />} onClick={() => openCreate()}>Create Routing</Button>}
      />
      {processesMissing && (
        <Card className="p-3 mt-3 border border-amber-200 bg-amber-50 text-xs text-amber-800">
          Process Master is not provisioned — no process can be selected until{' '}
          <span className="font-mono">cnc_processes</span> exists. Routing steps cannot be added.
        </Card>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 mb-3">
        <FormField label="Status filter">
          <select className={inputClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {['All', ...ROUTING_STATUSES].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="Product filter">
          <select className={inputClass} value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
            <option value="All">All Products</option>
            {productsWithRoutings.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </FormField>
      </div>
      {loading ? (
        <Card className="p-12 text-center text-sm text-slate-500">Loading routings…</Card>
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          searchKeys={['product_code', 'product_name']}
          title="Routings"
        />
      )}

      {/* ---------- editor ---------- */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editId ? 'Edit Routing' : 'Create Routing'}
        subtitle={form.product_code ? `${form.product_code} · Rev ${form.revision || '?'}` : 'New standard routing'}
        size="3xl"
        footer={
          <>
            <span className="flex-1" />
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button variant="secondary" disabled={saving} onClick={() => void persist(form.status)}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {form.status !== 'Active' && (
              <Button icon={<CheckCheck size={14} />} disabled={saving} onClick={() => void persist('Active')}>
                {saving ? 'Saving…' : 'Save & Activate'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <FormSection title="Section 1 — Product">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <FormField label="Product" required>
                <select className={inputClass} value={form.product_code} disabled={!!editId} onChange={(e) => handleProductSelect(e.target.value)}>
                  <option value="">Select Product…</option>
                  {parts.map((p) => <option key={p.part_no} value={p.part_no}>{p.part_no} — {p.part_name}</option>)}
                </select>
              </FormField>
              <FormField label="Product Code"><input className={`${inputClass} bg-slate-50`} readOnly value={form.product_code} placeholder="Auto-filled" /></FormField>
              <FormField label="Product Name"><input className={`${inputClass} bg-slate-50`} readOnly value={form.product_name} placeholder="Auto-filled" /></FormField>
              <FormField label="Revision" required>
                <input type="number" min={1} step={1} className={inputClass} value={form.revision} onChange={(e) => setForm({ ...form, revision: e.target.value })} />
              </FormField>
              <FormField label="Effective From">
                <input type="date" className={inputClass} value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              </FormField>
              <FormField label="Status">
                <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {ROUTING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FormField>
              <div className="col-span-2 md:col-span-3">
                <FormField label="Notes"><input className={inputClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes for this revision…" /></FormField>
              </div>
            </div>
          </FormSection>

          <FormSection title="Section 2 — Operations">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <p className="text-xs text-slate-500">Sequence follows 10 / 20 / 30… Process and machine come from masters only.</p>
              <span className="flex-1" />
              <FormField label="Preview qty">
                <input type="number" min={0} className={`${inputClass} !w-24`} value={previewQty} onChange={(e) => setPreviewQty(e.target.value)} />
              </FormField>
              <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={addRow} disabled={processesMissing || activeProcesses.length === 0}>
                Add Operation
              </Button>
            </div>
            {opRows.length === 0 && (
              <p className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
                No operations yet. Add at least one operation before activation.
              </p>
            )}
            <div className="space-y-3">
              {[...opRows].sort((a, b) => a.sequence - b.sequence).map((r, i, arr) => {
                const proc = processes.find((p) => String(p.id) === String(r.process_id ?? ''));
                const est = routingOpCost(r, previewN);
                return (
                  <div key={r.key} className="border border-slate-200 rounded-xl p-3 bg-white">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="min-w-[3rem] text-center rounded-lg bg-navy-900 text-white text-xs font-bold px-2 py-1 font-mono">{r.sequence}</span>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Operation {i + 1}</span>
                      {proc?.process_category && <Badge variant="info">{proc.process_category}</Badge>}
                      <span className="flex-1" />
                      <span className="text-xs font-bold text-brand-700 tabular-nums">Est. {money(est)}</span>
                      <button onClick={() => moveRow(r.key, -1)} disabled={i === 0} title="Move up" className="p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30"><ChevronUp size={15} /></button>
                      <button onClick={() => moveRow(r.key, 1)} disabled={i === arr.length - 1} title="Move down" className="p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30"><ChevronDown size={15} /></button>
                      <button onClick={() => setOpRows((list) => list.filter((x) => x.key !== r.key))} title="Remove operation" className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="col-span-2 md:col-span-1">
                        <FormField label="Process" required>
                          <select value={r.process_id ?? ''} onChange={(e) => handleProcessSelect(r.key, e.target.value)} className={inputClass}>
                            <option value="">Select process…</option>
                            {activeProcesses.map((p) => (
                              <option key={p.id} value={p.id}>{p.process_code} — {p.process_name}</option>
                            ))}
                          </select>
                        </FormField>
                      </div>
                      <FormField label="Machine">
                        <select value={r.machine} onChange={(e) => updateRow(r.key, { machine: e.target.value })} className={inputClass}>
                          <option value="">No machine</option>
                          {machines.map((m) => <option key={m.code} value={m.code}>{m.code}{m.name ? ` — ${m.name}` : ''}</option>)}
                        </select>
                      </FormField>
                      <FormField label="Setup Time (min)">
                        <input type="number" min={0} step={0.5} value={r.setup_time} onChange={(e) => updateRow(r.key, { setup_time: e.target.value as any })} className={inputClass} />
                      </FormField>
                      <FormField label="Cycle Time (min / unit)">
                        <input type="number" min={0} step={0.1} value={r.cycle_time} onChange={(e) => updateRow(r.key, { cycle_time: e.target.value as any })} className={inputClass} />
                      </FormField>
                      <FormField label="Cost Per Hour (₹)">
                        <input type="number" min={0} value={r.cost_per_hour} placeholder={proc ? String(Number(proc.cost_per_hour) || 0) : '0'} onChange={(e) => updateRow(r.key, { cost_per_hour: e.target.value as any })} className={inputClass} />
                      </FormField>
                      <FormField label="Cost Per Component (₹)">
                        <input type="number" min={0} value={r.cost_per_component} placeholder={proc ? String(Number(proc.cost_per_component) || 0) : '0'} onChange={(e) => updateRow(r.key, { cost_per_component: e.target.value as any })} className={inputClass} />
                      </FormField>
                      <FormField label="Standard Quantity">
                        <input type="number" min={0} value={r.standard_qty} onChange={(e) => updateRow(r.key, { standard_qty: e.target.value as any })} className={inputClass} />
                      </FormField>
                      <FormField label="Sequence">
                        <input type="number" min={1} step={1} value={r.sequence} onChange={(e) => updateRow(r.key, { sequence: Number(e.target.value) })} className={inputClass} />
                      </FormField>
                      <div className="col-span-2 md:col-span-4">
                        <FormField label="Instructions / Notes">
                          <input value={r.instructions} onChange={(e) => updateRow(r.key, { instructions: e.target.value })} placeholder="Setup notes, tooling, fixtures…" className={inputClass} />
                        </FormField>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {opRows.length > 0 && (
              <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
                <span>Total Setup Time: <b className="tabular-nums">{totals.setup} min</b></span>
                <span>Total Cycle Time: <b className="tabular-nums">{totals.cycle} min/unit</b></span>
                <span>Total Routing Cost (qty {previewN}): <b className="tabular-nums text-brand-700">{money(totals.cost)}</b></span>
              </div>
            )}
          </FormSection>

          {errors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-bold mb-1">Resolve before saving:</p>
              <ul className="list-disc ml-5 space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
        </div>
      </Modal>

      {/* ---------- detail ---------- */}
      <Modal
        open={!!viewHeader}
        onClose={() => setViewId(null)}
        title={viewHeader ? `${viewHeader.product_code} · Rev ${viewHeader.revision}` : 'Routing Detail'}
        subtitle={viewHeader?.product_name ?? ''}
        size="2xl"
        footer={
          <>
            <span className="flex-1" />
            <Button variant="secondary" icon={<Pencil size={14} />} onClick={() => { if (viewHeader) { setViewId(null); void openEdit(viewHeader); } }}>Edit</Button>
            <Button variant="secondary" icon={<Copy size={14} />} onClick={() => { if (viewHeader) { setViewId(null); void newRevision(viewHeader); } }}>New Revision</Button>
            <Button variant="secondary" onClick={() => setViewId(null)}>Close</Button>
          </>
        }
      >
        {viewHeader && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Product</p><p className="font-semibold">{viewHeader.product_name || '—'}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Revision</p><p className="font-mono font-bold">R{viewHeader.revision}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Status</p><p><Badge variant={statusBadge(viewHeader.status) as any} dot>{viewHeader.status}</Badge></p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Effective From</p><p className="font-semibold">{String(viewHeader.effective_from || '—').slice(0, 10)}</p></div>
            </div>
            {viewHeader.notes && <p className="text-xs text-slate-500">{viewHeader.notes}</p>}
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs min-w-[760px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
                    <th className="p-2 text-left">Seq</th><th className="p-2 text-left">Process</th><th className="p-2 text-left">Machine</th>
                    <th className="p-2 text-right">Setup</th><th className="p-2 text-right">Cycle</th>
                    <th className="p-2 text-right">Cost/Hour</th><th className="p-2 text-right">Cost/Comp</th>
                    <th className="p-2 text-right">Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {[...viewSteps].sort((a, b) => Number(a.sequence) - Number(b.sequence)).map((s: any) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="p-2 font-mono font-bold">{s.sequence}</td>
                      <td className="p-2 font-medium">{s.process_name || s.process_code || '—'}</td>
                      <td className="p-2 font-mono">{s.machine || '—'}</td>
                      <td className="p-2 text-right tabular-nums">{Number(s.setup_time) || 0}</td>
                      <td className="p-2 text-right tabular-nums">{Number(s.cycle_time) || 0}</td>
                      <td className="p-2 text-right tabular-nums">{money(Number(s.cost_per_hour) || 0)}</td>
                      <td className="p-2 text-right tabular-nums">{money(Number(s.cost_per_component) || 0)}</td>
                      <td className="p-2 text-right tabular-nums font-bold">
                        {money(routingOpCost({ setup_time: Number(s.setup_time), cycle_time: Number(s.cycle_time), cost_per_hour: Number(s.cost_per_hour), cost_per_component: Number(s.cost_per_component) }, Math.max(0, Number(s.standard_qty) || 0)))}
                      </td>
                    </tr>
                  ))}
                  {viewSteps.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-400">No operations in this revision.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
              <span>Total Operations: <b>{viewSteps.length}</b></span>
              <span>Total Setup Time: <b className="tabular-nums">{viewSteps.reduce((s: number, x: any) => s + (Number(x.setup_time) || 0), 0)} min</b></span>
              <span>Total Cycle Time: <b className="tabular-nums">{viewSteps.reduce((s: number, x: any) => s + (Number(x.cycle_time) || 0), 0)} min/unit</b></span>
              <span>Estimated Routing Cost: <b className="tabular-nums text-brand-700">{money(viewSteps.reduce((s: number, x: any) => s + routingOpCost({ setup_time: Number(x.setup_time), cycle_time: Number(x.cycle_time), cost_per_hour: Number(x.cost_per_hour), cost_per_component: Number(x.cost_per_component) }, Math.max(0, Number(x.standard_qty) || 0)), 0))}</b></span>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Revision history — {viewHeader.product_code}</p>
              <div className="space-y-1">
                {viewHistory.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => setViewId(String(h.id))}
                    className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-xs hover:border-brand-300 ${String(h.id) === String(viewHeader.id) ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200'}`}
                  >
                    <span className="font-mono font-bold">R{h.revision}</span>
                    <Badge variant={statusBadge(h.status) as any} dot>{h.status}</Badge>
                    <span className="text-slate-500">Eff. {String(h.effective_from || '—').slice(0, 10)}</span>
                    <span className="flex-1" />
                    <span className="text-slate-400">{(stepsByRouting[String(h.id)] ?? []).length} ops</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={() => {
          if (!confirmToggle) return;
          if (confirmToggle.to === 'Active') {
            const steps = stepsByRouting[String(confirmToggle.h.id)] ?? [];
            if (steps.length === 0) { alert('Add at least one operation before activation.'); setConfirmToggle(null); return; }
            void setActive(String(confirmToggle.h.id));
          } else {
            void setInactive(confirmToggle.h);
          }
        }}
        title={confirmToggle?.to === 'Active' ? 'Activate Routing' : 'Set Routing Inactive'}
        message={confirmToggle?.to === 'Active'
          ? `Activate ${confirmToggle?.h.product_code} Rev ${confirmToggle?.h.revision}? Any other Active revision of this product retires to Inactive. Existing work orders keep their own operations.`
          : `Set ${confirmToggle?.h.product_code} Rev ${confirmToggle?.h.revision} to Inactive? New work orders will no longer offer it.`}
        confirmLabel={confirmToggle?.to === 'Active' ? 'Activate' : 'Set Inactive'}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => void deleteDraft()}
        title="Delete Draft Routing"
        message={`Delete ${confirmDelete?.product_code} Rev ${confirmDelete?.revision}? Only drafts can be deleted; history is preserved.`}
        confirmLabel="Delete Draft"
        danger
      />
    </div>
  );
}

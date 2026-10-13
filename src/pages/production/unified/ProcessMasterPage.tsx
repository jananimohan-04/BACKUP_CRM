import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { formatINR } from '@/lib/format';
import { StatCard, Badge, Button, statusToVariant } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal, FormField, FormSection, ConfirmDialog, inputClass } from '@/components/ui/Modal';
import {
  Cog, CheckCircle, XCircle, IndianRupee,
  Plus, Pencil, Copy, Power, Trash2, X,
} from 'lucide-react';

// Master record. Other production modules (Work Orders, Scheduling, Machine Log,
// Process Costing, Finished Goods) reference a process by its stable processCode
// (unique per company), never by duplicating the name inside transactions.
export interface ProcessMaster {
  id: string;
  processCode: string;
  processName: string;
  processCategory: string;
  machineType: string;
  description: string;
  costPerHour: number;
  costPerComponent: number;
  setupCost: number;
  minimumCharge: number;
  status: 'Active' | 'Inactive';
  notes: string;
  createdAt: string;
}

interface ProcessForm {
  processCode: string;
  processName: string;
  processCategory: string;
  machineType: string;
  description: string;
  costPerHour: string;
  costPerComponent: string;
  setupCost: string;
  minimumCharge: string;
  status: 'Active' | 'Inactive';
  notes: string;
}

const EMPTY_FORM: ProcessForm = {
  processCode: '',
  processName: '',
  processCategory: '',
  machineType: '',
  description: '',
  costPerHour: '',
  costPerComponent: '',
  setupCost: '',
  minimumCharge: '',
  status: 'Active',
  notes: '',
};

function mapRow(r: any): ProcessMaster {
  return {
    id: r.id,
    processCode: r.process_code ?? '',
    processName: r.process_name ?? '',
    processCategory: r.process_category ?? '',
    machineType: r.machine_type ?? '',
    description: r.description ?? '',
    costPerHour: Number(r.cost_per_hour) || 0,
    costPerComponent: Number(r.cost_per_component) || 0,
    setupCost: Number(r.setup_cost) || 0,
    minimumCharge: Number(r.minimum_charge) || 0,
    status: r.status === 'Inactive' ? 'Inactive' : 'Active',
    notes: r.notes ?? '',
    createdAt: r.created_at ?? '',
  };
}

export function ProcessMasterPage() {
  const [processes, setProcesses] = useState<ProcessMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState('All Categories');
  const [machineFilter, setMachineFilter] = useState('All Machine Types');

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProcessForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ProcessMaster | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setTableMissing(false);
    try {
      const { data, error } = await supabase
        .from('cnc_processes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        // PGRST205 = table not in schema cache (migration not applied yet)
        if ((error as any).code === 'PGRST205') setTableMissing(true);
        else console.error('Failed to load processes:', error);
        setProcesses([]);
      } else {
        setProcesses((data ?? []).map(mapRow));
      }
    } catch (err) {
      console.error('Failed to load processes:', err);
      setProcesses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(processes.map((p) => p.processCategory).filter(Boolean))).sort(),
    [processes]
  );
  const machineTypes = useMemo(
    () => Array.from(new Set(processes.map((p) => p.machineType).filter(Boolean))).sort(),
    [processes]
  );

  const filtered = useMemo(() => {
    return processes.filter((p) => {
      if (categoryFilter !== 'All Categories' && p.processCategory !== categoryFilter) return false;
      if (machineFilter !== 'All Machine Types' && p.machineType !== machineFilter) return false;
      return true;
    });
  }, [processes, categoryFilter, machineFilter]);

  const stats = useMemo(() => {
    const total = processes.length;
    const active = processes.filter((p) => p.status === 'Active').length;
    const inactive = total - active;
    const avg = total === 0 ? 0 : processes.reduce((s, p) => s + p.costPerHour, 0) / total;
    return { total, active, inactive, avg };
  }, [processes]);

  const clearFilters = () => {
    setCategoryFilter('All Categories');
    setMachineFilter('All Machine Types');
  };

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setShowForm(true);
  };

  const openEdit = (row: ProcessMaster) => {
    setEditId(row.id);
    setForm({
      processCode: row.processCode,
      processName: row.processName,
      processCategory: row.processCategory,
      machineType: row.machineType,
      description: row.description,
      costPerHour: String(row.costPerHour),
      costPerComponent: row.costPerComponent ? String(row.costPerComponent) : '',
      setupCost: row.setupCost ? String(row.setupCost) : '',
      minimumCharge: row.minimumCharge ? String(row.minimumCharge) : '',
      status: row.status,
      notes: row.notes,
    });
    setErrors({});
    setShowForm(true);
  };

  const openDuplicate = (row: ProcessMaster) => {
    setEditId(null);
    setForm({
      processCode: `${row.processCode}-COPY`,
      processName: `${row.processName} (Copy)`,
      processCategory: row.processCategory,
      machineType: row.machineType,
      description: row.description,
      costPerHour: String(row.costPerHour),
      costPerComponent: row.costPerComponent ? String(row.costPerComponent) : '',
      setupCost: row.setupCost ? String(row.setupCost) : '',
      minimumCharge: row.minimumCharge ? String(row.minimumCharge) : '',
      status: 'Active',
      notes: row.notes,
    });
    setErrors({});
    setShowForm(true);
  };

  const set = (key: keyof ProcessForm, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const parseCost = (value: string): number | null => {
    if (value.trim() === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return NaN as unknown as null;
    return n;
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    const code = form.processCode.trim();
    const name = form.processName.trim();

    if (!code) next.processCode = 'Process Code is required.';
    else if (
      processes.some(
        (p) => p.processCode.toLowerCase() === code.toLowerCase() && p.id !== editId
      )
    ) {
      next.processCode = 'This Process Code already exists. Use a unique code.';
    }

    if (!name) next.processName = 'Process Name is required.';

    const cph = parseCost(form.costPerHour);
    if (form.costPerHour.trim() === '') next.costPerHour = 'Cost Per Hour is required.';
    else if (cph === null || !Number.isFinite(cph as number)) next.costPerHour = 'Cost Per Hour must be a number.';
    else if ((cph as number) < 0) next.costPerHour = 'Cost Per Hour cannot be negative.';

    const optionals: (keyof ProcessForm)[] = ['costPerComponent', 'setupCost', 'minimumCharge'];
    const labels: Record<string, string> = {
      costPerComponent: 'Cost Per Component',
      setupCost: 'Setup Cost',
      minimumCharge: 'Minimum Charge',
    };
    for (const key of optionals) {
      if (form[key].trim() === '') continue;
      const n = parseCost(form[key]);
      if (n === null || !Number.isFinite(n as number)) next[key] = `${labels[key]} must be a number.`;
      else if ((n as number) < 0) next[key] = `${labels[key]} cannot be negative.`;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || saving) return;
    setSaving(true);
    try {
      const payload = {
        process_code: form.processCode.trim(),
        process_name: form.processName.trim(),
        process_category: form.processCategory.trim() || null,
        machine_type: form.machineType.trim() || null,
        description: form.description.trim() || null,
        cost_per_hour: Number(form.costPerHour),
        cost_per_component: form.costPerComponent.trim() === '' ? 0 : Number(form.costPerComponent),
        setup_cost: form.setupCost.trim() === '' ? 0 : Number(form.setupCost),
        minimum_charge: form.minimumCharge.trim() === '' ? 0 : Number(form.minimumCharge),
        status: form.status,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (editId) {
        const { error } = await supabase.from('cnc_processes').update(payload).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('cnc_processes').insert([{ id: crypto.randomUUID(), ...payload }]);
        if (error) throw error;
      }
      setShowForm(false);
      fetchData();
    } catch (err: any) {
      // Unique-violation backstop (in case of a race with another user)
      if (err?.code === '23505') {
        setErrors({ processCode: 'This Process Code already exists. Use a unique code.' });
      } else {
        alert('Failed to save process: ' + (err?.message ?? err));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (row: ProcessMaster) => {
    try {
      const next = row.status === 'Active' ? 'Inactive' : 'Active';
      const { error } = await supabase
        .from('cnc_processes')
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) throw error;
      fetchData();
    } catch (err: any) {
      alert('Failed to update status: ' + (err?.message ?? err));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from('cnc_processes').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      fetchData();
    } catch (err: any) {
      alert('Failed to delete process: ' + (err?.message ?? err));
    }
  };

  const columns: Column<ProcessMaster>[] = [
    {
      key: 'processCode',
      label: 'Process Code',
      sortable: true,
      render: (r) => <span className="font-mono text-xs font-semibold text-slate-700">{r.processCode}</span>,
    },
    {
      key: 'processName',
      label: 'Process Name',
      sortable: true,
      render: (r) => <span className="font-semibold text-slate-800">{r.processName}</span>,
    },
    {
      key: 'processCategory',
      label: 'Process Category',
      sortable: true,
      render: (r) => (r.processCategory ? <Badge variant="neutral">{r.processCategory}</Badge> : <span className="text-slate-300">—</span>),
    },
    {
      key: 'machineType',
      label: 'Machine Type',
      sortable: true,
      render: (r) => (r.machineType ? <span className="text-slate-600">{r.machineType}</span> : <span className="text-slate-300">—</span>),
    },
    {
      key: 'costPerHour',
      label: 'Cost / Hour',
      sortable: true,
      align: 'right',
      render: (r) => (
        <span className="font-semibold text-slate-800 whitespace-nowrap">
          {formatINR(r.costPerHour)}<span className="text-xs font-medium text-slate-400">/hour</span>
        </span>
      ),
    },
    {
      key: 'costPerComponent',
      label: 'Cost / Component',
      sortable: true,
      align: 'right',
      render: (r) => <span className="text-slate-600 whitespace-nowrap">{formatINR(r.costPerComponent)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (r) => (
        <Badge variant={statusToVariant(r.status)} dot>
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => openEdit(r)}
            title="Edit process"
            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => openDuplicate(r)}
            title="Duplicate process"
            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
          >
            <Copy size={15} />
          </button>
          <button
            onClick={() => handleToggleStatus(r)}
            title={r.status === 'Active' ? 'Deactivate process' : 'Activate process'}
            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
          >
            <Power size={15} />
          </button>
          <button
            onClick={() => setDeleteTarget(r)}
            title="Delete process"
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  const errText = (key: string) =>
    errors[key] ? <p className="text-xs font-medium text-red-600 mt-1">{errors[key]}</p> : null;

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-full">
      <PageHeader
        title="Process Master"
        description="Define and manage manufacturing processes, machine operations and process costing."
        actions={
          <Button icon={<Plus size={15} />} onClick={openAdd}>
            Add Process
          </Button>
        }
      />

      {tableMissing && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <span className="font-bold">Setup required: </span>
          the <span className="font-mono">cnc_processes</span> table does not exist yet. Apply{' '}
          <span className="font-mono">supabase/migrations/20260927000000_process_master.sql</span> to
          the database, then refresh this page.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Processes" value={String(stats.total)} icon={<Cog size={20} />} accent="navy" />
        <StatCard label="Active Processes" value={String(stats.active)} icon={<CheckCircle size={20} />} accent="success" />
        <StatCard label="Inactive Processes" value={String(stats.inactive)} icon={<XCircle size={20} />} accent="neutral" />
        <StatCard label="Average Cost / Hour" value={formatINR(Math.round(stats.avg * 100) / 100)} icon={<IndianRupee size={20} />} accent="brand" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-2.5 mb-2.5 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px]">
          <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
            Process Category
          </label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className={inputClass}
          >
            <option>All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px]">
          <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
            Machine Type
          </label>
          <select
            value={machineFilter}
            onChange={(e) => setMachineFilter(e.target.value)}
            className={inputClass}
          >
            <option>All Machine Types</option>
            {machineTypes.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        {(categoryFilter !== 'All Categories' || machineFilter !== 'All Machine Types') && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
          >
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-slate-200 border-t-brand-500 rounded-full animate-spin" style={{ borderWidth: '3px' }} />
            <p className="text-sm text-slate-400">Loading processes...</p>
          </div>
        </div>
      ) : (
        <DataTable<ProcessMaster>
          data={filtered}
          columns={columns}
          title="Processes"
          searchKeys={['processCode', 'processName', 'processCategory', 'machineType', 'description']}
          filterOptions={[
            { label: 'Active', value: 'Active' },
            { label: 'Inactive', value: 'Inactive' },
          ]}
          emptyMessage={tableMissing ? 'Process table not provisioned yet' : 'No processes found'}
        />
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? 'Edit Process' : 'Add Process'}
        subtitle={editId ? 'Update the process details and costing rates.' : 'Define a new manufacturing process and its costing rates.'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Process'}
            </Button>
          </>
        }
      >
        <FormSection title="Process Information">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FormField label="Process Code" required>
                <input
                  value={form.processCode}
                  onChange={(e) => set('processCode', e.target.value.toUpperCase())}
                  placeholder="e.g. C10"
                  className={`${inputClass} font-mono ${errors.processCode ? 'border-red-400' : ''}`}
                />
              </FormField>
              {errText('processCode')}
            </div>
            <div>
              <FormField label="Process Name" required>
                <input
                  value={form.processName}
                  onChange={(e) => set('processName', e.target.value)}
                  placeholder="e.g. 4 Axis Machining"
                  className={`${inputClass} ${errors.processName ? 'border-red-400' : ''}`}
                />
              </FormField>
              {errText('processName')}
            </div>
            <div>
              <FormField label="Process Category">
                <input
                  value={form.processCategory}
                  onChange={(e) => set('processCategory', e.target.value)}
                  placeholder="e.g. CNC Machining"
                  list="process-category-list"
                  className={inputClass}
                />
                <datalist id="process-category-list">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </FormField>
            </div>
            <div>
              <FormField label="Machine Type">
                <input
                  value={form.machineType}
                  onChange={(e) => set('machineType', e.target.value)}
                  placeholder="e.g. 4 Axis CNC"
                  list="process-machine-list"
                  className={inputClass}
                />
                <datalist id="process-machine-list">
                  {machineTypes.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </FormField>
            </div>
            <div className="md:col-span-2">
              <FormField label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="What does this process / operation cover?"
                  rows={2}
                  className={inputClass}
                />
              </FormField>
            </div>
          </div>
        </FormSection>

        <FormSection title="Costing">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FormField label="Cost Per Hour (₹)" required hint="Machine-hour rate used for future process costing.">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.costPerHour}
                  onChange={(e) => set('costPerHour', e.target.value)}
                  placeholder="e.g. 500"
                  className={`${inputClass} ${errors.costPerHour ? 'border-red-400' : ''}`}
                />
              </FormField>
              {errText('costPerHour')}
            </div>
            <div>
              <FormField label="Cost Per Component (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.costPerComponent}
                  onChange={(e) => set('costPerComponent', e.target.value)}
                  placeholder="e.g. 0"
                  className={`${inputClass} ${errors.costPerComponent ? 'border-red-400' : ''}`}
                />
              </FormField>
              {errText('costPerComponent')}
            </div>
            <div>
              <FormField label="Setup Cost (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.setupCost}
                  onChange={(e) => set('setupCost', e.target.value)}
                  placeholder="e.g. 0"
                  className={`${inputClass} ${errors.setupCost ? 'border-red-400' : ''}`}
                />
              </FormField>
              {errText('setupCost')}
            </div>
            <div>
              <FormField label="Minimum Charge (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minimumCharge}
                  onChange={(e) => set('minimumCharge', e.target.value)}
                  placeholder="e.g. 0"
                  className={`${inputClass} ${errors.minimumCharge ? 'border-red-400' : ''}`}
                />
              </FormField>
              {errText('minimumCharge')}
            </div>
          </div>
        </FormSection>

        <FormSection title="Configuration">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Status">
              <select value={form.status} onChange={(e) => set('status', e.target.value)} className={inputClass}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </FormField>
            <div className="md:col-span-2">
              <FormField label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Internal notes about this process."
                  rows={2}
                  className={inputClass}
                />
              </FormField>
            </div>
          </div>
        </FormSection>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Process"
        message={`Delete process "${deleteTarget?.processCode} — ${deleteTarget?.processName}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

export { ProductionMainPage as ProductionPlanningPage } from './unified/ProductionMainPage';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { Eye, Edit, Trash2, Cog, ClipboardList, Gauge, Package, Activity, Calendar } from 'lucide-react';
import { PageHeader, FilterButton, ExportButton, DateSelector, SectionCard } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Card, Badge, Button, StatCard, ProgressBar, statusToVariant, priorityToVariant } from '@/components/ui/Card';
import { Modal, FormField, FormSection, inputClass, ConfirmDialog } from '@/components/ui/Modal';
import { BarChart, ChartCard, GaugeChart } from '@/components/ui/Charts';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
// Mock data is only referenced by the unrouted legacy pages (OldProductionPlanningPage, MachineSchedulingPage)
import { workOrders, machines, productionTrend } from '@/data/mockData';
import type { WorkOrder, JobCard, Machine } from '@/data/mockData';

// Canonical statuses (see cnc_work_orders / cnc_job_cards)
const WO_STATUSES = ['Planning', 'In Progress', 'On Hold', 'Completed', 'Dispatched'];
type JobCardStatus = 'Planned' | 'In Progress' | 'On Hold' | 'Completed';
const JOB_STATUSES: JobCardStatus[] = ['Planned', 'In Progress', 'On Hold', 'Completed'];

// Shape of a cnc_job_cards row as used by the live pages (the mock JobCard type has different statuses/fields)
type JobCardRow = Omit<JobCard, 'status' | 'cncProgram' | 'startDate'> & {
  id: string;
  status: JobCardStatus | string;
  cncProgram?: string;
  startDate?: string;
  createdAt?: string;
};

function mapJobCardRow(d: any): JobCardRow {
  const opNo = Number(d.op_no);
  return {
    id: d.id,
    jobNo: d.job_no,
    workOrder: d.work_order,
    partName: d.part_name,
    opNo: Number.isFinite(opNo) ? opNo : 0,
    operation: d.operation || '',
    machine: d.machine,
    operator: d.operator,
    qtyPlanned: Number(d.qty_planned) || 0,
    qtyCompleted: Number(d.qty_completed) || 0,
    qtyRejected: Number(d.qty_rejected) || 0,
    cycleTime: Number(d.cycle_time) || 0,
    setupTime: Number(d.setup_time) || 0,
    toolNo: d.tool_no,
    status: d.status,
    createdAt: d.created_at,
  };
}

// "Op 10 - Turning", tolerating job cards saved without an op number / operation
const formatOp = (opNo: number | null | undefined, operation?: string | null) =>
  [opNo ? `Op ${opNo}` : null, operation || null].filter(Boolean).join(' - ') || '—';

export function OldProductionPlanningPage() {
  const [woData, setWoData] = useState<WorkOrder[]>([]);
  const [machineStats, setMachineStats] = useState<{label: string, val: number}[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [overallCapacity, setOverallCapacity] = useState('0%');
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  useEffect(() => {
    async function fetchWOs() {
      try {
        const [woRes, machRes] = await Promise.all([
          supabase.from('cnc_work_orders').select('*').order('created_at', { ascending: false }),
          supabase.from('cnc_machines').select('type, utilization')
        ]);
        
        if (machRes.data) {
          const grouped = machRes.data.reduce((acc: any, m: any) => {
            const t = m.type || 'Other';
            acc[t] = acc[t] || { sum: 0, count: 0 };
            acc[t].sum += Number(m.utilization) || 0;
            acc[t].count += 1;
            return acc;
          }, {});
          const stats = Object.keys(grouped).map(type => ({
            label: type,
            val: Math.round(grouped[type].sum / grouped[type].count)
          }));
          setMachineStats(stats);
          
          if (machRes.data.length > 0) {
              const totalUtil = machRes.data.reduce((sum: number, m: any) => sum + (Number(m.utilization) || 0), 0);
              setOverallCapacity(Math.round(totalUtil / machRes.data.length) + '%');
          }
        }

        const { data, error } = woRes;
        if (error) {
          console.error('Error fetching WOs:', error);
          setDbError(true);
          setWoData(workOrders);
        } else if (data) {
          setDbError(false);
          const formattedData = data.map((d: any) => ({
            id: d.id,
            woNo: d.wo_no,
            partName: d.part_name,
            partNo: d.part_no,
            customer: d.customer,
            salesOrder: d.sales_order,
            quantity: Number(d.quantity),
            completed: Number(d.completed),
            rejected: Number(d.rejected),
            startDate: d.start_date,
            dueDate: d.due_date,
            status: d.status,
            priority: d.priority,
          }));
          setWoData(formattedData.length > 0 ? formattedData : workOrders);
          
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const monthCounts = data.reduce((acc: any, wo: any) => {
            if(!wo.created_at) return acc;
            const d = new Date(wo.created_at);
            const k = months[d.getMonth()];
            acc[k] = acc[k] || { name: k, planned: 0, completed: 0 };
            acc[k].planned++;
            if (wo.status === 'Completed') acc[k].completed++;
            return acc;
          }, {});
          const chart = [];
          const currentMonth = new Date().getMonth();
          for (let i = 6; i >= 0; i--) {
              let mIndex = currentMonth - i;
              if (mIndex < 0) mIndex += 12;
              const k = months[mIndex];
              chart.push(monthCounts[k] || { name: k, planned: 0, completed: 0 });
          }
          setChartData(chart);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchWOs();
  }, []);

  const handleInlineUpdate = async (id: string, field: 'priority' | 'status', value: string) => {
    try {
      const { error } = await supabase.from('cnc_work_orders').update({ [field]: value }).eq('id', id);
      if (error) {
        alert("Failed to update: " + error.message);
      } else {
        setWoData(prev => prev.map(w => w.id === id ? { ...w, [field]: value } : w));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const plannedOrders = woData.filter(w => w.status === 'Planning').length;
  const scheduledOrders = woData.filter(w => w.status === 'In Progress').length;
  // Calculate backlog days roughly based on incomplete items (mock calculation for dashboard)
  const totalIncomplete = woData.filter(w => w.status !== 'Completed').length;
  const backlogDays = totalIncomplete > 0 ? (totalIncomplete * 1.5).toFixed(1) : '0';

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Production Planning" description="Plan and schedule production orders" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /><DateSelector /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Planned Orders" value={plannedOrders.toString()} icon={<ClipboardList size={20} />} accent="brand" />
        <StatCard label="Scheduled" value={scheduledOrders.toString()} icon={<Calendar size={20} />} accent="success" />
        <StatCard label="Capacity Used" value={overallCapacity} icon={<Gauge size={20} />} accent="accent" />
        <StatCard label="Backlog (days)" value={backlogDays} icon={<ClipboardList size={20} />} accent="warning" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <ChartCard title="Planned vs Completed" subtitle="Last 7 months">
          <BarChart data={chartData.length > 0 ? chartData : productionTrend} series={[{ key: 'planned', color: '#c7d2fe', label: 'Planned' }, { key: 'completed', color: '#4f46e5', label: 'Completed' }]} height={220} />
        </ChartCard>
        <ChartCard title="Capacity Utilization" subtitle="By machine type">
          <div className="space-y-4">
            {(machineStats.length > 0 ? machineStats : [{ label: 'CNC Turning', val: 87 }, { label: 'CNC VMC', val: 92 }, { label: 'CNC HMC', val: 45 }, { label: '5-Axis', val: 78 }, { label: 'Grinding', val: 0 }, { label: 'Wire EDM', val: 81 }]).map((m) => (
              <div key={m.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-slate-600">{m.label}</span>
                  <span className="text-sm font-semibold text-slate-700">{m.val}%</span>
                </div>
                <ProgressBar value={m.val} color={m.val > 80 ? 'success' : m.val > 50 ? 'brand' : m.val > 0 ? 'warning' : 'error'} />
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
      <SectionCard title="Upcoming Production Schedule">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Part</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Company</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">Qty</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Start Date</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Due Date</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Priority</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {woData.filter((w) => w.status === 'Planning' || w.status === 'In Progress').map((w) => (
                <tr key={w.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3"><p className="text-sm text-slate-700">{w.partName}</p></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{w.customer}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-slate-700">{w.quantity}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{w.startDate}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{w.dueDate}</td>
                  <td className="px-4 py-3">
                    <select
                      className={`text-xs font-semibold rounded-full px-2 py-1 border border-transparent hover:border-slate-300 cursor-pointer outline-none focus:ring-2 focus:ring-brand-500/50 ${w.priority === 'Critical' ? 'bg-red-50 text-red-700' : w.priority === 'High' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}
                      value={w.priority}
                      onChange={(e) => handleInlineUpdate(w.id, 'priority', e.target.value)}
                    >
                      <option value="Normal">Normal</option>
                      <option value="High">High</option>
                      <option value="Critical">Critical</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className={`text-xs font-semibold rounded-full px-2 py-1 border border-transparent hover:border-slate-300 cursor-pointer outline-none focus:ring-2 focus:ring-brand-500/50 ${w.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : w.status === 'In Progress' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}
                      value={w.status}
                      onChange={(e) => handleInlineUpdate(w.id, 'status', e.target.value)}
                    >
                      <option value="Planning">Planning</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Completed">Completed</option>
                    </select>
                  </td>
                </tr>
              ))}
              {woData.filter((w) => w.status === 'Planning' || w.status === 'In Progress').length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">No upcoming production scheduled.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function WorkOrderDetailModal({ wo, onClose }: { wo: WorkOrder, onClose: () => void }) {
  const [operations, setOperations] = useState<JobCardRow[]>([]);

  useEffect(() => {
    supabase.from('cnc_job_cards').select('*').eq('work_order', wo.woNo).then(({ data, error }) => {
      if (error) console.error('Failed to load job cards for work order:', error);
      setOperations((data || []).map(mapJobCardRow).sort((a, b) => a.opNo - b.opNo));
    });
  }, [wo.woNo]);

  return (
    <Modal open={true} onClose={onClose} title={`Work Order Details`} subtitle={wo.partName} size="xl">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="space-y-4">
          <div><p className="text-xs text-slate-500 uppercase tracking-wider">Part</p><p className="font-semibold text-slate-800">{wo.partName}</p></div>
          <div><p className="text-xs text-slate-500 uppercase tracking-wider">Company</p><p className="text-sm text-slate-700">{wo.customer}</p></div>
          <div><p className="text-xs text-slate-500 uppercase tracking-wider">Sales Order</p><p className="text-sm font-mono text-slate-700">{wo.salesOrder}</p></div>
        </div>
        <div className="space-y-4">
          <div><p className="text-xs text-slate-500 uppercase tracking-wider">Quantity</p><p className="text-xl font-bold text-slate-800">{wo.quantity} <span className="text-sm font-normal text-slate-500">Nos</span></p></div>
          <div><p className="text-xs text-slate-500 uppercase tracking-wider">Completed</p><p className="text-sm font-medium text-green-600">{wo.completed}</p></div>
          <div><p className="text-xs text-slate-500 uppercase tracking-wider">Rejected</p><p className="text-sm font-medium text-red-600">{wo.rejected}</p></div>
        </div>
        <div className="space-y-4">
          <div><p className="text-xs text-slate-500 uppercase tracking-wider">Status</p><Badge variant={statusToVariant(wo.status)}>{wo.status}</Badge></div>
          <div><p className="text-xs text-slate-500 uppercase tracking-wider">Start Date</p><p className="text-sm text-slate-700">{wo.startDate}</p></div>
          <div><p className="text-xs text-slate-500 uppercase tracking-wider">Due Date</p><p className="text-sm text-slate-700">{wo.dueDate}</p></div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2 mb-4">Production Workflow</h3>
        <div className="flex items-center justify-between relative">
          <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-slate-200 -z-10 transform -translate-y-1/2"></div>
          {['Planning', 'Material Issued', 'Setup', 'Machining', 'Inspection', 'Completed'].map((step, i) => {
            let state = 'pending';
            if (wo.status === 'Completed') state = 'done';
            else if (wo.status === 'Planning' && i === 0) state = 'active';
            else if (wo.status === 'Planning' && i > 0) state = 'pending';
            else if (wo.status === 'In Progress') {
              if (i <= 3) state = 'done';
              if (i === 3) state = 'active'; // Machining active
            }
            return (
              <div key={step} className="flex flex-col items-center gap-2 bg-white px-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${state === 'done' ? 'bg-green-500 border-green-500 text-white' : state === 'active' ? 'bg-white border-brand-500 text-brand-600 ring-4 ring-brand-50' : 'bg-white border-slate-300 text-slate-400'}`}>
                  {state === 'done' ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium ${state === 'active' ? 'text-brand-700' : state === 'done' ? 'text-slate-700' : 'text-slate-400'}`}>{step}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2 mb-4">Operations Router</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="py-2 font-medium">Op</th>
                <th className="py-2 font-medium">Operation</th>
                <th className="py-2 font-medium">Machine</th>
                <th className="py-2 font-medium">Operator</th>
                <th className="py-2 font-medium">Qty</th>
                <th className="py-2 font-medium">Cycle</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {operations.length > 0 ? operations.map((op) => (
                <tr key={op.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="py-3 font-mono text-xs">{op.opNo ? `OP-${op.opNo}` : '—'}</td>
                  <td className="py-3 font-medium text-slate-700">{op.operation}</td>
                  <td className="py-3 font-mono text-xs text-brand-600">{op.machine}</td>
                  <td className="py-3 text-slate-600">{op.operator || '—'}</td>
                  <td className="py-3 font-medium">{op.qtyCompleted}/{op.qtyPlanned}</td>
                  <td className="py-3 text-slate-500">{op.cycleTime}m</td>
                  <td className="py-3"><Badge variant={statusToVariant(op.status)}>{op.status}</Badge></td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 border-2 border-dashed border-slate-100 rounded-lg">
                    No operations routed yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export function WorkOrdersPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder & { id: string } | null>(null);
  const [woData, setWoData] = useState<(WorkOrder & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  const resetForm = () => ({
    woNo: '', partNo: '', partName: '', drawingRevision: '', description: '', salesOrder: '', customer: '', quantity: '', priority: 'Normal', startDate: new Date().toISOString().split('T')[0], dueDate: '', status: 'Planning', completed: 0, rejected: 0
  });
  const [formData, setFormData] = useState(resetForm());

  useEffect(() => {
    async function fetchWOs() {
      try {
        const { data, error } = await supabase.from('cnc_work_orders').select('*').order('created_at', { ascending: false });
        if (error) {
          console.error('Error fetching WOs:', error);
          setDbError(true);
          setWoData([]);
        } else if (data) {
          setDbError(false);
          const formattedData = data.map((d: any) => ({
            id: d.id,
            woNo: d.wo_no,
            partName: d.part_name,
            partNo: d.part_no,
            customer: d.customer,
            salesOrder: d.sales_order,
            quantity: Number(d.quantity),
            completed: Number(d.completed),
            rejected: Number(d.rejected),
            startDate: d.start_date,
            dueDate: d.due_date,
            status: d.status,
            priority: d.priority,
            drawingRevision: d.drawing_revision || '',
            description: d.description || ''
          }));
          setWoData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchWOs();
  }, []);

  const handleEditClick = (wo: WorkOrder & { id: string }) => {
    setFormData({
      woNo: wo.woNo,
      partNo: wo.partNo,
      partName: wo.partName,
      drawingRevision: (wo as any).drawingRevision || '',
      description: (wo as any).description || '',
      salesOrder: wo.salesOrder,
      customer: wo.customer,
      quantity: wo.quantity.toString(),
      priority: wo.priority,
      startDate: wo.startDate || '',
      dueDate: wo.dueDate || '',
      status: wo.status,
      completed: wo.completed,
      rejected: wo.rejected
    });
    setEditId(wo.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!formData.woNo || !formData.quantity) return;

    const entryData = {
      wo_no: formData.woNo,
      part_name: formData.partName,
      part_no: formData.partNo || 'N/A',
      customer: formData.customer,
      sales_order: formData.salesOrder,
      quantity: Number(formData.quantity) || 0,
      completed: Number(formData.completed) || 0,
      rejected: Number(formData.rejected) || 0,
      start_date: formData.startDate || null,
      due_date: formData.dueDate || null,
      status: formData.status,
      priority: formData.priority,
      drawing_revision: formData.drawingRevision,
      description: formData.description
    };

    setLoading(true);

    if (editId) {
      const { error } = await supabase.from('cnc_work_orders').update(entryData).eq('id', editId);
      if (!error) {
        setWoData(prev => prev.map(wo => wo.id === editId ? { 
          ...wo, woNo: entryData.wo_no, partName: entryData.part_name, partNo: entryData.part_no, customer: entryData.customer, salesOrder: entryData.sales_order, quantity: entryData.quantity, completed: entryData.completed, rejected: entryData.rejected, startDate: entryData.start_date ?? '', dueDate: entryData.due_date ?? '', status: entryData.status as any, priority: entryData.priority as any
        } : wo));
        setShowAdd(false);
        setEditId(null);
        setFormData(resetForm());
      } else {
        alert("Failed to update.");
      }
    } else {
      const newId = crypto.randomUUID();
      const insertData = { ...entryData, id: newId };
      const { error } = await supabase.from('cnc_work_orders').insert([insertData]);
      
      if (!error) {
        const formatted = {
          id: newId,
          woNo: insertData.wo_no,
          partName: insertData.part_name,
          partNo: insertData.part_no,
          customer: insertData.customer,
          salesOrder: insertData.sales_order,
          quantity: insertData.quantity,
          completed: insertData.completed,
          rejected: insertData.rejected,
          startDate: insertData.start_date ?? '',
          dueDate: insertData.due_date ?? '',
          status: insertData.status as any,
          priority: insertData.priority as any
        };
        setWoData([formatted, ...woData]);
        setShowAdd(false);
        setFormData(resetForm());
      } else {
        alert("Failed to add to database.");
      }
    }
    setLoading(false);
  };

  const handleInlineUpdate = async (id: string, field: 'priority' | 'status', value: string) => {
    try {
      const { error } = await supabase.from('cnc_work_orders').update({ [field]: value }).eq('id', id);
      if (error) {
        alert("Failed to update: " + error.message);
      } else {
        setWoData(prev => prev.map(w => w.id === id ? { ...w, [field]: value } : w));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const columns: Column<WorkOrder & { id: string }>[] = [
    { key: 'partName', label: 'Part', sortable: true, render: (r) => <div><p className="text-sm font-medium text-slate-800">{r.partName}</p></div> },
    { key: 'customer', label: 'Company', sortable: true, render: (r) => <span className="text-sm text-slate-600">{r.customer}</span> },
    { key: 'quantity', label: 'Planned', align: 'right', sortable: true, render: (r) => <span className="font-medium text-slate-700">{r.quantity}</span> },
    { key: 'completed', label: 'Progress', render: (r) => <div className="flex items-center gap-2 min-w-[120px]"><ProgressBar value={r.completed} max={r.quantity} color="brand" /><span className="text-xs font-medium text-slate-600 whitespace-nowrap">{r.completed}/{r.quantity}</span></div> },
    { key: 'rejected', label: 'Rej', align: 'right', render: (r) => <span className={r.rejected > 0 ? 'text-red-600 font-semibold bg-red-50 px-1.5 py-0.5 rounded' : 'text-slate-400'}>{r.rejected}</span> },
    { key: 'dueDate', label: 'Due', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.dueDate}</span> },
    { key: 'priority', label: 'Priority', sortable: true, render: (r) => (
      <select
        className={`text-xs font-semibold rounded-full px-2 py-1 border border-transparent hover:border-slate-300 cursor-pointer outline-none focus:ring-2 focus:ring-brand-500/50 ${r.priority === 'Critical' ? 'bg-red-50 text-red-700' : r.priority === 'High' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}
        value={r.priority}
        onChange={(e) => handleInlineUpdate(r.id, 'priority', e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="Normal">Normal</option>
        <option value="High">High</option>
        <option value="Critical">Critical</option>
      </select>
    ) },
    { key: 'status', label: 'Status', sortable: true, render: (r) => (
      <select
        className={`text-xs font-semibold rounded-full px-2 py-1 border border-transparent hover:border-slate-300 cursor-pointer outline-none focus:ring-2 focus:ring-brand-500/50 ${r.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : r.status === 'In Progress' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}
        value={r.status}
        onChange={(e) => handleInlineUpdate(r.id, 'status', e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        {r.status && !WO_STATUSES.includes(r.status) && <option value={r.status}>{r.status}</option>}
        {WO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    ) },
    {
      key: 'actions', label: 'Actions', align: 'center', render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => setSelectedWO(r as WorkOrder)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Eye size={15} /></button>
          <button onClick={() => handleEditClick(r)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit size={15} /></button>
          <button onClick={() => setDeleteTarget(r)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>
        </div>
      )
    },
  ];

  // Global date filter (plan start date) drives the stats and the table together.
  const { inRange: inWODateRange } = useGlobalDateFilter();
  const rangedWOs = useMemo(
    () => woData.filter((w: any) => inWODateRange(w.startDate ?? w.start_date ?? w.created_at)),
    [woData, inWODateRange],
  );
  const totalWOs = rangedWOs.length;
  const inProgressWOs = rangedWOs.filter(w => w.status === 'In Progress').length;
  const completedWOs = rangedWOs.filter(w => w.status === 'Completed').length;
  const onHoldWOs = rangedWOs.filter(w => w.status === 'On Hold').length;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Work Orders" description="Manage production work orders and workflow" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /><DateSelector /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total WOs" value={totalWOs.toString()} icon={<ClipboardList size={20} />} accent="brand" />
        <StatCard label="In Progress" value={inProgressWOs.toString()} icon={<Cog size={20} />} accent="accent" />
        <StatCard label="Completed" value={completedWOs.toString()} icon={<Package size={20} />} accent="success" />
        <StatCard label="On Hold" value={onHoldWOs.toString()} icon={<ClipboardList size={20} />} accent="warning" />
      </div>
      <DataTable data={rangedWOs} columns={columns} searchKeys={['woNo', 'partName', 'customer']} onAdd={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }} addLabel="New Work Order" filterOptions={WO_STATUSES.map(s => ({ label: s, value: s }))} />
      
      {selectedWO && <WorkOrderDetailModal wo={selectedWO} onClose={() => setSelectedWO(null)} />}

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditId(null); setFormData(resetForm()); }} title={editId ? "Edit Work Order" : "New Work Order"} subtitle="Manage production work order" size="lg" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} disabled={loading}>{editId ? 'Update Work Order' : 'Create Work Order'}</Button></>}>
        <div className="space-y-6">
          <FormSection title="PART INFORMATION">
            <div className="grid grid-cols-2 gap-5">
              <FormField label="WO Number" required>
                <input className={inputClass} value={formData.woNo} onChange={e => setFormData({...formData, woNo: e.target.value})} placeholder="WO-..." />
              </FormField>
              <FormField label="Part Name" required>
                <input className={inputClass} value={formData.partName} onChange={e => setFormData({...formData, partName: e.target.value})} placeholder="e.g. Turbine Bracket" />
              </FormField>
              <FormField label="Drawing Revision">
                <input className={inputClass} value={formData.drawingRevision} onChange={e => setFormData({...formData, drawingRevision: e.target.value})} placeholder="e.g., R03" />
              </FormField>
              <div className="col-span-2">
                <FormField label="Description">
                  <input className={inputClass} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Part description" />
                </FormField>
              </div>
            </div>
          </FormSection>
          
          <FormSection title="PRODUCTION INFORMATION">
            <div className="grid grid-cols-2 gap-5">
              <FormField label="Sales Order Ref" required>
                <input className={inputClass} value={formData.salesOrder} onChange={e => setFormData({...formData, salesOrder: e.target.value})} placeholder="Link to Sales Order" />
              </FormField>
              <FormField label="Company" required>
                <input className={inputClass} value={formData.customer} onChange={e => setFormData({...formData, customer: e.target.value})} placeholder="Company Name" />
              </FormField>
              <FormField label="Target Quantity" required>
                <input type="number" className={inputClass} value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} placeholder="100" />
              </FormField>
              <FormField label="Status" required>
                <select className={inputClass} value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                  {WO_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </FormField>
              <FormField label="Priority">
                <select className={inputClass} value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})}>
                  <option>Normal</option>
                  <option>High</option>
                  <option>Critical</option>
                </select>
              </FormField>
              <FormField label="Start Date" required>
                <input type="date" className={inputClass} value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})} />
              </FormField>
              <FormField label="Due Date" required>
                <input type="date" className={inputClass} value={formData.dueDate} onChange={e => setFormData({...formData, dueDate: e.target.value})} />
              </FormField>
              <div className="col-span-2 grid grid-cols-2 gap-5 border-t border-slate-100 pt-5 mt-2">
                <FormField label="Completed Qty">
                  <input type="number" className={inputClass} value={formData.completed} onChange={e => setFormData({...formData, completed: Number(e.target.value)})} />
                </FormField>
                <FormField label="Rejected Qty">
                  <input type="number" className={inputClass} value={formData.rejected} onChange={e => setFormData({...formData, rejected: Number(e.target.value)})} />
                </FormField>
              </div>
            </div>
          </FormSection>
        </div>
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_work_orders').delete().eq('id', deleteTarget.id);
            if (!error) {
              setWoData(prev => prev.filter(w => w.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
          }
        }} 
        title="Delete Work Order" 
        message={`Delete work order ${deleteTarget?.woNo}? This will remove it from production scheduling.`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}

function JobCardModal({ job, onClose }: { job: JobCardRow, onClose: () => void }) {
  const [wo, setWo] = useState<{ partNo: string; drawing: string; material: string } | null>(null);

  useEffect(() => {
    async function loadWo() {
      const { data: woRow, error } = await supabase.from('cnc_work_orders').select('part_no, drawing_revision').eq('wo_no', job.workOrder).maybeSingle();
      if (error) console.error('Failed to load work order:', error);
      const partNo = woRow?.part_no || '';
      let drawing = '';
      let material = '';
      if (partNo) {
        const { data: part } = await supabase.from('cnc_parts').select('drawing_no, revision, material').eq('part_no', partNo).maybeSingle();
        drawing = [part?.drawing_no, part?.revision || woRow?.drawing_revision].filter(Boolean).join(' / ');
        material = part?.material || '';
      }
      setWo({ partNo, drawing, material });
    }
    loadWo();
  }, [job.workOrder]);
  const material = wo?.material || '—';

  return (
    <Modal open={true} onClose={onClose} title={`Job Card`} subtitle={job.partName} size="xl">
      <div className="border-2 border-slate-800 p-6 bg-white relative">
        <div className="absolute top-4 right-4 text-slate-300 pointer-events-none">
          <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 24 24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
        </div>
        
        <div className="text-center border-b-2 border-slate-800 pb-4 mb-4">
          <h2 className="text-2xl font-black text-slate-800 uppercase tracking-widest">Manufacturing Job Card</h2>
          <p className="text-sm font-bold text-slate-600 mt-1">{job.partName}</p>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 mb-6 text-sm">
          <div className="flex border-b border-slate-300 pb-1"><span className="w-32 font-bold text-slate-700">Drawing Number:</span><span className="font-mono">{wo?.drawing || '—'}</span></div>
          <div className="flex border-b border-slate-300 pb-1"><span className="w-32 font-bold text-slate-700">Material:</span><span>{material}</span></div>
          <div className="flex border-b border-slate-300 pb-1"><span className="w-32 font-bold text-slate-700">Work Order:</span><span className="font-mono">{job.workOrder}</span></div>
          <div className="flex border-b border-slate-300 pb-1"><span className="w-32 font-bold text-slate-700">Quantity:</span><span>{job.qtyPlanned} Nos</span></div>
          <div className="flex border-b border-slate-300 pb-1"><span className="w-32 font-bold text-slate-700">Machine:</span><span className="font-mono">{job.machine}</span></div>
          <div className="flex border-b border-slate-300 pb-1"><span className="w-32 font-bold text-slate-700">Operator:</span><span>{job.operator || '________'}</span></div>
          <div className="flex border-b border-slate-300 pb-1"><span className="w-32 font-bold text-slate-700">Status:</span><span className="font-bold uppercase">{job.status}</span></div>
        </div>

        <div className="mb-6">
          <table className="w-full text-sm border-collapse border border-slate-800">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-800 py-2 px-3 text-left font-bold">Op</th>
                <th className="border border-slate-800 py-2 px-3 text-left font-bold">Operation</th>
                <th className="border border-slate-800 py-2 px-3 text-left font-bold">Machine</th>
                <th className="border border-slate-800 py-2 px-3 text-left font-bold">Tool</th>
                <th className="border border-slate-800 py-2 px-3 text-left font-bold">Setup Time</th>
                <th className="border border-slate-800 py-2 px-3 text-left font-bold">Cycle Time</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-slate-800 py-2 px-3 text-center">{job.opNo || '—'}</td>
                <td className="border border-slate-800 py-2 px-3 font-medium">{job.operation}</td>
                <td className="border border-slate-800 py-2 px-3 font-mono text-xs">{job.machine}</td>
                <td className="border border-slate-800 py-2 px-3 font-mono text-xs">{job.toolNo}</td>
                <td className="border border-slate-800 py-2 px-3">{job.setupTime} min</td>
                <td className="border border-slate-800 py-2 px-3">{job.cycleTime} min</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-4 gap-4 mt-8 border-t border-slate-200 pt-6">
           <Button variant="primary" className="w-full justify-center">Start Job</Button>
           <Button variant="secondary" className="w-full justify-center text-amber-600 border-amber-200 hover:bg-amber-50">Pause</Button>
           <Button variant="secondary" className="w-full justify-center text-green-600 border-green-200 hover:bg-green-50">Complete</Button>
           <Button variant="danger" className="w-full justify-center">Report Rejection</Button>
        </div>
      </div>
    </Modal>
  );
}

export function JobCardsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobCardRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobCardRow | null>(null);
  const [jobData, setJobData] = useState<JobCardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  const resetForm = () => ({
    jobNo: '', workOrder: '', partName: '', opNo: '', operation: '', machine: '', operator: '', qtyPlanned: '', qtyCompleted: 0, qtyRejected: 0, cycleTime: '', setupTime: '', toolNo: '', status: 'Planned'
  });
  const [formData, setFormData] = useState(resetForm());

  useEffect(() => {
    async function fetchJobs() {
      try {
        const { data, error } = await supabase.from('cnc_job_cards').select('*').order('created_at', { ascending: false });
        if (error) {
          console.error('Error fetching jobs:', error);
          setDbError(true);
          setJobData([]);
        } else if (data) {
          setDbError(false);
          setJobData(data.map(mapJobCardRow));
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, []);

  const handleEditClick = (job: JobCardRow) => {
    setFormData({
      jobNo: job.jobNo,
      workOrder: job.workOrder,
      partName: job.partName,
      opNo: job.opNo ? job.opNo.toString() : '',
      operation: job.operation,
      machine: job.machine,
      operator: job.operator || '',
      qtyPlanned: job.qtyPlanned.toString(),
      qtyCompleted: job.qtyCompleted,
      qtyRejected: job.qtyRejected,
      cycleTime: job.cycleTime.toString(),
      setupTime: job.setupTime.toString(),
      toolNo: job.toolNo || '',
      status: job.status
    });
    setEditId(job.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!formData.jobNo || !formData.workOrder || !formData.opNo) return;

    const entryData = {
      job_no: formData.jobNo,
      work_order: formData.workOrder,
      part_name: formData.partName,
      op_no: Number(formData.opNo) || 10,
      operation: formData.operation,
      machine: formData.machine,
      operator: formData.operator,
      qty_planned: Number(formData.qtyPlanned) || 0,
      qty_completed: Number(formData.qtyCompleted) || 0,
      qty_rejected: Number(formData.qtyRejected) || 0,
      cycle_time: Number(formData.cycleTime) || 0,
      setup_time: Number(formData.setupTime) || 0,
      tool_no: formData.toolNo,
      status: formData.status
    };

    setLoading(true);

    if (editId) {
      const { error } = await supabase.from('cnc_job_cards').update(entryData).eq('id', editId);
      if (!error) {
        setJobData(prev => prev.map(job => job.id === editId ? { 
          ...job, jobNo: entryData.job_no, workOrder: entryData.work_order, partName: entryData.part_name, opNo: entryData.op_no, operation: entryData.operation, machine: entryData.machine, operator: entryData.operator, qtyPlanned: entryData.qty_planned, qtyCompleted: entryData.qty_completed, qtyRejected: entryData.qty_rejected, cycleTime: entryData.cycle_time, setupTime: entryData.setup_time, toolNo: entryData.tool_no, status: entryData.status
        } : job));
        setShowAdd(false);
        setEditId(null);
        setFormData(resetForm());
      } else {
        alert("Failed to update.");
      }
    } else {
      const newId = crypto.randomUUID();
      const insertData = { ...entryData, id: newId };
      const { error } = await supabase.from('cnc_job_cards').insert([insertData]);
      
      if (!error) {
        const formatted: JobCardRow = {
          id: newId,
          jobNo: insertData.job_no,
          workOrder: insertData.work_order,
          partName: insertData.part_name,
          opNo: insertData.op_no,
          operation: insertData.operation,
          machine: insertData.machine,
          operator: insertData.operator,
          qtyPlanned: insertData.qty_planned,
          qtyCompleted: insertData.qty_completed,
          qtyRejected: insertData.qty_rejected,
          cycleTime: insertData.cycle_time,
          setupTime: insertData.setup_time,
          toolNo: insertData.tool_no,
          status: insertData.status
        };
        setJobData(prev => [formatted, ...prev]);
        setShowAdd(false);
        setFormData(resetForm());
      } else {
        alert("Failed to add to database.");
      }
    }
    setLoading(false);
  };

  const handleInlineUpdate = async (id: string, field: 'status', value: string) => {
    try {
      const { error } = await supabase.from('cnc_job_cards').update({ [field]: value }).eq('id', id);
      if (error) {
        alert("Failed to update: " + error.message);
      } else {
        setJobData(prev => prev.map(j => j.id === id ? { ...j, [field]: value } : j));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const columns: Column<JobCardRow>[] = [
    { key: 'partName', label: 'Product / Part', sortable: true },
    { key: 'workOrder', label: 'WO Ref', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-500">{r.workOrder}</span> },
    { key: 'partName', label: 'Part', sortable: true, render: (r) => <span className="font-medium text-slate-800">{r.partName}</span> },
    { key: 'opNo', label: 'Op', align: 'center', sortable: true, render: (r) => r.opNo ? <Badge variant="neutral">Op {r.opNo}</Badge> : <span className="text-slate-400">—</span> },
    { key: 'operation', label: 'Operation', sortable: true, render: (r) => <span className="text-sm font-medium text-slate-700">{r.operation}</span> },
    { key: 'machine', label: 'Machine', sortable: true, render: (r) => <span className="font-mono text-xs font-semibold text-slate-600">{r.machine}</span> },
    { key: 'operator', label: 'Operator', sortable: true, render: (r) => <span className="text-sm text-slate-600">{r.operator}</span> },
    { key: 'qtyPlanned', label: 'Planned', align: 'right', sortable: true, render: (r) => <span className="text-sm font-medium">{r.qtyPlanned}</span> },
    { key: 'qtyCompleted', label: 'Done', align: 'right', render: (r) => <span className="text-green-600 font-bold">{r.qtyCompleted}</span> },
    { key: 'qtyRejected', label: 'Rej', align: 'right', render: (r) => <span className={r.qtyRejected > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}>{r.qtyRejected}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => (
      <select
        className={`text-xs font-semibold rounded-full px-2 py-1 border border-transparent hover:border-slate-300 cursor-pointer outline-none focus:ring-2 focus:ring-brand-500/50 ${r.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : r.status === 'In Progress' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}
        value={r.status}
        onChange={(e) => handleInlineUpdate(r.id, 'status', e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        {r.status && !(JOB_STATUSES as string[]).includes(r.status) && <option value={r.status}>{r.status}</option>}
        {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    ) },
    {
      key: 'actions', label: 'Actions', align: 'center', render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => setSelectedJob(r)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Eye size={15} /></button>
          <button onClick={() => handleEditClick(r)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit size={15} /></button>
          <button onClick={() => setDeleteTarget(r)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>
        </div>
      )
    },
  ];

  // Global date filter (job creation date) drives the stats and the table together.
  const { inRange: inJobDateRange } = useGlobalDateFilter();
  const rangedJobs = useMemo(
    () => jobData.filter((j: any) => inJobDateRange(j.createdAt ?? j.created_at)),
    [jobData, inJobDateRange],
  );
  const totalJobs = rangedJobs.length;
  const runningJobs = rangedJobs.filter(j => j.status === 'In Progress').length;
  const pendingJobs = rangedJobs.filter(j => j.status === 'Planned' || j.status === 'Pending').length;
  const onHoldJobs = rangedJobs.filter(j => j.status === 'On Hold').length;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Job Cards" description="Track individual job cards and CNC operations" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /><DateSelector /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Job Cards" value={totalJobs.toString()} icon={<Cog size={20} />} accent="brand" />
        <StatCard label="Running" value={runningJobs.toString()} icon={<Cog size={20} />} accent="success" />
        <StatCard label="Planned" value={pendingJobs.toString()} icon={<ClipboardList size={20} />} accent="warning" />
        <StatCard label="On Hold" value={onHoldJobs.toString()} icon={<ClipboardList size={20} />} accent="neutral" />
      </div>
      <DataTable data={rangedJobs} columns={columns} searchKeys={['jobNo', 'workOrder', 'partName', 'operation', 'machine', 'operator']} onAdd={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }} addLabel="New Job Card" filterOptions={JOB_STATUSES.map(s => ({ label: s, value: s }))} />
      
      {selectedJob && <JobCardModal job={selectedJob} onClose={() => setSelectedJob(null)} />}

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditId(null); setFormData(resetForm()); }} title={editId ? "Edit Job Card" : "New Job Card"} subtitle="Create CNC job card for operation" size="lg" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} disabled={loading}>{editId ? 'Update Job Card' : 'Create Job Card'}</Button></>}>
        <div className="space-y-6">
          <FormSection title="IDENTIFICATION">
            <div className="grid grid-cols-2 gap-5">
              <FormField label="Job Card Number" required>
                <input className={inputClass} value={formData.jobNo} onChange={e => setFormData({...formData, jobNo: e.target.value})} placeholder="JC-..." />
              </FormField>
              <FormField label="Work Order Ref" required>
                <input className={inputClass} value={formData.workOrder} onChange={e => setFormData({...formData, workOrder: e.target.value})} placeholder="WO-..." />
              </FormField>
              <div className="col-span-2">
                <FormField label="Part Name" required>
                  <input className={inputClass} value={formData.partName} onChange={e => setFormData({...formData, partName: e.target.value})} placeholder="e.g. Turbine Bracket" />
                </FormField>
              </div>
            </div>
          </FormSection>
          <FormSection title="OPERATION DETAILS">
            <div className="grid grid-cols-3 gap-5">
              <FormField label="Op No" required>
                <input type="number" step="10" className={inputClass} value={formData.opNo} onChange={e => setFormData({...formData, opNo: e.target.value})} placeholder="10" />
              </FormField>
              <div className="col-span-2">
                <FormField label="Operation Name" required>
                  <input className={inputClass} value={formData.operation} onChange={e => setFormData({...formData, operation: e.target.value})} placeholder="e.g. Facing & Turning" />
                </FormField>
              </div>
              <FormField label="Machine" required>
                <input className={inputClass} value={formData.machine} onChange={e => setFormData({...formData, machine: e.target.value})} placeholder="e.g. CNC-T-01" />
              </FormField>
              <FormField label="Tool No">
                <input className={inputClass} value={formData.toolNo} onChange={e => setFormData({...formData, toolNo: e.target.value})} placeholder="e.g. T01-T04" />
              </FormField>
              <FormField label="Operator">
                <input className={inputClass} value={formData.operator} onChange={e => setFormData({...formData, operator: e.target.value})} placeholder="Operator name" />
              </FormField>
              <FormField label="Setup Time (min)">
                <input type="number" className={inputClass} value={formData.setupTime} onChange={e => setFormData({...formData, setupTime: e.target.value})} />
              </FormField>
              <FormField label="Cycle Time (min)">
                <input type="number" className={inputClass} value={formData.cycleTime} onChange={e => setFormData({...formData, cycleTime: e.target.value})} />
              </FormField>
            </div>
          </FormSection>
          <FormSection title="PRODUCTION TRACKING">
            <div className="grid grid-cols-3 gap-5">
              <FormField label="Planned Qty" required>
                <input type="number" className={inputClass} value={formData.qtyPlanned} onChange={e => setFormData({...formData, qtyPlanned: e.target.value})} />
              </FormField>
              <FormField label="Completed Qty">
                <input type="number" className={inputClass} value={formData.qtyCompleted} onChange={e => setFormData({...formData, qtyCompleted: Number(e.target.value)})} />
              </FormField>
              <FormField label="Rejected Qty">
                <input type="number" className={inputClass} value={formData.qtyRejected} onChange={e => setFormData({...formData, qtyRejected: Number(e.target.value)})} />
              </FormField>
              <FormField label="Status" required>
                <select className={inputClass} value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                  {JOB_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </FormField>
            </div>
          </FormSection>
        </div>
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_job_cards').delete().eq('id', deleteTarget.id);
            if (!error) {
              setJobData(prev => prev.filter(j => j.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
          }
        }} 
        title="Delete Job Card" 
        message={`Delete job card ${deleteTarget?.jobNo}?`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}

export function MachineSchedulingPage() {
  const dates = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const [machineData, setMachineData] = useState<Machine[]>([]);
  const [jobData, setJobData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [machinesRes, jobsRes] = await Promise.all([
          supabase.from('cnc_machines').select('*').order('code'),
          supabase.from('cnc_job_cards').select('*').in('status', ['In Progress', 'Pending'])
        ]);

        if (machinesRes.error) {
          console.error('Error fetching machines:', machinesRes.error);
          setDbError(true);
          setMachineData(machines as any);
        } else if (machinesRes.data) {
          setDbError(false);
          const formattedData = machinesRes.data.map((d: any) => ({
            id: d.id,
            code: d.code,
            name: d.name,
            type: d.type,
            status: d.status,
            utilization: Number(d.utilization),
            operator: d.operator,
            currentJob: d.current_job,
            location: d.location,
            lastMaintenance: d.last_maintenance,
            nextMaintenance: d.next_maintenance,
            spindleHours: Number(d.spindle_hours)
          }));
          setMachineData(formattedData.length > 0 ? formattedData : machines as any);
        }

        if (jobsRes.data) {
          setJobData(jobsRes.data);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Production Planning" description="Gantt-style machine allocation and scheduling" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><DateSelector /></div>} />
      
      <div className="flex gap-3 mb-3">
        <div className="flex items-center gap-2 text-xs text-slate-500"><div className="w-3 h-3 rounded bg-brand-500"></div> Running / Planned</div>
        <div className="flex items-center gap-2 text-xs text-slate-500"><div className="w-3 h-3 rounded bg-amber-500"></div> Maintenance / Setup</div>
        <div className="flex items-center gap-2 text-xs text-slate-500"><div className="w-3 h-3 rounded bg-red-500"></div> Breakdown</div>
        <div className="flex items-center gap-2 text-xs text-slate-500"><div className="w-3 h-3 rounded bg-slate-200 border border-slate-300 border-dashed"></div> Available</div>
      </div>

      <Card className="overflow-hidden border border-slate-200">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-700 w-64 border-r border-slate-200 sticky left-0 bg-slate-50 z-10 shadow-[1px_0_0_0_#e2e8f0]">Machine Resource</th>
                {dates.map(d => (
                  <th key={d} className="px-2 py-3 text-center font-medium text-slate-600 min-w-[120px] border-r border-slate-100 last:border-r-0">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {machineData.map((m) => {
                const schedule: Record<number, { label: string; color: string, span: number }> = {};
                let skipCols = 0;
                let currentDay = 0;

                // Priority overrides for machine status
                if (m.status === 'Breakdown') {
                  schedule[currentDay] = { label: 'Machine Breakdown', color: 'bg-red-500', span: 2 };
                  currentDay += 2;
                } else if (m.status === 'Maintenance') {
                  schedule[currentDay] = { label: 'Scheduled Maintenance', color: 'bg-amber-500', span: 1 };
                  currentDay += 1;
                }

                // Plot actual job cards assigned to this machine
                const assignedJobs = jobData.filter(j => j.machine === m.code);
                
                for (const job of assignedJobs) {
                  if (currentDay >= 7) break;
                  
                  // Estimate days based on quantity (e.g. 50 parts per day)
                  let span = Math.max(1, Math.ceil(Number(job.qty_planned) / 50));
                  if (currentDay + span > 7) {
                    span = 7 - currentDay;
                  }

                  schedule[currentDay] = { 
                    label: `${job.work_order} (${job.part_name})`, 
                    color: job.status === 'In Progress' ? 'bg-brand-500' : 'bg-brand-400', 
                    span 
                  };
                  currentDay += span;
                }

                return (
                  <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 border-r border-slate-200 sticky left-0 bg-white shadow-[1px_0_0_0_#e2e8f0]">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-800">{m.code}</span>
                        <span className="text-xs text-slate-500">{m.name}</span>
                      </div>
                    </td>
                    {dates.map((_, i) => {
                      if (skipCols > 0) {
                        skipCols--;
                        return null;
                      }
                      
                      const block = schedule[i];
                      if (block) {
                        skipCols = block.span - 1;
                        return (
                          <td key={i} colSpan={block.span} className="p-1.5 border-r border-slate-100 last:border-r-0">
                            <div className={`${block.color} text-white text-xs font-medium rounded p-2 text-center truncate shadow-sm`} title={block.label}>
                              {block.label}
                            </div>
                          </td>
                        );
                      }
                      
                      return (
                        <td key={i} className="p-1.5 border-r border-slate-100 last:border-r-0">
                          <div className="h-8 border-2 border-dashed border-slate-200 rounded hover:border-slate-300 transition-colors cursor-pointer"></div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function CNCOperationsPage() {
  const [jobData, setJobData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  useEffect(() => {
    async function fetchActiveJobs() {
      try {
        const { data, error } = await supabase.from('cnc_job_cards').select('*').in('status', ['In Progress']);
        if (error) {
          console.error('Error fetching jobs:', error);
          setDbError(true);
          setJobData([]);
        } else if (data) {
          setDbError(false);
          // cnc_job_cards has no CNC program column
          setJobData(data.map((d: any) => ({ ...mapJobCardRow(d), cncProgram: d.cnc_program || '—' })));
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchActiveJobs();
  }, []);

  const totalPartsCompleted = jobData.reduce((sum, j) => sum + j.qtyCompleted, 0);
  const totalPartsRejected = jobData.reduce((sum, j) => sum + j.qtyRejected, 0);
  const totalParts = totalPartsCompleted + totalPartsRejected;
  const rejectionRate = totalParts > 0 ? ((totalPartsRejected / totalParts) * 100).toFixed(1) : '0.0';
  
  const avgCycleTime = jobData.length > 0 
    ? (jobData.reduce((sum, j) => sum + j.cycleTime, 0) / jobData.length).toFixed(1)
    : '0.0';

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="CNC Operations" description="Live CNC program execution monitoring" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Active Programs" value={jobData.length.toString()} icon={<Cog size={20} />} accent="brand" />
        <StatCard label="Avg Cycle Time" value={`${avgCycleTime} min`} icon={<Cog size={20} />} accent="accent" />
        <StatCard label="Parts Today" value={totalPartsCompleted.toString()} icon={<Package size={20} />} accent="success" />
        <StatCard label="Rejection Rate" value={`${rejectionRate}%`} icon={<Cog size={20} />} accent={Number(rejectionRate) > 5 ? 'error' : 'success'} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {jobData.map((j) => (
          <Card key={j.id} className="p-5 hover:border-brand-300 transition-colors cursor-pointer border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">{j.partName}</h3>
                <p className="text-xs text-slate-500">{formatOp(j.opNo, j.operation)}</p>
              </div>
              <Badge variant="success" dot>Running</Badge>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div><p className="text-xs text-slate-400">Machine</p><p className="text-sm font-mono font-medium text-slate-700">{j.machine}</p></div>
              <div><p className="text-xs text-slate-400">Operator</p><p className="text-sm font-medium text-slate-700">{j.operator || 'Unassigned'}</p></div>
              <div><p className="text-xs text-slate-400">CNC Program</p><p className="text-sm font-mono font-medium text-slate-700">{j.cncProgram}</p></div>
              <div><p className="text-xs text-slate-400">Tools</p><p className="text-sm font-mono font-medium text-slate-700">{j.toolNo || 'N/A'}</p></div>
              <div><p className="text-xs text-slate-400">Cycle Time</p><p className="text-sm font-medium text-slate-700">{j.cycleTime} min</p></div>
              <div><p className="text-xs text-slate-400">Setup Time</p><p className="text-sm font-medium text-slate-700">{j.setupTime} min</p></div>
            </div>
            <div className="mt-5 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600">Progress</span>
                <span className="text-xs font-bold text-slate-800">{j.qtyCompleted} / {j.qtyPlanned}</span>
              </div>
              <ProgressBar value={j.qtyCompleted} max={j.qtyPlanned} color="brand" />
              <div className="flex justify-between items-center mt-2 text-[10px]">
                <span className="text-red-500 font-medium">Rejected: {j.qtyRejected}</span>
                <span className="text-green-600 font-medium">Yield: {j.qtyPlanned > 0 ? (((j.qtyCompleted - j.qtyRejected) / j.qtyPlanned) * 100).toFixed(1) : 0}%</span>
              </div>
            </div>
          </Card>
        ))}
        {jobData.length === 0 && !loading && (
          <div className="col-span-2 py-12 text-center border-2 border-dashed border-slate-200 rounded-xl">
            <Cog className="mx-auto h-8 w-8 text-slate-300 mb-3 animate-spin-slow" />
            <h3 className="text-sm font-medium text-slate-600">No active CNC operations</h3>
            <p className="text-xs text-slate-400 mt-1">Start a job card to monitor production</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MachineDetailPage({ machine, jobCards, onBack }: { machine: Machine, jobCards: JobCardRow[], onBack: () => void }) {
  const job = jobCards.find(j => j.machine === machine.code && (j.status === 'In Progress' || j.status === 'Running'))
    || jobCards.find(j => j.machine === machine.code && j.status !== 'Completed');

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <div className="flex items-center gap-3 mb-3">
        <button onClick={onBack} className="p-2 hover:bg-slate-200 bg-slate-100 rounded-lg text-slate-600 transition-colors">
          ← Back
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{machine.code} - {machine.name}</h1>
          <p className="text-sm text-slate-500">Shop Floor • {machine.location}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Badge variant={statusToVariant(machine.status)} dot>{machine.status}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="p-4 col-span-1 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-3 mb-4">Current Job Execution</h3>
          {job ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div><p className="text-xs text-slate-400">Work Order</p><p className="text-sm font-mono font-medium text-slate-700">{job.workOrder}</p></div>
              <div><p className="text-xs text-slate-400">Part</p><p className="text-sm font-medium text-slate-700">{job.partName}</p></div>
              <div><p className="text-xs text-slate-400">Operation</p><p className="text-sm font-medium text-slate-700">{formatOp(job.opNo, job.operation)}</p></div>
              <div><p className="text-xs text-slate-400">Operator</p><p className="text-sm font-medium text-slate-700">{job.operator || machine.operator}</p></div>
              <div><p className="text-xs text-slate-400">CNC Program</p><p className="text-sm font-mono font-medium text-slate-700">{job.cncProgram || '—'}</p></div>
              <div><p className="text-xs text-slate-400">Target Qty</p><p className="text-sm font-medium text-slate-700">{job.qtyPlanned}</p></div>
              <div className="col-span-2 md:col-span-3 mt-2">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-500">Progress</span>
                  <span className="font-semibold text-slate-700">{job.qtyCompleted} / {job.qtyPlanned}</span>
                </div>
                <ProgressBar value={job.qtyCompleted} max={job.qtyPlanned} color="brand" height="h-3" />
                <div className="flex justify-between text-xs text-slate-400 mt-2">
                  <span>Rejected: <span className="text-red-600 font-medium">{job.qtyRejected}</span></span>
                  <span>Cycle Time: {job.cycleTime} min</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-slate-500 text-sm border-2 border-dashed border-slate-200 rounded-lg">
              No active job running on this machine
            </div>
          )}
        </Card>
        
        <Card className="p-4 col-span-1">
          <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-3 mb-4">Machine Metrics</h3>
          <div className="flex justify-center mb-6">
            <GaugeChart value={machine.utilization} label="OEE" color={machine.utilization > 80 ? '#16a34a' : '#f59e0b'} size={140} />
          </div>
          <div className="space-y-4">
             <div className="flex justify-between items-center"><span className="text-slate-500 text-sm">Spindle Hours</span><span className="text-slate-800 font-mono text-sm">{machine.spindleHours.toLocaleString()}</span></div>
             <div className="flex justify-between items-center"><span className="text-slate-500 text-sm">Last Maintenance</span><span className="text-slate-800 text-sm">{machine.lastMaintenance}</span></div>
             <div className="flex justify-between items-center"><span className="text-slate-500 text-sm">Next Maintenance</span><span className="text-slate-800 text-sm">{machine.nextMaintenance}</span></div>
          </div>
        </Card>
      </div>
      
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-3 mb-4">Production Timeline (Today)</h3>
        {/* No machine state log is recorded yet, so there is no real timeline to show */}
        <div className="h-24 flex items-center justify-center text-slate-500 text-sm border-2 border-dashed border-slate-200 rounded-lg">
          No machine state history recorded yet
        </div>
      </Card>
    </div>
  );
}

export function ShopFloorPage() {
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [jobCards, setJobCards] = useState<JobCardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [mRes, jRes] = await Promise.all([
          supabase.from('cnc_machines').select('*').order('code'),
          supabase.from('cnc_job_cards').select('*')
        ]);
        if (mRes.error) console.error('Failed to load machines:', mRes.error);
        if (jRes.error) console.error('Failed to load job cards:', jRes.error);

        if (mRes.data) {
          setMachines(mRes.data.map((d: any) => ({
            id: d.id, code: d.code, name: d.name, type: d.type, status: d.status,
            utilization: Number(d.utilization), operator: d.operator, currentJob: d.current_job,
            location: d.location, lastMaintenance: d.last_maintenance, nextMaintenance: d.next_maintenance,
            spindleHours: Number(d.spindle_hours)
          })));
        }
        
        if (jRes.data) {
          setJobCards(jRes.data.map(mapJobCardRow));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (selectedMachine) {
    return <MachineDetailPage machine={selectedMachine} jobCards={jobCards} onBack={() => setSelectedMachine(null)} />;
  }

  const activeMachinesCount = machines.filter(m => m.status === 'Running').length;
  const runningJobsCount = jobCards.filter(j => j.status === 'Running' || j.status === 'In Progress').length;
  const totalProd = jobCards.reduce((acc, j) => acc + j.qtyCompleted, 0);
  
  // Calculate OEE roughly
  const oee = machines.length > 0 ? (machines.reduce((acc, m) => acc + (m.utilization || 0), 0) / machines.length).toFixed(1) : '0.0';

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Shop Floor Live" description="Real-time shop floor monitoring" actions={<div className="flex items-center gap-2">{loading && <Badge variant="neutral">Syncing...</Badge>}<Badge variant="success" dot>Live</Badge><DateSelector /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Active Machines" value={activeMachinesCount.toString()} icon={<Cog size={20} />} accent="success" />
        <StatCard label="Running Jobs" value={runningJobsCount.toString()} icon={<Activity size={20} />} accent="brand" />
        <StatCard label="Total Production" value={totalProd.toString()} icon={<Package size={20} />} accent="accent" />
        <StatCard label="OEE Average" value={`${oee}%`} icon={<Gauge size={20} />} accent="navy" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {machines.map((m) => {
          const job = jobCards.find(j => j.machine === m.code && (j.status === 'Running' || j.status === 'In Progress' || j.status === 'Setup')) || jobCards.find(j => j.machine === m.code && j.status !== 'Completed');
          return (
            <Card key={m.id} className="p-5 hover:shadow-card-hover transition-shadow cursor-pointer border border-transparent hover:border-brand-200" onClick={() => setSelectedMachine(m)}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${m.status === 'Running' ? 'bg-green-500 animate-pulse-ring' : m.status === 'Idle' ? 'bg-slate-400' : m.status === 'Maintenance' ? 'bg-amber-500' : 'bg-red-500'}`} />
                  <div>
                    <h3 className="text-base font-bold text-slate-800">{m.code}</h3>
                    <p className="text-xs text-slate-500">{m.type}</p>
                  </div>
                </div>
                <Badge variant={statusToVariant(m.status)}>{m.status}</Badge>
              </div>
              
              <div className="bg-slate-50 rounded-lg p-3 mb-4 min-h-[90px]">
                {job ? (
                  <>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider">Current Job</p>
                        <p className="text-sm font-semibold text-slate-700">{job.workOrder}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500 uppercase tracking-wider">Part</p>
                        <p className="text-sm font-medium text-slate-700 truncate max-w-[120px]">{job.partName}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-600">
                      <span>{formatOp(job.opNo, job.operation)}</span>
                      <span className="font-medium text-brand-600">{job.operator || m.operator}</span>
                    </div>
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                    No active job
                  </div>
                )}
              </div>

              {job && (
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Progress</span>
                    <span className="font-semibold text-slate-700">{job.qtyCompleted} / {job.qtyPlanned}</span>
                  </div>
                  <ProgressBar value={job.qtyCompleted} max={job.qtyPlanned} color="brand" height="h-2" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Cycle Time</p>
                  <p className="text-sm font-medium text-slate-700">{job ? `${job.cycleTime}m` : '—'}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Rejects</p>
                  <p className={`text-sm font-medium ${job?.qtyRejected ? 'text-red-600' : 'text-slate-700'}`}>{job ? job.qtyRejected : '—'}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// Compact stat chips shared by the top-bar cluster and the small-screen fallback row.
function TrackingStats({ planned, completed, rejected, wip }: { planned: number; completed: number; rejected: number; wip: number }) {
  const items = [
    { l: 'Total Planned', v: planned, c: 'text-slate-800' },
    { l: 'Completed', v: completed, c: 'text-emerald-600' },
    { l: 'Rejected', v: rejected, c: 'text-red-600' },
    { l: 'WIP', v: wip, c: 'text-amber-600' },
  ];
  return (
    <div className="flex items-center gap-3 shrink-0">
      {items.map((s) => (
        <span key={s.l} className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {s.l} <b className={`text-sm tabular-nums ${s.c}`}>{s.v}</b>
        </span>
      ))}
    </div>
  );
}

export function ProductionTrackingPage() {
  const [woData, setWoData] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWOs() {
      try {
        const { data, error } = await supabase.from('cnc_work_orders').select('*').order('created_at', { ascending: false });
        if (error) console.error('Error fetching WOs:', error);
        if (data) {
          setWoData(data.map((d: any) => ({
            id: d.id, woNo: d.wo_no, partName: d.part_name, partNo: d.part_no, customer: d.customer, salesOrder: d.sales_order,
            quantity: Number(d.quantity), completed: Number(d.completed), rejected: Number(d.rejected), startDate: d.start_date, dueDate: d.due_date,
            status: d.status, priority: d.priority,
          })));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchWOs();
  }, []);

  const totalPlanned = woData.reduce((acc, w) => acc + w.quantity, 0);
  const totalCompleted = woData.reduce((acc, w) => acc + w.completed, 0);
  const totalRejected = woData.reduce((acc, w) => acc + w.rejected, 0);
  const totalWip = woData.filter(w => w.status === 'In Progress').reduce((acc, w) => acc + w.quantity, 0);

  // Header cluster lives in the top bar on desktop (title + stats + actions);
  // the local row below stays only for smaller screens.
  const { setHeader, setTabActions } = useHeaderKpis();
  useEffect(() => {
    setHeader({ title: 'Production Tracking' });
    return () => setHeader(null);
  }, [setHeader]);
  useEffect(() => {
    setTabActions(
      <>
        <TrackingStats planned={totalPlanned} completed={totalCompleted} rejected={totalRejected} wip={totalWip} />
        {loading && <Badge variant="neutral">Syncing...</Badge>}
        <FilterButton />
        <ExportButton />
        <DateSelector />
      </>
    );
    return () => setTabActions(null);
  }, [setTabActions, loading, totalPlanned, totalCompleted, totalRejected, totalWip]);

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <div className="flex flex-nowrap items-center gap-3 mb-3 overflow-x-auto scrollbar-thin lg:hidden">
        <h1 className="text-xl font-bold text-slate-800 whitespace-nowrap shrink-0">Production Tracking</h1>
        <TrackingStats planned={totalPlanned} completed={totalCompleted} rejected={totalRejected} wip={totalWip} />
        <div className="ml-auto flex items-center gap-2 shrink-0">{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /><DateSelector /></div>
      </div>
      <Card className="overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-800">Work Order Progress</h3></div>
        <div className="divide-y divide-slate-50">
          {woData.map((w) => {
            const pct = w.quantity > 0 ? (w.completed / w.quantity) * 100 : 0;
            return (
              <div key={w.id} className="px-4 py-2.5 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-600">{w.partName}</span>
                    <Badge variant={priorityToVariant(w.priority)}>{w.priority}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-slate-500">{w.completed} / {w.quantity}</span>
                    <span className="text-red-500 text-xs">Rej: {w.rejected}</span>
                    <Badge variant={statusToVariant(w.status)} dot>{w.status}</Badge>
                  </div>
                </div>
                <ProgressBar value={pct} color={pct === 100 ? 'success' : pct > 50 ? 'brand' : 'warning'} height="h-2" />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

export function FinishedGoodsPage() {
  const [woData, setWoData] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWOs() {
      try {
        const { data, error } = await supabase.from('cnc_work_orders').select('*').order('created_at', { ascending: false });
        if (error) console.error('Error fetching WOs:', error);
        if (data) {
          setWoData(data.map((d: any) => ({
            id: d.id, woNo: d.wo_no, partName: d.part_name, partNo: d.part_no, customer: d.customer, salesOrder: d.sales_order,
            quantity: Number(d.quantity), completed: Number(d.completed), rejected: Number(d.rejected), startDate: d.start_date, dueDate: d.due_date,
            status: d.status, priority: d.priority,
          })));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchWOs();
  }, []);

  const finishedGoods = woData.filter((w) => w.status === 'Completed' || w.completed > 0).map((w) => ({
    id: w.id,
    partName: w.partName,
    partNo: w.partNo,
    woNo: w.woNo,
    customer: w.customer,
    quantity: w.quantity,
    completed: w.completed,
    rejected: w.rejected,
    accepted: w.completed - w.rejected,
    status: w.status,
  }));

  const totalFinished = finishedGoods.reduce((acc, w) => acc + w.completed, 0);

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Finished Goods" description="Track completed production and stock" actions={<div className="flex items-center gap-2">{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Finished" value={totalFinished.toString()} icon={<Package size={20} />} accent="success" />
        <StatCard label="Delivered" value="0" icon={<Package size={20} />} accent="brand" />
        <StatCard label="In Stock" value={totalFinished.toString()} icon={<Package size={20} />} accent="accent" />
        <StatCard label="Awaiting QC" value="0" icon={<Package size={20} />} accent="warning" />
      </div>
      <DataTable data={finishedGoods} columns={[
        { key: 'partName', label: 'Part', sortable: true, render: (r) => <div><p className="text-sm text-slate-700">{r.partName}</p></div> },
        { key: 'customer', label: 'Company', sortable: true },
        { key: 'quantity', label: 'Order Qty', align: 'right', sortable: true },
        { key: 'completed', label: 'Produced', align: 'right', sortable: true, render: (r) => <span className="font-medium text-slate-700">{r.completed}</span> },
        { key: 'rejected', label: 'Rejected', align: 'right', render: (r) => <span className={r.rejected > 0 ? 'text-red-500' : 'text-slate-400'}>{r.rejected}</span> },
        { key: 'accepted', label: 'Accepted (OK)', align: 'right', render: (r) => <span className="font-bold text-green-600">{r.accepted}</span> },
        { key: 'status', label: 'Status', sortable: true, render: () => <Badge variant="success">In Stock</Badge> },
      ]} searchKeys={['woNo', 'partName', 'customer']} filterOptions={[{ label: 'Completed', value: 'Completed' }, { label: 'In Progress', value: 'In Progress' }]} />
    </div>
  );
}

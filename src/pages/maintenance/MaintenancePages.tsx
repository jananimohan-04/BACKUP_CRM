import { useState, useEffect } from 'react';
import { Wrench, Settings, AlertTriangle, Activity } from 'lucide-react';
import { PageHeader, FilterButton, ExportButton } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge, StatCard, ProgressBar, statusToVariant } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import type { Machine, MaintenanceRecord } from '@/data/mockData';

export function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMachines() {
      try {
        const { data, error } = await supabase.from('cnc_machines').select('*').order('code');
        if (error) {
          console.error('Error fetching machines:', error);
          setMachines([]);
        } else {
          setMachines((data || []).map((d: any) => ({
            id: d.id,
            code: d.code,
            name: d.name,
            type: d.type,
            status: d.status,
            utilization: Number(d.utilization) || 0,
            operator: d.operator,
            currentJob: d.current_job,
            location: d.location,
            lastMaintenance: d.last_maintenance,
            nextMaintenance: d.next_maintenance,
            spindleHours: Number(d.spindle_hours) || 0,
          })));
        }
      } finally {
        setLoading(false);
      }
    }
    fetchMachines();
  }, []);

  const columns: Column<Machine>[] = [
    { key: 'code', label: 'Machine Code', sortable: true, render: (r) => <span className="font-mono text-xs font-semibold text-slate-800">{r.code}</span> },
    { key: 'name', label: 'Machine Name', sortable: true, render: (r) => <span className="font-medium text-slate-700">{r.name}</span> },
    { key: 'type', label: 'Type', sortable: true, render: (r) => <Badge variant="neutral">{r.type}</Badge> },
    { key: 'location', label: 'Location', render: (r) => <span className="text-xs text-slate-500">{r.location}</span> },
    { key: 'utilization', label: 'Utilization', sortable: true, render: (r) => <div className="flex items-center gap-2 w-24"><ProgressBar value={r.utilization} max={100} color={r.utilization > 80 ? 'success' : r.utilization > 50 ? 'warning' : 'neutral'} /><span className="text-xs">{r.utilization}%</span></div> },
    { key: 'spindleHours', label: 'Spindle Hrs', align: 'right', sortable: true, render: (r) => <span className="font-mono text-sm text-slate-600">{r.spindleHours.toLocaleString()}</span> },
    { key: 'nextMaintenance', label: 'Next PM', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.nextMaintenance || '—'}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={statusToVariant(r.status)} dot>{r.status}</Badge> },
  ];

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Machine Master" description="Central registry of all CNC machines" actions={<div className="flex items-center gap-2">{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Machines" value={machines.length.toString()} icon={<Settings size={20} />} accent="brand" />
        <StatCard label="Running" value={machines.filter(m => m.status === 'Running').length.toString()} icon={<Activity size={20} />} accent="success" />
        <StatCard label="Under Maintenance" value={machines.filter(m => m.status === 'Maintenance').length.toString()} icon={<Wrench size={20} />} accent="warning" />
        <StatCard label="Breakdown" value={machines.filter(m => m.status === 'Breakdown').length.toString()} icon={<AlertTriangle size={20} />} accent="error" />
      </div>
      <DataTable data={machines} columns={columns} searchKeys={['code', 'name', 'type', 'location']} emptyMessage={loading ? 'Loading machines...' : 'No machines yet'} filterOptions={[{ label: 'Running', value: 'Running' }, { label: 'Idle', value: 'Idle' }, { label: 'Breakdown', value: 'Breakdown' }, { label: 'Maintenance', value: 'Maintenance' }]} />
    </div>
  );
}

function MaintenanceList({ title, description }: { type: 'Preventive' | 'Breakdown' | 'Calibration' | 'History', title: string, description: string }) {
  // There is no maintenance table in the database yet, so there are no records to show.
  const data: MaintenanceRecord[] = [];

  const columns: Column<MaintenanceRecord>[] = [
    { key: 'machineCode', label: 'Machine', sortable: true, render: (r) => <div><p className="font-mono text-xs font-semibold">{r.machineCode}</p><p className="text-xs text-slate-500">{r.machineName}</p></div> },
    { key: 'type', label: 'Type', sortable: true, render: (r) => <Badge variant={r.type === 'Breakdown' ? 'error' : r.type === 'Calibration' ? 'info' : 'brand'}>{r.type}</Badge> },
    { key: 'description', label: 'Description', render: (r) => <span className="text-sm text-slate-700">{r.description}</span> },
    { key: 'startDate', label: 'Start Date', sortable: true, render: (r) => <span className="text-xs text-slate-600">{r.startDate}</span> },
    { key: 'duration', label: 'Duration', align: 'right', render: (r) => <span className="text-sm">{r.duration} hrs</span> },
    { key: 'technician', label: 'Technician', render: (r) => <span className="text-xs text-slate-500">{r.technician}</span> },
    { key: 'cost', label: 'Cost', align: 'right', render: (r) => <span className="font-mono text-sm">₹{r.cost.toLocaleString()}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={r.status === 'Completed' ? 'success' : r.status === 'Scheduled' ? 'neutral' : r.status === 'Overdue' ? 'error' : 'warning'} dot>{r.status}</Badge> },
  ];

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title={title} description={description} actions={<div className="flex items-center gap-2"><FilterButton /><ExportButton /></div>} />
      <DataTable data={data} columns={columns} searchKeys={['machineCode', 'description', 'technician']} emptyMessage="No maintenance records yet" />
    </div>
  );
}

export function PreventiveMaintenancePage() {
  return <MaintenanceList type="Preventive" title="Preventive Maintenance" description="Scheduled PM tasks and check-sheets" />;
}

export function BreakdownMaintenancePage() {
  return <MaintenanceList type="Breakdown" title="Breakdown Maintenance" description="Unplanned machine breakdowns and repairs" />;
}

export function MaintenanceHistoryPage() {
  return <MaintenanceList type="History" title="Maintenance History" description="Complete record of all maintenance activities" />;
}

export function MachineDowntimePage() {
  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Machine Downtime" description="Analytics on breakdown causes and MTTR/MTBF" />
      <div className="flex items-center justify-center h-64 border border-dashed border-slate-300 rounded-xl bg-slate-50">
        <p className="text-slate-500">Downtime analytics coming soon.</p>
      </div>
    </div>
  );
}

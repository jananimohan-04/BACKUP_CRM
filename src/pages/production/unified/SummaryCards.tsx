import { StatCard } from '@/components/ui/Card';
import { ClipboardList, Package, Clock, AlertTriangle, CheckCircle } from 'lucide-react';

export function SummaryCards({ workOrders }: { workOrders: any[] }) {
  const totalOrders = workOrders.length;
  const partsInProduction = workOrders.filter(w => w.status === 'In Progress').length;
  
  const isDone = (w: any) => w.status === 'Completed' || w.status === 'Dispatched';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = (w: any) => !isDone(w) && !!w.due_date && new Date(w.due_date) < today;

  // Delayed = open (not completed/dispatched) orders past their due date
  const delayedOrders = workOrders.filter(isOverdue).length;

  // cnc_work_orders has no completion timestamp, so count finished orders that were due this month
  const completedThisMonth = workOrders.filter(w => {
    if (!isDone(w) || !w.due_date) return false;
    const due = new Date(w.due_date);
    return due.getMonth() === today.getMonth() && due.getFullYear() === today.getFullYear();
  }).length;

  // Without a completion date we can't measure on-time completion; show the share of open orders still on schedule
  const openOrders = workOrders.filter(w => !isDone(w));
  const onTrackPercentage = openOrders.length > 0
    ? Math.round(((openOrders.length - delayedOrders) / openOrders.length) * 100)
    : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
      <StatCard 
        label="Total Production Orders" 
        value={totalOrders.toString()} 
        icon={<ClipboardList size={20} />} 
        accent="neutral" 
      />
      <StatCard 
        label="Parts in Production" 
        value={partsInProduction.toString()} 
        icon={<Package size={20} />} 
        accent="brand" 
      />
      <StatCard 
        label="Open Orders On Track"
        value={`${onTrackPercentage}%`}
        icon={<Clock size={20} />} 
        accent="success" 
      />
      <StatCard 
        label="Delayed Orders" 
        value={delayedOrders.toString()} 
        icon={<AlertTriangle size={20} />} 
        accent="error" 
      />
      <StatCard 
        label="Completed (Due This Month)"
        value={completedThisMonth.toString()} 
        icon={<CheckCircle size={20} />} 
        accent="success" 
      />
    </div>
  );
}

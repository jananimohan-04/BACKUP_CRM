import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Card';

import { SummaryCards } from './SummaryCards';
import { ProductionOrdersTab } from './ProductionOrdersTab';
import { PartRoutingTab } from './PartRoutingTab';
import { LiveProductionTab } from './LiveProductionTab';
import { JobCardsTab } from './JobCardsTab';
import { WIPTab, CompletedTab, ReportsTab } from './OtherTabs';

export function ProductionMainPage() {
  const TABS = [
    'Production Orders', 'Part Routing', 'Live Production',
    'Job Card', 'WIP', 'Completed', 'Reports'
  ];

  const [activeTab, setActiveTab] = useState('Production Orders');
  const [loading, setLoading] = useState(true);
  const [workOrders, setWorkOrders] = useState<any[]>([]);

  const fetchData = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('cnc_work_orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) console.error('Failed to load work orders:', error);
    if (data) setWorkOrders(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // The Production Orders tab is the full Work Order module: it renders its own
  // header, summary cards and creation flow. Other tabs keep the shared shell.
  const isOrders = activeTab === 'Production Orders';

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-full">
      {!isOrders && (
        <>
          <PageHeader
            title="Production"
            description="Plan, track and manage production from project to part to finished goods."
            actions={
              <div className="flex items-center gap-2">
                {loading && <span className="text-xs text-slate-400">Syncing...</span>}
                <Button variant="secondary">Import</Button>
                <Button variant="secondary">Export</Button>
                <Button variant="secondary">Print</Button>
              </div>
            }
          />
          <SummaryCards workOrders={workOrders} />
        </>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-slate-200 mb-3 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Dynamic Tab Content */}
      {isOrders ? (
        <ProductionOrdersTab workOrders={workOrders} refresh={fetchData} />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          {activeTab === 'Part Routing' && <PartRoutingTab />}
          {activeTab === 'Live Production' && <LiveProductionTab workOrders={workOrders} />}
          {activeTab === 'Job Card' && <JobCardsTab workOrders={workOrders} />}
          {activeTab === 'WIP' && <WIPTab workOrders={workOrders} />}
          {activeTab === 'Completed' && <CompletedTab workOrders={workOrders} />}
          {activeTab === 'Reports' && <ReportsTab workOrders={workOrders} />}
        </div>
      )}
    </div>
  );
}

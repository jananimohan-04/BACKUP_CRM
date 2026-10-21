import { useState, useEffect, useMemo } from 'react';
import { Download, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Card';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';

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

  // Publish the title and tabs into the top bar (same line as date/profile); the local
  // tab row below stays only for smaller screens. Cleared on unmount.
  const { setTabs, setHeader } = useHeaderKpis();
  useEffect(() => {
    setHeader({ title: 'Production' });
    setTabs(TABS.map(label => ({ label, active: label === activeTab, onClick: () => setActiveTab(label) })));
    return () => {
      setTabs([]);
      setHeader(null);
    };
  }, [activeTab, setTabs, setHeader]);

  // Global date filter (plan start date) applies to every tab's orders and summaries.
  const { inRange: inProdDateRange } = useGlobalDateFilter();
  const rangedWorkOrders = useMemo(
    () => workOrders.filter((w: any) => inProdDateRange(w.start_date ?? w.created_at)),
    [workOrders, inProdDateRange],
  );
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
        <div className="lg:hidden">
          <PageHeader
            title="Production"
            description="Plan, track and manage production from project to part to finished goods."
            actions={
              <div className="flex items-center gap-2">
                {loading && <span className="text-xs text-slate-400">Syncing...</span>}
                <Button variant="secondary" icon={<Download size={14} />}>Import</Button>
                <Button variant="secondary" icon={<Upload size={14} />}>Export</Button>
                <Button variant="secondary">Print</Button>
              </div>
            }
          />
        </div>
      )}
      {!isOrders && <SummaryCards workOrders={rangedWorkOrders} />}

      {/* Tabs (below-lg screens only — desktop shows them in the top bar) */}
      <div className="flex lg:hidden items-center gap-4 border-b border-slate-200 mb-3 overflow-x-auto">
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
        <ProductionOrdersTab workOrders={rangedWorkOrders} refresh={fetchData} />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          {activeTab === 'Part Routing' && <PartRoutingTab />}
          {activeTab === 'Live Production' && <LiveProductionTab workOrders={rangedWorkOrders} />}
          {activeTab === 'Job Card' && <JobCardsTab workOrders={rangedWorkOrders} />}
          {activeTab === 'WIP' && <WIPTab workOrders={rangedWorkOrders} />}
          {activeTab === 'Completed' && <CompletedTab workOrders={rangedWorkOrders} />}
          {activeTab === 'Reports' && <ReportsTab workOrders={rangedWorkOrders} />}
        </div>
      )}
    </div>
  );
}

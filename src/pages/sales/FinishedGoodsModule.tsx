import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, ArrowLeft, FileText } from 'lucide-react';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Card';
import { PagerFooter, usePager } from '@/components/ui/TablePager';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { recordDateOf } from '@/lib/globalDate';

export function FinishedGoodsModule({ onBack, onEdit, onDelete, refreshSignal, onView, entryForm }: { onBack: () => void; onView?: (record: any) => void; onEdit?: (record: any) => void; onDelete?: (record: any) => void; refreshSignal?: number; entryForm?: ReactNode | ((slots: { searchSlot: ReactNode; titleSlot: ReactNode }) => ReactNode) }) {
  const { companyFilter, setCompanyFilter, companyOptions } = useHeaderKpis();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');

  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);

  useEffect(() => {
    fetchRecords();
  }, [refreshSignal]);

  const fetchRecords = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('cnc_work_orders').select('*')
      .or('status.eq.Completed,completed.gt.0')
      .order('created_at', { ascending: false });
    if (error) console.error('Error fetching finished goods:', error);
    if (data) setRecords(data);
    setLoading(false);
  };

  const openRecord = async (record: any) => {
    setSelectedRecord(record);
  };

  const companies = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      const c = (r.customer || '').trim();
      if (c) set.add(c);
    });
    companyOptions.forEach(c => {
      if (c && c !== 'All Companies') set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [records, companyOptions]);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      const s = (r.status || '').trim();
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [records]);

  const { from: globalFrom, to: globalTo, inRange: inDateRange } = useGlobalDateFilter();
  const filteredRecords = records.filter(r => {
    const matchesSearch = (r.wo_no || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.customer || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.part_name || '').toLowerCase().includes(search.toLowerCase());
    const matchesCompany = !companyFilter || companyFilter === 'All Companies' ||
      (r.customer || '').trim().toLowerCase() === companyFilter.trim().toLowerCase();
    const matchesStatus = !statusFilter || statusFilter === 'All Status' ||
      (r.status || '').trim().toLowerCase() === statusFilter.trim().toLowerCase();
    // Global date filter uses the finished-goods completion record date.
    const matchesDate = inDateRange(recordDateOf(r, ['created_at']));
    return matchesSearch && matchesCompany && matchesStatus && matchesDate;
  });

  const pager = usePager(filteredRecords, `${search}||${companyFilter}||${statusFilter}||${globalFrom}||${globalTo}`);

  const searchInput = (
    <div className="relative shrink-0">
      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        placeholder="Search..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="pl-8 pr-2.5 py-1 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-brand-500 bg-white shadow-sm w-32 sm:w-36"
      />
    </div>
  );
  const titleSlot = (
    <div className="flex items-center gap-1.5 shrink-0 mr-1">
      <button onClick={onBack} title="Back to Pipeline" className="p-1 hover:bg-slate-200/80 rounded-md transition-colors text-slate-600 shrink-0 cursor-pointer">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <h2 className="text-sm font-bold text-slate-800 shrink-0">Finished Goods</h2>
      <span className="h-5 w-px shrink-0 bg-slate-300 ml-1" aria-hidden="true" />
    </div>
  );
  const renderedEntry = typeof entryForm === 'function' ? entryForm({ searchSlot: searchInput, titleSlot }) : entryForm;

  return (
    <div className="flex flex-col gap-2.5">
      {renderedEntry ? (
        renderedEntry
      ) : (
      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-teal-400/30 px-3 py-2 flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="p-1 hover:bg-slate-200 rounded-md transition-colors text-slate-600 shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-slate-800 shrink-0">Finished Goods</h2>
        </div>
        <div className="flex items-center gap-2">
          {searchInput}
        </div>
      </div>
      )}

      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-teal-400/30 overflow-hidden flex flex-col">
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div></div>
        ) : (
          <table className="erp-table erp-table-teal w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <th className="p-3 font-semibold">Work Order</th>
                <th className="p-3 font-semibold">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Company</span>
                    <select
                      aria-label="Filter by Company"
                      title="Filter by Company"
                      value={companyFilter || 'All Companies'}
                      onChange={e => setCompanyFilter(e.target.value)}
                      className="text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[125px] truncate shadow-xs"
                    >
                      <option value="All Companies">All</option>
                      {companies.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="p-3 font-semibold">Product Name</th>
                <th className="p-3 font-semibold">Completed Qty</th>
                <th className="p-3 font-semibold">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Status</span>
                    <select
                      aria-label="Filter by Status"
                      title="Filter by Status"
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      className="text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[110px] truncate shadow-xs"
                    >
                      <option value="All Status">All</option>
                      {statuses.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="p-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map(record => (
                <tr key={record.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="p-3 text-sm font-mono font-medium text-slate-800">{record.wo_no || '-'}</td>
                  <td className="p-3 text-sm font-semibold text-brand-700">{record.customer || '-'}</td>
                  <td className="p-3 text-sm text-slate-700">{record.part_name || '-'}</td>
                  <td className="p-3 text-sm text-slate-700">{record.completed ?? '-'}</td>
                  <td className="p-3 text-sm text-slate-700">{record.status || '-'}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => (onView ? onView(record) : openRecord(record))}>View Details</Button>{onEdit && <Button variant="secondary" size="sm" onClick={() => onEdit(record)}>Edit</Button>}{onDelete && <Button variant="secondary" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => onDelete(record)}>Delete</Button>}</div>
                  </td>
                </tr>
              ))}
              {filteredRecords.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-slate-500">No records found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <PagerFooter pager={pager} />
      </div>

      <Modal open={!!selectedRecord} onClose={() => setSelectedRecord(null)} title={'Finished Goods Details: ' + (selectedRecord?.wo_no || 'Pending')} size="xl" footer={
        <div className="flex justify-between w-full">
          <div>
             <Button onClick={() => alert('Development Note: Conversion logic will go here.')} className="bg-emerald-600 hover:bg-emerald-700 text-white">Create DC</Button>
          </div>
          <Button onClick={() => setSelectedRecord(null)}>Close</Button>
        </div>
      }>
        {selectedRecord && (
          <div className="flex gap-6">
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Work Order"><input className={inputClass} value={selectedRecord.wo_no || ''} disabled /></FormField>
                <FormField label="Company"><input className={inputClass} value={selectedRecord.customer || ''} disabled /></FormField>
                <FormField label="Product Name"><input className={inputClass} value={selectedRecord.part_name || ''} disabled /></FormField>
                <FormField label="Completed Qty"><input className={inputClass} value={selectedRecord.completed ?? ''} disabled /></FormField>
                <FormField label="Status"><input className={inputClass} value={selectedRecord.status || ''} disabled /></FormField>
              </div>
            </div>

            <div className="w-64 bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col h-full">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2"><FileText className="w-4 h-4 text-brand-600"/> DOCUMENT FLOW</h3>

              <div className="flex flex-col space-y-0 relative pl-4">
                <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-slate-200 z-0"></div>

                <FlowStep active={false} title="ENQUIRY" subtitle="Linked" />
                <FlowStep active={false} title="QUOTATION" subtitle="Linked" />
                <FlowStep active={false} title="SALES ORDER" subtitle={selectedRecord.sales_order || 'Linked'} />
                <FlowStep active={false} title="INWARD" subtitle="Linked" />
                <FlowStep active={false} title="PRODUCTION" subtitle={selectedRecord.wo_no || 'Linked'} />
                <FlowStep active highlight title="FINISHED GOODS" subtitle={selectedRecord.wo_no} />
                <FlowStep active={false} title="DELIVERY CHALLAN" subtitle="Linked" />
                <FlowStep active={false} title="INVOICE" subtitle="Linked" />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function FlowStep({ active, highlight, title, subtitle }: { active: boolean, highlight?: boolean, title: string, subtitle: string }) {
  return (
    <div className="relative z-10 flex items-start gap-3 py-3">
      <div className={"mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 " + (highlight ? 'bg-brand-500 border-brand-500' : (active ? 'bg-white border-brand-400' : 'bg-white border-slate-300'))}></div>
      <div>
        <div className={"font-bold text-[11px] uppercase tracking-wider " + (highlight ? 'text-brand-700' : (active ? 'text-slate-600' : 'text-slate-400'))}>{title}</div>
        <div className={"text-[10px] font-mono " + (highlight ? 'text-slate-700' : 'text-slate-400')}>{subtitle}</div>
      </div>
    </div>
  );
}

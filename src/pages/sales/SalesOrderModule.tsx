import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchOrderQty, summarizeSalesOrder } from '@/lib/orderQuantities';
import { Search, ArrowLeft } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Card';
import { SalesOrderSection } from './SalesOrderSection';
import { PagerFooter, usePager } from '@/components/ui/TablePager';
import { formatLeadProductDisplay } from './SalesPipelinePage';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';

const orderValue = (r: any) => r.total_value ?? r.value;

const ORDER_STATUSES = ['Draft', 'Confirmed', 'Waiting for Parts', 'In Production'];

export function SalesOrderModule({ onBack, onDelete, refreshSignal, onView, onEdit, entryForm }: { onBack: () => void; onDelete?: (record: any) => void; refreshSignal?: number; onView?: (record: any) => void; onEdit?: (record: any) => void; entryForm?: ReactNode | ((props: { onBack: () => void; searchSlot: ReactNode }) => ReactNode) }) {
  const { companyFilter, setCompanyFilter, companyOptions } = useHeaderKpis();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');

  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [qtyTracking, setQtyTracking] = useState<any>(null);
  // Live per-order progress (finished / rejected / remaining / DC / invoice).
  const [qtyMap, setQtyMap] = useState<Record<string, any>>({});
  const soSaveRef = useRef<(() => Promise<boolean>) | null>(null);

  useEffect(() => {
    fetchRecords();
  }, [refreshSignal]);

  const fetchRecords = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('cnc_sales_orders').select('*').order('created_at', { ascending: false });
    if (error) console.error('Error fetching sales orders:', error);
    if (data) setRecords(data);
    setLoading(false);
    // Batch-load production rows once and reconcile every order locally.
    try {
      const [woRes, dcRes, invRes, batchRes] = await Promise.all([
        supabase.from('cnc_work_orders').select('*'),
        supabase.from('cnc_deliveries').select('*'),
        supabase.from('cnc_invoices').select('*'),
        supabase.from('cnc_production_batches').select('*'),
      ]);
      const map: Record<string, any> = {};
      (data || []).forEach((so: any) => {
        try {
          map[so.order_no] = summarizeSalesOrder(
            so, woRes.data ?? [], dcRes.data ?? [], invRes.data ?? [], batchRes.data ?? []);
        } catch { /* this order stays without progress */ }
      });
      setQtyMap(map);
    } catch { /* progress stays hidden */ }
  };

  const updateStatus = async (record: any, value: string) => {
    if (!value || value === record.status) return;
    const { error } = await supabase.from('cnc_sales_orders').update({ status: value }).eq('id', record.id);
    if (error) {
      alert('Failed to update status: ' + error.message);
      return;
    }
    setRecords((prev) => prev.map((r) => (r.id === record.id ? { ...r, status: value } : r)));
    setSelectedRecord((prev: any) => (prev && prev.id === record.id ? { ...prev, status: value } : prev));
  };

  const openRecord = async (record: any, edit: boolean) => {
    setSelectedRecord(record);
    setEditMode(edit);
    setQtyTracking(null);
    soSaveRef.current = null;
    try {
      const { summary } = await fetchOrderQty(record?.id ?? null, record?.order_no ?? '');
      if (summary) setQtyTracking(summary);
    } catch { /* quantities stay order-level */ }
  };

  const closeRecord = () => {
    setSelectedRecord(null);
    setEditMode(false);
    setQtyTracking(null);
    soSaveRef.current = null;
  };

  const refreshSelected = async (id: string) => {
    await fetchRecords();
    const { data } = await supabase.from('cnc_sales_orders').select('*').eq('id', id).maybeSingle();
    if (data) {
      setSelectedRecord(data);
      try {
        const r = await fetchOrderQty(data.id ?? null, data.order_no ?? '');
        if (r.summary) setQtyTracking(r.summary);
      } catch { /* keep previous tracking */ }
    }
  };

  const handleInlineEdit = async (field: string, value: string) => {
    if (!selectedRecord) return;
    const { error } = await supabase.from('cnc_sales_orders').update({ [field]: value }).eq('id', selectedRecord.id);
    if (error) {
      alert('Failed to update field: ' + error.message);
      return;
    }
    setSelectedRecord((prev: any) => (prev ? { ...prev, [field]: value } : prev));
    void refreshSelected(selectedRecord.id);
  };

  const toggleEdit = async () => {
    if (editMode && soSaveRef.current) {
      const ok = await soSaveRef.current();
      if (!ok) return;
    }
    setEditMode(!editMode);
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
    ORDER_STATUSES.forEach(s => set.add(s));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [records]);

  const filteredRecords = records.filter(r => {
    const matchesSearch = (r.order_no || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.customer || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.part_name || '').toLowerCase().includes(search.toLowerCase());
    const matchesCompany = !companyFilter || companyFilter === 'All Companies' ||
      (r.customer || '').trim().toLowerCase() === companyFilter.trim().toLowerCase();
    const matchesStatus = !statusFilter || statusFilter === 'All Status' ||
      (r.status || '').trim().toLowerCase() === statusFilter.trim().toLowerCase();
    return matchesSearch && matchesCompany && matchesStatus;
  });

  const pager = usePager(filteredRecords, `${search}||${companyFilter}||${statusFilter}`);

  const searchInput = (
    <div className="relative shrink-0">
      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        placeholder="Search orders..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="pl-8 pr-2.5 py-1 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-brand-500 bg-white shadow-sm w-36 sm:w-44"
      />
    </div>
  );

  const renderedEntry = typeof entryForm === 'function' ? entryForm({ onBack, searchSlot: searchInput }) : entryForm;

  return (
    <div className="flex flex-col gap-2.5">
      {renderedEntry ? (
        renderedEntry
      ) : (
        <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-emerald-400/30 px-3 py-2 flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={onBack} className="p-1 hover:bg-slate-200 rounded-md transition-colors text-slate-600 shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-bold text-slate-800 shrink-0">Sales Orders</h2>
          </div>
          {searchInput}
        </div>
      )}

      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-emerald-400/30 overflow-hidden flex flex-col">
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div></div>
        ) : (
          <table className="erp-table erp-table-emerald w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <th className="p-3 font-semibold">Order No</th>
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
                <th className="p-3 font-semibold">Part Name</th>
                <th className="p-3 font-semibold">Quantity</th>
                <th className="p-3 font-semibold">Total Value</th>
                <th className="p-3 font-semibold">Delivery Date</th>
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
                  <td className="p-3 text-sm font-mono font-medium text-slate-800">{record.order_no || '-'}</td>
                  <td className="p-3 text-sm font-semibold text-brand-700">{record.customer || '-'}</td>
                  <td className="p-3 text-sm text-slate-700">{formatLeadProductDisplay(record)}</td>
                  <td className="p-3 text-sm text-slate-700">{record.quantity ?? '-'}</td>
                  <td className="p-3 text-sm text-slate-700">{orderValue(record) ?? '-'}</td>
                  <td className="p-3 text-sm text-slate-700">{record.delivery_date || '-'}</td>
                  <td className="p-3">
                    <select
                      value={record.status || ''}
                      onChange={(e) => void updateStatus(record, e.target.value)}
                      className="text-sm text-slate-700 border border-slate-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-brand-500"
                      title="Change status"
                    >
                      {Array.from(new Set([...ORDER_STATUSES, record.status].filter(Boolean))).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => (onView ? onView(record) : void openRecord(record, false))}>View Details</Button>
                      <Button variant="secondary" size="sm" onClick={() => (onEdit ? onEdit(record) : void openRecord(record, true))}>Edit</Button>
                      {onDelete && <Button variant="secondary" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => onDelete(record)}>Delete</Button>}
                    </div>
                    {(() => {
                      const q = qtyMap[record.order_no];
                      if (!q) return null;
                      return (
                        <div className="mt-2 flex flex-wrap gap-1">
                          <span title="Finished (good)" className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-emerald-700">Fin {q.good}</span>
                          <span title="Rejected" className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-rose-700">Rej {q.rejected}</span>
                          <span title="Remaining" className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-amber-700">Rem {q.remaining}</span>
                          <span title="Delivered via DC" className="rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-violet-700">DC {q.delivered}</span>
                          <span title="Invoiced" className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-sky-700">Inv {q.invoiced}</span>
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
              {filteredRecords.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-slate-500">No records found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <PagerFooter pager={pager} />
      </div>

      <Modal open={!!selectedRecord} onClose={closeRecord} title={'Sales Order Details: ' + (selectedRecord?.order_no || 'Pending')} size="md" footer={
        <div className="flex justify-end w-full gap-2">
          <Button variant={editMode ? 'primary' : 'secondary'} onClick={() => void toggleEdit()}>{editMode ? 'Done Editing' : 'Edit'}</Button>
          <Button variant="secondary" onClick={closeRecord}>Close</Button>
        </div>
      }>
        {selectedRecord && (
          <div className="flex flex-col max-h-[75vh] overflow-y-auto pr-2">
            <SalesOrderSection
              key={selectedRecord.id || 'so'}
              order={selectedRecord}
              qtyTracking={qtyTracking}
              editMode={editMode}
              saveRef={soSaveRef}
              onSaved={() => void refreshSelected(selectedRecord.id)}
              onInlineEdit={(field: string, value: string) => void handleInlineEdit(field, value)}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}


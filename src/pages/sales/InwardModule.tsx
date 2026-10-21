import { useState, useEffect, useMemo, Fragment, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, ArrowLeft, FileText, Download } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { recordDateOf } from '@/lib/globalDate';
import { downloadBrandedDocument, viewBrandedDocument } from '@/lib/brandedDocument';
import { PagerFooter, usePager } from '@/components/ui/TablePager';

export function InwardModule({ onBack, refreshSignal, onEdit, onDelete, onView, entryForm }: { onBack: () => void; refreshSignal?: number; onEdit?: (record: any) => void; onDelete?: (record: any) => void; onView?: (record: any) => void; entryForm?: ReactNode | ((props: { onBack: () => void; searchSlot: ReactNode }) => ReactNode) }) {
  const { company } = useAuth();
  const { companyFilter, setCompanyFilter, companyOptions } = useHeaderKpis();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [partNameFilter, setPartNameFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const isExpense = (r: any) => String(r.category || '').trim().toUpperCase() === 'EXPENSES';

  // Distinct categories present in the data, so the filter always matches reality.
  const categories = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      const c = String(r.category || 'GOODS PURCHASE').trim();
      if (c) set.add(c.toUpperCase());
    });
    return [...set].sort();
  }, [records]);

  // Distinct companies/parties present in the data
  const companies = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      const p = (r.party_name || r.customer || '').trim();
      if (p) set.add(p);
    });
    companyOptions.forEach(c => {
      if (c && c !== 'All Companies') set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [records, companyOptions]);

  // Distinct statuses present in the data
  const statuses = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      const s = (r.status || '').trim();
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [records]);

  // Distinct part names present in the data
  const partNames = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      const p = (r.part_name || '').trim();
      if (p) set.add(p);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [records]);

  // If the selected category disappears from the data, fall back to All.
  useEffect(() => {
    if (categoryFilter !== 'All' && !categories.includes(categoryFilter)) setCategoryFilter('All');
  }, [categories, categoryFilter]);

  // If the selected part name disappears from the data, fall back to All.
  useEffect(() => {
    if (partNameFilter !== 'All' && !partNames.includes(partNameFilter)) setPartNameFilter('All');
  }, [partNames, partNameFilter]);

  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);

  const openAttachment = async (attachment: { path: string; name: string }) => {
    const tab = window.open('about:blank', '_blank');
    if (!tab) { alert('Allow pop-ups to open this attachment.'); return; }
    const { data, error } = await supabase.storage.from('inventory-images').createSignedUrl(attachment.path, 60);
    if (error || !data?.signedUrl) {
      tab.close();
      alert(`Unable to open ${attachment.name}: ${error?.message || 'File unavailable'}`);
      return;
    }
    tab.location.href = data.signedUrl;
  };

  useEffect(() => {
    fetchRecords();
  }, [refreshSignal]);

  const fetchRecords = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('cnc_inwards').select('*').order('created_at', { ascending: false });
    if (error) console.error('Error fetching inwards:', error);
    if (data) setRecords(data);
    setLoading(false);
  };

  const openRecord = async (record: any) => {
    setSelectedRecord(record);
  };

  // Core PDF fonts lack the ₹ glyph — always use Rs. in generated bills.
  const inr = (v: any) => 'Rs. ' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  // Line total: stored total_amount wins, otherwise price x qty with discount + GST applied.
  const rowTotal = (r: any) => r && r.total_amount !== null && r.total_amount !== undefined && r.total_amount !== ''
    ? Number(r.total_amount)
    : (Number(r.quantity) || 0) * (Number(r.price) || 0)
      * (1 - (Number(r.discount_percent) || 0) / 100) * (1 + (Number(r.gst_percent) || 0) / 100);

  const buildBillInput = () => {
    const r = selectedRecord;
    if (!r) return null;
    const q = Number(r.quantity) || 0;
    const p = Number(r.price) || 0;
    const total = rowTotal(r);
    return {
      companyName: company?.company_name || 'ARGUS CNC',
      title: 'Purchase Bill',
      documentNo: r.inward_no || '',
      date: r.inward_date || r.created_at,
      details: [
        ['Company Name', r.party_name || '—'],
        ['Category', r.category || '—'],
        ['Reference No.', r.reference_no || '—'],
        ['Product', r.product_name || r.project_name || '—'],
      ] as [string, string | number | null | undefined][],
      details2: [
        ['Inward Date', r.inward_date || '—'],
        ['Status', r.status || '—'],
      ] as [string, string | number | null | undefined][],
      columns: ['S.No', 'Part Name', 'Qty', 'Price (Rs.)', 'Disc %', 'GST %', 'Amount (Rs.)'],
      rows: [[
        1, r.part_name || '—', q, inr(p),
        `${Number(r.discount_percent) || 0}%`, `${Number(r.gst_percent) || 0}%`, inr(total),
      ]] as (string | number)[][],
      totals: [['Total Amount', inr(total)]] as [string, string][],
      signatures: ['Prepared By', 'Checked By', 'Received By'],
      premium: true,
    };
  };

  const previewBill = async () => {
    const input = buildBillInput();
    if (!input) return;
    try { await viewBrandedDocument(input); }
    catch (error) { alert(error instanceof Error ? error.message : 'Unable to preview the bill.'); }
  };

  const downloadBill = async () => {
    const input = buildBillInput();
    if (!input) return;
    try { await downloadBrandedDocument(input); }
    catch (error) { alert(error instanceof Error ? error.message : 'Unable to download the bill.'); }
  };

  const { from: globalFrom, to: globalTo, inRange: inDateRange } = useGlobalDateFilter();
  const filteredRecords = records.filter(r => r.status !== 'Deleted').filter(r => {
    const matchesSearch = (r.inward_no || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.party_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.product_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.part_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.category || '').toLowerCase().includes(search.toLowerCase());
    const matchesCompany = !companyFilter || companyFilter === 'All Companies' ||
      (r.party_name || '').trim().toLowerCase() === companyFilter.trim().toLowerCase() ||
      (r.customer || '').trim().toLowerCase() === companyFilter.trim().toLowerCase();
    const matchesCategory = categoryFilter === 'All' ||
      String(r.category || 'GOODS PURCHASE').trim().toUpperCase() === categoryFilter;
    const matchesPartName = !partNameFilter || partNameFilter === 'All' ||
      (r.part_name || '').trim().toLowerCase() === partNameFilter.trim().toLowerCase();
    const matchesStatus = !statusFilter || statusFilter === 'All Status' ||
      (r.status || '').trim().toLowerCase() === statusFilter.trim().toLowerCase();
    // Global date filter uses the inward date.
    const matchesDate = inDateRange(recordDateOf(r, ['inward_date', 'created_at']));
    return matchesSearch && matchesCompany && matchesCategory && matchesPartName && matchesStatus && matchesDate;
  });

  const colCount = 8;

  const pager = usePager(filteredRecords, `${search}||${companyFilter}||${categoryFilter}||${partNameFilter}||${statusFilter}||${globalFrom}||${globalTo}`);

  // Shared so the two row templates cannot drift apart.
  const actionCell = (record: any) => (
    <td className="py-2 px-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => (onView ? onView(record) : openRecord(record))}>View Details</Button>
        {onEdit && <Button variant="secondary" size="sm" onClick={() => onEdit(record)}>Edit</Button>}
        {onDelete && <Button variant="secondary" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => onDelete(record)}>Delete</Button>}
      </div>
    </td>
  );

  const searchInput = (
    <div className="flex shrink-0 items-center gap-2">
      <div className="relative shrink-0">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search inwards..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-8 pr-2.5 py-1 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-brand-500 bg-white shadow-sm w-36 sm:w-44"
        />
      </div>
      <select
        aria-label="Filter by category"
        title="Filter by category"
        value={categoryFilter}
        onChange={e => setCategoryFilter(e.target.value)}
        className="py-1 px-2 text-xs font-medium border border-slate-300 rounded-md focus:outline-none focus:border-brand-500 bg-white shadow-sm max-w-[11rem] text-slate-600"
      >
        <option value="All">All Categories</option>
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        aria-label="Filter by part name"
        title="Filter by part name"
        value={partNameFilter}
        onChange={e => setPartNameFilter(e.target.value)}
        className="py-1 px-2 text-xs font-medium border border-slate-300 rounded-md focus:outline-none focus:border-brand-500 bg-white shadow-sm max-w-[11rem] text-slate-600 truncate"
      >
        <option value="All">All Part Names</option>
        {partNames.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );

  const renderedEntry = typeof entryForm === 'function' ? entryForm({ onBack, searchSlot: searchInput }) : entryForm;

  return (
    <div className="flex flex-col gap-2.5">
      {renderedEntry ? (
        renderedEntry
      ) : (
        <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-amber-400/30 px-3 py-2 flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={onBack} className="p-1 hover:bg-slate-200 rounded-md transition-colors text-slate-600 shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-bold text-slate-800 shrink-0">Inwards</h2>
          </div>
          {searchInput}
        </div>
      )}

      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-amber-400/30 overflow-hidden flex flex-col">
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div></div>
        ) : (
          <table className="erp-table erp-table-amber w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <th className="py-2 px-3 font-semibold">Inward No</th>
                <th className="py-2 px-3 font-semibold">
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
                <th className="py-2 px-3 font-semibold">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Category</span>
                    <select
                      aria-label="Filter by Category"
                      title="Filter by Category"
                      value={categoryFilter}
                      onChange={e => setCategoryFilter(e.target.value)}
                      className="text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[110px] truncate shadow-xs"
                    >
                      <option value="All">All</option>
                      {categories.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="py-2 px-3 font-semibold">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Part Name</span>
                    <select
                      aria-label="Filter by Part Name"
                      title="Filter by Part Name"
                      value={partNameFilter}
                      onChange={e => setPartNameFilter(e.target.value)}
                      className="text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[130px] truncate shadow-xs"
                    >
                      <option value="All">All</option>
                      {partNames.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="py-2 px-3 font-semibold">Quantity</th>
                <th className="py-2 px-3 font-semibold">Total Amount</th>
                <th className="py-2 px-3 font-semibold">
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
                <th className="py-2 px-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map(record => (
                <tr key={record.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="py-2 px-3 text-sm font-mono font-medium text-slate-800">{record.inward_no || '-'}</td>
                  <td className="py-2 px-3 text-sm font-semibold text-brand-700">{record.party_name || '-'}</td>
                  <td className="py-2 px-3 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      isExpense(record)
                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                        : 'bg-slate-100 text-slate-700'
                    }`}>
                      {record.category || 'GOODS PURCHASE'}
                    </span>
                    {record.petty_cash && (
                      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-300" title={`Petty Cash: Paid by ${record.paid_by || 'Member'}${record.petty_date ? ' on ' + record.petty_date : ''}`}>
                        Petty Cash
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-sm text-slate-700">{record.part_name || '-'}</td>
                  <td className="py-2 px-3 text-sm text-slate-700">{record.quantity ?? '-'}</td>
                  <td className="py-2 px-3 text-sm font-mono font-semibold text-slate-800 whitespace-nowrap">{inr(rowTotal(record))}</td>
                  <td className="py-2 px-3 text-sm text-slate-700">{record.status || '-'}</td>
                  {actionCell(record)}
                </tr>
              ))}
              {filteredRecords.length === 0 && (
                <tr><td colSpan={colCount} className="text-center py-8 text-slate-500">No records found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <PagerFooter pager={pager} />
      </div>

      <Modal open={!!selectedRecord} onClose={() => setSelectedRecord(null)} title={'Inward Details: ' + (selectedRecord?.inward_no || 'Pending')} size="lg" footer={
        <div className="flex justify-between w-full">
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void previewBill()}>Bill Preview</Button>
            <Button variant="secondary" icon={<Download size={14} />} onClick={() => void downloadBill()}>Download Bill PDF</Button>
          </div>
          <Button onClick={() => setSelectedRecord(null)}>Close</Button>
        </div>
      }>
        {selectedRecord && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="grid grid-cols-2 md:grid-cols-[9rem_minmax(0,1fr)_9rem_9rem_auto] gap-4 mb-3">
              {([
                ['Category', selectedRecord.category],
                ['Company', selectedRecord.party_name],
                ['Inward Date', selectedRecord.inward_date],
                ['Reference No.', selectedRecord.reference_no],
              ] as [string, any][]).map(([label, v]) => (
                <div key={label}>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">{label}</span>
                  <span className="text-sm text-slate-800 font-medium break-words">{v === null || v === undefined || v === '' ? '—' : String(v)}</span>
                </div>
              ))}
              <div>
                <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Petty Cash</span>
                {selectedRecord.petty_cash ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Paid by {selectedRecord.paid_by || 'Member'}{selectedRecord.petty_amount ? ` (Rs. ${Number(selectedRecord.petty_amount).toLocaleString('en-IN')})` : ' (Full Amount)'}{selectedRecord.petty_date ? ` · ${selectedRecord.petty_date}` : ''}
                  </span>
                ) : (
                  <span className="text-sm text-slate-400">No</span>
                )}
              </div>
              <div>
                <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Files</span>
                <div className="flex flex-wrap gap-2">
                  {Array.isArray(selectedRecord.attachments) && selectedRecord.attachments.length > 0 ? (
                    selectedRecord.attachments.map((attachment: { path: string; name: string }, index: number) => (
                      <button key={`${attachment.path}-${index}`} type="button" onClick={() => openAttachment(attachment)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-brand-700 hover:bg-brand-50">
                        <FileText className="h-4 w-4" />{attachment.name}
                      </button>
                    ))
                  ) : (
                    <span className="text-sm text-slate-400">—</span>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_4rem_4.75rem_4rem_3.75rem_5rem_minmax(0,1fr)] gap-2 items-center mb-1 px-1">
              {['Product', 'Part Name', 'Qty', 'Price', 'Disc', 'GST', 'Total', 'Remarks'].map(h => (
                <span key={h} className="text-[10px] font-bold text-slate-500 uppercase">{h}</span>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_4rem_4.75rem_4rem_3.75rem_5rem_minmax(0,1fr)] gap-2 items-center bg-white rounded-lg border border-slate-200 p-2">
              {[
                selectedRecord.product_name || selectedRecord.project_name || '—',
                selectedRecord.part_name || '—',
                selectedRecord.quantity ?? '—',
                selectedRecord.price !== null && selectedRecord.price !== undefined && selectedRecord.price !== '' ? inr(selectedRecord.price) : '—',
                `${Number(selectedRecord.discount_percent) || 0}%`,
                `${Number(selectedRecord.gst_percent) || 0}%`,
                selectedRecord.total_amount !== null && selectedRecord.total_amount !== undefined && selectedRecord.total_amount !== '' ? inr(selectedRecord.total_amount) : '—',
                selectedRecord.remarks || '—',
              ].map((v, i) => (
                <span key={i} className="text-sm text-slate-800 font-medium break-words tabular-nums">{String(v)}</span>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

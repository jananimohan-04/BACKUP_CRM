import { useState, useEffect, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, Calendar, List, Kanban as KanbanIcon, ArrowLeft, FileText } from 'lucide-react';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Card';
import { PagerFooter, usePager } from '@/components/ui/TablePager';

export function EnquiryModule({ onBack, onEdit, onDelete, refreshSignal, onView, entryForm }: { onBack: () => void; onEdit?: (record: any) => void; onDelete?: (record: any) => void; refreshSignal?: number; onView?: (record: any) => void; entryForm?: ReactNode }) {
  const [enquiries, setEnquiries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'calendar'>('list');
  const [selectedEnquiry, setSelectedEnquiry] = useState<any | null>(null);
  const [relatedQuote, setRelatedQuote] = useState<any | null>(null);

  useEffect(() => {
    fetchEnquiries();
  }, [refreshSignal]);

  const fetchEnquiries = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('cnc_enquiries').select('*').order('created_at', { ascending: false });
    if (error) console.error("Error fetching enquiries:", error);
    if (data) setEnquiries(data);
    setLoading(false);
  };

  const openEnquiry = async (enq: any) => {
    setSelectedEnquiry(enq);
    // Fetch related quotation using lead_id or enquiry_no
    const filters = [`lead_id.eq.${enq.id}`];
    if (enq.enquiry_no) filters.push(`enquiry_no.eq.${enq.enquiry_no}`);
    const { data: quote, error } = await supabase.from('cnc_quotations')
      .select('id, quote_no')
      .or(filters.join(','))
      .limit(1)
      .maybeSingle();
    if (error) console.error("Error fetching related quotation:", error);

    setRelatedQuote(quote || null);
  };

  const filteredEnquiries = enquiries.filter(e => 
    (e.enquiry_no || '').toLowerCase().includes(search.toLowerCase()) || 
    (e.customer || '').toLowerCase().includes(search.toLowerCase())
  );

  const productNames = (enq: any): string => {
    try {
      const ef = enq?.enquiring_for;
      const parsed = typeof ef === 'string' ? JSON.parse(ef) : ef;
      if (Array.isArray(parsed)) {
        const names = parsed.map((it: any) => String(it.productName || it.partName || it.part_name || '').trim()).filter(Boolean);
        if (names.length) return names.join(', ');
      }
    } catch { /* fall through to part_name */ }
    return String(enq?.part_name || '').trim().replace(/(\s*\(?\d+\s*products?\)?\s*)+$/i, '').trim() || '—';
  };

  const productRemarks = (enq: any): string => {
    try {
      const ef = enq?.enquiring_for;
      const parsed = typeof ef === 'string' ? JSON.parse(ef) : ef;
      if (Array.isArray(parsed)) {
        const rs = parsed.map((it: any) => String(it.remarks || '').trim()).filter(Boolean);
        if (rs.length) return rs.join(' | ');
      }
    } catch { /* no remarks */ }
    return '—';
  };

  const pager = usePager(filteredEnquiries, filteredEnquiries.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-3 py-1.5 flex flex-wrap justify-between items-center gap-2 gap-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="p-1 hover:bg-slate-200 rounded-md transition-colors text-slate-600 shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-sm font-bold text-slate-800 shrink-0">Enquiries</h2>
            <p className="text-xs text-slate-500 truncate">Manage all incoming enquiries</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search enquiries..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-brand-500"
            />
          </div>
          <div className="flex bg-slate-100 rounded-lg p-1 border border-slate-200">
            <button onClick={() => setViewMode('kanban')} className={`p-1 rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-white shadow-sm text-brand-600' : 'text-slate-500 hover:text-slate-700'}`}><KanbanIcon className="w-4 h-4" /></button>
            <button onClick={() => setViewMode('list')} className={`p-1 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-brand-600' : 'text-slate-500 hover:text-slate-700'}`}><List className="w-4 h-4" /></button>
            <button onClick={() => setViewMode('calendar')} className={`p-1 rounded-md transition-colors ${viewMode === 'calendar' ? 'bg-white shadow-sm text-brand-600' : 'text-slate-500 hover:text-slate-700'}`}><Calendar className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* Always-visible New Enquiry entry form, refactored out of the old popup so the
          page loads with it already open above the table. It is its own card, sitting on
          the page background between the page header and the table. */}
      {entryForm}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[500px]">
      <div className="overflow-x-auto p-4">
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div></div>
        ) : (
          <table className="erp-table w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 text-xs uppercase tracking-wider border-b border-slate-300">
                <th className="p-3 font-semibold">Enquiry No</th>
                <th className="p-3 font-semibold">Date</th>
                <th className="p-3 font-semibold">Company</th>
                <th className="p-3 font-semibold">Products</th>
                <th className="p-3 font-semibold">Remarks</th>
                <th className="p-3 font-semibold">Quantity</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map(enq => (
                <tr key={enq.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="p-3 font-mono text-sm text-slate-800 font-medium">{enq.enquiry_no || 'Pending'}</td>
                  <td className="p-3 text-sm text-slate-800">{enq.received_date ? enq.received_date.split('T')[0] : (enq.created_at ? enq.created_at.split('T')[0] : '')}</td>
                  <td className="p-3 font-semibold text-brand-700 text-sm max-w-[220px] truncate" title={enq.customer}>{enq.customer}</td>
                  <td className="p-3 text-sm text-slate-700 max-w-[260px]">{productNames(enq)}</td>
                  <td className="p-3 text-sm text-slate-800 max-w-[200px] truncate" title={productRemarks(enq)}>{productRemarks(enq)}</td>
                  <td className="p-3 text-sm font-medium text-slate-700">{enq.quantity || '-'}</td>
                  <td className="p-3">
                    <span className="bg-orange-200 text-orange-900 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider">{enq.status || 'New'}</span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => (onView ? onView(enq) : openEnquiry(enq))}>View Details</Button>{onEdit && <Button variant="secondary" size="sm" onClick={() => onEdit(enq)}>Edit</Button>}{onDelete && <Button variant="secondary" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => onDelete(enq)}>Delete</Button>}</div>
                  </td>
                </tr>
              ))}
              {filteredEnquiries.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-slate-500">No enquiries found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <PagerFooter pager={pager} />
      </div>

      <Modal open={!!selectedEnquiry} onClose={() => setSelectedEnquiry(null)} title={`Enquiry Details: ${selectedEnquiry?.enquiry_no || 'Pending'}`} size="xl" footer={<Button onClick={() => setSelectedEnquiry(null)}>Close</Button>}>
        {selectedEnquiry && (
          <div className="flex gap-6">
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Enquiry No"><input className={inputClass} value={selectedEnquiry.enquiry_no || 'Pending'} disabled /></FormField>
                <FormField label="Date"><input className={inputClass} value={selectedEnquiry.received_date?.split('T')[0] || selectedEnquiry.created_at?.split('T')[0] || ''} disabled /></FormField>
                <FormField label="Company"><input className={`${inputClass} font-semibold text-brand-700`} value={selectedEnquiry.customer || ''} disabled /></FormField>
                <FormField label="Status"><input className={inputClass} value={selectedEnquiry.status || 'New'} disabled /></FormField>
                <div className="col-span-2"><FormField label="Product / Description"><input className={inputClass} value={selectedEnquiry.part_name || selectedEnquiry.enquiring_for || ''} disabled /></FormField></div>
                <FormField label="Quantity"><input className={inputClass} value={selectedEnquiry.quantity || ''} disabled /></FormField>
                <div className="col-span-2"><FormField label="Remarks"><textarea className={inputClass} value={selectedEnquiry.lost_reason || ''} disabled rows={2}></textarea></FormField></div>
              </div>
            </div>

            {/* Document Flow Section */}
            <div className="w-64 bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col h-full">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2"><FileText className="w-4 h-4 text-brand-600"/> DOCUMENT FLOW</h3>
              
              <div className="flex flex-col space-y-0 relative pl-4">
                <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-slate-200 z-0"></div>

                <FlowStep active={true} title="ENQUIRY" subtitle={selectedEnquiry.enquiry_no || 'New'} isFirst />
                
                {relatedQuote ? (
                  <FlowStep active={true} title="QUOTATION" subtitle={relatedQuote.quote_no} link />
                ) : (
                  <FlowStep active={false} title="QUOTATION" subtitle="Not Created" />
                )}
                
                <FlowStep active={false} title="SALES ORDER" subtitle="Pending" />
                <FlowStep active={false} title="INWARD" subtitle="Pending" />
                <FlowStep active={false} title="PRODUCTION" subtitle="Pending" />
                <FlowStep active={false} title="FINISHED GOODS" subtitle="Pending" />
                <FlowStep active={false} title="DELIVERY CHALLAN" subtitle="Pending" />
                <FlowStep active={false} title="INVOICE" subtitle="Pending" isLast />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function FlowStep({ active, title, subtitle, link }:{ active: boolean, title: string, subtitle: string, isFirst?: boolean, isLast?: boolean, link?: boolean }) {
  return (
    <div className="relative z-10 flex items-start gap-3 py-3">
      <div className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 ${active ? 'bg-brand-500 border-brand-500' : 'bg-white border-slate-300'}`}></div>
      <div>
        <div className={`font-bold text-[11px] uppercase tracking-wider ${active ? 'text-brand-700' : 'text-slate-400'}`}>{title}</div>
        <div className={`text-[10px] font-mono ${link ? 'text-blue-600 underline cursor-pointer hover:text-blue-800' : (active ? 'text-slate-600' : 'text-slate-400')}`}>{subtitle}</div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { recordDateOf } from '@/lib/globalDate';
import { supabase } from '@/lib/supabase';
import { Search, ArrowLeft, FileText, Eye } from 'lucide-react';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Card';
import { PagerFooter, usePager } from '@/components/ui/TablePager';
import { formatTimestamp } from '@/lib/format';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { CompanyFilterInput } from '@/components/ui/CompanyFilterInput';

export function QuotationModule({ onBack, onEdit, onDelete, refreshSignal, onView, toolbar }: { onBack: () => void; onEdit?: (record: any) => void; onDelete?: (record: any) => void; refreshSignal?: number; onView?: (record: any) => void; /** Quotation tool strip, rendered on the same line as the title and actions. */ toolbar?: React.ReactNode }) {
  const { companyFilter, setCompanyFilter, companyOptions } = useHeaderKpis();
  const [quotations, setQuotations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  
  const [selectedQuote, setSelectedQuote] = useState<any | null>(null);
  
  // Relationships
  const [relatedEnquiry, setRelatedEnquiry] = useState<any | null>(null);
  const [relatedSO, setRelatedSO] = useState<any | null>(null);

  // Modals
  const [enquiryModalOpen, setEnquiryModalOpen] = useState(false);
  const [soModalOpen, setSoModalOpen] = useState(false);
  const [soModalTarget, setSoModalTarget] = useState<any>(null); // quote object

  useEffect(() => {
    fetchQuotations();
  }, [refreshSignal]);

  const fetchQuotations = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('cnc_quotations').select('*').order('created_at', { ascending: false });
    if (error) console.error('Error fetching quotations:', error);
    if (data) setQuotations(data);
    setLoading(false);
  };

  const openQuotation = async (quote: any) => {
    setSelectedQuote(quote);
    setRelatedEnquiry(null);
    setRelatedSO(null);

    // Fetch related enquiry
    if (quote.lead_id) {
      const { data: enq } = await supabase.from('cnc_enquiries').select('*').eq('id', quote.lead_id).single();
      if (enq) setRelatedEnquiry(enq);
    } else if (quote.enquiry_no) {
      const { data: enq } = await supabase.from('cnc_enquiries').select('*').eq('enquiry_no', quote.enquiry_no).limit(1).single();
      if (enq) setRelatedEnquiry(enq);
    }

    // Fetch related Sales Order
    const soFilters = [`quotation_id.eq.${quote.id}`];
    if (quote.quote_no) soFilters.push(`quote_no.eq.${quote.quote_no}`);
    const { data: so } = await supabase.from('cnc_sales_orders')
      .select('id, order_no')
      .or(soFilters.join(','))
      .limit(1)
      .maybeSingle();
    
    if (so) setRelatedSO(so);
  };

  const createSalesOrder = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    // Auto-generate SO number
    const nextSO = `SO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    
    const qty = Number(formData.get('quantity')) || Number(soModalTarget.quantity) || 0;
    const unitPrice = Number(soModalTarget.unit_price) || 0;
    const disc = Number(soModalTarget.discount_percent) || 0;
    const unitDisc = Number(soModalTarget.unit_discount) || 0;
    const gst = Number(soModalTarget.gst_percent) || 0;
    // Re-price from the quotation's unit price when the quantity changes; fall back to the quoted total
    const discountedPrice = Math.max(0, unitPrice * (1 - disc / 100) - unitDisc);
    const orderValue = unitPrice
      ? Number((qty * discountedPrice * (1 + gst / 100)).toFixed(2))
      : (Number(soModalTarget.total_value) || 0);

    const { error } = await supabase.from('cnc_sales_orders').insert({
      order_no: nextSO,
      customer: soModalTarget.customer,
      quote_no: soModalTarget.quote_no,
      quotation_id: soModalTarget.id,
      lead_no: relatedEnquiry?.lead_no || relatedEnquiry?.enquiry_no || soModalTarget.enquiry_no || '',
      customer_id: soModalTarget.customer_id || null,
      part_name: soModalTarget.part_name || soModalTarget.part_number,
      part_number: soModalTarget.part_number || '',
      part_no: soModalTarget.part_number || '',
      contact_person: soModalTarget.contact_person || '',
      phone: soModalTarget.phone || '',
      email: soModalTarget.email || '',
      quantity: qty,
      delivered: 0,
      value: orderValue,
      total_value: orderValue,
      order_date: formData.get('order_date') || null,
      delivery_date: formData.get('delivery_date') || null,
      status: 'Confirmed'
    });

    if (error) {
      alert('Failed to create Sales Order: ' + error.message);
      console.error(error);
    } else {
      alert(`Sales Order ${nextSO} created successfully!`);
      // Update quote status
      const { error: qErr } = await supabase.from('cnc_quotations').update({ status: 'Converted' }).eq('id', soModalTarget.id);
      if (qErr) console.error('Failed to update quotation status:', qErr);

      setSoModalOpen(false);
      setSoModalTarget(null);
      // Refresh current quote view
      openQuotation({...soModalTarget, status: 'Converted'});
      fetchQuotations();
    }
  };

  const companies = useMemo(() => {
    const set = new Set<string>();
    quotations.forEach(q => {
      const c = (q.customer || '').trim();
      if (c) set.add(c);
    });
    companyOptions.forEach(c => {
      if (c && c !== 'All Companies') set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [quotations, companyOptions]);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    quotations.forEach(q => {
      const s = (q.status || 'Sent').trim();
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [quotations]);

  const { from: globalFrom, to: globalTo, inRange: inDateRange } = useGlobalDateFilter();
  const filteredQuotes = quotations.filter(q => {
    const matchesSearch = (q.quote_no || '').toLowerCase().includes(search.toLowerCase()) || 
      (q.customer || '').toLowerCase().includes(search.toLowerCase()) ||
      (q.part_name || '').toLowerCase().includes(search.toLowerCase());
    const matchesCompany = !companyFilter || companyFilter === 'All Companies' || 
      (q.customer || '').trim().toLowerCase() === companyFilter.trim().toLowerCase();
    const matchesStatus = !statusFilter || statusFilter === 'All Status' ||
      (q.status || 'Sent').trim().toLowerCase() === statusFilter.trim().toLowerCase();
    // Global date filter uses the quotation date (not the expiry).
    const matchesDate = inDateRange(recordDateOf(q, ['date', 'quote_date', 'created_at']));
    return matchesSearch && matchesCompany && matchesStatus && matchesDate;
  });

  const sortedQuotes = useMemo(() => {
    return [...filteredQuotes].sort((a, b) => {
      const bTime = new Date(b.created_at || b.date || 0).getTime();
      const aTime = new Date(a.created_at || a.date || 0).getTime();
      return bTime - aTime;
    });
  }, [filteredQuotes]);

  const pager = usePager(sortedQuotes, `${search}||${companyFilter}||${statusFilter}||${globalFrom}||${globalTo}`);

  return (
    <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-violet-400/30 overflow-hidden flex flex-col">
      {/* One line: back + title on the left, the quotation tool strip and the
          Add / search / view-toggle controls grouped flush right. flex-wrap so the
          row breaks cleanly instead of overflowing on narrow viewports. */}
      <div className="px-3 py-1.5 border-b border-slate-200 flex flex-wrap justify-between items-center gap-2 gap-y-1 bg-slate-50">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="p-1 hover:bg-slate-200 rounded-md transition-colors text-slate-600 shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-slate-800 shrink-0">Quotations</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 gap-y-2 min-w-0 md:justify-end">
          {toolbar}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search quotations..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-4 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div></div>
        ) : (
          <table className="erp-table erp-table-violet w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <th className="p-3 font-semibold w-8">#</th>
                <th className="p-3 font-semibold">Timestamp</th>
                <th className="p-3 font-semibold">Quote No</th>
                <th className="p-3 font-semibold">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Company</span>
                    <CompanyFilterInput
                      value={companyFilter || 'All Companies'}
                      onChange={setCompanyFilter}
                      options={companies}
                    />
                  </div>
                </th>
                <th className="p-3 font-semibold">Description</th>
                <th className="p-3 font-semibold">Value</th>
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
              {pager.pageItems.map((quote, idx) => (
                <tr key={quote.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="p-3 text-xs text-slate-400 font-mono">{pager.start + idx + 1}</td>
                  <td className="p-3 text-sm text-slate-600 whitespace-nowrap font-mono">{formatTimestamp(quote.created_at || quote.date)}</td>
                  <td className="p-3 font-mono text-sm text-slate-800 font-medium">{quote.quote_no || 'Pending'}</td>
                  <td className="p-3 font-semibold text-brand-700 text-sm">{quote.customer}</td>
                  <td className="p-3 text-sm text-slate-700">{quote.part_name || '—'}</td>
                  <td className="p-3 text-sm font-medium text-slate-700">₹{quote.total_value?.toLocaleString('en-IN') || '-'}</td>
                  <td className="p-3">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${(quote.status === 'Converted' || quote.status === 'Accepted') ?'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-700'}`}>{quote.status || 'Sent'}</span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" icon={<Eye size={13} />} onClick={() => (onView ? onView(quote) : openQuotation(quote))}>View</Button>{onEdit && <Button variant="secondary" size="sm" onClick={() => onEdit(quote)}>Edit</Button>}{onDelete && <Button variant="secondary" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => onDelete(quote)}>Delete</Button>}</div>
                  </td>
                </tr>
              ))}
              {filteredQuotes.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-slate-500">No quotations found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <PagerFooter pager={pager} />

      <Modal open={!!selectedQuote} onClose={() => setSelectedQuote(null)} title={`Quotation Details: ${selectedQuote?.quote_no || 'Pending'}`} size="xl" footer={
        <div className="flex justify-between w-full">
          <div>
             {!relatedSO && (
               <Button onClick={() => { setSoModalTarget(selectedQuote); setSoModalOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white">Create Sales Order</Button>
             )}
          </div>
          <Button onClick={() => setSelectedQuote(null)}>Close</Button>
        </div>
      }>
        {selectedQuote && (
          <div className="flex gap-6">
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Quotation No"><input className={inputClass} value={selectedQuote.quote_no || 'Pending'} disabled /></FormField>
                <FormField label="Date"><input className={inputClass} value={selectedQuote.date?.split('T')[0] || selectedQuote.created_at?.split('T')[0] || ''} disabled /></FormField>
                
                <div className="col-span-2"><FormField label="Company"><input className={`${inputClass} font-semibold text-brand-700`} value={selectedQuote.customer || ''} disabled /></FormField></div>
                
                <FormField label="Related Enquiry No">
                  <div className="relative">
                    <input className={`${inputClass} cursor-pointer text-blue-600 hover:underline`} value={selectedQuote.enquiry_no || relatedEnquiry?.enquiry_no || 'None'} disabled onClick={() => { if(relatedEnquiry) setEnquiryModalOpen(true); }} />
                    {!relatedEnquiry && selectedQuote.enquiry_no && <div className="text-[10px] text-amber-500 mt-1">Record missing in DB</div>}
                  </div>
                </FormField>
                
                <FormField label="Validity"><input className={inputClass} value={selectedQuote.valid_till || ''} disabled /></FormField>

                <div className="col-span-2"><FormField label="Description"><input className={inputClass} value={selectedQuote.part_name || selectedQuote.description || '—'} disabled /></FormField></div>
                
                <FormField label="Quantity"><input className={inputClass} value={selectedQuote.quantity || ''} disabled /></FormField>
                <FormField label="Rate"><input className={inputClass} value={selectedQuote.unit_price || ''} disabled /></FormField>
                <FormField label="Discount %"><input className={inputClass} value={selectedQuote.discount_percent ?? '0'} disabled /></FormField>
                <FormField label="Unit Discount (₹)"><input className={inputClass} value={selectedQuote.unit_discount ?? '0'} disabled /></FormField>
                
                <FormField label="Total Value"><input className={`${inputClass} font-bold`} value={selectedQuote.total_value || ''} disabled /></FormField>
                <FormField label="Status"><input className={inputClass} value={selectedQuote.status || 'Sent'} disabled /></FormField>
                
                <FormField label="Assigned To"><input className={inputClass} value={selectedQuote.salesperson || 'Admin'} disabled /></FormField>
                <FormField label="Remarks"><textarea className={inputClass} value={selectedQuote.remarks || ''} disabled rows={2}></textarea></FormField>
              </div>
            </div>

            {/* Document Flow Section */}
            <div className="w-64 bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col h-full">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2"><FileText className="w-4 h-4 text-brand-600"/> DOCUMENT FLOW</h3>
              
              <div className="flex flex-col space-y-0 relative pl-4">
                <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-slate-200 z-0"></div>

                {relatedEnquiry ? (
                  <FlowStep active={false} title="ENQUIRY" subtitle={relatedEnquiry.enquiry_no} link onClick={() => setEnquiryModalOpen(true)} isFirst />
                ) : (
                  <FlowStep active={false} title="ENQUIRY" subtitle={selectedQuote.enquiry_no || 'Not Created'} isFirst />
                )}
                
                <FlowStep active={true} title="QUOTATION" subtitle={selectedQuote.quote_no || 'Pending'} highlight />
                
                {relatedSO ? (
                  <FlowStep active={false} title="SALES ORDER" subtitle={relatedSO.order_no} link />
                ) : (
                  <FlowStep active={false} title="SALES ORDER" subtitle="Not Created" />
                )}
                
                <FlowStep active={false} title="INWARD" subtitle="Not Created" />
                <FlowStep active={false} title="PRODUCTION" subtitle="Not Created" />
                <FlowStep active={false} title="FINISHED GOODS" subtitle="Not Created" />
                <FlowStep active={false} title="DELIVERY CHALLAN" subtitle="Not Created" />
                <FlowStep active={false} title="INVOICE" subtitle="Not Created" isLast />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Enquiry Detail Modal from Document Flow */}
      {relatedEnquiry && (
        <Modal open={enquiryModalOpen} onClose={() => setEnquiryModalOpen(false)} title={`Enquiry Details: ${relatedEnquiry.enquiry_no}`} size="lg" footer={<Button onClick={() => setEnquiryModalOpen(false)}>Close</Button>}>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Enquiry No"><input className={inputClass} value={relatedEnquiry.enquiry_no} disabled /></FormField>
            <FormField label="Date"><input className={inputClass} value={relatedEnquiry.received_date?.split('T')[0] || ''} disabled /></FormField>
            <FormField label="Company"><input className={`${inputClass} font-semibold`} value={relatedEnquiry.customer || ''} disabled /></FormField>
            <FormField label="Status"><input className={inputClass} value={relatedEnquiry.status || ''} disabled /></FormField>
            <div className="col-span-2"><FormField label="Description"><input className={inputClass} value={relatedEnquiry.part_name || relatedEnquiry.enquiring_for || ''} disabled /></FormField></div>
            <FormField label="Quantity"><input className={inputClass} value={relatedEnquiry.quantity || ''} disabled /></FormField>
            <FormField label="Estimated Value"><input className={inputClass} value={relatedEnquiry.estimated_value || ''} disabled /></FormField>
          </div>
        </Modal>
      )}

      {/* Create Sales Order Modal */}
      {soModalTarget && (
        <Modal open={soModalOpen} onClose={() => setSoModalOpen(false)} title="Create Sales Order from Quotation" size="xl">
          <form onSubmit={createSalesOrder} className="space-y-4">
            <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm mb-4">
              Converting Quotation <strong>{soModalTarget.quote_no}</strong> to a new Sales Order.
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <FormField label="Company"><input className={`${inputClass} bg-slate-100`} value={soModalTarget.customer} disabled /></FormField>
              </div>
              <FormField label="Quotation Ref"><input className={`${inputClass} bg-slate-100`} value={soModalTarget.quote_no} disabled /></FormField>
              <FormField label="Enquiry Ref"><input className={`${inputClass} bg-slate-100`} value={soModalTarget.enquiry_no || relatedEnquiry?.enquiry_no || ''} disabled /></FormField>
              
              <div className="col-span-2">
                <FormField label="Description"><input className={`${inputClass} bg-slate-100`} value={soModalTarget.part_name || ''} disabled /></FormField>
              </div>
              
              <FormField label="Quantity"><input type="number" name="quantity" className={inputClass} defaultValue={soModalTarget.quantity} required /></FormField>
              <FormField label="Total Value"><input className={`${inputClass} bg-slate-100 font-bold`} value={soModalTarget.total_value || ''} disabled /></FormField>
              
              <FormField label="Order Date"><input type="date" name="order_date" className={inputClass} defaultValue={new Date().toISOString().split('T')[0]} required /></FormField>
              <FormField label="Expected Delivery"><input type="date" name="delivery_date" className={inputClass} required /></FormField>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <Button type="button" variant="secondary" onClick={() => setSoModalOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">Create Sales Order</Button>
            </div>
          </form>
        </Modal>
      )}

    </div>
  );
}

function FlowStep({ active, highlight, title, subtitle, link, onClick }:{ active: boolean, highlight?: boolean, title: string, subtitle: string, isFirst?: boolean, isLast?: boolean, link?: boolean, onClick?: () => void }) {
  return (
    <div className="relative z-10 flex items-start gap-3 py-3">
      <div className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 ${highlight ? 'bg-brand-500 border-brand-500' : (active ? 'bg-white border-brand-400' : 'bg-white border-slate-300')}`}></div>
      <div>
        <div className={`font-bold text-[11px] uppercase tracking-wider ${highlight ? 'text-brand-700' : (active ? 'text-slate-600' : 'text-slate-400')}`}>{title}</div>
        <div onClick={link ? onClick : undefined} className={`text-[10px] font-mono ${link ? 'text-blue-600 underline cursor-pointer hover:text-blue-800' : (highlight ? 'text-slate-700' : 'text-slate-400')}`}>{subtitle}</div>
      </div>
    </div>
  );
}

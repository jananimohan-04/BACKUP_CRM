import { useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { Eye, Edit, ArrowRightCircle, FileText, Trash2 } from 'lucide-react';
import { PageHeader, DateSelector } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge, Button, statusToVariant } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { recordDateOf } from '@/lib/globalDate';
import { generateUniqueProjectNo } from '@/lib/projectNumber';
import { CustomerAutocomplete } from '@/components/ui/CustomerAutocomplete';
import { fetchOrderQty } from '@/lib/orderQuantities';

async function uploadLeadProductFile(companyId: string | undefined | null, file: File) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
  const cId = companyId || 'general';
  const path = `${cId}/enquiries/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from('inventory-images').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) {
    console.warn(`Storage upload warning for ${file.name}:`, error);
  }
  return path;
}

export function LeadsPage({ hideHeader = false, toolbarLeft }: { hideHeader?: boolean; toolbarLeft?: ReactNode } = {}) {
  const { profile, company } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  // Editing a master-only company row (no enquiry): updates cnc_customers only.
  const [masterEditId, setMasterEditId] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<any | null>(null);
  const [viewData, setViewData] = useState({ enquiries: 0, quotes: 0, orders: 0 });
  const [viewHistory, setViewHistory] = useState<any[]>([]);
  const [purchaseHistory, setPurchaseHistory] = useState<any[]>([]);
  const [completedInwards, setCompletedInwards] = useState<any[]>([]);

  useEffect(() => {
    if (viewTarget) {
      const fetchHistory = async () => {
        const { data: enqs } = await supabase.from('cnc_enquiries').select('*').eq('customer', viewTarget.company).order('created_at', { ascending: false });
        
        if (enqs) {
           setViewHistory(enqs.map((d: any) => ({
              id: d.id,
              leadNo: d.lead_no || `LD-${d.enquiry_no}`,
              company: d.customer,
              contactPerson: d.contact_person || '',
              phone: d.phone || '',
              email: d.email || '',
              city: d.city || '',
              gst: d.gst || '',
              enquiringFor: d.enquiring_for || '',
              partName: d.part_name,
              partNo: d.part_no,
              quantity: d.quantity,
              expectedDate: d.expected_date,
              status: d.status || 'New',
              estimatedValue: Number(d.estimated_value),
              source: d.source || 'Direct',
              notes: d.notes || '',
              remarks: d.remarks || '',
              allocation: d.remarks || ''
           })));
        }

        const [q, o, inv] = await Promise.all([
           supabase.from('cnc_quotations').select('*', { count: 'exact', head: true }).eq('customer', viewTarget.company),
           supabase.from('cnc_sales_orders').select('*', { count: 'exact', head: true }).eq('customer', viewTarget.company),
           supabase.from('cnc_invoices').select('*').eq('customer_name', viewTarget.company).not('pipeline_completed_at', 'is', null).order('created_at', { ascending: false })
        ]);
        setViewData({ enquiries: enqs?.length || 0, quotes: q.count || 0, orders: o.count || 0 });
        
        // Fetch purchase history from enquiry remarks (stored as JSON by handleCompleteInvoice)
        let purchaseHist: any[] = [];
        if (inv.data && inv.data.length > 0) {
          purchaseHist = inv.data.map((i: any) => ({
            invoice_no: i.invoice_no, part_name: i.part_name || i.item || '-',
            quantity: i.quantity || 0, total_value: i.amount || 0,
            date: i.invoice_date || (i.created_at ? i.created_at.split('T')[0] : '')
          }));
        }
        // Also check enquiry remarks for stored history
        if (enqs) {
          enqs.forEach((e: any) => {
            try {
              if (e.remarks) {
                const parsed = JSON.parse(e.remarks);
                if (Array.isArray(parsed)) {
                  parsed.forEach((h: any) => {
                    if (h.invoice_no) purchaseHist.push({
                      invoice_no: h.invoice_no, part_name: h.part_name || '-',
                      quantity: h.quantity || 0, total_value: h.total_value || 0,
                      date: h.completed_at ? h.completed_at.split('T')[0] : ''
                    });
                  });
                }
              }
            } catch { /* not JSON */ }
          });
        }
        // Inwards whose production is complete (nothing remaining) no longer show on the pipeline.
        try {
          const { data: inws } = await supabase.from('cnc_inwards').select('*').eq('party_name', viewTarget.company);
          const bySo = new Map<string, any[]>();
          (inws ?? []).forEach((r: any) => { const k = String(r.sales_order_ref || ''); if (k) bySo.set(k, [...(bySo.get(k) ?? []), r]); });
          const done: any[] = [];
          for (const [soNo, rows] of bySo) {
            const { summary } = await fetchOrderQty(null, soNo);
            if (summary && summary.ordered > 0 && summary.remaining <= 0) {
              done.push({
                inward_no: rows[0].inward_no || soNo, so_no: soNo,
                products: [...new Set(rows.map((r: any) => r.part_name || r.product_name).filter(Boolean))].join(', ') || '-',
                ordered: summary.ordered, finished: summary.good,
                date: rows.map((r: any) => r.created_at).filter(Boolean).sort().reverse()[0]?.split('T')[0] ?? '',
              });
            }
          }
          setCompletedInwards(done);
        } catch { setCompletedInwards([]); }
        // Deduplicate by invoice_no
        const seen = new Set();
        setPurchaseHistory(purchaseHist.filter(h => { if (seen.has(h.invoice_no)) return false; seen.add(h.invoice_no); return true; }));
      };
      fetchHistory();
    }
  }, [viewTarget]);
  const [quotationTarget, setQuotationTarget] = useState<any | null>(null);
  const [quoteSelectTarget, setQuoteSelectTarget] = useState<any[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ row: any; quotes: number; orders: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openQuoteModal = (enq: any) => {
    const qNo = `QT-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    setQuoteForm({
        quoteNo: qNo, customer: enq.customer || enq.company, leadNo: enq.leadNo || enq.lead_no || `LD-${enq.enquiry_no}`, quoteDate: new Date().toISOString().split('T')[0], validTill: enq.expectedDate || enq.expected_date || '', salesperson: profile?.full_name || '',
        partName: enq.partName || enq.part_name, partNumber: enq.partNo || enq.part_no || '', description: '', quantity: (enq.quantity)?.toString() || '0', unitPrice: '', discount: '0', unitDiscount: '0', gst: '18',
        paymentTerms: '', deliveryTerms: '', remarks: ''
    });
    setQuotationTarget({ id: enq.id, contactPerson: enq.contactPerson || enq.contact_person, phone: enq.phone, email: enq.email, company: enq.customer || enq.company });
    setQuoteSelectTarget(null);
  };

  const [quoteForm, setQuoteForm] = useState<any>({
      quoteNo: '', customer: '', leadNo: '', quoteDate: '', validTill: '', salesperson: '',
      partName: '', partNumber: '', description: '', quantity: '', unitPrice: '', discount: '0', unitDiscount: '0', gst: '18',
      paymentTerms: '', deliveryTerms: '', remarks: ''
  });
  const [leadsData, setLeadsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  const resetForm = (leads = leadsData) => ({
    leadNo: generateUniqueProjectNo(leads),
    customer: '', contacts: [{ person: '', phone: '', email: '' }], city: '', gst: '', enquiringFor: '', 
    items: [{ productName: '', quantity: '', files: [] as File[], filePaths: [] as string[] }],
    partName: '', partNo: '', quantity: '', estimatedValue: '', expectedDate: '', source: 'Direct', status: 'New', notes: ''
  });
  const [formData, setFormData] = useState(resetForm());
  const [customerList, setCustomerList] = useState<any[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  useEffect(() => {
    fetchLeads();
    fetchCustomers();
  }, [company?.id]);

  async function fetchCustomers() {
    let query = supabase.from('cnc_customers').select('*');
    if (company?.id) {
      query = query.eq('company_id', company.id);
    }
    const { data, error } = await query;
    if (error) {
      console.error('[LeadsPage] Error fetching customers:', error);
    } else if (data) {
      setCustomerList(data);
    }
  }

  const allKnownCompanies = useMemo(() => {
    const map = new Map<string, { company: string; contact_person?: string; phone?: string; email?: string; city?: string; address?: string; gst?: string; gstin?: string; id?: string }>();
    (leadsData || []).forEach((l: any) => {
      const name = (l.company || l.customer)?.trim();
      if (!name) return;
      const key = name.toLowerCase();
      const existing = map.get(key);
      const addr = l.address || l.city || existing?.address || existing?.city || '';
      const gstVal = l.gst || l.gstin || existing?.gst || existing?.gstin || '';
      map.set(key, {
        company: name,
        contact_person: l.contactPerson || l.contact_person || existing?.contact_person || '',
        phone: l.phone || existing?.phone || '',
        email: l.email || existing?.email || '',
        city: l.city || existing?.city || '',
        address: addr,
        gst: gstVal,
        gstin: gstVal,
        id: l.id || existing?.id || '',
      });
    });
    (customerList || []).forEach((c: any) => {
      const name = c.name?.trim();
      if (!name) return;
      const key = name.toLowerCase();
      const existing = map.get(key);
      const addrCandidates = [c.address, c.billing_address, c.city, existing?.address, existing?.city].filter(Boolean).map((s: any) => String(s).trim());
      const bestAddr = addrCandidates.sort((a, b) => b.length - a.length)[0] || '';
      const gstVal = c.gst || c.gstin || c.gst_number || (c as any).gst_no || existing?.gst || existing?.gstin || '';
      map.set(key, {
        company: name,
        contact_person: existing?.contact_person || c.contact || '',
        phone: existing?.phone || c.phone || '',
        email: existing?.email || c.email || '',
        city: c.city || existing?.city || '',
        address: bestAddr,
        gst: gstVal,
        gstin: gstVal,
        id: c.id || existing?.id || '',
      });
    });
    return Array.from(map.values()).sort((a, b) => a.company.localeCompare(b.company));
  }, [customerList, leadsData]);

  // Company-master rows with no enquiry yet still list under All Companies
  // (blank product/status cells). Their Company ID is the master CUST-xxxx id.
  // The global date filter keeps a company when at least one of its enquiries
  // (by received date) falls in range; master-only rows have no date and stay.
  const { inRange: inDateRange } = useGlobalDateFilter();
  const displayLeads = useMemo(() => {
    const ranged = (leadsData || []).map((l: any) => {
      if (l.isMasterOnly) return l;
      const rows = (l.allEnquiries || []).filter((d: any) =>
        inDateRange(recordDateOf(d, ['received_date', 'created_at'])));
      if (rows.length === 0) return null;
      const statusSummary: Record<string, number> = {};
      for (const d of rows) {
        const st = d.status || 'New';
        statusSummary[st] = (statusSummary[st] || 0) + 1;
      }
      return { ...l, allEnquiries: rows, statusSummary };
    }).filter(Boolean);
    const grouped = new Set((leadsData || []).map((l: any) => String(l.company || '').trim().toLowerCase()));
    const extras = (customerList || [])
      .filter((c: any) => String(c.name || '').trim() && !grouped.has(String(c.name).trim().toLowerCase()))
      .map((c: any) => ({
        id: c.id,
        leadNo: c.id,
        company: String(c.name).trim(),
        contactPerson: c.contact || '',
        phone: c.phone || '',
        email: c.email || '',
        city: c.city || '',
        gst: c.gst || c.gstin || c.gst_number || '',
        enquiringFor: '',
        partName: '',
        partNo: '',
        quantity: '',
        expectedDate: '',
        status: '',
        estimatedValue: 0,
        source: '',
        remarks: '',
        allocation: '',
        statusSummary: {},
        allEnquiries: [],
        isMasterOnly: true,
      }));
    return [...ranged, ...extras];
  }, [leadsData, customerList, inDateRange]);

  async function fetchLeads() {
    try {
      setLoading(true);
      let query = supabase.from('cnc_enquiries').select('*').order('created_at', { ascending: false });
      if (company?.id) {
        query = query.eq('company_id', company.id);
      }
      const { data, error } = await query;
      if (error) {
        console.error('Error fetching leads:', error);
        setDbError(true);
      } else if (data) {
        setDbError(false);
        const groupedMap = new Map();
        data.forEach((d: any) => {
          const st = d.status || 'New';
          if (!groupedMap.has(d.customer)) {
            groupedMap.set(d.customer, {
              id: d.id,
              leadNo: d.lead_no || `LD-${d.enquiry_no}`,
              company: d.customer,
              contactPerson: d.contact_person || '',
              phone: d.phone || '',
              email: d.email || '',
              city: d.city || '',
              gst: d.gst || '',
              enquiringFor: d.enquiring_for || '',
              partName: d.part_name,
              partNo: d.part_no,
              quantity: d.quantity,
              expectedDate: d.expected_date,
              status: st,
              estimatedValue: Number(d.estimated_value),
              source: d.source || 'Direct',
              remarks: d.remarks || '',
              allocation: d.remarks || '',
              statusSummary: { [st]: 1 },
              allEnquiries: [d]
            });
          } else {
            const existing = groupedMap.get(d.customer);
            existing.statusSummary[st] = (existing.statusSummary[st] || 0) + 1;
            existing.allEnquiries.push(d);
          }
        });
        const leadsList = Array.from(groupedMap.values());
        setLeadsData(leadsList);
        setFormData(prev => {
          if (!prev.leadNo || prev.leadNo.startsWith('PROJ-')) {
            return { ...prev, leadNo: generateUniqueProjectNo(data) };
          }
          return prev;
        });
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      setDbError(true);
    } finally {
      setLoading(false);
    }
  }

  const openProductFile = async (path: string) => {
    if (path.startsWith('data:') || path.startsWith('blob:') || path.startsWith('http')) {
      window.open(path, '_blank');
      return;
    }
    const tab = window.open('', '_blank');
    if (!tab) { alert('Allow pop-ups to open the attachment.'); return; }
    const { data, error } = await supabase.storage.from('inventory-images').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      tab.close();
      alert(error?.message || 'Unable to open attachment.');
      return;
    }
    tab.location.href = data.signedUrl;
  };

  const handleEditClick = (r: any) => {
    // Master-only rows edit the company master (no enquiry fields).
    if (r.isMasterOnly) {
      const parts = (p: any) => String(p || '').split(' | ').map((s: string) => s.trim());
      const persons = parts(r.contactPerson);
      const phones = parts(r.phone);
      const emails = parts(r.email);
      const n = Math.max(persons.length, phones.length, emails.length, 1);
      setFormData({
        ...resetForm(),
        customer: r.company,
        contacts: Array.from({ length: n }).map((_, i) => ({
          person: persons[i] || '', phone: phones[i] || '', email: emails[i] || '',
        })),
        city: r.city || '',
        gst: r.gst || '',
        source: 'Direct',
      });
      setMasterEditId(r.id);
      setEditId(null);
      setShowAdd(true);
      return;
    }
    let parsedItems = [{ productName: r.partName || '', quantity: r.quantity?.toString() || '', files: [] as File[], filePaths: [] as string[] }];
    try {
      const raw = r.enquiringFor ?? r.enquiring_for;
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsedItems = parsed.map((p: any) => ({
            productName: p.productName || p.partName || '',
            quantity: (p.quantity || '').toString(),
            files: [] as File[],
            filePaths: Array.isArray(p.filePaths) ? p.filePaths : []
          }));
        }
      }
    } catch {}

    setFormData({
      leadNo: r.leadNo,
      customer: r.company,
      contacts: r.contactPerson ? r.contactPerson.split(' | ').map((p: string, i: number) => ({
        person: p,
        phone: (r.phone || '').split(' | ')[i] || '',
        email: (r.email || '').split(' | ')[i] || ''
      })) : [{ person: '', phone: '', email: '' }],
      city: r.city || '',
      gst: r.gst || '',
      enquiringFor: r.enquiringFor ?? r.enquiring_for ?? '',
      items: parsedItems,
      partName: r.partName,
      partNo: r.partNo || '',
      quantity: r.quantity?.toString() || '',
      estimatedValue: r.estimatedValue?.toString() || '',
      expectedDate: r.expectedDate || '',
      source: r.source,
      status: r.status,
      notes: r.notes || ''
    });
    setEditId(r.id);
    setMasterEditId(null);
    setShowAdd(true);
  };

  // Company-master save only (new company + master-row edit): writes
  // cnc_customers and never creates or touches an enquiry. The Company ID
  // (CUST-xxxx) is generated in the background for new rows.
  const saveCompanyMaster = async () => {
    const name = String(formData.customer || '').trim();
    if (!name) {
      alert("Please enter company name.");
      return;
    }
    setLoading(true);
    try {
      const person = (formData.contacts || []).map((c: any) => c.person).join(' | ');
      const phone = (formData.contacts || []).map((c: any) => c.phone).join(' | ');
      const email = (formData.contacts || []).map((c: any) => c.email).join(' | ');
      const stripUnknown = async (op: (payload: any) => any, payload: any): Promise<any> => {
        const remaining = { ...payload };
        for (let attempt = 0; attempt < 10; attempt++) {
          const res = await op(remaining);
          if (!res.error) return null;
          const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(res.error.message || '');
          if (m && Object.prototype.hasOwnProperty.call(remaining, m[1])) {
            delete remaining[m[1]];
            continue;
          }
          return res.error;
        }
        return new Error('Company save failed after retries.');
      };
      if (masterEditId) {
        const err = await stripUnknown(
          (p) => supabase.from('cnc_customers').update(p).eq('id', masterEditId),
          {
            name, contact: person || null, phone: phone || null, email: email || null,
            city: formData.city || null, gst: formData.gst || null, source: formData.source || null,
          },
        );
        if (err) throw err;
      } else {
        const dup = (customerList || []).some((c: any) => String(c.name || '').trim().toLowerCase() === name.toLowerCase());
        if (dup) {
          alert(`Company "${name}" already exists in the company master.`);
          return;
        }
        const payload: any = {
          id: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
          name,
          contact: person || null, phone: phone || null, email: email || null,
          city: formData.city || null, gst: formData.gst || null, source: formData.source || null,
          status: 'Active',
        };
        if (company?.id) payload.company_id = company.id;
        const err = await stripUnknown((p) => supabase.from('cnc_customers').insert([p]), payload);
        if (err) throw err;
      }
      await fetchCustomers();
      setShowAdd(false);
      setMasterEditId(null);
    } catch (err: any) {
      console.error('Failed to save company:', err);
      alert('Failed to save company: ' + (err?.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.customer?.trim()) {
      alert("Please enter company name.");
      return;
    }
    // New companies save to the master only (no enquiry is created here).
    if (!editId) {
      await saveCompanyMaster();
      return;
    }
    const enteredProducts = (formData.items || []).filter((item: any) => String(item.productName || item.partName || '').trim());
    let finalItems = enteredProducts;
    if (!finalItems.length && formData.partName?.trim()) {
      finalItems = [{ productName: formData.partName.trim(), quantity: formData.quantity || '0', files: [], filePaths: [] }];
    }
    if (!finalItems.length) {
      alert("Please enter at least one product name.");
      return;
    }
    if (finalItems.some((item: any) => Number(item.quantity) < 0)) {
      alert("Product quantities cannot be negative.");
      return;
    }
    
    setLoading(true);
    try {
      const companyId = company?.id;
      const itemsToSave = await Promise.all(finalItems.map(async (item: any) => {
        let uploadedPaths: string[] = [];
        if ((item.files || []).length > 0) {
          try {
            uploadedPaths = await Promise.all((item.files || []).map((file: File) => uploadLeadProductFile(companyId, file)));
          } catch (upErr: any) {
            console.warn("Storage upload warning:", upErr);
          }
        }
        return {
          productName: String(item.productName || item.partName).trim(),
          partName: String(item.productName || item.partName).trim(),
          quantity: item.quantity || '0',
          filePaths: [...(item.filePaths || []), ...uploadedPaths],
        };
      }));

      const firstItem = itemsToSave[0];
      const productNamesList = itemsToSave.map((it: any) => it.productName).join(', ');
      const multiplePartsString = itemsToSave.length > 1 ? `${productNamesList} (${itemsToSave.length} Products)` : firstItem.productName;
      const totalQty = itemsToSave.reduce((sum: number, it: any) => sum + (Number(it.quantity) || 0), 0);

      const entryData: any = {
        lead_no: formData.leadNo,
        customer: formData.customer,
        contact_person: formData.contacts.map((c: any) => c.person).join(' | '),
        phone: formData.contacts.map((c: any) => c.phone).join(' | '),
        email: formData.contacts.map((c: any) => c.email).join(' | '),
        city: formData.city,
        gst: formData.gst,
        enquiring_for: JSON.stringify(itemsToSave),
        part_name: multiplePartsString,
        part_no: formData.partNo || 'N/A',
        quantity: totalQty,
        estimated_value: Number(formData.estimatedValue) || 0,
        expected_date: formData.expectedDate || null,
        source: formData.source,
        status: formData.status
      };

      if (companyId) {
        entryData.company_id = companyId;
      }

      const { error } = editId
        ? await supabase.from('cnc_enquiries').update(entryData).eq('id', editId)
        : await supabase.from('cnc_enquiries').insert([{
            ...entryData,
            id: crypto.randomUUID(),
            enquiry_no: formData.leadNo,
            received_date: new Date().toISOString().split('T')[0],
            pipeline_stage: 'Enquiry'
          }]);
      if (error) {
        console.error('Failed to save lead:', error);
        alert('Failed to save company: ' + error.message);
        return;
      }

      // Auto-sync customer to cnc_customers if not yet existing
      try {
        const custExists = customerList.some(c => c.name?.toLowerCase() === formData.customer.toLowerCase());
        if (!custExists) {
          const custPayload: any = {
            id: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
            name: formData.customer,
            contact: formData.contacts?.[0]?.person || null,
            phone: formData.contacts?.[0]?.phone || null,
            email: formData.contacts?.[0]?.email || null,
            city: formData.city || null,
            status: 'Active'
          };
          if (companyId) custPayload.company_id = companyId;
          await supabase.from('cnc_customers').insert([custPayload]);
        }
      } catch (cErr) {
        console.warn('Customer auto-insert error:', cErr);
      }

      await fetchLeads();
      setShowAdd(false);
      setEditId(null);
      setMasterEditId(null);
    } catch (err: any) {
      console.error('Failed to save lead:', err);
      alert('Failed to save company: ' + (err?.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateQuotation = async () => {
    if (!quotationTarget) return;
    setLoading(true);

    const q = Number(quoteForm.quantity) || 0; const p = Number(quoteForm.unitPrice) || 0;
    const d = Number(quoteForm.discount) || 0; const ud = Number(quoteForm.unitDiscount) || 0; const g = Number(quoteForm.gst) || 0;
    const discounted = Math.max(0, p * (1 - d / 100) - ud);
    const total = q * discounted * (1 + g / 100);
    
    const quotePayload: any = {
      id: crypto.randomUUID(), quote_no: quoteForm.quoteNo, customer: quoteForm.customer, part_name: quoteForm.partName,
      contact_person: quotationTarget.contactPerson, phone: quotationTarget.phone, email: quotationTarget.email,
      enquiry_no: quoteForm.leadNo || null,
      part_number: quoteForm.partNumber || 'N/A', description: quoteForm.description, unit_price: p,
      unit_discount: ud,
      quantity: q, total_value: total, date: quoteForm.quoteDate || null, valid_till: quoteForm.validTill || null, status: 'Sent',
      salesperson: quoteForm.salesperson, discount_percent: d, gst_percent: g,
      payment_terms: quoteForm.paymentTerms, delivery_terms: quoteForm.deliveryTerms, remarks: quoteForm.remarks, lead_id: quotationTarget.id
    };

    let { error: quoteErr } = await supabase.from('cnc_quotations').insert([quotePayload]);
    if (quoteErr && (quoteErr.message?.includes('unit_discount') || quoteErr.code === '42703')) {
      const { unit_discount, ...fallback } = quotePayload;
      const res = await supabase.from('cnc_quotations').insert([fallback]);
      quoteErr = res.error;
    }

    if (!quoteErr) {
      // Update lead
      const { error: enqErr } = await supabase.from('cnc_enquiries').update({
        status: 'Quoted',
        pipeline_stage: 'Quotation'
      }).eq('id', quotationTarget.id);
      if (enqErr) console.error('Failed to update lead status:', enqErr);
      setQuotationTarget(null);
      await fetchLeads();
    } else {
      alert("Error: " + quoteErr.message);
      setLoading(false);
    }
  };



  const handleQuickStatusChange = async (id: string, newStatus: string) => {
    const { error } = await supabase.from('cnc_enquiries').update({ status: newStatus }).eq('id', id);
    if (error) { alert('Failed to update status: ' + error.message); return; }
    setViewHistory(prev => prev.map(item => item.id === id ? { ...item, status: newStatus } : item));
    fetchLeads();
  };

  const openDeleteLead = async (r: any) => {
    const enquiryIds: string[] = (r.allEnquiries || []).map((e: any) => String(e.id));
    let quoteIds: string[] = [];
    let orderCount = 0;
    try {
      if (enquiryIds.length > 0) {
        const { data: quotes } = await supabase.from('cnc_quotations').select('id').in('lead_id', enquiryIds);
        quoteIds = (quotes ?? []).map((q: any) => String(q.id));
      }
      if (quoteIds.length > 0) {
        const { count } = await supabase.from('cnc_sales_orders').select('id', { count: 'exact', head: true }).in('quotation_id', quoteIds);
        orderCount = count ?? 0;
      }
    } catch (e) {
      console.warn('Delete preview lookup failed:', e);
    }
    setDeleteTarget({ row: { ...r, _quoteIds: quoteIds }, quotes: quoteIds.length, orders: orderCount });
  };

  const confirmDeleteLead = async () => {
    if (!deleteTarget || deleting) return;
    const company: string = deleteTarget.row.company;
    const enquiryIds: string[] = (deleteTarget.row.allEnquiries || []).map((e: any) => String(e.id));
    const quoteIds: string[] = deleteTarget.row._quoteIds || [];
    setDeleting(true);
    try {
      // Sales orders + work orders tied to these quotations.
      let soIds: string[] = [];
      let soNos: string[] = [];
      let woIds: string[] = [];
      let woNos: string[] = [];
      let invIds: string[] = [];
      if (quoteIds.length > 0) {
        const { data: sos } = await supabase.from('cnc_sales_orders').select('id,order_no').in('quotation_id', quoteIds);
        soIds = (sos ?? []).map((s: any) => String(s.id));
        soNos = (sos ?? []).map((s: any) => String(s.order_no)).filter(Boolean);
      }
      if (soNos.length > 0) {
        const { data: wos } = await supabase.from('cnc_work_orders').select('id,wo_no').in('sales_order', soNos);
        woIds = (wos ?? []).map((w: any) => String(w.id));
        woNos = (wos ?? []).map((w: any) => String(w.wo_no)).filter(Boolean);
      }
      const { data: invs } = await supabase.from('cnc_invoices').select('id').eq('customer_name', company);
      invIds = (invs ?? []).map((i: any) => String(i.id));

      // Children first.
      if (invIds.length > 0) await supabase.from('cnc_invoice_items').delete().in('invoice_id', invIds);
      if (quoteIds.length > 0 || soIds.length > 0) {
        let csq: any = supabase.from('cnc_costing_sheets').delete();
        const orParts: string[] = [];
        if (quoteIds.length > 0) orParts.push(`quotation_id.in.(${quoteIds.join(',')})`);
        if (soIds.length > 0) orParts.push(`sales_order_id.in.(${soIds.join(',')})`);
        await csq.or(orParts.join(','));
      }
      if (soIds.length > 0 || woIds.length > 0) {
        let wq: any = supabase.from('cnc_work_order_operations').delete();
        const orParts: string[] = [];
        if (soIds.length > 0) orParts.push(`sales_order_id.in.(${soIds.join(',')})`);
        if (woIds.length > 0) orParts.push(`work_order_id.in.(${woIds.join(',')})`);
        await wq.or(orParts.join(','));
      }
      if (woNos.length > 0) await supabase.from('cnc_job_cards').delete().in('work_order', woNos);
      if (woNos.length > 0) await supabase.from('cnc_work_orders').delete().in('wo_no', woNos);
      await supabase.from('cnc_deliveries').delete().eq('customer_name', company);
      if (invIds.length > 0) await supabase.from('cnc_invoices').delete().in('id', invIds);
      if (soIds.length > 0) await supabase.from('cnc_sales_orders').delete().in('id', soIds);
      if (quoteIds.length > 0) await supabase.from('cnc_quotations').delete().in('id', quoteIds);
      const pipeIds = [...enquiryIds, ...quoteIds, ...soIds, ...woIds];
      if (pipeIds.length > 0) await supabase.from('cnc_pipeline_comments').delete().in('record_id', pipeIds);
      if (enquiryIds.length > 0) await supabase.from('cnc_enquiries').delete().in('id', enquiryIds);
      await supabase.from('cnc_customers').delete().eq('name', company);

      setDeleteTarget(null);
      await fetchLeads();
      await fetchCustomers();
    } catch (err: any) {
      console.error('Failed to delete lead:', err);
      alert('Failed to delete company: ' + (err?.message || 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<any>[] = [
    { key: 'leadNo', label: 'Company ID', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-500">{r.leadNo}</span> },
    { key: 'company', label: 'Company', sortable: true, render: (r) => <span className="font-semibold text-slate-800">{r.company}</span> },
    { key: 'city', label: 'Address', render: (r) => <span className="text-sm text-slate-600">{r.city || '—'}</span> },
    { key: 'gst', label: 'GST No.', render: (r) => <span className="text-sm text-slate-600">{r.gst || '—'}</span> },
    { key: 'contactPerson', label: 'Contact', render: (r) => <div><p className="text-sm">{r.contactPerson}</p><p className="text-xs text-slate-500">{r.phone}</p></div> },
    { key: 'source', label: 'Source', render: (r) => <Badge variant="neutral">{r.source || '—'}</Badge> },
    { key: 'status', label: 'Status Summary', render: (r) => (
      <div className="flex flex-wrap gap-1 max-w-[150px]">
        {Object.entries(r.statusSummary || {}).map(([st, count]) => (
          <Badge key={st} variant={statusToVariant(st)}>{count as React.ReactNode} {st}</Badge>
        ))}
      </div>
    ) },
    { key: 'actions', label: 'Actions', align: 'right', render: (r) => {
        const activeEnqs = (r.allEnquiries || []).filter((e: any) => e.status !== 'Converted' && e.status !== 'Lost' && e.status !== 'Quoted');
        const hasActive = activeEnqs.length > 0;

        return (
        <div className="flex items-center justify-end gap-1">
          {hasActive && (
            <button onClick={() => {
              if (activeEnqs.length === 1) openQuoteModal(activeEnqs[0]);
              else setQuoteSelectTarget(activeEnqs);
            }} title="Create Quotation" className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"><ArrowRightCircle size={15} /></button>
          )}
          <button onClick={() => setViewTarget(r)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Eye size={15} /></button>
          <button onClick={() => handleEditClick(r)} title="Edit Latest Enquiry" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit size={15} /></button>
          <button onClick={() => openDeleteLead(r)} title="Delete Company" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>
        </div>
      );
    } }
    ];

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      {!hideHeader && <PageHeader title="All Company Library" description="Manage all incoming enquiries and convert qualified companies to companies" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}</div>} />}

      <DataTable data={displayLeads} columns={columns} searchKeys={['company', 'leadNo', 'city', 'gst']} onAdd={() => { setEditId(null); setMasterEditId(null); setFormData(resetForm()); setShowAdd(true); }} addLabel="New Company" inlineAdd toolbarLeft={toolbarLeft} toolbarDate={<DateSelector />} filterOptions={[{ label: 'New', value: 'New' }, { label: 'Converted', value: 'Converted' }, { label: 'Lost', value: 'Lost' }]} />

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={editId || masterEditId ? "Edit Company" : "Add New Company"} size="sm" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave}>Save Company</Button></>}>
        <div className="grid grid-cols-3 gap-3">
          {editId && (
            <FormField label="Company ID" required><input className={inputClass} value={formData.leadNo} onChange={e => setFormData({...formData, leadNo: e.target.value})} placeholder="e.g. 1840 or Custom Company ID" /></FormField>
          )}
          <CustomerAutocomplete
            label="Company Name"
            required
            value={formData.customer}
            onChange={val => {
              const matched = allKnownCompanies.find(c => c.company.toLowerCase() === val.trim().toLowerCase());
              setFormData(prev => ({
                ...prev,
                customer: val,
                contacts: matched && (matched.contact_person || matched.phone || matched.email)
                  ? [{ person: matched.contact_person || '', phone: matched.phone || '', email: matched.email || '' }]
                  : prev.contacts,
                city: matched?.address || matched?.city || prev.city,
                gst: matched?.gst || (matched as any)?.gstin || prev.gst
              }));
            }}
            onSelectCustomer={c => {
              setFormData(prev => ({
                ...prev,
                customer: c.company,
                contacts: (c.contact_person || c.phone || c.email)
                  ? [{ person: c.contact_person || '', phone: c.phone || '', email: c.email || '' }]
                  : prev.contacts,
                city: (c as any).address || c.city || prev.city,
                gst: c.gst || (c as any).gstin || prev.gst
              }));
            }}
            companies={allKnownCompanies}
            inputClass={inputClass}
            placeholder="e.g. Acme Corp"
          />
          <FormField label="Address"><input className={inputClass} value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} /></FormField>
          <FormField label="GST No."><input className={inputClass} value={formData.gst} onChange={e => setFormData({...formData, gst: e.target.value})} /></FormField>
          <div className="col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-500 uppercase">Contact Persons</label>
              <button onClick={() => setFormData({...formData, contacts: [...formData.contacts, { person: '', phone: '', email: '' }]})} className="text-xs text-blue-600 font-bold flex items-center gap-1">+ Add Contact Person</button>
            </div>
            {formData.contacts.map((c: any, i: number) => (
              <div key={i} className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <input placeholder="Name" className={inputClass} value={c.person} onChange={e => { const nc = [...formData.contacts]; nc[i].person = e.target.value; setFormData({...formData, contacts: nc}); }} />
                <input placeholder="Phone" className={inputClass} value={c.phone} onChange={e => { const nc = [...formData.contacts]; nc[i].phone = e.target.value; setFormData({...formData, contacts: nc}); }} />
                <input placeholder="Email" className={inputClass} value={c.email} onChange={e => { const nc = [...formData.contacts]; nc[i].email = e.target.value; setFormData({...formData, contacts: nc}); }} />
              </div>
            ))}
          </div>

          <FormField label="Source">
            <select className={inputClass} value={formData.source} onChange={e => setFormData({...formData, source: e.target.value})}>
              <option>Direct</option><option>Website</option><option>Referral</option><option>Phone</option><option>Email</option><option>Other</option>
            </select>
          </FormField>

        </div>
      </Modal>

      <Modal open={!!quotationTarget} onClose={() => setQuotationTarget(null)} title="CREATE QUOTATION" size="lg" footer={<><Button variant="secondary" onClick={() => setQuotationTarget(null)}>Cancel</Button><Button onClick={handleCreateQuotation}>Create Quotation</Button></>}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-4 pb-4 border-b border-slate-100">
              <FormField label="Quotation No." required><input className={inputClass} value={quoteForm.quoteNo} disabled /></FormField>
              <CustomerAutocomplete
                label="Company"
                required
                value={quoteForm.customer || ''}
                onChange={val => setQuoteForm((prev: any) => ({ ...prev, customer: val }))}
                onSelectCustomer={c => {
                  setQuoteForm((prev: any) => ({
                    ...prev,
                    customer: c.company
                  }));
                }}
                companies={allKnownCompanies}
                inputClass={inputClass}
                placeholder="Type or select company..."
              />
              <FormField label="Enquiry / Company No." required><input className={inputClass} value={quoteForm.leadNo} disabled /></FormField>
              <FormField label="Quotation Date" required><input type="date" className={inputClass} value={quoteForm.quoteDate} onChange={e=>setQuoteForm({...quoteForm, quoteDate: e.target.value})} /></FormField>
              <FormField label="Valid Till" required><input type="date" className={inputClass} value={quoteForm.validTill} onChange={e=>setQuoteForm({...quoteForm, validTill: e.target.value})} /></FormField>
              <FormField label="Salesperson"><input className={inputClass} value={quoteForm.salesperson} onChange={e=>setQuoteForm({...quoteForm, salesperson: e.target.value})} /></FormField>
            </div>
            
            <h4 className="font-semibold text-sm text-slate-800">Product Details</h4>
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Product Name" required><input className={inputClass} value={quoteForm.partName} onChange={e=>setQuoteForm({...quoteForm, partName: e.target.value})} /></FormField>
              <FormField label="Description"><input className={inputClass} value={quoteForm.description} onChange={e=>setQuoteForm({...quoteForm, description: e.target.value})} /></FormField>
              <FormField label="Quantity" required><input type="number" className={inputClass} value={quoteForm.quantity} onChange={e=>setQuoteForm({...quoteForm, quantity: e.target.value})} /></FormField>
              <FormField label="Unit Price" required><input type="number" className={inputClass} value={quoteForm.unitPrice} onChange={e=>setQuoteForm({...quoteForm, unitPrice: e.target.value})} /></FormField>
              <FormField label="Discount %"><input type="number" className={inputClass} value={quoteForm.discount} onChange={e=>setQuoteForm({...quoteForm, discount: e.target.value})} /></FormField>
              <FormField label="Unit Discount (₹)"><input type="number" className={inputClass} placeholder="0.00" value={quoteForm.unitDiscount || ''} onChange={e=>setQuoteForm({...quoteForm, unitDiscount: e.target.value})} /></FormField>
              <FormField label="GST %"><input type="number" className={inputClass} value={quoteForm.gst} onChange={e=>setQuoteForm({...quoteForm, gst: e.target.value})} /></FormField>
              <FormField label="Total Amount (Rs.)"><input className={`${inputClass} bg-slate-100 font-bold`} value={(() => {
                const q = Number(quoteForm.quantity) || 0; const p = Number(quoteForm.unitPrice) || 0;
                const d = Number(quoteForm.discount) || 0; const ud = Number(quoteForm.unitDiscount) || 0; const g = Number(quoteForm.gst) || 0;
                const discounted = Math.max(0, p * (1 - d / 100) - ud);
                return (q * discounted * (1 + g / 100)).toFixed(2);
              })()} disabled /></FormField>
            </div>
            <h4 className="font-semibold text-sm text-slate-800 border-t border-slate-100 pt-4">Additional Details</h4>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Payment Terms"><input className={inputClass} value={quoteForm.paymentTerms} onChange={e=>setQuoteForm({...quoteForm, paymentTerms: e.target.value})} /></FormField>
              <FormField label="Delivery Terms"><input className={inputClass} value={quoteForm.deliveryTerms} onChange={e=>setQuoteForm({...quoteForm, deliveryTerms: e.target.value})} /></FormField>
              <div className="col-span-2"><FormField label="Notes / Remarks"><textarea className={inputClass} rows={2} value={quoteForm.remarks} onChange={e=>setQuoteForm({...quoteForm, remarks: e.target.value})}></textarea></FormField></div>
            </div>
          </div>
      </Modal>
      
      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="Company History" size="lg" footer={<Button onClick={() => setViewTarget(null)}>Close</Button>}>
        {viewTarget && (
          <div className="flex flex-col gap-6">
            <div>
              <h4 className="font-bold text-slate-800 text-xl mb-1">{viewTarget.company}</h4>
              <div className="flex gap-4 text-sm text-slate-600">
                <span className="flex items-center gap-1"><FileText size={14} /> {viewTarget.leadNo}</span>
                <span>{viewTarget.city}</span>
                <span>GST: {viewTarget.gst || 'N/A'}</span>
              </div>
            </div>

            <div>
              <h5 className="font-semibold text-sm text-slate-700 mb-3 uppercase tracking-wider">Company History</h5>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-blue-700">{viewData.enquiries}</span>
                  <span className="text-xs text-blue-600 font-medium">Total Enquiries</span>
                </div>
                <div className="bg-purple-50 border border-purple-100 p-3 rounded-lg flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-purple-700">{viewData.quotes}</span>
                  <span className="text-xs text-purple-600 font-medium">Quotations</span>
                </div>
                <div className="bg-green-50 border border-green-100 p-3 rounded-lg flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-green-700">{viewData.orders}</span>
                  <span className="text-xs text-green-600 font-medium">Sales Orders</span>
                </div>
              </div>
            </div>

            <div className="mt-2">
              {completedInwards.length > 0 && (
                <div className="mb-6" data-testid="completed-inwards">
                  <h5 className="font-semibold text-sm text-slate-700 mb-3 uppercase tracking-wider">Completed Production ({completedInwards.length})</h5>
                  <div className="bg-amber-50/50 rounded-lg border border-amber-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-amber-100/50 border-b border-amber-200">
                        <tr>
                          <th className="text-left px-4 py-2 text-[10px] font-bold text-amber-700 uppercase">Order</th>
                          <th className="text-left px-4 py-2 text-[10px] font-bold text-amber-700 uppercase">Product</th>
                          <th className="text-center px-4 py-2 text-[10px] font-bold text-amber-700 uppercase">Finished / Ordered</th>
                          <th className="text-right px-4 py-2 text-[10px] font-bold text-amber-700 uppercase">Inward Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {completedInwards.map((c: any) => (
                          <tr key={c.so_no} className="border-b border-amber-100 last:border-0">
                            <td className="px-4 py-2.5 font-semibold text-amber-800">{c.so_no}</td>
                            <td className="px-4 py-2.5 text-slate-700">{c.products}</td>
                            <td className="px-4 py-2.5 text-center font-medium text-slate-700">{c.finished} / {c.ordered}</td>
                            <td className="px-4 py-2.5 text-right text-slate-600 text-xs">{c.date ? new Date(c.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Purchase History */}
              {purchaseHistory.length > 0 && (
                <div className="mb-6">
                  <h5 className="font-semibold text-sm text-slate-700 mb-3 uppercase tracking-wider flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><polyline points="16 8 12 12 8 8"></polyline><line x1="12" y1="16" x2="12" y2="12"></line></svg>
                    Purchase History ({purchaseHistory.length} completed)
                  </h5>
                  <div className="bg-emerald-50/50 rounded-lg border border-emerald-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-emerald-100/50 border-b border-emerald-200">
                        <tr>
                          <th className="text-left px-4 py-2 text-[10px] font-bold text-emerald-700 uppercase">Invoice</th>
                          <th className="text-left px-4 py-2 text-[10px] font-bold text-emerald-700 uppercase">Product</th>
                          <th className="text-center px-4 py-2 text-[10px] font-bold text-emerald-700 uppercase">Qty</th>
                          <th className="text-right px-4 py-2 text-[10px] font-bold text-emerald-700 uppercase">Amount (₹)</th>
                          <th className="text-right px-4 py-2 text-[10px] font-bold text-emerald-700 uppercase">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {purchaseHistory.map((ph: any, idx: number) => (
                          <tr key={idx} className="border-b border-emerald-100 last:border-0">
                            <td className="px-4 py-2.5 font-semibold text-emerald-800">{ph.invoice_no}</td>
                            <td className="px-4 py-2.5 text-slate-700">{ph.part_name}</td>
                            <td className="px-4 py-2.5 text-center font-medium text-slate-700">{ph.quantity}</td>
                            <td className="px-4 py-2.5 text-right font-bold text-emerald-700">₹{Number(ph.total_value).toLocaleString('en-IN')}</td>
                            <td className="px-4 py-2.5 text-right text-slate-600 text-xs">{ph.date ? new Date(ph.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-emerald-100/50 border-t border-emerald-200">
                        <tr>
                          <td colSpan={3} className="px-4 py-2 text-right font-bold text-sm text-emerald-800 uppercase">Total Purchased</td>
                          <td className="px-4 py-2 text-right font-bold text-base text-emerald-800">₹{purchaseHistory.reduce((s: number, h: any) => s + (Number(h.total_value) || 0), 0).toLocaleString('en-IN')}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

               <h5 className="font-semibold text-sm text-slate-700 mb-3 uppercase tracking-wider">All Enquiries</h5>
               <div className="flex flex-col gap-4 max-h-[50vh] overflow-y-auto pr-2 pb-2">
                 {viewHistory.map(h => (
                    <div key={h.id} className="flex flex-col p-4 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-slate-300 transition-colors">
                      <div className="flex justify-between items-start mb-3 border-b border-slate-100 pb-3">
                        <div>
                          <h6 className="font-bold text-slate-800 text-base">{h.leadNo} - {h.partName}</h6>
                          <span className="text-xs text-slate-500 font-medium">Source: {h.source} {h.allocation ? `| Allocation: ${h.allocation}` : ''} | Expected: {h.expectedDate || 'N/A'}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <select
                            value={h.status}
                            onChange={(e) => handleQuickStatusChange(h.id, e.target.value)}
                            className={`text-xs font-semibold pl-3 pr-7 py-1 rounded-full border outline-none cursor-pointer
                              ${h.status === 'Lost' ? 'bg-red-50 text-red-700 border-red-200' : 
                                h.status === 'Quoted' ? 'bg-purple-50 text-purple-700 border-purple-200' : 
                                h.status === 'Converted' ? 'bg-green-50 text-green-700 border-green-200' : 
                                'bg-slate-50 text-slate-700 border-slate-200'}`}
                          >
                            <option value="New">New</option>
                            <option value="Quoted">Quoted</option>
                            <option value="Converted">Converted</option>
                            <option value="Lost">Lost</option>
                          </select>
                          <button onClick={() => { setViewTarget(null); handleEditClick(h); }} title="Edit Enquiry" className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 hover:text-blue-700 rounded transition-colors"><Edit size={16}/></button>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-1">
                        <div>
                          <p className="text-slate-400 text-[10px] font-bold uppercase mb-1">Quantity</p>
                          <p className="font-medium text-slate-700">{h.quantity}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-[10px] font-bold uppercase mb-1">Contact Person</p>
                          <p className="font-medium text-slate-700 truncate">{h.contactPerson ? h.contactPerson.split(' | ')[0] : 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-[10px] font-bold uppercase mb-1">Phone</p>
                          <p className="font-medium text-slate-700 truncate">{h.phone ? h.phone.split(' | ')[0] : 'N/A'}</p>
                        </div>
                        <div className="col-span-4 mt-2 border-t border-slate-100 pt-2">
                          <p className="text-slate-500 text-[11px] font-bold uppercase mb-2">Products / Requirements</p>
                          {(() => {
                            let parsed: any[] = [];
                            try {
                              if (h.enquiringFor) {
                                const p = typeof h.enquiringFor === 'string' ? JSON.parse(h.enquiringFor) : h.enquiringFor;
                                if (Array.isArray(p)) parsed = p;
                              }
                            } catch {}
                            if (parsed.length > 0) {
                              return (
                                <div className="space-y-2">
                                  {parsed.map((item: any, pIdx: number) => (
                                    <div key={pIdx} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                                      <div className="flex items-center gap-2">
                                        <span className="font-bold text-slate-800">{item.productName || item.partName || 'Product'}</span>
                                        <span className="text-slate-500 font-medium">· Qty: {item.quantity || '-'}</span>
                                      </div>
                                      {Array.isArray(item.filePaths) && item.filePaths.length > 0 && (
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {item.filePaths.map((fPath: string, fIdx: number) => (
                                            <button
                                              key={fIdx}
                                              type="button"
                                              onClick={() => void openProductFile(fPath)}
                                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 rounded text-blue-600 hover:text-blue-800 hover:border-blue-300 font-medium transition-colors"
                                            >
                                              <FileText size={11} />
                                              <span className="truncate max-w-[120px]">{fPath.split('/').pop()}</span>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              );
                            }
                            return <p className="font-medium text-slate-700">{h.enquiringFor || h.partName || 'N/A'}</p>;
                          })()}
                        </div>
                        {h.estimatedValue > 0 && (
                          <div className="col-span-2">
                            <p className="text-slate-400 text-[10px] font-bold uppercase mb-1">Est. Value</p>
                            <p className="font-medium text-slate-700">₹{h.estimatedValue.toLocaleString()}</p>
                          </div>
                        )}
                      </div>
                    </div>
                 ))}
               </div>
            </div>

          </div>
        )}
      </Modal>
    
      <Modal open={!!quoteSelectTarget} onClose={() => setQuoteSelectTarget(null)} title="Select Enquiry to Quote" size="sm" footer={<Button variant="secondary" onClick={() => setQuoteSelectTarget(null)}>Cancel</Button>}>
         <div className="flex flex-col gap-2">
            {quoteSelectTarget?.map(e => (
               <div key={e.id} onClick={() => openQuoteModal(e)} className="p-3 border border-slate-200 rounded-lg hover:border-brand-400 hover:bg-brand-50 cursor-pointer transition-colors">
                  <p className="font-bold text-sm">{e.lead_no || `LD-${e.enquiry_no}`} - {e.part_name}</p>
                  <p className="text-xs text-slate-500">Qty: {e.quantity}</p>
               </div>
            ))}
         </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} title="Delete Company" size="sm" footer={<><Button variant="secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</Button><Button disabled={deleting} onClick={confirmDeleteLead} className="bg-red-600 hover:bg-red-700 text-white border-0">{deleting ? 'Deleting...' : 'Delete'}</Button></>}>
        {deleteTarget && (
          <div className="text-sm text-slate-600 space-y-2">
            <p>Delete <span className="font-bold text-slate-800">{deleteTarget.row.company}</span> and all of its data?</p>
            <ul className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-0.5 list-disc pl-6">
              <li>{(deleteTarget.row.allEnquiries || []).length} enquir{((deleteTarget.row.allEnquiries || []).length === 1) ? 'y' : 'ies'}</li>
              <li>{deleteTarget.quotes} quotation(s)</li>
              <li>{deleteTarget.orders} sales order(s) + linked work orders, deliveries & invoices</li>
              <li>Company record</li>
            </ul>
            <p className="text-xs font-semibold text-red-600">This cannot be undone.</p>
          </div>
        )}
      </Modal>

    </div>
  );
}

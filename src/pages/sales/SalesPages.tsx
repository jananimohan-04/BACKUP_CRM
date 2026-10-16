import { useState, useEffect, useMemo } from 'react';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { supabase } from '@/lib/supabase';
import { Eye, Edit, Trash2, FileText, Users, Truck } from 'lucide-react';
import { PageHeader, DateSelector } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge, Button, StatCard, statusToVariant } from '@/components/ui/Card';
import { Modal, ConfirmDialog, FormField, inputClass } from '@/components/ui/Modal';
import { tint } from '@/lib/entryTints';
import { compactInput } from '@/lib/compactFields';
import type { Quotation, SalesOrder, Customer } from '@/data/mockData';

export { LeadsPage } from './LeadsPage';
export { SalesPipelinePage } from './SalesPipelinePage';

// ============ CUSTOMERS ============

export function CustomersPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [customersData, setCustomersData] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  const resetForm = () => ({
    name: '', industry: 'Aerospace', contact: '', email: '', phone: '', city: '', status: 'Active'
  });
  const [formData, setFormData] = useState(resetForm());

  useEffect(() => {
    async function fetchCustomers() {
      try {
        const { data, error } = await supabase.from('cnc_customers').select('*').order('created_at', { ascending: false });
        if (error) {
          console.error('Error fetching customers:', error);
          setDbError(true);
        } else if (data) {
          setDbError(false);
          const formattedData: Customer[] = data.map((d: any) => ({
            id: d.id,
            name: d.name,
            industry: d.industry,
            contact: d.contact,
            email: d.email,
            phone: d.phone,
            city: d.city,
            totalOrders: d.total_orders,
            totalValue: Number(d.total_value),
            outstanding: Number(d.outstanding),
            rating: d.rating,
            status: d.status,
          }));
          setCustomersData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchCustomers();
  }, []);

  const handleEditClick = (r: Customer) => {
    setFormData({
      name: r.name,
      industry: r.industry,
      contact: r.contact,
      email: r.email || '',
      phone: r.phone || '',
      city: r.city,
      status: r.status
    });
    setEditId(r.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.contact) return;
    
    const entryData = {
      name: formData.name,
      industry: formData.industry,
      contact: formData.contact,
      email: formData.email,
      phone: formData.phone,
      city: formData.city,
      status: formData.status
    };

    setLoading(true);

    if (editId) {
      const { error } = await supabase.from('cnc_customers').update(entryData).eq('id', editId);
      if (!error) {
        setCustomersData(prev => prev.map(c => c.id === editId ? { 
          ...c, name: entryData.name, industry: entryData.industry, contact: entryData.contact, email: entryData.email, phone: entryData.phone, city: entryData.city, status: entryData.status as any
        } : c));
        setShowAdd(false);
        setEditId(null);
        setFormData(resetForm());
      } else {
        alert("Failed to update: " + error.message);
      }
    } else {
      const newId = `CUST-${Math.floor(100 + Math.random() * 900)}`;
      const insertData = { ...entryData, id: newId, total_orders: 0, total_value: 0, outstanding: 0, rating: 3 };
      
      const { error } = await supabase.from('cnc_customers').insert([insertData]);
      if (!error) {
        const formatted: Customer = {
          id: newId, name: insertData.name, industry: insertData.industry, contact: insertData.contact, email: insertData.email, phone: insertData.phone, city: insertData.city, totalOrders: 0, totalValue: 0, outstanding: 0, rating: 3, status: 'Active'
        };
        setCustomersData([formatted, ...customersData]);
        setShowAdd(false);
        setFormData(resetForm());
      } else {
        console.error('Failed to add customer:', error);
        alert("Failed to add company: " + error.message);
      }
    }
    setLoading(false);
  };

  const columns: Column<Customer>[] = [
    { key: 'name', label: 'Company', sortable: true, render: (r) => <span className="font-semibold text-slate-800">{r.name}</span> },
    { key: 'industry', label: 'Industry', sortable: true, render: (r) => <Badge variant="neutral">{r.industry}</Badge> },
    { key: 'contact', label: 'Contact Person', render: (r) => <div><p className="text-sm text-slate-700">{r.contact}</p><p className="text-xs text-slate-400">{r.city}</p></div> },
    { key: 'totalOrders', label: 'Orders', sortable: true, align: 'right' },
    { key: 'totalValue', label: 'Total Value', sortable: true, align: 'right', render: (r) => <span className="font-semibold text-slate-700">₹{(r.totalValue / 100000).toFixed(1)}L</span> },
    { key: 'outstanding', label: 'Outstanding', sortable: true, align: 'right', render: (r) => <span className={r.outstanding > 0 ? 'text-orange-600 font-medium' : 'text-slate-500'}>₹{(r.outstanding / 100000).toFixed(1)}L</span> },
    { key: 'rating', label: 'Rating', sortable: true, align: 'center', render: (r) => <span className="text-amber-400">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={statusToVariant(r.status)} dot>{r.status}</Badge> },
    {
      key: 'actions', label: 'Actions', align: 'center', render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => setViewTarget(r)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Eye size={15} /></button>
          <button onClick={() => handleEditClick(r)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit size={15} /></button>
          <button onClick={() => setDeleteTarget(r)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>
        </div>
      )
    },
  ];

  const totalValue = customersData.reduce((acc, c) => acc + c.totalValue, 0);
  const outstanding = customersData.reduce((acc, c) => acc + c.outstanding, 0);
  const activeCount = customersData.filter(c => c.status === 'Active').length;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Companies" description="Manage client relationships and outstanding balances" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<DateSelector /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Clients" value={customersData.length.toString()} icon={<Users size={20} />} accent="brand" />
        <StatCard label="Active Clients" value={activeCount.toString()} icon={<Users size={20} />} trend="2" trendUp accent="success" />
        <StatCard label="Total Revenue" value={`₹${(totalValue / 10000000).toFixed(2)}Cr`} icon={<FileText size={20} />} trend="12%" trendUp accent="accent" />
        <StatCard label="Outstanding" value={`₹${(outstanding / 100000).toFixed(1)}L`} icon={<FileText size={20} />} accent="warning" />
      </div>
      <DataTable data={customersData} columns={columns} searchKeys={['name', 'contact', 'city']} onAdd={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }} addLabel="Add Company" filterOptions={[{ label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }]} />
      
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditId(null); setFormData(resetForm()); }} title={editId ? "Edit Company" : "New Company"} subtitle={editId ? "Update company profile" : "Add a new company to the database"} size="lg" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave}>{editId ? 'Update Company' : 'Save Company'}</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Company Name" required><input className={inputClass} value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Company Ltd" /></FormField>
          <FormField label="Industry" required>
            <select className={inputClass} value={formData.industry} onChange={e => setFormData({...formData, industry: e.target.value})}>
              <option>Aerospace</option><option>Automotive</option><option>Defense</option><option>Medical</option><option>Space</option><option>Industrial</option>
            </select>
          </FormField>
          <FormField label="Contact Person" required><input className={inputClass} value={formData.contact} onChange={e => setFormData({...formData, contact: e.target.value})} placeholder="Full name" /></FormField>
          <FormField label="Email" required><input type="email" className={inputClass} value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="email@company.com" /></FormField>
          <FormField label="Phone"><input className={inputClass} value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="+91 ..." /></FormField>
          <FormField label="Address"><input className={inputClass} value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} placeholder="Address" /></FormField>
          {editId && (
            <FormField label="Status">
              <select className={inputClass} value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                <option>Active</option><option>Inactive</option>
              </select>
            </FormField>
          )}
        </div>
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="View Company Details" subtitle={viewTarget?.name}>
        {viewTarget && (
          <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
            <div><p className="text-slate-500 mb-1">Industry</p><Badge variant="neutral">{viewTarget.industry}</Badge></div>
            <div><p className="text-slate-500 mb-1">Status</p><Badge variant={statusToVariant(viewTarget.status)} dot>{viewTarget.status}</Badge></div>
            <div><p className="text-slate-500 mb-1">Contact</p><p className="font-medium text-slate-800">{viewTarget.contact}</p></div>
            <div><p className="text-slate-500 mb-1">Address</p><p className="font-medium text-slate-800">{viewTarget.city}</p></div>
            <div><p className="text-slate-500 mb-1">Total Orders</p><p className="text-slate-800">{viewTarget.totalOrders}</p></div>
            <div><p className="text-slate-500 mb-1">Total Value</p><p className="font-semibold text-slate-800">₹{viewTarget.totalValue.toLocaleString('en-IN')}</p></div>
            <div><p className="text-slate-500 mb-1">Outstanding</p><p className={viewTarget.outstanding > 0 ? 'text-orange-600 font-medium' : 'text-slate-800'}>₹{viewTarget.outstanding.toLocaleString('en-IN')}</p></div>
            <div><p className="text-slate-500 mb-1">Rating</p><p className="text-amber-400 text-lg leading-none">{'★'.repeat(viewTarget.rating)}{'☆'.repeat(5 - viewTarget.rating)}</p></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_customers').delete().eq('id', deleteTarget.id);
            if (!error) {
              setCustomersData(prev => prev.filter(c => c.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
          }
        }} 
        title="Delete Company" 
        message={`Delete company ${deleteTarget?.name}? This will remove all associated records.`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}

// Quotation rows use the canonical DB statuses (Draft, Sent, Converted, Rejected)
type QuotationRow = Omit<Quotation, 'status'> & { status: string; paymentTerms?: string };

// Customer / enquiry options for the form dropdowns, loaded from the DB
function useCustomerOptions() {
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    supabase.from('cnc_customers').select('id, name').order('name').then(({ data, error }) => {
      if (error) console.error('Error fetching customers:', error);
      else setOptions((data || []).filter((c: any) => c.name));
    });
  }, []);
  return options;
}

export function QuotationsPage() {
  // The New Quotation form is an always-visible card above the table and starts open.
  // `editId` is what opens the edit popup: the inline card steps aside while a record is
  // being edited, then comes back as soon as the popup closes.
  const [showAdd, setShowAdd] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<QuotationRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuotationRow | null>(null);
  const [quotationsData, setQuotationsData] = useState<QuotationRow[]>([]);
  // Global date filter (quotation date) drives the table.
  const { inRange: inQuotationDateRange } = useGlobalDateFilter();
  const rangedQuotations = useMemo(
    () => quotationsData.filter((q: any) => inQuotationDateRange(q.date)),
    [quotationsData, inQuotationDateRange],
  );
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const customerOptions = useCustomerOptions();
  const [enquiryOptions, setEnquiryOptions] = useState<{ id: string; enquiry_no: string }[]>([]);

  useEffect(() => {
    supabase.from('cnc_enquiries').select('id, enquiry_no').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (error) console.error('Error fetching enquiries:', error);
      else setEnquiryOptions((data || []).filter((e: any) => e.enquiry_no));
    });
  }, []);

  const resetForm = () => ({
    quoteNo: `QT-2026-${Math.floor(100 + Math.random() * 900)}`,
    customer: '', enquiryNo: '', partName: '', quantity: '', unitPrice: '', validTill: '', paymentTerms: 'Net 30', status: 'Draft'
  });
  const [formData, setFormData] = useState(resetForm());

  useEffect(() => {
    async function fetchQuotations() {
      try {
        const { data, error } = await supabase.from('cnc_quotations').select('*').order('created_at', { ascending: false });
        if (error) {
          console.error('Error fetching quotations:', error);
          setDbError(true);
        } else if (data) {
          setDbError(false);
          const formattedData: QuotationRow[] = data.map((d: any) => ({
            id: d.id,
            quoteNo: d.quote_no,
            customer: d.customer,
            enquiryNo: d.enquiry_no,
            partName: d.part_name,
            quantity: d.quantity,
            unitPrice: Number(d.unit_price),
            totalValue: Number(d.total_value),
            date: d.date,
            validTill: d.valid_till,
            paymentTerms: d.payment_terms || '',
            status: d.status,
          }));
          setQuotationsData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchQuotations();
  }, []);

  const handleEditClick = (r: QuotationRow) => {
    setFormData({
      quoteNo: r.quoteNo,
      customer: r.customer,
      enquiryNo: r.enquiryNo || '',
      partName: r.partName,
      quantity: (r.quantity ?? '').toString(),
      unitPrice: (r.unitPrice ?? '').toString(),
      validTill: r.validTill || '',
      paymentTerms: r.paymentTerms || 'Net 30',
      status: r.status === 'Accepted' ? 'Converted' : r.status
    });
    setEditId(r.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    setFormError(null);
    if (!formData.customer || !formData.partName) {
      setFormError('Company and Product Name are required.');
      return;
    }
    
    const qty = Number(formData.quantity) || 0;
    const price = Number(formData.unitPrice) || 0;

    const linkedEnquiry = enquiryOptions.find(e => e.enquiry_no === formData.enquiryNo);
    const linkedCustomer = customerOptions.find(c => c.name === formData.customer);
    const entryData = {
      quote_no: formData.quoteNo,
      customer: formData.customer,
      enquiry_no: formData.enquiryNo || null,
      part_name: formData.partName,
      quantity: qty,
      unit_price: price,
      total_value: qty * price,
      valid_till: formData.validTill || null,
      payment_terms: formData.paymentTerms,
      status: formData.status,
      ...(linkedEnquiry ? { lead_id: linkedEnquiry.id } : {}),
      ...(linkedCustomer ? { customer_id: linkedCustomer.id } : {})
    };

    setSaving(true);

    if (editId) {
      const { error } = await supabase.from('cnc_quotations').update(entryData).eq('id', editId);
      if (!error) {
        setQuotationsData(prev => prev.map(q => q.id === editId ? { 
          ...q, quoteNo: entryData.quote_no, customer: entryData.customer, enquiryNo: entryData.enquiry_no || '', partName: entryData.part_name, quantity: entryData.quantity, unitPrice: entryData.unit_price, totalValue: entryData.total_value, validTill: entryData.valid_till || '', paymentTerms: entryData.payment_terms, status: entryData.status
        } : q));
        setSavedNote(formData.quoteNo);
        setEditId(null);
        setFormData(resetForm());
      } else {
        alert("Failed to update: " + error.message);
      }
    } else {
      const newId = crypto.randomUUID();
      const insertData = { ...entryData, id: newId, date: new Date().toISOString().split('T')[0] };
      
      const { error } = await supabase.from('cnc_quotations').insert([insertData]);
      if (!error) {
        const formatted: QuotationRow = {
          id: newId,
          quoteNo: insertData.quote_no,
          customer: insertData.customer,
          enquiryNo: insertData.enquiry_no || '',
          partName: insertData.part_name,
          quantity: insertData.quantity,
          unitPrice: insertData.unit_price,
          totalValue: insertData.total_value,
          date: insertData.date,
          validTill: insertData.valid_till || '',
          paymentTerms: insertData.payment_terms,
          status: insertData.status
        };
        setSavedNote(insertData.quote_no);
        setQuotationsData([formatted, ...quotationsData]);
        setFormData(resetForm());
      } else {
        console.error('Failed to add quotation:', error);
        alert("Failed to add quotation: " + error.message);
      }
    }
    setLoading(false);
    setSaving(false);
  };

  const columns: Column<QuotationRow>[] = [
    { key: 'quoteNo', label: 'Quote No', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-700">{r.quoteNo}</span> },
    { key: 'customer', label: 'Company', sortable: true, render: (r) => <span className="font-medium text-slate-700">{r.customer}</span> },
    { key: 'enquiryNo', label: 'Enquiry', render: (r) => <span className="font-mono text-xs text-slate-500">{r.enquiryNo}</span> },
    { key: 'partName', label: 'Product', sortable: true },
    { key: 'quantity', label: 'Qty', sortable: true, align: 'right' },
    { key: 'unitPrice', label: 'Unit Price', sortable: true, align: 'right', render: (r) => <span>₹{r.unitPrice.toLocaleString('en-IN')}</span> },
    { key: 'totalValue', label: 'Total Value', sortable: true, align: 'right', render: (r) => <span className="font-semibold text-slate-700">₹{(r.totalValue / 100000).toFixed(1)}L</span> },
    { key: 'date', label: 'Date', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.date}</span> },
    { key: 'validTill', label: 'Valid Till', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.validTill}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={statusToVariant(r.status)} dot>{r.status}</Badge> },
    {
      key: 'actions', label: 'Actions', align: 'center', render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => setViewTarget(r)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Eye size={15} /></button>
          <button onClick={() => handleEditClick(r)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit size={15} /></button>
          <button onClick={() => setDeleteTarget(r)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>
        </div>
      )
    },
  ];

  const pendingCount = quotationsData.filter(q => q.status === 'Sent' || q.status === 'Draft').length;
  const isConverted = (s: string) => s === 'Converted' || s === 'Accepted';
  const acceptedCount = quotationsData.filter(q => isConverted(q.status)).length;
  const totalCompleted = quotationsData.filter(q => isConverted(q.status) || q.status === 'Rejected').length;
  const winRate = totalCompleted > 0 ? Math.round((acceptedCount / totalCompleted) * 100) : 0;

  // The quotation fields live in exactly one place: rendered by the always-visible
  // New Quotation card above the table, and by the popup used when editing a record.
  // Compact inline labels let the whole block read as an entry toolbar rather than a form card.
  const quotationFormBody = (
    <div className="flex flex-wrap items-center gap-2">
      <FormField label="Quotation Number" required inline><input className={`${compactInput} w-[10rem]`} value={formData.quoteNo} onChange={e => setFormData({...formData, quoteNo: e.target.value})} /></FormField>
      <FormField label="Company" required inline>
        <select className={`${compactInput} w-[15rem]`} value={formData.customer} onChange={e => setFormData({...formData, customer: e.target.value})}>
          <option value="">Select company...</option>{customerOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          {formData.customer && !customerOptions.some(c => c.name === formData.customer) && <option value={formData.customer}>{formData.customer}</option>}
        </select>
      </FormField>
      <FormField label="Enquiry Reference" inline>
        <select className={`${compactInput} w-[12rem]`} value={formData.enquiryNo} onChange={e => setFormData({...formData, enquiryNo: e.target.value})}>
          <option value="">Select enquiry...</option>{enquiryOptions.map((e) => <option key={e.id} value={e.enquiry_no}>{e.enquiry_no}</option>)}
          {formData.enquiryNo && !enquiryOptions.some(e => e.enquiry_no === formData.enquiryNo) && <option value={formData.enquiryNo}>{formData.enquiryNo}</option>}
        </select>
      </FormField>
      <FormField label="Product Name" required inline><input className={`${compactInput} w-[13rem]`} value={formData.partName} onChange={e => setFormData({...formData, partName: e.target.value})} /></FormField>
      <FormField label="Quantity" required inline><input type="number" className={`${compactInput} w-[5.5rem]`} value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} /></FormField>
      <FormField label="Unit Price (₹)" required inline><input type="number" className={`${compactInput} w-[7.5rem]`} value={formData.unitPrice} onChange={e => setFormData({...formData, unitPrice: e.target.value})} /></FormField>
      <FormField label="Valid Till" required inline><input type="date" className={`${compactInput} w-[10.5rem]`} value={formData.validTill} onChange={e => setFormData({...formData, validTill: e.target.value})} /></FormField>
      <FormField label="Payment Terms" inline><select className={`${compactInput} w-[8rem]`} value={formData.paymentTerms} onChange={e => setFormData({...formData, paymentTerms: e.target.value})}><option>Net 30</option><option>Net 45</option><option>Net 60</option><option>Advance</option></select></FormField>
      {editId && (
        <FormField label="Status" inline>
          <select className={`${compactInput} w-[9rem]`} value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
            <option>Draft</option><option>Sent</option><option>Converted</option><option>Rejected</option>
          </select>
        </FormField>
      )}
    </div>
  );

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Quotations" description="Manage price quotations for company enquiries" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<DateSelector /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Quotations" value={quotationsData.length.toString()} icon={<FileText size={20} />} accent="brand" />
        <StatCard label="Pending" value={pendingCount.toString()} icon={<FileText size={20} />} accent="warning" />
        <StatCard label="Converted" value={acceptedCount.toString()} icon={<FileText size={20} />} trend="12%" trendUp accent="success" />
        <StatCard label="Win Rate" value={`${winRate}%`} icon={<FileText size={20} />} trend="3%" trendUp accent="accent" />
      </div>
      {/* Always-visible New Quotation card, directly above the table so the list sits
          immediately below the entry row. Edit still opens in the popup below. */}
      {showAdd && !editId && (
        <section className={`rounded-xl border shadow-sm ${tint('Quotation').panel}`} data-testid="quotation-entry-form">
          <div className="space-y-2.5 p-3">
            {savedNote && (
              <div role="status" data-testid="quotation-saved-note" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                <span>&#10003; Quotation {savedNote} saved. The table below has been refreshed.</span>
                <button type="button" onClick={() => setSavedNote(null)} className="font-bold underline hover:text-emerald-900">Dismiss</button>
              </div>
            )}
            {formError && (
              <div role="alert" data-testid="quotation-error" className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{formError}</div>
            )}
            {quotationFormBody}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-2.5">
              <Button variant="secondary" size="sm" onClick={() => { setFormData(resetForm()); setSavedNote(null); setFormError(null); }}>Clear / Reset</Button>
              <Button size="sm" onClick={() => void handleSave()} disabled={saving}>{saving ? 'Saving...' : 'Save Quotation'}</Button>
            </div>
          </div>
        </section>
      )}

      <DataTable data={rangedQuotations} columns={columns} searchKeys={['quoteNo', 'customer', 'partName']} onAdd={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }} addLabel="New Quotation" filterOptions={[{ label: 'Draft', value: 'Draft' }, { label: 'Sent', value: 'Sent' }, { label: 'Converted', value: 'Converted' }, { label: 'Rejected', value: 'Rejected' }]} />
      
      <Modal open={!!editId} onClose={() => { setEditId(null); setFormData(resetForm()); }} title="Edit Quotation" subtitle="Update quotation details" size="lg" footer={<><Button variant="secondary" onClick={() => { setEditId(null); setFormData(resetForm()); }}>Cancel</Button><Button onClick={() => void handleSave()} disabled={saving}>{saving ? 'Saving...' : 'Update Quotation'}</Button></>}>
        {quotationFormBody}
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="View Quotation Details" subtitle={viewTarget?.quoteNo}>
        {viewTarget && (
          <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
            <div><p className="text-slate-500 mb-1">Company</p><p className="font-semibold text-slate-800">{viewTarget.customer}</p></div>
            <div><p className="text-slate-500 mb-1">Status</p><Badge variant={statusToVariant(viewTarget.status)} dot>{viewTarget.status}</Badge></div>
            <div><p className="text-slate-500 mb-1">Product Name</p><p className="font-medium text-slate-800">{viewTarget.partName}</p></div>
            <div><p className="text-slate-500 mb-1">Enquiry No</p><p className="font-mono text-slate-700">{viewTarget.enquiryNo}</p></div>
            <div><p className="text-slate-500 mb-1">Quantity</p><p className="text-slate-800">{viewTarget.quantity}</p></div>
            <div><p className="text-slate-500 mb-1">Unit Price</p><p className="text-slate-800">₹{viewTarget.unitPrice.toLocaleString('en-IN')}</p></div>
            <div><p className="text-slate-500 mb-1">Total Value</p><p className="font-semibold text-slate-800">₹{viewTarget.totalValue.toLocaleString('en-IN')}</p></div>
            <div><p className="text-slate-500 mb-1">Valid Till</p><p className="text-slate-800">{viewTarget.validTill}</p></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_quotations').delete().eq('id', deleteTarget.id);
            if (!error) {
              setQuotationsData(prev => prev.filter(q => q.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
          }
        }} 
        title="Delete Quotation" 
        message={`Delete quotation ${deleteTarget?.quoteNo}? This action cannot be undone.`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}

// ============ SALES ORDERS ============

type SalesOrderRow = Omit<SalesOrder, 'status'> & { status: string; customerId?: string | null; quotationId?: string | null };

export function SalesOrdersPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<SalesOrderRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SalesOrderRow | null>(null);
  const [deliveryTarget, setDeliveryTarget] = useState<SalesOrderRow | null>(null);
  const [ordersData, setOrdersData] = useState<SalesOrderRow[]>([]);
  // Global date filter (order date) drives the table.
  const { inRange: inOrderDateRange } = useGlobalDateFilter();
  const rangedOrders = useMemo(
    () => ordersData.filter((o: any) => inOrderDateRange(o.orderDate)),
    [ordersData, inOrderDateRange],
  );
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const customerOptions = useCustomerOptions();
  const [quoteOptions, setQuoteOptions] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('cnc_quotations').select('id, quote_no, customer, customer_id, part_name, part_number, unit_price, discount_percent, unit_discount, gst_percent').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (error) console.error('Error fetching quotations:', error);
      else setQuoteOptions((data || []).filter((q: any) => q.quote_no));
    });
  }, []);

  const resetForm = () => ({
    orderNo: `SO-2026-${Math.floor(1000 + Math.random() * 9000)}`,
    customer: '', quoteNo: '', partName: '', partNo: '', quantity: '', deliveryDate: '', status: 'Confirmed'
  });
  const [formData, setFormData] = useState(resetForm());

  const resetDeliveryForm = () => ({
    deliveryNo: `DLV-2026-${Math.floor(1000 + Math.random() * 9000)}`,
    dispatchQty: '', deliveryAddress: '', transport: '', vehicleNo: '', driverContact: '', remarks: ''
  });
  const [deliveryForm, setDeliveryForm] = useState(resetDeliveryForm());

  useEffect(() => {
    async function fetchOrders() {
      try {
        const { data, error } = await supabase.from('cnc_sales_orders').select('*').order('created_at', { ascending: false });
        if (error) {
          console.error('Error fetching sales orders:', error);
          setDbError(true);
        } else if (data) {
          setDbError(false);
          const formattedData: SalesOrderRow[] = data.map((d: any) => ({
            id: d.id,
            orderNo: d.order_no,
            customer: d.customer,
            quoteNo: d.quote_no,
            partName: d.part_name,
            partNo: d.part_no ?? d.part_number,
            quantity: d.quantity,
            delivered: d.delivered || 0,
            value: Number(d.total_value ?? d.value) || 0,
            orderDate: d.order_date,
            deliveryDate: d.delivery_date,
            status: d.status,
            customerId: d.customer_id ?? null,
            quotationId: d.quotation_id ?? null,
          }));
          setOrdersData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchOrders();
  }, []);

  const handleEditClick = (r: SalesOrderRow) => {
    setFormData({
      orderNo: r.orderNo,
      customer: r.customer,
      quoteNo: r.quoteNo || '',
      partName: r.partName,
      partNo: r.partNo || '',
      quantity: (r.quantity ?? '').toString(),
      deliveryDate: r.deliveryDate || '',
      status: r.status
    });
    setEditId(r.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!formData.customer || !formData.partName) return;
    
    const partNo = formData.partNo || formData.partName.substring(0, 3).toUpperCase();
    const qty = Number(formData.quantity) || 0;
    const linkedQuote = quoteOptions.find(q => q.quote_no === formData.quoteNo);
    const linkedCustomer = customerOptions.find(c => c.name === formData.customer);
    // Order value is derived from the linked quotation's unit price (incl. discount/GST); 0 when no quotation
    const unitPrice = Number(linkedQuote?.unit_price) || 0;
    const disc = Number(linkedQuote?.discount_percent) || 0;
    const unitDisc = Number(linkedQuote?.unit_discount) || 0;
    const gst = Number(linkedQuote?.gst_percent) || 0;
    const discountedPrice = Math.max(0, unitPrice * (1 - disc / 100) - unitDisc);
    const orderValue = Number((qty * discountedPrice * (1 + gst / 100)).toFixed(2));
    const entryData = {
      order_no: formData.orderNo,
      customer: formData.customer,
      quote_no: formData.quoteNo,
      part_name: formData.partName,
      part_no: partNo,
      part_number: partNo,
      quantity: qty,
      delivery_date: formData.deliveryDate || null,
      status: formData.status,
      ...(linkedQuote ? { quotation_id: linkedQuote.id, value: orderValue, total_value: orderValue } : {}),
      ...(linkedCustomer ? { customer_id: linkedCustomer.id } : {})
    };

    setLoading(true);

    if (editId) {
      const { error } = await supabase.from('cnc_sales_orders').update(entryData).eq('id', editId);
      if (!error) {
        setOrdersData(prev => prev.map(o => o.id === editId ? {
          ...o, orderNo: entryData.order_no, customer: entryData.customer, quoteNo: entryData.quote_no, partName: entryData.part_name, partNo: entryData.part_no, quantity: entryData.quantity, deliveryDate: entryData.delivery_date || '', status: entryData.status,
          ...(linkedQuote ? { value: orderValue, quotationId: linkedQuote.id } : {}),
          ...(linkedCustomer ? { customerId: linkedCustomer.id } : {})
        } : o));
        setShowAdd(false);
        setEditId(null);
        setFormData(resetForm());
      } else {
        alert("Failed to update: " + error.message);
      }
    } else {
      const newId = crypto.randomUUID();
      const insertData = { ...entryData, id: newId, delivered: 0, value: orderValue, total_value: orderValue, order_date: new Date().toISOString().split('T')[0] };

      const { error } = await supabase.from('cnc_sales_orders').insert([insertData]);
      if (!error) {
        const formatted: SalesOrderRow = {
          id: newId,
          orderNo: insertData.order_no,
          customer: insertData.customer,
          quoteNo: insertData.quote_no,
          partName: insertData.part_name,
          partNo: insertData.part_no,
          quantity: insertData.quantity,
          delivered: insertData.delivered,
          value: insertData.value,
          orderDate: insertData.order_date,
          deliveryDate: insertData.delivery_date || '',
          status: insertData.status,
          customerId: linkedCustomer?.id ?? null,
          quotationId: linkedQuote?.id ?? null
        };
        setOrdersData([formatted, ...ordersData]);
        setShowAdd(false);
        setFormData(resetForm());
      } else {
        console.error('Failed to add sales order:', error);
        alert("Failed to add sales order: " + error.message);
      }
    }
    setLoading(false);
  };

  const handleSaveDelivery = async () => {
    if (!deliveryTarget) return;
    const remaining = Math.max(0, (Number(deliveryTarget.quantity) || 0) - (Number(deliveryTarget.delivered) || 0));
    const dispatchQty = Number(deliveryForm.dispatchQty) || remaining;
    if (dispatchQty <= 0) { alert("Nothing left to dispatch for this order."); return; }
    if (dispatchQty > remaining) { alert(`Dispatch quantity cannot exceed the remaining ${remaining} pcs.`); return; }
    setLoading(true);
    const { error } = await supabase.from('cnc_deliveries').insert([{
      delivery_no: deliveryForm.deliveryNo,
      sales_order_id: deliveryTarget.id,
      sales_order_no: deliveryTarget.orderNo,
      customer_id: deliveryTarget.customerId || null,
      customer_name: deliveryTarget.customer,
      part_name: deliveryTarget.partName,
      quantity: dispatchQty,
      delivery_date: new Date().toISOString().split('T')[0],
      delivery_address: deliveryForm.deliveryAddress,
      transport: deliveryForm.transport,
      vehicle_no: deliveryForm.vehicleNo,
      driver_contact: deliveryForm.driverContact,
      dispatch_qty: dispatchQty,
      remarks: deliveryForm.remarks,
      status: 'Pending'
    }]);

    if (!error) {
       // Finished-goods stock is reduced by the database when the delivery challan is saved.

       // Update the sales order's delivered count and status
       const delivered = (Number(deliveryTarget.delivered) || 0) + dispatchQty;
       const status = delivered >= (Number(deliveryTarget.quantity) || 0) ? 'Delivered' : 'Partially Delivered';
       const { error: soErr } = await supabase.from('cnc_sales_orders').update({ delivered, status }).eq('id', deliveryTarget.id);
       if (soErr) console.error('Failed to update sales order delivery:', soErr);
       else setOrdersData(prev => prev.map(o => o.id === deliveryTarget.id ? { ...o, delivered, status } : o));
    }

    if (!error) {
      alert("Delivery challan created! You can track it in the Operations > Delivery Challan page.");
      setDeliveryTarget(null);
      setDeliveryForm(resetDeliveryForm());
    } else {
      console.error('Failed to create delivery:', error);
      alert("Error creating delivery: " + error.message);
    }
    setLoading(false);
  };

  const columns: Column<SalesOrderRow>[] = [
    { key: 'orderNo', label: 'Order No', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-700">{r.orderNo}</span> },
    { key: 'customer', label: 'Company', sortable: true, render: (r) => <span className="font-medium text-slate-700">{r.customer}</span> },
    { key: 'partName', label: 'Product', sortable: true, render: (r) => <div><p className="text-sm text-slate-700">{r.partName}</p></div> },
    { key: 'quantity', label: 'Qty', sortable: true, align: 'right' },
    { key: 'delivered', label: 'Delivered', align: 'right', render: (r) => <span className={r.delivered === r.quantity ? 'text-green-600 font-medium' : 'text-slate-500'}>{r.delivered}/{r.quantity}</span> },
    { key: 'value', label: 'Value', sortable: true, align: 'right', render: (r) => <span className="font-semibold text-slate-700">₹{(r.value / 100000).toFixed(1)}L</span> },
    { key: 'orderDate', label: 'Order Date', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.orderDate}</span> },
    { key: 'deliveryDate', label: 'Due Date', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.deliveryDate}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={statusToVariant(r.status)} dot>{r.status}</Badge> },
    {
      key: 'actions', label: 'Actions', align: 'center', render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => setDeliveryTarget(r)} title="Create Delivery" className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"><Truck size={15} /></button>
          <button onClick={() => setViewTarget(r)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Eye size={15} /></button>
          <button onClick={() => handleEditClick(r)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit size={15} /></button>
          <button onClick={() => setDeleteTarget(r)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>
        </div>
      )
    },
  ];

  const inProduction = ordersData.filter(o => o.status === 'In Production').length;
  const deliveredCount = ordersData.filter(o => o.status === 'Delivered').length;
  const totalValue = ordersData.reduce((acc, o) => acc + o.value, 0);

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Sales Orders" description="Track confirmed company orders" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<DateSelector /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Orders" value={ordersData.length.toString()} icon={<FileText size={20} />} accent="brand" />
        <StatCard label="In Production" value={inProduction.toString()} icon={<FileText size={20} />} accent="accent" />
        <StatCard label="Delivered" value={deliveredCount.toString()} icon={<FileText size={20} />} trend="100%" trendUp accent="success" />
        <StatCard label="Order Value" value={`₹${(totalValue / 100000).toFixed(1)}L`} icon={<FileText size={20} />} accent="navy" />
      </div>
      <DataTable data={rangedOrders} columns={columns} searchKeys={['orderNo', 'customer', 'partName']} onAdd={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }} addLabel="New Sales Order" filterOptions={[{ label: 'Confirmed', value: 'Confirmed' }, { label: 'Inwarded', value: 'Inwarded' }, { label: 'In Production', value: 'In Production' }, { label: 'Partially Delivered', value: 'Partially Delivered' }, { label: 'Delivered', value: 'Delivered' }]} />
      
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditId(null); setFormData(resetForm()); }} title={editId ? "Edit Sales Order" : "New Sales Order"} subtitle={editId ? "Update sales order details" : "Create a sales order from an accepted quotation"} size="lg" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave}>{editId ? 'Update Order' : 'Create Order'}</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Order Number" required><input className={inputClass} value={formData.orderNo} onChange={e => setFormData({...formData, orderNo: e.target.value})} /></FormField>
          <FormField label="Company" required>
            <select className={inputClass} value={formData.customer} onChange={e => setFormData({...formData, customer: e.target.value})}>
              <option value="">Select company...</option>{customerOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              {formData.customer && !customerOptions.some(c => c.name === formData.customer) && <option value={formData.customer}>{formData.customer}</option>}
            </select>
          </FormField>
          <FormField label="Quotation Reference">
            <select className={inputClass} value={formData.quoteNo} onChange={e => setFormData({...formData, quoteNo: e.target.value})}>
              <option value="">Select quotation...</option>{quoteOptions.map((q) => <option key={q.id} value={q.quote_no}>{q.quote_no}</option>)}
              {formData.quoteNo && !quoteOptions.some(q => q.quote_no === formData.quoteNo) && <option value={formData.quoteNo}>{formData.quoteNo}</option>}
            </select>
          </FormField>
          <FormField label="Part Name" required><input className={inputClass} value={formData.partName} onChange={e => setFormData({...formData, partName: e.target.value})} /></FormField>
          <FormField label="Quantity" required><input type="number" className={inputClass} value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} /></FormField>
          <FormField label="Delivery Date" required><input type="date" className={inputClass} value={formData.deliveryDate} onChange={e => setFormData({...formData, deliveryDate: e.target.value})} /></FormField>
          {editId && (
            <FormField label="Status">
              <select className={inputClass} value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                <option>Confirmed</option><option>Inwarded</option><option>In Production</option><option>Partially Delivered</option><option>Delivered</option>
              </select>
            </FormField>
          )}
        </div>
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="View Sales Order Details" subtitle={viewTarget?.orderNo}>
        {viewTarget && (
          <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
            <div><p className="text-slate-500 mb-1">Company</p><p className="font-semibold text-slate-800">{viewTarget.customer}</p></div>
            <div><p className="text-slate-500 mb-1">Status</p><Badge variant={statusToVariant(viewTarget.status)} dot>{viewTarget.status}</Badge></div>
            <div><p className="text-slate-500 mb-1">Part Name</p><p className="font-medium text-slate-800">{viewTarget.partName}</p></div>
            <div><p className="text-slate-500 mb-1">Quantity</p><p className="text-slate-800">{viewTarget.quantity}</p></div>
            <div><p className="text-slate-500 mb-1">Delivered</p><p className="text-slate-800">{viewTarget.delivered}</p></div>
            <div><p className="text-slate-500 mb-1">Total Value</p><p className="font-semibold text-slate-800">₹{viewTarget.value.toLocaleString('en-IN')}</p></div>
            <div><p className="text-slate-500 mb-1">Due Date</p><p className="text-slate-800">{viewTarget.deliveryDate}</p></div>
          </div>
        )}
      </Modal>

      <Modal open={!!deliveryTarget} onClose={() => setDeliveryTarget(null)} title="Create Delivery" subtitle={`Dispatch goods for Order ${deliveryTarget?.orderNo}`} size="lg" footer={<><Button variant="secondary" onClick={() => setDeliveryTarget(null)}>Cancel</Button><Button onClick={handleSaveDelivery}>Create Delivery</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Delivery Number" required><input className={inputClass} value={deliveryForm.deliveryNo} disabled /></FormField>
          <FormField label="Dispatch Quantity" required><input type="number" className={inputClass} value={deliveryForm.dispatchQty} onChange={e => setDeliveryForm({...deliveryForm, dispatchQty: e.target.value})} placeholder={deliveryTarget ? String(Math.max(0, (Number(deliveryTarget.quantity) || 0) - (Number(deliveryTarget.delivered) || 0))) : ''} /></FormField>
          <div className="col-span-2">
            <FormField label="Delivery Address" required><input className={inputClass} value={deliveryForm.deliveryAddress} onChange={e => setDeliveryForm({...deliveryForm, deliveryAddress: e.target.value})} /></FormField>
          </div>
          <FormField label="Transport / Courier"><input className={inputClass} value={deliveryForm.transport} onChange={e => setDeliveryForm({...deliveryForm, transport: e.target.value})} /></FormField>
          <FormField label="Vehicle Number"><input className={inputClass} value={deliveryForm.vehicleNo} onChange={e => setDeliveryForm({...deliveryForm, vehicleNo: e.target.value})} /></FormField>
          <FormField label="Driver Contact"><input className={inputClass} value={deliveryForm.driverContact} onChange={e => setDeliveryForm({...deliveryForm, driverContact: e.target.value})} /></FormField>
          <FormField label="Remarks"><input className={inputClass} value={deliveryForm.remarks} onChange={e => setDeliveryForm({...deliveryForm, remarks: e.target.value})} /></FormField>
        </div>
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_sales_orders').delete().eq('id', deleteTarget.id);
            if (!error) {
              setOrdersData(prev => prev.filter(o => o.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
          }
        }} 
        title="Delete Order" 
        message={`Delete order ${deleteTarget?.orderNo}? This action cannot be undone.`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}


import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Eye, Edit, Trash2, Users, FileText, ShoppingCart, Package, Activity, TrendingUp, Power, PowerOff, Printer, Send, CheckCircle, AlertCircle, Search, Download } from 'lucide-react';
import { PageHeader, FilterButton, ExportButton } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Card, Badge, Button, StatCard } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { fromInwards } from '@/lib/ledgerDashboard';
import { exportCsv } from '@/lib/reportExport';
import { todayISO } from '@/lib/format';
import { fetchPartyOpenings, openingKey, sideLabel } from '@/lib/openingBalances';

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [viewTarget, setViewTarget] = useState<any>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // Posted opening balances (Opening Balances page) by supplier name: credit = we owed the supplier this when we started.
  const [openings, setOpenings] = useState<Map<string, number>>(new Map());
  useEffect(() => { void fetchPartyOpenings('SUPPLIER').then(setOpenings); }, []);
  const openingText = (name: string) => { const v = openings.get(openingKey(name)); return v ? `₹${Math.abs(v).toLocaleString('en-IN')} ${sideLabel(v)}` : ''; };

  // Tabs for details view
  const [activeTab, setActiveTab] = useState('Profile');

  const [formData, setFormData] = useState({
    code: '', name: '', category: 'Raw Material', status: 'Active',
    contact_person: '', phone: '', email: '', website: '',
    address: '', city: '', state: '', country: '', pincode: '',
    gst_number: '', pan: '', payment_terms: 'Net 30'
  });

  useEffect(() => {
    fetchSuppliers();
  }, []);

  async function fetchSuppliers() {
    setLoading(true);
    const { data, error } = await supabase.from('cnc_suppliers').select('*').order('created_at', { ascending: false });
    if (!error && data) setSuppliers(data);
    setLoading(false);
  }

  const resetForm = () => ({
    code: `VEN-${Math.floor(1000 + Math.random() * 9000)}`, name: '', category: 'Raw Material', status: 'Active',
    contact_person: '', phone: '', email: '', website: '',
    address: '', city: '', state: '', country: '', pincode: '',
    gst_number: '', pan: '', payment_terms: 'Net 30'
  });

  const handleSave = async () => {
    if (!formData.code || !formData.name) return alert("Code and Name are required");
    
    if (editId) {
      const { error } = await supabase.from('cnc_suppliers').update(formData).eq('id', editId);
      if (error) return alert("Error updating: " + error.message);
    } else {
      const { error } = await supabase.from('cnc_suppliers').insert([formData]);
      if (error) {
        if (error.code === '23505') return alert("Supplier code already exists.");
        return alert("Error saving: " + error.message + "\nMake sure you ran the SQL script.");
      }
    }
    setShowModal(false);
    fetchSuppliers();
  };

  const handleToggleStatus = async (s: any) => {
    const newStatus = s.status === 'Active' ? 'Inactive' : 'Active';
    const { error } = await supabase.from('cnc_suppliers').update({ status: newStatus }).eq('id', s.id);
    if (!error) fetchSuppliers();
  };

  const columns: Column<any>[] = [
    { key: 'code', label: 'Code', sortable: true, render: (r) => <span className="font-mono text-xs font-semibold text-brand-700">{r.code}</span> },
    { key: 'name', label: 'Supplier Name', sortable: true, render: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
    { key: 'opening', label: 'Opening Balance', align: 'right', render: (r) => { const t = openingText(r.name); return t ? <span className="font-medium text-slate-700 whitespace-nowrap">{t}</span> : <span className="text-slate-300">—</span>; } },
    { key: 'category', label: 'Category', sortable: true, render: (r) => <Badge variant="neutral">{r.category}</Badge> },
    { key: 'contact', label: 'Contact', render: (r) => <div><p className="text-sm font-medium">{r.contact_person || 'N/A'}</p><p className="text-xs text-slate-500">{r.phone || r.email || ''}</p></div> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={r.status === 'Active' ? 'success' : 'neutral'} dot>{r.status}</Badge> },
    {
      key: 'actions', label: 'Actions', align: 'center', render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => { setViewTarget(r); setActiveTab('Profile'); }} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors" title="View"><Eye size={15} /></button>
          <button onClick={() => { setEditId(r.id); setFormData(r); setShowModal(true); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Edit"><Edit size={15} /></button>
          <button onClick={() => handleToggleStatus(r)} className={`p-1.5 rounded transition-colors ${r.status === 'Active' ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`} title={r.status === 'Active' ? "Deactivate" : "Activate"}>
            {r.status === 'Active' ? <PowerOff size={15} /> : <Power size={15} />}
          </button>
        </div>
      )
    },
  ];

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader 
         title="Suppliers" 
         description="Manage vendor master data and assess performance" 
         actions={
           <div className="flex items-center gap-2">
             <FilterButton />
             <ExportButton />
             <Button onClick={() => { setEditId(null); setFormData(resetForm()); setShowModal(true); }} icon={<Plus size={16}/>}>New Supplier</Button>
           </div>
         } 
      />
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Suppliers" value={suppliers.length.toString()} icon={<Users size={20} />} accent="brand" />
        <StatCard label="Active" value={suppliers.filter(s => s.status === 'Active').length.toString()} icon={<Users size={20} />} accent="success" />
        <StatCard label="Avg Rating" value="N/A" icon={<TrendingUp size={20} />} accent="neutral" />
        <StatCard label="Avg On-Time" value="N/A" icon={<Activity size={20} />} accent="neutral" />
      </div>

      <Card>
         <DataTable data={suppliers} columns={columns} searchKeys={['name', 'code', 'category', 'contact_person']} />
      </Card>

      {/* Add / Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editId ? "Edit Supplier" : "New Supplier"} subtitle="Master Data Record" size="xl" footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave}>Save Record</Button></>}>
        <div className="space-y-3">
           <div className="grid grid-cols-2 gap-4">
              <FormField label="Supplier Code" required><input className={inputClass} value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} /></FormField>
              <FormField label="Supplier Name" required><input className={inputClass} value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} /></FormField>
              <div className="space-y-1"><label className="text-xs font-medium text-slate-700">Category</label>
                 <select className={inputClass} value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                    <option>Raw Material</option><option>Components</option><option>Tooling</option><option>Consumables</option><option>Services</option><option>Other</option>
                 </select>
              </div>
              <div className="space-y-1"><label className="text-xs font-medium text-slate-700">Status</label>
                 <select className={inputClass} value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                    <option>Active</option><option>Inactive</option>
                 </select>
              </div>
           </div>
           
           <h4 className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-2">Contact Details</h4>
           <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="col-span-2"><FormField label="Contact Person"><input className={inputClass} value={formData.contact_person} onChange={e => setFormData({...formData, contact_person: e.target.value})} /></FormField></div>
              <div className="col-span-2"><FormField label="Email"><input type="email" className={inputClass} value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} /></FormField></div>
              <div className="col-span-2"><FormField label="Phone"><input className={inputClass} value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} /></FormField></div>
              <div className="col-span-2"><FormField label="Website"><input className={inputClass} value={formData.website} onChange={e => setFormData({...formData, website: e.target.value})} /></FormField></div>
           </div>

           <h4 className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-2">Business & Tax</h4>
           <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="col-span-2"><FormField label="GST Number"><input className={inputClass} value={formData.gst_number} onChange={e => setFormData({...formData, gst_number: e.target.value})} /></FormField></div>
              <div className="col-span-2"><FormField label="PAN"><input className={inputClass} value={formData.pan} onChange={e => setFormData({...formData, pan: e.target.value})} /></FormField></div>
              <div className="col-span-2"><FormField label="Payment Terms"><input className={inputClass} value={formData.payment_terms} onChange={e => setFormData({...formData, payment_terms: e.target.value})} /></FormField></div>
           </div>

           <h4 className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-2">Address</h4>
           <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><FormField label="Street Address"><input className={inputClass} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} /></FormField></div>
              <FormField label="Address"><input className={inputClass} value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} /></FormField>
              <FormField label="State"><input className={inputClass} value={formData.state} onChange={e => setFormData({...formData, state: e.target.value})} /></FormField>
              <FormField label="Country"><input className={inputClass} value={formData.country} onChange={e => setFormData({...formData, country: e.target.value})} /></FormField>
              <FormField label="Pincode"><input className={inputClass} value={formData.pincode} onChange={e => setFormData({...formData, pincode: e.target.value})} /></FormField>
           </div>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={viewTarget?.name} subtitle={viewTarget?.code} size="xl">
         {viewTarget && (
            <div>
               <div className="flex gap-4 border-b border-slate-200 mb-4 pb-0 overflow-x-auto scrollbar-hide">
                  {['Profile', 'Purchase Orders', 'Goods Receipts', 'Performance'].map(tab => (
                     <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-2 px-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{tab}</button>
                  ))}
               </div>

               {activeTab === 'Profile' && (
                  <div className="space-y-3">
                     <div className="grid grid-cols-3 gap-4">
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                           <p className="text-xs text-slate-500 font-semibold mb-1">Status</p>
                           <Badge variant={viewTarget.status === 'Active' ? 'success' : 'neutral'}>{viewTarget.status}</Badge>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                           <p className="text-xs text-slate-500 font-semibold mb-1">Category</p>
                           <p className="font-semibold text-slate-800">{viewTarget.category || 'N/A'}</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                           <p className="text-xs text-slate-500 font-semibold mb-1">Opening Balance</p>
                           <p className="font-semibold text-slate-800">{openingText(viewTarget.name) || 'None'}</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                           <p className="text-xs text-slate-500 font-semibold mb-1">Payment Terms</p>
                           <p className="font-semibold text-slate-800">{viewTarget.payment_terms || 'N/A'}</p>
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-8">
                        <div>
                           <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Contact Information</h5>
                           <div className="space-y-2 text-sm">
                              <div className="flex justify-between"><span className="text-slate-500">Contact Person</span><span className="font-medium">{viewTarget.contact_person || '-'}</span></div>
                              <div className="flex justify-between"><span className="text-slate-500">Phone</span><span className="font-medium">{viewTarget.phone || '-'}</span></div>
                              <div className="flex justify-between"><span className="text-slate-500">Email</span><span className="font-medium">{viewTarget.email || '-'}</span></div>
                              <div className="flex justify-between"><span className="text-slate-500">Website</span><span className="font-medium">{viewTarget.website || '-'}</span></div>
                           </div>
                        </div>
                        <div>
                           <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Business Details</h5>
                           <div className="space-y-2 text-sm">
                              <div className="flex justify-between"><span className="text-slate-500">GST Number</span><span className="font-medium">{viewTarget.gst_number || '-'}</span></div>
                              <div className="flex justify-between"><span className="text-slate-500">PAN</span><span className="font-medium">{viewTarget.pan || '-'}</span></div>
                              <div className="flex flex-col mt-2 pt-2 border-t border-slate-100">
                                 <span className="text-slate-500 mb-1">Address</span>
                                 <span className="font-medium">{viewTarget.address}</span>
                                 <span className="font-medium">{[viewTarget.city, viewTarget.state, viewTarget.country].filter(Boolean).join(', ')} {viewTarget.pincode}</span>
                              </div>
                           </div>
                        </div>
                     </div>
                  </div>
               )}

               {activeTab === 'Purchase Orders' && (
                  <div className="py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                     <ShoppingCart size={24} className="mx-auto text-slate-300 mb-2" />
                     <p className="text-slate-500 text-sm">No Purchase Orders found for this supplier.</p>
                     <p className="text-xs text-slate-400 mt-1">PO tracking module is pending implementation.</p>
                  </div>
               )}

               {activeTab === 'Goods Receipts' && (
                  <div className="py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                     <Package size={24} className="mx-auto text-slate-300 mb-2" />
                     <p className="text-slate-500 text-sm">No Goods Receipts found.</p>
                  </div>
               )}

               {activeTab === 'Performance' && (
                  <div className="py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                     <Activity size={24} className="mx-auto text-slate-300 mb-2" />
                     <p className="text-slate-500 text-sm">Insufficient data to calculate performance metrics.</p>
                     <p className="text-xs text-slate-400 mt-1">Requires historical PO and delivery data.</p>
                  </div>
               )}
            </div>
         )}
      </Modal>
    </div>
  );
}

export function PurchaseRequisitionsPage() {
  const [prs, setPrs] = useState<any[]>([]);
  // Global date filter (requisition date).
  const { inRange: inPRDateRange } = useGlobalDateFilter();
  const rangedPrs = useMemo(
    () => prs.filter((r: any) => inPRDateRange(r.pr_date ?? r.created_at)),
    [prs, inPRDateRange],
  );
  const [, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [viewTarget, setViewTarget] = useState<any>(null);
  
  // Master data for form
  const [materials, setMaterials] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [materialRequests, setMaterialRequests] = useState<any[]>([]);

  // Form State
  const resetForm = () => ({
    prNo: `PR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
    date: new Date().toISOString().split('T')[0],
    department: 'Production',
    priority: 'Normal',
    sourceType: 'Manual',
    sourceReference: '',
    materialRequestId: '',
    remarks: '',
    items: [] as any[]
  });
  const [form, setForm] = useState(resetForm());
  const [submitting, setSubmitting] = useState(false);
  const [converting, setConverting] = useState(false);
  const { profile } = useAuth();

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    // Fetch PRs
    const { data: prData } = await supabase.from('cnc_purchase_requisitions').select('*, items:cnc_purchase_requisition_items(*)').order('created_at', { ascending: false });
    if (prData) setPrs(prData);

    // Fetch Master Data for dropdowns
    const { data: rmData } = await supabase.from('cnc_raw_materials').select('*');
    const { data: ptData } = await supabase.from('cnc_parts').select('*');
    if (rmData && ptData) {
      setMaterials([
        ...rmData.map(r => ({ code: r.material_code, name: r.name, stock: r.stock_qty || 0, min: r.min_stock || 0, uom: r.uom, supplier_id: r.preferred_supplier_id, raw_material_id: r.id })),
        ...ptData.map(p => ({ code: p.part_no, name: p.part_name, stock: p.stock_qty || 0, min: p.min_stock || 0, uom: p.unit, supplier_id: p.preferred_supplier_id, part_id: p.id }))
      ]);
    }
    const { data: supData } = await supabase.from('cnc_suppliers').select('*').eq('status', 'Active');
    if (supData) setSuppliers(supData);

    const { data: mrData } = await supabase.from('cnc_material_requests').select('*').in('status', ['Pending', 'Partial']);
    if (mrData) setMaterialRequests(mrData);

    setLoading(false);
  }

  const handleAddItem = () => {
    setForm({ ...form, items: [...form.items, { material_code: '', material_name: '', qty: '', uom: 'kg', required_date: '', preferred_supplier_id: '', estimated_unit_cost: '' }] });
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...form.items];
    newItems[index] = { ...newItems[index], [field]: value };
    
    // Auto-fill material details
    if (field === 'material_code') {
      const mat = materials.find(m => m.code === value);
      if (mat) {
         newItems[index].material_name = mat.name;
         newItems[index].uom = mat.uom;
         newItems[index].preferred_supplier_id = mat.supplier_id || '';
         newItems[index].raw_material_id = mat.raw_material_id || null;
         newItems[index].part_id = mat.part_id || null;
      }
    }
    
    setForm({ ...form, items: newItems });
  };

  const handleSourceChange = (e: any) => {
    const type = e.target.value;
    setForm({ ...form, sourceType: type, sourceReference: '', materialRequestId: '', items: [] });
  };

  const handleMRSelect = async (e: any) => {
    const mrId = e.target.value;
    const mr = materialRequests.find(m => m.id === mrId);
    if (!mr) return;

    setForm({ 
      ...form, 
      materialRequestId: mrId, 
      sourceReference: mr.request_no,
      items: [] // In a real scenario, fetch MR items and map them here. We'll leave blank for manual fill for now.
    });
    
    // Fetch MR Items
    const { data: mrItems } = await supabase.from('cnc_material_request_items').select('*').eq('request_id', mrId);
    if (mrItems) {
      setForm(prev => ({
         ...prev,
         items: mrItems.map(i => {
           const mat = materials.find(m => m.code === i.material_code) || {} as any;
           return {
             material_code: i.material_code,
             material_name: i.material_name,
             qty: i.request_qty,
             uom: i.uom || mat.uom || 'kg',
             required_date: mr.required_date,
             preferred_supplier_id: mat.supplier_id || '',
             estimated_unit_cost: ''
           }
         })
      }));
    }
  };

  // cnc_purchase_requisition_items has no raw_material_id/part_id columns, so resolve them from material_code
  // when the PR is converted to a PO (and from there onto the GRN).
  const resolveItemIds = (code: string) => {
    const mat = materials.find(m => m.code === code);
    return { raw_material_id: mat?.raw_material_id || null, part_id: mat?.part_id || null };
  };

  const submitPR = async (status: string) => {
    if (submitting) return;
    if (!form.items.length) return alert('Add at least one product');
    setSubmitting(true);
    try {
      const { data: prRecord, error } = await supabase.from('cnc_purchase_requisitions').insert([{
         pr_no: form.prNo,
         pr_date: form.date,
         department: form.department,
         priority: form.priority,
         source_type: form.sourceType,
         source_reference: form.sourceReference,
         material_request_id: form.materialRequestId || null,
         status: status,
         remarks: form.remarks,
         requested_by: profile?.full_name || ''
      }]).select();

      if (error) { console.error(error); return alert('Error creating PR: ' + error.message); }
      if (!prRecord || prRecord.length === 0) return alert('Error creating PR: no record returned.');

      const prId = prRecord[0].id;

      const itemsToInsert = form.items.map(i => ({
        pr_id: prId,
        material_code: i.material_code,
        material_name: i.material_name,
        qty: Number(i.qty),
        uom: i.uom,
        required_date: i.required_date || null,
        preferred_supplier_id: i.preferred_supplier_id || null,
        estimated_unit_cost: i.estimated_unit_cost ? Number(i.estimated_unit_cost) : null
      }));

      const { error: itemsError } = await supabase.from('cnc_purchase_requisition_items').insert(itemsToInsert);
      if (itemsError) {
        console.error(itemsError);
        const { error: cleanupError } = await supabase.from('cnc_purchase_requisitions').delete().eq('id', prId);
        if (cleanupError) console.error('Failed to roll back PR header:', cleanupError);
        return alert('Error saving PR products: ' + itemsError.message);
      }

      setShowAdd(false);
      fetchData();
    } finally {
      setSubmitting(false);
    }
  };

  const handleAction = async (id: string, action: string) => {
    let error: any = null;
    if (action === 'Reject') {
       const reason = prompt("Enter rejection reason:");
       if (!reason) return;
       ({ error } = await supabase.from('cnc_purchase_requisitions').update({ status: 'Rejected', rejection_reason: reason }).eq('id', id));
    } else if (action === 'Submit') {
       ({ error } = await supabase.from('cnc_purchase_requisitions').update({ status: 'Pending Approval' }).eq('id', id));
    } else if (action === 'Approve') {
       ({ error } = await supabase.from('cnc_purchase_requisitions').update({ status: 'Approved' }).eq('id', id));
    }
    if (error) { console.error(error); alert(`Failed to ${action.toLowerCase()} PR: ${error.message}`); return; }
    fetchData();
    setViewTarget(null);
  };

  const convertToPO = async (pr: any) => {
    if (converting) return;
    if (!confirm("Create a Draft Purchase Order for this Requisition?")) return;
    setConverting(true);
    try {
      // Create PO
      const poNo = `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Pick the first item's supplier as the PO supplier (simplified logic for Phase 1)
      const primarySupplierId = pr.items?.[0]?.preferred_supplier_id || null;

      const poItems = (pr.items || []).map((i: any) => {
         const qty = Number(i.qty) || 0;
         const price = Number(i.estimated_unit_cost) || 0;
         return {
            ...resolveItemIds(i.material_code),
            material_code: i.material_code,
            material_name: i.material_name,
            quantity: qty,
            unit: i.uom,
            unit_price: price,
            tax_amount: 0,
            total_amount: qty * price,
            required_date: i.required_date
         };
      });
      const subtotal = poItems.reduce((acc: number, i: any) => acc + i.total_amount, 0);

      const { data: poRecord, error } = await supabase.from('cnc_purchase_orders').insert([{
         po_number: poNo,
         purchase_requisition_id: pr.id,
         supplier_id: primarySupplierId,
         order_date: new Date().toISOString().split('T')[0],
         status: 'Draft',
         subtotal,
         tax: 0,
         grand_total: subtotal,
         notes: `Generated from ${pr.pr_no}`
      }]).select();

      if (error) { console.error(error); return alert("Error creating PO: " + error.message); }
      if (!poRecord || poRecord.length === 0) return alert('Error creating PO: no record returned.');

      const poId = poRecord[0].id;

      // Create PO Items
      if (poItems.length > 0) {
         const { error: itemsError } = await supabase.from('cnc_purchase_order_items').insert(poItems.map((i: any) => ({ ...i, purchase_order_id: poId })));
         if (itemsError) {
            console.error(itemsError);
            const { error: cleanupError } = await supabase.from('cnc_purchase_orders').delete().eq('id', poId);
            if (cleanupError) console.error('Failed to roll back PO header:', cleanupError);
            return alert('Error creating PO products: ' + itemsError.message);
         }
      }

      // Update PR Status
      const { error: prError } = await supabase.from('cnc_purchase_requisitions').update({ status: 'Converted to PO' }).eq('id', pr.id);
      if (prError) { console.error(prError); alert(`PO ${poNo} was created but the PR status could not be updated: ${prError.message}`); }
      else alert(`Draft Purchase Order ${poNo} created successfully!`);
      fetchData();
      setViewTarget(null);
    } finally {
      setConverting(false);
    }
  };

  const columns: Column<any>[] = [
    { key: 'pr_no', label: 'PR Number', render: (r) => <span className="font-mono text-xs font-semibold text-brand-700">{r.pr_no}</span> },
    { key: 'pr_date', label: 'Request Date', render: (r) => <span className="text-sm">{r.pr_date}</span> },
    { key: 'department', label: 'Department', render: (r) => <span className="text-sm">{r.department}</span> },
    { key: 'source', label: 'Source', render: (r) => <span className="text-sm">{r.source_type} {r.source_reference && `(${r.source_reference})`}</span> },
    { key: 'priority', label: 'Priority', render: (r) => <Badge variant={r.priority === 'High' ? 'error' : r.priority === 'Urgent' ? 'error' : 'neutral'}>{r.priority}</Badge> },
    { key: 'status', label: 'Status', render: (r) => <Badge variant={r.status === 'Approved' ? 'success' : r.status === 'Rejected' ? 'error' : r.status === 'Converted to PO' ? 'brand' : 'warning'} dot>{r.status}</Badge> },
    { key: 'actions', label: 'Actions', align: 'center', render: (r) => (
       <Button variant="secondary" size="sm" onClick={() => setViewTarget(r)} icon={<Eye size={14} />}>View</Button>
    ) }
  ];

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader 
         title="Purchase Requisitions" 
         description="Internal requests for procurement"
         actions={<Button onClick={() => { setForm(resetForm()); setShowAdd(true); }} icon={<Plus size={16}/>}>New Requisition</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total PRs" value={rangedPrs.length.toString()} icon={<FileText size={20} />} accent="neutral" />
        <StatCard label="Pending Approval" value={rangedPrs.filter(p => p.status === 'Pending Approval' || p.status === 'Submitted').length.toString()} icon={<Activity size={20} />} accent="warning" />
        <StatCard label="Approved" value={rangedPrs.filter(p => p.status === 'Approved').length.toString()} icon={<TrendingUp size={20} />} accent="success" />
        <StatCard label="Converted to PO" value={rangedPrs.filter(p => p.status === 'Converted to PO').length.toString()} icon={<ShoppingCart size={20} />} accent="brand" />
      </div>

      <Card>
         <DataTable data={rangedPrs} columns={columns} searchKeys={['pr_no', 'department', 'source_reference']} />
      </Card>

      {/* CREATE PR MODAL */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Purchase Requisition" subtitle="Internal Procurement Request" size="xl" footer={<>
         <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
         <Button variant="secondary" disabled={submitting} onClick={() => submitPR('Draft')}>Save Draft</Button>
         <Button disabled={submitting} onClick={() => submitPR('Pending Approval')}>Submit for Approval</Button>
      </>}>
         <div className="space-y-3">
            <div className="grid grid-cols-3 gap-4">
               <FormField label="PR Number" required><input className={inputClass} value={form.prNo} disabled /></FormField>
               <FormField label="Request Date" required><input type="date" className={inputClass} value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></FormField>
               <FormField label="Department"><input className={inputClass} value={form.department} onChange={e => setForm({...form, department: e.target.value})} /></FormField>
               
               <div className="space-y-1">
                 <label className="text-xs font-medium text-slate-700">Source</label>
                 <select className={inputClass} value={form.sourceType} onChange={handleSourceChange}>
                    <option>Manual</option>
                    <option>Material Request</option>
                    <option>Low Stock Alert</option>
                 </select>
               </div>
               
               {form.sourceType === 'Material Request' ? (
                  <div className="space-y-1 col-span-2">
                     <label className="text-xs font-medium text-slate-700">Select Material Request</label>
                     <select className={inputClass} value={form.materialRequestId} onChange={handleMRSelect}>
                        <option value="">-- Select MR --</option>
                        {materialRequests.map(mr => (
                           <option key={mr.id} value={mr.id}>{mr.request_no} (WO: {mr.work_order_no || 'N/A'})</option>
                        ))}
                     </select>
                  </div>
               ) : (
                  <div className="col-span-2"><FormField label="Source Reference"><input className={inputClass} value={form.sourceReference} onChange={e => setForm({...form, sourceReference: e.target.value})} placeholder="e.g. Email from Production" /></FormField></div>
               )}

               <div className="space-y-1">
                 <label className="text-xs font-medium text-slate-700">Priority</label>
                 <select className={inputClass} value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}>
                    <option>Low</option><option>Normal</option><option>High</option><option>Urgent</option>
                 </select>
               </div>
               <div className="col-span-2"><FormField label="Remarks"><input className={inputClass} value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></FormField></div>
            </div>

            <div className="border-t border-slate-200 pt-4">
               <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-bold text-slate-800">Requested Products</h4>
                  <Button variant="secondary" size="sm" onClick={handleAddItem} icon={<Plus size={14}/>}>Add Product</Button>
               </div>
               
               {form.items.length === 0 ? (
                  <div className="text-center p-4 bg-slate-50 rounded-lg border border-dashed border-slate-300 text-slate-500 text-sm">No products added yet.</div>
               ) : (
                  <div className="overflow-x-auto">
                     <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead>
                           <tr className="bg-slate-50 border-y border-slate-200">
                              <th className="p-2 font-semibold text-slate-600">Material</th>
                              <th className="p-2 font-semibold text-slate-600">Req Qty</th>
                              <th className="p-2 font-semibold text-slate-600">UoM</th>
                              <th className="p-2 font-semibold text-slate-600">Current Stock</th>
                              <th className="p-2 font-semibold text-slate-600">Shortage</th>
                              <th className="p-2 font-semibold text-slate-600">Pref. Supplier</th>
                              <th className="p-2 font-semibold text-slate-600">Est. Unit Cost (₹)</th>
                              <th className="p-2"></th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                           {form.items.map((item, idx) => {
                              const matInfo = materials.find(m => m.code === item.material_code) || { stock: 0 };
                              const shortage = Math.max(0, Number(item.qty || 0) - matInfo.stock);
                              return (
                                 <tr key={idx}>
                                    <td className="p-1">
                                       <select className={inputClass} value={item.material_code} onChange={e => updateItem(idx, 'material_code', e.target.value)}>
                                          <option value="">Select...</option>
                                          {materials.map(m => <option key={m.code} value={m.code}>{m.code} - {m.name}</option>)}
                                       </select>
                                    </td>
                                    <td className="p-1"><input type="number" className={inputClass} value={item.qty} onChange={e => updateItem(idx, 'qty', e.target.value)} /></td>
                                    <td className="p-1"><input className={inputClass} value={item.uom} onChange={e => updateItem(idx, 'uom', e.target.value)} /></td>
                                    <td className="p-2 text-slate-600">{item.material_code ? matInfo.stock : '-'}</td>
                                    <td className="p-2 text-red-600 font-semibold">{item.material_code && shortage > 0 ? shortage : '-'}</td>
                                    <td className="p-1">
                                       <select className={inputClass} value={item.preferred_supplier_id} onChange={e => updateItem(idx, 'preferred_supplier_id', e.target.value)}>
                                          <option value="">None</option>
                                          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                       </select>
                                    </td>
                                    <td className="p-1"><input type="number" className={inputClass} value={item.estimated_unit_cost} onChange={e => updateItem(idx, 'estimated_unit_cost', e.target.value)} /></td>
                                    <td className="p-1 text-center"><button onClick={() => { const ni = [...form.items]; ni.splice(idx, 1); setForm({...form, items: ni}); }} className="text-red-500 hover:text-red-700"><Trash2 size={16}/></button></td>
                                 </tr>
                              );
                           })}
                        </tbody>
                     </table>
                  </div>
               )}
            </div>
         </div>
      </Modal>

      {/* VIEW PR MODAL */}
      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={`Requisition Details: ${viewTarget?.pr_no}`} subtitle={viewTarget?.status} size="xl" footer={
         <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" onClick={() => setViewTarget(null)}>Close</Button>
            {(viewTarget?.status === 'Draft' || viewTarget?.status === 'Pending') && <Button onClick={() => handleAction(viewTarget.id, 'Submit')}>Submit for Approval</Button>}
            {viewTarget?.status === 'Pending Approval' && <>
               <Button variant="error" onClick={() => handleAction(viewTarget.id, 'Reject')}>Reject</Button>
               <Button variant="primary" onClick={() => handleAction(viewTarget.id, 'Approve')}>Approve PR</Button>
            </>}
            {viewTarget?.status === 'Approved' && (
               <Button variant="brand" disabled={converting} onClick={() => convertToPO(viewTarget)} icon={<ShoppingCart size={16}/>}>Convert to Purchase Order</Button>
            )}
            {viewTarget?.status === 'Converted to PO' && (
               <div className="px-4 py-2 bg-brand-50 text-brand-700 rounded-lg font-medium border border-brand-200 flex items-center gap-2">
                  <ShoppingCart size={16}/> Purchase Order Created
               </div>
            )}
         </div>
      }>
         {viewTarget && (
            <div className="space-y-3">
               <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm">
                  <div><span className="block text-slate-500 mb-1">Date</span><span className="font-medium text-slate-900">{viewTarget.pr_date}</span></div>
                  <div><span className="block text-slate-500 mb-1">Requested By</span><span className="font-medium text-slate-900">{viewTarget.requested_by}</span></div>
                  <div><span className="block text-slate-500 mb-1">Department</span><span className="font-medium text-slate-900">{viewTarget.department}</span></div>
                  <div><span className="block text-slate-500 mb-1">Priority</span><Badge variant={viewTarget.priority === 'Urgent' ? 'error' : 'neutral'}>{viewTarget.priority}</Badge></div>
                  <div><span className="block text-slate-500 mb-1">Source</span><span className="font-medium text-slate-900">{viewTarget.source_type}</span></div>
                  <div className="col-span-2"><span className="block text-slate-500 mb-1">Source Ref</span><span className="font-medium text-slate-900">{viewTarget.source_reference || 'N/A'}</span></div>
               </div>

               {viewTarget.status === 'Rejected' && viewTarget.rejection_reason && (
                  <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-red-800 text-sm">
                     <strong>Rejection Reason:</strong> {viewTarget.rejection_reason}
                  </div>
               )}

               <div>
                  <h4 className="text-sm font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2">Requested Products</h4>
                  <table className="w-full text-left text-sm">
                     <thead>
                        <tr className="text-slate-500 border-b border-slate-100">
                           <th className="pb-2 font-medium">Material</th>
                           <th className="pb-2 font-medium">Qty</th>
                           <th className="pb-2 font-medium">Supplier (Suggested)</th>
                           <th className="pb-2 font-medium">Est. Cost</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-50">
                        {viewTarget.items?.map((item: any, idx: number) => {
                           const sup = suppliers.find(s => s.id === item.preferred_supplier_id);
                           return (
                              <tr key={idx}>
                                 <td className="py-3">
                                    <p className="font-medium text-slate-800">{item.material_name}</p>
                                    <p className="text-xs text-slate-500 font-mono">{item.material_code}</p>
                                 </td>
                                 <td className="py-3 font-semibold">{item.qty} <span className="text-xs font-normal text-slate-500">{item.uom}</span></td>
                                 <td className="py-3">{sup ? sup.name : <span className="text-slate-400 italic">Not Specified</span>}</td>
                                 <td className="py-3 font-mono">{item.estimated_unit_cost ? `₹${item.estimated_unit_cost}` : '-'}</td>
                              </tr>
                           );
                        })}
                     </tbody>
                  </table>
               </div>
            </div>
         )}
      </Modal>
    </div>
  );
}

export function PurchaseOrdersPage() {
  const [pos, setPos] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [viewTarget, setViewTarget] = useState<any>(null);
  // Goods Purchase inwards entered in the Sales Pipeline: every one is a purchase, so they are listed here with the POs.
  const [inwardRows, setInwardRows] = useState<any[]>([]);
  const [inwardView, setInwardView] = useState<any | null>(null);

  // Master Data
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);

  // Form State
  const resetForm = () => ({
    id: null,
    poNo: `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
    orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '',
    supplierId: '',
    paymentTerms: 'Net 30',
    billingAddress: '',
    deliveryAddress: '',
    notes: '',
    items: [] as any[]
  });
  const [form, setForm] = useState(resetForm());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const { setHeader, setTabActions, setHeaderCenter } = useHeaderKpis();

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    // 1. Fetch POs
    const { data: poData } = await supabase.from('cnc_purchase_orders').select('*, supplier:cnc_suppliers(name, code, address, gst_number), items:cnc_purchase_order_items(*)').order('created_at', { ascending: false });
    if (poData) setPos(poData);

    // 1b. Goods Purchase inwards
    const inw = await supabase.from('cnc_inwards').select('*').order('created_at', { ascending: false }).limit(5000);
    if (!inw.error) setInwardRows(((inw.data ?? []) as any[]).filter(r => String(r.status ?? '') !== 'Deleted' && String(r.category ?? '').trim().toUpperCase() === 'GOODS PURCHASE'));

    // 2. Fetch Suppliers
    const { data: supData } = await supabase.from('cnc_suppliers').select('*').eq('status', 'Active');
    if (supData) setSuppliers(supData);

    // 3. Fetch Materials
    const { data: rmData } = await supabase.from('cnc_raw_materials').select('*');
    const { data: ptData } = await supabase.from('cnc_parts').select('*');
    if (rmData && ptData) {
      setMaterials([
        ...rmData.map(r => ({ code: r.material_code, name: r.name, uom: r.uom, raw_material_id: r.id })),
        ...ptData.map(p => ({ code: p.part_no, name: p.part_name, uom: p.unit, part_id: p.id }))
      ]);
    }
    setLoading(false);
  }

  const handleSupplierChange = (e: any) => {
    const sId = e.target.value;
    const s = suppliers.find(sup => sup.id === sId);
    setForm({
      ...form, 
      supplierId: sId,
      paymentTerms: s?.payment_terms || 'Net 30',
      billingAddress: 'ARGUSCNC Main Office, 123 Industrial Phase, Pune',
      deliveryAddress: s?.address || 'ARGUSCNC Main Warehouse, Pune'
    });
  };

  const handleAddItem = () => {
    setForm({ ...form, items: [...form.items, { material_code: '', material_name: '', quantity: '', unit: 'kg', unit_price: '', tax_amount: '', total_amount: '' }] });
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...form.items];
    newItems[index] = { ...newItems[index], [field]: value };
    
    if (field === 'material_code') {
      const mat = materials.find(m => m.code === value);
      if (mat) {
         newItems[index].material_name = mat.name;
         newItems[index].unit = mat.uom;
         newItems[index].raw_material_id = mat.raw_material_id || null;
         newItems[index].part_id = mat.part_id || null;
      }
    }

    // Auto calculate totals
    const qty = Number(newItems[index].quantity) || 0;
    const price = Number(newItems[index].unit_price) || 0;
    const taxPercent = Number(newItems[index].tax_amount) || 0; // Using tax_amount field as tax% for UI input simplicity
    
    const lineTotalBase = qty * price;
    const taxAmount = lineTotalBase * (taxPercent / 100);
    newItems[index].total_amount = lineTotalBase + taxAmount;
    
    setForm({ ...form, items: newItems });
  };

  const calculateTotals = () => {
    let subtotal = 0;
    let tax = 0;
    form.items.forEach(i => {
       const qty = Number(i.quantity) || 0;
       const price = Number(i.unit_price) || 0;
       const taxPercent = Number(i.tax_amount) || 0;
       const lineBase = qty * price;
       subtotal += lineBase;
       tax += lineBase * (taxPercent / 100);
    });
    return { subtotal, tax, grandTotal: subtotal + tax };
  };

  const savePO = async (statusToSave = 'Draft') => {
    if (saving) return;
    if (!form.supplierId) return alert('Supplier is required');
    if (!form.items.length) return alert('At least one product is required');
    if (statusToSave === 'Issued' && !form.expectedDate) return alert('Expected Delivery Date is required to Issue PO');

    const totals = calculateTotals();

    const poRecord = {
       po_number: form.poNo,
       supplier_id: form.supplierId,
       order_date: form.orderDate,
       expected_date: form.expectedDate || null,
       status: statusToSave,
       payment_terms: form.paymentTerms,
       billing_address: form.billingAddress,
       delivery_address: form.deliveryAddress,
       subtotal: totals.subtotal,
       tax: totals.tax,
       grand_total: totals.grandTotal,
       notes: form.notes
    };

    setSaving(true);
    try {
      let poId = form.id;
      const isNew = !poId;
      let oldItemIds: string[] = [];

      if (poId) {
         // Update existing Draft
         const { error: updErr } = await supabase.from('cnc_purchase_orders').update(poRecord).eq('id', poId);
         if (updErr) { console.error(updErr); return alert('Error updating PO: ' + updErr.message); }
         // Remember the old items; they are only removed after the new ones are saved,
         // so a failed insert can't leave the PO with no items (still not a single transaction).
         const { data: oldItems, error: oldErr } = await supabase.from('cnc_purchase_order_items').select('id').eq('purchase_order_id', poId);
         if (oldErr) { console.error(oldErr); return alert('Error loading existing PO products: ' + oldErr.message); }
         oldItemIds = (oldItems || []).map((i: any) => i.id);
      } else {
         // Insert new
         const { data: insData, error: insErr } = await supabase.from('cnc_purchase_orders').insert([poRecord]).select();
         if (insErr) { console.error(insErr); return alert('Error creating PO: ' + insErr.message); }
         if (!insData || insData.length === 0) return alert('Error creating PO: no record returned.');
         poId = insData[0].id;
      }

      // Insert items
      const itemsToInsert = form.items.map(i => ({
        purchase_order_id: poId,
        raw_material_id: i.raw_material_id || null,
        part_id: i.part_id || null,
        material_code: i.material_code,
        material_name: i.material_name,
        quantity: Number(i.quantity) || 0,
        unit: i.unit,
        unit_price: Number(i.unit_price) || 0,
        tax_amount: Number(i.tax_amount) || 0, // Storing tax % here for simplicity
        total_amount: Number(i.total_amount) || 0
      }));

      const { error: itemsErr } = await supabase.from('cnc_purchase_order_items').insert(itemsToInsert);
      if (itemsErr) {
         console.error(itemsErr);
         if (isNew) {
            const { error: cleanupError } = await supabase.from('cnc_purchase_orders').delete().eq('id', poId);
            if (cleanupError) console.error('Failed to roll back PO header:', cleanupError);
         }
         return alert('Error saving PO products: ' + itemsErr.message);
      }

      if (oldItemIds.length > 0) {
         const { error: delErr } = await supabase.from('cnc_purchase_order_items').delete().in('id', oldItemIds);
         if (delErr) { console.error(delErr); alert('PO saved, but old line products could not be removed (they may appear duplicated): ' + delErr.message); }
      }

      setShowAdd(false);
      setViewTarget(null);
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const loadPOForEdit = (po: any) => {
     setForm({
        id: po.id,
        poNo: po.po_number,
        orderDate: po.order_date,
        expectedDate: po.expected_date || '',
        supplierId: po.supplier_id,
        paymentTerms: po.payment_terms || '',
        billingAddress: po.billing_address || '',
        deliveryAddress: po.delivery_address || '',
        notes: po.notes || '',
        items: (po.items || []).map((i:any) => ({ ...i }))
     });
     setShowAdd(true);
  };

  const handleIssueAction = async (po: any) => {
     if (!po.expected_date) return alert("Expected delivery date is missing. Please edit the PO first.");
     if (!confirm("Are you sure you want to issue this PO? It will be marked as Issued.")) return;
     const { error } = await supabase.from('cnc_purchase_orders').update({ status: 'Issued' }).eq('id', po.id);
     if (error) { console.error(error); return alert('Failed to issue PO: ' + error.message); }
     fetchData();
     setViewTarget(null);
  };

  // Determine if a PO is delayed visually (Calculated dynamically, doesn't change DB status)
  const isDelayed = (po: any) => {
     if (['Draft', 'Received', 'Cancelled'].includes(po.status)) return false;
     if (!po.expected_date) return false;
     return new Date(po.expected_date) < new Date();
  };

  // One entry per inward number (a multi-part inward is one purchase); shaped like a PO row so the table can sort and search it.
  const inwardPOs = useMemo(() => {
    const byNo = new Map<string, any[]>();
    inwardRows.forEach(r => { const k = String(r.inward_no || r.id); byNo.set(k, [...(byNo.get(k) ?? []), r]); });
    return Array.from(byNo.entries()).map(([no, rows]) => ({
      id: `inw:${no}`, fromInward: true, po_number: no, supplier: { name: String(rows[0].party_name ?? '') },
      order_date: String(rows[0].inward_date ?? rows[0].created_at ?? '').slice(0, 10), expected_date: null,
      grand_total: fromInwards(rows).reduce((n, l) => n + l.credit, 0), status: 'Received', inwardRows: rows,
    }));
  }, [inwardRows]);
  const allPOs = useMemo(() => [...pos, ...inwardPOs].sort((a, b) => String(b.order_date ?? '').localeCompare(String(a.order_date ?? ''))), [pos, inwardPOs]);
  // Global date filter (order date) drives the stats and the table together.
  const { inRange: inPODateRange } = useGlobalDateFilter();
  const rangedPOs = useMemo(
    () => allPOs.filter((p: any) => inPODateRange(p.order_date ?? p.created_at)),
    [allPOs, inPODateRange],
  );

  const poStats = useMemo(() => {
    const total = rangedPOs.length;
    const draft = rangedPOs.filter(p => p.status === 'Draft').length;
    const issued = rangedPOs.filter(p => p.status === 'Issued').length;
    const rcvd = rangedPOs.filter(p => ['Partially Received', 'Received'].includes(p.status)).length;
    const delayed = rangedPOs.filter(p => isDelayed(p)).length;
    return { total, draft, issued, rcvd, delayed };
  }, [rangedPOs]);

  const filteredPOs = useMemo(() => {
    if (!search.trim()) return rangedPOs;
    const q = search.toLowerCase();
    return rangedPOs.filter(p =>
      String(p.po_number || '').toLowerCase().includes(q) ||
      String(p.supplier?.name || '').toLowerCase().includes(q) ||
      String(p.supplier?.code || '').toLowerCase().includes(q)
    );
  }, [rangedPOs, search]);

  const handleExport = () => {
    if (filteredPOs.length === 0) return;
    exportCsv(`Purchase_Orders_${todayISO()}`, [
      ['PO Number', 'Supplier', 'Order Date', 'Expected By', 'Value (INR)', 'Status'],
      ...filteredPOs.map(r => [
        r.po_number,
        r.supplier?.name ?? '',
        r.order_date ?? '',
        r.expected_date ?? '',
        r.grand_total ?? 0,
        r.status ?? '',
      ]),
    ]);
  };

  useEffect(() => {
    setHeader({ title: 'Purchase Orders' });
    setHeaderCenter(
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md text-xs">
          <ShoppingCart size={11} className="text-slate-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total:</span>
          <span className="text-xs font-black text-slate-800 tabular-nums">{poStats.total}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md text-xs">
          <FileText size={11} className="text-slate-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Draft:</span>
          <span className="text-xs font-black text-slate-800 tabular-nums">{poStats.draft}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-orange-50 border border-orange-200 rounded-md text-xs">
          <Send size={11} className="text-orange-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-orange-700">Issued:</span>
          <span className="text-xs font-black text-orange-900 tabular-nums">{poStats.issued}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs">
          <Package size={11} className="text-emerald-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Received:</span>
          <span className="text-xs font-black text-emerald-900 tabular-nums">{poStats.rcvd}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-red-50 border border-red-200 rounded-md text-xs">
          <Activity size={11} className="text-red-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-red-700">Delayed:</span>
          <span className="text-xs font-black text-red-900 tabular-nums">{poStats.delayed}</span>
        </div>
      </div>
    );
    setTabActions(
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search records..."
            className="h-7 w-32 xl:w-44 pl-7 pr-2 text-xs rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500/30 focus:border-brand-500 transition-all placeholder:text-slate-400"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={13} />}
          onClick={handleExport}
          className="h-7 py-1 text-xs px-2.5 shadow-sm font-semibold"
        >
          EXPORT
        </Button>
        <Button
          onClick={() => { setForm(resetForm()); setShowAdd(true); }}
          icon={<Plus size={14} />}
          size="sm"
          className="h-7 py-1 text-xs px-2.5 shadow-sm"
        >
          New PO
        </Button>
      </div>
    );

    return () => {
      setHeader(null);
      setHeaderCenter(null);
      setTabActions(null);
    };
  }, [setHeader, setHeaderCenter, setTabActions, poStats, search, filteredPOs]);

  const columns: Column<any>[] = [
    { key: 'po_number', label: 'PO No', sortable: true, render: (r) => <span className="font-mono text-xs font-semibold text-brand-700">{r.po_number}{r.fromInward && <span className="ml-2 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 font-sans">INWARD</span>}</span> },
    { key: 'supplier', label: 'Supplier', sortable: true, render: (r) => <span className="font-medium text-slate-800">{r.supplier?.name}</span> },
    { key: 'order_date', label: 'Order Date', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.order_date}</span> },
    { key: 'expected_date', label: 'Expected By', sortable: true, render: (r) => (
       <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">{r.expected_date || '-'}</span>
          {isDelayed(r) && <span title="Delayed"><AlertCircle size={12} className="text-red-500" /></span>}
       </div>
    )},
    { key: 'grand_total', label: 'Value', align: 'right', sortable: true, render: (r) => <span className="font-mono text-sm">₹{Number(r.grand_total ?? 0).toLocaleString()}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => (
       <div className="flex flex-col gap-1 items-start">
         <Badge variant={r.status === 'Issued' ? 'brand' : r.status === 'Draft' ? 'neutral' : r.status === 'Received' ? 'success' : 'warning'} dot>{r.status}</Badge>
         {isDelayed(r) && <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1 rounded">DELAYED</span>}
       </div>
    )},
    { key: 'actions', label: 'Actions', align: 'center', render: (r) => (
       <div className="flex gap-1 justify-center">
         <Button variant="secondary" size="sm" onClick={() => (r.fromInward ? setInwardView(r) : setViewTarget(r))} icon={<Eye size={14} />}>View</Button>
         {!r.fromInward && r.status === 'Draft' && <Button variant="secondary" size="sm" onClick={() => loadPOForEdit(r)} icon={<Edit size={14} />} title="Edit PO">Edit</Button>}
       </div>
    ) }
  ];

  return (
    <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full">
      <div className="lg:hidden">
        <PageHeader 
           title="Purchase Orders" 
           description="Manage commercial purchase commitments issued to suppliers" 
           actions={<Button onClick={() => { setForm(resetForm()); setShowAdd(true); }} icon={<Plus size={16}/>}>New PO</Button>} 
        />
      </div>
      
      <div className="lg:hidden grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-3">
        <StatCard compact label="Total POs" value={allPOs.length.toString()} icon={<ShoppingCart size={16} />} accent="brand" />
        <StatCard compact label="Draft" value={allPOs.filter(p => p.status === 'Draft').length.toString()} icon={<FileText size={16} />} accent="neutral" />
        <StatCard compact label="Issued / Sent" value={allPOs.filter(p => p.status === 'Issued').length.toString()} icon={<Send size={16} />} accent="brand" />
        <StatCard compact label="Partially / Fully Rcvd" value={allPOs.filter(p => ['Partially Received', 'Received'].includes(p.status)).length.toString()} icon={<Package size={16} />} accent="success" />
        <StatCard compact label="Delayed" value={allPOs.filter(p => isDelayed(p)).length.toString()} icon={<Activity size={16} />} accent="error" />
      </div>
      
      <Card>
         <DataTable hideToolbar data={filteredPOs} columns={columns} />
      </Card>

      {/* A Goods Purchase inward: the lines that were bought */}
      <Modal open={!!inwardView} onClose={() => setInwardView(null)} title={`Goods Purchase inward: ${inwardView?.po_number ?? ''}`} subtitle={`${inwardView?.supplier?.name ?? ''} · ${inwardView?.order_date ?? ''}`} size="lg"
        footer={<Button variant="secondary" onClick={() => setInwardView(null)}>Close</Button>}>
        {inwardView && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Entered as an inward in the Sales Pipeline. Edit or delete it from the inward card there; this list updates automatically.</p>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <th className="px-3 py-2">Part</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">GST %</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
                <tbody>
                  {(inwardView.inwardRows as any[]).map((r, i) => (
                    <tr key={r.id ?? i} className="border-t border-slate-100">
                      <td className="px-3 py-2">{r.part_name || r.product_name || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(r.price ?? 0).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.gst_percent ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">₹{(fromInwards([r])[0]?.credit ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-slate-300 bg-slate-50 font-bold"><td colSpan={4} className="px-3 py-2 text-right">Total</td><td className="px-3 py-2 text-right tabular-nums">₹{Number(inwardView.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr></tfoot>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* CREATE / EDIT PO MODAL */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={form.id ? "Edit Purchase Order" : "New Purchase Order"} subtitle="Commercial Commitment" size="xl" footer={<>
         <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
         <Button variant="secondary" disabled={saving} onClick={() => savePO('Draft')}>Save Draft</Button>
         <Button disabled={saving} onClick={() => savePO('Issued')} icon={<Send size={16}/>}>Issue PO</Button>
      </>}>
         <div className="space-y-3">
            <div className="grid grid-cols-3 gap-4">
               <FormField label="PO Number" required><input className={inputClass} value={form.poNo} disabled /></FormField>
               <FormField label="Order Date" required><input type="date" className={inputClass} value={form.orderDate} onChange={e => setForm({...form, orderDate: e.target.value})} /></FormField>
               <FormField label="Expected Delivery Date"><input type="date" className={inputClass} value={form.expectedDate} onChange={e => setForm({...form, expectedDate: e.target.value})} /></FormField>
               
               <div className="space-y-1 col-span-2">
                 <label className="text-xs font-medium text-slate-700">Supplier *</label>
                 <select className={inputClass} value={form.supplierId} onChange={handleSupplierChange}>
                    <option value="">-- Select Supplier --</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                 </select>
               </div>
               
               <FormField label="Payment Terms"><input className={inputClass} value={form.paymentTerms} onChange={e => setForm({...form, paymentTerms: e.target.value})} /></FormField>
               
               <div className="col-span-3 grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <label className="text-xs font-medium text-slate-700">Billing Address</label>
                     <textarea className={inputClass} rows={2} value={form.billingAddress} onChange={e => setForm({...form, billingAddress: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                     <label className="text-xs font-medium text-slate-700">Delivery Address</label>
                     <textarea className={inputClass} rows={2} value={form.deliveryAddress} onChange={e => setForm({...form, deliveryAddress: e.target.value})} />
                  </div>
               </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
               <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-bold text-slate-800">Order Products</h4>
                  <Button variant="secondary" size="sm" onClick={handleAddItem} icon={<Plus size={14}/>}>Add Product</Button>
               </div>
               
               {form.items.length === 0 ? (
                  <div className="text-center p-4 bg-slate-50 rounded-lg border border-dashed border-slate-300 text-slate-500 text-sm">No products added to PO.</div>
               ) : (
                  <div className="overflow-x-auto">
                     <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead>
                           <tr className="bg-slate-50 border-y border-slate-200">
                              <th className="p-2 font-semibold text-slate-600">Material</th>
                              <th className="p-2 font-semibold text-slate-600 w-24">Qty</th>
                              <th className="p-2 font-semibold text-slate-600 w-16">UoM</th>
                              <th className="p-2 font-semibold text-slate-600 w-32">Unit Price (₹)</th>
                              <th className="p-2 font-semibold text-slate-600 w-24">Tax %</th>
                              <th className="p-2 font-semibold text-slate-600 text-right">Total (₹)</th>
                              <th className="p-2"></th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                           {form.items.map((item, idx) => (
                                 <tr key={idx}>
                                    <td className="p-1">
                                       <select className={inputClass} value={item.material_code} onChange={e => updateItem(idx, 'material_code', e.target.value)}>
                                          <option value="">Select...</option>
                                          {materials.map(m => <option key={m.code} value={m.code}>{m.code} - {m.name}</option>)}
                                       </select>
                                    </td>
                                    <td className="p-1"><input type="number" className={inputClass} value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} /></td>
                                    <td className="p-1"><input className={inputClass} value={item.unit} onChange={e => updateItem(idx, 'unit', e.target.value)} /></td>
                                    <td className="p-1"><input type="number" className={inputClass} value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} /></td>
                                    <td className="p-1"><input type="number" className={inputClass} value={item.tax_amount} onChange={e => updateItem(idx, 'tax_amount', e.target.value)} /></td>
                                    <td className="p-2 text-right font-mono font-semibold text-slate-800">{item.total_amount ? Number(item.total_amount ?? 0).toLocaleString() : '-'}</td>
                                    <td className="p-1 text-center"><button onClick={() => { const ni = [...form.items]; ni.splice(idx, 1); setForm({...form, items: ni}); }} className="text-red-500 hover:text-red-700"><Trash2 size={16}/></button></td>
                                 </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               )}
               
               {form.items.length > 0 && (() => {
                  const totals = calculateTotals();
                  return (
                     <div className="flex justify-end mt-4">
                        <div className="w-64 bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm">
                           <div className="flex justify-between mb-2"><span className="text-slate-500">Subtotal</span><span className="font-mono">₹{totals.subtotal.toLocaleString()}</span></div>
                           <div className="flex justify-between mb-2 pb-2 border-b border-slate-200"><span className="text-slate-500">Estimated Tax</span><span className="font-mono">₹{totals.tax.toLocaleString()}</span></div>
                           <div className="flex justify-between font-bold text-slate-900 text-base"><span>Grand Total</span><span className="font-mono text-brand-700">₹{totals.grandTotal.toLocaleString()}</span></div>
                        </div>
                     </div>
                  );
               })()}
            </div>
         </div>
      </Modal>

      {/* VIEW / PRINT PO MODAL */}
      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={`Purchase Order: ${viewTarget?.po_number}`} size="xl" footer={
         <div className="flex gap-2 w-full justify-between items-center">
            <div>
               {viewTarget?.status === 'Issued' && (
                  <Button variant="success" icon={<Package size={16}/>} onClick={() => alert("Goods Receipt module is pending implementation. Once available, this will map the PO into a new GRN transaction.")}>
                     Create Goods Receipt
                  </Button>
               )}
               {['Partially Received', 'Received'].includes(viewTarget?.status) && (
                  <span className="text-sm font-medium text-emerald-600 flex items-center gap-1"><CheckCircle size={16}/> Goods Receiving In Progress / Completed</span>
               )}
            </div>
            <div className="flex gap-2">
               <Button variant="secondary" onClick={() => window.print()} icon={<Printer size={16}/>}>Print / PDF</Button>
               {viewTarget?.status === 'Draft' && <Button onClick={() => loadPOForEdit(viewTarget)} icon={<Edit size={16}/>}>Edit PO</Button>}
               {viewTarget?.status === 'Draft' && <Button variant="brand" onClick={() => handleIssueAction(viewTarget)} icon={<Send size={16}/>}>Issue Purchase Order</Button>}
               <Button variant="secondary" onClick={() => setViewTarget(null)}>Close</Button>
            </div>
         </div>
      }>
         {viewTarget && (
            <div className="space-y-8 bg-white p-4" id="printable-po">
               {/* Print Header */}
               <div className="flex justify-between items-start border-b-2 border-slate-800 pb-6">
                  <div>
                     <h1 className="text-3xl font-black text-slate-900 tracking-tight">PURCHASE ORDER</h1>
                     <p className="text-slate-500 mt-1 font-mono">{viewTarget.po_number}</p>
                     {isDelayed(viewTarget) && <Badge variant="error" className="mt-2">DELAYED</Badge>}
                  </div>
                  <div className="text-right text-sm">
                     <p className="font-bold text-slate-800">ARGUSCNC MFG LTD.</p>
                     <p className="text-slate-500">123 Industrial Phase, Pune</p>
                     <p className="text-slate-500">GSTIN: 27AAAAA0000A1Z5</p>
                  </div>
               </div>

               {/* Parties Info */}
               <div className="grid grid-cols-2 gap-8 text-sm">
                  <div>
                     <h3 className="font-bold text-slate-400 uppercase text-xs tracking-wider mb-2">Vendor (Supplier)</h3>
                     <p className="font-bold text-slate-800 text-base">{viewTarget.supplier?.name}</p>
                     <p className="text-slate-600">{viewTarget.supplier?.address || 'Address not provided'}</p>
                     <p className="text-slate-600 mt-2"><strong>GSTIN:</strong> {viewTarget.supplier?.gst_number || 'N/A'}</p>
                  </div>
                  <div>
                     <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div><span className="block text-xs text-slate-500 uppercase tracking-wider mb-1">PO Date</span><span className="font-medium text-slate-900">{viewTarget.order_date}</span></div>
                        <div><span className="block text-xs text-slate-500 uppercase tracking-wider mb-1">Expected By</span><span className="font-medium text-slate-900">{viewTarget.expected_date || 'TBD'}</span></div>
                        <div><span className="block text-xs text-slate-500 uppercase tracking-wider mb-1">Payment Terms</span><span className="font-medium text-slate-900">{viewTarget.payment_terms || 'N/A'}</span></div>
                        <div><span className="block text-xs text-slate-500 uppercase tracking-wider mb-1">Status</span><span className="font-medium text-slate-900">{viewTarget.status}</span></div>
                     </div>
                  </div>
               </div>

               {/* Addresses */}
               <div className="grid grid-cols-2 gap-8 text-sm pt-4 border-t border-slate-100">
                  <div>
                     <h3 className="font-bold text-slate-400 uppercase text-xs tracking-wider mb-2">Delivery Address</h3>
                     <p className="text-slate-700 whitespace-pre-wrap">{viewTarget.delivery_address}</p>
                  </div>
                  <div>
                     <h3 className="font-bold text-slate-400 uppercase text-xs tracking-wider mb-2">Billing Address</h3>
                     <p className="text-slate-700 whitespace-pre-wrap">{viewTarget.billing_address}</p>
                  </div>
               </div>

               {/* Items Table */}
               <div className="pt-4">
                  <table className="w-full text-left text-sm">
                     <thead>
                        <tr className="border-b-2 border-slate-800 text-slate-800">
                           <th className="py-2 font-bold w-12">#</th>
                           <th className="py-2 font-bold">Product & Description</th>
                           <th className="py-2 font-bold text-center">Ordered Qty</th>
                           <th className="py-2 font-bold text-center">Pending Qty</th>
                           <th className="py-2 font-bold text-right">Unit Price</th>
                           <th className="py-2 font-bold text-right">Tax %</th>
                           <th className="py-2 font-bold text-right">Total Amount</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-200">
                        {viewTarget.items?.map((item: any, idx: number) => (
                           <tr key={idx}>
                              <td className="py-3 text-slate-500">{idx + 1}</td>
                              <td className="py-3">
                                 <p className="font-bold text-slate-800">{item.material_name}</p>
                                 <p className="text-xs text-slate-500 font-mono">{item.material_code}</p>
                              </td>
                              <td className="py-3 text-center font-medium">{item.quantity} {item.unit}</td>
                              <td className="py-3 text-center text-slate-500">{item.quantity} {item.unit} <span className="text-[10px] block">(0 Received)</span></td>
                              <td className="py-3 text-right font-mono">₹{Number(item.unit_price ?? 0).toLocaleString()}</td>
                              <td className="py-3 text-right text-slate-500">{item.tax_amount}%</td>
                              <td className="py-3 text-right font-mono font-bold text-slate-900">₹{Number(item.total_amount ?? 0).toLocaleString()}</td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
               </div>

               {/* Totals */}
               <div className="flex justify-end pt-4">
                  <div className="w-72">
                     <div className="flex justify-between py-1 text-sm text-slate-600"><span>Subtotal</span><span className="font-mono text-slate-900">₹{Number(viewTarget.subtotal ?? 0).toLocaleString()}</span></div>
                     <div className="flex justify-between py-1 text-sm text-slate-600 border-b border-slate-200 mb-2 pb-2"><span>Total Tax</span><span className="font-mono text-slate-900">₹{Number(viewTarget.tax ?? 0).toLocaleString()}</span></div>
                     <div className="flex justify-between py-2 text-lg font-black text-slate-900"><span>Grand Total</span><span className="font-mono">₹{Number(viewTarget.grand_total ?? 0).toLocaleString()}</span></div>
                  </div>
               </div>
               
               {/* Notes */}
               {viewTarget.notes && (
                  <div className="pt-8 border-t border-slate-100 text-sm">
                     <h3 className="font-bold text-slate-400 uppercase text-xs tracking-wider mb-2">Terms & Notes</h3>
                     <p className="text-slate-700 whitespace-pre-wrap">{viewTarget.notes}</p>
                  </div>
               )}
               
               <div className="mt-16 pt-8 border-t border-slate-100 flex justify-between text-xs text-slate-400 uppercase tracking-widest font-bold">
                  <div>Authorized Signatory</div>
                  <div>Supplier Acceptance</div>
               </div>
            </div>
         )}
      </Modal>
    </div>
  );
}

export function GoodsReceiptPage() {
  const [grns, setGrns] = useState<any[]>([]);
  // Global date filter (receipt date) drives the stats and the table together.
  const { inRange: inGRNDateRange } = useGlobalDateFilter();
  const rangedGrns = useMemo(
    () => grns.filter((g: any) => inGRNDateRange(g.receipt_date ?? g.created_at)),
    [grns, inGRNDateRange],
  );
  const [, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [viewTarget, setViewTarget] = useState<any>(null);
  
  // Master Data
  const [pos, setPos] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  // Form State
  const resetForm = () => ({
    id: null,
    grnNo: `GRN-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
    receiptDate: new Date().toISOString().split('T')[0],
    poId: '',
    supplierChallan: '',
    supplierInvoice: '',
    supplierInvoiceDate: '',
    warehouseId: '',
    remarks: '',
    items: [] as any[]
  });
  const [form, setForm] = useState(resetForm());
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const { profile } = useAuth();

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    // 1. Fetch GRNs
    const { data: grnData } = await supabase.from('cnc_goods_receipts').select('*, supplier:cnc_suppliers(name, code), po:cnc_purchase_orders(po_number), items:cnc_goods_receipt_items(*)').order('created_at', { ascending: false });
    if (grnData) setGrns(grnData);

    // 2. Fetch POs (Only Issued or Partially Received)
    const { data: poData } = await supabase.from('cnc_purchase_orders').select('*, items:cnc_purchase_order_items(*)').in('status', ['Issued', 'Partially Received']);
    if (poData) setPos(poData);

    // 3. Fetch Warehouses & Locations
    const { data: whData } = await supabase.from('cnc_warehouses').select('*');
    if (whData) setWarehouses(whData);
    
    const { data: locData } = await supabase.from('cnc_warehouse_locations').select('*');
    if (locData) setLocations(locData);
    
    setLoading(false);
  }

  const handlePOSelect = async (e: any) => {
    const poId = e.target.value;
    const po = pos.find(p => p.id === poId);
    
    if (!po) {
       setForm({ ...form, poId: '', items: [] });
       return;
    }

    // Determine previously received quantities for this PO across all POSTED GRNs
    const { data: priorGrns } = await supabase.from('cnc_goods_receipt_items')
      .select('purchase_order_item_id, received_qty, grn:cnc_goods_receipts!inner(status, purchase_order_id)')
      .eq('grn.purchase_order_id', poId)
      .eq('grn.status', 'Posted');

    const receivedMap: Record<string, number> = {};
    if (priorGrns) {
       priorGrns.forEach((pg: any) => {
          receivedMap[pg.purchase_order_item_id] = (receivedMap[pg.purchase_order_item_id] || 0) + Number(pg.received_qty);
       });
    }

    const items = po.items.map((i: any) => {
       const previouslyReceived = receivedMap[i.id] || 0;
       const remaining = Math.max(0, Number(i.quantity) - previouslyReceived);
       return {
          purchase_order_item_id: i.id,
          raw_material_id: i.raw_material_id,
          part_id: i.part_id,
          material_code: i.material_code,
          material_name: i.material_name,
          ordered_qty: i.quantity,
          previously_received_qty: previouslyReceived,
          remaining_qty: remaining,
          received_qty: remaining > 0 ? remaining : 0, // default to receiving the rest
          unit: i.unit,
          location_id: '',
          condition: 'Accepted'
       };
    }).filter((i: any) => i.remaining_qty > 0); // Only show items that still need receiving

    setForm({
      ...form, 
      poId: poId,
      items: items
    });
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...form.items];
    
    if (field === 'received_qty') {
       const val = Number(value);
       if (val > newItems[index].remaining_qty) {
          alert('Received quantity cannot exceed the pending quantity.');
          return;
       }
    }
    
    newItems[index] = { ...newItems[index], [field]: value };
    setForm({ ...form, items: newItems });
  };

  const saveGRN = async () => {
    if (saving) return;
    if (!form.poId) return alert('Purchase Order is required');
    if (!form.warehouseId) return alert('Warehouse is required');
    if (!form.items.length) return alert('At least one product is required');

    const po = pos.find(p => p.id === form.poId);

    const grnRecord = {
       grn_number: form.grnNo,
       purchase_order_id: form.poId,
       supplier_id: po?.supplier_id,
       receipt_date: form.receiptDate,
       supplier_challan_no: form.supplierChallan,
       supplier_invoice_no: form.supplierInvoice,
       supplier_invoice_date: form.supplierInvoiceDate || null,
       warehouse_id: form.warehouseId,
       status: 'Draft',
       remarks: form.remarks,
       created_by: profile?.full_name || ''
    };

    setSaving(true);
    try {
      let grnId = form.id;
      const isNew = !grnId;
      let oldItemIds: string[] = [];

      if (grnId) {
         // Update existing Draft
         const { error: updErr } = await supabase.from('cnc_goods_receipts').update(grnRecord).eq('id', grnId);
         if (updErr) { console.error(updErr); return alert('Error updating GRN: ' + updErr.message); }
         // Old items are removed only after the new ones are saved (not a single transaction).
         const { data: oldItems, error: oldErr } = await supabase.from('cnc_goods_receipt_items').select('id').eq('goods_receipt_id', grnId);
         if (oldErr) { console.error(oldErr); return alert('Error loading existing GRN products: ' + oldErr.message); }
         oldItemIds = (oldItems || []).map((i: any) => i.id);
      } else {
         // Insert new
         const { data: insData, error: insErr } = await supabase.from('cnc_goods_receipts').insert([grnRecord]).select();
         if (insErr) { console.error(insErr); return alert('Error creating GRN: ' + insErr.message); }
         if (!insData || insData.length === 0) return alert('Error creating GRN: no record returned.');
         grnId = insData[0].id;
      }

      // Insert items
      const itemsToInsert = form.items.map(i => ({
        goods_receipt_id: grnId,
        purchase_order_item_id: i.purchase_order_item_id,
        raw_material_id: i.raw_material_id || null,
        part_id: i.part_id || null,
        material_code: i.material_code,
        material_name: i.material_name,
        ordered_qty: i.ordered_qty,
        received_qty: Number(i.received_qty) || 0,
        unit: i.unit,
        location_id: i.location_id || null,
        condition: i.condition
      }));

      const { error: itemsErr } = await supabase.from('cnc_goods_receipt_items').insert(itemsToInsert);
      if (itemsErr) {
         console.error(itemsErr);
         if (isNew) {
            const { error: cleanupError } = await supabase.from('cnc_goods_receipts').delete().eq('id', grnId);
            if (cleanupError) console.error('Failed to roll back GRN header:', cleanupError);
         }
         return alert('Error saving GRN products: ' + itemsErr.message);
      }

      if (oldItemIds.length > 0) {
         const { error: delErr } = await supabase.from('cnc_goods_receipt_items').delete().in('id', oldItemIds);
         if (delErr) { console.error(delErr); alert('GRN saved, but old line products could not be removed (they may appear duplicated): ' + delErr.message); }
      }

      setShowAdd(false);
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const handlePost = async (grn: any) => {
     if (posting) return;
     if (!confirm("Are you sure you want to POST this GRN? This will permanently update stock quantities and create stock movements. This action is atomic.")) return;

     setPosting(true);
     try {
        const { error } = await supabase.rpc('post_goods_receipt', { p_grn_id: grn.id, p_user: profile?.full_name || 'Current User' });
        if (error) throw error;
        alert("GRN Posted successfully! Inventory updated.");
     } catch (err: any) {
        console.error(err);
        alert("Error posting GRN: " + (err.message || "Unknown error"));
     } finally {
        setPosting(false);
     }

     fetchData();
     setViewTarget(null);
  };

  const columns: Column<any>[] = [
    { key: 'grn_number', label: 'GRN No', sortable: true, render: (r) => <span className="font-mono text-xs font-semibold text-brand-700">{r.grn_number}</span> },
    { key: 'po_number', label: 'PO No', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.po?.po_number}</span> },
    { key: 'supplier', label: 'Supplier', sortable: true, render: (r) => <span className="font-medium text-slate-800">{r.supplier?.name}</span> },
    { key: 'receipt_date', label: 'Receipt Date', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.receipt_date}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => (
       <Badge variant={r.status === 'Posted' ? 'success' : r.status === 'Draft' ? 'neutral' : 'warning'} dot>{r.status}</Badge>
    )},
    { key: 'actions', label: 'Actions', align: 'center', render: (r) => (
       <div className="flex gap-1 justify-center">
         <Button variant="secondary" size="sm" onClick={() => setViewTarget(r)} icon={<Eye size={14} />}>View</Button>
       </div>
    ) }
  ];

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader 
         title="Goods Receipt (GRN)" 
         description="Record physical material receipts against Supplier Purchase Orders" 
         actions={<Button onClick={() => { setForm(resetForm()); setShowAdd(true); }} icon={<Plus size={16}/>}>New Goods Receipt</Button>} 
      />
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total GRNs" value={rangedGrns.length.toString()} icon={<Package size={20} />} accent="brand" />
        <StatCard label="Draft" value={rangedGrns.filter(g => g.status === 'Draft').length.toString()} icon={<FileText size={20} />} accent="neutral" />
        <StatCard label="Posted" value={rangedGrns.filter(g => g.status === 'Posted').length.toString()} icon={<CheckCircle size={20} />} accent="success" />
        <StatCard label="This Month" value={rangedGrns.filter(g => (g.receipt_date || '').startsWith(new Date().toISOString().substring(0, 7))).length.toString()} icon={<TrendingUp size={20} />} accent="brand" />
      </div>
      
      <Card>
         <DataTable data={rangedGrns} columns={columns} searchKeys={['grn_number', 'supplier.name', 'po.po_number']} />
      </Card>

      {/* CREATE / EDIT GRN MODAL */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Goods Receipt" subtitle="Supplier Delivery" size="xl" footer={<>
         <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
         <Button disabled={saving} onClick={() => saveGRN()} icon={<CheckCircle size={16}/>}>Save Draft</Button>
      </>}>
         <div className="space-y-3">
            <div className="grid grid-cols-3 gap-4">
               <FormField label="GRN Number" required><input className={inputClass} value={form.grnNo} disabled /></FormField>
               <FormField label="Receipt Date" required><input type="date" className={inputClass} value={form.receiptDate} onChange={e => setForm({...form, receiptDate: e.target.value})} /></FormField>
               
               <div className="space-y-1">
                 <label className="text-xs font-medium text-slate-700">Purchase Order *</label>
                 <select className={inputClass} value={form.poId} onChange={handlePOSelect}>
                    <option value="">-- Select PO --</option>
                    {pos.map(p => <option key={p.id} value={p.id}>{p.po_number}</option>)}
                 </select>
               </div>
               
               <div className="space-y-1">
                 <label className="text-xs font-medium text-slate-700">Destination Warehouse *</label>
                 <select className={inputClass} value={form.warehouseId} onChange={e => setForm({...form, warehouseId: e.target.value})}>
                    <option value="">-- Select Warehouse --</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                 </select>
               </div>

               <FormField label="Supplier Challan No"><input className={inputClass} value={form.supplierChallan} onChange={e => setForm({...form, supplierChallan: e.target.value})} /></FormField>
               <FormField label="Supplier Invoice No"><input className={inputClass} value={form.supplierInvoice} onChange={e => setForm({...form, supplierInvoice: e.target.value})} /></FormField>
               <FormField label="Supplier Invoice Date"><input type="date" className={inputClass} value={form.supplierInvoiceDate} onChange={e => setForm({...form, supplierInvoiceDate: e.target.value})} /></FormField>
               
               <div className="col-span-2">
                 <FormField label="Remarks"><input className={inputClass} value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></FormField>
               </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
               <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-bold text-slate-800">Received Products</h4>
               </div>
               
               {form.items.length === 0 ? (
                  <div className="text-center p-4 bg-slate-50 rounded-lg border border-dashed border-slate-300 text-slate-500 text-sm">Select a Purchase Order to load pending products.</div>
               ) : (
                  <div className="overflow-x-auto">
                     <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead>
                           <tr className="bg-slate-50 border-y border-slate-200">
                              <th className="p-2 font-semibold text-slate-600">Material</th>
                              <th className="p-2 font-semibold text-slate-600">Ordered</th>
                              <th className="p-2 font-semibold text-slate-600">Pending</th>
                              <th className="p-2 font-bold text-brand-700 w-32">Received Now *</th>
                              <th className="p-2 font-semibold text-slate-600">Location</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                           {form.items.map((item, idx) => (
                                 <tr key={idx}>
                                    <td className="p-2">
                                       <span className="block font-medium text-slate-800">{item.material_name}</span>
                                       <span className="block text-xs text-slate-500 font-mono">{item.material_code}</span>
                                    </td>
                                    <td className="p-2">{item.ordered_qty} {item.unit}</td>
                                    <td className="p-2 text-red-600 font-medium">{item.remaining_qty} {item.unit}</td>
                                    <td className="p-2">
                                       <div className="flex items-center gap-1">
                                          <input type="number" className={inputClass} value={item.received_qty} onChange={e => updateItem(idx, 'received_qty', e.target.value)} max={item.remaining_qty} />
                                          <span className="text-xs text-slate-500">{item.unit}</span>
                                       </div>
                                    </td>
                                    <td className="p-2">
                                       <select className={inputClass} value={item.location_id} onChange={e => updateItem(idx, 'location_id', e.target.value)}>
                                          <option value="">- Bin/Location -</option>
                                          {locations.map(l => <option key={l.id} value={l.id}>{l.code}</option>)}
                                       </select>
                                    </td>
                                 </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               )}
            </div>
         </div>
      </Modal>

      {/* VIEW / POST GRN MODAL */}
      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={`Goods Receipt: ${viewTarget?.grn_number}`} size="xl" footer={
         <div className="flex gap-2 w-full justify-between items-center">
            <div>
               {viewTarget?.status === 'Posted' && (
                  <span className="text-sm font-medium text-emerald-600 flex items-center gap-1"><CheckCircle size={16}/> Stock Updated</span>
               )}
            </div>
            <div className="flex gap-2">
               <Button variant="secondary" onClick={() => window.print()} icon={<Printer size={16}/>}>Print / PDF</Button>
               {viewTarget?.status === 'Draft' && <Button variant="brand" disabled={posting} onClick={() => handlePost(viewTarget)} icon={<CheckCircle size={16}/>}>Post to Inventory</Button>}
               <Button variant="secondary" onClick={() => setViewTarget(null)}>Close</Button>
            </div>
         </div>
      }>
         {viewTarget && (
            <div className="space-y-8 bg-white p-4" id="printable-po">
               {/* Print Header */}
               <div className="flex justify-between items-start border-b-2 border-slate-800 pb-6">
                  <div>
                     <h1 className="text-3xl font-black text-slate-900 tracking-tight">GOODS RECEIPT</h1>
                     <p className="text-slate-500 mt-1 font-mono">{viewTarget.grn_number}</p>
                  </div>
                  <div className="text-right text-sm">
                     <p className="font-bold text-slate-800">ARGUSCNC MFG LTD.</p>
                     <p className="text-slate-500">123 Industrial Phase, Pune</p>
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-8 text-sm">
                  <div>
                     <h3 className="font-bold text-slate-400 uppercase text-xs tracking-wider mb-2">Supplier</h3>
                     <p className="font-bold text-slate-800 text-base">{viewTarget.supplier?.name}</p>
                     <p className="text-slate-600 mt-1"><strong>PO Ref:</strong> <span className="font-mono">{viewTarget.po?.po_number}</span></p>
                  </div>
                  <div>
                     <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div><span className="block text-xs text-slate-500 uppercase tracking-wider mb-1">Receipt Date</span><span className="font-medium text-slate-900">{viewTarget.receipt_date}</span></div>
                        <div><span className="block text-xs text-slate-500 uppercase tracking-wider mb-1">Status</span><span className="font-medium text-slate-900">{viewTarget.status}</span></div>
                        <div><span className="block text-xs text-slate-500 uppercase tracking-wider mb-1">Challan No</span><span className="font-medium text-slate-900">{viewTarget.supplier_challan_no || '-'}</span></div>
                        <div><span className="block text-xs text-slate-500 uppercase tracking-wider mb-1">Invoice No</span><span className="font-medium text-slate-900">{viewTarget.supplier_invoice_no || '-'}</span></div>
                     </div>
                  </div>
               </div>

               {/* Items Table */}
               <div className="pt-4">
                  <table className="w-full text-left text-sm">
                     <thead>
                        <tr className="border-b-2 border-slate-800 text-slate-800">
                           <th className="py-2 font-bold w-12">#</th>
                           <th className="py-2 font-bold">Material / Code</th>
                           <th className="py-2 font-bold text-center">Ordered</th>
                           <th className="py-2 font-bold text-center">Received Now</th>
                           <th className="py-2 font-bold">Location</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-200">
                        {viewTarget.items?.map((item: any, idx: number) => {
                           const loc = locations.find(l => l.id === item.location_id);
                           return (
                           <tr key={idx}>
                              <td className="py-3 text-slate-500">{idx + 1}</td>
                              <td className="py-3">
                                 <p className="font-bold text-slate-800">{item.material_name}</p>
                                 <p className="text-xs text-slate-500 font-mono">{item.material_code}</p>
                              </td>
                              <td className="py-3 text-center">{item.ordered_qty} {item.unit}</td>
                              <td className="py-3 text-center font-bold text-slate-900">{item.received_qty} {item.unit}</td>
                              <td className="py-3 text-slate-600">{loc ? loc.code : 'Unassigned'}</td>
                           </tr>
                           )
                        })}
                     </tbody>
                  </table>
               </div>
               
               {viewTarget.status === 'Posted' && (
                  <div className="mt-8 bg-emerald-50 text-emerald-800 p-4 rounded-lg border border-emerald-200 text-sm flex gap-3 items-center">
                     <CheckCircle size={24} />
                     <div>
                        <strong>Stock Updated Successfully</strong>
                        <p className="text-emerald-700 opacity-80 mt-1">This Goods Receipt was permanently posted. Stock movements have been generated and inventory values have been increased.</p>
                     </div>
                  </div>
               )}
            </div>
         )}
      </Modal>
    </div>
  );
}

export function SupplierPerformancePage() {
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<string>('');
  const [kpiFilter, setKpiFilter] = useState<string>('All');

  const [allData, setAllData] = useState<any[]>([]);
  // Global date filter (PO order-date cohort).
  const { inRange: inPerfDateRange } = useGlobalDateFilter();
  const rangedData = useMemo(
    () => allData.filter((d: any) => inPerfDateRange(d.order_date ?? d.created_at)),
    [allData, inPerfDateRange],
  );
  
  const [viewTarget, setViewTarget] = useState<any>(null); // For viewing PO details

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    
    // Fetch Suppliers
    const { data: supData } = await supabase.from('cnc_suppliers').select('id, name, code').order('name');
    if (supData) setSuppliers(supData);

    // Fetch POs
    const { data: poData } = await supabase.from('cnc_purchase_orders').select('*, supplier:cnc_suppliers(name), items:cnc_purchase_order_items(*)');
    // Fetch GRNs (only Posted)
    const { data: grnData } = await supabase.from('cnc_goods_receipts').select('id, purchase_order_id, receipt_date, status').eq('status', 'Posted');

    if (poData && grnData) {
      const todayStr = new Date().toISOString().split('T')[0];
      
      const processed = poData.map(po => {
         let finalReceiptDate = null;
         if (po.status === 'Received') {
            const grns = grnData.filter(g => g.purchase_order_id === po.id && g.receipt_date);
            if (grns.length > 0) {
               // Latest receipt date = the date the PO was fully received
               grns.sort((a,b) => new Date(b.receipt_date).getTime() - new Date(a.receipt_date).getTime());
               finalReceiptDate = grns[0].receipt_date;
            }
         }

         let condition = '';
         let delayDays = null;

         if (['Draft', 'Cancelled'].includes(po.status)) {
            condition = po.status;
         } else if (po.status === 'Received') {
            if (finalReceiptDate && po.expected_date) {
               if (finalReceiptDate <= po.expected_date) {
                  condition = 'On Time';
               } else {
                  condition = 'Delivered Late';
                  delayDays = Math.ceil((new Date(finalReceiptDate).getTime() - new Date(po.expected_date).getTime()) / (1000 * 60 * 60 * 24));
               }
            } else {
               condition = 'Received (Missing Dates)';
            }
         } else if (['Issued', 'Partially Received'].includes(po.status)) {
            if (po.expected_date && po.expected_date < todayStr) {
               condition = 'Overdue / Pending Receipt';
            } else {
               condition = 'Pending Receipt';
            }
         }

         return {
            ...po,
            final_receipt_date: finalReceiptDate,
            condition,
            delayDays
         };
      });
      
      setAllData(processed);
    }
    setLoading(false);
  }

  // Derived Data for UI
  const supplierData = selectedSupplier ? rangedData.filter(d => d.supplier_id === selectedSupplier) : rangedData;
  
  // Calculate Summaries
  let totalValue = 0;
  let openCount = 0;
  let overdueCount = 0;
  let evaluableCount = 0;
  let onTimeCount = 0;

  supplierData.forEach(po => {
     if (['Issued', 'Partially Received', 'Received'].includes(po.status)) {
        totalValue += Number(po.grand_total || 0);
     }
     if (['Issued', 'Partially Received'].includes(po.status)) openCount++;
     if (po.condition === 'Overdue / Pending Receipt') overdueCount++;
     if (po.status === 'Received' && po.expected_date && po.final_receipt_date) {
        evaluableCount++;
        if (po.condition === 'On Time') onTimeCount++;
     }
  });

  const onTimePercent = evaluableCount > 0 ? Math.round((onTimeCount / evaluableCount) * 100) : null;

  // Apply KPI Filter
  const displayData = supplierData.filter(po => {
     if (kpiFilter === 'All') return true;
     if (kpiFilter === 'Open') return ['Issued', 'Partially Received'].includes(po.status);
     if (kpiFilter === 'Overdue') return po.condition === 'Overdue / Pending Receipt';
     if (kpiFilter === 'OnTime') return po.condition === 'On Time';
     if (kpiFilter === 'Late') return po.condition === 'Delivered Late';
     return true;
  });

  const columns: Column<any>[] = [
    { key: 'po_number', label: 'PO No', sortable: true, render: (r) => <span className="font-mono text-xs font-semibold text-brand-700">{r.po_number}</span> },
    { key: 'supplier', label: 'Supplier', sortable: true, render: (r) => <span className="font-medium text-slate-800">{r.supplier?.name}</span> },
    { key: 'dates', label: 'Dates', render: (r) => (
       <div className="text-xs text-slate-500">
         <div>Expected: {r.expected_date || 'N/A'}</div>
         <div>Final Receipt: {r.final_receipt_date || '-'}</div>
       </div>
    )},
    { key: 'grand_total', label: 'Value', align: 'right', sortable: true, render: (r) => <span className="font-mono text-sm">₹{Number(r.grand_total ?? 0).toLocaleString()}</span> },
    { key: 'performance', label: 'Delivery Performance', sortable: true, render: (r) => {
       if (r.condition === 'On Time') return <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">On Time</span>;
       if (r.condition === 'Delivered Late') return <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded">Late ({r.delayDays}d)</span>;
       if (r.condition === 'Overdue / Pending Receipt') return <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded flex items-center gap-1 w-max"><AlertCircle size={12}/> Overdue</span>;
       if (r.condition === 'Pending Receipt') return <span className="text-xs text-slate-500">Pending</span>;
       return <span className="text-xs text-slate-400">{r.condition}</span>;
    }},
    { key: 'status', label: 'Status', sortable: true, render: (r) => (
       <Badge variant={r.status === 'Issued' ? 'brand' : r.status === 'Received' ? 'success' : r.status === 'Partially Received' ? 'warning' : 'neutral'} dot>{r.status}</Badge>
    )},
    { key: 'actions', label: 'Actions', align: 'center', render: (r) => (
       <Button variant="secondary" size="sm" onClick={() => setViewTarget(r)} icon={<Eye size={14} />}>View</Button>
    ) }
  ];

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
         <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Supplier Performance</h1>
            <p className="text-slate-500 mt-1">Real-time analytics based on verifiable Purchase Order and GRN history</p>
         </div>
         <div className="flex gap-2">
            <select className={inputClass} value={selectedSupplier} onChange={e => { setSelectedSupplier(e.target.value); setKpiFilter('All'); }}>
               <option value="">All Suppliers</option>
               {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
         </div>
      </div>
      
      {loading ? (
         <div className="flex justify-center py-12"><Activity className="animate-spin text-brand-500" /></div>
      ) : allData.length === 0 ? (
         <div className="text-center p-12 bg-white rounded-xl border border-dashed border-slate-300">
            <h3 className="text-lg font-bold text-slate-800 mb-2">No Performance History</h3>
            <p className="text-slate-500">Performance metrics will become available after purchase and receiving transactions are recorded.</p>
         </div>
      ) : (
         <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
              <div onClick={() => setKpiFilter('All')} className={`cursor-pointer transition-transform hover:scale-105 ${kpiFilter === 'All' ? 'ring-2 ring-brand-500 rounded-xl' : ''}`}>
                 <StatCard label="Total Purchase Value" value={`₹${totalValue.toLocaleString()}`} icon={<TrendingUp size={20} />} accent="brand" />
              </div>
              
              <div onClick={() => setKpiFilter('Open')} className={`cursor-pointer transition-transform hover:scale-105 ${kpiFilter === 'Open' ? 'ring-2 ring-brand-500 rounded-xl' : ''}`}>
                 <StatCard label="Open Orders" value={openCount.toString()} icon={<ShoppingCart size={20} />} accent="brand" />
              </div>

              <div onClick={() => setKpiFilter('Overdue')} className={`cursor-pointer transition-transform hover:scale-105 ${kpiFilter === 'Overdue' ? 'ring-2 ring-red-500 rounded-xl' : ''}`}>
                 <StatCard label="Overdue Pending" value={overdueCount.toString()} icon={<AlertCircle size={20} />} accent="error" />
              </div>

              <div onClick={() => setKpiFilter('All')} className="cursor-pointer transition-transform hover:scale-105">
                 <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex justify-between items-start mb-2">
                       <span className="text-sm font-medium text-slate-500">On-Time Delivery</span>
                       <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600"><CheckCircle size={20}/></div>
                    </div>
                    <div className="text-2xl font-black text-slate-800">
                       {onTimePercent !== null ? `${onTimePercent}%` : 'N/A'}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 font-medium">
                       {evaluableCount > 0 ? `${onTimeCount} of ${evaluableCount} completed POs` : 'Insufficient delivery data'}
                    </div>
                 </div>
              </div>

              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                 <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-medium text-slate-500">Quality / Rejections</span>
                    <div className="p-2 bg-slate-50 rounded-lg text-slate-400"><Activity size={20}/></div>
                 </div>
                 <div className="text-xl font-bold text-slate-700 mt-1">N/A</div>
                 <div className="text-xs text-slate-500 mt-2 font-medium">QC Module Pending</div>
              </div>
            </div>
            
            <Card>
               <div className="px-4 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
                  <h3 className="font-bold text-slate-800">
                     {kpiFilter === 'All' ? 'All Transaction History' : 
                      kpiFilter === 'Open' ? 'Active / Open Orders' :
                      kpiFilter === 'Overdue' ? 'Overdue Deliveries' :
                      kpiFilter === 'OnTime' ? 'On-Time Deliveries' :
                      kpiFilter === 'Late' ? 'Late Deliveries' : ''}
                  </h3>
                  {kpiFilter !== 'All' && (
                     <Button variant="secondary" size="sm" onClick={() => setKpiFilter('All')}>Clear Filter</Button>
                  )}
               </div>
               <DataTable data={displayData} columns={columns} searchKeys={['po_number', 'supplier.name']} />
            </Card>
         </>
      )}

      {/* MINIMAL VIEW MODAL FOR AUDIT */}
      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={`Performance Drill-down: ${viewTarget?.po_number}`} size="lg" footer={<Button onClick={() => setViewTarget(null)}>Close</Button>}>
         {viewTarget && (
            <div className="space-y-4 text-sm">
               <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <div><span className="block text-slate-500">Supplier</span><span className="font-bold">{viewTarget.supplier?.name}</span></div>
                  <div><span className="block text-slate-500">Status</span><Badge variant="neutral">{viewTarget.status}</Badge></div>
                  <div><span className="block text-slate-500">Order Date</span><span className="font-medium">{viewTarget.order_date}</span></div>
                  <div><span className="block text-slate-500">Expected Date</span><span className="font-medium">{viewTarget.expected_date || 'N/A'}</span></div>
               </div>

               <div className="bg-white p-4 rounded-lg border border-slate-200">
                  <h4 className="font-bold text-slate-800 mb-2 border-b pb-2">Calculation Logic</h4>
                  <div className="space-y-2">
                     <div className="flex justify-between border-b border-dashed border-slate-100 pb-1">
                        <span className="text-slate-500">Final Receipt Date (Last GRN)</span>
                        <span className="font-mono text-slate-800 font-medium">{viewTarget.final_receipt_date || 'Not fully received'}</span>
                     </div>
                     <div className="flex justify-between border-b border-dashed border-slate-100 pb-1">
                        <span className="text-slate-500">Calculated Condition</span>
                        <span className="font-bold text-brand-700">{viewTarget.condition}</span>
                     </div>
                     {viewTarget.delayDays !== null && (
                        <div className="flex justify-between border-b border-dashed border-slate-100 pb-1">
                           <span className="text-slate-500">Calculated Delay</span>
                           <span className="font-bold text-orange-600">{viewTarget.delayDays} days</span>
                        </div>
                     )}
                     <div className="flex justify-between pt-1">
                        <span className="text-slate-500">Grand Total Included in Value</span>
                        <span className="font-mono text-slate-800 font-bold">₹{Number(viewTarget.grand_total ?? 0).toLocaleString()}</span>
                     </div>
                  </div>
               </div>
            </div>
         )}
      </Modal>
    </div>
  );
}

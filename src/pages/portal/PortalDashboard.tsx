import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Cpu, Plus, FileText, Clock, CheckCircle2, Package, Truck, LogOut, Eye, AlertCircle } from 'lucide-react';

// ── Status mapping: ERP internal → customer-facing ──
const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  // Enquiry statuses
  'New':            { label: 'Enquiry Received', color: 'bg-blue-100 text-blue-700', icon: FileText },
  'Contacted':      { label: 'Under Review', color: 'bg-blue-100 text-blue-700', icon: Clock },
  'Qualified':      { label: 'Under Technical Review', color: 'bg-indigo-100 text-indigo-700', icon: Clock },
  'Under Review':   { label: 'Under Technical Review', color: 'bg-indigo-100 text-indigo-700', icon: Clock },
  'Quoted':         { label: 'Quotation Prepared', color: 'bg-purple-100 text-purple-700', icon: FileText },
  'Converted':      { label: 'Converted to Company', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  'Lost':           { label: 'Enquiry Closed', color: 'bg-red-100 text-red-700', icon: AlertCircle },
  // Quotation statuses
  'Draft':          { label: 'Being Prepared', color: 'bg-slate-100 text-slate-700', icon: Clock },
  'Sent':           { label: 'Quotation Ready', color: 'bg-amber-100 text-amber-700', icon: FileText },
  'Accepted':       { label: 'Accepted', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  'Rejected':       { label: 'Not Accepted', color: 'bg-red-100 text-red-700', icon: AlertCircle },
  // Sales Order statuses
  'Confirmed':      { label: 'Order Confirmed', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  'In Production':  { label: 'In Manufacturing', color: 'bg-amber-100 text-amber-700', icon: Package },
  'Partially Delivered': { label: 'Partially Shipped', color: 'bg-cyan-100 text-cyan-700', icon: Truck },
  'Delivered':      { label: 'Fulfilled', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  // Work Order statuses
  'Planning':       { label: 'Production Planning', color: 'bg-slate-100 text-slate-700', icon: Clock },
  'In Progress':    { label: 'Manufacturing In Progress', color: 'bg-amber-100 text-amber-700', icon: Package },
  'Completed':      { label: 'Manufacturing Complete', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  // Delivery statuses
  'Scheduled':      { label: 'Delivery Scheduled', color: 'bg-blue-100 text-blue-700', icon: Truck },
  'In Transit':     { label: 'Out for Delivery', color: 'bg-cyan-100 text-cyan-700', icon: Truck },
  'Failed':         { label: 'Delivery Issue', color: 'bg-red-100 text-red-700', icon: AlertCircle },
};

function getCustomerStatus(status: string) {
  return STATUS_MAP[status] || { label: status, color: 'bg-slate-100 text-slate-600', icon: Clock };
}

// ── Profile Setup ──
function ProfileSetup({ session, onComplete }: { session: any; onComplete: () => void }) {
  const [form, setForm] = useState({
    company_name: '', contacts: [{ name: session.user.user_metadata?.full_name || '', phone: '' }],
    gst: '', address: '', city: '', state: '', country: 'India', pincode: '', enquiring_for: ''
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.company_name) return;
    setSaving(true);
    const { data: profile, error } = await supabase.from('portal_profiles').insert([{
      auth_user_id: session.user.id,
      email: session.user.email,
      company_name: form.company_name,
      contact_name: form.contacts.map((c: any) => c.name).join(' | '),
      phone: form.contacts.map((c: any) => c.phone).join(' | '),
      gst: form.gst,
      city: form.city,
      enquiring_for: form.enquiring_for,
    }]).select().single();
    if (error) { alert('Error: ' + error.message); setSaving(false); return; }

    const leadNo = `${Math.floor(1000 + Math.random() * 9000)}`;
    const { error: leadError } = await supabase.from('cnc_enquiries').insert([{
      id: crypto.randomUUID(),
      enquiry_no: leadNo,
      lead_no: leadNo,
      customer: form.company_name,
      contact_person: form.contacts.map((c: any) => c.name).join(' | '),
      phone: form.contacts.map((c: any) => c.phone).join(' | '),
      email: session.user.email,
      city: form.city,
      gst: form.gst,
      enquiring_for: form.enquiring_for,
      part_name: form.enquiring_for || 'Company Profile',
      part_no: 'N/A',
      quantity: 0,
      estimated_value: 0,
      expected_date: new Date().toISOString().split('T')[0],
      received_date: new Date().toISOString().split('T')[0],
      source: 'Customer Portal',
      status: 'New',
      pipeline_stage: null,
      portal_profile_id: profile.id
    }]);
    if (leadError) console.error('Could not create the profile lead:', leadError);

    onComplete();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 w-full max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-xl flex items-center justify-center">
            <Cpu size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">Company Profile Setup</h2>
            <p className="text-xs text-slate-500">Complete your profile to start submitting enquiries</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Company Name *</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.company_name} onChange={e => setForm({...form, company_name: e.target.value})} />
          </div>
          <div className="col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-500 uppercase">Contact Persons</label>
              <button onClick={() => setForm({...form, contacts: [...form.contacts, { name: '', phone: '' }]})} className="text-xs text-blue-600 font-bold flex items-center gap-1">+ Add Contact</button>
            </div>
            {form.contacts.map((c: any, i: number) => (
              <div key={i} className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <input placeholder="Name" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={c.name} onChange={e => { const nc = [...form.contacts]; nc[i].name = e.target.value; setForm({...form, contacts: nc}); }} />
                <input placeholder="Phone" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={c.phone} onChange={e => { const nc = [...form.contacts]; nc[i].phone = e.target.value; setForm({...form, contacts: nc}); }} />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">City</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.city} onChange={e => setForm({...form, city: e.target.value})} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">GST No.</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.gst} onChange={e => setForm({...form, gst: e.target.value})} placeholder="e.g. 29ABCDE1234F1Z5" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Enquiring For</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.enquiring_for} onChange={e => setForm({...form, enquiring_for: e.target.value})} placeholder="What kind of manufacturing services are you looking for?" />
          </div>
        </div>
        <button onClick={handleSave} disabled={saving} className="w-full mt-6 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-semibold py-3 rounded-xl hover:shadow-lg hover:shadow-blue-200 transition-all disabled:opacity-50">
          {saving ? 'Saving...' : 'Complete Setup'}
        </button>
      </div>
    </div>
  );
}

// ── New Enquiry Form ──
function NewEnquiryForm({ profile, onClose, onSaved }: { profile: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    partName: '', partNumber: '', quantity: '', material: '', description: '', expectedDate: '', remarks: ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.partName || !form.quantity) return;
    setSaving(true);
    const enquiryNo = `${Math.floor(1000 + Math.random() * 9000)}`;
    const { error } = await supabase.from('cnc_enquiries').insert([{
      id: crypto.randomUUID(),
      enquiry_no: enquiryNo,
      lead_no: enquiryNo,
      customer: profile.company_name,
      contact_person: profile.contact_name,
      phone: profile.phone || '',
      email: profile.email,
      part_name: form.partName,
      part_no: form.partNumber || 'N/A',
      quantity: Number(form.quantity) || 0,
      material: form.material || null,
      description: form.description || null,
      estimated_value: 0,
      expected_date: form.expectedDate || null,
      received_date: new Date().toISOString().split('T')[0],
      source: 'Customer Portal',
      status: 'New',
      pipeline_stage: 'Enquiry',
      portal_profile_id: profile.id,
    }]);
    if (error) { alert('Error: ' + error.message); setSaving(false); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">Submit New Enquiry</h3>
          <p className="text-sm text-slate-500">Enquiry will be submitted to arguscnc for review</p>
        </div>
        <div className="p-4 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Part Name *</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.partName} onChange={e => setForm({...form, partName: e.target.value})} placeholder="e.g. Turbine Bracket" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Quantity *</label>
            <input type="number" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Material</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.material} onChange={e => setForm({...form, material: e.target.value})} placeholder="e.g. SS 304, Aluminium 6061" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Required Date</label>
            <input type="date" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.expectedDate} onChange={e => setForm({...form, expectedDate: e.target.value})} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description / Remarks</label>
            <textarea rows={3} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Specifications, tolerances, special instructions..." />
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">{saving ? 'Submitting...' : 'Submit Enquiry'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Enquiry Detail / Timeline ──
function EnquiryDetail({ enquiry, onClose }: { enquiry: any; onClose: () => void }) {
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    buildTimeline();
  }, [enquiry]);

  const buildTimeline = async () => {
    setLoading(true);
    const steps: any[] = [];

    // Step 1: Enquiry
    steps.push({ stage: 'Enquiry', status: enquiry.status, date: enquiry.received_date || enquiry.created_at, data: enquiry });

    // Step 2: Quotation (if exists)
    const { data: quotes } = await supabase.from('cnc_quotations').select('*').eq('lead_id', enquiry.id);
    if (quotes && quotes.length > 0) {
      const q = quotes[0];
      steps.push({ stage: 'Quotation', status: q.status, date: q.date || q.created_at, data: q });

      // Step 3: Sales Order (if exists)
      const { data: orders } = await supabase.from('cnc_sales_orders').select('*').eq('quotation_id', q.id);
      if (orders && orders.length > 0) {
        const o = orders[0];
        steps.push({ stage: 'Sales Order', status: o.status, date: o.order_date || o.created_at, data: o });

        // Step 4: Work Order (if exists)
        const { data: wos } = await supabase.from('cnc_work_orders').select('*').eq('sales_order', o.order_no);
        if (wos && wos.length > 0) {
          steps.push({ stage: 'Work Order', status: wos[0].status, date: wos[0].created_at, data: wos[0] });
        }

        // Step 5: Delivery (if exists)
        const { data: dels } = await supabase.from('cnc_deliveries').select('*').eq('sales_order_id', o.id);
        if (dels && dels.length > 0) {
          steps.push({ stage: 'Delivery', status: dels[0].status, date: dels[0].created_at, data: dels[0] });
        }
      }
    }

    setTimeline(steps);
    setLoading(false);
  };

  const cs = getCustomerStatus(enquiry.status);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800">{enquiry.lead_no || enquiry.enquiry_no}</h3>
            <p className="text-sm text-slate-500">{enquiry.part_name} &middot; Qty: {enquiry.quantity}</p>
          </div>
          <span className={"px-3 py-1 rounded-full text-xs font-semibold " + cs.color}>{cs.label}</span>
        </div>

        <div className="p-4">
          <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4">Order Progress</h4>
          {loading ? (
            <p className="text-sm text-slate-400">Loading timeline...</p>
          ) : (
            <div className="relative pl-8">
              {timeline.map((step, i) => {
                const s = getCustomerStatus(step.status);
                const isLast = i === timeline.length - 1;
                const Icon = s.icon;
                return (
                  <div key={i} className="relative pb-8 last:pb-0">
                    {!isLast && <div className="absolute left-[-20px] top-8 w-0.5 h-full bg-slate-200" />}
                    <div className="absolute left-[-28px] top-1 w-6 h-6 rounded-full bg-white border-2 border-blue-500 flex items-center justify-center">
                      <Icon size={12} className="text-blue-600" />
                    </div>
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-slate-700">{step.stage}</span>
                        <span className={"px-2 py-0.5 rounded-full text-[10px] font-semibold " + s.color}>{s.label}</span>
                      </div>
                      <p className="text-xs text-slate-400">{step.date ? new Date(step.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</p>
                      {step.stage === 'Quotation' && step.data.total_value && (
                        <p className="text-xs text-slate-600 mt-1">Value: Rs. {Number(step.data.total_value).toLocaleString('en-IN')}</p>
                      )}
                      {step.stage === 'Sales Order' && step.data.delivery_date && (
                        <p className="text-xs text-slate-600 mt-1">Expected Delivery: {new Date(step.data.delivery_date).toLocaleDateString('en-IN')}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ──
export function PortalDashboard({ session }: { session: any }) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [enquiries, setEnquiries] = useState<any[]>([]);
  const [showNewEnquiry, setShowNewEnquiry] = useState(false);
  const [selectedEnquiry, setSelectedEnquiry] = useState<any>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('portal_profiles').select('*').eq('auth_user_id', session.user.id).maybeSingle();
    if (error) console.error('Could not load portal profile:', error);
    if (data) {
      setProfile(data);
      await loadEnquiries(data.id);
    }
    setLoading(false);
  };

  const loadEnquiries = async (profileId: string) => {
    const { data } = await supabase.from('cnc_enquiries').select('*').eq('portal_profile_id', profileId).order('created_at', { ascending: false });
    // Only show actual enquiries in the portal, hide the initial 'Profile Lead'
    setEnquiries((data || []).filter(e => e.pipeline_stage !== null));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!profile) {
    return <ProfileSetup session={session} onComplete={loadProfile} />;
  }

  const activeEnquiries = enquiries.filter(e => !['Lost', 'Converted'].includes(e.status));
  const quotedEnquiries = enquiries.filter(e => e.status === 'Quoted');

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Nav */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center">
              <Cpu size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800">ARGUSCNC</h1>
              <p className="text-[9px] text-blue-600 tracking-widest uppercase -mt-0.5">Customer Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-slate-700">{profile.company_name}</p>
              <p className="text-xs text-slate-400">{session.user.email}</p>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Sign Out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Welcome */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Welcome, {profile.contact_name}</h2>
            <p className="text-slate-500 text-sm">Manage your enquiries and track order progress</p>
          </div>
          <button onClick={() => setShowNewEnquiry(true)} className="flex items-center gap-2 bg-blue-600 text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-700 transition-colors shadow-md shadow-blue-200">
            <Plus size={18} /> New Enquiry
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <p className="text-xs font-bold text-slate-500 uppercase mb-1">Total Enquiries</p>
            <p className="text-2xl font-bold text-slate-800">{enquiries.length}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <p className="text-xs font-bold text-slate-500 uppercase mb-1">Active</p>
            <p className="text-2xl font-bold text-blue-600">{activeEnquiries.length}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <p className="text-xs font-bold text-slate-500 uppercase mb-1">Quotations Ready</p>
            <p className="text-2xl font-bold text-purple-600">{quotedEnquiries.length}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <p className="text-xs font-bold text-slate-500 uppercase mb-1">Company</p>
            <p className="text-lg font-bold text-slate-700 truncate">{profile.company_name}</p>
          </div>
        </div>

        {/* Enquiries Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800">My Enquiries</h3>
            <span className="text-xs text-slate-400">{enquiries.length} total</span>
          </div>
          {enquiries.length === 0 ? (
            <div className="p-12 text-center">
              <FileText size={40} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">No enquiries yet</p>
              <p className="text-slate-400 text-sm mb-4">Submit your first enquiry to get started</p>
              <button onClick={() => setShowNewEnquiry(true)} className="text-blue-600 font-semibold text-sm hover:underline">+ Submit New Enquiry</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-4 py-2 text-xs font-bold text-slate-500 uppercase">Project</th>
                    <th className="px-4 py-2 text-xs font-bold text-slate-500 uppercase">Part</th>
                    <th className="px-4 py-2 text-xs font-bold text-slate-500 uppercase">Qty</th>
                    <th className="px-4 py-2 text-xs font-bold text-slate-500 uppercase">Date</th>
                    <th className="px-4 py-2 text-xs font-bold text-slate-500 uppercase">Status</th>
                    <th className="px-4 py-2 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {enquiries.map(enq => {
                    const cs = getCustomerStatus(enq.status);
                    return (
                      <tr key={enq.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 font-mono text-xs text-slate-500">{enq.lead_no || enq.enquiry_no}</td>
                        <td className="px-4 py-2 font-medium text-slate-700">{enq.part_name}</td>
                        <td className="px-4 py-2 text-slate-600">{enq.quantity}</td>
                        <td className="px-4 py-2 text-slate-400">{enq.received_date || enq.created_at?.split('T')[0]}</td>
                        <td className="px-4 py-2"><span className={"px-2.5 py-1 rounded-full text-[10px] font-semibold " + cs.color}>{cs.label}</span></td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => setSelectedEnquiry(enq)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View Details">
                            <Eye size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      {showNewEnquiry && <NewEnquiryForm profile={profile} onClose={() => setShowNewEnquiry(false)} onSaved={() => { setShowNewEnquiry(false); loadEnquiries(profile.id); }} />}
      {selectedEnquiry && <EnquiryDetail enquiry={selectedEnquiry} onClose={() => setSelectedEnquiry(null)} />}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, Edit, Trash2, Users as UsersIcon, Building2, ShieldCheck, Settings as SettingsIcon, FileText } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge, Button, StatCard } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { supabase } from '@/lib/supabase';
import { useAuth, type ErpRole } from '@/contexts/AuthContext';

// ---------------------------------------------------------------------------------------
// Users and companies are read through RLS and written ONLY through the erp_save_user /
// erp_save_company database functions, which enforce every role and company rule.
// The checks in this file just keep the UI from offering actions that would be refused.
// ---------------------------------------------------------------------------------------

interface CompanyRow {
  id: string;
  company_name: string;
  code: string | null;
  status: 'Active' | 'Inactive';
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: ErpRole;
  status: 'Active' | 'Inactive';
  company_id: string | null;
  last_login_at: string | null;
  created_at: string;
  company_name: string;
}

const ROLE_LABELS: Record<ErpRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Company Admin',
  USER: 'User',
};

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function useCompanies() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('companies').select('id, company_name, code, status, created_at').order('company_name');
    if (error) console.error('Failed to load companies:', error);
    setCompanies((data as CompanyRow[]) || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { companies, reload: load };
}

// ======================================================================================
// User Management
// ======================================================================================

const emptyUserForm = { id: null as string | null, full_name: '', email: '', role: 'USER' as ErpRole, status: 'Active' as 'Active' | 'Inactive', company_id: '' };

export function UsersPage() {
  const { profile, company, isSuperAdmin, isCompanyAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const { companies } = useCompanies();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState<string>(() => searchParams.get('company') ?? company?.id ?? '');
  const [form, setForm] = useState(emptyUserForm);
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<UserRow | null>(null);
  const [toDelete, setToDelete] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('company_users')
      .select('id, email, full_name, role, status, company_id, last_login_at, created_at, companies!company_users_company_id_fkey(company_name)')
      .order('created_at', { ascending: false });
    if (error) console.error('Failed to load users:', error);
    setUsers(((data as any[]) || []).map(u => ({ ...u, company_name: u.companies?.company_name ?? (u.role === 'SUPER_ADMIN' ? 'All companies' : '—') })));
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const visibleUsers = useMemo(
    () => (isSuperAdmin && companyFilter ? users.filter(u => u.company_id === companyFilter || u.role === 'SUPER_ADMIN') : users),
    [users, companyFilter, isSuperAdmin],
  );

  // A Super Admin may edit anyone except themselves (self-edit stays blocked
  // so nobody can accidentally remove their own Super Admin access).
  const canEdit = (u: UserRow) =>
    u.id !== profile?.id && (isSuperAdmin || (isCompanyAdmin && u.role !== 'SUPER_ADMIN' && u.company_id === profile?.company_id));

  const openCreate = () => {
    setForm({ ...emptyUserForm, company_id: isSuperAdmin ? companyFilter || company?.id || '' : profile?.company_id ?? '' });
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (u: UserRow) => {
    setForm({ id: u.id, full_name: u.full_name, email: u.email, role: u.role, status: u.status, company_id: u.company_id ?? '' });
    setFormError(null);
    setShowForm(true);
  };

  const save = async (next: typeof emptyUserForm) => {
    setSaving(true);
    setFormError(null);
    const { error } = await supabase.rpc('erp_save_user', {
      p_id: next.id,
      p_email: next.email,
      p_full_name: next.full_name,
      p_role: next.role,
      p_status: next.status,
      // Company Admins never choose a company: the database uses their own.
      // Super Admin accounts span all companies: no company is sent.
      p_company_id: isSuperAdmin && next.role !== 'SUPER_ADMIN' ? next.company_id || null : null,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return error.message;
    }
    await loadUsers();
    return null;
  };

  const handleSubmit = async () => {
    if (!form.email.trim()) { setFormError('Google account email is required'); return; }
    if (isSuperAdmin && form.role !== 'SUPER_ADMIN' && !form.company_id) { setFormError('Select a company'); return; }
    if ((await save(form)) === null) setShowForm(false);
  };

  // Permanent: removes the ERP user and their Google sign-in (erp_delete_user enforces who may do this).
  const confirmDeleteUser = async () => {
    if (!toDelete) return;
    setDeleting(true); setDeleteError(null);
    const { error } = await supabase.rpc('erp_delete_user', { p_id: toDelete.id });
    setDeleting(false);
    if (error) { setDeleteError(error.message); return; }
    setToDelete(null);
    await loadUsers();
  };

  const columns: Column<UserRow>[] = [
    { key: 'full_name', label: 'Name', sortable: true, render: (r) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
          {(r.full_name || r.email).slice(0, 2).toUpperCase()}
        </div>
        <p className="font-medium text-slate-800">{r.full_name || <span className="text-slate-400 italic">Not signed in yet</span>}</p>
      </div>
    )},
    { key: 'email', label: 'Email', sortable: true, render: (r) => <span className="text-sm text-slate-600">{r.email}</span> },
    { key: 'company_name', label: 'Company', sortable: true, render: (r) => <span className="text-sm text-slate-600">{r.company_name}</span> },
    { key: 'role', label: 'Role', sortable: true, render: (r) => <Badge variant={r.role === 'USER' ? 'neutral' : 'brand'}>{ROLE_LABELS[r.role]}</Badge> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={r.status === 'Active' ? 'success' : 'error'} dot>{r.status}</Badge> },
    { key: 'created_at', label: 'Created Date', sortable: true, render: (r) => <span className="text-xs text-slate-500">{formatDate(r.created_at)}</span> },
    {
      key: 'actions', label: 'Actions', align: 'center', render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button title="View" onClick={() => setViewing(r)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Eye size={15} /></button>
          {canEdit(r) && (
            <>
              <button title="Edit" onClick={() => openEdit(r)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Edit size={15} /></button>
              {r.id !== profile?.id && <button title="Delete user" aria-label={`Delete user ${r.email}`} onClick={() => { setDeleteError(null); setToDelete(r); }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>}
            </>
          )}
        </div>
      )
    },
  ];

  const roleOptions: ErpRole[] = isSuperAdmin ? ['SUPER_ADMIN', 'COMPANY_ADMIN', 'USER'] : ['COMPANY_ADMIN', 'USER'];
  const ownCompanyName = companies.find(c => c.id === profile?.company_id)?.company_name ?? company?.company_name ?? '';

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader
        title="User Management"
        description={isSuperAdmin ? 'All ERP users across companies. Users sign in with their Google account — no passwords.' : `Users of ${ownCompanyName}. Users sign in with their Google account — no passwords.`}
        actions={isSuperAdmin ? (
          <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className={`${inputClass} w-56`}>
            <option value="">All companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        ) : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Users" value={visibleUsers.length.toString()} icon={<UsersIcon size={20} />} accent="brand" />
        <StatCard label="Active" value={visibleUsers.filter(u => u.status === 'Active').length.toString()} icon={<UsersIcon size={20} />} accent="success" />
        <StatCard label="Inactive" value={visibleUsers.filter(u => u.status !== 'Active').length.toString()} icon={<UsersIcon size={20} />} accent="neutral" />
      </div>
      <DataTable
        data={visibleUsers}
        columns={columns}
        searchKeys={['full_name', 'email', 'role', 'company_name']}
        onAdd={openCreate}
        addLabel="Create User"
        emptyMessage={loading ? 'Loading…' : 'No users yet'}
      />

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={form.id ? 'Edit User' : 'Create User'}
        subtitle="The user signs in with Continue with Google using this exact email address."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Saving…' : form.id ? 'Save Changes' : 'Create User'}</Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Full Name">
            <input className={inputClass} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="e.g. Priya Sharma" />
          </FormField>
          <FormField label="Gmail / Google Account Email" required>
            <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@gmail.com" />
          </FormField>
          <FormField label="Company" required={form.role !== 'SUPER_ADMIN'}>
            {isSuperAdmin && form.role === 'SUPER_ADMIN' ? (
              <input className={`${inputClass} !bg-slate-100 !text-slate-500 cursor-not-allowed`} value="All companies" disabled title="Super Admin accounts span all companies" />
            ) : isSuperAdmin ? (
              <select className={inputClass} value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
                <option value="">Select company…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            ) : (
              <input className={`${inputClass} !bg-slate-100 !text-slate-500 cursor-not-allowed`} value={ownCompanyName} disabled title="Users are always created in your own company" />
            )}
          </FormField>
          <FormField label="Role" required>
            <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as ErpRole })} disabled={roleOptions.length === 1}>
              {roleOptions.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </FormField>
          <FormField label="Status" required>
            <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'Active' | 'Inactive' })}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </FormField>
        </div>
        {formError && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>}
      </Modal>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title="User Details" size="sm">
        {viewing && (
          <dl className="grid grid-cols-3 gap-y-3 text-sm">
            <dt className="text-slate-500">Name</dt><dd className="col-span-2 font-medium text-slate-800">{viewing.full_name || '—'}</dd>
            <dt className="text-slate-500">Email</dt><dd className="col-span-2 font-medium text-slate-800 break-all">{viewing.email}</dd>
            <dt className="text-slate-500">Company</dt><dd className="col-span-2 font-medium text-slate-800">{viewing.company_name}</dd>
            <dt className="text-slate-500">Role</dt><dd className="col-span-2 font-medium text-slate-800">{ROLE_LABELS[viewing.role]}</dd>
            <dt className="text-slate-500">Status</dt><dd className="col-span-2 font-medium text-slate-800">{viewing.status}</dd>
            <dt className="text-slate-500">Created</dt><dd className="col-span-2 font-medium text-slate-800">{formatDate(viewing.created_at)}</dd>
            <dt className="text-slate-500">Last login</dt><dd className="col-span-2 font-medium text-slate-800">{viewing.last_login_at ? new Date(viewing.last_login_at).toLocaleString('en-IN', { hour12: false }) : 'Never'}</dd>
          </dl>
        )}
      </Modal>
      <Modal open={!!toDelete} onClose={() => !deleting && setToDelete(null)} title="Delete user permanently?" size="sm"
        footer={<><Button variant="secondary" onClick={() => setToDelete(null)} disabled={deleting}>Cancel</Button><button onClick={confirmDeleteUser} disabled={deleting} className="h-9 px-4 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">{deleting ? 'Deleting…' : 'Delete permanently'}</button></>}>
        <p className="text-sm text-slate-700"><b>{toDelete?.full_name || toDelete?.email}</b> ({toDelete?.email}) will be removed completely, including their Google sign-in. This cannot be undone.</p>
        {deleteError && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{deleteError}</p>}
      </Modal>
    </div>
  );
}

// ======================================================================================
// Company Management (Super Admin only)
// ======================================================================================

const emptyCompanyForm = { id: null as string | null, company_name: '', code: '', status: 'Active' as 'Active' | 'Inactive' };

export function CompaniesPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { companies, reload } = useCompanies();
  const [userCounts, setUserCounts] = useState<Record<string, number>>({});
  const [form, setForm] = useState(emptyCompanyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CompanyRow | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('company_users').select('company_id').then(({ data, error }) => {
      if (error) console.error('Failed to count users:', error);
      const counts: Record<string, number> = {};
      (data || []).forEach((u: { company_id: string | null }) => { if (u.company_id) counts[u.company_id] = (counts[u.company_id] || 0) + 1; });
      setUserCounts(counts);
    });
  }, [companies]);

  const save = async (next: typeof emptyCompanyForm) => {
    setSaving(true);
    setFormError(null);
    const { error } = await supabase.rpc('erp_save_company', {
      p_id: next.id, p_company_name: next.company_name, p_code: next.code, p_status: next.status,
    });
    setSaving(false);
    if (error) { setFormError(error.message); return error.message; }
    await reload();
    await refresh(); // keep the top-bar company switcher in sync
    return null;
  };

  const handleSubmit = async () => {
    if (!form.company_name.trim()) { setFormError('Company name is required'); return; }
    if ((await save(form)) === null) setShowForm(false);
  };

  // Permanent: erp_delete_company removes the company, ALL its data and its users, atomically.
  const confirmDeleteCompany = async () => {
    if (!toDelete) return;
    setDeleting(true); setDeleteError(null);
    const { error } = await supabase.rpc('erp_delete_company', { p_id: toDelete.id, p_confirm_name: confirmText });
    setDeleting(false);
    if (error) { setDeleteError(error.message); return; }
    setToDelete(null); setConfirmText('');
    await reload();
    await refresh();
  };

  const rows = companies.map(c => ({ ...c, users: userCounts[c.id] || 0 }));
  const columns: Column<CompanyRow & { users: number }>[] = [
    { key: 'company_name', label: 'Company', sortable: true, render: (r) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500"><Building2 size={15} /></div>
        <p className="font-medium text-slate-800">{r.company_name}</p>
      </div>
    )},
    { key: 'code', label: 'Code', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-600">{r.code || '—'}</span> },
    { key: 'users', label: 'Users', sortable: true, align: 'center', render: (r) => <span className="text-sm text-slate-700">{r.users}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={r.status === 'Active' ? 'success' : 'error'} dot>{r.status}</Badge> },
    { key: 'created_at', label: 'Created Date', sortable: true, render: (r) => <span className="text-xs text-slate-500">{formatDate(r.created_at)}</span> },
    {
      key: 'actions', label: 'Actions', align: 'center', render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button title="View users" onClick={() => navigate(`/admin/users?company=${r.id}`)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><UsersIcon size={15} /></button>
          <button title="Edit" onClick={() => { setForm({ id: r.id, company_name: r.company_name, code: r.code ?? '', status: r.status }); setFormError(null); setShowForm(true); }} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Edit size={15} /></button>
          <button title="Delete company" aria-label={`Delete company ${r.company_name}`} onClick={() => { setDeleteError(null); setConfirmText(''); setToDelete(r); }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>
        </div>
      )
    },
  ];

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Company Management" description="Companies using this ERP. Each company's data is isolated by the database." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Companies" value={companies.length.toString()} icon={<Building2 size={20} />} accent="brand" />
        <StatCard label="Active" value={companies.filter(c => c.status === 'Active').length.toString()} icon={<Building2 size={20} />} accent="success" />
        <StatCard label="Inactive" value={companies.filter(c => c.status !== 'Active').length.toString()} icon={<Building2 size={20} />} accent="neutral" />
      </div>
      <DataTable
        data={rows}
        columns={columns}
        searchKeys={['company_name', 'code']}
        onAdd={() => { setForm(emptyCompanyForm); setFormError(null); setShowForm(true); }}
        addLabel="Create Company"
      />

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={form.id ? 'Edit Company' : 'Create Company'}
        subtitle="After creating a company, add its Company Admin in User Management."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Saving…' : form.id ? 'Save Changes' : 'Create Company'}</Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4">
          <FormField label="Company Name" required>
            <input className={inputClass} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
          </FormField>
          <FormField label="Code">
            <input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. ARGUS" />
          </FormField>
          <FormField label="Status" required>
            <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'Active' | 'Inactive' })}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </FormField>
        </div>
        {formError && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>}
      </Modal>
      <Modal open={!!toDelete} onClose={() => !deleting && setToDelete(null)} title="Delete company permanently?" size="sm"
        footer={<><Button variant="secondary" onClick={() => setToDelete(null)} disabled={deleting}>Cancel</Button><button onClick={confirmDeleteCompany} disabled={deleting || confirmText.trim() !== toDelete?.company_name} className="h-9 px-4 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40">{deleting ? 'Deleting…' : 'Delete everything'}</button></>}>
        <div className="space-y-3 text-sm text-slate-700">
          <p><b>{toDelete?.company_name}</b> and <b>all of its data</b> (enquiries, quotations, orders, inventory, accounts, files records…) will be erased, together with its {userCounts[toDelete?.id ?? ''] || 0} user(s) and their Google sign-ins. <b>This cannot be undone.</b></p>
          <FormField label={`Type the company name to confirm`}>
            <input autoFocus aria-label="Confirm company name" className={inputClass} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={toDelete?.company_name} />
          </FormField>
          {deleteError && <p className="text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{deleteError}</p>}
        </div>
      </Modal>
    </div>
  );
}

function AdminStub({ title, description, icon: Icon }: { title: string, description: string, icon: any }) {
  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title={title} description={description} />
      <div className="flex flex-col items-center justify-center h-64 border border-dashed border-slate-300 rounded-xl bg-slate-50">
        <Icon className="text-slate-400 mb-3" size={32} />
        <h3 className="text-slate-700 font-medium">{title}</h3>
        <p className="text-slate-500 text-sm mt-1">Configuration module coming soon.</p>
      </div>
    </div>
  );
}

export function RolesPage() { return <AdminStub title="Roles" description="Define user roles and group policies" icon={ShieldCheck} />; }
export function PermissionsPage() { return <AdminStub title="Permissions" description="Granular access control matrix" icon={ShieldCheck} />; }
export function SettingsPage() { return <AdminStub title="Company Settings" description="Global ERP configuration and preferences" icon={SettingsIcon} />; }
export function AuditLogsPage() { return <AdminStub title="Audit Logs" description="System-wide activity monitoring" icon={FileText} />; }

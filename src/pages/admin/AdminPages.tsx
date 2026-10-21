import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, Edit, Trash2, Users as UsersIcon, Building2, ShieldCheck, Settings as SettingsIcon, FileText, ChevronDown, ChevronRight, Search, Lock, KeyRound, Plus, Download, Upload } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge, Button, StatCard } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { supabase } from '@/lib/supabase';
import { exportCsv } from '@/lib/reportExport';
import { todayISO } from '@/lib/format';
import { useAuth, type ErpRole } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { isTauri } from '@/lib/desktop/isTauri';
import { UpdatesSettingsPage } from '@/components/desktop/UpdatesSettingsPage';
import {
  ADMIN_RESERVED_MODULES, MODULE_CATALOG, PERM_CATEGORIES,
  emptyMatrix, fullMatrix, matrixToPayload, rowsToMatrix,
  type PermAction, type PermMatrix,
} from '@/config/permissions';

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
  const navigate = useNavigate();
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
              <button title="Manage access" aria-label={`Manage access for ${r.email}`} onClick={() => navigate(`/admin/access?user=${r.id}${r.company_id ? `&company=${r.company_id}` : ''}`)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"><KeyRound size={15} /></button>
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

  const [search, setSearch] = useState('');

  const searchedUsers = useMemo(() => {
    if (!search.trim()) return visibleUsers;
    const q = search.toLowerCase();
    return visibleUsers.filter(u =>
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q) ||
      (u.company_name || '').toLowerCase().includes(q)
    );
  }, [visibleUsers, search]);

  const activeCount = visibleUsers.filter(u => u.status === 'Active').length;
  const inactiveCount = visibleUsers.filter(u => u.status !== 'Active').length;

  const handleExport = () => {
    if (searchedUsers.length === 0) return;
    exportCsv(`ERP_Users_${todayISO()}`, [
      ['Full Name', 'Email', 'Company', 'Role', 'Status', 'Created Date'],
      ...searchedUsers.map(u => [
        u.full_name || '',
        u.email || '',
        u.company_name || '',
        ROLE_LABELS[u.role] || u.role,
        u.status || '',
        formatDate(u.created_at),
      ]),
    ]);
  };

  const handleExportRef = useRef(handleExport);
  handleExportRef.current = handleExport;
  const openCreateRef = useRef(openCreate);
  openCreateRef.current = openCreate;

  const { setHeader, setTabActions, setHeaderCenter } = useHeaderKpis();

  useEffect(() => {
    setHeader({ title: 'User Management' });
    setHeaderCenter(
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md text-xs">
          <UsersIcon size={11} className="text-slate-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total:</span>
          <span className="text-xs font-black text-slate-800 tabular-nums">{visibleUsers.length}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs">
          <UsersIcon size={11} className="text-emerald-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Active:</span>
          <span className="text-xs font-black text-emerald-900 tabular-nums">{activeCount}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md text-xs">
          <UsersIcon size={11} className="text-slate-500" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Inactive:</span>
          <span className="text-xs font-black text-slate-700 tabular-nums">{inactiveCount}</span>
        </div>
      </div>
    );
    setTabActions(
      <div className="flex items-center gap-2">
        {isSuperAdmin && (
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="h-7 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-brand-500 max-w-[150px] truncate"
          >
            <option value="">All companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        )}
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
          icon={<Upload size={13} />}
          onClick={() => handleExportRef.current()}
          className="h-7 py-1 text-xs px-2.5 shadow-sm font-semibold"
        >
          EXPORT
        </Button>
        <Button
          onClick={() => openCreateRef.current()}
          icon={<Plus size={14} />}
          size="sm"
          className="h-7 py-1 text-xs px-2.5 shadow-sm"
        >
          Create User
        </Button>
      </div>
    );
    return () => {
      setHeader(null);
      setHeaderCenter(null);
      setTabActions(null);
    };
  }, [setHeader, setHeaderCenter, setTabActions, visibleUsers.length, activeCount, inactiveCount, isSuperAdmin, companyFilter, companies, search]);

  return (
    <div className="p-3 sm:p-4 lg:px-4 lg:pt-1.5 lg:pb-4 bg-grid min-h-full space-y-2">
      <div className="lg:hidden">
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <StatCard label="Total Users" value={visibleUsers.length.toString()} icon={<UsersIcon size={20} />} accent="brand" />
          <StatCard label="Active" value={activeCount.toString()} icon={<UsersIcon size={20} />} accent="success" />
          <StatCard label="Inactive" value={inactiveCount.toString()} icon={<UsersIcon size={20} />} accent="neutral" />
        </div>
      </div>
      <DataTable
        data={searchedUsers}
        columns={columns}
        searchKeys={['full_name', 'email', 'role', 'company_name']}
        onAdd={openCreate}
        addLabel="Create User"
        emptyMessage={loading ? 'Loading…' : 'No users yet'}
        hideToolbar
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

  const [search, setSearch] = useState('');

  const rows = companies.map(c => ({ ...c, users: userCounts[c.id] || 0 }));

  const searchedRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      (r.company_name || '').toLowerCase().includes(q) ||
      (r.code || '').toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const activeCount = companies.filter(c => c.status === 'Active').length;
  const inactiveCount = companies.filter(c => c.status !== 'Active').length;

  const handleExport = () => {
    if (searchedRows.length === 0) return;
    exportCsv(`ERP_Companies_${todayISO()}`, [
      ['Company Name', 'Code', 'Users', 'Status', 'Created Date'],
      ...searchedRows.map(r => [
        r.company_name || '',
        r.code || '',
        r.users || 0,
        r.status || '',
        formatDate(r.created_at),
      ]),
    ]);
  };

  const handleExportRef = useRef(handleExport);
  handleExportRef.current = handleExport;
  const openCreateRef = useRef(() => { setForm(emptyCompanyForm); setFormError(null); setShowForm(true); });
  openCreateRef.current = () => { setForm(emptyCompanyForm); setFormError(null); setShowForm(true); };

  const { setHeader, setTabActions, setHeaderCenter } = useHeaderKpis();

  useEffect(() => {
    setHeader({ title: 'Company Management' });
    setHeaderCenter(
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md text-xs">
          <Building2 size={11} className="text-slate-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Companies:</span>
          <span className="text-xs font-black text-slate-800 tabular-nums">{companies.length}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs">
          <Building2 size={11} className="text-emerald-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Active:</span>
          <span className="text-xs font-black text-emerald-900 tabular-nums">{activeCount}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md text-xs">
          <Building2 size={11} className="text-slate-500" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Inactive:</span>
          <span className="text-xs font-black text-slate-700 tabular-nums">{inactiveCount}</span>
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
          icon={<Upload size={13} />}
          onClick={() => handleExportRef.current()}
          className="h-7 py-1 text-xs px-2.5 shadow-sm font-semibold"
        >
          EXPORT
        </Button>
        <Button
          onClick={() => openCreateRef.current()}
          icon={<Plus size={14} />}
          size="sm"
          className="h-7 py-1 text-xs px-2.5 shadow-sm"
        >
          Create Company
        </Button>
      </div>
    );
    return () => {
      setHeader(null);
      setHeaderCenter(null);
      setTabActions(null);
    };
  }, [setHeader, setHeaderCenter, setTabActions, companies.length, activeCount, inactiveCount, search]);

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
          <button title="Manage access" aria-label={`Manage access for ${r.company_name}`} onClick={() => navigate(`/admin/access?company=${r.id}`)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"><KeyRound size={15} /></button>
          <button title="Edit" onClick={() => { setForm({ id: r.id, company_name: r.company_name, code: r.code ?? '', status: r.status }); setFormError(null); setShowForm(true); }} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Edit size={15} /></button>
          <button title="Delete company" aria-label={`Delete company ${r.company_name}`} onClick={() => { setDeleteError(null); setConfirmText(''); setToDelete(r); }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>
        </div>
      )
    },
  ];

  return (
    <div className="p-3 sm:p-4 lg:px-4 lg:pt-1.5 lg:pb-4 bg-grid min-h-full space-y-2">
      <div className="lg:hidden">
        <PageHeader title="Company Management" description="Companies using this ERP. Each company's data is isolated by the database." />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <StatCard label="Companies" value={companies.length.toString()} icon={<Building2 size={20} />} accent="brand" />
          <StatCard label="Active" value={activeCount.toString()} icon={<Building2 size={20} />} accent="success" />
          <StatCard label="Inactive" value={inactiveCount.toString()} icon={<Building2 size={20} />} accent="neutral" />
        </div>
      </div>
      <DataTable
        data={searchedRows}
        columns={columns}
        searchKeys={['company_name', 'code']}
        onAdd={() => { setForm(emptyCompanyForm); setFormError(null); setShowForm(true); }}
        addLabel="Create Company"
        hideToolbar
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
// Web: keeps the original placeholder. Desktop: real About + Updates settings
// (version, startup/periodic check toggles, manual check) — no other settings moved.
export function SettingsPage() {
  if (isTauri()) return <UpdatesSettingsPage />;
  return <AdminStub title="Company Settings" description="Global ERP configuration and preferences" icon={SettingsIcon} />;
}
export function AuditLogsPage() { return <AdminStub title="Audit Logs" description="System-wide activity monitoring" icon={FileText} />; }

// ======================================================================================
// Company & Access Management: All Companies → Company → Users → User Permissions
const ACTION_LABELS: Record<PermAction, string> = {
  view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', approve: 'Approve', export: 'Export',
};

const CATEGORY_THEMES: Record<string, {
  cardBg: string;
  cardBorder: string;
  headerBg: string;
  headerBorder: string;
  headerText: string;
  badgeBg: string;
  badgeText: string;
  divider: string;
  rowHover: string;
  accent: string;
  toggleOn: string;
}> = {
  Overview: {
    cardBg: 'bg-indigo-50/40',
    cardBorder: 'border-indigo-200/80',
    headerBg: 'bg-indigo-100/70',
    headerBorder: 'border-indigo-200',
    headerText: 'text-indigo-900',
    badgeBg: 'bg-indigo-200/60',
    badgeText: 'text-indigo-800',
    divider: 'divide-indigo-100/70',
    rowHover: 'hover:bg-indigo-100/30',
    accent: 'accent-indigo-600',
    toggleOn: 'bg-indigo-600',
  },
  Sales: {
    cardBg: 'bg-emerald-50/40',
    cardBorder: 'border-emerald-200/80',
    headerBg: 'bg-emerald-100/70',
    headerBorder: 'border-emerald-200',
    headerText: 'text-emerald-900',
    badgeBg: 'bg-emerald-200/60',
    badgeText: 'text-emerald-800',
    divider: 'divide-emerald-100/70',
    rowHover: 'hover:bg-emerald-100/30',
    accent: 'accent-emerald-600',
    toggleOn: 'bg-emerald-600',
  },
  Production: {
    cardBg: 'bg-amber-50/40',
    cardBorder: 'border-amber-200/80',
    headerBg: 'bg-amber-100/70',
    headerBorder: 'border-amber-200',
    headerText: 'text-amber-900',
    badgeBg: 'bg-amber-200/60',
    badgeText: 'text-amber-800',
    divider: 'divide-amber-100/70',
    rowHover: 'hover:bg-amber-100/30',
    accent: 'accent-amber-600',
    toggleOn: 'bg-amber-600',
  },
  Logistics: {
    cardBg: 'bg-sky-50/40',
    cardBorder: 'border-sky-200/80',
    headerBg: 'bg-sky-100/70',
    headerBorder: 'border-sky-200',
    headerText: 'text-sky-900',
    badgeBg: 'bg-sky-200/60',
    badgeText: 'text-sky-800',
    divider: 'divide-sky-100/70',
    rowHover: 'hover:bg-sky-100/30',
    accent: 'accent-sky-600',
    toggleOn: 'bg-sky-600',
  },
  Finance: {
    cardBg: 'bg-violet-50/40',
    cardBorder: 'border-violet-200/80',
    headerBg: 'bg-violet-100/70',
    headerBorder: 'border-violet-200',
    headerText: 'text-violet-900',
    badgeBg: 'bg-violet-200/60',
    badgeText: 'text-violet-800',
    divider: 'divide-violet-100/70',
    rowHover: 'hover:bg-violet-100/30',
    accent: 'accent-violet-600',
    toggleOn: 'bg-violet-600',
  },
  'Inventory & Purchasing': {
    cardBg: 'bg-teal-50/40',
    cardBorder: 'border-teal-200/80',
    headerBg: 'bg-teal-100/70',
    headerBorder: 'border-teal-200',
    headerText: 'text-teal-900',
    badgeBg: 'bg-teal-200/60',
    badgeText: 'text-teal-800',
    divider: 'divide-teal-100/70',
    rowHover: 'hover:bg-teal-100/30',
    accent: 'accent-teal-600',
    toggleOn: 'bg-teal-600',
  },
  Administration: {
    cardBg: 'bg-rose-50/40',
    cardBorder: 'border-rose-200/80',
    headerBg: 'bg-rose-100/70',
    headerBorder: 'border-rose-200',
    headerText: 'text-rose-900',
    badgeBg: 'bg-rose-200/60',
    badgeText: 'text-rose-800',
    divider: 'divide-rose-100/70',
    rowHover: 'hover:bg-rose-100/30',
    accent: 'accent-rose-600',
    toggleOn: 'bg-rose-600',
  },
};

function TriCheckbox({ checked, indeterminate, onChange, label, disabled, title, accentClass }: {
  checked: boolean; indeterminate: boolean; onChange: (on: boolean) => void;
  label: string; disabled?: boolean; title?: string; accentClass?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate && !checked; }, [indeterminate, checked]);
  return (
    <label title={title} className={`flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap ${disabled ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 cursor-pointer hover:text-slate-900'}`}>
      <input ref={ref} type="checkbox" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)}
        className={`w-3.5 h-3.5 rounded cursor-pointer disabled:cursor-not-allowed ${accentClass ?? 'accent-brand-600'}`} />
      {label}
    </label>
  );
}

function PermissionEditor({ userId, userEmail, userRole, onSaved }: {
  userId: string; userEmail: string; userRole: ErpRole; onSaved?: () => void;
}) {
  // These stages live on the Sales Pipeline strip (no sidebar entry): their
  // matrix rows still control the pipeline column, KPI tile and list access.
  const PIPELINE_ONLY: Record<string, boolean> = { 'finished-goods': true, delivery: true, invoices: true };
  const { profile, isSuperAdmin, refreshPermissions } = useAuth();
  const [matrix, setMatrix] = useState<PermMatrix>(emptyMatrix);
  const [saved, setSaved] = useState<PermMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Category bulk controls. Select All toggles View only (never grants
  // actions); the Actions menu enables one action at a time (implying View,
  // like the single-module controls) or clears optional actions. Locked and
  // Super-Admin-target modules are always skipped; backend rules still apply.
  const setCategoryView = (cat: string, on: boolean) => {
    setMatrix((prev) => {
      const next = { ...prev };
      MODULE_CATALOG.filter((m) => m.category === cat).forEach((m) => {
        if (lockedForCaller(m.key) || isSuperTarget) return;
        next[m.key] = on
          ? { ...next[m.key], view: true }
          : { view: false, create: false, edit: false, delete: false, approve: false, export: false };
      });
      return next;
    });
  };

  const setCategoryAction = (cat: string, action: PermAction | 'clear') => {
    setMatrix((prev) => {
      const next = { ...prev };
      MODULE_CATALOG.filter((m) => m.category === cat).forEach((m) => {
        if (lockedForCaller(m.key) || isSuperTarget) return;
        if (action === 'clear') {
          next[m.key] = { ...next[m.key], create: false, edit: false, delete: false, approve: false, export: false };
        } else if ((m.actions as string[]).includes(action)) {
          next[m.key] = { ...next[m.key], view: true, [action]: true };
        }
      });
      return next;
    });
    setMenuFor(null);
  };

  const isSelf = profile?.id === userId;
  const isSuperTarget = userRole === 'SUPER_ADMIN';
  // Company Admins can never grant these (mirrors the database rule).
  const lockedForCaller = useCallback((key: string) => !isSuperAdmin && ADMIN_RESERVED_MODULES.includes(key), [isSuperAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('erp_get_user_permissions', { p_user_id: userId });
    setLoading(false);
    if (err) { setError(err.message); return; }
    // Admins resolve to full access even with no rows: show that reality as the base.
    const base = (data?.role === 'SUPER_ADMIN' || data?.role === 'COMPANY_ADMIN')
      ? fullMatrix()
      : rowsToMatrix(data?.permissions);
    setMatrix(base);
    setSaved(JSON.parse(JSON.stringify(base)));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const dirty = saved !== null && JSON.stringify(matrix) !== JSON.stringify(saved);
  const grantedCount = MODULE_CATALOG.filter((m) => matrix[m.key]?.view).length;

  const setModule = (key: string, patch: Partial<Record<PermAction, boolean>>) => {
    setMatrix((prev) => {
      const next = { ...prev, [key]: { ...prev[key], ...patch } };
      // View off clears every action; an action on implies view.
      if (patch.view === false) {
        next[key] = { view: false, create: false, edit: false, delete: false, approve: false, export: false };
      } else if (Object.entries(patch).some(([a, v]) => a !== 'view' && v)) {
        next[key] = { ...next[key], view: true };
      }
      return next;
    });
  };

  const selectAll = () => {
    const next = emptyMatrix();
    MODULE_CATALOG.forEach((m) => {
      if (lockedForCaller(m.key)) return;
      m.actions.forEach((a) => { next[m.key][a] = true; });
    });
    setMatrix(next);
  };

  const save = async () => {
    if (isSelf) { setError('You cannot edit your own permissions — ask another administrator.'); return; }
    if (isSuperTarget) { setError('Super Admins always have full access — nothing to configure.'); return; }
    const revoked = saved ? MODULE_CATALOG.filter((m) => saved[m.key]?.view && !matrix[m.key]?.view).map((m) => m.label) : [];
    if (revoked.length && !window.confirm(`Remove access to ${revoked.join(', ')} for ${userEmail}?`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const { error: err } = await supabase.rpc('erp_save_permissions', { p_user_id: userId, p_permissions: matrixToPayload(matrix) });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(JSON.parse(JSON.stringify(matrix)));
    setNotice('Permissions saved. They apply the next time the user loads a page (no re-login needed).');
    // If an admin trimmed their own session's scope indirectly, refresh local nav.
    if (profile) void refreshPermissions();
    onSaved?.();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-3 border-slate-200 border-t-brand-500 rounded-full animate-spin" style={{ borderWidth: '3px' }} /></div>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800 truncate">User Access — {userEmail}</h3>
          <p className="text-[11px] text-slate-500">{grantedCount} of {MODULE_CATALOG.length} modules enabled{dirty ? ' · unsaved changes' : ''}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={selectAll}>Select All Allowed</Button>
          <Button variant="secondary" size="sm" onClick={() => setMatrix(emptyMatrix())}>Clear</Button>
          <Button variant="secondary" size="sm" disabled={!dirty} onClick={() => saved && setMatrix(JSON.parse(JSON.stringify(saved)))}>Cancel</Button>
          <Button size="sm" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save Permissions'}</Button>
        </div>
      </div>
      {error && <p className="text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm">{error}</p>}
      {notice && <p className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm">{notice}</p>}
      {isSuperTarget && <p className="text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">Super Admins always have full access across all companies — there is nothing to configure here.</p>}
      {(() => {
        const renderCategoryCard = (cat: string) => {
          const mods = MODULE_CATALOG.filter((m) => m.category === cat);
          const isCollapsed = collapsed.has(cat);
          const selectable = isSuperTarget ? [] : mods.filter((m) => !lockedForCaller(m.key));
          const viewOn = selectable.filter((m) => matrix[m.key]?.view).length;
          const allOn = selectable.length > 0 && viewOn === selectable.length;
          const someOn = viewOn > 0 && viewOn < selectable.length;
          const bulkActions: PermAction[] = (['create', 'edit', 'delete', 'export'] as PermAction[]).filter((a) =>
            selectable.some((m) => (m.actions as string[]).includes(a)));
          const theme = CATEGORY_THEMES[cat] ?? {
            cardBg: 'bg-white',
            cardBorder: 'border-slate-200',
            headerBg: 'bg-slate-50/70',
            headerBorder: 'border-slate-100',
            headerText: 'text-slate-700',
            badgeBg: 'bg-slate-100',
            badgeText: 'text-slate-500',
            divider: 'divide-slate-100',
            rowHover: 'hover:bg-slate-50/50',
            accent: 'accent-brand-600',
            toggleOn: 'bg-brand-600',
          };

          return (
            <div key={cat} className={`${theme.cardBg} rounded-xl border ${theme.cardBorder} shadow-sm overflow-hidden transition-shadow`}>
              <div className={`flex items-center gap-2 pl-2 pr-2.5 h-9 ${theme.headerBg} border-b ${theme.headerBorder}`}>
                <button type="button" onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })}
                  className="flex items-center gap-1.5 min-w-0 shrink-0 hover:opacity-80" title={isCollapsed ? `Expand ${cat}` : `Collapse ${cat}`}>
                  {isCollapsed ? <ChevronRight size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
                  <span className={`text-xs font-bold ${theme.headerText} uppercase tracking-wider truncate`}>{cat}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${theme.badgeBg} ${theme.badgeText} shrink-0`}>{viewOn}/{mods.length}</span>
                </button>
                <TriCheckbox checked={allOn} indeterminate={someOn} disabled={selectable.length === 0}
                  label="Select All" accentClass={theme.accent}
                  title={selectable.length === 0 ? 'No grantable modules in this category' : `Turn View ${allOn ? 'off' : 'on'} for every ${cat} module (actions untouched when turning on)`}
                  onChange={(on) => setCategoryView(cat, on)} />
                <div className="relative shrink-0 ml-auto">
                  <button type="button" onClick={() => setMenuFor(menuFor === cat ? null : cat)} disabled={selectable.length === 0}
                    className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:text-slate-800 border border-slate-200/90 rounded-md bg-white shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Bulk actions for this category">
                    Actions
                    <ChevronDown size={12} className={`transition-transform ${menuFor === cat ? 'rotate-180' : ''}`} />
                  </button>
                  {menuFor === cat && (
                    <>
                      <button type="button" aria-label="Close menu" onClick={() => setMenuFor(null)} className="fixed inset-0 z-10 cursor-default" />
                      <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                        {bulkActions.map((a) => (
                          <button key={a} type="button" onClick={() => setCategoryAction(cat, a)}
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                            Enable {ACTION_LABELS[a]} for this category
                          </button>
                        ))}
                        <div className="border-t border-slate-100 mt-1 pt-1">
                          <button type="button" onClick={() => setCategoryAction(cat, 'clear')}
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                            Clear optional actions (keep View)
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {!isCollapsed && (
                <div className={`divide-y ${theme.divider}`}>
                  {mods.map((m) => {
                    const locked = lockedForCaller(m.key);
                    const f = matrix[m.key];
                    return (
                      <div key={m.key} className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-1.5 ${theme.rowHover} transition-colors`}>
                        <label className="flex items-center gap-2 min-w-[9.5rem] cursor-pointer">
                          <button type="button" role="switch" aria-checked={f.view} disabled={locked || isSuperTarget}
                            onClick={() => setModule(m.key, { view: !f.view })}
                            className={`relative w-8 h-4.5 rounded-full transition-colors shrink-0 ${f.view ? theme.toggleOn : 'bg-slate-300'} ${(locked || isSuperTarget) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            style={{ height: '18px', width: '32px' }}>
                            <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${f.view ? 'left-[15px]' : 'left-0.5'}`} />
                          </button>
                          <span className="text-xs font-semibold text-slate-800 truncate">{m.label}</span>
                          {locked && <Lock size={12} className="text-slate-400 shrink-0" />}
                          {PIPELINE_ONLY[m.key] && <span className="text-[10px] text-slate-400 whitespace-nowrap" title="No sidebar entry — this permission controls the Sales Pipeline column, KPI tile and list access">via Sales Pipeline</span>}
                        </label>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          {m.actions.filter((a) => a !== 'view').map((a) => (
                            <label key={a} className={`flex items-center gap-1 text-[11px] ${(locked || isSuperTarget || !f.view) ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 cursor-pointer hover:text-slate-900'}`}>
                              <input type="checkbox" disabled={locked || isSuperTarget || !f.view} checked={!!f[a]}
                                onChange={(e) => setModule(m.key, { [a]: e.target.checked } as Partial<Record<PermAction, boolean>>)}
                                className={`w-3.5 h-3.5 rounded ${theme.accent}`} />
                              {ACTION_LABELS[a]}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        };

        // Distribute categories across two vertical columns so cards stack tightly with no blank gaps below shorter boxes
        const leftCategories = ['Overview', 'Production', 'Inventory & Purchasing'];
        const rightCategories = ['Sales', 'Logistics', 'Finance', 'Administration'];

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            <div className="flex flex-col gap-3">
              {leftCategories.map(renderCategoryCard)}
            </div>
            <div className="flex flex-col gap-3">
              {rightCategories.map(renderCategoryCard)}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

interface AccessUser {
  id: string;
  email: string;
  full_name: string;
  role: ErpRole;
  status: 'Active' | 'Inactive';
  company_id: string | null;
  company_name: string;
}

export function AccessPage() {
  const { profile, company, isSuperAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { companies } = useCompanies();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moduleCounts, setModuleCounts] = useState<Record<string, number>>({});
  const selectedUserId = searchParams.get('user') ?? null;
  const focusedCompany = searchParams.get('company') ?? null;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('company_users')
      .select('id, email, full_name, role, status, company_id, companies!company_users_company_id_fkey(company_name)')
      .order('created_at', { ascending: false });
    if (error) console.error('Failed to load users:', error);
    const rows = ((data as any[]) || []).map((u) => ({
      id: u.id, email: u.email, full_name: u.full_name, role: u.role, status: u.status,
      company_id: u.company_id, company_name: u.companies?.company_name ?? (u.role === 'SUPER_ADMIN' ? 'All companies' : '—'),
    }));
    // Company Admins see their own company (RLS already restricts; this is display only).
    setUsers(isSuperAdmin ? rows : rows.filter((u) => u.company_id === profile?.company_id || u.id === profile?.id));
    setLoading(false);
  }, [isSuperAdmin, profile?.company_id, profile?.id]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const visibleCompanies = useMemo(() => {
    const list = isSuperAdmin ? companies : companies.filter((c) => c.id === profile?.company_id);
    const q = query.trim().toLowerCase();
    const rf = roleFilter, sf = statusFilter;
    return list
      .filter((c) => !focusedCompany || c.id === focusedCompany)
      .map((c) => ({
        ...c,
        users: users.filter((u) =>
          u.company_id === c.id &&
          (!q || u.email.toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q)) &&
          (!rf || u.role === rf) &&
          (!sf || u.status === sf)),
      }))
      .filter((c) => {
        const q = query.trim().toLowerCase();
        return c.users.length > 0 || (!q && !roleFilter && !statusFilter && !focusedCompany) || (q && c.company_name.toLowerCase().includes(q));
      });
  }, [companies, users, query, roleFilter, statusFilter, focusedCompany, isSuperAdmin]);

  // Company Admins land expanded on their own company; deep links expand too.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!isSuperAdmin && profile?.company_id) next.add(profile.company_id);
      if (focusedCompany) next.add(focusedCompany);
      const sel = users.find((u) => u.id === selectedUserId);
      if (sel?.company_id) next.add(sel.company_id);
      return next;
    });
  }, [isSuperAdmin, profile?.company_id, focusedCompany, selectedUserId, users]);

  const toggleCompany = async (id: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    // Lazy module counts for the expanded company (one small RPC per user).
    const list = users.filter((u) => u.company_id === id && moduleCounts[u.id] === undefined);
    if (!list.length) return;
    const entries = await Promise.all(list.map(async (u) => {
      const { data, error } = await supabase.rpc('erp_get_user_permissions', { p_user_id: u.id });
      if (error || !data) return [u.id, -1] as const;
      if (data.role === 'SUPER_ADMIN' || data.role === 'COMPANY_ADMIN') return [u.id, -2] as const; // full by role
      return [u.id, (data.permissions ?? []).filter((p: any) => p.can_view).length] as const;
    }));
    setModuleCounts((prev) => {
      const n = { ...prev };
      entries.forEach(([id, c]) => { n[id] = c; });
      return n;
    });
  };

  const selectUser = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('user', id); else next.delete('user');
    setSearchParams(next, { replace: true });
  };

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;
  const canManage = (u: AccessUser) =>
    u.id !== profile?.id && (isSuperAdmin || (u.role !== 'SUPER_ADMIN' && u.company_id === profile?.company_id));

  // Title lives in the top bar (same line as date/profile); nothing rendered here.
  const { setHeader } = useHeaderKpis();
  useEffect(() => {
    setHeader({
      title: 'Company & Access Management',
      subtitle: isSuperAdmin ? 'All Companies → Company → Users → Permissions' : `${company?.company_name ?? 'Your company'} → Users → Permissions`,
    });
    return () => setHeader(null);
  }, [setHeader, isSuperAdmin, company?.company_name]);

  return (
    <div className="p-3 bg-grid min-h-full">
      {focusedCompany && (
        <div className="mb-2">
          <Button variant="secondary" size="sm" onClick={() => { const n = new URLSearchParams(searchParams); n.delete('company'); n.delete('user'); setSearchParams(n, { replace: true }); }}>← All companies</Button>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] gap-2.5 items-start">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 flex flex-col gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies or users…"
                className="w-full pl-8 pr-2.5 py-1.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:border-brand-500" />
            </div>
            <div className="flex gap-2">
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white">
                <option value="">All roles</option>
                <option value="COMPANY_ADMIN">Company Admin</option>
                <option value="USER">Member</option>
                {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white">
                <option value="">Any status</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
            ) : visibleCompanies.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No companies or users match.</p>
            ) : visibleCompanies.map((c) => {
              const open = expanded.has(c.id);
              return (
                <div key={c.id} className="border-b border-slate-100 last:border-0">
                  <button type="button" onClick={() => toggleCompany(c.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left">
                    {open ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
                    <Building2 size={14} className="text-brand-500 shrink-0" />
                    <span className="text-sm font-bold text-slate-800 truncate">{c.company_name}</span>
                    <span className="ml-auto text-[11px] text-slate-400 shrink-0">{c.users.length} user{c.users.length === 1 ? '' : 's'}</span>
                  </button>
                  {open && (
                    <div className="pb-1">
                      {c.users.length === 0 && <p className="text-xs text-slate-400 px-9 py-1.5">No users match the filters.</p>}
                      {c.users.map((u) => {
                        const mc = moduleCounts[u.id];
                        const active = u.id === selectedUserId;
                        return (
                          <button key={u.id} type="button" onClick={() => selectUser(active ? null : u.id)}
                            className={`w-full flex items-center gap-2 pl-9 pr-3 py-1 text-left hover:bg-brand-50/50 ${active ? 'bg-brand-50' : ''}`}>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-semibold text-slate-700 truncate">{u.full_name || u.email}</span>
                              <span className="block text-[11px] text-slate-400 truncate">
                                {ROLE_LABELS[u.role] ?? u.role} · {u.status}
                                {mc === undefined ? '' : mc === -2 ? ' · full access (role)' : ` · ${mc} modules`}
                              </span>
                            </span>
                            <Badge variant={u.status === 'Active' ? 'success' : 'error'} dot>{u.status}</Badge>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          {selectedUser ? (
            canManage(selectedUser) ? (
              <PermissionEditor key={selectedUser.id} userId={selectedUser.id} userEmail={selectedUser.email} userRole={selectedUser.role} onSaved={() => loadUsers()} />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ShieldCheck size={28} className="text-slate-300 mb-3" />
                <p className="text-sm font-semibold text-slate-700">{selectedUser.email}</p>
                <p className="text-xs text-slate-400 mt-1 max-w-xs">
                  {selectedUser.id === profile?.id
                    ? 'You cannot edit your own permissions — ask another administrator.'
                    : 'You are not authorized to manage this user.'}
                </p>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <KeyRound size={28} className="text-slate-300 mb-3" />
              <p className="text-sm font-semibold text-slate-700">Select a user to manage access</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">Expand a company, pick a user, then toggle modules and actions. Changes save only when you press Save Permissions.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

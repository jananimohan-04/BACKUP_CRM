import { useEffect, useMemo, useState } from 'react';
import { LifeBuoy, PlusCircle, Ticket as TicketIcon, LayoutList } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Modal } from '@/components/ui/Modal';
import { supportApi, moduleLabel, type SupportTicket } from '@/lib/support';
import { supportModules } from '@/lib/support';
import { RaiseTicket, TicketSubmitted } from './RaiseTicket';
import { TicketList } from './TicketList';
import { TicketDetail } from './TicketDetail';

type Tab = 'raise' | 'mine' | 'all';

function useQueryTab(initial: Tab): [Tab, (t: Tab) => void] {
  const [tab, setTab] = useState<Tab>(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    return q === 'mine' || q === 'all' ? (q as Tab) : initial;
  });
  const go = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url.toString());
  };
  return [tab, go];
}

/**
 * Support Center: Raise Ticket, My Tickets, and (for admins) the
 * cross-company All Tickets inbox. Demo video library follows next.
 */
export function SupportCenterPage() {
  const { company, profile, isSuperAdmin, isCompanyAdmin, canDo } = useAuth();
  const [tab, setTab] = useQueryTab('mine');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [justRaised, setJustRaised] = useState<string | null>(null);
  const [adminModule, setAdminModule] = useState('');
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({});

  const isAdmin = isSuperAdmin || isCompanyAdmin;
  const canRaise = typeof canDo === 'function' ? !!canDo('support', 'create') : true;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await supportApi.listTickets();
      setTickets(list);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load tickets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Company names for the admin inbox (RLS: admins may read companies).
  useEffect(() => {
    if (!isAdmin) return;
    let off = false;
    (async () => {
      try {
        const { data } = await supabase.from('companies').select('id,company_name');
        if (off || !data) return;
        const map: Record<string, string> = {};
        (data as any[]).forEach((c) => { map[c.id] = c.company_name; });
        setCompanyNames(map);
      } catch { /* company names stay short-id fallbacks */ }
    })();
    return () => { off = true; };
  }, [isAdmin]);

  const myTickets = useMemo(
    () => tickets.filter((t) => t.created_by_user_id && profile?.id && t.created_by_user_id === profile.id),
    [tickets, profile?.id],
  );

  const adminTickets = useMemo(() => {
    const q = '';
    return tickets.filter((t) => {
      if (adminModule && t.module !== adminModule) return false;
      return true;
    }).filter(() => q === '');
  }, [tickets, adminModule]);

  const opened = tickets.find((t) => t.id === openId) ?? null;
  const companyNameFor = (t: SupportTicket) =>
    t.company_id === company?.id && company?.company_name
      ? company.company_name
      : companyNames[t.company_id] || `Company ${t.company_id.slice(0, 8)}`;

  return (
    <div className="p-4 lg:p-6 space-y-4 bg-slate-50 min-h-full">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800">
          <LifeBuoy size={22} className="text-cyan-600" /> Support Center
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Raise tickets, track progress, and learn features — one place for help.</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm w-fit">
        {canRaise && (
          <button type="button" onClick={() => setTab('raise')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${tab === 'raise' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
            <PlusCircle size={15} /> Raise Ticket
          </button>
        )}
        <button type="button" onClick={() => setTab('mine')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${tab === 'mine' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
          <TicketIcon size={15} /> My Tickets
          <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${tab === 'mine' ? 'bg-white/25' : 'bg-slate-100 text-slate-600'}`}>{myTickets.length}</span>
        </button>
        {isAdmin && (
          <button type="button" onClick={() => setTab('all')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${tab === 'all' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
            <LayoutList size={15} /> All Tickets
            <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${tab === 'all' ? 'bg-white/25' : 'bg-slate-100 text-slate-600'}`}>{tickets.length}</span>
          </button>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {tab === 'raise' && canRaise && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {justRaised ? (
            <TicketSubmitted ticketNo={justRaised} onTrack={() => { setJustRaised(null); setTab('mine'); void load(); }} />
          ) : (
            <RaiseTicket onSubmitted={(no) => { setJustRaised(no); void load(); }} />
          )}
        </div>
      )}

      {tab === 'mine' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <TicketList tickets={myTickets} loading={loading} selectedId={openId} onOpen={(t) => setOpenId(t.id)} />
        </div>
      )}

      {tab === 'all' && isAdmin && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Module filter" value={adminModule} onChange={(e) => setAdminModule(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600">
              <option value="">All modules</option>
              {supportModules().map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <span className="text-[11px] text-slate-400">
              {tickets.length} ticket{tickets.length === 1 ? '' : 's'} visible · {adminModule ? moduleLabel(adminModule) : 'all modules'}
            </span>
          </div>
          <TicketList tickets={adminTickets} loading={loading} selectedId={openId} onOpen={(t) => setOpenId(t.id)} />
        </div>
      )}

      <Modal open={opened !== null} onClose={() => setOpenId(null)} title={opened ? `Ticket ${opened.ticket_no}` : 'Ticket'} size="2xl" width={860}>
        {opened && (
          <TicketDetail
            ticket={opened}
            isAdmin={isSuperAdmin || (isCompanyAdmin && opened.company_id === profile?.company_id)}
            isCreator={!!profile?.id && opened.created_by_user_id === profile.id}
            companyName={companyNameFor(opened)}
            onChanged={() => void load()}
          />
        )}
      </Modal>
    </div>
  );
}

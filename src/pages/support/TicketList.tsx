import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { moduleLabel, TICKET_PRIORITIES, TICKET_STATUSES, type SupportTicket } from '@/lib/support';

export const STATUS_TONES: Record<string, string> = {
  Open: 'bg-sky-100 text-sky-800 border-sky-200',
  'In Review': 'bg-violet-100 text-violet-800 border-violet-200',
  'Need Information': 'bg-amber-100 text-amber-800 border-amber-200',
  'In Progress': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  Resolved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Closed: 'bg-slate-100 text-slate-600 border-slate-200',
};

const PRIORITY_TONES: Record<string, string> = {
  Low: 'text-slate-500',
  Medium: 'text-blue-600',
  High: 'text-orange-600',
  Critical: 'text-red-600',
};

/**
 * Ticket cards with status chips + counts. In admin mode the parent renders
 * extra filters above and passes the already-filtered list down.
 */
export function TicketList({ tickets, loading, onOpen, selectedId }: {
  tickets: SupportTicket[];
  loading: boolean;
  onOpen: (t: SupportTicket) => void;
  selectedId?: string | null;
}) {
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [search, setSearch] = useState('');

  const counts = useMemo(() => {
    const c: Record<string, number> = { Open: 0, 'In Progress': 0, Resolved: 0 };
    tickets.forEach((t) => {
      if (t.status === 'Open') c.Open += 1;
      else if (t.status === 'In Progress') c['In Progress'] += 1;
      else if (t.status === 'Resolved') c.Resolved += 1;
    });
    return c;
  }, [tickets]);

  const shown = tickets.filter((t) => {
    if (status && t.status !== status) return false;
    if (priority && t.priority !== priority) return false;
    const q = search.trim().toLowerCase();
    if (q && !`${t.ticket_no} ${t.subject} ${moduleLabel(t.module)}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {[
          { k: 'Open', n: counts.Open },
          { k: 'In Progress', n: counts['In Progress'] },
          { k: 'Resolved', n: counts.Resolved },
        ].map(({ k, n }) => (
          <button
            key={k}
            type="button"
            onClick={() => setStatus((s) => (s === k ? '' : k))}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${status === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
          >
            {k} <span className="ml-1 tabular-nums">{n}</span>
          </button>
        ))}
        <div className="relative ml-auto flex items-center gap-2">
          <select aria-label="Priority filter" value={priority} onChange={(e) => setPriority(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600">
            <option value="">All priorities</option>
            {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets…"
              className="h-8 rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs w-44" />
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600">
          <option value="">All statuses</option>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(status || priority || search.trim()) && (
          <button type="button" onClick={() => { setStatus(''); setPriority(''); setSearch(''); }}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 underline">Clear filters</button>
        )}
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading tickets…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700">No tickets found.</p>
          <p className="mt-1 text-xs text-slate-500">Raise one from the Raise Ticket tab and track it here.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onOpen(t)}
                className={`w-full rounded-xl border bg-white px-4 py-3 text-left shadow-sm transition-all hover:shadow-md hover:-translate-y-px ${selectedId === t.id ? 'border-brand-400 ring-1 ring-brand-300' : 'border-slate-200'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-500">{t.ticket_no}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_TONES[t.status] ?? STATUS_TONES.Open}`}>{t.status}</span>
                  <span className={`ml-auto text-[11px] font-bold uppercase ${PRIORITY_TONES[t.priority] ?? ''}`}>{t.priority}</span>
                </div>
                <p className="mt-1 text-sm font-bold text-slate-800 line-clamp-1">{t.subject}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Module: {moduleLabel(t.module)} · {new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {t.created_by_name ? ` · by ${t.created_by_name}` : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, Film, Send } from 'lucide-react';
import { Button } from '@/components/ui/Card';
import {
  supportApi, supportDownloadUrl, supportFileUrl, moduleLabel,
  TICKET_STATUSES, type SupportAttachment, type SupportTicket,
} from '@/lib/support';
import { STATUS_TONES } from './TicketList';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Ticket detail: description, attachments (original vs marked, video
 * playback, downloads), reply thread, reply box, and role-aware status
 * controls. All enforcement is backend-side; this only mirrors it.
 */
export function TicketDetail({ ticket, isAdmin, isCreator, companyName, onChanged }: {
  ticket: SupportTicket;
  isAdmin: boolean;
  isCreator: boolean;
  companyName: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<{ comments: any[]; attachments: SupportAttachment[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(ticket.status);
  const [note, setNote] = useState('');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await supportApi.ticketDetail(ticket.id);
      setDetail({ comments: d.comments, attachments: d.attachments });
      setStatus(d.ticket.status);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the ticket.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ticket.id]);

  // Resolve short-lived view URLs lazily per attachment.
  useEffect(() => {
    let off = false;
    const rows = (detail?.attachments ?? []).filter((a) => !urls[a.id]);
    if (!rows.length) return;
    (async () => {
      for (const a of rows) {
        try {
          const u = await supportFileUrl(a.path);
          if (off) return;
          setUrls((prev) => ({ ...prev, [a.id]: u }));
        } catch { /* per-file failure shows a retry below */ }
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const images = useMemo(() => {
    const list = detail?.attachments ?? [];
    const annotated = list.filter((a) => a.kind === 'annotated');
    const originals = list.filter((a) => a.kind === 'original');
    const videos = list.filter((a) => a.kind === 'video');
    const files = list.filter((a) => a.kind !== 'annotated' && a.kind !== 'original' && a.kind !== 'video');
    return { annotated, originals, videos, files };
  }, [detail]);

  const sendReply = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await supportApi.addComment(ticket.id, reply.trim(), isAdmin && internal);
      setReply('');
      setInternal(false);
      await load();
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Could not send the reply.');
    } finally {
      setSending(false);
    }
  };

  const applyStatus = async (next: string, resolutionNote = '') => {
    setActing(true);
    setError('');
    try {
      await supportApi.setStatus(ticket.id, next, resolutionNote);
      setNote('');
      await load();
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Could not update the status.');
    } finally {
      setActing(false);
    }
  };

  const openFile = async (a: SupportAttachment, download: boolean) => {
    try {
      const u = download
        ? await supportDownloadUrl(a.path, a.path.split('/').pop() || 'file')
        : await supportFileUrl(a.path);
      window.open(u, '_blank', 'noopener');
    } catch (e: any) {
      setError(e?.message ?? 'File unavailable.');
    }
  };

  if (loading) return <p className="py-8 text-center text-sm text-slate-500">Loading ticket…</p>;
  if (error && !detail) return <p role="alert" className="py-8 text-center text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-bold text-slate-500">{ticket.ticket_no}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_TONES[ticket.status] ?? STATUS_TONES.Open}`}>
          {detail ? (detail as any).ticket?.status ?? ticket.status : ticket.status}
        </span>
        <span className="text-[11px] font-bold uppercase text-slate-500">{ticket.priority}</span>
        <span className="ml-auto text-[11px] text-slate-400">{companyName} · {fmtDate(ticket.created_at)}</span>
      </div>

      <div>
        <h3 className="text-base font-bold text-slate-900">{ticket.subject}</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Module: {moduleLabel(ticket.module)} · Type: {ticket.issue_type}
          {ticket.created_by_name ? ` · Raised by ${ticket.created_by_name}` : ''}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{ticket.description || '—'}</p>
      </div>

      {(images.annotated.length > 0 || images.originals.length > 0 || images.videos.length > 0 || images.files.length > 0) && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">Attachments</p>
          {images.annotated.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[11px] font-bold text-emerald-700">Marked screenshots</p>
              <div className="grid grid-cols-2 gap-2">
                {images.annotated.map((a) => (
                  <button key={a.id} type="button" onClick={() => void openFile(a, false)} title="Open full size"
                    className="overflow-hidden rounded-lg border border-emerald-200 bg-white hover:shadow">
                    {urls[a.id]
                      ? <img src={urls[a.id]} alt="Marked screenshot" className="h-32 w-full object-cover" />
                      : <span className="block py-8 text-center text-xs text-slate-400">Loading preview…</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {images.originals.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[11px] font-bold text-slate-500">Original screenshots</p>
              <div className="grid grid-cols-3 gap-2">
                {images.originals.map((a) => (
                  <button key={a.id} type="button" onClick={() => void openFile(a, false)} title="Open full size"
                    className="overflow-hidden rounded-lg border border-slate-200 bg-white hover:shadow">
                    {urls[a.id]
                      ? <img src={urls[a.id]} alt="Original screenshot" className="h-20 w-full object-cover" />
                      : <span className="block py-5 text-center text-xs text-slate-400">Loading…</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {images.videos.map((a) => (
            <div key={a.id} className="mb-2 overflow-hidden rounded-lg border border-slate-200 bg-black">
              {urls[a.id]
                ? <video src={urls[a.id]} controls preload="metadata" className="max-h-64 w-full" />
                : <p className="py-6 text-center text-xs text-slate-400">Preparing video…</p>}
            </div>
          ))}
          {images.files.map((a) => (
            <div key={a.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
              <Film size={14} className="text-slate-400 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{a.path.split('/').pop()}</span>
              <button type="button" onClick={() => void openFile(a, false)} title="View"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Eye size={14} /></button>
              <button type="button" onClick={() => void openFile(a, true)} title="Download"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Download size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Conversation ({(detail?.comments ?? []).length})
        </p>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
          {(detail?.comments ?? []).length === 0 && (
            <p className="py-2 text-center text-xs text-slate-400">No replies yet.</p>
          )}
          {(detail?.comments ?? []).map((c: any) => (
            <div key={c.id} className={`rounded-lg border px-2.5 py-1.5 text-xs ${c.is_system ? 'border-slate-200 bg-white text-slate-500 italic' : c.is_internal ? 'border-violet-200 bg-violet-50 text-slate-700' : 'border-slate-200 bg-white text-slate-700'}`}>
              <p className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                <b className="text-slate-600">{c.is_system ? 'System' : c.author_name || '—'}</b>
                <span>{fmtDate(c.created_at)}</span>
                {c.is_internal && <span className="rounded bg-violet-600 px-1 py-px font-bold text-white">INTERNAL</span>}
              </p>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-start gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            placeholder={isAdmin ? 'Reply to the user…' : 'Add more information…'}
            className="min-h-[3.5rem] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm focus:outline-none focus:border-brand-500"
          />
          <Button onClick={() => void sendReply()} disabled={sending || !reply.trim()} icon={<Send size={14} />}
            className="bg-brand-600 hover:bg-brand-700 text-white shrink-0">
            {sending ? 'Sending…' : 'Reply'}
          </Button>
        </div>
        {isAdmin && (
          <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-3.5 w-3.5 accent-violet-600" />
            Internal note (hidden from the ticket creator)
          </label>
        )}
      </div>

      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold">
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution / note (shown on Resolved)" className="h-8 min-w-[10rem] flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs" />
          <Button size="sm" onClick={() => void applyStatus(status, note)} disabled={acting} className="bg-brand-600 hover:bg-brand-700 text-white">
            {acting ? 'Saving…' : 'Update'}
          </Button>
        </div>
      ) : (
        isCreator && (
          <div className="flex flex-wrap items-center gap-2">
            {ticket.status === 'Resolved' && (
              <Button size="sm" onClick={() => void applyStatus('Closed')} disabled={acting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                Confirm solution & close
              </Button>
            )}
            {ticket.status === 'Closed' && (
              <Button size="sm" variant="secondary" onClick={() => void applyStatus('Open')} disabled={acting}>
                Reopen ticket
              </Button>
            )}
          </div>
        )
      )}

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

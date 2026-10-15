import { useMemo, useRef, useState } from 'react';
import { UploadCloud, X, Pencil, Trash2, CheckCircle2, Film } from 'lucide-react';
import { Button } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { AnnotationEditor } from '@/components/support/AnnotationEditor';
import {
  supportApi, supportModules, uploadPending, removePending, fileLimitError,
  TICKET_PRIORITIES, TICKET_ISSUE_TYPES,
  type AttachmentKind, type PendingUpload,
} from '@/lib/support';

interface StagedFile extends PendingUpload {
  id: string;
  annotated?: boolean;
  /** For a marked copy: the id of the screenshot it was drawn on. */
  of?: string;
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

/**
 * Phase 1 — Raise Ticket. Company and reporter come from the signed-in
 * account (never from form fields). Images can be marked up in the annotation
 * editor; the original and the marked copy are both attached.
 */
export function RaiseTicket({ onSubmitted }: { onSubmitted: (ticketNo: string) => void }) {
  const { company, profile } = useAuth();
  const [subject, setSubject] = useState('');
  const [module, setModule] = useState('');
  const [issueType, setIssueType] = useState<string>('Other');
  const [priority, setPriority] = useState<string>('Medium');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [marking, setMarking] = useState<StagedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const modules = useMemo(() => supportModules(), []);
  const reporter = profile?.full_name || profile?.email || '';

  const addFiles = (picked: FileList | File[]) => {
    const list = Array.from(picked || []);
    if (!list.length) return;
    setError('');
    const staged: StagedFile[] = [];
    for (const f of list) {
      const err = fileLimitError(f);
      if (err) { setError(err); continue; }
      const kind: AttachmentKind = f.type.startsWith('video/') ? 'video' : 'original';
      staged.push({ id: uid(), file: f, kind, preview: URL.createObjectURL(f) });
    }
    if (staged.length) setFiles((prev) => [...prev, ...staged]);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      // Removing a screenshot removes its marked copy too.
      const gone = prev.filter((f) => f.id === id || f.of === id);
      gone.forEach((f) => URL.revokeObjectURL(f.preview));
      return prev.filter((f) => f.id !== id && f.of !== id);
    });
  };

  const saveMarked = async (blob: Blob) => {
    if (!marking) return;
    const base = marking.file.name.replace(/\.[a-zA-Z0-9]+$/, '') || 'screenshot';
    const file = new File([blob], `${base}-marked.png`, { type: 'image/png' });
    // One marked copy per screenshot: marking again replaces the previous one instead of adding another.
    setFiles((prev) => {
      prev.filter((f) => f.of === marking.id).forEach((f) => URL.revokeObjectURL(f.preview));
      return [...prev.filter((f) => f.of !== marking.id), { id: uid(), file, kind: 'annotated', preview: URL.createObjectURL(file), of: marking.id }];
    });
    setMarking(null);
  };

  const submit = async () => {
    if (!subject.trim()) { setError('Subject is required.'); return; }
    if (!module) { setError('Choose the ERP module this issue belongs to.'); return; }
    if (!description.trim()) { setError('Description is required.'); return; }
    setBusy(true);
    setError('');
    const uploaded: { path: string; kind: AttachmentKind; mime: string; size: number }[] = [];
    try {
      for (const f of files) {
        const up = await uploadPending(f.file);
        uploaded.push({ path: up.path, kind: f.kind, mime: up.mime, size: up.size });
      }
      const res = await supportApi.createTicket({
        subject: subject.trim(),
        module,
        issue_type: issueType,
        priority,
        description: description.trim(),
        files: uploaded,
      });
      files.forEach((f) => URL.revokeObjectURL(f.preview));
      setSubject('');
      setModule('');
      setIssueType('Other');
      setPriority('Medium');
      setDescription('');
      setFiles([]);
      onSubmitted(res.ticket_no);
    } catch (e: any) {
      // Best-effort cleanup of orphaned uploads so retries never double-attach.
      for (const u of uploaded) {
        try { await removePending(u.path); } catch { /* ignore */ }
      }
      setError(e?.message ?? 'Could not submit the ticket.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Company (from your account)</p>
          <p className="text-sm font-bold text-slate-800">{company?.company_name ?? '—'}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Raised by</p>
          <p className="text-sm font-bold text-slate-800">{reporter || '—'}</p>
        </div>
      </div>

      <FormField label="Subject" required>
        <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short issue title" maxLength={140} />
      </FormField>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <FormField label="ERP Module" required>
          <select className={inputClass} value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">Select module…</option>
            {modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </FormField>
        <FormField label="Issue Type">
          <select className={inputClass} value={issueType} onChange={(e) => setIssueType(e.target.value)}>
            {TICKET_ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
        <FormField label="Priority">
          <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {TICKET_PRIORITIES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
      </div>

      <FormField label="Description" required>
        <textarea className={inputClass} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explain the issue: what you did, what you expected, what happened instead." />
      </FormField>

      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
          Screenshot / Video <span className="font-medium normal-case text-slate-400">(images ≤ 5 MB, videos ≤ 50 MB)</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700">
            <UploadCloud size={15} /> Choose files
            <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { addFiles(e.target.files || []); e.currentTarget.value = ''; }} />
          </label>
          {files.some((f) => f.kind !== 'annotated') && <span className="text-xs text-slate-500">{files.filter((f) => f.kind !== 'annotated').length} attached</span>}
        </div>
        {files.some((f) => f.kind !== 'annotated') && (
          <ul className="mt-2 space-y-1.5">
            {files.filter((f) => f.kind !== 'annotated').map((f) => {
              const marked = files.find((m) => m.of === f.id);
              return (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                {f.kind === 'video'
                  ? <Film size={14} className="text-slate-400 shrink-0" />
                  : <img src={(marked ?? f).preview} alt="" className="h-8 w-8 rounded object-cover border border-slate-200 shrink-0" />}
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{f.file.name}</span>
                {marked && <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 shrink-0" title="The original and your marked copy are both attached">MARKED</span>}
                {f.kind === 'original' && (
                  <button type="button" onClick={() => setMarking(f)} title="Mark on this screenshot (arrows, shapes, text)"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-brand-200 bg-brand-50/50 px-2 py-1 text-[11px] font-bold text-brand-700 hover:border-brand-400">
                    <Pencil size={12} /> {marked ? 'Mark again' : 'Mark'}
                  </button>
                )}
                <button type="button" onClick={() => removeFile(f.id)} title={`Remove ${f.file.name}`}
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 size={14} />
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
        <Button
          disabled={busy}
          onClick={() => void submit()}
          className="bg-brand-600 hover:bg-brand-700 text-white"
        >
          {busy ? 'Submitting…' : 'Submit Ticket'}
        </Button>
      </div>

      <Modal open={marking !== null} onClose={() => setMarking(null)} title="Mark Screenshot" subtitle="Draw on the image, then save — the original stays untouched." size="xl" width={920}>
        {marking && (
          <AnnotationEditor
            src={marking.preview}
            onCancel={() => setMarking(null)}
            onSave={(blob) => void saveMarked(blob)}
          />
        )}
      </Modal>
    </div>
  );
}

export function TicketSubmitted({ ticketNo, onTrack }: { ticketNo: string; onTrack: () => void }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <CheckCircle2 size={40} className="text-emerald-500 mb-3" />
      <p className="text-lg font-bold text-slate-800">Ticket {ticketNo} submitted</p>
      <p className="text-sm text-slate-500 mt-1">The Super Admin has been notified. Track progress under My Tickets.</p>
      <Button onClick={onTrack} className="mt-4 bg-brand-600 hover:bg-brand-700 text-white">Track in My Tickets</Button>
    </div>
  );
}

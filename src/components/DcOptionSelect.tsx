import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useDcOptions, type DcOptionKind } from '@/lib/dcOptions';

// A dropdown of the saved Delivery Challan categories / DC processes, with a "+" to add a new one on the spot.
export function DcOptionSelect({ kind, companyId, value, onChange, className = '', placeholder, label }: {
  kind: DcOptionKind;
  companyId?: string | null;
  value: string;
  onChange: (v: string) => void;
  /** Same look as the neighbouring boxes on the form. */
  className?: string;
  placeholder?: string;
  label?: string;
}) {
  const { options, add } = useDcOptions(kind, companyId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const noun = kind === 'category' ? 'category' : 'DC process';
  // A value saved earlier that is not in the list yet still shows (and stays selected).
  const shown = value && !options.some((o) => o.toLowerCase() === value.trim().toLowerCase()) ? [value, ...options] : options;

  const commit = async () => {
    const name = draft.trim();
    if (!name) { setAdding(false); return; }
    setBusy(true);
    try {
      const saved = await add(name);
      onChange(saved);
      setAdding(false);
      setDraft('');
    } catch (e) {
      alert(`Could not add the ${noun}: ${e instanceof Error ? e.message : e}`);
    } finally { setBusy(false); }
  };

  if (adding) {
    return (
      <span className="inline-flex items-center gap-0.5">
        <input
          autoFocus value={draft} disabled={busy} placeholder={`New ${noun}`} aria-label={`New ${noun}`}
          className={className}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commit(); } if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setDraft(''); } }}
        />
        <button type="button" onClick={() => void commit()} disabled={busy} title="Save" aria-label={`Save ${noun}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded bg-emerald-600 text-white hover:bg-emerald-700"><Check size={13} /></button>
        <button type="button" onClick={() => { setAdding(false); setDraft(''); }} title="Cancel" aria-label="Cancel"
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-500 hover:bg-slate-50"><X size={13} /></button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label ?? noun} className={className}>
        <option value="">{placeholder ?? `Select ${noun}`}</option>
        {shown.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <button type="button" onClick={() => setAdding(true)} title={`Add a new ${noun}`} aria-label={`Add ${noun}`}
        className="inline-flex h-6 w-6 items-center justify-center rounded bg-brand-600 text-white hover:bg-brand-700"><Plus size={13} /></button>
    </span>
  );
}

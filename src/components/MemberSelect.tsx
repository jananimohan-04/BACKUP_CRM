import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Every member name known to the company: users, plus anyone already used on a petty cash inward.
// A name typed once through MemberSelect is saved with its entry and so shows up here from then on.
export function useMemberNames(companyId?: string | null, extra: string[] = []): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let off = false;
    (async () => {
      const [u, p] = await Promise.all([
        supabase.from('company_users').select('full_name,email'),
        supabase.from('cnc_inwards').select('paid_by').eq('petty_cash', true),
      ]);
      if (off) return;
      const all = [
        ...(u.error ? [] : (u.data ?? []).map((x: any) => String(x.full_name || x.email || ''))),
        ...(p.error ? [] : (p.data ?? []).map((x: any) => String(x.paid_by || ''))),
      ];
      setNames(all.map((n) => n.trim()).filter(Boolean));
    })();
    return () => { off = true; };
  }, [companyId]);
  const seen = new Set<string>();
  return [...names, ...extra].map((n) => n.trim()).filter((n) => n && !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

const ADD = '__add_member__';

/** A dropdown of members with "+ Add new member…", which turns into a text box for a name not in the list. */
export function MemberSelect({ value, onChange, options, className = '', placeholder = 'Select member', disabled }: {
  value: string; onChange: (v: string) => void; options: string[]; className?: string; placeholder?: string; disabled?: boolean;
}) {
  const known = options.some((o) => o.toLowerCase() === value.trim().toLowerCase());
  const [adding, setAdding] = useState(false);
  const typing = adding || (!!value && !known);
  if (typing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input autoFocus={adding} disabled={disabled} className={className} placeholder="New member name" value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" title="Pick from the list" className="shrink-0 rounded border border-slate-300 bg-white px-1.5 text-[11px] leading-5 text-slate-600 hover:bg-slate-50"
          onClick={() => { setAdding(false); onChange(''); }}>List</button>
      </span>
    );
  }
  return (
    <select disabled={disabled} className={className} value={value} onChange={(e) => { if (e.target.value === ADD) { setAdding(true); onChange(''); } else onChange(e.target.value); }}>
      <option value="">{placeholder}</option>
      {options.map((n) => <option key={n} value={n}>{n}</option>)}
      <option value={ADD}>+ Add new member…</option>
    </select>
  );
}

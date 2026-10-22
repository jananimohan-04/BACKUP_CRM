import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// The members: people who were ADDED as members (typed through "+ Add new member…"), plus the signed-in user. A name is a member once
// it is used as "Paid by" on a petty cash inward, or as the member on a "Payable to Members" entry. User accounts, companies and
// vendors are not members, so they are not listed.
export function useMemberNames(companyId?: string | null, extra: string[] = []): string[] {
  const { profile } = useAuth();
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let off = false;
    (async () => {
      const [p, tx] = await Promise.all([
        supabase.from('cnc_inwards').select('paid_by').eq('petty_cash', true),
        supabase.from('cnc_bank_transactions').select('party_name,contra_account_id,status').eq('source_type', 'petty_cash').not('party_name', 'is', null),
      ]);
      if (off) return;
      // Bank entries only count when they are on the Payable to Members ledger (an entry "paid to" a vendor is not a member).
      let memberLedgerId = '';
      try {
        const c = await supabase.from('chart_of_accounts').select('id').eq('system_key', 'MEMBER_PAYABLE').maybeSingle();
        memberLedgerId = String((c.data as { id?: string } | null)?.id ?? '');
      } catch { /* ledger not created yet */ }
      const all = [
        ...(p.error ? [] : (p.data ?? []).map((x: any) => String(x.paid_by || ''))),
        ...(tx.error || !memberLedgerId ? [] : (tx.data ?? []).filter((x: any) => String(x.contra_account_id) === memberLedgerId && x.status !== 'Cancelled').map((x: any) => String(x.party_name || ''))),
      ];
      setNames(all.map((n) => n.trim()).filter(Boolean));
    })();
    return () => { off = true; };
  }, [companyId]);
  const seen = new Set<string>();
  return [...names, String(profile?.full_name ?? ''), ...extra].map((n) => n.trim()).filter((n) => n && !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()))
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

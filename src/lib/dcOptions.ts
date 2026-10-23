import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Delivery Challan category and DC process lists. These are their own lists (e.g. "After Process", "SEND FOR SERVICE";
// "Anodizing", "Heat Treatment"), NOT the machine processes of the Process Master. They are read from the database and
// new entries are added with the "+" next to the dropdown. Until migration 20261022000000_dc_options.sql has been run,
// the list is kept on this browser instead (seeded with the common values) so the dropdown works straight away.

export type DcOptionKind = 'category' | 'process';

const TABLE: Record<DcOptionKind, string> = { category: 'cnc_dc_categories', process: 'cnc_dc_processes' };

export const DEFAULT_DC_OPTIONS: Record<DcOptionKind, string[]> = {
  category: ['After Process', 'Cancelled', 'Rejected', 'Returnable', 'REWORK', 'SEND FOR SERVICE', 'Sold', 'Stock', 'Without Process'],
  process: ['Anodizing', 'Blackening', 'CNC Machining', 'Cutting Process', 'Deburring', 'Grinding', 'Hardening', 'Heat Treatment',
    'material+machining', 'None', 'Polishing', 'Surface Coating', 'Tapping', 'Turning Process'],
};

const localKey = (kind: DcOptionKind, companyId?: string | null) => `argus.dcopts.${kind}.${companyId ?? 'all'}`;
const sortNames = (list: string[]) => [...list].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
const dedupe = (list: string[]) => {
  const seen = new Set<string>();
  return list.map((n) => n.trim()).filter((n) => n && !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()));
};

function readLocal(kind: DcOptionKind, companyId?: string | null): string[] {
  try {
    const raw = localStorage.getItem(localKey(kind, companyId));
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return sortNames(dedupe(v.map(String))); }
  } catch { /* storage unavailable: use the defaults */ }
  return sortNames(DEFAULT_DC_OPTIONS[kind]);
}
function writeLocal(kind: DcOptionKind, companyId: string | null | undefined, list: string[]) {
  try { localStorage.setItem(localKey(kind, companyId), JSON.stringify(list)); } catch { /* ignore */ }
}

const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|Could not find the table|schema cache/i.test(String(e.message ?? '')));

export function useDcOptions(kind: DcOptionKind, companyId?: string | null) {
  const [options, setOptions] = useState<string[]>(() => readLocal(kind, companyId));
  const [source, setSource] = useState<'db' | 'local'>('local');

  const load = useCallback(async () => {
    const r = await supabase.from(TABLE[kind]).select('name').order('name');
    if (r.error) { setSource('local'); setOptions(readLocal(kind, companyId)); return; }
    setSource('db');
    setOptions(sortNames(dedupe((r.data ?? []).map((x: { name: string }) => String(x.name ?? '')))));
  }, [kind, companyId]);
  useEffect(() => { void load(); }, [load]);

  /** Adds a value (once, ignoring capitals) and returns the name as stored. */
  const add = useCallback(async (raw: string): Promise<string> => {
    const name = raw.trim();
    if (!name) throw new Error('Enter a name.');
    const existing = options.find((o) => o.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    if (source === 'db') {
      const ins = await supabase.from(TABLE[kind]).insert([{ name }]);
      if (!ins.error) { setOptions((o) => sortNames(dedupe([...o, name]))); return name; }
      if (!isMissingTable(ins.error)) throw new Error(ins.error.message);
      setSource('local');
    }
    const next = sortNames(dedupe([...readLocal(kind, companyId), name]));
    writeLocal(kind, companyId, next);
    setOptions(next);
    return name;
  }, [options, source, kind, companyId]);

  return { options, add, source, reload: load };
}

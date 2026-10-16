// Shared helpers for the ERP-wide global date-range filter.
// All comparisons use YYYY-MM-DD calendar days (inclusive on both ends) so every
// module filters identically, whether its rows carry datetimes or plain dates.

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'all'
  | 'custom';

export const PRESET_LABELS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'all', label: 'All Time' },
];

const pad = (n: number) => String(n).padStart(2, '0');

export const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = (): string => toISODate(new Date());

/** Earliest concrete date used when "All Time" must feed a query needing bounds. */
export const ALL_TIME_START = '2000-01-01';

/** Normalise any date-like value to YYYY-MM-DD, or null when it has no date. */
export function isoDay(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toISODate(value);
  const s = String(value).trim();
  if (!s) return null;
  // Plain YYYY-MM-DD (or datetime starting with it).
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD-MM-YYYY or DD/MM/YYYY.
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : toISODate(t);
}

/** Inclusive range check. Null bounds mean unbounded; records without a date never match an active filter. */
export function inGlobalRange(dateLike: unknown, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  const d = isoDay(dateLike);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** First usable date out of a record, trying each field name in order. */
export function recordDateOf(record: Record<string, unknown> | null | undefined, fields: string[]): string | null {
  if (!record) return null;
  for (const f of fields) {
    const d = isoDay(record[f]);
    if (d) return d;
  }
  return null;
}

/** Concrete { from, to } for a quick-filter preset. 'all' returns nulls (unbounded). */
export function presetRange(preset: Exclude<DatePreset, 'custom'>): { from: string | null; to: string | null } {
  const now = new Date();
  const today = toISODate(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = toISODate(new Date(now.getTime() - 86400000));
      return { from: y, to: y };
    }
    case 'last7':
      return { from: toISODate(new Date(now.getTime() - 6 * 86400000)), to: today };
    case 'last30':
      return { from: toISODate(new Date(now.getTime() - 29 * 86400000)), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toISODate(first), to: toISODate(last) };
    }
    case 'all':
      return { from: null, to: null };
  }
}

/** Intersect a page-local range with the global range. Empty = unbounded.
 *  Under All Time the local range passes through unchanged (existing behaviour). */
export function intersectRange(
  localFrom: string | null | undefined,
  localTo: string | null | undefined,
  globalFrom: string | null | undefined,
  globalTo: string | null | undefined,
): { from: string; to: string } {
  const lf = (localFrom || '').slice(0, 10);
  const lt = (localTo || '').slice(0, 10);
  const gf = (globalFrom || '').slice(0, 10);
  const gt = (globalTo || '').slice(0, 10);
  return {
    from: lf && gf ? (lf > gf ? lf : gf) : lf || gf,
    to: lt && gt ? (lt < gt ? lt : gt) : lt || gt,
  };
}

/** dd/mm/yyyy for compact display. */
export function displayDay(iso: string | null): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

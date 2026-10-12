import type { PriceUnit } from './metalCalc';

// Live metal rates (INR per kg) come from the market_rates table, filled by the
// refresh-metal-rates Edge Function. Only metals a feed actually quotes are listed here;
// steel, stainless, brass etc. stay manual.

export type LiveMetal = 'aluminum' | 'copper' | 'lead' | 'nickel' | 'zinc' | 'gold' | 'silver' | 'platinum' | 'palladium';
export const LIVE_METALS: LiveMetal[] = ['aluminum', 'copper', 'zinc', 'nickel', 'lead', 'silver', 'gold', 'platinum', 'palladium'];

/** calculator material id -> metal in the feed */
export const LIVE_METAL_OF: Record<string, LiveMetal> = {
  aluminium: 'aluminum', copper: 'copper', lead: 'lead', nickel: 'nickel', zinc: 'zinc',
  gold: 'gold', silver: 'silver', platinum: 'platinum', palladium: 'palladium',
};

export interface MarketRate { metal: LiveMetal; inrPerKg: number; fetchedAt: string; quotedAt: string | null }

/** A rate older than this is shown as out of date and not applied automatically. */
export const STALE_AFTER_HOURS = 36;

const PER_KG_TO_UNIT: Record<PriceUnit, number> = { kg: 1, g: 1 / 1000, tonne: 1000, lb: 1 / 2.2046226218 };

/** Display amount with Indian digit grouping, e.g. 74,50,000 or 296.47 (for badges and notes, not for input fields). */
export function inrLabel(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

/** INR per kg -> INR per <unit>, as a plain 2-decimal string for the price field. */
export function rateInUnit(inrPerKg: number, unit: PriceUnit): string {
  const v = inrPerKg * PER_KG_TO_UNIT[unit];
  return String(Number(v.toFixed(v >= 1 ? 2 : 4)));
}

/** Out of date = we have not managed to refresh it for a long time (the feed failed). Markets that are closed
 *  at the weekend keep their last quote, which is still our latest successful fetch. */
export function isStale(r: Pick<MarketRate, 'fetchedAt'>, now = Date.now()): boolean {
  const t = Date.parse(r.fetchedAt);
  return !Number.isFinite(t) || now - t > STALE_AFTER_HOURS * 3600_000;
}

/** Worth asking the server for a refresh (it still decides, and never calls the provider more than every 6 h). */
export function needsRefresh(r: Pick<MarketRate, 'fetchedAt'> | undefined, now = Date.now(), maxHours = 12): boolean {
  if (!r) return true;
  const t = Date.parse(r.fetchedAt);
  return !Number.isFinite(t) || now - t > maxHours * 3600_000;
}

export function ageLabel(iso: string | null, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'time unknown';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Rows from the market_rates table -> typed rates; ignores anything malformed. */
export function parseRates(rows: unknown): Partial<Record<LiveMetal, MarketRate>> {
  const out: Partial<Record<LiveMetal, MarketRate>> = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows as Record<string, unknown>[]) {
    const metal = String(r.metal) as LiveMetal;
    const v = Number(r.inr_per_kg);
    if (!LIVE_METALS.includes(metal) || !Number.isFinite(v) || v <= 0) continue;
    out[metal] = { metal, inrPerKg: v, fetchedAt: String(r.fetched_at ?? ''), quotedAt: r.quoted_at ? String(r.quoted_at) : null };
  }
  return out;
}

/** A short, plain-English reason the rates could not be loaded, so a missing setup step is obvious. */
export function describeRateIssue(step: 'table' | 'function', err: unknown, status?: number, body?: unknown): string {
  const msg = String((err as { message?: unknown } | null)?.message ?? err ?? '');
  const code = String((err as { code?: unknown } | null)?.code ?? '');
  const detail = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : '';
  if (step === 'table') {
    if (code === 'PGRST205' || /schema cache|does not exist|Could not find the table/i.test(msg)) return 'The market_rates table is missing. Run the market_rates migrations in Supabase.';
    if (code === '42501' || /permission denied/i.test(msg)) return 'No permission to read market_rates. Re-run the market_rates migration.';
    return `Could not read market rates: ${msg || 'unknown error'}`;
  }
  if (status === 404) return 'The refresh-metal-rates Edge Function is not deployed in Supabase.';
  if (status === 401 || status === 403) return 'The rate service refused the request (not signed in).';
  if (/METALS_DEV_KEY/.test(detail)) return 'The METALS_DEV_KEY secret is not set for the Edge Function.';
  if (/Metals\.Dev returned HTTP (401|403)/.test(detail)) return 'Metals.Dev rejected the API key. Check METALS_DEV_KEY.';
  if (detail) return `Rate service error: ${detail}`;
  return `Rate service error${status ? ` (HTTP ${status})` : ''}: ${msg || 'unknown'}`;
}

/** "03 Oct 2026, 11:52" in India time (24-hour clock), for showing exactly when a quote was taken. */
export function quoteStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'time unknown';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
}

// Money helpers for accounting screens. Amounts arrive from the database as exact decimal
// strings (numeric(18,2)); they are formatted without going through floating point.

/** Parses "1234.5" / "-12" / 1234.5 into integer paise (BigInt). Invalid input → 0. */
export function toPaise(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  const s = typeof value === 'number' ? value.toFixed(2) : String(value).trim();
  const m = s.match(/^(-)?(\d*)(?:\.(\d*))?$/);
  if (!m) return 0n;
  const [, neg, whole = '', frac = ''] = m;
  const paise = BigInt(whole || '0') * 100n + BigInt((frac + '00').slice(0, 2) || '0');
  return neg ? -paise : paise;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

export interface MoneyFormat {
  /** Prefix with the rupee symbol (default true). */
  symbol?: boolean;
  /** Show paise (default: only when non-zero). */
  decimals?: 'auto' | 'always' | 'never';
  /** Negative style: "-1,000" (default) or accounting "(1,000)". */
  negative?: 'minus' | 'parentheses';
  /** Symbol text (e.g. "Rs." for PDF fonts without the ₹ glyph). */
  symbolText?: string;
}

/** Indian-grouped currency, e.g. "₹ 1,84,50,320" or "(12,500.50)". */
export function formatINR(value: string | number | null | undefined, opts: MoneyFormat = {}): string {
  const { symbol = true, decimals = 'auto', negative = 'minus', symbolText = '₹' } = opts;
  const paise = toPaise(value);
  const isNeg = paise < 0n;
  const abs = isNeg ? -paise : paise;
  const rupees = groupIndian((abs / 100n).toString());
  const p = (abs % 100n).toString().padStart(2, '0');
  const body = decimals === 'always' || (decimals === 'auto' && p !== '00') ? `${rupees}.${p}` : rupees;
  const withSymbol = symbol ? `${symbolText} ${body}` : body;
  if (!isNeg) return withSymbol;
  return negative === 'parentheses' ? `(${withSymbol})` : `-${withSymbol}`;
}

/** Share of a total as "33.9%". Display only; returns "—" when the total is zero. */
export function formatPercent(part: string | number, total: string | number, digits = 1): string {
  const t = toPaise(total);
  if (t === 0n) return '—';
  // Scale in integers first, then a single division for display.
  const pct = Number((toPaise(part) * 100000n) / t) / 1000;
  return `${pct.toFixed(digits)}%`;
}

export const isZero = (value: string | number | null | undefined) => toPaise(value) === 0n;

/** "2026-09-30" → "30 Sep 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Local calendar date as "YYYY-MM-DD" (not UTC, so it is right after midnight in India). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Formats timestamp into "27 Oct 2026, 10:05 AM" */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (String(iso).includes('T') || String(iso).includes(':')) {
      return `${dateStr}, ${timeStr}`;
    }
    return dateStr;
  } catch {
    return String(iso);
  }
}


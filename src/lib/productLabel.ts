// One way to write a product everywhere it is picked: "Product - Company - date time - Qty N".
// Times are on the 24-hour (railway) clock. A product name that already carries its sale date/time
// ("Gear - 14-10-2026 02:31 PM") keeps it, so the company is slotted in before it:
// "Gear - ABC Industries - 14-10-2026 14:31".

const STAMPS = [
  /\s*[-•·]\s*\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?/i,
  /\s*[-•·]\s*\d{2}[A-Za-z]{3}\d{2}[-,]\s*\d{1,2}:?\d{2}(?:\s*[AP]M)?/i,
];

/** "02:31 PM" -> "14:31" inside any date-time text; text already on 24 hours is left alone. */
export function to24Hour(text: string): string {
  return text.replace(/(\d{1,2}):?(\d{2})(?::(\d{2}))?\s*([AP]M)/gi, (_m, h: string, mi: string, s: string | undefined, ap: string) => {
    let hh = Number(h) % 12;
    if (/p/i.test(ap)) hh += 12;
    return `${String(hh).padStart(2, '0')}:${mi}${s ? `:${s}` : ''}`;
  });
}

export function productWithCompany(product: string, company: string, qty?: number | string | null): string {
  const name = String(product ?? '').trim();
  const co = String(company ?? '').trim();
  const n = Number(qty);
  const tail = Number.isFinite(n) && n > 0 ? ` - Qty ${n}` : '';
  if (!co) return to24Hour(name) + tail;
  for (const rx of STAMPS) {
    const m = rx.exec(name);
    if (m) {
      const base = (name.slice(0, m.index) + name.slice(m.index + m[0].length)).trim();
      return `${base} - ${co}${to24Hour(m[0])}${tail}`;
    }
  }
  return `${name} - ${co}${tail}`;
}

/** The product name alone, without the sale date/time it was saved with: what a printed document should show. */
export function productOnly(product: string): string {
  let name = String(product ?? '').trim();
  for (const rx of STAMPS) name = name.replace(rx, '');
  return name.trim();
}

const registeredCompanies = new Set<string>();

/**
 * Register known company names to help disambiguate composite strings like
 * "Product - Company - Date Time".
 */
export function registerKnownCompanies(companies: (string | null | undefined)[]) {
  for (const c of companies) {
    if (c && typeof c === 'string' && c.trim()) {
      registeredCompanies.add(c.trim().toLowerCase());
    }
  }
}

/** Formats a full reference label showing: product name + company name + date/time + qty. */
export function formatFullReference(
  product: string,
  company?: string,
  dateTime?: string,
  qty?: number | string | null
): string {
  const p = String(product || '').trim();
  const c = String(company || '').trim();
  const dt = String(dateTime || '').trim();
  const n = Number(qty);
  let q = '';
  if (Number.isFinite(n) && n > 0) {
    q = `Qty ${n}`;
  } else if (typeof qty === 'string' && qty.trim()) {
    const cleanQ = qty.trim();
    q = /^qty\b/i.test(cleanQ) ? cleanQ : `Qty ${cleanQ}`;
  }
  return [p, c, dt, q].filter(Boolean).join(' - ');
}

/**
 * Splits a composite product label like:
 * - "p1 - 30-09-2026 00:40"
 * - "p1 - ABC Industries - 30-09-2026 00:40"
 * - "p1 • ABC Industries • 30-09-2026 00:40"
 * - "p1 - ABC Industries - 30-09-2026 00:40 - Qty 5"
 * into:
 * { original: "p1", reference: "p1 - ABC Industries - 30-09-2026 00:40 - Qty 5", company: "ABC Industries", dateTime: "30-09-2026 00:40", qty: "5" }
 */
export function splitProductAndRef(
  fullText: string,
  knownCompanies: string[] = [],
  defaultCompany: string = '',
  defaultQty?: number | string | null
): { original: string; reference: string; company?: string; dateTime?: string; qty?: string } {
  let str = String(fullText || '').trim();
  if (!str) return { original: '', reference: '', company: '', dateTime: '', qty: '' };

  // Strip and capture trailing quantity if present: " - Qty 10" or " • Qty 10"
  let qtyStr = '';
  const qtyMatch = /\s*[-•·]\s*Qty\s*(\d+(?:\.\d+)?)\s*$/i.exec(str);
  if (qtyMatch) {
    qtyStr = qtyMatch[1];
    str = str.slice(0, qtyMatch.index).trim();
  } else if (defaultQty != null && defaultQty !== '') {
    qtyStr = String(defaultQty).replace(/^qty\s*/i, '').trim();
  }

  let dt = '';
  let company = '';
  let orig = str;

  for (const rx of STAMPS) {
    const m = rx.exec(str);
    if (m) {
      dt = to24Hour(m[0].replace(/^\s*[-•·]\s*/, '').trim());
      orig = (str.slice(0, m.index) + str.slice(m.index + m[0].length)).trim();
      break;
    }
  }

  if (!dt) {
    const parenMatch = /\s*\(([^)]+)\)\s*$/.exec(str);
    if (parenMatch) {
      orig = str.slice(0, parenMatch.index).trim();
      dt = parenMatch[1].trim();
    }
  }

  // Check for bullet or middle-dot separator: "Product • Company"
  const dotParts = orig.split(/\s*[•·]\s*/);
  if (dotParts.length >= 2) {
    orig = dotParts[0].trim();
    company = dotParts.slice(1).join(' - ').trim();
  } else {
    // Check known companies against dash separation: "Product - Company"
    const compList = [...knownCompanies.map((c) => String(c).trim().toLowerCase()), ...registeredCompanies, String(defaultCompany || '').trim().toLowerCase()].filter(Boolean);
    const knownSet = new Set(compList);
    const dashParts = orig.split(/\s+-\s+/);
    if (dashParts.length >= 2) {
      const last = dashParts[dashParts.length - 1].trim();
      if (knownSet.has(last.toLowerCase())) {
        company = last;
        orig = dashParts.slice(0, -1).join(' - ').trim();
      }
    }
  }

  const effCompany = company || defaultCompany || '';
  const fullRef = (dt || effCompany || qtyStr)
    ? formatFullReference(orig, effCompany, dt, qtyStr)
    : '';

  return {
    original: orig,
    reference: fullRef || dt,
    company: effCompany,
    dateTime: dt,
    qty: qtyStr,
  };
}

/**
 * Combines an original product name and reference back into a canonical product label for database storage.
 */
export function combineProductAndRef(original: string, reference: string): string {
  const o = String(original || '').trim();
  const r = String(reference || '').trim();
  if (!r) return o;
  if (!o) return r;
  // If reference is the full composite "p1 - ABC Industries - 30-09-2026 00:40", extract the timestamp
  for (const rx of STAMPS) {
    const m = rx.exec(r);
    if (m) {
      const dt = to24Hour(m[0].replace(/^\s*[-•·]\s*/, '').trim());
      return `${o} - ${dt}`;
    }
  }
  if (o.toLowerCase().endsWith(r.toLowerCase())) return o;
  return `${o} - ${r}`;
}

// One way to write a product everywhere it is picked: "Product - Company - date time - Qty N".
// Times are on the 24-hour (railway) clock. A product name that already carries its sale date/time
// ("Gear - 14-10-2026 02:31 PM") keeps it, so the company is slotted in before it:
// "Gear - ABC Industries - 14-10-2026 14:31".

const STAMPS = [
  /\s*-\s*\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?/i,
  /\s*-\s*\d{2}[A-Za-z]{3}\d{2}[-,]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?/i,
];

/** "02:31 PM" -> "14:31" inside any date-time text; text already on 24 hours is left alone. */
export function to24Hour(text: string): string {
  return text.replace(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)/gi, (_m, h: string, mi: string, s: string | undefined, ap: string) => {
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

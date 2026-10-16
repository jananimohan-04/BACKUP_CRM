// One way to write a product everywhere it is picked: "Product - Company - date time".
// A product name that already carries its sale date/time ("Gear - 14-10-2026 14:31") keeps it at the end,
// so the company is slotted in between: "Gear - ABC Industries - 14-10-2026 14:31".

const STAMPS = [
  /\s*-\s*\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?/i,
  /\s*-\s*\d{2}[A-Za-z]{3}\d{2}[-,]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?/i,
];

export function productWithCompany(product: string, company: string): string {
  const name = String(product ?? '').trim();
  const co = String(company ?? '').trim();
  if (!co) return name;
  for (const rx of STAMPS) {
    const m = rx.exec(name);
    if (m) {
      const base = (name.slice(0, m.index) + name.slice(m.index + m[0].length)).trim();
      return `${base} - ${co}${m[0]}`;
    }
  }
  return `${name} - ${co}`;
}

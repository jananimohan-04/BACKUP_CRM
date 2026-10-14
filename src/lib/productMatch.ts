// The same product is often typed a little differently on an order, a challan and a costing sheet (spacing, a slipped
// letter). Names whose digits match and whose letters differ by at most two characters are one product.

const stripTimestamp = (s: unknown) => String(s ?? '')
  .replace(/\s*-\s*\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?/i, '')
  .replace(/\s*-\s*\d{2}[A-Za-z]{3}\d{2}[-,]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?/i, '');

const flat = (s: unknown) => stripTimestamp(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const distance = (a: string, b: string) => {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};

export function sameProduct(a: unknown, b: unknown): boolean {
  const x = flat(a); const y = flat(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.replace(/[^0-9]/g, '') !== y.replace(/[^0-9]/g, '')) return false;
  const lx = x.replace(/[0-9]/g, ''); const ly = y.replace(/[0-9]/g, '');
  return Math.min(lx.length, ly.length) >= 6 && Math.abs(lx.length - ly.length) <= 2 && distance(lx, ly) <= 2;
}

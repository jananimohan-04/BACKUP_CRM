import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// Every product already saved anywhere in the system (enquiries, quotations, sales orders, inwards, work orders,
// the parts master), each name once. One shared <datalist id="saved-products"> is mounted for the whole app, so any
// product-name field can offer them with list="saved-products", in add and edit forms alike.

export const SAVED_PRODUCTS_LIST_ID = 'saved-products';

// "Gear - 14-10-2026 02:31 PM" and "Gear - 14Oct26, 2:31PM" are the same product as "Gear".
const stripStamp = (name: string): string => name
  .replace(/\s*-\s*\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?/i, '')
  .replace(/\s*-\s*\d{2}[A-Za-z]{3}\d{2}[-,]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?/i, '')
  .trim();

const isRealName = (n: string) => n.length > 1 && !/^multiple products/i.test(n) && !/\(\d+\s*products?\)\s*$/i.test(n) && n !== '-' && n.toUpperCase() !== 'N/A' && n.toUpperCase() !== 'TBD';

function itemNames(raw: unknown): string[] {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(v)) return v.map((it: any) => String(it?.partName || it?.productName || it?.product_name || it?.part_name || '').trim()).filter(Boolean);
  } catch { /* plain text, not a list of items */ }
  return [];
}

let cache: string[] = [];
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const subs = new Set<(n: string[]) => void>();

export function refreshSavedProducts(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < 15000) return inflight ?? Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    const pick = async (table: string, cols: string) => {
      const r = await supabase.from(table).select(cols).limit(3000);
      return r.error ? [] : ((r.data ?? []) as unknown as Record<string, unknown>[]);
    };
    const [so, qt, enq, inw, wo, parts] = await Promise.all([
      pick('cnc_sales_orders', 'part_name,items'), pick('cnc_quotations', 'part_name,description'), pick('cnc_enquiries', 'part_name,enquiring_for'),
      pick('cnc_inwards', 'product_name,part_name,status'), pick('cnc_work_orders', 'part_name'), pick('cnc_parts', 'part_name'),
    ]);
    const all: string[] = [];
    so.forEach((r) => { all.push(String(r.part_name ?? ''), ...itemNames(r.items)); });
    qt.forEach((r) => { all.push(String(r.part_name ?? ''), ...itemNames(r.description)); });
    enq.forEach((r) => { all.push(String(r.part_name ?? ''), ...itemNames(r.enquiring_for)); });
    inw.forEach((r) => { if (String(r.status ?? '') !== 'Deleted') all.push(String(r.product_name ?? ''), String(r.part_name ?? '')); });
    wo.forEach((r) => all.push(String(r.part_name ?? '')));
    parts.forEach((r) => all.push(String(r.part_name ?? '')));
    const seen = new Map<string, string>();
    for (const raw of all) {
      const n = stripStamp(raw.trim());
      if (!isRealName(n)) continue;
      const k = n.toLowerCase();
      if (!seen.has(k)) seen.set(k, n);
    }
    cache = [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    loadedAt = Date.now();
    subs.forEach((f) => f(cache));
  })().finally(() => { inflight = null; });
  return inflight;
}

export function SavedProductsDatalist() {
  const { company } = useAuth();
  const [names, setNames] = useState<string[]>(cache);
  useEffect(() => {
    subs.add(setNames);
    return () => { subs.delete(setNames); };
  }, []);
  // A different company has different products; also refresh on returning to the tab and every minute.
  useEffect(() => { void refreshSavedProducts(true); }, [company?.id]);
  useEffect(() => {
    const on = () => { void refreshSavedProducts(); };
    window.addEventListener('focus', on);
    const t = window.setInterval(on, 60000);
    return () => { window.removeEventListener('focus', on); window.clearInterval(t); };
  }, []);
  return <datalist id={SAVED_PRODUCTS_LIST_ID}>{names.map((n) => <option key={n} value={n} />)}</datalist>;
}

import { supabase } from '@/lib/supabase';
import { attachDateTimeToProduct, getProductBaseName } from '@/pages/sales/SalesPipelinePage';
import { productWithCompany } from '@/lib/productLabel';

// A product is made of parts. Production and Scheduling plan each PART:
//  * products come from the sales orders (their items) and from the inwards;
//  * the parts of a product are the part lines received on its inwards;
//  * "ordered" is the quantity of that part received, "remaining" is what no production order has taken yet.
// A product with no part lines can still be produced as a whole (the classic product-level order).

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const baseKey = (s: unknown) => norm(getProductBaseName(String(s ?? '')));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** A part order is a production order for one part of a product (never counted as finished product). */
export const isPartOrder = (w: any): boolean => w?.is_part_order === true;
/** Work orders that make up finished product: everything except part orders. */
export const productOrdersOnly = <T,>(rows: T[] | null | undefined): T[] => (rows ?? []).filter((w) => !isPartOrder(w));

// Only material received from a customer is a part to produce: CUSTOMER DC, NEW PART (NEW PROJECT) and NO DC inwards.
// Purchases, services and expenses are not parts. (Same list as the sales kanban's inward cards.)
const PART_INWARD_CATEGORIES = new Set(['CUSTOMER DC', 'DC', 'NO DC', 'NODC', 'NEW PART', 'NEW PROJECT', 'NEWPART', 'NEWPROJECT']);
export const isPartInward = (w: any): boolean => PART_INWARD_CATEGORIES.has(String(w?.category ?? '').toUpperCase().replace(/\s+/g, ' ').trim());

export interface ProductChoice {
  key: string;
  /** Product name as saved on the sales order / inward (carries its sale date and time). */
  name: string;
  customer: string;
  so: any | null;
  soQty: number;
  partNumber: string;
  label: string;
}

export interface PartChoice {
  key: string;
  productKey: string;
  productName: string;
  customer: string;
  so: any | null;
  /** The part, or the product itself for a whole-product order. */
  part: string;
  partNumber: string;
  whole: boolean;
  ordered: number;
  used: number;
  remaining: number;
  label: string;
}

function soItems(so: any): any[] {
  try {
    const raw = so?.items;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* single-product order */ }
  return [{ partName: so?.part_name, quantity: so?.quantity, partNumber: so?.part_number || so?.part_no }];
}

export function buildProductChoices(salesOrders: any[], inwards: any[]): ProductChoice[] {
  const out: ProductChoice[] = [];
  const seen = new Set<string>();
  for (const so of salesOrders ?? []) {
    for (const [i, it] of soItems(so).entries()) {
      const raw = String(it?.partName || it?.productName || it?.part_name || it?.description || '').trim();
      if (!raw) continue;
      const name = attachDateTimeToProduct(raw, so);
      const key = `so:${so.id}:${i}`;
      seen.add(baseKey(name) + '|' + norm(so.order_no));
      out.push({ key, name, customer: String(so.customer ?? ''), so, soQty: num(it?.quantity ?? it?.qty), partNumber: String(it?.partNumber || it?.part_number || '').trim(), label: productWithCompany(name, String(so.customer ?? '')) });
    }
  }
  // Products that exist only on inwards (no sales order item): offered once each, linked to their sales order if the inward names one.
  const soByNo = new Map((salesOrders ?? []).map((s) => [norm(s.order_no), s]));
  for (const w of inwards ?? []) {
    const name = String(w?.product_name ?? '').trim();
    if (!name || w?.status === 'Deleted' || !isPartInward(w)) continue;
    const so = soByNo.get(norm(w?.sales_order_ref)) ?? null;
    const k = baseKey(name) + '|' + norm(so?.order_no);
    if (seen.has(k) || [...seen].some((s) => s.startsWith(baseKey(name) + '|'))) continue;
    seen.add(k);
    out.push({ key: `in:${norm(name)}`, name, customer: String(so?.customer ?? ''), so, soQty: 0, partNumber: '', label: productWithCompany(name, String(so?.customer ?? '')) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export function buildPartChoices(products: ProductChoice[], inwards: any[], workOrders: any[]): PartChoice[] {
  const live = (inwards ?? []).filter((w) => w?.status !== 'Deleted' && isPartInward(w) && String(w?.part_name ?? '').trim());
  const wos = workOrders ?? [];
  const out: PartChoice[] = [];
  for (const p of products) {
    // Part lines received for this product (grouped by part name + number).
    const groups = new Map<string, { part: string; partNumber: string; qty: number }>();
    for (const w of live) {
      if (baseKey(w.product_name) !== baseKey(p.name)) continue;
      const k = `${norm(w.part_name)}|${norm(w.part_number)}`;
      const g = groups.get(k) ?? { part: String(w.part_name).trim(), partNumber: String(w.part_number ?? '').trim(), qty: 0 };
      g.qty += num(w.quantity);
      groups.set(k, g);
    }
    for (const [k, g] of groups) {
      const used = wos.filter((w) => isPartOrder(w) && baseKey(w.product_name) === baseKey(p.name) && norm(w.part_name) === norm(g.part))
        .reduce((s, w) => s + num(w.quantity), 0);
      const remaining = Math.max(0, g.qty - used);
      out.push({
        key: `${p.key}|part:${k}`, productKey: p.key, productName: p.name, customer: p.customer, so: p.so,
        part: g.part, partNumber: g.partNumber, whole: false, ordered: g.qty, used, remaining,
        label: `${g.part} – ${p.label}  ·  Ordered ${g.qty} · Remaining ${remaining}`,
      });
    }
    // The product itself, for orders that are not split into parts (the classic product-level production order).
    if (p.so && p.soQty > 0) {
      const used = wos.filter((w) => !isPartOrder(w) && norm(w.sales_order) === norm(p.so.order_no) && baseKey(w.part_name) === baseKey(p.name))
        .reduce((s, w) => s + num(w.quantity), 0);
      const remaining = Math.max(0, p.soQty - used);
      out.push({
        key: `${p.key}|whole`, productKey: p.key, productName: p.name, customer: p.customer, so: p.so,
        part: p.name, partNumber: p.partNumber, whole: true, ordered: p.soQty, used, remaining,
        label: `Whole product – ${p.label}  ·  Ordered ${p.soQty} · Remaining ${remaining}`,
      });
    }
  }
  return out;
}

/** The production orders that belong to a part choice (a part order for that part, or a whole-product order for the product). */
export function workOrdersForPart(choice: PartChoice, workOrders: any[]): any[] {
  return (workOrders ?? []).filter((w) => choice.whole
    ? !isPartOrder(w) && !!choice.so && norm(w.sales_order) === norm(choice.so.order_no) && baseKey(w.part_name) === baseKey(choice.productName)
    : isPartOrder(w) && baseKey(w.product_name) === baseKey(choice.productName) && norm(w.part_name) === norm(choice.part));
}

const RUN_OPEN = (w: any) => !['Completed', 'Dispatched', 'Cancelled'].includes(String(w?.status)) && !(num(w?.quantity) > 0 && num(w?.completed) >= num(w?.quantity));

/**
 * An actual run is recorded against a production order, but the person only picks the product and part.
 * This reuses the open order for that part (or whole product) and starts one when there is none.
 */
export async function ensureRunWorkOrder(choice: PartChoice, allWos: any[], status = 'In Progress'): Promise<any> {
  const open = workOrdersForPart(choice, allWos).find(RUN_OPEN);
  if (open) return open;
  const d = new Date();
  const prefix = `WO-${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}-`;
  const used = new Set((allWos ?? []).map((w) => w.wo_no));
  let woNo = `${prefix}${Date.now().toString().slice(-4)}`;
  for (let i = 0; used.has(woNo) && i < 50; i++) woNo = `${prefix}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
  const isPart = !choice.whole;
  const fresh: any = {
    id: crypto.randomUUID(), wo_no: woNo, sales_order: choice.so?.order_no ?? '', customer: choice.customer,
    part_name: isPart ? choice.part : choice.productName, part_no: choice.partNumber || 'N/A',
    quantity: choice.ordered, completed: 0, rejected: 0, status, priority: 'Medium',
  };
  if (isPart) { fresh.product_name = choice.productName; fresh.is_part_order = true; }
  const { error } = await supabase.from('cnc_work_orders').insert([fresh]);
  if (error) {
    if (isPart && /product_name|is_part_order/.test(String(error.message))) {
      throw new Error('Part runs need the database update 20261021000000_work_order_parts.sql. Run it in the Supabase SQL Editor, then try again.');
    }
    throw new Error(`Could not record the production for ${choice.part}: ${error.message}`);
  }
  return fresh;
}

/**
 * Parts offered when recording an actual run: each with how many were ordered and how many are still remaining
 * (ordered less what runs have already finished).
 */
export function buildRunPartChoices(salesOrders: any[], inwards: any[], workOrders: any[]): PartChoice[] {
  const products = buildProductChoices(salesOrders, inwards);
  const productLabel = new Map(products.map((p) => [p.key, p.label]));
  return buildPartChoices(products, inwards, workOrders).map((p) => {
    const done = workOrdersForPart(p, workOrders).reduce((n, w) => n + num(w.completed), 0);
    const remaining = Math.max(0, p.ordered - done);
    return { ...p, remaining, label: `${p.whole ? 'Whole product' : p.part} – ${productLabel.get(p.productKey) ?? p.productName}  ·  Ordered ${p.ordered} · Remaining ${remaining}` };
  });
}

// Order quantity reconciliation — the SINGLE source of truth for partial
// production, rejection, batch delivery and invoice quantities.
//
// Authoritative inputs (all live database rows, never frontend memory):
//   ordered    cnc_sales_orders.quantity
//   good       SUM(cnc_work_orders.completed) for the sales order
//   rejected   SUM(cnc_production_batches.rejected_qty), falling back to
//              SUM(cnc_work_orders.rejected) until the batches migration lands
//   delivered  SUM(cnc_deliveries.dispatch_qty) excluding Cancelled/Returned
//   invoiced   SUM(cnc_invoices.quantity) over Sales Invoices minus Credit
//              Notes, excluding cancelled / proforma invoices
//
// Derived (never stored, never mixed):
//   remaining    ordered - good            (still required to produce)
//   fgAvailable  good - delivered          (dispatchable right now)
//   invoiceable  delivered - invoiced      (billable right now)
//
// Rejected quantity never enters FG stock, DC quantity or invoice quantity:
// every downstream computation starts from `good`, never from gross.

import { supabase } from '@/lib/supabase';

export const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const REJECTION_TYPES = [
  'Machine Issue',
  'Dimensional Failure',
  'Surface Defect',
  'Material Defect',
  'Tool Wear',
  'Setup Error',
  'Quality Failure',
  'Other',
] as const;

/** Delivery rows that still count as dispatched. */
export const isActiveDelivery = (d: any) =>
  !['Cancelled', 'Returned', 'Return'].includes(String(d?.status ?? ''));

/** Invoice rows that count toward billed quantity. */
const isBillableInvoice = (i: any) =>
  !i?.cancelled && String(i?.invoice_type ?? 'Sales Invoice') !== 'Proforma Invoice';

const sameText = (a: any, b: any) =>
  a != null && b != null && String(a).trim() !== '' && String(a).trim() === String(b).trim();

export interface OrderProductQty {
  name: string;
  ordered: number;
  good: number;
  rejected: number;
  delivered: number;
  invoiced: number;
  remaining: number;
  available: number;
}

export interface OrderQtySummary {
  soId: string | null;
  soNo: string;
  customer: string;
  product: string;
  ordered: number;
  grossProduced: number;
  good: number;
  rejected: number;
  rework: number;
  remaining: number;
  fgAvailable: number;
  delivered: number;
  invoiced: number;
  invoiceable: number;
  progress: number;
  /** True when at least one work-order row exists for the order. */
  hasProduction: boolean;
  /** True when per-batch rows exist (migration applied). */
  batchesTracked: boolean;
  /** Per-product breakdown (ordered first, then any extra activity).
   *  Remaining/available are computed per item, then aggregated. */
  products: OrderProductQty[];
  batches: any[];
  deliveries: any[];
  invoices: any[];
}

export function summarizeSalesOrder(
  so: any,
  allWos: any[] = [],
  allDeliveries: any[] = [],
  allInvoices: any[] = [],
  allBatches: any[] = [],
): OrderQtySummary {
  const soNo = String(so?.order_no ?? '');
  const soId = so?.id != null ? String(so.id) : null;

  const wos = (allWos || []).filter((w) => sameText(w?.sales_order, soNo));
  const deliveries = (allDeliveries || []).filter(
    (d) => (soId && sameText(d?.sales_order_id, soId)) || sameText(d?.sales_order_no, soNo),
  );
  const activeDeliveries = deliveries.filter(isActiveDelivery);
  const deliveryIds = new Set(deliveries.map((d) => String(d?.id)).filter(Boolean));
  const deliveryNos = new Set(deliveries.map((d) => String(d?.delivery_no || '')).filter(Boolean));
  const invoices = (allInvoices || []).filter(
    (i) =>
      (soId && sameText(i?.sales_order_id, soId)) ||
      (i?.delivery_id != null && deliveryIds.has(String(i.delivery_id))) ||
      (i?.dc_no && deliveryNos.has(String(i.dc_no))),
  );
  const batches = (allBatches || []).filter(
    (b) => sameText(b?.sales_order_no, soNo) || (soId && sameText(b?.sales_order_id, soId)),
  );

  const ordered = num(so?.quantity);
  const good = wos.reduce((s, w) => s + num(w?.completed), 0);
  const woRejected = wos.reduce((s, w) => s + num(w?.rejected), 0);
  const batchesTracked = batches.length > 0;
  // Rejected is additive across both sources: legacy work-order rejections
  // plus traceable batch rejections. (Batches written by current flows carry
  // good-only or batch-only quantities, so nothing double-counts.)
  const batchRejected = batches.reduce((s, b) => s + num(b?.rejected_qty), 0);
  const rejected = woRejected + batchRejected;
  const rework = batches.reduce((s, b) => s + num(b?.rework_qty), 0);
  const grossProduced = batchesTracked
    ? batches.reduce((s, b) => s + num(b?.gross_qty), 0)
    : good + rejected;
  const delivered = activeDeliveries.reduce((s, d) => s + num(d?.dispatch_qty ?? d?.quantity), 0);
  const invoiced = invoices.filter(isBillableInvoice).reduce(
    (s, i) => s + num(i?.quantity) * (String(i?.invoice_type) === 'Credit Note' ? -1 : 1),
    0,
  );

  // Goods already dispatched were necessarily produced, even when no work order recorded them.
  const remaining = Math.max(0, ordered - Math.max(good, delivered) - rejected);
  const fgAvailable = Math.max(0, good - delivered);
  const invoiceable = Math.max(0, delivered - invoiced);

  // ---- per-product breakdown (single source for every card) ----
  const norm = (s: any) => String(s ?? '').trim().toLowerCase();
  const display = new Map<string, string>();
  const orderedBy = new Map<string, number>();
  try {
    const rawItems = (so as any)?.items;
    const parsed = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
    if (Array.isArray(parsed)) {
      for (const it of parsed) {
        const name = String(it.partName || it.productName || it.part_name || it.description || '').trim();
        if (!name) continue;
        const k = norm(name);
        if (!display.has(k)) display.set(k, name);
        orderedBy.set(k, (orderedBy.get(k) ?? 0) + num(it.quantity ?? it.qty));
      }
    }
  } catch { /* products fall back below */ }
  if (orderedBy.size === 0 && String(so?.part_name ?? '').trim() !== '') {
    const name = String(so.part_name).trim();
    display.set(norm(name), name);
    orderedBy.set(norm(name), ordered);
  }
  // Work orders, deliveries and invoices often spell the product a little differently from the order line
  // (spacing, a slipped letter). Such a name is the same product, not a second one.
  const flat = (s: string) => s.replace(/[^a-z0-9]/g, '');
  const dist = (a: string, b: string) => {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  };
  const stripTime = (s: string) => s
    .replace(/\s*-\s*\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?/i, '')
    .replace(/\s*-\s*\d{2}[A-Za-z]{3}\d{2}[-,]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?/i, '')
    .trim();
  const resolve = (k: string): string => {
    if (!k || orderedBy.has(k)) return k;
    const baseK = stripTime(k);
    for (const o of orderedBy.keys()) {
      if (stripTime(o) === baseK) return o;
    }
    const f = flat(baseK); const digits = f.replace(/[^0-9]/g, ''); const letters = f.replace(/[0-9]/g, '');
    for (const o of orderedBy.keys()) {
      const of = flat(stripTime(o));
      if (of === f) return o;
      if (of.replace(/[^0-9]/g, '') === digits) {
        const ol = of.replace(/[0-9]/g, '');
        if (letters.length >= 6 && Math.abs(ol.length - letters.length) <= 2 && dist(ol, letters) <= 2) return o;
      }
    }
    return k;
  };
  const sumBy = (rows: any[], key: (r: any) => string, val: (r: any) => number) => {
    const m = new Map<string, number>();
    for (const r of rows || []) {
      const k = resolve(key(r));
      if (!k) continue;
      if (!display.has(k)) display.set(k, String(r?.part_name ?? r?.product_name ?? r?.description ?? k));
      m.set(k, (m.get(k) ?? 0) + val(r));
    }
    return m;
  };
  const goodBy = sumBy(wos, (w) => norm(w?.part_name), (w) => num(w?.completed));
  const rejByWo = sumBy(wos, (w) => norm(w?.part_name), (w) => num(w?.rejected));
  const rejByBatch = sumBy(batches, (b) => norm(b?.product_name), (b) => num(b?.rejected_qty));
  const rejBy = new Map<string, number>(rejByWo);
  for (const [k, v] of rejByBatch) rejBy.set(k, (rejBy.get(k) ?? 0) + v);
  // Manual rejections entered on the sales order itself (editable Rej Qty).
  try {
    const rawItems = (so as any)?.items;
    const parsed = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
    if (Array.isArray(parsed)) {
      for (const it of parsed) {
        const name = String(it.partName || it.productName || it.part_name || it.description || '').trim();
        if (!name) continue;
        const v = num((it as any).rejectedQty ?? (it as any).rejected_qty ?? (it as any).rejected);
        if (v) {
          const k = norm(name);
          if (!display.has(k)) display.set(k, name);
          rejBy.set(k, (rejBy.get(k) ?? 0) + v);
        }
      }
    }
  } catch { /* manual rejections stay zero */ }
  const delBy = sumBy(activeDeliveries, (d) => norm(d?.part_name), (d) => num(d?.dispatch_qty ?? d?.quantity));
  const invBy = sumBy(
    invoices.filter(isBillableInvoice),
    (i) => norm(i?.part_name),
    (i) => num(i?.quantity) * (String(i?.invoice_type) === 'Credit Note' ? -1 : 1),
  );
  const prodKeys: string[] = [...orderedBy.keys()];
  for (const m of [goodBy, rejBy, delBy, invBy]) {
    for (const k of m.keys()) if (!prodKeys.includes(k)) prodKeys.push(k);
  }
  const products: OrderProductQty[] = prodKeys.map((k) => {
    const o = orderedBy.get(k) ?? 0;
    const gd = goodBy.get(k) ?? 0;
    const rj = rejBy.get(k) ?? 0;
    const dl = delBy.get(k) ?? 0;
    const iv = invBy.get(k) ?? 0;
    return {
      name: display.get(k) ?? k,
      ordered: o, good: gd, rejected: rj, delivered: dl, invoiced: iv,
      remaining: Math.max(0, o - Math.max(gd, dl) - rj),
      available: Math.max(0, gd - dl),
    };
  });

  return {
    soId,
    soNo,
    customer: String(so?.customer ?? so?.customer_name ?? ''),
    product: String(so?.part_name ?? ''),
    ordered,
    grossProduced,
    good,
    rejected,
    rework,
    remaining,
    fgAvailable,
    delivered,
    invoiced,
    invoiceable,
    progress: ordered > 0 ? Math.min(1, good / ordered) : 0,
    hasProduction: wos.length > 0,
    batchesTracked,
    products,
    batches: [...batches].sort((a, b) => String(a?.created_at ?? '').localeCompare(String(b?.created_at ?? ''))),
    deliveries: [...activeDeliveries].sort((a, b) => String(a?.delivery_date ?? a?.created_at ?? '').localeCompare(String(b?.delivery_date ?? b?.created_at ?? ''))),
    invoices: [...invoices].sort((a, b) => String(a?.invoice_date ?? a?.created_at ?? '').localeCompare(String(b?.invoice_date ?? b?.created_at ?? ''))),
  };
}

/** True when the error means "table/column not in the database yet". */
export function isMissingRelation(err: any): boolean {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  return (
    code === 'PGRST205' || code === '42P01' || code === '42703' ||
    /could not find the '(table|column)'/i.test(msg) ||
    /relation .* does not exist/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

/** Fetch live rows for one sales order and reconcile. Never throws for a
 *  missing batches table — traceability degrades, quantities do not. */
export async function fetchOrderQty(
  soId: string | null,
  soNo: string,
): Promise<{ so: any | null; summary: OrderQtySummary | null }> {
  let so: any = null;
  if (soId) {
    const r = await supabase.from('cnc_sales_orders').select('*').eq('id', soId).maybeSingle();
    if (!r.error && r.data) so = r.data;
  }
  if (!so && soNo) {
    const r = await supabase.from('cnc_sales_orders').select('*').eq('order_no', soNo).maybeSingle();
    if (!r.error && r.data) so = r.data;
  }
  if (!so) return { so: null, summary: null };
  const no = String(so.order_no ?? '');
  const id = String(so.id);
  const [woRes, dcRes, invRes, batchRes] = await Promise.all([
    supabase.from('cnc_work_orders').select('*').eq('sales_order', no),
    supabase.from('cnc_deliveries').select('*').or(`sales_order_id.eq.${id},sales_order_no.eq.${no}`),
    supabase.from('cnc_invoices').select('*').eq('sales_order_id', id),
    supabase.from('cnc_production_batches').select('*').or(`sales_order_id.eq.${id},sales_order_no.eq.${no}`).order('created_at'),
  ]);
  const wos = woRes.error ? [] : (woRes.data ?? []);
  const dcs = dcRes.error ? [] : (dcRes.data ?? []);
  // Invoices linked through a DC carry delivery_id instead of sales_order_id.
  let extraInvs: any[] = [];
  try {
    const dcIds = dcs.map((d: any) => d.id).filter(Boolean);
    const dcNos = dcs.map((d: any) => d.delivery_no).filter(Boolean);
    if (dcIds.length > 0) {
      const r = await supabase.from('cnc_invoices').select('*').in('delivery_id', dcIds);
      if (!r.error) extraInvs = [...extraInvs, ...(r.data ?? [])];
    }
    if (dcNos.length > 0) {
      const r = await supabase.from('cnc_invoices').select('*').in('dc_no', dcNos);
      if (!r.error) extraInvs = [...extraInvs, ...(r.data ?? [])];
    }
  } catch { /* invoice linkage stays order-level */ }
  const seen = new Set<string>();
  const invs = [...(invRes.error ? [] : (invRes.data ?? [])), ...extraInvs].filter((i: any) => {
    const k = String(i?.id ?? Math.random());
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const batches = batchRes.error ? [] : (batchRes.data ?? []);
  return { so, summary: summarizeSalesOrder(so, wos, dcs, invs, batches) };
}

export interface BatchPayload {
  salesOrderId?: string | null;
  salesOrderNo?: string | null;
  workOrderId?: string | null;
  woNo?: string | null;
  productName?: string | null;
  partNo?: string | null;
  batchNo: string;
  grossQty: number;
  goodQty: number;
  rejectedQty?: number;
  reworkQty?: number;
  rejectionType?: string | null;
  rejectionReason?: string | null;
  notes?: string | null;
  operation?: string | null;
  machine?: string | null;
  operator?: string | null;
  /** Client-generated UUID per approval session: retries never double-count. */
  idempotencyKey: string;
  createdBy?: string | null;
  /** Executing job card (nullable: rows predate the job-card module). */
  jobCardId?: string | null;
  jobNo?: string | null;
}

/**
 * Persist one production batch. Best-effort until migration
 * 20260929010000_production_batches.sql is applied: quantities already flow
 * through cnc_work_orders, so a missing table only loses traceability.
 * A repeated submit with the same idempotency key is safe (unique index).
 */
export async function recordProductionBatch(
  p: BatchPayload,
): Promise<{ saved: boolean; duplicate?: boolean; pendingMigration?: boolean }> {
  const row: any = {
    sales_order_id: p.salesOrderId ?? null,
    sales_order_no: p.salesOrderNo ?? null,
    work_order_id: p.workOrderId ?? null,
    wo_no: p.woNo ?? null,
    product_name: p.productName ?? null,
    part_no: p.partNo ?? null,
    batch_no: p.batchNo,
    gross_qty: num(p.grossQty),
    good_qty: num(p.goodQty),
    rejected_qty: num(p.rejectedQty),
    rework_qty: num(p.reworkQty),
    rejection_type: p.rejectionType || null,
    rejection_reason: p.rejectionReason || null,
    notes: p.notes || null,
    operation: p.operation || null,
    machine: p.machine || null,
    operator: p.operator || null,
    idempotency_key: p.idempotencyKey,
    created_by: p.createdBy ?? null,
    job_card_id: (p as any).jobCardId ?? null,
    job_no: (p as any).jobNo ?? null,
  };
  let pending: any = row;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.from('cnc_production_batches').insert([pending]);
    if (!error) return { saved: true };
    if (isMissingRelation(error)) {
      // Table (or the job-card link columns) predates this database: without
      // the table only traceability is lost; without the link columns the
      // core batch still saves.
      const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(String((error as any)?.message || ''));
      if (m && (m[1] === 'job_card_id' || m[1] === 'job_no') && Object.prototype.hasOwnProperty.call(pending, m[1])) {
        const c = { ...pending };
        delete c[m[1]];
        pending = c;
        continue;
      }
      console.warn('Production batch traceability skipped (apply migration 20260929010000_production_batches.sql).');
      return { saved: false, pendingMigration: true };
    }
    if (String((error as any)?.code) === '23505') return { saved: true, duplicate: true };
    console.error('Production batch insert failed:', error);
    return { saved: false };
  }
  console.error('Production batch insert failed after retries.');
  return { saved: false };
}

/** Tolerant work-order update: drops keys the cloud schema predates. */
export async function updateWorkOrderTolerant(id: string, patch: Record<string, any>): Promise<void> {
  let remaining = { ...patch };
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase.from('cnc_work_orders').update(remaining).eq('id', id);
    if (!error) return;
    const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(String((error as any)?.message || ''));
    if (m && Object.prototype.hasOwnProperty.call(remaining, m[1])) {
      delete remaining[m[1]];
      continue;
    }
    throw error;
  }
  throw new Error('Work order update failed after retries.');
}

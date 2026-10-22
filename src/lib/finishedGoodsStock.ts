// Finished goods in stock: what production has completed for an order and not yet sent out on a delivery challan.
// Same rule as the pipeline's Finished Goods card: available = good completed - delivered (cancelled / returned challans do not count).

export interface WoLike { is_part_order?: boolean | null; id: string; wo_no?: string | null; sales_order?: string | null; part_name?: string | null; customer?: string | null; completed?: number | string | null; warehouse_id?: string | null }
export interface DcLike { sales_order_no?: string | null; part_name?: string | null; dispatch_qty?: number | string | null; quantity?: number | string | null; status?: string | null }

export interface FgStockRow {
  key: string;
  salesOrder: string;
  product: string;
  customer: string;
  finished: number;
  delivered: number;
  available: number;
  warehouseId: string;      // explicitly chosen warehouse ('' = follows the default)
  woIds: string[];
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const activeDc = (d: DcLike) => !['Cancelled', 'Returned', 'Return'].includes(String(d.status ?? ''));

export function finishedGoodsStock(wos: WoLike[], dcs: DcLike[]): FgStockRow[] {
  const delivered = new Map<string, number>();
  for (const d of dcs) {
    if (!activeDc(d)) continue;
    const k = `${norm(d.sales_order_no)}|${norm(d.part_name)}`;
    delivered.set(k, (delivered.get(k) ?? 0) + num(d.dispatch_qty ?? d.quantity));
  }
  const groups = new Map<string, FgStockRow>();
  for (const w of wos) {
    if (w.is_part_order === true) continue; // a part's completed quantity is not finished product
    const good = num(w.completed);
    if (good <= 0) continue;
    const k = `${norm(w.sales_order)}|${norm(w.part_name)}`;
    const g = groups.get(k) ?? { key: k, salesOrder: String(w.sales_order ?? ''), product: String(w.part_name ?? '').trim(), customer: String(w.customer ?? ''), finished: 0, delivered: 0, available: 0, warehouseId: '', woIds: [] };
    g.finished += good;
    g.woIds.push(String(w.id));
    if (!g.warehouseId && w.warehouse_id) g.warehouseId = String(w.warehouse_id);
    groups.set(k, g);
  }
  const out: FgStockRow[] = [];
  for (const g of groups.values()) {
    g.delivered = delivered.get(g.key) ?? 0;
    g.available = Math.max(0, g.finished - g.delivered);
    if (g.available > 0) out.push(g);
  }
  return out.sort((a, b) => a.product.localeCompare(b.product, undefined, { sensitivity: 'base' }) || a.salesOrder.localeCompare(b.salesOrder));
}

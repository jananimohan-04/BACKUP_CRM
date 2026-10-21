// Types + thin wrappers for the inventory database functions
// (supabase/migrations/20260924000000_inventory.sql). Stock, rates, values and statuses are all
// calculated in the database for the current company; the browser only displays them.
import { supabase } from '@/lib/supabase';
import { formatINR, toPaise } from '@/lib/format';

export type ItemKind = 'RAW' | 'PART';
export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock';
/** Filter value: a status, or 'Reorder' = Low Stock + Out of Stock. */
export type StatusFilter = StockStatus | 'Reorder';
export type Direction = 'IN' | 'OUT' | 'ADJ';

export interface InventoryCategory {
  id: string;
  code: string;
  name: string;
  kind: 'PURCHASED' | 'MANUFACTURED';
  sort_order: number;
}

export interface InventoryLocation {
  id: string;
  code: string;
  name: string;
  warehouse_id: string;
  warehouse_name: string;
}

export interface InventoryFilters {
  company: { id: string; company_name: string };
  categories: InventoryCategory[];
  suppliers: { id: string; name: string }[];
  warehouses: { id: string; code: string; name: string }[];
  locations: InventoryLocation[];
  units: string[];
  can_manage: boolean;
}

export interface InventoryItemRow {
  kind: ItemKind;
  id: string;
  code: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  category_code: string | null;
  specification: string | null;
  unit: string | null;
  current_stock: string;
  min_stock: string;
  reorder_qty: string;
  rate: string;
  value: string;
  status: StockStatus;
  supplier_id: string | null;
  supplier_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  location_id: string | null;
  location_name: string | null;
  image_url: string | null;
  item_status: 'Active' | 'Inactive';
  updated_at: string | null;
}

export interface InventoryItemsPage {
  total: number;
  page: number;
  page_size: number;
  rows: InventoryItemRow[];
}

export interface InventoryItemsQuery {
  categoryId: string | null;
  search: string | null;
  supplierId: string | null;
  status: StatusFilter | null;
  warehouseId: string | null;
  page: number;
  pageSize: number;
}

export interface InventorySummary {
  total_items: number;
  in_stock: number;
  low_stock: number;
  out_of_stock: number;
  to_reorder: number;
  total_value: string;
  by_category: { category_id: string; code: string; name: string; items: number; value: string }[];
}

export interface RecentTransaction {
  id: string;
  txn_date: string;
  type: string;
  direction: Direction;
  qty: string;
  unit: string | null;
  item_kind: ItemKind;
  item_id: string;
  item_code: string;
  item_name: string;
  reference_type: string | null;
  reference_id: string | null;
  reference_no: string | null;
  remarks: string | null;
  created_by: string | null;
}

export interface ItemMovement {
  id: string;
  txn_date: string;
  type: string;
  direction: Direction;
  qty: string;
  unit: string | null;
  rate: string | null;
  balance: string;
  reference_type: string | null;
  reference_id: string | null;
  reference_no: string | null;
  remarks: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface InventoryItemDetail {
  item: InventoryItemRow & { created_at: string | null; grade: string | null; form: string | null };
  movements: ItemMovement[];
}

export interface SaveItemInput {
  id: string | null;
  kind: ItemKind | null;
  code: string;
  name: string;
  category_id: string;
  specification: string;
  unit: string;
  min_stock: string;
  reorder_qty: string;
  rate: string;
  supplier_id: string | null;
  location_id: string | null;
  image_url: string | null;
  status: 'Active' | 'Inactive';
  opening_qty?: string;
  opening_date?: string;
}

export interface ImportRow {
  code: string;
  name: string;
  category: string;
  specification: string;
  unit: string;
  min_stock: string;
  reorder_qty: string;
  rate: string;
  supplier: string;
  location: string;
  opening_qty: string;
}

export interface ImportResult {
  created: number;
  errors: { row: number; code: string | null; message: string }[];
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

async function fallbackSaveImport(rows: ImportRow[], preloadedFilters?: InventoryFilters | null): Promise<ImportResult> {
  let filters = preloadedFilters;
  if (!filters) {
    try { filters = await inventoryApi.filters(); } catch { filters = null; }
  }
  const categories = filters?.categories ?? [];
  const suppliers = filters?.suppliers ?? [];
  const locations = filters?.locations ?? [];

  let created = 0;
  const errors: { row: number; code: string | null; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const n = i + 1;
    if (!r.code?.trim() || !r.name?.trim()) {
      errors.push({ row: n, code: r.code || null, message: 'Item code and name are required' });
      continue;
    }

    // Match category
    const catInput = (r.category || '').trim().toLowerCase();
    let cat = categories.find(c => c.name.toLowerCase() === catInput || c.code.toLowerCase() === catInput);
    if (!cat && catInput) {
      cat = categories.find(c => c.name.toLowerCase().includes(catInput) || catInput.includes(c.name.toLowerCase()));
    }
    if (!cat && categories.length > 0) {
      cat = categories[0];
    }
    if (!cat) {
      errors.push({ row: n, code: r.code, message: `Unknown category "${r.category}"` });
      continue;
    }

    // Match supplier
    let supplierId: string | null = null;
    if (r.supplier?.trim()) {
      const sup = suppliers.find(s => s.name.toLowerCase() === r.supplier.trim().toLowerCase());
      if (sup) supplierId = sup.id;
    }

    // Match location
    let locationId: string | null = null;
    if (r.location?.trim()) {
      const loc = locations.find(l => l.name.toLowerCase() === r.location.trim().toLowerCase() || l.code.toLowerCase() === r.location.trim().toLowerCase());
      if (loc) locationId = loc.id;
    }

    const itemKind: ItemKind = cat.kind === 'MANUFACTURED' ? 'PART' : 'RAW';
    const payload: SaveItemInput = {
      id: null,
      kind: itemKind,
      code: r.code.trim(),
      name: r.name.trim(),
      category_id: cat.id,
      specification: (r.specification || '').trim(),
      unit: (r.unit || 'Nos').trim(),
      min_stock: r.min_stock || '0',
      reorder_qty: r.reorder_qty || '0',
      rate: r.rate || '0',
      supplier_id: supplierId,
      location_id: locationId,
      image_url: null,
      status: 'Active',
      opening_qty: r.opening_qty || '0',
    };

    try {
      await inventoryApi.saveItem(payload);
      created++;
    } catch (e: any) {
      errors.push({ row: n, code: r.code, message: e?.message || 'Failed to save product' });
    }
  }

  return { created, errors };
}

export const inventoryApi = {
  filters: () => call<InventoryFilters>('erp_inventory_filters'),
  items: (q: InventoryItemsQuery) => call<InventoryItemsPage>('erp_inventory_items', {
    p_category_id: q.categoryId, p_search: q.search, p_supplier_id: q.supplierId, p_status: q.status,
    p_warehouse_id: q.warehouseId, p_page: q.page, p_page_size: q.pageSize,
  }),
  summary: () => call<InventorySummary>('erp_inventory_summary'),
  recent: (limit: number) => call<RecentTransaction[]>('erp_inventory_recent', { p_limit: limit }),
  item: (kind: ItemKind, id: string) => call<InventoryItemDetail>('erp_inventory_item', { p_kind: kind, p_id: id }),
  saveItem: (item: SaveItemInput) => call<{ kind: ItemKind; id: string }>('erp_save_inventory_item', { p_item: item }),
  adjustStock: (args: { kind: ItemKind; id: string; direction: 'IN' | 'OUT'; qty: string; reason: string; reference: string; date: string }) =>
    call<{ movement_id: string; new_stock: string }>('erp_adjust_stock', {
      p_kind: args.kind, p_id: args.id, p_direction: args.direction, p_qty: args.qty,
      p_reason: args.reason, p_reference: args.reference, p_date: args.date,
    }),
  transferStock: (args: { kind: ItemKind; id: string; fromWarehouse: string; toWarehouse: string; qty: string; reason: string; reference: string; date: string }) =>
    call<{ reference_no: string; movement_out_id: string | null; movement_in_id: string | null; duplicate: boolean; new_stock: string }>('erp_transfer_stock', {
      p_kind: args.kind, p_id: args.id, p_from_warehouse: args.fromWarehouse, p_to_warehouse: args.toWarehouse,
      p_qty: args.qty, p_reason: args.reason, p_reference: args.reference, p_date: args.date,
    }),
  importItems: async (rows: ImportRow[]): Promise<ImportResult> => {
    let filters: InventoryFilters | null = null;
    try { filters = await inventoryApi.filters(); } catch { filters = null; }

    const normalizedRows: ImportRow[] = rows.map(r => {
      const copy = { ...r };
      const catTrim = (copy.category || '').trim();
      if (filters?.categories && filters.categories.length > 0) {
        const exact = filters.categories.find(c =>
          c.name.trim().toLowerCase() === catTrim.toLowerCase() ||
          c.code.trim().toLowerCase() === catTrim.toLowerCase()
        );
        if (exact) {
          copy.category = exact.name;
        } else {
          const fuzzy = filters.categories.find(c => {
            const cn = c.name.trim().toLowerCase().replace(/s$/, '');
            const ct = catTrim.toLowerCase().replace(/s$/, '');
            return cn === ct || cn.includes(ct) || ct.includes(cn);
          });
          if (fuzzy) {
            copy.category = fuzzy.name;
          } else if (!catTrim) {
            copy.category = filters.categories[0].name;
          }
        }
      }

      if (copy.supplier && filters?.suppliers) {
        const foundSup = filters.suppliers.find(s => s.name.trim().toLowerCase() === copy.supplier.trim().toLowerCase());
        if (!foundSup) copy.supplier = '';
      }

      if (copy.location && filters?.locations) {
        const foundLoc = filters.locations.find(l =>
          l.code.trim().toLowerCase() === copy.location.trim().toLowerCase() ||
          l.name.trim().toLowerCase() === copy.location.trim().toLowerCase()
        );
        if (!foundLoc) copy.location = '';
      }

      return copy;
    });

    try {
      const res = await call<ImportResult>('erp_import_inventory_items', { p_rows: normalizedRows });
      if (res && typeof res.created === 'number' && (res.created > 0 || !res.errors?.length)) {
        return res;
      }
      if (res && res.errors?.length > 0 && res.created === 0) {
        return await fallbackSaveImport(normalizedRows, filters);
      }
      return res || { created: 0, errors: [] };
    } catch (rpcErr) {
      console.warn('erp_import_inventory_items RPC call failed, falling back to direct save:', rpcErr);
      return await fallbackSaveImport(normalizedRows, filters);
    }
  },
};

// ---- Images (private bucket, company-scoped paths) --------------------------------------
export const IMAGE_BUCKET = 'inventory-images';

export async function uploadItemImage(companyId: string, file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${companyId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Signed URLs for stored image paths (path → url). Missing / failed paths are simply absent. */
export async function signedImageUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(unique, 3600);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  data.forEach(d => { if (d.path && d.signedUrl) out[d.path] = d.signedUrl; });
  return out;
}

// ---- Source routes for movement references -------------------------------------------------
export const REFERENCE_ROUTES: Record<string, string> = {
  grn: '/purchasing/goods-receipt',
  material_request: '/inventory/requests',
  work_order: '/production/finished-goods',
  delivery: '/operations/delivery',
  transfer: '/inventory/stock',
};

export const REFERENCE_LABELS: Record<string, string> = {
  grn: 'Goods receipt',
  material_request: 'Material request',
  work_order: 'Work order',
  delivery: 'Delivery',
  adjustment: 'Stock adjustment',
  transfer: 'Stock transfer',
  opening: 'Opening stock',
  golive: 'Go-live balance',
  direct_edit: 'Direct edit',
  legacy: 'Legacy entry',
};

// ---- Display helpers (exact decimal strings, no float math) ---------------------------------

/** Quantity "12345.5000" → "12,345.5" (Indian grouping, up to 3 decimals, trailing zeros trimmed). */
export function formatQty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  const s = typeof value === 'number' ? String(value) : String(value).trim();
  const m = s.match(/^([+-])?(\d*)(?:\.(\d*))?$/);
  if (!m) return s;
  const [, sign, whole = '', frac = ''] = m;
  const f = frac.slice(0, 3).replace(/0+$/, '');
  const grouped = formatINR(whole || '0', { symbol: false, decimals: 'never' });
  const body = f ? `${grouped}.${f}` : grouped;
  const isZeroValue = /^0*$/.test(whole) && /^0*$/.test(f);
  return sign === '-' && !isZeroValue ? `-${body}` : body;
}

/** True when a quantity string is > 0 (valid positive decimal). */
export function isPositiveQty(value: string): boolean {
  const s = value.trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return false;
  return /[1-9]/.test(s);
}

/** Non-negative decimal (empty allowed). */
export function isNonNegativeDecimal(value: string): boolean {
  const s = value.trim();
  return s === '' || /^\d+(\.\d+)?$/.test(s) || /^\.\d+$/.test(s);
}

/** Compact rupees: "₹ 4.29Cr", "₹ 42.86L", or full "₹ 84,500" below one lakh. */
export function formatCompactINR(value: string | number | null | undefined): string {
  const paise = toPaise(value);
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const unit = (div: bigint, suffix: string) => {
    // two decimals, truncated consistently via integer math
    const hundredths = (abs * 100n) / div;
    const whole = hundredths / 100n;
    const frac = (hundredths % 100n).toString().padStart(2, '0');
    return `₹ ${formatINR(whole.toString(), { symbol: false })}.${frac}${suffix}`;
  };
  let out: string;
  if (abs >= 1000000000n) out = unit(1000000000n, 'Cr');
  else if (abs >= 10000000n) out = unit(10000000n, 'L');
  else out = formatINR((abs / 100n).toString());
  return neg ? `-${out}` : out;
}

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

export const IMPORT_COLUMNS: (keyof ImportRow)[] = [
  'code', 'name', 'category', 'specification', 'unit', 'min_stock', 'reorder_qty', 'rate', 'supplier', 'location', 'opening_qty',
];

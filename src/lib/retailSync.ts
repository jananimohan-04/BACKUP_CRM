// ============================================================================
// ERP Inventory ↔ Retail Store API Client
// Secure client communicating via /api/retail-sync (never exposes server secrets)
// ============================================================================

import { supabase } from '@/lib/supabase';
import { isTauri } from '@/lib/desktop/isTauri';

// The deployed Vercel API that serves /api/retail-sync/*. On the web these are
// same-origin relative requests; in the desktop shell the WebView2 origin is
// tauri://localhost (or the dev server), so desktop requests are routed to the
// same production API through tauri-plugin-http — which is scope-restricted to
// this exact origin in src-tauri/capabilities/default.json. Identical request
// bodies, headers and response handling on both platforms; no backend change.
const RETAIL_API_ORIGIN = 'https://with-cnc.vercel.app';

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(RETAIL_API_ORIGIN + path, init);
  }
  return fetch(path, init);
}

export type SyncStatus = 'synced' | 'pending' | 'failed' | 'updated' | 'removed';

export interface SyncProductPayload {
  id: string;
  item_kind?: 'RAW' | 'PART' | 'FG';
  /** The product code / SKU. `sku` is accepted as the same thing. */
  code?: string;
  sku?: string;
  /** Same as the second argument of syncItem: is this product sitting in the Retail Store warehouse? */
  is_retail?: boolean;
  name: string;
  category_id?: string | null;
  category_name?: string | null;
  specification?: string | null;
  unit?: string | null;
  stock: string | number;
  rate?: string | number | null;
  supplier_id?: string | null;
  supplier_name?: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  location_id?: string | null;
  location_name?: string | null;
  status?: 'Active' | 'Inactive' | string;
  image_url?: string | null;
  is_retail_warehouse?: boolean;
}

export interface SyncSummary {
  synced: number;
  pending: number;
  failed: number;
  updated: number;
  removed: number;
  total: number;
}

export interface RetailSyncState {
  ok: boolean;
  connection: 'connected' | 'disconnected' | 'loading';
  storeUrl: string;
  store: {
    name: string;
    code: string;
    companyId: string;
    storeStatus: string;
  } | null;
  metrics: {
    totalProducts: number;
    erpSyncedProducts: number;
    visibleProducts: number;
    pendingContentReview: number;
  } | null;
  syncSummary: SyncSummary;
  designatedWarehouse: {
    warehouse_id: string;
    warehouse_name: string;
  } | null;
  error?: string;
}

export interface RetailSyncLog {
  id: string;
  companyId?: string;
  item_kind: string;
  item_id: string;
  item_code: string;
  item_name: string;
  warehouse_id?: string;
  warehouse_name?: string;
  erp_stock: number;
  retail_stock: number | null;
  sync_status: SyncStatus;
  last_sync_at: string;
  error_message: string | null;
  retry_count: number;
  idempotency_key?: string;
}

// The signed-in user's token, so the server can write to the database as that user.
async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    return t ? { ...extra, Authorization: `Bearer ${t}` } : extra;
  } catch { return extra; }
}

// Memory & localStorage cached designation. `id` is the same as `warehouse_id` (callers use either).
type Designation = { warehouse_id: string; warehouse_name: string; id: string };
const asDesignation = (id: string, name: string): Designation => ({ id, warehouse_id: id, warehouse_name: name });
let cachedDesignation: Designation | null = null;
try {
  const saved = localStorage.getItem('erp_retail_warehouse_designation');
  if (saved) { const j = JSON.parse(saved); cachedDesignation = asDesignation(j.warehouse_id || j.id, j.warehouse_name || ''); }
} catch (e) {}

export const retailSyncApi = {
  /**
   * What is physically in one warehouse for an item: the sum of its stock movements tagged to that warehouse.
   * Movements with no warehouse tag pre-date warehouse tracking and count for the item's own warehouse (`itemWarehouseId`).
   */
  warehouseStock: async (kind: string, itemId: string, warehouseId: string, itemWarehouseId?: string | null): Promise<number> => {
    const r = await supabase.from('cnc_stock_movements').select('qty_change,warehouse_id').eq('item_kind', kind).eq('item_id', itemId);
    if (r.error) throw new Error(r.error.message);
    let total = 0;
    for (const m of (r.data ?? []) as any[]) {
      const wh = m.warehouse_id == null || m.warehouse_id === '' ? (itemWarehouseId ?? null) : String(m.warehouse_id);
      if (wh === warehouseId) total += Number(m.qty_change) || 0;
    }
    return Math.max(0, Math.round(total * 1000) / 1000);
  },

  /**
   * The Retail Store warehouse: the one flagged in the database, else the one chosen on this browser/server,
   * else a warehouse whose name or code says "retail". Always ask this (not the cache) before syncing.
   */
  resolveDesignation: async (): Promise<Designation | null> => {
    // 1. Return cached designation if available
    if (cachedDesignation) return cachedDesignation;

    // 2. Fetch designated warehouse from server status
    try {
      const res = await apiFetch('/api/retail-sync/status', {
        headers: await authHeaders({ 'x-company-id': 'C-ARGUS' })
      });
      if (res.ok) {
        const j = await res.json();
        if (j?.designatedWarehouse?.warehouse_id) {
          cachedDesignation = asDesignation(
            j.designatedWarehouse.warehouse_id,
            j.designatedWarehouse.warehouse_name || 'Retail Store Warehouse'
          );
          try { localStorage.setItem('erp_retail_warehouse_designation', JSON.stringify(cachedDesignation)); } catch (e) {}
          return cachedDesignation;
        }
      }
    } catch (e) {}

    // 3. Fallback to Supabase database query
    try {
      const r = await supabase.from('cnc_warehouses').select('id,code,name,status,is_retail_store');
      if (!r.error) {
        const rows = ((r.data ?? []) as any[]).filter((w) => String(w.status ?? 'Active') !== 'Inactive');
        const flagged = rows.find((w) => w.is_retail_store === true);
        const named = rows.find((w) => /retail/i.test(`${w.name ?? ''} ${w.code ?? ''}`));
        const pick = flagged ?? (cachedDesignation && rows.find((w) => String(w.id) === cachedDesignation!.warehouse_id)) ?? named;
        if (pick) {
          cachedDesignation = asDesignation(String(pick.id), String(pick.name ?? pick.code ?? 'Retail Store Warehouse'));
          try { localStorage.setItem('erp_retail_warehouse_designation', JSON.stringify(cachedDesignation)); } catch (e) {}
          return cachedDesignation;
        }
      }
      const plain = await supabase.from('cnc_warehouses').select('id,code,name,status');
      const named = ((plain.data ?? []) as any[]).find((w) => String(w.status ?? 'Active') !== 'Inactive' && /retail/i.test(`${w.name ?? ''} ${w.code ?? ''}`));
      if (named) {
        cachedDesignation = asDesignation(String(named.id), String(named.name ?? named.code ?? 'Retail Store Warehouse'));
        try { localStorage.setItem('erp_retail_warehouse_designation', JSON.stringify(cachedDesignation)); } catch (e) {}
      }
    } catch (e) {}
    return cachedDesignation;
  },

  /**
   * Check connection status and get summary stats
   */
  getStatus: async (companyId: string = 'C-ARGUS'): Promise<RetailSyncState> => {
    try {
      const res = await apiFetch('/api/retail-sync/status', {
        headers: await authHeaders({ 'x-company-id': companyId })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // The database / warehouse list is the source of truth for which warehouse is the retail one.
      const d = await retailSyncApi.resolveDesignation();
      return { ...data, designatedWarehouse: d ? { warehouse_id: d.warehouse_id, warehouse_name: d.warehouse_name } : (data.designatedWarehouse ?? null) };
    } catch (err: any) {
      return {
        ok: false,
        connection: 'disconnected',
        storeUrl: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_RETAIL_STORE_URL) || (import.meta.env?.PROD ? 'https://retail.arguscnc.com' : 'http://localhost:4000'),
        store: null,
        metrics: null,
        syncSummary: { synced: 0, pending: 0, failed: 0, updated: 0, removed: 0, total: 0 },
        designatedWarehouse: cachedDesignation,
        error: err.message
      };
    }
  },

  /**
   * Synchronize an individual item to Retail Store
   */
  syncItem: async (
    item: SyncProductPayload,
    isRetailWarehouse?: boolean,
    companyId: string = 'C-ARGUS'
  ): Promise<{ ok: boolean; action?: string; product?: any; error?: string; dbLogged?: boolean; dbError?: string | null }> => {
    try {
      const rawSku = item.code || item.sku || (item as any).part_number || (item as any).part_no || (item as any).item_code || (item as any).itemCode || (item as any).product || item.id || '';
      let sku = String(rawSku).trim();
      if (!sku) {
        const namePart = (item.name || (item as any).part_name || 'ITEM').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ITEM';
        sku = `SKU-${namePart}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
      }

      const des = cachedDesignation || await retailSyncApi.resolveDesignation();
      const isRetail = isRetailWarehouse ?? item.is_retail ?? item.is_retail_warehouse ?? true;
      const whName = item.warehouse_name && item.warehouse_name !== 'Other Warehouse'
        ? item.warehouse_name
        : (des?.warehouse_name || 'Retail Store Warehouse');

      const payload = {
        erp_item_id: item.id,
        sku,
        name: item.name || (item as any).part_name || sku,
        category: item.category_id || undefined,
        category_name: item.category_name || undefined,
        uom: item.unit || 'Pc',
        stock: Number(item.stock || 0),
        warehouse: whName,
        warehouse_id: item.warehouse_id || des?.warehouse_id || null,
        specification: item.specification || '',
        specs: item.specification ? { 'Specification': item.specification } : {},
        rate: item.rate != null ? Number(item.rate) : null,
        image_url: item.image_url || null,
        status: item.status || 'Active',
        is_retail_warehouse: isRetail,
        companyId,
        idempotency_key: `erp-sync-${item.id || sku}-${Date.now()}`
      };

      const res = await apiFetch('/api/retail-sync/sync-item', {
        method: 'POST',
        headers: await authHeaders({
          'Content-Type': 'application/json',
          'x-company-id': companyId,
          'x-idempotency-key': payload.idempotency_key
        }),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync request failed');
      return data;
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  },

  /**
   * Batch synchronize products to Retail Store
   */
  syncBatch: async (
    items: SyncProductPayload[],
    companyId: string = 'C-ARGUS'
  ): Promise<{ ok: boolean; batchResult?: any; error?: string }> => {
    try {
      const des = cachedDesignation || await retailSyncApi.resolveDesignation();
      const formattedItems = items.map(item => {
        const rawSku = item.code || item.sku || (item as any).part_number || (item as any).part_no || (item as any).item_code || (item as any).itemCode || (item as any).product || item.id || '';
        let sku = String(rawSku).trim();
        if (!sku) {
          const namePart = (item.name || (item as any).part_name || 'ITEM').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ITEM';
          sku = `SKU-${namePart}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
        }
        return {
          erp_item_id: item.id,
          sku,
          name: item.name || (item as any).part_name || sku,
          category: item.category_id || undefined,
          category_name: item.category_name || undefined,
          uom: item.unit || 'Pc',
          stock: Number(item.stock || 0),
          warehouse: (item.warehouse_name && item.warehouse_name !== 'Other Warehouse') ? item.warehouse_name : (des?.warehouse_name || 'Retail Store Warehouse'),
          warehouse_id: item.warehouse_id || des?.warehouse_id || null,
          specification: item.specification || '',
          specs: item.specification ? { 'Specification': item.specification } : {},
          rate: item.rate != null ? Number(item.rate) : null,
          image_url: item.image_url || null,
          status: item.status || 'Active',
          is_retail_warehouse: item.is_retail_warehouse !== false,
          companyId
        };
      });

      const res = await apiFetch('/api/retail-sync/sync-all', {
        method: 'POST',
        headers: await authHeaders({
          'Content-Type': 'application/json',
          'x-company-id': companyId
        }),
        body: JSON.stringify({ companyId, items: formattedItems })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch sync failed');
      return data;
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  },

  /**
   * Fetch sync audit logs
   */
  getLogs: async (
    companyId: string = 'C-ARGUS',
    status?: string,
    q?: string
  ): Promise<RetailSyncLog[]> => {
    try {
      const db = await supabase.from('cnc_retail_sync_logs').select('*').order('last_sync_at', { ascending: false }).limit(500);
      if (!db.error) {
        const needle = (q || '').toLowerCase();
        return ((db.data ?? []) as any[])
          .filter((l) => (!status || status === 'all' || l.sync_status === status) && (!needle || `${l.item_code} ${l.item_name}`.toLowerCase().includes(needle)))
          .map((l) => ({
            id: String(l.id), item_kind: l.item_kind, item_id: l.item_id, item_code: l.item_code, item_name: l.item_name,
            warehouse_id: l.warehouse_id ?? undefined, warehouse_name: l.warehouse_name ?? undefined,
            erp_stock: Number(l.erp_stock) || 0, retail_stock: l.retail_stock == null ? null : Number(l.retail_stock),
            sync_status: l.sync_status, last_sync_at: l.last_sync_at, error_message: l.error_message ?? null,
            retry_count: Number(l.retry_count) || 0, idempotency_key: l.idempotency_key ?? undefined,
          })) as RetailSyncLog[];
      }
    } catch (e) { /* table not created yet: use the server log below */ }
    try {
      const params = new URLSearchParams({ companyId });
      if (status && status !== 'all') params.set('status', status);
      if (q) params.set('q', q);

      const res = await apiFetch(`/api/retail-sync/logs?${params.toString()}`, {
        headers: { 'x-company-id': companyId }
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.logs || [];
    } catch (e) {
      return [];
    }
  },

  /**
   * Designate the Retail Store warehouse
   */
  designateWarehouse: async (
    warehouseId: string,
    warehouseName: string,
    companyId: string = 'C-ARGUS'
  ): Promise<boolean> => {
    try {
      // The database is where the choice must live (the server's file is lost on a redeploy).
      const rpc = await supabase.rpc('erp_designate_retail_warehouse', { p_warehouse_id: warehouseId });
      if (rpc.error) console.warn('Retail warehouse not saved in the database (run migration 20261020000000_retail_store_sync.sql):', rpc.error.message);
      const res = await apiFetch('/api/retail-sync/designate-warehouse', {
        method: 'POST',
        headers: await authHeaders({
          'Content-Type': 'application/json',
          'x-company-id': companyId
        }),
        body: JSON.stringify({ warehouse_id: warehouseId, warehouse_name: warehouseName, companyId })
      });
      if (res.ok || !rpc.error) {
        cachedDesignation = asDesignation(warehouseId, warehouseName);
        try { localStorage.setItem('erp_retail_warehouse_designation', JSON.stringify(cachedDesignation)); } catch (e) {}
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  },

  /**
   * Checks whether a given warehouse is the designated Retail Store warehouse
   */
  isDesignatedWarehouse: (
    warehouseId: string | null | undefined,
    warehouseName?: string | null
  ): boolean => {
    // 1. Check explicit designation
    if (cachedDesignation && warehouseId && cachedDesignation.warehouse_id === warehouseId) {
      return true;
    }
    // 2. Fallback to name heuristic if no explicit designation set yet
    if (warehouseName && /retail/i.test(warehouseName)) {
      return true;
    }
    // 3. If designation exists and item has no explicit warehouse, assume default designated warehouse
    if (cachedDesignation && !warehouseId) {
      return true;
    }
    return false;
  },

  /**
   * Returns current designated warehouse
   */
  getDesignatedWarehouse: () => cachedDesignation
};

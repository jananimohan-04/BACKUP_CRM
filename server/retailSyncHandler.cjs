/**
 * ERP Inventory ↔ Retail Store Production-Ready Integration Handler
 * Handles all /api/retail-sync/* requests across environments:
 * - Vercel Serverless Function (api/retail-sync.js)
 * - Standalone Node.js server (server/sync-server.cjs)
 * - Vite dev server middleware (vite.config.ts)
 *
 * Keeps API secrets strictly on the server (never exposed to frontend).
 */

const fs = require('fs');
const path = require('path');

// Durable file-backed sync store as a reliable fallback/cache alongside Supabase
const LOGS_FILE = path.join(__dirname, 'retail_sync_logs.json');
let syncLogs = [];
try {
  if (fs.existsSync(LOGS_FILE)) {
    syncLogs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
  }
} catch (e) {
  syncLogs = [];
}

function saveLogs() {
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(syncLogs.slice(0, 1000), null, 2), 'utf8');
  } catch (e) {}
}

// Config from environment variables. Nothing secret is written in the code:
//   RETAIL_STORE_API_BASE_URL   where the retail store runs (default http://localhost:4000)
//   RETAIL_STORE_API_KEY        the shared ERP <-> retail key (also read from ERP_INTEGRATION_KEY); required
//   RETAIL_COMPANY_ID           the company code the retail store knows this ERP company by (default C-ARGUS)
//   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY   the ERP database (also read as SUPABASE_URL / SUPABASE_ANON_KEY)
//   SUPABASE_SERVICE_ROLE_KEY + ERP_COMPANY_ID   only for the retail store's order webhook (/order-deduct):
//                                                the ERP company (uuid) whose stock a retail order reduces
const env = (...names) => { for (const n of names) if (process.env[n]) return process.env[n]; return ''; };
const RETAIL_STORE_API_BASE_URL = env('RETAIL_STORE_API_BASE_URL') || (process.env.NODE_ENV === 'production' ? 'https://retail.arguscnc.com' : 'http://localhost:4000');
const RETAIL_STORE_API_KEY = env('RETAIL_STORE_API_KEY', 'ERP_INTEGRATION_KEY');
const RETAIL_COMPANY_ID = env('RETAIL_COMPANY_ID') || 'C-ARGUS';
const SUPABASE_URL = env('VITE_SUPABASE_URL', 'SUPABASE_URL');
const SUPABASE_ANON_KEY = env('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ERP_COMPANY_ID = env('ERP_COMPANY_ID');
const NOT_CONFIGURED = 'RETAIL_STORE_API_KEY is not set on the server, so the Retail Store cannot be reached. Add it to the server environment (.env.local for local dev).';

// Designated warehouse storage per company (persistent fallback)
const DESIGNATIONS_FILE = path.join(__dirname, 'retail_warehouse_designations.json');
let designations = {};
function loadDesignations() {
  try {
    if (fs.existsSync(DESIGNATIONS_FILE)) {
      designations = JSON.parse(fs.readFileSync(DESIGNATIONS_FILE, 'utf8'));
    }
  } catch (e) {}
  return designations || {};
}
loadDesignations();

function saveDesignations() {
  try {
    fs.writeFileSync(DESIGNATIONS_FILE, JSON.stringify(designations, null, 2), 'utf8');
  } catch (e) {}
}

// Helper: parse body if not parsed
async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// Call a Supabase RPC. `token` is the signed-in user's JWT (the functions work out the company from it);
// the service-role call for the order webhook passes the service key instead.
async function callSupabaseRpc(fn, args, token, apiKey) {
  if (!SUPABASE_URL || !(apiKey || SUPABASE_ANON_KEY)) return { ok: false, error: 'Supabase URL / key not configured on the server' };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'apikey': apiKey || SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token || apiKey || SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args || {})
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await res.text() };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const bearer = (req) => String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || '';
const sameKey = (a, b) => {
  if (!a || !b) return false;
  try { return require('crypto').timingSafeEqual(Buffer.from(String(a)), Buffer.from(String(b))); } catch { return false; }
};

/**
 * Main request router for /api/retail-sync
 */
async function handleRetailSyncRequest(req, res) {
  loadDesignations();
  // Extract path relative to /api/retail-sync
  const urlObj = new URL(req.url, 'http://localhost');
  let subpath = urlObj.pathname.replace(/^\/api\/retail-sync/, '');
  if (!subpath || subpath === '') subpath = '/';

  const method = req.method.toUpperCase();

  // 1. GET /api/retail-sync/status
  if (method === 'GET' && (subpath === '/status' || subpath === '/')) {
    const companyId = req.headers['x-company-id'] || 'C-ARGUS';
    if (!RETAIL_STORE_API_KEY) return sendJson(res, 200, { ok: false, connection: 'disconnected', storeUrl: RETAIL_STORE_API_BASE_URL, error: NOT_CONFIGURED, syncSummary: { synced: 0, pending: 0, failed: 0, updated: 0, removed: 0, total: 0 }, designatedWarehouse: designations[companyId] || null });
    try {
      const storeRes = await fetch(`${RETAIL_STORE_API_BASE_URL}/api/integrations/erp/status`, {
        headers: {
          'x-erp-api-key': RETAIL_STORE_API_KEY,
          'x-company-id': RETAIL_COMPANY_ID
        }
      });

      let storeData = null;
      if (storeRes.ok) {
        const j = await storeRes.json();
        storeData = j.data || j;
      }

      // Compute summary from durable logs
      const coLogs = syncLogs.filter(l => !l.companyId || l.companyId === companyId);
      const summary = {
        synced: coLogs.filter(l => l.sync_status === 'synced').length,
        pending: coLogs.filter(l => l.sync_status === 'pending').length,
        failed: coLogs.filter(l => l.sync_status === 'failed').length,
        updated: coLogs.filter(l => l.sync_status === 'updated').length,
        removed: coLogs.filter(l => l.sync_status === 'removed').length,
        total: coLogs.length
      };

      return sendJson(res, 200, {
        ok: true,
        connection: storeRes.ok ? 'connected' : 'disconnected',
        storeUrl: RETAIL_STORE_API_BASE_URL,
        store: storeData?.store || null,
        metrics: storeData?.metrics || null,
        syncSummary: summary,
        designatedWarehouse: designations[companyId] || null
      });
    } catch (err) {
      return sendJson(res, 200, {
        ok: false,
        connection: 'disconnected',
        storeUrl: RETAIL_STORE_API_BASE_URL,
        error: err.message,
        syncSummary: {
          synced: syncLogs.filter(l => l.sync_status === 'synced').length,
          pending: syncLogs.filter(l => l.sync_status === 'pending').length,
          failed: syncLogs.filter(l => l.sync_status === 'failed').length,
          updated: syncLogs.filter(l => l.sync_status === 'updated').length,
          removed: syncLogs.filter(l => l.sync_status === 'removed').length,
          total: syncLogs.length
        },
        designatedWarehouse: designations[companyId] || null
      });
    }
  }

  // 2. POST /api/retail-sync/sync-item
  if (method === 'POST' && subpath === '/sync-item') {
    const body = await parseBody(req);
    const companyId = req.headers['x-company-id'] || body.companyId || 'C-ARGUS';
    if (!RETAIL_STORE_API_KEY) return sendJson(res, 503, { ok: false, error: NOT_CONFIGURED });

    // Resilient SKU extraction across all possible fields
    const rawSku = body.sku || body.code || body.part_number || body.part_no || body.item_code || body.itemCode || body.product || body.erp_item_id || body.id || '';
    let sku = String(rawSku).trim();
    if (!sku) {
      const namePart = (body.name || body.item_name || 'ITEM').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ITEM';
      sku = `SKU-${namePart}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    }
    body.sku = sku;
    body.code = body.code || sku;
    body.name = body.name || body.item_name || body.part_name || sku;

    // Resilient warehouse handling
    const des = designations[companyId];
    if (!body.warehouse || body.warehouse === 'Other Warehouse') {
      body.warehouse = des?.warehouse_name || 'Retail Store Warehouse';
    }
    if (body.is_retail_warehouse === undefined) {
      body.is_retail_warehouse = true;
    }
    const idempotencyKey = req.headers['x-idempotency-key'] || body.idempotency_key || `erp-sync-${sku}-${Date.now()}`;

    try {
      const storeRes = await fetch(`${RETAIL_STORE_API_BASE_URL}/api/integrations/erp/sync-product`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-erp-api-key': RETAIL_STORE_API_KEY,
          'x-company-id': RETAIL_COMPANY_ID,
          'x-idempotency-key': idempotencyKey
        },
        body: JSON.stringify({
          ...body,
          companyId: RETAIL_COMPANY_ID
        })
      });

      const storeJson = await storeRes.json();
      if (!storeRes.ok) {
        throw new Error(storeJson.error || `Retail Store responded with ${storeRes.status}`);
      }

      const syncResult = storeJson.data || storeJson;
      const status = syncResult.action === 'deactivated' ? 'removed' :
        syncResult.action === 'updated' ? 'updated' : 'synced';

      // Record in durable sync log
      const logEntry = {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        companyId,
        item_kind: body.item_kind || 'PART',
        item_id: body.erp_item_id || body.id || '',
        item_code: body.sku || body.code || '',
        item_name: body.name || '',
        warehouse_id: body.warehouse_id || '',
        warehouse_name: body.warehouse || '',
        erp_stock: Number(body.stock || 0),
        retail_stock: Number(syncResult.product?.stock ?? body.stock ?? 0),
        sync_status: status,
        last_sync_at: new Date().toISOString(),
        error_message: null,
        retry_count: 0,
        idempotency_key: idempotencyKey
      };

      // Upsert in local syncLogs
      const existingIdx = syncLogs.findIndex(l => l.item_code === logEntry.item_code && l.companyId === companyId);
      if (existingIdx >= 0) syncLogs[existingIdx] = { ...syncLogs[existingIdx], ...logEntry };
      else syncLogs.unshift(logEntry);
      saveLogs();

      // Persist to the database as the signed-in user (awaited, so a failure is reported instead of lost)
      const token = bearer(req);
      let dbLogged = false, dbError = null;
      if (token && logEntry.item_id && logEntry.item_code) {
        const r = await callSupabaseRpc('erp_record_retail_sync', { p_entry: logEntry }, token);
        dbLogged = r.ok; dbError = r.ok ? null : r.error;
      }

      return sendJson(res, 200, {
        ok: true,
        action: syncResult.action,
        product: syncResult.product,
        log: logEntry,
        dbLogged,
        dbError
      });
    } catch (err) {
      // Record failure in log
      const failedEntry = {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        companyId,
        item_kind: body.item_kind || 'PART',
        item_id: body.erp_item_id || body.id || '',
        item_code: body.sku || body.code || '',
        item_name: body.name || '',
        warehouse_id: body.warehouse_id || '',
        warehouse_name: body.warehouse || '',
        erp_stock: Number(body.stock || 0),
        retail_stock: null,
        sync_status: 'failed',
        last_sync_at: new Date().toISOString(),
        error_message: err.message,
        retry_count: 1,
        idempotency_key: idempotencyKey
      };

      const existingIdx = syncLogs.findIndex(l => l.item_code === failedEntry.item_code && l.companyId === companyId);
      if (existingIdx >= 0) {
        failedEntry.retry_count = (syncLogs[existingIdx].retry_count || 0) + 1;
        syncLogs[existingIdx] = { ...syncLogs[existingIdx], ...failedEntry };
      } else {
        syncLogs.unshift(failedEntry);
      }
      saveLogs();
      const token = bearer(req);
      if (token && failedEntry.item_id && failedEntry.item_code) {
        await callSupabaseRpc('erp_record_retail_sync', { p_entry: failedEntry }, token);
      }

      return sendJson(res, 400, { ok: false, error: err.message, log: failedEntry });
    }
  }

  // 3. POST /api/retail-sync/sync-all (Bulk synchronization)
  if (method === 'POST' && subpath === '/sync-all') {
    const body = await parseBody(req);
    const companyId = req.headers['x-company-id'] || body.companyId || 'C-ARGUS';
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!RETAIL_STORE_API_KEY) return sendJson(res, 503, { ok: false, error: NOT_CONFIGURED });

    const des = designations[companyId];
    const items = rawItems.map(it => {
      const rawSku = it.sku || it.code || it.part_number || it.part_no || it.item_code || it.itemCode || it.product || it.erp_item_id || it.id || '';
      let sku = String(rawSku).trim();
      if (!sku) {
        const namePart = (it.name || it.item_name || 'ITEM').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ITEM';
        sku = `SKU-${namePart}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
      }
      return {
        ...it,
        sku,
        code: it.code || sku,
        name: it.name || it.item_name || it.part_name || sku,
        warehouse: (it.warehouse && it.warehouse !== 'Other Warehouse') ? it.warehouse : (des?.warehouse_name || 'Retail Store Warehouse'),
        is_retail_warehouse: it.is_retail_warehouse !== false
      };
    });

    try {
      const storeRes = await fetch(`${RETAIL_STORE_API_BASE_URL}/api/integrations/erp/sync-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-erp-api-key': RETAIL_STORE_API_KEY,
          'x-company-id': RETAIL_COMPANY_ID,
          'x-idempotency-key': `batch-${Date.now()}`
        },
        body: JSON.stringify({
          companyId: RETAIL_COMPANY_ID,
          items
        })
      });

      const storeJson = await storeRes.json();
      if (!storeRes.ok) {
        throw new Error(storeJson.error || `Retail Store responded with ${storeRes.status}`);
      }

      const result = storeJson.data || storeJson;

      // Update sync logs for items
      for (const it of items) {
        const status = it.is_retail_warehouse !== false ? 'synced' : 'removed';
        const existingIdx = syncLogs.findIndex(l => l.item_code === it.sku && l.companyId === companyId);
        const entry = {
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          companyId,
          item_kind: it.item_kind || 'PART',
          item_id: it.erp_item_id || it.id || '',
          item_code: it.sku || it.code || '',
          item_name: it.name || '',
          warehouse_id: it.warehouse_id || '',
          warehouse_name: it.warehouse || '',
          erp_stock: Number(it.stock || 0),
          retail_stock: Number(it.stock || 0),
          sync_status: status,
          last_sync_at: new Date().toISOString(),
          error_message: null,
          retry_count: 0
        };
        if (existingIdx >= 0) syncLogs[existingIdx] = { ...syncLogs[existingIdx], ...entry };
        else syncLogs.unshift(entry);
      }
      saveLogs();

      return sendJson(res, 200, { ok: true, batchResult: result });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  // 4. GET /api/retail-sync/logs
  if (method === 'GET' && subpath === '/logs') {
    const companyId = req.headers['x-company-id'] || urlObj.searchParams.get('companyId') || 'C-ARGUS';
    const status = urlObj.searchParams.get('status');
    const q = (urlObj.searchParams.get('q') || '').toLowerCase();

    let list = syncLogs.filter(l => !companyId || l.companyId === companyId);
    if (status && status !== 'all') {
      list = list.filter(l => l.sync_status === status);
    }
    if (q) {
      list = list.filter(l => (l.item_code + ' ' + l.item_name).toLowerCase().includes(q));
    }
    return sendJson(res, 200, { ok: true, logs: list });
  }

  // 5. POST /api/retail-sync/designate-warehouse
  if (method === 'POST' && subpath === '/designate-warehouse') {
    const body = await parseBody(req);
    const companyId = req.headers['x-company-id'] || body.companyId || 'C-ARGUS';
    const warehouseId = body.warehouse_id;
    const warehouseName = body.warehouse_name || 'Retail Store Warehouse';

    if (!warehouseId) {
      return sendJson(res, 400, { error: 'warehouse_id is required' });
    }

    designations[companyId] = {
      warehouse_id: warehouseId,
      warehouse_name: warehouseName,
      designated_at: new Date().toISOString()
    };
    saveDesignations();

    const token = bearer(req);
    let dbSaved = false, dbError = null;
    if (token) {
      const r = await callSupabaseRpc('erp_designate_retail_warehouse', { p_warehouse_id: String(warehouseId) }, token);
      dbSaved = r.ok; dbError = r.ok ? null : r.error;
    }

    return sendJson(res, 200, { ok: true, designation: designations[companyId], dbSaved, dbError });
  }

  // 6. POST /api/retail-sync/order-deduct (the Retail Store reports an order; the ERP stock is reduced)
  if (method === 'POST' && subpath === '/order-deduct') {
    if (!RETAIL_STORE_API_KEY) return sendJson(res, 503, { success: false, error: NOT_CONFIGURED });
    if (!sameKey(req.headers['x-erp-api-key'], RETAIL_STORE_API_KEY)) {
      return sendJson(res, 401, { success: false, error: 'Unauthorized: Invalid ERP integration key' });
    }
    if (!SUPABASE_SERVICE_ROLE_KEY || !ERP_COMPANY_ID) {
      return sendJson(res, 503, { success: false, error: 'Order deduction is not configured: set SUPABASE_SERVICE_ROLE_KEY and ERP_COMPANY_ID on the server. No stock was changed.' });
    }

    const body = await parseBody(req);
    const { order_id, items, customer } = body;
    if (!order_id || !Array.isArray(items) || !items.length) {
      return sendJson(res, 400, { success: false, error: 'order_id and items[] are required' });
    }

    const rpcRes = await callSupabaseRpc('erp_retail_deduct_stock_service', {
      p_company: ERP_COMPANY_ID,
      p_deduction: {
        order_id: String(order_id),
        items,
        customer: customer || 'Retail Store Order',
        idempotency_key: body.idempotency_key || `erp-deduct-${order_id}`
      }
    }, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_ROLE_KEY);

    if (rpcRes.ok && rpcRes.data?.success) {
      return sendJson(res, 200, rpcRes.data);
    }
    // Refused (unknown item, not enough stock, database function missing...): say so, so the store does not treat it as done.
    let msg = rpcRes.error || 'Stock could not be deducted';
    try { const j = JSON.parse(msg); msg = j.message || msg; } catch (e) { /* plain text */ }
    return sendJson(res, rpcRes.status && rpcRes.status < 500 ? 409 : 502, { success: false, order_id, error: msg, note: 'No ERP stock was changed.' });
  }

  // 404 for unknown subpaths
  return sendJson(res, 404, { error: `Unknown endpoint /api/retail-sync${subpath}` });
}

module.exports = {
  handleRetailSyncRequest,
  RETAIL_STORE_API_BASE_URL
};

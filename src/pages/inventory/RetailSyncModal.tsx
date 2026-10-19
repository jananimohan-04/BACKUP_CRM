import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Store, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock,
  ExternalLink, Search, ArrowRight, ShieldCheck, Warehouse, ArrowUpDown, Loader2
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import {
  retailSyncApi,
  type RetailSyncState,
  type RetailSyncLog,
  type SyncStatus
} from '@/lib/retailSync';
import { formatQty } from '@/lib/inventory';

interface RetailSyncModalProps {
  open: boolean;
  onClose: () => void;
  warehouses: { id: string; code: string; name: string }[];
  allInventoryRows?: any[];
  companyId?: string;
  onSyncCompleted?: () => void;
}

export function RetailSyncModal({
  open,
  onClose,
  warehouses,
  allInventoryRows = [],
  companyId = 'C-ARGUS',
  onSyncCompleted
}: RetailSyncModalProps) {
  const [syncState, setSyncState] = useState<RetailSyncState | null>(null);
  const [logs, setLogs] = useState<RetailSyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingItemId, setSyncingItemId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SyncStatus>('all');
  const [selectedWhId, setSelectedWhId] = useState<string>('');
  const [savingWh, setSavingWh] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load status and logs
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const state = await retailSyncApi.getStatus(companyId);
      setSyncState(state);
      const logList = await retailSyncApi.getLogs(companyId);
      setLogs(logList);

      if (state.designatedWarehouse?.warehouse_id) {
        setSelectedWhId(state.designatedWarehouse.warehouse_id);
      } else {
        // Find default matching retail
        const matching = warehouses.find(w => /retail/i.test(w.name) || /retail/i.test(w.code));
        if (matching) setSelectedWhId(matching.id);
      }
    } catch (e: any) {
      setBannerMsg({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [companyId, warehouses]);

  useEffect(() => {
    if (open) void loadData();
  }, [open, loadData]);

  // Handle warehouse designation change
  const handleSaveDesignation = async () => {
    if (!selectedWhId) return;
    const wh = warehouses.find(w => w.id === selectedWhId);
    if (!wh) return;

    setSavingWh(true);
    setBannerMsg(null);
    try {
      const ok = await retailSyncApi.designateWarehouse(wh.id, wh.name, companyId);
      if (ok) {
        setBannerMsg({ type: 'success', text: `Warehouse "${wh.name}" is now designated as the Retail Store warehouse.` });
        await loadData();
      } else {
        setBannerMsg({ type: 'error', text: 'Failed to update designated warehouse.' });
      }
    } finally {
      setSavingWh(false);
    }
  };

  // Sync single product on demand
  const handleSyncItem = async (logOrItem: any) => {
    const isRetailWh = retailSyncApi.isDesignatedWarehouse(
      logOrItem.warehouse_id,
      logOrItem.warehouse_name
    );

    setSyncingItemId(logOrItem.item_id || logOrItem.id);
    setBannerMsg(null);
    try {
      const res = await retailSyncApi.syncItem({
        id: logOrItem.item_id || logOrItem.id,
        item_kind: logOrItem.item_kind || 'PART',
        code: logOrItem.item_code || logOrItem.code || logOrItem.part_number || logOrItem.part_no || logOrItem.product || '',
        name: logOrItem.item_name || logOrItem.name || logOrItem.part_name || logOrItem.product || '',
        stock: logOrItem.erp_stock ?? logOrItem.current_stock ?? logOrItem.stock ?? 0,
        warehouse_id: logOrItem.warehouse_id,
        warehouse_name: logOrItem.warehouse_name,
        specification: logOrItem.specification,
        status: logOrItem.status || logOrItem.item_status || 'Active'
      }, isRetailWh, companyId);

      if (res.ok) {
        setBannerMsg({ type: 'success', text: `Product ${logOrItem.item_code || logOrItem.code || logOrItem.part_number || 'item'} synchronized successfully (${res.action}).` });
        await loadData();
        onSyncCompleted?.();
      } else {
        setBannerMsg({ type: 'error', text: res.error || 'Sync failed.' });
      }
    } finally {
      setSyncingItemId(null);
    }
  };

  // Bulk sync all qualifying products
  const handleSyncAll = async () => {
    setSyncingAll(true);
    setBannerMsg(null);
    try {
      // Find all rows currently in the designated retail warehouse
      const designatedWhId = syncState?.designatedWarehouse?.warehouse_id || selectedWhId;
      const qualifying = (allInventoryRows || []).filter(r => {
        return (designatedWhId && r.warehouse_id === designatedWhId) ||
          /retail/i.test(r.warehouse_name || '');
      });

      if (qualifying.length === 0) {
        setBannerMsg({ type: 'error', text: 'No products currently assigned to the designated Retail Store warehouse.' });
        return;
      }

      const res = await retailSyncApi.syncBatch(qualifying.map(r => ({
        id: r.id,
        item_kind: r.kind || 'PART',
        code: r.code || r.part_number || r.part_no || r.item_code || r.product || '',
        name: r.name || r.part_name || r.product || '',
        category_id: r.category_id,
        category_name: r.category_name,
        specification: r.specification,
        unit: r.unit,
        stock: r.current_stock ?? r.stock ?? 0,
        rate: r.rate,
        warehouse_id: r.warehouse_id,
        warehouse_name: r.warehouse_name,
        status: r.item_status || r.status || 'Active',
        is_retail_warehouse: true
      })), companyId);

      if (res.ok) {
        const stats = res.batchResult || {};
        setBannerMsg({
          type: 'success',
          text: `Batch completed: ${stats.created || 0} created, ${stats.updated || 0} updated, ${stats.deactivated || 0} deactivated.`
        });
        await loadData();
        onSyncCompleted?.();
      } else {
        setBannerMsg({ type: 'error', text: res.error || 'Batch sync failed.' });
      }
    } finally {
      setSyncingAll(false);
    }
  };

  // Filter logs for display
  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      if (statusFilter !== 'all' && l.sync_status !== statusFilter) return false;
      if (search) {
        const txt = (l.item_code + ' ' + l.item_name + ' ' + (l.warehouse_name || '')).toLowerCase();
        if (!txt.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [logs, statusFilter, search]);

  const summary = syncState?.syncSummary || {
    synced: 0, pending: 0, failed: 0, updated: 0, removed: 0, total: 0
  };

  const isConnected = syncState?.connection === 'connected';

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Retail Store Integration & Synchronization"
      subtitle="Server-to-server product catalog synchronization and stock consistency"
      footer={
        <div className="flex items-center justify-between w-full">
          {(() => {
            const defStore = (typeof import.meta !== 'undefined' && (import.meta.env as any)?.VITE_RETAIL_STORE_URL) || ((import.meta.env as any)?.PROD ? 'https://retail.arguscnc.com' : 'http://localhost:4000');
            return (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                <span>Store Base: <code className="font-mono">{syncState?.storeUrl || defStore}</code></span>
              </div>
            );
          })()}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {bannerMsg && (
          <div className={`p-3 rounded-lg text-sm flex items-center justify-between ${bannerMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            <span>{bannerMsg.text}</span>
            <button onClick={() => setBannerMsg(null)} className="text-xs font-bold underline ml-3">Dismiss</button>
          </div>
        )}

        {/* 1. Header Cards & Warehouse Designation */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Connection status card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Retail Connection</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-600' : 'bg-red-600'}`} />
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <p className="text-sm font-semibold text-slate-800">{syncState?.store?.name || 'Retail Store'}</p>
            <p className="text-xs text-slate-500">Company: <b className="text-slate-700">{companyId}</b></p>
          </div>

          {/* Designated Retail Warehouse selector */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 md:col-span-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mb-1.5">
              <Warehouse size={14} className="text-blue-600" />
              Designated Retail Store Warehouse
            </span>
            <div className="flex items-center gap-2">
              <select
                className="flex-1 h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={selectedWhId}
                onChange={e => setSelectedWhId(e.target.value)}
              >
                <option value="">— Select Designated Warehouse —</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code}) {syncState?.designatedWarehouse?.warehouse_id === w.id ? '★ Current' : ''}
                  </option>
                ))}
              </select>
              <button
                disabled={savingWh || !selectedWhId || selectedWhId === syncState?.designatedWarehouse?.warehouse_id}
                onClick={handleSaveDesignation}
                className="h-9 px-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors shrink-0"
              >
                {savingWh ? <Loader2 size={13} className="animate-spin" /> : 'Save Designation'}
              </button>
            </div>
          </div>
        </div>

        {/* 2. KPI Summary Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div
            onClick={() => setStatusFilter('synced')}
            className={`p-2.5 rounded-xl border cursor-pointer transition-all ${statusFilter === 'synced' ? 'bg-emerald-50 border-emerald-300 shadow-sm' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
          >
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 size={12} className="text-emerald-600" /> Synced
            </p>
            <p className="text-xl font-bold text-emerald-700 mt-1">{summary.synced}</p>
            <p className="text-[10px] text-slate-400">Available in store</p>
          </div>

          <div
            onClick={() => setStatusFilter('updated')}
            className={`p-2.5 rounded-xl border cursor-pointer transition-all ${statusFilter === 'updated' ? 'bg-blue-50 border-blue-300 shadow-sm' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
          >
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <RefreshCw size={12} className="text-blue-600" /> Updated
            </p>
            <p className="text-xl font-bold text-blue-700 mt-1">{summary.updated}</p>
            <p className="text-[10px] text-slate-400">Stock updated</p>
          </div>

          <div
            onClick={() => setStatusFilter('pending')}
            className={`p-2.5 rounded-xl border cursor-pointer transition-all ${statusFilter === 'pending' ? 'bg-amber-50 border-amber-300 shadow-sm' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
          >
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Clock size={12} className="text-amber-600" /> Pending
            </p>
            <p className="text-xl font-bold text-amber-700 mt-1">{summary.pending}</p>
            <p className="text-[10px] text-slate-400">Content review</p>
          </div>

          <div
            onClick={() => setStatusFilter('failed')}
            className={`p-2.5 rounded-xl border cursor-pointer transition-all ${statusFilter === 'failed' ? 'bg-red-50 border-red-300 shadow-sm' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
          >
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <XCircle size={12} className="text-red-600" /> Failed
            </p>
            <p className="text-xl font-bold text-red-700 mt-1">{summary.failed}</p>
            <p className="text-[10px] text-slate-400">Requires retry</p>
          </div>

          <div
            onClick={() => setStatusFilter('removed')}
            className={`p-2.5 rounded-xl border cursor-pointer transition-all ${statusFilter === 'removed' ? 'bg-slate-100 border-slate-400 shadow-sm' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
          >
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle size={12} className="text-slate-500" /> Excluded
            </p>
            <p className="text-xl font-bold text-slate-700 mt-1">{summary.removed}</p>
            <p className="text-[10px] text-slate-400">Moved / inactive</p>
          </div>
        </div>

        {/* 3. Toolbar & Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search synchronized SKU or product name…"
                className="w-full h-9 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {statusFilter !== 'all' && (
              <button
                onClick={() => setStatusFilter('all')}
                className="px-2.5 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
              >
                Clear filter ({statusFilter})
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={handleSyncAll}
              disabled={syncingAll || !isConnected}
              className="h-9 px-3.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {syncingAll ? <Loader2 size={13} className="animate-spin" /> : <Store size={14} />}
              Sync All Retail Products
            </button>
          </div>
        </div>

        {/* 4. Synchronized Products Table */}
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white max-h-[380px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="px-3 py-2.5">Product & SKU</th>
                <th className="px-3 py-2.5">Warehouse</th>
                <th className="px-3 py-2.5 text-center">ERP Stock</th>
                <th className="px-3 py-2.5 text-center">Store Stock</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Last Sync</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.length > 0 ? (
                filteredLogs.map(log => {
                  const statusCls =
                    log.sync_status === 'synced' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    log.sync_status === 'updated' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    log.sync_status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    log.sync_status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                    'bg-slate-100 text-slate-600 border-slate-200';

                  const isItemBusy = syncingItemId === log.item_id;

                  return (
                    <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2.5 font-medium text-slate-800">
                        <div>{log.item_name}</div>
                        <div className="font-mono text-[10px] text-slate-500">{log.item_code}</div>
                        {log.error_message && (
                          <div className="text-[10px] text-red-600 mt-0.5 line-clamp-1" title={log.error_message}>
                            Error: {log.error_message}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {log.warehouse_name || 'Retail Warehouse'}
                      </td>
                      <td className="px-3 py-2.5 text-center font-bold text-slate-900">
                        {formatQty(log.erp_stock)}
                      </td>
                      <td className="px-3 py-2.5 text-center font-medium text-slate-700">
                        {log.retail_stock != null ? formatQty(log.retail_stock) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border capitalize ${statusCls}`}>
                          {log.sync_status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 text-[11px] whitespace-nowrap">
                        {new Date(log.last_sync_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <button
                          disabled={isItemBusy || !isConnected}
                          onClick={() => handleSyncItem(log)}
                          className="px-2 py-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 mr-1"
                        >
                          {isItemBusy ? <Loader2 size={11} className="inline animate-spin mr-0.5" /> : null}
                          Sync
                        </button>
                        <a
                          href={`${syncState?.storeUrl || ((typeof import.meta !== 'undefined' && (import.meta.env as any)?.VITE_RETAIL_STORE_URL) || ((import.meta.env as any)?.PROD ? 'https://retail.arguscnc.com' : 'http://localhost:4000'))}/#/admin/products`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded inline-flex items-center gap-0.5"
                          title="Open in Retail Store Content Writer view"
                        >
                          Store <ExternalLink size={10} />
                        </a>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    {loading ? (
                      <span className="flex items-center justify-center gap-1.5"><Loader2 size={16} className="animate-spin text-blue-600" /> Loading synchronization status…</span>
                    ) : (
                      <div>
                        <p className="font-medium text-slate-600">No synchronized products matching filters</p>
                        <p className="text-xs text-slate-400 mt-1">Assign products to the designated Retail Store warehouse or click "Sync All Retail Products" above.</p>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

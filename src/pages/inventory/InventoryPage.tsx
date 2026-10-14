import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Upload, Download, ChevronDown, Plus, Box, Layers, AlertTriangle, XCircle, Package,
  Pencil, MoreVertical, Eye, History, SlidersHorizontal, ChevronLeft, ChevronRight, Building2, Loader2,
  ExternalLink, FileSpreadsheet, AlertCircle, Info, ArrowLeftRight, Factory, Archive, Search,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import {
  inventoryApi, signedImageUrls, uploadItemImage, formatQty, formatCompactINR, isPositiveQty, isNonNegativeDecimal,
  parseCsv, IMPORT_COLUMNS, REFERENCE_ROUTES, REFERENCE_LABELS,
  type InventoryFilters, type InventoryItemsPage, type InventoryItemRow, type InventorySummary, type RecentTransaction,
  type StockStatus, type StatusFilter, type Direction, type InventoryItemDetail, type ItemKind, type ImportRow, type ImportResult,
} from '@/lib/inventory';
import { formatDate, formatINR, formatPercent, toPaise, todayISO } from '@/lib/format';
import { exportCsv } from '@/lib/reportExport';
import { useFinishedGoods, WarehouseMasterModal } from './FinishedGoodsStock';

// ---------------------------------------------------------------------------------------
// Inventory. Stock, rates, values and statuses all come from the database
// (erp_inventory_* functions). This page never calculates stock or money itself.
// ---------------------------------------------------------------------------------------

interface FilterState {
  search: string;
  categoryId: string; // '' = all
  supplierId: string;
  status: '' | StatusFilter;
  warehouseId: string;
}

const EMPTY_FILTERS: FilterState = { search: '', categoryId: '', supplierId: '', status: '', warehouseId: '' };
const PAGE_SIZES = [10, 25, 50];
const RECENT_LIMIT = 6;
const DONUT_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#ef4444', '#0891b2', '#db2777', '#65a30d', '#64748b'];

const money = (v: string | null | undefined) => formatINR(v, { symbol: false });
const rowKey = (r: { kind: ItemKind; id: string }) => `${r.kind}:${r.id}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const outlineBtn = 'h-10 px-4 inline-flex items-center gap-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50';
const primaryBtn = 'h-10 px-4 inline-flex items-center gap-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm disabled:opacity-60';
const selectCls = 'h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

function StatusPill({ status }: { status: StockStatus }) {
  const cls = status === 'In Stock' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'Low Stock' ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-red-50 text-red-700 border-red-200';
  return <span className={`inline-flex px-2.5 py-0.5 text-xs font-semibold rounded-full border whitespace-nowrap ${cls}`}>{status}</span>;
}

function DirectionBadge({ direction }: { direction: Direction }) {
  const cls = direction === 'IN' ? 'bg-emerald-100 text-emerald-700' : direction === 'OUT' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700';
  return <span className={`inline-flex items-center justify-center w-10 py-0.5 text-[11px] font-bold rounded ${cls}`}>{direction}</span>;
}

function SignedQty({ qty, unit }: { qty: string; unit?: string | null }) {
  const neg = toPaise(qty) < 0n || /^\s*-/.test(qty);
  const f = formatQty(qty);
  const shown = neg ? f.replace(/^-/, '−') : `+${f}`;
  return <span className={`font-semibold tabular-nums whitespace-nowrap ${neg ? 'text-red-600' : 'text-emerald-600'}`}>{shown}{unit ? ` ${unit}` : ''}</span>;
}

function pageList(current: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 'gap', totalPages];
  if (current >= totalPages - 3) return [1, 'gap', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, 'gap', current - 1, current, current + 1, 'gap', totalPages];
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function InventoryPage() {
  const navigate = useNavigate();
  const { company } = useAuth();
  const companyId = company?.id ?? null;
  const [params, setParams] = useSearchParams();
  const q = params.get('q');

  const [filters, setFilters] = useState<InventoryFilters | null>(null);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [items, setItems] = useState<InventoryItemsPage | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentTransaction[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const [refreshKey, setRefreshKey] = useState(0);
  const silentRef = useRef(false);
  const itemsReq = useRef(0);

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ row: InventoryItemRow; x: number; y: number } | null>(null);

  const [editing, setEditing] = useState<InventoryItemRow | 'new' | null>(null);
  const [viewing, setViewing] = useState<{ row: InventoryItemRow; tab: 'details' | 'history' } | null>(null);
  const [adjusting, setAdjusting] = useState<InventoryItemRow | null>(null);
  const [adjustPickerOpen, setAdjustPickerOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [masterOpen, setMasterOpen] = useState(false);
  const [fgKey, setFgKey] = useState(0);
  const fg = useFinishedGoods(fgKey);
  const fgStockCount = fg.rows?.length ?? 0;
  const [txn, setTxn] = useState<RecentTransaction | null>(null);

  // Extra dashboard data: per-item last movement, open work orders (WIP), live status.
  const [recentAll, setRecentAll] = useState<RecentTransaction[] | null>(null);
  const [wipCount, setWipCount] = useState<number | null>(null);
  const [live, setLive] = useState(false);

  const canManage = filters?.can_manage ?? false;
  const categories = useMemo(() => [...(filters?.categories ?? [])].sort((a, b) => a.sort_order - b.sort_order), [filters]);
  // On the Finished Goods tab the table is replaced by the finished goods waiting for delivery.
  const allTab = !applied.categoryId;
  const fgTab = !!applied.categoryId && categories.some(c => c.id === applied.categoryId && (String(c.code ?? '').toUpperCase() === 'FG' || /finished/i.test(String(c.name))));
  // Finished goods waiting for delivery are listed in the table on the All Items and Finished Goods tabs, narrowed by the same filters.
  const fgVisible = useMemo(() => {
    if (!(fgTab || allTab) || applied.supplierId || (applied.status && applied.status !== 'In Stock')) return [];
    const q = applied.search.trim().toLowerCase();
    return (fg.rows ?? []).filter(r => {
      if (q && ![r.product, r.customer, r.salesOrder, 'finished goods'].some(x => x.toLowerCase().includes(q))) return false;
      if (applied.warehouseId && fg.warehouseOf(r)?.id !== applied.warehouseId) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fg.rows, fg.whs, fgTab, allTab, applied]);

  const refreshAll = useCallback(() => { silentRef.current = true; setRefreshKey(k => k + 1); }, []);

  // ---- Filters master (tabs, selects, permissions) ----------------------------------------
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setReady(false);
    setFilters(null);
    setFiltersError(null);
    inventoryApi.filters()
      .then(res => {
        if (cancelled) return;
        setFilters(res);
        const first = [...res.categories].sort((a, b) => a.sort_order - b.sort_order)[0];
        const initialQ = new URLSearchParams(window.location.search).get('q');
        const start: FilterState = initialQ ? { ...EMPTY_FILTERS, search: initialQ } : { ...EMPTY_FILTERS, categoryId: first?.id ?? '' };
        setDraft(start);
        setApplied(start);
        setPage(1);
      })
      .catch(e => { if (!cancelled) setFiltersError(errText(e)); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [companyId]);

  // ---- Global header search (?q=) ------------------------------------------------------------
  useEffect(() => {
    if (q === null) return;
    setDraft(d => ({ ...d, search: q, categoryId: '' }));
    setApplied(a => ({ ...a, search: q, categoryId: '' }));
    setPage(1);
  }, [q]);

  // ---- Items (server-paginated) ------------------------------------------------------------
  useEffect(() => {
    if (!companyId || !ready) return;
    const id = ++itemsReq.current;
    const silent = silentRef.current;
    if (!silent) { setItemsLoading(true); setItems(null); }
    setItemsError(null);
    inventoryApi.items({
      categoryId: applied.categoryId || null,
      search: applied.search.trim() || null,
      supplierId: applied.supplierId || null,
      status: applied.status || null,
      warehouseId: applied.warehouseId || null,
      page, pageSize,
    })
      .then(res => {
        if (id !== itemsReq.current) return;
        setItems(res);
        const paths = res.rows.map(r => r.image_url).filter((p): p is string => !!p);
        if (paths.length) signedImageUrls(paths).then(urls => setImageUrls(prev => ({ ...prev, ...urls })));
      })
      .catch(e => { if (id === itemsReq.current) setItemsError(errText(e)); })
      .finally(() => { if (id === itemsReq.current) setItemsLoading(false); });
  }, [companyId, ready, applied, page, pageSize, refreshKey]);

  // ---- Summary + recent transactions -----------------------------------------------------------
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) { setSummary(null); setRecent(null); }
    setSummaryError(null);
    setRecentError(null);
    inventoryApi.summary()
      .then(res => { if (!cancelled) setSummary(res); })
      .catch(e => { if (!cancelled) setSummaryError(errText(e)); });
    inventoryApi.recent(RECENT_LIMIT)
      .then(res => { if (!cancelled) setRecent(res ?? []); })
      .catch(e => { if (!cancelled) setRecentError(errText(e)); });
    return () => { cancelled = true; };
  }, [companyId, refreshKey]);

  // Refetch when the window regains focus (stock may have moved in another module).
  useEffect(() => {
    const onFocus = () => refreshAll();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshAll]);

  // ---- Per-item last movement (for the stock table) ---------------------------------------
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    inventoryApi.recent(100)
      .then(res => { if (!cancelled) setRecentAll(res ?? []); })
      .catch(() => { if (!cancelled) setRecentAll([]); });
    return () => { cancelled = true; };
  }, [companyId, refreshKey]);

  const lastMovement = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of recentAll ?? []) {
      const k = `${t.item_kind}:${t.item_id}`;
      if (!map[k] || (t.txn_date && t.txn_date > map[k])) map[k] = t.txn_date;
    }
    return map;
  }, [recentAll]);

  // ---- Open work orders (WIP proxy — real count, never hardcoded) ---------------------------
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    supabase.from('cnc_work_orders').select('id', { count: 'exact', head: true })
      .in('status', ['In Progress', 'Released'])
      .then(({ count, error }) => { if (!cancelled && !error) setWipCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [companyId, refreshKey]);

  // ---- Realtime: the ledger is authoritative; events only trigger a silent re-read ---------
  // A refresh re-reads from the database, so duplicate/delayed events can never
  // double-count stock — they just schedule another read (debounced).
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (!cancelled) refreshAll(); }, 800);
    };
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`inventory-${companyId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cnc_stock_movements', filter: `company_id=eq.${companyId}` }, schedule)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cnc_raw_materials', filter: `company_id=eq.${companyId}` }, schedule)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cnc_parts', filter: `company_id=eq.${companyId}` }, schedule)
        .subscribe(status => { if (!cancelled && status === 'SUBSCRIBED') setLive(true); });
    } catch {
      channel = null;
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setLive(false);
      if (channel) supabase.removeChannel(channel);
    };
  }, [companyId, refreshAll]);

  // Close floating menus on outside interaction.
  useEffect(() => {
    if (!menu && !exportOpen) return;
    const close = () => { setMenu(null); setExportOpen(false); };
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-floating-menu]')) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu, exportOpen]);

  // ---- Filter actions -------------------------------------------------------------------------
  const applyFilters = (next: FilterState) => { setApplied(next); setPage(1); };
  const handleSearch = () => applyFilters(draft);
  const handleClear = () => {
    const next = { ...EMPTY_FILTERS, categoryId: applied.categoryId };
    setDraft(next);
    applyFilters(next);
    if (q !== null) setParams(prev => { const p = new URLSearchParams(prev); p.delete('q'); return p; }, { replace: true });
  };
  const handleTab = (categoryId: string) => {
    setDraft(d => ({ ...d, categoryId }));
    applyFilters({ ...applied, categoryId });
  };
  const filterByStatus = (status: StatusFilter) => {
    const next = { ...applied, categoryId: '', status };
    setDraft({ ...draft, categoryId: '', status });
    applyFilters(next);
  };

  const locationsFor = (warehouseId: string) => (filters?.locations ?? []).filter(l => !warehouseId || l.warehouse_id === warehouseId);

  // ---- Export (all rows for the current filters) -----------------------------------------------
  const handleExport = async () => {
    setExportOpen(false);
    setExporting(true);
    setExportError(null);
    try {
      const all: InventoryItemRow[] = [];
      for (let p = 1; ; p++) {
        const res = await inventoryApi.items({
          categoryId: applied.categoryId || null, search: applied.search.trim() || null, supplierId: applied.supplierId || null,
          status: applied.status || null, warehouseId: applied.warehouseId || null, page: p, pageSize: 500,
        });
        all.push(...res.rows);
        if (res.rows.length < 500 || all.length >= res.total) break;
      }
      const catName = categories.find(c => c.id === applied.categoryId)?.name ?? 'All-Items';
      exportCsv(`Inventory_${catName.replace(/\W+/g, '-')}_${todayISO()}`, [
        ['#', 'Item Code', 'Item Name', 'Category', 'Specification', 'Unit', 'Current Stock', 'Min Stock', 'Reorder Qty', 'Rate (INR)', 'Value (INR)', 'Status', 'Supplier', 'Warehouse', 'Location', 'Item Status'],
        ...all.map((r, i) => [
          i + 1, r.code, r.name, r.category_name ?? '', r.specification ?? '', r.unit ?? '', r.current_stock, r.min_stock, r.reorder_qty,
          r.rate, r.value, r.status, r.supplier_name ?? '', r.warehouse_name ?? '', r.location_name ?? '', r.item_status,
        ]),
      ]);
    } catch (e) {
      setExportError(errText(e));
    } finally {
      setExporting(false);
    }
  };

  // ---- Render -----------------------------------------------------------------------------------
  if (!company) {
    return (
      <div className="p-4 lg:p-6 min-h-full">
        <div className="max-w-xl mx-auto mt-16 bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <Building2 className="mx-auto text-slate-400 mb-3" size={28} />
          <h2 className="text-lg font-bold text-slate-800">Select a company</h2>
          <p className="text-sm text-slate-500 mt-1">Choose a company in the top bar to view its inventory. Stock is never combined across companies.</p>
        </div>
      </div>
    );
  }

  const loadError = filtersError || itemsError || summaryError || recentError;
  const totalPages = items ? Math.max(1, Math.ceil(items.total / items.page_size)) : 1;
  const firstShown = items && items.total > 0 ? (items.page - 1) * items.page_size + 1 : 0;
  const lastShown = items ? Math.min(items.total, (items.page - 1) * items.page_size + items.rows.length) : 0;

  const byCat = summary?.by_category ?? [];
  const catKind = (id: string) => categories.find(c => c.id === id)?.kind;
  const rawCount = byCat.filter(c => catKind(c.category_id) !== 'MANUFACTURED').reduce((s, c) => s + (Number(c.items) || 0), 0);
  const fgCount = byCat.filter(c => catKind(c.category_id) === 'MANUFACTURED').reduce((s, c) => s + (Number(c.items) || 0), 0);

  const cards = [
    { label: 'Total Items', icon: Box, tint: 'bg-blue-100 text-blue-600', value: summary ? formatQty(summary.total_items + fgStockCount) : null },
    { label: 'Total Stock Value', icon: Layers, tint: 'bg-emerald-100 text-emerald-600', value: summary ? formatINR(summary.total_value) : null },
    { label: 'Raw Materials', icon: Package, tint: 'bg-orange-100 text-orange-600', value: summary ? formatQty(rawCount) : null },
    { label: 'Work In Progress', icon: Factory, tint: 'bg-violet-100 text-violet-600', value: wipCount === null ? null : formatQty(wipCount), hint: 'Open work orders' },
    { label: 'Finished Goods', icon: Archive, tint: 'bg-indigo-100 text-indigo-600', value: summary ? formatQty(fgCount + fgStockCount) : null },
    { label: 'Low Stock', icon: AlertTriangle, tint: 'bg-amber-100 text-amber-600', value: summary ? formatQty(summary.low_stock) : null },
    { label: 'Out of Stock', icon: XCircle, tint: 'bg-red-100 text-red-600', value: summary ? formatQty(summary.out_of_stock) : null },
  ];

  return (
    <div className="p-4 lg:p-6 min-h-full bg-white">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4 mb-5">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            Inventory
            {live && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 mt-1">Real-time visibility of raw materials, work-in-progress and finished goods.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canManage && (
            <button onClick={() => setAdjustPickerOpen(true)} className={outlineBtn}><SlidersHorizontal size={16} /> Stock Adjustment</button>
          )}
          {canManage && (
            <button onClick={() => setTransferOpen(true)} className={outlineBtn}><ArrowLeftRight size={16} /> Stock Transfer</button>
          )}
          {canManage && (
            <button onClick={() => setImportOpen(true)} className={outlineBtn}><Upload size={16} /> Import</button>
          )}
          {canManage && (
            <button onClick={() => setMasterOpen(true)} className={outlineBtn}><Building2 size={16} /> Warehouse Master</button>
          )}
          <div className="relative" data-floating-menu>
            <button onClick={() => setExportOpen(o => !o)} disabled={exporting || !ready} className={outlineBtn}>
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export <ChevronDown size={14} />
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 w-60 bg-white border border-slate-200 rounded-lg shadow-xl z-30 overflow-hidden">
                <button onClick={handleExport} className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2">
                  <FileSpreadsheet size={15} className="text-emerald-600" /> CSV (current filters)
                </button>
              </div>
            )}
          </div>
          <button onClick={() => setEditing('new')} disabled={!filters} className={primaryBtn}><Plus size={16} /> Add Item</button>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold flex items-center gap-2"><AlertTriangle size={16} /> Unable to load inventory data. Please try again.</p>
            <p className="text-xs text-red-600 mt-1">{loadError}</p>
          </div>
          <button onClick={() => { silentRef.current = false; setRefreshKey(k => k + 1); }} className="text-xs font-semibold text-red-700 underline">Retry</button>
        </div>
      )}
      {exportError && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="font-semibold">Export failed.</p><p className="text-xs text-red-600 mt-1">{exportError}</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="flex gap-3 mb-5 overflow-x-auto pb-1" data-testid="inventory-cards">
        {cards.map(c => (
          <div key={c.label} data-testid="inventory-card" className="flex-1 min-w-[132px] bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-3 flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${c.tint}`}><c.icon size={18} /></div>
            <div className="min-w-0">
              <p className="text-xs text-slate-600 leading-tight">{c.label}</p>
              {c.value === null
                ? (summaryError ? <p className="text-2xl font-bold text-slate-300">—</p> : <div className="h-7 w-24 mt-1 rounded bg-slate-100 animate-pulse" />)
                : <p className="text-lg font-bold text-slate-900 tracking-tight truncate">{c.value}</p>}
              {'hint' in c && c.hint && <p className="text-[10px] text-slate-400 whitespace-nowrap">{c.hint}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-5 items-stretch">
        {/* Main column: the table now uses the full page width */}
        <div className="w-full min-w-0 bg-white border border-slate-200 rounded-xl shadow-sm">
          {/* Tabs */}
          <div className="flex gap-6 px-5 border-b border-slate-200 overflow-x-auto">
            {!filters && !filtersError && [0, 1, 2, 3].map(i => <div key={i} className="h-5 w-24 my-3.5 rounded bg-slate-100 animate-pulse" />)}
            {[...categories.map(c => ({ id: c.id, name: c.name })), { id: '', name: 'All Items' }].map(t => {
              if (!filters && t.id === '' && !filtersError) return null;
              const active = applied.categoryId === t.id;
              return (
                <button key={t.id || 'all'} onClick={() => handleTab(t.id)}
                  className={`py-3.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${active ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
                  {t.name}
                </button>
              );
            })}
          </div>

          {(<>
          {/* Filter bar */}
          <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
            <input
              value={draft.search}
              onChange={e => setDraft({ ...draft, search: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
              placeholder="Search by item name, code..."
              className={`${selectCls} flex-1 min-w-[200px]`}
            />
            <select aria-label="Category" value={draft.categoryId} onChange={e => setDraft({ ...draft, categoryId: e.target.value })} className={selectCls}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select aria-label="Supplier" value={draft.supplierId} onChange={e => setDraft({ ...draft, supplierId: e.target.value })} className={`${selectCls} max-w-[180px]`}>
              <option value="">All Suppliers</option>
              {(filters?.suppliers ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select aria-label="Stock status" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as FilterState['status'] })} className={selectCls}>
              <option value="">All Status</option>
              <option value="In Stock">In Stock</option>
              <option value="Low Stock">Low Stock</option>
              <option value="Out of Stock">Out of Stock</option>
              <option value="Reorder">Needs Reorder</option>
            </select>
            <select aria-label="Warehouse" value={draft.warehouseId} onChange={e => setDraft({ ...draft, warehouseId: e.target.value })} className={`${selectCls} max-w-[180px]`}>
              <option value="">All Warehouses</option>
              {(filters?.warehouses ?? []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button onClick={handleSearch} className={primaryBtn}>Search</button>
            <button onClick={handleClear} className={outlineBtn}>Clear</button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs font-semibold border-b border-slate-200">
                  <th className="px-3 py-3 text-left w-10">#</th>
                  <th className="px-3 py-3 text-left">Item Code</th>
                  <th className="px-3 py-3 text-left">Product / Material Name</th>
                  <th className="px-3 py-3 text-left">Category</th>
                  <th className="px-3 py-3 text-left">Warehouse / Location</th>
                  <th className="px-3 py-3 text-left">Unit</th>
                  <th className="px-3 py-3 text-right">Available Qty</th>
                  <th className="px-3 py-3 text-right">Value (₹)</th>
                  <th className="px-3 py-3 text-right">Reorder Level</th>
                  <th className="px-3 py-3 text-left">Stock Status</th>
                  <th className="px-3 py-3 text-left">Last Movement</th>
                  <th className="px-3 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(itemsLoading || (!items && !itemsError)) && Array.from({ length: pageSize > 10 ? 10 : pageSize }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {Array.from({ length: 12 }).map((__, j) => (
                      <td key={j} className="px-3 py-3.5"><div className={`h-4 rounded bg-slate-100 animate-pulse ${j === 1 ? 'w-28' : 'w-full'}`} /></td>
                    ))}
                  </tr>
                ))}
                {!itemsLoading && items && items.rows.length === 0 && fgVisible.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-12 text-center text-slate-500">{fg.rows === null ? 'Loading…' : 'No inventory items found.'}</td></tr>
                )}
                {!itemsLoading && items && items.rows.map((r, i) => (
                  <tr key={rowKey(r)} className="border-b border-slate-100 hover:bg-slate-50/70">
                    <td className="px-3 py-2.5 text-slate-500">{firstShown + i}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        {r.image_url && imageUrls[r.image_url]
                          ? <img src={imageUrls[r.image_url]} alt="" className="w-8 h-8 rounded-md object-cover border border-slate-200 flex-shrink-0" />
                          : <div className="w-8 h-8 rounded-md bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0"><Package size={16} /></div>}
                        <button onClick={() => setViewing({ row: r, tab: 'details' })} className="font-semibold text-slate-800 hover:text-blue-600 whitespace-nowrap">{r.code}</button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-800 max-w-[150px] truncate" title={r.name}>
                      {r.name}
                      {r.item_status === 'Inactive' && <span className="ml-2 text-[10px] font-semibold uppercase text-slate-400">Inactive</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[110px] truncate" title={r.category_name ?? ''}>{r.category_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[240px] truncate" title={[r.warehouse_name, r.location_name].filter(Boolean).join(' / ')}>
                      {[r.warehouse_name, r.location_name].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{r.unit ?? ''}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">{formatQty(r.current_stock)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">{money(r.value)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600">{formatQty(r.min_stock)}</td>
                    <td className="px-3 py-2.5"><StatusPill status={r.status} /></td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {lastMovement[rowKey(r)] ? formatDate(lastMovement[rowKey(r)]) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <button title="Edit" onClick={() => setEditing(r)}
                          className="w-8 h-8 flex items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"><Pencil size={14} /></button>
                        <button title="More" data-floating-menu
                          onClick={e => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenu(m => (m && rowKey(m.row) === rowKey(r) ? null : { row: r, x: rect.right, y: rect.bottom }));
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"><MoreVertical size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!itemsLoading && items && fgVisible.map((r, j) => {
                  const wh = fg.warehouseOf(r);
                  return (
                    <tr key={`fg:${r.key}`} data-testid="fg-row" className="border-b border-slate-100 hover:bg-slate-50/70">
                      <td className="px-3 py-2.5 text-slate-500">{firstShown + items.rows.length + j}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-md bg-indigo-50 text-indigo-500 flex items-center justify-center flex-shrink-0"><Archive size={16} /></div>
                          <span className="font-semibold text-slate-800 whitespace-nowrap">{r.salesOrder || 'FG'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-800 max-w-[220px]" title={`${r.product} · ${r.customer}`}>
                        <div className="truncate">{r.product || '—'}</div>
                        <div className="text-[11px] text-slate-400 truncate">{r.customer}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">Finished Goods</td>
                      <td className="px-3 py-2">
                        {canManage && fg.canAssign ? (
                          <select aria-label={`Warehouse for ${r.product}`} className="h-8 w-full max-w-[220px] px-2 text-[13px] bg-white border border-slate-300 rounded-md" value={r.warehouseId} disabled={fg.busyKey === r.key} onChange={e => void fg.assign(r, e.target.value)}>
                            <option value="">{fg.def ? `Default · ${fg.def.name}` : 'Not set'}</option>
                            {fg.whs.filter(w => w.status === 'Active').map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                          </select>
                        ) : <span className="text-slate-600">{wh ? `${wh.name}${wh.isDefault ? ' (default)' : ''}` : '—'}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">pcs</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800" title={`Finished ${r.finished} · Delivered ${r.delivered}`}>{formatQty(String(r.available))}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300">—</td>
                      <td className="px-3 py-2.5 text-right text-slate-300">—</td>
                      <td className="px-3 py-2.5"><StatusPill status="In Stock" /></td>
                      <td className="px-3 py-2.5 text-slate-300">—</td>
                      <td className="px-3 py-2.5" />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {fg.error && <p role="alert" className="mx-4 mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fg.error}</p>}

          {/* Footer / pagination */}
          <div className="px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-sm text-slate-600">
            <span>{items ? ((items.total === 0 ? (fgVisible.length ? '' : 'Showing 0 items') : `Showing ${firstShown} to ${lastShown} of ${formatQty(items.total)} items`) + (fgVisible.length ? `${items.total ? ' · ' : ''}${fgVisible.length} finished good${fgVisible.length === 1 ? '' : 's'} ready for delivery` : '')) : ' '}</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <button aria-label="Previous page" disabled={page <= 1 || !items} onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="w-8 h-8 flex items-center justify-center rounded-md border border-slate-300 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={15} /></button>
                {items && pageList(page, totalPages).map((p, i) => p === 'gap'
                  ? <span key={`g${i}`} className="w-8 text-center text-slate-400">…</span>
                  : (
                    <button key={p} onClick={() => setPage(p)}
                      className={`min-w-8 h-8 px-2 rounded-md text-sm border ${p === page ? 'bg-blue-600 border-blue-600 text-white font-semibold' : 'border-slate-300 hover:bg-slate-50'}`}>{p}</button>
                  ))}
                <button aria-label="Next page" disabled={page >= totalPages || !items} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="w-8 h-8 flex items-center justify-center rounded-md border border-slate-300 hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={15} /></button>
              </div>
              <select aria-label="Rows per page" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="h-8 px-2 text-sm bg-white border border-slate-300 rounded-md">
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / page</option>)}
              </select>
            </div>
          </div>
          </>)}
        </div>

        {/* Summary panels: at the end of the page */}
        <div className="w-full min-w-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start" data-testid="inventory-panels">
          <CategoryDonut summary={summary} failed={!!summaryError} />
          <StockStatusCard summary={summary} failed={!!summaryError} />
          <Card title="Recent Transactions" action={<button onClick={() => navigate('/inventory/movements')} className="text-xs font-semibold text-blue-600 hover:underline">View All</button>}>
            {recent === null && !recentError && <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="h-9 rounded bg-slate-100 animate-pulse" />)}</div>}
            {recentError && <p className="text-xs text-slate-400">Not available.</p>}
            {recent && recent.length === 0 && <p className="text-sm text-slate-500 py-2">No transactions found.</p>}
            {recent && recent.length > 0 && (
              <ul className="divide-y divide-slate-100 -mx-1">
                {recent.map(t => (
                  <li key={t.id}>
                    <button onClick={() => setTxn(t)} className="w-full text-left px-1 py-2 flex items-center gap-2.5 hover:bg-slate-50 rounded">
                      <DirectionBadge direction={t.direction} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-800 truncate">{t.item_code}</p>
                        <p className="text-[11px] text-slate-500">{formatDate(t.txn_date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs"><SignedQty qty={t.qty} unit={t.unit} /></p>
                        <p className="text-[11px] text-slate-500 truncate max-w-[110px]">{t.type}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Alerts" action={<button onClick={() => filterByStatus('Low Stock')} className="text-xs font-semibold text-blue-600 hover:underline">View All</button>}>
            {!summary && !summaryError && <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-5 rounded bg-slate-100 animate-pulse" />)}</div>}
            {summaryError && <p className="text-xs text-slate-400">Not available.</p>}
            {summary && (summary.out_of_stock === 0 && summary.low_stock === 0 && summary.to_reorder === 0
              ? <p className="text-sm text-slate-500">No alerts.</p>
              : (
                <ul className="space-y-1">
                  {summary.out_of_stock > 0 && (
                    <li><button onClick={() => filterByStatus('Out of Stock')} className="w-full text-left flex items-center gap-2 text-sm text-slate-700 hover:bg-slate-50 rounded px-1 py-1.5">
                      <XCircle size={16} className="text-red-500 flex-shrink-0" /> {formatQty(summary.out_of_stock)} items are out of stock</button></li>
                  )}
                  {summary.low_stock > 0 && (
                    <li><button onClick={() => filterByStatus('Low Stock')} className="w-full text-left flex items-center gap-2 text-sm text-slate-700 hover:bg-slate-50 rounded px-1 py-1.5">
                      <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" /> {formatQty(summary.low_stock)} items are below minimum stock</button></li>
                  )}
                  {summary.to_reorder > 0 && (
                    <li><button onClick={() => filterByStatus('Reorder')} className="w-full text-left flex items-center gap-2 text-sm text-slate-700 hover:bg-slate-50 rounded px-1 py-1.5">
                      <Info size={16} className="text-blue-500 flex-shrink-0" /> {formatQty(summary.to_reorder)} items need reordering</button></li>
                  )}
                </ul>
              ))}
          </Card>
        </div>
      </div>

      {/* Row "More" menu (fixed so the table's scroll container doesn't clip it) */}
      {menu && (
        <div data-floating-menu className="fixed z-40 w-44 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
          style={{ top: Math.min(menu.y + 4, window.innerHeight - 140), left: Math.max(8, menu.x - 176) }}>
          <button onClick={() => { setViewing({ row: menu.row, tab: 'details' }); setMenu(null); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"><Eye size={14} /> View Item</button>
          <button onClick={() => { setViewing({ row: menu.row, tab: 'history' }); setMenu(null); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"><History size={14} /> Stock Movement</button>
          {canManage && (
            <button onClick={() => { setAdjusting(menu.row); setMenu(null); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"><SlidersHorizontal size={14} /> Adjust Stock</button>
          )}
        </div>
      )}

      {editing && filters && (
        <ItemFormModal
          item={editing === 'new' ? null : editing}
          filters={filters}
          categories={categories}
          defaultCategoryId={applied.categoryId}
          companyId={company.id}
          imageUrl={editing !== 'new' && editing.image_url ? imageUrls[editing.image_url] ?? null : null}
          locationsFor={locationsFor}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshAll(); }}
        />
      )}
      {viewing && (
        <ViewItemModal
          row={viewing.row}
          initialTab={viewing.tab}
          imageUrl={viewing.row.image_url ? imageUrls[viewing.row.image_url] ?? null : null}
          onClose={() => setViewing(null)}
          onOpenSource={route => { setViewing(null); navigate(route); }}
        />
      )}
      {adjusting && canManage && (
        <AdjustStockModal row={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); refreshAll(); }} />
      )}
      {adjustPickerOpen && canManage && (
        <ItemPickerModal title="Stock Adjustment — Select Item" onClose={() => setAdjustPickerOpen(false)} onPick={row => { setAdjustPickerOpen(false); setAdjusting(row); }} />
      )}
      {transferOpen && canManage && (
        <TransferModal onClose={() => setTransferOpen(false)} onSaved={refreshAll} />
      )}
      {masterOpen && canManage && (
        <WarehouseMasterModal onClose={() => setMasterOpen(false)} onChanged={() => { setFgKey(k => k + 1); }} />
      )}
      {importOpen && canManage && (
        <ImportModal onClose={() => setImportOpen(false)} onImported={refreshAll} />
      )}
      {txn && (
        <TransactionModal txn={txn} onClose={() => setTxn(null)} onOpenSource={route => { setTxn(null); navigate(route); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Right-column cards
// ---------------------------------------------------------------------------------------

function CategoryDonut({ summary, failed }: { summary: InventorySummary | null; failed: boolean }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const total = summary ? toPaise(summary.total_value) : 0n;
  const cats = summary?.by_category ?? [];
  let offset = 0;
  return (
    <Card title="Stock Value by Category">
      {!summary && !failed && <div className="h-40 rounded bg-slate-100 animate-pulse" />}
      {failed && <p className="text-xs text-slate-400">Not available.</p>}
      {summary && (
        <>
          <div className="relative w-40 h-40 mx-auto">
            <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
              <circle cx="70" cy="70" r={R} fill="none" stroke="#e2e8f0" strokeWidth="18" />
              {total > 0n && cats.map((c, i) => {
                const v = toPaise(c.value);
                if (v <= 0n) return null;
                // Geometry only — the displayed figures come straight from the database strings.
                const frac = Number((v * 1000000n) / total) / 1000000;
                const len = frac * C;
                const el = (
                  <circle key={c.category_id} cx="70" cy="70" r={R} fill="none" stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
                    strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}>
                    <title>{`${c.name}: ${formatINR(c.value)}`}</title>
                  </circle>
                );
                offset += len;
                return el;
              })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-base font-bold text-slate-900">{formatCompactINR(summary.total_value)}</span>
              <span className="text-[11px] text-slate-500">Total Value</span>
            </div>
          </div>
          {cats.length === 0
            ? <p className="text-sm text-slate-500 text-center mt-3">No stock value yet.</p>
            : (
              <ul className="mt-4 space-y-1.5">
                {cats.map((c, i) => (
                  <li key={c.category_id} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="flex-1 min-w-0 truncate text-slate-700" title={formatINR(c.value)}>{c.name}</span>
                    <span className="font-semibold text-slate-800 tabular-nums">{formatPercent(c.value, summary.total_value)}</span>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}
    </Card>
  );
}

function StockStatusCard({ summary, failed }: { summary: InventorySummary | null; failed: boolean }) {
  const rows = summary ? [
    { label: 'In Stock', count: summary.in_stock, color: 'bg-emerald-500' },
    { label: 'Low Stock', count: summary.low_stock, color: 'bg-amber-500' },
    { label: 'Out of Stock', count: summary.out_of_stock, color: 'bg-red-500' },
    { label: 'Total Items', count: summary.total_items, color: 'bg-slate-500' },
  ] : [];
  const total = summary?.total_items ?? 0;
  return (
    <Card title="Stock Status">
      {!summary && !failed && <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="h-5 rounded bg-slate-100 animate-pulse" />)}</div>}
      {failed && <p className="text-xs text-slate-400">Not available.</p>}
      {summary && (
        <ul className="space-y-3">
          {rows.map(r => (
            <li key={r.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-600">{r.label}</span>
                <span className="font-semibold text-slate-800 tabular-nums">{formatQty(r.count)}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${r.color}`} style={{ width: total > 0 ? `${(r.count / total) * 100}%` : '0%' }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------------------

function ModalError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
      <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{message}</span>
    </div>
  );
}

const cancelBtn = 'px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg';
const saveBtn = 'px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 inline-flex items-center gap-2';

function DetailGrid({ fields }: { fields: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {fields.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{k}</dt>
          <dd className="text-sm text-slate-800 mt-0.5 break-words">{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ItemFormModal({ item, filters, categories, defaultCategoryId, companyId, imageUrl, locationsFor, onClose, onSaved }: {
  item: InventoryItemRow | null;
  filters: InventoryFilters;
  categories: InventoryFilters['categories'];
  defaultCategoryId: string;
  companyId: string;
  imageUrl: string | null;
  locationsFor: (warehouseId: string) => InventoryFilters['locations'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !item;
  // An existing item keeps its master table: purchased ↔ manufactured categories only.
  const allowedCategories = item
    ? categories.filter(c => (item.kind === 'PART' ? c.kind === 'MANUFACTURED' : c.kind === 'PURCHASED'))
    : categories;
  const [form, setForm] = useState({
    code: item?.code ?? '',
    name: item?.name ?? '',
    category_id: item?.category_id ?? (defaultCategoryId || categories[0]?.id || ''),
    specification: item?.specification ?? '',
    unit: item?.unit ?? '',
    min_stock: item?.min_stock ?? '0',
    reorder_qty: item?.reorder_qty ?? '0',
    rate: item?.rate ?? '0',
    supplier_id: item?.supplier_id ?? '',
    warehouse_id: item?.warehouse_id ?? '',
    location_id: item?.location_id ?? '',
    status: item?.item_status ?? 'Active' as 'Active' | 'Inactive',
    opening_qty: '0',
    opening_date: todayISO(),
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(imageUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));
  const locations = locationsFor(form.warehouse_id);

  const save = async () => {
    if (!form.code.trim()) return setError('Item Code is required.');
    if (!form.name.trim()) return setError('Item Name is required.');
    if (!form.category_id) return setError('Select a category.');
    for (const [label, v] of [['Min Stock', form.min_stock], ['Reorder Qty', form.reorder_qty], ['Rate', form.rate]] as const) {
      if (!isNonNegativeDecimal(v)) return setError(`${label} must be a number of zero or more.`);
    }
    if (isNew && !isNonNegativeDecimal(form.opening_qty)) return setError('Opening Qty must be a number of zero or more.');
    if (isNew && isPositiveQty(form.opening_qty) && !form.opening_date) return setError('Select the opening date.');
    if (file && !file.type.startsWith('image/')) return setError('The image must be a picture file (JPG, PNG, WEBP…).');
    setSaving(true);
    setError(null);
    try {
      const image_url = file ? await uploadItemImage(companyId, file) : item?.image_url ?? null;
      await inventoryApi.saveItem({
        id: item?.id ?? null,
        kind: item?.kind ?? null,
        code: form.code.trim(),
        name: form.name.trim(),
        category_id: form.category_id,
        specification: form.specification.trim(),
        unit: form.unit.trim(),
        min_stock: form.min_stock.trim() || '0',
        reorder_qty: form.reorder_qty.trim() || '0',
        rate: form.rate.trim() || '0',
        supplier_id: form.supplier_id || null,
        location_id: form.location_id || null,
        image_url,
        status: form.status,
        ...(isNew ? { opening_qty: form.opening_qty.trim() || '0', opening_date: form.opening_date } : {}),
      });
      onSaved();
    } catch (e) {
      setError(errText(e));
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? 'Add Item' : 'Edit Item'} subtitle={item ? `${item.code} · ${item.name}` : undefined}
      footer={<>
        <button onClick={onClose} className={cancelBtn}>Cancel</button>
        <button onClick={save} disabled={saving} className={saveBtn}>{saving && <Loader2 size={14} className="animate-spin" />} Save</button>
      </>}>
      <ModalError message={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Item Code" required><input className={inputClass} value={form.code} onChange={e => set('code', e.target.value)} /></FormField>
        <FormField label="Item Name" required><input className={inputClass} value={form.name} onChange={e => set('name', e.target.value)} /></FormField>
        <FormField label="Category" required>
          <select className={inputClass} value={form.category_id} onChange={e => set('category_id', e.target.value)}>
            <option value="">Select…</option>
            {allowedCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Unit">
          <input className={inputClass} list="inventory-units" value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="e.g. Nos, Kg" />
          <datalist id="inventory-units">{filters.units.map(u => <option key={u} value={u} />)}</datalist>
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Specification"><input className={inputClass} value={form.specification} onChange={e => set('specification', e.target.value)} /></FormField>
        </div>
        <FormField label="Min Stock"><input className={inputClass} inputMode="decimal" value={form.min_stock} onChange={e => set('min_stock', e.target.value)} /></FormField>
        <FormField label="Reorder Qty"><input className={inputClass} inputMode="decimal" value={form.reorder_qty} onChange={e => set('reorder_qty', e.target.value)} /></FormField>
        <FormField label="Rate (₹)" hint={!isNew ? 'Changing the rate revalues current stock in accounts.' : undefined}>
          <input className={inputClass} inputMode="decimal" value={form.rate} onChange={e => set('rate', e.target.value)} />
        </FormField>
        <FormField label="Supplier">
          <select className={inputClass} value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)}>
            <option value="">— None —</option>
            {filters.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </FormField>
        <FormField label="Warehouse">
          <select className={inputClass} value={form.warehouse_id} onChange={e => {
            const wid = e.target.value;
            setForm(f => ({ ...f, warehouse_id: wid, location_id: locationsFor(wid).some(l => l.id === f.location_id) ? f.location_id : '' }));
          }}>
            <option value="">— Any —</option>
            {filters.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </FormField>
        <FormField label="Location">
          <select className={inputClass} value={form.location_id} onChange={e => {
            const lid = e.target.value;
            const loc = filters.locations.find(l => l.id === lid);
            setForm(f => ({ ...f, location_id: lid, warehouse_id: loc ? loc.warehouse_id : f.warehouse_id }));
          }}>
            <option value="">— None —</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}{form.warehouse_id ? '' : ` (${l.warehouse_name})`}</option>)}
          </select>
        </FormField>
        <FormField label="Status">
          <select className={inputClass} value={form.status} onChange={e => set('status', e.target.value as 'Active' | 'Inactive')}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </FormField>
        <FormField label="Image">
          <div className="flex items-center gap-3">
            {preview
              ? <img src={preview} alt="" className="w-14 h-14 rounded-md object-cover border border-slate-200" />
              : <div className="w-14 h-14 rounded-md bg-slate-100 text-slate-400 flex items-center justify-center"><Package size={20} /></div>}
            <div className="flex items-center gap-2">
              <input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs text-slate-600 min-w-0" />
              {(file || preview) && (
                <button
                  type="button"
                  onClick={() => { setFile(null); setPreview(null); set('image_url', ''); }}
                  className="px-2 py-1 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded border border-rose-200 transition-colors shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </FormField>
        {isNew ? (
          <>
            <FormField label="Opening Qty"><input className={inputClass} inputMode="decimal" value={form.opening_qty} onChange={e => set('opening_qty', e.target.value)} /></FormField>
            <FormField label="Opening Date"><input type="date" className={inputClass} value={form.opening_date} onChange={e => set('opening_date', e.target.value)} /></FormField>
          </>
        ) : (
          <div className="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Current Stock</p>
            <p className="text-lg font-bold text-slate-900">{formatQty(item!.current_stock)} {item!.unit ?? ''}</p>
            <p className="text-xs text-slate-500 mt-0.5">Stock changes only through transactions or Adjust Stock.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ViewItemModal({ row, initialTab, imageUrl, onClose, onOpenSource }: {
  row: InventoryItemRow;
  initialTab: 'details' | 'history';
  imageUrl: string | null;
  onClose: () => void;
  onOpenSource: (route: string) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [detail, setDetail] = useState<InventoryItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    let cancelled = false;
    inventoryApi.item(row.kind, row.id)
      .then(res => { if (!cancelled) setDetail(res); })
      .catch(e => { if (!cancelled) setError(errText(e)); });
    return () => { cancelled = true; };
  }, [row.kind, row.id]);

  const it = detail?.item ?? row;
  const allMovements = detail ? [...detail.movements].reverse() : null; // newest first for reading
  const movements = allMovements
    ? allMovements.filter(m => {
      const d = (m.txn_date ?? '').slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    })
    : null;

  return (
    <Modal open onClose={onClose} size="xl" title="View Item" subtitle={`${it.code} · ${it.name}`}
      footer={<button onClick={onClose} className={cancelBtn}>Close</button>}>
      <ModalError message={error} />
      <div className="flex gap-6 border-b border-slate-200 mb-4">
        {(['details', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-2.5 text-sm border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-600'}`}>
            {t === 'details' ? 'Details' : 'Movement History'}
          </button>
        ))}
      </div>
      {tab === 'details' && (
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="flex-shrink-0">
            {imageUrl
              ? <img src={imageUrl} alt="" className="w-32 h-32 rounded-lg object-cover border border-slate-200" />
              : <div className="w-32 h-32 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center"><Package size={36} /></div>}
          </div>
          <div className="flex-1">
            <DetailGrid fields={[
              ['Item Code', it.code],
              ['Item Name', it.name],
              ['Category', it.category_name],
              ['Specification', it.specification],
              ['Unit', it.unit],
              ['Current Stock', `${formatQty(it.current_stock)} ${it.unit ?? ''}`],
              ['Available Qty', `${formatQty(it.current_stock)} ${it.unit ?? ''}`],
              ['Reserved Qty', '—'],
              ['In Production Qty', '—'],
              ['Total Qty', `${formatQty(it.current_stock)} ${it.unit ?? ''}`],
              ['Minimum Stock', formatQty(it.min_stock)],
              ['Reorder Qty', formatQty(it.reorder_qty)],
              ['Rate', formatINR(it.rate)],
              ['Stock Value', formatINR(it.value)],
              ['Supplier', it.supplier_name],
              ['Warehouse / Location', [it.warehouse_name, it.location_name].filter(Boolean).join(' / ')],
              ['Status', <span className="inline-flex items-center gap-2"><StatusPill status={it.status} /> <span className="text-xs text-slate-500">{it.item_status}</span></span>],
              ['Last Updated', it.updated_at ? new Date(it.updated_at).toLocaleString('en-IN', { hour12: false }) : ''],
            ]} />
            <p className="text-[11px] text-slate-400 mt-3">
              Reserved and in-production quantities are not tracked separately — the ledger balance (available quantity) is authoritative.
            </p>
          </div>
        </div>
      )}
      {tab === 'history' && (
        <div>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputClass} />
            </div>
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs font-semibold text-slate-500 hover:text-slate-700 underline pb-2">Clear dates</button>
            )}
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Movement Type</th>
                  <th className="px-3 py-2 text-left">Reference</th>
                  <th className="px-3 py-2 text-left">Source Module</th>
                  <th className="px-3 py-2 text-right">Quantity In</th>
                  <th className="px-3 py-2 text-right">Quantity Out</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2 text-left">Warehouse</th>
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-center">Source</th>
                </tr>
              </thead>
              <tbody>
                {!movements && !error && [0, 1, 2, 3].map(i => (
                  <tr key={i}><td colSpan={10} className="px-3 py-2"><div className="h-4 rounded bg-slate-100 animate-pulse" /></td></tr>
                ))}
                {movements && movements.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">No transactions found.</td></tr>
                )}
                {movements && movements.map(m => {
                  const route = m.reference_type ? REFERENCE_ROUTES[m.reference_type] : undefined;
                  const neg = /^\s*-/.test(m.qty ?? '');
                  const absQty = formatQty((m.qty ?? '').replace(/-/g, ''));
                  return (
                    <tr key={m.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(m.txn_date)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{m.type}</td>
                      <td className="px-3 py-2" title={m.remarks ?? ''}>
                        {m.reference_no || (m.reference_type ? REFERENCE_LABELS[m.reference_type] ?? m.reference_type : '—')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                        {m.reference_type ? REFERENCE_LABELS[m.reference_type] ?? m.reference_type : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600">{neg ? '—' : `+${formatQty(m.qty)}`}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">{neg ? absQty : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatQty(m.balance)}</td>
                      <td className="px-3 py-2 text-slate-600">{m.warehouse_name ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{m.created_by || '—'}</td>
                      <td className="px-3 py-2 text-center">
                        {route
                          ? <button onClick={() => onOpenSource(route)} title="Open source" className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"><ExternalLink size={13} /></button>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AdjustStockModal({ row, onClose, onSaved }: { row: InventoryItemRow; onClose: () => void; onSaved: () => void }) {
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [qty, setQty] = useState('');
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!isPositiveQty(qty)) return setError('Enter a quantity greater than zero.');
    if (!date) return setError('Select the date.');
    if (!reason.trim()) return setError('Reason is required.');
    setSaving(true);
    setError(null);
    try {
      await inventoryApi.adjustStock({ kind: row.kind, id: row.id, direction, qty: qty.trim(), reason: reason.trim(), reference: reference.trim(), date });
      onSaved();
    } catch (e) {
      setError(errText(e));
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" title="Adjust Stock"
      footer={<>
        <button onClick={onClose} className={cancelBtn}>Cancel</button>
        <button onClick={save} disabled={saving} className={saveBtn}>{saving && <Loader2 size={14} className="animate-spin" />} Save Adjustment</button>
      </>}>
      <ModalError message={error} />
      <div className="space-y-4">
        <FormField label="Item">
          <input className={`${inputClass} bg-slate-50`} readOnly value={`${row.code} · ${row.name} (current ${formatQty(row.current_stock)} ${row.unit ?? ''})`} />
        </FormField>
        <FormField label="Direction" required>
          <div className="flex gap-2">
            {(['IN', 'OUT'] as const).map(d => (
              <button key={d} type="button" onClick={() => setDirection(d)}
                className={`flex-1 py-2 text-sm font-semibold rounded border ${direction === d
                  ? (d === 'IN' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-red-50 border-red-400 text-red-700')
                  : 'bg-white border-slate-300 text-slate-600'}`}>
                {d === 'IN' ? 'Increase' : 'Decrease'}
              </button>
            ))}
          </div>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label={`Quantity${row.unit ? ` (${row.unit})` : ''}`} required>
            <input className={inputClass} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />
          </FormField>
          <FormField label="Date" required><input type="date" className={inputClass} value={date} onChange={e => setDate(e.target.value)} /></FormField>
        </div>
        <FormField label="Reason" required><input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Physical count difference" /></FormField>
        <FormField label="Reference / Remarks"><input className={inputClass} value={reference} onChange={e => setReference(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}

function ItemPickerModal({ title, onPick, onClose }: {
  title: string;
  onPick: (row: InventoryItemRow) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<InventoryItemRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (term: string) => {
    setSearching(true);
    setError(null);
    try {
      const res = await inventoryApi.items({
        categoryId: null, search: term.trim() || null, supplierId: null,
        status: null, warehouseId: null, page: 1, pageSize: 20,
      });
      setResults(res.rows);
    } catch (e) {
      setError(errText(e));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => { search(''); }, []);

  return (
    <Modal open onClose={onClose} size="md" title={title} subtitle="Search by item code or name"
      footer={<button onClick={onClose} className={cancelBtn}>Cancel</button>}>
      <ModalError message={error} />
      <div className="flex gap-2 mb-3">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search(q); }}
          placeholder="Item code or name..."
          className={`${inputClass} flex-1`}
        />
        <button onClick={() => search(q)} disabled={searching} className={outlineBtn}>
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Search
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
        {results === null && <p className="px-3 py-6 text-center text-sm text-slate-400">Searching...</p>}
        {results !== null && results.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">No items found.</p>}
        {(results ?? []).map(r => (
          <button key={`${r.kind}:${r.id}`} onClick={() => onPick(r)}
            className="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold text-slate-800">{r.code} · {r.name}</span>
              <span className="block text-xs text-slate-500">{r.category_name ?? ''} · {formatQty(r.current_stock)} {r.unit ?? ''}</span>
            </span>
            <StatusPill status={r.status} />
          </button>
        ))}
      </div>
    </Modal>
  );
}

interface WarehouseOpt { id: string; code: string | null; name: string | null }

function TransferModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [warehouses, setWarehouses] = useState<WarehouseOpt[] | null>(null);
  const [item, setItem] = useState<InventoryItemRow | null>(null);
  const [picking, setPicking] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneRef, setDoneRef] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.from('cnc_warehouses').select('id,code,name').order('name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setWarehouses([]);
        else setWarehouses((data ?? []) as WarehouseOpt[]);
      });
    return () => { cancelled = true; };
  }, []);

  const whName = (id: string) => warehouses?.find(w => String(w.id) === id)?.name ?? id;

  const startReview = () => {
    if (!item) return setError('Select an item to transfer.');
    if (!fromId || !toId) return setError('Choose the source and destination warehouses.');
    if (fromId === toId) return setError('Source and destination must be different.');
    if (!isPositiveQty(qty)) return setError('Enter a quantity greater than zero.');
    if (!reason.trim()) return setError('A reason is required.');
    if (!date) return setError('Select the date.');
    setError(null);
    setReviewing(true);
  };

  const confirm = async () => {
    if (!item || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await inventoryApi.transferStock({
        kind: item.kind, id: item.id, fromWarehouse: fromId, toWarehouse: toId,
        qty: qty.trim(), reason: reason.trim(), reference: reference.trim(), date,
      });
      if (res.duplicate) {
        setDoneRef(`${res.reference_no} (already posted — duplicate prevented)`);
      } else {
        setDoneRef(res.reference_no);
      }
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" title="Stock Transfer" subtitle="Move stock between warehouses — posted as two atomic ledger movements"
      footer={doneRef
        ? <button onClick={onClose} className={saveBtn}>Done</button>
        : reviewing
          ? <>
            <button onClick={() => setReviewing(false)} disabled={saving} className={cancelBtn}>Back</button>
            <button onClick={confirm} disabled={saving} className={saveBtn}>
              {saving && <Loader2 size={14} className="animate-spin" />} Confirm & Transfer
            </button>
          </>
          : <>
            <button onClick={onClose} className={cancelBtn}>Cancel</button>
            <button onClick={startReview} className={saveBtn}>Review Transfer</button>
          </>}>
      <ModalError message={error} />
      {doneRef ? (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          Transfer posted with reference <b className="font-mono">{doneRef}</b>.
        </p>
      ) : reviewing && item ? (
        <div className="text-sm">
          <DetailGrid fields={[
            ['Item', `${item.code} · ${item.name}`],
            ['From', whName(fromId)],
            ['To', whName(toId)],
            ['Quantity', `${qty.trim()} ${item.unit ?? ''}`],
            ['Reason', reason.trim()],
            ['Date', date],
            ['Reference', reference.trim() || '(auto-generated)'],
          ]} />
          <p className="text-xs text-slate-500 mt-3">
            This writes one Quantity-Out movement in {whName(fromId)} and one Quantity-In movement in {whName(toId)} under a single reference. Both post together or neither does.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <FormField label="Item" required>
            <button onClick={() => setPicking(true)} className={`${inputClass} text-left ${item ? '' : 'text-slate-400'}`}>
              {item ? `${item.code} · ${item.name} (available ${formatQty(item.current_stock)} ${item.unit ?? ''})` : 'Select item...'}
            </button>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="From Warehouse" required>
              <select value={fromId} onChange={e => setFromId(e.target.value)} className={inputClass}>
                <option value="">Select...</option>
                {(warehouses ?? []).map(w => <option key={w.id} value={w.id}>{w.name ?? w.code ?? w.id}</option>)}
              </select>
            </FormField>
            <FormField label="To Warehouse" required>
              <select value={toId} onChange={e => setToId(e.target.value)} className={inputClass}>
                <option value="">Select...</option>
                {(warehouses ?? []).map(w => <option key={w.id} value={w.id}>{w.name ?? w.code ?? w.id}</option>)}
              </select>
            </FormField>
          </div>
          {warehouses !== null && warehouses.length === 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No warehouses found. Create them under Supply Chain → Warehouses before transferring stock.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <FormField label={`Quantity${item?.unit ? ` (${item.unit})` : ''}`} required>
              <input className={inputClass} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />
            </FormField>
            <FormField label="Date" required><input type="date" className={inputClass} value={date} onChange={e => setDate(e.target.value)} /></FormField>
          </div>
          <FormField label="Reason" required><input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Move to production store" /></FormField>
          <FormField label="Reference (optional)"><input className={inputClass} value={reference} onChange={e => setReference(e.target.value)} placeholder="Auto-generated when blank" /></FormField>
        </div>
      )}
      {picking && (
        <ItemPickerModal title="Select Item to Transfer" onClose={() => setPicking(false)} onPick={r => { setItem(r); setPicking(false); }} />
      )}
    </Modal>
  );
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const readFile = async (file: File | null) => {
    setRows(null); setResult(null); setParseError(null); setError(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const grid = parseCsv(await file.text());
      if (grid.length === 0) { setParseError('The file is empty.'); return; }
      const head = grid[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
      const hasHeader = head.includes('code') && head.includes('name');
      const index = IMPORT_COLUMNS.map((c, i) => (hasHeader ? head.indexOf(c) : i));
      const body = hasHeader ? grid.slice(1) : grid;
      const parsed = body.map(r => {
        const out = {} as ImportRow;
        IMPORT_COLUMNS.forEach((c, i) => { out[c] = index[i] >= 0 ? (r[index[i]] ?? '').trim() : ''; });
        return out;
      });
      if (parsed.length === 0) { setParseError('No data rows found under the header.'); return; }
      setRows(parsed);
    } catch (e) {
      setParseError(errText(e));
    }
  };

  const runImport = async () => {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const res = await inventoryApi.importItems(rows);
      setResult(res);
      if (res.created > 0) onImported();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Import Items"
      footer={<>
        <button onClick={onClose} className={cancelBtn}>{result ? 'Close' : 'Cancel'}</button>
        {!result && <button onClick={runImport} disabled={!rows || busy} className={saveBtn}>{busy && <Loader2 size={14} className="animate-spin" />} Import</button>}
      </>}>
      <ModalError message={error} />
      <div className="space-y-4">
        <div className="text-sm text-slate-600 bg-white border border-slate-200 rounded-lg p-4">
          <p className="mb-2">Upload a CSV file with these columns (header row recommended):</p>
          <code className="block text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-slate-800 break-all">{IMPORT_COLUMNS.join(',')}</code>
          <ul className="mt-2 text-xs text-slate-500 list-disc pl-5 space-y-0.5">
            <li><b>category</b>: category name or code; <b>supplier</b>: supplier name; <b>location</b>: location code or name.</li>
            <li>Quantities and rate are plain numbers (no ₹ or commas). <b>opening_qty</b> posts an opening stock entry.</li>
            <li>Invalid or duplicate rows are skipped and listed; valid rows are saved.</li>
          </ul>
          <button onClick={() => exportCsv('inventory-import-template', [IMPORT_COLUMNS])} className={`${outlineBtn} mt-3 h-9`}>
            <Download size={15} /> Download template
          </button>
        </div>
        <FormField label="CSV file">
          <input type="file" accept=".csv,text/csv" onChange={e => readFile(e.target.files?.[0] ?? null)} className="text-sm text-slate-600" />
        </FormField>
        {parseError && <p className="text-sm text-red-600">{parseError}</p>}
        {rows && !result && <p className="text-sm text-slate-700"><b>{formatQty(rows.length)}</b> rows ready to import from {fileName}.</p>}
        {result && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-emerald-700">Created {formatQty(result.created)}</p>
            {result.errors.length > 0 && (
              <div className="border border-red-200 rounded-lg overflow-hidden bg-white">
                <p className="px-3 py-2 text-xs font-semibold text-red-700 bg-red-50">{formatQty(result.errors.length)} rows skipped</p>
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-slate-600 bg-slate-50"><th className="px-3 py-1.5 text-left w-16">Row</th><th className="px-3 py-1.5 text-left">Code</th><th className="px-3 py-1.5 text-left">Error</th></tr></thead>
                    <tbody>
                      {result.errors.map((er, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-1.5">{er.row}</td>
                          <td className="px-3 py-1.5 font-medium">{er.code ?? ''}</td>
                          <td className="px-3 py-1.5 text-red-700">{er.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function TransactionModal({ txn, onClose, onOpenSource }: { txn: RecentTransaction; onClose: () => void; onOpenSource: (route: string) => void }) {
  const route = txn.reference_type ? REFERENCE_ROUTES[txn.reference_type] : undefined;
  return (
    <Modal open onClose={onClose} size="md" title="Transaction Detail" subtitle={`${txn.item_code} · ${txn.item_name}`}
      footer={<>
        <button onClick={onClose} className={cancelBtn}>Close</button>
        {route && <button onClick={() => onOpenSource(route)} className={saveBtn}><ExternalLink size={14} /> Open {REFERENCE_LABELS[txn.reference_type!] ?? 'source'}</button>}
      </>}>
      <DetailGrid fields={[
        ['Date', formatDate(txn.txn_date)],
        ['Type', txn.type],
        ['Direction', <DirectionBadge direction={txn.direction} />],
        ['Quantity', <SignedQty qty={txn.qty} unit={txn.unit} />],
        ['Item Code', txn.item_code],
        ['Item Name', txn.item_name],
        ['Reference Type', txn.reference_type ? REFERENCE_LABELS[txn.reference_type] ?? txn.reference_type : ''],
        ['Reference No', txn.reference_no],
        ['Remarks', txn.remarks],
        ['Created By', txn.created_by],
      ]} />
    </Modal>
  );
}

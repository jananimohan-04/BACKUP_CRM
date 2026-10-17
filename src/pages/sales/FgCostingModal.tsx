// "Finished Goods + Costing" modal for the Sales Pipeline Kanban.
// Opened INSTEAD of moving an Inward card to Finished Goods: the user reviews the
// engine-calculated costing (same implementation as the Quotation Costing page),
// completes gaps manually when masters are missing, optionally edits the approved
// price, and only on "Approve & Move" does the modal (1) save an Approved costing
// version and (2) perform the exact Finished Goods transition the pipeline has
// always performed (insert Completed work order + mark inward rows Processed).
// Cancel writes nothing and the card stays put.

import { useState, useEffect, useMemo, useRef, Fragment, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { productWithCompany } from '@/lib/productLabel';
import { calcWorkings, rowCost, type WorkRow, type Workings } from '@/lib/quotationWorkings';
import { supabase } from '@/lib/supabase';
import { todayISO } from '@/lib/format';
import { tint } from '@/lib/entryTints';
import { compactInput, inlineLbl } from '@/lib/compactFields';
import { Badge, Button, statusToVariant } from '@/components/ui/Card';
import { Modal, inputClass } from '@/components/ui/Modal';
import { attachDateTimeToProduct, getProductBaseName } from './SalesPipelinePage';
import { fetchOrderQty, recordProductionBatch, type OrderQtySummary } from '@/lib/orderQuantities';
import { insertTolerant } from '@/lib/partRouting';
import { useAuth } from '@/contexts/AuthContext';
import {
  costInr as inr, costNum as num, costUid as uid,
  buildMaterialLines, buildOpLines, computeTotals, computeWarnings,
  applyMatPatch, applyOpPatch,
  buildVersionPayload, parseQuoteProducts,
  type MaterialLine, type OpLine,
} from '@/lib/costingEngine';
import { CheckCheck, Save, AlertTriangle, X, Plus, Trash2, Pencil, ChevronDown } from 'lucide-react';

const cellInputClass = `${inputClass} text-xs !px-2 !py-1 w-full min-w-[3.5rem] tabular-nums`;

function EditNum({ value, onChange, aria }: { value: string | number; onChange: (v: string) => void; aria: string }) {
  return <input type="number" aria-label={aria} value={value} onChange={(e) => onChange(e.target.value)} className={cellInputClass} />;
}

const ManualTag = () => (
  <span className="ml-1 text-[10px] font-bold uppercase text-brand-600 bg-brand-50 border border-brand-200 rounded px-1">Manual</span>
);

const panelTitleClass = 'text-[10px] font-bold uppercase tracking-widest mb-1';
const cellTh = 'text-left py-1.5 pr-2 font-bold text-slate-500 uppercase text-[10px] whitespace-nowrap';
const cellTd = 'py-1.5 pr-2 tabular-nums whitespace-nowrap';

/** Ensure a cnc_parts row exists so the stock trigger can post FG receipts.
 *  Best-effort: failures only mean the trigger skips (never blocks a flow). */
async function ensurePart(pno: string, pname: string): Promise<string> {
  try {
    const clean = String(pno ?? '').trim();
    if (!clean) return '';
    const ex = await supabase.from('cnc_parts').select('id').eq('part_no', clean).limit(1);
    if (!ex.error && (ex.data ?? []).length > 0) return clean;
    try {
      await insertTolerant('cnc_parts', [{ part_no: clean, part_name: pname || clean, stock_qty: 0 }]);
    } catch { /* parts master unavailable; trigger will skip */ }
    return clean;
  } catch {
    return '';
  }
}

/** Point N/A/blank work-order part numbers at their product names so the
 *  stock trigger posts their completed deltas (self-heal for older approvals). */
async function healWorkOrderPartNos(salesOrderRef: string): Promise<void> {
  try {
    if (!salesOrderRef) return;
    const old = await supabase.from('cnc_work_orders').select('id,part_name,part_no').eq('sales_order', salesOrderRef);
    if (old.error) return;
    for (const w of (old.data ?? []) as any[]) {
      const pn = String(w?.part_no ?? '');
      if (pn !== '' && pn.toUpperCase() !== 'N/A') continue;
      const nm = String(w?.part_name ?? '').trim();
      if (!nm) continue;
      await ensurePart(nm, nm);
      try {
        await supabase.from('cnc_work_orders').update({ part_no: nm }).eq('id', w.id);
      } catch { /* backfill best-effort */ }
    }
  } catch { /* backfill best-effort */ }
}

export function FgCostingModal({ card, onClose, onMoved, mode = 'add', pickOptions = [], pickCompanies = [], onPick, inline = false, titleSlot, searchSlot }: {
  card: any;
  onClose: () => void;
  onMoved: () => void;
  /** Direct add: the sales orders / inwards the user can choose from (card.raw.__pick marks the blank starting card). */
  pickOptions?: { company: string; product: string; qty?: number }[];
  pickCompanies?: string[];
  onPick?: (company: string, product: string) => void;
  /** add: move an inward to Finished Goods. edit: revise the costing of an existing FG card. view: read-only. */
  mode?: 'add' | 'edit' | 'view';
  /** Render the whole thing as an inline page card instead of a popup (add mode only). */
  inline?: boolean;
  /** Optional list-page header pieces merged into the picker row (one line). */
  titleSlot?: ReactNode;
  searchSlot?: ReactNode;
}) {
  const { company, profile, canView, canDo } = useAuth() as any;
  const companyName: string = company?.company_name ?? 'ARGUS CNC';
  const userName: string = profile?.email ?? '';
  // ---- Access control (User Access Matrix) ----
  // Finished Goods permission governs the transaction; every costing section
  // and action additionally requires the Project Costing module
  // (product-costing accepted as its sibling module, mirroring RLS).
  const fgView: boolean = typeof canView === 'function' ? !!canView('finished-goods') : true;
  const fgEdit: boolean = typeof canDo === 'function' ? !!canDo('finished-goods', 'edit') : true;
  const hasCostView: boolean = typeof canView === 'function'
    ? (!!canView('project-costing') || !!canView('product-costing')) : true;
  const costPerm = (a: 'create' | 'edit' | 'approve' | 'export'): boolean =>
    typeof canDo === 'function'
      ? (!!canDo('project-costing', a) || !!canDo('product-costing', a)) : true;
  const canCreateCosting = costPerm('create');
  const canEditCosting = costPerm('edit');
  // Approval saves an Approved sheet AND moves the card, so it needs the
  // costing approve permission plus the Finished Goods edit permission that
  // already gates the Inward → Finished Goods move.
  const canApproveCosting = costPerm('approve') && fgEdit;

  const inward = card?.raw ?? {};
  const maxQ = num(card?.qty) || 0;
  const inwardGroupIds: string[] = Array.isArray(inward._groupIds) && inward._groupIds.length
    ? inward._groupIds : (inward.id ? [inward.id] : []);

  const [fgDate, setFgDate] = useState(mode !== 'add' && card?.date ? String(card.date).slice(0, 10) : todayISO());
  // Current production batch: good vs rejected are entered separately.
  // Rejected quantity is traceable but never becomes FG stock, DC qty or invoice qty.
  const [rejQty, setRejQty] = useState('');
  const [rejType, setRejType] = useState('');
  const [rejReason, setRejReason] = useState('');
  const [rejNotes, setRejNotes] = useState('');
  const [qtySum, setQtySum] = useState<OrderQtySummary | null>(null);
  const batchKeyRef = useRef<string | null>(null);
  // Products in this inward: every line is selectable, each selected product
  // gets its own finished-qty box and its own FG entry + batch on approval.
  // Raw inward lines; sale-order products (below) lead the selectable rows.
  const [inwardLines, setInwardLines] = useState<any[]>([]);
  const [prodSel, setProdSel] = useState<Record<string, string>>({});
  const [prodInitKey, setProdInitKey] = useState('');
  // Linked purchase inwards (actuals): service → reference block, goods →
  // one-click material lines. The estimate itself still prices from BOM when
  // one exists, like Project Costing separates estimated vs recorded cost.
  const [serviceActuals, setServiceActuals] = useState<{ rows: any[]; total: number }>({ rows: [], total: 0 });
  const [goodsActuals, setGoodsActuals] = useState<{ rows: any[]; total: number }>({ rows: [], total: 0 });
  const [goodsLoaded, setGoodsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [quote, setQuote] = useState<any | null>(null);
  const [so, setSo] = useState<any | null>(null);
  const [wos, setWos] = useState<any[]>([]);
  const [bom, setBom] = useState<any[]>([]);
  const [routing, setRouting] = useState<any[]>([]);
  const [rawMats, setRawMats] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [jobCards, setJobCards] = useState<any[]>([]);
  const [woOps, setWoOps] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);

  // Editable product code (drives the BOM lookup) + quotation overrides.
  const [code, setCode] = useState('');
  const [quoteQty, setQuoteQty] = useState('');
  const [quoteUnit, setQuoteUnit] = useState('');
  // Manual lines added by the user when masters are missing.
  const [extraMats, setExtraMats] = useState<MaterialLine[]>([]);
  const [extraOps, setExtraOps] = useState<OpLine[]>([]);
  const [newMat, setNewMat] = useState({ code: '', name: '', qty: '', unit: 'Nos', rate: '' });
  const [newOp, setNewOp] = useState({ process: '', machine: '', hours: '', mRate: '', lHours: '', lRate: '' });
  // Per-section edit mode + patches over auto lines (masters are never modified;
  // patched lines are flagged manual so adjustments stay visible).
  const [editMats, setEditMats] = useState(false);
  const [editOps, setEditOps] = useState(false);
  const [matPatches, setMatPatches] = useState<Record<string, MaterialLine>>({});
  const [opPatches, setOpPatches] = useState<Record<string, OpLine>>({});

  const [versions, setVersions] = useState<any[]>([]);
  const [sheetsMissing, setSheetsMissing] = useState(false);
  const [approvedInput, setApprovedInput] = useState('');
  // True once the approved price came from a saved version or the user typed
  // it — the quotation auto-fill below never overwrites either of those.
  const [approvedTouched, setApprovedTouched] = useState(false);
  // Set once the person types in the Approved Final Price box: a later reload of the saved sheet must not overwrite it.
  const approvedEdited = useRef(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  // Inward product lines (one selectable row per product, same-name lines
  // merged). Defaults select everything at full line qty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // select('*'): named-column selects fail on databases that predate
        // newer inward columns; star-selects never do.
        const r = inwardGroupIds.length > 0
          ? await supabase.from('cnc_inwards').select('*').in('id', inwardGroupIds).order('created_at')
          : { data: [] as any[], error: { message: 'no ids' } };
        if (cancelled) return;
        const src = (!r.error && (r.data ?? []).length > 0 ? r.data : [inward]) as any[];
        setInwardLines(src.filter((x: any) => x && (x.id || x.part_name || x.product_name)));
      } catch {
        if (!cancelled) setInwardLines([inward]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selectable rows: SALE ORDER products lead (order qty shown, inward qty
  // matched underneath); without SO items, the inward lines lead instead.
  // Warehouses for the finished goods: each product shows the default one, and can be changed.
  const [whs, setWhs] = useState<{ id: string; name: string; isDefault: boolean }[]>([]);
  const [whSel, setWhSel] = useState<Record<string, string>>({});
  useEffect(() => {
    let off = false;
    (async () => {
      const r = await supabase.from('cnc_warehouses').select('*').order('created_at', { ascending: true });
      if (off || r.error) return;
      setWhs(((r.data ?? []) as any[]).filter((w) => String(w.status ?? 'Active') !== 'Inactive')
        .map((w) => ({ id: String(w.id), name: String(w.name ?? w.code ?? ''), isDefault: w.is_default === true })));
    })();
    return () => { off = true; };
  }, []);
  const defaultWhId = (whs.find((w) => w.isDefault) ?? whs[0])?.id ?? '';

  const prodRows = useMemo(() => {
    const norm = (s: any) => String(s ?? '').trim().toLowerCase();
    const inRows = (inwardLines ?? []).map((x: any) => ({
      name: String(x?.part_name || x?.product_name || 'Unnamed').trim() || 'Unnamed',
      qty: Number(x?.quantity) || 0,
      partNumber: String(x?.part_number ?? '').trim(),
      id: String(x?.id ?? ''),
    }));
    let items: any[] = [];
    try {
      const rawItems = (so as any)?.items;
      const parsed = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
      if (Array.isArray(parsed)) items = parsed;
    } catch { /* fall back to inward lines */ }
    const soProds = items
      .map((it: any) => ({
        name: attachDateTimeToProduct(String(it.partName || it.productName || it.part_name || it.description || '').trim(), so),
        qty: Number(it.quantity ?? it.qty) || 0,
        partNumber: String(it.partNumber || it.part_number || '').trim(),
      }))
      .filter((p) => p.name);
    if (soProds.length === 0) {
      const merged = new Map<string, { key: string; ids: string[]; name: string; qty: number; inwardQty: number; partNumber: string }>();
      inRows.forEach((r, i) => {
        const ex = merged.get(norm(r.name));
        if (ex) {
          if (r.id && !ex.ids.includes(r.id)) ex.ids.push(r.id);
          ex.qty += r.qty; ex.inwardQty += r.qty;
          if (!ex.partNumber && r.partNumber) ex.partNumber = r.partNumber;
        } else {
          merged.set(norm(r.name), { key: `in-${i}`, ids: r.id ? [r.id] : [], name: r.name, qty: r.qty, inwardQty: r.qty, partNumber: r.partNumber });
        }
      });
      return [...merged.values()];
    }
    return soProds.map((p, i) => {
      const matched = inRows.filter((r) => norm(r.name) === norm(p.name) || norm(getProductBaseName(r.name)) === norm(getProductBaseName(p.name)));
      return {
        key: `so-${i}`,
        ids: matched.map((r) => r.id).filter(Boolean),
        name: p.name,
        qty: p.qty,
        inwardQty: matched.reduce((s, r) => s + r.qty, 0),
        partNumber: p.partNumber || matched.find((r) => r.partNumber)?.partNumber || '',
      };
    });
  }, [so, inwardLines]);

  useEffect(() => {
    const key = prodRows.map((r) => r.key).join('|');
    if (!key || key === prodInitKey) return;
    const init: Record<string, string> = {};
    for (const r of prodRows) init[r.key] = (r.inwardQty > 0 ? String(r.inwardQty) : '');
    setProdSel(init);
    setProdInitKey(key);
  }, [prodRows, prodInitKey]);

  // Prefer the first selected product's part number for BOM/routing lookup.
  const firstProdKey = Object.keys(prodSel)[0];
  const firstProd = prodRows.find((r) => r.key === firstProdKey) ?? null;
  useEffect(() => {
    if (code.trim() !== '' || !firstProd?.partNumber) return;
    const c = String(firstProd.partNumber).trim();
    if (c && c.toUpperCase() !== 'N/A') setCode(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstProd?.partNumber]);

  // ---- load live source records for this inward card ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const soRef: string = inward.sales_order_ref ?? '';
        let soRow: any = null;
        if (soRef) {
          const r = await supabase.from('cnc_sales_orders').select('*').eq('order_no', soRef).limit(1);
          if (!r.error && (r.data ?? []).length > 0) soRow = r.data![0];
        }
        if (cancelled) return;
        setSo(soRow);
        // Quotation pricing is restricted: only fetch it for Project Costing viewers.
        let qRow: any = null;
        if (hasCostView) {
          if (soRow?.quotation_id) {
            const r = await supabase.from('cnc_quotations').select('*').eq('id', soRow.quotation_id).limit(1);
            if (!r.error && (r.data ?? []).length > 0) qRow = r.data![0];
          }
          if (!qRow && soRow?.quote_no) {
            const r = await supabase.from('cnc_quotations').select('*').eq('quote_no', soRow.quote_no).limit(1);
            if (!r.error && (r.data ?? []).length > 0) qRow = r.data![0];
          }
        }
        if (cancelled) return;
        setQuote(qRow);
        const codeCandidates = [soRow?.part_no, inward.part_number, qRow?.part_number];
        setCode(String(codeCandidates.find((c) => String(c ?? '').trim() !== '' && String(c).trim().toUpperCase() !== 'N/A') ?? '').trim());
        let woRows: any[] = [];
        if (soRow?.order_no) {
          const r = await supabase.from('cnc_work_orders').select('*').eq('sales_order', soRow.order_no).order('created_at');
          if (!r.error) woRows = r.data ?? [];
        }
        if (cancelled) return;
        setWos(woRows);
        // Self-heal for the stock trigger (runs on open AND on approve).
        // Gated on costing view: only approvers reach the approval path.
        if (hasCostView && soRow?.order_no) void healWorkOrderPartNos(String(soRow.order_no));
        // Linked purchase actuals for reference (same source as the Project
        // Costing material/service tabs): service → reference block, goods →
        // one-click material lines. Matched by UNIQUE NUMBER: the inward
        // card's and the order's base numbers (stamp suffixes stripped, so
        // 1010 matches 1010-28Sep26-0994PM) plus the exact sales order number.
        if (hasCostView && (soRow?.order_no || inwardGroupIds.length > 0)) {
          try {
            const base = (s: any) => String(s || '').replace(/-\d{2}[A-Za-z]{3}\d{2}-\d{4}(AM|PM)$/, '').trim().toLowerCase();
            const r = await supabase.from('cnc_inwards').select('*');
            if (!cancelled && !r.error) {
              const all = (r.data ?? []) as any[];
              const scope = new Set<string>();
              if (soRow?.lead_no) scope.add(base(soRow.lead_no));
              if (soRow?.order_no) scope.add(String(soRow.order_no).trim().toLowerCase());
              for (const g of all.filter((x: any) => inwardGroupIds.includes(String(x?.id ?? '')))) {
                if (g.project_name) scope.add(base(g.project_name));
              }
              const linked = all.filter((inv: any) =>
                scope.has(String(inv.sales_order_ref ?? '').trim().toLowerCase()) || scope.has(base(inv.project_name)));
              const isService = (c: any) => /service/i.test(String(c ?? ''));
              const isGoods = (c: any) => {
                const s = String(c ?? '').trim().toUpperCase();
                return s.includes('GOODS PURCHASE') || s.includes('GOODS_PURCHASE') || s === 'PURCHASE';
              };
              const amountOf = (inv: any) => {
                const q = Number(inv.quantity) || 0;
                return Number(inv.total_amount) || q * (Number(inv.price) || 0);
              };
              const svc = linked.filter((inv: any) => isService(inv.category));
              setServiceActuals({ rows: svc, total: svc.reduce((s: number, inv: any) => s + amountOf(inv), 0) });
              const goods = linked.filter((inv: any) => isGoods(inv.category));
              setGoodsActuals({ rows: goods, total: goods.reduce((s: number, inv: any) => s + amountOf(inv), 0) });
            }
          } catch { /* reference blocks stay empty */ }
        }
        // Order-level quantity reconciliation (good / rejected / delivered /
        // invoiced from live rows) for the batch summary and validation.
        if (soRow?.order_no) {
          try {
            const { summary } = await fetchOrderQty(
              soRow.id != null ? String(soRow.id) : null, String(soRow.order_no));
            if (!cancelled && summary) setQtySum(summary);
          } catch { /* summary stays null; local work-order fallback below */ }
        }
        // Masters feed costing only: skip them without Project Costing view.
        let rmRes: any = { data: [], error: null };
        let supRes: any = { data: [], error: null };
        let jcRes: any = { data: [], error: null };
        let wooRes: any = { data: [], error: null };
        let procRes: any = { data: [], error: null };
        if (hasCostView) {
          ([rmRes, supRes, jcRes, wooRes, procRes] = await Promise.all([
            supabase.from('cnc_raw_materials').select('*'),
            supabase.from('cnc_suppliers').select('id,name'),
            woRows.length > 0
              ? supabase.from('cnc_job_cards').select('*').in('work_order', woRows.map((w) => w.wo_no))
              : Promise.resolve({ data: [], error: null } as any),
            woRows.length > 0
              ? supabase.from('cnc_work_order_operations').select('*').in('work_order_id', woRows.map((w) => w.id)).order('operation_sequence')
              : Promise.resolve({ data: [], error: null } as any),
            supabase.from('cnc_processes').select('*').order('process_code'),
          ]));
        }
        if (cancelled) return;
        if (!rmRes.error) setRawMats(rmRes.data ?? []);
        if (!supRes.error) {
          const map: Record<string, string> = {};
          for (const s of supRes.data ?? []) map[String(s.id)] = s.name ?? '';
          setSuppliers(map);
        }
        if (!jcRes.error) setJobCards(jcRes.data ?? []);
        if (!wooRes.error && !(wooRes as any).error) setWoOps((wooRes.data ?? []) as any[]);
        if (!procRes.error) setProcesses(procRes.data ?? []);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- BOM + routing follow the (editable) product code ----
  // Routing is the first-batch fallback: before any work order exists there
  // are no operations/job cards to cost from, so the engineered routing steps
  // (valued with live Process Master rates) fill the tables instead.
  // Source order: Active Part Routing revision first, legacy cnc_routing second.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // BOM + routing are costing inputs: skip them without Project Costing view.
      if (!hasCostView) { setBom([]); setRouting([]); return; }
      if (!code.trim()) { setBom([]); setRouting([]); return; }
      const b = await supabase.from('cnc_bom').select('*').eq('parent_part_no', code.trim()).order('level').order('created_at');
      if (cancelled) return;
      if (!b.error) setBom(b.data ?? []);
      try {
        const h = await supabase.from('cnc_part_routings').select('id').eq('product_code', code.trim()).eq('status', 'Active').order('revision', { ascending: false }).limit(1);
        if (!h.error && (h.data ?? []).length > 0) {
          const s = await supabase.from('cnc_part_routing_steps').select('*').eq('routing_id', h.data![0].id).order('sequence');
          if (cancelled) return;
          if (!s.error && (s.data ?? []).length > 0) {
            setRouting((s.data ?? []).map((r: any) => ({
              op_no: Number(r.sequence),
              operation: r.process_name || r.process_code || '',
              machine: r.machine ?? '',
              setup_time: r.setup_time,
              cycle_time: r.cycle_time,
            })));
            return;
          }
        }
      } catch { /* versioned routing unavailable; legacy fallback below */ }
      if (cancelled) return;
      const r = await supabase.from('cnc_routing').select('*').eq('parent_part_no', code.trim()).order('op_no');
      if (!cancelled && !r.error) setRouting(r.data ?? []);
    })();
    return () => { cancelled = true; };
  }, [code]);

  // The key a costing sheet is stored under: the quotation number, or (direct orders) the sales order number.
  const soNoForSheets = String(so?.order_no || inward?.sales_order_ref || '').trim();
  const sheetKey: { quotationNo: string; salesOrderNo: string } | null = quote?.quote_no
    ? { quotationNo: String(quote.quote_no), salesOrderNo: '' }
    : (soNoForSheets ? { quotationNo: '', salesOrderNo: soNoForSheets } : null);
  const sheetsFor = (k: { quotationNo: string; salesOrderNo: string }) => {
    const q = supabase.from('cnc_costing_sheets').select('*');
    return (k.quotationNo ? q.eq('quotation_no', k.quotationNo) : q.eq('quotation_no', '').eq('sales_order_no', k.salesOrderNo))
      .eq('product_code', code ?? '').order('version', { ascending: false });
  };

  // ---- versions follow quotation + product code ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Saved sheets hold restricted pricing: never load them without Project Costing view.
      if (!sheetKey || !hasCostView) return;
      const v = await sheetsFor(sheetKey);
      if (cancelled) return;
      if (!v.error) {
        setVersions(v.data ?? []);
        const latest = (v.data ?? [])[0];
        if (latest?.approved_price != null && !approvedEdited.current) { setApprovedInput(String(latest.approved_price)); setApprovedTouched(true); }
        if (latest?.lines?.quoteOverrides) {
          const qo = latest.lines.quoteOverrides;
          if (qo.qty != null) setQuoteQty(String(qo.qty));
          if (qo.unit != null) setQuoteUnit(String(qo.unit));
        }
      } else if ((v.error as any).code === 'PGRST205') {
        setSheetsMissing(true);
      }
    })();
    return () => { cancelled = true; };
  // Keyed by the values, not the object: sheetKey is rebuilt on every render and would refetch (and reset the price) after every keystroke.
  }, [sheetKey?.quotationNo, sheetKey?.salesOrderNo, code]);

  const products = useMemo(() => (quote ? parseQuoteProducts(quote) : []), [quote]);
  const product = products[0] ?? null;
  const selectedProds = prodRows.filter((r) => prodSel[r.key] !== undefined);
  const finishedOf = (r: { key: string }) => Math.max(0, num(prodSel[r.key]));
  const productName = firstProd?.name || inward.part_name || so?.part_name || product?.name || quote?.part_name || '';

  const baseQty = selectedProds.reduce((s, r) => s + finishedOf(r), 0);
  const rejNum = Math.max(0, num(rejQty));
  // Order-level reconciliation: live summary when loaded, else the work-order
  // rows already in hand. Completion is always measured on GOOD quantity.
  const orderedQty = num(so?.quantity);
  const prevGood = qtySum ? qtySum.good : (wos || []).reduce((s: number, w: any) => s + num(w?.completed), 0);
  const prevRejected = qtySum ? qtySum.rejected : (wos || []).reduce((s: number, w: any) => s + num(w?.rejected), 0);
  const remainingQty = orderedQty > 0 ? Math.max(0, orderedQty - prevGood) : 0;
  const totalGoodAfter = prevGood + baseQty;

  // Quotation overrides (edit the sheet's quoted qty / unit price, never the master).
  const qQtyEff = quoteQty.trim() === '' ? num(quote?.quantity) : num(quoteQty);
  const qUnitEff = quoteUnit.trim() === '' ? num(quote?.unit_price) : num(quoteUnit);
  const origBase = num(quote?.quantity) * num(quote?.unit_price);
  const quoteFactor = origBase > 0 ? num(quote?.total_value) / origBase : 1;
  const effQuoteTotal = qQtyEff * qUnitEff * quoteFactor;
  const quoteManual = quoteQty.trim() !== '' || quoteUnit.trim() !== '';
  const quoteOverrides = quoteManual ? { qty: quoteQty.trim() === '' ? null : num(quoteQty), unit: quoteUnit.trim() === '' ? null : num(quoteUnit) } : null;

  const autoMats = useMemo(
    () => buildMaterialLines(bom, rawMats, suppliers, baseQty),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bom, rawMats, suppliers, baseQty]);
  // Job cards carry the freshest execution plan (machine/operator/cycle times
  // set at release/scheduling). Prefer them over the work-order operations —
  // e.g. a card with 24 planned hours prices correctly while the WO operation
  // still shows cycle 0. Falls back to WO ops, then engineered routing.
  const autoOps = useMemo(() => {
    const woNos = new Set((wos ?? []).map((w: any) => String(w.wo_no ?? '')));
    const relevant = (jobCards ?? []).filter((c: any) => woNos.has(String(c.work_order ?? '')));
    if (relevant.length > 0) return buildOpLines([], relevant, processes, wos);
    return buildOpLines(woOps, jobCards, processes, wos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woOps, jobCards, processes, wos]);
  // First-batch fallback: no work orders/job cards exist yet, so value the
  // engineered routing steps with Process Master rates (hours scale with the
  // batch qty). Real production history wins whenever it exists.
  const routingAutoOps = useMemo(() => {
    if (!routing.length) return [];
    const cards = routing.map((r: any) => ({
      work_order: '__routing__',
      op_no: Number(r.op_no) || 0,
      operation: r.operation ?? '',
      machine: r.machine ?? '',
      operator: '',
      qty_planned: baseQty,
      qty_completed: 0,
      cycle_time: r.cycle_time,
      setup_time: r.setup_time,
    }));
    return buildOpLines([], cards, processes, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routing, processes, baseQty]);
  const effAutoOps = autoOps.length > 0 ? autoOps : routingAutoOps;
  const matLines = useMemo(() => [...autoMats.map((m) => matPatches[m.key] ?? m), ...extraMats], [autoMats, extraMats, matPatches]);
  const opLines = useMemo(() => {
    const startSeq = effAutoOps.length > 0 ? Math.max(...effAutoOps.map((o) => o.seq)) : 0;
    const base = [...effAutoOps.map((o) => opPatches[o.key] ?? o), ...extraOps.map((o, i) => ({ ...o, seq: startSeq + i + 1 }))];
    return base;
  }, [effAutoOps, extraOps, opPatches]);

  const patchMat = (key: string, patch: Partial<MaterialLine>) => {
    if (extraMats.some((m) => m.key === key)) {
      setExtraMats((ls) => applyMatPatch(ls, key, patch));
    } else {
      const base = matPatches[key] ?? autoMats.find((m) => m.key === key);
      if (base) setMatPatches((prev) => ({ ...prev, [key]: applyMatPatch([prev[key] ?? base], key, patch)[0] }));
    }
  };
  const patchOp = (key: string, patch: Partial<OpLine>) => {
    if (extraOps.some((o) => o.key === key)) {
      setExtraOps((ls) => applyOpPatch(ls, key, patch));
    } else {
      const base = opPatches[key] ?? effAutoOps.find((o) => o.key === key);
      if (base) setOpPatches((prev) => ({ ...prev, [key]: applyOpPatch([prev[key] ?? base], key, patch)[0] }));
    }
  };

  const buildPendingMat = (): MaterialLine | null => {
    if (!newMat.name.trim() || !(num(newMat.qty) > 0)) return null;
    const qty = num(newMat.qty);
    const rate = num(newMat.rate);
    return {
      key: uid(), material_code: newMat.code.trim(), material_name: newMat.name.trim(),
      req_qty: qty, unit: newMat.unit.trim() || 'Nos', unit_cost: rate, total: qty * rate,
      supplier: '', remarks: 'Added manually in pipeline', manual: true,
    };
  };

  const buildPendingOp = (existingCount: number): OpLine | null => {
    if (!newOp.process.trim() || !(num(newOp.hours) > 0)) return null;
    const mh = num(newOp.hours);
    const mRate = num(newOp.mRate);
    const lh = num(newOp.lHours);
    const lRate = num(newOp.lRate);
    const mc = mh * mRate;
    const lc = lh * lRate;
    return {
      key: uid(), seq: existingCount + 1,
      process_code: '', process_name: newOp.process.trim(),
      machine: newOp.machine.trim(), operator: '',
      machine_hours: mh, machine_rate: mRate, machine_cost: mc,
      labour_hours: lh, labour_rate: lRate, labour_cost: lc,
      cycle_time: 0, setup_time: 0,
      cost_per_hour: mRate, cost_per_component: 0, setup_cost: 0,
      // Machine cost is considered process cost.
      process_cost: mc + lc,
      manual: true, warn_machine: mh > 0 && mRate <= 0, warn_labour: lh > 0 && lRate <= 0,
    };
  };

  // Pending (typed but not yet Added) input counts too — it is committed
  // automatically on Save/Approve so typed values are never silently ignored.
  const draftMat = buildPendingMat();
  const draftOp = buildPendingOp(opLines.length);
  const effMatLines = draftMat ? [...matLines, draftMat] : matLines;
  const effOpLines = draftOp ? [...opLines, draftOp] : opLines;
  const effWarnings = computeWarnings({
    hasQuote: !!quote, baseQty, bom, woOps, jobCards: jobCards.length > 0 ? jobCards : routing, opLines: effOpLines,
    manualMaterials: effMatLines.some((m) => m.manual), manualOps: effOpLines.some((o) => o.manual),
  });
  // Effective totals include typed-but-unadded input, so values on screen always match.
  const effTotals = computeTotals(effMatLines, effOpLines, effQuoteTotal);

  const totals = useMemo(
    () => computeTotals(effMatLines, effOpLines, effQuoteTotal),
    [effMatLines, effOpLines, effQuoteTotal]);
  const warnings = effWarnings;

  const approvedNum = approvedInput.trim() === '' ? null : num(approvedInput);
  const effectiveApproved = approvedNum ?? totals.calculated;
  const adjustment = effectiveApproved - totals.calculated;
  // Comparison: quotation (quoted) vs project cost (manufacturing cost).
  const projectCost = totals.material + totals.process;
  const costDiff = effQuoteTotal - projectCost;
  const costDiffPct = effQuoteTotal > 0 ? (costDiff / effQuoteTotal) * 100 : null;
  // Default the approved price to the quotation's ex-GST basic value (the
  // invoice adds GST on top of this rate, so copying the GST-inclusive
  // quotation total here would tax the tax: 1,18,000 billed as 1,39,240).
  // Follows quote overrides until a saved version's price arrives or the user
  // types their own. Header gst_percent mirrors the line rate (single-rate
  // quotes are exact; mixed-rate quotes stay editable).
  const quoteGstRate = (() => { const g = Number(quote?.gst_percent); return Number.isFinite(g) && g > 0 ? g : 18; })();
  useEffect(() => {
    if (approvedTouched || approvedInput.trim() !== '' || !(effQuoteTotal > 0)) return;
    setApprovedInput(String(Math.round(effQuoteTotal / (1 + quoteGstRate / 100))));
  }, [effQuoteTotal, approvedTouched, approvedInput, quoteGstRate]);
  const nextVersion = (versions[0]?.version ?? 0) + 1;
  const blockReasons: string[] = [];
  if (loading) blockReasons.push('Costing data is still loading.');
  if (loadError) blockReasons.push('Costing data failed to load.');
  if (sheetsMissing && hasCostView) blockReasons.push('Costing storage is not provisioned (apply migration 20260930000000_costing_sheets.sql).');
  if (!(baseQty > 0)) blockReasons.push('Enter a finished quantity greater than 0 for at least one product.');
  if (selectedProds.length === 0) blockReasons.push('Select at least one product.');
  for (const r of selectedProds) {
    const cap = (r as any).inwardQty > 0 ? (r as any).inwardQty : (orderedQty > 0 ? remainingQty : null);
    if (cap != null && finishedOf(r) > cap + 1e-9) blockReasons.push(`${r.name}: finished qty exceeds ${(r as any).inwardQty > 0 ? `its inward qty (${(r as any).inwardQty})` : `the remaining order qty (${cap})`}.`);
  }
  if (so && orderedQty > 0 && baseQty > remainingQty) blockReasons.push(`Batch good qty exceeds the remaining order qty (${remainingQty} of ${orderedQty} pcs).`);
  if (rejNum > 0 && !rejType) blockReasons.push('Select a rejection type for the rejected quantity.');
  if (rejNum > 0 && !rejReason.trim()) blockReasons.push('Enter a rejection reason for the rejected quantity.');
  // TESTING: BOM / work-order warnings (effWarnings) do not block approval for now.
  const canApprove = blockReasons.length === 0;

  const addManualMat = () => {
    const line = buildPendingMat();
    if (!line) return;
    setExtraMats((ls) => [...ls, line]);
    setNewMat({ code: '', name: '', qty: '', unit: 'Nos', rate: '' });
  };

  // Fill the estimate from linked goods-purchase actuals (Project Costing
  // material tab source). Lines stay editable and flagged manual.
  const loadGoodsActuals = () => {
    const lines: MaterialLine[] = goodsActuals.rows.map((inv: any) => {
      const qty = Number(inv.quantity) || 0;
      const rate = Number(inv.price) || (qty > 0 ? (Number(inv.total_amount) || 0) / qty : 0);
      return {
        key: uid(),
        material_code: '',
        material_name: String(inv.part_name || inv.product_name || 'Material'),
        req_qty: qty, unit: 'pcs', unit_cost: rate, total: qty * rate,
        supplier: '', remarks: `Actual: ${inv.inward_no ?? ''}`, manual: true,
      };
    }).filter((l) => l.req_qty > 0);
    if (lines.length === 0) return;
    setExtraMats((ls) => [...ls, ...lines]);
    setGoodsLoaded(true);
  };

  // No BOM to calculate from (BOM missing or all-zero) → consider the
  // Project Costing material actuals as the material cost, automatically.
  useEffect(() => {
    if (goodsLoaded || goodsActuals.rows.length === 0 || extraMats.length > 0) return;
    const bomTotal = autoMats.reduce((s, m) => s + num(m.total), 0);
    if (bomTotal > 0) return;
    loadGoodsActuals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goodsActuals, autoMats, extraMats.length, goodsLoaded]);

  const addManualOp = () => {
    const line = buildPendingOp(opLines.length);
    if (!line) return;
    setExtraOps((ls) => [...ls, line]);
    setNewOp({ process: '', machine: '', hours: '', mRate: '', lHours: '', lRate: '' });
  };

  const persistVersion = async (status: 'Draft' | 'Calculated' | 'Approved', approved: number) => {
    // Commit any typed-but-unadded input first so the saved version matches the screen.
    if (draftMat) setExtraMats((ls) => [...ls, draftMat]);
    if (draftOp) setExtraOps((ls) => [...ls, draftOp]);
    const { error } = await supabase.from('cnc_costing_sheets').insert([
      buildVersionPayload({
        quote: quote ?? {}, so, productCode: code, productName, baseQty,
        status, version: nextVersion, totals, approved,
        matLines: effMatLines, opLines: effOpLines, userName, quoteOverrides,
      }),
    ]);
    if (error) throw error;
  };

  const reloadVersions = async () => {
    if (!sheetKey) return;
    const v = await sheetsFor(sheetKey);
    if (!v.error) setVersions(v.data ?? []);
  };

  const saveDraft = async () => {
    if (!(canCreateCosting || canEditCosting)) {
      alert('Saving costing needs the Project Costing create or edit permission.');
      return;
    }
    if (sheetsMissing) {
      alert('Costing storage is not provisioned. Apply supabase/migrations/20260930000000_costing_sheets.sql first.');
      return;
    }
    if (baseQty <= 0) {
      alert('A quantity greater than 0 is required before saving.');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'edit') {
        // Editing a finished-goods entry: without the approve permission this
        // stays a Draft (never an Approved version); approvers keep the
        // existing save-as-Approved behaviour, then refresh the board/lists.
        await persistVersion(canApproveCosting ? 'Approved' : 'Draft', effectiveApproved);
        onMoved();
        onClose();
        return;
      }
      await persistVersion('Draft', effectiveApproved);
      await reloadVersions();
      alert(`Costing draft saved as version ${nextVersion}. The card stays in Inward until approval.`);
    } catch (e: any) {
      alert(`Failed to save draft: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const approveAndMove = async () => {
    if (approving) return;
    // Move-only users (Finished Goods edit without costing approval) skip the
    // sheet persist below and only move the goods; pricing approval happens
    // later through an authorized costing user.
    if (!canApproveCosting && !fgEdit) {
      alert('Moving to Finished Goods needs Finished Goods edit access (approving pricing additionally needs the Project Costing approve permission).');
      return;
    }
    if (!canApprove) {
      alert(`Cannot approve yet:\n- ${blockReasons.join('\n- ')}`);
      return;
    }
    setApproving(true);
    try {
      const groupIds: string[] = Array.isArray(inward._groupIds) && inward._groupIds.length
        ? inward._groupIds : (inward.id ? [inward.id] : []);
      if (groupIds.length > 0) {
        const chk = await supabase.from('cnc_inwards').select('id,status,part_name,product_name').in('id', groupIds);
        if (!chk.error && (chk.data ?? []).length > 0 && (chk.data ?? []).every((r: any) => r.status === 'Processed')) {
          // "Processed" only means something while the finished goods it produced still exist. If they were
          // deleted, the inward is stuck as Processed with nothing in Finished Goods: free it so it can move again.
          const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
          const ref = lc(inward.sales_order_ref);
          const names = new Set((chk.data ?? []).flatMap((r: any) => [lc(r.part_name), lc(r.product_name)]).filter(Boolean));
          const fg = await supabase.from('cnc_work_orders').select('id,sales_order,customer,part_name,completed').gt('completed', 0);
          const stillThere = !fg.error && (fg.data ?? []).some((w: any) =>
            ref ? lc(w.sales_order) === ref : (lc(w.customer) === lc(card.customer) && names.has(lc(w.part_name))));
          if (fg.error || stillThere) {
            alert('This inward was already moved to Finished Goods. Refresh the board.');
            onMoved();
            onClose();
            return;
          }
          const reset = await supabase.from('cnc_inwards').update({ status: 'Pending' }).in('id', groupIds);
          if (reset.error) throw new Error(`Could not re-open this inward: ${reset.error.message}`);
        }
      }
      // 1) Save the Approved costing version (same payload shape as the costing page).
      // Move-only users skip this: without the approve permission the database
      // trigger would reject an Approved version anyway, and they never saw the
      // pricing. A quotation is optional: a direct order is costed and approved against its sales order instead.
      if (canApproveCosting) {
        await persistVersion('Approved', effectiveApproved);
      }
      // 2) One work-order row + batch per selected product. Good quantity
      // becomes FG stock (via the stock trigger on `completed`); rejected
      // quantity is recorded on the first product only, for traceability, and
      // never enters stock, DCs or invoices.
      //
      // Stock needs a real part number (the trigger skips '' / 'N/A') and a
      // matching cnc_parts row, so both are ensured here. Older approvals
      // stored N/A: point them at their product names so the trigger posts
      // their deltas too (best-effort; failures never block the approval).
      if (!batchKeyRef.current) batchKeyRef.current = uid();
      await healWorkOrderPartNos(inward.sales_order_ref || '');
      const insertWO = async (parts: {
        id: string; woNo: string; name: string; partNo: string; good: number; rej: number; warehouseId?: string;
      }) => {
        const pno = String(parts.partNo || code || parts.name || '').trim();
        await ensurePart(pno, parts.name);
        const base: any = {
          id: parts.id, wo_no: parts.woNo, customer: card.customer,
          part_name: parts.name, part_no: pno || parts.name,
          completed: parts.good, rejected: parts.rej, status: 'Completed',
          sales_order: inward.sales_order_ref || '', quantity: so?.quantity || maxQ, start_date: fgDate, due_date: fgDate,
          priority: 'Normal', drawing_revision: '0', description: '',
          created_at: fgDate + 'T00:00:00Z',
        };
        if (parts.warehouseId) base.warehouse_id = parts.warehouseId;
        let woErr = await supabase.from('cnc_work_orders').insert([base]);
        if (woErr.error && /warehouse_id/.test(String(woErr.error.message || ''))) {
          delete base.warehouse_id; // database predates the warehouse column: the stock still moves
          woErr = await supabase.from('cnc_work_orders').insert([base]);
        }
        if (woErr.error) {
          const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(String(woErr.error.message || ''));
          if (m && (m[1] === 'rejected')) {
            // Cloud schema predates the rejected column: retry without it so the
            // good quantity still moves; rejection traceability is skipped.
            const c = { ...base };
            delete c.rejected;
            const retry = await supabase.from('cnc_work_orders').insert([c]);
            if (retry.error) throw retry.error;
          } else {
            throw woErr.error;
          }
        }
        return parts.id;
      };
      const doneLines: string[] = [];
      for (let pi = 0; pi < selectedProds.length; pi++) {
        const pr = selectedProds[pi];
        const fq = finishedOf(pr);
        if (!(fq > 0)) continue;
        const prRej = pi === 0 ? rejNum : 0;
        const woNo = `WO-2026-${Math.floor(1000 + Math.random() * 9000)}`;
        const woId = crypto.randomUUID();
        await insertWO({ id: woId, woNo, name: pr.name, partNo: pr.partNumber, good: fq, rej: prRej, warehouseId: whSel[pr.key] || defaultWhId });
        // 3) Batch traceability (best-effort until the batches migration lands).
        await recordProductionBatch({
          salesOrderId: so?.id != null ? String(so.id) : null,
          salesOrderNo: inward.sales_order_ref || so?.order_no || null,
          workOrderId: woId, woNo,
          productName: pr.name,
          partNo: pr.partNumber || code || null,
          batchNo: woNo,
          grossQty: fq + prRej, goodQty: fq, rejectedQty: prRej,
          rejectionType: prRej > 0 ? rejType : null,
          rejectionReason: prRej > 0 ? rejReason.trim() : null,
          notes: (pi === 0 ? rejNotes.trim() : '') || null,
          createdBy: userName || null,
          idempotencyKey: `${batchKeyRef.current}-${pi}`,
        });
        doneLines.push(`${pr.name}: ${fq} good${prRej > 0 ? `, ${prRej} rejected` : ''}`);
      }
      // 4) Mark only fulfilled product lines Processed (a line is fulfilled
      // when its matched inward qty is finished); the card stays open until
      // every line is done. Order-level fulfillment keeps old messaging.
      const processedIds = selectedProds
        .filter((pr) => (pr as any).ids.length > 0 && (pr as any).inwardQty > 0 && finishedOf(pr) >= (pr as any).inwardQty - 1e-9)
        .flatMap((pr) => (pr as any).ids)
        .filter(Boolean);
      if (processedIds.length > 0) {
        const inwRes = await supabase.from('cnc_inwards').update({ status: 'Processed' }).in('id', processedIds);
        if (inwRes.error) console.error('Failed to update inward status:', inwRes.error);
      }
      const fulfilled = !so || !(orderedQty > 0) || totalGoodAfter >= orderedQty;
      if (!fulfilled) {
        alert(`Saved — ${doneLines.join(' · ')}. Total good ${totalGoodAfter} of ${orderedQty}; remaining ${orderedQty - totalGoodAfter}. The inward card stays open for the next batch.`);
      }
      onMoved();
      onClose();
    } catch (e: any) {
      alert(`Approve & Move failed: ${e?.message ?? e}. Nothing was moved.`);
    } finally {
      setApproving(false);
    }
  };

  const [pickCompany, setPickCompany] = useState('');
  const [pickProduct, setPickProduct] = useState('');
  const [pickText, setPickText] = useState('');
  const pickInputRef = useRef<HTMLInputElement>(null);
  const [pickTick, setPickTick] = useState(0);
  const [prodDropdownOpen, setProdDropdownOpen] = useState(false);
  const prodRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const inList = (e.target as HTMLElement | null)?.closest?.('[data-fg-dropdown]');
      if (!inList && prodRef.current && !prodRef.current.contains(e.target as Node)) {
        setProdDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    // The list is drawn at a fixed spot under the field: follow it when the page moves or resizes.
    const follow = () => setPickTick((n) => n + 1);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => { document.removeEventListener('mousedown', handleOutside); window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); };
  }, []);

  if (card?.raw?.__pick) {
    const key = (v: string) => String(v || '').trim().toLowerCase();
    // One row per product, written as "Company - Product - date time". Typing matches any part of that text,
    // so the company name finds it too.
    const rowsAll = pickOptions
      .map((o) => ({ key: `${o.company}||${o.product}`, company: String(o.company || '').trim(), product: o.product, label: productWithCompany(o.product, String(o.company || ''), o.qty) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const words = key(pickText).split(/\s+/).filter(Boolean);
    const rows = rowsAll.filter((r) => words.every((w) => r.label.toLowerCase().includes(w)));
    const box = pickInputRef.current?.getBoundingClientRect();
    void pickTick;

    return (
      <Modal open inline={inline} onClose={onClose} title="Finished Goods + Costing" subtitle="Add Finished Goods" size="3xl" width={960} accent={tint('Finished Goods')}>
        <div className={`w-fit rounded-xl border p-2.5 ${tint('Finished Goods').panel}`}>
          <div className="flex flex-wrap items-center gap-2">
            {titleSlot ?? <h3 className="text-[10px] font-bold uppercase tracking-widest text-brand-600">Section 1 — Transaction Details</h3>}
            <div className="flex items-center gap-1.5 relative" ref={prodRef}>
              <span className={inlineLbl}>Product *</span>
              <div className="relative">
                <input
                  ref={pickInputRef}
                  className={`${compactInput} w-[26rem] max-w-[60vw] pr-6`}
                  placeholder="Type company or product, or select"
                  value={pickText}
                  onFocus={() => setProdDropdownOpen(true)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPickText(v);
                    const hit = rowsAll.find((r) => key(r.label) === key(v));
                    setPickProduct(hit ? hit.product : '');
                    setPickCompany(hit ? hit.company : '');
                    setProdDropdownOpen(true);
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  onClick={() => setProdDropdownOpen((o) => !o)}
                >
                  <ChevronDown size={14} />
                </button>
                {prodDropdownOpen && box && createPortal(
                  // Drawn on the page itself (not inside the form) so no panel can clip or hide it.
                  <div
                    data-fg-dropdown
                    style={{ position: 'fixed', left: Math.max(8, Math.min(box.left, window.innerWidth - 8 - Math.max(box.width, 420))), top: box.bottom + 4, width: Math.max(box.width, 420), maxWidth: 'calc(100vw - 16px)', maxHeight: Math.max(160, Math.min(320, window.innerHeight - box.bottom - 16)), zIndex: 100 }}
                    className="overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
                  >
                    {rows.length > 0 ? rows.map((r) => (
                      <div
                        key={r.key}
                        title={r.label}
                        className="cursor-pointer px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-800"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setPickText(r.label);
                          setPickProduct(r.product);
                          setPickCompany(r.company);
                          setProdDropdownOpen(false);
                        }}
                      >
                        {r.label}
                      </div>
                    )) : (
                      <div className="px-3 py-2 text-xs italic text-slate-400">
                        {pickOptions.length === 0 ? 'No products are waiting to be finished' : 'No product matches what you typed'}
                      </div>
                    )}
                  </div>,
                  document.body,
                )}
              </div>
            </div>
            <Button variant="secondary" size="sm" icon={<X size={14} />} onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!pickCompany.trim() || !pickProduct.trim()} onClick={() => onPick?.(pickCompany.trim(), pickProduct.trim())} className="!bg-teal-600 hover:!bg-teal-500 text-white shadow-md shadow-teal-500/25 !border-teal-600">Continue</Button>
            {searchSlot}
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      inline={inline}
      accent={tint('Finished Goods')}
      onClose={onClose}
      title={mode === 'view' ? 'View Finished Goods + Costing' : mode === 'edit' ? 'Edit Finished Goods + Costing' : 'Finished Goods + Costing'}
      subtitle={mode === 'add' ? `Inward ${card?.refNo ?? inward.project_name ?? ''} → Finished Goods with pricing approval` : `Finished Goods ${card?.refNo ?? inward.project_name ?? ''}`}
      size="3xl"
      width={960}
      footer={
        <>
          {mode === 'add' && (canApproveCosting || fgEdit) && !canApprove && (
            <p className="mr-auto min-w-0 truncate text-xs text-amber-800" title={`Before approval — fix ${blockReasons.length === 1 ? 'this' : 'these'}:\n- ${blockReasons.join('\n- ')}`}>
              <b className="text-[10px] uppercase tracking-wider">Before approval — fix this: </b>
              {blockReasons[0]}{blockReasons.length > 1 ? ` (+${blockReasons.length - 1} more)` : ''}
            </p>
          )}
          <span className="flex-1" />
          <Button variant="secondary" size={inline ? 'sm' : undefined} icon={<X size={14} />} onClick={onClose}>{mode === 'view' ? 'Close' : 'Cancel'}</Button>
          {mode !== 'view' && (canCreateCosting || canEditCosting) && (
            <Button variant={mode === 'edit' ? undefined : 'secondary'} icon={<Save size={14} />} disabled={saving || loading} onClick={saveDraft}>
              {saving ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Save Draft'}
            </Button>
          )}
          {mode === 'add' && (canApproveCosting || fgEdit) && (
            // Stays clickable when blocked: approveAndMove alerts the exact
            // blocking reasons, and they are also listed inline below.
            // Without costing approval this is a quantity-only move (no sheet
            // is saved); pricing approval still needs an authorized user.
            <Button icon={<CheckCheck size={14} />} disabled={approving} size={inline ? 'sm' : undefined}
              title={canApprove ? (canApproveCosting ? 'Approve pricing and move the card' : 'Move the card to Finished Goods without costing approval') : `Blocked: ${blockReasons[0] ?? 'resolving'}`}
              className="!bg-teal-600 hover:!bg-teal-500 text-white shadow-md shadow-teal-500/25 !border-teal-600"
              onClick={approveAndMove}>
              {approving ? 'Moving...' : (canApproveCosting ? 'Approve & Move to Finished Goods' : 'Move to Finished Goods')}
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-slate-500 py-8 text-center">Loading live transaction records and costing...</p>
      ) : loadError ? (
        <p className="text-sm text-red-600 py-8 text-center">Failed to load costing data: {loadError}</p>
      ) : (
        <fieldset disabled={mode === 'view'} className="min-w-0 border-0 p-0 m-0">
        <div className={inline ? 'space-y-2' : 'space-y-4'}>
          {(titleSlot || searchSlot) && (
            <div className="flex flex-wrap items-center gap-2">
              {titleSlot}
              {searchSlot && <div className="ml-auto flex shrink-0 items-center gap-2">{searchSlot}</div>}
            </div>
          )}
          {/* 1 — transaction details, with the products to finish (and how many) right next to the product */}
          <div className={inline ? 'bg-white rounded-xl border border-slate-200 p-2.5' : 'bg-white rounded-xl border border-slate-200 p-4'}>
            <h3 className={inline ? 'text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-2 border-b border-brand-100 pb-1.5' : 'text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-3 border-b border-brand-100 pb-2'}>Section 1 — Transaction Details</h3>
            {!fgView && (
              <p className="text-xs text-slate-500">Transaction details need the Finished Goods view permission.</p>
            )}
            {fgView && (
            <>
            <div className={inline ? 'grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_11rem] gap-2 text-sm' : 'grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_11rem] gap-4 text-sm'}>
              <div>
                {prodRows.length === 0 ? (
                  <p className="text-xs text-slate-400 mt-1">Loading products…</p>
                ) : (
                  <div className="mt-1 space-y-1">
                    {prodRows.map((r) => {
                      const checked = prodSel[r.key] !== undefined;
                      const fq = checked ? Math.max(0, num(prodSel[r.key])) : 0;
                      // Finished goods so far for this product (from the order's reconciliation), then what is left of the order.
                      const doneSoFar = (qtySum?.products ?? []).find((x) => String(x.name).trim().toLowerCase() === String(r.name).trim().toLowerCase())?.good ?? 0;
                      const rem = Math.max(0, r.qty - doneSoFar - (mode === 'add' ? fq : 0));
                      return (
                        <div key={r.key} className={`flex items-center gap-2 rounded-lg border px-3 ${inline ? 'h-8' : 'h-9'} ${checked ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!fgEdit}
                            onChange={(e) => setProdSel((prev) => {
                              const next = { ...prev };
                              if (e.target.checked) next[r.key] = String((r as any).inwardQty > 0 ? (r as any).inwardQty : '');
                              else delete next[r.key];
                              return next;
                            })}
                            className="h-3.5 w-3.5 accent-orange-600"
                            aria-label={`Select ${r.name}`}
                          />
                          <span className="min-w-0 flex-1 truncate font-semibold text-slate-800" title={productWithCompany(r.name, card?.customer ?? '')}>{productWithCompany(r.name, card?.customer ?? '')}</span>
                          {whs.length > 0 && (
                            <select
                              aria-label={`Warehouse for ${r.name}`} title="Warehouse (default shown; change if needed)"
                              disabled={!checked || !fgEdit}
                              value={whSel[r.key] ?? defaultWhId}
                              onChange={(e) => setWhSel((prev) => ({ ...prev, [r.key]: e.target.value }))}
                              className="h-6 w-24 shrink-0 rounded border border-slate-300 bg-white px-1 text-[10px] text-slate-700 disabled:bg-slate-100"
                            >
                              {whs.map((w) => <option key={w.id} value={w.id}>{w.name}{w.isDefault ? ' ★' : ''}</option>)}
                            </select>
                          )}
                          <span className="hidden sm:inline text-[10px] text-slate-400 whitespace-nowrap">
                            Ordered {r.qty} · Finished {doneSoFar}
                            {r.qty > 0 && <b className="text-amber-700"> · Remaining {rem}</b>}
                          </span>
                          <input
                            type="number" min={0} aria-label={`How many ${r.name} finished`} placeholder="Qty"
                            disabled={!checked || !fgEdit}
                            value={checked ? (prodSel[r.key] ?? '') : ''}
                            onChange={(e) => setProdSel((prev) => ({ ...prev, [r.key]: e.target.value }))}
                            className={`${inputClass} !w-20 !py-1 text-right tabular-nums disabled:bg-slate-100`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                {!inline && <p className="text-[10px] text-slate-400 mt-1">Each selected product gets its own entry + batch. Costing follows {firstProd ? <b>{firstProd.name}</b> : 'the first selected product'}.</p>}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Date</p>
                <input type="date" value={fgDate} disabled={!fgEdit} onChange={(e) => setFgDate(e.target.value)} className={inputClass} />
              </div>
            </div>
            </>
            )}
          </div>

          {/* Rejection capture removed — batches record good quantity only. */}
          {!hasCostView ? (
            inline ? null : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Costing details are hidden — you have Finished Goods access without Project Costing access. Quotation pricing, process and material costs, the cost summary and the final price need the Project Costing view permission.
              {fgEdit ? ' You can still move the goods with the button below; pricing approval must be completed later by an authorized costing user before invoicing.' : ''}
            </div>
            )
          ) : (
          <>
          {(!canEditCosting && mode !== 'view') && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
              Read-only — you can view costing but cannot change it. Editing needs the Project Costing edit permission.
            </div>
          )}
          {/* Costing edits lock together: view-only users get every costing
              section read-only through this single fieldset (no layout change). */}
          <fieldset disabled={!canEditCosting} className="contents">
          {/* comparison workspace: quotation vs project costing */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {/* LEFT — quotation (reference only, master never modified) */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className={`${panelTitleClass} text-brand-600 border-b border-brand-100 pb-2`}>Quotation</h3>
            <p className="text-[11px] text-slate-400 mt-1 mb-3">Company quoted price</p>
            {!quote ? (
              <p className="text-sm text-slate-400">No quotation is linked (direct order). Enter the materials, operations and the approved final price below; the price is saved against this sales order.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Quote No</p><p className="font-mono font-semibold">{quote.quote_no}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Sales Order No</p><p className="font-mono font-semibold">{so?.order_no ?? inward.sales_order_ref ?? '—'}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Company</p><p className="font-semibold">{quote.customer || card?.customer || '—'}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Product</p><p className="font-semibold">{productName || '—'}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Product Code</p><p className="font-mono font-semibold">{code || product?.code || '—'}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Quoted Qty</p><p className="font-semibold">{quote.quantity}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Unit Price</p><p className="font-semibold">{inr(quote.unit_price)}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Discount / GST</p><p className="font-semibold">{num(quote.discount_percent)}% / {num(quote.gst_percent)}%</p></div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Qty Override</p>
                  <input type="number" min="0" value={quoteQty} onChange={(e) => setQuoteQty(e.target.value)} placeholder={String(quote.quantity ?? '')} className={inputClass} />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Unit Price Override (₹)</p>
                  <input type="number" min="0" value={quoteUnit} onChange={(e) => setQuoteUnit(e.target.value)} placeholder={String(quote.unit_price ?? '')} className={inputClass} />
                </div>
                <div className="col-span-2 rounded-lg bg-brand-50/60 border border-brand-100 px-3 py-2 flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-brand-700 font-bold">Quotation Total {quoteManual && <span className="ml-1 text-brand-700 bg-white border border-brand-200 rounded px-1">Manual</span>}</p>
                  <p className="font-bold tabular-nums text-lg text-brand-800">{inr(effQuoteTotal)}</p>
                </div>
              </div>
            )}
            {products.filter((p) => p.workings).map((p, pi) => {
              const w = p.workings as Workings;
              const r = calcWorkings(w);
              const sections: [string, WorkRow[], number][] = [['Materials', w.materials ?? [], r.materials], ['Process operations', w.processes ?? [], r.processes], ['Other expenses', w.others ?? [], r.others]];
              if (!sections.some(([, rows]) => rows.length)) return null;
              return (
                <div key={pi} className="mt-3 rounded-lg border border-slate-200" data-testid="quotation-breakdown">
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 bg-slate-50 rounded-t-lg">Quoted cost breakdown · {p.name}</p>
                  <table className="w-full text-xs">
                    <tbody>
                      {sections.map(([label, rows, sub]) => rows.length > 0 && (
                        <Fragment key={label}>
                          <tr className="bg-slate-50/60"><td colSpan={3} className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</td><td className="px-3 py-1 text-right font-semibold tabular-nums">{inr(sub)}</td></tr>
                          {rows.map((row) => (
                            <tr key={row.id} className="border-t border-slate-100"><td className="px-3 py-1 text-slate-700">{row.description || '—'}</td><td className="px-2 py-1 tabular-nums text-slate-500">{row.qty}</td><td className="px-2 py-1 tabular-nums text-slate-500">× {row.rate}</td><td className="px-3 py-1 text-right tabular-nums">{inr(rowCost(row))}</td></tr>
                          ))}
                        </Fragment>
                      ))}
                      <tr className="border-t border-slate-200"><td colSpan={3} className="px-3 py-1 text-slate-500">Cost subtotal</td><td className="px-3 py-1 text-right font-semibold tabular-nums">{inr(r.subtotal)}</td></tr>
                      <tr><td colSpan={3} className="px-3 py-1 text-slate-500">Profit margin {w.marginPct || 0}%</td><td className="px-3 py-1 text-right tabular-nums">{inr(r.profit)}</td></tr>
                      <tr className="border-t border-slate-200 bg-brand-50/60"><td colSpan={3} className="px-3 py-1.5 font-bold text-brand-800">Quoted cost per unit</td><td className="px-3 py-1.5 text-right font-bold tabular-nums text-brand-800">{inr(r.total)}</td></tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
            <p className="text-[11px] text-slate-400 mt-2">Reference values — overrides affect this sheet only (discount/tax ratio preserved). The quotation master is never modified.</p>
          </div>

          {/* RIGHT — project costing (actual estimated manufacturing cost) */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-5">
            <div>
              <h3 className={`${panelTitleClass} text-brand-600 border-b border-brand-100 pb-2`}>Project Costing</h3>
              <p className="text-[11px] text-slate-400 mt-1">Actual estimated manufacturing cost</p>
            </div>

            {/* 1 — process costing */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">1. Process Costing</h4>
                <button type="button" onClick={() => setEditOps((v) => !v)} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-800 border border-brand-200 hover:border-brand-400 rounded px-2 py-0.5 bg-brand-50/50">
                  <Pencil size={11} />{editOps ? 'Done' : 'Edit'}
                </button>
              </div>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr><th className={cellTh}>#</th><th className={cellTh}>Operation / Process</th><th className={cellTh}>Machine</th><th className={cellTh}>Qty</th><th className={cellTh}>Cycle</th><th className={cellTh}>₹/Hr</th><th className={cellTh}>Setup</th><th className={cellTh}>Comp</th><th className={`${cellTh} text-right`}>Process Cost</th></tr></thead>
                  <tbody>
                    {effOpLines.length === 0 && (<tr><td colSpan={9} className="py-3 text-center text-slate-400">No operations yet — add one below.</td></tr>)}
                    {effOpLines.map((o) => (
                      <tr key={o.key} className="border-t border-slate-100">
                        <td className={cellTd}>{o.seq}</td>
                        <td className={`${cellTd} font-medium text-slate-700`}>{o.process_name || o.process_code || '—'}{o.manual && <ManualTag />}</td>
                        <td className={cellTd}>{o.machine || '—'}</td>
                        <td className={cellTd}>{baseQty}</td>
                        <td className={cellTd}>{o.cycle_time}</td>
                        <td className={cellTd}>{editOps ? <EditNum aria="Cost per hour" value={o.cost_per_hour} onChange={(v) => patchOp(o.key, { cost_per_hour: v, machine_rate: v })} /> : inr(o.cost_per_hour)}</td>
                        <td className={cellTd}>{editOps ? <EditNum aria="Setup cost" value={o.setup_cost} onChange={(v) => patchOp(o.key, { setup_cost: v })} /> : inr(o.setup_cost)}</td>
                        <td className={cellTd}>{editOps ? <EditNum aria="Cost per component" value={o.cost_per_component} onChange={(v) => patchOp(o.key, { cost_per_component: v })} /> : inr(o.cost_per_component)}</td>
                        <td className={`${cellTd} text-right font-bold`}>{inr(o.process_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-1.5 text-sm">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Process Cost</span>
                <span className="font-bold tabular-nums">{inr(totals.process)}</span>
              </div>
            </div>

            {/* 2 — material cost */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">2. Material Cost</h4>
                <button type="button" onClick={() => setEditMats((v) => !v)} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-800 border border-brand-200 hover:border-brand-400 rounded px-2 py-0.5 bg-brand-50/50">
                  <Pencil size={11} />{editMats ? 'Done' : 'Edit'}
                </button>
              </div>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr><th className={cellTh}>Material</th><th className={cellTh}>Req Qty</th><th className={cellTh}>Unit</th><th className={cellTh}>Unit Cost</th><th className={`${cellTh} text-right`}>Total</th>{editMats && <th className={cellTh} />}</tr></thead>
                  <tbody>
                    {effMatLines.length === 0 && (<tr><td colSpan={6} className="py-3 text-center text-slate-400">No material lines yet — add one below.</td></tr>)}
                    {effMatLines.map((m) => (
                      <tr key={m.key} className="border-t border-slate-100">
                        <td className={`${cellTd} font-medium text-slate-700`}>{m.material_name || '—'}{m.manual && <ManualTag />}</td>
                        <td className={cellTd}>{editMats ? <EditNum aria="Required qty" value={m.req_qty} onChange={(v) => patchMat(m.key, { req_qty: v })} /> : m.req_qty}</td>
                        <td className={cellTd}>{m.unit}</td>
                        <td className={cellTd}>{editMats ? <EditNum aria="Unit cost" value={m.unit_cost} onChange={(v) => patchMat(m.key, { unit_cost: v })} /> : inr(m.unit_cost)}</td>
                        <td className={`${cellTd} text-right font-bold`}>{inr(m.total)}</td>
                        {editMats && (
                          <td className={cellTd}>
                            {extraMats.some((x) => x.key === m.key) && (
                              <button onClick={() => setExtraMats((ls) => ls.filter((x) => x.key !== m.key))} className="text-slate-400 hover:text-red-600" title="Remove"><Trash2 size={13} /></button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-1.5 text-sm">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Material Cost</span>
                <span className="font-bold tabular-nums">{inr(totals.material)}</span>
              </div>
              {goodsActuals.rows.length > 0 && !goodsLoaded && (
                <button
                  type="button"
                  onClick={loadGoodsActuals}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-700 hover:text-brand-900 border border-brand-200 hover:border-brand-400 rounded-lg px-2.5 py-1.5 bg-brand-50/50"
                >
                  <Plus size={13} /> Load purchase actuals: {goodsActuals.rows.length} line{goodsActuals.rows.length === 1 ? '' : 's'} ({inr(goodsActuals.total)})
                </button>
              )}
              <div className="border border-dashed border-slate-300 rounded-lg p-2.5 mt-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Add material line</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={newMat.name} onChange={(e) => setNewMat({ ...newMat, name: e.target.value })} placeholder="Material name *" className={`${inputClass} text-xs`} />
                  <input value={newMat.code} onChange={(e) => setNewMat({ ...newMat, code: e.target.value })} placeholder="Code" className={`${inputClass} text-xs`} />
                  <input type="number" min="0" value={newMat.qty} onChange={(e) => setNewMat({ ...newMat, qty: e.target.value })} placeholder="Qty *" className={`${inputClass} text-xs`} />
                  <input type="number" min="0" value={newMat.rate} onChange={(e) => setNewMat({ ...newMat, rate: e.target.value })} placeholder="Unit cost ₹" className={`${inputClass} text-xs`} />
                </div>
                <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={addManualMat} className="mt-2">Add material to costing</Button>
              </div>
            </div>

            {/* 3 — machine & labour */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">3. Machine &amp; Labour</h4>
                <button type="button" onClick={() => setEditOps((v) => !v)} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-800 border border-brand-200 hover:border-brand-400 rounded px-2 py-0.5 bg-brand-50/50">
                  <Pencil size={11} />{editOps ? 'Done' : 'Edit'}
                </button>
              </div>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr><th className={cellTh}>Machine</th><th className={cellTh}>Mc Hrs</th><th className={cellTh}>Mc Rate</th><th className={cellTh}>Mc Cost</th><th className={cellTh}>Operator</th><th className={cellTh}>Lab Hrs</th><th className={cellTh}>Lab Rate</th><th className={`${cellTh} text-right`}>Lab Cost</th></tr></thead>
                  <tbody>
                    {effOpLines.length === 0 && (<tr><td colSpan={8} className="py-3 text-center text-slate-400">No operations yet — add one below.</td></tr>)}
                    {effOpLines.map((o) => (
                      <tr key={o.key} className="border-t border-slate-100">
                        <td className={`${cellTd} font-medium text-slate-700`}>{o.machine || '—'}{o.manual && <ManualTag />}</td>
                        <td className={cellTd}>{editOps ? <EditNum aria="Machine hours" value={o.machine_hours} onChange={(v) => patchOp(o.key, { machine_hours: v })} /> : Math.round(o.machine_hours * 100) / 100}</td>
                        <td className={cellTd}>{editOps ? <EditNum aria="Machine rate" value={o.machine_rate} onChange={(v) => patchOp(o.key, { machine_rate: v, cost_per_hour: v })} /> : inr(o.machine_rate)}</td>
                        <td className={`${cellTd} font-semibold`}>{inr(o.machine_cost)}</td>
                        <td className={cellTd}>{o.operator || '—'}</td>
                        <td className={cellTd}>{editOps ? <EditNum aria="Labour hours" value={o.labour_hours} onChange={(v) => patchOp(o.key, { labour_hours: v })} /> : Math.round(o.labour_hours * 100) / 100}</td>
                        <td className={cellTd}>{editOps ? <EditNum aria="Labour rate" value={o.labour_rate} onChange={(v) => patchOp(o.key, { labour_rate: v })} /> : inr(o.labour_rate)}</td>
                        <td className={`${cellTd} text-right font-semibold`}>{inr(o.labour_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-1.5 space-y-0.5 text-sm">
                <div className="flex items-center justify-between"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Machine Cost</span><span className="font-bold tabular-nums">{inr(totals.machine)}</span></div>
                <div className="flex items-center justify-between"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Labour Cost</span><span className="font-bold tabular-nums">{inr(totals.labour)}</span></div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-1"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Total Machine &amp; Labour Cost</span><span className="font-bold tabular-nums">{inr(totals.machineLabour)}</span></div>
              </div>
              {serviceActuals.rows.length > 0 && (
                <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-violet-700">
                    Linked service purchase (actual) — {inr(serviceActuals.total)}
                  </p>
                  {serviceActuals.rows.slice(0, 3).map((inv: any, i: number) => (
                    <p key={i} className="text-[11px] text-slate-600 tabular-nums">
                      {inv.inward_no} · {inv.part_name || inv.product_name || 'Service'} · {Number(inv.quantity) || 0} pcs × {inr(Number(inv.price) || 0)}
                    </p>
                  ))}
                  <p className="text-[11px] text-slate-400 mt-0.5">Recorded cost from Project Costing — reference only, the estimate above is unchanged.</p>
                </div>
              )}
              <div className="border border-dashed border-slate-300 rounded-lg p-2.5 mt-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Add operation line</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={newOp.process} onChange={(e) => setNewOp({ ...newOp, process: e.target.value })} placeholder="Process *" className={`${inputClass} text-xs`} />
                  <input value={newOp.machine} onChange={(e) => setNewOp({ ...newOp, machine: e.target.value })} placeholder="Machine" className={`${inputClass} text-xs`} />
                  <input type="number" min="0" step="0.01" value={newOp.hours} onChange={(e) => setNewOp({ ...newOp, hours: e.target.value })} placeholder="Mc hours *" className={`${inputClass} text-xs`} />
                  <input type="number" min="0" value={newOp.mRate} onChange={(e) => setNewOp({ ...newOp, mRate: e.target.value })} placeholder="Mc rate ₹/h" className={`${inputClass} text-xs`} />
                  <input type="number" min="0" step="0.01" value={newOp.lHours} onChange={(e) => setNewOp({ ...newOp, lHours: e.target.value })} placeholder="Lab hours" className={`${inputClass} text-xs`} />
                  <input type="number" min="0" value={newOp.lRate} onChange={(e) => setNewOp({ ...newOp, lRate: e.target.value })} placeholder="Lab rate ₹/h" className={`${inputClass} text-xs`} />
                </div>
                <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={addManualOp} className="mt-2">Add operation to costing</Button>
              </div>
              {extraOps.length > 0 && (
                <div className="mt-2 space-y-1">
                  {extraOps.map((o) => (
                    <p key={o.key} className="text-xs flex items-center gap-2">
                      <ManualTag />
                      {o.process_name} · {o.machine_hours}h · {inr(o.machine_cost + o.labour_cost)}
                      <button onClick={() => setExtraOps((ls) => ls.filter((x) => x.key !== o.key))} className="text-slate-400 hover:text-red-600" title="Remove"><Trash2 size={13} /></button>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>

          {/* cost summary — quotation vs project cost */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className={`${panelTitleClass} text-brand-600 border-b border-brand-100 pb-2`}>Cost Summary — Quotation vs Project Cost</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mt-3">
              <div className="border border-slate-200 rounded-lg px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Quotation Total</p>
                <p className="font-bold tabular-nums text-lg">{inr(effQuoteTotal)}</p>
              </div>
              <div className="border border-slate-200 rounded-lg px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Project Cost</p>
                <p className="font-bold tabular-nums text-lg">{inr(projectCost)}</p>
                <p className="text-[11px] text-slate-400">Material {inr(totals.material)} + Process {inr(totals.process)}</p>
              </div>
              <div className={`border rounded-lg px-3 py-2 ${costDiff < 0 ? 'border-red-200 bg-red-50/50' : 'border-emerald-200 bg-emerald-50/50'}`}>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Cost Difference</p>
                <p className={`font-bold tabular-nums text-lg ${costDiff < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{costDiff >= 0 ? '+' : ''}{inr(costDiff)}{costDiffPct == null ? '' : ` (${costDiffPct >= 0 ? '+' : ''}${costDiffPct.toFixed(1)}%)`}</p>
                <p className="text-[11px] text-slate-400">Quotation − Project Cost{costDiffPct == null ? '' : ' · (Diff ÷ Quotation) × 100'}</p>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              {effMatLines.length} material line(s) · {effOpLines.length} operation(s)
              {versions[0] ? ` · Latest saved version V${versions[0].version} (${versions[0].status})` : ' · Not saved yet'}
            </p>
          </div>

          {/* 3 — final price */}
          <div className="rounded-xl p-4 bg-gradient-to-br from-navy-900 to-navy-800 text-white">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-brand-400 mb-2">Section 3 — Final Price</h3>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-300">System Calculated Price</p>
                <p className="text-3xl font-bold text-brand-400 tabular-nums">{inr(totals.calculated)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-300">Approved Final Price</p>
                <input type="text" inputMode="decimal" autoComplete="off" value={approvedInput} onChange={(e) => { approvedEdited.current = true; setApprovedInput(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); setApprovedTouched(true); }}
                  placeholder={String(Math.round(totals.calculated))}
                  className="w-48 text-right font-bold text-navy-900 rounded-lg px-3 py-1.5 text-lg" />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
              <span>Calculated: <b className="tabular-nums">{inr(totals.calculated)}</b></span>
              <span>Approved: <b className="tabular-nums">{inr(effectiveApproved)}</b></span>
              <span>Manual Adjustment: <b className={`tabular-nums ${adjustment >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{adjustment >= 0 ? '+' : ''}{inr(adjustment)}</b></span>
            </div>
          </div>
          </fieldset>
          </>
          )}

          {/* TESTING: Section 4 — Warnings hidden for now (BOM / work-order warnings don't block approval). */}

          {hasCostView && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Sheet status:</span>
            <Badge variant={statusToVariant(versions[0]?.status ?? 'Draft')} dot>{versions[0] ? `V${versions[0].version} ${versions[0].status}` : 'Unsaved'}</Badge>
          </div>
          )}
        </div>
        </fieldset>
      )}
    </Modal>
  );
}


import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { formatINR, formatDate, todayISO } from '@/lib/format';
import { StatCard, Badge, Button, statusToVariant } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal, FormField, FormSection, inputClass } from '@/components/ui/Modal';
import { downloadCostingDocument, viewCostingDocument } from '@/lib/brandedDocument';
import { printHtml } from '@/lib/reportExport';
import { useAuth } from '@/contexts/AuthContext';
import {
  Calculator, FileText, Printer, Eye, Download, Pencil, CheckCheck, Save,
  AlertTriangle, RefreshCw, ChevronDown,
} from 'lucide-react';
// Costing math lives in the shared engine so the pipeline FG modal reuses the
// exact same implementation (no duplicated calculations).
import {
  costInr as inr, costPdfInr as pdfInr, costNum as num,
  buildMaterialLines, buildOpLines, computeTotals, computeWarnings,
  applyMatPatch, applyOpPatch, buildVersionPayload, buildCostingPdfInput, parseQuoteProducts,
  type MaterialLine, type OpLine,
} from '@/lib/costingEngine';

export function QuoteCostingPage() {
  const { company, profile } = useAuth() as any;
  const companyName: string = company?.company_name ?? 'ARGUS CNC';
  const userName: string = profile?.email ?? '';

  const [quotations, setQuotations] = useState<any[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [quoteSearch, setQuoteSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [quote, setQuote] = useState<any | null>(null);
  const [productIdx, setProductIdx] = useState(0);

  const [so, setSo] = useState<any | null>(null);
  const [wos, setWos] = useState<any[]>([]);
  const [bom, setBom] = useState<any[]>([]);
  const [rawMats, setRawMats] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [jobCards, setJobCards] = useState<any[]>([]);
  const [woOps, setWoOps] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [loadingSheet, setLoadingSheet] = useState(false);

  const [matLines, setMatLines] = useState<MaterialLine[]>([]);
  const [opLines, setOpLines] = useState<OpLine[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [approvedInput, setApprovedInput] = useState('');
  const [saving, setSaving] = useState(false);

  const [versions, setVersions] = useState<any[]>([]);
  const [sheetsMissing, setSheetsMissing] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState(false);

  // ---------- quotation list ----------
  useEffect(() => {
    (async () => {
      setLoadingQuotes(true);
      try {
        const { data, error } = await supabase.from('cnc_quotations').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        setQuotations(data ?? []);
      } catch (err) {
        console.error('Failed to load quotations:', err);
      } finally {
        setLoadingQuotes(false);
      }
    })();
  }, []);

  const filteredQuotes = useMemo(() => {
    const q = quoteSearch.trim().toLowerCase();
    if (!q) return quotations;
    return quotations.filter((x) =>
      `${x.quote_no ?? ''} ${x.customer ?? ''} ${x.part_name ?? ''}`.toLowerCase().includes(q));
  }, [quotations, quoteSearch]);

  const products = useMemo(() => (quote ? parseQuoteProducts(quote) : []), [quote]);
  const product = products[Math.min(productIdx, Math.max(0, products.length - 1))] ?? null;
  const productCode = product?.code ?? '';

  const loadQuote = async (id: string) => {
    const q = quotations.find((x) => String(x.id) === String(id)) ?? null;
    setSelectedId(id);
    setQuote(q);
    setProductIdx(0);
    setSo(null); setWos([]); setBom([]); setJobCards([]); setWoOps([]);
    setMatLines([]); setOpLines([]); setVersions([]); setApprovedInput(''); setEditMode(false);
    if (!q) return;
    setLoadingSheet(true);
    try {
      // Linked sales order (primary key quotation_id, fallback quote_no)
      let soRow: any = null;
      const byId = await supabase.from('cnc_sales_orders').select('*').eq('quotation_id', q.id).limit(1);
      if (!byId.error && (byId.data ?? []).length > 0) soRow = byId.data![0];
      else if (q.quote_no) {
        const byNo = await supabase.from('cnc_sales_orders').select('*').eq('quote_no', q.quote_no).limit(1);
        if (!byNo.error && (byNo.data ?? []).length > 0) soRow = byNo.data![0];
      }
      setSo(soRow);
      // Work orders for the sales order
      let woRows: any[] = [];
      if (soRow?.order_no) {
        const woRes = await supabase.from('cnc_work_orders').select('*').eq('sales_order', soRow.order_no).order('created_at');
        if (!woRes.error) woRows = woRes.data ?? [];
      }
      setWos(woRows);
      // BOM for the product
      const parentCode = soRow?.part_no || q.part_number || product?.code || '';
      if (parentCode) {
        const bomRes = await supabase.from('cnc_bom').select('*').eq('parent_part_no', parentCode).order('level').order('created_at');
        if (!bomRes.error) setBom(bomRes.data ?? []);
      }
      // Masters needed for rates (loaded once per selection; small tables)
      const [rmRes, supRes, jcRes, wooRes, procRes] = await Promise.all([
        supabase.from('cnc_raw_materials').select('*'),
        supabase.from('cnc_suppliers').select('id,name'),
        woRows.length > 0
          ? supabase.from('cnc_job_cards').select('*').in('work_order', woRows.map((w) => w.wo_no))
          : Promise.resolve({ data: [], error: null } as any),
        woRows.length > 0
          ? supabase.from('cnc_work_order_operations').select('*').in('work_order_id', woRows.map((w) => w.id)).order('operation_sequence')
          : Promise.resolve({ data: [], error: null } as any),
        supabase.from('cnc_processes').select('*').order('process_code'),
      ]);
      if (!rmRes.error) setRawMats(rmRes.data ?? []);
      if (!supRes.error) {
        const map: Record<string, string> = {};
        for (const s of supRes.data ?? []) map[String(s.id)] = s.name ?? '';
        setSuppliers(map);
      }
      if (!jcRes.error) setJobCards(jcRes.data ?? []);
      if (!wooRes.error) {
        if ((wooRes as any).error && (wooRes as any).error.code === 'PGRST205') setWoOps([]);
        else setWoOps((wooRes.data ?? []) as any[]);
      }
      if (!procRes.error) setProcesses(procRes.data ?? []);
      // Saved versions for this quotation + product
      await loadVersions(q.quote_no, product?.code ?? (q.part_number ?? ''));
    } finally {
      setLoadingSheet(false);
    }
  };

  const loadVersions = async (quoteNo: string, code: string) => {
    try {
      const { data, error } = await supabase
        .from('cnc_costing_sheets')
        .select('*')
        .eq('quotation_no', quoteNo ?? '')
        .eq('product_code', code ?? '')
        .order('version', { ascending: false });
      if (error) {
        if ((error as any).code === 'PGRST205') setSheetsMissing(true);
        else console.error('Failed to load costing versions:', error);
        setVersions([]);
      } else {
        setVersions(data ?? []);
        const latest = (data ?? [])[0];
        if (latest) {
          if (latest.lines?.materials) setMatLines(latest.lines.materials);
          if (latest.lines?.ops) setOpLines(latest.lines.ops);
          if (latest.approved_price != null) setApprovedInput(String(latest.approved_price));
        }
      }
    } catch (err) {
      console.error('Failed to load costing versions:', err);
    }
  };

  // ---------- build lines from masters (non-manual values) ----------
  const baseQty = useMemo(() => {
    if (wos.length === 1) return num(wos[0].quantity) || num(product?.qty);
    return num(product?.qty);
  }, [wos, product]);

  const rebuildFromMasters = () => {
    setMatLines(buildMaterialLines(bom, rawMats, suppliers, baseQty));
    setOpLines(buildOpLines(woOps, jobCards, processes, wos));
  };

  // Auto-build when sources arrive (only if no saved version already loaded lines)
  useEffect(() => {
    if (!quote) return;
    if (versions.length > 0) return;
    if (bom.length === 0 && woOps.length === 0 && jobCards.length === 0) return;
    rebuildFromMasters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bom, woOps, jobCards, processes, rawMats, quote]);

  // ---------- totals ----------
  const totals = useMemo(
    () => computeTotals(matLines, opLines, quote?.total_value),
    [matLines, opLines, quote]);

  const warnings = useMemo(
    () => computeWarnings({ hasQuote: !!quote, baseQty, bom, woOps, jobCards, opLines }),
    [quote, baseQty, bom, woOps, jobCards, opLines]);

  const latestApproved = useMemo(() => versions.find((v) => v.status === 'Approved') ?? null, [versions]);
  const changedSinceApproval = useMemo(() => {
    if (!latestApproved) return false;
    return Math.abs(num(latestApproved.calculated_price) - totals.calculated) > 0.005;
  }, [latestApproved, totals.calculated]);

  const approvedNum = approvedInput.trim() === '' ? null : num(approvedInput);
  const adjustment = approvedNum == null ? 0 : approvedNum - totals.calculated;

  // ---------- persistence (append-only versions) ----------
  const nextVersion = (versions[0]?.version ?? 0) + 1;

  const saveVersion = async (status: 'Draft' | 'Calculated' | 'Approved', approved: number | null) => {
    if (!quote) return;
    if (sheetsMissing) {
      alert('Costing storage is not provisioned. Apply supabase/migrations/20260930000000_costing_sheets.sql first.');
      return;
    }
    if (baseQty <= 0) {
      alert('Quantity must be greater than 0 before saving.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('cnc_costing_sheets').insert([
        buildVersionPayload({
          quote, so, productCode, productName: product?.name ?? '', baseQty,
          status, version: nextVersion, totals, approved, matLines, opLines, userName,
        }),
      ]);
      if (error) throw error;
      await loadVersions(quote.quote_no, productCode);
    } catch (err: any) {
      alert(`Failed to save costing version: ${err?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  // ---------- PDF ----------
  const pdfInput = (): Parameters<typeof downloadCostingDocument>[0] => buildCostingPdfInput({
    companyName,
    documentNo: `${quote?.quote_no ?? 'QT'}-V${nextVersion - 1 || 1}`,
    date: todayISO(),
    quote, so, product, productCode, baseQty,
    status: versions[0]?.status ?? 'Draft',
    matLines, opLines, totals,
    approved: approvedNum, latestVersion: versions[0] ?? null, userName,
  });

  const handlePrint = () => {
    const row = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    const tbl = (heads: string[], body: string) =>
      `<table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
    printHtml(`Product Costing - ${quote?.quote_no ?? ''}`, `
      <h2>${companyName} — Product Costing / Final Pricing (${quote?.quote_no ?? ''})</h2>
      <p>Company: ${quote?.customer ?? ''} | Product: ${product?.name ?? ''} | Qty: ${baseQty} | Date: ${todayISO()}</p>
      <h3>1. Quotation — ${inr(quote?.total_value)}</h3>
      <h3>2. Material Cost — ${inr(totals.material)}</h3>
      ${tbl(['Code', 'Material', 'Req Qty', 'Unit Cost', 'Total'], matLines.map((m) => row([m.material_code, m.material_name, `${m.req_qty} ${m.unit}`, inr(m.unit_cost), inr(m.total)])).join(''))}
      <h3>3. Machine & Labour — ${inr(totals.machineLabour)}</h3>
      ${tbl(['Op', 'Machine', 'Mc Hrs', 'Mc Rate', 'Mc Cost', 'Operator', 'Lab Hrs', 'Lab Rate', 'Lab Cost'], opLines.map((o) => row([`${o.seq} ${o.process_name}`, o.machine, String(o.machine_hours), inr(o.machine_rate), inr(o.machine_cost), o.operator, String(o.labour_hours), inr(o.labour_rate), inr(o.labour_cost)])).join(''))}
      <h3>4. Process Costing — ${inr(totals.process)}</h3>
      ${tbl(['Seq', 'Process', 'Cycle (min)', 'Setup (min)', 'Cost/Hour', 'Process Cost'], opLines.map((o) => row([String(o.seq), o.process_name, String(o.cycle_time), String(o.setup_time), inr(o.cost_per_hour), inr(o.process_cost)])).join(''))}
      <h3>5. Final Price — Calculated ${inr(totals.calculated)} | Approved ${approvedNum == null ? '—' : inr(approvedNum)}</h3>`);
  };

  // ---------- edit helpers ----------
  const setMat = (key: string, patch: Partial<MaterialLine>) =>
    setMatLines((ls) => applyMatPatch(ls, key, patch));
  const setOp = (key: string, patch: Partial<OpLine>) =>
    setOpLines((ls) => applyOpPatch(ls, key, patch));

  const pct = (v: number) => (totals.calculated > 0 ? `${((v / totals.calculated) * 100).toFixed(1)}%` : '—');
  const breakRows: [string, number, string][] = [
    ['Quotation', totals.quotation, 'bg-navy-900'],
    ['Material', totals.material, 'bg-emerald-500'],
    ['Machine', totals.machine, 'bg-brand-500'],
    ['Labour', totals.labour, 'bg-violet-500'],
    ['Process', totals.process, 'bg-sky-500'],
  ];

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-full">
      <PageHeader
        title="Quotation Costing"
        description="Complete cost breakdown and final pricing in one place."
        actions={
          quote && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" icon={<Eye size={14} />} onClick={() => { try { viewCostingDocument(pdfInput()); } catch (e: any) { alert(e?.message ?? e); } }}>
                Preview PDF
              </Button>
              <Button variant="secondary" icon={<Download size={14} />} onClick={() => { downloadCostingDocument(pdfInput()).catch((e: any) => alert(e?.message ?? e)); }}>
                Download PDF
              </Button>
              <Button variant="secondary" icon={<Printer size={14} />} onClick={handlePrint}>Print</Button>
            </div>
          )
        }
      />

      {sheetsMissing && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <span className="font-bold">Setup required: </span>
          the <span className="font-mono">cnc_costing_sheets</span> table does not exist yet. Apply{' '}
          <span className="font-mono">supabase/migrations/20260930000000_costing_sheets.sql</span>. Costing calculates live, but versions cannot be saved until then.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
        {/* quotation picker */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <FormField label="Search Quotations">
            <input value={quoteSearch} onChange={(e) => setQuoteSearch(e.target.value)} placeholder="No. / company / product..." className={inputClass} />
          </FormField>
          <div className="mt-3 max-h-[520px] overflow-y-auto space-y-2">
            {loadingQuotes && <p className="text-sm text-slate-400">Loading quotations...</p>}
            {!loadingQuotes && filteredQuotes.length === 0 && <p className="text-sm text-slate-400">No quotations found.</p>}
            {filteredQuotes.map((q) => (
              <button
                key={q.id}
                onClick={() => loadQuote(String(q.id))}
                className={`w-full text-left border rounded-xl px-3 py-2.5 transition-colors ${String(selectedId) === String(q.id) ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
              >
                <p className="font-mono text-xs font-bold text-slate-700">{q.quote_no}</p>
                <p className="text-sm font-semibold text-slate-800 truncate">{q.customer}</p>
                <p className="text-xs text-slate-500 truncate">{q.part_name} · Qty {q.quantity}</p>
                <p className="text-xs font-bold text-slate-700 mt-0.5">{inr(q.total_value)} <span className="font-medium text-slate-400">· {q.status}</span></p>
              </button>
            ))}
          </div>
        </div>

        {/* sheet */}
        <div>
          {!quote ? (
            <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
              <Calculator size={36} className="mx-auto mb-3 opacity-50" />
              <p className="font-semibold text-slate-600">Select a quotation to open its costing sheet.</p>
            </div>
          ) : loadingSheet ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">Loading costing data...</div>
          ) : (
            <div className="space-y-4">
              {/* header */}
              <div className="bg-navy-900 text-white rounded-xl p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-brand-400">Costing Sheet {versions[0] ? `· Version ${versions[0].version}` : '· Unsaved'}</p>
                    <h2 className="text-xl font-bold mt-1">{product?.name || quote.part_name}</h2>
                    <p className="text-sm text-slate-300 mt-1">
                      {quote.customer} · {quote.quote_no}
                      {so ? ` · SO ${so.order_no}` : ' · No sales order yet'}
                      {products.length > 1 && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          Product:
                          <select value={productIdx} onChange={(e) => { setProductIdx(Number(e.target.value)); setMatLines([]); setOpLines([]); }} className="text-slate-800 text-xs rounded border border-slate-300 px-1.5 py-0.5">
                            {products.map((p, i) => <option key={i} value={i}>{p.name || `Product ${i + 1}`} (Qty {p.qty})</option>)}
                          </select>
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusToVariant(versions[0]?.status ?? 'Draft')}>{versions[0]?.status ?? 'Draft'}</Badge>
                    <Button size="sm" variant={editMode ? 'secondary' : 'primary'} icon={<Pencil size={13} />} onClick={() => setEditMode((v) => !v)}>
                      {editMode ? 'Done Editing' : 'Edit Costing'}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Company</p><p className="font-semibold">{quote.customer}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Product Code</p><p className="font-mono font-semibold">{productCode || '—'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Quantity</p><p className="font-semibold">{baseQty}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Costing Date</p><p className="font-semibold">{todayISO()}</p></div>
                </div>
              </div>

              {changedSinceApproval && latestApproved && (
                <div className="px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800 flex items-center gap-2">
                  <AlertTriangle size={15} />
                  Cost changed since last approval (approved calc {inr(latestApproved.calculated_price)} → now {inr(totals.calculated)}). The approved price is untouched.
                </div>
              )}

              {/* quotation details */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h3 className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-3 border-b border-brand-100 pb-2">Quotation Details</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Quotation Price</p><p className="font-bold text-slate-800">{inr(quote.total_value)}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Quoted Quantity</p><p className="font-semibold">{quote.quantity}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Unit Price</p><p className="font-semibold">{inr(quote.unit_price)}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Discount / Tax</p><p className="font-semibold">{num(quote.discount_percent)}% / {num(quote.gst_percent)}%</p></div>
                </div>
              </div>

              {/* materials */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] font-bold text-brand-600 uppercase tracking-widest border-b border-brand-100 pb-2 flex-1">Material Cost</h3>
                  <span className="text-sm font-bold text-slate-800 ml-3">Total: {inr(totals.material)}</span>
                </div>
                {matLines.length === 0 ? (
                  <p className="text-sm text-slate-400 py-3 text-center">No BOM lines found for this product.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[760px]">
                      <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                        <th className="text-left py-2">Material Code</th><th className="text-left py-2">Material Name</th>
                        <th className="text-right py-2">Req. Qty</th><th className="text-left py-2">Unit</th>
                        <th className="text-right py-2">Unit Cost</th><th className="text-right py-2">Total Cost</th>
                        <th className="text-left py-2">Supplier</th>
                      </tr></thead>
                      <tbody>
                        {matLines.map((m) => (
                          <tr key={m.key} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 font-mono text-xs">{m.material_code}</td>
                            <td className="py-2 font-medium">{m.material_name}{m.manual && <span className="ml-1.5 text-[10px] font-bold uppercase text-brand-600 bg-brand-50 border border-brand-200 rounded px-1">Manual</span>}</td>
                            <td className="py-2 text-right">{editMode
                              ? <input type="number" min="0" value={m.req_qty} onChange={(e) => setMat(m.key, { req_qty: num(e.target.value) })} className="w-24 text-right text-xs rounded border border-slate-300 px-1.5 py-1" />
                              : m.req_qty}</td>
                            <td className="py-2">{m.unit}</td>
                            <td className="py-2 text-right">{editMode
                              ? <input type="number" min="0" value={m.unit_cost} onChange={(e) => setMat(m.key, { unit_cost: num(e.target.value) })} className="w-24 text-right text-xs rounded border border-slate-300 px-1.5 py-1" />
                              : inr(m.unit_cost)}</td>
                            <td className="py-2 text-right font-semibold">{inr(m.total)}</td>
                            <td className="py-2 text-slate-500 text-xs">{m.supplier || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 mt-2">Master material prices are never overwritten — edits live only in this sheet version.</p>
              </div>

              {/* machine & labour */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] font-bold text-brand-600 uppercase tracking-widest border-b border-brand-100 pb-2 flex-1">Machine & Labour Cost</h3>
                  <span className="text-sm font-bold text-slate-800 ml-3">Total: {inr(totals.machineLabour)}</span>
                </div>
                {opLines.length === 0 ? (
                  <p className="text-sm text-slate-400 py-3 text-center">No operations found — release a work order with Process Master operations first.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[980px]">
                      <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                        <th className="text-left py-2">Operation</th><th className="text-left py-2">Machine</th>
                        <th className="text-right py-2">Mc Hrs</th><th className="text-right py-2">Mc Rate</th><th className="text-right py-2">Mc Cost</th>
                        <th className="text-left py-2">Operator</th>
                        <th className="text-right py-2">Lab Hrs</th><th className="text-right py-2">Lab Rate</th><th className="text-right py-2">Lab Cost</th>
                        <th className="text-right py-2">Total</th>
                      </tr></thead>
                      <tbody>
                        {opLines.map((o) => (
                          <tr key={o.key} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 font-medium">{o.seq} · {o.process_name || o.process_code}{o.manual && <span className="ml-1.5 text-[10px] font-bold uppercase text-brand-600 bg-brand-50 border border-brand-200 rounded px-1">Manual</span>}</td>
                            <td className="py-2">{o.machine || '—'}</td>
                            <td className="py-2 text-right">{editMode
                              ? <input type="number" min="0" step="0.01" value={o.machine_hours} onChange={(e) => setOp(o.key, { machine_hours: num(e.target.value) })} className="w-20 text-right text-xs rounded border border-slate-300 px-1.5 py-1" />
                              : Math.round(o.machine_hours * 100) / 100}</td>
                            <td className="py-2 text-right">{editMode
                              ? <input type="number" min="0" value={o.machine_rate} onChange={(e) => setOp(o.key, { machine_rate: num(e.target.value) })} className="w-20 text-right text-xs rounded border border-slate-300 px-1.5 py-1" />
                              : inr(o.machine_rate)}</td>
                            <td className="py-2 text-right font-semibold">{inr(o.machine_cost)}</td>
                            <td className="py-2">{o.operator || '—'}</td>
                            <td className="py-2 text-right">{editMode
                              ? <input type="number" min="0" step="0.01" value={o.labour_hours} onChange={(e) => setOp(o.key, { labour_hours: num(e.target.value) })} className="w-20 text-right text-xs rounded border border-slate-300 px-1.5 py-1" />
                              : Math.round(o.labour_hours * 100) / 100}</td>
                            <td className="py-2 text-right">{editMode
                              ? <input type="number" min="0" value={o.labour_rate} onChange={(e) => setOp(o.key, { labour_rate: num(e.target.value) })} className="w-20 text-right text-xs rounded border border-slate-300 px-1.5 py-1" />
                              : inr(o.labour_rate)}</td>
                            <td className="py-2 text-right font-semibold">{inr(o.labour_cost)}</td>
                            <td className="py-2 text-right font-bold">{inr(num(o.machine_cost) + num(o.labour_cost))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm font-semibold">
                  <span>Total Machine: {inr(totals.machine)}</span>
                  <span>Total Labour: {inr(totals.labour)}</span>
                </div>
              </div>

              {/* process costing */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] font-bold text-brand-600 uppercase tracking-widest border-b border-brand-100 pb-2 flex-1">Process Costing</h3>
                  <span className="text-sm font-bold text-slate-800 ml-3">Total: {inr(totals.process)}</span>
                </div>
                {opLines.length === 0 ? (
                  <p className="text-sm text-slate-400 py-3 text-center">No processes loaded.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[820px]">
                      <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                        <th className="text-left py-2">Seq</th><th className="text-left py-2">Process</th><th className="text-left py-2">Machine</th>
                        <th className="text-right py-2">Cycle (min)</th><th className="text-right py-2">Setup (min)</th>
                        <th className="text-right py-2">Cost/Hour</th><th className="text-right py-2">Process Cost</th>
                      </tr></thead>
                      <tbody>
                        {opLines.map((o) => (
                          <tr key={o.key} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 font-mono">{o.seq}</td>
                            <td className="py-2 font-medium">{o.process_code} {o.process_name}</td>
                            <td className="py-2">{o.machine || '—'}</td>
                            <td className="py-2 text-right">{o.cycle_time}</td>
                            <td className="py-2 text-right">{o.setup_time}</td>
                            <td className="py-2 text-right">{inr(o.cost_per_hour)}</td>
                            <td className="py-2 text-right font-bold">{inr(o.process_cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 mt-2">Machine Cost = Cost/Hour × Hours Run. Process Cost = Machine + Labour.</p>
              </div>

              {/* final summary */}
              <div className="rounded-xl p-5 shadow-sm bg-gradient-to-br from-navy-900 to-navy-800 text-white">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-brand-400 mb-3">Final Price Summary</h3>
                <div className="space-y-1.5 text-sm">
                  {([['Quotation Price', totals.quotation], ['Material Cost', totals.material], ['Machine Cost', totals.machine], ['Labour Cost', totals.labour], ['Process Cost', totals.process]] as [string, number][]).map(([l, v]) => (
                    <div key={l} className="flex justify-between"><span className="text-slate-300">{l}</span><span className="font-semibold tabular-nums">{inr(v)}</span></div>
                  ))}
                  <div className="border-t border-white/20 pt-2 flex justify-between items-center">
                    <span className="font-bold">SYSTEM CALCULATED PRICE</span>
                    <span className="text-2xl font-bold text-brand-400 tabular-nums">{inr(totals.calculated)}</span>
                  </div>
                  <div className="flex justify-between items-center gap-3 pt-1">
                    <span className="font-bold">FINAL APPROVED PRICE</span>
                    <input
                      type="number" min="0" value={approvedInput}
                      onChange={(e) => setApprovedInput(e.target.value)}
                      placeholder={String(Math.round(totals.calculated))}
                      className="w-44 text-right font-bold text-navy-900 rounded-lg px-3 py-1.5 text-base"
                    />
                  </div>
                  {approvedNum != null && (
                    <div className="flex justify-between text-sm pt-1">
                      <span className="text-slate-300">Adjustment</span>
                      <span className={`font-bold tabular-nums ${adjustment >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {adjustment >= 0 ? '+' : ''}{inr(adjustment)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button size="sm" icon={<Save size={13} />} disabled={saving} onClick={() => saveVersion('Calculated', approvedNum)}>
                    {saving ? 'Saving...' : 'Save Version'}
                  </Button>
                  <Button size="sm" variant="success" icon={<CheckCheck size={13} />} disabled={saving || approvedNum == null} title={approvedNum == null ? 'Enter an approved price first' : 'Approve this price as a new version'}
                    onClick={() => saveVersion('Approved', approvedNum)}>
                    Approve Price
                  </Button>
                  <Button size="sm" variant="secondary" icon={<RefreshCw size={13} />} onClick={() => { if (window.confirm('Reload all values from masters? Manual edits will be lost.')) rebuildFromMasters(); }}>
                    Recalculate
                  </Button>
                </div>
                {warnings.length > 0 && (
                  <div className="mt-3 text-xs bg-white/10 border border-white/20 rounded-lg px-3 py-2 space-y-1">
                    {warnings.map((w, i) => <p key={i} className="flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-400" />{w}</p>)}
                  </div>
                )}
              </div>

              {/* breakdown visual */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h3 className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-3 border-b border-brand-100 pb-2">Cost Breakdown</h3>
                <div className="space-y-2.5">
                  {breakRows.map(([label, v, bar]) => (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-slate-600">{label}</span>
                        <span className="font-bold text-slate-800 tabular-nums">{inr(v)} <span className="font-medium text-slate-400">· {pct(v)}</span></span>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${bar}`} style={{ width: `${totals.calculated > 0 ? Math.min(100, (v / totals.calculated) * 100) : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* history */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <button onClick={() => setExpandedHistory((v) => !v)} className="flex items-center gap-2 text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-2">
                  Costing History ({versions.length}) <ChevronDown size={13} className={`transition-transform ${expandedHistory ? 'rotate-180' : ''}`} />
                </button>
                {(expandedHistory || versions.length === 0) && (
                  versions.length === 0 ? <p className="text-sm text-slate-400">No saved versions yet.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[720px]">
                        <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                          <th className="text-left py-2">Version</th><th className="text-left py-2">Date</th><th className="text-left py-2">Created By</th>
                          <th className="text-right py-2">Calculated</th><th className="text-right py-2">Approved</th>
                          <th className="text-right py-2">Adjustment</th><th className="text-left py-2">Status</th>
                        </tr></thead>
                        <tbody>
                          {versions.map((v) => (
                            <tr key={v.id} className="border-b border-slate-100 last:border-0">
                              <td className="py-2 font-mono font-bold">V{v.version}</td>
                              <td className="py-2">{v.costing_date ? formatDate(v.costing_date) : formatDate(v.created_at)}</td>
                              <td className="py-2">{v.created_by || '—'}</td>
                              <td className="py-2 text-right tabular-nums">{inr(v.calculated_price)}</td>
                              <td className="py-2 text-right tabular-nums">{v.approved_price != null ? inr(v.approved_price) : '—'}</td>
                              <td className="py-2 text-right tabular-nums">{inr(v.adjustment)}</td>
                              <td className="py-2"><Badge variant={statusToVariant(v.status)} dot>{v.status}</Badge></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>

              {/* quick stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Material Cost" value={inr(totals.material)} icon={<FileText size={18} />} accent="success" />
                <StatCard label="Machine & Labour" value={inr(totals.machineLabour)} icon={<Calculator size={18} />} accent="brand" />
                <StatCard label="Process Cost" value={inr(totals.process)} icon={<Calculator size={18} />} accent="info" />
                <StatCard label="Calculated Price" value={inr(totals.calculated)} icon={<CheckCheck size={18} />} accent="navy" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

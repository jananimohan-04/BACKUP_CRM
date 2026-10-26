// Shared costing engine: pure calculation logic reused by the Quotation Costing
// page and the Sales Pipeline "Finished Goods + Costing" modal. No React state,
// no Supabase calls here — callers load source data and pass it in, so there is
// exactly one implementation of every formula.

import type { CostingDocumentInput } from '@/lib/brandedDocument';
import { formatINR, todayISO } from '@/lib/format';

export interface MaterialLine {
  key: string; material_code: string; material_name: string;
  req_qty: number; unit: string; unit_cost: number; total: number;
  supplier: string; remarks: string; manual: boolean;
}

export interface OpLine {
  key: string; seq: number; process_code: string; process_name: string;
  machine: string; operator: string;
  machine_hours: number; machine_rate: number; machine_cost: number;  // machine_cost = machine_rate × machine_hours
  labour_hours: number; labour_rate: number; labour_cost: number;
  cycle_time: number; setup_time: number;
  cost_per_hour: number;  // Machine Cost = Cost Per Hour × Hours run
  process_cost: number; manual: boolean;
  warn_machine: boolean; warn_labour: boolean;
}

export interface ProductOption { code: string; name: string; qty: number; unitPrice: number; workings?: any }

export interface CostingTotals {
  material: number; machine: number; labour: number; machineLabour: number;
  process: number; quotation: number; calculated: number;
  /** Service purchase (outside work) actuals; only counted when a caller passes them. */
  service: number;
}

export const costNum = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const costUid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random()}`;

export const costInr = (v: number | string | null | undefined) => formatINR(v ?? 0);
export const costPdfInr = (v: number | string | null | undefined) => formatINR(v ?? 0, { symbolText: 'Rs.' });

export function parseQuoteProducts(q: any): ProductOption[] {
  const single: ProductOption = {
    code: q.part_number ?? q.part_no ?? '',
    name: q.part_name ?? '',
    qty: costNum(q.quantity),
    unitPrice: costNum(q.unit_price),
  };
  try {
    const arr = JSON.parse(q.description ?? '');
    if (Array.isArray(arr) && arr.length > 0 && arr[0]?.partName) {
      return arr.map((it: any) => ({
        code: it.partNumber ?? '',
        name: it.partName ?? '',
        qty: costNum(it.quantity),
        unitPrice: costNum(it.unitPrice),
        workings: it.workings,
      }));
    }
  } catch { /* single-product quotation */ }
  return [single];
}

/** Minutes → hours for (setup + qty × cycle). */
export function hoursOf(setupMin: number, qty: number, cycleMin: number): number {
  return Math.max(0, (costNum(setupMin) + costNum(qty) * costNum(cycleMin)) / 60);
}

export function buildMaterialLines(
  bom: any[], rawMats: any[], suppliers: Record<string, string>, baseQty: number,
): MaterialLine[] {
  return bom.map((b: any) => {
    const rm = rawMats.find((r) => r.name === b.material || r.material_code === b.material);
    const qty = costNum(b.quantity) * baseQty;
    const rate = costNum(rm?.unit_price);
    return {
      key: costUid(),
      material_code: b.part_no ?? rm?.material_code ?? '',
      material_name: b.part_name || b.material || '',
      req_qty: qty,
      unit: b.unit ?? rm?.uom ?? 'Nos',
      unit_cost: rate,
      total: qty * rate,
      supplier: rm?.preferred_supplier_id ? suppliers[String(rm.preferred_supplier_id)] ?? '' : '',
      remarks: b.make ? `Make/Buy: ${b.make}` : '',
      manual: false,
    };
  });
}

export function buildOpLines(woOps: any[], jobCards: any[], processes: any[], wos: any[]): OpLine[] {
  const procByCode = new Map((processes ?? []).map((p: any) => [String(p.process_code), p]));
  const procByName = new Map((processes ?? []).map((p: any) => [String(p.process_name).toLowerCase(), p]));
  const cardsByOp = new Map<string, any[]>();
  for (const c of jobCards ?? []) {
    const k = `${c.work_order}::${Number(c.op_no)}`;
    if (!cardsByOp.has(k)) cardsByOp.set(k, []);
    cardsByOp.get(k)!.push(c);
  }
  const ops: OpLine[] = [];
  // Real run time of a job card (actual start to end). Used when no cycle / setup time was planned,
  // so a job that really ran for hours is never costed as zero.
  const elapsedHours = (cs: any[]) => cs.reduce((s, c) => {
    const st = c?.actual_start ? new Date(c.actual_start).getTime() : NaN;
    const en = new Date(c?.actual_end || c?.completed_at || '').getTime();
    return Number.isFinite(st) && Number.isFinite(en) && en > st ? s + (en - st) / 3600000 : s;
  }, 0);
  const pushOp = (
    seq: number, p: any, machine: string, operator: string,
    qty: number, cycleMin: number, setupMin: number, loggedHours = 0, label = '',
  ) => {
    const planned = hoursOf(setupMin, qty, cycleMin);
    const mh = planned > 0 ? planned : Math.max(0, loggedHours);
    const mRate = costNum(p?.cost_per_hour);
    const lh = operator ? mh : 0;
    const machineCost = mh * mRate;
    const labourCost = 0;
    ops.push({
      key: costUid(),
      seq,
      process_code: p?.process_code ?? '',
      // The name the run was recorded under is kept when Process Master has no such process, so it is visible why no rate was found.
      process_name: p?.process_name ?? label,
      machine,
      operator,
      machine_hours: mh,
      machine_rate: mRate,
      machine_cost: machineCost,
      labour_hours: lh,
      labour_rate: 0,
      labour_cost: labourCost,
      cycle_time: costNum(cycleMin),
      setup_time: costNum(setupMin),
      cost_per_hour: mRate,
      // Machine cost = Cost Per Hour × Hours run
      process_cost: machineCost + labourCost,
      manual: false,
      warn_machine: mh > 0 && mRate <= 0,
      warn_labour: lh > 0,
    });
  };
  if ((woOps ?? []).length > 0) {
    for (const o of woOps) {
      const p = procByCode.get(String(o.process_code))
        ?? procByName.get(String(o.process_name ?? '').toLowerCase());
      const woNo = (wos ?? []).find((w: any) => String(w.id) === String(o.work_order_id))?.wo_no;
      const cards = cardsByOp.get(`${woNo}::${costNum(o.operation_sequence) * 10}`) ?? [];
      const c = cards[0];
      const qty = costNum(o.completed_qty) > 0 ? costNum(o.completed_qty) : costNum(o.planned_qty);
      pushOp(costNum(o.operation_sequence), p, o.machine ?? c?.machine ?? '', o.operator ?? c?.operator ?? '',
        qty, costNum(o.est_cycle_time), costNum(o.setup_time),
        costNum(o.actual_minutes) > 0 ? costNum(o.actual_minutes) / 60 : elapsedHours(cards), String(o.process_name || c?.operation || ''));
    }
  } else {
    const seen = new Set<string>();
    for (const c of jobCards ?? []) {
      const k = `${c.work_order}::${Number(c.op_no)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const p = procByName.get(String(c.operation ?? '').toLowerCase());
      const qty = costNum(c.qty_completed) > 0 ? costNum(c.qty_completed) : costNum(c.qty_planned);
      pushOp(Number(c.op_no) / 10 || 0, p, c.machine ?? '', c.operator ?? '', qty, costNum(c.cycle_time), costNum(c.setup_time), elapsedHours(cardsByOp.get(k) ?? [c]), String(c.operation ?? ''));
    }
  }
  ops.sort((a, b) => a.seq - b.seq);
  return ops;
}

export function computeTotals(matLines: MaterialLine[], opLines: OpLine[], quoteTotal: number, serviceTotal = 0): CostingTotals {
  const material = matLines.reduce((s, m) => s + costNum(m.total), 0);
  const machine = opLines.reduce((s, o) => s + costNum(o.machine_cost), 0);  // Machine Cost = Cost/Hour × Hours
  const labour = opLines.reduce((s, o) => s + costNum(o.labour_cost), 0);
  // Process cost = machine cost + labour cost
  const process = machine + labour;
  const quotation = costNum(quoteTotal);
  const service = costNum(serviceTotal);
  return { material, machine, labour, machineLabour: machine + labour, process, quotation, service, calculated: quotation + material + process + service };
}

export function computeWarnings(args: {
  hasQuote: boolean; baseQty: number; bom: any[]; woOps: any[]; jobCards: any[]; opLines: OpLine[];
  manualMaterials?: boolean; manualOps?: boolean;
}): string[] {
  const { hasQuote, baseQty, bom, woOps, jobCards, opLines, manualMaterials, manualOps } = args;
  if (!hasQuote) return [];
  const w: string[] = [];
  if (baseQty <= 0) w.push('Quantity is not greater than 0 — check the quotation or work order quantity.');
  if (bom.length === 0 && !manualMaterials) w.push('No BOM found for this product — add material lines manually or fix the product code.');
  if (woOps.length === 0 && jobCards.length === 0 && !manualOps) w.push('No work order operations or job cards found — add operation lines manually.');
  for (const o of opLines) {
    if (o.warn_machine) w.push(`Machine rate is missing for Operation ${o.seq} (${o.process_name || o.process_code}).`);
    if (o.warn_labour && costNum(o.labour_rate) <= 0) w.push(`Labour rate is missing for Operation ${o.seq} (${o.process_name || o.process_code}).`);
  }
  return w;
}

/** Manual edit of a material row: flags manual and recomputes the line total. */
export function applyMatPatch(lines: MaterialLine[], key: string, patch: Partial<MaterialLine>): MaterialLine[] {
  return lines.map((m) => (m.key === key
    ? { ...m, ...patch, manual: true, total: costNum(patch.req_qty ?? m.req_qty) * costNum(patch.unit_cost ?? m.unit_cost) }
    : m));
}

/** Manual edit of an operation row: flags manual and recomputes all derived costs. */
export function applyOpPatch(lines: OpLine[], key: string, patch: Partial<OpLine>): OpLine[] {
  return lines.map((o) => {
    if (o.key !== key) return o;
    const n = { ...o, ...patch, manual: true };
    n.machine_cost = costNum(n.machine_hours) * costNum(n.machine_rate);  // Machine Cost = Rate × Hours
    n.labour_cost = costNum(n.labour_hours) * costNum(n.labour_rate);
    n.process_cost = n.machine_cost + n.labour_cost;
    n.warn_machine = costNum(n.machine_hours) > 0 && costNum(n.machine_rate) <= 0;
    n.warn_labour = costNum(n.labour_hours) > 0 && costNum(n.labour_rate) <= 0;
    return n;
  });
}

export interface VersionPayload {
  quotation_id: string | null;
  quotation_no: string;
  sales_order_id: string | null;
  sales_order_no: string;
  product_code: string;
  product_name: string;
  quantity: number;
  costing_date: string;
  status: 'Draft' | 'Calculated' | 'Approved';
  version: number;
  quotation_price: number;
  calculated_price: number;
  approved_price: number | null;
  adjustment: number;
  lines: { materials: MaterialLine[]; ops: OpLine[]; quoteOverrides?: { qty: number | null; unit: number | null } | null };
  created_by: string | null;
}

/** Exact insert payload for cnc_costing_sheets (append-only versions). */
export function buildVersionPayload(args: {
  quote: any; so: any; productCode: string; productName: string; baseQty: number;
  status: 'Draft' | 'Calculated' | 'Approved'; version: number; totals: CostingTotals;
  approved: number | null; matLines: MaterialLine[]; opLines: OpLine[]; userName: string;
  quoteOverrides?: { qty: number | null; unit: number | null } | null;
}): any {
  const { quote, so, productCode, productName, baseQty, status, version, totals, approved, matLines, opLines, userName, quoteOverrides } = args;
  return {
    id: costUid(),
    quotation_id: quote.id != null ? String(quote.id) : null,
    quotation_no: quote.quote_no ?? '',
    sales_order_id: so?.id != null ? String(so.id) : null,
    sales_order_no: so?.order_no ?? '',
    product_code: productCode,
    product_name: productName,
    quantity: baseQty,
    costing_date: todayISO(),
    status,
    version,
    quotation_price: totals.quotation,
    calculated_price: totals.calculated,
    approved_price: approved,
    adjustment: approved == null ? 0 : approved - totals.calculated,
    lines: { materials: matLines, ops: opLines, quoteOverrides: quoteOverrides ?? null },
    created_by: userName || null,
  };
}

export function buildCostingPdfInput(args: {
  companyName: string; documentNo: string; date: string;
  quote: any; so: any; product: ProductOption | null; productCode: string; baseQty: number;
  inwardNo?: string;
  status: string; matLines: MaterialLine[]; opLines: OpLine[]; totals: CostingTotals;
  approved: number | null; latestVersion: any; userName: string;
}): CostingDocumentInput {
  const { companyName, documentNo, date, quote, so, product, productCode, baseQty, inwardNo, status,
    matLines, opLines, totals, approved, latestVersion, userName } = args;
  const adj = approved == null ? 0 : approved - totals.calculated;
  const approvedBy = latestVersion?.status === 'Approved' ? (latestVersion?.created_by ?? userName ?? '') : '—';
  return {
    companyName,
    documentNo,
    date,
    infoLeft: [
      ['Company', quote?.customer ?? ''],
      ['Quotation No', quote?.quote_no ?? ''],
      ['Sales Order', so?.order_no ?? ''],
      ['Product', product?.name ?? ''],
    ],
    infoRight: [
      ['Product Code', productCode || ''],
      ...(inwardNo ? [['Inward No', inwardNo] as [string, string]] : []),
      ['Quantity', String(baseQty)],
      ['Costing Date', date],
      ['Status', status],
    ],
    quotationRow: [
      quote?.quote_no ?? '', quote?.customer ?? '', product?.name ?? '', String(baseQty),
      costPdfInr(quote?.unit_price), `${costNum(quote?.discount_percent)}%`,
      `${costNum(quote?.gst_percent)}%`, costPdfInr(quote?.total_value),
    ],
    materials: matLines.map((m) => ({
      code: m.material_code,
      name: m.material_name + (m.manual ? ' *' : ''),
      qty: `${m.req_qty} ${m.unit}`, unit: m.unit,
      rate: costPdfInr(m.unit_cost), total: costPdfInr(m.total),
    })),
    ops: opLines.map((o) => ({
      op: `${o.seq} ${o.process_name || o.process_code}`, machine: o.machine || '',
      mHours: String(Math.round(o.machine_hours * 100) / 100), mRate: costPdfInr(o.machine_rate), mCost: costPdfInr(o.machine_cost),
      operator: o.operator || '', lHours: String(Math.round(o.labour_hours * 100) / 100),
      lRate: costPdfInr(o.labour_rate), lCost: costPdfInr(o.labour_cost),
    })),
    processes: opLines.map((o) => ({
      seq: String(o.seq), process: `${o.process_code} ${o.process_name}`.trim(), machine: o.machine || '',
      cycle: String(o.cycle_time), setup: String(o.setup_time),
      rate: costPdfInr(o.cost_per_hour), cost: costPdfInr(o.process_cost),  // Machine Cost = Rate × Hours
    })),
    summary: [
      ['Project Costing', costPdfInr(totals.calculated)],
      ['Material Cost', costPdfInr(totals.material)],
      ['Machine & Labour', costPdfInr(totals.machineLabour)],
      ['Process Cost', costPdfInr(totals.process)],
      ['Approved Final Price', approved == null ? '—' : costPdfInr(approved)],
      ['Adjustment', `${adj >= 0 ? '+' : ''}${costPdfInr(adj)}`],
    ],
    approval: [
      ['Version', String(latestVersion?.version ?? 1)],
      ['Status', latestVersion?.status ?? 'Draft'],
      ['Created By', latestVersion?.created_by ?? userName ?? ''],
      ['Calculated Price', costPdfInr(latestVersion?.calculated_price ?? totals.calculated)],
      ['Approved Price', latestVersion?.approved_price != null ? costPdfInr(latestVersion.approved_price) : '—'],
      ['Prepared By', latestVersion?.created_by ?? userName ?? ''],
      ['Approved By', approvedBy],
      ['Date', date],
      ['Signature', ''],
    ],
  };
}

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

/** Match an operation name or machine to a row in cnc_processes (Process Master). */
export function matchProcess(processes: any[], nameOrCode: string, machine?: string): any {
  if (!nameOrCode && !machine) return null;
  const norm = (s: any) => String(s ?? '').toLowerCase().trim().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ');
  const target = norm(nameOrCode);
  const targetMach = norm(machine);
  const list = processes ?? [];

  // 1. Exact match by process_code
  if (target) {
    const f = list.find((p: any) => norm(p.process_code) === target);
    if (f) return f;
  }

  // 2. Exact match by process_name
  if (target) {
    const f = list.find((p: any) => norm(p.process_name) === target);
    if (f) return f;
  }

  // 3. Substring / contains match by name
  if (target) {
    const f = list.find((p: any) => {
      const pn = norm(p.process_name);
      return pn && (pn.includes(target) || target.includes(pn));
    });
    if (f) return f;
  }

  // 4. Machine type match
  if (targetMach) {
    const f = list.find((p: any) => {
      const mt = norm(p.machine_type);
      return mt && (mt === targetMach || mt.includes(targetMach) || targetMach.includes(mt));
    });
    if (f) return f;
  }

  // 5. Machine in process name
  if (targetMach) {
    const f = list.find((p: any) => {
      const pn = norm(p.process_name);
      return pn && (pn.includes(targetMach) || targetMach.includes(pn));
    });
    if (f) return f;
  }

  return null;
}

/** Compute elapsed run time of a job card or operation plan in hours. */
export function calcJobCardHours(c: any): number {
  if (!c) return 0;
  // 1. Direct actual_minutes recorded
  if (costNum(c.actual_minutes) > 0) {
    return costNum(c.actual_minutes) / 60;
  }
  // 2. Real timestamps (actual_start to actual_end / completed_at)
  const st = c.actual_start ? new Date(c.actual_start).getTime() : NaN;
  const en = new Date(c.actual_end || c.completed_at || '').getTime();
  if (Number.isFinite(st) && Number.isFinite(en) && en > st) {
    return (en - st) / 3600000;
  }
  // 3. In-progress / running right now in scheduling
  if (Number.isFinite(st) && (['Running', 'In Progress'].includes(String(c.status)) || !c.actual_end)) {
    const now = Date.now();
    if (now > st) return (now - st) / 3600000;
  }
  // 4. Operation plan start_time / end_time ('HH:mm')
  if (c.start_time && c.end_time) {
    const toMin = (t: string) => {
      const [h, m] = String(t).split(':').map(Number);
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    const diff = toMin(c.end_time) - toMin(c.start_time);
    if (diff > 0) return diff / 60;
  }
  // 5. Fallback planned hours from cycle / setup
  const qty = costNum(c.qty_completed) > 0 ? costNum(c.qty_completed) : costNum(c.qty_planned);
  const planned = hoursOf(costNum(c.setup_time), qty, costNum(c.cycle_time));
  return planned > 0 ? planned : 0;
}

export function buildOpLines(
  woOps: any[],
  jobCards: any[],
  processes: any[],
  wos: any[],
  opPlans: any[] = []
): OpLine[] {
  const ops: OpLine[] = [];
  const norm = (s: any) => String(s ?? '').toLowerCase().trim().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ');

  const pushOp = (
    seq: number,
    processLabel: string,
    processCode: string,
    machine: string,
    operator: string,
    qty: number,
    cycleMin: number,
    setupMin: number,
    loggedHours: number,
  ) => {
    // Match Process Master to get the per hour rate (cost_per_hour or hourly_rate)
    const p = matchProcess(processes, processLabel || processCode, machine);
    const mRate = costNum(p?.cost_per_hour ?? p?.hourly_rate ?? 0);

    const planned = hoursOf(setupMin, qty, cycleMin);
    // User formula: in scheduling how many hrs ran is in data; hour rate * hours calculate and show
    const mh = loggedHours > 0 ? loggedHours : planned;
    const roundedMh = Math.round(mh * 100) / 100;
    const machineCost = Math.round(roundedMh * mRate * 100) / 100;

    const lh = operator ? roundedMh : 0;
    const labourCost = 0;

    ops.push({
      key: costUid(),
      seq,
      process_code: p?.process_code ?? processCode ?? '',
      process_name: p?.process_name ?? processLabel ?? 'Machining',
      machine: machine || p?.machine_type || '',
      operator: operator || '',
      machine_hours: roundedMh,
      machine_rate: mRate,
      machine_cost: machineCost,
      labour_hours: lh,
      labour_rate: 0,
      labour_cost: labourCost,
      cycle_time: costNum(cycleMin),
      setup_time: costNum(setupMin),
      cost_per_hour: mRate,
      process_cost: machineCost + labourCost,
      manual: false,
      warn_machine: roundedMh > 0 && mRate <= 0,
      warn_labour: false,
    });
  };

  const allJobs = jobCards ?? [];
  const allWoOps = woOps ?? [];
  const allPlans = opPlans ?? [];

  if (allWoOps.length > 0) {
    const consumedJobIds = new Set<string>();
    allWoOps.forEach((o, idx) => {
      const woNo = (wos ?? []).find((w: any) => String(w.id) === String(o.work_order_id))?.wo_no;
      const oSeq = costNum(o.operation_sequence) || (idx + 1);
      const oName = String(o.process_name || o.process_code || '');

      // Find job cards that match this operation
      const matchedCards = allJobs.filter((c: any) => {
        if (consumedJobIds.has(String(c.id))) return false;
        const cWo = String(c.work_order ?? '');
        const cOpNo = Number(c.op_no);
        const cName = String(c.operation ?? '');
        const sameWo = !woNo || cWo === woNo;
        const matchesSeq = Number.isFinite(cOpNo) && (cOpNo === oSeq * 10 || cOpNo === oSeq);
        const matchesName = norm(cName) === norm(oName) || (cName && oName && (norm(cName).includes(norm(oName)) || norm(oName).includes(norm(cName))));
        return sameWo && (matchesSeq || matchesName);
      });

      matchedCards.forEach((c: any) => consumedJobIds.add(String(c.id)));

      const cardHours = matchedCards.reduce((sum, c) => sum + calcJobCardHours(c), 0);
      const directHours = costNum(o.actual_minutes) > 0 ? costNum(o.actual_minutes) / 60 : 0;
      const loggedHours = directHours > 0 ? directHours : cardHours;

      const firstCard = matchedCards[0];
      const qty = costNum(o.completed_qty) > 0 ? costNum(o.completed_qty) : costNum(o.planned_qty);
      const machine = o.machine ?? firstCard?.machine ?? '';
      const operator = o.operator ?? firstCard?.operator ?? '';

      pushOp(
        oSeq,
        oName,
        String(o.process_code ?? ''),
        machine,
        operator,
        qty,
        costNum(o.est_cycle_time),
        costNum(o.setup_time),
        loggedHours
      );
    });

    // If there were extra job cards from scheduling that didn't match any woOp, add them
    const unconsumedJobs = allJobs.filter((c: any) => !consumedJobIds.has(String(c.id)));
    if (unconsumedJobs.length > 0) {
      const seen = new Map<string, { machine: string; operator: string; qty: number; cycle: number; setup: number; hours: number }>();
      unconsumedJobs.forEach((c: any) => {
        const opName = String(c.operation || 'Machining').trim();
        const mach = String(c.machine || '').trim();
        const k = `${opName}|${mach}`;
        const prev = seen.get(k) ?? {
          machine: mach,
          operator: String(c.operator || '').trim(),
          qty: costNum(c.qty_completed) || costNum(c.qty_planned),
          cycle: costNum(c.cycle_time),
          setup: costNum(c.setup_time),
          hours: 0,
        };
        prev.hours += calcJobCardHours(c);
        if (!prev.operator && c.operator) prev.operator = String(c.operator).trim();
        seen.set(k, prev);
      });

      let nextSeq = ops.length + 1;
      seen.forEach((data, k) => {
        const opName = k.split('|')[0];
        pushOp(nextSeq++, opName, '', data.machine, data.operator, data.qty, data.cycle, data.setup, data.hours);
      });
    }
  } else if (allJobs.length > 0) {
    // Scheduling data from job cards (no work order operations table)
    // Group by operation name & machine so multiple runs of the same operation add their running hours
    const grouped = new Map<string, {
      opName: string;
      machine: string;
      operator: string;
      qty: number;
      cycle: number;
      setup: number;
      hours: number;
      seq: number;
    }>();

    allJobs.forEach((c: any) => {
      const opName = String(c.operation || 'Machining').trim();
      const mach = String(c.machine || '').trim();
      const k = `${opName.toLowerCase()}|${mach.toLowerCase()}`;
      const hrs = calcJobCardHours(c);
      const existing = grouped.get(k);

      if (existing) {
        existing.hours += hrs;
        if (!existing.operator && c.operator) existing.operator = String(c.operator).trim();
        if (costNum(c.qty_completed) > existing.qty) existing.qty = costNum(c.qty_completed);
      } else {
        const seq = Number(c.op_no) > 0 ? (Number(c.op_no) >= 10 ? Math.round(Number(c.op_no) / 10) : Number(c.op_no)) : (grouped.size + 1);
        grouped.set(k, {
          opName,
          machine: mach,
          operator: String(c.operator || '').trim(),
          qty: costNum(c.qty_completed) || costNum(c.qty_planned),
          cycle: costNum(c.cycle_time),
          setup: costNum(c.setup_time),
          hours: hrs,
          seq,
        });
      }
    });

    let s = 1;
    grouped.forEach((item) => {
      pushOp(
        item.seq || s++,
        item.opName,
        '',
        item.machine,
        item.operator,
        item.qty,
        item.cycle,
        item.setup,
        item.hours
      );
    });
  } else if (allPlans.length > 0) {
    // Planned scheduling runs from cnc_operation_plans
    allPlans.forEach((p: any, idx: number) => {
      const seq = costNum(p.operation_sequence) || (idx + 1);
      const hours = calcJobCardHours(p);
      pushOp(
        seq,
        String(p.process_name || 'Machining'),
        '',
        String(p.machine || ''),
        String(p.operator || ''),
        costNum(p.quantity),
        0,
        0,
        hours
      );
    });
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Printer, Search, TrendingUp, Package, GripVertical } from 'lucide-react';
import { Badge, Button, Card, statusToVariant } from '@/components/ui/Card';
import { inputClass } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDate, formatINR, todayISO } from '@/lib/format';
import { exportCsv, escapeHtml, printHtml } from '@/lib/reportExport';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';

type ProjectRow = {
  project_name: string;
  party_name: string;
  part_name: string;
  quantity: string | null;
  planned_cost: string | null;
  actual_cost: string | null;
  sales_value: string | null;
  cost_source: string | null;
  profit?: string | null;
  profit_pct?: string | null;
};

type CostingDetail = {
  project: ProjectRow & {
    product_cost: string | null;
    process_cost: string | null;
    invoice_value: string | null;
  };
  categories: { category: string; amount: string }[];
  processes: {
    id: string;
    process: string;
    supplier: string;
    duration: string;
    quantity: string;
    rate: string;
    amount: string;
    created_at: string;
  }[];
  materials: {
    id: string;
    date: string;
    type: string;
    reference: string;
    item: string;
    quantity: string;
    unit: string;
    rate: string;
    amount: string;
    work_order: string;
    request_no: string;
  }[];
  services: {
    id: string;
    date: string;
    type: string;
    reference: string;
    item: string;
    quantity: string;
    unit: string;
    rate: string;
    amount: string;
    work_order: string;
    request_no: string;
  }[];
  work_orders: {
    id: string;
    wo_no: string;
    sales_order: string;
    customer: string;
    part_name: string;
    part_no: string;
    quantity: string;
    completed: string;
    rejected: string;
    status: string;
    due_date: string;
  }[];
  operations?: {
    id: string;
    job_no: string;
    operation: string;
    machine: string;
    operator: string;
    qty_planned: string;
    qty_completed: string;
    qty_rejected: string;
    cycle_time: string;
    setup_time: string;
    status: string;
  }[];
};

const money = (v: string | number | null | undefined) =>
  v == null || v === '' ? '—' : formatINR(v, { decimals: 'auto' });

const tabs = [
  'Process Costing',
  'Material Cost',
  'Machine & Labour',
  'Expenses',
];

// Helper to check if category is Goods Purchase
const isGoodsPurchaseCategory = (cat: string | null | undefined) => {
  if (!cat) return false;
  const s = String(cat).trim().toUpperCase();
  return s.includes('GOODS PURCHASE') || s.includes('GOODS_PURCHASE') || s === 'PURCHASE';
};

// Helper to check if category is Service Purchase (routed to Machine & Labour)
const isServicePurchaseCategory = (cat: string | null | undefined) => {
  if (!cat) return false;
  const s = String(cat).trim().toUpperCase();
  return s.includes('SERVICE PURCHASE') || s.includes('SERVICE_PURCHASE') || s === 'SERVICE';
};

const isPurchaseCategory = (cat: string | null | undefined) =>
  isGoodsPurchaseCategory(cat) || isServicePurchaseCategory(cat);

// Quotation totals by sales order (via quotation_id / quote_no), falling back to customer + part.
// Returns a matcher: (project / sales-order refs, party, part) -> quoted amount, or null.
async function loadQuoteLookup() {
  const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
  const [{ data: sos }, { data: quotes }] = await Promise.all([
    supabase.from('cnc_sales_orders').select('order_no, quotation_id, quote_no'),
    supabase.from('cnc_quotations').select('id, quote_no, customer, part_name, total_value'),
  ]);
  const quoteList = quotes ?? [];
  const totalOf = (q: any) => Number(q?.total_value) || 0;
  return (refs: unknown[], party: string | null, part: string | null): number | null => {
    const wanted = new Set(refs.map(lc).filter(Boolean));
    let sum = 0;
    const seen = new Set<string>();
    for (const so of sos ?? []) {
      if (!wanted.has(lc(so.order_no))) continue;
      const q = quoteList.find((x: any) => (so.quotation_id && x.id === so.quotation_id) || (so.quote_no && lc(x.quote_no) === lc(so.quote_no)));
      if (q && !seen.has(String(q.id))) { seen.add(String(q.id)); sum += totalOf(q); }
    }
    if (sum > 0) return sum;
    const byParty = quoteList.filter((q: any) => lc(q.customer) === lc(party) && lc(q.part_name) === lc(part));
    const latest = byParty[byParty.length - 1];
    return latest && totalOf(latest) > 0 ? totalOf(latest) : null;
  };
}

export function ProjectCostingPage() {
  const { company } = useAuth();
  const { setHeader, setTabActions } = useHeaderKpis();
  const exportRef = useRef<() => void>(() => {});
  const printRef = useRef<() => void>(() => {});

  // Resizable left/right panes width (persisted in localStorage)
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('project_costing_left_width');
      const n = saved ? parseInt(saved, 10) : NaN;
      return Number.isFinite(n) && n >= 220 && n <= 750 ? n : 300;
    } catch {
      return 300;
    }
  });
  const [isDragging, setIsDragging] = useState(false);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const initialWidth = leftWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(220, Math.min(750, initialWidth + delta));
      setLeftWidth(nextWidth);
    };

    const onMouseUp = (upEvent: MouseEvent) => {
      const delta = upEvent.clientX - startX;
      const finalWidth = Math.max(220, Math.min(750, initialWidth + delta));
      setLeftWidth(finalWidth);
      try {
        localStorage.setItem('project_costing_left_width', String(finalWidth));
      } catch {}
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [leftWidth]);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ProjectRow | null>(null);
  const [report, setReport] = useState<CostingDetail | null>(null);
  const [tab, setTab] = useState('Material Cost');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const pageSize = 10;
  // Process Master rates for valuing production operations (missing table tolerated).
  const [procRates, setProcRates] = useState<any[]>([]);
  // Expense inwards entered for this project (typed product / project name).
  const [expenseRows, setExpenseRows] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: e } = await supabase.from('cnc_processes').select('*').order('process_code');
        if (!cancelled && !e) setProcRates(data ?? []);
      } catch { /* rates stay empty; operations show unmatched */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-upgrade seeded dummy inwards if needed
  const autoSyncSeededInwards = async () => {
    try {
      await supabase
        .from('cnc_inwards')
        .update({ category: 'GOODS PURCHASE' })
        .in('inward_no', ['INW-2026-201', 'INW-2026-202', 'INW-2026-203', 'INW-2026-204', 'INW-2026-205'])
        .eq('category', 'CUSTOMER DC');
    } catch {
      // Ignore if permission or network issue
    }
  };

  const loadProjects = async (p = 1, q = appliedSearch) => {
    setLoading(true);
    setError('');
    try {
      await autoSyncSeededInwards();

      const { data, error: rpcError } = await supabase.rpc('erp_costing_projects', {
        p_search: q || null,
        p_page: p,
        p_page_size: pageSize,
      } as never);
      if (rpcError) throw new Error(rpcError.message);
      const result = data as any;
      let rows: ProjectRow[] = result.rows || [];

      // Fetch Goods Purchase inwards to enrich actual_cost in project list
      const { data: inwardRows } = await supabase
        .from('cnc_inwards')
        .select('*');

      const { data: woList } = await supabase
        .from('cnc_work_orders')
        .select('wo_no, sales_order, customer, part_name');

      if (inwardRows && inwardRows.length > 0) {
        const purchaseInwards = inwardRows.filter((inv: any) =>
          isPurchaseCategory(inv.category)
        );

        rows = rows.map((proj) => {
          const linkedWos = (woList || []).filter(
            (w: any) =>
              w.wo_no === proj.project_name ||
              w.sales_order === proj.project_name ||
              (w.customer === proj.party_name && w.part_name === proj.part_name)
          );

          const matchingSo = new Set<string>();
          const matchingWo = new Set<string>();
          matchingSo.add(proj.project_name.toLowerCase());
          matchingWo.add(proj.project_name.toLowerCase());
          linkedWos.forEach((w: any) => {
            if (w.sales_order) matchingSo.add(w.sales_order.toLowerCase());
            if (w.wo_no) matchingWo.add(w.wo_no.toLowerCase());
          });

          const matchingInwards = purchaseInwards.filter((inv: any) => {
            const soRef = (inv.sales_order_ref || '').trim().toLowerCase();
            const projRef = (inv.project_name || '').trim().toLowerCase();
            const partyRef = (inv.party_name || '').trim().toLowerCase();
            const partRef = (inv.part_name || '').trim().toLowerCase();
            const prodRef = (inv.product_name || '').trim().toLowerCase();
            const currParty = (proj.party_name || '').trim().toLowerCase();
            const currPart = (proj.part_name || '').trim().toLowerCase();

            if (soRef && matchingSo.has(soRef)) return true;
            if (projRef && (matchingWo.has(projRef) || matchingSo.has(projRef))) return true;
            if (partyRef && partyRef === currParty && (partRef === currPart || prodRef === currPart)) return true;
            return false;
          });

          if (matchingInwards.length > 0) {
            const purchaseTotal = matchingInwards.reduce((sum: number, inv: any) => {
              const qty = Number(inv.quantity) || 0;
              const price = Number(inv.price) || 0;
              const tot = Number(inv.total_amount) || qty * price;
              return sum + tot;
            }, 0);

            const kinds = Array.from(
              new Set(
                matchingInwards.map((inv: any) =>
                  isServicePurchaseCategory(inv.category) ? 'service purchase' : 'goods purchase'
                )
              )
            );

            const baseCost = Number(proj.actual_cost) || 0;
            const combinedCost = baseCost > 0 ? baseCost + purchaseTotal : purchaseTotal;
            const salesVal = Number(proj.sales_value) || 0;
            const profit = salesVal ? (salesVal - combinedCost).toFixed(2) : null;
            const profitPct =
              salesVal && salesVal > 0
                ? (((salesVal - combinedCost) * 100) / salesVal).toFixed(2)
                : null;

            return {
              ...proj,
              actual_cost: combinedCost.toFixed(2),
              cost_source: proj.cost_source
                ? `${proj.cost_source} + ${kinds.join(' + ')}`
                : `${kinds.join(' + ')} inward`,
              profit,
              profit_pct: profitPct,
            };
          }
          return proj;
        });
      }

      // Planned Cost: the amount quoted to the customer, unless planned_workings already has one.
      const quoteLookup = await loadQuoteLookup();
      rows = rows.map((proj) => {
        if (Number(proj.planned_cost) > 0) return proj;
        const linked = (woList || []).filter((w: any) => w.wo_no === proj.project_name || w.sales_order === proj.project_name);
        const quoted = quoteLookup(
          [proj.project_name, ...linked.map((w: any) => w.sales_order)],
          proj.party_name, proj.part_name,
        );
        return quoted ? { ...proj, planned_cost: quoted.toFixed(2) } : proj;
      });

      setProjects(rows);
      setTotal(result.total || 0);
      setPage(p);
      const next =
        rows.find(
          (x: ProjectRow) =>
            selected &&
            x.project_name === selected.project_name &&
            x.part_name === selected.part_name &&
            x.party_name === selected.party_name
        ) ||
        rows[0] ||
        null;
      setSelected(next);
    } catch (e) {
      setProjects([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : 'Unable to load project costing.');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (p: ProjectRow | null) => {
    if (!p) {
      setReport(null);
      return;
    }
    setDetailLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('erp_project_costing_detail', {
        p_project_name: p.project_name,
        p_part_name: p.part_name || null,
        p_party_name: p.party_name || null,
      } as never);
      if (rpcError) throw new Error(rpcError.message);

      const baseReport = (data as CostingDetail) || {
        project: { ...p, product_cost: null, process_cost: null, invoice_value: null },
        categories: [],
        processes: [],
        materials: [],
        work_orders: [],
        operations: [],
      };

      // 1. Fetch purchase inwards (goods -> material, service -> machine & labour)
      const { data: inwardRows } = await supabase
        .from('cnc_inwards')
        .select('*');

      const purchaseInwards = (inwardRows || []).filter((inv: any) =>
        isPurchaseCategory(inv.category)
      );

      // Build match keys
      const workOrders = baseReport.work_orders || [];
      const matchingSo = new Set<string>();
      const matchingWo = new Set<string>();
      matchingSo.add(p.project_name.toLowerCase());
      matchingWo.add(p.project_name.toLowerCase());
      workOrders.forEach((w: any) => {
        if (w.sales_order) matchingSo.add(w.sales_order.toLowerCase());
        if (w.wo_no) matchingWo.add(w.wo_no.toLowerCase());
      });

      const currParty = (p.party_name || '').trim().toLowerCase();
      const currPart = (p.part_name || '').trim().toLowerCase();

      const lc = (v: any) => String(v ?? '').trim().toLowerCase();
      setExpenseRows((inwardRows || []).filter((inv: any) => {
        if (String(inv.category || '').trim().toUpperCase() !== 'EXPENSES' || inv.status === 'Deleted') return false;
        const names = [inv.project_name, inv.product_name].map(lc).filter(Boolean);
        if (lc(inv.sales_order_ref) && matchingSo.has(lc(inv.sales_order_ref))) return true;
        if (names.some(n => n === lc(p.project_name) || n === currPart || matchingSo.has(n) || matchingWo.has(n))) return true;
        return !!lc(inv.party_name) && lc(inv.party_name) === currParty && lc(inv.part_name) === currPart;
      }));

      const matchedInwards = purchaseInwards.filter((inv: any) => {
        const soRef = (inv.sales_order_ref || '').trim().toLowerCase();
        const projRef = (inv.project_name || '').trim().toLowerCase();
        const partyRef = (inv.party_name || '').trim().toLowerCase();
        const partRef = (inv.part_name || '').trim().toLowerCase();
        const prodRef = (inv.product_name || '').trim().toLowerCase();

        if (soRef && matchingSo.has(soRef)) return true;
        if (projRef && (matchingWo.has(projRef) || matchingSo.has(projRef))) return true;
        if (partyRef && partyRef === currParty && (partRef === currPart || prodRef === currPart)) return true;
        return false;
      });

      // Format inward rows: goods purchase -> material, service purchase -> machine & labour
      const toCostRow = (inv: any, type: string) => {
        const qty = Number(inv.quantity) || 0;
        const rate = Number(inv.price) || (qty > 0 ? (Number(inv.total_amount) || 0) / qty : 0);
        const amount = Number(inv.total_amount) || qty * rate;
        return {
          id: inv.id || crypto.randomUUID(),
          date: inv.inward_date || inv.created_at || todayISO(),
          type,
          reference: inv.reference_no ? `${inv.inward_no} (${inv.reference_no})` : inv.inward_no,
          item: inv.part_name || inv.product_name || `${type} Item`,
          quantity: String(qty),
          unit: 'pcs',
          rate: String(rate),
          amount: String(amount),
          work_order: inv.project_name || p.project_name,
          request_no: inv.inward_no,
        };
      };

      const inwardMaterials = matchedInwards
        .filter((inv: any) => isGoodsPurchaseCategory(inv.category))
        .map((inv: any) => toCostRow(inv, 'Goods Purchase'));
      const serviceRows = matchedInwards
        .filter((inv: any) => isServicePurchaseCategory(inv.category))
        .map((inv: any) => toCostRow(inv, 'Service Purchase'));

      const allMaterials = [...(baseReport.materials || []), ...inwardMaterials];
      const totalMaterialCost = allMaterials.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
      const inwardAmount = inwardMaterials.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
      const serviceAmount = serviceRows.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

      // Update categories breakdown (used by export/print)
      let updatedCategories = [...(baseReport.categories || [])];
      const matCatIdx = updatedCategories.findIndex((c) => /material/i.test(c.category));
      if (matCatIdx >= 0) {
        const existingAmt = Number(updatedCategories[matCatIdx].amount) || 0;
        updatedCategories[matCatIdx] = {
          ...updatedCategories[matCatIdx],
          amount: (existingAmt + inwardAmount).toFixed(2),
        };
      } else if (totalMaterialCost > 0) {
        updatedCategories.unshift({
          category: 'Material Cost',
          amount: totalMaterialCost.toFixed(2),
        });
      }
      if (serviceAmount > 0) {
        const svcCatIdx = updatedCategories.findIndex((c) => /service/i.test(c.category));
        if (svcCatIdx >= 0) {
          const existingAmt = Number(updatedCategories[svcCatIdx].amount) || 0;
          updatedCategories[svcCatIdx] = {
            ...updatedCategories[svcCatIdx],
            amount: (existingAmt + serviceAmount).toFixed(2),
          };
        } else {
          updatedCategories.push({
            category: 'Service Cost',
            amount: serviceAmount.toFixed(2),
          });
        }
      }

      // Compute combined actual cost and margin
      const baseActual = Number(baseReport.project?.actual_cost) || 0;
      const purchaseAmount = inwardAmount + serviceAmount;
      const combinedActual = (baseActual > 0 ? baseActual + purchaseAmount : totalMaterialCost + serviceAmount) || null;
      const salesVal = Number(baseReport.project?.sales_value || p.sales_value) || null;
      const profit =
        salesVal !== null && combinedActual !== null ? (salesVal - combinedActual).toFixed(2) : null;
      const profitPct =
        salesVal !== null && salesVal > 0 && combinedActual !== null
          ? (((salesVal - combinedActual) * 100) / salesVal).toFixed(2)
          : null;

      const purchaseKinds = [
        ...(inwardAmount > 0 ? ['goods purchase'] : []),
        ...(serviceAmount > 0 ? ['service purchase'] : []),
      ];
      const costSource = baseReport.project?.cost_source
        ? purchaseKinds.length > 0
          ? `${baseReport.project.cost_source} + ${purchaseKinds.join(' + ')}`
          : baseReport.project.cost_source
        : purchaseKinds.length > 0
        ? `${purchaseKinds.join(' + ')} inward`
        : null;

      // Operations scheduled / logged on the work order (Production, Scheduling, Machine Log) live in
      // cnc_work_order_operations, while the report RPC only reads job cards. Add them so machine time
      // is costed too; an operation that already has a job card is not counted twice.
      let mergedOps: any[] = baseReport.operations || [];
      // Real machine time: a job card records when it started and when it was completed (the report
      // function doesn't return those), so attach the elapsed minutes to each job card operation.
      const woNos = (baseReport.work_orders || []).map((w: any) => w.wo_no).filter(Boolean);
      if (woNos.length && mergedOps.length) {
        const { data: spans, error: spanErr } = await supabase
          .from('cnc_job_cards').select('id, actual_start, completed_at').in('work_order', woNos);
        if (spanErr) console.error('Project costing: job card run times unavailable', spanErr);
        const minutesById = new Map<string, number>();
        for (const j of spans ?? []) {
          const st = j.actual_start ? new Date(j.actual_start).getTime() : NaN;
          const en = j.completed_at ? new Date(j.completed_at).getTime() : Date.now();
          if (Number.isFinite(st) && en > st) minutesById.set(String(j.id), Math.round((en - st) / 60000));
        }
        mergedOps = mergedOps.map((o: any) => (minutesById.has(String(o.id)) ? { ...o, actual_minutes: String(minutesById.get(String(o.id))) } : o));
      }
      // work_order_id is a uuid column; a non-uuid id would make the database reject the whole request.
      const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
      const woIds = (baseReport.work_orders || []).map((w: any) => w.id).filter(isUuid);
      if (woIds.length) {
        const { data: woOps, error: woOpsErr } = await supabase
          .from('cnc_work_order_operations').select('*').in('work_order_id', woIds).order('operation_sequence');
        if (woOpsErr) console.error('Project costing: work order operations unavailable', woOpsErr);
        const haveJob = new Set(mergedOps.map((o: any) => String(o.operation ?? '').trim().toLowerCase()));
        const extra = (woOps ?? [])
          .filter((o: any) => !haveJob.has(String(o.process_name ?? '').trim().toLowerCase()))
          .map((o: any) => ({
            id: o.id, job_no: null, operation: o.process_name || o.process_code, machine: o.machine, operator: o.operator,
            qty_planned: String(o.planned_qty ?? 0), qty_completed: String(o.completed_qty ?? 0), qty_rejected: '0',
            cycle_time: String(o.est_cycle_time ?? 0), setup_time: String(o.setup_time ?? 0),
            actual_minutes: String(o.actual_minutes ?? 0), status: o.status,
          }));
        mergedOps = [...mergedOps, ...extra];
      }

      let plannedCost = baseReport.project?.planned_cost ?? null;
      if (!(Number(plannedCost) > 0)) {
        const quoted = (await loadQuoteLookup())(
          [p.project_name, ...workOrders.map((w: any) => w.sales_order)], p.party_name, p.part_name,
        );
        if (quoted) plannedCost = quoted.toFixed(2);
      }

      const finalDetail: CostingDetail = {
        ...baseReport,
        operations: mergedOps,
        materials: allMaterials,
        services: [...(baseReport.services || []), ...serviceRows],
        categories: updatedCategories,
        project: {
          ...baseReport.project,
          planned_cost: plannedCost,
          actual_cost: combinedActual !== null ? String(combinedActual) : null,
          cost_source: costSource,
          profit,
          profit_pct: profitPct,
        },
      };

      setReport(finalDetail);
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : 'Unable to load costing details.');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects(1, '');
  }, [company?.id]);

  useEffect(() => {
    void loadDetail(selected);
  }, [selected?.project_name, selected?.part_name, selected?.party_name, company?.id]);

  const project = report?.project;
  const categoryRows = report?.categories || [];
  const jobs = report?.work_orders || [];
  const completed = jobs.reduce((n, w) => n + Number(w.completed || 0), 0);
  const rejected = jobs.reduce((n, w) => n + Number(w.rejected || 0), 0);
  const quantity = jobs.reduce((n, w) => n + Number(w.quantity || 0), 0);
  const progress = quantity ? Math.min(100, (completed / quantity) * 100) : 0;
  const totalActual = project?.actual_cost ?? project?.product_cost ?? project?.process_cost ?? null;
  const profit = project?.profit ?? null;
  const profitPct = project?.profit_pct ?? null;

  const exportReport = () => {
    if (!report) return;
    exportCsv('Costing_' + report.project.project_name, [
      ['Project', report.project.project_name],
      ['Company', report.project.party_name],
      ['Part', report.project.part_name],
      ['Planned Cost', report.project.planned_cost || ''],
      ['Recorded Actual Cost', totalActual || ''],
      ['Sales Order Value', report.project.sales_value || ''],
      ['Recorded Margin', profit || ''],
      [],
      ['Cost Category', 'Actual Amount'],
      ...categoryRows.map((x) => [x.category, x.amount]),
      [],
      ['Process', 'Supplier', 'Quantity', 'Duration', 'Rate', 'Amount'],
      ...(report.processes || []).map((x) => [
        x.process,
        x.supplier,
        x.quantity,
        x.duration,
        x.rate,
        x.amount,
      ]),
      [],
      ['Date', 'Source', 'Item', 'Quantity', 'Unit', 'Rate', 'Amount'],
      ...(report.materials || []).map((x) => [
        x.date,
        x.request_no,
        x.item,
        x.quantity,
        x.unit,
        x.rate,
        x.amount,
      ]),
    ]);
  };

  const printReport = () => {
    if (!report) {
      window.print();
      return;
    }
    const rows = categoryRows
      .map((x) => '<tr><td>' + escapeHtml(x.category) + '</td><td>' + money(x.amount) + '</td></tr>')
      .join('');
    printHtml(
      'Project Costing ' + report.project.project_name,
      '<h1>ARGUS CNC</h1><h2>Project Costing</h2><p>' +
        escapeHtml(report.project.project_name) +
        ' · ' +
        escapeHtml(report.project.part_name) +
        ' · ' +
        escapeHtml(report.project.party_name) +
        '</p><table><thead><tr><th>Cost Head</th><th>Recorded Actual</th></tr></thead><tbody>' +
        rows +
        '</tbody></table><p>Planned: ' +
        money(report.project.planned_cost) +
        ' · Actual: ' +
        money(totalActual) +
        ' · Sales Order: ' +
        money(report.project.sales_value) +
        '</p>'
    );
  };

  exportRef.current = exportReport;
  printRef.current = printReport;
  const hasReport = !!report;

  useEffect(() => {
    setHeader({ title: 'Project Costing' });
    setTabActions(
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={14} />}
          onClick={() => exportRef.current()}
          disabled={!hasReport}
          className="h-7 py-1 text-xs px-2.5 shadow-sm"
        >
          Export
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Printer size={14} />}
          onClick={() => printRef.current()}
          className="h-7 py-1 text-xs px-2.5 shadow-sm"
        >
          Print
        </Button>
      </div>
    );
    return () => {
      setHeader(null);
      setTabActions(null);
    };
  }, [setHeader, setTabActions, hasReport]);

  const totalMaterialsAmount = useMemo(() => {
    return (report?.materials || []).reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  }, [report?.materials]);

  const totalServiceAmount = useMemo(() => {
    return (report?.services || []).reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  }, [report?.services]);
  // Production operations valued with live Process Master rates (process costing
  // = production operations). Operations without a matching master rate show
  // hours only and are excluded from the total.
  const processOps = useMemo(() => {
    // Names are compared ignoring case and extra spaces; a process code also counts as a match.
    const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    const byName = new Map<string, any>();
    for (const p of procRates ?? []) {
      if (norm(p.process_code)) byName.set(norm(p.process_code), p);
    }
    for (const p of procRates ?? []) byName.set(norm(p.process_name), p);
    return (report?.operations || []).map((x: any) => {
      const p = byName.get(norm(x.operation));
      const qty = Number(x.qty_completed) > 0 ? Number(x.qty_completed) : Number(x.qty_planned) || 0;
      // Logged machine minutes win over the estimate when the operation has been run.
      const logged = Number(x.actual_minutes) || 0;
      const hours = Math.max(0, (logged > 0 ? logged : (Number(x.setup_time) || 0) + qty * (Number(x.cycle_time) || 0)) / 60);
      const rate = Number(p?.cost_per_hour) || 0;
      const compSetup = (Number(p?.cost_per_component) || 0) + (Number(p?.setup_cost) || 0);
      return {
        ...x,
        hours: Math.round(hours * 100) / 100,
        rate,
        compSetup,
        cost: hours * rate + compSetup,
        matched: !!p && rate > 0,
      };
    });
  }, [report?.operations, procRates]);

  const processOpsTotal = useMemo(() => {
    return processOps.reduce((sum, x) => sum + (x.matched ? x.cost : 0), 0);
  }, [processOps]);

  return (
    <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 space-y-3 bg-slate-50 min-h-full">
      <div className="lg:hidden">
        <PageHeader
          title="Project Costing"
          description="Cost analysis from existing project costs, production records, inventory movements, goods purchase inwards (material) and service purchase inwards (machine & labour)."
          actions={
            <>
              <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportReport} disabled={!report}>
                Export
              </Button>
              <Button variant="secondary" size="sm" icon={<Printer size={14} />} onClick={printReport}>
                Print
              </Button>
            </>
          }
        />
      </div>
      {error && <div className="border border-rose-200 bg-rose-50 text-rose-700 rounded p-2 text-sm">{error}</div>}
      <div className="flex flex-col xl:flex-row items-start gap-4 xl:gap-0">
        <div
          className="w-full xl:w-[var(--left-pane-w)] xl:shrink-0"
          style={{ ['--left-pane-w' as any]: `${leftWidth}px` }}
        >
          <Card className="overflow-hidden">
            <div className="p-3 border-b bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-sm">Projects / Work Orders</h3>
              <span className="hidden xl:inline text-[10px] text-slate-400 font-mono" title="Width of panel">{leftWidth}px</span>
            </div>
            <div className="p-3 border-b bg-slate-50 pt-0">
              <form
                className="flex gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  setAppliedSearch(search);
                  void loadProjects(1, search);
                }}
              >
                <input
                  className={inputClass}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search project, part, company..."
                />
                <Button size="sm" type="submit" aria-label="Search">
                  <Search size={14} />
                </Button>
              </form>
            </div>
            <div className="max-h-[340px] overflow-auto divide-y">
              {loading ? (
                <div className="p-4 text-center text-xs text-slate-500">Loading projects...</div>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.project_name + '|' + p.part_name + '|' + p.party_name}
                    onClick={() => setSelected(p)}
                    className={
                      'w-full text-left p-3 hover:bg-blue-50 transition-colors ' +
                      (selected?.project_name === p.project_name && selected?.part_name === p.part_name
                        ? 'bg-blue-50 border-l-4 border-brand-600'
                        : '')
                    }
                  >
                    <div className="text-xs font-semibold text-slate-800">{p.part_name} · {p.party_name}</div>
                    <div className="text-[10px] mt-1 text-slate-600">Recorded actual: {money(p.actual_cost)}</div>
                  </button>
                ))
              )}
              {!loading && !projects.length && (
                <div className="p-4 text-center text-xs text-slate-500">No project cost records found.</div>
              )}
            </div>
            <div className="flex justify-between p-2 border-t text-xs text-slate-500">
              <span>{total} projects</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => void loadProjects(page - 1)}>
                  <span className="sr-only">Previous</span>‹
                </button>
                {page}
                <button disabled={page * pageSize >= total} onClick={() => void loadProjects(page + 1)}>
                  <span className="sr-only">Next</span>›
                </button>
              </div>
            </div>
          </Card>
        </div>

        {/* Draggable Divider between Left and Right panes (Desktop) */}
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startDrag}
          onDoubleClick={() => {
            setLeftWidth(300);
            try {
              localStorage.setItem('project_costing_left_width', '300');
            } catch {}
          }}
          className={`hidden xl:flex items-center justify-center w-3 hover:w-3.5 cursor-col-resize select-none shrink-0 self-stretch group z-10 transition-colors ${
            isDragging ? 'bg-orange-100/60' : 'hover:bg-slate-200/50'
          }`}
          title="Drag left/right to resize panels (Double-click to reset to 300px)"
        >
          <div
            className={`rounded-full transition-all flex items-center justify-center ${
              isDragging
                ? 'w-1.5 bg-orange-500 h-28 shadow-sm'
                : 'w-1 h-14 group-hover:h-28 bg-slate-300 group-hover:bg-orange-400 group-hover:w-1.5'
            }`}
          >
            <GripVertical
              size={11}
              className={`transition-colors ${
                isDragging ? 'text-white' : 'text-slate-400 group-hover:text-white'
              }`}
            />
          </div>
        </div>

        <div className="w-full min-w-0 flex-1 space-y-4 xl:pl-3">
          {!selected ? (
            <Card className="p-12 text-center text-sm text-slate-500">Select a project or work order to view its costing.</Card>
          ) : (
            <>
              <Card className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="min-w-[180px] max-w-[320px]">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Project / Work Order</div>
                    <h2 className="text-base font-bold leading-tight truncate" title={selected.project_name}>{selected.project_name}</h2>
                    <div className="text-xs text-slate-600 truncate" title={`${selected.part_name} · ${selected.party_name}`}>{selected.part_name} · {selected.party_name}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Sales Order Value</div>
                      <div className="text-sm font-bold">{money(project?.sales_value)}</div>
                    </div>
                    <div title={project?.planned_cost ? 'From planned_workings, else the quotation total' : 'No estimate source recorded'}>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Planned Cost</div>
                      <div className="text-sm font-bold">{money(project?.planned_cost)}</div>
                    </div>
                    <div title="Operations x Process Master rates (logged minutes when recorded, else estimated from cycle time)">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Machine Cost (Est.)</div>
                      <div className="text-sm font-bold">{processOpsTotal > 0 ? money(processOpsTotal) : '—'}</div>
                    </div>
                    <div title={project?.cost_source || 'No cost source recorded'}>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Recorded Actual Cost</div>
                      <div className="text-sm font-bold">{money(totalActual)}</div>
                    </div>
                    <div title="Linked sales order only">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Sales Value</div>
                      <div className="text-sm font-bold">{money(project?.sales_value)}</div>
                    </div>
                    <div title={profitPct !== null && profitPct !== undefined ? profitPct + '%' : 'Not available'}>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Margin on Recorded Cost</div>
                      <div className="text-sm font-bold">{money(profit)}</div>
                    </div>
                  </div>
                </div>
                {jobs.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {jobs.map((w) => (
                      <Badge key={w.id} variant={statusToVariant(w.status)}>
                        {w.wo_no} · {w.status}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <b className="text-[11px] whitespace-nowrap">Production Progress</b>
                  <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: progress + '%' }} />
                  </div>
                  <span className="text-[11px] text-slate-500 whitespace-nowrap">
                    {quantity
                      ? completed +
                        ' completed · ' +
                        Math.max(0, quantity - completed - rejected) +
                        ' pending · ' +
                        rejected +
                        ' rejected'
                      : 'No linked work order quantities'}
                  </span>
                  <span className="text-[11px] font-semibold">{progress.toFixed(1)}%</span>
                </div>
              </Card>

              <div className="flex overflow-auto border-b">
                {tabs.map((x) => (
                  <button
                    key={x}
                    onClick={() => setTab(x)}
                    className={
                      'whitespace-nowrap px-3 py-2 text-[11px] font-semibold border-b-2 transition-colors ' +
                      (tab === x ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')
                    }
                  >
                    {x}
                  </button>
                ))}
              </div>

              {detailLoading ? (
                <Card className="p-12 text-center text-sm text-slate-500">Loading costing records...</Card>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {tab === 'Process Costing' && (
                    <Card className="overflow-hidden xl:col-span-2">
                      <div className="p-3 border-b bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-sm">Process Costing</h3>
                          <p className="text-[10px] text-slate-500">
                            Outside processes are the costs recorded for this project. In-house operations come from job cards, valued with live Process Master rates: (Time x Cost/Hour) + Cost/Component + Setup Cost.
                          </p>
                        </div>
                        {(processOpsTotal > 0 || (report?.processes?.length ?? 0) > 0) && (
                          <Badge variant="success" className="font-mono text-xs font-semibold px-2 py-0.5">
                            Total Process: {money((processOpsTotal + (report?.processes || []).reduce((n, x) => n + (Number(x.amount) || 0), 0)).toFixed(2))}
                          </Badge>
                        )}
                      </div>
                      <div className="overflow-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-500">
                              <th className="p-2 text-left">Type</th>
                              <th className="p-2 text-left">Process / Operation</th>
                              <th className="p-2 text-left">Company / Machine</th>
                              <th className="p-2 text-right">Qty / Hours</th>
                              <th className="p-2 text-right">Rate</th>
                              <th className="p-2 text-right">Cost</th>
                              <th className="p-2 text-left">Job / Date</th>
                              <th className="p-2 text-left">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(report?.processes || []).map((x) => (
                              <tr key={`p-${x.id}`} className="border-t hover:bg-slate-50/70">
                                <td className="p-2"><span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">Outside</span></td>
                                <td className="p-2 font-medium text-slate-800">{x.process}</td>
                                <td className="p-2">{x.supplier || '—'}</td>
                                <td className="p-2 text-right">{x.quantity || x.duration || '—'}</td>
                                <td className="p-2 text-right">{money(x.rate)}</td>
                                <td className="p-2 text-right font-semibold text-slate-900">{money(x.amount)}</td>
                                <td className="p-2">{formatDate(x.created_at)}</td>
                                <td className="p-2">—</td>
                              </tr>
                            ))}
                            {processOps.map((x) => (
                              <tr key={`o-${x.id}`} className="border-t hover:bg-slate-50/70">
                                <td className="p-2"><span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">In-house</span></td>
                                <td className="p-2 font-medium text-slate-800">
                                  {x.operation || '—'}
                                  {!x.matched && (
                                    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                                      title="Costing needs an operation name that matches a process in Process Master with a cost per hour">
                                      {x.operation ? 'Not in Process Master' : 'No operation name'}
                                    </span>
                                  )}
                                </td>
                                <td className="p-2">{x.machine} / {x.operator || '—'}</td>
                                <td className="p-2 text-right">{x.hours} h</td>
                                <td className="p-2 text-right">{x.matched ? money(x.rate) : '—'}</td>
                                <td className="p-2 text-right font-semibold text-slate-900">{x.matched ? money(x.cost) : '—'}</td>
                                <td className="p-2 font-mono text-[11px]">{x.job_no}</td>
                                <td className="p-2">{x.status || '—'}</td>
                              </tr>
                            ))}
                            {!report?.processes?.length && !processOps.length && (
                              <tr>
                                <td colSpan={8} className="p-8 text-center text-slate-500">
                                  No process cost or job card records for this project.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
{tab === 'Expenses' && (
                    <Card className="overflow-hidden xl:col-span-2">
                      <div className="p-3 border-b bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-sm">Expenses</h3>
                          <p className="text-[10px] text-slate-500">Expense inward entries made for this project.</p>
                        </div>
                        {expenseRows.length > 0 && (
                          <Badge variant="success" className="font-mono text-xs font-semibold px-2 py-0.5">
                            Total Expenses: {money(expenseRows.reduce((n, x) => n + (Number(x.total_amount) || 0), 0).toFixed(2))}
                          </Badge>
                        )}
                      </div>
                      <div className="overflow-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-500">
                              <th className="p-2 text-left">Date</th>
                              <th className="p-2 text-left">Reference</th>
                              <th className="p-2 text-left">Expense</th>
                              <th className="p-2 text-left">Company</th>
                              <th className="p-2 text-left">Remarks</th>
                              <th className="p-2 text-right">Qty</th>
                              <th className="p-2 text-right">Rate</th>
                              <th className="p-2 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {expenseRows.map((x) => (
                              <tr key={x.id} className="border-t hover:bg-slate-50/70">
                                <td className="p-2">{formatDate(x.inward_date || x.created_at)}</td>
                                <td className="p-2 font-mono text-[11px]">{x.inward_no}{x.reference_no ? ` (${x.reference_no})` : ''}</td>
                                <td className="p-2 font-medium text-slate-800">{x.part_name || x.product_name || '—'}</td>
                                <td className="p-2">{x.party_name || '—'}</td>
                                <td className="p-2">{x.remarks || '—'}</td>
                                <td className="p-2 text-right">{x.quantity}</td>
                                <td className="p-2 text-right">{money(x.price)}</td>
                                <td className="p-2 text-right font-semibold text-slate-900">{money(x.total_amount)}</td>
                              </tr>
                            ))}
                            {!expenseRows.length && (
                              <tr><td colSpan={8} className="p-8 text-center text-slate-500">No expenses for this project.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
{tab === 'Material Cost' && (
                    <Card className="overflow-hidden xl:col-span-2">
                      <div className="p-3 border-b bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-sm">Material Cost from Goods Purchase & Inventory Issues</h3>
                          <p className="text-[10px] text-slate-500">
                            Source: Goods Purchase inward entries and posted stock movements linked to this project or work order.
                          </p>
                        </div>
                        {report?.materials && report.materials.length > 0 && (
                          <Badge variant="success" className="font-mono text-xs font-semibold px-2 py-0.5">
                            Total Material: {money(totalMaterialsAmount.toFixed(2))}
                          </Badge>
                        )}
                      </div>
                      <div className="overflow-auto">
                        <table className="w-full min-w-[700px] text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-500">
                              <th className="p-2 text-left">Date</th>
                              <th className="p-2 text-left">Item / Material</th>
                              <th className="p-2 text-left">Source</th>
                              <th className="p-2 text-left">Inward / Request Ref</th>
                              <th className="p-2 text-right">Quantity</th>
                              <th className="p-2 text-center">Unit</th>
                              <th className="p-2 text-right">Rate</th>
                              <th className="p-2 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(report?.materials || []).map((x) => (
                              <tr key={x.id} className="border-t hover:bg-slate-50/70">
                                <td className="p-2">{formatDate(x.date)}</td>
                                <td className="p-2 font-medium text-slate-800">{x.item}</td>
                                <td className="p-2">
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                      x.type === 'Goods Purchase'
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                                    }`}
                                  >
                                    {x.type || 'Material'}
                                  </span>
                                </td>
                                <td className="p-2 font-mono text-[11px] text-slate-600">
                                  {x.reference || x.request_no}
                                </td>
                                <td className="p-2 text-right font-medium">{x.quantity}</td>
                                <td className="p-2 text-center text-slate-500">{x.unit || 'pcs'}</td>
                                <td className="p-2 text-right">{money(x.rate)}</td>
                                <td className="p-2 text-right font-semibold text-slate-900">{money(x.amount)}</td>
                              </tr>
                            ))}
                            {!report?.materials?.length && (
                              <tr>
                                <td colSpan={8} className="p-8 text-center text-slate-500">
                                  No linked material cost or goods purchase inward records.
                                </td>
                              </tr>
                            )}
                          </tbody>
                          {report?.materials && report.materials.length > 0 && (
                            <tfoot>
                              <tr className="border-t bg-slate-50/90 font-bold">
                                <td colSpan={7} className="p-2.5 text-right text-slate-700 uppercase tracking-wide text-[11px]">
                                  Total Material Cost
                                </td>
                                <td className="p-2.5 text-right font-mono text-emerald-700 text-sm">
                                  {money(totalMaterialsAmount.toFixed(2))}
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </Card>
                  )}

                  {tab === 'Machine & Labour' && (
                    <Card className="overflow-hidden xl:col-span-2">
                      <div className="p-3 border-b bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-sm">Service Purchase Cost</h3>
                          <p className="text-[10px] text-slate-500">
                            Source: Service Purchase inward entries linked to this project or work order.
                          </p>
                        </div>
                        {report?.services && report.services.length > 0 && (
                          <Badge variant="success" className="font-mono text-xs font-semibold px-2 py-0.5">
                            Total Service: {money(totalServiceAmount.toFixed(2))}
                          </Badge>
                        )}
                      </div>
                      <div className="overflow-auto">
                        <table className="w-full min-w-[700px] text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-500">
                              <th className="p-2 text-left">Date</th>
                              <th className="p-2 text-left">Item / Service</th>
                              <th className="p-2 text-left">Source</th>
                              <th className="p-2 text-left">Inward / Request Ref</th>
                              <th className="p-2 text-right">Quantity</th>
                              <th className="p-2 text-center">Unit</th>
                              <th className="p-2 text-right">Rate</th>
                              <th className="p-2 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(report?.services || []).map((x) => (
                              <tr key={x.id} className="border-t hover:bg-slate-50/70">
                                <td className="p-2">{formatDate(x.date)}</td>
                                <td className="p-2 font-medium text-slate-800">{x.item}</td>
                                <td className="p-2">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                                    {x.type || 'Service'}
                                  </span>
                                </td>
                                <td className="p-2 font-mono text-[11px] text-slate-600">
                                  {x.reference || x.request_no}
                                </td>
                                <td className="p-2 text-right font-medium">{x.quantity}</td>
                                <td className="p-2 text-center text-slate-500">{x.unit || 'pcs'}</td>
                                <td className="p-2 text-right">{money(x.rate)}</td>
                                <td className="p-2 text-right font-semibold text-slate-900">{money(x.amount)}</td>
                              </tr>
                            ))}
                            {!report?.services?.length && (
                              <tr>
                                <td colSpan={8} className="p-8 text-center text-slate-500">
                                  No linked service purchase inward records.
                                </td>
                              </tr>
                            )}
                          </tbody>
                          {report?.services && report.services.length > 0 && (
                            <tfoot>
                              <tr className="border-t bg-slate-50/90 font-bold">
                                <td colSpan={7} className="p-2.5 text-right text-slate-700 uppercase tracking-wide text-[11px]">
                                  Total Service Cost
                                </td>
                                <td className="p-2.5 text-right font-mono text-emerald-700 text-sm">
                                  {money(totalServiceAmount.toFixed(2))}
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </Card>
                  )}

                  

                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

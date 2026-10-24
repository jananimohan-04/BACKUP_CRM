// Project Costing: the machine-cost and planned-cost rules, kept free of React so they can be tested.

/** Minutes between two timestamps (a run still open counts up to `now`); null when it cannot be worked out. */
export function spanMinutes(start: unknown, end: unknown, now: number = Date.now()): number | null {
  const st = start ? new Date(String(start)).getTime() : NaN;
  const en = end ? new Date(String(end)).getTime() : now;
  return Number.isFinite(st) && Number.isFinite(en) && en > st ? Math.round((en - st) / 60000) : null;
}

export interface ProcessRate { process_code?: string | null; process_name?: string | null; cost_per_hour?: number | string | null; cost_per_component?: number | string | null; setup_cost?: number | string | null }

export interface ValuedOperation {
  [k: string]: unknown;
  hours: number; rate: number; compSetup: number; cost: number; matched: boolean;
}

const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Machine cost of the in-house operations (job cards run in Scheduling / Production):
 *   hours = the logged minutes of the run (actual start to end) when there are any, else setup + qty x cycle time;
 *   cost  = hours x the process's cost per hour (Process Master) + cost per component + setup cost.
 * An operation whose name matches no Process Master process with a cost per hour is shown but not added to the total.
 */
export function valueOperations(ops: Record<string, unknown>[], procRates: ProcessRate[] | null | undefined): ValuedOperation[] {
  const byName = new Map<string, ProcessRate>();
  for (const p of procRates ?? []) if (norm(p.process_code)) byName.set(norm(p.process_code), p);
  for (const p of procRates ?? []) byName.set(norm(p.process_name), p);
  return (ops ?? []).map((x) => {
    const p = byName.get(norm(x.operation));
    const qty = Number(x.qty_completed) > 0 ? Number(x.qty_completed) : Number(x.qty_planned) || 0;
    const logged = Number(x.actual_minutes) || 0;
    const hours = Math.max(0, (logged > 0 ? logged : (Number(x.setup_time) || 0) + qty * (Number(x.cycle_time) || 0)) / 60);
    const rate = Number(p?.cost_per_hour) || 0;
    const compSetup = (Number(p?.cost_per_component) || 0) + (Number(p?.setup_cost) || 0);
    return { ...x, hours: Math.round(hours * 100) / 100, rate, compSetup, cost: hours * rate + compSetup, matched: !!p && rate > 0 };
  });
}

export const machineCostTotal = (ops: ValuedOperation[]) => ops.reduce((s, x) => s + (x.matched ? x.cost : 0), 0);

/**
 * A key for comparing a product name written differently in different places:
 * "MOUNT BLOCK - 23-10-2026 12:15", "MOUNT BLOCK - CITADEL COMPLETE - 23-10-2026 12:15" and "Mount Block" all give "mount block".
 */
export function quoteNameKey(name: unknown): string {
  let s = String(name ?? '').trim();
  s = s.replace(/\s*[-•·]\s*\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?/gi, '')
       .replace(/\s*[-•·]\s*\d{2}[A-Za-z]{3}\d{2}[-,]\s*\d{1,2}:?\d{2}(?:\s*[AP]M)?/gi, '')
       .replace(/\s*\(\s*\d+\s+products?\s*\)\s*$/i, '');
  return s.split(/\s+[-•·]\s+/)[0].trim().replace(/\s+/g, ' ').toLowerCase();
}

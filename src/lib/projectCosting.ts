// Project Costing: the machine-cost and planned-cost rules, kept free of React so they can be tested.

/** Minutes between two timestamps (a run still open counts up to `now`); null when it cannot be worked out. */
export function spanMinutes(start: unknown, end: unknown, now: number = Date.now()): number | null {
  const st = start ? new Date(String(start)).getTime() : NaN;
  const en = end ? new Date(String(end)).getTime() : now;
  return Number.isFinite(st) && Number.isFinite(en) && en > st ? Math.round((en - st) / 60000) : null;
}

export interface ProcessRate { process_code?: string | null; process_name?: string | null; cost_per_hour?: number | string | null; cost_per_component?: number | string | null; setup_cost?: number | string | null; machine_type?: string | null }

export interface ValuedOperation {
  [k: string]: unknown;
  hours: number; rate: number; compSetup: number; cost: number; matched: boolean;
}

export function matchProcessRate(procRates: ProcessRate[] | null | undefined, nameOrCode: unknown, machine?: unknown): ProcessRate | null {
  if (!nameOrCode && !machine) return null;
  const n = (s: unknown) => String(s ?? '').toLowerCase().trim().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ');
  const target = n(nameOrCode);
  const targetMach = n(machine);
  const list = procRates ?? [];

  if (target) {
    const f = list.find((p) => n(p.process_code) === target);
    if (f) return f;
  }
  if (target) {
    const f = list.find((p) => n(p.process_name) === target);
    if (f) return f;
  }
  if (target) {
    const f = list.find((p) => {
      const pn = n(p.process_name);
      return pn && (pn.includes(target) || target.includes(pn));
    });
    if (f) return f;
  }
  if (targetMach) {
    const f = list.find((p: any) => {
      const mt = n(p.machine_type);
      return mt && (mt === targetMach || mt.includes(targetMach) || targetMach.includes(mt));
    });
    if (f) return f;
  }
  return null;
}

/**
 * Machine cost of the in-house operations (job cards run in Scheduling / Production):
 *   hours = the logged minutes of the run (actual start to end) when there are any, else setup + qty x cycle time;
 *   cost  = hours x the process's cost per hour (Process Master) + cost per component + setup cost.
 * An operation whose name matches no Process Master process with a cost per hour is shown but not added to the total.
 */
export function valueOperations(ops: Record<string, unknown>[], procRates: ProcessRate[] | null | undefined): ValuedOperation[] {
  return (ops ?? []).map((x) => {
    const p = matchProcessRate(procRates, x.operation, x.machine);
    const qty = Number(x.qty_completed) > 0 ? Number(x.qty_completed) : Number(x.qty_planned) || 0;
    const logged = Number(x.actual_minutes) || 0;
    const hours = Math.max(0, (logged > 0 ? logged : (Number(x.setup_time) || 0) + qty * (Number(x.cycle_time) || 0)) / 60);
    const rate = Number(p?.cost_per_hour) || 0;
    const compSetup = (Number(p?.cost_per_component) || 0) + (Number(p?.setup_cost) || 0);
    return { ...x, hours: Math.round(hours * 100) / 100, rate, compSetup, cost: Math.round((hours * rate + compSetup) * 100) / 100, matched: !!p && rate > 0 };
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

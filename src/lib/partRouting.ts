// Part Routing shared logic: standard manufacturing sequence per product.
//
// A routing header (product + revision + status) owns sequenced steps.
// Exactly one revision is Active per product; work orders created from the
// Active revision stamp routing_id / routing_revision on their operations so
// later master edits never rewrite history.

import { supabase } from '@/lib/supabase';
import { hoursOf } from '@/lib/costingEngine';
import { isMissingRelation, num } from '@/lib/orderQuantities';

export const ROUTING_STATUSES = ['Draft', 'Active', 'Inactive'] as const;
export type RoutingStatus = (typeof ROUTING_STATUSES)[number];

export interface RoutingStep {
  id?: string;
  routing_id?: string;
  sequence: number;
  process_id: string | null;
  process_code: string;
  process_name: string;
  process_category: string;
  machine: string;
  setup_time: number;
  cycle_time: number;
  cost_per_hour: number;  // Machine Cost = Cost Per Hour × Hours
  standard_qty: number;
  instructions: string;
}

/** Estimated operation cost for a quantity — Machine Cost = Cost/Hour × Hours
 *  where Hours = (setup + qty × cycle) / 60 */
export function routingOpCost(step: Pick<RoutingStep, 'setup_time' | 'cycle_time' | 'cost_per_hour'>, qty: number): number {
  return hoursOf(num(step.setup_time), qty, num(step.cycle_time)) * num(step.cost_per_hour);
}

export function nextSequence(steps: { sequence: number }[]): number {
  if (!steps.length) return 10;
  return Math.max(...steps.map((s) => num(s.sequence))) + 10;
}

/** Active revision (highest wins) for a product code, with ordered steps.
 *  Returns null when nothing is active or the tables are not provisioned. */
export async function fetchActiveRouting(productCode: string): Promise<{ header: any; steps: any[] } | null> {
  const code = String(productCode ?? '').trim();
  if (!code) return null;
  try {
    const h = await supabase
      .from('cnc_part_routings')
      .select('*')
      .eq('product_code', code)
      .eq('status', 'Active')
      .order('revision', { ascending: false })
      .limit(1);
    if (h.error || !(h.data ?? []).length) return null;
    const header = h.data![0];
    const s = await supabase
      .from('cnc_part_routing_steps')
      .select('*')
      .eq('routing_id', header.id)
      .order('sequence');
    return { header, steps: s.error ? [] : (s.data ?? []) };
  } catch {
    return null;
  }
}

/** Strip keys the cloud schema predates, then insert (tolerant pre-migration). */
export async function insertTolerant(table: string, rows: Record<string, any>[]): Promise<void> {
  let pending = rows.map((r) => ({ ...r }));
  for (let attempt = 0; attempt < 6 && pending.length; attempt++) {
    const { error } = await supabase.from(table).insert(pending);
    if (!error) return;
    if (isMissingRelation(error)) throw error;
    const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(String((error as any)?.message || ''));
    if (m && pending.length && Object.prototype.hasOwnProperty.call(pending[0], m[1])) {
      pending = pending.map((r) => {
        const c = { ...r };
        delete c[m[1]];
        return c;
      });
      continue;
    }
    throw error;
  }
  if (pending.length) throw new Error(`Insert into ${table} failed after retries.`);
}

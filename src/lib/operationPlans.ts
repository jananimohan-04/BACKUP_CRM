// Planned timeline of work-order operations: a date range (from - to) and, for each date, its own time slots (several
// per day allowed, a day can also be off), expanded into one segment per date and slot. Dates are plain "YYYY-MM-DD" strings and times "HH:mm" (24-hour), never Date objects, so
// time zones cannot move a plan to another day.

export interface PlanSlot { start: string; end: string }
export interface PlanDraft {
  from: string;
  to: string;
  /** Timings of every date that has none of its own. */
  slots: PlanSlot[];
  /** Timings of particular dates (an empty list = that day is off). */
  days?: Record<string, PlanSlot[]>;
}
export interface PlanSegment { date: string; start: string; end: string }

export const MAX_PLAN_DAYS = 92;

export const emptyPlan = (): PlanDraft => ({ from: '', to: '', slots: [{ start: '08:00', end: '12:00' }] });
export const planIsBlank = (p?: PlanDraft | null) => !p || (!p.from && !p.to);

export const toMinutes = (hhmm: string): number => {
  const [h, m] = String(hhmm || '').split(':').map(n => Number(n));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/** Railway (24-hour) clock time, zero-padded: 08:00, 13:05, 23:59. */
export const fmtTime24 = (hhmm: string): string => {
  const mins = toMinutes(hhmm);
  const h = Math.floor(mins / 60) % 24; const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseYmd = (s: string): Date => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const addDays = (s: string, n: number): string => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const daysBetween = (from: string, to: string): number => Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86400000) + 1;

/** The time slots of one date of the plan. */
export const slotsFor = (p: PlanDraft, date: string): PlanSlot[] => p.days?.[date] ?? p.slots;

/** The dates from the plan's From to its To (empty when the range is not usable). */
export function planDates(p: PlanDraft): string[] {
  if (!p.from || !p.to || p.to < p.from || daysBetween(p.from, p.to) > MAX_PLAN_DAYS) return [];
  return Array.from({ length: daysBetween(p.from, p.to) }, (_, i) => addDays(p.from, i));
}

const slotsError = (slots: PlanSlot[]): string | null => {
  for (const s of slots) {
    if (!s.start || !s.end) return 'Set the start and end of every time slot.';
    if (toMinutes(s.end) <= toMinutes(s.start)) return 'Each time slot must end after it starts.';
  }
  const sorted = [...slots].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) return 'Time slots of the same date must not overlap.';
  }
  return null;
};

/** null when the plan is usable, else what is wrong with it. */
export function planError(p: PlanDraft): string | null {
  if (!p.from || !p.to) return 'Set the plan From and To dates.';
  if (p.to < p.from) return 'The To date must not be before the From date.';
  if (daysBetween(p.from, p.to) > MAX_PLAN_DAYS) return `A plan can cover at most ${MAX_PLAN_DAYS} days.`;
  let any = false;
  for (const d of planDates(p)) {
    const slots = slotsFor(p, d);
    const e = slotsError(slots);
    if (e) return `${d}: ${e}`;
    if (slots.length > 0) any = true;
  }
  return any ? null : 'Add at least one time slot on at least one date.';
}

/** One segment per date of the range and slot of that date. */
export function expandPlan(p: PlanDraft): PlanSegment[] {
  if (planError(p)) return [];
  const out: PlanSegment[] = [];
  for (const date of planDates(p)) for (const s of slotsFor(p, date)) out.push({ date, start: s.start, end: s.end });
  return out;
}

export const segmentHours = (s: { start: string; end: string }) => Math.max(0, toMinutes(s.end) - toMinutes(s.start)) / 60;
export const planHours = (p: PlanDraft) => expandPlan(p).reduce((n, s) => n + segmentHours(s), 0);

const hhmm = (t: unknown) => String(t ?? '').slice(0, 5);

/** Rows from the database back into an editable plan: the range from the first to the last planned date, each date with
 *  the slots it has (a date inside the range with none is off). */
export function planFromRows(rows: { plan_date: string; start_time: string; end_time: string }[]): PlanDraft {
  if (rows.length === 0) return emptyPlan();
  const byDate = new Map<string, PlanSlot[]>();
  for (const r of rows) {
    const d = String(r.plan_date).slice(0, 10);
    byDate.set(d, [...(byDate.get(d) ?? []), { start: hhmm(r.start_time), end: hhmm(r.end_time) }]);
  }
  const dates = [...byDate.keys()].sort();
  const sortSlots = (l: PlanSlot[]) => [...l].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const from = dates[0]; const to = dates[dates.length - 1];
  const template = sortSlots(byDate.get(from)!);
  const key = (l: PlanSlot[]) => sortSlots(l).map(x => `${x.start}-${x.end}`).join('|');
  const days: Record<string, PlanSlot[]> = {};
  for (let i = 0; i < daysBetween(from, to); i++) {
    const d = addDays(from, i);
    const slots = sortSlots(byDate.get(d) ?? []);
    if (key(slots) !== key(template)) days[d] = slots;
  }
  return { from, to, slots: template, days };
}

export const isMissingTable = (err: any) => {
  const m = String(err?.message ?? '');
  return err?.code === 'PGRST205' || err?.code === '42P01' || /cnc_operation_plans/.test(m) && /(not find|does not exist|schema cache)/i.test(m);
};

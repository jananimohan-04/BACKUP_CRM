import { Plus, Trash2 } from 'lucide-react';
import { inputClass } from '@/components/ui/Modal';
import { Time24 } from '@/components/ui/Time24';
import { expandPlan, parseYmd, planDates, planError, planHours, slotsFor, type PlanDraft, type PlanSlot } from '@/lib/operationPlans';

const label = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5';
const timeBox = 'inline-flex items-center rounded-lg border border-slate-300 bg-white text-sm';
const dayName = (d: string) => parseYmd(d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });

/** Plan an operation: the dates from - to at the top, then the timings of each particular date below (several slots a
 *  date allowed, e.g. 13:00 - 15:00 and again 17:00 - 18:00; a date can be left off). */
export function PlanEditor({ value, onChange, showSummary = true }: { value: PlanDraft; onChange: (p: PlanDraft) => void; showSummary?: boolean }) {
  const set = (patch: Partial<PlanDraft>) => onChange({ ...value, ...patch });
  const dates = planDates(value);
  const error = value.from || value.to ? planError(value) : null;

  const setDay = (date: string, slots: PlanSlot[]) => set({ days: { ...(value.days ?? {}), [date]: slots } });
  const setSlot = (date: string, i: number, patch: Partial<PlanSlot>) => setDay(date, slotsFor(value, date).map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addSlot = (date: string) => {
    const cur = slotsFor(value, date);
    const last = cur[cur.length - 1];
    const startH = last ? Math.min(22, Number(last.end.split(':')[0]) + 1) : 8;
    setDay(date, [...cur, { start: `${String(startH).padStart(2, '0')}:00`, end: `${String(Math.min(23, startH + 1)).padStart(2, '0')}:00` }]);
  };
  // Every date gets these timings.
  const applyToAll = (slots: PlanSlot[]) => set({ slots: slots.map(s => ({ ...s })), days: {} });

  const workingDays = dates.filter(d => slotsFor(value, d).length > 0).length;

  return (
    <div className="space-y-3" data-testid="plan-editor">
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div>
          <span className={label}>From date</span>
          <input type="date" aria-label="Plan from date" className={inputClass} value={value.from}
            onChange={e => set({ from: e.target.value, to: value.to && value.to < e.target.value ? e.target.value : (value.to || e.target.value) })} />
        </div>
        <div>
          <span className={label}>To date</span>
          <input type="date" aria-label="Plan to date" className={inputClass} value={value.to} min={value.from || undefined} onChange={e => set({ to: e.target.value })} />
        </div>
      </div>

      <div>
        <span className={label}>Timings for each date</span>
        {dates.length === 0 ? (
          <p className="text-xs text-slate-400">Choose the From and To dates, then set the timings of each date here.</p>
        ) : (
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-auto bg-white">
            {dates.map(date => {
              const slots = slotsFor(value, date);
              return (
                <div key={date} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2" data-testid="plan-date-row" data-date={date}>
                  <div className="w-24 shrink-0 pt-2 text-xs font-semibold text-slate-700">{dayName(date)}</div>
                  <div className="flex-1 min-w-[18rem] space-y-1.5">
                    {slots.length === 0 && <p className="pt-2 text-xs text-slate-400">Day off — no timing</p>}
                    {slots.map((s, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2" data-testid="plan-slot">
                        <div className={timeBox}><Time24 label={`${date} slot ${i + 1} from`} value={s.start} onChange={v => setSlot(date, i, { start: v })} /></div>
                        <span className="text-xs text-slate-500">to</span>
                        <div className={timeBox}><Time24 label={`${date} slot ${i + 1} to`} value={s.end} onChange={v => setSlot(date, i, { end: v })} /></div>
                        <button type="button" aria-label={`Remove slot ${i + 1} on ${date}`} title="Remove" onClick={() => setDay(date, slots.filter((_, j) => j !== i))}
                          className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col items-end gap-1 pt-1.5 text-xs">
                    <button type="button" onClick={() => addSlot(date)} className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-800"><Plus size={13} /> Add time slot</button>
                    {dates.length > 1 && slots.length > 0 && (
                      <button type="button" onClick={() => applyToAll(slots)} className="font-semibold text-slate-500 hover:text-slate-800 hover:underline">Same for all dates</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
      {showSummary && !error && dates.length > 0 && (
        <p className="text-xs text-slate-500" data-testid="plan-summary">
          {workingDays} working date{workingDays === 1 ? '' : 's'} of {dates.length} · {expandPlan(value).length} planned slots · {Math.round(planHours(value) * 100) / 100} hours in all
        </p>
      )}
    </div>
  );
}

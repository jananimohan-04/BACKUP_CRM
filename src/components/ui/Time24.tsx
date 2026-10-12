import React from 'react';

/**
 * 24-hour (railway) time entry: hour 00-23 and minute, with no AM/PM switch.
 * Value in and out is still "HH:mm", exactly like <input type="time">, so the plan
 * slots, run times and job schedules stored behind it are untouched — only the control
 * the user picks with has changed.
 */
export function Time24({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [hh, mm] = (value || '08:00').split(':').map(n => Number(n) || 0);
  const emitHour = (h: number) => onChange(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  const emitMinute = (m: number) => onChange(`${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  const sel = 'bg-transparent py-2 focus:outline-none cursor-pointer';
  return (
    <div className="flex items-center gap-0.5 px-2" role="group" aria-label={label}>
      <select aria-label={`${label} hour`} className={sel} value={hh} onChange={e => emitHour(Number(e.target.value))}>
        {Array.from({ length: 24 }, (_, i) => i).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
      </select>
      <span className="text-slate-400">:</span>
      <select aria-label={`${label} minute`} className={sel} value={mm} onChange={e => emitMinute(Number(e.target.value))}>
        {Array.from({ length: 60 }, (_, i) => i).map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
      </select>
    </div>
  );
}

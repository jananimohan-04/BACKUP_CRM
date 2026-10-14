import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge, Button } from '@/components/ui/Card';
import { addDays, fmtTime24, parseYmd, ymd } from '@/lib/operationPlans';

// Calendar used by the Comparison page: a week / day grid with blocks placed by date and time, side-by-side lanes
// inside a day (planned | actual), a current-time line, and the same navigation as the Planned timeline.

export const HOUR_PX = 44;
export const MACHINE_PALETTE = [
  'bg-blue-100 border-blue-500 text-blue-950 hover:bg-blue-200/80',
  'bg-emerald-100 border-emerald-500 text-emerald-950 hover:bg-emerald-200/80',
  'bg-amber-100 border-amber-500 text-amber-950 hover:bg-amber-200/80',
  'bg-purple-100 border-purple-500 text-purple-950 hover:bg-purple-200/80',
  'bg-rose-100 border-rose-500 text-rose-950 hover:bg-rose-200/80',
  'bg-cyan-100 border-cyan-500 text-cyan-950 hover:bg-cyan-200/80',
  'bg-orange-100 border-orange-500 text-orange-950 hover:bg-orange-200/80',
  'bg-indigo-100 border-indigo-500 text-indigo-950 hover:bg-indigo-200/80',
  'bg-teal-100 border-teal-500 text-teal-950 hover:bg-teal-200/80',
  'bg-fuchsia-100 border-fuchsia-500 text-fuchsia-950 hover:bg-fuchsia-200/80',
  'bg-lime-100 border-lime-600 text-lime-950 hover:bg-lime-200/80',
  'bg-pink-100 border-pink-500 text-pink-950 hover:bg-pink-200/80',
  'bg-sky-100 border-sky-500 text-sky-950 hover:bg-sky-200/80',
  'bg-violet-100 border-violet-500 text-violet-950 hover:bg-violet-200/80',
];

export const colorForMachine = (machine: string, machineList: string[] = []) => {
  const clean = (machine || '').trim().toUpperCase();
  if (!clean) return 'bg-slate-100 border-slate-400 text-slate-800';
  const idx = machineList.findIndex(m => m.trim().toUpperCase() === clean);
  if (idx >= 0) return MACHINE_PALETTE[idx % MACHINE_PALETTE.length];
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  return MACHINE_PALETTE[Math.abs(hash) % MACHINE_PALETTE.length];
};

export const PALETTE = MACHINE_PALETTE;
export const colorFor = (key: string) => colorForMachine(key);
export const dayLabel = (s: string) => parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
export const minToHhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export interface GridBlock {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  /** 0-based lane within the day and how many lanes there are (planned | actual). */
  lane?: number;
  lanes?: number;
  className: string;
  title: string;
  lines: string[];
  /** Dashed, lighter look (the plan shown beside what ran). */
  ghost?: boolean;
  ring?: boolean;
  onClick?: () => void;
}

export function useCalendarNav() {
  const [view, setView] = useState<'Week' | 'Day'>('Week');
  const [anchor, setAnchor] = useState(ymd(new Date()));
  const days = useMemo(() => {
    if (view === 'Day') return [anchor];
    const dow = parseYmd(anchor).getDay();
    const monday = addDays(anchor, dow === 0 ? -6 : 1 - dow);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [view, anchor]);
  const step = (n: number) => setAnchor(a => addDays(a, view === 'Week' ? n * 7 : n));
  const title = view === 'Day' ? dayLabel(days[0]) : `${dayLabel(days[0])} – ${dayLabel(days[6])}`;
  return { view, setView, anchor, setAnchor, days, step, title };
}

export function CalendarNav({ nav, onToday, loading }: { nav: ReturnType<typeof useCalendarNav>; onToday: () => void; loading?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center bg-white rounded-lg border border-slate-200">
        <button aria-label="Previous" className="p-2 text-slate-600 hover:bg-slate-50 border-r border-slate-200" onClick={() => nav.step(-1)}><ChevronLeft size={16} /></button>
        <div className="px-4 py-1.5 text-sm font-medium text-slate-700 min-w-[210px] text-center">{nav.title}</div>
        <button aria-label="Next" className="p-2 text-slate-600 hover:bg-slate-50 border-l border-slate-200" onClick={() => nav.step(1)}><ChevronRight size={16} /></button>
      </div>
      <Button variant="secondary" className="bg-white" onClick={onToday}>Today</Button>
      <div className="flex bg-white rounded-lg border border-slate-200 p-1">
        {(['Week', 'Day'] as const).map(v => (
          <button key={v} onClick={() => nav.setView(v)} className={`px-3 py-1 text-sm font-medium rounded-md ${nav.view === v ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{v}</button>
        ))}
      </div>
      {loading && <Badge variant="neutral">Loading…</Badge>}
    </div>
  );
}

const SNAP = 30; // minutes
const snap = (min: number) => Math.max(0, Math.min(24 * 60, Math.round(min / SNAP) * SNAP));

export function TimelineGrid({ days, blocks, testId = 'timeline-grid', onDragRange }: {
  days: string[]; blocks: GridBlock[]; testId?: string;
  /** Drag on an empty part of a day to pick a time range (a plain click picks one hour). */
  onDragRange?: (r: { date: string; start: string; end: string }) => void;
}) {
  const [drag, setDrag] = useState<{ date: string; a: number; b: number } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const yToMin = (e: React.MouseEvent, el: HTMLElement) => snap(((e.clientY - el.getBoundingClientRect().top) / HOUR_PX) * 60);
  const endDrag = useCallback(() => {
    const d = dragRef.current; dragRef.current = null; setDrag(null);
    if (!d || !onDragRange) return;
    let a = Math.min(d.a, d.b); let b = Math.max(d.a, d.b);
    if (b - a < SNAP) b = Math.min(24 * 60, a + 60);
    if (b > 24 * 60 - 1) { b = 24 * 60 - 1; a = Math.min(a, b - SNAP); }
    onDragRange({ date: d.date, start: minToHhmm(a), end: minToHhmm(b) });
  }, [onDragRange]);
  useEffect(() => {
    if (!onDragRange) return;
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [endDrag, onDragRange]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  const today = ymd(new Date());
  useEffect(() => {
    const t = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()); }, 60000);
    return () => clearInterval(t);
  }, []);
  const toNow = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    const d = new Date(); el.scrollTop = Math.max(0, ((d.getHours() * 60 + d.getMinutes()) / 60 - 2) * HOUR_PX);
  }, []);
  useEffect(() => { toNow(); }, [toNow]);

  return (
    <div ref={scrollRef} className="bg-white rounded-xl border border-slate-200 overflow-auto max-h-[68vh]" data-testid={testId}>
      <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="sticky top-0 z-20 bg-white border-b border-slate-200" />
        {days.map(d => (
          <div key={d} className={`sticky top-0 z-20 border-b border-l border-slate-200 px-2 py-2 text-center text-xs font-semibold ${d === today ? 'bg-blue-50 text-blue-700' : 'bg-white text-slate-600'}`}>{dayLabel(d)}</div>
        ))}
        <div className="relative" style={{ height: 24 * HOUR_PX }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="absolute right-2 -translate-y-2 text-[10px] text-slate-400" style={{ top: h * HOUR_PX }}>{h === 0 ? '' : fmtTime24(`${h}:00`)}</div>
          ))}
        </div>
        {days.map(d => (
          <div key={d} className={`relative border-l border-slate-200 ${onDragRange ? 'cursor-crosshair select-none' : ''}`} style={{ height: 24 * HOUR_PX }} data-testid="tl-day" data-date={d}
            onMouseDown={e => { if (!onDragRange || (e.target as HTMLElement).closest('[data-testid="tl-block"]')) return; const m = yToMin(e, e.currentTarget); const v = { date: d, a: m, b: m }; dragRef.current = v; setDrag(v); }}
            onMouseMove={e => { if (!dragRef.current || dragRef.current.date !== d) return; const v = { ...dragRef.current, b: yToMin(e, e.currentTarget) }; dragRef.current = v; setDrag(v); }}>
            {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: h * HOUR_PX }} />)}
            {drag && drag.date === d && (
              <div className="absolute left-0.5 right-0.5 rounded-md border-2 border-dashed border-brand-500 bg-brand-100/60 pointer-events-none z-10" data-testid="tl-drag"
                style={{ top: (Math.min(drag.a, drag.b) / 60) * HOUR_PX, height: Math.max(SNAP, Math.abs(drag.b - drag.a)) / 60 * HOUR_PX }}>
                <span className="text-[10px] font-bold text-brand-700 px-1">{fmtTime24(minToHhmm(Math.min(drag.a, drag.b)))} – {fmtTime24(minToHhmm(Math.min(24 * 60 - 1, Math.max(Math.max(drag.a, drag.b), Math.min(drag.a, drag.b) + SNAP))))}</span>
              </div>
            )}
            {d === today && <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: (nowMin / 60) * HOUR_PX }}><div className="h-0.5 bg-red-500" /><div className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" /></div>}
            {blocks.filter(b => b.date === d).map(b => {
              const lanes = b.lanes ?? 1; const lane = b.lane ?? 0;
              const top = (b.startMin / 60) * HOUR_PX;
              const height = Math.max(18, ((b.endMin - b.startMin) / 60) * HOUR_PX - 2);
              return (
                <button key={b.id} type="button" data-testid="tl-block" data-lane={lane} title={b.title} onClick={b.onClick}
                  className={`absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-[10px] leading-tight shadow-sm hover:brightness-95 ${b.className} ${b.ghost ? 'opacity-60 border-dashed' : ''} ${b.ring ? 'ring-2 ring-red-500' : ''}`}
                  style={{ top, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}>
                  {b.lines.map((l, i) => <div key={i} className={i === 0 ? 'font-bold truncate' : 'truncate'}>{l}</div>)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

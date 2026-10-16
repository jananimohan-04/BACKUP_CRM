import { useState } from 'react';
import { useDateRange } from '@/contexts/DateRangeContext';
import { PRESET_LABELS, displayDay, presetRange, type DatePreset } from '@/lib/globalDate';

// Compact popup opened from the Topbar date/time display. Same ERP styling as the
// other header dropdowns; deliberately small (no full-screen modal).
export function GlobalDateFilterPopup({ onClose }: { onClose: () => void }) {
  const { from, to, preset, setCustomRange, applyPreset, reset } = useDateRange();
  const [draftFrom, setDraftFrom] = useState(from ?? '');
  const [draftTo, setDraftTo] = useState(to ?? '');
  const [draftPreset, setDraftPreset] = useState<DatePreset>(preset);
  const [error, setError] = useState('');

  const pickPreset = (key: DatePreset) => {
    setDraftPreset(key);
    setError('');
    if (key === 'custom') return;
    const r = presetRange(key);
    setDraftFrom(r.from ?? '');
    setDraftTo(r.to ?? '');
  };

  const apply = () => {
    if (draftFrom && draftTo && draftFrom > draftTo) {
      setError('From date cannot be after To date.');
      return;
    }
    if (draftPreset !== 'custom') {
      applyPreset(draftPreset);
    } else if (!setCustomRange(draftFrom || null, draftTo || null)) {
      setError('From date cannot be after To date.');
      return;
    }
    onClose();
  };

  return (
    <div className="w-[320px] rounded-xl border border-slate-200 bg-white shadow-2xl animate-scale-in overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Filter by Date</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {from || to ? `${displayDay(from)} → ${displayDay(to)}` : 'Showing all time'}
        </p>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">From Date</span>
            <input
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(e) => { setDraftFrom(e.target.value); setDraftPreset('custom'); setError(''); }}
              className="w-full px-2 py-1.5 text-xs font-medium border border-slate-200 rounded-lg focus:outline-none focus:border-brand-500"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">To Date</span>
            <input
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(e) => { setDraftTo(e.target.value); setDraftPreset('custom'); setError(''); }}
              className="w-full px-2 py-1.5 text-xs font-medium border border-slate-200 rounded-lg focus:outline-none focus:border-brand-500"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESET_LABELS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pickPreset(p.key)}
              className={`px-2 py-1.5 text-[11px] font-bold rounded-lg border transition-colors ${
                draftPreset === p.key
                  ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {error && <p className="text-[11px] font-semibold text-red-600">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => { reset(); onClose(); }}
            className="flex-1 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex-1 py-2 text-xs font-bold uppercase tracking-wider text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors shadow-sm"
          >
            Apply Filter
          </button>
        </div>
      </div>
    </div>
  );
}

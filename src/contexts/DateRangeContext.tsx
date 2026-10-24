import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  ALL_TIME_START,
  inGlobalRange,
  presetRange,
  todayISO,
  type DatePreset,
} from '@/lib/globalDate';

// ERP-wide date-range filter. Default is All Time (no filtering), so every page
// behaves exactly as before until the user picks a range in the Topbar calendar.
// The selection lives at the app root, so it stays active while navigating.

export interface GlobalDateFilter {
  /** Inclusive YYYY-MM-DD bounds; null = unbounded (All Time). */
  from: string | null;
  to: string | null;
  preset: DatePreset;
  isAllTime: boolean;
  /**
   * Concrete bounds for legacy consumers (Dashboard money queries, old DateSelector).
   * All Time maps to a wide range covering every record.
   */
  dateRange: { start: string; end: string };
  /** Legacy setter (Dashboard DateSelector shape). Empty start/end clears to All Time. */
  setDateRange: (range: { start: string; end: string }) => void;
  /** Custom From/To pair. Returns false (and keeps the old range) when from > to. */
  setCustomRange: (from: string | null, to: string | null) => boolean;
  applyPreset: (preset: Exclude<DatePreset, 'custom'>) => void;
  reset: () => void;
  /** Inclusive check of one date-like value against the active range. */
  inRange: (dateLike: unknown) => boolean;
}

const GlobalDateContext = createContext<GlobalDateFilter | null>(null);

const STORAGE_KEY = 'erp.globalDateFilter';

// The date range is not remembered: a refresh (or a new visit) always starts at All Time, so old rows are never hidden by a forgotten filter.
function loadInitial(): { from: string | null; to: string | null; preset: DatePreset } {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return { from: null, to: null, preset: 'all' };
}

export const DateRangeProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState(loadInitial);

  const persist = (next: { from: string | null; to: string | null; preset: DatePreset }) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode etc: the filter still works for this session.
    }
  };

  const setCustomRange = useCallback(
    (from: string | null, to: string | null): boolean => {
      const f = from || null;
      const t = to || null;
      if (f && t && f > t) return false;
      if (!f && !t) persist({ from: null, to: null, preset: 'all' });
      else persist({ from: f, to: t, preset: 'custom' });
      return true;
    },
    [],
  );

  const applyPreset = useCallback((preset: Exclude<DatePreset, 'custom'>) => {
    const { from, to } = presetRange(preset);
    persist({ from, to, preset });
  }, []);

  const reset = useCallback(() => {
    persist({ from: null, to: null, preset: 'all' });
  }, []);

  const setDateRange = useCallback(
    (range: { start: string; end: string }) => {
      const s = (range.start || '').slice(0, 10) || null;
      const e = (range.end || '').slice(0, 10) || null;
      setCustomRange(s, e);
    },
    [setCustomRange],
  );

  const value = useMemo<GlobalDateFilter>(() => {
    const { from, to, preset } = state;
    const isAllTime = !from && !to;
    const today = todayISO();
    return {
      from,
      to,
      preset,
      isAllTime,
      dateRange: { start: from ?? ALL_TIME_START, end: to ?? today },
      setDateRange,
      setCustomRange,
      applyPreset,
      reset,
      inRange: (dateLike: unknown) => inGlobalRange(dateLike, from, to),
    };
  }, [state, setDateRange, setCustomRange, applyPreset, reset]);

  return <GlobalDateContext.Provider value={value}>{children}</GlobalDateContext.Provider>;
};

export const useDateRange = (): GlobalDateFilter => {
  const ctx = useContext(GlobalDateContext);
  if (!ctx) throw new Error('useDateRange must be used within DateRangeProvider');
  return ctx;
};

/** Alias with the feature's name; identical hook. */
export const useGlobalDateFilter = useDateRange;

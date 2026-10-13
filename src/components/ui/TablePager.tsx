import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Shared paging for list tables: a "Show N per page" choice (remembered across pages and visits),
// the "Showing a–b of n" text and previous / next buttons. Pair it with the `erp-table` class on the
// <table> (index.css) for the dark header.

export const PAGE_SIZES = [10, 15, 25, 50, 100];
const SIZE_KEY = 'argus.table.pageSize';
const DEFAULT_SIZE = 15;

const loadSize = (): number => {
  try { const n = Number(localStorage.getItem(SIZE_KEY)); return PAGE_SIZES.includes(n) ? n : DEFAULT_SIZE; } catch { return DEFAULT_SIZE; }
};

export interface Pager<T> {
  pageItems: T[];
  /** Zero-based index of the first row on this page (for row numbers). */
  start: number;
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  setPage: (n: number) => void;
  setPageSize: (n: number) => void;
}

/** Slices `items` into the current page. Goes back to page 1 when `resetKey` changes (filters, search…). */
export function usePager<T>(items: T[], resetKey: unknown = ''): Pager<T> {
  const [pageSize, setSize] = useState(loadSize);
  const [page, setPageRaw] = useState(1);
  useEffect(() => { setPageRaw(1); }, [resetKey, pageSize]);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  const pageItems = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);
  const setPageSize = (n: number) => {
    setSize(n);
    try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* storage unavailable: the size just resets next visit */ }
  };
  return { pageItems, start, total: items.length, page: current, pages, pageSize, setPage: setPageRaw, setPageSize };
}

export function PagerFooter<T>({ pager, sticky = false, label = 'records' }: { pager: Pager<T>; sticky?: boolean; label?: string }) {
  if (pager.total === 0) return null;
  const { start, pageSize, total, page, pages } = pager;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 ${sticky ? 'sticky bottom-0 z-10' : ''}`}>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 font-semibold">
        <label className="flex items-center gap-2 font-medium text-slate-500">Show
          <select aria-label="Rows per page" value={pageSize} onChange={e => pager.setPageSize(Number(e.target.value))}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700">
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          per page
        </label>
        <span>Showing {start + 1}–{Math.min(start + pageSize, total)} of {total} {label}</span>
      </span>
      <div className="flex items-center gap-3">
        <button aria-label="Previous page" disabled={page === 1} onClick={() => pager.setPage(page - 1)} className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={16} /></button>
        <span className="font-semibold">{page} / {pages}</span>
        <button aria-label="Next page" disabled={page === pages} onClick={() => pager.setPage(page + 1)} className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

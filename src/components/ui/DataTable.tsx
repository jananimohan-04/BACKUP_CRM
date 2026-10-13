import { useState, useMemo, type ReactNode } from 'react';
import { ChevronUp, ChevronDown, Search, Download, SlidersHorizontal, Plus } from 'lucide-react';
import { Button } from './Card';
import { PagerFooter, usePager } from './TablePager';

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

function getPath(row: any, key: string): any {
  if (row == null) return undefined;
  if (key in row) return row[key];
  return key.split('.').reduce((acc: any, part) => (acc == null ? undefined : acc[part]), row);
}

function rowMatches(row: Record<string, any>, q: string, keys?: string[]): boolean {
  if (keys && keys.length > 0) {
    return keys.some((k) => String(getPath(row, k) ?? '').toLowerCase().includes(q));
  }
  // No searchKeys supplied: search every string/number field (one level of nesting).
  return Object.values(row ?? {}).some((v) => {
    if (typeof v === 'string' || typeof v === 'number') return String(v).toLowerCase().includes(q);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.values(v).some(
        (inner) => (typeof inner === 'string' || typeof inner === 'number') && String(inner).toLowerCase().includes(q)
      );
    }
    return false;
  });
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  searchKeys,
  title,
  onAdd,
  addLabel,
  onRowClick,
  filterOptions,
  emptyMessage = 'No records found',
  toolbarDate,
  toolbarLeft,
  inlineAdd = false,
}: {
  data: T[];
  columns: Column<T>[];
  searchKeys?: string[];
  title?: string;
  onAdd?: () => void;
  addLabel?: string;
  onRowClick?: (row: T) => void;
  filterOptions?: { label: string; value: string }[];
  emptyMessage?: string;
  /** Extra control rendered in the toolbar row right after search (e.g. a date picker). */
  toolbarDate?: ReactNode;
  /** Extra content rendered at the START of the toolbar row, before search
   *  (e.g. view tabs when this table is embedded under another toolbar). */
  toolbarLeft?: ReactNode;
  /** When true, the Add button moves into the toolbar row (after the status
   *  filter, before Export) instead of the top header row. */
  inlineAdd?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [filterValue, setFilterValue] = useState('all');

  const filtered = useMemo(() => {
    let result = [...(data ?? [])];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((row) => rowMatches(row, q, searchKeys));
    }
    if (filterValue !== 'all' && filterOptions) {
      result = result.filter((row) =>
        String(row['status'] || row['Status'] || '').toLowerCase() === filterValue.toLowerCase()
      );
    }
    if (sortKey) {
      result.sort((a, b) => {
        const av = getPath(a, sortKey);
        const bv = getPath(b, sortKey);
        if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
        return sortDir === 'asc'
          ? String(av ?? '').localeCompare(String(bv ?? ''))
          : String(bv ?? '').localeCompare(String(av ?? ''));
      });
    }
    return result;
  }, [data, search, sortKey, sortDir, filterValue, filterOptions, searchKeys]);

  const pager = usePager(filtered, `${search}|${filterValue}`);
  const paginated = pager.pageItems;

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleExport = () => {
    if (filtered.length === 0) return;
    
    // Create CSV header
    const keys = Object.keys(filtered[0]).filter(k => k !== 'id'); // skip raw id if present
    const csvContent = [
      keys.join(','),
      ...filtered.map(row => keys.map(k => {
        const val = row[k];
        if (val === null || val === undefined) return '';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${title ? title.toLowerCase().replace(/\s+/g, '_') : 'export'}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      {(title || (onAdd && !inlineAdd)) && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-sm font-bold text-slate-800 tracking-wider uppercase">{title}</h3>
          {onAdd && !inlineAdd && (
            <Button size="sm" onClick={onAdd} icon={<span className="text-base leading-none font-bold">+</span>}>
              {addLabel || 'Add New'}
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-slate-100 bg-white">
        {toolbarLeft}
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search records..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all placeholder:text-slate-400"
          />
        </div>
        {toolbarDate}
        {filterOptions && (
          <div className="relative">
            <SlidersHorizontal size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select
              value={filterValue}
              onChange={(e) => {
                setFilterValue(e.target.value);
                }}
              className="pl-9 pr-8 py-2 text-sm font-medium rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all appearance-none cursor-pointer"
            >
              <option value="all">All Status</option>
              {filterOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {inlineAdd && onAdd && (
          <Button size="sm" onClick={onAdd} icon={<Plus size={14} />}>
            {addLabel || 'Add New'}
          </Button>
        )}
        <button onClick={handleExport} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold tracking-wide text-slate-600 hover:text-brand-700 bg-white hover:bg-brand-50 rounded-md transition-colors border border-slate-200 hover:border-brand-200 shadow-sm">
          <Download size={14} />
          EXPORT
        </button>
      </div>
      <div className="overflow-x-auto scrollbar-thin flex-1">
        <table className="erp-table w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={`px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  }`}
                >
                  {col.sortable ? (
                    <button
                      onClick={() => handleSort(col.key)}
                      className="inline-flex items-center gap-1.5 hover:text-brand-600 transition-colors focus:outline-none"
                    >
                      {col.label}
                      {sortKey === col.key ? (
                        sortDir === 'asc' ? <ChevronUp size={14} className="text-brand-500" /> : <ChevronDown size={14} className="text-brand-500" />
                      ) : (
                        <span className="text-slate-300 group-hover:text-slate-400 transition-colors"><ChevronUp size={14} /></span>
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center bg-slate-50/50">
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <Search size={32} className="text-slate-300 opacity-50" />
                    <p className="text-sm font-medium">{emptyMessage}</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginated.map((row, idx) => (
                <tr
                  key={idx}
                  onClick={() => onRowClick?.(row)}
                  className={`hover:bg-slate-50 transition-colors group ${
                    onRowClick ? 'cursor-pointer' : ''
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-2 text-slate-700 ${
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                      }`}
                    >
                      {col.render ? col.render(row) : String(getPath(row, col.key) ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <PagerFooter pager={pager} />
    </div>
  );
}

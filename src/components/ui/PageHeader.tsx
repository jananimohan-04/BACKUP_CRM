import type { ReactNode } from 'react';
import { useState, useRef, useEffect } from 'react';
import { useDateRange } from '@/contexts/DateRangeContext';
import { Calendar, Download, Filter, Bell } from 'lucide-react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
      <div>
        <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DateSelector() {
  const { from, to, isAllTime, setCustomRange, reset } = useDateRange();
  const [isOpen, setIsOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [error, setError] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef]);

  useEffect(() => {
    if (isOpen) {
      setDraftFrom(from ?? '');
      setDraftTo(to ?? '');
      setError('');
    }
  }, [isOpen, from, to]);

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  let dateStr = 'All Time';
  if (!isAllTime && from && to) {
    const endYear = new Date(to).getFullYear();
    dateStr = `${formatDate(from)} - ${formatDate(to)}`;
    if (!isNaN(endYear)) dateStr += `, ${endYear}`;
  } else if (!isAllTime) {
    dateStr = 'Custom range';
  }

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <div onClick={() => setIsOpen(!isOpen)} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors">
        <Calendar size={15} className="text-slate-400" />
        <span className="text-slate-600 font-medium">{dateStr}</span>
      </div>

      {isOpen && (
        <div className="absolute right-0 mt-2 p-4 bg-white border border-slate-200 shadow-xl rounded-xl z-[100] flex flex-col gap-3 w-72">
          <h4 className="text-xs font-bold text-slate-500 uppercase">Select Date Range</h4>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-600 font-medium">Start Date</label>
            <input type="date" value={draftFrom} onChange={e => setDraftFrom(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-brand-500" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-600 font-medium">End Date</label>
            <input type="date" value={draftTo} onChange={e => setDraftTo(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-brand-500" />
          </div>
          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
          <div className="flex items-center gap-2 mt-2">
             <button onClick={() => { reset(); setIsOpen(false); }} className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-200">All Time</button>
             <button onClick={() => {
               if (draftFrom && draftTo && draftFrom > draftTo) { setError('From date cannot be after To date.'); return; }
               if (setCustomRange(draftFrom || null, draftTo || null)) setIsOpen(false);
               else setError('From date cannot be after To date.');
             }} className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm font-bold hover:bg-brand-700">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FilterButton() {
  return (
    <button className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 bg-white">
      <Filter size={14} />
      Filter
    </button>
  );
}

export function ExportButton() {
  return (
    <button className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 bg-white">
      <Download size={14} />
      Export
    </button>
  );
}

export function NotificationBadge({ count }: { count: number }) {
  return (
    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
      {count}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && (
        <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <p className="text-sm text-slate-400 mt-1 max-w-sm">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-3 border-slate-200 border-t-brand-500 rounded-full animate-spin" style={{ borderWidth: '3px' }} />
        <p className="text-sm text-slate-400">{message}</p>
      </div>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-500">
          <Bell size={20} />
        </div>
        <p className="text-sm text-slate-500">{message}</p>
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

import React, { useState, useMemo } from 'react';
import { Search, Download, Upload, Eye, Edit2, Trash2 } from 'lucide-react';
import { PagerFooter, usePager } from '@/components/ui/TablePager';
import { CompanyFilterInput } from '@/components/ui/CompanyFilterInput';
import { KanbanCard } from './SalesPipelinePage';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { recordDateOf } from '@/lib/globalDate';
import { exportCsv } from '@/lib/reportExport';
import { formatTimestamp } from '@/lib/format';
import { todayISO } from '@/lib/format';

interface PipelineListViewProps {
  cards: KanbanCard[];
  onView: (card: KanbanCard) => void;
  onEdit?: (card: KanbanCard) => void;
  onDelete?: (card: KanbanCard) => void;
}


export function PipelineListView({ cards, onView, onEdit, onDelete }: PipelineListViewProps) {
  const { companyFilter, setCompanyFilter, companyOptions } = useHeaderKpis();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('All');

  const customers = useMemo(() => {
    const set = new Set<string>();
    cards.forEach(c => {
      const cust = (c.customer || '').trim();
      if (cust) set.add(cust);
    });
    companyOptions.forEach(c => {
      if (c && c !== 'All Companies') set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [cards, companyOptions]);

  // Pipeline stages, labelled exactly like the summary cards above the list.
  const STAGE_LABELS: Record<string, string> = {
    'Enquiry': 'Total Enquiries',
    'Quotation': 'Quotations',
    'Sales Order': 'Sales Orders',
    'Inward': 'Inward',
    'Finished Goods': 'Finished Goods',
    'DC': 'Delivery Challans',
    'Invoice': 'Invoices',
  };
  const stageOf = (c: KanbanCard) => STAGE_LABELS[c.stage] || c.stage;
  const stageOptions = ['Total Enquiries', 'Quotations', 'Sales Orders', 'Inward', 'Finished Goods', 'Delivery Challans', 'Invoices']
    .filter(label => cards.some(c => stageOf(c) === label));

  const { from: globalFrom, to: globalTo, inRange: inDateRange } = useGlobalDateFilter();
  const cardDate = (c: KanbanCard): string | null =>
    recordDateOf({ date: (c as any).date, ...((c as any).raw ?? {}) } as Record<string, unknown>,
      ['date', 'invoice_date', 'delivery_date', 'inward_date', 'order_date', 'received_date', 'created_at']);
  const filteredCards = cards.filter(c => {
    const matchesSearch = !search ||
      (c.refNo || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.customer || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.part || '').toLowerCase().includes(search.toLowerCase());

    const matchesCustomer = !companyFilter || companyFilter === 'All Companies' ||
      (c.customer || '').trim().toLowerCase() === companyFilter.trim().toLowerCase();
    const matchesStage = stageFilter === 'All' || stageOf(c) === stageFilter;
    const matchesDate = inDateRange(cardDate(c));

    return matchesSearch && matchesCustomer && matchesStage && matchesDate;
  });

  const sortedCards = useMemo(() => {
    return [...filteredCards].sort((a, b) => {
      const bTime = new Date((b.raw as any)?.created_at || cardDate(b) || 0).getTime();
      const aTime = new Date((a.raw as any)?.created_at || cardDate(a) || 0).getTime();
      if (bTime !== aTime) return bTime - aTime;
      return (b.refNo || '').localeCompare(a.refNo || '', undefined, { numeric: true });
    });
  }, [filteredCards]);

  const pager = usePager(sortedCards, `${search}|${companyFilter}|${stageFilter}|${globalFrom}|${globalTo}`);
  const { pageCards, start } = { pageCards: pager.pageItems, start: pager.start };

  const handleExport = () => {
    exportCsv(`Sales_Pipeline_${todayISO()}`, [
      ['#', 'Reference No', 'Date', 'Company', 'Products', 'Stage', 'Qty', 'Remarks'],
      ...filteredCards.map((card, i) => [
        i + 1,
        card.refNo || '',
        card.date || '',
        card.customer || '',
        card.part || '',
        stageOf(card) || '',
        card.qty ?? '',
        card.raw?.remarks || card.raw?.internal_remarks || '',
      ]),
    ]);
  };

  return (
    <div className="flex flex-col">
      <div className="pb-2 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search enquiries, parts..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-brand-500"
          />
        </div>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} className="border border-slate-300 rounded-lg text-sm px-3 py-1.5 focus:outline-none focus:border-brand-500 bg-white">
          <option value="All">All Stages</option>
          {stageOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <button onClick={handleExport} className="p-2 border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" title="Export CSV">
          <Upload className="w-4 h-4" />
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-white text-[13px] font-bold uppercase tracking-wider">
              <th className="bg-slate-800 px-4 py-3.5 w-12">#</th>
              <th className="bg-slate-800 px-4 py-3.5">Timestamp</th>
              <th className="bg-slate-800 px-4 py-3.5">Ref No</th>
              <th className="bg-slate-800 px-4 py-3.5">
                <div className="flex items-center gap-1.5 flex-nowrap">
                  <span className="whitespace-nowrap">Company</span>
                  <CompanyFilterInput
                    value={companyFilter || 'All Companies'}
                    onChange={setCompanyFilter}
                    options={customers}
                  />
                </div>
              </th>
              <th className="bg-slate-800 px-4 py-3.5">Products</th>
              <th className="bg-slate-800 px-4 py-3.5">
                <div className="flex items-center gap-1.5 flex-nowrap">
                  <span className="whitespace-nowrap">Stage</span>
                  <select
                    aria-label="Filter by Stage"
                    title="Filter by Stage"
                    value={stageFilter}
                    onChange={e => setStageFilter(e.target.value)}
                    className="text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[110px] truncate shadow-xs"
                  >
                    <option value="All">All</option>
                    {stageOptions.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </th>
              <th className="bg-slate-800 px-4 py-3.5 text-right">Qty</th>
              <th className="bg-slate-800 px-4 py-3.5">Remarks</th>
              <th className="bg-slate-800 px-4 py-3.5 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageCards.map((card, index) => (
              <tr key={card.id} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/60 hover:bg-brand-50/50 transition-colors">
                <td className="px-4 py-1.5 text-sm text-slate-400">{start + index + 1}</td>
                <td className="px-4 py-1.5 text-sm text-slate-600 whitespace-nowrap font-mono">{formatTimestamp((card.raw as any)?.created_at || card.date)}</td>
                <td className="px-4 py-1.5 text-[15px] font-bold text-brand-600 cursor-pointer hover:underline" onClick={() => onView(card)}>{card.refNo}</td>
                <td className="px-4 py-1.5 text-[15px] font-semibold text-slate-800">{card.customer}</td>
                <td className="px-4 py-1.5 text-sm text-slate-700 max-w-[220px] truncate" title={card.part}>{card.part}</td>
                <td className="px-4 py-1.5 whitespace-nowrap"><span className="inline-block rounded-full bg-brand-50 text-brand-700 border border-brand-100 px-2.5 py-0.5 text-xs font-semibold">{stageOf(card)}</span>{card.history && <span title={`Left the board${card.status ? ` (${card.status})` : ''}`} className="ml-1.5 inline-block rounded-full bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 text-[10px] font-semibold">{card.status || 'Old'}</span>}</td>
                <td className="px-4 py-1.5 text-[15px] text-slate-800 text-right font-bold">{card.qty}</td>
                <td className="px-4 py-1.5 text-xs text-slate-500 max-w-[160px] truncate">{card.raw?.remarks || card.raw?.internal_remarks || '-'}</td>
                <td className="px-4 py-1.5">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => onView(card)} className="p-1.5 rounded-md text-slate-500 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="View" aria-label={`View ${card.refNo}`}>
                      <Eye className="w-[18px] h-[18px]" />
                    </button>
                    {onEdit && (
                      <button onClick={() => onEdit(card)} className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Edit" aria-label={`Edit ${card.refNo}`}>
                        <Edit2 className="w-[18px] h-[18px]" />
                      </button>
                    )}
                    {onDelete && (
                      <button onClick={() => onDelete(card)} className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete" aria-label={`Delete ${card.refNo}`}>
                        <Trash2 className="w-[18px] h-[18px]" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredCards.length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-500">
                  No records found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PagerFooter pager={pager} sticky />
    </div>
  );
}

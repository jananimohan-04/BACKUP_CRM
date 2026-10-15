import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Play, Printer, TrendingUp } from 'lucide-react';
import { PageHeader, EmptyState, LoadingState } from '@/components/ui/PageHeader';
import { Button, Card } from '@/components/ui/Card';
import { FormField, inputClass } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { accountingApi, childrenMap, type FinancialYear, type ProfitAndLoss, type ReportRow } from '@/lib/accounting';
import { formatDate, formatINR, formatPercent, todayISO, toPaise } from '@/lib/format';
import { exportCsv, printHtml, escapeHtml } from '@/lib/reportExport';

// Profit & Loss statement for a period. Amounts and totals are calculated by the database.

const EMPTY_MESSAGE = 'No accounting data available for the selected period.';
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isZeroAmt = (v: string) => toPaise(v) === 0n;

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 mb-4 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function defaultTo(fy: FinancialYear): string {
  const today = todayISO();
  if (today > fy.end_date) return fy.end_date;
  if (today < fy.start_date) return fy.start_date;
  return today;
}

const money = (v: string) => formatINR(v, { negative: 'parentheses' });

type Section = { key: 'INCOME' | 'EXPENSE'; title: string; total: string };

/** Visible rows of one section in tree order. */
function flatten(rows: ReportRow[], collapsed: Set<string>, hideZero: boolean) {
  const kids = childrenMap(rows);
  const ids = new Set(rows.map(r => r.id));
  const out: { row: ReportRow; depth: number; hasChildren: boolean }[] = [];
  const walk = (list: ReportRow[], depth: number) => {
    list.forEach(r => {
      if (hideZero && isZeroAmt(r.amount)) return;
      const children = kids.get(r.id) ?? [];
      out.push({ row: r, depth, hasChildren: children.some(c => !hideZero || !isZeroAmt(c.amount)) });
      if (!collapsed.has(r.id)) walk(children, depth + 1);
    });
  };
  // Roots: rows whose parent is not in this section.
  walk(rows.filter(r => !r.parent_id || !ids.has(r.parent_id)), 0);
  return out;
}

export function ProfitLossPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { company } = useAuth();
  const companyId = company?.id ?? null;
  const urlFrom = searchParams.get('from') ?? '';
  const urlTo = searchParams.get('to') ?? '';

  const [years, setYears] = useState<FinancialYear[]>([]);
  const [fyId, setFyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<ProfitAndLoss | null>(null);
  const [loadingYears, setLoadingYears] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hideZero, setHideZero] = useState(true);

  const generate = useCallback(async (f: string, t: string) => {
    if (!f || !t || f > t) { setError('Choose a valid period (From must be on or before To)'); return; }
    setLoading(true);
    setError(null);
    try {
      setReport(await accountingApi.profitAndLoss(f, t));
    } catch (e) {
      setReport(null);
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoadingYears(true);
    setError(null);
    setReport(null);
    accountingApi.financialYears()
      .then(res => {
        if (cancelled) return;
        setYears(res.years);
        const anchor = urlTo || urlFrom;
        const fy = (anchor && res.years.find(y => y.start_date <= anchor && anchor <= y.end_date))
          || res.years.find(y => y.is_current) || res.years[0];
        const f = urlFrom || fy?.start_date || '';
        const t = urlTo || (fy ? defaultTo(fy) : '');
        setFyId(fy?.id ?? '');
        setFrom(f);
        setTo(t);
        if (f && t) generate(f, t);
      })
      .catch(e => { if (!cancelled) setError(errorText(e)); })
      .finally(() => { if (!cancelled) setLoadingYears(false); });
    return () => { cancelled = true; };
  }, [companyId, urlFrom, urlTo, generate]);

  const changeYear = useCallback((id: string) => {
    setFyId(id);
    const fy = years.find(y => y.id === id);
    if (!fy) return;
    const t = defaultTo(fy);
    setFrom(fy.start_date);
    setTo(t);
    generate(fy.start_date, t);
  }, [years, generate]);

  const sections: Section[] = report ? [
    { key: 'INCOME', title: 'Income', total: report.totals.income },
    { key: 'EXPENSE', title: 'Expenses', total: report.totals.expenses },
  ] : [];

  const hasData = !!report && (report.rows.some(r => !isZeroAmt(r.amount)) || !isZeroAmt(report.totals.income) || !isZeroAmt(report.totals.expenses));
  const netNegative = report ? toPaise(report.totals.net_profit) < 0n : false;

  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const openLedger = (r: ReportRow) => {
    if (!report || r.is_group) return;
    navigate(`/accounts/ledger?tab=ledger&account=${r.id}&from=${report.from}&to=${report.to}`);
  };

  const handleCsv = () => {
    if (!report) return;
    const out: unknown[][] = [
      ['Company', report.company],
      ['Period', formatDate(report.from), formatDate(report.to)],
      [],
    ];
    sections.forEach(s => {
      out.push([s.title.toUpperCase(), '', '', '']);
      out.push(['Code', 'Account', 'Amount', `% of total ${s.title.toLowerCase()}`]);
      flatten(report.rows.filter(r => r.account_type === s.key), new Set(), false)
        .forEach(({ row, depth }) => out.push([row.code, `${'  '.repeat(depth)}${row.name}`, row.amount, formatPercent(row.amount, s.total)]));
      out.push(['', `Total ${s.title}`, s.total, '']);
      out.push([]);
    });
    out.push(['', netNegative ? 'Net Loss' : 'Net Profit', report.totals.net_profit, '']);
    exportCsv(`Profit_and_Loss_${report.from}_${report.to}`, out);
  };

  const handlePrint = () => {
    if (!report) return;
    const panel = (s: Section) => {
      const rows = flatten(report.rows.filter(r => r.account_type === s.key), new Set(), hideZero)
        .map(({ row, depth }) => `<tr class="${row.is_group ? 'group' : ''}"><td style="padding-left:${8 + depth * 14}px">${escapeHtml(row.name)}</td>
          <td class="num">${escapeHtml(money(row.amount))}</td><td class="num">${escapeHtml(formatPercent(row.amount, s.total))}</td></tr>`).join('');
      return `<div><table><thead><tr><th>${escapeHtml(s.title)}</th><th class="num">Amount</th><th class="num">%</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="3">${escapeHtml(EMPTY_MESSAGE)}</td></tr>`}
        <tr class="total"><td>Total ${escapeHtml(s.title)}</td><td class="num">${escapeHtml(money(s.total))}</td><td class="num"></td></tr></tbody></table></div>`;
    };
    printHtml(`Profit and Loss ${report.from} to ${report.to}`, `
      <div class="brand"><div><h1>Profit &amp; Loss Statement</h1>
      <div class="meta">${escapeHtml(report.company)} · ${escapeHtml(formatDate(report.from))} to ${escapeHtml(formatDate(report.to))}</div></div></div>
      <div class="cols">${sections.map(panel).join('')}</div>
      <table><tbody>
        <tr><td>Total Income</td><td class="num">${escapeHtml(money(report.totals.income))}</td></tr>
        <tr><td>Total Expenses</td><td class="num">${escapeHtml(money(report.totals.expenses))}</td></tr>
        <tr class="total"><td>${netNegative ? 'Net Loss' : 'Net Profit'}</td><td class="num ${netNegative ? 'warn' : ''}">${escapeHtml(money(report.totals.net_profit))}</td></tr>
      </tbody></table>
      <div class="note">Generated ${escapeHtml(new Date().toLocaleString('en-IN', { hour12: false }))}</div>`);
  };

  const sectionRows = useMemo(() => {
    const map: Record<string, ReturnType<typeof flatten>> = {};
    if (report) (['INCOME', 'EXPENSE'] as const).forEach(k => { map[k] = flatten(report.rows.filter(r => r.account_type === k), collapsed, hideZero); });
    return map;
  }, [report, collapsed, hideZero]);

  const csvRef = useRef<() => void>(() => {});
  const printRef = useRef<() => void>(() => {});
  csvRef.current = handleCsv;
  printRef.current = handlePrint;
  const hasReport = !!report;

  const { setHeader, setTabActions, setHeaderCenter } = useHeaderKpis();
  useEffect(() => {
    setHeader({ title: 'Profit & Loss' });
    setHeaderCenter(
      <div className="flex items-center gap-2">
        <select
          aria-label="Financial Year"
          title="Financial Year"
          className="h-7 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400"
          value={fyId}
          onChange={e => changeYear(e.target.value)}
          disabled={loadingYears || years.length === 0}
        >
          {!years.some(y => y.id === fyId) && <option value="">—</option>}
          {years.map(y => <option key={y.id} value={y.id}>{y.name}{y.status === 'Closed' ? ' (closed)' : ''}</option>)}
        </select>
        <input
          type="date"
          aria-label="From"
          title="From"
          className="h-7 px-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400"
          value={from}
          onChange={e => setFrom(e.target.value)}
        />
        <input
          type="date"
          aria-label="To"
          title="To"
          className="h-7 px-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400"
          value={to}
          onChange={e => setTo(e.target.value)}
        />
        <button
          type="button"
          onClick={() => generate(from, to)}
          disabled={loading || loadingYears}
          className="h-7 px-2.5 text-xs font-bold text-white bg-gradient-to-b from-orange-500 to-orange-600 hover:from-orange-500 hover:to-orange-700 rounded-md shadow-sm flex items-center gap-1 active:scale-[0.98] transition disabled:opacity-40 cursor-pointer"
        >
          <Play size={11} className="fill-white" />
          <span>Generate</span>
        </button>
        <label className="inline-flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={e => setHideZero(e.target.checked)}
            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span>Hide zero</span>
        </label>
      </div>
    );
    setTabActions(
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={14} />}
          onClick={() => csvRef.current()}
          disabled={!hasReport}
          className="h-7 py-1 text-xs px-2.5 shadow-sm"
        >
          CSV
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Printer size={14} />}
          onClick={() => printRef.current()}
          disabled={!hasReport}
          className="h-7 py-1 text-xs px-2.5 shadow-sm"
        >
          Print
        </Button>
      </div>
    );
    return () => {
      setHeader(null);
      setHeaderCenter(null);
      setTabActions(null);
    };
  }, [setHeader, setHeaderCenter, setTabActions, hasReport, fyId, changeYear, loadingYears, years, from, to, generate, loading, hideZero]);

  if (!company) {
    return (
      <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full">
        <PageHeader title="Profit & Loss" description="Income and expenses for a period." />
        <Card><EmptyState icon={<TrendingUp size={28} />} title="No company selected" message="Select a company in the top bar to view its accounts." /></Card>
      </div>
    );
  }

  return (
    <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full">
      <div className="lg:hidden bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2 mb-3">
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-thin [&>*]:shrink-0">
          <h1 className="text-base font-bold text-slate-800 whitespace-nowrap">Profit & Loss</h1>
          <select aria-label="Financial Year" title="Financial Year" className={`${inputClass} !h-9 !text-xs !w-36`} value={fyId} onChange={e => changeYear(e.target.value)} disabled={loadingYears || years.length === 0}>
            {!years.some(y => y.id === fyId) && <option value="">—</option>}
            {years.map(y => <option key={y.id} value={y.id}>{y.name}{y.status === 'Closed' ? ' (closed)' : ''}</option>)}
          </select>
          <input type="date" aria-label="From" title="From" className={`${inputClass} !h-9 !text-xs !w-32`} value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" aria-label="To" title="To" className={`${inputClass} !h-9 !text-xs !w-32`} value={to} onChange={e => setTo(e.target.value)} />
          <Button icon={<Play size={14} />} onClick={() => generate(from, to)} disabled={loading || loadingYears}>Generate</Button>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
            <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            Hide zero balances
          </label>
          <span className="ml-auto flex gap-2 shrink-0">
            <Button variant="secondary" icon={<Download size={14} />} onClick={handleCsv} disabled={!report}>CSV</Button>
            <Button variant="secondary" icon={<Printer size={14} />} onClick={handlePrint} disabled={!report}>Print</Button>
          </span>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading || loadingYears ? (
        <Card><LoadingState message="Calculating profit & loss…" /></Card>
      ) : !report || !hasData ? (
        <Card><EmptyState icon={<TrendingUp size={28} />} title="Profit & Loss" message={error && !report ? 'The report could not be generated.' : EMPTY_MESSAGE} /></Card>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-3">{report.company} · {formatDate(report.from)} to {formatDate(report.to)}</p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
            {sections.map(s => (
              <Card key={s.key} className="overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600">{s.title}</h3>
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200">
                    <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-left">Account</th>
                    <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Amount</th>
                    <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right w-20">%</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(sectionRows[s.key] ?? []).length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">{EMPTY_MESSAGE}</td></tr>
                    ) : (sectionRows[s.key] ?? []).map(({ row, depth, hasChildren }) => (
                      <tr key={row.id} onClick={() => openLedger(row)}
                        className={`${row.is_group ? 'bg-slate-50/50' : 'hover:bg-orange-50/40 cursor-pointer'}`}
                        title={row.is_group ? undefined : 'Open ledger'}>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
                            {hasChildren ? (
                              <button onClick={e => { e.stopPropagation(); toggle(row.id); }} className="p-0.5 text-slate-400 hover:text-slate-700">
                                {collapsed.has(row.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                              </button>
                            ) : <span className="w-[18px]" />}
                            <span className={row.is_group ? 'font-semibold text-slate-800' : 'text-slate-700'}>{row.name}</span>
                            {row.code && <span className="font-mono text-[10px] text-slate-400 ml-1">{row.code}</span>}
                          </div>
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${row.is_group ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>{money(row.amount)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">{formatPercent(row.amount, s.total)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-300 bg-orange-50/60 font-bold">
                      <td className="px-4 py-2.5">Total {s.title}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{money(s.total)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </Card>
            ))}
          </div>

          <Card className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total Income</p>
                <p className="text-xl font-bold text-slate-800 tabular-nums mt-1">{money(report.totals.income)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total Expenses</p>
                <p className="text-xl font-bold text-slate-800 tabular-nums mt-1">{money(report.totals.expenses)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Net Profit / (Loss)</p>
                <p className={`text-xl font-bold tabular-nums mt-1 ${netNegative ? 'text-red-600' : 'text-green-700'}`}>{money(report.totals.net_profit)}</p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

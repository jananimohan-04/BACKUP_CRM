import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, Play, Printer, Scale } from 'lucide-react';
import { PageHeader, EmptyState, LoadingState } from '@/components/ui/PageHeader';
import { Badge, Button, Card } from '@/components/ui/Card';
import { FormField, inputClass } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { accountingApi, type FinancialYear, type TrialBalance } from '@/lib/accounting';
import { formatDate, formatINR, todayISO, toPaise } from '@/lib/format';
import { exportCsv, printHtml, escapeHtml } from '@/lib/reportExport';

// Trial balance: closing debit / credit of every ledger account, calculated by the database.

const EMPTY_MESSAGE = 'No accounting data available for the selected period.';
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 mb-4 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** Default as-on date for a year: today, kept inside the year. */
function defaultAsOf(fy: FinancialYear): string {
  const today = todayISO();
  if (today > fy.end_date) return fy.end_date;
  if (today < fy.start_date) return fy.start_date;
  return today;
}

const thClass = 'px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-left whitespace-nowrap';
const thNum = 'px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right whitespace-nowrap';
const tdClass = 'px-4 py-2.5 text-slate-700';
const tdNum = 'px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-slate-700';
const blankIfZero = (v: string) => (toPaise(v) === 0n ? '' : formatINR(v));

export function TrialBalancePage() {
  const navigate = useNavigate();
  const { company } = useAuth();
  const companyId = company?.id ?? null;

  const [years, setYears] = useState<FinancialYear[]>([]);
  const [fyId, setFyId] = useState('');
  const [asOf, setAsOf] = useState('');
  const [report, setReport] = useState<TrialBalance | null>(null);
  const [loadingYears, setLoadingYears] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (yearId: string, date: string, list: FinancialYear[]) => {
    const fy = list.find(y => y.id === yearId);
    if (!fy) { setError('Choose a financial year'); return; }
    if (!date || date < fy.start_date || date > fy.end_date) {
      setError(`The as-on date must fall within ${fy.name} (${formatDate(fy.start_date)} to ${formatDate(fy.end_date)})`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReport(await accountingApi.trialBalance(yearId, date));
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
        const fy = res.years.find(y => y.is_current) ?? res.years[0];
        if (fy) {
          const date = defaultAsOf(fy);
          setFyId(fy.id);
          setAsOf(date);
          generate(fy.id, date, res.years);
        }
      })
      .catch(e => { if (!cancelled) setError(errorText(e)); })
      .finally(() => { if (!cancelled) setLoadingYears(false); });
    return () => { cancelled = true; };
  }, [companyId, generate]);

  const changeYear = useCallback((id: string) => {
    const fy = years.find(y => y.id === id);
    setFyId(id);
    if (!fy) return;
    const date = defaultAsOf(fy);
    setAsOf(date);
    generate(id, date, years);
  }, [years, generate]);

  const balanced = report ? toPaise(report.totals.debit) === toPaise(report.totals.credit) : false;
  const difference = report ? toPaise(report.totals.debit) - toPaise(report.totals.credit) : 0n;

  const handleCsv = () => {
    if (!report) return;
    exportCsv(`Trial_Balance_${report.as_of}`, [
      ['Company', report.company],
      ['Financial year', report.financial_year.name],
      ['As on', formatDate(report.as_of)],
      [],
      ['Code', 'Account', 'Type', 'Debit', 'Credit'],
      ...report.rows.map(r => [r.code, r.name, r.account_type, r.debit, r.credit]),
      ['', 'Total', '', report.totals.debit, report.totals.credit],
    ]);
  };

  const handlePrint = () => {
    if (!report) return;
    const rows = report.rows.map(r => `<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.account_type)}</td>
      <td class="num">${escapeHtml(blankIfZero(r.debit))}</td><td class="num">${escapeHtml(blankIfZero(r.credit))}</td></tr>`).join('');
    printHtml(`Trial Balance ${report.as_of}`, `
      <div class="brand"><div><h1>Trial Balance</h1>
      <div class="meta">${escapeHtml(report.company)} · ${escapeHtml(report.financial_year.name)} · as on ${escapeHtml(formatDate(report.as_of))}</div></div>
      <div class="${balanced ? 'ok' : 'warn'}">${balanced ? 'Balanced' : 'Trial balance does not match'}</div></div>
      <table><thead><tr><th>Code</th><th>Account</th><th>Type</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">${escapeHtml(EMPTY_MESSAGE)}</td></tr>`}
      <tr class="total"><td colspan="3">Total</td><td class="num">${escapeHtml(formatINR(report.totals.debit))}</td><td class="num">${escapeHtml(formatINR(report.totals.credit))}</td></tr></tbody></table>
      <div class="note">Generated ${escapeHtml(new Date().toLocaleString('en-IN', { hour12: false }))}</div>`);
  };

  const csvRef = useRef<() => void>(() => {});
  const printRef = useRef<() => void>(() => {});
  csvRef.current = handleCsv;
  printRef.current = handlePrint;
  const hasReport = !!report;

  const fy = years.find(y => y.id === fyId);

  const { setHeader, setTabActions, setHeaderCenter } = useHeaderKpis();
  useEffect(() => {
    setHeader({ title: 'Trial Balance' });
    setHeaderCenter(
      <div className="flex items-center gap-2">
        <select
          aria-label="Financial Year"
          className="h-7 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400"
          value={fyId}
          onChange={e => changeYear(e.target.value)}
          disabled={loadingYears || years.length === 0}
        >
          {years.length === 0 && <option value="">—</option>}
          {years.map(y => <option key={y.id} value={y.id}>{y.name}{y.status === 'Closed' ? ' (closed)' : ''}</option>)}
        </select>
        <input
          aria-label="As on date"
          type="date"
          className="h-7 px-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400"
          value={asOf}
          min={fy?.start_date}
          max={fy?.end_date}
          onChange={e => setAsOf(e.target.value)}
        />
        <button
          type="button"
          onClick={() => generate(fyId, asOf, years)}
          disabled={loading || loadingYears || !fyId}
          className="h-7 px-2.5 text-xs font-bold text-white bg-gradient-to-b from-orange-500 to-orange-600 hover:from-orange-500 hover:to-orange-700 rounded-md shadow-sm flex items-center gap-1 active:scale-[0.98] transition disabled:opacity-40 cursor-pointer"
        >
          <Play size={11} className="fill-white" />
          <span>Generate</span>
        </button>
        {fy && <span className="text-[11px] text-slate-400 hidden xl:inline font-medium">({formatDate(fy.start_date)} – {formatDate(fy.end_date)})</span>}
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
  }, [setHeader, setHeaderCenter, setTabActions, hasReport, fyId, changeYear, loadingYears, years, asOf, fy, generate, loading]);

  if (!company) {
    return (
      <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full">
        <PageHeader title="Trial Balance" description="Closing debit and credit balance of every account." />
        <Card><EmptyState icon={<Scale size={28} />} title="No company selected" message="Select a company in the top bar to view its accounts." /></Card>
      </div>
    );
  }

  return (
    <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full">
      <div className="lg:hidden">
        <PageHeader
          title="Trial Balance"
          description={`Closing debit and credit balance of every account of ${company.company_name}.`}
          actions={<>
            <Button variant="secondary" icon={<Download size={14} />} onClick={handleCsv} disabled={!report}>CSV</Button>
            <Button variant="secondary" icon={<Printer size={14} />} onClick={handlePrint} disabled={!report}>Print</Button>
          </>}
        />
        <Card className="p-3 sm:px-4 sm:py-2.5 mb-3">
          <div className="flex flex-nowrap items-end gap-3 overflow-x-auto min-w-0">
            <div className="w-52 shrink-0">
              <FormField label="Financial Year">
                <select className={`${inputClass} !h-8 text-xs`} value={fyId} onChange={e => changeYear(e.target.value)} disabled={loadingYears || years.length === 0}>
                  {years.length === 0 && <option value="">—</option>}
                  {years.map(y => <option key={y.id} value={y.id}>{y.name}{y.status === 'Closed' ? ' (closed)' : ''}</option>)}
                </select>
              </FormField>
            </div>
            <div className="w-40 shrink-0">
              <FormField label="As on">
                <input type="date" className={`${inputClass} !h-8 text-xs`} value={asOf} min={fy?.start_date} max={fy?.end_date} onChange={e => setAsOf(e.target.value)} />
              </FormField>
            </div>
            <Button size="sm" className="!h-8 text-xs px-3 shadow-sm shrink-0" icon={<Play size={13} />} onClick={() => generate(fyId, asOf, years)} disabled={loading || loadingYears || !fyId}>Generate</Button>
            {fy && <p className="text-xs text-slate-500 pb-1.5 whitespace-nowrap shrink-0">{formatDate(fy.start_date)} – {formatDate(fy.end_date)}</p>}
          </div>
        </Card>
      </div>

      {error && <ErrorBanner message={error} />}

      <Card className="overflow-hidden">
        {loading || loadingYears ? (
          <LoadingState message="Calculating trial balance…" />
        ) : !report ? (
          <EmptyState icon={<Scale size={28} />} title="Trial balance" message={error ? 'The report could not be generated.' : EMPTY_MESSAGE} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Trial Balance as on {formatDate(report.as_of)}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{report.company} · {report.financial_year.name}</p>
              </div>
              {balanced ? (
                <Badge variant="success"><CheckCircle2 size={12} /> Balanced</Badge>
              ) : (
                <Badge variant="error"><AlertTriangle size={12} /> Trial balance does not match (difference {formatINR(differenceText(difference))})</Badge>
              )}
            </div>
            {report.rows.length === 0 ? (
              <EmptyState icon={<Scale size={28} />} title="No balances" message={EMPTY_MESSAGE} />
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 bg-slate-50">
                    <th className={thClass}>Code</th><th className={thClass}>Account</th><th className={thClass}>Type</th>
                    <th className={thNum}>Debit</th><th className={thNum}>Credit</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.rows.map(r => (
                      <tr key={r.id} onClick={() => navigate(`/accounts/ledger?tab=ledger&account=${r.id}&to=${report.as_of}`)}
                        className="hover:bg-slate-50 cursor-pointer" title="Open ledger">
                        <td className={`${tdClass} font-mono text-xs`}>{r.code}</td>
                        <td className={`${tdClass} text-brand-700`}>{r.name}</td>
                        <td className={tdClass}><span className="text-xs text-slate-600">{r.account_type}</span></td>
                        <td className={tdNum}>{blankIfZero(r.debit)}</td>
                        <td className={tdNum}>{blankIfZero(r.credit)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-300 bg-orange-50/60 font-bold">
                      <td className={tdClass} colSpan={3}>Total</td>
                      <td className={tdNum}>{formatINR(report.totals.debit)}</td>
                      <td className={tdNum}>{formatINR(report.totals.credit)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/** Absolute difference (paise) as an exact decimal string. */
function differenceText(p: bigint): string {
  const a = p < 0n ? -p : p;
  return `${(a / 100n).toString()}.${(a % 100n).toString().padStart(2, '0')}`;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, LayoutList, BookOpen, ChevronDown, ChevronRight, Download, Upload, Edit, ExternalLink, FileText, ListTree, Lock, Plus,
  Printer, Search, Trash2, X,
} from 'lucide-react';
import { EmptyState, LoadingState } from '@/components/ui/PageHeader';
import { Badge, Button, Card } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { LedgerDashboardPage } from '@/pages/finance/LedgerDashboardPage';
import {
  accountingApi, childrenMap, SOURCE_LABELS, SOURCE_ROUTES,
  type Account, type AccountType, type FinancialYearsResponse, type JournalEntry, type Ledger, type VoucherType,
} from '@/lib/accounting';
import { formatDate, formatINR, todayISO, toPaise } from '@/lib/format';
import { exportCsv, printHtml, escapeHtml } from '@/lib/reportExport';

// ---------------------------------------------------------------------------------------
// Ledger, vouchers and chart of accounts. Every figure is calculated by the database
// (accountingApi); this page only formats and displays it.
// ---------------------------------------------------------------------------------------

type Tab = 'dashboard' | 'ledger' | 'vouchers' | 'accounts';
const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'dashboard', label: 'Ledger Dashboard', icon: LayoutList },
  { id: 'accounts', label: 'Chart of Accounts', icon: ListTree },
];

const MANUAL_VOUCHER_TYPES: VoucherType[] = ['Journal', 'Receipt', 'Payment', 'Contra', 'Opening'];
const EMPTY_MESSAGE = 'No accounting data available for the selected period.';
const AMOUNT_RE = /^\d{0,13}(\.\d{0,2})?$/;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-2 mb-4 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      {onClose && <button onClick={onClose} className="text-red-400 hover:text-red-600"><X size={14} /></button>}
    </div>
  );
}

const thClass = 'px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-left whitespace-nowrap';
const thNum = 'px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right whitespace-nowrap';
const tdClass = 'px-4 py-2.5 text-slate-700';
const tdNum = 'px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-slate-700';

/** Balance with its side: a positive balance is on the account's natural side. */
function balanceSide(value: string, type: AccountType): { abs: string; side: 'Dr' | 'Cr' | '' } {
  const p = toPaise(value);
  const naturalDr = type === 'ASSET' || type === 'EXPENSE';
  const abs = String(value).trim().replace(/^-/, '');
  if (p === 0n) return { abs, side: '' };
  const dr = p > 0n ? naturalDr : !naturalDr;
  return { abs, side: dr ? 'Dr' : 'Cr' };
}

function formatBalance(value: string, type: AccountType): string {
  const { abs, side } = balanceSide(value, type);
  return side ? `${formatINR(abs)} ${side}` : formatINR(abs);
}

/** Integer paise → exact decimal string ("1234.50"). */
function paiseToAmount(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? '-' : ''}${(a / 100n).toString()}.${(a % 100n).toString().padStart(2, '0')}`;
}

/** Start of the financial year that contains `date`. */
function fyStartFor(date: string, fyr: FinancialYearsResponse): string {
  const year = fyr.years.find(y => y.start_date <= date && date <= y.end_date);
  if (year) return year.start_date;
  const month = fyr.company.fy_start_month;
  const [yy, mm] = date.split('-').map(Number);
  const startYear = mm < month ? yy - 1 : yy;
  return `${startYear}-${String(month).padStart(2, '0')}-01`;
}

/** Chart of accounts in tree order with depth. */
function flattenAccounts(accounts: Account[], collapsed?: Set<string>) {
  const kids = childrenMap(accounts);
  const out: { account: Account; depth: number; hasChildren: boolean }[] = [];
  const walk = (parent: string | null, depth: number) => {
    (kids.get(parent) ?? []).forEach(a => {
      const hasChildren = (kids.get(a.id)?.length ?? 0) > 0;
      out.push({ account: a, depth, hasChildren });
      if (!collapsed?.has(a.id)) walk(a.id, depth + 1);
    });
  };
  walk(null, 0);
  return out;
}

const indent = (depth: number) => '   '.repeat(depth);

// ======================================================================================
// Page
// ======================================================================================

export function LedgerPage() {
  const { company, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  // The party Ledger Dashboard is the first tab and opens by default.
  const tab: Tab = rawTab === 'vouchers' || rawTab === 'accounts' || rawTab === 'ledger' ? rawTab : searchParams.get('account') ? 'ledger' : 'dashboard';

  const [fyr, setFyr] = useState<FinancialYearsResponse | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voucherId, setVoucherId] = useState<string | null>(null);
  const companyId = company?.id ?? null;
  const isAdmin = profile?.role === 'COMPANY_ADMIN' || profile?.role === 'SUPER_ADMIN';

  const reloadAccounts = useCallback(async () => {
    try {
      setAccounts(await accountingApi.chartOfAccounts());
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFyr(null);
    Promise.all([accountingApi.financialYears(), accountingApi.chartOfAccounts()])
      .then(([years, coa]) => {
        if (cancelled) return;
        setFyr(years);
        setAccounts(coa);
      })
      .catch(e => { if (!cancelled) setError(errorText(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  const { setHeader, setTabs } = useHeaderKpis();
  useEffect(() => {
    setHeader({ title: 'Ledger & Vouchers' });
    const headerTabs: { label: string; active: boolean; onClick: () => void }[] = [];
    if (tab === 'ledger' || tab === 'vouchers') {
      headerTabs.push({
        label: '← Back to Dashboard',
        active: false,
        onClick: () => setTab('dashboard'),
      });
    }
    TABS.forEach(t => {
      headerTabs.push({
        label: t.label,
        active: tab === t.id,
        onClick: () => setTab(t.id),
      });
    });
    setTabs(headerTabs);
    return () => {
      setHeader(null);
      setTabs([]);
    };
  }, [setHeader, setTabs, tab]);

  const setTab = (t: Tab) => setSearchParams(prev => {
    const next = new URLSearchParams(prev);
    next.set('tab', t);
    return next;
  });

  return (
    <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full">
      <div className="lg:hidden flex flex-nowrap items-center gap-3 mb-3 overflow-x-auto scrollbar-thin">
        <h1 className="text-xl font-bold text-slate-800 whitespace-nowrap shrink-0">Ledger & Vouchers</h1>
        <p className="text-sm text-slate-500 whitespace-nowrap shrink-0">Account ledgers, vouchers and chart of accounts{company ? ` of ${company.company_name}` : ''}.</p>
      </div>

      {!company ? (
        <Card><EmptyState icon={<BookOpen size={28} />} title="No company selected" message="Select a company in the top bar to view its accounts." /></Card>
      ) : (
        <>
          <div className="flex lg:hidden items-center gap-6 border-b border-slate-200 mb-6 overflow-x-auto">
            {/* The Account Ledger and Vouchers views are no longer tabs; they still open from a report's drill-down link. */}
            {(tab === 'ledger' || tab === 'vouchers') && (
              <button onClick={() => setTab('dashboard')} className="inline-flex items-center gap-1.5 pb-3 text-sm font-medium text-brand-600 hover:text-brand-700 whitespace-nowrap">
                ← Back to Ledger Dashboard
              </button>
            )}
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.id ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <t.icon size={15} />
                {t.label}
              </button>
            ))}
          </div>

          {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

          {tab === 'dashboard' && <LedgerDashboardPage embedded />}

          {tab === 'dashboard' ? null : loading || !fyr ? (
            loading ? <Card><LoadingState message="Loading accounts…" /></Card> : null
          ) : (
            <>
              {tab === 'ledger' && <LedgerTab fyr={fyr} accounts={accounts} companyName={company.company_name} onOpenVoucher={setVoucherId} />}
              {tab === 'vouchers' && <VouchersTab fyr={fyr} accounts={accounts} onOpenVoucher={setVoucherId} onChanged={reloadAccounts} />}
              {tab === 'accounts' && <AccountsTab accounts={accounts} isAdmin={isAdmin} onReload={reloadAccounts} />}
            </>
          )}
        </>
      )}

      {voucherId && <VoucherDetailModal id={voucherId} onClose={() => setVoucherId(null)} />}
    </div>
  );
}

// ======================================================================================
// Account ledger
// ======================================================================================

function LedgerTab({ fyr, accounts, companyName, onOpenVoucher }: {
  fyr: FinancialYearsResponse;
  accounts: Account[];
  companyName: string;
  onOpenVoucher: (id: string) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlAccount = searchParams.get('account') ?? '';
  const effTo = searchParams.get('to') || todayISO();
  const effFrom = searchParams.get('from') || fyStartFor(effTo, fyr);

  const [form, setForm] = useState({ account: urlAccount, from: effFrom, to: effTo });
  const [formError, setFormError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Keep the filter in step with the URL (deep links from the reports).
  useEffect(() => {
    setForm({ account: urlAccount, from: effFrom, to: effTo });
  }, [urlAccount, effFrom, effTo]);

  useEffect(() => {
    if (!urlAccount) { setLedger(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    accountingApi.ledger(urlAccount, effFrom, effTo)
      .then(l => { if (!cancelled) setLedger(l); })
      .catch(e => { if (!cancelled) { setLedger(null); setError(errorText(e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [urlAccount, effFrom, effTo, reloadKey]);

  const options = useMemo(() => flattenAccounts(accounts), [accounts]);

  const show = () => {
    if (!form.account) { setFormError('Choose an account'); return; }
    if (!form.from || !form.to || form.from > form.to) { setFormError('Choose a valid period (From must be on or before To)'); return; }
    setFormError(null);
    setSearchParams({ tab: 'ledger', account: form.account, from: form.from, to: form.to });
    setReloadKey(k => k + 1);
  };

  const particulars = (l: Ledger['lines'][number], isGroup: boolean) =>
    [isGroup ? l.account : null, l.narration, l.party].filter(Boolean).join(' — ');

  const handleCsv = () => {
    if (!ledger) return;
    const t = ledger.account.account_type;
    const bal = (v: string) => { const b = balanceSide(v, t); return [b.abs, b.side]; };
    exportCsv(`Ledger_${ledger.account.code}_${ledger.from}_${ledger.to}`, [
      ['Company', companyName],
      ['Account', `${ledger.account.code} ${ledger.account.name}`],
      ['Period', formatDate(ledger.from), formatDate(ledger.to)],
      [],
      ['Date', 'Voucher No', 'Type', 'Reference', 'Particulars', 'Debit', 'Credit', 'Balance', 'Dr/Cr'],
      ['', '', '', '', 'Opening Balance', '', '', ...bal(ledger.opening)],
      ...ledger.lines.map(l => [formatDate(l.entry_date), l.entry_no, l.voucher_type, l.reference ?? '', particulars(l, ledger.account.is_group), l.debit, l.credit, ...bal(l.balance)]),
      ['', '', '', '', 'Total', ledger.totals.debit, ledger.totals.credit, '', ''],
      ['', '', '', '', 'Closing Balance', '', '', ...bal(ledger.closing)],
    ]);
  };

  const handlePrint = () => {
    if (!ledger) return;
    const t = ledger.account.account_type;
    const rows = ledger.lines.map(l => `<tr><td>${escapeHtml(formatDate(l.entry_date))}</td><td>${escapeHtml(l.entry_no)}</td><td>${escapeHtml(l.voucher_type)}</td>
      <td>${escapeHtml(particulars(l, ledger.account.is_group))}</td><td class="num">${isZeroAmt(l.debit) ? '' : escapeHtml(formatINR(l.debit))}</td>
      <td class="num">${isZeroAmt(l.credit) ? '' : escapeHtml(formatINR(l.credit))}</td><td class="num">${escapeHtml(formatBalance(l.balance, t))}</td></tr>`).join('');
    printHtml(`Ledger ${ledger.account.name}`, `
      <div class="brand"><div><h1>Account Ledger — ${escapeHtml(ledger.account.code)} ${escapeHtml(ledger.account.name)}</h1>
      <div class="meta">${escapeHtml(companyName)} · ${escapeHtml(formatDate(ledger.from))} to ${escapeHtml(formatDate(ledger.to))}</div></div></div>
      <table><thead><tr><th>Date</th><th>Voucher No</th><th>Type</th><th>Particulars</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
      <tbody><tr class="group"><td colspan="6">Opening Balance</td><td class="num">${escapeHtml(formatBalance(ledger.opening, t))}</td></tr>
      ${rows || `<tr><td colspan="7">${escapeHtml(EMPTY_MESSAGE)}</td></tr>`}
      <tr class="total"><td colspan="4">Total</td><td class="num">${escapeHtml(formatINR(ledger.totals.debit))}</td><td class="num">${escapeHtml(formatINR(ledger.totals.credit))}</td><td></td></tr>
      <tr class="total"><td colspan="6">Closing Balance</td><td class="num">${escapeHtml(formatBalance(ledger.closing, t))}</td></tr></tbody></table>
      <div class="note">Generated ${escapeHtml(new Date().toLocaleString('en-IN', { hour12: false }))}</div>`);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
          <FormField label="Account">
            <select className={inputClass} value={form.account} onChange={e => setForm({ ...form, account: e.target.value })}>
              <option value="">Select account…</option>
              {options.map(({ account: a, depth }) => (
                <option key={a.id} value={a.id}>{indent(depth)}{a.code} — {a.name}{a.is_group ? ' (group)' : ''}{a.status === 'Inactive' ? ' (inactive)' : ''}</option>
              ))}
            </select>
          </FormField>
          <FormField label="From">
            <input type="date" className={inputClass} value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} />
          </FormField>
          <FormField label="To">
            <input type="date" className={inputClass} value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} />
          </FormField>
          <div className="flex gap-2">
            <Button icon={<Search size={14} />} onClick={show} disabled={loading}>Show</Button>
            <Button variant="secondary" icon={<Upload size={14} />} onClick={handleCsv} disabled={!ledger} title="Export CSV">CSV</Button>
            <Button variant="secondary" icon={<Printer size={14} />} onClick={handlePrint} disabled={!ledger}>Print</Button>
          </div>
        </div>
        {formError && <p className="mt-3 text-sm text-red-600">{formError}</p>}
      </Card>

      {error && <ErrorBanner message={error} />}

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState message="Loading ledger…" />
        ) : !ledger ? (
          <EmptyState icon={<BookOpen size={28} />} title="Choose an account" message="Pick an account (or a group to include all its sub-accounts) and a period, then click Show." />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">{ledger.account.code} — {ledger.account.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatDate(ledger.from)} to {formatDate(ledger.to)}
                  {ledger.account.is_group && ' · group ledger (includes all sub-accounts)'}
                </p>
              </div>
              <Badge variant="neutral">{ledger.account.account_type}</Badge>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className={thClass}>Date</th>
                    <th className={thClass}>Voucher No</th>
                    <th className={thClass}>Type</th>
                    <th className={thClass}>Particulars</th>
                    <th className={thNum}>Debit</th>
                    <th className={thNum}>Credit</th>
                    <th className={thNum}>Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="bg-slate-50/60 font-semibold">
                    <td className={tdClass} colSpan={6}>Opening Balance</td>
                    <td className={tdNum}>{formatBalance(ledger.opening, ledger.account.account_type)}</td>
                  </tr>
                  {ledger.lines.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">{EMPTY_MESSAGE}</td></tr>
                  ) : ledger.lines.map((l, i) => (
                    <tr key={`${l.journal_id}-${i}`} className="hover:bg-slate-50">
                      <td className={`${tdClass} whitespace-nowrap`}>{formatDate(l.entry_date)}</td>
                      <td className={tdClass}>
                        <button onClick={() => onOpenVoucher(l.journal_id)} className="font-mono text-xs font-semibold text-brand-600 hover:underline">{l.entry_no}</button>
                      </td>
                      <td className={tdClass}><span className="text-xs text-slate-600">{l.voucher_type}</span></td>
                      <td className={tdClass}>
                        {ledger.account.is_group && <p className="text-xs font-semibold text-slate-800">{l.account}</p>}
                        <p className="text-slate-700">{l.narration || <span className="text-slate-400">—</span>}</p>
                        {(l.party || l.reference) && (
                          <p className="text-xs text-slate-500">{[l.party, l.reference ? `Ref: ${l.reference}` : null].filter(Boolean).join(' · ')}</p>
                        )}
                      </td>
                      <td className={tdNum}>{isZeroAmt(l.debit) ? '' : formatINR(l.debit)}</td>
                      <td className={tdNum}>{isZeroAmt(l.credit) ? '' : formatINR(l.credit)}</td>
                      <td className={`${tdNum} font-medium`}>{formatBalance(l.balance, ledger.account.account_type)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 bg-orange-50/60 font-bold">
                    <td className={tdClass} colSpan={4}>Total</td>
                    <td className={tdNum}>{formatINR(ledger.totals.debit)}</td>
                    <td className={tdNum}>{formatINR(ledger.totals.credit)}</td>
                    <td className={tdNum}></td>
                  </tr>
                  <tr className="bg-orange-50/60 font-bold">
                    <td className={tdClass} colSpan={6}>Closing Balance</td>
                    <td className={tdNum}>{formatBalance(ledger.closing, ledger.account.account_type)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

const isZeroAmt = (v: string) => toPaise(v) === 0n;

// ======================================================================================
// Voucher detail
// ======================================================================================

function VoucherDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    accountingApi.journalEntry(id)
      .then(e => { if (!cancelled) { setEntry(e); if (!e) setError('Voucher not found'); } })
      .catch(e => { if (!cancelled) setError(errorText(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const totalCredit = entry ? paiseToAmount(entry.lines.reduce((s, l) => s + toPaise(l.credit), 0n)) : '0';

  return (
    <Modal open onClose={onClose} title={entry ? `Voucher ${entry.entry_no}` : 'Voucher'} subtitle={entry ? `${entry.voucher_type} · ${formatDate(entry.entry_date)}` : undefined} size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {loading ? <LoadingState message="Loading voucher…" /> : error ? <ErrorBanner message={error} /> : entry && (
        <div className="space-y-4">
          {entry.source_type && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-sm text-blue-800">
              <span className="inline-flex items-center gap-2"><Lock size={14} /> Automatic entry from {SOURCE_LABELS[entry.source_type] ?? entry.source_type}. Correct it in the source module.</span>
              {SOURCE_ROUTES[entry.source_type] && (
                <Button size="sm" variant="secondary" icon={<ExternalLink size={13} />} onClick={() => { onClose(); navigate(SOURCE_ROUTES[entry.source_type!]); }}>
                  Open {SOURCE_LABELS[entry.source_type] ?? 'source'}
                </Button>
              )}
            </div>
          )}
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Date</dt><dd className="font-medium text-slate-800">{formatDate(entry.entry_date)}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Type</dt><dd className="font-medium text-slate-800">{entry.voucher_type}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Reference</dt><dd className="font-medium text-slate-800">{entry.reference || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Created by</dt><dd className="font-medium text-slate-800">{entry.created_by || '—'}</dd></div>
            <div className="col-span-2 md:col-span-4"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Narration</dt><dd className="font-medium text-slate-800">{entry.narration || '—'}</dd></div>
          </dl>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 bg-slate-50">
                <th className={thClass}>Account</th><th className={thClass}>Company</th><th className={thNum}>Debit</th><th className={thNum}>Credit</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {entry.lines.map((l, i) => (
                  <tr key={i}>
                    <td className={tdClass}><span className="font-mono text-xs text-slate-500 mr-2">{l.account_code}</span>{l.account_name}</td>
                    <td className={tdClass}>{l.party || '—'}</td>
                    <td className={tdNum}>{isZeroAmt(l.debit) ? '' : formatINR(l.debit)}</td>
                    <td className={tdNum}>{isZeroAmt(l.credit) ? '' : formatINR(l.credit)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 bg-orange-50/60 font-bold">
                  <td className={tdClass} colSpan={2}>Total</td>
                  <td className={tdNum}>{formatINR(entry.total)}</td>
                  <td className={tdNum}>{formatINR(totalCredit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ======================================================================================
// Vouchers
// ======================================================================================

function VouchersTab({ fyr, accounts, onOpenVoucher, onChanged }: {
  fyr: FinancialYearsResponse;
  accounts: Account[];
  onOpenVoucher: (id: string) => void;
  onChanged: () => void;
}) {
  const [period, setPeriod] = useState(() => { const to = todayISO(); return { from: fyStartFor(to, fyr), to }; });
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: number; entry: JournalEntry | null } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async (from: string, to: string) => {
    if (!from || !to || from > to) { setError('Choose a valid period (From must be on or before To)'); return; }
    setLoading(true);
    setError(null);
    try {
      setEntries(await accountingApi.journalEntries(from, to));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load for the default period only; later loads come from the Show button.
  const [initialPeriod] = useState(period);
  useEffect(() => { load(initialPeriod.from, initialPeriod.to); }, [load, initialPeriod]);

  const remove = async (e: JournalEntry) => {
    if (!window.confirm(`Delete voucher ${e.entry_no}? This cannot be undone.`)) return;
    setDeleting(e.id);
    setError(null);
    try {
      await accountingApi.deleteJournal(e.id);
      await load(period.from, period.to);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44"><FormField label="From"><input type="date" className={inputClass} value={period.from} onChange={e => setPeriod({ ...period, from: e.target.value })} /></FormField></div>
          <div className="w-44"><FormField label="To"><input type="date" className={inputClass} value={period.to} onChange={e => setPeriod({ ...period, to: e.target.value })} /></FormField></div>
          <Button icon={<Search size={14} />} onClick={() => load(period.from, period.to)} disabled={loading}>Show</Button>
          <div className="flex-1" />
          <Button icon={<Plus size={14} />} onClick={() => setEditing({ key: Date.now(), entry: null })}>New Voucher</Button>
        </div>
      </Card>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <Card className="overflow-hidden">
        {loading ? <LoadingState message="Loading vouchers…" /> : entries.length === 0 ? (
          <EmptyState icon={<FileText size={28} />} title="No vouchers" message={EMPTY_MESSAGE} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 bg-slate-50">
                <th className={thClass}>Voucher No</th><th className={thClass}>Date</th><th className={thClass}>Type</th>
                <th className={thClass}>Narration</th><th className={thNum}>Amount</th><th className={thClass}>Source / Created by</th>
                <th className={`${thClass} text-center`}>Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className={tdClass}><button onClick={() => onOpenVoucher(e.id)} className="font-mono text-xs font-semibold text-brand-600 hover:underline">{e.entry_no}</button></td>
                    <td className={`${tdClass} whitespace-nowrap`}>{formatDate(e.entry_date)}</td>
                    <td className={tdClass}><span className="text-xs text-slate-600">{e.voucher_type}</span></td>
                    <td className={tdClass}>
                      <p>{e.narration || <span className="text-slate-400">—</span>}</p>
                      {e.reference && <p className="text-xs text-slate-500">Ref: {e.reference}</p>}
                    </td>
                    <td className={tdNum}>{formatINR(e.total)}</td>
                    <td className={tdClass}>
                      {e.is_system ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="info"><Lock size={11} /> Automatic</Badge>
                          <span className="text-xs text-slate-500">{e.source_type ? SOURCE_LABELS[e.source_type] ?? e.source_type : e.created_by}</span>
                        </div>
                      ) : <span className="text-xs text-slate-600">{e.created_by || '—'}</span>}
                    </td>
                    <td className={`${tdClass} text-center`}>
                      {!e.is_system && (
                        <div className="flex items-center justify-center gap-1">
                          <button title="Edit" onClick={() => setEditing({ key: Date.now(), entry: e })} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Edit size={15} /></button>
                          <button title="Delete" disabled={deleting === e.id} onClick={() => remove(e)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-40"><Trash2 size={15} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <VoucherFormModal
          key={editing.key}
          entry={editing.entry}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(period.from, period.to); onChanged(); }}
        />
      )}
    </div>
  );
}

interface FormLine { key: number; account_id: string; party: string; debit: string; credit: string }

let lineSeq = 0;
const newLine = (partial: Partial<FormLine> = {}): FormLine => ({ key: ++lineSeq, account_id: '', party: '', debit: '', credit: '', ...partial });

function VoucherFormModal({ entry, accounts, onClose, onSaved }: {
  entry: JournalEntry | null;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(entry?.entry_date?.slice(0, 10) ?? todayISO());
  const [type, setType] = useState<VoucherType>(entry && MANUAL_VOUCHER_TYPES.includes(entry.voucher_type) ? entry.voucher_type : 'Journal');
  const [reference, setReference] = useState(entry?.reference ?? '');
  const [narration, setNarration] = useState(entry?.narration ?? '');
  const [lines, setLines] = useState<FormLine[]>(() => entry
    ? entry.lines.map(l => newLine({
        account_id: l.account_id, party: l.party ?? '',
        debit: isZeroAmt(l.debit) ? '' : l.debit, credit: isZeroAmt(l.credit) ? '' : l.credit,
      }))
    : [newLine(), newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only active ledger (non-group) accounts can be posted to; keep a line's current account visible.
  const postable = useMemo(() => flattenAccounts(accounts).filter(r => !r.account.is_group && r.account.status === 'Active'), [accounts]);
  const accountById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

  const totalDr = lines.reduce((s, l) => s + toPaise(l.debit), 0n);
  const totalCr = lines.reduce((s, l) => s + toPaise(l.credit), 0n);
  const diff = totalDr - totalCr;

  let problem: string | null = null;
  if (lines.length < 2) problem = 'A voucher needs at least two lines.';
  else if (lines.some(l => !l.account_id)) problem = 'Select an account on every line.';
  else if (lines.some(l => (toPaise(l.debit) > 0n) === (toPaise(l.credit) > 0n))) problem = 'Each line needs either a debit or a credit amount.';
  else if (totalDr === 0n) problem = 'Enter the voucher amounts.';
  else if (diff !== 0n) problem = `Debit and credit totals differ by ${formatINR(paiseToAmount(diff < 0n ? -diff : diff))}.`;
  if (!date) problem = 'Voucher date is required.';

  const update = (key: number, patch: Partial<FormLine>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const setAmount = (key: number, field: 'debit' | 'credit', value: string) => {
    if (!AMOUNT_RE.test(value)) return;
    update(key, field === 'debit' ? { debit: value, ...(value ? { credit: '' } : {}) } : { credit: value, ...(value ? { debit: '' } : {}) });
  };

  const save = async () => {
    if (problem) return;
    setSaving(true);
    setError(null);
    try {
      await accountingApi.saveJournal({
        id: entry?.id ?? null, date, type, narration, reference,
        lines: lines.map(l => ({
          account_id: l.account_id, party: l.party,
          debit: paiseToAmount(toPaise(l.debit)), credit: paiseToAmount(toPaise(l.credit)),
        })),
      });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={entry ? `Edit Voucher ${entry.entry_no}` : 'New Voucher'}
      subtitle="Debits must equal credits. The voucher number is assigned automatically."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !!problem}>{saving ? 'Saving…' : entry ? 'Save Changes' : 'Save Voucher'}</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Date" required><input type="date" className={inputClass} value={date} onChange={e => setDate(e.target.value)} /></FormField>
          <FormField label="Type" required>
            <select className={inputClass} value={type} onChange={e => setType(e.target.value as VoucherType)}>
              {MANUAL_VOUCHER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Reference"><input className={inputClass} value={reference} onChange={e => setReference(e.target.value)} placeholder="Cheque / bill no." /></FormField>
        </div>
        <FormField label="Narration"><textarea className={inputClass} rows={2} value={narration} onChange={e => setNarration(e.target.value)} /></FormField>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 bg-slate-50">
              <th className={thClass}>Account</th><th className={thClass}>Company</th>
              <th className={`${thNum} w-36`}>Debit</th><th className={`${thNum} w-36`}>Credit</th><th className="w-10" />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map(l => {
                const current = l.account_id ? accountById.get(l.account_id) : undefined;
                const missing = current && (current.is_group || current.status !== 'Active');
                return (
                  <tr key={l.key}>
                    <td className="px-2 py-2 min-w-[240px]">
                      <select className={inputClass} value={l.account_id} onChange={e => update(l.key, { account_id: e.target.value })}>
                        <option value="">Select account…</option>
                        {missing && current && <option value={current.id}>{current.code} — {current.name} (not postable)</option>}
                        {postable.map(({ account: a }) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2 min-w-[160px]"><input className={inputClass} value={l.party} onChange={e => update(l.key, { party: e.target.value })} placeholder="Optional" /></td>
                    <td className="px-2 py-2"><input className={`${inputClass} text-right tabular-nums`} inputMode="decimal" value={l.debit} onChange={e => setAmount(l.key, 'debit', e.target.value)} placeholder="0.00" /></td>
                    <td className="px-2 py-2"><input className={`${inputClass} text-right tabular-nums`} inputMode="decimal" value={l.credit} onChange={e => setAmount(l.key, 'credit', e.target.value)} placeholder="0.00" /></td>
                    <td className="px-2 py-2 text-center">
                      <button title="Remove line" disabled={lines.length <= 2} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-30"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 font-bold">
                <td className="px-2 py-2" colSpan={2}>
                  <button onClick={() => setLines(ls => [...ls, newLine()])} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"><Plus size={13} /> Add line</button>
                </td>
                <td className={tdNum}>{formatINR(paiseToAmount(totalDr))}</td>
                <td className={tdNum}>{formatINR(paiseToAmount(totalCr))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        {problem && (
          <p className={`text-sm rounded-lg px-3 py-2 border ${diff !== 0n && totalDr + totalCr > 0n ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-slate-600 bg-slate-50 border-slate-200'}`}>{problem}</p>
        )}
        {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}

// ======================================================================================
// Chart of accounts
// ======================================================================================

const CLASS_LABELS: Record<string, string> = { CURRENT: 'Current', NON_CURRENT: 'Non-current' };

function AccountsTab({ accounts, isAdmin, onReload }: { accounts: Account[]; isAdmin: boolean; onReload: () => Promise<void> }) {
  const [, setSearchParams] = useSearchParams();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<{ key: number; account: Account | null; parentId: string } | null>(null);

  const rows = useMemo(() => flattenAccounts(accounts, collapsed), [accounts, collapsed]);
  const byId = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const kids = useMemo(() => childrenMap(accounts), [accounts]);

  /** Classification is set on the top Balance Sheet groups; sub-accounts inherit it. */
  const classification = (a: Account): { label: string; inherited: boolean } => {
    let cur: Account | undefined = a;
    let inherited = false;
    while (cur) {
      if (cur.bs_class) return { label: CLASS_LABELS[cur.bs_class] ?? cur.bs_class, inherited };
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      inherited = true;
    }
    return { label: '—', inherited: false };
  };

  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (accounts.length === 0) {
    return <Card><EmptyState icon={<ListTree size={28} />} title="No accounts" message={EMPTY_MESSAGE} /></Card>;
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Chart of Accounts</h3>
            <p className="text-xs text-slate-500 mt-0.5">{accounts.length} accounts. Type and classification follow the parent group.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>Expand all</Button>
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(accounts.filter(a => (kids.get(a.id)?.length ?? 0) > 0).map(a => a.id)))}>Collapse all</Button>
            {isAdmin && <Button size="sm" icon={<Plus size={14} />} onClick={() => setForm({ key: Date.now(), account: null, parentId: '' })}>Add account</Button>}
          </div>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 bg-slate-50">
              <th className={thClass}>Code</th><th className={thClass}>Name</th><th className={thClass}>Type</th>
              <th className={thClass}>Classification</th><th className={thClass}>Status</th><th className={thClass}>Postings</th>
              <th className={`${thClass} text-center`}>Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ account: a, depth, hasChildren }) => {
                const cls = classification(a);
                return (
                  <tr key={a.id} className={`hover:bg-slate-50 ${a.is_group ? 'bg-slate-50/40' : ''}`}>
                    <td className={`${tdClass} font-mono text-xs`}>{a.code}</td>
                    <td className={tdClass}>
                      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 18 }}>
                        {hasChildren ? (
                          <button onClick={() => toggle(a.id)} className="p-0.5 text-slate-400 hover:text-slate-700">
                            {collapsed.has(a.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                        ) : <span className="w-[18px]" />}
                        <span className={a.is_group ? 'font-semibold text-slate-800' : 'text-slate-700'}>{a.name}</span>
                        {a.is_group && <span className="text-[10px] uppercase tracking-wider text-slate-400 ml-1">group</span>}
                        {a.system_key && <Badge variant="neutral" className="ml-2 !px-1.5 !py-0 text-[10px]">System</Badge>}
                      </div>
                    </td>
                    <td className={tdClass}><span className="text-xs text-slate-600">{a.account_type}</span></td>
                    <td className={tdClass}><span className={`text-xs ${cls.inherited ? 'text-slate-400' : 'text-slate-600'}`}>{cls.label}</span></td>
                    <td className={tdClass}><Badge variant={a.status === 'Active' ? 'success' : 'neutral'} dot>{a.status}</Badge></td>
                    <td className={tdClass}><span className="text-xs text-slate-600">{a.has_postings ? 'Yes' : 'No'}</span></td>
                    <td className={`${tdClass} text-center`}>
                      <div className="flex items-center justify-center gap-1">
                        <button title="Open ledger" onClick={() => setSearchParams({ tab: 'ledger', account: a.id })} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><BookOpen size={15} /></button>
                        {isAdmin && (
                          <>
                            {a.is_group && <button title="Add account under this group" onClick={() => setForm({ key: Date.now(), account: null, parentId: a.id })} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Plus size={15} /></button>}
                            <button title="Edit" onClick={() => setForm({ key: Date.now(), account: a, parentId: a.parent_id ?? '' })} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Edit size={15} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {form && (
        <AccountFormModal
          key={form.key}
          account={form.account}
          initialParentId={form.parentId}
          accounts={accounts}
          hasChildren={form.account ? (kids.get(form.account.id)?.length ?? 0) > 0 : false}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await onReload(); }}
        />
      )}
    </div>
  );
}

function AccountFormModal({ account, initialParentId, accounts, hasChildren, onClose, onSaved }: {
  account: Account | null;
  initialParentId: string;
  accounts: Account[];
  hasChildren: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [parentId, setParentId] = useState(initialParentId);
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [isGroup, setIsGroup] = useState(account?.is_group ?? false);
  const [status, setStatus] = useState<'Active' | 'Inactive'>(account?.status ?? 'Active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => flattenAccounts(accounts).filter(r => r.account.is_group), [accounts]);
  const parent = accounts.find(a => a.id === (account ? account.parent_id : parentId));
  const groupLocked = !!account && (account.has_postings || hasChildren);
  const statusLocked = !!account?.system_key;

  const save = async () => {
    if (!account && !parentId) { setError('Choose a parent group for the new account'); return; }
    if (!code.trim() || !name.trim()) { setError('Account code and name are required'); return; }
    setSaving(true);
    setError(null);
    try {
      await accountingApi.saveAccount({ id: account?.id ?? null, parentId: account ? account.parent_id : parentId, code: code.trim(), name: name.trim(), isGroup, status });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={account ? 'Edit Account' : 'Add Account'}
      subtitle={parent ? `Under ${parent.code} — ${parent.name} (${parent.account_type})` : 'Type and classification come from the parent group.'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : account ? 'Save Changes' : 'Add Account'}</Button>
      </>}>
      <div className="grid grid-cols-1 gap-4">
        {!account && (
          <FormField label="Parent group" required>
            <select className={inputClass} value={parentId} onChange={e => setParentId(e.target.value)}>
              <option value="">Select group…</option>
              {groups.map(({ account: g, depth }) => <option key={g.id} value={g.id}>{indent(depth)}{g.code} — {g.name}</option>)}
            </select>
          </FormField>
        )}
        <FormField label="Code" required><input className={inputClass} value={code} onChange={e => setCode(e.target.value)} /></FormField>
        <FormField label="Name" required><input className={inputClass} value={name} onChange={e => setName(e.target.value)} /></FormField>
        <FormField label="Group" hint={groupLocked ? 'An account with postings or sub-accounts cannot change between group and ledger.' : 'A group holds other accounts and cannot be posted to directly.'}>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isGroup} disabled={groupLocked} onChange={e => setIsGroup(e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            This is a group account
          </label>
        </FormField>
        {account && (
          <FormField label="Status" hint={statusLocked ? 'System accounts are used by automatic postings and must stay active.' : undefined}>
            <select className={inputClass} value={status} disabled={statusLocked} onChange={e => setStatus(e.target.value as 'Active' | 'Inactive')}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </FormField>
        )}
        {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}

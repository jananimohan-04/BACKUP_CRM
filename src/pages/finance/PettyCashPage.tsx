import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, Save, Eraser, Trash2, FileSpreadsheet, Inbox, AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { intersectRange } from '@/lib/globalDate';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { supabase } from '@/lib/supabase';
import { financeApi, type BankFilters } from '@/lib/finance';
import { accountingApi, type Account } from '@/lib/accounting';
import { formatINR, todayISO } from '@/lib/format';
import { exportCsv } from '@/lib/reportExport';

// Petty Cash Entry: record small cash / bank payments and receipts against a ledger, then browse and filter them.
// Debit = money paid out of the chosen bank / cash account, Credit = money received into it (same as the bank statement).
// Entries are saved with the same erp_add_bank_entry as Bank Entry, so they post to the ledger like any other.

const SOURCE = 'petty_cash';
const lbl = 'block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5';
const inp = 'w-full h-10 px-3 text-sm text-slate-800 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15 disabled:bg-slate-100 disabled:text-slate-500';
const btn = 'inline-flex items-center justify-center gap-1.5 h-10 px-4 text-sm font-semibold rounded-lg shadow-sm active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';
const money = (n: number) => (n ? formatINR(n, { decimals: 'always', symbol: false }) : '');
const dmy = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const stamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
};

/** The kind of ledger an account is, as a short readable label. */
function ledgerTypeOf(a: Pick<Account, 'account_type' | 'system_key'> | undefined | null): string {
  if (!a) return '';
  if (a.system_key === 'TRADE_RECEIVABLES') return 'Receivable';
  if (a.system_key === 'TRADE_PAYABLES') return 'Payable';
  return ({ ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', INCOME: 'Income', EXPENSE: 'Expense' } as Record<string, string>)[a.account_type] ?? '';
}

interface PettyRow {
  id: string; txn_no: string; txn_date: string; direction: 'IN' | 'OUT'; account_id: string; contra_account_id: string | null;
  amount: number; description: string | null; status: string; created_at: string; created_by: string | null;
}

type Note = { kind: 'ok' | 'err'; text: string } | null;

export function PettyCashPage() {
  const { setHeader } = useHeaderKpis();
  const { company } = useAuth();
  const cid = company?.id ?? null;

  useEffect(() => {
    setHeader({ title: 'Petty Cash Entry' });
    return () => setHeader(null);
  }, [setHeader]);
  const [options, setOptions] = useState<BankFilters | null>(null);
  const [chart, setChart] = useState<Account[]>([]);
  const [rows, setRows] = useState<PettyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [note, setNote] = useState<Note>(null);
  const [saving, setSaving] = useState(false);

  // form
  const [date, setDate] = useState(todayISO());
  const [desc, setDesc] = useState('');
  const [debit, setDebit] = useState('');
  const [credit, setCredit] = useState('');
  const [bankId, setBankId] = useState('');
  const [ledgerText, setLedgerText] = useState('');

  // filters
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fBank, setFBank] = useState('');
  const [fLedger, setFLedger] = useState('');
  const [fType, setFType] = useState('');

  const accounts = options?.accounts ?? [];
  const canManage = !!options?.can_manage;
  const ledgers = useMemo(() => chart.filter(a => !a.is_group && a.status === 'Active' && a.id !== bankId), [chart, bankId]);
  const label = (a: Account) => `${a.code} · ${a.name}`;
  const ledger = useMemo(() => ledgers.find(a => label(a) === ledgerText.trim()) ?? ledgers.find(a => a.name.toLowerCase() === ledgerText.trim().toLowerCase()), [ledgers, ledgerText]);
  const accName = useMemo(() => new Map(chart.map(a => [a.id, a])), [chart]);

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    try {
      const r = await supabase.from('cnc_bank_transactions')
        .select('id,txn_no,txn_date,direction,account_id,contra_account_id,amount,description,status,created_at,created_by')
        .eq('source_type', SOURCE).order('created_at', { ascending: false }).limit(1000);
      if (r.error) throw new Error(r.error.message);
      setRows(((r.data ?? []) as Record<string, unknown>[]).map(x => ({
        id: String(x.id), txn_no: String(x.txn_no ?? ''), txn_date: String(x.txn_date ?? '').slice(0, 10), direction: x.direction === 'IN' ? 'IN' : 'OUT',
        account_id: String(x.account_id ?? ''), contra_account_id: x.contra_account_id ? String(x.contra_account_id) : null,
        amount: Number(x.amount) || 0, description: (x.description as string) ?? '', status: String(x.status ?? ''),
        created_at: String(x.created_at ?? ''), created_by: (x.created_by as string) ?? null,
      })));
    } catch (e) { setRows([]); setLoadErr(e instanceof Error ? e.message : 'Could not load petty cash entries.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [o, c] = await Promise.all([financeApi.bankFilters(), accountingApi.chartOfAccounts()]);
        if (off) return;
        setOptions(o); setChart(c);
        setBankId(b => b || o.accounts.find(a => a.type === 'Cash')?.id || o.accounts[0]?.id || '');
      } catch (e) { if (!off) setLoadErr(e instanceof Error ? e.message : 'Could not load accounts.'); }
    })();
    void load();
    return () => { off = true; };
  }, [cid, load]);

  const clearForm = () => { setDate(todayISO()); setDesc(''); setDebit(''); setCredit(''); setLedgerText(''); setNote(null); };

  const save = async () => {
    setNote(null);
    const d = Number(debit.replace(/,/g, '')) || 0, c = Number(credit.replace(/,/g, '')) || 0;
    if (!date) return setNote({ kind: 'err', text: 'Choose the value date.' });
    if (!desc.trim()) return setNote({ kind: 'err', text: 'Enter a description.' });
    if (!bankId) return setNote({ kind: 'err', text: 'Select the bank / cash account.' });
    if (!ledger) return setNote({ kind: 'err', text: 'Choose a ledger from the list.' });
    if (d > 0 && c > 0) return setNote({ kind: 'err', text: 'Enter either a debit or a credit, not both.' });
    if (!(d > 0) && !(c > 0)) return setNote({ kind: 'err', text: 'Enter a debit or a credit amount.' });
    setSaving(true);
    try {
      await financeApi.addBankEntry({
        direction: c > 0 ? 'IN' : 'OUT', account_id: bankId, contra_account_id: ledger.id, amount: String(c > 0 ? c : d), txn_date: date,
        mode: 'Petty cash', description: desc.trim(), status: 'Cleared', source_type: SOURCE,
      });
      setNote({ kind: 'ok', text: 'Entry saved and posted to the ledger.' });
      setDesc(''); setDebit(''); setCredit(''); setLedgerText('');
      await load();
    } catch (e) { setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Could not save the entry.' }); }
    finally { setSaving(false); }
  };

  const cancelRow = async (r: PettyRow) => {
    if (!window.confirm(`Delete entry ${r.txn_no}? It is cancelled and reversed in the ledger.`)) return;
    try { await financeApi.bankSetStatus(r.id, 'Cancelled'); await load(); setNote({ kind: 'ok', text: `${r.txn_no} deleted.` }); }
    catch (e) { setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Could not delete the entry.' }); }
  };

  // Global Topbar range intersects this page's own From/To (either may be empty).
  const { from: globalFrom, to: globalTo } = useGlobalDateFilter();
  const { from: effFrom, to: effTo } = intersectRange(fFrom, fTo, globalFrom, globalTo);
  const view = useMemo(() => rows.filter(r =>
    (!effFrom || r.txn_date >= effFrom) && (!effTo || r.txn_date <= effTo) && (!fBank || r.account_id === fBank) &&
    (!fLedger || r.contra_account_id === fLedger) && (!fType || ledgerTypeOf(r.contra_account_id ? accName.get(r.contra_account_id) : null) === fType)), [rows, effFrom, effTo, fBank, fLedger, fType, accName]);
  const live = view.filter(r => r.status !== 'Cancelled');
  const totalDebit = live.filter(r => r.direction === 'OUT').reduce((n, r) => n + r.amount, 0);
  const totalCredit = live.filter(r => r.direction === 'IN').reduce((n, r) => n + r.amount, 0);
  const usedLedgers = useMemo(() => Array.from(new Set(rows.map(r => r.contra_account_id).filter((x): x is string => !!x))).map(id => accName.get(id)).filter((a): a is Account => !!a), [rows, accName]);
  const filtersOn = !!(fFrom || fTo || fBank || fLedger || fType);
  const clearFilters = () => { setFFrom(''); setFTo(''); setFBank(''); setFLedger(''); setFType(''); };

  const exportRows = () => {
    if (!view.length) return;
    exportCsv(`petty-cash-${todayISO()}`, [['Entry No', 'Timestamp', 'Value Date', 'Description', 'Debit', 'Credit', 'Bank Name', 'Ledger Name', 'Ledger Type', 'Status'],
      ...view.map(r => [r.txn_no, stamp(r.created_at), dmy(r.txn_date), r.description ?? '', r.direction === 'OUT' ? r.amount : '', r.direction === 'IN' ? r.amount : '',
        accName.get(r.account_id)?.name ?? '', r.contra_account_id ? accName.get(r.contra_account_id)?.name ?? '' : '', ledgerTypeOf(r.contra_account_id ? accName.get(r.contra_account_id) : null), r.status])]);
  };

  const typeOptions = ['Expense', 'Income', 'Receivable', 'Payable', 'Asset', 'Liability', 'Equity'];

  return (
    <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full">
      <div className="max-w-[1500px] mx-auto flex flex-col gap-2.5">
        <div className="lg:hidden flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 text-white flex items-center justify-center shadow-lg shadow-orange-500/25"><Wallet size={22} /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Petty Cash Entry</h1>
          </div>
        </div>

        {/* ---------- new entry ---------- */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-2.5 sm:p-3 space-y-2">
            <div className="flex items-end gap-2 overflow-x-auto min-w-0 pb-0.5">
              <div className="w-[130px] shrink-0">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-date">Value date <span className="text-red-500">*</span></label>
                <input id="pc-date" type="date" className="w-full h-8 px-2 text-xs text-slate-800 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="min-w-[140px] flex-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-desc">Description <span className="text-red-500">*</span></label>
                <input id="pc-desc" placeholder="Description" className="w-full h-8 px-2 text-xs text-slate-800 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" value={desc} onChange={e => setDesc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }} />
              </div>
              <div className="w-[85px] shrink-0">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-debit">Debit <span className="font-normal text-slate-400">(out)</span></label>
                <input id="pc-debit" inputMode="decimal" placeholder="0.00" className="w-full h-8 px-2 text-xs text-slate-800 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" value={debit} onChange={e => { setDebit(e.target.value); if (e.target.value) setCredit(''); }} />
              </div>
              <div className="w-[85px] shrink-0">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-credit">Credit <span className="font-normal text-slate-400">(in)</span></label>
                <input id="pc-credit" inputMode="decimal" placeholder="0.00" className="w-full h-8 px-2 text-xs text-slate-800 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" value={credit} onChange={e => { setCredit(e.target.value); if (e.target.value) setDebit(''); }} />
              </div>
              <div className="w-[140px] shrink-0">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-bank">Bank name <span className="text-red-500">*</span></label>
                <select id="pc-bank" className="w-full h-8 px-2 text-xs text-slate-800 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400 truncate cursor-pointer" value={bankId} onChange={e => setBankId(e.target.value)}>
                  <option value="">Select Bank</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.type === 'Cash' ? ' (Cash)' : ''}</option>)}
                </select>
              </div>
              <div className="min-w-[140px] flex-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-ledger">Ledger name <span className="text-red-500">*</span></label>
                <input id="pc-ledger" list="pc-ledgers" placeholder="Search Ledger" className="w-full h-8 px-2 text-xs text-slate-800 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" value={ledgerText} onChange={e => setLedgerText(e.target.value)} />
                <datalist id="pc-ledgers">{ledgers.map(a => <option key={a.id} value={label(a)} />)}</datalist>
              </div>
              <div className="w-[90px] shrink-0">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-type">Ledger type</label>
                <input id="pc-type" readOnly className="w-full h-8 px-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md shadow-sm" value={ledgerTypeOf(ledger)} placeholder="Auto" />
              </div>
              <button type="button" className="h-8 px-3 text-xs font-semibold text-white bg-gradient-to-b from-orange-500 to-orange-600 hover:from-orange-500 hover:to-orange-700 rounded-md shadow-sm flex items-center gap-1.5 shrink-0 disabled:opacity-40 cursor-pointer active:scale-[0.98] transition" disabled={saving || !canManage} onClick={() => void save()}>
                <Save size={13} />
                <span>{saving ? 'Saving…' : 'Save entry'}</span>
              </button>
              <button type="button" className="h-8 px-2.5 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-md shadow-sm flex items-center gap-1.5 shrink-0 cursor-pointer transition" onClick={clearForm}>
                <Eraser size={13} />
                <span>Clear</span>
              </button>
            </div>
            {options && !canManage && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Only administrators can record entries. You can still view and filter them.</p>}
            {note && (
              <div role="status" className={`flex items-start gap-2 text-sm rounded-xl border px-3.5 py-2.5 ${note.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                {note.kind === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}<span>{note.text}</span>
              </div>
            )}
          </div>
        </section>

        {/* ---------- details ---------- */}
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Petty cash details <span className="ml-2 text-xs font-medium normal-case text-slate-500" data-testid="pc-count">{view.length} entr{view.length === 1 ? 'y' : 'ies'}</span></h2>
            <button type="button" className={`${btn} !h-9 text-slate-700 bg-white border border-slate-200 hover:bg-slate-50`} onClick={exportRows} disabled={!view.length}><Upload size={14} />Export CSV</button>
          </div>
          {loadErr && <div role="alert" className="m-4 flex items-start gap-2 text-sm rounded-xl border border-red-200 bg-red-50 text-red-800 px-3.5 py-2.5"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{loadErr}</span></div>}
          <div className="overflow-auto max-h-[520px]">
            <table className="w-full text-[13px] min-w-[1000px]">
              <thead className="bg-slate-100/90 sticky top-0 z-10 shadow-[0_1px_0_#e2e8f0]"><tr className="text-left">
                {['Timestamp', 'Value Date', 'Description', 'Debit', 'Credit', 'Bank Name', 'Ledger Name', 'Ledger Type', 'Actions'].map((h, i) => <th key={h} className={`px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 ${i === 3 || i === 4 ? 'text-right' : ''}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {view.map(r => {
                  const cancelled = r.status === 'Cancelled';
                  const la = r.contra_account_id ? accName.get(r.contra_account_id) : undefined;
                  return (
                    <tr key={r.id} data-testid="pc-row" className={`border-t border-slate-100 ${cancelled ? 'opacity-50 line-through' : 'hover:bg-slate-50'}`}>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500">{stamp(r.created_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{dmy(r.txn_date)}</td>
                      <td className="px-3 py-2 max-w-[280px] truncate" title={r.description ?? ''}>{r.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">{r.direction === 'OUT' ? money(r.amount) : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600">{r.direction === 'IN' ? money(r.amount) : ''}</td>
                      <td className="px-3 py-2">{accName.get(r.account_id)?.name ?? ''}</td>
                      <td className="px-3 py-2">{la?.name ?? ''}</td>
                      <td className="px-3 py-2">{la && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-slate-50 text-slate-600 border-slate-200">{ledgerTypeOf(la)}</span>}</td>
                      <td className="px-3 py-2">{!cancelled && canManage && <button type="button" aria-label={`Delete ${r.txn_no}`} title="Delete entry" onClick={() => void cancelRow(r)} className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>}{cancelled && <span className="text-[11px] font-semibold text-slate-500 no-underline">Deleted</span>}</td>
                    </tr>
                  );
                })}
                {!loading && view.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center"><Inbox size={28} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-semibold text-slate-600">{filtersOn ? 'No entries match these filters' : 'No petty cash entries yet'}</p></td></tr>
                )}
                {loading && view.length === 0 && <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              </tbody>
              {view.length > 0 && (
                <tfoot className="sticky bottom-0 bg-slate-100 border-t border-slate-300 font-bold">
                  <tr><td colSpan={3} className="px-3 py-2 text-right text-slate-600">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-600" data-testid="pc-debit">{money(totalDebit) || '0.00'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600" data-testid="pc-credit">{money(totalCredit) || '0.00'}</td>
                    <td colSpan={4} className="px-3 py-2 text-slate-500 font-medium">Deleted entries are not counted</td></tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, Save, Eraser, Trash2, FileSpreadsheet, Inbox, AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { MemberSelect, useMemberNames } from '@/components/MemberSelect';
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
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
};

function toISODate(d: unknown): string {
  if (!d) return '';
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}-\d{2}-\d{4}/.test(s)) {
    const parts = s.slice(0, 10).split('-');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
}

function inwardLineTotal(q: any, p: any, d: any, g: any) {
  const qty = Number(q) || 0;
  const price = Number(p) || 0;
  const disc = Number(d) || 0;
  const gst = Number(g) || 0;
  const base = qty * price;
  const afterDisc = base - (base * disc / 100);
  const total = afterDisc + (afterDisc * gst / 100);
  return Math.round(total * 100) / 100;
}

function cleanItemDesc(text: string, projName?: string, soRef?: string, inwNo?: string): string {
  if (!text) return '';
  let s = text.trim();
  if (inwNo && s.toLowerCase() === inwNo.toLowerCase()) return '';
  if (projName && s.toLowerCase() === projName.toLowerCase()) return '';
  if (soRef && s.toLowerCase() === soRef.toLowerCase()) return '';

  // Remove Inward Numbers: INW-2026-xxxx
  s = s.replace(/\bINW[-_]\d{4}[-_]\d+\b/gi, '').trim();

  // Remove Sales Order Numbers: SO-xxxx or SO_xxxx
  s = s.replace(/\bSO[-_]\d+[-_]?\d*\b/gi, '').trim();

  // Remove Project / Lead numbers with timestamp stamps: e.g. 1010-28Sep26-0994PM or 1010-14Oct26-1105AM
  s = s.replace(/\b\d{3,5}-\d{2}[A-Za-z]{3}\d{2}-\d{3,5}[AP]M\b/gi, '').trim();

  // If specific project_name or sales_order_ref was passed, strip them
  if (projName) {
    const escaped = projName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '').trim();
    const base = projName.split(/[-_]/)[0];
    if (base && base.length >= 3) {
      const escBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp(`\\b${escBase}\\b`, 'gi'), '').trim();
    }
  }
  if (soRef) {
    const escSo = soRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\b${escSo}\\b`, 'gi'), '').trim();
  }

  // Clean leading / trailing dashes, bullets, spaces
  s = s.replace(/^[\s\-•·]+|[\s\-•·]+$/g, '').trim();
  return s;
}

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
  source?: 'bank' | 'inward'; bank_name?: string; ledger_name?: string; ledger_type?: string;
  /** The company / vendor the money was paid to (shown in its own column, not inside the description). */
  company?: string;
  /** The member who paid out of pocket (own column). */
  paid_by?: string;
}

type Note = { kind: 'ok' | 'err'; text: string } | null;

export function PettyCashPage({ prefill }: { prefill?: { member: string; amount: number; nonce: number } | null } = {}) {
  const { setHeader, setTabActions } = useHeaderKpis();
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
  const [paidTo, setPaidTo] = useState('');

  // filters
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fBank, setFBank] = useState('');
  const [fLedger, setFLedger] = useState('');
  const [fType, setFType] = useState('');

  const accounts = options?.accounts ?? [];
  const canManage = !!options?.can_manage;
  const defaultCashAccount = useMemo(() =>
    accounts.find(a => a.type === 'Cash') ||
    chart.find(a => a.system_key === 'CASH' || a.name.toLowerCase().includes('cash')),
  [accounts, chart]);
  const ledgers = useMemo(() => chart.filter(a => !a.is_group && a.status === 'Active' && a.id !== bankId), [chart, bankId]);
  const label = (a: Account) => `${a.code} · ${a.name}`;
  const ledger = useMemo(() => ledgers.find(a => label(a) === ledgerText.trim()) ?? ledgers.find(a => a.name.toLowerCase() === ledgerText.trim().toLowerCase()), [ledgers, ledgerText]);
  const accName = useMemo(() => new Map(chart.map(a => [a.id, a])), [chart]);

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    try {
      const [bankRes, inwRes] = await Promise.all([
        supabase.from('cnc_bank_transactions')
          .select('id,txn_no,txn_date,direction,account_id,contra_account_id,amount,description,status,created_at,created_by,party_name')
          .eq('source_type', SOURCE).order('created_at', { ascending: false }).limit(1000),
        supabase.from('cnc_inwards')
          .select('id,inward_no,inward_date,petty_cash,paid_by,petty_amount,petty_date,category,party_name,part_name,product_name,project_name,sales_order_ref,total_amount,quantity,price,discount_percent,gst_percent,status,created_at')
          .eq('petty_cash', true).order('created_at', { ascending: false }).limit(1000),
      ]);
      if (bankRes.error) throw new Error(bankRes.error.message);
      if (inwRes.error) console.warn('Could not load inward petty cash entries:', inwRes.error.message);

      const bankRows: PettyRow[] = ((bankRes.data ?? []) as Record<string, unknown>[]).map(x => ({
        id: String(x.id), txn_no: String(x.txn_no ?? ''), txn_date: toISODate(x.txn_date) || todayISO(), direction: x.direction === 'IN' ? 'IN' : 'OUT',
        account_id: String(x.account_id ?? ''), contra_account_id: x.contra_account_id ? String(x.contra_account_id) : null,
        amount: Number(x.amount) || 0, description: (x.description as string) ?? '', status: String(x.status ?? ''),
        created_at: String(x.created_at ?? ''), created_by: (x.created_by as string) ?? null, source: 'bank', company: String(x.party_name ?? '').trim(),
      }));

      const inwData = inwRes.error ? [] : ((inwRes.data ?? []) as Record<string, unknown>[]);
      const inwRows: PettyRow[] = inwData.map(x => {
        const calcTotal = inwardLineTotal(x.quantity, x.price, x.discount_percent, x.gst_percent);
        const lineTotal = Number(x.total_amount) || calcTotal;
        const pAmt = x.petty_amount !== null && x.petty_amount !== undefined && String(x.petty_amount).trim() !== ''
          ? Number(x.petty_amount)
          : null;
        const amt = pAmt !== null ? pAmt : lineTotal;

        const inwNo = String(x.inward_no ?? '').trim();
        const projName = String(x.project_name ?? '').trim();
        const soRef = String(x.sales_order_ref ?? '').trim();

        const cleanPart = cleanItemDesc(String(x.part_name || '').trim(), projName, soRef, inwNo);
        const cleanProd = cleanItemDesc(String(x.product_name || '').trim(), projName, soRef, inwNo);

        let pName = cleanPart || cleanProd;
        if (cleanPart && cleanProd && cleanPart.toLowerCase() !== cleanProd.toLowerCase()) {
          pName = `${cleanProd} · ${cleanPart}`;
        }

        const vendor = String(x.party_name || '').trim();
        const paidBy = String(x.paid_by || '').trim();
        const category = String(x.category || '').trim();

        const descParts: string[] = [];
        if (pName) descParts.push(pName);
        else if (category) descParts.push(category);
        const desc0 = descParts.join(' · ');
        const desc = desc0 || category || 'Expense';

        const vDate = toISODate(x.petty_date) || toISODate(x.inward_date) || toISODate(x.created_at) || todayISO();

        return {
          id: String(x.id),
          txn_no: inwNo,
          txn_date: vDate,
          direction: 'OUT',
          account_id: '',
          contra_account_id: null,
          amount: amt,
          description: desc,
          company: vendor,
          paid_by: paidBy,
          status: String(x.status ?? 'Pending'),
          created_at: String(x.created_at ?? ''),
          created_by: paidBy || null,
          source: 'inward',
          bank_name: 'Cash in Hand',
          ledger_name: category || 'Company Expenses',
          ledger_type: 'Expense',
        };
      });

      const combined = [...bankRows, ...inwRows].sort((a, b) => {
        const ta = a.created_at || a.txn_date;
        const tb = b.created_at || b.txn_date;
        return tb.localeCompare(ta);
      });
      setRows(combined);
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

  // Money given to / returned by a member: pick the "Payable to Members" ledger and name the member. The member name is what
  // puts the entry on that member's balance (Members Petty Cash tab).
  const memberLedger = chart.find(a => a.system_key === 'MEMBER_PAYABLE');
  const isMemberLedger = !!ledger && !!memberLedger && ledger.id === memberLedger.id;
  // Who the money was paid to: a member (dropdown with "+ Add new member…", like the members list).
  const paidToOptions = useMemberNames(cid);

  // "Pay" from the Members tab: fill the form (debit = money out to the member).
  const usedPrefill = useRef(0);
  useEffect(() => {
    if (!prefill || usedPrefill.current === prefill.nonce || !memberLedger) return;
    usedPrefill.current = prefill.nonce;
    setLedgerText(label(memberLedger));
    setPaidTo(prefill.member);
    setDebit(String(Math.round(prefill.amount * 100) / 100));
    setCredit('');
    setDesc(`Petty cash paid to ${prefill.member}`);
    setDate(todayISO());
    setNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, memberLedger?.id]);

  const clearForm = () => { setDate(todayISO()); setDesc(''); setDebit(''); setCredit(''); setLedgerText(''); setPaidTo(''); setNote(null); };

  const save = async () => {
    setNote(null);
    const d = Number(debit.replace(/,/g, '')) || 0, c = Number(credit.replace(/,/g, '')) || 0;
    if (!date) return setNote({ kind: 'err', text: 'Choose the value date.' });
    const who = paidTo.trim();
    if (isMemberLedger && !who) return setNote({ kind: 'err', text: 'Choose who this money is paid to (the member).' });
    // A member entry describes itself when no description is typed.
    const text = desc.trim() || (isMemberLedger ? (c > 0 ? `Petty cash returned by ${who}` : `Petty cash given to ${who}`) : '');
    if (!text) return setNote({ kind: 'err', text: 'Enter a description.' });
    if (!bankId) return setNote({ kind: 'err', text: 'Select the bank / cash account.' });
    if (!ledger) return setNote({ kind: 'err', text: 'Choose a ledger from the list.' });
    if (d > 0 && c > 0) return setNote({ kind: 'err', text: 'Enter either a debit or a credit, not both.' });
    if (!(d > 0) && !(c > 0)) return setNote({ kind: 'err', text: 'Enter a debit or a credit amount.' });
    setSaving(true);
    try {
      await financeApi.addBankEntry({
        direction: c > 0 ? 'IN' : 'OUT', account_id: bankId, contra_account_id: ledger.id, amount: String(c > 0 ? c : d), txn_date: date,
        mode: 'Petty cash', description: text, status: 'Cleared', source_type: SOURCE,
        ...(isMemberLedger ? { party_type: 'Other', party_name: who } : who ? { party_type: 'Other', party_name: who } : {}),
      });
      setNote({ kind: 'ok', text: 'Entry saved and posted to the ledger.' });
      setDesc(''); setDebit(''); setCredit(''); setLedgerText(''); setPaidTo('');
      await load();
    } catch (e) { setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Could not save the entry.' }); }
    finally { setSaving(false); }
  };

  const cancelRow = async (r: PettyRow) => {
    const label = r.txn_no ? `entry ${r.txn_no}` : 'this entry';
    if (!window.confirm(`Delete ${label}? It is cancelled and reversed in the ledger.`)) return;
    try {
      if (r.source === 'inward') {
        const { error } = await supabase.from('cnc_inwards').update({ status: 'Deleted' }).eq('id', r.id);
        if (error) throw new Error(error.message);
      } else {
        await financeApi.bankSetStatus(r.id, 'Cancelled');
      }
      await load();
      setNote({ kind: 'ok', text: `${r.txn_no || 'Entry'} deleted.` });
    } catch (e) {
      setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Could not delete the entry.' });
    }
  };

  // Global Topbar range intersects this page's own From/To (either may be empty).
  const { from: globalFrom, to: globalTo } = useGlobalDateFilter();
  const { from: effFrom, to: effTo } = intersectRange(fFrom, fTo, globalFrom, globalTo);
  // What each row shows in its filterable columns (same rules as the cells below).
  const cellVals = (r: PettyRow) => {
    const la = r.contra_account_id ? accName.get(r.contra_account_id) : (r.ledger_name ? chart.find(a => a.name.toLowerCase() === r.ledger_name?.toLowerCase()) : null);
    return {
      company: r.company ?? '',
      paidBy: r.paid_by ?? '',
      bank: (accName.get(r.account_id) || (r.source === 'inward' ? defaultCashAccount : null))?.name || r.bank_name || 'Cash in Hand',
      ledger: la?.name || r.ledger_name || 'Company Expenses',
      type: la ? ledgerTypeOf(la) : (r.ledger_type || 'Expense'),
    };
  };
  type HeaderFilterKey = 'company' | 'paidBy' | 'bank' | 'ledger' | 'type';
  const [hf, setHf] = useState<Record<HeaderFilterKey, string>>({ company: '', paidBy: '', bank: '', ledger: '', type: '' });
  const hfOptions = useMemo(() => {
    const out: Record<HeaderFilterKey, string[]> = { company: [], paidBy: [], bank: [], ledger: [], type: [] };
    (Object.keys(out) as HeaderFilterKey[]).forEach(k => {
      out[k] = [...new Set(rows.map(r => cellVals(r)[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, accName, chart, defaultCashAccount]);
  const view = useMemo(() => rows.filter(r => {
    const cv = cellVals(r);
    if (hf.company && cv.company !== hf.company) return false;
    if (hf.paidBy && cv.paidBy !== hf.paidBy) return false;
    if (hf.bank && cv.bank !== hf.bank) return false;
    if (hf.ledger && cv.ledger !== hf.ledger) return false;
    if (hf.type && cv.type !== hf.type) return false;
    const rowDate = r.txn_date;
    if (effFrom && rowDate < effFrom) return false;
    if (effTo && rowDate > effTo) return false;
    const effBankId = r.account_id || (r.source === 'inward' ? defaultCashAccount?.id : '');
    if (fBank && effBankId !== fBank) return false;
    const effLedgerId = r.contra_account_id || (r.ledger_name ? chart.find(a => a.name.toLowerCase() === r.ledger_name?.toLowerCase())?.id : '');
    if (fLedger && effLedgerId !== fLedger) return false;
    const effType = r.contra_account_id ? ledgerTypeOf(accName.get(r.contra_account_id)) : (r.ledger_type || 'Expense');
    if (fType && effType !== fType) return false;
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, effFrom, effTo, fBank, fLedger, fType, defaultCashAccount, chart, accName, hf]);

  const live = view.filter(r => r.status !== 'Cancelled' && r.status !== 'Deleted');
  const totalDebit = live.filter(r => r.direction === 'OUT').reduce((n, r) => n + r.amount, 0);
  const totalCredit = live.filter(r => r.direction === 'IN').reduce((n, r) => n + r.amount, 0);

  // Money in / out and the net, in the top bar just before the Download Desktop App button:
  // green with "+" when the net is in, red with "−" when it is out. Follows the filters and date range below.
  useEffect(() => {
    const net = Math.round((totalCredit - totalDebit) * 100) / 100;
    const fmt = (n: number) => formatINR(Math.abs(n), { decimals: 'always', symbol: false });
    const pos = net >= 0;
    setTabActions(
      <div className="flex items-center gap-3 whitespace-nowrap" data-testid="pc-topbar-total" title={`Money in ${fmt(totalCredit)} · Money out ${fmt(totalDebit)}`}>
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Money In</span>
          <span className="text-base font-extrabold tabular-nums text-emerald-700">+ ₹{fmt(totalCredit)}</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-red-600">Money Out</span>
          <span className="text-base font-extrabold tabular-nums text-red-600">− ₹{fmt(totalDebit)}</span>
        </div>
        <div className={`flex items-center gap-2 rounded-lg border-2 px-4 py-1.5 ${pos ? 'border-emerald-400 bg-emerald-100' : 'border-red-400 bg-red-100'}`}>
          <span className={`text-[11px] font-bold uppercase tracking-wider ${pos ? 'text-emerald-800' : 'text-red-700'}`}>Total Balance</span>
          <span className={`text-lg font-black tabular-nums ${pos ? 'text-emerald-700' : 'text-red-600'}`}>{pos ? '+' : '−'} ₹{fmt(net)}</span>
        </div>
      </div>
    );
    return () => setTabActions(null);
  }, [totalCredit, totalDebit, setTabActions]);
  const filtersOn = !!(fFrom || fTo || fBank || fLedger || fType || Object.values(hf).some(Boolean));
  const clearFilters = () => { setFFrom(''); setFTo(''); setFBank(''); setFLedger(''); setFType(''); setHf({ company: '', paidBy: '', bank: '', ledger: '', type: '' }); };

  const exportRows = () => {
    if (!view.length) return;
    exportCsv(`petty-cash-${todayISO()}`, [['Entry No', 'Timestamp', 'Value Date', 'Description', 'Paid To', 'Paid By', 'Debit', 'Credit', 'Bank Name', 'Ledger Name', 'Ledger Type', 'Status'],
      ...view.map(r => {
        const bankName = (accName.get(r.account_id) || (r.source === 'inward' ? defaultCashAccount : null))?.name || r.bank_name || 'Cash in Hand';
        const la = r.contra_account_id ? accName.get(r.contra_account_id) : (r.ledger_name ? chart.find(a => a.name.toLowerCase() === r.ledger_name?.toLowerCase()) : null);
        const ledgerName = la?.name || r.ledger_name || 'Company Expenses';
        const ledgerType = la ? ledgerTypeOf(la) : (r.ledger_type || 'Expense');
        return [
          r.txn_no,
          stamp(r.created_at),
          dmy(r.txn_date),
          r.description ?? '',
          r.company ?? '',
          r.paid_by ?? '',
          r.direction === 'OUT' ? r.amount : '',
          r.direction === 'IN' ? r.amount : '',
          bankName,
          ledgerName,
          ledgerType,
          r.status,
        ];
      })]);
  };

  const typeOptions = ['Expense', 'Income', 'Receivable', 'Payable', 'Asset', 'Liability', 'Equity'];

  return (
    <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full">
      <div className="w-full flex flex-col gap-2">
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
              <div className="w-[200px] shrink-0">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Paid to{isMemberLedger && <span className="text-red-500"> *</span>}</label>
                <MemberSelect className="w-full h-8 px-2 text-xs text-slate-800 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" placeholder="Select member" options={paidToOptions} value={paidTo} onChange={setPaidTo} />
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
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Petty cash details <span className="ml-2 text-xs font-medium normal-case text-slate-500" data-testid="pc-count">{view.length} entr{view.length === 1 ? 'y' : 'ies'}</span></h2>
            <button type="button" className={`${btn} !h-9 text-slate-700 bg-white border border-slate-200 hover:bg-slate-50`} onClick={exportRows} disabled={!view.length}><Upload size={14} />Export CSV</button>
          </div>
          {loadErr && <div role="alert" className="m-4 flex items-start gap-2 text-sm rounded-xl border border-red-200 bg-red-50 text-red-800 px-3.5 py-2.5"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{loadErr}</span></div>}
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-290px)]">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-100/90 sticky top-0 z-10 shadow-[0_1px_0_#e2e8f0]"><tr className="text-left">
                {([
                  { label: 'Timestamp' }, { label: 'Value Date' }, { label: 'Description' },
                  { label: 'Paid To', fk: 'company' }, { label: 'Paid By', fk: 'paidBy' },
                  { label: 'Debit', right: true }, { label: 'Credit', right: true },
                  { label: 'Bank Name', fk: 'bank' }, { label: 'Ledger Name', fk: 'ledger' }, { label: 'Ledger Type', fk: 'type' },
                  { label: 'Actions' },
                ] as { label: string; fk?: HeaderFilterKey; right?: boolean }[]).map(h => (
                  <th key={h.label} className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 whitespace-nowrap ${h.right ? 'text-right' : ''}`}>
                    {h.label}
                    {h.fk && hfOptions[h.fk].length > 0 && (
                      <select
                        value={hf[h.fk]}
                        onChange={e => { const k = h.fk as HeaderFilterKey; const v = e.target.value; setHf(f => ({ ...f, [k]: v })); }}
                        aria-label={`Filter ${h.label}`}
                        className={`ml-1 h-5 max-w-[84px] rounded border bg-white px-0.5 text-[10px] font-semibold normal-case tracking-normal text-slate-800 focus:outline-none ${hf[h.fk] ? 'border-orange-500 ring-1 ring-orange-400' : 'border-slate-300'}`}
                      >
                        <option value="">All</option>
                        {hfOptions[h.fk].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    )}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {view.map(r => {
                  const cancelled = r.status === 'Cancelled' || r.status === 'Deleted';
                  const la = r.contra_account_id
                    ? accName.get(r.contra_account_id)
                    : (r.ledger_name ? chart.find(a => a.name.toLowerCase() === r.ledger_name?.toLowerCase()) : null);
                  const bankDisplayName = (accName.get(r.account_id) || (r.source === 'inward' ? defaultCashAccount : null))?.name || r.bank_name || 'Cash in Hand';
                  const ledgerDisplayName = la?.name || r.ledger_name || 'Company Expenses';
                  const ledgerTypeDisplay = la ? ledgerTypeOf(la) : (r.ledger_type || 'Expense');
                  return (
                    <tr key={`${r.source || 'bank'}-${r.id}`} data-testid="pc-row" className={`border-t border-slate-100 ${cancelled ? 'opacity-50 line-through' : 'hover:bg-slate-50'}`}>
                      <td className="px-2 py-1 whitespace-nowrap text-slate-500">{stamp(r.created_at)}</td>
                      <td className="px-2 py-1 whitespace-nowrap font-medium">{dmy(r.txn_date)}</td>
                      <td className="px-2 py-1 max-w-[230px] truncate" title={r.description ?? ''}>
                        <span>{r.description}</span>
                      </td>
                      <td className="px-2 py-1 max-w-[190px] truncate font-medium text-slate-800" title={r.company ?? ''}>{r.company || ''}</td>
                      <td className="px-2 py-1 max-w-[160px] truncate text-slate-700" title={r.paid_by ?? ''}>{r.paid_by || ''}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-semibold text-red-600">{r.direction === 'OUT' ? money(r.amount) : ''}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-semibold text-emerald-600">{r.direction === 'IN' ? money(r.amount) : ''}</td>
                      <td className="px-2 py-1">{bankDisplayName}</td>
                      <td className="px-2 py-1">{ledgerDisplayName}</td>
                      <td className="px-2 py-1">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-slate-50 text-slate-600 border-slate-200">
                          {ledgerTypeDisplay}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        {!cancelled && canManage && (
                          <button
                            type="button"
                            aria-label={`Delete ${r.txn_no || 'entry'}`}
                            title="Delete entry"
                            onClick={() => void cancelRow(r)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                        {cancelled && <span className="text-[11px] font-semibold text-slate-500 no-underline">Deleted</span>}
                      </td>
                    </tr>
                  );
                })}
                {!loading && view.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-8 text-center"><Inbox size={28} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-semibold text-slate-600">{filtersOn ? 'No entries match these filters' : 'No petty cash entries yet'}</p></td></tr>
                )}
                {loading && view.length === 0 && <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              </tbody>
              {view.length > 0 && (
                <tfoot className="sticky bottom-0 bg-slate-100 border-t border-slate-300 font-bold">
                  <tr><td colSpan={5} className="px-2 py-1 text-right text-slate-600">Total</td>
                    <td className="px-2 py-1 text-right tabular-nums text-red-600" data-testid="pc-debit">{money(totalDebit) || '0.00'}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-emerald-600" data-testid="pc-credit">{money(totalCredit) || '0.00'}</td>
                    <td colSpan={4} className="px-2 py-1 text-slate-500 font-medium">Deleted entries are not counted</td></tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

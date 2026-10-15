import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Landmark, Tags, Layers, BookOpen, PenLine, UploadCloud, FileText, Save, Table2, Eraser, FileDown, FileSpreadsheet, RefreshCw, Wand2, Search, Filter, CheckCircle2, AlertTriangle, Info, Inbox } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { financeApi, type BankFilters, type BankRow } from '@/lib/finance';
import { accountingApi, type Account } from '@/lib/accounting';
import { formatINR, todayISO } from '@/lib/format';
import { exportCsv } from '@/lib/reportExport';
import { xlsxToTsv } from '@/lib/xlsxRead';
import { supabase } from '@/lib/supabase';
import { suggestRows, type LedgerRef, type PartyRef } from '@/lib/bankSuggest';
import {
  applyTypeDefaults, loadOthers, loadTypes, parseStatement, rowDirection, saveOthers, saveTypes, typeFitsRow, validateRows,
  type EntryType, type ImportRow, type Other, type RowIssue,
} from '@/lib/bankImport';

// Bank Entry: paste or upload a statement, tag each row with a Type and ledger, save it as bank transactions,
// and browse / filter / export the saved bank data. Saving uses the same erp_add_bank_entry as Manual Entry,
// so every entry posts to the ledger exactly like a manually added one.

const btn = 'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 text-[13px] font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 h-9 px-5 text-[13px] font-bold text-white bg-gradient-to-b from-orange-500 to-orange-600 rounded-lg shadow-md shadow-orange-500/25 hover:from-orange-500 hover:to-orange-700 active:scale-[0.98] transition disabled:opacity-40 disabled:shadow-none';
const sel = 'h-9 px-3 text-[13px] font-medium text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15';
const inp = 'h-9 px-3 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15';
const th = 'px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500';
const money = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '' : formatINR(n, { decimals: 'always', symbol: false }));
const dmy = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('-') : '');
const isoDaysAgo = (months: number) => { const d = new Date(); d.setMonth(d.getMonth() - months); return d.toISOString().slice(0, 10); };
const ERR_STATUS = /error|bounce|fail|reject/i;

type Msg = { kind: 'ok' | 'err' | 'info'; text: string } | null;

export function BankEntryPage() {
  const { company } = useAuth();
  const cid = company?.id ?? null;
  const navigate = useNavigate();

  const [options, setOptions] = useState<BankFilters | null>(null);
  const [bankId, setBankId] = useState('');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [showTable, setShowTable] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [types, setTypes] = useState<EntryType[]>(() => loadTypes(cid));
  const [others, setOthers] = useState<Other[]>(() => loadOthers(cid));
  const [existing, setExisting] = useState<BankRow[]>([]);
  const [modal, setModal] = useState<null | 'banks' | 'types' | 'others' | 'ledger' | 'manual'>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { setHeader, setTabActions } = useHeaderKpis();

  useEffect(() => {
    setHeader({
      title: 'Bank Entry',
    });
    setTabActions(
      <div className="flex items-center gap-1.5">
        <button className="h-7 px-2.5 text-xs font-semibold rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer" onClick={() => setModal('banks')}><Landmark size={13} className="text-slate-500" /> Manage Banks</button>
        <button className="h-7 px-2.5 text-xs font-semibold rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer" onClick={() => setModal('types')}><Tags size={13} className="text-slate-500" /> Manage Types</button>
        <button className="h-7 px-2.5 text-xs font-semibold rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer" onClick={() => { setOthers(loadOthers(cid)); setModal('others'); }}><Layers size={13} className="text-slate-500" /> Manage Others</button>
        <button className="h-7 px-2.5 text-xs font-semibold rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer" onClick={() => setModal('ledger')}><BookOpen size={13} className="text-slate-500" /> Ledger Details</button>
        <button className="h-7 px-2.5 text-xs font-semibold rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer" onClick={() => setModal('manual')}><PenLine size={13} className="text-slate-500" /> Manual Entry</button>
      </div>
    );
    return () => {
      setHeader(null);
      setTabActions(null);
    };
  }, [setHeader, setTabActions, cid]);

  // Registered companies (with GSTIN) and the two control ledgers, used to suggest each row's ledger and party.
  const [partyRefs, setPartyRefs] = useState<PartyRef[]>([]);
  const [receivable, setReceivable] = useState<LedgerRef | undefined>();
  const [payable, setPayable] = useState<LedgerRef | undefined>();
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const gstOf = (r: Record<string, unknown>) => String(r.gst_number ?? r.gstin ?? r.gst ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const [c, su, chart] = await Promise.all([
          supabase.from('cnc_customers').select('*'),
          supabase.from('cnc_suppliers').select('*'),
          accountingApi.chartOfAccounts(),
        ]);
        if (off) return;
        const list: PartyRef[] = [
          ...((c.error ? [] : c.data) ?? []).map((r: Record<string, unknown>) => ({ id: String(r.id), name: String(r.name ?? '').trim(), gst: gstOf(r), kind: 'Customer' as const })),
          ...((su.error ? [] : su.data) ?? []).map((r: Record<string, unknown>) => ({ id: String(r.id), name: String(r.name ?? '').trim(), gst: gstOf(r), kind: 'Supplier' as const })),
        ].filter(x => x.name);
        setPartyRefs(list);
        const pick = (key: string) => { const a = chart.find(x => x.system_key === key && !x.is_group); return a ? { id: a.id, code: a.code, name: a.name } : undefined; };
        setReceivable(pick('TRADE_RECEIVABLES')); setPayable(pick('TRADE_PAYABLES'));
      } catch { /* suggestions fall back to keywords only */ }
    })();
    return () => { off = true; };
  }, [cid]);
  const suggestCtx = () => ({ parties: partyRefs, receivable, payable, income: options?.income_accounts ?? [], expense: options?.expense_accounts ?? [], types, others, ownName: company?.company_name });

  // Bank Data
  const [data, setData] = useState<BankRow[]>([]);
  const [dataTotal, setDataTotal] = useState(0);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState('');
  const [fBank, setFBank] = useState('');
  const [fKind, setFKind] = useState('');
  const [onlyErr, setOnlyErr] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [full, setFull] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const o = await financeApi.bankFilters();
      setOptions(o);
      setBankId(b => b || o.accounts.find(a => a.type === 'Bank')?.id || o.accounts[0]?.id || '');
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not load bank accounts.' }); }
  }, []);
  useEffect(() => { void loadOptions(); setTypes(loadTypes(cid)); setOthers(loadOthers(cid)); }, [cid, loadOptions]);

  const loadData = useCallback(async (everything = false) => {
    setLoadingData(true); setDataError('');
    try {
      const args = { account: fBank || null, kind: fKind || null, from: from || undefined, to: to || undefined };
      if (!everything) {
        const r = await financeApi.bankTransactions({ ...args, page: 1, pageSize: 50 });
        setData(r.rows); setDataTotal(r.total); setFull(r.rows.length >= r.total);
      } else {
        const all: BankRow[] = []; let total = 0;
        for (let page = 1; page <= 25; page++) {
          const r = await financeApi.bankTransactions({ ...args, page, pageSize: 200 });
          total = r.total; all.push(...r.rows);
          if (all.length >= total || r.rows.length === 0) break;
        }
        setData(all); setDataTotal(total); setFull(all.length >= total);
      }
    } catch (e) { setData([]); setDataTotal(0); setDataError(e instanceof Error ? e.message : 'Could not load bank data.'); }
    finally { setLoadingData(false); }
  }, [fBank, fKind, from, to]);
  useEffect(() => { void loadData(false); }, [loadData, cid]);

  const bank = options?.accounts.find(a => a.id === bankId);
  const issues = useMemo(() => validateRows(rows, existing.map(e => ({ txn_date: e.txn_date, amount: e.amount, direction: e.direction, reference_no: e.reference_no }))), [rows, existing]);
  const errCount = rows.filter(r => (issues.get(r.id) ?? []).length > 0).length;
  const okCount = rows.length - errCount;

  const incomeOpts = options?.income_accounts ?? [];
  const expenseOpts = options?.expense_accounts ?? [];
  const ledgerChoices = (r: ImportRow) => (rowDirection(r) === 'IN' ? incomeOpts : rowDirection(r) === 'OUT' ? expenseOpts : [...incomeOpts, ...expenseOpts]);
  const ledgerOptions = (r: ImportRow) => (<>
    <option value="">—</option>
    {receivable && <optgroup label="Receivable (customers)"><option value={receivable.id}>{receivable.code} {receivable.name}</option></optgroup>}
    {payable && <optgroup label="Payable (suppliers)"><option value={payable.id}>{payable.code} {payable.name}</option></optgroup>}
    <optgroup label={rowDirection(r) === 'IN' ? 'Income' : rowDirection(r) === 'OUT' ? 'Expense' : 'Income / Expense'}>{ledgerChoices(r).map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</optgroup>
  </>);
  const parties = useMemo(() => Array.from(new Set([...others.map(o => o.name), ...(options?.customers ?? []).map(c => c.name), ...(options?.suppliers ?? []).map(s => s.name)])).filter(Boolean), [others, options]);

  const readExisting = async (list: ImportRow[]) => {
    const dates = list.map(r => r.date).filter((d): d is string => !!d).sort();
    if (!dates.length || !bankId) { setExisting([]); return []; }
    try {
      const all: BankRow[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await financeApi.bankTransactions({ account: bankId, from: dates[0], to: dates[dates.length - 1], page, pageSize: 200 });
        all.push(...r.rows); if (all.length >= r.total || !r.rows.length) break;
      }
      setExisting(all); return all;
    } catch { setExisting([]); return []; }
  };

  const parseNow = async (src = text): Promise<ImportRow[]> => {
    const p = parseStatement(src);
    if (!p.rows.length) { setRows([]); setMsg({ kind: 'err', text: 'Nothing to read. Paste rows (TAB or comma separated) or choose a file first.' }); return []; }
    const withTypes = suggestRows(applyTypeDefaults(p.rows, types), suggestCtx());
    const auto = withTypes.filter(r => r.auto).length;
    setRows(withTypes); setShowTable(true);
    await readExisting(withTypes);
    setMsg({ kind: 'info', text: `${p.rows.length} row${p.rows.length === 1 ? '' : 's'} read${auto ? ` · ${auto} filled in automatically (marked ✨ — check them)` : ''}${p.warnings.length ? ' · ' + p.warnings.join(' ') : ''}` });
    return withTypes;
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setMsg({ kind: 'err', text: 'File is larger than 5 MB.' }); return; }
    if (!/\.(csv|tsv|txt|xlsx)$/i.test(f.name)) { setMsg({ kind: 'err', text: 'Choose an .xlsx, .csv, .tsv or .txt statement. For an old .xls file, use Save As .xlsx or CSV first.' }); return; }
    let t: string;
    try { t = /\.xlsx$/i.test(f.name) ? await xlsxToTsv(await f.arrayBuffer()) : await f.text(); }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message || 'Could not read this file.' }); return; }
    setText(t); setMsg({ kind: 'info', text: `Loaded ${f.name}. Click “View full Table” to check the rows.` });
  };

  const patchRow = (id: string, patch: Partial<ImportRow>) => setRows(rs => rs.map(r => {
    if (r.id !== id) return r;
    const next = { ...r, ...patch };
    if (patch.typeId !== undefined || patch.ledgerId !== undefined || patch.party !== undefined) delete next.auto;
    if (patch.typeId !== undefined) {
      const t = types.find(x => x.id === patch.typeId);
      if (t && !typeFitsRow(t, next)) { setMsg({ kind: 'err', text: `Type “${t.name}” is for ${t.direction === 'IN' ? 'money in' : 'money out'}, but row ${r.line} is the opposite.` }); return r; }
      if (t && t.ledgerId) next.ledgerId = t.ledgerId;
    }
    return next;
  }));

  const updateEntries = async () => {
    if (!rows.length) { setMsg({ kind: 'err', text: 'No rows to update. Click “View full Table” first.' }); return; }
    setBusy(true);
    const re = suggestRows(applyTypeDefaults(rows, types), suggestCtx());
    setRows(re); await readExisting(re);
    setBusy(false);
    setMsg({ kind: 'ok', text: 'Entries updated: type defaults applied and every row re-checked against saved bank data.' });
  };

  const save = async () => {
    if (!bankId) { setMsg({ kind: 'err', text: 'Select a bank first.' }); return; }
    let list = rows;
    if (!list.length) list = await parseNow();
    if (!list.length) return;
    const ex = await readExisting(list);
    const iss = validateRows(list, ex.map(e => ({ txn_date: e.txn_date, amount: e.amount, direction: e.direction, reference_no: e.reference_no })));
    const good = list.filter(r => (iss.get(r.id) ?? []).length === 0);
    if (!good.length) { setShowTable(true); setMsg({ kind: 'err', text: 'No row is ready to save. Fix the highlighted rows (type/ledger, date, amount) first.' }); return; }
    setBusy(true);
    const savedIds = new Set<string>(); const failed: string[] = [];
    for (const r of good) {
      const dir = rowDirection(r)!; const t = types.find(x => x.id === r.typeId);
      const cust = options?.customers.find(c => c.name === r.party); const sup = options?.suppliers.find(s => s.name === r.party);
      try {
        await financeApi.addBankEntry({
          direction: dir, account_id: bankId, contra_account_id: r.ledgerId || '', amount: String(dir === 'IN' ? r.credit : r.debit), txn_date: r.date,
          party_type: cust ? 'Customer' : sup ? 'Supplier' : r.party ? (/^internal$/i.test(others.find(o => o.name === r.party)?.kind ?? '') ? 'Internal' : 'Other') : '', party_name: r.party, customer_id: cust?.id ?? '', supplier_id: sup?.id ?? '',
          mode: 'Statement import', reference_no: r.reference, description: [t?.name, r.description].filter(Boolean).join(' - '), status: 'Cleared', source_type: 'bank_import',
        });
        savedIds.add(r.id);
      } catch (e) { failed.push(`row ${r.line}: ${e instanceof Error ? e.message : 'failed'}`); }
    }
    setBusy(false);
    setRows(list.filter(r => !savedIds.has(r.id)));
    await readExisting(list.filter(r => !savedIds.has(r.id)));
    const skipped = list.length - good.length;
    setMsg({ kind: failed.length ? 'err' : 'ok', text: `Saved ${savedIds.size} entr${savedIds.size === 1 ? 'y' : 'ies'}${skipped ? ` · ${skipped} row${skipped === 1 ? '' : 's'} with errors left in the table` : ''}${failed.length ? ` · ${failed.length} failed: ${failed.slice(0, 3).join('; ')}` : ''}.` });
    if (!list.some(r => !savedIds.has(r.id))) setText('');
    void loadData(full);
  };

  const clearText = () => { setText(''); setRows([]); setShowTable(false); setExisting([]); setMsg(null); if (fileRef.current) fileRef.current.value = ''; };

  const shownData = data.filter(r => (!onlyErr || ERR_STATUS.test(r.status)));
  const kinds = useMemo(() => Array.from(new Set(data.map(r => r.kind).filter(Boolean))).sort(), [data]);
  const shownRows = rows.filter(r => !onlyErr || (issues.get(r.id) ?? []).length > 0);

  // A ready-to-fill sample in the usual bank-statement layout; the importer reads it as is.
  const downloadSample = () => {
    exportCsv('bank-statement-sample', [
      ['Txn Date', 'Value Date', 'Cheque No.', 'Description', 'Branch Code', 'Debit', 'Credit', 'Balance'],
      ['03-01-2024 12:39', '03-Jan-24', '', 'UPI/CR/400300688546/SAMPLE CUSTOMER', '33', '', 3500, 103500],
      ['04-01-2024 07:43', '04-Jan-24', '3176', 'By Clg:CHN ACCT SEC-SAMPLE BANK', '1760', '', 77111, 180611],
      ['04-01-2024 23:37', '04-Jan-24', '', 'NEFT DR-SAMPLE SUPPLIER', '16138', 31083.89, '', 149527.11],
      ['08-01-2024 12:55', '08-Jan-24', '', 'IB ITG SAMPLE TRANSFER', '16138', 46000, '', 103527.11],
    ]);
  };

  const downloadCsv = () => {
    if (!shownData.length) { setMsg({ kind: 'err', text: 'No bank data to download.' }); return; }
    exportCsv(`bank-data-${todayISO()}`, [
      ['Txn No', 'Date', 'Bank', 'Type', 'Party', 'Reference', 'Description', 'Debit (out)', 'Credit (in)', 'Balance', 'Status'],
      ...shownData.map(r => [r.txn_no, dmy(r.txn_date), r.account_name, r.kind, r.party_name ?? '', r.reference_no ?? '', r.description ?? '', r.direction === 'OUT' ? r.amount : '', r.direction === 'IN' ? r.amount : '', r.balance ?? '', r.status]),
    ]);
  };
  const downloadPdf = async () => {
    if (!shownData.length) { setMsg({ kind: 'err', text: 'No bank data to download.' }); return; }
    try {
      const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      pdf.setFontSize(13); pdf.text(`Bank Data${bank ? ' - ' + bank.name : ''}`, 14, 14);
      pdf.setFontSize(8); pdf.text(`${company?.company_name ?? ''}  |  ${dmy(from) || 'start'} to ${dmy(to) || 'today'}  |  ${shownData.length} rows`, 14, 19);
      autoTable(pdf, {
        startY: 23, styles: { fontSize: 7.5, cellPadding: 1.4 }, headStyles: { fillColor: [51, 65, 85] },
        head: [['Txn No', 'Date', 'Bank', 'Type', 'Party', 'Ref', 'Description', 'Debit', 'Credit', 'Balance', 'Status']],
        body: shownData.map(r => [r.txn_no, dmy(r.txn_date), r.account_name, r.kind, r.party_name ?? '', r.reference_no ?? '', (r.description ?? '').slice(0, 40), r.direction === 'OUT' ? Number(r.amount).toFixed(2) : '', r.direction === 'IN' ? Number(r.amount).toFixed(2) : '', r.balance ?? '', r.status]),
        columnStyles: { 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } },
      });
      pdf.save(`bank-data-${todayISO()}.pdf`);
    } catch (e) { setMsg({ kind: 'err', text: `Could not create the PDF: ${(e as Error).message}` }); }
  };

  const range = (months: number) => { setFrom(isoDaysAgo(months)); setTo(todayISO()); };
  const clearFilters = () => { setFBank(''); setFKind(''); setOnlyErr(false); setFrom(''); setTo(''); };

  const issueBadge = (is: RowIssue[]) => is.length === 0
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><CheckCircle2 size={12} /> OK</span>
    : <span className="inline-flex flex-wrap gap-1" data-testid="row-issue">{is.map(i => <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200"><AlertTriangle size={11} />{i}</span>)}</span>;
  const statusPill = (st: string) => (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${ERR_STATUS.test(st) ? 'bg-red-50 text-red-700 border-red-200' : /pend/i.test(st) ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{st}</span>
  );
  const topBtn = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <button className={`${btn} !rounded-full !h-9`} onClick={onClick}>{icon}{label}</button>
  );
  const msgTone = msg?.kind === 'err' ? 'bg-red-50 border-red-200 text-red-800' : msg?.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-sky-50 border-sky-200 text-sky-800';
  const inTotal = shownData.filter(r => r.direction === 'IN').reduce((n, r) => n + Number(r.amount || 0), 0);
  const outTotal = shownData.filter(r => r.direction === 'OUT').reduce((n, r) => n + Number(r.amount || 0), 0);
  const quick = (months: number, label: string) => {
    const active = from === isoDaysAgo(months) && to === todayISO();
    return <button key={label} type="button" className={`h-7 px-2 text-[11px] font-semibold rounded-md border transition whitespace-nowrap cursor-pointer ${active ? 'bg-orange-500 text-white border-orange-500 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`} onClick={() => range(months)}>{label}</button>;
  };

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <div className="space-y-2 max-w-[1500px] mx-auto">
        {/* ---------- header (mobile/tablet fallback; desktop is unified in topbar) ---------- */}
        <div className="flex lg:hidden flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 text-white flex items-center justify-center shadow-lg shadow-orange-500/25"><Landmark size={22} /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Bank Entry</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {topBtn(<Landmark size={14} />, 'Manage Banks', () => setModal('banks'))}
            {topBtn(<Tags size={14} />, 'Manage Types', () => setModal('types'))}
            {topBtn(<Layers size={14} />, 'Manage Others', () => { setOthers(loadOthers(cid)); setModal('others'); })}
            {topBtn(<BookOpen size={14} />, 'Ledger Details', () => setModal('ledger'))}
            {topBtn(<PenLine size={14} />, 'Manual Entry', () => setModal('manual'))}
          </div>
        </div>

        {/* ---------- import ---------- */}
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex flex-wrap items-center gap-2">
            <UploadCloud size={16} className="text-orange-500" /><h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Import statement</h2>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <button className={btnPrimary} disabled={busy} onClick={() => void save()}><Save size={14} />{busy ? 'Saving…' : 'Save'}</button>
              <button className={btn} disabled={busy} onClick={() => void parseNow()}><Table2 size={14} />View full Table</button>
              <button className={btn} onClick={clearText}><Eraser size={14} />Clear Text</button>
              <span className="w-px h-6 bg-slate-200 mx-1" />
              <button className={btn} onClick={downloadCsv}><FileSpreadsheet size={14} />Download CSV</button>
              <button className={btn} onClick={() => void downloadPdf()}><FileDown size={14} />Download PDF</button>
              <button className={btn} disabled={busy} onClick={() => void updateEntries()}><Wand2 size={14} />Update entries</button>
            </div>
          </div>
          <div className="p-3">
            <div className="flex flex-wrap xl:flex-nowrap items-stretch gap-2">
              <label className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 hover:border-orange-400 hover:bg-orange-50/30 transition px-2.5 py-1.5 cursor-pointer shrink-0">
                <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center text-orange-500 shrink-0"><FileText size={16} /></div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 whitespace-nowrap">Choose a statement file <span className="font-normal text-slate-400">· xlsx, csv, tsv, txt ≤ 5 MB</span></p>
                  <button type="button" data-testid="download-sample" onClick={downloadSample}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 hover:text-orange-700 hover:underline">
                    <FileDown size={12} /> Download sample format
                  </button>
                  <input ref={fileRef} type="file" aria-label="Statement file" accept=".xlsx,.csv,.tsv,.txt" onChange={e => void onFile(e.target.files?.[0])} className="mt-0.5 block text-[11px] text-slate-600 file:mr-2 file:h-7 file:px-2.5 file:rounded-lg file:border file:border-slate-200 file:bg-white file:text-xs file:font-semibold file:text-slate-700 file:cursor-pointer" />
                </div>
              </label>
              <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 flex flex-wrap items-center gap-2 shrink-0">
                <div className="min-w-[10rem]">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Post into</p>
                  <select aria-label="Select bank" className={`${sel} w-full !py-1.5 !text-xs`} value={bankId} onChange={e => { setBankId(e.target.value); setExisting([]); }}>
                    <option value="">-- Select Bank --</option>
                    {(options?.accounts ?? []).map(a => <option key={a.id} value={a.id}>{a.name}{a.type === 'Cash' ? ' (Cash)' : ''}</option>)}
                  </select>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Balance</p>
                  <p className="text-base font-bold text-slate-900 tabular-nums" data-testid="bank-balance">{bank ? `₹${money(bank.balance)}` : '—'}</p>
                </div>
                <button className={`${btn} !px-2.5`} aria-label="Refresh" onClick={() => void loadOptions().then(() => loadData(full))}><RefreshCw size={14} /> Refresh</button>
              </div>
              <textarea aria-label="Statement rows" value={text} onChange={e => setText(e.target.value)} rows={2}
                placeholder="Paste rows here - use TAB or comma separated columns"
                className="flex-1 min-w-[12rem] p-2 text-xs font-mono leading-relaxed text-slate-800 bg-slate-50/60 border border-slate-200 rounded-lg resize-y focus:outline-none focus:bg-white focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15" />
            </div>

            {msg && (
              <div role="status" data-testid="bank-msg" className={`mt-2 flex items-start gap-2 text-sm rounded-xl border px-3.5 py-2.5 ${msgTone}`}>
                {msg.kind === 'err' ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : msg.kind === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <Info size={16} className="mt-0.5 shrink-0" />}
                <span>{msg.text}</span>
              </div>
            )}
          </div>
        </section>

        {/* ---------- preview grid ---------- */}
        {showTable && rows.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden" data-testid="import-grid">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold text-slate-800">{rows.length} rows</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200" data-testid="ok-count">{okCount} ready</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${errCount ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`} data-testid="err-count">{errCount} with errors</span>
              </div>
              <span className="text-xs text-slate-500">Choose a Type or a Ledger for every row, then Save. Rows with errors are not saved.</span>
            </div>
            <div className="overflow-auto max-h-[440px]">
              <table className="w-full text-xs min-w-[1100px]">
                <thead className="bg-slate-50/95 backdrop-blur sticky top-0 z-10 shadow-[0_1px_0_#e2e8f0]"><tr className="text-left">
                  {['#', 'Date', 'Description', 'Reference', 'Debit', 'Credit', 'Type', 'Ledger', 'Party / Other', 'Status'].map((h, i) => <th key={h} className={`${th} ${i === 4 || i === 5 ? 'text-right' : ''}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {shownRows.map(r => {
                    const is = issues.get(r.id) ?? [];
                    return (
                      <tr key={r.id} data-testid="import-row" className={`border-t border-slate-100 transition ${is.length ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50'}`}>
                        <td className="px-3 py-2 text-slate-400 tabular-nums">{r.line}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium">{r.date ? dmy(r.date) : <span className="text-red-600">{r.rawDate || '—'}</span>}</td>
                        <td className="px-3 py-2 max-w-[260px] truncate text-slate-700" title={r.description}>{r.auto && <span data-testid="auto-mark" title={`Filled in automatically: ${r.auto}`} className="mr-1 cursor-help text-orange-500">✨</span>}{r.description}</td>
                        <td className="px-3 py-2 font-mono text-slate-500">{r.reference}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">{Number.isNaN(r.debit) ? '?' : r.debit ? money(r.debit) : ''}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600">{Number.isNaN(r.credit) ? '?' : r.credit ? money(r.credit) : ''}</td>
                        <td className="px-3 py-1.5"><select aria-label={`Type row ${r.line}`} className={`${sel} !h-8 w-40`} value={r.typeId} onChange={e => patchRow(r.id, { typeId: e.target.value })}>
                          <option value="">—</option>{types.filter(t => typeFitsRow(t, r)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
                        <td className="px-3 py-1.5"><select aria-label={`Ledger row ${r.line}`} className={`${sel} !h-8 w-48`} value={r.ledgerId} onChange={e => patchRow(r.id, { ledgerId: e.target.value })}>
                          {ledgerOptions(r)}</select></td>
                        <td className="px-3 py-1.5"><input aria-label={`Party row ${r.line}`} list="bank-parties" className={`${inp} !h-8 w-36`} value={r.party} onChange={e => patchRow(r.id, { party: e.target.value })} /></td>
                        <td className="px-3 py-2">{issueBadge(is)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <datalist id="bank-parties">{parties.map(pn => <option key={pn} value={pn} />)}</datalist>
          </section>
        )}

        {/* ---------- bank data ---------- */}
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70 flex items-center gap-2.5 overflow-x-auto min-w-0">
            {/* Totals */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold tabular-nums whitespace-nowrap">In ₹{money(inTotal)}</span>
              <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-[11px] font-bold tabular-nums whitespace-nowrap">Out ₹{money(outTotal)}</span>
            </div>

            <span className="h-5 w-px bg-slate-200 shrink-0 mx-0.5" aria-hidden="true" />

            {/* Load Full Data */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button className="h-7 px-2.5 text-xs font-semibold rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-sm transition disabled:opacity-40 whitespace-nowrap cursor-pointer" disabled={loadingData} onClick={() => void loadData(true)}>
                {loadingData ? 'Loading…' : 'Load Full Data'}
              </button>
              <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap" data-testid="data-count">
                {loadingData ? '' : `${shownData.length} shown${dataTotal > data.length ? ` of ${dataTotal}` : ''}`}
              </span>
            </div>

            <span className="h-5 w-px bg-slate-200 shrink-0 mx-0.5" aria-hidden="true" />

            {/* Filters */}
            <div className="flex items-center gap-2 shrink-0">
              <Filter size={13} className="text-slate-400 shrink-0" />
              <select aria-label="Filter bank" className="h-7 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400 w-44 truncate cursor-pointer" value={fBank} onChange={e => setFBank(e.target.value)}>
                <option value="">-- All Banks / Types --</option>
                {(options?.accounts ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select aria-label="Filter ledger type" className="h-7 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400 w-40 truncate cursor-pointer" value={fKind} onChange={e => setFKind(e.target.value)}>
                <option value="">-- All Ledger Types --</option>
                {kinds.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs font-medium text-slate-600 cursor-pointer whitespace-nowrap px-1">
                <input type="checkbox" aria-label="Only error rows" className="accent-orange-500 w-3.5 h-3.5 rounded" checked={onlyErr} onChange={e => setOnlyErr(e.target.checked)} />
                <span>Only error rows</span>
              </label>
              <span className="text-[11px] font-semibold text-slate-400 whitespace-nowrap">From</span>
              <input type="date" aria-label="From date" className="h-7 px-1.5 text-xs text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" value={from} onChange={e => setFrom(e.target.value)} />
              <span className="text-[11px] font-semibold text-slate-400 whitespace-nowrap">To</span>
              <input type="date" aria-label="To date" className="h-7 px-1.5 text-xs text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" value={to} onChange={e => setTo(e.target.value)} />
              <div className="flex items-center gap-1">
                {quick(3, 'Last 3 Months')}
                {quick(6, 'Last 6 Months')}
                {quick(12, 'Last 1 Year')}
              </div>
              <button className="h-7 px-2 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md border border-slate-200 transition-colors whitespace-nowrap cursor-pointer" onClick={clearFilters}>
                Clear Filters
              </button>
            </div>
          </div>
          <div className="p-4 space-y-4">
            {dataError && <div data-testid="data-error" className="flex items-start gap-2 text-sm rounded-xl border border-red-200 bg-red-50 text-red-800 px-3.5 py-2.5"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{dataError}</div>}
            <div className="overflow-auto max-h-[480px] border border-slate-200 rounded-xl">
              <table className="w-full text-xs min-w-[1000px]">
                <thead className="bg-slate-50/95 backdrop-blur sticky top-0 z-10 shadow-[0_1px_0_#e2e8f0]"><tr className="text-left">
                  {['Txn No', 'Date', 'Bank', 'Type', 'Party', 'Reference', 'Description', 'Debit (out)', 'Credit (in)', 'Balance', 'Status'].map((h, i) => <th key={h} className={`${th} ${i >= 7 && i <= 9 ? 'text-right' : ''}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {shownData.map(r => (
                    <tr key={r.id} data-testid="data-row" className="border-t border-slate-100 hover:bg-slate-50 transition">
                      <td className="px-3 py-2.5 font-mono font-semibold text-slate-700">{r.txn_no}</td><td className="px-3 py-2.5 whitespace-nowrap">{dmy(r.txn_date)}</td><td className="px-3 py-2.5">{r.account_name}</td>
                      <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">{r.kind}</span></td>
                      <td className="px-3 py-2.5">{r.party_name ?? ''}</td><td className="px-3 py-2.5 font-mono text-slate-500">{r.reference_no ?? ''}</td><td className="px-3 py-2.5 max-w-[240px] truncate text-slate-600" title={r.description ?? ''}>{r.description ?? ''}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-red-600">{r.direction === 'OUT' ? money(r.amount) : ''}</td><td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-600">{r.direction === 'IN' ? money(r.amount) : ''}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{money(r.balance)}</td><td className="px-3 py-2.5">{statusPill(r.status)}</td>
                    </tr>
                  ))}
                  {!loadingData && shownData.length === 0 && (
                    <tr><td colSpan={11} className="px-3 py-8 text-center">
                      <Inbox size={30} className="mx-auto text-slate-300 mb-2" />
                      <p className="text-sm font-semibold text-slate-600">No bank data for these filters</p>
                      <p className="text-xs text-slate-400 mt-0.5">Import a statement above or change the filters.</p>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <ManualEntryModal open={modal === 'manual'} onClose={() => setModal(null)} bankId={bankId} bankName={bank?.name ?? ''} types={types}
        incomeOpts={incomeOpts} expenseOpts={expenseOpts} onTypes={() => setModal('types')}
        onSaved={() => { setMsg({ kind: 'ok', text: 'Manual entry saved.' }); void loadData(full); }} />
      <ManageBanks open={modal === 'banks'} onClose={() => setModal(null)} accounts={options?.accounts ?? []} canManage={!!options?.can_manage} onChanged={() => loadOptions()} />
      <ManageTypes open={modal === 'types'} onClose={() => setModal(null)} types={types} ledgers={[...incomeOpts, ...expenseOpts]}
        onChange={(t, renamed) => {
          if (!saveTypes(cid, t)) { setMsg({ kind: 'err', text: 'Could not save: browser storage is unavailable.' }); return; }
          setTypes(t);
          if (renamed) { const o2 = others.map(o => (o.kind === renamed.from ? { ...o, kind: renamed.to } : o)); if (saveOthers(cid, o2)) setOthers(o2); }
        }} />
      <ManageOthers open={modal === 'others'} onClose={() => setModal(null)} others={others} typeNames={types.map(t => t.name)}
        onSave={o => { if (saveOthers(cid, o)) { setOthers(o); setMsg({ kind: 'ok', text: 'Others saved.' }); } else setMsg({ kind: 'err', text: 'Could not save: browser storage is unavailable.' }); }} />
      <Modal open={modal === 'ledger'} onClose={() => setModal(null)} title="Ledger Details" subtitle="Accounts a statement row can be posted against" size="lg">
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          {([['Income (money in)', incomeOpts, 'text-emerald-600'], ['Expense (money out)', expenseOpts, 'text-red-600']] as const).map(([title, list, tone]) => (
            <div key={title}><p className={`text-xs font-bold uppercase mb-1.5 ${tone}`}>{title}</p>
              {list.length === 0 ? <p className="text-slate-400 text-xs">None.</p> : <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">{list.map(a => <li key={a.id} className="px-3 py-2 flex gap-3 hover:bg-slate-50"><span className="font-mono text-slate-500">{a.code}</span>{a.name}</li>)}</ul>}</div>
          ))}
        </div>
        <button className={`${btn} mt-4`} onClick={() => { setModal(null); navigate('/accounts/ledger'); }}><BookOpen size={14} />Open Ledger</button>
      </Modal>
    </div>
  );
}

/** Banks are accounts under "Bank Balances" in the chart of accounts, so adding one here adds a real ledger account
 *  (code assigned automatically). "Delete" takes a bank out of the lists (inactive); its history stays in the books. */
function ManageBanks({ open, onClose, accounts, canManage, onChanged }: {
  open: boolean; onClose: () => void; accounts: { id: string; code: string; name: string; type: string; balance: string; system_key?: string | null }[]; canManage: boolean; onChanged: () => void | Promise<void>;
}) {
  const [chart, setChart] = useState<Account[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setEditing(null); setConfirmDel(null); setErr(''); setName('');
    accountingApi.chartOfAccounts().then(setChart).catch(e => setErr(e instanceof Error ? e.message : 'Could not load the chart of accounts.'));
  }, [open]);

  const group = chart.find(a => a.system_key === 'BANK_GROUP');
  const taken = (n: string, exceptId?: string) => [...accounts, ...chart.filter(a => a.status === 'Active' && !a.is_group)].some(a => a.name.trim().toLowerCase() === n.trim().toLowerCase() && a.id !== exceptId);
  const nextCode = () => {
    const used = new Set(chart.map(a => a.code));
    const base = Number(group?.code ?? '1540');
    for (let n = base + 1; n < base + 400; n++) if (!used.has(String(n))) return String(n);
    return `${base}-${Date.now() % 1000}`;
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('');
    try { await fn(); setChart(await accountingApi.chartOfAccounts()); await onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : 'That did not work.'); }
    finally { setBusy(false); }
  };

  const add = () => {
    if (!canManage) return setErr('Only administrators can add banks.');
    if (!name.trim()) return setErr('Enter a bank name.');
    if (!group) return setErr('The Bank Balances group was not found in your chart of accounts.');
    if (taken(name)) return setErr('A bank or account with that name already exists.');
    void run(async () => { await accountingApi.saveAccount({ id: null, parentId: group.id, code: nextCode(), name: name.trim(), isGroup: false, status: 'Active' }); setName(''); });
  };
  const update = (id: string) => {
    const acc = chart.find(a => a.id === id);
    if (!acc) return setErr('Account not found.');
    if (!draft.trim()) return setErr('Enter a bank name.');
    if (taken(draft, id)) return setErr('A bank or account with that name already exists.');
    void run(async () => { await accountingApi.saveAccount({ id, parentId: acc.parent_id, code: acc.code, name: draft.trim(), isGroup: false, status: 'Active' }); setEditing(null); });
  };
  const remove = (id: string) => {
    const acc = chart.find(a => a.id === id);
    if (!acc) return setErr('Account not found.');
    void run(async () => { await accountingApi.saveAccount({ id, parentId: acc.parent_id, code: acc.code, name: acc.name, isGroup: false, status: 'Inactive' }); setConfirmDel(null); });
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Manage Banks" subtitle="Bank and cash accounts in your books" size="md"
      footer={<button className={btn} data-testid="banks-close" onClick={onClose}>Close</button>}>
      <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
        <input aria-label="New bank name" className={`${inp} flex-1`} placeholder="New bank name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <button className={btn} disabled={busy} onClick={add}><Plus size={14} />Add</button>
      </div>
      {err && <p role="alert" data-testid="banks-error" className="mt-2 text-xs text-red-600">{err}</p>}
      <div className="mt-1 max-h-80 overflow-y-auto divide-y divide-slate-100">
        {accounts.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No bank or cash accounts yet.</p>}
        {accounts.map(a => {
          const system = !!a.system_key;
          return (
            <div key={a.id} data-testid="bank-row" className="py-2 text-sm">
              {editing === a.id ? (
                <div className="flex items-center gap-2">
                  <input aria-label="Edit bank name" className={`${inp} flex-1 !h-8`} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') update(a.id); }} />
                  <button className={`${btn} !h-8`} data-testid="bank-update" disabled={busy} onClick={() => update(a.id)}>Update</button>
                  <button className={`${btn} !h-8`} onClick={() => { setEditing(null); setErr(''); }}>Cancel</button>
                </div>
              ) : confirmDel === a.id ? (
                <div className="flex items-center gap-2 text-red-700">
                  <span className="flex-1 text-xs">Remove <b>{a.name}</b> from your banks? Past entries stay in the books.</span>
                  <button className={`${btn} !h-8 !text-red-700`} data-testid="bank-confirm-delete" disabled={busy} onClick={() => remove(a.id)}>Yes, delete</button>
                  <button className={`${btn} !h-8`} onClick={() => setConfirmDel(null)}>No</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-slate-800 break-words">{a.name}</span>
                    <span className="ml-2 text-[11px] text-slate-400">{a.code} · {a.type} · ₹{formatINR(a.balance, { decimals: 'always', symbol: false })}</span>
                  </span>
                  <button className={`${btn} !h-8`} aria-label={`Edit ${a.name}`} disabled={!canManage || busy} onClick={() => { setEditing(a.id); setDraft(a.name); setErr(''); }}>Edit</button>
                  <button className={`${btn} !h-8 hover:!text-red-600`} aria-label={`Delete ${a.name}`} disabled={!canManage || busy || system} title={system ? 'System account: used by automatic postings' : ''} onClick={() => { setConfirmDel(a.id); setErr(''); }}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function ManageTypes({ open, onClose, types, ledgers, onChange }: {
  open: boolean; onClose: () => void; types: EntryType[]; ledgers: { id: string; code: string; name: string }[];
  onChange: (t: EntryType[], renamed?: { from: string; to: string }) => void;
}) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [dName, setDName] = useState('');
  const [dDir, setDDir] = useState<EntryType['direction']>('ANY');
  const [dLedger, setDLedger] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setEditing(null); setErr(''); setName(''); } }, [open]);
  const taken = (n: string, exceptId?: string) => types.some(t => t.name.trim().toLowerCase() === n.trim().toLowerCase() && t.id !== exceptId);

  const add = () => {
    if (!name.trim()) return setErr('Enter a type name.');
    if (taken(name)) return setErr('A type with that name already exists.');
    onChange([...types, { id: `t-${Date.now()}`, name: name.trim().toUpperCase(), direction: 'ANY', ledgerId: '' }]); setName(''); setErr('');
  };
  const startEdit = (t: EntryType) => { setEditing(t.id); setDName(t.name); setDDir(t.direction); setDLedger(t.ledgerId); setErr(''); };
  const update = () => {
    const old = types.find(t => t.id === editing);
    if (!old) return;
    if (!dName.trim()) return setErr('Enter a type name.');
    if (taken(dName, old.id)) return setErr('A type with that name already exists.');
    const to = dName.trim().toUpperCase();
    onChange(types.map(t => (t.id === old.id ? { ...t, name: to, direction: dDir, ledgerId: dLedger } : t)), old.name !== to ? { from: old.name, to } : undefined);
    setEditing(null); setErr('');
  };
  const dirLabel = (d: EntryType['direction']) => (d === 'IN' ? 'money in' : d === 'OUT' ? 'money out' : '');

  return (
    <Modal open={open} onClose={onClose} title="Manage Types" subtitle="Types tag statement rows and parties. Changes save as you make them." size="md"
      footer={<button className={btn} data-testid="types-close" onClick={onClose}>Close</button>}>
      <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
        <input aria-label="New type name" className={`${inp} flex-1`} placeholder="New type name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <button className={btn} onClick={add}><Plus size={14} />Add Type</button>
      </div>
      {err && <p role="alert" data-testid="types-error" className="mt-2 text-xs text-red-600">{err}</p>}
      <div className="mt-1 max-h-80 overflow-y-auto divide-y divide-slate-100">
        {types.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No types yet.</p>}
        {types.map(t => (
          <div key={t.id} data-testid="type-row" className="py-2 text-sm">
            {editing === t.id ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input aria-label="Edit type name" className={`${inp} flex-1 !h-8`} value={dName} onChange={e => setDName(e.target.value)} />
                  <button className={`${btn} !h-8`} data-testid="type-update" onClick={update}>Update</button>
                  <button className={`${btn} !h-8`} onClick={() => { setEditing(null); setErr(''); }}>Cancel</button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>Used for</span>
                  <select aria-label="Edit type direction" className={`${sel} !h-8`} value={dDir} onChange={e => setDDir(e.target.value as EntryType['direction'])}><option value="ANY">Money in or out</option><option value="IN">Money in only</option><option value="OUT">Money out only</option></select>
                  <span>Default ledger</span>
                  <select aria-label="Edit type ledger" className={`${sel} !h-8 w-52`} value={dLedger} onChange={e => setDLedger(e.target.value)}><option value="">None</option>{ledgers.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 font-medium text-slate-800 uppercase tracking-wide">{t.name}
                  {(dirLabel(t.direction) || t.ledgerId) && <span className="ml-2 normal-case tracking-normal text-[11px] font-normal text-slate-400">{[dirLabel(t.direction), t.ledgerId ? `ledger: ${(ledgers.find(a => a.id === t.ledgerId)?.name) ?? 'set'}` : ''].filter(Boolean).join(' · ')}</span>}
                </span>
                <button className={`${btn} !h-8`} aria-label={`Edit ${t.name}`} onClick={() => startEdit(t)}>Edit</button>
                <button className={`${btn} !h-8 hover:!text-red-600`} aria-label={`Delete ${t.name}`} onClick={() => onChange(types.filter(x => x.id !== t.id))}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ManageOthers({ open, onClose, others, typeNames, onSave }: { open: boolean; onClose: () => void; others: Other[]; typeNames: string[]; onSave: (o: Other[]) => void }) {
  const [list, setList] = useState<Other[]>(others);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftKind, setDraftKind] = useState('OTHERS');
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setList(others); setEditing(null); setErr(''); } }, [open, others]);
  const exists = (n: string, except?: string) => list.some(o => o.name.toLowerCase() === n.trim().toLowerCase() && o.name !== except);

  const add = () => {
    setErr('');
    if (!name.trim()) return setErr('Enter a party name.');
    if (!kind) return setErr('Select a type.');
    if (exists(name)) return setErr('A party with that name already exists.');
    setList(l => [...l, { name: name.trim(), kind }]); setName(''); setKind('');
  };
  const startEdit = (o: Other) => { setEditing(o.name); setDraftName(o.name); setDraftKind(o.kind); setErr(''); };
  const commitEdit = () => {
    if (!draftName.trim()) return setErr('Enter a party name.');
    if (exists(draftName, editing ?? undefined)) return setErr('A party with that name already exists.');
    setList(l => l.map(o => (o.name === editing ? { name: draftName.trim(), kind: draftKind } : o))); setEditing(null); setErr('');
  };

  return (
    <Modal open={open} onClose={onClose} title="Manage Others" subtitle="Parties that are not customers or suppliers, for the Party of a row" size="lg"
      footer={<><button className={btn} onClick={onClose}>Cancel</button><button className={btnPrimary} data-testid="others-save" onClick={() => { onSave(list); onClose(); }}>Save</button></>}>
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100">
        <input aria-label="New party name" className={`${inp} flex-1 min-w-[12rem]`} placeholder="Party name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <select aria-label="New party type" className={`${sel} w-44`} value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">-- Select Type --</option>{typeNames.map(k => <option key={k} value={k}>{k}</option>)}</select>
        <button className={btn} onClick={add}><Plus size={14} />Add Party</button>
      </div>
      {err && <p role="alert" data-testid="others-error" className="mt-2 text-xs text-red-600">{err}</p>}
      <div className="mt-2 max-h-80 overflow-y-auto divide-y divide-slate-100">
        {list.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No parties yet, for example Petrol, Bank Charges or a loan account.</p>}
        {list.map(o => (
          <div key={o.name} data-testid="other-row" className="flex items-center gap-2 py-2 text-sm">
            {editing === o.name ? (
              <>
                <input aria-label="Edit party name" className={`${inp} flex-1 !h-8`} value={draftName} onChange={e => setDraftName(e.target.value)} />
                <select aria-label="Edit party type" className={`${sel} !h-8 w-36`} value={draftKind} onChange={e => setDraftKind(e.target.value)}>{Array.from(new Set([...typeNames, draftKind])).map(k => <option key={k}>{k}</option>)}</select>
                <button className={`${btn} !h-8`} data-testid="other-update" onClick={commitEdit}>Update</button>
                <button className={`${btn} !h-8`} onClick={() => { setEditing(null); setErr(''); }}>Cancel</button>
              </>
            ) : (
              <>
                <span className="flex-1 font-medium text-slate-800 uppercase tracking-wide">{o.name} <span className="text-slate-400 font-normal">—</span> <span className={`text-xs font-bold ${/^internal$/i.test(o.kind) ? 'text-sky-600' : 'text-slate-500'}`}>{o.kind}</span></span>
                <button className={`${btn} !h-8`} aria-label={`Edit ${o.name}`} onClick={() => startEdit(o)}>Edit</button>
                <button className={`${btn} !h-8 hover:!text-red-600`} aria-label={`Delete ${o.name}`} onClick={() => setList(l => l.filter(x => x.name !== o.name))}>Delete</button>
              </>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/** Manual Entry: one debit OR credit line against the selected bank, tagged with a Type. Lists the manual entries
 *  already saved for that bank underneath. Saving uses the same erp_add_bank_entry as the statement import. */
function ManualEntryModal({ open, onClose, bankId, bankName, types, incomeOpts, expenseOpts, onTypes, onSaved }: {
  open: boolean; onClose: () => void; bankId: string; bankName: string; types: EntryType[];
  incomeOpts: { id: string; code: string; name: string }[]; expenseOpts: { id: string; code: string; name: string }[]; onTypes: () => void; onSaved: () => void;
}) {
  const [date, setDate] = useState(today());
  const [debit, setDebit] = useState('');
  const [credit, setCredit] = useState('');
  const [desc, setDesc] = useState('');
  const [typeId, setTypeId] = useState('');
  const [ledgerId, setLedgerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [list, setList] = useState<BankRow[]>([]);
  const [listState, setListState] = useState('');

  const num = (v: string) => { const n = Number(v.replace(/,/g, '').trim()); return v.trim() === '' ? 0 : Number.isFinite(n) && n >= 0 ? n : NaN; };
  const d = num(debit), c = num(credit);
  const dir: 'IN' | 'OUT' | null = c > 0 && !(d > 0) ? 'IN' : d > 0 && !(c > 0) ? 'OUT' : null;
  const type = types.find(t => t.id === typeId);
  const ledgers = dir === 'IN' ? incomeOpts : dir === 'OUT' ? expenseOpts : [...incomeOpts, ...expenseOpts];
  const fits = types.filter(t => dir === null || t.direction === 'ANY' || t.direction === dir);

  const loadList = useCallback(async () => {
    if (!bankId) { setList([]); setListState('Select a bank first.'); return; }
    setListState('Loading…');
    try {
      const all: BankRow[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await financeApi.bankTransactions({ account: bankId, page, pageSize: 200 });
        all.push(...r.rows); if (all.length >= r.total || !r.rows.length) break;
      }
      const manual = all.filter(r => /manual/i.test(r.mode ?? ''));
      setList(manual); setListState(`Loaded ${manual.length} manual entr${manual.length === 1 ? 'y' : 'ies'}`);
    } catch (e) { setList([]); setListState(e instanceof Error ? e.message : 'Could not load manual entries.'); }
  }, [bankId]);
  useEffect(() => { if (open) { setErr(''); setDate(today()); void loadList(); } }, [open, loadList]);

  const submit = async () => {
    setErr('');
    if (!bankId) return setErr('Select a bank first (on the Bank Entry page).');
    if (!parseDateOk(date)) return setErr('Enter a valid date.');
    if (Number.isNaN(d) || Number.isNaN(c)) return setErr('Debit and credit must be numbers of 0 or more.');
    if (!dir) return setErr(d > 0 && c > 0 ? 'Enter either a debit or a credit, not both.' : 'Enter a debit or a credit amount.');
    if (!typeId && !ledgerId) return setErr('Choose a Type or a Ledger.');
    if (type && !(type.direction === 'ANY' || type.direction === dir)) return setErr(`Type “${type.name}” is for ${type.direction === 'IN' ? 'money in (credit)' : 'money out (debit)'}.`);
    setBusy(true);
    try {
      await financeApi.addBankEntry({
        direction: dir, account_id: bankId, contra_account_id: ledgerId || type?.ledgerId || '', amount: String(dir === 'IN' ? c : d), txn_date: date,
        mode: 'Manual entry', description: [type?.name, desc.trim()].filter(Boolean).join(' - '), status: 'Cleared', source_type: 'manual_entry',
      });
      setDebit(''); setCredit(''); setDesc(''); setTypeId(''); setLedgerId('');
      onSaved(); await loadList();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save the entry.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Manual Entry" subtitle={bankName ? `Posting to ${bankName}` : 'Select a bank on the Bank Entry page first'} size="xl"
      footer={<><button className={btn} onClick={onClose}>Close</button><button className={btnPrimary} data-testid="manual-save" disabled={busy} onClick={() => void submit()}><Save size={14} />{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="flex justify-end -mt-1 mb-2"><button className={btn} onClick={onTypes}><Tags size={14} />Types</button></div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Date
          <input type="date" aria-label="Manual date" className={`${inp} w-full mt-1 normal-case font-normal`} value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Debit (money out)
          <input aria-label="Manual debit" inputMode="decimal" placeholder="0.00" className={`${inp} w-full mt-1 normal-case font-normal`} value={debit} onChange={e => setDebit(e.target.value.replace(/[^0-9.,]/g, ''))} /></label>
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Credit (money in)
          <input aria-label="Manual credit" inputMode="decimal" placeholder="0.00" className={`${inp} w-full mt-1 normal-case font-normal`} value={credit} onChange={e => setCredit(e.target.value.replace(/[^0-9.,]/g, ''))} /></label>
      </div>
      <label className="block mt-3 text-xs font-bold uppercase tracking-wider text-slate-500">Description
        <input aria-label="Manual description" className={`${inp} w-full mt-1 normal-case font-normal`} placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} /></label>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Type
          <select aria-label="Manual type" className={`${sel} w-full mt-1 normal-case font-normal`} value={typeId} onChange={e => { setTypeId(e.target.value); const t = types.find(x => x.id === e.target.value); if (t?.ledgerId) setLedgerId(t.ledgerId); }}>
            <option value="">-- Select Type --</option>{fits.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Ledger {type?.ledgerId ? '' : '(if the Type has no default)'}
          <select aria-label="Manual ledger" className={`${sel} w-full mt-1 normal-case font-normal`} value={ledgerId} onChange={e => setLedgerId(e.target.value)}>
            <option value="">{type?.ledgerId ? 'Type default' : '—'}</option>{ledgers.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></label>
      </div>
      {err && <p role="alert" data-testid="manual-error" className="mt-3 flex items-start gap-2 text-sm rounded-xl border border-red-200 bg-red-50 text-red-800 px-3 py-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{err}</p>}

      <div className="mt-5 pt-4 border-t border-slate-200">
        <h3 className="text-base font-bold text-slate-900">Manual Entry Details</h3>
        <p className="text-sm text-emerald-700 mt-0.5" data-testid="manual-count">{listState}</p>
        {list.length > 0 && (
          <div className="mt-2 overflow-auto max-h-56 border border-slate-200 rounded-xl">
            <table className="w-full text-xs"><thead className="bg-slate-50 sticky top-0"><tr className="text-left">{['Txn No', 'Date', 'Description', 'Debit', 'Credit'].map((h, i) => <th key={h} className={`${th} ${i >= 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>{list.map(r => (
                <tr key={r.id} data-testid="manual-row" className="border-t border-slate-100"><td className="px-3 py-2 font-mono">{r.txn_no}</td><td className="px-3 py-2">{dmy(r.txn_date)}</td><td className="px-3 py-2 max-w-[260px] truncate">{r.description ?? ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-600 font-semibold">{r.direction === 'OUT' ? money(r.amount) : ''}</td><td className="px-3 py-2 text-right tabular-nums text-emerald-600 font-semibold">{r.direction === 'IN' ? money(r.amount) : ''}</td></tr>
              ))}</tbody></table>
          </div>
        )}
      </div>
    </Modal>
  );
}
function parseDateOk(v: string) { return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime()); }

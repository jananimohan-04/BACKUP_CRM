import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, BookText, RefreshCw, Landmark, FileText, PackageOpen, Search, Filter, ArrowUp, ArrowDown, ArrowUpDown, Inbox, AlertTriangle, FileDown, FileSpreadsheet, ChevronLeft, ChevronRight, X, MoreVertical, Printer, Eye } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { financeApi, type BankRow, type InvoiceRow } from '@/lib/finance';
import { formatINR, todayISO } from '@/lib/format';
import { exportCsv, escapeHtml, printHtml } from '@/lib/reportExport';
import { addRoundedLogo } from '@/lib/brandedDocument';
import {
  dmy, drCr, filterLines, fromBank, fromInvoices, fromInwards, sortLines, statementFor, summarizeByParty, receivablePayable, settleDocuments, nameKey, stripStamp,
  type LedgerLine, type LedgerSource, type SortKey,
} from '@/lib/ledgerDashboard';

// Ledger Dashboard: every bank entry, invoice and inward in one party ledger, with filters, a party statement
// and a party-wise ledger book. Read-only: it reads the same records the rest of the ERP writes.

const btn = 'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 text-[13px] font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 h-9 px-5 text-[13px] font-bold text-white bg-gradient-to-b from-orange-500 to-orange-600 rounded-lg shadow-md shadow-orange-500/25 hover:from-orange-500 hover:to-orange-700 active:scale-[0.98] transition disabled:opacity-40';
const sel = 'h-9 px-3 text-[13px] font-medium text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15';
const inp = 'h-9 px-3 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15';
const th = 'px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 select-none';
const money = (n: number) => (n ? formatINR(n, { decimals: 'always', symbol: false }) : '');
const MAX_ROWS = 5000;
const item = 'w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-slate-700 hover:bg-orange-50 hover:text-orange-800 disabled:opacity-40 text-left';

type SourceState = { rows: LedgerLine[]; state: 'idle' | 'loading' | 'ok' | 'error'; error: string; at: string };
const emptySource = (): SourceState => ({ rows: [], state: 'idle', error: '', at: '' });

const COLS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'date', label: 'Date (dd/MM/yyyy)' }, { key: 'ref', label: 'Reference Number' }, { key: 'party', label: 'Party Name' },
  { key: 'particulars', label: 'Particulars' }, { key: 'narration', label: 'Narration' },
  { key: 'debit', label: 'Debit', align: 'right' }, { key: 'credit', label: 'Credit', align: 'right' },
];

/** `embedded` = shown as a tab inside Ledger & Vouchers (no page padding, compact heading). */
export function LedgerDashboardPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { company } = useAuth();
  const cid = company?.id ?? null;
  const [src, setSrc] = useState<Record<LedgerSource, SourceState>>({ Bank: emptySource(), Invoice: emptySource(), Inward: emptySource() });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [part, setPart] = useState('');
  const [party, setParty] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '', part: '', party: '' });
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [modal, setModal] = useState<null | 'statement' | 'book'>(null);
  const [stmtParty, setStmtParty] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async (which: LedgerSource): Promise<number> => {
    setSrc(s => ({ ...s, [which]: { ...s[which], state: 'loading', error: '' } }));
    try {
      let rows: LedgerLine[] = [];
      if (which === 'Bank') {
        const all: BankRow[] = [];
        for (let page = 1; all.length < MAX_ROWS; page++) {
          const r = await financeApi.bankTransactions({ page, pageSize: 200 });
          all.push(...r.rows); if (all.length >= r.total || !r.rows.length) break;
        }
        rows = fromBank(all);
      } else if (which === 'Invoice') {
        const all: InvoiceRow[] = [];
        for (let page = 1; all.length < MAX_ROWS; page++) {
          const r = await financeApi.invoices({ page, pageSize: 200 });
          all.push(...r.rows); if (all.length >= r.total || !r.rows.length) break;
        }
        rows = fromInvoices(all);
      } else {
        const r = await supabase.from('cnc_inwards').select('*').neq('status', 'Deleted').limit(MAX_ROWS);
        if (r.error) throw new Error(r.error.message);
        rows = fromInwards((r.data ?? []) as Record<string, unknown>[]);
      }
      setSrc(s => ({ ...s, [which]: { rows, state: 'ok', error: '', at: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) } }));
      return rows.length;
    } catch (e) {
      setSrc(s => ({ ...s, [which]: { ...s[which], state: 'error', error: e instanceof Error ? e.message : 'Could not load.' } }));
      return -1;
    }
  }, []);

  const refreshAll = useCallback(async () => { await Promise.all((['Bank', 'Invoice', 'Inward'] as LedgerSource[]).map(load)); }, [load]);
  useEffect(() => { void refreshAll(); }, [refreshAll, cid]);
  const updateOne = async (which: LedgerSource) => {
    const n = await load(which);
    setNote(n < 0 ? `${which}: could not update.` : `${which} updated: ${n} row${n === 1 ? '' : 's'}.`);
  };

  // The Reference Number of an invoice / inward is the order's Company ID with its date and time (1001-06OCT26-0952AM),
  // found through the sales order / challan it came from; failing that the company's own ID (1001). The document
  // number moves into the narration. Bank rows keep their cheque / UTR reference.
  const [ids, setIds] = useState<{ byName: Map<string, string>; bySo: Map<string, string>; byDc: Map<string, string>; byBase: Map<string, string> }>({ byName: new Map(), bySo: new Map(), byDc: new Map(), byBase: new Map() });
  useEffect(() => {
    let off = false;
    (async () => {
      const byName = new Map<string, string>(), bySo = new Map<string, string>(), byDc = new Map<string, string>(), byBase = new Map<string, string>();
      const enq = await supabase.from('cnc_enquiries').select('customer,lead_no,enquiry_no,created_at').order('created_at', { ascending: false });
      for (const e of (enq.error ? [] : enq.data) ?? []) {
        const k = nameKey(String(e.customer ?? ''));
        if (k && !byName.has(k)) byName.set(k, stripStamp(String(e.lead_no || (e.enquiry_no ? `LD-${e.enquiry_no}` : ''))));
      }
      const cust = await supabase.from('cnc_customers').select('id,name');
      for (const c of (cust.error ? [] : cust.data) ?? []) {
        const k = nameKey(String(c.name ?? ''));
        if (k && !byName.get(k)) byName.set(k, String(c.id));
      }
      const sos = await supabase.from('cnc_sales_orders').select('order_no,lead_no').order('created_at', { ascending: false });
      for (const o of (sos.error ? [] : sos.data) ?? []) {
        if (!o.lead_no) continue;
        if (o.order_no) bySo.set(String(o.order_no), String(o.lead_no));
        byBase.set(String(o.lead_no).toUpperCase(), String(o.lead_no)); // exact stamped number
        const base = stripStamp(String(o.lead_no));
        if (!byBase.has(base)) byBase.set(base, String(o.lead_no)); // newest order of that company
      }
      const dcs = await supabase.from('cnc_deliveries').select('delivery_no,sales_order_no');
      for (const d of (dcs.error ? [] : dcs.data) ?? []) {
        const lead = d.sales_order_no ? bySo.get(String(d.sales_order_no)) : undefined;
        if (d.delivery_no && lead) byDc.set(String(d.delivery_no), lead);
      }
      if (!off) setIds({ byName, bySo, byDc, byBase });
    })().catch(() => { /* references stay as document numbers */ });
    return () => { off = true; };
  }, [cid]);
  const all = useMemo(() => [...src.Bank.rows, ...src.Invoice.rows, ...src.Inward.rows].map(l => {
    if (l.source === 'Bank') return l;
    let id = '';
    for (const k of l.links ?? []) { id = ids.bySo.get(k) || ids.byDc.get(k) || ids.byBase.get(k.toUpperCase()) || ids.byBase.get(stripStamp(k)) || ''; if (id) break; }
    id = (id || ids.byName.get(nameKey(l.party)) || '').toUpperCase();
    return id ? { ...l, ref: id, narration: [l.ref, l.narration].filter(Boolean).join(' · ') } : l;
  }), [src, ids]);
  const recPay = useMemo(() => receivablePayable(all), [all]);
  const settled = useMemo(() => settleDocuments(all, todayISO()), [all]);
  const statusText = (id: string): string => {
    const s = settled.get(id);
    if (!s) return '';
    const age = s.days <= 0 ? 'today' : `${s.days} day${s.days === 1 ? '' : 's'}`;
    return s.state === 'Completed' ? 'Completed' : s.state === 'Part' ? `Part paid · ${age}` : `Due · ${age}`;
  };
  const parties = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const l of all) { const k = nameKey(l.party); if (k && !byKey.has(k)) byKey.set(k, l.party.trim().replace(/\s+/g, ' ')); }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [all]);
  const filtered = useMemo(() => filterLines(all, { from: applied.from, to: applied.to, particulars: applied.part, party: applied.party, search }), [all, applied, search]);
  const sorted = useMemo(() => sortLines(filtered, sort.key, sort.dir), [filtered, sort]);
  const pages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages);
  const shown = pageSize === 0 ? sorted : sorted.slice((cur - 1) * pageSize, cur * pageSize);
  const totals = useMemo(() => ({ debit: filtered.reduce((n, l) => n + l.debit, 0), credit: filtered.reduce((n, l) => n + l.credit, 0) }), [filtered]);
  const anyLoading = Object.values(src).some(s => s.state === 'loading');
  const errors = (Object.entries(src) as [LedgerSource, SourceState][]).filter(([, s]) => s.state === 'error');
  const filtersActive = !!(applied.from || applied.to || applied.part || applied.party || search);

  const apply = () => { if (from && to && from > to) { setNote('Start date is after the end date.'); return; } setApplied({ from, to, part, party }); setPage(1); setNote(''); };
  const clear = () => { setFrom(''); setTo(''); setPart(''); setParty(''); setSearch(''); setApplied({ from: '', to: '', part: '', party: '' }); setPage(1); setNote(''); };
  const sortBy = (key: SortKey) => setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'debit' || key === 'credit' ? 'desc' : 'asc' }));

  const exportRows = () => {
    if (!sorted.length) { setNote('Nothing to export.'); return; }
    exportCsv(`ledger-${todayISO()}`, [['Date', 'Reference Number', 'Party Name', 'Particulars', 'Narration', 'Debit', 'Credit', 'Source', 'Status'],
      ...sorted.map(l => [dmy(l.date), l.ref, l.party, l.particulars, l.narration, l.debit || '', l.credit || '', l.source, statusText(l.id)])]);
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menuOpen]);

  // "Statement", from the chosen start date to the chosen end date; without dates, from the first to the last entry shown.
  const dated = sorted.map(l => l.date).filter(Boolean).sort();
  const periodFrom = applied.from || dated[0] || '';
  const periodTo = applied.to || dated[dated.length - 1] || '';
  const reportTitle = `Statement${applied.party ? ` - ${applied.party}` : ''}`;
  const reportSub = `${company?.company_name ?? ''}  |  From ${dmy(periodFrom) || '-'} to ${dmy(periodTo) || '-'}  |  ${sorted.length} rows`;
  const reportBody = () => sorted.map(l => [dmy(l.date), l.ref, l.party, l.particulars, l.narration, l.debit ? money(l.debit) : '', l.credit ? money(l.credit) : '', statusText(l.id)]);
  const balanceText = `${money(Math.abs(totals.debit - totals.credit)) || '0.00'} ${drCr(totals.debit - totals.credit)}`.trim();
  const pdfName = `statement${applied.party ? '-' + applied.party.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() : ''}-${todayISO()}.pdf`;
  const buildPdf = async () => {
    const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await addRoundedLogo(pdf, 14, 8, 40, 17);
    pdf.setFontSize(14); pdf.text(reportTitle, 60, 15);
    pdf.setFontSize(8); pdf.text(reportSub, 60, 20.5);
    pdf.setDrawColor(242, 90, 10); pdf.setLineWidth(0.7); pdf.line(14, 27, 283, 27);
    autoTable(pdf, {
      startY: 31, styles: { fontSize: 7.5, cellPadding: 1.4 }, headStyles: { fillColor: [51, 65, 85] },
      head: [['Date', 'Reference', 'Party Name', 'Particulars', 'Narration', 'Debit', 'Credit', 'Status']],
      body: reportBody(),
      foot: [['', '', '', '', `Total (${sorted.length} rows)`, money(totals.debit) || '0.00', money(totals.credit) || '0.00', `Balance ${balanceText}`]],
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
      columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' } },
    });
    return pdf;
  };
  const downloadPdf = async () => {
    if (!sorted.length) { setNote('Nothing to download.'); return; }
    try { (await buildPdf()).save(pdfName); } catch (e) { setNote(`Could not create the PDF: ${(e as Error).message}`); }
  };
  // Preview: the same PDF shown in a window, with Download and Print inside it.
  const [preview, setPreview] = useState<string | null>(null);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const closePreview = () => setPreview(p => { if (p) URL.revokeObjectURL(p); return null; });
  const openPreview = async () => {
    if (!sorted.length) { setNote('Nothing to preview.'); return; }
    try { setPreview(URL.createObjectURL((await buildPdf()).output('blob'))); } catch (e) { setNote(`Could not create the preview: ${(e as Error).message}`); }
  };
  const printPreview = () => {
    const w = previewFrame.current?.contentWindow;
    if (w) { try { w.focus(); w.print(); return; } catch { /* fall through */ } }
    if (preview) window.open(preview, '_blank');
  };
  const printReport = () => {
    if (!sorted.length) { setNote('Nothing to print.'); return; }
    const cell = (v: string, num = false) => `<td${num ? ' class="num"' : ''}>${escapeHtml(v)}</td>`;
    const head = ['Date', 'Reference', 'Party Name', 'Particulars', 'Narration', 'Debit', 'Credit', 'Status'].map((h, i) => `<th${i === 5 || i === 6 ? ' class="num"' : ''}>${escapeHtml(h)}</th>`).join('');
    const body = reportBody().map(r => `<tr>${r.map((v, i) => cell(v, i === 5 || i === 6)).join('')}</tr>`).join('');
    printHtml(reportTitle, `<div class="brand"><img src="${window.location.origin}/arguscnc-logo.jpg" alt="Logo"><div style="text-align:right"><h1>${escapeHtml(reportTitle)}</h1><div class="meta">${escapeHtml(reportSub)}</div></div></div>
<table><thead><tr>${head}</tr></thead><tbody>${body}<tr class="total"><td colspan="5" style="text-align:right">Total (${sorted.length} rows)</td>${cell(money(totals.debit) || '0.00', true)}${cell(money(totals.credit) || '0.00', true)}<td>Balance ${escapeHtml(balanceText)}</td></tr></tbody></table>`);
  };

  const srcBtn = (which: LedgerSource, icon: React.ReactNode, label: string) => (
    <button role="menuitem" className={item} data-testid={`update-${which.toLowerCase()}`} disabled={src[which].state === 'loading'} onClick={() => { setMenuOpen(false); void updateOne(which); }} title={src[which].error || (src[which].at ? `${src[which].rows.length} rows · ${src[which].at}` : '')}>
      {icon}{label}<span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold ${src[which].state === 'error' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{src[which].state === 'loading' ? '…' : src[which].state === 'error' ? '!' : src[which].rows.length}</span>
    </button>
  );

  return (
    <div className={embedded ? '' : 'p-4 lg:p-6 bg-grid min-h-full'}>
      <div className="space-y-5 max-w-[1500px] mx-auto">
        {!embedded && (
          <div className="flex flex-nowrap items-center gap-3 overflow-x-auto scrollbar-thin">
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 text-white flex items-center justify-center shadow-lg shadow-orange-500/25"><BookText size={22} /></div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-baseline gap-3">Ledger Dashboard <span className="text-sm font-medium text-slate-500" data-testid="row-count">{sorted.length} rows</span></h1>
                <p className="text-sm text-slate-500">Bank entries, invoices and inwards in one party ledger.</p>
              </div>
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <div role="alert" data-testid="source-error" className="flex items-start gap-2 text-sm rounded-xl border border-red-200 bg-red-50 text-red-800 px-3.5 py-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{errors.map(([k, s]) => `${k}: ${s.error}`).join(' · ')} — the other sources are still shown.</span>
          </div>
        )}
        {note && <div role="status" data-testid="ledger-note" className="rounded-xl border border-sky-200 bg-sky-50 text-sky-800 text-sm px-3.5 py-2">{note}</div>}

        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/70 flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-thin [&>*]:shrink-0">
            <p className="text-xs text-slate-500 whitespace-nowrap shrink-0"><span className="font-semibold text-slate-700" data-testid="row-count">{sorted.length} rows</span></p>
            <button type="button" onClick={() => { setSearch(cur => (cur === 'Customer' ? '' : 'Customer')); setPage(1); }}
              title={`${recPay.customers} customer${recPay.customers === 1 ? '' : 's'} with a balance — click to filter`}
              className="shrink-0 whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50/60 px-2 py-1 text-[11px] font-bold text-sky-800 hover:shadow-sm transition">
              RECEIVABLE <b className="tabular-nums" data-testid="receivable-total">₹{money(recPay.receivable) || '0.00'}</b> <span className="font-medium text-sky-600">({recPay.customers})</span>
            </button>
            <button type="button" onClick={() => { setSearch(cur => (cur === 'Supplier' ? '' : 'Supplier')); setPage(1); }}
              title={`${recPay.suppliers} supplier${recPay.suppliers === 1 ? '' : 's'} with a balance — click to filter`}
              className="shrink-0 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50/60 px-2 py-1 text-[11px] font-bold text-amber-800 hover:shadow-sm transition">
              PAYABLE <b className="tabular-nums" data-testid="payable-total">₹{money(recPay.payable) || '0.00'}</b> <span className="font-medium text-amber-600">({recPay.suppliers})</span>
            </button>
            <span className="h-6 w-px bg-slate-200 shrink-0" aria-hidden="true" />
            <Filter size={14} className="text-slate-400 shrink-0" />
            <Filter size={14} className="text-slate-400" />
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">Start <input type="date" aria-label="Start date" className={inp} value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">End <input type="date" aria-label="End date" className={inp} value={to} onChange={e => setTo(e.target.value)} /></label>
            <input aria-label="Filter particulars" className={`${inp} w-40 shrink min-w-0`} placeholder="Filter: Particulars" value={part} onChange={e => setPart(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') apply(); }} />
            <select aria-label="Party" className={`${sel} w-48 shrink min-w-0`} value={party} onChange={e => { setParty(e.target.value); setApplied(a => ({ ...a, party: e.target.value })); setPage(1); }}>
              <option value="">Party (all)</option>{parties.map(p => <option key={p} value={p}>{p}</option>)}</select>
            <button className={btnPrimary} onClick={apply}>Apply</button>
            <button className={btn} onClick={clear}><X size={14} />Clear</button>
            <span className="ml-auto flex gap-2 shrink-0">
              <button className={btn} data-testid="ledger-preview" title="Preview, then download or print" onClick={() => void openPreview()}><Eye size={14} />Preview</button>
              <button className={btn} data-testid="ledger-print" onClick={printReport}><Printer size={14} />Print</button>
              <button className={btn} data-testid="ledger-pdf" title="Download PDF" onClick={() => void downloadPdf()}><FileDown size={14} />PDF</button>
              <button className={btn} title="Export CSV" onClick={exportRows}><FileSpreadsheet size={14} />CSV</button>
            </span>
            <div className="relative shrink-0" ref={menuRef}>
              <button type="button" aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} data-testid="ledger-menu" className={`${btn} !px-2.5`} onClick={() => setMenuOpen(o => !o)}>
                <MoreVertical size={18} className={anyLoading ? 'animate-pulse text-orange-500' : ''} />
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 mt-2 w-60 z-30 rounded-xl border border-slate-200 bg-white shadow-xl py-1.5">
                  <button role="menuitem" className={item} data-testid="refresh-all" disabled={anyLoading} onClick={() => { setMenuOpen(false); void refreshAll().then(() => setNote('Everything refreshed.')); }}><RefreshCw size={14} className={anyLoading ? 'animate-spin' : ''} />Refresh all</button>
                  <div className="my-1 border-t border-slate-100" />
                  {srcBtn('Bank', <Landmark size={14} />, 'Update Bank')}
                  {srcBtn('Invoice', <FileText size={14} />, 'Update Invoice')}
                  {srcBtn('Inward', <PackageOpen size={14} />, 'Update Inward')}
                  <div className="my-1 border-t border-slate-100" />
                  <button role="menuitem" className={item} onClick={() => { setMenuOpen(false); setStmtParty(applied.party || parties[0] || ''); setModal('statement'); }}><BookOpen size={14} />Ledger Statement</button>
                  <button role="menuitem" className={`${item} !text-orange-800`} onClick={() => { setMenuOpen(false); setModal('book'); }}><BookText size={14} />Ledger Book</button>
                </div>
              )}
            </div>
          </div>

          <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <label className="flex items-center gap-2 text-slate-600">Show
              <select aria-label="Entries per page" className={`${sel} !h-8`} value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
                {[10, 25, 50, 100, 500].map(n => <option key={n} value={n}>{n}</option>)}<option value={0}>All</option></select> entries</label>
            <label className="flex items-center gap-2 text-slate-600">Search:
              <input aria-label="Search ledger" className={`${inp} !h-8 w-56`} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
          </div>

          <div className="overflow-auto max-h-[560px] border-t border-slate-200">
            <table className="w-full text-[13px] min-w-[1100px]">
              <thead className="bg-slate-100/90 backdrop-blur sticky top-0 z-10 shadow-[0_1px_0_#e2e8f0]"><tr className="text-left">
                {COLS.map(c => (
                  <th key={c.key} className={`${th} cursor-pointer hover:bg-slate-200/60 ${c.align === 'right' ? 'text-right' : ''}`} onClick={() => sortBy(c.key)} data-testid={`sort-${c.key}`} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <span className="inline-flex items-center gap-1">{c.label}{sort.key === c.key ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="text-slate-300" />}</span>
                  </th>
                ))}
                <th className={th}>Status</th>
              </tr></thead>
              <tbody>
                {shown.map(l => (
                  <tr key={l.id} data-testid="ledger-row" className="border-t border-slate-100 odd:bg-white even:bg-slate-50/50 hover:bg-orange-50/40 transition">
                    <td className="px-3 py-2 whitespace-nowrap">{dmy(l.date)}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{l.ref}</td>
                    <td className="px-3 py-2 uppercase font-medium text-slate-800">{l.party}</td>
                    <td className="px-3 py-2 uppercase">{l.particulars}</td>
                    <td className="px-3 py-2">{l.narration}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">{money(l.debit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600">{money(l.credit)}</td>
                    <td className="px-3 py-2 whitespace-nowrap" data-testid="bill-status">{(() => {
                      const s = settled.get(l.id);
                      if (!s) return null;
                      const cls = s.state === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : s.state === 'Part' ? 'bg-amber-50 text-amber-700 border-amber-200' : s.days > 30 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-orange-50 text-orange-700 border-orange-200';
                      return <span title={s.state === 'Completed' ? 'Settled by the bank statement' : `Still unpaid: ${money(s.left)}`} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>{statusText(l.id)}</span>;
                    })()}</td>
                  </tr>
                ))}
                {!anyLoading && shown.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center"><Inbox size={30} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-semibold text-slate-600">{filtersActive ? 'No ledger rows match these filters' : 'No ledger entries yet'}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{filtersActive ? 'Change or clear the filters.' : 'Bank entries, invoices and inwards will appear here.'}</p></td></tr>
                )}
                {anyLoading && shown.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              </tbody>
              {sorted.length > 0 && (
                <tfoot className="sticky bottom-0 bg-slate-100 border-t border-slate-300 font-bold text-[13px]">
                  <tr><td colSpan={5} className="px-3 py-2 text-right text-slate-600">Total ({sorted.length} rows)</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-600" data-testid="total-debit">{money(totals.debit) || '0.00'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600" data-testid="total-credit">{money(totals.credit) || '0.00'}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">Balance <span data-testid="total-balance">{money(Math.abs(totals.debit - totals.credit)) || '0.00'} {drCr(totals.debit - totals.credit)}</span></td></tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 border-t border-slate-100">
            <span data-testid="showing">{sorted.length === 0 ? 'Showing 0 entries' : `Showing ${pageSize === 0 ? 1 : (cur - 1) * pageSize + 1} to ${pageSize === 0 ? sorted.length : Math.min(cur * pageSize, sorted.length)} of ${sorted.length} entries`}</span>
            <span className="flex items-center gap-1.5">
              <button className={`${btn} !h-8 !px-2`} aria-label="Previous page" disabled={cur <= 1} onClick={() => setPage(cur - 1)}><ChevronLeft size={14} /></button>
              <span>Page {cur} of {pages}</span>
              <button className={`${btn} !h-8 !px-2`} aria-label="Next page" disabled={cur >= pages} onClick={() => setPage(cur + 1)}><ChevronRight size={14} /></button>
            </span>
          </div>
        </section>
      </div>

      <Modal open={!!preview} onClose={closePreview} title={reportTitle} subtitle="Preview" size="xl" draggable={false}
        footer={<><Button variant="secondary" onClick={closePreview}>Close</Button>
          <Button variant="secondary" icon={<Printer size={14} />} onClick={printPreview}>Print</Button>
          <Button icon={<FileDown size={14} />} onClick={() => void downloadPdf()}>Download PDF</Button></>}>
        {preview && <iframe ref={previewFrame} title="Ledger preview" data-testid="ledger-preview-frame" src={preview} className="w-full h-[68vh] rounded-lg border border-slate-200 bg-slate-100" />}
      </Modal>
      <StatementModal open={modal === 'statement'} onClose={() => setModal(null)} lines={all} parties={parties} party={stmtParty} setParty={setStmtParty} initFrom={applied.from} initTo={applied.to} company={company?.company_name ?? ''} />
      <BookModal open={modal === 'book'} onClose={() => setModal(null)} lines={filterLines(all, { from: applied.from, to: applied.to })} onOpen={p => { setStmtParty(p); setModal('statement'); }} />
    </div>
  );
}

function StatementModal({ open, onClose, lines, parties, party, setParty, initFrom, initTo, company }: {
  open: boolean; onClose: () => void; lines: LedgerLine[]; parties: string[]; party: string; setParty: (p: string) => void; initFrom: string; initTo: string; company: string;
}) {
  const [from, setFrom] = useState(initFrom);
  const [to, setTo] = useState(initTo);
  useEffect(() => { if (open) { setFrom(initFrom); setTo(initTo); } }, [open, initFrom, initTo]);
  const st = useMemo(() => (party ? statementFor(lines, party, from || undefined, to || undefined) : null), [lines, party, from, to]);

  const csv = () => {
    if (!st || !party) return;
    exportCsv(`statement-${party.replace(/[^\w]+/g, '_')}`, [['Party', party], ['From', from ? dmy(from) : ''], ['To', to ? dmy(to) : ''], [], ['Date', 'Reference', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance'],
      ['', '', 'Opening balance', '', '', '', `${Math.abs(st.opening)} ${drCr(st.opening)}`],
      ...st.rows.map(r => [dmy(r.date), r.ref, r.particulars, r.narration, r.debit || '', r.credit || '', `${Math.abs(r.balance)} ${drCr(r.balance)}`]),
      ['', '', 'Closing balance', '', st.debit, st.credit, `${Math.abs(st.closing)} ${drCr(st.closing)}`]]);
  };
  const pdf = async () => {
    if (!st || !party) return;
    const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    doc.setFontSize(14); doc.text(`Ledger Statement - ${party}`, 14, 14);
    doc.setFontSize(9); doc.text(`${company}  |  ${from ? dmy(from) : 'start'} to ${to ? dmy(to) : 'today'}`, 14, 20);
    const bal = (n: number) => `${Math.abs(n).toFixed(2)} ${drCr(n)}`.trim();
    autoTable(doc, {
      startY: 25, styles: { fontSize: 8, cellPadding: 1.6 }, headStyles: { fillColor: [51, 65, 85] },
      head: [['Date', 'Reference', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance']],
      body: [['', '', 'Opening balance', '', '', '', bal(st.opening)], ...st.rows.map(r => [dmy(r.date), r.ref, r.particulars, r.narration, r.debit ? r.debit.toFixed(2) : '', r.credit ? r.credit.toFixed(2) : '', bal(r.balance)]), ['', '', 'Closing balance', '', st.debit.toFixed(2), st.credit.toFixed(2), bal(st.closing)]],
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    });
    doc.save(`statement-${party.replace(/[^\w]+/g, '_')}.pdf`);
  };

  return (
    <Modal open={open} onClose={onClose} title="Ledger Statement" subtitle="Running balance for one party" size="2xl"
      footer={<><button className={btn} onClick={onClose}>Close</button><button className={btn} disabled={!st} onClick={csv}><FileSpreadsheet size={14} />CSV</button><button className={btnPrimary} disabled={!st} data-testid="statement-pdf" onClick={() => void pdf()}><FileDown size={14} />Download PDF</button></>}>
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100">
        <select aria-label="Statement party" className={`${sel} w-72`} value={party} onChange={e => setParty(e.target.value)}><option value="">-- Select party --</option>{parties.map(p => <option key={p} value={p}>{p}</option>)}</select>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">From <input type="date" aria-label="Statement from" className={inp} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">To <input type="date" aria-label="Statement to" className={inp} value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      {!st ? <p className="py-10 text-center text-sm text-slate-400">Choose a party to see the statement.</p> : (
        <div className="mt-3 overflow-auto max-h-[420px] border border-slate-200 rounded-xl">
          <table className="w-full text-xs min-w-[760px]">
            <thead className="bg-slate-50 sticky top-0"><tr className="text-left">{['Date', 'Reference', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance'].map((h, i) => <th key={h} className={`${th} ${i >= 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>
              <tr className="bg-slate-50/70 font-semibold"><td colSpan={6} className="px-3 py-2">Opening balance</td><td className="px-3 py-2 text-right tabular-nums" data-testid="stmt-opening">{money(Math.abs(st.opening)) || '0.00'} {drCr(st.opening)}</td></tr>
              {st.rows.map(r => (
                <tr key={r.id} data-testid="stmt-row" className="border-t border-slate-100"><td className="px-3 py-2 whitespace-nowrap">{dmy(r.date)}</td><td className="px-3 py-2 font-mono">{r.ref}</td><td className="px-3 py-2 uppercase">{r.particulars}</td><td className="px-3 py-2">{r.narration}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-600">{money(r.debit)}</td><td className="px-3 py-2 text-right tabular-nums text-emerald-600">{money(r.credit)}</td><td className="px-3 py-2 text-right tabular-nums font-semibold">{money(Math.abs(r.balance)) || '0.00'} {drCr(r.balance)}</td></tr>
              ))}
              {st.rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No entries for this party in the period.</td></tr>}
              <tr className="bg-slate-100 font-bold border-t border-slate-300"><td colSpan={4} className="px-3 py-2 text-right">Closing balance</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-600" data-testid="stmt-debit">{money(st.debit) || '0.00'}</td><td className="px-3 py-2 text-right tabular-nums text-emerald-600" data-testid="stmt-credit">{money(st.credit) || '0.00'}</td>
                <td className="px-3 py-2 text-right tabular-nums" data-testid="stmt-closing">{money(Math.abs(st.closing)) || '0.00'} {drCr(st.closing)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function BookModal({ open, onClose, lines, onOpen }: { open: boolean; onClose: () => void; lines: LedgerLine[]; onOpen: (party: string) => void }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const sum = useMemo(() => summarizeByParty(lines), [lines]);
  const rows = sum.filter(s => (!q.trim() || s.party.toLowerCase().includes(q.trim().toLowerCase())) && (!type || s.ledgerType === type));
  const types = Array.from(new Set(sum.map(s => s.ledgerType).filter(Boolean))).sort();
  const tot = rows.reduce((a, s) => ({ d: a.d + s.debit, c: a.c + s.credit }), { d: 0, c: 0 });
  return (
    <Modal open={open} onClose={onClose} title="Ledger Book" subtitle="Party-wise totals. Click a party to open its statement." size="2xl"
      footer={<button className={btn} onClick={onClose}>Close</button>}>
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100">
        <div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-slate-400" /><input aria-label="Search parties" className={`${inp} pl-8 w-64`} placeholder="Search party" value={q} onChange={e => setQ(e.target.value)} /></div>
        <select aria-label="Ledger type filter" className={sel} value={type} onChange={e => setType(e.target.value)}><option value="">All types</option>{types.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <span className="ml-auto text-xs text-slate-500">{rows.length} parties</span>
      </div>
      <div className="mt-3 overflow-auto max-h-[440px] border border-slate-200 rounded-xl">
        <table className="w-full text-[13px] min-w-[720px]">
          <thead className="bg-slate-50 sticky top-0"><tr className="text-left">{['Party', 'Type', 'Entries', 'Debit', 'Credit', 'Balance'].map((h, i) => <th key={h} className={`${th} ${i >= 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.party} data-testid="book-row" className="border-t border-slate-100 hover:bg-orange-50/40 cursor-pointer" onClick={() => s.party !== '(no party)' && onOpen(s.party)}>
                <td className="px-3 py-2 uppercase font-medium">{s.party}</td><td className="px-3 py-2">{s.ledgerType}</td><td className="px-3 py-2 tabular-nums">{s.entries}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-600">{money(s.debit)}</td><td className="px-3 py-2 text-right tabular-nums text-emerald-600">{money(s.credit)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold ${s.balance > 0 ? 'text-red-600' : s.balance < 0 ? 'text-emerald-600' : ''}`}>{money(Math.abs(s.balance)) || '0.00'} {drCr(s.balance)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">No parties.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot className="bg-slate-100 font-bold border-t border-slate-300"><tr><td colSpan={3} className="px-3 py-2 text-right">Total</td><td className="px-3 py-2 text-right tabular-nums text-red-600" data-testid="book-debit">{money(tot.d) || '0.00'}</td><td className="px-3 py-2 text-right tabular-nums text-emerald-600" data-testid="book-credit">{money(tot.c) || '0.00'}</td><td className="px-3 py-2 text-right tabular-nums">{money(Math.abs(tot.d - tot.c)) || '0.00'} {drCr(tot.d - tot.c)}</td></tr></tfoot>}
        </table>
      </div>
    </Modal>
  );
}

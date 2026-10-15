import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileText, ClipboardList, BarChart3, PieChart, ChevronRight, ChevronDown, CalendarDays, Info,
  Download, Printer, FileDown, AlertTriangle, CheckCircle2, Loader2, Building2, Play,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { Button } from '@/components/ui/Card';
import {
  accountingApi, childrenMap, type BalanceSheet, type FinancialYear, type ReportRow,
} from '@/lib/accounting';
import { formatDate, formatINR, formatPercent, isZero, todayISO, toPaise } from '@/lib/format';
import { exportCsv, escapeHtml, printHtml } from '@/lib/reportExport';

// ---------------------------------------------------------------------------------------
// Balance Sheet. Every figure comes from erp_balance_sheet() — journal lines aggregated in
// the database for the current company. This page never edits or stores amounts.
// ---------------------------------------------------------------------------------------

type ViewMode = 'summary' | 'detailed';
type Tone = 'assets' | 'liabilities' | 'equity';

const TONES: Record<Tone, { head: string; section: string; sub: string; total: string; text: string }> = {
  assets: { head: 'bg-emerald-50/70', section: 'bg-emerald-50/60', sub: 'bg-emerald-50/30', total: 'bg-emerald-50', text: 'text-emerald-900' },
  liabilities: { head: 'bg-orange-50/80', section: 'bg-orange-50/70', sub: 'bg-orange-50/40', total: 'bg-sky-50', text: 'text-slate-900' },
  equity: { head: 'bg-sky-50', section: 'bg-sky-50/80', sub: 'bg-sky-50/40', total: 'bg-sky-50', text: 'text-sky-950' },
};

const money = (v: string | null | undefined) => formatINR(v, { symbol: false, negative: 'parentheses' });

/** Default as-on date for a financial year: today if inside it, otherwise its nearest end. */
function defaultAsOf(fy: FinancialYear) {
  const today = todayISO();
  if (today < fy.start_date) return fy.start_date;
  if (today > fy.end_date) return fy.end_date;
  return today;
}

interface FlatRow {
  row: ReportRow;
  label: string;
  kind: 'section' | 'subsection' | 'account';
  depth: number;
  tone: Tone;
  hasChildren: boolean;
}

/** Report rows of one side, flattened in display order (all levels; visibility applied later). */
function flattenSide(rows: ReportRow[], types: ReportRow['account_type'][]) {
  const kids = childrenMap(rows);
  const roots = (kids.get(null) ?? []).filter(r => types.includes(r.account_type));
  const out: FlatRow[] = [];
  const walk = (r: ReportRow, depth: number, tone: Tone) => {
    const c = kids.get(r.id) ?? [];
    out.push({ row: r, label: r.name, kind: 'account', depth, tone, hasChildren: c.length > 0 });
    c.forEach(k => walk(k, depth + 1, tone));
  };
  roots.forEach((root, i) => {
    const tone: Tone = root.account_type === 'ASSET' ? 'assets' : root.account_type === 'EQUITY' ? 'equity' : 'liabilities';
    out.push({ row: root, label: `${i + 1}. ${root.name}`, kind: 'section', depth: 0, tone, hasChildren: true });
    const children = kids.get(root.id) ?? [];
    // Groups that carry a Current / Non-Current classification become numbered sub-sections (1.1, 1.2).
    const numbered = children.length > 0 && children.every(c => c.is_group && c.bs_class);
    children.forEach((child, j) => {
      if (numbered) {
        out.push({ row: child, label: `${i + 1}.${j + 1} ${child.name}`, kind: 'subsection', depth: 0, tone, hasChildren: true });
        (kids.get(child.id) ?? []).forEach(k => walk(k, 0, tone));
      } else {
        walk(child, 0, tone);
      }
    });
  });
  return { out, kids };
}

export function BalanceSheetPage() {
  const navigate = useNavigate();
  const { company } = useAuth();
  const [params, setParams] = useSearchParams();

  const [years, setYears] = useState<FinancialYear[]>([]);
  const [yearsError, setYearsError] = useState<string | null>(null);
  const [fyId, setFyId] = useState<string>(params.get('fy') ?? '');
  const [asOf, setAsOf] = useState<string>(params.get('asOf') ?? '');
  const [view, setView] = useState<ViewMode>(params.get('view') === 'detailed' ? 'detailed' : 'summary');

  const [report, setReport] = useState<BalanceSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const fy = years.find(y => y.id === fyId) ?? null;

  const generate = useCallback(async (targetFy: FinancialYear | null, date: string) => {
    if (!targetFy) { setValidation('Select a financial year.'); return; }
    if (!date) { setValidation('Select the as-on date.'); return; }
    if (date < targetFy.start_date || date > targetFy.end_date) {
      setValidation(`The as-on date must fall within ${targetFy.name} (${formatDate(targetFy.start_date)} – ${formatDate(targetFy.end_date)}).`);
      return;
    }
    setValidation(null);
    setLoading(true);
    setError(null);
    setReport(null); // never show stale figures while recalculating
    try {
      const bs = await accountingApi.balanceSheet(targetFy.id, date);
      setReport(bs);
      setParams(prev => { const p = new URLSearchParams(prev); p.set('fy', targetFy.id); p.set('asOf', date); return p; }, { replace: true });
    } catch (e) {
      console.error('Balance sheet failed:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [setParams]);

  // Financial years come from the company's accounting configuration.
  useEffect(() => {
    if (!company) return;
    let cancelled = false;
    accountingApi.financialYears()
      .then(res => {
        if (cancelled) return;
        setYears(res.years);
        const chosen = res.years.find(y => y.id === params.get('fy')) ?? res.years.find(y => y.is_current) ?? res.years[0];
        if (!chosen) return;
        const date = params.get('asOf') && params.get('asOf')! >= chosen.start_date && params.get('asOf')! <= chosen.end_date
          ? params.get('asOf')! : defaultAsOf(chosen);
        setFyId(chosen.id);
        setAsOf(date);
        generate(chosen, date);
      })
      .catch(e => { if (!cancelled) setYearsError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per company
  }, [company?.id]);

  const handleYearChange = useCallback((id: string) => {
    const next = years.find(y => y.id === id) ?? null;
    setFyId(id);
    if (!next) return;
    const date = defaultAsOf(next);
    setAsOf(date);
    generate(next, date);
  }, [years, generate]);

  const handleDateChange = useCallback((date: string) => {
    setAsOf(date);
    if (date) generate(fy, date);
  }, [fy, generate]);

  const handleViewChange = (v: ViewMode) => {
    setView(v);
    setParams(prev => { const p = new URLSearchParams(prev); p.set('view', v); return p; }, { replace: true });
  };

  // ---- Derived display structure -------------------------------------------------------
  const sides = useMemo(() => {
    if (!report) return null;
    const assets = flattenSide(report.rows, ['ASSET']);
    const liabEq = flattenSide(report.rows, ['LIABILITY', 'EQUITY']);
    return { assets, liabEq };
  }, [report]);

  // Detailed view opens everything; summary starts with groups collapsed.
  useEffect(() => {
    if (!report) return;
    setExpanded(view === 'detailed' ? new Set(report.rows.filter(r => r.is_group).map(r => r.id)) : new Set());
  }, [report, view]);

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** Rows actually shown: children of collapsed accounts are hidden; summary hides zero balances. */
  const visible = useCallback((flat: FlatRow[]) => {
    const shown: FlatRow[] = [];
    const hiddenBelow: { depth: number } [] = [];
    for (const f of flat) {
      if (f.kind !== 'account') { hiddenBelow.length = 0; shown.push(f); continue; }
      while (hiddenBelow.length && hiddenBelow[hiddenBelow.length - 1].depth >= f.depth) hiddenBelow.pop();
      if (hiddenBelow.length) continue;
      if (view === 'summary' && isZero(f.row.amount) && !f.row.virtual) {
        hiddenBelow.push({ depth: f.depth });
        continue;
      }
      shown.push(f);
      if (f.hasChildren && !expanded.has(f.row.id)) hiddenBelow.push({ depth: f.depth });
    }
    return shown;
  }, [expanded, view]);

  const openRow = (r: ReportRow) => {
    if (!report) return;
    if (r.link === 'profit_loss') {
      navigate(`/accounts/profit-loss?from=${report.financial_year.start_date}&to=${report.as_of}`);
      return;
    }
    const accountId = r.virtual ? r.parent_id : r.id;
    if (accountId) navigate(`/accounts/ledger?tab=ledger&account=${accountId}&from=${report.financial_year.start_date}&to=${report.as_of}`);
  };

  // ---- Export / print / PDF -----------------------------------------------------------
  const allRowsForExport = () => {
    if (!report || !sides) return [];
    const toLine = (side: string, f: FlatRow, total: string) => [
      side, f.kind === 'account' ? `${'  '.repeat(f.depth)}${f.label}` : f.label,
      f.kind, formatINR(f.row.amount, { symbol: false, decimals: 'always' }), formatPercent(f.row.amount, total),
    ];
    return [
      ...sides.assets.out.map(f => toLine('Assets', f, report.totals.assets)),
      ['Assets', 'TOTAL ASSETS', 'total', formatINR(report.totals.assets, { symbol: false, decimals: 'always' }), '100.0%'],
      ...sides.liabEq.out.map(f => toLine('Liabilities & Equity', f, report.totals.liabilities_and_equity)),
      ['Liabilities & Equity', 'TOTAL LIABILITIES & EQUITY', 'total', formatINR(report.totals.liabilities_and_equity, { symbol: false, decimals: 'always' }), '100.0%'],
    ];
  };

  const fileBase = () => report
    ? `Balance-Sheet_${report.company.replace(/\W+/g, '-')}_${report.financial_year.name.replace(/\W+/g, '')}_as-on-${report.as_of}`
    : 'Balance-Sheet';

  const handleCsv = () => {
    if (!report) return;
    exportCsv(fileBase(), [
      ['Balance Sheet'], ['Company', report.company], ['Financial Year', report.financial_year.name],
      ['As on', formatDate(report.as_of)], ['Balanced', report.balanced ? 'Yes' : `No (difference ${report.difference})`], [],
      ['Side', 'Particulars', 'Row type', 'Amount (INR)', '% of Total'],
      ...allRowsForExport(),
      [], ['Current Ratio', report.current_ratio ?? 'n/a'],
    ]);
    setExportOpen(false);
  };

  const handlePrint = () => {
    if (!report || !sides) return;
    const table = (title: string, flat: FlatRow[], total: string, totalLabel: string) => `
      <table><thead><tr><th>${escapeHtml(title)}</th><th class="num">Amount (₹)</th><th class="num">% of Total</th></tr></thead><tbody>
      ${visible(flat).map(f => `<tr class="${f.kind !== 'account' ? 'group' : ''}">
        <td style="padding-left:${8 + (f.kind === 'account' ? (f.depth + 1) * 14 : 0)}px">${escapeHtml(f.label)}</td>
        <td class="num">${escapeHtml(money(f.row.amount))}</td><td class="num">${escapeHtml(formatPercent(f.row.amount, total))}</td></tr>`).join('')}
      <tr class="total"><td>${escapeHtml(totalLabel)}</td><td class="num">${escapeHtml(money(total))}</td><td class="num">100.0%</td></tr>
      </tbody></table>`;
    printHtml(`Balance Sheet — ${report.company}`, `
      <div class="brand"><div><h1>Balance Sheet</h1>
        <div class="meta">${escapeHtml(report.company)} · ${escapeHtml(report.financial_year.name)} · As on ${escapeHtml(formatDate(report.as_of))}</div></div>
        <img src="${window.location.origin}/arguscnc-logo.jpg" alt="ARGUS CNC"></div>
      <div class="cols">${table('Assets', sides.assets.out, report.totals.assets, 'TOTAL ASSETS')}
        ${table('Liabilities & Equity', sides.liabEq.out, report.totals.liabilities_and_equity, 'TOTAL LIABILITIES & EQUITY')}</div>
      <p class="${report.balanced ? 'ok' : 'warn'}">${report.balanced
        ? 'Balanced: Total Assets = Total Liabilities + Total Equity'
        : `Not balanced — difference ${escapeHtml(money(report.difference))}. Please review accounting entries.`}</p>
      <p class="note">Current ratio: ${escapeHtml(report.current_ratio ?? 'n/a')} · Figures are as per books of accounts and subject to final audit.
        Generated ${escapeHtml(new Date(report.generated_at).toLocaleString('en-IN', { hour12: false }))}.</p>`);
  };

  const handlePdf = async () => {
    if (!report || !sides) return;
    setPdfBusy(true);
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      // PDF core fonts have no ₹ glyph, so amounts are labelled INR.
      const amt = (v: string) => formatINR(v, { symbol: false, negative: 'parentheses', decimals: 'always' });

      try {
        const blob = await (await fetch('/arguscnc-logo.jpg')).blob();
        const dataUrl = await new Promise<string>((res, rej) => {
          const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(blob);
        });
        doc.addImage(dataUrl, 'JPEG', pageW - 170, 24, 130, 40);
      } catch { /* logo is optional */ }

      doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Balance Sheet', 40, 46);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(71, 85, 105);
      doc.text(`${report.company}  |  ${report.financial_year.name}  |  As on ${formatDate(report.as_of)}`, 40, 64);
      doc.setDrawColor(242, 90, 10); doc.setLineWidth(2); doc.line(40, 76, pageW - 40, 76);
      doc.setTextColor(15, 23, 42);

      const colW = (pageW - 100) / 2;
      const body = (flat: FlatRow[], total: string) => flat.map(f => [
        { content: f.kind === 'account' ? `${'   '.repeat(f.depth + 1)}${f.label}` : f.label, styles: f.kind !== 'account' ? { fontStyle: 'bold' as const, fillColor: [248, 250, 252] as [number, number, number] } : {} },
        { content: amt(f.row.amount), styles: { halign: 'right' as const, fontStyle: (f.kind !== 'account' ? 'bold' : 'normal') as 'bold' | 'normal' } },
        { content: formatPercent(f.row.amount, total), styles: { halign: 'right' as const } },
      ]);
      const common = { startY: 90, theme: 'plain' as const, styles: { fontSize: 8.5, cellPadding: 3 }, headStyles: { fillColor: [241, 245, 249] as [number, number, number], fontStyle: 'bold' as const } };
      autoTable(doc, {
        ...common, margin: { left: 40 }, tableWidth: colW,
        head: [['ASSETS', { content: 'Amount (INR)', styles: { halign: 'right' } }, { content: '% of Total', styles: { halign: 'right' } }]],
        body: body(visible(sides.assets.out), report.totals.assets),
        foot: [['TOTAL ASSETS', { content: amt(report.totals.assets), styles: { halign: 'right' } }, { content: '100.0%', styles: { halign: 'right' } }]],
        footStyles: { fillColor: [236, 253, 245], fontStyle: 'bold', textColor: [6, 78, 59] },
      });
      const docWithTable = doc as unknown as { lastAutoTable?: { finalY: number } };
      const leftEnd = docWithTable.lastAutoTable?.finalY ?? 0;
      autoTable(doc, {
        ...common, margin: { left: 60 + colW }, tableWidth: colW,
        head: [['LIABILITIES & EQUITY', { content: 'Amount (INR)', styles: { halign: 'right' } }, { content: '% of Total', styles: { halign: 'right' } }]],
        body: body(visible(sides.liabEq.out), report.totals.liabilities_and_equity),
        foot: [['TOTAL LIABILITIES & EQUITY', { content: amt(report.totals.liabilities_and_equity), styles: { halign: 'right' } }, { content: '100.0%', styles: { halign: 'right' } }]],
        footStyles: { fillColor: [240, 249, 255], fontStyle: 'bold', textColor: [8, 47, 73] },
      });

      // Below the taller of the two tables; start a new page if there is no room left.
      let y = Math.max(leftEnd, docWithTable.lastAutoTable?.finalY ?? 0) + 24;
      if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 50; }
      doc.setFontSize(10);
      if (report.balanced) { doc.setTextColor(21, 128, 61); doc.text('Balanced: Total Assets = Total Liabilities + Total Equity', 40, y); }
      else { doc.setTextColor(185, 28, 28); doc.text(`NOT BALANCED - difference INR ${amt(report.difference)}. Please review accounting entries.`, 40, y); }
      y += 16;
      doc.setTextColor(100, 116, 139); doc.setFontSize(8.5);
      doc.text(`Current ratio: ${report.current_ratio ?? 'n/a'}   |   Figures are as per books of accounts and subject to final audit.   |   Generated ${new Date(report.generated_at).toLocaleString('en-IN', { hour12: false })}   |   Powered by ArgusCNC`, 40, y);
      doc.save(`${fileBase()}.pdf`);
    } catch (e) {
      console.error('PDF failed:', e);
      alert('Could not create the PDF: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPdfBusy(false);
    }
  };

  const csvRef = useRef<() => void>(() => {});
  const printRef = useRef<() => void>(() => {});
  csvRef.current = handleCsv;
  printRef.current = handlePrint;
  const hasReport = !!report;

  const { setHeader, setTabActions, setHeaderCenter } = useHeaderKpis();

  useEffect(() => {
    if (!company) {
      setHeader(null);
      setHeaderCenter(null);
      setTabActions(null);
      return;
    }

    setHeader({ title: 'Balance Sheet' });
    setHeaderCenter(
      <div className="flex items-center gap-2">
        <select
          aria-label="Financial year"
          className="h-7 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400"
          value={fyId}
          onChange={e => handleYearChange(e.target.value)}
          disabled={loading || years.length === 0}
        >
          {years.length === 0 && <option value="">Loading…</option>}
          {years.map(y => <option key={y.id} value={y.id}>{y.name}{y.status === 'Closed' ? ' (closed)' : ''}</option>)}
        </select>
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-md px-1.5 h-7 shadow-sm">
          <span className="text-[11px] font-medium text-slate-500">As on</span>
          <input
            aria-label="As on date"
            type="date"
            className="text-xs text-slate-700 bg-transparent focus:outline-none"
            value={asOf}
            min={fy?.start_date}
            max={fy?.end_date}
            onChange={e => handleDateChange(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => generate(fy, asOf)}
          disabled={loading || !fy}
          className="h-7 px-2.5 text-xs font-bold text-white bg-gradient-to-b from-orange-500 to-orange-600 hover:from-orange-500 hover:to-orange-700 rounded-md shadow-sm flex items-center gap-1 active:scale-[0.98] transition disabled:opacity-40 cursor-pointer"
        >
          {loading ? <Loader2 size={12} className="animate-spin text-white" /> : <Play size={11} className="fill-white" />}
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
  }, [company, fyId, asOf, years, loading, hasReport, fy, setHeader, setHeaderCenter, setTabActions, handleYearChange, handleDateChange, generate]);

  // ---- Render -----------------------------------------------------------------------------
  if (!company) {
    return (
      <div className="p-4 lg:p-6 min-h-full">
        <div className="max-w-xl mx-auto mt-16 bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <Building2 className="mx-auto text-slate-400 mb-3" size={28} />
          <h2 className="text-lg font-bold text-slate-800">Select a company</h2>
          <p className="text-sm text-slate-500 mt-1">Choose a company in the top bar to view its Balance Sheet. Accounts are never combined across companies.</p>
        </div>
      </div>
    );
  }

  const t = report?.totals;
  const cards = [
    { label: 'Total Assets', icon: FileText, tint: 'bg-emerald-50 text-emerald-600 border border-emerald-100', value: t?.assets,
      note: t ? `Non-current ${formatINR(t.non_current_assets)} · Current ${formatINR(t.current_assets)}` : '' },
    { label: 'Total Liabilities', icon: ClipboardList, tint: 'bg-sky-50 text-sky-600 border border-sky-100', value: t?.liabilities,
      note: t ? `Non-current ${formatINR(t.non_current_liabilities)} · Current ${formatINR(t.current_liabilities)}` : '' },
    { label: 'Total Equity', icon: BarChart3, tint: 'bg-orange-50 text-orange-600 border border-orange-100', value: t?.equity,
      note: t ? `Incl. period profit ${formatINR(t.profit_current_period, { negative: 'parentheses' })}` : '' },
  ];

  return (
    <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 min-h-full bg-slate-50/60">
      {/* Header */}
      <div className="lg:hidden flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4 mb-5">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Balance Sheet</h1>
          <p className="text-sm text-slate-500 mt-1">Financial position of your business</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Financial year"
            value={fyId}
            onChange={e => handleYearChange(e.target.value)}
            className="h-11 min-w-[180px] px-4 text-sm font-medium bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
          >
            {years.length === 0 && <option value="">Loading…</option>}
            {years.map(y => <option key={y.id} value={y.id}>{y.name}{y.status === 'Closed' ? ' (closed)' : ''}</option>)}
          </select>
          <label className="h-11 flex items-center gap-3 px-4 bg-white border border-slate-200 rounded-lg shadow-sm focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:border-brand-500">
            <span className="text-xs text-slate-500">As on</span>
            <input
              type="date"
              aria-label="As on date"
              value={asOf}
              min={fy?.start_date}
              max={fy?.end_date}
              onChange={e => handleDateChange(e.target.value)}
              className="text-sm font-medium text-slate-800 bg-transparent focus:outline-none"
            />
            <CalendarDays size={16} className="text-slate-400 pointer-events-none" />
          </label>
          <button
            onClick={() => generate(fy, asOf)}
            disabled={loading || !fy}
            className="h-11 px-8 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg shadow-lg shadow-brand-600/20 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />} Generate
          </button>
        </div>
      </div>

      {(validation || yearsError) && (
        <div className="mb-4 flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> {validation || yearsError}
        </div>
      )}
      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="font-semibold flex items-center gap-2"><AlertTriangle size={16} /> Unable to generate Balance Sheet. Please try again.</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
        </div>
      )}
      {report && !report.balanced && (
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle size={16} /> Balance Sheet is not balanced (difference {formatINR(report.difference, { negative: 'parentheses' })}). Please review accounting entries.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
        {cards.map(c => (
          <div key={c.label} className="bg-white border border-slate-200/90 rounded-lg shadow-xs px-3 py-2 flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${c.tint}`}><c.icon size={16} /></div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-slate-500 leading-tight truncate">{c.label}</p>
              {loading || !report ? <div className="h-4 w-24 my-0.5 rounded bg-slate-100 animate-pulse" />
                : <p className="text-sm font-bold text-slate-900 tracking-tight leading-tight">{formatINR(c.value, { negative: 'parentheses' })}</p>}
              {report && !loading && <p className="text-[10px] text-slate-400 mt-0.5 truncate leading-none">{c.note}</p>}
            </div>
          </div>
        ))}
        <div className="bg-white border border-slate-200/90 rounded-lg shadow-xs px-3 py-2 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-violet-50 text-violet-600 border border-violet-100"><PieChart size={16} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-slate-500 leading-tight truncate">Current Ratio</p>
            {loading || !report ? <div className="h-4 w-12 my-0.5 rounded bg-slate-100 animate-pulse" />
              : <p className="text-sm font-bold text-slate-900 tracking-tight leading-tight">{report.current_ratio ?? '—'}</p>}
            {report && !loading && (
              <p className="text-[10px] text-slate-400 mt-0.5 truncate leading-none">
                {report.current_ratio ? 'Current assets ÷ current liabilities' : isZero(report.totals.current_liabilities) ? 'No current liabilities' : 'Not available'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Report body */}
      {loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[0, 1].map(i => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              {Array.from({ length: 10 }).map((_, j) => <div key={j} className="h-6 rounded bg-slate-100 animate-pulse" />)}
            </div>
          ))}
        </div>
      )}

      {!loading && report && !report.has_data && (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center">
          <Info className="mx-auto text-slate-400 mb-3" size={26} />
          <p className="text-slate-700 font-medium">No accounting data available for the selected period.</p>
          <p className="text-sm text-slate-500 mt-1">Post invoices, goods receipts or vouchers and generate again.</p>
        </div>
      )}

      {!loading && report && report.has_data && sides && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <ReportPanel
            title="ASSETS" tone="assets" rows={visible(sides.assets.out)} total={report.totals.assets}
            totalLabel="TOTAL ASSETS" expanded={expanded} onToggle={toggle} onOpen={openRow}
          />
          <ReportPanel
            title="LIABILITIES & EQUITY" tone="liabilities" rows={visible(sides.liabEq.out)} total={report.totals.liabilities_and_equity}
            totalLabel="TOTAL LIABILITIES & EQUITY" expanded={expanded} onToggle={toggle} onOpen={openRow}
          />
        </div>
      )}

      {/* Footer actions */}
      <div className="mt-5 bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="text-xs text-slate-600 flex items-center gap-2">
          <Info size={16} className="text-slate-700 flex-shrink-0" />
          <span><span className="font-semibold text-slate-800">Note:</span> Figures are as per books of accounts and subject to final audit.</span>
          {report && !loading && (report.balanced
            ? <span className="ml-2 inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 size={14} /> Balanced</span>
            : <span className="ml-2 inline-flex items-center gap-1 text-red-700 font-semibold"><AlertTriangle size={14} /> Not balanced</span>)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            View As
            <select value={view} onChange={e => handleViewChange(e.target.value as ViewMode)}
              className="h-9 min-w-[150px] px-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20">
              <option value="summary">Summary</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <div className="relative">
            <button onClick={() => setExportOpen(o => !o)} disabled={!report}
              className="h-9 px-4 flex items-center gap-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
              <Download size={15} /> Export <ChevronDown size={14} />
            </button>
            {exportOpen && report && (
              <div className="absolute right-0 bottom-full mb-1 w-52 bg-white border border-slate-200 rounded-lg shadow-xl z-20 overflow-hidden">
                <button onClick={handleCsv} className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50">Excel / CSV (all accounts)</button>
                <button onClick={() => { setExportOpen(false); handlePdf(); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50">PDF report</button>
              </div>
            )}
          </div>
          <button onClick={handlePrint} disabled={!report}
            className="h-9 px-4 flex items-center gap-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
            <Printer size={15} /> Print
          </button>
          <button onClick={handlePdf} disabled={!report || pdfBusy}
            className="h-9 px-4 flex items-center gap-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-50">
            {pdfBusy ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />} Download PDF
          </button>
        </div>
      </div>
      {report && !loading && (
        <p className="text-right text-[11px] text-slate-400 mt-2">
          {report.company} · {report.financial_year.name} · as on {formatDate(report.as_of)} · generated {new Date(report.generated_at).toLocaleString('en-IN', { hour12: false })}
        </p>
      )}
    </div>
  );
}

function ReportPanel({ title, tone, rows, total, totalLabel, expanded, onToggle, onOpen }: {
  title: string;
  tone: Tone;
  rows: FlatRow[];
  total: string;
  totalLabel: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (r: ReportRow) => void;
}) {
  const head = TONES[tone];
  const totalTone = tone === 'assets' ? TONES.assets : TONES.equity;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className={`${head.head} border-b border-slate-200`}>
            <th className={`text-left px-5 py-3.5 text-base font-bold tracking-wide ${head.text}`}>{title}</th>
            <th className="text-right px-4 py-3.5 font-semibold text-slate-700 w-36">Amount (₹)</th>
            <th className="text-right px-5 py-3.5 font-semibold text-slate-700 w-28">% of Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(f => {
            const tn = TONES[f.tone];
            const negative = toPaise(f.row.amount) < 0n;
            if (f.kind !== 'account') {
              return (
                <tr key={f.row.id} className={`${f.kind === 'section' ? tn.section : tn.sub} border-b border-slate-200`}>
                  <td className={`px-5 py-2.5 font-bold text-slate-900 ${f.kind === 'subsection' ? 'pl-8 text-[13px]' : 'text-[15px]'}`}>{f.label}</td>
                  <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${negative ? 'text-red-700' : 'text-slate-900'}`}>{money(f.row.amount)}</td>
                  <td className="px-5 py-2.5 text-right font-bold text-slate-900 tabular-nums">{formatPercent(f.row.amount, total)}</td>
                </tr>
              );
            }
            const isOpen = expanded.has(f.row.id);
            return (
              <tr key={f.row.id} className="border-b border-slate-100 hover:bg-slate-50/70 group">
                <td className="py-2.5 pr-3" style={{ paddingLeft: 16 + f.depth * 20 }}>
                  <div className="flex items-center gap-2">
                    {f.hasChildren ? (
                      <button onClick={() => onToggle(f.row.id)} aria-label={isOpen ? 'Collapse' : 'Expand'}
                        className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded">
                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                    ) : <span className="w-5" />}
                    <button onClick={() => onOpen(f.row)} title="Open ledger"
                      className={`text-left hover:text-brand-600 hover:underline underline-offset-2 ${f.row.virtual ? 'italic text-slate-600' : 'text-slate-700'}`}>
                      {f.row.name}
                    </button>
                  </div>
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${negative ? 'text-red-700' : 'text-slate-800'}`}>{money(f.row.amount)}</td>
                <td className="px-5 py-2.5 text-right text-slate-600 tabular-nums">{formatPercent(f.row.amount, total)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className={`${totalTone.total} border-t border-slate-200`}>
            <td className={`px-5 py-4 text-base font-bold ${totalTone.text}`}>{totalLabel}</td>
            <td className={`px-4 py-4 text-right text-lg font-bold tabular-nums ${totalTone.text}`}>{money(total)}</td>
            <td className={`px-5 py-4 text-right text-base font-bold ${totalTone.text}`}>100.0%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

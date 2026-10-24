import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Boxes, CheckCircle2, Download, Eye, FilePlus2, Landmark, Pencil, Plus, Rows3, Search, Trash2, Undo2, Upload, Users } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui/Card';
import { EmptyState, LoadingState } from '@/components/ui/PageHeader';
import { FormField, Modal, inputClass } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { formatDate, formatINR, todayISO } from '@/lib/format';
import { exportCsv } from '@/lib/reportExport';
import {
  num, openingApi, parseStockCsv, stockValue, toIsoDate,
  type OpeningDraft, type OpeningEntry, type OpeningLookups, type OpeningPreview, type OpeningSummary, type OpeningType,
} from '@/lib/openingBalances';


// Opening Balances: enter what the company already had when it started using the ERP (bank balances, what customers owe,
// what is owed to suppliers, stock in the warehouse). Draft -> Validate & Preview -> Post -> view in the ledger / stock.
// A posted entry is never edited or deleted; it is reversed (an audit trail is kept) and a corrected entry entered.

type Tab = 'BANK' | 'PARTY' | 'STOCK';
type PartyKind = 'CUSTOMER' | 'SUPPLIER';

const TABS: { id: Tab; label: string; icon: typeof Landmark }[] = [
  { id: 'BANK', label: 'Bank Opening Balances', icon: Landmark },
  { id: 'PARTY', label: 'Customer & Supplier', icon: Users },
  { id: 'STOCK', label: 'Inventory Opening Stock', icon: Boxes },
];

const th = 'px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-left whitespace-nowrap';
const thR = `${th} !text-right`;
const td = 'px-3 py-2 text-[13px] text-slate-700';
const tdR = `${td} text-right tabular-nums whitespace-nowrap`;
const sel = 'h-9 px-3 text-[13px] font-medium text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15';
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const money = (n: number) => formatINR(n, { decimals: 'always' });
const drCr = (side: string | null) => (side === 'CR' ? 'Cr' : 'Dr');

const statusVariant = (s: string) => (s === 'Posted' ? 'success' : s === 'Draft' ? 'warning' : 'neutral') as 'success' | 'warning' | 'neutral';

type Toast = { kind: 'ok' | 'err'; text: string } | null;

export function OpeningBalancesPage() {
  const navigate = useNavigate();
  const { company } = useAuth();
  const companyId = company?.id ?? null;
  const { setHeader, setTabActions } = useHeaderKpis();

  const [lookups, setLookups] = useState<OpeningLookups | null>(null);
  const [rows, setRows] = useState<OpeningEntry[]>([]);
  const [summary, setSummary] = useState<OpeningSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<Toast>(null);

  const [tab, setTab] = useState<Tab>('BANK');
  const [kind, setKind] = useState<PartyKind>('CUSTOMER');
  const [fyId, setFyId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [form, setForm] = useState<{ type: OpeningType; entry?: OpeningEntry } | null>(null);
  const [bulk, setBulk] = useState<BulkRow[] | null>(null);
  const [preview, setPreview] = useState<OpeningPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [reversing, setReversing] = useState<OpeningEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const say = (kind: 'ok' | 'err', text: string) => { setToast({ kind, text }); window.setTimeout(() => setToast(t => (t && t.text === text ? null : t)), 4500); };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [lk, list] = await Promise.all([openingApi.lookups(), openingApi.list({ status, search, fyId })]);
      setLookups(lk); setRows(list.rows); setSummary(list.summary);
      setPicked(new Set());
    } catch (e) { setError(errText(e)); }
    finally { setLoading(false); }
  }, [status, search, fyId]);

  useEffect(() => {
    if (!companyId) return;
    const t = window.setTimeout(() => { void load(); }, search ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [companyId, load, search]);

  const canManage = !!lookups?.can_manage;
  const shown = useMemo(() => rows.filter(e => (tab === 'PARTY' ? e.entry_type === kind : e.entry_type === tab)), [rows, tab, kind]);
  const drafts = shown.filter(e => e.status === 'Draft');
  const allPicked = drafts.length > 0 && drafts.every(e => picked.has(e.id));
  const togglePick = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const addType: OpeningType = tab === 'BANK' ? 'BANK' : tab === 'STOCK' ? 'STOCK' : kind;
  const addLabel = tab === 'BANK' ? 'Add Bank Balance' : tab === 'STOCK' ? 'Add Opening Stock' : kind === 'CUSTOMER' ? 'Add Customer Balance' : 'Add Supplier Balance';

  useEffect(() => {
    setHeader({ title: 'Opening Balances' });
    setTabActions(null);
    return () => { setHeader(null); setTabActions(null); };
  }, [setHeader, setTabActions]);

  const openPreview = async (ids: string[]) => {
    if (!ids.length) { say('err', 'Select at least one draft entry.'); return; }
    setPreviewBusy(true);
    try { setPreview(await openingApi.validate(ids)); }
    catch (e) { say('err', errText(e)); }
    finally { setPreviewBusy(false); }
  };

  const doPost = async () => {
    if (!preview) return;
    setPreviewBusy(true);
    try {
      const res = await openingApi.post(preview.entries.filter(e => e.status === 'Draft').map(e => e.id));
      setPreview(null);
      say('ok', `Posted ${res.posted} entr${res.posted === 1 ? 'y' : 'ies'}${res.skipped ? ` (${res.skipped} already posted)` : ''}.`);
      await load();
    } catch (e) { say('err', errText(e)); await load(); }
    finally { setPreviewBusy(false); }
  };

  const remove = async (e: OpeningEntry) => {
    if (!window.confirm(`Delete draft ${e.entry_no}? This cannot be undone.`)) return;
    try { await openingApi.remove(e.id); say('ok', 'Draft deleted.'); await load(); }
    catch (err) { say('err', errText(err)); }
  };

  const viewIn = (e: OpeningEntry) => {
    if (e.entry_type === 'BANK' && e.account_id) navigate(`/accounts/ledger?account=${e.account_id}`);
    else if (e.entry_type === 'STOCK') navigate(`/inventory/stock?q=${encodeURIComponent(e.item_name || e.item_code || '')}`);
    else if (e.party_name) navigate(`/accounts/ledger?party=${encodeURIComponent(e.party_name)}`);
  };

  const exportRows = () => {
    exportCsv(`Opening_${tab === 'PARTY' ? kind : tab}_${todayISO()}`, [
      ['Entry No', 'Date', 'Type', 'Name', 'Code', 'Balance type', 'Invoice ref', 'Due date', 'Warehouse', 'Qty', 'Unit cost', 'Amount', 'Status', 'Remarks'],
      ...shown.map(e => [e.entry_no, e.opening_date, e.entry_type,
        e.entry_type === 'BANK' ? e.account_name : e.entry_type === 'STOCK' ? e.item_name : e.party_name,
        e.entry_type === 'STOCK' ? e.item_code : e.party_code, e.balance_type, e.invoice_ref, e.due_date, e.warehouse_name,
        e.qty, e.unit_cost, e.amount, e.status, e.remarks]),
    ]);
  };

  const importCsv = async (file: File | undefined) => {
    if (!file || !lookups) return;
    const { rows: parsed, problems } = parseStockCsv(await file.text());
    if (problems.length) say('err', problems.slice(0, 3).join(' | ') + (problems.length > 3 ? ` (+${problems.length - 3} more)` : ''));
    if (!parsed.length) return;
    const key = (s: string) => s.trim().toLowerCase();
    setBulk(parsed.map(r => {
      const item = lookups.items.find(i => key(i.code ?? '') === key(r.code)) ?? lookups.items.find(i => key(i.name) === key(r.code));
      const wh = r.warehouse ? lookups.warehouses.find(w => key(w.name) === key(r.warehouse) || key(w.code ?? '') === key(r.warehouse)) : undefined;
      return {
        key: `csv-${r.line}`, itemRef: item ? `${item.kind}:${item.id}` : '', warehouse: wh?.id ?? '', qty: String(r.qty), cost: String(r.unitCost || item?.rate || ''),
        date: toIsoDate(r.date), remarks: r.remarks,
        error: !item ? `Line ${r.line}: "${r.code}" is not in the inventory master` : r.warehouse && !wh ? `Line ${r.line}: warehouse "${r.warehouse}" not found` : '',
      };
    }));
  };

  if (!company) {
    return (
      <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full">
        <Card><EmptyState icon={<Landmark size={28} />} title="No company selected" message="Select a company in the top bar to enter its opening balances." /></Card>
      </div>
    );
  }

  const cards: { label: string; value: number; draft: number; tint: string; note: string }[] = [
    { label: 'Total Bank Opening Balance', value: summary?.bank.posted ?? 0, draft: summary?.bank.draft ?? 0, tint: 'border-lime-300 bg-lime-50', note: 'Bank & cash accounts' },
    { label: 'Total Customer Receivables', value: summary?.receivable.posted ?? 0, draft: summary?.receivable.draft ?? 0, tint: 'border-sky-300 bg-sky-50', note: 'Owed to us' },
    { label: 'Total Supplier Payables', value: summary?.payable.posted ?? 0, draft: summary?.payable.draft ?? 0, tint: 'border-amber-300 bg-amber-50', note: 'We owe' },
    { label: 'Total Opening Stock Value', value: summary?.stock.posted ?? 0, draft: summary?.stock.draft ?? 0, tint: 'border-rose-300 bg-rose-50', note: 'Qty × unit cost' },
  ];

  return (
    <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full space-y-3">
      {toast && (
        <div role="status" className={`fixed bottom-20 right-5 z-[80] max-w-sm px-4 py-2.5 rounded-lg shadow-xl text-sm font-semibold ${toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>{toast.text}</div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2" data-testid="opening-summary">
        {cards.map(c => (
          <div key={c.label} className={`rounded-xl border px-3 py-2.5 shadow-sm ${c.tint}`}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{c.label}</p>
            <p className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">{money(c.value)}</p>
            <p className="text-[11px] text-slate-500">{c.note}{c.draft !== 0 && <span className="ml-1 font-semibold text-amber-700">· {money(c.draft)} in draft</span>}</p>
          </div>
        ))}
      </div>

      <Card className="p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 px-1">{lookups?.company?.company_name ?? company.company_name}</span>
          <select aria-label="Financial year" className={sel} value={fyId} onChange={e => setFyId(e.target.value)}>
            <option value="">All financial years</option>
            {(lookups?.financial_years ?? []).map(y => <option key={y.id} value={y.id}>{y.name}{y.status === 'Closed' ? ' (closed)' : ''}</option>)}
          </select>
          <select aria-label="Entry status" className={sel} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option><option>Draft</option><option>Posted</option><option>Reversed</option>
          </select>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input aria-label="Search by name" className={`${sel} pl-8 w-56`} placeholder="Search name, code, entry no…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportRows} disabled={!shown.length}>Export CSV</Button>
            {tab === 'STOCK' && (
              <>
                <Button variant="secondary" size="sm" icon={<Rows3 size={14} />} onClick={() => setBulk([newBulkRow()])}>Bulk Entry</Button>
                <Button variant="secondary" size="sm" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>Import CSV</Button>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Import opening stock CSV"
                  onChange={e => { void importCsv(e.target.files?.[0]); e.target.value = ''; }} />
              </>
            )}
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setForm({ type: addType })}>{addLabel}</Button>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => { setTab(t.id); setPicked(new Set()); }}
            className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-bold border transition ${tab === t.id ? 'bg-orange-600 text-white border-orange-600 shadow' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <t.icon size={14} />{t.label}
          </button>
        ))}
        {tab === 'PARTY' && (
          <div className="ml-2 inline-flex rounded-lg border border-slate-200 overflow-hidden bg-white" role="group" aria-label="Customer or supplier">
            {(['CUSTOMER', 'SUPPLIER'] as PartyKind[]).map(k => (
              <button key={k} type="button" onClick={() => { setKind(k); setPicked(new Set()); }}
                className={`h-9 px-3 text-[13px] font-semibold ${kind === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{k === 'CUSTOMER' ? 'Customers' : 'Suppliers'}</button>
            ))}
          </div>
        )}
        {canManage && drafts.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-500">{picked.size} of {drafts.length} drafts selected</span>
            <Button variant="success" size="sm" icon={<CheckCircle2 size={14} />} onClick={() => openPreview([...picked])} disabled={!picked.size || previewBusy}>Validate, Preview &amp; Post</Button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>
      )}

      <Card className="overflow-hidden">
        {loading && !rows.length ? <LoadingState message="Loading opening entries…" /> : !shown.length ? (
          <EmptyState icon={<FilePlus2 size={28} />} title="No opening entries yet" message={`Use “${addLabel}” to enter the first one. Nothing counts in the books until it is posted.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {canManage && <th className={`${th} w-8`}><input type="checkbox" aria-label="Select all drafts" checked={allPicked} disabled={!drafts.length}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(drafts.map(d => d.id)))} /></th>}
                  <th className={th}>Entry No</th><th className={th}>Date</th>
                  {tab === 'BANK' && (<><th className={th}>Bank Account</th><th className={th}>Remarks</th><th className={thR}>Opening Balance</th></>)}
                  {tab === 'PARTY' && (<><th className={th}>{kind === 'CUSTOMER' ? 'Customer' : 'Supplier'}</th><th className={th}>Balance Type</th><th className={th}>Invoice Ref</th><th className={th}>Due</th><th className={thR}>Amount</th></>)}
                  {tab === 'STOCK' && (<><th className={th}>Product</th><th className={th}>Warehouse</th><th className={thR}>Qty</th><th className={thR}>Unit Cost</th><th className={thR}>Value</th></>)}
                  <th className={th}>Status</th><th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(e => (
                  <tr key={e.id} className="hover:bg-orange-50/40">
                    {canManage && <td className={td}>{e.status === 'Draft' && <input type="checkbox" aria-label={`Select ${e.entry_no}`} checked={picked.has(e.id)} onChange={() => togglePick(e.id)} />}</td>}
                    <td className={`${td} font-mono text-xs`}>{e.entry_no}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(e.opening_date)}</td>
                    {tab === 'BANK' && (<><td className={`${td} font-semibold`}>{e.account_name}</td><td className={`${td} text-slate-500`}>{e.remarks}</td>
                      <td className={`${tdR} font-semibold`}>{money(e.amount)} <span className="text-[10px] text-slate-400">{drCr(e.side)}</span></td></>)}
                    {tab === 'PARTY' && (<><td className={`${td} font-semibold`}>{e.party_name}{e.party_code && <span className="ml-1.5 text-[11px] font-normal text-slate-400">{e.party_code}</span>}</td>
                      <td className={td}>{e.balance_type}</td><td className={td}>{e.invoice_ref ?? ''}</td><td className={`${td} whitespace-nowrap`}>{e.due_date ? formatDate(e.due_date) : ''}</td>
                      <td className={`${tdR} font-semibold`}>{money(e.amount)} <span className="text-[10px] text-slate-400">{drCr(e.side)}</span></td></>)}
                    {tab === 'STOCK' && (<><td className={`${td} font-semibold`}>{e.item_name}{e.item_code && <span className="ml-1.5 text-[11px] font-normal text-slate-400">{e.item_code}</span>}</td>
                      <td className={td}>{e.warehouse_name ?? <span className="text-slate-400">Item default</span>}</td>
                      <td className={tdR}>{num(e.qty).toLocaleString('en-IN')} <span className="text-[10px] text-slate-400">{e.unit}</span></td>
                      <td className={tdR}>{money(num(e.unit_cost))}</td><td className={`${tdR} font-semibold`}>{money(e.amount)}</td></>)}
                    <td className={td}><Badge variant={statusVariant(e.status)} dot>{e.status}</Badge>{e.status === 'Reversed' && e.reverse_reason && <p className="text-[10px] text-slate-400 mt-0.5 max-w-[10rem] truncate" title={e.reverse_reason}>{e.reverse_reason}</p>}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      <div className="inline-flex items-center gap-1">
                        {e.status === 'Draft' && <>
                          <IconBtn label="Edit draft" onClick={() => setForm({ type: e.entry_type, entry: e })}><Pencil size={14} /></IconBtn>
                          <IconBtn label="Validate & preview" onClick={() => openPreview([e.id])}><Eye size={14} /></IconBtn>
                          <IconBtn label="Delete draft" danger onClick={() => remove(e)}><Trash2 size={14} /></IconBtn></>}
                        {e.status !== 'Draft' && <IconBtn label={e.entry_type === 'STOCK' ? 'View stock' : 'View ledger'} onClick={() => viewIn(e)}><Eye size={14} /></IconBtn>}
                        {e.status === 'Posted' && canManage && <IconBtn label="Reverse" danger onClick={() => setReversing(e)}><Undo2 size={14} /></IconBtn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {form && lookups && (
        <EntryForm key={form.entry?.id ?? 'new'} type={form.type} entry={form.entry} lookups={lookups} fyDefault={todayISO()}
          onClose={() => setForm(null)} onSaved={async (msg) => { setForm(null); say('ok', msg); await load(); }} />
      )}
      {bulk && lookups && (
        <BulkStock rows={bulk} lookups={lookups} onClose={() => setBulk(null)} onSaved={async (n) => { setBulk(null); say('ok', `${n} opening stock draft${n === 1 ? '' : 's'} saved. Select them and post.`); await load(); }} />
      )}
      {preview && (
        <PreviewModal data={preview} busy={previewBusy} canPost={canManage} onClose={() => setPreview(null)} onPost={doPost} />
      )}
      {reversing && (
        <ReverseModal entry={reversing} onClose={() => setReversing(null)}
          onDone={async () => { setReversing(null); say('ok', 'Entry reversed. You can now enter a corrected one.'); await load(); }} />
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-transparent ${danger ? 'text-red-500 hover:bg-red-50 hover:border-red-200' : 'text-slate-500 hover:bg-slate-100 hover:border-slate-200'}`}>{children}</button>
  );
}

// ------------------------------------------------------------------------------------------------
// Add / edit one draft
// ------------------------------------------------------------------------------------------------
function EntryForm({ type, entry, lookups, fyDefault, onClose, onSaved }: {
  type: OpeningType; entry?: OpeningEntry; lookups: OpeningLookups; fyDefault: string; onClose: () => void; onSaved: (msg: string) => void | Promise<void>;
}) {
  const [f, setF] = useState<OpeningDraft>(() => entry ? {
    id: entry.id, entry_type: entry.entry_type, opening_date: entry.opening_date, account_id: entry.account_id ?? '', party_id: entry.party_id ?? '', party_name: entry.party_name ?? '',
    party_code: entry.party_code ?? '', balance_type: entry.balance_type ?? '', invoice_ref: entry.invoice_ref ?? '', due_date: entry.due_date ?? '',
    item_kind: entry.item_kind ?? undefined, item_id: entry.item_id ?? '', warehouse_id: entry.warehouse_id ?? '', qty: entry.qty ?? '', unit_cost: entry.unit_cost ?? '',
    amount: entry.amount, currency: entry.currency, remarks: entry.remarks ?? '',
  } : {
    entry_type: type, opening_date: fyDefault, currency: 'INR', account_id: '', party_id: '', party_name: '', party_code: '', invoice_ref: '', due_date: '', item_id: '', warehouse_id: '', qty: '', unit_cost: '', amount: '', remarks: '',
    balance_type: type === 'BANK' ? 'Debit' : type === 'CUSTOMER' ? 'Receivable' : type === 'SUPPLIER' ? 'Payable' : '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof OpeningDraft, v: string) => setF(p => ({ ...p, [k]: v }));
  const bank = lookups.banks.find(b => b.id === f.account_id);
  const partyList = type === 'CUSTOMER' ? lookups.customers : lookups.suppliers;
  const itemKey = f.item_id ? `${f.item_kind}:${f.item_id}` : '';
  const item = lookups.items.find(i => `${i.kind}:${i.id}` === itemKey);

  const pickParty = (id: string) => {
    const p = partyList.find(x => x.id === id);
    setF(prev => ({ ...prev, party_id: id, party_name: p?.name ?? '', party_code: type === 'SUPPLIER' ? (p as { code?: string | null } | undefined)?.code ?? '' : id }));
  };
  const pickItem = (key: string) => {
    const it = lookups.items.find(i => `${i.kind}:${i.id}` === key);
    setF(prev => ({ ...prev, item_kind: it?.kind, item_id: it?.id ?? '', unit_cost: it && !num(prev.unit_cost) ? it.rate : prev.unit_cost }));
  };

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const res = await openingApi.save({ ...f, entry_type: type });
      await onSaved(`${res.entry_no} saved as draft.`);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };

  const title = `${entry ? 'Edit' : 'Add'} ${type === 'BANK' ? 'bank opening balance' : type === 'STOCK' ? 'opening stock' : type === 'CUSTOMER' ? 'customer opening balance' : 'supplier opening balance'}`;
  return (
    <Modal open onClose={onClose} title={title} subtitle={entry ? entry.entry_no : 'Saved as a draft; it counts only after it is posted'} size="lg" isDirty
      footer={<div className="flex items-center justify-end gap-2 w-full">
        {err && <span className="mr-auto text-xs font-semibold text-red-600">{err}</span>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Draft'}</Button></div>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <FormField label="Company"><input className={`${inputClass} bg-slate-50`} readOnly value={lookups.company?.company_name ?? ''} /></FormField>
        <FormField label="Opening Date" required><input type="date" className={inputClass} value={f.opening_date ?? ''} max={todayISO()} onChange={e => set('opening_date', e.target.value)} /></FormField>

        {type === 'BANK' && (<>
          <FormField label="Bank Account" required>
            <select className={inputClass} value={f.account_id ?? ''} onChange={e => set('account_id', e.target.value)}>
              <option value="">Select account…</option>
              {lookups.banks.map(b => <option key={b.id} value={b.id}>{b.name} ({b.type})</option>)}
            </select></FormField>
          <FormField label="Account Name"><input className={`${inputClass} bg-slate-50`} readOnly value={bank?.name ?? ''} /></FormField>
          <FormField label="Account Number" hint="Account code from the chart of accounts; bank numbers are not stored"><input className={`${inputClass} bg-slate-50`} readOnly value={bank ? `••••${bank.code.slice(-4)}` : ''} /></FormField>
          <FormField label="Balance Type"><select className={inputClass} value={f.balance_type ?? 'Debit'} onChange={e => set('balance_type', e.target.value)}>
            <option value="Debit">Money in the account (Dr)</option><option value="Overdraft">Overdraft (Cr)</option></select></FormField>
        </>)}

        {(type === 'CUSTOMER' || type === 'SUPPLIER') && (<>
          <FormField label={type === 'CUSTOMER' ? 'Customer / Client' : 'Supplier'} required>
            <select className={inputClass} value={f.party_id ?? ''} onChange={e => pickParty(e.target.value)}>
              <option value="">Select…</option>
              {partyList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></FormField>
          <FormField label={type === 'CUSTOMER' ? 'Customer Code' : 'Supplier Code'}><input className={`${inputClass} bg-slate-50`} readOnly value={f.party_code ?? ''} /></FormField>
          <FormField label="Balance Type"><select className={inputClass} value={f.balance_type ?? ''} onChange={e => set('balance_type', e.target.value)}>
            {type === 'CUSTOMER' ? <><option>Receivable</option><option>Credit Balance</option></> : <><option>Payable</option><option>Debit Balance</option></>}</select></FormField>
          <FormField label="Opening Balance Amount" required><input type="number" min="0" step="0.01" className={inputClass} value={f.amount ?? ''} onChange={e => set('amount', e.target.value)} /></FormField>
          <FormField label="Invoice Reference" hint="Optional. Enter one entry per bill to track bills separately"><input className={inputClass} value={f.invoice_ref ?? ''} onChange={e => set('invoice_ref', e.target.value)} /></FormField>
          <FormField label="Due Date"><input type="date" className={inputClass} value={f.due_date ?? ''} onChange={e => set('due_date', e.target.value)} /></FormField>
        </>)}

        {type === 'BANK' && (
          <FormField label="Opening Balance" required><input type="number" min="0" step="0.01" className={inputClass} value={f.amount ?? ''} onChange={e => set('amount', e.target.value)} /></FormField>
        )}

        {type === 'STOCK' && (<>
          <FormField label="Warehouse / Location" hint="Leave blank to use the product's own location">
            <select className={inputClass} value={f.warehouse_id ?? ''} onChange={e => set('warehouse_id', e.target.value)}>
              <option value="">Product default</option>
              {lookups.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></FormField>
          <FormField label="Product" required>
            <select className={inputClass} value={itemKey} onChange={e => pickItem(e.target.value)}>
              <option value="">Select product…</option>
              {lookups.items.map(i => <option key={`${i.kind}:${i.id}`} value={`${i.kind}:${i.id}`}>{i.code ? `${i.code} - ` : ''}{i.name} ({i.kind === 'RAW' ? 'Material' : 'Part'})</option>)}
            </select></FormField>
          <FormField label="Product Code / SKU"><input className={`${inputClass} bg-slate-50`} readOnly value={item?.code ?? ''} /></FormField>
          <FormField label="Unit of Measurement"><input className={`${inputClass} bg-slate-50`} readOnly value={item?.unit ?? ''} /></FormField>
          <FormField label="Opening Quantity" required hint={item && item.stock > 0 ? `Already in stock: ${item.stock}. This is added to it` : undefined}>
            <input type="number" min="0" step="0.001" className={inputClass} value={f.qty ?? ''} onChange={e => set('qty', e.target.value)} /></FormField>
          <FormField label="Unit Cost" required><input type="number" min="0" step="0.01" className={inputClass} value={f.unit_cost ?? ''} onChange={e => set('unit_cost', e.target.value)} /></FormField>
          <FormField label="Total Opening Value"><input className={`${inputClass} bg-slate-50 font-bold`} readOnly value={money(stockValue(f.qty, f.unit_cost))} /></FormField>
        </>)}

        <FormField label="Currency"><select className={inputClass} value={f.currency ?? 'INR'} onChange={e => set('currency', e.target.value)}><option>INR</option></select></FormField>
        <div className="sm:col-span-2"><FormField label="Remarks"><textarea rows={2} className={inputClass} value={f.remarks ?? ''} onChange={e => set('remarks', e.target.value)} /></FormField></div>
        <FormField label="Status"><input className={`${inputClass} bg-slate-50`} readOnly value={entry?.status ?? 'Draft'} /></FormField>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------
// Bulk opening stock (table form, also receives the CSV import)
// ------------------------------------------------------------------------------------------------
interface BulkRow { key: string; itemRef: string; warehouse: string; qty: string; cost: string; date: string; remarks: string; error: string }
let bulkSeq = 0;
const newBulkRow = (): BulkRow => ({ key: `new-${++bulkSeq}`, itemRef: '', warehouse: '', qty: '', cost: '', date: '', remarks: '', error: '' });

function BulkStock({ rows: initial, lookups, onClose, onSaved }: { rows: BulkRow[]; lookups: OpeningLookups; onClose: () => void; onSaved: (n: number) => void | Promise<void> }) {
  const [rows, setRows] = useState<BulkRow[]>(initial);
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const patch = (key: string, p: Partial<BulkRow>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p, error: '' } : r)));
  const total = rows.reduce((n, r) => n + stockValue(r.qty, r.cost), 0);

  const save = async () => {
    setBusy(true);
    let saved = 0;
    const left: BulkRow[] = [];
    for (const r of rows) {
      if (!r.itemRef && !num(r.qty) && !r.cost) continue;   // an untouched row
      const [kind, ...idParts] = r.itemRef.split(':');
      try {
        await openingApi.save({
          entry_type: 'STOCK', opening_date: r.date || date, item_kind: kind as 'RAW' | 'PART', item_id: idParts.join(':'), warehouse_id: r.warehouse,
          qty: r.qty, unit_cost: r.cost, remarks: r.remarks, currency: 'INR',
        });
        saved++;
      } catch (e) { left.push({ ...r, error: errText(e) }); }
    }
    setBusy(false);
    if (!left.length) { await onSaved(saved); return; }
    setRows(left);   // only the rows that could not be saved stay, each with its reason
  };

  return (
    <Modal open onClose={onClose} title="Bulk opening stock" subtitle="One row per product and warehouse. Rows are saved as drafts; post them afterwards." size="2xl" isDirty
      footer={<div className="flex items-center justify-between gap-2 w-full">
        <span className="text-sm font-semibold text-slate-600">Total value {money(total)}</span>
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save as Drafts'}</Button></div></div>}>
      <div className="mb-3 flex items-center gap-2"><label className="text-xs font-semibold text-slate-600">Opening date for rows without one</label>
        <input type="date" className={`${inputClass} !w-44`} value={date} max={todayISO()} onChange={e => setDate(e.target.value)} /></div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead><tr><th className={th}>Product</th><th className={th}>Warehouse</th><th className={thR}>Quantity</th><th className={thR}>Unit cost</th><th className={thR}>Value</th><th className={th}>Remarks</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.key} className="align-top">
                <td className="py-1.5 pr-2 min-w-[14rem]">
                  <select aria-label="Product" className={`${inputClass} !py-1.5`} value={r.itemRef} onChange={e => {
                    const it = lookups.items.find(i => `${i.kind}:${i.id}` === e.target.value);
                    patch(r.key, { itemRef: e.target.value, cost: r.cost || (it ? String(it.rate) : '') });
                  }}>
                    <option value="">Select product…</option>
                    {lookups.items.map(i => <option key={`${i.kind}:${i.id}`} value={`${i.kind}:${i.id}`}>{i.code ? `${i.code} - ` : ''}{i.name}</option>)}
                  </select>
                  {r.error && <p className="mt-0.5 text-[11px] font-semibold text-red-600">{r.error}</p>}
                </td>
                <td className="py-1.5 pr-2 min-w-[9rem]"><select aria-label="Warehouse" className={`${inputClass} !py-1.5`} value={r.warehouse} onChange={e => patch(r.key, { warehouse: e.target.value })}>
                  <option value="">Product default</option>{lookups.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
                <td className="py-1.5 pr-2"><input aria-label="Quantity" type="number" min="0" step="0.001" className={`${inputClass} !py-1.5 !w-24 text-right`} value={r.qty} onChange={e => patch(r.key, { qty: e.target.value })} /></td>
                <td className="py-1.5 pr-2"><input aria-label="Unit cost" type="number" min="0" step="0.01" className={`${inputClass} !py-1.5 !w-24 text-right`} value={r.cost} onChange={e => patch(r.key, { cost: e.target.value })} /></td>
                <td className={`${tdR} font-semibold`}>{money(stockValue(r.qty, r.cost))}</td>
                <td className="py-1.5 pr-2"><input aria-label="Remarks" className={`${inputClass} !py-1.5`} value={r.remarks} onChange={e => patch(r.key, { remarks: e.target.value })} /></td>
                <td className="py-1.5"><IconBtn label="Remove row" danger onClick={() => setRows(rs => rs.length > 1 ? rs.filter(x => x.key !== r.key) : [newBulkRow()])}><Trash2 size={14} /></IconBtn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2"><Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setRows(rs => [...rs, newBulkRow()])}>Add row</Button></div>
      <p className="mt-3 text-[11px] text-slate-500">CSV columns: product (code or name), warehouse, quantity, unit cost, date, remarks. Columns are found by their heading, in any order.</p>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------
// Validate & preview, then post
// ------------------------------------------------------------------------------------------------
function PreviewModal({ data, busy, canPost, onClose, onPost }: { data: OpeningPreview; busy: boolean; canPost: boolean; onClose: () => void; onPost: () => void }) {
  const postable = data.entries.filter(e => e.status === 'Draft');
  const bad = data.entries.filter(e => e.issues.length).length;
  return (
    <Modal open onClose={onClose} title="Validate & preview" subtitle={bad ? `${bad} of ${data.entries.length} entries need fixing` : `${postable.length} entr${postable.length === 1 ? 'y' : 'ies'} ready to post`} size="xl"
      footer={<div className="flex items-center justify-end gap-2 w-full">
        {!canPost && <span className="mr-auto text-xs text-slate-500">Only administrators can post.</span>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant="success" icon={<CheckCircle2 size={14} />} disabled={busy || !data.ok || !canPost} onClick={onPost}>{busy ? 'Posting…' : `Confirm & Post ${postable.length}`}</Button></div>}>
      <p className="mb-3 text-xs text-slate-500">Posting writes the journal entries and stock movements in one step: if anything fails, nothing is posted. Posted entries cannot be edited, only reversed.</p>
      <div className="space-y-3">
        {data.entries.map(e => (
          <div key={e.id} className={`rounded-lg border p-3 ${e.issues.length ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-white'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-800">{e.label} <span className="ml-1 text-[11px] font-mono font-normal text-slate-400">{e.entry_no} · {e.entry_type}</span></p>
              <p className="text-sm font-bold tabular-nums">{money(num(e.amount))}</p>
            </div>
            {e.issues.map(i => <p key={i} className="mt-1 text-xs font-semibold text-red-600">✕ {i}</p>)}
            {e.warnings.map(w => <p key={w} className="mt-1 text-xs text-amber-700">⚠ {w}</p>)}
            {!!e.lines.length && (
              <table className="mt-2 w-full text-xs"><thead><tr className="text-slate-400"><th className="text-left font-semibold py-1">Account</th><th className="text-right font-semibold">Debit</th><th className="text-right font-semibold">Credit</th></tr></thead>
                <tbody>{e.lines.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100"><td className="py-1">{l.account}{l.party && <span className="text-slate-400"> · {l.party}</span>}</td>
                    <td className="text-right tabular-nums">{num(l.debit) ? money(num(l.debit)) : ''}</td><td className="text-right tabular-nums">{num(l.credit) ? money(num(l.credit)) : ''}</td></tr>))}</tbody></table>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ReverseModal({ entry, onClose, onDone }: { entry: OpeningEntry; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await openingApi.reverse(entry.id, reason); await onDone(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Reverse ${entry.entry_no}`} subtitle="Writes an opposite entry; the original stays for the audit trail" size="md"
      footer={<div className="flex items-center justify-end gap-2 w-full">{err && <span className="mr-auto text-xs font-semibold text-red-600">{err}</span>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" icon={<Undo2 size={14} />} disabled={busy || !reason.trim()} onClick={go}>{busy ? 'Reversing…' : 'Reverse entry'}</Button></div>}>
      <p className="text-sm text-slate-600 mb-3">
        {entry.entry_type === 'STOCK' ? `This takes ${num(entry.qty)} ${entry.unit ?? ''} of ${entry.item_name} back out of stock (it fails if that stock has already been used).`
          : `This reverses the ${money(entry.amount)} opening balance of ${entry.party_name ?? entry.account_name}.`} Afterwards you can enter a corrected opening entry.
      </p>
      <FormField label="Reason" required><textarea rows={3} className={inputClass} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this being reversed?" /></FormField>
    </Modal>
  );
}

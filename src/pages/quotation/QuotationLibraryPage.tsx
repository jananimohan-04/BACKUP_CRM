import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Search, Hash, Eye, FileDown, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { formatINR } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { calcLine } from '@/lib/quotationCalc';
import { downloadQuotePdf } from '@/lib/quotationDocument';
import { resolveSeller, syncProfileStore } from '@/lib/companyProfile';
import { clientNames, deleteQuote, filterQuotes, loadQuotes, mergeQuotes, noFilter, stashForReuse, type DbQuoteRow, type SavedQuote } from '@/lib/quotationStore';
import { supabase } from '@/lib/supabase';

const inputCls = 'h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20';
const dmy = (iso: string) => (iso ? iso.split('-').reverse().join('-') : '—');
const money = (n: number) => formatINR(n, { decimals: 'always' });
const itemNames = (q: SavedQuote) => q.lines.filter(l => calcLine(l).active).map(l => l.description.trim() || 'Item');

export function QuotationLibraryPage() {
  const { company, email: authEmail } = useAuth();
  const cid = company?.id ?? null;
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<SavedQuote[]>(() => loadQuotes(cid));
  // Quotations are kept in this browser per company, and the ones recorded in the sales pipeline live in the database.
  // Both are listed; reload whenever the company changes (it can arrive after the page opens).
  const [dbRows, setDbRows] = useState<DbQuoteRow[]>([]);
  useEffect(() => {
    let off = false;
    setQuotes(loadQuotes(cid));
    supabase.from('cnc_quotations').select('id,quote_no,customer,phone,email,description,total_value,date,created_at,remarks,gst_percent,part_name')
      .order('created_at', { ascending: false }).limit(1000)
      .then(({ data, error }) => { if (!off && !error) setDbRows((data ?? []) as DbQuoteRow[]); });
    return () => { off = true; };
  }, [cid]);
  const all = useMemo(() => mergeQuotes(quotes, dbRows), [quotes, dbRows]);
  const [f, setF] = useState(noFilter);
  const [toDelete, setToDelete] = useState<SavedQuote | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const shown = useMemo(() => filterQuotes(all, f), [all, f]);
  const names = useMemo(() => clientNames(all), [all]);
  const set = (patch: Partial<typeof f>) => setF(p => ({ ...p, ...patch }));
  const filtered = JSON.stringify(f) !== JSON.stringify(noFilter);

  const reuse = (q: SavedQuote) => {
    if (!stashForReuse(cid, q)) { setNotice({ kind: 'err', text: 'Could not open the quotation: browser storage is unavailable.' }); return; }
    navigate('/quotation/create');
  };
  const pdf = async (q: SavedQuote, workings: boolean) => {
    try { await downloadQuotePdf(q, workings, 'orange', resolveSeller(await syncProfileStore(cid, { orgName: company?.company_name ?? '', email: authEmail ?? '' }), q.sellerRef)); } catch (e) { console.error(e); setNotice({ kind: 'err', text: `Could not create the PDF: ${(e as Error).message}` }); }
  };
  const remove = () => {
    if (!toDelete) return;
    if (deleteQuote(cid, toDelete.id)) { setQuotes(loadQuotes(cid)); setNotice({ kind: 'ok', text: `Quotation #${toDelete.seq} deleted` }); }
    else setNotice({ kind: 'err', text: 'Could not delete: browser storage is unavailable.' });
    setToDelete(null);
  };

  const iconBtn = 'p-1.5 text-slate-400 rounded hover:bg-slate-100';

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><FolderOpen className="text-orange-500" size={26} /> Saved Quotation Library</h1>
          <p className="text-sm text-slate-500 mt-1">View, manage, and reuse all your saved quotations in one place.</p>
        </div>

        {notice && <div role="status" className={`flex justify-between text-sm rounded-lg px-3 py-2 border ${notice.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}><span>{notice.text}</span><button aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div>}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3 top-3 text-slate-400" />
            <input aria-label="Search client or item" className={`${inputCls} w-full pl-9`} placeholder="Search client or item…" value={f.text} onChange={e => set({ text: e.target.value })} />
          </div>
          <div className="relative w-full sm:w-44">
            <Hash size={15} className="absolute left-3 top-3 text-slate-400" />
            <input aria-label="Quote number" className={`${inputCls} w-full pl-9`} placeholder="Quote # (Exact)" value={f.quoteNo} onChange={e => set({ quoteNo: e.target.value })} />
          </div>
          <select aria-label="Filter by company" className={`${inputCls} w-full sm:w-52`} value={f.client} onChange={e => set({ client: e.target.value })}>
            <option value="">All Companies</option>
            {names.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-2 h-12 bg-slate-50/60">
            <span className="text-[10px] font-bold text-slate-500">FROM:</span>
            <input type="date" aria-label="From date" className={`${inputCls} h-9`} value={f.from} onChange={e => set({ from: e.target.value })} />
            <span className="text-[10px] font-bold text-slate-500">TO:</span>
            <input type="date" aria-label="To date" className={`${inputCls} h-9`} value={f.to} onChange={e => set({ to: e.target.value })} />
          </div>
          {filtered && <button onClick={() => setF(noFilter)} className="text-xs font-semibold text-orange-600 underline">Clear filters</button>}
          <span data-testid="count" className="ml-auto text-sm font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-4 h-10 flex items-center">
            {all.length} Saved {all.length === 1 ? 'Quote' : 'Quotes'}{filtered && ` · ${shown.length} shown`}
          </span>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500"><tr>
              {['#', 'Date', 'Client / Company', 'Products / Line Items', 'Grand Total (₹)', 'Actions'].map((h, i) => <th key={h} className={`font-semibold px-4 py-2 ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {shown.map(q => {
                const items = itemNames(q);
                return (
                  <tr key={q.id} data-testid="quote-row" className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2 font-bold text-orange-600">#{q.seq}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{dmy(q.date)}</td>
                    <td className="px-4 py-2 font-medium text-slate-800">{q.clients.map(c => c.name).join(', ') || '—'}</td>
                    <td className="px-4 py-2 text-slate-600">{items.slice(0, 2).join(', ')}{items.length > 2 && <span className="text-slate-400"> +{items.length - 2} more</span>}</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">{money(q.total)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-0.5">
                        <button aria-label={`View #${q.seq}`} title="View / edit in Create Quotation" onClick={() => reuse(q)} className={`${iconBtn} hover:text-blue-600`}><Eye size={15} /></button>
                        <button aria-label={`Download PDF #${q.seq}`} title="Download PDF" onClick={() => pdf(q, false)} className={`${iconBtn} hover:text-emerald-600`}><FileDown size={15} /></button>
                        {q.id.startsWith('db-')
                          ? <span title="Recorded in the sales pipeline; delete it there" className="ml-1 text-[10px] font-bold uppercase text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">Pipeline</span>
                          : <button aria-label={`Delete #${q.seq}`} title="Delete" onClick={() => setToDelete(q)} className={`${iconBtn} hover:text-red-600`}><Trash2 size={15} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && (
            <div className="flex flex-col items-center py-14 text-center">
              <FolderOpen size={28} className="text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-800">{all.length ? 'No quotations match your filters.' : 'No saved quotations in directory.'}</p>
              <p className="text-xs text-slate-500 mt-1">{all.length ? 'Change or clear the filters.' : <>Every quotation you <b>Save</b>, export or send from Create Quotation is listed here, numbered #1, #2, #3…</>}</p>
            </div>
          )}
        </div>
      </div>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} size="sm" title="Delete quotation?">
        <p className="text-sm text-slate-600">Quotation #{toDelete?.seq} ({toDelete?.clients.map(c => c.name).join(', ')}) will be permanently removed.</p>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => setToDelete(null)} className="text-sm font-semibold text-slate-600 px-3">Cancel</button>
          <button onClick={remove} className="h-10 px-5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700">Delete</button>
        </div>
      </Modal>
    </div>
  );
}

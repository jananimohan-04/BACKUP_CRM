import { calcTotals } from './quotationCalc';
import type { QuoteDoc } from './quotationDocument';

// Saved quotations, kept in this browser per company (no quotation table in the database yet).
// Every quotation that is saved, exported or sent lands here, numbered #1, #2, #3 in order.

export interface SavedQuote extends QuoteDoc {
  id: string;
  seq: number;
  savedAt: string;
  total: number;
}

export interface QuoteIdent { id: string; seq: number; quoteNo: string }

const key = (companyId: string | null | undefined) => `argus.quotations.${companyId ?? 'all'}`;
const DRAFT_KEY = (companyId: string | null | undefined) => `argus.quotation.reuse.${companyId ?? 'all'}`;

export const makeQuoteNo = (date: string, seq: number) => `QT-${date.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;

const isQuote = (q: unknown): q is Partial<SavedQuote> & { lines: unknown[]; clients: unknown[] } =>
  !!q && typeof q === 'object' && Array.isArray((q as SavedQuote).lines) && Array.isArray((q as SavedQuote).clients);

/** Newest first. Entries saved by earlier versions (no id / seq) are numbered by their position. */
export function loadQuotes(companyId: string | null | undefined): SavedQuote[] {
  let raw: unknown[] = [];
  try { const v = JSON.parse(localStorage.getItem(key(companyId)) || '[]'); if (Array.isArray(v)) raw = v; } catch { /* unreadable: treat as empty */ }
  const valid = raw.filter(isQuote);
  const n = valid.length;
  const out = valid.map((q, i): SavedQuote => ({
    ...(q as unknown as SavedQuote),
    id: q.id ?? `legacy-${i}-${q.quoteNo ?? ''}`,
    seq: typeof q.seq === 'number' ? q.seq : n - i,
    savedAt: q.savedAt ?? new Date(0).toISOString(),
    total: typeof q.total === 'number' ? q.total : calcTotals(q.lines as SavedQuote['lines'], q.tax as SavedQuote['tax']).total,
  }));
  return out.sort((a, b) => b.seq - a.seq);
}

function write(companyId: string | null | undefined, list: SavedQuote[]): boolean {
  try { localStorage.setItem(key(companyId), JSON.stringify(list)); return true; } catch { return false; }
}

export const nextSeq = (list: SavedQuote[]) => list.reduce((m, q) => Math.max(m, q.seq), 0) + 1;

/** Reserves the identity (id, number) for a quotation about to be saved for the first time. */
export function newIdent(companyId: string | null | undefined, date: string): QuoteIdent {
  const seq = nextSeq(loadQuotes(companyId));
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `q${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  return { id, seq, quoteNo: makeQuoteNo(date, seq) };
}

/** Inserts or replaces (same id) a quotation. Returns false if storage is unavailable. */
export function upsertQuote(companyId: string | null | undefined, doc: QuoteDoc, ident: QuoteIdent): boolean {
  const list = loadQuotes(companyId);
  const entry: SavedQuote = { ...doc, quoteNo: ident.quoteNo, id: ident.id, seq: ident.seq, savedAt: new Date().toISOString(), total: calcTotals(doc.lines, doc.tax).total };
  const i = list.findIndex(q => q.id === ident.id);
  if (i >= 0) list[i] = entry; else list.push(entry);
  return write(companyId, list);
}

export function deleteQuote(companyId: string | null | undefined, id: string): boolean {
  return write(companyId, loadQuotes(companyId).filter(q => q.id !== id));
}

/** Hand-off from the library to the Create Quotation page ("Reuse"). */
export function stashForReuse(companyId: string | null | undefined, q: SavedQuote): boolean {
  try { sessionStorage.setItem(DRAFT_KEY(companyId), JSON.stringify(q)); return true; } catch { return false; }
}
export function takeReuse(companyId: string | null | undefined): SavedQuote | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY(companyId));
    if (!raw) return null;
    sessionStorage.removeItem(DRAFT_KEY(companyId));
    const q = JSON.parse(raw);
    return isQuote(q) ? (q as SavedQuote) : null;
  } catch { return null; }
}

/** A quotation recorded in the sales pipeline (cnc_quotations), shown in the library next to the ones saved in this browser. */
export interface DbQuoteRow {
  id: string; quote_no: string | null; customer: string | null; phone: string | null; email: string | null; description: string | null;
  total_value: number | string | null; date: string | null; created_at: string | null; remarks: string | null; gst_percent: number | string | null; part_name: string | null;
}

/** Rebuilds a library entry from a database quotation. `seq` continues after the browser-saved numbers. Terms / seller are not kept in the database. */
export function quoteFromDb(r: DbQuoteRow, seq: number): SavedQuote {
  let items: Record<string, unknown>[] = [];
  try { const v = JSON.parse(r.description || '[]'); if (Array.isArray(v)) items = v; } catch { /* description is plain text: no line items */ }
  const half = String((Number(r.gst_percent) || 0) / 2);
  const lines = items.map((i, n) => ({
    id: `db${r.id}-${n}`, hsn: '', description: String(i.partName ?? ''), qty: String(i.quantity ?? '1'), unit: 'Nos', unitPrice: String(i.unitPrice ?? ''),
    discount: String(i.discount ?? '0'), ...(i.workings ? { workings: i.workings as never } : {}),
  }));
  const name = String(r.customer ?? '').trim();
  const date = String(r.date ?? r.created_at ?? '').slice(0, 10);
  return {
    id: `db-${r.id}`, seq, quoteNo: r.quote_no || `QT-${r.id.slice(0, 6)}`, date, sellerName: '', clients: name ? [{ key: name.toLowerCase(), name, email: r.email ?? '', phone: r.phone ?? '', address: '', gstin: '' }] : [],
    lines: lines.length ? lines : [{ id: `db${r.id}-0`, hsn: '', description: String(r.part_name ?? ''), qty: '1', unit: 'Nos', unitPrice: String(Number(r.total_value) || 0), discount: '0' }],
    tax: { cgst: half, sgst: half, igst: '0' }, terms: '', notes: r.remarks ?? '', savedAt: String(r.created_at ?? new Date(0).toISOString()), total: Number(r.total_value) || 0,
  };
}

/** Browser-saved quotations plus pipeline quotations that are not already among them (matched by quote number). */
export function mergeQuotes(local: SavedQuote[], db: DbQuoteRow[]): SavedQuote[] {
  const have = new Set(local.map(q => q.quoteNo));
  let seq = nextSeq(local);
  const extra = [...db].filter(r => !have.has(r.quote_no ?? '')).sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))).map(r => quoteFromDb(r, seq++));
  return [...local, ...extra].sort((a, b) => b.seq - a.seq);
}

export interface QuoteFilter { text: string; quoteNo: string; client: string; from: string; to: string }
export const noFilter: QuoteFilter = { text: '', quoteNo: '', client: '', from: '', to: '' };

export function filterQuotes(list: SavedQuote[], f: QuoteFilter): SavedQuote[] {
  const t = f.text.trim().toLowerCase();
  const no = f.quoteNo.trim().replace(/^#/, '').toLowerCase();
  return list.filter(q => {
    if (t && !(q.clients.some(c => c.name.toLowerCase().includes(t)) || q.lines.some(l => l.description.toLowerCase().includes(t)))) return false;
    if (no && String(q.seq) !== no && q.quoteNo.toLowerCase() !== no) return false;
    if (f.client && !q.clients.some(c => c.name === f.client)) return false;
    if (f.from && q.date < f.from) return false;
    if (f.to && q.date > f.to) return false;
    return true;
  });
}

export const clientNames = (list: SavedQuote[]) =>
  [...new Set(list.flatMap(q => q.clients.map(c => c.name)))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

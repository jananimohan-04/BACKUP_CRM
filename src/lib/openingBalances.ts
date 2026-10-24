import { supabase } from '@/lib/supabase';

// Opening balances & opening stock: what the company already had when it started using the ERP.
// Everything is saved, validated and posted by database functions (see the cnc_opening_balances migration); this file
// is only the typed client for them plus a few pure helpers.

export type OpeningType = 'BANK' | 'CUSTOMER' | 'SUPPLIER' | 'STOCK';
export type OpeningStatus = 'Draft' | 'Posted' | 'Reversed';

export interface OpeningEntry {
  id: string;
  entry_no: string;
  entry_type: OpeningType;
  opening_date: string;
  status: OpeningStatus;
  account_id: string | null;
  account_name: string | null;
  party_id: string | null;
  party_name: string | null;
  party_code: string | null;
  balance_type: string | null;
  side: 'DR' | 'CR' | null;
  invoice_ref: string | null;
  due_date: string | null;
  item_kind: 'RAW' | 'PART' | null;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  unit: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  qty: number | null;
  unit_cost: number | null;
  amount: number;
  currency: string;
  remarks: string | null;
  company_name: string | null;
  created_by: string | null;
  posted_by: string | null;
  posted_at: string | null;
  reversed_by: string | null;
  reversed_at: string | null;
  reverse_reason: string | null;
}

export interface OpeningSummary {
  bank: { posted: number; draft: number };
  receivable: { posted: number; draft: number };
  payable: { posted: number; draft: number };
  stock: { posted: number; draft: number };
}

export interface OpeningLookups {
  company: { id: string; company_name: string } | null;
  banks: { id: string; code: string; name: string; type: string; balance: string }[];
  customers: { id: string; name: string }[];
  suppliers: { id: string; name: string; code: string | null }[];
  warehouses: { id: string; name: string; code: string | null }[];
  items: { kind: 'RAW' | 'PART'; id: string; code: string | null; name: string; unit: string | null; rate: number; stock: number }[];
  financial_years: { id: string; name: string; start_date: string; end_date: string; status: string }[];
  can_manage: boolean;
}

export interface OpeningPreview {
  ok: boolean;
  entries: {
    id: string; entry_no: string; entry_type: OpeningType; status: OpeningStatus; label: string; amount: number;
    issues: string[]; warnings: string[];
    lines: { account: string; debit: number; credit: number; party: string | null }[];
  }[];
}

export type OpeningDraft = Partial<{
  id: string; entry_type: OpeningType; opening_date: string; account_id: string; party_id: string; party_name: string; party_code: string;
  balance_type: string; invoice_ref: string; due_date: string; item_kind: 'RAW' | 'PART'; item_id: string; warehouse_id: string;
  qty: number | string; unit_cost: number | string; amount: number | string; currency: string; remarks: string;
}>;

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export const openingApi = {
  lookups: () => call<OpeningLookups>('erp_opening_lookups'),
  list: (a: { type?: OpeningType | null; status?: string | null; search?: string; fyId?: string | null } = {}) =>
    call<{ rows: OpeningEntry[]; summary: OpeningSummary }>('erp_opening_list', {
      p_type: a.type ?? null, p_status: a.status || null, p_search: a.search || null, p_fy_id: a.fyId || null,
    }),
  save: (entry: OpeningDraft) => call<{ id: string; entry_no: string; status: OpeningStatus }>('erp_opening_save', { p_entry: entry }),
  remove: (id: string) => call<void>('erp_opening_delete', { p_id: id }),
  validate: (ids: string[]) => call<OpeningPreview>('erp_opening_validate', { p_ids: ids }),
  post: (ids: string[]) => call<{ posted: number; skipped: number }>('erp_opening_post', { p_ids: ids }),
  reverse: (id: string, reason: string) => call<{ id: string; status: string }>('erp_opening_reverse', { p_id: id, p_reason: reason }),
};

export const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Opening value of a stock line: quantity x unit cost. */
export const stockValue = (qty: unknown, cost: unknown) => r2(num(qty) * num(cost));

/** Signed amount of a posted entry as it sits in the party ledger: + = the party owes us (debit), - = we owe them (credit). */
export const partyDebitMinusCredit = (e: Pick<OpeningEntry, 'side' | 'amount'>) => (e.side === 'DR' ? 1 : -1) * num(e.amount);

/** The key a party name is looked up by in the map from fetchPartyOpenings. */
export const openingKey = (name: string | null | undefined) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Posted opening balances by party name (lower case): what each customer owes us / each supplier we owe, as debit - credit. */
export async function fetchPartyOpenings(kind: 'CUSTOMER' | 'SUPPLIER'): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('cnc_opening_entries')
    .select('party_name,side,amount').eq('entry_type', kind).eq('status', 'Posted');
  const out = new Map<string, number>();
  if (error || !data) return out;
  for (const r of data as { party_name: string | null; side: 'DR' | 'CR'; amount: number }[]) {
    const k = openingKey(r.party_name);
    if (!k) continue;
    out.set(k, r2((out.get(k) ?? 0) + partyDebitMinusCredit(r)));
  }
  return out;
}

/** Human text for a party opening: "₹50,000 Dr (Receivable)" style pieces are built by the caller; this is just the sign label. */
export const sideLabel = (n: number) => (n > 0 ? 'Dr' : n < 0 ? 'Cr' : '');

// ---- CSV import of opening stock (header row: product/code, warehouse, quantity, unit cost, date, remarks) ----

export interface StockCsvRow { line: number; code: string; warehouse: string; qty: number; unitCost: number; date: string; remarks: string }

/** Splits one CSV line, honouring "quoted, values". */
function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Reads the CSV text of an opening-stock sheet. Columns are found by header name, in any order. */
export function parseStockCsv(text: string): { rows: StockCsvRow[]; problems: string[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const problems: string[] = [];
  if (lines.length < 2) return { rows: [], problems: ['The file needs a header row and at least one product row.'] };
  const head = splitCsv(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
  const col = (...names: string[]) => head.findIndex(h => names.includes(h));
  const iCode = col('productcode', 'code', 'sku', 'product', 'item', 'itemcode', 'name', 'productname');
  const iWh = col('warehouse', 'location');
  const iQty = col('quantity', 'qty', 'openingquantity');
  const iCost = col('unitcost', 'cost', 'rate', 'price');
  const iDate = col('date', 'openingdate');
  const iRem = col('remarks', 'remark', 'notes');
  if (iCode < 0 || iQty < 0) return { rows: [], problems: ['Header must include a product (or code) column and a quantity column.'] };
  const rows: StockCsvRow[] = [];
  lines.slice(1).forEach((l, k) => {
    const c = splitCsv(l);
    const qty = num(c[iQty]); const cost = iCost >= 0 ? num(c[iCost]) : 0;
    if (!c[iCode]) { problems.push(`Line ${k + 2}: product is empty`); return; }
    if (!(qty > 0)) { problems.push(`Line ${k + 2}: quantity must be greater than zero`); return; }
    if (cost < 0) { problems.push(`Line ${k + 2}: unit cost cannot be negative`); return; }
    rows.push({ line: k + 2, code: c[iCode], warehouse: iWh >= 0 ? c[iWh] ?? '' : '', qty, unitCost: cost, date: iDate >= 0 ? c[iDate] ?? '' : '', remarks: iRem >= 0 ? c[iRem] ?? '' : '' });
  });
  return { rows, problems };
}

/** Accepts yyyy-mm-dd or dd-mm-yyyy / dd/mm/yyyy; returns yyyy-mm-dd or ''. */
export function toIsoDate(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

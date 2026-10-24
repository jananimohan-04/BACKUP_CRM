// What a customer still owes, read from the same records as the Ledger Dashboard: their invoices, less the receipts
// in the bank statement (linked ones, and unlinked ones applied to the oldest invoices first).

import { financeApi, type BankRow, type InvoiceRow } from './finance';
import { fromBank, fromInvoices, fromOpening, settleDocuments } from './ledgerDashboard';
import { supabase } from './supabase';
import { todayISO } from './format';

export interface DueInvoice { invoiceNo: string; date: string; due: number; days: number }
export interface PartyDue { total: number; invoices: DueInvoice[] }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function loadCustomerDue(name: string): Promise<PartyDue> {
  const who = name.trim();
  if (!who) return { total: 0, invoices: [] };
  const inv: InvoiceRow[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await financeApi.invoices({ customer: who, page, pageSize: 200 });
    inv.push(...r.rows);
    if (inv.length >= r.total || !r.rows.length) break;
  }
  const bank: BankRow[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await financeApi.bankTransactions({ party: who, page, pageSize: 200 });
    bank.push(...r.rows);
    if (bank.length >= r.total || !r.rows.length) break;
  }
  // The balance brought forward when the company started (Opening Balances page); absent if that table is not installed yet.
  const op = await supabase.from('cnc_opening_entries').select('*').eq('entry_type', 'CUSTOMER').eq('status', 'Posted').ilike('party_name', who);
  const opening = fromOpening(op.error ? [] : (op.data ?? []) as Record<string, unknown>[]);
  const lines = [...opening, ...fromInvoices(inv), ...fromBank(bank)];
  const settled = settleDocuments(lines, todayISO());
  const invoices: DueInvoice[] = [];
  for (const l of lines) {
    if (l.source !== 'Invoice' && l.source !== 'Opening') continue;
    const s = settled.get(l.id);
    if (!s || s.state === 'Completed' || s.left <= 0.005) continue;
    invoices.push({ invoiceNo: l.source === 'Opening' ? `Opening balance${l.ref ? ` ${l.ref}` : ''}` : l.ref, date: l.date, due: s.left, days: s.days });
  }
  invoices.sort((a, b) => a.date.localeCompare(b.date));
  return { total: r2(invoices.reduce((n, i) => n + i.due, 0)), invoices };
}

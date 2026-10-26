// Copilot: turning what the person typed or said into an ERP action.
// Two brains with the same output: the AI service (help-assistant function, "copilot" request) for natural language in Tamil /
// Tanglish / English, and the local rules below, which still handle clear commands when the service is not reachable.

import { navSections, pageTitles } from '@/config/navigation';

export type Intent = 'add_company' | 'add_enquiry' | 'add_sales_order' | 'open_page' | 'find_records' | 'help' | 'guide' | 'unknown';
export type Params = Record<string, any>;
export interface Pending { intent: Intent; params: Params }
export interface Understood { intent: Intent; params: Params; missing: string[]; reply: string }

export const ACTION_INTENTS: Intent[] = ['add_company', 'add_enquiry', 'add_sales_order', 'open_page', 'find_records'];

/** Fields that must be known before an action can be shown for confirmation. */
export const REQUIRED: Partial<Record<Intent, string[]>> = {
  add_company: ['name'],
  add_enquiry: ['company', 'products'],
  add_sales_order: ['company'],
  open_page: ['page'],
  find_records: ['kind'],
};

export const FIELD_QUESTION: Record<string, [string, string]> = {
  name: ['What is the company name?', 'நிறுவனத்தின் பெயர் என்ன?'],
  company: ['Which company is it for?', 'எந்த நிறுவனத்திற்கு?'],
  products: ['Which product(s) and quantity? For example: Flicker tool x 10', 'எந்தப் பொருள், எவ்வளவு? எ.கா: Flicker tool x 10'],
  page: ['Which page should I open?', 'எந்தப் பக்கத்தைத் திறக்கவேண்டும்?'],
  kind: ['What should I look for: enquiries, quotations, sales orders, invoices or companies?', 'எதைத் தேடவேண்டும்: enquiries, quotations, sales orders, invoices அல்லது companies?'],
};

export const missingOf = (intent: Intent, params: Params): string[] =>
  (REQUIRED[intent] ?? []).filter((k) => {
    const v = params[k];
    if (k === 'products') return !Array.isArray(v) || !v.some((p: any) => String(p?.name ?? '').trim());
    return v == null || String(v).trim() === '';
  });

// ------------------------------------------------------------------------------------------------ pages
const ALIASES: [RegExp, string][] = [
  [/\b(enquir|pipeline|kanban|sales board)/, 'sales/pipeline'],
  [/\b(quotation|quote)s?\b/, 'sales/pipeline'],
  [/\bsales orders?\b|\borders?\b/, 'sales/pipeline'],
  [/\binvoices?\b|\bbilling\b/, 'finance/invoices'],
  [/\bbank\b/, 'finance/bank-entry'],
  [/\bpetty\b/, 'finance/petty-cash'],
  [/\bopening balances?\b/, 'accounts/opening-balances'],
  [/\bledger\b/, 'accounts/ledger'],
  [/\btrial balance\b/, 'accounts/trial-balance'],
  [/\bprofit\b/, 'accounts/profit-loss'],
  [/\bbalance sheet\b/, 'accounts/balance-sheet'],
  [/\binventory\b|\bstock\b/, 'inventory/stock'],
  [/\bpurchase\b|\bsuppliers?\b/, 'purchasing/orders'],
  [/\bscheduling\b|\bschedule\b/, 'production/scheduling'],
  [/\bproduction\b/, 'production/planning'],
  [/\bprocess master\b/, 'production/process-master'],
  [/\bproject costing\b|\bcosting\b/, 'costing/job-costing'],
  [/\bcompany profile\b/, 'quotation/company-profile'],
  [/\breports?\b/, 'reports/production'],
  [/\bdashboard\b|\bhome\b/, 'dashboard'],
  [/\bsupport\b/, 'support/center'],
  [/\busers?\b/, 'admin/users'],
];

export function resolvePage(text: string): { page: string; label: string } | null {
  const t = text.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const entries: { page: string; label: string }[] = [
    ...navSections.flatMap((s) => s.items.map((i) => ({ page: i.page, label: i.label }))),
    ...Object.entries(pageTitles).map(([page, label]) => ({ page, label })),
  ];
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const exact = entries.find((e) => norm(e.label) === t);
  if (exact) return exact;
  const contains = entries.filter((e) => norm(e.label) && (t.includes(norm(e.label)) || norm(e.label).includes(t))).sort((a, b) => b.label.length - a.label.length)[0];
  if (contains) return contains;
  for (const [rx, page] of ALIASES) if (rx.test(t)) return { page, label: pageTitles[page] ?? page };
  return null;
}

// ------------------------------------------------------------------------------------------------ small readers
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, '').trim();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseDate(text: string, today = new Date()): string {
  const t = text.trim().toLowerCase();
  if (!t) return '';
  if (ISO.test(t)) return t;
  const m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  const add = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return isoOf(d); };
  if (/\btoday\b/.test(t)) return add(0);
  if (/\btomorrow\b|\bnaalai\b|நாளை/.test(t)) return add(1);
  if (/next week/.test(t)) return add(7);
  const days = /\bin (\d+) days?\b/.exec(t);
  if (days) return add(Number(days[1]));
  return '';
}

/** "Flicker tool x 10 and Gear, 5 pcs of Shaft" -> [{name, qty}] */
export function parseProducts(text: string): { name: string; qty?: number; price?: number }[] {
  const out: { name: string; qty?: number; price?: number }[] = [];
  for (const raw of text.split(/\s*(?:,|;|\band\b|\bmattrum\b|மற்றும்)\s*/i)) {
    const piece = clean(raw);
    if (!piece) continue;
    let m = /^(.*?)\s*(?:x|×|\*|qty|quantity)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:pcs|nos|pieces|numbers)?$/i.exec(piece);
    if (m && clean(m[1])) { out.push({ name: clean(m[1]), qty: Number(m[2]) }); continue; }
    m = /^(\d+(?:\.\d+)?)\s*(?:pcs|nos|pieces|numbers)?\s*(?:of\s+)?(.+)$/i.exec(piece);
    if (m && clean(m[2]) && !/^\d/.test(clean(m[2]))) { out.push({ name: clean(m[2]), qty: Number(m[1]) }); continue; }
    out.push({ name: piece });
  }
  return out;
}

const STOP = '(?=\\s*(?:,|;|\\bproducts?\\b|\\bitems?\\b|\\bqty\\b|\\bquantity\\b|\\bwith\\b|\\bpo\\b|\\bdelivery\\b|\\bdeliver\\b|\\bremarks?\\b|\\bgst\\b|\\baddress\\b|\\bphone\\b|\\bemail\\b|\\bprice\\b|\\brate\\b)|$)';

function findCompanyAt(text: string): { name: string; end: number } {
  const m = new RegExp(`\\b(?:for|from|of|to)\\s+(?:the\\s+)?(?:company\\s+)?(.+?)${STOP}`, 'i').exec(text);
  return m ? { name: clean(m[1]), end: m.index + m[0].length } : { name: '', end: 0 };
}
const findCompany = (text: string) => findCompanyAt(text).name;

const ADD_WORD = '(?:add|create|new|raise|register|make|enter|pannu|panunga|podu|podunga|சேர்|உருவாக்கு|போடு)';

// ------------------------------------------------------------------------------------------------ local understanding
/** Rules for clear commands. `pending` lets an answer to a question ("Flicker tool x 5") fill the field that was asked for. */
export function understandLocal(text: string, pending: Pending | null, today = new Date()): Understood {
  const msg = text.trim();
  const low = msg.toLowerCase();
  const done = (intent: Intent, params: Params, reply = ''): Understood => ({ intent, params, missing: missingOf(intent, params), reply });

  // A new command always wins over a half-finished one.
  const startsNew = new RegExp(`\\b${ADD_WORD}\\b.*\\b(enquir|company|sales\\s*order|order)|\\b(open|go to|goto|take me to|find|search|list)\\b|\\b(guide me|walk me through|show me how)\\b|^(how|what|where|why|eppadi|enna|yeppadi)\\b`, 'i').test(msg);

  if (pending && !startsNew) {
    const params = { ...pending.params };
    const need = missingOf(pending.intent, params)[0];
    if (need === 'products') params.products = parseProducts(msg);
    else if (need) params[need] = clean(msg);
    return done(pending.intent, params);
  }

  if (/\b(guide me|walk me through|walkthrough|show me how|step by step)\b|வழிகாட்டு/i.test(msg)) return done('guide', {});
  if (/^(how|what|where|why|when|eppadi|enna|yeppadi|yenna|epdi)\b/i.test(low) || /\?\s*$/.test(msg)) return done('help', { question: msg });

  const hasAdd = new RegExp(`\\b${ADD_WORD}\\b`, 'i').test(msg);
  const qtyMatch = /(?:qty|quantity)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i.exec(msg);
  const priceMatch = /(?:price|rate|@)\s*[:\-]?\s*(?:rs\.?|₹)?\s*(\d+(?:\.\d+)?)/i.exec(msg);

  const productText = (() => {
    const m = /\b(?:products?|items?)\b\s*[:\-]?\s*(.+?)(?=\s*(?:\bremarks?\b|\bpo\b|\bdelivery\b|\bdeliver\b|$))/i.exec(msg);
    if (m) return m[1];
    // No "product" word: what follows the company ("for ABC Industries, flicker tool x 10") is the product.
    const co = findCompanyAt(msg);
    const rest = msg.slice(co.end).replace(/^\s*[,;]?\s*(?:with\s+)?/i, '').split(/\b(?:remarks?|po|delivery|deliver)\b/i)[0].trim();
    return co.name && rest && !/^(?:qty|quantity|price|rate)\b/i.test(rest) ? rest : '';
  })().replace(/\s*(?:\bprice\b|\brate\b|@)\s*[:\-]?\s*(?:rs\.?|₹)?\s*\d+(?:\.\d+)?/gi, '');   // a price belongs to the line, not to the name
  const productsOf = () => {
    const list = productText ? parseProducts(productText.replace(/\s*(?:qty|quantity)\s*[:\-]?\s*\d+(?:\.\d+)?\s*$/i, '')) : [];
    if (list.length === 1 && list[0].qty == null && qtyMatch) list[0].qty = Number(qtyMatch[1]);
    if (list.length === 1 && priceMatch) list[0].price = Number(priceMatch[1]);
    return list;
  };

  if (hasAdd && /\bcompany\b|நிறுவன/i.test(msg) && !/\benquir|\border\b/i.test(msg)) {
    const name = (/\b(?:named|called|name)\b\s*[:\-]?\s*(.+?)(?=\s*(?:,|;|\bgst\b|\baddress\b|\bphone\b|\bemail\b|$))/i.exec(msg)
      ?? /\bcompany\b\s+(?!named|called)(.+?)(?=\s*(?:,|;|\bgst\b|\baddress\b|\bphone\b|\bemail\b|$))/i.exec(msg))?.[1] ?? '';
    const gst = /\bgst(?:in)?\s*(?:no\.?|number)?\s*[:\-]?\s*([0-9A-Za-z]{15})\b/i.exec(msg)?.[1] ?? '';
    const phone = /\b(?:phone|mobile|ph)\s*(?:no\.?|number)?\s*[:\-]?\s*(\+?\d[\d ]{7,13}\d)/i.exec(msg)?.[1] ?? '';
    const email = /([\w.+-]+@[\w-]+\.[\w.]+)/.exec(msg)?.[1] ?? '';
    const address = /\baddress\b\s*[:\-]?\s*(.+?)(?=\s*(?:,\s*(?:gst|phone|email)\b|\bgst\b|\bphone\b|\bemail\b|$))/i.exec(msg)?.[1] ?? '';
    return done('add_company', { name: clean(name), gst: gst.toUpperCase(), phone: phone.replace(/\s/g, ''), email, address: clean(address) });
  }

  if (hasAdd && /\benquir|விசாரணை/i.test(msg)) {
    return done('add_enquiry', { company: findCompany(msg), products: productsOf(), remarks: clean(/\bremarks?\b\s*[:\-]?\s*(.+)$/i.exec(msg)?.[1] ?? '') });
  }

  if (hasAdd && /\bsales\s*order|\border\b|ஆர்டர்/i.test(msg)) {
    const delivery = /\bdeliver\w*\b\s*(?:date)?\s*(?:on|by|:)?\s*([0-9a-z/\-. ]{3,20})/i.exec(msg)?.[1] ?? '';
    const orderDate = /\border\s*date\b\s*(?:on|:)?\s*([0-9/\-.]{6,10})/i.exec(msg)?.[1] ?? '';
    return done('add_sales_order', {
      company: findCompany(msg), products: productsOf(),
      delivery_date: parseDate(delivery, today), order_date: parseDate(orderDate, today),
      po_no: clean(/\bpo\b\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Za-z0-9/\-]+)/i.exec(msg)?.[1] ?? ''),
    });
  }

  const find = /\b(?:find|search|show|list|get)\b\s+(?:me\s+)?(?:all\s+)?(enquir\w*|quotation\w*|quote\w*|sales orders?|orders?|invoices?|compan\w*|customers?|inwards?|deliver\w*|challans?)\s*(?:(?:for|of|named|from|with)\s+(.+))?$/i.exec(msg);
  if (find) {
    const k = find[1].toLowerCase();
    const kind = /enquir/.test(k) ? 'enquiry' : /quot|quote/.test(k) ? 'quotation' : /order/.test(k) ? 'sales_order' : /invoice/.test(k) ? 'invoice'
      : /compan|customer/.test(k) ? 'company' : /inward/.test(k) ? 'inward' : 'delivery';
    return done('find_records', { kind, query: clean(find[2] ?? '') });
  }

  const open = /\b(?:open|go to|goto|take me to|show me|navigate to)\b\s+(?:the\s+)?(.+)$/i.exec(msg);
  if (open) {
    const hit = resolvePage(open[1]);
    return done('open_page', hit ? { page: hit.page, label: hit.label } : { page: '' });
  }

  return { intent: 'unknown', params: {}, missing: [], reply: '' };
}

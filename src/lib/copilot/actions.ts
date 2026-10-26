// Copilot actions: what each command shows for confirmation (preview) and what it saves (run).
// They write through the signed-in person's own session with the same fields the forms write, so the database's company and
// permission rules apply exactly as if the form had been used. Nothing here deletes anything.

import { supabase } from '@/lib/supabase';
import { generateUniqueProjectNo } from '@/lib/projectNumber';
import type { Intent, Params } from './understand';

export interface ActionCtx {
  companyId: string | null;
  canDo: (moduleKey: string, action: 'create' | 'view' | 'edit' | 'delete' | 'export' | 'approve') => boolean;
}
export interface Preview { title: string; lines: string[]; warnings: string[]; blocked?: string }
export interface RunResult { ok: boolean; message: string; where?: { path: string; label: string } }
export interface FindResult { title: string; rows: string[] }

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const today = () => new Date().toISOString().split('T')[0];
const ilikeSafe = (s: string) => s.replace(/[%_,()]/g, ' ').trim();

type Product = { name: string; qty?: number; price?: number; gst?: number };
const productsOf = (p: Params): Product[] => (Array.isArray(p.products) ? p.products : [])
  .map((x: any) => ({ name: str(x?.name), qty: x?.qty == null || x.qty === '' ? undefined : num(x.qty), price: x?.price == null || x.price === '' ? undefined : num(x.price), gst: x?.gst == null ? undefined : num(x.gst) }))
  .filter((x: Product) => x.name);

async function findCustomer(name: string, companyId: string | null) {
  const n = ilikeSafe(name);
  if (!n) return null;
  let q = supabase.from('cnc_customers').select('id,name,contact,phone,email,city,gst').ilike('name', n);
  if (companyId) q = q.eq('company_id', companyId);
  const { data } = await q.limit(5);
  const rows = (data ?? []) as any[];
  return rows.find((r) => str(r.name).toLowerCase() === name.trim().toLowerCase()) ?? rows[0] ?? null;
}

export function blockedReason(intent: Intent, ctx: ActionCtx): string | undefined {
  const need: Partial<Record<Intent, string>> = { add_company: 'companies', add_enquiry: 'enquiries', add_sales_order: 'sales-orders' };
  const m = need[intent];
  if (m && !ctx.canDo(m, 'create')) return 'Your account is not allowed to create these records. Ask your administrator for access.';
  return undefined;
}

// ------------------------------------------------------------------------------------------------ preview
export async function previewAction(intent: Intent, p: Params, ctx: ActionCtx): Promise<Preview> {
  const blocked = blockedReason(intent, ctx);
  const warnings: string[] = [];
  if (intent === 'add_company') {
    const dup = await findCustomer(str(p.name), ctx.companyId);
    if (dup && str(dup.name).toLowerCase() === str(p.name).toLowerCase()) return { title: 'Add company', lines: [`Name: ${str(p.name)}`], warnings: [], blocked: `“${dup.name}” already exists in the company list.` };
    const lines = [`Name: ${str(p.name)}`];
    if (str(p.address)) lines.push(`Address: ${str(p.address)}`);
    if (str(p.gst)) lines.push(`GST No.: ${str(p.gst)}`);
    if (str(p.phone)) lines.push(`Phone: ${str(p.phone)}`);
    if (str(p.email)) lines.push(`Email: ${str(p.email)}`);
    if (str(p.gst) && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(str(p.gst).toUpperCase())) warnings.push('That GST number does not look like a valid 15-character GSTIN.');
    return { title: 'Add company', lines, warnings, blocked };
  }
  if (intent === 'add_enquiry') {
    const co = await findCustomer(str(p.company), ctx.companyId);
    const items = productsOf(p);
    if (!co) warnings.push(`“${str(p.company)}” is not in the company list. The enquiry is saved under that name; add the company too to keep its address and GST.`);
    if (items.some((i) => i.qty != null && i.qty < 0)) return { title: 'Add enquiry', lines: [], warnings: [], blocked: 'Quantities cannot be negative.' };
    return {
      title: 'Add enquiry',
      lines: [`Company: ${co?.name ?? str(p.company)}`, ...items.map((i) => `Product: ${i.name}${i.qty != null ? `  ·  Qty ${i.qty}` : ''}`), ...(str(p.remarks) ? [`Remarks: ${str(p.remarks)}`] : [])],
      warnings, blocked,
    };
  }
  if (intent === 'add_sales_order') {
    const co = await findCustomer(str(p.company), ctx.companyId);
    const items = productsOf(p);
    const orderDate = str(p.order_date) || today();
    if (str(p.delivery_date) && str(p.delivery_date) <= orderDate) return { title: 'Create sales order', lines: [], warnings: [], blocked: 'The delivery date must be after the order date.' };
    if (!co) warnings.push(`“${str(p.company)}” is not in the company list; the order is saved under that name.`);
    if (!items.length) warnings.push('No products yet. The order is saved without products; add them later.');
    return {
      title: 'Create sales order',
      lines: [`Company: ${co?.name ?? str(p.company)}`, `Order date: ${orderDate}`, ...(str(p.delivery_date) ? [`Delivery date: ${str(p.delivery_date)}`] : []), ...(str(p.po_no) ? [`PO No: ${str(p.po_no)}`] : []),
        ...items.map((i) => `Product: ${i.name}${i.qty != null ? `  ·  Qty ${i.qty}` : ''}${i.price != null ? `  ·  ₹${i.price}` : ''}`)],
      warnings, blocked,
    };
  }
  return { title: 'Action', lines: [], warnings: [], blocked: 'I cannot do that yet.' };
}

// ------------------------------------------------------------------------------------------------ run
export async function runAction(intent: Intent, p: Params, ctx: ActionCtx): Promise<RunResult> {
  const blocked = blockedReason(intent, ctx);
  if (blocked) return { ok: false, message: blocked };
  try {
    if (intent === 'add_company') return await addCompany(p, ctx);
    if (intent === 'add_enquiry') return await addEnquiry(p, ctx);
    if (intent === 'add_sales_order') return await addSalesOrder(p, ctx);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  return { ok: false, message: 'I cannot do that yet.' };
}

async function addCompany(p: Params, ctx: ActionCtx): Promise<RunResult> {
  const name = str(p.name);
  if (!name) return { ok: false, message: 'The company name is required.' };
  const dup = await findCustomer(name, ctx.companyId);
  if (dup && str(dup.name).toLowerCase() === name.toLowerCase()) return { ok: false, message: `“${dup.name}” already exists in the company list.` };
  const payload: any = {
    id: `CUST-${Math.floor(1000 + Math.random() * 9000)}`, name,
    contact: str(p.contact_person) || null, phone: str(p.phone) || null, email: str(p.email) || null,
    city: str(p.address) || null, gst: str(p.gst) || null, source: str(p.source) || 'Direct', status: 'Active',
  };
  if (ctx.companyId) payload.company_id = ctx.companyId;
  const { error } = await supabase.from('cnc_customers').insert([payload]);
  if (error) return { ok: false, message: `Could not save the company: ${error.message}` };
  return { ok: true, message: `Company “${name}” saved. You can find it under “All Company Library”.`, where: { path: '/sales/pipeline', label: 'All Company Library' } };
}

async function addEnquiry(p: Params, ctx: ActionCtx): Promise<RunResult> {
  const items = productsOf(p);
  if (!str(p.company)) return { ok: false, message: 'The company is required.' };
  if (!items.length) return { ok: false, message: 'At least one product is required.' };
  if (items.some((i) => (i.qty ?? 0) < 0)) return { ok: false, message: 'Quantities cannot be negative.' };
  const co = await findCustomer(str(p.company), ctx.companyId);
  const { data: existing } = await supabase.from('cnc_enquiries').select('lead_no,enquiry_no');
  const leadNo = generateUniqueProjectNo((existing ?? []) as any[]);
  const toSave = items.map((i) => ({ productName: i.name, partName: i.name, quantity: String(i.qty ?? 0), remarks: '', filePaths: [] as string[] }));
  const names = toSave.map((i) => i.productName).join(', ');
  const payload: any = {
    id: crypto.randomUUID(), lead_no: leadNo, enquiry_no: leadNo, customer: co?.name ?? str(p.company),
    contact_person: co?.contact ?? '', phone: co?.phone ?? '', email: co?.email ?? '',
    enquiring_for: JSON.stringify(toSave), part_name: toSave.length > 1 ? `${names} (${toSave.length} Products)` : toSave[0].productName, part_no: 'N/A',
    quantity: toSave.reduce((s, i) => s + num(i.quantity), 0),
    expected_date: null, received_date: today(), estimated_value: 0, source: 'Direct', status: 'New', pipeline_stage: 'Enquiry',
  };
  if (str(p.remarks)) toSave[0].remarks = str(p.remarks), payload.enquiring_for = JSON.stringify(toSave);
  if (ctx.companyId) payload.company_id = ctx.companyId;
  const { error } = await supabase.from('cnc_enquiries').insert([payload]);
  if (error) return { ok: false, message: `Could not save the enquiry: ${error.message}` };
  return { ok: true, message: `Enquiry ${leadNo} saved for ${payload.customer}. It is in the ENQUIRY column of the Sales Pipeline.`, where: { path: '/sales/pipeline', label: 'ENQUIRY column' } };
}

async function addSalesOrder(p: Params, ctx: ActionCtx): Promise<RunResult> {
  if (!str(p.company)) return { ok: false, message: 'The company is required.' };
  const items = productsOf(p);
  const orderDate = str(p.order_date) || today();
  const delivery = str(p.delivery_date);
  if (delivery && delivery <= orderDate) return { ok: false, message: 'The delivery date must be after the order date.' };
  if (items.some((i) => (i.qty ?? 0) < 0)) return { ok: false, message: 'Quantities cannot be negative.' };
  const co = await findCustomer(str(p.company), ctx.companyId);
  const { attachDateTimeToProduct } = await import('@/pages/sales/SalesPipelinePage');   // same date-time stamp the form puts on products
  const now = new Date();
  const finalItems = items.map((i) => ({
    id: crypto.randomUUID(), filePaths: [] as string[], partName: attachDateTimeToProduct(i.name, null, now), partNumber: '', description: '',
    quantity: String(i.qty ?? 0), rejectedQty: 0, status: 'Confirmed', unitPrice: String(i.price ?? 0), discount: '0', unitDiscount: '0', gst: String(i.gst ?? 18),
  }));
  const { data: orders } = await supabase.from('cnc_sales_orders').select('order_no');
  const taken = new Set((orders ?? []).map((o: any) => String(o.order_no)));
  let orderNo = '';
  for (let i = 0; i < 30 && (!orderNo || taken.has(orderNo)); i++) orderNo = `SO-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const names = finalItems.map((i) => i.partName);
  const totalQty = finalItems.reduce((s, i) => s + num(i.quantity), 0);
  const totalVal = finalItems.reduce((s, i) => s + num(i.quantity) * num(i.unitPrice) * (1 + num(i.gst) / 100), 0);
  const payload: any = {
    id: crypto.randomUUID(), order_no: orderNo, customer: co?.name ?? str(p.company), contact_person: '', phone: '', email: '',
    billing_address: '', delivery_address: '', shipping_contact: '', shipping_phone: '', lead_no: '', order_date: orderDate,
    customer_po_no: str(p.po_no), customer_po_date: null, items: finalItems,
    part_name: finalItems.length > 1 ? `${names.join(', ')} (${finalItems.length} Products)` : (names[0] ?? ''), part_number: '', part_no: '',
    quantity: totalQty, delivered: 0, value: totalVal, total_value: totalVal, delivery_date: delivery || orderDate || null,
    status: 'Confirmed', payment_terms: 'Net 30', special_instructions: '', internal_remarks: '', quotation_id: null,
  };
  if (ctx.companyId) payload.company_id = ctx.companyId;
  const { error } = await supabase.from('cnc_sales_orders').insert([payload]);
  if (error) return { ok: false, message: `Could not save the sales order: ${error.message}` };
  return { ok: true, message: `Sales order ${orderNo} saved for ${payload.customer}. It is in the SALES ORDER column of the Sales Pipeline.`, where: { path: '/sales/pipeline', label: 'SALES ORDER column' } };
}

// ------------------------------------------------------------------------------------------------ find (read only)
const FIND: Record<string, { table: string; cols: string; who: string; line: (r: any) => string; label: string }> = {
  enquiry: { table: 'cnc_enquiries', cols: 'lead_no,enquiry_no,customer,part_name,status,received_date', who: 'customer', label: 'Enquiries', line: (r) => `${r.lead_no || r.enquiry_no} · ${r.customer} · ${r.part_name ?? ''} · ${r.status ?? ''}` },
  quotation: { table: 'cnc_quotations', cols: 'quote_no,customer,part_name,total_value,status', who: 'customer', label: 'Quotations', line: (r) => `${r.quote_no} · ${r.customer} · ${r.part_name ?? ''} · ₹${num(r.total_value).toLocaleString('en-IN')} · ${r.status ?? ''}` },
  sales_order: { table: 'cnc_sales_orders', cols: 'order_no,customer,part_name,total_value,status', who: 'customer', label: 'Sales orders', line: (r) => `${r.order_no} · ${r.customer} · ${r.part_name ?? ''} · ₹${num(r.total_value).toLocaleString('en-IN')} · ${r.status ?? ''}` },
  invoice: { table: 'cnc_invoices', cols: 'invoice_no,customer_name,amount,status', who: 'customer_name', label: 'Invoices', line: (r) => `${r.invoice_no} · ${r.customer_name} · ₹${num(r.amount).toLocaleString('en-IN')} · ${r.status ?? ''}` },
  company: { table: 'cnc_customers', cols: 'name,city,gst,phone', who: 'name', label: 'Companies', line: (r) => `${r.name}${r.city ? ' · ' + r.city : ''}${r.gst ? ' · ' + r.gst : ''}${r.phone ? ' · ' + r.phone : ''}` },
  inward: { table: 'cnc_inwards', cols: 'inward_no,party_name,part_name,status', who: 'party_name', label: 'Inwards', line: (r) => `${r.inward_no} · ${r.party_name} · ${r.part_name ?? ''} · ${r.status ?? ''}` },
  delivery: { table: 'cnc_deliveries', cols: 'delivery_no,customer_name,part_name,status', who: 'customer_name', label: 'Delivery challans', line: (r) => `${r.delivery_no} · ${r.customer_name} · ${r.part_name ?? ''} · ${r.status ?? ''}` },
};
export const FIND_MODULE: Record<string, string> = { enquiry: 'enquiries', quotation: 'quotations', sales_order: 'sales-orders', invoice: 'invoices', company: 'companies', inward: 'inward', delivery: 'delivery' };

export async function findRecords(kind: string, query: string, ctx: ActionCtx): Promise<FindResult> {
  const def = FIND[kind];
  if (!def) return { title: 'Nothing to look for', rows: [] };
  if (!ctx.canDo(FIND_MODULE[kind], 'view')) return { title: `You cannot view ${def.label.toLowerCase()}.`, rows: [] };
  let q = supabase.from(def.table).select(def.cols).order('created_at', { ascending: false }).limit(6);
  const s = ilikeSafe(query);
  if (s) q = q.ilike(def.who, `%${s}%`);
  const { data, error } = await q;
  if (error) return { title: `Could not search: ${error.message}`, rows: [] };
  const rows = ((data ?? []) as any[]).map(def.line);
  return { title: rows.length ? `${def.label}${s ? ` for “${s}”` : ''} (latest ${rows.length})` : `No ${def.label.toLowerCase()} found${s ? ` for “${s}”` : ''}.`, rows };
}

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Eye, FileText, Plus, Printer, CreditCard, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { Badge, Button, Card, statusToVariant } from '@/components/ui/Card';
import { FormField, inputClass, Modal } from '@/components/ui/Modal';
import { financeApi, type InvoiceDetail, type InvoiceRow, type InvoiceSummary } from '@/lib/finance';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { exportCsv, escapeHtml, printHtml } from '@/lib/reportExport';
import { formatDate, formatINR, todayISO } from '@/lib/format';
import { tint } from '@/lib/entryTints';
import { compactInput } from '@/lib/compactFields';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { downloadSalesInvoice, fetchCompanyPrintDetails } from '@/lib/brandedDocument';

const PAGE = 10;
const cash = (v: string | number | null | undefined) => formatINR(v, { decimals: 'auto' });
// Due Days <-> Due Date helpers (invoice_date is an ISO yyyy-mm-dd string).
const addDaysISO = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime()) || !Number.isFinite(n)) return '';
  d.setDate(d.getDate() + Math.trunc(n));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const diffDaysISO = (from: string, to: string): string => {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return '';
  return String(Math.round((b.getTime() - a.getTime()) / 86400000));
};
const emptySummary: InvoiceSummary = { total_invoices: 0, total_value: '0', total_received: '0', outstanding: '0', overdue_count: 0, overdue_amount: '0', by_status: {}, ageing: { current: '0', d31_60: '0', d61_90: '0', d90_plus: '0' }, top_customers: [], monthly: [] };

export function InvoicesPage({ onBack }: { onBack?: () => void } = {}) {
  const { company, canDo } = useAuth();
  const canCreateInv: boolean = typeof canDo === 'function' ? !!canDo('invoices', 'create') : true;
  const canEditInv: boolean = typeof canDo === 'function' ? !!canDo('invoices', 'edit') : true;
  const canExportInv: boolean = typeof canDo === 'function' ? !!canDo('invoices', 'export') : true;
  const { companyFilter, setCompanyFilter, companyOptions } = useHeaderKpis();
  const [searchParams] = useSearchParams();
  const linkedInvoiceId = searchParams.get('invoice') || '';
  const deliveryId = searchParams.get('delivery') || '';
  const [tab, setTab] = useState('');
  const [filters, setFilters] = useState({ from: '', to: '', customer: '', status: '', search: '' });
  const [draft, setDraft] = useState(filters);
  // Global Topbar date range feeds the invoice date query (server-side). The page's
  // own date inputs were removed, so these are empty and the global range applies.
  const { from: globalFrom, to: globalTo } = useGlobalDateFilter();
  const effFilters = { ...filters, from: filters.from || globalFrom || '', to: filters.to || globalTo || '' };
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [stats, setStats] = useState<InvoiceSummary>(emptySummary);
  const [customers, setCustomers] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selected, setSelected] = useState<InvoiceDetail | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // The New Invoice form is always rendered inline at the top of the page, so it starts
  // open. The popup is only used when *editing* an existing invoice (editId set).
  const [formOpen, setFormOpen] = useState(true);
  const [savedNote, setSavedNote] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<any>({ invoice_type: 'Sales Invoice', invoice_date: todayISO(), customer_name: '', customer_id: '', due_days: '', po_no: '', dc_no: '', delivery_id: '', payment_terms: '' });
  const [lines, setLines] = useState<any[]>([{ description: '', quantity: '', unit: '', rate: '', gst_rate: '', discount_pct: '0' }]);
  const [payment, setPayment] = useState<any>({ account_id: '', amount: '', txn_date: todayISO(), mode: '', reference_no: '' });

  const reload = async (p = page, f = effFilters, t = tab) => {
    setLoading(true); setError('');
    try {
      const [list, summary] = await Promise.all([
        // Empty date inputs must be omitted; Postgres cannot cast '' to a date.
        financeApi.invoices({ type: t || null, status: f.status || null, customer: f.customer || null, search: f.search, from: f.from || undefined, to: f.to || undefined, page: p, pageSize: PAGE }),
        financeApi.invoiceSummary(f.from || undefined, f.to || undefined),
      ]);
      setRows(list.rows); setTotal(list.total); setStats(summary || emptySummary); setPage(p);
    } catch (e) { setRows([]); setTotal(0); setStats(emptySummary); setError(e instanceof Error ? e.message : 'Unable to load invoices.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void reload(1, effFilters, tab); }, [company?.id, tab, globalFrom, globalTo]);
  useEffect(() => {
    if (!linkedInvoiceId) return;
    let active = true;
    Promise.all([
      financeApi.invoice(linkedInvoiceId),
      supabase.from('cnc_invoice_items').select('id,description,hsn,quantity,unit,rate,gst_rate,discount_pct,amount').eq('invoice_id', linkedInvoiceId).order('line_no'),
    ]).then(([detail, itemResult]) => {
      if (active) setSelected({ ...detail, items: itemResult.data?.length ? itemResult.data as InvoiceDetail['items'] : detail.items });
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to open linked invoice.'); });
    return () => { active = false; };
  }, [linkedInvoiceId, company?.id]);
  useEffect(() => {
    if (!deliveryId) return;
    let active = true;
    (async () => {
      const { data: delivery, error: deliveryError } = await supabase.from('cnc_deliveries')
        .select('id,delivery_no,delivery_date,customer_id,customer_name,sales_order_id,sales_order_no,part_name,dispatch_qty,quantity,delivery_address')
        .eq('id', deliveryId).maybeSingle();
      if (deliveryError) throw deliveryError;
      if (!delivery) throw new Error('Delivery challan not found.');
      const { data: order } = delivery.sales_order_id
        ? await supabase.from('cnc_sales_orders').select('id,quantity,value').eq('id', delivery.sales_order_id).maybeSingle()
        : { data: null };
      if (!active) return;
      const qty = Number(delivery.dispatch_qty ?? delivery.quantity ?? 0);
      const unitRate = Number(order?.quantity || 0) > 0 ? Number(order?.value || 0) / Number(order?.quantity) : 0;
      setSelected(null);
      setEditId('');
      setForm({ invoice_type: 'Sales Invoice', invoice_date: delivery.delivery_date || todayISO(), customer_name: delivery.customer_name || '', customer_id: delivery.customer_id || '', billing_address: delivery.delivery_address || '', due_days: '', po_no: '', dc_no: delivery.delivery_no || '', delivery_id: delivery.id, sales_order_id: delivery.sales_order_id || '', payment_terms: '' });
      setLines([{ description: delivery.part_name || '', quantity: String(qty), unit: '', rate: String(unitRate), gst_rate: '', discount_pct: '0' }]);
      setFormOpen(true);
    })().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load the delivery challan.'); });
    return () => { active = false; };
  }, [deliveryId, company?.id]);
  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from('cnc_customers').select('id,name').order('name'),
      supabase.from('cnc_deliveries').select('*').order('created_at', { ascending: false }),
      financeApi.bankFilters(),
    ]).then(([c, d, b]) => {
      if (!active) return;
      if (c.data) setCustomers(c.data as any[]);
      if (d.data) setDeliveries((d.data as any[]).filter(x => !['Billed', 'Cancelled'].includes(String(x.status))));
      setAccounts(b.accounts || []);
    }).catch(() => {});
    return () => { active = false; };
  }, [company?.id]);

  const view = async (r: InvoiceRow) => {
    setSelected(null);
    try {
      const [detail, itemResult] = await Promise.all([
        financeApi.invoice(r.id),
        supabase.from('cnc_invoice_items').select('id,description,hsn,quantity,unit,rate,gst_rate,discount_pct,amount').eq('invoice_id', r.id).order('line_no'),
      ]);
      setSelected({ ...detail, items: itemResult.data?.length ? itemResult.data as InvoiceDetail['items'] : detail.items });
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to open invoice.'); }
  };
  const startNew = () => {
    setEditId('');
    setForm({ invoice_type: 'Sales Invoice', invoice_date: todayISO(), customer_name: '', customer_id: '', due_days: '', po_no: '', dc_no: '', delivery_id: '', payment_terms: '' });
    setLines([{ description: '', quantity: '', unit: '', rate: '', gst_rate: '', discount_pct: '0' }]);
    setFormOpen(true);
  };
  const startEdit = () => {
    if (!selected || Number(selected.received) !== 0 || selected.cancelled) return;
    const item = selected.items?.[0];
    setEditId(selected.id);
    setForm({ id: selected.id, invoice_no: selected.invoice_no, invoice_type: selected.invoice_type, invoice_date: selected.invoice_date || todayISO(), due_date: selected.due_date || '', due_days: (selected.invoice_date && selected.due_date) ? diffDaysISO(selected.invoice_date, selected.due_date) : '', customer_name: selected.customer_name || '', customer_id: selected.customer_id || '', po_no: selected.po_no || '', dc_no: selected.dc_no || '', payment_terms: selected.payment_terms || '' });
    const quantity = Math.max(1, Number(selected.quantity || 1));
    const taxable = Number(selected.taxable_value || selected.basic_value || 0);
    const taxRate = taxable > 0 ? (Number(selected.cgst || 0) + Number(selected.sgst || 0) + Number(selected.igst || 0)) * 100 / taxable : 0;
    setLines(selected.items?.length ? selected.items.map(item => ({ description: item.description, quantity: item.quantity, unit: item.unit || '', rate: item.rate, gst_rate: item.gst_rate, discount_pct: item.discount_pct || '0' })) : [{ description: selected.part_name || '', quantity: String(quantity), unit: '', rate: String(taxable / quantity), gst_rate: String(taxRate), discount_pct: '0' }]);
    setFormOpen(true);
  };
  const save = async () => {
    if (!form.customer_name?.trim() || !lines.length || lines.some(line => !line.description?.trim() || Number(line.quantity) <= 0 || Number(line.rate) < 0)) { setError('Company and at least one item with a positive quantity and valid rate are required.'); return; }
    setBusy(true); setError('');
    try {
      const items = lines.map(line => ({ ...line, quantity: Number(line.quantity), rate: Number(line.rate), gst_rate: line.gst_rate === '' ? null : Number(line.gst_rate), discount_pct: Number(line.discount_pct || 0) }));
      // Due Days wins when set; otherwise the stored due date (edit flow) is kept as-is.
      const dueDate = String(form.due_days ?? '').trim() !== '' && form.invoice_date
        ? addDaysISO(form.invoice_date, Number(form.due_days))
        : (form.due_date || '');
      const result = await financeApi.saveInvoice({ ...form, due_date: dueDate, quantity: items.reduce((sum, item) => sum + item.quantity, 0), part_name: items.map(item => item.description).join(', ') }, items);
      await reload(1);
      if (editId) {
        // Editing an existing invoice still happens in the popup, which closes on save.
        setFormOpen(false);
        await view({ id: result.id } as InvoiceRow);
        // ...and the always-visible blank entry form is restored underneath it.
        startNew();
      } else {
        // Creating: keep the inline form on screen, confirm, then reset it for the next one.
        setSavedNote(result.invoice_no || result.id);
        startNew();
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save invoice.'); }
    finally { setBusy(false); }
  };
  const chooseDelivery = (id: string) => {
    const d = deliveries.find(x => String(x.id) === id);
    setForm({ ...form, delivery_id: id, dc_no: d?.delivery_no || '', sales_order_id: d?.sales_order_id || '', customer_id: d?.customer_id || '', customer_name: d?.customer_name || form.customer_name });
    if (d) setLines(current => current.map((line, index) => index === 0 ? { ...line, description: d.part_name || '', quantity: String(d.dispatch_qty ?? d.quantity ?? 1) } : line));
  };
  const recordReceipt = async () => {
    if (!selected) return;
    try {
      const f = await financeApi.bankFilters();
      if (!f.accounts?.length) { setError('No bank or cash accounts are configured.'); return; }
      setAccounts(f.accounts);
      setPayment({ account_id: f.accounts[0].id, amount: selected.balance, txn_date: todayISO(), mode: '', reference_no: selected.invoice_no });
      setPayOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load accounts.'); }
  };
  const saveReceipt = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await financeApi.addBankEntry({ direction: 'IN', account_id: payment.account_id, amount: payment.amount, txn_date: payment.txn_date, mode: payment.mode, reference_no: payment.reference_no, description: 'Receipt against ' + selected.invoice_no, party_type: 'Customer', party_name: selected.customer_name, customer_id: selected.customer_id, invoice_id: selected.id });
      setPayOpen(false); await reload(); setSelected(await financeApi.invoice(selected.id));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to record receipt.'); }
    finally { setBusy(false); }
  };
  const exportRows = async () => {
    setBusy(true);
    try {
      const out: InvoiceRow[] = [];
      for (let p = 1; p <= Math.max(1, Math.ceil(total / 500)); p++) {
        const r = await financeApi.invoices({ type: tab || null, status: effFilters.status || null, customer: effFilters.customer || null, search: effFilters.search, from: effFilters.from || undefined, to: effFilters.to || undefined, page: p, pageSize: 500 });
        out.push(...r.rows); if (out.length >= r.total) break;
      }
      exportCsv('Invoices_' + todayISO(), [['Invoice No','Date','Company','PO No','DC No','Basic Value','CGST','SGST','IGST','Total','Received','Balance','Status'], ...out.map(r => [r.invoice_no,r.invoice_date||'',r.customer_name||'',r.po_no||'',r.dc_no||'',r.basic_value,r.cgst,r.sgst,r.igst,r.total,r.received,r.balance,r.status])]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed.'); }
    finally { setBusy(false); }
  };
  const printInvoice = () => {
    if (!selected) { window.print(); return; }
    const items = (selected.items || []).map((x,i) => '<tr><td>'+(i+1)+'</td><td>'+escapeHtml(x.description)+'</td><td>'+escapeHtml(x.quantity)+'</td><td>'+cash(x.rate)+'</td><td>'+cash(x.amount)+'</td></tr>').join('');
    printHtml(selected.invoice_no, '<h1>ARGUS CNC</h1><h2>Tax Invoice</h2><p>'+escapeHtml(selected.invoice_no)+' · '+escapeHtml(formatDate(selected.invoice_date))+'</p><p>Bill To: '+escapeHtml(selected.customer_name||'')+'</p><table><thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>'+items+'</tbody></table><h3>Total: '+cash(selected.total)+'</h3>');
  };
  const downloadInvoice = async () => {
    if (!selected) { setError('Select an invoice first.'); return; }
    try {
      const comp = await fetchCompanyPrintDetails((company as any)?.id);
      const basic = Number(selected.basic_value) || 0;
      const cg = Number(selected.cgst) || 0;
      const sg = Number(selected.sgst) || 0;
      const ig = Number(selected.igst) || 0;
      const rateOf = (a: number) => (basic > 0 && a > 0 ? Math.round((a / basic) * 10000) / 100 : null);
      let dcDate: string | null = null;
      if (selected.dc_no) {
        try {
          const dr = await supabase.from('cnc_deliveries').select('delivery_date').eq('delivery_no', selected.dc_no).order('created_at').limit(1).maybeSingle();
          if (!dr.error && dr.data) dcDate = (dr.data as any).delivery_date || null;
        } catch { /* date stays empty */ }
      }
      const custMatch: any = (customers || []).find((x: any) => String(x.name || '').trim().toLowerCase() === String(selected.customer_name || '').trim().toLowerCase()) || {};
      await downloadSalesInvoice({
        companyName: company?.company_name || 'ARGUS CNC',
        companyGstin: comp.gstin,
        title: selected.invoice_type || 'Sales Invoice',
        docNo: selected.invoice_no,
        invDate: selected.invoice_date,
        partyName: selected.customer_name || '',
        partyAddress: selected.billing_address || '',
        partyCode: String(custMatch.id || selected.customer_id || ''),
        partyGstin: selected.customer_gstin || '',
        dcNo: selected.dc_no || '',
        dcDate,
        poNo: selected.po_no || '',
        items: (selected.items || []).map((item) => {
          const q = Number(item.quantity) || 0;
          const r = Number(item.rate) || 0;
          return {
            description: item.description || '', hsn: item.hsn || '',
            qty: q, unit: item.unit || '', price: r,
            amount: Number(item.amount ?? q * r) || 0,
          };
        }),
        basicValue: basic,
        cgstRate: rateOf(cg), cgstAmt: cg,
        sgstRate: rateOf(sg), sgstAmt: sg,
        igstRate: rateOf(ig), igstAmt: ig,
        roundOff: Number(selected.round_off) || 0,
        grandTotal: Number(selected.total) || 0,
        bankLines: comp.bankLines,
      });
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to generate the invoice PDF.'); }
  };
  const cancelInvoice = async () => {
    if (!selected) return; const reason = window.prompt('Reason for cancellation:'); if (!reason?.trim()) return;
    setBusy(true); try { await financeApi.cancelInvoice(selected.id, reason); await reload(); setSelected(await financeApi.invoice(selected.id)); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to cancel invoice.'); } finally { setBusy(false); }
  };
  const createCreditNote = async () => {
    if (!selected) return; const reason = window.prompt('Reason for credit note:'); if (!reason?.trim()) return;
    setBusy(true); try { const r = await financeApi.creditNote(selected.id, reason); await reload(); setSelected(await financeApi.invoice(r.id)); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create credit note.'); } finally { setBusy(false); }
  };
  const pageCount = Math.max(1, Math.ceil(total / PAGE));

  const [tableStatusFilter, setTableStatusFilter] = useState('All');

  const allCompanies = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => {
      const c = (r.customer_name || '').trim();
      if (c) set.add(c);
    });
    customers.forEach(c => {
      if (c?.name) set.add(String(c.name).trim());
    });
    companyOptions.forEach(c => {
      if (c && c !== 'All Companies') set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows, customers, companyOptions]);

  const allStatuses = ['Paid', 'Partially Paid', 'Overdue', 'Pending', 'Proforma', 'Credit Note', 'Cancelled'];

  const displayedRows = useMemo(() => {
    return rows.filter(r => {
      const matchesCompany = !companyFilter || companyFilter === 'All Companies' ||
        (r.customer_name || '').trim().toLowerCase() === companyFilter.trim().toLowerCase();
      const matchesStatus = !tableStatusFilter || tableStatusFilter === 'All' ||
        (r.status || '').trim().toLowerCase() === tableStatusFilter.trim().toLowerCase();
      return matchesCompany && matchesStatus;
    });
  }, [rows, companyFilter, tableStatusFilter]);

  // The invoice fields live in exactly one place: rendered by the always-visible
  // New Invoice card above the table, and by the popup used when editing a record.
  const invoiceFormBody = (<>
      {/* One compact row for the header fields. flex-wrap keeps every field reachable on
          narrow screens, where they simply flow onto extra lines. */}
      <div className="flex flex-wrap items-center gap-2">
        <FormField label="Invoice Type" inline><select className={`${compactInput} w-[10rem]`} value={form.invoice_type} onChange={e=>setForm({...form,invoice_type:e.target.value})}><option>Sales Invoice</option><option>Proforma Invoice</option></select></FormField>
        <FormField label="Invoice No (optional)" inline><input className={`${compactInput} w-[11rem]`} value={form.invoice_no||''} onChange={e=>setForm({...form,invoice_no:e.target.value})} placeholder="Auto-number if blank"/></FormField>
        <FormField label="Delivery Challan" inline><select className={`${compactInput} w-[16rem]`} value={form.delivery_id||''} onChange={e=>chooseDelivery(e.target.value)}><option value="">Not linked</option>{deliveries.map(d=><option key={d.id} value={d.id}>{d.delivery_no||d.id} · {d.customer_name||''}</option>)}</select></FormField>
        <FormField label="Company" required inline><select className={`${compactInput} w-[15rem]`} value={form.customer_id||''} onChange={e=>{const c=customers.find(x=>x.id===e.target.value);setForm({...form,customer_id:e.target.value,customer_name:c?.name||''})}}><option value="">Select company</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></FormField>
        <FormField label="Invoice Date" inline><input type="date" className={`${compactInput} w-[10.5rem]`} value={form.invoice_date} onChange={e=>setForm({...form,invoice_date:e.target.value})}/></FormField>
        <FormField label="Due Days" inline><input type="number" min={0} className={`${compactInput} w-[6rem]`} value={form.due_days||''} onChange={e=>setForm({...form,due_days:e.target.value})} placeholder="Days"/>{form.due_days !== '' && form.invoice_date && addDaysISO(form.invoice_date, Number(form.due_days)) ? <span className="text-[11px] text-slate-500 whitespace-nowrap">due {addDaysISO(form.invoice_date, Number(form.due_days)).split('-').reverse().join('-')}</span> : null}</FormField>
        <FormField label="PO No" inline><input className={`${compactInput} w-[9rem]`} value={form.po_no||''} onChange={e=>setForm({...form,po_no:e.target.value})}/></FormField>
        <FormField label="Payment Terms" inline><input className={`${compactInput} w-[11rem]`} value={form.payment_terms||''} onChange={e=>setForm({...form,payment_terms:e.target.value})}/></FormField>
      </div>
      <div className="mt-2.5 space-y-2 border-t border-slate-200/70 pt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Invoice Products</h3>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="secondary" icon={<Plus size={13}/>} onClick={()=>setLines([...lines,{description:'',quantity:'',unit:'',rate:'',gst_rate:'',discount_pct:'0'}])}>Add Product</Button>
            {!editId && (
              <>
                <Button variant="secondary" size="sm" onClick={() => { startNew(); setSavedNote(''); }}>Clear / Reset</Button>
                <Button size="sm" onClick={() => void save()} disabled={busy || !canCreateInv} title={!canCreateInv ? 'Invoice create permission is required' : undefined}>{busy ? 'Saving...' : 'Save Invoice'}</Button>
              </>
            )}
          </div>
        </div>
        {lines.map((line,index)=>(
          <div key={index} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white/70 px-2 py-1.5">
            <FormField label="Product" inline><input className={`${compactInput} w-[16rem]`} value={line.description} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,description:e.target.value}:x))}/></FormField>
            <FormField label="Quantity" inline><input type="number" min="0" className={`${compactInput} w-[5.5rem]`} value={line.quantity} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,quantity:e.target.value}:x))}/></FormField>
            <FormField label="Unit" inline><input className={`${compactInput} w-[5rem]`} value={line.unit} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,unit:e.target.value}:x))}/></FormField>
            <FormField label="Rate" inline><input type="number" min="0" className={`${compactInput} w-[7rem]`} value={line.rate} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,rate:e.target.value}:x))}/></FormField>
            <FormField label="GST %" inline><input type="number" min="0" className={`${compactInput} w-[6.5rem]`} value={line.gst_rate} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,gst_rate:e.target.value}:x))} placeholder="Company default"/></FormField>
            <FormField label="Discount %" inline><input type="number" min="0" className={`${compactInput} w-[7rem]`} value={line.discount_pct} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,discount_pct:e.target.value}:x))}/></FormField>
            <button type="button" aria-label="Remove item" disabled={lines.length===1} onClick={()=>setLines(lines.filter((_,i)=>i!==index))} className="h-8 shrink-0 rounded border border-slate-300 px-2 text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50 disabled:opacity-40"><Trash2 size={14} className="mx-auto"/></button>
          </div>
        ))}
      </div>
  </>);
 
  return <div className="p-3 sm:p-4 lg:px-4 lg:pt-2 lg:pb-4 space-y-2.5 bg-slate-50 min-h-full">
    {/* Line 1: Back, Title, Tabs, and Export/Print buttons */}
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
      <div className="flex items-center gap-3 min-w-0">
        {onBack && <Button variant="secondary" size="sm" icon={<ArrowLeft size={14}/>} onClick={onBack}>Back</Button>}
        <h1 className="text-lg font-bold text-slate-800 whitespace-nowrap">Invoices</h1>
        <div className="h-4 w-px bg-slate-300 hidden sm:block" />
        <div className="flex items-center gap-1 overflow-x-auto">
          {[['','All Invoices'],['Sales Invoice','Sales Invoice'],['Proforma Invoice','Proforma Invoice'],['Credit Note','Credit Note'],['Cancelled','Cancelled']].map(([v,l]) => (
            <button
              key={v}
              type="button"
              onClick={() => { setTab(v); setPage(1); }}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md whitespace-nowrap transition-colors ${tab === v ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200/60'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
        <Button variant="secondary" size="sm" icon={<Download size={13}/>} onClick={() => void exportRows()} disabled={busy || !canExportInv} title={!canExportInv ? 'Invoice export permission is required' : undefined} className="h-7 py-1 text-xs px-2.5 shadow-xs">
          Export
        </Button>
        <Button variant="secondary" size="sm" icon={<Printer size={13}/>} onClick={printInvoice} className="h-7 py-1 text-xs px-2.5 shadow-xs">
          Print
        </Button>
      </div>
    </div>
    {error && <div className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</div>}

    {/* Line 2: Small compact metric boxes on a single line */}
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
      <Metric title="Total Invoices" value={String(stats.total_invoices)} color="emerald"/>
      <Metric title="Total Invoice Value" value={cash(stats.total_value)} color="blue"/>
      <Metric title="Total Received" value={cash(stats.total_received)} color="amber"/>
      <Metric title="Outstanding Amount" value={cash(stats.outstanding)} color="rose"/>
      <Metric title="Overdue Invoices" value={String(stats.overdue_count)} color="violet"/>
    </div>
    {/* New Invoice entry form. Refactored out of the popup so it is visible as soon as
        the page opens, directly above the invoice table. Fields, validation, the item
        rows and save() are the same code as before - only the modal chrome is gone. */}
    {formOpen && !editId && (
      <section className={`rounded-xl border shadow-sm ${tint('Invoice').panel}`} data-testid="invoice-entry-form">
        <div className="space-y-2.5 p-3">
          {savedNote && (
            <div role="status" data-testid="invoice-saved-note" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              <span>&#10003; Invoice {savedNote} saved. The table below has been refreshed.</span>
              <button type="button" onClick={() => setSavedNote('')} className="font-bold underline hover:text-emerald-900">Dismiss</button>
            </div>
          )}
          {invoiceFormBody}
        </div>
      </section>
    )}
 
    <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_330px] gap-4 items-start">
      <Card className="overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full min-w-[1000px] text-left">
            <thead>
              <tr className="bg-slate-50 border-b text-[10px] uppercase text-slate-500">
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Invoice No</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Company</span>
                    <select
                      aria-label="Filter by Company"
                      title="Filter by Company"
                      value={companyFilter || 'All Companies'}
                      onChange={e => setCompanyFilter(e.target.value)}
                      className="text-[10px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[120px] truncate shadow-xs"
                    >
                      <option value="All Companies">All</option>
                      {allCompanies.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="px-2 py-2">PO No</th>
                <th className="px-2 py-2 text-right">Basic</th>
                <th className="px-2 py-2 text-right">CGST</th>
                <th className="px-2 py-2 text-right">SGST</th>
                <th className="px-2 py-2 text-right">IGST</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-right">Received</th>
                <th className="px-2 py-2 text-right">Balance</th>
                <th className="px-2 py-2">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    <span className="whitespace-nowrap">Status</span>
                    <select
                      aria-label="Filter by Status"
                      title="Filter by Status"
                      value={tableStatusFilter}
                      onChange={e => setTableStatusFilter(e.target.value)}
                      className="text-[10px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[100px] truncate shadow-xs"
                    >
                      <option value="All">All</option>
                      {allStatuses.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={14} className="p-10 text-center">Loading invoices...</td></tr>
              ) : displayedRows.map((r, i) => (
                <tr key={r.id} onClick={() => void view(r)} className="border-b hover:bg-blue-50/50 cursor-pointer text-xs">
                  <td className="px-2 py-2">{(page - 1) * PAGE + i + 1}</td>
                  <td className="px-2 py-2 font-semibold text-blue-700">{r.invoice_no}</td>
                  <td className="px-2 py-2">{formatDate(r.invoice_date)}</td>
                  <td className="px-2 py-2">{r.customer_name || '-'}</td>
                  <td className="px-2 py-2">{r.po_no || '-'}</td>
                  <td className="px-2 py-2 text-right">{cash(r.basic_value)}</td>
                  <td className="px-2 py-2 text-right">{cash(r.cgst)}</td>
                  <td className="px-2 py-2 text-right">{cash(r.sgst)}</td>
                  <td className="px-2 py-2 text-right">{cash(r.igst)}</td>
                  <td className="px-2 py-2 text-right font-semibold">{cash(r.total)}</td>
                  <td className="px-2 py-2 text-right">{cash(r.received)}</td>
                  <td className="px-2 py-2 text-right">{cash(r.balance)}</td>
                  <td className="px-2 py-2"><Badge variant={statusToVariant(r.status)}>{r.status}</Badge></td>
                  <td className="px-2 py-2"><Eye size={14} /></td>
                </tr>
              ))}
              {!loading && !displayedRows.length && (
                <tr><td colSpan={14} className="p-6 text-center text-slate-500">No invoices found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between p-2 border-t text-xs text-slate-500"><span>{total?((page-1)*PAGE+1):0}-{Math.min(page*PAGE,total)} of {total}</span><div className="flex gap-2"><button disabled={page<=1} onClick={()=>void reload(page-1)}><ChevronLeft size={16}/></button>{page}/{pageCount}<button disabled={page>=pageCount} onClick={()=>void reload(page+1)}><ChevronRight size={16}/></button></div></div>
      </Card>
      <Card className="overflow-hidden"><div className="p-3 border-b bg-slate-50"><h3 className="font-bold text-sm">Invoice Preview</h3><p className="text-[10px] text-slate-500">Selected database record</p></div>{!selected?<div className="p-10 text-center text-sm text-slate-500">Select an invoice.</div>:<div className="p-4 space-y-3 text-xs">
        <div className="flex justify-between"><b className="text-lg">ARGUS CNC</b><Badge variant={statusToVariant(selected.status)}>{selected.status}</Badge></div>
        <div className="grid grid-cols-2 gap-y-1 border-y py-2"><span>Invoice No</span><b>{selected.invoice_no}</b><span>Date</span><b>{formatDate(selected.invoice_date)}</b><span>Company</span><b>{selected.customer_name}</b><span>PO / DC</span><b>{selected.po_no||'-'} / {selected.dc_no||'-'}</b></div>
        <table className="w-full"><thead><tr className="bg-slate-50"><th className="p-1 text-left">Product</th><th className="p-1 text-right">Qty</th><th className="p-1 text-right">Rate</th><th className="p-1 text-right">Amount</th></tr></thead><tbody>{(selected.items||[]).map(i=><tr key={i.id} className="border-t"><td className="p-1">{i.description}</td><td className="p-1 text-right">{i.quantity} {i.unit||''}</td><td className="p-1 text-right">{cash(i.rate)}</td><td className="p-1 text-right">{cash(i.amount)}</td></tr>)}</tbody></table>
        <Total label="Basic Value" value={cash(selected.basic_value)}/><Total label="CGST / SGST / IGST" value={cash(selected.cgst)+' / '+cash(selected.sgst)+' / '+cash(selected.igst)}/><Total label="Received" value={cash(selected.received)}/><Total label="Balance" value={cash(selected.balance)} bold/><Total label="Total" value={cash(selected.total)} bold/>
        <div className="flex flex-wrap gap-1.5 border-t pt-3"><Button size="sm" variant="secondary" onClick={()=>void downloadInvoice()} disabled={!canExportInv} title={!canExportInv ? 'Invoice export permission is required' : undefined}><Download size={13}/> Download PDF</Button><Button size="sm" variant="secondary" onClick={printInvoice}><Printer size={13}/> Print</Button><Button size="sm" onClick={()=>void recordReceipt()} disabled={Number(selected.balance)<=0||selected.cancelled}><CreditCard size={13}/> Receipt</Button><Button size="sm" variant="secondary" onClick={startEdit} disabled={Number(selected.received)!==0||selected.cancelled||selected.invoice_type==='Credit Note'||!canEditInv} title={!canEditInv ? 'Invoice edit permission is required' : undefined}>Edit</Button>{selected.invoice_type==='Sales Invoice'&&!selected.cancelled&&(<><Button size="sm" variant="secondary" onClick={()=>void createCreditNote()}>Credit Note</Button><Button size="sm" variant="danger" onClick={()=>void cancelInvoice()}>Cancel</Button></>)}</div>
      </div>}</Card>
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4"><Card className="p-4"><h3 className="font-bold text-sm mb-3">Invoice Activity</h3><div className="h-24 flex items-end gap-1 border-b">{stats.monthly.length?stats.monthly.map(x=><div key={x.day} title={formatDate(x.day)+' '+cash(x.invoiced)} className="flex-1 bg-blue-500 rounded-t" style={{height:Math.max(3,Number(x.invoiced)/Math.max(1,...stats.monthly.map(y=>Number(y.invoiced)))*90)}}/>):<span className="w-full text-center text-xs text-slate-400">No invoice activity.</span>}</div><p className="text-[10px] text-slate-500 mt-2">Actual invoice amounts from the selected date range</p></Card><Card className="p-4"><h3 className="font-bold text-sm mb-2">Outstanding by Ageing</h3><Total label="0-30 days" value={cash(stats.ageing.current)}/><Total label="31-60 days" value={cash(stats.ageing.d31_60)}/><Total label="61-90 days" value={cash(stats.ageing.d61_90)}/><Total label="Over 90 days" value={cash(stats.ageing.d90_plus)}/></Card><Card className="p-4"><h3 className="font-bold text-sm mb-2">Invoice Status</h3><div className="grid grid-cols-2 gap-2">{['Paid','Partially Paid','Overdue','Credit Note','Cancelled'].map(x=><div key={x} className="border rounded p-2 flex justify-between text-xs">{x}<b>{stats.by_status?.[x]||0}</b></div>)}</div><h4 className="font-semibold text-xs mt-3">Top Companies</h4>{stats.top_customers?.slice(0,4).map(x=><Total key={x.customer} label={x.customer} value={cash(x.value)}/>)}</Card></div>

    <Modal open={formOpen && !!editId} onClose={()=>!busy&&setFormOpen(false)} title="Edit Invoice" subtitle="Tax totals and ledger postings are calculated by the database." size="2xl" footer={<><Button variant="secondary" onClick={()=>setFormOpen(false)}>Cancel</Button><Button onClick={()=>void save()} disabled={busy || !canEditInv} title={!canEditInv ? 'Invoice edit permission is required' : undefined}>{busy?'Saving...':'Save Invoice'}</Button></>}>
      {invoiceFormBody}
      {invoiceFormBody}
    </Modal>
    <Modal open={payOpen} onClose={()=>!busy&&setPayOpen(false)} title="Record Company Receipt" subtitle={selected?.invoice_no} footer={<><Button variant="secondary" onClick={()=>setPayOpen(false)}>Cancel</Button><Button onClick={()=>void saveReceipt()} disabled={busy}>Record Receipt</Button></>}>
      <div className="grid md:grid-cols-2 gap-3"><FormField label="Bank / Cash Account"><select className={inputClass} value={payment.account_id} onChange={e=>setPayment({...payment,account_id:e.target.value})}>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></FormField><FormField label="Amount"><input type="number" min="0.01" max={selected?.balance} className={inputClass} value={payment.amount} onChange={e=>setPayment({...payment,amount:e.target.value})}/></FormField><FormField label="Date"><input type="date" className={inputClass} value={payment.txn_date} onChange={e=>setPayment({...payment,txn_date:e.target.value})}/></FormField><FormField label="Mode"><input className={inputClass} value={payment.mode} onChange={e=>setPayment({...payment,mode:e.target.value})}/></FormField><FormField label="Reference"><input className={inputClass} value={payment.reference_no} onChange={e=>setPayment({...payment,reference_no:e.target.value})}/></FormField></div>
    </Modal>
  </div>;
}

function Metric({title,value,color}:{title:string;value:string;color:string}) {
  const styles:Record<string, { bg: string; text: string; label: string; border: string }> = {
    emerald: { bg: 'bg-emerald-50/70', text: 'text-emerald-950', label: 'text-emerald-700', border: 'border-emerald-200' },
    blue: { bg: 'bg-blue-50/70', text: 'text-blue-950', label: 'text-blue-700', border: 'border-blue-200' },
    amber: { bg: 'bg-amber-50/70', text: 'text-amber-950', label: 'text-amber-700', border: 'border-amber-200' },
    rose: { bg: 'bg-rose-50/70', text: 'text-rose-950', label: 'text-rose-700', border: 'border-rose-200' },
    violet: { bg: 'bg-violet-50/70', text: 'text-violet-950', label: 'text-violet-700', border: 'border-violet-200' },
  };
  const s = styles[color] || styles.blue;
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 rounded-lg border shadow-xs ${s.bg} ${s.border}`}>
      <span className={`text-[10px] font-bold uppercase tracking-wider ${s.label}`}>{title}</span>
      <span className={`text-sm font-black tabular-nums ${s.text}`}>{value}</span>
    </div>
  );
}
function Total({label,value,bold=false}:{label:string;value:string;bold?:boolean}) { return <div className={'flex justify-between py-1 text-xs '+(bold?'font-bold text-slate-900':'text-slate-600')}><span>{label}</span><span>{value}</span></div>; }

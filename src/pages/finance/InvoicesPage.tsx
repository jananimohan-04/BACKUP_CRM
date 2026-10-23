import { defaultTermsText } from '@/lib/termsLibrary';
import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Upload, Eye, FileText, Plus, Printer, CreditCard, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
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
import { downloadSalesInvoice, fetchCompanyPrintDetails, salesInvoicePreviewUrl } from '@/lib/brandedDocument';
import { splitProductAndRef, combineProductAndRef, formatFullReference } from '@/lib/productLabel';
import { loadTerms } from '@/lib/termsLibrary';

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
  const [partsList, setPartsList] = useState<any[]>([]);
  const [quotesList, setQuotesList] = useState<any[]>([]);
  const [salesOrdersList, setSalesOrdersList] = useState<any[]>([]);

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
      let qTerms = '';
      if (delivery.sales_order_id) {
        const { data: so } = await supabase.from('cnc_sales_orders')
          .select('quotation_id,quote_no,payment_terms')
          .eq('id', delivery.sales_order_id).maybeSingle();
        if (so) {
          if (so.quotation_id) {
            const { data: q } = await supabase.from('cnc_quotations').select('payment_terms').eq('id', so.quotation_id).maybeSingle();
            if (q?.payment_terms) qTerms = q.payment_terms;
          }
          if (!qTerms && so.quote_no) {
            const { data: q } = await supabase.from('cnc_quotations').select('payment_terms').eq('quote_no', so.quote_no).maybeSingle();
            if (q?.payment_terms) qTerms = q.payment_terms;
          }
          if (!qTerms && so.payment_terms) qTerms = so.payment_terms;
        }
      }
      if (!qTerms && delivery.customer_name) {
        const { data: q } = await supabase.from('cnc_quotations')
          .select('payment_terms')
          .eq('customer', delivery.customer_name)
          .order('created_at', { ascending: false })
          .limit(1).maybeSingle();
        if (q?.payment_terms) qTerms = q.payment_terms;
      }
      const days = qTerms ? extractDueDays(qTerms) : '';
      setSelected(null);
      setEditId('');
      setForm({ invoice_type: 'Sales Invoice', invoice_date: delivery.delivery_date || todayISO(), customer_name: delivery.customer_name || '', customer_id: delivery.customer_id || '', billing_address: delivery.delivery_address || '', due_days: days || '', po_no: '', dc_no: delivery.delivery_no || '', delivery_id: delivery.id, sales_order_id: delivery.sales_order_id || '', payment_terms: qTerms || '' });
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
      supabase.from('cnc_parts').select('id,part_name,part_code,hsn,unit,unit_price,gst_rate').order('part_name'),
      supabase.from('cnc_quotations').select('id,quote_no,customer,customer_id,part_name,payment_terms,delivery_terms,terms').order('created_at', { ascending: false }),
      supabase.from('cnc_sales_orders').select('id,order_no,customer,quote_no,quotation_id,payment_terms,part_name,items').order('created_at', { ascending: false }),
    ]).then(([c, d, b, p, q, so]) => {
      if (!active) return;
      if (c.data) setCustomers(c.data as any[]);
      if (d.data) setDeliveries((d.data as any[]).filter(x => !['Billed', 'Cancelled'].includes(String(x.status))));
      setAccounts(b.accounts || []);
      if (p.data) setPartsList(p.data as any[]);
      if (q.data) setQuotesList(q.data as any[]);
      if (so.data) setSalesOrdersList(so.data as any[]);
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
  const save = async (printAfter: boolean | unknown = false) => {
    if (!form.customer_name?.trim() || !lines.length || lines.some(line => !line.description?.trim() || Number(line.quantity) <= 0 || Number(line.rate) < 0)) { setError('Company and at least one item with a positive quantity and valid rate are required.'); return; }
    setBusy(true); setError('');
    try {
      const items = lines.map(line => ({ ...line, quantity: Number(line.quantity), rate: Number(line.rate), gst_rate: line.gst_rate === '' ? null : Number(line.gst_rate), discount_pct: Number(line.discount_pct || 0) }));
      // Due Days wins when set; otherwise the stored due date (edit flow) is kept as-is.
      const dueDate = String(form.due_days ?? '').trim() !== '' && form.invoice_date
        ? addDaysISO(form.invoice_date, Number(form.due_days))
        : (form.due_date || '');
      const result = await financeApi.saveInvoice({ ...form, due_date: dueDate, quantity: items.reduce((sum, item) => sum + item.quantity, 0), part_name: items.map(item => item.description).join(', ') }, items);
      
      const savedInvoiceRecord = {
        ...form,
        id: result.id,
        invoice_no: result.invoice_no || form.invoice_no || result.id,
        items,
        total: items.reduce((sum, item) => sum + (item.quantity * item.rate), 0),
      };

      await reload(1);

      if (printAfter === true) {
        printInvoice(savedInvoiceRecord);
      }

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
  const extractDueDays = (termsText: string): string => {
    const s = String(termsText || '').trim();
    if (!s) return '';
    const m = s.match(/\b(?:net\s*|credit\s*)?(\d{1,3})\s*(?:days?|d\b)/i) || s.match(/\b(\d{1,3})\s*days?\b/i);
    if (m) return m[1];
    if (/advance|immediate|cod|prior to dispatch/i.test(s)) return '0';
    return '';
  };

  const findQuoteTermsForDelivery = (d: any) => {
    if (!d) return '';
    const so = salesOrdersList.find(s =>
      (d.sales_order_id && String(s.id) === String(d.sales_order_id)) ||
      (d.sales_order_no && String(s.order_no) === String(d.sales_order_no))
    );
    if (so) {
      if (so.quotation_id || so.quote_no) {
        const q = quotesList.find(x =>
          (so.quotation_id && String(x.id) === String(so.quotation_id)) ||
          (so.quote_no && String(x.quote_no).trim().toLowerCase() === String(so.quote_no).trim().toLowerCase())
        );
        if (q?.payment_terms) return q.payment_terms;
      }
      if (so.payment_terms) return so.payment_terms;
    }
    const cust = String(d.customer_name || '').trim().toLowerCase();
    const part = String(d.part_name || '').trim().toLowerCase();
    if (cust) {
      const qByCustPart = quotesList.find(x =>
        String(x.customer || '').trim().toLowerCase() === cust &&
        (part && (String(x.part_name || '').trim().toLowerCase() === part || String(x.part_name || '').toLowerCase().includes(part))) &&
        x.payment_terms
      );
      if (qByCustPart?.payment_terms) return qByCustPart.payment_terms;
      const qByCust = quotesList.find(x => String(x.customer || '').trim().toLowerCase() === cust && x.payment_terms);
      if (qByCust?.payment_terms) return qByCust.payment_terms;
    }
    return '';
  };

  const findQuoteTermsForCustomer = (custName: string) => {
    const cust = String(custName || '').trim().toLowerCase();
    if (!cust) return '';
    const q = quotesList.find(x => String(x.customer || '').trim().toLowerCase() === cust && x.payment_terms);
    return q?.payment_terms || '';
  };

  const quotationTermsOptions = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    const seen = new Set<string>();

    quotesList.forEach(q => {
      const pt = String(q.payment_terms || '').trim();
      if (pt && !seen.has(pt.toLowerCase())) {
        seen.add(pt.toLowerCase());
        list.push({ value: pt, label: q.customer ? `${pt} (${q.customer})` : pt });
      }
    });

    salesOrdersList.forEach(so => {
      const pt = String(so.payment_terms || '').trim();
      if (pt && !seen.has(pt.toLowerCase())) {
        seen.add(pt.toLowerCase());
        list.push({ value: pt, label: so.customer ? `${pt} (${so.customer})` : pt });
      }
    });

    try {
      const tl = loadTerms(company?.id);
      (tl.templates || []).forEach(t => {
        const m = t.body.match(/payment\s*terms?\s*:\s*([^\n\r.]+)/i);
        const termVal = m ? m[1].trim() : t.title;
        if (termVal && !seen.has(termVal.toLowerCase())) {
          seen.add(termVal.toLowerCase());
          list.push({ value: termVal, label: `${termVal} · ${t.title}` });
        }
      });
    } catch {}

    const standards = [
      '100% Advance',
      '50% Advance, 50% Before Dispatch',
      'Net 15 Days',
      'Net 30 Days',
      'Net 45 Days',
      'Net 60 Days',
      'Immediate / Against Delivery',
    ];
    standards.forEach(s => {
      if (!seen.has(s.toLowerCase())) {
        seen.add(s.toLowerCase());
        list.push({ value: s, label: s });
      }
    });

    return list;
  }, [quotesList, salesOrdersList, company?.id]);

  const chooseDelivery = (id: string) => {
    const d = deliveries.find(x => String(x.id) === id);
    const qTerms = findQuoteTermsForDelivery(d);
    const days = qTerms ? extractDueDays(qTerms) : '';
    setForm({
      ...form,
      delivery_id: id,
      dc_no: d?.delivery_no || '',
      sales_order_id: d?.sales_order_id || '',
      customer_id: d?.customer_id || '',
      customer_name: d?.customer_name || form.customer_name,
      po_no: d?.po_no || d?.customer_po_no || form.po_no || '',
      billing_address: d?.delivery_address || d?.party_address || form.billing_address || '',
      payment_terms: qTerms || form.payment_terms || '',
      due_days: (days && (!form.due_days || form.due_days === '0')) ? days : form.due_days,
    });
    if (d) {
      const partMatch = partsList.find(p =>
        String(p.part_name || '').trim().toLowerCase() === String(d.part_name || '').trim().toLowerCase() ||
        String(p.part_code || '').trim().toLowerCase() === String(d.part_name || '').trim().toLowerCase()
      );
      setLines(current => current.map((line, index) => index === 0 ? {
        ...line,
        description: d.part_name || '',
        quantity: String(d.dispatch_qty ?? d.quantity ?? 1),
        unit: d.unit || partMatch?.unit || line.unit || 'Nos',
        rate: String(d.unit_price || d.price || partMatch?.unit_price || line.rate || ''),
        gst_rate: String(d.gst_rate || partMatch?.gst_rate || line.gst_rate || '18'),
      } : line));
    }
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
  // The invoice as the PDF layout (same document as Download), built from a saved invoice record.
  const buildInvoicePdfInput = async (inv: any) => {
    const comp = await fetchCompanyPrintDetails((company as any)?.id);
    const basic = Number(inv.basic_value) || 0;
    const cg = Number(inv.cgst) || 0;
    const sg = Number(inv.sgst) || 0;
    const ig = Number(inv.igst) || 0;
    const rateOf = (a: number) => (basic > 0 && a > 0 ? Math.round((a / basic) * 10000) / 100 : null);
    let dcDate: string | null = null;
    if (inv.dc_no) {
      try {
        const dr = await supabase.from('cnc_deliveries').select('delivery_date').eq('delivery_no', inv.dc_no).order('created_at').limit(1).maybeSingle();
        if (!dr.error && dr.data) dcDate = (dr.data as any).delivery_date || null;
      } catch { /* date stays empty */ }
    }
    const custMatch: any = (customers || []).find((x: any) => String(x.name || '').trim().toLowerCase() === String(inv.customer_name || '').trim().toLowerCase()) || {};
    return {
      companyName: company?.company_name || 'ARGUS CNC',
      companyGstin: comp.gstin,
      title: inv.invoice_type || 'Sales Invoice',
      docNo: inv.invoice_no,
      invDate: inv.invoice_date,
      partyName: inv.customer_name || '',
      partyAddress: inv.billing_address || '',
      partyCode: String(custMatch.id || inv.customer_id || ''),
      partyGstin: inv.customer_gstin || '',
      dcNo: inv.dc_no || '',
      dcDate,
      poNo: inv.po_no || '',
      items: (inv.items || []).map((item: any) => {
        const q = Number(item.quantity) || 0;
        const r = Number(item.rate) || 0;
        return { description: item.description || '', hsn: item.hsn || '', qty: q, unit: item.unit || '', price: r, amount: Number(item.amount ?? q * r) || 0 };
      }),
      basicValue: basic,
      cgstRate: rateOf(cg), cgstAmt: cg,
      sgstRate: rateOf(sg), sgstAmt: sg,
      igstRate: rateOf(ig), igstAmt: ig,
      roundOff: Number(inv.round_off) || 0,
      grandTotal: Number(inv.total) || 0,
      bankLines: comp.bankLines,
      terms: defaultTermsText((company as any)?.id),
    };
  };
  // Print opens the browser's print box on the real invoice PDF (not a plain table).
  const printInvoice = async (invToPrint?: any) => {
    let inv = invToPrint || selected;
    if (!inv) { setError('Select an invoice to print.'); return; }
    try {
      // A just-saved record only has what the form held; read it back so the tax and totals are the stored ones.
      if (inv.id && (inv.basic_value == null || inv.total == null || !(inv.items || []).length)) {
        try { inv = await financeApi.invoice(inv.id); } catch { /* print what we have */ }
      }
      const url = await salesInvoicePreviewUrl(await buildInvoicePdfInput(inv));
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      frame.src = url;
      frame.onload = () => {
        try { frame.contentWindow?.focus(); frame.contentWindow?.print(); }
        catch { window.open(url, '_blank'); }
      };
      document.body.appendChild(frame);
      window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 120_000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to print the invoice.'); }
  };
  const downloadInvoice = async () => {
    if (!selected) { setError('Select an invoice first.'); return; }
    try {
      await downloadSalesInvoice(await buildInvoicePdfInput(selected));
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

  const invInput = 'h-6 px-1.5 py-0 text-[11px] font-medium rounded border border-[color:var(--entry-border)] bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 shadow-none';
  const invLbl = 'whitespace-nowrap text-[9px] font-bold text-slate-600 uppercase tracking-tight';

  const renderInvField = (label: string, children: React.ReactNode, required?: boolean) => (
    <div className="inline-flex items-center gap-1 shrink-0">
      <span className={invLbl}>
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </div>
  );

  // The invoice fields live in exactly one place: rendered by the always-visible
  // New Invoice card above the table, and by the popup used when editing a record.
  const invoiceFormBody = (<>
      {/* Row 1: Header Fields */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {renderInvField("Type", (
          <select className={`${invInput} w-[6.5rem]`} value={form.invoice_type} onChange={e=>setForm({...form,invoice_type:e.target.value})}>
            <option>Sales Invoice</option>
            <option>Proforma Invoice</option>
          </select>
        ))}
        {renderInvField("Invoice No", (
          <input className={`${invInput} w-[6.5rem]`} value={form.invoice_no||''} onChange={e=>setForm({...form,invoice_no:e.target.value})} placeholder="Auto if blank"/>
        ))}
        {renderInvField("Delivery Challan", (
          <select className={`${invInput} w-[8.5rem]`} value={form.delivery_id||''} onChange={e=>chooseDelivery(e.target.value)}>
            <option value="">Not linked</option>
            {deliveries.map(d=><option key={d.id} value={d.id}>{d.delivery_no||d.id} · {d.customer_name||''}</option>)}
          </select>
        ))}
        {renderInvField("Company", (
          <select className={`${invInput} w-[8.5rem]`} value={form.customer_id||''} onChange={e=>{
            const c = customers.find(x=>x.id===e.target.value);
            const cName = c?.name || '';
            const qTerms = findQuoteTermsForCustomer(cName);
            const days = qTerms ? extractDueDays(qTerms) : '';
            setForm({
              ...form,
              customer_id: e.target.value,
              customer_name: cName,
              payment_terms: qTerms || form.payment_terms,
              due_days: (days && (!form.due_days || form.due_days === '0')) ? days : form.due_days,
            });
          }}>
            <option value="">Select company</option>
            {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ), true)}
        {renderInvField("Date", (
          <input type="date" className={`${invInput} w-[6.5rem]`} value={form.invoice_date} onChange={e=>setForm({...form,invoice_date:e.target.value})}/>
        ))}
        {renderInvField("Due Days", (
          <div className="inline-flex items-center gap-1">
            <input type="number" min={0} className={`${invInput} w-[2.75rem]`} value={form.due_days||''} onChange={e=>setForm({...form,due_days:e.target.value})} placeholder="Days"/>
            {form.due_days !== '' && form.invoice_date && addDaysISO(form.invoice_date, Number(form.due_days)) ? <span className="text-[9px] text-slate-500 whitespace-nowrap">due {addDaysISO(form.invoice_date, Number(form.due_days)).split('-').reverse().join('-')}</span> : null}
          </div>
        ))}
        {renderInvField("PO No", (
          <input className={`${invInput} w-[5rem]`} placeholder="PO No" value={form.po_no||''} onChange={e=>setForm({...form,po_no:e.target.value})}/>
        ))}
        {renderInvField("Payment Terms", (
          <select
            className={`${invInput} w-[9.5rem] sm:w-[11.5rem]`}
            value={form.payment_terms || ''}
            onChange={e => {
              const val = e.target.value;
              if (val === '__custom__') {
                const custom = window.prompt('Enter custom payment terms:', form.payment_terms || '');
                if (custom !== null) {
                  const days = extractDueDays(custom);
                  setForm({
                    ...form,
                    payment_terms: custom,
                    due_days: (days && (!form.due_days || form.due_days === '0')) ? days : form.due_days,
                  });
                }
                return;
              }
              const days = extractDueDays(val);
              setForm({
                ...form,
                payment_terms: val,
                due_days: (days && (!form.due_days || form.due_days === '0')) ? days : form.due_days,
              });
            }}
          >
            <option value="">Select terms…</option>
            {form.payment_terms && !quotationTermsOptions.some(o => o.value.toLowerCase() === String(form.payment_terms).toLowerCase()) && (
              <option value={form.payment_terms}>★ {form.payment_terms}</option>
            )}
            <optgroup label="Quotation Terms">
              {quotationTermsOptions.map((opt, i) => (
                <option key={`term-${i}`} value={opt.value}>
                  {opt.label || opt.value}
                </option>
              ))}
            </optgroup>
            <option value="__custom__">+ Enter Custom Terms…</option>
          </select>
        ))}
      </div>

      {/* Row 2: Product Line(s) */}
      <div className="space-y-1">
        {lines.map((line,index)=>{
          const q = Number(line.quantity) || 0;
          const r = Number(line.rate) || 0;
          const disc = Number(line.discount_pct) || 0;
          const gst = Number(line.gst_rate) || 0;
          const baseAmt = q * r * (1 - disc / 100);
          const totalAmt = baseAmt * (1 + gst / 100);
          return (
            <div key={index} className="flex flex-wrap items-center gap-1.5 rounded border border-slate-200/90 bg-white/70 px-1.5 py-0.5">
              <span className={invLbl}>Reference:</span>
              <input
                autoComplete="off"
                className={`${invInput} flex-1 min-w-[24rem] sm:min-w-[30rem]`}
                list="inv-product-list"
                placeholder="Product - Company - Date/Time - Qty"
                title={line.reference || "Full Reference (Product - Company - Date/Time - Qty)"}
                value={line.reference ?? (splitProductAndRef(line.description || '', allCompanies, form.customer_name, line.quantity).reference || '')}
                onChange={e => {
                  const val = e.target.value;
                  const split = splitProductAndRef(val, allCompanies, form.customer_name, line.quantity);
                  const orig = split.original;
                  const key = orig.trim().toLowerCase();
                  const compKey = (split.company || form.customer_name || '').trim().toLowerCase();

                  // Look up matching delivery
                  const dMatch = deliveries.find(d => {
                    const dCust = String(d.customer_name || '').trim().toLowerCase();
                    const dPart = String(d.part_name || '').trim().toLowerCase();
                    const dOrig = splitProductAndRef(d.part_name || '').original.toLowerCase();
                    const dNo = String(d.delivery_no || '').trim().toLowerCase();
                    const custMatches = !compKey || dCust === compKey;
                    return custMatches && (dPart === key || dOrig === key || dNo === key || dPart.includes(key));
                  }) || deliveries.find(d => {
                    const dPart = String(d.part_name || '').trim().toLowerCase();
                    const dOrig = splitProductAndRef(d.part_name || '').original.toLowerCase();
                    return dPart === key || dOrig === key;
                  });

                  // Look up matching sales order
                  const soMatch = salesOrdersList.find(s => {
                    const sCust = String(s.customer || s.customer_name || '').trim().toLowerCase();
                    const custMatches = !compKey || sCust === compKey;
                    if (!custMatches) return false;
                    let items: any[] = [];
                    try { items = typeof s.items === 'string' ? JSON.parse(s.items) : (s.items || []); } catch {}
                    const inItems = Array.isArray(items) && items.some((it: any) => {
                      const itName = String(it.partName || it.productName || it.part_name || it.description || '').trim().toLowerCase();
                      const itOrig = splitProductAndRef(itName).original.toLowerCase();
                      return itName === key || itOrig === key;
                    });
                    const sPart = String(s.part_name || '').trim().toLowerCase();
                    const sOrig = splitProductAndRef(s.part_name || '').original.toLowerCase();
                    return inItems || sPart === key || sOrig === key;
                  });

                  // Look up matching quotation
                  const qMatch = quotesList.find(q => {
                    const qCust = String(q.customer || '').trim().toLowerCase();
                    const custMatches = !compKey || qCust === compKey;
                    const qPart = String(q.part_name || '').trim().toLowerCase();
                    const qOrig = splitProductAndRef(q.part_name || '').original.toLowerCase();
                    return custMatches && (qPart === key || qOrig === key || qPart.includes(key));
                  });

                  // Look up matching parts master
                  const pMatch = partsList.find(p =>
                    String(p.part_name || '').trim().toLowerCase() === key ||
                    String(p.part_code || '').trim().toLowerCase() === key
                  );

                  const targetCust = split.company || dMatch?.customer_name || soMatch?.customer || soMatch?.customer_name || qMatch?.customer || form.customer_name || '';
                  const custMatch = customers.find(c => String(c.name || '').trim().toLowerCase() === targetCust.trim().toLowerCase());

                  const dtRef = split.dateTime || (dMatch?.delivery_date ? formatDate(dMatch.delivery_date) : '');
                  const fullRef = split.reference || formatFullReference(orig, targetCust, dtRef, split.qty || dMatch?.dispatch_qty || dMatch?.quantity || soMatch?.quantity);
                  const combined = combineProductAndRef(orig, fullRef);

                  // Resolve quantity
                  let resolvedQty = '';
                  if (split.qty) resolvedQty = split.qty;
                  else if (dMatch?.dispatch_qty != null && Number(dMatch.dispatch_qty) > 0) resolvedQty = String(dMatch.dispatch_qty);
                  else if (dMatch?.quantity != null && Number(dMatch.quantity) > 0) resolvedQty = String(dMatch.quantity);
                  else if (soMatch?.quantity != null && Number(soMatch.quantity) > 0) resolvedQty = String(soMatch.quantity);
                  else if (qMatch?.quantity != null && Number(qMatch.quantity) > 0) resolvedQty = String(qMatch.quantity);

                  const resolvedUnit = pMatch?.unit || dMatch?.unit || soMatch?.unit || 'Nos';
                  const resolvedHsn = pMatch?.hsn || pMatch?.hsn_code || dMatch?.hsn || (soMatch as any)?.hsn || '';

                  // Resolve unit price / rate
                  let resolvedRate = '';
                  if (dMatch?.unit_price != null && Number(dMatch.unit_price) > 0) resolvedRate = String(dMatch.unit_price);
                  else if (dMatch?.price != null && Number(dMatch.price) > 0) resolvedRate = String(dMatch.price);
                  else if (pMatch?.unit_price != null && Number(pMatch.unit_price) > 0) resolvedRate = String(pMatch.unit_price);
                  else if (qMatch?.unit_price != null && Number(qMatch.unit_price) > 0) resolvedRate = String(qMatch.unit_price);
                  else if (soMatch?.value && soMatch?.quantity && Number(soMatch.quantity) > 0) resolvedRate = String((Number(soMatch.value) / Number(soMatch.quantity)).toFixed(2));

                  const resolvedGst = pMatch?.gst_rate != null ? String(pMatch.gst_rate) : (dMatch?.gst_rate != null ? String(dMatch.gst_rate) : (qMatch?.gst_percent != null ? String(qMatch.gst_percent) : '18'));

                  // Resolve payment terms & due days from quotation / order
                  const qTerms = dMatch ? findQuoteTermsForDelivery(dMatch) : (soMatch?.payment_terms || qMatch?.payment_terms || findQuoteTermsForCustomer(targetCust));
                  const days = qTerms ? extractDueDays(qTerms) : '';

                  // Update line items
                  setLines(lines.map((x, i) => i === index ? {
                    ...x,
                    originalName: orig,
                    reference: fullRef,
                    description: combined,
                    hsn: resolvedHsn || x.hsn || '',
                    quantity: resolvedQty || x.quantity || '1',
                    unit: resolvedUnit || x.unit || 'Nos',
                    rate: resolvedRate || x.rate || '',
                    gst_rate: resolvedGst || x.gst_rate || '18',
                  } : x));

                  // Update header form with all DB details
                  setForm((prev: any) => ({
                    ...prev,
                    customer_name: targetCust || prev.customer_name,
                    customer_id: custMatch?.id || dMatch?.customer_id || prev.customer_id,
                    delivery_id: dMatch ? String(dMatch.id) : prev.delivery_id,
                    dc_no: dMatch?.delivery_no || prev.dc_no,
                    sales_order_id: dMatch?.sales_order_id || soMatch?.id || prev.sales_order_id,
                    po_no: dMatch?.po_no || dMatch?.customer_po_no || soMatch?.po_no || soMatch?.customer_po_no || prev.po_no,
                    billing_address: dMatch?.delivery_address || dMatch?.billing_address || (custMatch as any)?.address || (custMatch as any)?.billing_address || prev.billing_address,
                    payment_terms: qTerms || prev.payment_terms,
                    due_days: (days && (!prev.due_days || prev.due_days === '0')) ? days : prev.due_days,
                  }));
                }}
              />
              <span className={invLbl}>Original:</span>
              <input
                autoComplete="off"
                className={`${invInput} w-[16rem] sm:w-[18rem] min-w-[15rem]`}
                placeholder="Original Product"
                title={line.originalName ?? (splitProductAndRef(line.description || '', allCompanies, form.customer_name).original || line.description || '')}
                value={line.originalName ?? (splitProductAndRef(line.description || '', allCompanies, form.customer_name).original || line.description || '')}
                onChange={e => {
                  const orig = e.target.value;
                  const ref = line.reference || (splitProductAndRef(line.description || '', allCompanies, form.customer_name, line.quantity).reference || '');
                  const combined = combineProductAndRef(orig, ref);
                  setLines(lines.map((x, i) => i === index ? { ...x, originalName: orig, description: combined } : x));
                }}
              />
              <span className={invLbl}>Qty:</span>
              <input type="number" min="0" className={`${invInput} w-[3.75rem]`} placeholder="Qty" value={line.quantity} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,quantity:e.target.value}:x))}/>
              <span className={invLbl}>Unit:</span>
              <input className={`${invInput} w-[3.25rem]`} placeholder="Unit" value={line.unit} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,unit:e.target.value}:x))}/>
              <span className={invLbl}>Rate:</span>
              <input type="number" min="0" className={`${invInput} w-[4.5rem]`} placeholder="Rate" value={line.rate} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,rate:e.target.value}:x))}/>
              <span className={invLbl}>GST %:</span>
              <input type="number" min="0" className={`${invInput} w-[3.5rem]`} placeholder="GST" value={line.gst_rate} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,gst_rate:e.target.value}:x))}/>
              <span className={invLbl}>Disc %:</span>
              <input type="number" min="0" className={`${invInput} w-[3rem]`} placeholder="0" value={line.discount_pct} onChange={e=>setLines(lines.map((x,i)=>i===index?{...x,discount_pct:e.target.value}:x))}/>
              <span className="text-[11px] font-bold text-slate-700 tabular-nums min-w-[3.5rem] text-right">₹{totalAmt ? totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 0}</span>
              {lines.length > 1 && (
                <button type="button" aria-label="Remove item" onClick={()=>setLines(lines.filter((_,i)=>i!==index))} className="text-slate-400 hover:text-rose-600 px-0.5 font-bold text-xs">✕</button>
              )}
            </div>
          );
        })}
      </div>

      <datalist id="inv-product-list">
        {deliveries.map((d: any) => {
          const s = splitProductAndRef(d.part_name || '', allCompanies, d.customer_name);
          const dt = s.dateTime || (d.delivery_date ? formatDate(d.delivery_date) : '');
          const qty = d.dispatch_qty ?? d.quantity;
          const disp = formatFullReference(s.original, d.customer_name, dt || d.delivery_no, qty);
          return <option key={`dlv-${d.id}`} value={disp}>{disp}</option>;
        })}
        {salesOrdersList.map((so: any) => {
          const s = splitProductAndRef(so.part_name || '', allCompanies, so.customer);
          const disp = formatFullReference(s.original, so.customer, s.dateTime || so.order_no, so.quantity);
          return <option key={`so-${so.id}`} value={disp}>{disp}</option>;
        })}
        {partsList.map((p: any) => (
          <option key={`prt-${p.id}`} value={p.part_name}>{p.part_name}</option>
        ))}
      </datalist>

      {/* Row 3: Action Controls */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-slate-200/50 pt-1">
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={()=>setLines([...lines,{description:'',quantity:'',unit:'',rate:'',gst_rate:'',discount_pct:'0'}])}
            className="inline-flex items-center gap-0.5 rounded border border-brand-200 bg-brand-50/70 px-1.5 py-0.5 text-[10px] font-bold text-brand-600 hover:bg-brand-100 hover:text-brand-800 transition-colors shrink-0"
          >
            <span className="text-xs leading-none">+</span> Add Product
          </button>
        </div>

        {!editId && (
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            <button
              type="button"
              onClick={() => { startNew(); setSavedNote(''); }}
              className="h-6 px-2 text-[11px] font-medium rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Clear / Reset
            </button>
            <button
              type="button"
              onClick={() => void save(true)}
              disabled={busy || !canCreateInv}
              title={!canCreateInv ? 'Invoice create permission is required' : 'Save invoice and print'}
              className={`h-6 px-2.5 text-[11px] font-bold rounded text-white bg-brand-700 hover:bg-brand-800 shadow-sm transition-colors flex items-center gap-1 shrink-0 ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <Printer size={12} /> Save & Print
            </button>
            <button
              type="button"
              onClick={() => void save(false)}
              disabled={busy || !canCreateInv}
              title={!canCreateInv ? 'Invoice create permission is required' : undefined}
              className={`h-6 px-3 text-[11px] font-bold rounded text-white bg-brand-600 hover:bg-brand-700 shadow-sm transition-colors ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {busy ? 'Saving...' : 'Save Invoice'}
            </button>
          </div>
        )}
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
        <Button variant="secondary" size="sm" icon={<Upload size={13}/>} onClick={() => void exportRows()} disabled={busy || !canExportInv} title={!canExportInv ? 'Invoice export permission is required' : undefined} className="h-7 py-1 text-xs px-2.5 shadow-xs">
          Export
        </Button>
        <Button variant="secondary" size="sm" icon={<Printer size={13}/>} onClick={() => {
          if (form.customer_name?.trim() && lines.some(l => l.description?.trim())) {
            void save(true);
          } else if (selected) {
            printInvoice();
          } else {
            setError('Please enter company and product details to Save & Print, or select an invoice to print.');
          }
        }} className="h-7 py-1 text-xs px-2.5 shadow-xs">
          Save & Print
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
      <section className={`rounded-lg border shadow-sm ${tint('Invoice').panel} p-2 text-xs`} data-testid="invoice-entry-form">
        <div className="space-y-1.5">
          {savedNote && (
            <div role="status" data-testid="invoice-saved-note" className="flex items-center justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
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

    <Modal open={formOpen && !!editId} onClose={()=>!busy&&setFormOpen(false)} title="Edit Invoice" subtitle="Tax totals and ledger postings are calculated by the database." size="2xl" footer={<><Button variant="secondary" onClick={()=>setFormOpen(false)}>Cancel</Button><Button variant="secondary" onClick={()=>void save(true)} disabled={busy || !canEditInv} title={!canEditInv ? 'Invoice edit permission is required' : 'Save invoice and print'}><Printer size={13}/> Save & Print</Button><Button onClick={()=>void save(false)} disabled={busy || !canEditInv} title={!canEditInv ? 'Invoice edit permission is required' : undefined}>{busy?'Saving...':'Save Invoice'}</Button></>}>
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

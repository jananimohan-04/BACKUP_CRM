// DC → Invoice modal for the Sales Pipeline Kanban.
// Opened when a Delivery Challan card is dropped into Invoice. The unit price is
// NEVER typed blindly: it resolves from the latest APPROVED costing sheet
// (Finished Goods pricing) linked through DC → Sales Order → Quotation. If no
// approved price exists, creation is blocked with an explicit message — never a
// silent zero. Save reuses financeApi.saveInvoice (DB computes tax authoritatively),
// and duplicates for the same DC are refused.

import { useState, useEffect, useMemo, useRef } from 'react';
import { sameProduct } from '@/lib/productMatch';
import { supabase } from '@/lib/supabase';
import { financeApi } from '@/lib/finance';
import { fetchOrderQty, type OrderQtySummary } from '@/lib/orderQuantities';
import { loadCustomerDue, type PartyDue } from '@/lib/partyDue';
import { formatINR, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/Card';
import { Modal, inputClass } from '@/components/ui/Modal';
import { downloadSalesInvoice, fetchCompanyPrintDetails, viewSalesInvoice, type SalesInvoiceInput } from '@/lib/brandedDocument';
import { printHtml } from '@/lib/reportExport';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCheck, Download, Eye, Pencil, Printer, X } from 'lucide-react';

interface InvLine {
  key: string;
  dcId: string | null;
  itemName: string;
  productCode: string;
  qty: number;
  /** DC quantity at load: edits may reduce but never exceed it. */
  maxQty: number;
  unit: string;
  approvedUnit: number | null;
  sheetRef: string;
  unitInput: string;
  missing: boolean;
  /** The approved costing sheet row this price came from (full breakdown shown read-only). */
  sheet?: any;
}

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;

export function DcInvoiceModal({ card, onClose, onMoved }: {
  card: any;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { company, canView } = useAuth() as any;
  const companyName: string = company?.company_name ?? 'ARGUS CNC';
  // Invoice pricing is restricted: without the Invoice view permission the
  // modal shows a notice and never loads pricing (see the load effect below).

  const canSeeInvoices: boolean = typeof canView === 'function' ? !!canView('invoices') : true;
  const raw = card?.raw ?? {};
  const dcId: string | null = raw.id && raw.id !== 'dummy' ? String(raw.id) : null;
  const dcNo: string = raw.delivery_no || raw.dc_no || card?.refNo || '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [existingInv, setExistingInv] = useState<string | null>(null);

  const [customer, setCustomer] = useState(card?.customer ?? '');
  const [invDate, setInvDate] = useState(todayISO());
  const [, setQuoteNo] = useState('');
  // Types the finance module supports. Only a Sales Invoice bills the DC and counts as the invoice for it:
  // a Proforma never blocks the real invoice, and a Credit Note is a negative document.
  const [docType, setDocType] = useState<'Sales Invoice' | 'Proforma Invoice' | 'Credit Note'>('Sales Invoice');
  const docTitle = docType === 'Sales Invoice' ? 'Tax Invoice' : docType;
  const [soNo, setSoNo] = useState('');
  const [soOrderNo, setSoOrderNo] = useState('');
  const [soId, setSoId] = useState<string | null>(null);
  const [lines, setLines] = useState<InvLine[]>([]);
  const [cgst, setCgst] = useState('');
  const [sgst, setSgst] = useState('');
  const [igst, setIgst] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [orderQty, setOrderQty] = useState<OrderQtySummary | null>(null);
  // What this company already owes (unpaid earlier invoices, after the receipts in the bank statement).
  const [due, setDue] = useState<PartyDue | null>(null);
  const [dueState, setDueState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    let off = false;
    // Due amounts are invoice/receipt data: never load them without Invoice view.
    if (!canSeeInvoices) { setDue(null); setDueState('ok'); return; }
    const who = String(customer || '').trim();
    if (!who) { setDue(null); setDueState('ok'); return; }
    setDueState('loading');
    loadCustomerDue(who).then(d => { if (!off) { setDue(d); setDueState('ok'); } }).catch(() => { if (!off) { setDue(null); setDueState('error'); } });
    return () => { off = true; };
  }, [customer]);
  // Raw DC rows for the print (HSN / address / GSTIN / PO / DC date): read on click.
  const dcRowsRef = useRef<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Restricted pricing (quotations, costing sheets, invoice checks) loads
      // only for Invoice viewers; everyone else gets the notice below.
      if (!canSeeInvoices) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        // 0) Duplicate / already-billed guards first.
        if (raw.status === 'Billed') {
          if (!cancelled) { setBlocked('This Delivery Challan is already billed. Refresh the board.'); setLoading(false); }
          return;
        }
        if (dcId) {
          const r = await supabase.from('cnc_invoices').select('id,invoice_no').eq('delivery_id', dcId).neq('invoice_type', 'Proforma Invoice').limit(1);
          if (!cancelled && !r.error && (r.data ?? []).length > 0) {
            setExistingInv(r.data![0].invoice_no ?? r.data![0].id);
            setBlocked(`An invoice (${r.data![0].invoice_no ?? 'saved'}) already exists for this Delivery Challan. Duplicate invoicing is blocked.`);
            setLoading(false);
            return;
          }
        }
        if (!cancelled && dcNo) {
          const r = await supabase.from('cnc_invoices').select('id,invoice_no').eq('dc_no', dcNo).neq('invoice_type', 'Proforma Invoice').limit(1);
          if (!r.error && (r.data ?? []).length > 0) {
            setExistingInv(r.data![0].invoice_no ?? r.data![0].id);
            setBlocked(`An invoice (${r.data![0].invoice_no ?? 'saved'}) already exists for DC ${dcNo}. Duplicate invoicing is blocked.`);
            setLoading(false);
            return;
          }
        }
        // 1) All DC rows under this challan number (multi-item support).
        let rows: any[] = [raw];
        if (dcNo) {
          const r = await supabase.from('cnc_deliveries').select('*').eq('delivery_no', dcNo).order('created_at');
          if (!r.error && (r.data ?? []).length > 0) rows = r.data!;
        }
        if (!cancelled) dcRowsRef.current = rows;
        if (cancelled) return;
        // 2) Sales order → quotation chain.
        const first = rows[0] ?? {};
        let soRow: any = null;
        if (first.sales_order_id) {
          const r = await supabase.from('cnc_sales_orders').select('*').eq('id', first.sales_order_id).limit(1);
          if (!r.error && (r.data ?? []).length > 0) soRow = r.data![0];
        }
        if (!soRow && (first.sales_order_no || first.sales_order_ref)) {
          const r = await supabase.from('cnc_sales_orders').select('*').eq('order_no', first.sales_order_no || first.sales_order_ref).limit(1);
          if (!r.error && (r.data ?? []).length > 0) soRow = r.data![0];
        }
        // A challan made by hand may carry no order number: find the order through the card's unique number, else
        // through the company and the product being delivered.
        if (!soRow) {
          const ref = String(card?.refNo || first.project_name || '').trim().toLowerCase();
          const cust = String(first.customer_name || first.customer || card?.customer || '').trim().toLowerCase();
          const r = await supabase.from('cnc_sales_orders').select('*');
          if (!r.error) {
            const all = (r.data ?? []) as any[];
            soRow = (ref && all.find((o: any) => String(o.order_no ?? '').trim().toLowerCase() === ref || String(o.lead_no ?? '').trim().toLowerCase() === ref)) || null;
            if (!soRow && cust) {
              const names = rows.map((x: any) => x.part_name || x.product_name).filter(Boolean);
              const hits = all.filter((o: any) => {
                if (String(o.customer || o.customer_name || '').trim().toLowerCase() !== cust) return false;
                let items: any[] = [];
                try { const p = typeof o.items === 'string' ? JSON.parse(o.items) : o.items; if (Array.isArray(p)) items = p; } catch { /* no lines */ }
                return names.some((n: string) => items.some((it: any) => sameProduct(it.partName || it.productName || it.part_name || it.description, n)));
              });
              if (hits.length === 1) soRow = hits[0];
            }
          }
        }
        let qRow: any = null;
        if (soRow?.quotation_id) {
          const r = await supabase.from('cnc_quotations').select('*').eq('id', soRow.quotation_id).limit(1);
          if (!r.error && (r.data ?? []).length > 0) qRow = r.data![0];
        }
        if (!qRow && soRow?.quote_no) {
          const r = await supabase.from('cnc_quotations').select('*').eq('quote_no', soRow.quote_no).limit(1);
          if (!r.error && (r.data ?? []).length > 0) qRow = r.data![0];
        }
        if (cancelled) return;
        // A direct order has no quotation: its approved price is the costing sheet saved against the sales order.
        if (!qRow && !soRow?.order_no) {
          setBlocked('No quotation or sales order is linked to this Delivery Challan. An approved selling price is required before creating the invoice.');
          setLoading(false);
          return;
        }
        setQuoteNo(qRow?.quote_no ?? '');
        setSoNo(soRow?.lead_no || soRow?.order_no || '');
        setSoOrderNo(soRow?.order_no ?? '');
        setSoId(soRow?.id != null ? String(soRow.id) : null);
        // Order quantity context: delivered vs invoiced vs still invoiceable.
        if (soRow) {
          try {
            const { summary } = await fetchOrderQty(
              soRow.id != null ? String(soRow.id) : null, String(soRow.order_no ?? ''));
            if (!cancelled && summary) setOrderQty(summary);
          } catch { /* invoice still uses the DC quantity */ }
        }
        if (first.customer_name || first.customer || card?.customer) {
          setCustomer(first.customer_name || first.customer || card?.customer || '');
        }
        // 3) Approved price per product line — one fetch for the quotation,
        // then match by product code, else by product name (codes are often
        // empty on multi-product approvals; names always resolve).
        const built: InvLine[] = [];
        let missing: string[] = [];
        let sheets: any[] = [];
        try {
          const cols = 'approved_price,quantity,version,status,product_code,product_name,costing_date,quotation_price,calculated_price,adjustment,lines';
          const base = supabase.from('cnc_costing_sheets').select(cols).eq('status', 'Approved');
          // With a quotation the sheets are keyed by it; a direct order's sheets are keyed by the sales order.
          const q = qRow ? base.eq('quotation_no', qRow.quote_no) : base.eq('quotation_no', '').eq('sales_order_no', soRow.order_no);
          const v = await q.order('version', { ascending: false });
          if (!v.error) sheets = v.data ?? [];
        } catch { /* missing stays missing below */ }
        const lc = (s: any) => String(s ?? '').trim().toLowerCase();
        const unitOf = (code: string, name: string): { unit: number | null; ref: string; sheet?: any } => {
          const byCode = code.trim() !== ''
            ? sheets.find((s: any) => lc(s.product_code) === lc(code))
            : null;
          const sheet = byCode ?? (name.trim() !== '' ? (sheets.find((s: any) => lc(s.product_name) === lc(name)) ?? sheets.find((s: any) => sameProduct(s.product_name, name))) : null) ?? null;
          if (sheet && num(sheet.quantity) > 0 && sheet.approved_price != null) {
            return { unit: num(sheet.approved_price) / num(sheet.quantity), ref: `${qRow ? qRow.quote_no : soRow.order_no} V${sheet.version}`, sheet };
          }
          return { unit: null, ref: '' };
        };
        for (const row of rows) {
          const code = row.part_no || soRow?.part_no || '';
          const name = row.part_name || row.product_name || soRow?.part_name || '';
          const { unit: approvedUnit, ref: sheetRef, sheet: sheetRow } = unitOf(code, name);
          if (approvedUnit == null) missing.push(name || code || 'Unnamed product');
          const lineQty = num(row.dispatch_qty ?? row.quantity) || 0;
          built.push({
            key: uid(),
            dcId: row.id != null ? String(row.id) : null,
            itemName: name,
            productCode: code,
            qty: lineQty,
            maxQty: lineQty,
            unit: row.unit || '',
            approvedUnit,
            sheetRef,
            unitInput: '',
            missing: approvedUnit == null,
            sheet: sheetRow,
          });
          if (cancelled) return;
        }
        if (missing.length > 0) {
          setBlocked(`Approved selling price is required before creating the invoice. Missing for: ${missing.join(', ')}. Approve the Finished Goods costing first.`);
        }
        setLines(built);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effUnit = (l: InvLine) => (l.unitInput.trim() === '' ? (l.approvedUnit ?? 0) : num(l.unitInput));
  const basic = lines.reduce((s, l) => s + num(l.qty) * effUnit(l), 0);
  const c = cgst.trim() === '' ? null : num(cgst);
  const s = sgst.trim() === '' ? null : num(sgst);
  const ig = igst.trim() === '' ? null : num(igst);
  const tax = basic * ((c ?? 0) + (s ?? 0) + (ig ?? 0)) / 100;
  const grand = basic + tax;
  const origTotal = lines.reduce((sum, l) => sum + num(l.qty) * (l.approvedUnit ?? 0), 0);
  const edited = lines.some((l) => l.unitInput.trim() !== '');
  const adjustment = basic - origTotal;

  const canApprove = !loading && !loadError && !blocked && lines.length > 0
    && lines.every((l) => !l.missing && num(l.qty) > 0 && num(l.qty) <= num(l.maxQty) && effUnit(l) >= 0)
    && customer.trim() !== '';
  const dcTotal = lines.reduce((s, l) => s + num(l.qty), 0);

  // DC details shown in the header (read from the delivery challan rows loaded for this invoice)
  const headerRow: any = dcRowsRef.current[0] ?? raw ?? {};
  const headerPo = String(headerRow.po_no || raw.po_no || '').trim();
  const headerDcDate = headerRow.delivery_date || raw.delivery_date || null;
  const hsnOf = (l: InvLine): string => {
    const r: any = (l.dcId && (dcRowsRef.current as any[]).find((x: any) => String(x.id) === String(l.dcId))) || headerRow;
    return String(r?.hsn || '').trim();
  };
  const setLine = (key: string, patch: Partial<InvLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const approve = async (printAfter: boolean | unknown = false) => {
    if (!canApprove || saving) return;
    setSaving(true);
    try {
      // Re-check duplicates at commit time (second tab / double-click safe).
      if (dcId) {
        const r = await supabase.from('cnc_invoices').select('id,invoice_no').eq('delivery_id', dcId).neq('invoice_type', 'Proforma Invoice').limit(1);
        if (!r.error && (r.data ?? []).length > 0) throw new Error(`Invoice ${r.data![0].invoice_no ?? ''} already exists for this DC.`);
      }
      const gstRate = (c !== null || s !== null || ig !== null) ? (c ?? 0) + (s ?? 0) + (ig ?? 0) : null;
      const refs = Array.from(new Set(lines.map((l) => l.sheetRef).filter(Boolean))).join(', ');
      const res = await financeApi.saveInvoice({
        invoice_no: null,
        invoice_type: docType,
        customer_name: customer.trim(),
        customer_id: raw.customer_id || null,
        part_name: lines[0].itemName,
        quantity: lines.reduce((n, l) => n + num(l.qty), 0),
        invoice_date: invDate || null,
        dc_no: dcNo || null,
        delivery_id: dcId,
        sales_order_id: soId,
        notes: `Priced from approved FG costing ${refs}${edited ? ` (invoice-edited, adjustment ${adjustment >= 0 ? '+' : ''}${adjustment})` : ''}`,
      }, lines.map((l) => ({
        description: l.itemName, quantity: num(l.qty), unit: l.unit || null,
        rate: effUnit(l), gst_rate: gstRate,
      })));
      if (dcId && docType === 'Sales Invoice') {
        // Multi-product challans: every line under the number is billed together.
        const ids = Array.from(new Set(lines.map((l) => l.dcId).filter(Boolean))) as string[];
        const { error: dcErr } = await supabase.from('cnc_deliveries').update({ status: 'Billed' }).in('id', ids.length ? ids : [dcId]);
        if (dcErr) throw dcErr;
      }
      if (printAfter === true) {
        try {
          const pdfInput = await buildInvoicePdfInput();
          if (res?.invoice_no) pdfInput.docNo = res.invoice_no;
          await viewSalesInvoice(pdfInput);
        } catch (printErr) {
          console.error('Invoice print preview error:', printErr);
        }
      }
      onMoved();
      onClose();
      void res;
    } catch (e: any) {
      alert(`Approve & Create Invoice failed: ${e?.message ?? e}. Nothing was created.`);
    } finally {
      setSaving(false);
    }
  };

  const buildInvoicePdfInput = async (): Promise<SalesInvoiceInput> => {
    const d0: any = dcRowsRef.current[0] ?? raw ?? {};
    const comp = await fetchCompanyPrintDetails((company as any)?.id);
    const byDc = new Map((dcRowsRef.current as any[]).map((r: any) => [String(r.id), r]));
    return {
      companyName,
      companyGstin: comp.gstin,
      title: docTitle,
      docNo: 'DRAFT',
      invDate,
      partyName: customer,
      partyAddress: String(d0.billing_address || d0.customer_address || ''),
      partyCode: String(d0.customer_code || d0.customer_id || ''),
      partyGstin: String(d0.customer_gstin || ''),
      dcNo,
      dcDate: d0.delivery_date || null,
      poNo: String(d0.po_no || ''),
      items: lines.map((l) => {
        const r: any = (l.dcId && byDc.get(l.dcId)) || {};
        const u = effUnit(l);
        const q = num(l.qty);
        return {
          description: `${l.itemName}${l.unitInput.trim() !== '' ? ' (edited)' : ''}`,
          hsn: String(r.hsn || ''),
          qty: q, unit: l.unit || '', price: u, amount: q * u,
        };
      }),
      basicValue: basic,
      cgstRate: c, cgstAmt: c !== null ? basic * c / 100 : 0,
      sgstRate: s, sgstAmt: s !== null ? basic * s / 100 : 0,
      igstRate: ig, igstAmt: ig !== null ? basic * ig / 100 : 0,
      roundOff: 0,
      grandTotal: grand,
      bankLines: comp.bankLines,
    };
  };

  const handlePrint = () => {
    const row = (cells: string[]) => `<tr>${cells.map((x) => `<td>${x}</td>`).join('')}</tr>`;
    printHtml(`Invoice - ${dcNo}`, `
      <h2>${companyName} — ${docTitle} (DRAFT)</h2>
      <p>Company: ${customer} | DC: ${dcNo} | SO: ${soOrderNo || soNo} | Date: ${invDate}</p>
      <table><thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
      <tbody>${lines.map((l) => row([l.itemName, String(l.qty), formatINR(effUnit(l)), formatINR(num(l.qty) * effUnit(l))])).join('')}</tbody></table>
      <h3>Basic ${formatINR(basic)} | Tax ${formatINR(tax)} | Total ${formatINR(grand)}</h3>`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Invoice Entry — Approved Price"
      subtitle={`${dcNo ? `${card?.refNo || dcNo} → Invoice` : '→ Invoice'}`}
      size="2xl"
      width={960}
      footer={
        <>
          {canSeeInvoices && (
          <>
          <Button variant="secondary" icon={<Eye size={14} />} onClick={() => { void (async () => { try { await viewSalesInvoice(await buildInvoicePdfInput()); } catch (e: any) { alert(e?.message ?? e); } })(); }}>
            Preview Invoice PDF
          </Button>
          <Button variant="secondary" icon={<Download size={14} />} onClick={() => { void (async () => { try { await downloadSalesInvoice(await buildInvoicePdfInput()); } catch (e: any) { alert(e?.message ?? e); } })(); }}>
            Download PDF
          </Button>
          <Button variant="secondary" icon={<Printer size={14} />} onClick={handlePrint}>Print</Button>
          </>
          )}
          <span className="flex-1" />
          <Button variant="secondary" icon={<X size={14} />} onClick={onClose}>Cancel</Button>
          {canSeeInvoices && (
          <>
          <Button variant="secondary" icon={<Printer size={14} />} disabled={!canApprove || saving} title={!canApprove ? 'Resolve the blocker below first' : 'Create the invoice, print it and move the card'} onClick={() => void approve(true)}>Save & Print</Button>
          <Button variant="secondary" icon={<Pencil size={14} />} onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done Editing' : 'Edit'}
          </Button>
          <Button icon={<CheckCheck size={14} />} disabled={!canApprove || saving}
            title={!canApprove ? 'Resolve the blocker below first' : 'Create the invoice and move the card'}
            onClick={() => void approve(false)}>
            {saving ? 'Creating...' : docType === 'Sales Invoice' ? 'Approve & Create Invoice' : `Approve & Create ${docType}`}
          </Button>
          </>
          )}
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-slate-500 py-8 text-center">Resolving approved prices...</p>
      ) : loadError ? (
        <p className="text-sm text-red-600 py-8 text-center">Failed to load invoice data: {loadError}</p>
      ) : !canSeeInvoices ? (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <p className="font-bold uppercase tracking-wider text-[10px] mb-0.5">Not authorized</p>
          <p>Invoice details need the Invoice view permission. Ask an authorized Invoice user to complete billing for this Delivery Challan.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {blocked && (
            <div data-testid="inv-blocked" role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <p className="font-bold uppercase tracking-wider text-[10px] mb-0.5">Cannot create this invoice</p>
              <p>{blocked}</p>
            </div>
          )}
          {/* what this company already owes: first thing in the popup */}
          {dueState === 'ok' && due && due.total > 0 && (
              <div data-testid="due-amount" role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs">
                <p className="text-amber-900"><span className="font-bold uppercase tracking-wider text-[10px]">Due amount — </span>
                  <b className="text-base tabular-nums text-amber-800">₹{due.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                  <span className="text-amber-800"> still unpaid by {customer} on {due.invoices.length} earlier invoice{due.invoices.length === 1 ? '' : 's'} (after the bank receipts)</span></p>
                <ul className="mt-1.5 space-y-0.5 text-amber-900">
                  {due.invoices.slice(0, 5).map(i => (
                    <li key={i.invoiceNo + i.date} className="flex justify-between gap-3 tabular-nums">
                      <span>{i.invoiceNo} · {i.date ? i.date.split('-').reverse().join('/') : ''} · {i.days <= 0 ? 'today' : `${i.days} day${i.days === 1 ? '' : 's'}`}</span>
                      <b>₹{i.due.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                    </li>
                  ))}
                  {due.invoices.length > 5 && <li className="text-amber-700">+ {due.invoices.length - 5} more — see the Ledger Dashboard</li>}
                </ul>
              </div>
            )}
            {dueState === 'ok' && due && due.total === 0 && (
              <div data-testid="no-due" className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800"><span className="font-bold uppercase tracking-wider text-[10px]">Due amount — </span>nothing pending for {customer}.</div>
            )}
            {dueState === 'loading' && <p className="text-[11px] text-slate-400">Checking the ledger for dues…</p>}
          {/* header */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Document Type</p>
                <select aria-label="Document type" value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)} className={`${inputClass} font-semibold`}>
                  <option value="Sales Invoice">Sales Invoice</option>
                  <option value="Proforma Invoice">Proforma Invoice</option>
                  <option value="Credit Note">Credit Note</option>
                </select>
                {docType === 'Proforma Invoice' && <p className="text-[10px] text-amber-600 mt-1">Proforma: not counted as sales and does not bill the DC.</p>}
                {docType === 'Credit Note' && <p className="text-[10px] text-amber-600 mt-1">Credit note: reduces sales; does not bill the DC.</p>}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Company</p>
                <input value={customer} disabled={!editing} onChange={(e) => setCustomer(e.target.value)} className={`${inputClass} font-semibold`} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Invoice Date</p>
                <input type="date" value={invDate} disabled={!editing} onChange={(e) => setInvDate(e.target.value)} className={inputClass} />
              </div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Document Number</p><p className="font-semibold" data-testid="inv-docno">Auto-generated on approval</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">DC Number</p><p className="font-semibold" data-testid="inv-dcno">{dcNo || '—'}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">DC Date</p><p className="font-semibold" data-testid="inv-dcdate">{headerDcDate ? String(headerDcDate).slice(0, 10).split('-').reverse().join('-') : '—'}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-slate-400">PO Number</p><p className="font-semibold" data-testid="inv-po">{headerPo || '—'}</p></div>
            </div>
            {orderQty && (
              <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs">
                <span className="font-bold text-violet-800 uppercase tracking-wider text-[10px]">Order quantity — </span>
                <span className="tabular-nums">Ordered {orderQty.ordered} · Good {orderQty.good} · Rejected {orderQty.rejected} · Delivered {orderQty.delivered} · Invoiced {orderQty.invoiced} · </span>
                <b className="tabular-nums text-violet-800">Still invoiceable after this invoice: {Math.max(0, orderQty.delivered - orderQty.invoiced - dcTotal)}</b>
                <span className="text-slate-500"> (this DC: {dcTotal} pcs at approved unit price — never the full order qty)</span>
              </div>
            )}
          </div>

          {/* items */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-3 border-b border-brand-100 pb-2">Product Details</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="text-left py-2">Product Name</th><th className="text-left py-2">Product Code</th><th className="text-left py-2">HSN/SAC</th>
                  <th className="text-right py-2">Qty</th><th className="text-left py-2">Unit</th>
                  <th className="text-right py-2">System Approved Unit Price</th><th className="text-right py-2">Invoice Unit Price</th>
                  <th className="text-right py-2">Basic Amount</th>
                </tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 font-medium">{l.itemName || '—'}</td>
                      <td className="py-2 font-mono text-xs">{l.productCode || '—'}</td>
                      <td className="py-2 font-mono text-xs" data-testid="inv-hsn">{hsnOf(l) || '—'}</td>
                      <td className="py-2 text-right">
                        {editing
                          ? <input type="number" min="0" value={l.qty} onChange={(e) => setLine(l.key, { qty: num(e.target.value) })} className="w-20 text-right text-xs rounded border border-slate-300 px-1.5 py-1" />
                          : num(l.qty)}
                      </td>
                      <td className="py-2">{l.unit || '—'}</td>
                      <td className="py-2 text-right tabular-nums text-slate-500">{l.approvedUnit == null ? '—' : formatINR(l.approvedUnit)}</td>
                      <td className="py-2 text-right">
                        {editing
                          ? <input type="number" min="0" value={l.unitInput} onChange={(e) => setLine(l.key, { unitInput: e.target.value })} placeholder={l.approvedUnit == null ? '' : String(Math.round(l.approvedUnit * 100) / 100)} className="w-24 text-right text-xs rounded border border-slate-300 px-1.5 py-1" />
                          : <span className="font-semibold tabular-nums">{formatINR(effUnit(l))}</span>}
                      </td>
                      <td className="py-2 text-right font-bold tabular-nums">{formatINR(num(l.qty) * effUnit(l))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {edited && (
              <div className="mt-2 text-sm flex flex-wrap gap-x-6 gap-y-1">
                <span>Original Approved Price: <b className="tabular-nums">{formatINR(origTotal)}</b></span>
                <span>Edited Invoice Price: <b className="tabular-nums">{formatINR(basic)}</b></span>
                <span>Adjustment: <b className={`tabular-nums ${adjustment >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{adjustment >= 0 ? '+' : ''}{formatINR(adjustment)}</b></span>
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-2">Unit prices come from the approved Finished Goods costing — never re-entered. The FG approved price itself is never modified here.</p>
          </div>

          {/* project costing: the approved costing sheet behind each price, in full */}
          {lines.filter((l) => l.sheet).map((l) => {
            const sh = l.sheet;
            let ln: any = sh.lines;
            if (typeof ln === 'string') { try { ln = JSON.parse(ln); } catch { ln = {}; } }
            const mats: any[] = Array.isArray(ln?.materials) ? ln.materials : [];
            const ops: any[] = Array.isArray(ln?.ops) ? ln.ops : [];
            const matTotal = mats.reduce((a, m) => a + num(m.total), 0);
            const machine = ops.reduce((a, o) => a + num(o.machine_cost), 0);
            const labour = ops.reduce((a, o) => a + num(o.labour_cost), 0);
            const processTotal = ops.reduce((a, o) => a + num(o.process_cost), 0);
            return (
              <div key={`cost-${l.key}`} data-testid="project-costing" className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-1 border-b border-brand-100 pb-2">Project Costing — {l.itemName || l.productCode || 'Product'}</h3>
                <p className="text-[11px] text-slate-500 mb-3">Approved costing sheet {l.sheetRef}{sh.costing_date ? ` · ${String(sh.costing_date).slice(0, 10).split('-').reverse().join('-')}` : ''} · costed quantity {num(sh.quantity)} · status {sh.status}</p>

                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Raw material</p>
                <div className="overflow-x-auto mb-3"><table className="w-full text-xs min-w-[640px]">
                  <thead><tr className="text-[10px] uppercase text-slate-500 border-b border-slate-200"><th className="text-left py-1.5">Code</th><th className="text-left py-1.5">Material</th><th className="text-right py-1.5">Req. qty</th><th className="text-left py-1.5 pl-2">Unit</th><th className="text-right py-1.5">Unit cost</th><th className="text-left py-1.5 pl-3">Supplier</th><th className="text-right py-1.5">Total</th></tr></thead>
                  <tbody>
                    {mats.length === 0 && <tr><td colSpan={7} className="py-2 text-center text-slate-400 italic">No material lines in this costing.</td></tr>}
                    {mats.map((m, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0"><td className="py-1.5 font-mono">{m.material_code || '—'}</td><td className="py-1.5">{m.material_name || '—'}</td><td className="py-1.5 text-right tabular-nums">{num(m.req_qty)}</td><td className="py-1.5 pl-2">{m.unit || '—'}</td><td className="py-1.5 text-right tabular-nums">{formatINR(num(m.unit_cost))}</td><td className="py-1.5 pl-3">{m.supplier || '—'}</td><td className="py-1.5 text-right tabular-nums font-semibold">{formatINR(num(m.total))}</td></tr>
                    ))}
                  </tbody>
                </table></div>

                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Process operations (machine + labour)</p>
                <div className="overflow-x-auto mb-3"><table className="w-full text-xs min-w-[820px]">
                  <thead><tr className="text-[10px] uppercase text-slate-500 border-b border-slate-200"><th className="text-left py-1.5">#</th><th className="text-left py-1.5">Process</th><th className="text-left py-1.5">Machine</th><th className="text-right py-1.5">Mach. hrs × rate</th><th className="text-right py-1.5">Machine cost</th><th className="text-right py-1.5">Lab. hrs × rate</th><th className="text-right py-1.5">Labour cost</th><th className="text-right py-1.5">Setup</th><th className="text-right py-1.5">Process cost</th></tr></thead>
                  <tbody>
                    {ops.length === 0 && <tr><td colSpan={9} className="py-2 text-center text-slate-400 italic">No process lines in this costing.</td></tr>}
                    {ops.map((o, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0"><td className="py-1.5">{o.seq ?? i + 1}</td><td className="py-1.5">{o.process_name || o.process_code || '—'}</td><td className="py-1.5">{o.machine || '—'}</td><td className="py-1.5 text-right tabular-nums">{num(o.machine_hours)} × {num(o.machine_rate)}</td><td className="py-1.5 text-right tabular-nums">{formatINR(num(o.machine_cost))}</td><td className="py-1.5 text-right tabular-nums">{num(o.labour_hours)} × {num(o.labour_rate)}</td><td className="py-1.5 text-right tabular-nums">{formatINR(num(o.labour_cost))}</td><td className="py-1.5 text-right tabular-nums">{formatINR(num(o.setup_cost))}</td><td className="py-1.5 text-right tabular-nums font-semibold">{formatINR(num(o.process_cost))}</td></tr>
                    ))}
                  </tbody>
                </table></div>

                <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm max-w-2xl ml-auto">
                  <p className="flex justify-between"><span className="text-slate-500">Material total</span><span className="tabular-nums">{formatINR(matTotal)}</span></p>
                  <p className="flex justify-between"><span className="text-slate-500">Machine total</span><span className="tabular-nums">{formatINR(machine)}</span></p>
                  <p className="flex justify-between"><span className="text-slate-500">Labour total</span><span className="tabular-nums">{formatINR(labour)}</span></p>
                  <p className="flex justify-between"><span className="text-slate-500">Process total</span><span className="tabular-nums">{formatINR(processTotal)}</span></p>
                  <p className="flex justify-between"><span className="text-slate-500">Quotation price</span><span className="tabular-nums">{formatINR(num(sh.quotation_price))}</span></p>
                  <p className="flex justify-between"><span className="text-slate-500">Calculated cost</span><span className="tabular-nums">{formatINR(num(sh.calculated_price))}</span></p>
                  <p className="flex justify-between"><span className="text-slate-500">Adjustment</span><span className={`tabular-nums ${num(sh.adjustment) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{num(sh.adjustment) >= 0 ? '+' : ''}{formatINR(num(sh.adjustment))}</span></p>
                  <p className="flex justify-between font-bold border-t border-slate-200 pt-1"><span>Approved price ({num(sh.quantity)} pcs)</span><span className="tabular-nums">{formatINR(num(sh.approved_price))}</span></p>
                  <p className="flex justify-between font-bold sm:col-start-2"><span>Approved unit price</span><span className="tabular-nums text-brand-700">{l.approvedUnit == null ? '—' : formatINR(l.approvedUnit)}</span></p>
                </div>
              </div>
            );
          })}

          {/* tax */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-3 border-b border-brand-100 pb-2">Tax (company GST rules apply on save)</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">CGST (%)</p>
                <input type="number" min="0" value={cgst} disabled={!editing} onChange={(e) => setCgst(e.target.value)} placeholder="Company default" className={inputClass} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">SGST (%)</p>
                <input type="number" min="0" value={sgst} disabled={!editing} onChange={(e) => setSgst(e.target.value)} placeholder="Company default" className={inputClass} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">IGST (%)</p>
                <input type="number" min="0" value={igst} disabled={!editing} onChange={(e) => setIgst(e.target.value)} placeholder="Company default" className={inputClass} />
              </div>
            </div>
            <div className="mt-3 text-sm space-y-1 max-w-xs ml-auto">
              <div className="flex justify-between"><span className="text-slate-500">Basic</span><span className="font-semibold tabular-nums">{formatINR(basic)}</span></div>
              {c !== null && <div className="flex justify-between"><span className="text-slate-500">CGST ({c}%)</span><span className="tabular-nums">{formatINR(basic * c / 100)}</span></div>}
              {s !== null && <div className="flex justify-between"><span className="text-slate-500">SGST ({s}%)</span><span className="tabular-nums">{formatINR(basic * s / 100)}</span></div>}
              {ig !== null && <div className="flex justify-between"><span className="text-slate-500">IGST ({ig}%)</span><span className="tabular-nums">{formatINR(basic * ig / 100)}</span></div>}
              {c === null && s === null && ig === null && <p className="text-xs text-slate-400">GST applied from company settings on save.</p>}
              <div className="flex justify-between border-t border-slate-200 pt-1"><span className="font-bold">Grand Total</span><span className="font-bold text-brand-700 tabular-nums">{formatINR(grand)}</span></div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

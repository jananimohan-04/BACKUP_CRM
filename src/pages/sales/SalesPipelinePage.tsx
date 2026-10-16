import { useState, useEffect, useMemo, useRef, useLayoutEffect, Fragment } from 'react';
import { supabase } from '@/lib/supabase';
import { refreshSavedProducts } from '@/lib/savedProducts';
import { productWithCompany } from '@/lib/productLabel';
import { financeApi } from '@/lib/finance';
import { Button } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { CustomerAutocomplete } from '@/components/ui/CustomerAutocomplete';
import { Plus, Trash2, Eye, UploadCloud, Edit2, Download, FileText, RefreshCcw, Copy, Calculator, Users as UsersIcon, Package as PackageIcon, ScrollText, FolderOpen, Building2, ArrowLeft, ChevronDown } from 'lucide-react';
import { uploadOrderFile } from '@/lib/orderFiles';
import { MetalCalculatorPage, ClientLibraryPage, ProductLibraryPage, TermsLibraryPage, QuotationLibraryPage, CompanyProfilePage } from '../quotation/QuotationToolPages';
import { setMockImage, getMockImage } from '@/lib/mockStorage';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { recordDateOf } from '@/lib/globalDate';
import { STAGE_MODULE } from '@/config/permissions';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { EnquiryModule } from './EnquiryModule';
import { QuotationModule } from './QuotationModule';
import { HsnDatalist } from '../../components/HsnDatalist';
import { HSN_LIST_ID } from '@/lib/hsnMaster';
import { tint } from '@/lib/entryTints';
import { compactInput, compactCell, inlineLbl } from '@/lib/compactFields';
import { getSalesStageTheme, MODULE_THEMES } from '@/lib/pageThemes';
import { CreateQuotationPage, type QuotationEmbed } from '../quotation/CreateQuotationPage';
import { SalesOrderModule } from './SalesOrderModule';
import { InwardModule } from './InwardModule';
import { RejectedModule } from './RejectedModule';
import { FinishedGoodsModule } from './FinishedGoodsModule';
import { DeliveryChallanModule } from './DeliveryChallanModule';
import { InvoiceModule } from './InvoiceModule';
import { FgCostingModal } from './FgCostingModal';
import { DcInvoiceModal } from './DcInvoiceModal';
import { SignaturePad } from '@/components/ui/SignaturePad';
import { SalesOrderSection } from './SalesOrderSection';
import { downloadBrandedDocument, viewBrandedDocument, downloadDeliveryChallan, viewDeliveryChallan, downloadSalesInvoice, fetchCompanyPrintDetails, viewSalesInvoice } from '@/lib/brandedDocument';
import { generateUniqueProjectNo } from '@/lib/projectNumber';
import { summarizeSalesOrder, fetchOrderQty, recordProductionBatch, REJECTION_TYPES, type OrderQtySummary } from '@/lib/orderQuantities';
import { QtyProgress, QtySummaryGrid, QtyBreakdown } from '@/components/ui/QuantitySummary';

export type Stage = 'Enquiry' | 'Quotation' | 'Sales Order' | 'Inward' | 'Finished Goods' | 'DC' | 'Invoice';

async function uploadEnquiryProductFile(companyId: string, file: File) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
  const path = `${companyId}/enquiries/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from('inventory-images').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(`Unable to upload ${file.name}: ${error.message}`);
  return path;
}

// Blank Sales Order form. Used by the inline entry form on the Sales Orders list, by
// Clear / Reset, and by the board's "Add Sales Order" button. A fresh order number is
// generated on every reset so consecutive orders never share a number.
const resetSoForm = () => ({
  orderNo: `SO-2026-${Math.floor(1000 + Math.random() * 9000)}`,
  customer: '', orderDate: new Date().toISOString().split('T')[0],
  deliveryDate: '', customerPoNo: '',
  items: [{ id: crypto.randomUUID(), partName: '', quantity: '', rejectedQty: '', itemStatus: 'Confirmed', unitPrice: '', gst: '18' }],
});

// Blank Delivery Challan form. Used when the DC list opens, by Clear / Reset and by the
// board's "Add DC" button. A fresh DC number is generated on every reset.
const makeDcBlankForm = () => ({
  dcNo: `DC-2026-${Math.floor(1000 + Math.random() * 9000)}`,
  date: new Date().toISOString().split('T')[0], partyName: '',
  partyAddress: '', partyGstin: '', partyCode: '',
  ewayBill: '', poNumber: '', salesOrderNo: '', placeOfSupply: '', packaging: '',
  enquiryNo: '', vehicleNo: '', phone: '',
  category: '', process: '',
  receiverName: '', senderName: '', custSignature: null, authSignature: null,
});
const makeDcBlankItems = () => [{ name: '', avail: null, qty: '', selected: true, hsn: '', unit: 'Nos', price: '' }];

// The inline DC form always has an "entry session" (a source card, or none for a blank
// manual entry) - this is what used to be created when the popup was opened. It drives
// the masters / approved-price lookups and the work-order quantity cap in saveDeliveryChallan.
const DC_ENTRY_TARGET: KanbanCard = { id: 'dummy', stage: 'Finished Goods', type: 'finished_goods', refNo: '', customer: '', part: '', qty: 1, value: 0, date: '', raw: {} };

// Same idea for the inline Inward form: a blank entry session instead of a popup target.
const INWARD_ENTRY_TARGET: KanbanCard = { id: 'dummy', stage: 'Sales Order', type: 'order', refNo: '', customer: '', part: '', qty: 1, value: 0, date: '', raw: {} };

// Blank Finished Goods card. card.raw.__pick tells FgCostingModal to show its
// company / product picker first, so this is the form's starting state. The id carries a
// nonce so resetting the inline form remounts it (clearing whatever was typed).
const makeFgPickTarget = (): KanbanCard => ({
  id: `fg-pick-${Date.now()}`, stage: 'Inward', type: 'inward', refNo: '', customer: '', part: '',
  qty: 0, value: 0, date: '', raw: { __pick: true },
});

async function uploadInwardAttachment(companyId: string, inwardId: string, file: File) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
  const path = `${companyId}/inwards/${inwardId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from('inventory-images').upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  });
  if (error) throw new Error(`Unable to upload ${file.name}: ${error.message}`);
  return { name: file.name, path, size: file.size, type: file.type || 'application/octet-stream' };
}

// Base unique number: strips the order-time stamp suffix (1010-28Sep26-0994PM -> 1010)
// so stamped and plain numbers match. Idempotent.
export const baseUniqueNo = (s: any): string =>
  String(s || '').replace(/-\d{2}[A-Za-z]{3}\d{2}-\d{4}(AM|PM)$/, '');

/**
 * Formats a Date object or order timestamp into railway time: "DD-MM-YYYY HH:mm"
 * (24-hour clock, no AM/PM). Stored lead-number IDs keep their own 12-hour
 * suffix - only this product-display stamp is 24-hour. Old 12-hour stamps in
 * the database keep working: every detect/strip/match regex treats AM/PM as
 * optional, so old and new stamps compare and dedupe the same way.
 */
export function formatOrderDateTimeStamp(order?: any, fallbackDate?: Date): string {
  // 1. From lead_no stamp if present: e.g. 1010-14Oct26-1105AM -> 24-hour rendering.
  const stamped = String(order?.lead_no || order?.stamped_lead_no || '');
  const m = /-(\d{2})([A-Za-z]{3})(\d{2})-(\d{2})(\d{2})(AM|PM)$/.exec(stamped);
  if (m) {
    const [, dd, mon, yy, hh, mm, ap] = m;
    const year = Number(yy) < 50 ? `20${yy}` : `19${yy}`;
    const monMap: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const month = monMap[mon] || '01';
    const h24 = String((Number(hh) % 12) + (ap === 'PM' ? 12 : 0)).padStart(2, '0');
    return `${dd}-${month}-${year} ${h24}:${mm}`;
  }

  // 2. From created_at or order_date
  let d: Date | null = null;
  if (order?.created_at) {
    const parsed = new Date(order.created_at);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d && order?.order_date) {
    const parsed = new Date(order.order_date);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) d = fallbackDate || new Date();

  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

/**
 * Strips date/time timestamp suffix from a product name.
 */
export function getProductBaseName(name: string): string {
  return String(name || '')
    .replace(/\s*-\s*\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?/i, '')
    .replace(/\s*-\s*\d{2}[A-Za-z]{3}\d{2}[-,]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?/i, '')
    .trim();
}

/**
 * Appends Date + Time to a product name once it reaches Sales Order stage.
 * If already stamped, avoids duplicate stamping.
 */
export function attachDateTimeToProduct(productName: any, order?: any, fallbackDate?: Date): string {
  const raw = String(productName || '').trim();
  if (!raw) return '';
  // Check if it already has date + time attached:
  if (/\b\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+\d{1,2}:\d{2}/i.test(raw) || /\b\d{2}[A-Za-z]{3}\d{2}[-,]\s*\d{1,2}:\d{2}/i.test(raw)) {
    return raw;
  }
  const stamp = formatOrderDateTimeStamp(order, fallbackDate);
  return `${raw} - ${stamp}`;
}

export function formatLeadProductDisplay(raw: any): string {  if (!raw) return 'N/A';
  const isOrder = Boolean(raw.order_no || (raw.stage === 'Sales Order') || raw.quotation_id !== undefined);
  
  // 1. Check for items array (Quotation, Sales Order, etc.)
  let items: any[] = [];
  if (Array.isArray(raw.items) && raw.items.length > 0) {
    items = raw.items;
  } else if (raw.description) {
    try {
      const parsed = typeof raw.description === 'string' ? JSON.parse(raw.description) : raw.description;
      if (Array.isArray(parsed) && parsed.length > 0) items = parsed;
    } catch {}
  }
  
  if (items.length > 0) {
    const names = items.map((i: any) => {
      let n = String(i.partName || i.productName || i.part_name || i.description || '').trim();
      if (isOrder && n) n = attachDateTimeToProduct(n, raw);
      return n;
    }).filter(Boolean);
    if (names.length === 1) return names[0];
    if (names.length > 1) {
      return names.join(', ');
    }
  }

  // 2. Check for enquiring_for / enquiringFor (Enquiry / Lead)
  let enquiringItems: any[] = [];
  try {
    const ef = raw.enquiring_for ?? raw.enquiringFor;
    const parsed = typeof ef === 'string' ? JSON.parse(ef) : ef;
    if (Array.isArray(parsed) && parsed.length > 0) enquiringItems = parsed;
  } catch {}
  
  if (enquiringItems.length > 0) {
    const names = enquiringItems.map((i: any) => String(i.productName || i.product_name || i.partName || i.part_name || '').trim()).filter(Boolean);
    if (names.length === 1) return names[0];
    if (names.length > 1) {
      return names.join(', ');
    }
  }
  
  // 3. Fallback to part_name or partName string (strip any stored "(N Products)" summary suffixes)
  let pName = String(raw.part_name || raw.partName || raw.part || raw.product_name || '').trim().replace(/(\s*\(?\d+\s*products?\)?\s*)+$/i, '').trim();
  if (pName && !pName.startsWith('Multiple Products')) {
    if (isOrder) pName = attachDateTimeToProduct(pName, raw);
    return pName;
  }
  return pName || 'N/A';
}

function formatStampDateTime(stamped: any): string | null {
  // The stored lead number keeps its own 12-hour suffix (1009-26Sep26-1208AM) — that is
  // data the strip/parse regexes elsewhere rely on. Only this rendering is converted to
  // the 24-hour clock, so nothing already saved in the database has to change.
  const m = /-(\d{2})([A-Za-z]{3})(\d{2})-(\d{2})(\d{2})(AM|PM)$/.exec(String(stamped || ''));
  if (!m) return null;
  const [, dd, mon, yy, hh, mm, ap] = m;
  const h24 = (Number(hh) % 12) + (ap === 'PM' ? 12 : 0);
  return `${dd} ${mon} ${yy}, ${String(h24).padStart(2, '0')}:${mm}`;
}

function formatSaleOrderDateTime(order: any): string | null {
  if (!order) return null;
  const fromStamp = formatStampDateTime(order.lead_no || order.stamped_lead_no || '');
  if (fromStamp) return fromStamp;
  const datePart = String(order.order_date || '').slice(0, 10);
  const timePart = String(order.created_at || '').slice(11, 16);
  if (datePart && timePart && timePart.includes(':')) {
    try {
      const d = new Date(`${datePart}T${timePart}:00`);
      if (!isNaN(d.getTime())) {
        const monNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const h = d.getHours();
        return `${String(d.getDate()).padStart(2, '0')} ${monNames[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}, ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    } catch { /* fall through */ }
    return `${datePart}${timePart ? `, ${timePart}` : ''}`;
  }
  if (datePart) return datePart;
  if (order.created_at) {
    try {
      const d = new Date(order.created_at);
      if (!isNaN(d.getTime())) return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { /* ignore */ }
    return String(order.created_at).slice(0, 16).replace('T', ' ');
  }
  return null;
}

/** Normalised comparison key for names/codes (case- and space-insensitive). */
function normStr(v: any): string { return String(v ?? '').trim().toLowerCase(); }

function enquiryProductOptions(enquiries: any[], leadNo?: string, orders?: any[]) {
  // Sales-stage numbers carry a date-time stamp (1009-26Sep26-1208AM) while the
  // enquiry stores the plain number (1009) — compare base numbers so both match.
  const baseOf = (s: any) => String(s || '').replace(/-\d{2}[A-Za-z]{3}\d{2}-\d{4}(AM|PM)$/, '');
  const wantBase = baseOf(leadNo || '');
  const ordersByBase = new Map<string, any[]>();
  (orders || []).forEach((o: any) => {
    const b = baseOf(o?.lead_no || '');
    if (!b) return;
    if (!ordersByBase.has(b)) ordersByBase.set(b, []);
    ordersByBase.get(b)!.push(o);
  });
  ordersByBase.forEach(list => list.sort((a: any, b: any) =>
    String(b?.created_at || b?.order_date || '') .localeCompare(String(a?.created_at || a?.order_date || ''))));
  const fromEnquiries = (enquiries || []).filter((enquiry: any) => !leadNo || enquiry.lead_no === leadNo || enquiry.enquiry_no === leadNo
      || (wantBase && (baseOf(enquiry.lead_no) === wantBase || baseOf(enquiry.enquiry_no) === wantBase)))
    .flatMap((enquiry: any) => {
      let items: any[] = [];
      try {
        const parsed = typeof enquiry.enquiring_for === 'string' ? JSON.parse(enquiry.enquiring_for) : enquiry.enquiring_for;
        if (Array.isArray(parsed)) items = parsed;
      } catch { /* older enquiry may have a plain text product name */ }
      if (!items.length && enquiry.part_name && !String(enquiry.part_name).startsWith('Multiple Products')) {
        items = [{ productName: enquiry.part_name, quantity: enquiry.quantity }];
      }
      const base = baseOf(enquiry.lead_no || enquiry.enquiry_no);
      const matchedOrders = ordersByBase.get(base) || [];
      return items.flatMap((item: any, index: number) => {
        const name = String(item.productName || item.product_name || item.partName || item.part_name || '').trim();
        if (!name) return [];
        const baseOption = {
          key: `${enquiry.id}:${index}`,
          name,
          quantity: item.quantity ?? item.qty ?? '',
          enquiryId: enquiry.id,
          leadNo: enquiry.lead_no || enquiry.enquiry_no,
          customer: enquiry.customer || '',
        };
        if (!matchedOrders.length) return [{ ...baseOption }];
        // One dropdown row per sales order so the sale date/time disambiguates repeats.
        return matchedOrders.map((o: any) => {
          const saleLabel = formatSaleOrderDateTime(o);
          const stamped = String(o.lead_no || '').trim();
          const stampedName = attachDateTimeToProduct(name, o);
          return {
            ...baseOption,
            name: stampedName,
            key: `${enquiry.id}:${index}:${o.order_no || stamped}`,
            saleLabel,
            saleStamp: stamped,
            saleOrderRef: o.order_no || '',
            saleOrderDate: o.order_date || null,
          };
        });
      });
    });

  // Products on a sales order that has no enquiry behind it (a direct / repeat order). Without this the Inward
  // product list would be empty even though the order clearly has products.
  const orderProductOptions: any[] = [];
  (orders || []).forEach((o: any) => {
    if (!o) return;
    const ref = String(o.lead_no || '').trim();
    const orderNo = String(o.order_no || '').trim();
    if (leadNo && !(orderNo === leadNo || (ref && (ref === leadNo || (wantBase && baseOf(ref) === wantBase))))) return;
    let items: any[] = [];
    try {
      const parsed = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
      if (Array.isArray(parsed)) items = parsed;
    } catch { /* plain-text items */ }
    if (!items.length && o.part_name && !/^multiple products/i.test(String(o.part_name))) {
      items = [{ partName: String(o.part_name).replace(/\s*\(\d+\s*products?\)\s*$/i, ''), quantity: o.quantity }];
    }
    items.forEach((item: any, index: number) => {
      const name = String(item.partName || item.productName || item.product_name || item.part_name || '').trim();
      if (!name) return;
      const stampedName = attachDateTimeToProduct(name, o);
      // Already offered through its enquiry (same product on the same order): do not list it twice.
      if (fromEnquiries.some((e: any) => e.name.toLowerCase() === stampedName.toLowerCase() && (e.saleOrderRef || '') === orderNo)) return;
      orderProductOptions.push({
        key: `order:${o.id || orderNo}:${index}`,
        name: stampedName,
        quantity: item.quantity ?? item.qty ?? '',
        enquiryId: '',
        leadNo: ref || orderNo,
        customer: o.customer || o.customer_name || '',
        saleLabel: formatSaleOrderDateTime(o),
        saleStamp: ref,
        saleOrderRef: orderNo,
        saleOrderDate: o.order_date || null,
      });
    });
  });
  return [...fromEnquiries, ...orderProductOptions];
}

export interface KanbanCard {
  id: string;
  stage: Stage;
  type: string;
  refNo: string;
  customer: string;
  part: string;
  qty: string | number;
  value: number;
  date: string;
  status?: string;
  raw: any;
  /** Order quantity reconciliation (live rows) for order/FG/DC/invoice cards. */
  qtyTrack?: OrderQtySummary | null;
};

/**
 * The board's legal forward step for each column. This mirrors the branches of
 * moveCardToStage one-for-one: a card may only advance to the stage its business rules
 * allow, and Invoice is terminal. Rejected is not a board column (it is its own list),
 * so it is not part of this type.
 */
export const NEXT_STAGE: Record<Stage, Stage | null> = {
  'Enquiry': 'Quotation',
  'Quotation': 'Sales Order',
  'Sales Order': 'Inward',
  'Inward': 'Finished Goods',
  'Finished Goods': 'DC',
  'DC': 'Invoice',
  'Invoice': null,
};

const formatINR = (value: number) => {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
};

// renderRecordData moved inside component for inline edit support
import { CommentsModal } from './CommentsModal';
import { PipelineListView } from './PipelineListView';
import { PipelineCalendarView } from './PipelineCalendarView';
// All Companies is shown as a toolbar view by reusing the existing /sales/leads page.
import { LeadsPage } from './LeadsPage';

// Defined at module level so inputs keep focus between keystrokes
const ContactsList = ({ form, setForm, readOnly = false }: { form: any, setForm?: any, readOnly?: boolean }) => (
  <div className="border-t border-slate-100 pt-4 mt-2 mb-4 col-span-full">
    <div className="flex justify-between items-center mb-4">
      <h4 className="font-semibold text-sm text-slate-800">Contact Details</h4>
      {!readOnly && setForm && (
        <button type="button" onClick={() => setForm({...form, contacts: [...(form.contacts || []), { person: '', phone: '', email: '' }]})} className="flex items-center gap-1 text-xs bg-brand-100 text-brand-700 px-2 py-1 rounded hover:bg-brand-200 transition-colors">
          <Plus size={14} /> Add Contact
        </button>
      )}
    </div>
    {(form.contacts || []).map((contact: any, idx: number) => (
      <div key={idx} className="grid grid-cols-3 gap-4 mb-4 p-3 bg-slate-50 rounded border border-slate-100 relative">
        {!readOnly && setForm && (form.contacts || []).length > 1 && (
          <button type="button" onClick={() => {
            const newContacts = [...form.contacts]; newContacts.splice(idx, 1); setForm({...form, contacts: newContacts});
          }} className="absolute -top-2 -right-2 bg-red-100 text-red-600 rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-200 text-xs shadow-sm z-10 transition-colors">&times;</button>
        )}
        <FormField label="Contact Person"><input className={inputClass} value={contact.person} readOnly={readOnly} disabled={readOnly} onChange={e => {
          if(!readOnly && setForm) { const nc = [...form.contacts]; nc[idx] = { ...nc[idx], person: e.target.value }; setForm({...form, contacts: nc}); }
        }} placeholder="Name" /></FormField>
        <FormField label="Phone"><input className={inputClass} value={contact.phone} readOnly={readOnly} disabled={readOnly} onChange={e => {
          if(!readOnly && setForm) { const nc = [...form.contacts]; nc[idx] = { ...nc[idx], phone: e.target.value }; setForm({...form, contacts: nc}); }
        }} placeholder="Phone" /></FormField>
        <FormField label="Email"><input type="email" className={inputClass} value={contact.email} readOnly={readOnly} disabled={readOnly} onChange={e => {
          if(!readOnly && setForm) { const nc = [...form.contacts]; nc[idx] = { ...nc[idx], email: e.target.value }; setForm({...form, contacts: nc}); }
        }} placeholder="Email" /></FormField>
      </div>
    ))}
  </div>
);

/** Quantity Tracking section (detail view + FG approval): summary +
 *  reconciliation + record-rejected entry. Rejections save as traceable batch
 *  rows (good quantity untouched) and the summary refreshes from live rows. */
export function QtyTrackingSection({ q, userName, onSaved, allowReject = true, compact = false }: {
  q: OrderQtySummary; userName: string; onSaved: (q: OrderQtySummary) => void;
  /** Show the Record rejected quantity form (not wanted on the Inward details). */
  allowReject?: boolean;
  /** Tight paddings for dense pages (Finished Goods entry). */
  compact?: boolean;
}) {
  const [rejQty, setRejQty] = useState('');
  const [rejProduct, setRejProduct] = useState('');
  const [rejType, setRejType] = useState('');
  const [rejReason, setRejReason] = useState('');
  const [rejNotes, setRejNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const saveRejection = async () => {
    if (!rejProduct) { setMsg('Select the product first.'); return; }
    const n = Number(rejQty);
    if (!Number.isFinite(n) || n <= 0) { setMsg('Enter how many were rejected (more than 0).'); return; }
    if (!rejType) { setMsg('Select a rejection type.'); return; }
    if (!rejReason.trim()) { setMsg('Enter a rejection reason.'); return; }
    if (saving) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await recordProductionBatch({
        salesOrderId: q.soId,
        salesOrderNo: q.soNo || null,
        productName: rejProduct || null,
        batchNo: `REJ-${Date.now().toString().slice(-6)}`,
        grossQty: n,
        goodQty: 0,
        rejectedQty: n,
        reworkQty: 0,
        rejectionType: rejType,
        rejectionReason: rejReason.trim(),
        notes: rejNotes.trim() || null,
        createdBy: userName || null,
        idempotencyKey: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `rej-${Date.now()}`,
      });
      if ((res as any)?.pendingMigration) {
        setMsg('Batch storage is not provisioned — apply the production-batches migration first.');
        return;
      }
      if (!(res as any)?.saved) { setMsg('Unable to record rejection. Nothing was saved.'); return; }
      const { summary } = await fetchOrderQty(q.soId, q.soNo);
      if (summary) onSaved(summary);
      setRejQty(''); setRejProduct(''); setRejType(''); setRejReason(''); setRejNotes('');
      setMsg(`Recorded ${n} rejected${rejProduct ? ` for ${rejProduct}` : ''}.`);
    } catch (e: any) {
      setMsg('Unable to record rejection: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={compact ? 'w-full rounded-xl border-2 border-violet-200 bg-violet-50/50 px-2.5 py-2 mb-2' : 'w-full rounded-xl border-2 border-violet-200 bg-violet-50/50 px-4 py-3 mb-4'}>
      <h4 className={compact ? 'font-bold text-xs text-violet-900 uppercase mb-1' : 'font-bold text-sm text-violet-900 uppercase mb-2'}>Quantity Tracking</h4>
      <QtySummaryGrid q={q} compact={compact} />
      <div className={compact ? 'mt-1' : 'mt-2'}><QtyProgress q={q} /></div>
      <details className={compact ? 'mt-1' : 'mt-2'}>
        <summary className="text-xs font-semibold text-violet-700 cursor-pointer">Full reconciliation (batches · delivery · invoice)</summary>
        <div className="mt-2"><QtyBreakdown q={q} /></div>
      </details>
      {allowReject && (
      <div className="mt-3 rounded-xl border border-rose-200 bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-rose-700">Record rejected quantity</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
          <FormField label="In which product? *">
            <select className={inputClass} value={rejProduct} onChange={(e) => setRejProduct(e.target.value)}>
              <option value="">Select product…</option>
              {((q.products ?? []).some((p) => p.ordered > 0) ? (q.products ?? []).filter((p) => p.ordered > 0) : (q.products ?? [])).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </FormField>
          <FormField label="How many rejected? *">
            <input type="number" min={0} className={inputClass} value={rejQty} onChange={(e) => setRejQty(e.target.value)} placeholder="0" />
          </FormField>
          <FormField label="Rejection Type *">
            <select className={inputClass} value={rejType} onChange={(e) => setRejType(e.target.value)}>
              <option value="">Select…</option>
              {REJECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <div className="col-span-2 md:col-span-2">
            <FormField label="Rejection Reason *">
              <input className={inputClass} value={rejReason} onChange={(e) => setRejReason(e.target.value)} placeholder="e.g. Oversize by 0.05mm" />
            </FormField>
          </div>
          <FormField label="Notes">
            <input className={inputClass} value={rejNotes} onChange={(e) => setRejNotes(e.target.value)} placeholder="Optional" />
          </FormField>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Button size="sm" disabled={saving} onClick={() => void saveRejection()}>{saving ? 'Saving…' : 'Save Rejection'}</Button>
          {msg && <span className="text-xs text-slate-600">{msg}</span>}
        </div>
        <p className="text-[11px] text-slate-400 mt-1">Good quantity is untouched — rejected stays traceable and never enters stock, DCs or invoices.</p>
      </div>
      )}
    </div>
  );
}

/** Enquiry edit form (view modal, edit mode): the same layout as the New
 *  Enquiry entry form — unique number, company, product rows with
 *  name/qty/upload/remarks — plus the summary banner strip. Saves with an
 *  UPDATE (no new record); uploads reuse the existing storage mechanism. */
/** The entry form's input look; in view mode the same boxes are shown read-only so Add, Edit and View share one layout. */
const fieldClass = (editable: boolean) => (editable ? inputClass : `${inputClass} !bg-slate-50 !text-slate-700 cursor-default focus:!ring-0 focus:!border-slate-300`);

function EnquiryEditForm({ raw, companies, productNames, companyId, editMode, saveRef, onSaved }: {
  raw: any;
  companies: any[];
  productNames: string[];
  companyId?: string;
  editMode: boolean;
  saveRef?: { current: (() => Promise<boolean>) | null };
  onSaved: () => void;
}) {
  const initItems = () => {
    try {
      const ef = raw?.enquiring_for;
      const parsed = typeof ef === 'string' ? JSON.parse(ef) : ef;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((it: any) => ({
          productName: String(it.productName || it.partName || it.part_name || ''),
          partName: String(it.productName || it.partName || it.part_name || ''),
          quantity: it.quantity ?? it.qty ?? '',
          remarks: it.remarks || '',
          filePaths: Array.isArray(it.filePaths) ? [...it.filePaths] : [],
          files: [] as File[],
        }));
      }
    } catch { /* fall through to single-product fallback */ }
    return [{
      productName: String(raw?.part_name || ''),
      partName: String(raw?.part_name || ''),
      quantity: raw?.quantity ?? '',
      remarks: '',
      filePaths: [] as string[],
      files: [] as File[],
    }];
  };
  const [leadNo, setLeadNo] = useState(String(raw?.lead_no || raw?.enquiry_no || ''));
  const [company, setCompany] = useState(String(raw?.customer || ''));
  const [contacts, setContacts] = useState<any[]>(Array.isArray(raw?.contacts) && raw.contacts.length ? raw.contacts : [{ person: raw?.contact_person || '', phone: raw?.phone || '', email: raw?.email || '' }]);
  const [items, setItems] = useState<any[]>(initItems);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fileEntries = (fps: any[]) => (fps || []).map((fp: any, i: number) => typeof fp === 'string'
    ? { name: fp.split('/').pop() || fp, path: fp, key: `${fp}-${i}` }
    : { name: fp.name || String(fp.path || fp.url || '').split('/').pop(), path: fp.path || fp.url, key: `${fp.path || fp.url}-${i}` })
    .filter((f: any) => f.path);

  const save = async (): Promise<boolean> => {
    if (!company.trim()) { setError('Please enter a company name.'); return false; }
    const entered = items.filter((it: any) => String(it.productName || it.partName || '').trim());
    if (!entered.length) { setError('Please enter at least one product name.'); return false; }
    if (entered.some((it: any) => Number(it.quantity) < 0)) { setError('Product quantities cannot be negative.'); return false; }
    if (entered.some((it: any) => (it.files || []).length) && !companyId) {
      setError('Select a company before uploading product files.'); return false;
    }
    if (saving) return false;
    setSaving(true);
    setError('');
    try {
      const itemsToSave = await Promise.all(entered.map(async (item: any) => {
        const uploaded = companyId
          ? await Promise.all((item.files || []).map((file: File) => uploadEnquiryProductFile(companyId, file)))
          : [];
        return {
          productName: String(item.productName || item.partName).trim(),
          partName: String(item.productName || item.partName).trim(),
          quantity: item.quantity || '0',
          remarks: item.remarks || '',
          filePaths: [...(item.filePaths || []).filter((p: any) => typeof p === 'string'), ...uploaded],
        };
      }));
      const firstItem = itemsToSave[0];
      const productNamesList = itemsToSave.map((it: any) => it.productName).join(', ');
      const totalQty = itemsToSave.reduce((sum: number, it: any) => sum + (Number(it.quantity) || 0), 0);
      const c0 = contacts[0] || {};
      const { error: updErr } = await supabase.from('cnc_enquiries').update({
        lead_no: leadNo.trim(),
        enquiry_no: leadNo.trim(),
        customer: company.trim(),
        contact_person: c0.person || raw?.contact_person || '',
        phone: c0.phone || raw?.phone || '',
        email: c0.email || raw?.email || '',
        enquiring_for: JSON.stringify(itemsToSave),
        part_name: itemsToSave.length > 1 ? `${productNamesList} (${itemsToSave.length} Products)` : firstItem.productName,
        quantity: totalQty,
      }).eq('id', raw.id);
      if (updErr) throw updErr;
      onSaved();
      return true;
    } catch (e: any) {
      setError('Unable to save changes: ' + (e?.message ?? e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // The footer "Done Editing" button triggers this save; no separate button here.
  useEffect(() => {
    if (saveRef) saveRef.current = save;
    return () => { if (saveRef && saveRef.current === save) saveRef.current = null; };
  });

  const extraFields = ([
    ['Expected Date', raw?.expected_date],
    ['Source', raw?.source],
    ['Received Date', raw?.received_date],
    ['City', raw?.city],
    ['GST', raw?.gst],
  ] as [string, any][]).filter(([, v]) => v !== null && v !== undefined && v !== '');

  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 gap-4">
        {editMode ? (
          <CustomerAutocomplete
            label="Company Name"
            required
            value={company}
            onChange={(val) => {
              setCompany(val);
              const matched = (companies || []).find((c: any) => String(c.company || '').toLowerCase() === val.trim().toLowerCase());
              if (matched && (matched.contact_person || matched.phone || matched.email)) {
                setContacts([{ person: matched.contact_person || '', phone: matched.phone || '', email: matched.email || '' }]);
              }
            }}
            onSelectCustomer={(c: any) => {
              setCompany(c.company);
              if (c.contact_person || c.phone || c.email) {
                setContacts([{ person: c.contact_person || '', phone: c.phone || '', email: c.email || '' }]);
              }
            }}
            companies={companies}
            inputClass={inputClass}
            placeholder="Type or select company..."
          />
        ) : (
          <FormField label="Company Name" required>
            <input readOnly aria-label="Company name" className={fieldClass(false)} value={company} />
          </FormField>
        )}
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Products Required *</label>
          <div className="space-y-2">
            {items.map((item: any, idx: number) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_5.5rem_11rem_minmax(0,1fr)_auto] gap-2 items-center rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div>
                  {editMode ? (
                    <input className={inputClass} placeholder="Product Name" list="enquiry-edit-product-list" value={item.productName ?? item.partName ?? ''} onChange={(e) => {
                      const next = [...items];
                      next[idx] = { ...next[idx], productName: e.target.value, partName: e.target.value };
                      setItems(next);
                    }} />
                  ) : (
                    <input readOnly aria-label="Product name" className={fieldClass(false)} value={item.productName || item.partName || ''} />
                  )}
                </div>
                <div>
                  {editMode ? (
                    <input type="number" className={inputClass} placeholder="Qty" value={item.quantity} onChange={(e) => {
                      const next = [...items];
                      next[idx] = { ...next[idx], quantity: e.target.value };
                      setItems(next);
                    }} />
                  ) : (
                    <input readOnly aria-label="Quantity" className={fieldClass(false)} value={item.quantity === '' || item.quantity == null ? '' : String(item.quantity)} />
                  )}
                </div>
                <div>
                  {editMode && (
                    <label className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700">
                      <UploadCloud size={15} />{((item.files || []).length + fileEntries(item.filePaths).length) ? `${(item.files || []).length + fileEntries(item.filePaths).length} file(s) selected` : 'Upload image / file / PDF'}
                      <input type="file" multiple accept="*/*" className="hidden" onChange={(e) => {
                        const selectedFiles = Array.from(e.currentTarget.files || []);
                        e.currentTarget.value = '';
                        if (selectedFiles.length) {
                          setItems((prev: any[]) => prev.map((it: any, i: number) => i === idx ? { ...it, files: [...(it.files || []), ...selectedFiles] } : it));
                        }
                      }} />
                    </label>
                  )}
                  {(item.files || []).length > 0 && (
                    <div className="mt-1 space-y-1">
                      {item.files.map((file: File, fileIdx: number) => (
                        <div key={`${file.name}-${fileIdx}`} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                          <span className="truncate">{file.name}</span>
                          <button type="button" className="text-rose-600 hover:text-rose-800 font-semibold cursor-pointer" onClick={() => {
                            setItems((prev: any[]) => prev.map((it: any, i: number) => i === idx ? { ...it, files: (it.files || []).filter((_: File, j: number) => j !== fileIdx) } : it));
                          }}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {fileEntries(item.filePaths).length > 0 && (
                    <div className="mt-1 space-y-1">
                      {fileEntries(item.filePaths).map((f: any) => (
                        <div key={f.key} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                          <span className="truncate">{f.name}</span>
                          {editMode && (
                            <button type="button" className="text-rose-600 hover:text-rose-800 font-semibold cursor-pointer" onClick={() => {
                              setItems((prev: any[]) => prev.map((it: any, i: number) => i === idx ? { ...it, filePaths: (it.filePaths || []).filter((p: any) => (typeof p === 'string' ? p : p.path || p.url) !== f.path) } : it));
                            }}>Remove</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  {editMode ? (
                    <input className={inputClass} placeholder="Remarks..." value={item.remarks || ''} onChange={(e) => {
                      const next = [...items];
                      next[idx] = { ...next[idx], remarks: e.target.value };
                      setItems(next);
                    }} />
                  ) : (
                    <input readOnly aria-label="Remarks" className={fieldClass(false)} placeholder="—" value={item.remarks || ''} />
                  )}
                </div>
                {editMode ? (
                  idx > 0 ? (
                    <button type="button" className="p-2 text-red-500 hover:bg-red-50 rounded" onClick={() => setItems(items.filter((_: any, i: number) => i !== idx))}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0-1 1-2 2-2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    </button>
                  ) : <span />
                ) : null}
              </div>
            ))}
            <datalist id="enquiry-edit-product-list">{productNames.map((n) => <option key={n} value={n} />)}</datalist>
            {editMode && (
              <button type="button" className="text-xs font-medium text-brand-600 hover:text-brand-800 flex items-center gap-1 mt-1" onClick={() => {
                setItems([...items, { productName: '', partName: '', quantity: '', remarks: '', filePaths: [], files: [] as File[] }]);
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Add Another Product
              </button>
            )}
          </div>
        </div>
        {!editMode && extraFields.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
            {extraFields.map(([label, v]) => (
              <div key={label}>
                <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">{label}</span>
                <span className="text-sm text-slate-800 font-medium break-words">{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {editMode && error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
    </div>
  );
}

/** Quotation edit form (view modal, edit mode): the same layout as the Create
 *  Quotation entry form — context banner, quotation date, editable
 *  products/items table with computed totals, additional details. Saves with
 *  an UPDATE (totals recomputed with the entry formula); uploads reuse the
 *  existing storage mechanism. */
function QuotationEditForm({ raw, productNames, companyId, openFile, onSaved, readOnly = false }: {
  /** View mode: the same form, locked, without the save button. */
  readOnly?: boolean;
  raw: any;
  productNames: string[];
  companyId?: string;
  openFile: (path: string) => void;
  onSaved: () => void;
}) {
  const initItems = () => {
    try {
      const d = raw?.description;
      const parsed = typeof d === 'string' ? JSON.parse(d) : d;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((it: any) => ({
          id: it.id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `q-${Date.now()}-${Math.random()}`),
          partName: String(it.partName || it.productName || it.part_name || it.description || ''),
          partNumber: String(it.partNumber || it.part_number || ''),
          quantity: it.quantity ?? it.qty ?? '',
          unitPrice: it.unitPrice ?? it.rate ?? '',
          discount: it.discount ?? it.discount_percent ?? '0',
          unitDiscount: it.unitDiscount ?? it.unit_discount ?? '0',
          gst: it.gst ?? it.gst_percent ?? '18',
          filePaths: Array.isArray(it.filePaths) ? [...it.filePaths] : [],
          files: [] as File[],
        }));
      }
    } catch { /* fall through to single-item fallback */ }
    return [{
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `q-${Date.now()}`,
      partName: String(raw?.part_name || ''),
      partNumber: String(raw?.part_number || raw?.part_no || ''),
      quantity: raw?.quantity ?? '',
      unitPrice: raw?.unit_price ?? '',
      discount: raw?.discount_percent ?? '0',
      unitDiscount: (raw as any)?.unit_discount ?? '0',
      gst: raw?.gst_percent ?? '18',
      filePaths: [] as string[],
      files: [] as File[],
    }];
  };
  const [quoteDate, setQuoteDate] = useState(String(raw?.date || raw?.quote_date || new Date().toISOString().split('T')[0]).slice(0, 10));
  const [items, setItems] = useState<any[]>(initItems);
  const [paymentTerms, setPaymentTerms] = useState(String(raw?.payment_terms || ''));
  const [deliveryTerms, setDeliveryTerms] = useState(String(raw?.delivery_terms || ''));
  const [remarks, setRemarks] = useState(String(raw?.remarks || raw?.notes || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const upd = (idx: number, patch: any) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const lineTotal = (it: any) => {
    const q = Number(it.quantity) || 0;
    const p = Number(it.unitPrice) || 0;
    const d = Number(it.discount) || 0;
    const ud = Number(it.unitDiscount) || 0;
    const g = Number(it.gst) || 0;
    return q * Math.max(0, p * (1 - d / 100) - ud) * (1 + g / 100);
  };
  const grandTotal = items.reduce((s, it) => s + lineTotal(it), 0);
  const names = items.map((it: any) => String(it.partName || it.productName || '').trim()).filter(Boolean);
  const fileEntries = (fps: any[]) => (fps || []).map((fp: any, i: number) => typeof fp === 'string'
    ? { name: fp.split('/').pop() || fp, path: fp, key: `${fp}-${i}` }
    : { name: fp.name || String(fp.path || fp.url || '').split('/').pop(), path: fp.path || fp.url, key: `${fp.path || fp.url}-${i}` })
    .filter((f: any) => f.path);

  const save = async () => {
    const entered = items.filter((it: any) => String(it.partName || it.productName || '').trim());
    if (!entered.length) { setError('Enter at least one product.'); return; }
    if (entered.some((it: any) => (it.files || []).length) && !companyId) {
      setError('Select a company before uploading product files.'); return;
    }
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const saved = await Promise.all(entered.map(async (it: any) => {
        const uploaded = companyId
          ? await Promise.all((it.files || []).map((f: File) => uploadEnquiryProductFile(companyId, f)))
          : [];
        const { files, ...rest } = it;
        return { ...rest, filePaths: [...(it.filePaths || []).filter((p: any) => typeof p === 'string'), ...uploaded] };
      }));
      const firstItem = saved[0];
      const itemNamesList = saved.map((i: any) => String(i.partName || i.productName || '').trim()).filter(Boolean).join(', ');
      const totalQty = saved.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 0), 0);
      const { error: updErr } = await supabase.from('cnc_quotations').update({
        part_name: saved.length > 1 ? `${itemNamesList} (${saved.length} Products)` : (firstItem.partName || 'TBD'),
        part_number: firstItem.partNumber || '',
        description: JSON.stringify(saved),
        unit_price: Number(firstItem.unitPrice) || 0,
        unit_discount: Number(firstItem.unitDiscount) || 0,
        quantity: totalQty,
        total_value: grandTotal,
        date: quoteDate || null,
        discount_percent: Number(firstItem.discount) || 0,
        gst_percent: Number(firstItem.gst) || 18,
        payment_terms: paymentTerms,
        delivery_terms: deliveryTerms,
        remarks,
      }).eq('id', raw.id);
      if (updErr) {
        const msg = String((updErr as any)?.message || '');
        if (msg.includes('unit_discount') || (updErr as any)?.code === '42703') {
          const retry = await supabase.from('cnc_quotations').update({
            part_name: saved.length > 1 ? `${itemNamesList} (${saved.length} Products)` : (firstItem.partName || 'TBD'),
            part_number: firstItem.partNumber || '',
            description: JSON.stringify(saved),
            unit_price: Number(firstItem.unitPrice) || 0,
            quantity: totalQty,
            total_value: grandTotal,
            date: quoteDate || null,
            discount_percent: Number(firstItem.discount) || 0,
            gst_percent: Number(firstItem.gst) || 18,
            payment_terms: paymentTerms,
            delivery_terms: deliveryTerms,
            remarks,
          }).eq('id', raw.id);
          if (retry.error) throw retry.error;
        } else throw updErr;
      }
      onSaved();
    } catch (e: any) {
      setError('Unable to save changes: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset disabled={readOnly} className="mb-6 min-w-0 border-0 p-0 m-0 [&_input:disabled]:bg-slate-50 [&_input:disabled]:text-slate-700 [&_input:disabled]:cursor-default [&_select:disabled]:bg-slate-50 [&_select:disabled]:text-slate-700 [&_textarea:disabled]:bg-slate-50 [&_textarea:disabled]:text-slate-700">
      <div className="grid grid-cols-3 gap-4 pb-4 border-b border-slate-100">
        <FormField label="Quotation Date" required>
          <input type="date" className={inputClass} value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
        </FormField>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <h4 className="font-semibold text-sm text-slate-800 mb-3">Products Breakdown</h4>
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-500 uppercase w-[4%]">#</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-500 uppercase w-[22%]">Product Name</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-500 uppercase w-[10%]">Qty</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-500 uppercase w-[13%]">Unit Price (₹)</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-500 uppercase w-[9%]">Disc %</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-500 uppercase w-[12%]">Unit Disc (₹)</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-500 uppercase w-[8%]">GST %</th>
                <th className="text-right px-3 py-2 text-[10px] font-bold text-slate-500 uppercase w-[14%]">Total (₹)</th>
                <th className="text-center px-3 py-2 text-[10px] font-bold text-slate-500 uppercase">File</th>
                <th className="text-center px-3 py-2 text-[10px] font-bold text-slate-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any, idx: number) => (
                <tr key={item.id || idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="px-3 py-2 text-slate-400 font-medium">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <input className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-brand-500" placeholder="Product name" list="quotation-edit-product-list" value={item.partName || ''} onChange={(e) => upd(idx, { partName: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} className="w-full min-w-[72px] tabular-nums text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-brand-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-inner-spin-button]:m-0" placeholder="0" value={item.quantity ?? ''} onChange={(e) => upd(idx, { quantity: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-brand-500" placeholder="0.00" value={item.unitPrice ?? ''} onChange={(e) => upd(idx, { unitPrice: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-brand-500" placeholder="0" value={item.discount ?? ''} onChange={(e) => upd(idx, { discount: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-brand-500" placeholder="0.00" value={item.unitDiscount ?? ''} onChange={(e) => upd(idx, { unitDiscount: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-brand-500" placeholder="18" value={item.gst ?? ''} onChange={(e) => upd(idx, { gst: e.target.value })} />
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-700 tabular-nums">₹{lineTotal(item).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-center">
                    <label className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700">
                      <UploadCloud size={13} />{((item.files || []).length + fileEntries(item.filePaths).length) ? `${(item.files || []).length + fileEntries(item.filePaths).length} file(s)` : 'Upload'}
                      <input type="file" multiple accept="*/*" className="hidden" onChange={(e) => {
                        const selected = Array.from(e.currentTarget.files || []);
                        upd(idx, { files: [...(item.files || []), ...selected] });
                        e.currentTarget.value = '';
                      }} />
                    </label>
                    {((item.files || []).length > 0 || fileEntries(item.filePaths).length > 0) && (
                      <div className="mt-1 space-y-1 text-left">
                        {(item.files || []).map((f: File, fi: number) => (
                          <div key={`quote-f-${f.name}-${fi}`} className="flex items-center justify-between gap-1 text-[10px] text-slate-600 bg-slate-50 rounded px-1 py-0.5 border border-slate-200">
                            <span className="truncate max-w-[110px] font-medium">{f.name}</span>
                            <button
                              type="button"
                              className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-xs font-bold leading-none"
                              title={`Remove ${f.name}`}
                              onClick={() => upd(idx, { files: (item.files || []).filter((_: any, j: number) => j !== fi) })}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {fileEntries(item.filePaths).map((f: any) => (
                          <div key={f.key} className="flex items-center justify-between gap-1 text-[10px] text-slate-600 bg-slate-50 rounded px-1 py-0.5 border border-slate-200">
                            <button type="button" className="truncate text-blue-700 hover:underline max-w-[110px]" onClick={() => openFile(f.path)}>{f.name}</button>
                            <button
                              type="button"
                              className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-xs font-bold leading-none"
                              title={`Remove ${f.name}`}
                              onClick={() => upd(idx, { filePaths: (item.filePaths || []).filter((p: any) => (typeof p === 'string' ? p : p.path || p.url) !== f.path) })}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => setItems(items.filter((_: any, i: number) => i !== idx))} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded" title="Remove product">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td colSpan={7} className="px-3 py-2 text-right font-bold text-sm text-slate-600 uppercase">Grand Total</td>
                <td className="px-3 py-2 text-right font-bold text-base text-brand-700 tabular-nums">₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <datalist id="quotation-edit-product-list">{productNames.map((n) => <option key={n} value={n} />)}</datalist>
        {!readOnly && <button onClick={() => setItems([...items, { id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `q-${Date.now()}`, partName: '', partNumber: '', quantity: '', unitPrice: '', discount: '0', unitDiscount: '0', gst: '18', filePaths: [], files: [] }])} className="mt-2 text-sm text-brand-600 font-semibold hover:text-brand-700 flex items-center gap-1">
          <span className="text-lg">+</span> Add Another Product
        </button>}
      </div>
      <h4 className="font-semibold text-sm text-slate-800 border-t border-slate-100 pt-4 mt-4">Additional Details</h4>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Payment Terms"><input className={inputClass} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></FormField>
        <FormField label="Delivery Terms"><input className={inputClass} value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} /></FormField>
        <div className="col-span-2"><FormField label="Notes / Remarks"><textarea className={inputClass} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></FormField></div>
      </div>
      {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
      {!readOnly && (
        <div className="flex justify-end mt-4">
          <Button disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        </div>
      )}
    </fieldset>
  );
}

/** Tolerant delivery update: drops keys the cloud schema predates. */
async function updateDeliveryTolerant(id: string, patch: Record<string, any>): Promise<string[]> {
  const remaining = { ...patch };
  const dropped: string[] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    const { error } = await supabase.from('cnc_deliveries').update(remaining).eq('id', id);
    if (!error) return dropped;
    const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(String((error as any)?.message || ''));
    if (m && Object.prototype.hasOwnProperty.call(remaining, m[1])) {
      delete remaining[m[1]];
      dropped.push(m[1]);
      continue;
    }
    throw error;
  }
  throw new Error('Delivery update failed after retries.');
}

/** Delivery Challan view/edit box mirroring the DC entry form: header rows,
 *  one line per product, signature row. Header edits apply to every row of
 *  the challan; the footer Done Editing button saves via saveRef. */
function DcSection({ rows, qtyTracking, editMode: editing, saveRef, customers, companies, onSaved }: {
  rows: any[]; qtyTracking?: any; editMode: boolean;
  saveRef?: { current: (() => Promise<boolean>) | null };
  customers: any[]; companies: any[];
  onSaved: () => void;
}) {
  const first = rows[0] || {};
  const [date, setDate] = useState(String(first.delivery_date || '').slice(0, 10));
  const [partyName, setPartyName] = useState(String(first.customer_name || ''));
  const [partyAddress, setPartyAddress] = useState(String(first.billing_address || ''));
  const [partyGstin, setPartyGstin] = useState(String(first.customer_gstin || ''));
  const [partyCode, setPartyCode] = useState(String(first.customer_code || ''));
  const [ewayBill, setEwayBill] = useState(String(first.eway_bill || ''));
  const [poNumber, setPoNumber] = useState(String(first.po_no || first.sales_order_no || ''));
  const [placeOfSupply, setPlaceOfSupply] = useState(String(first.place_of_supply || ''));
  const [packaging, setPackaging] = useState(String(first.packaging_details || ''));
  const [enquiryNo, setEnquiryNo] = useState(String(first.enquiry_no || ''));
  const [vehicleNo, setVehicleNo] = useState(String(first.vehicle_no || ''));
  const [phone, setPhone] = useState(String(first.phone || ''));
  const [category, setCategory] = useState(String(first.category || ''));
  const [process, setProcess] = useState(String(first.process || ''));
  const [receiverName, setReceiverName] = useState(String(first.receiver_name || ''));
  const [senderName, setSenderName] = useState(String(first.sender_name || ''));
  const [custSignature, setCustSignature] = useState<string | null>(first.customer_signature || null);
  const [authSignature, setAuthSignature] = useState<string | null>(first.authorized_signature || null);
  const [lines, setLines] = useState<any[]>(rows.map((r: any) => ({
    id: r.id, partName: r.part_name || '', hsn: r.hsn || '',
    qty: String(r.dispatch_qty ?? r.quantity ?? ''),
    unit: r.unit || 'Nos', price: String(r.unit_price ?? r.price ?? ''),
  })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Single source of truth: header + lines live in local state for BOTH view
  // and edit modes. The `rows` prop only re-seeds this state when fresh DB
  // data arrives (post-save refresh) while NOT editing, so clicking Done
  // Editing never flashes stale DB values.
  const buildDcLines = (rs: any[]) => (rs || []).map((r: any) => ({
    id: r.id, partName: r.part_name || '', hsn: r.hsn || '',
    qty: String(r.dispatch_qty ?? r.quantity ?? ''),
    unit: r.unit || 'Nos', price: String(r.unit_price ?? r.price ?? ''),
  }));
  const rowsFingerprint = (rows || []).map((r: any) => [
    r.id, r.delivery_date, r.customer_name, r.billing_address, r.customer_gstin,
    r.customer_code, r.eway_bill, r.po_no, r.sales_order_no, r.place_of_supply,
    r.packaging_details, r.enquiry_no, r.vehicle_no, r.phone, r.category, r.process,
    r.receiver_name, r.sender_name, r.customer_signature, r.authorized_signature,
    r.part_name, r.hsn, r.dispatch_qty ?? r.quantity, r.unit, r.unit_price ?? r.price,
  ].join('~')).join('|');
  const syncGuard = useRef(true);
  useEffect(() => {
    if (syncGuard.current) { syncGuard.current = false; return; }
    if (editing) return;
    const f = (rows || [])[0] || {};
    setDate(String(f.delivery_date || '').slice(0, 10));
    setPartyName(String(f.customer_name || ''));
    setPartyAddress(String(f.billing_address || ''));
    setPartyGstin(String(f.customer_gstin || ''));
    setPartyCode(String(f.customer_code || ''));
    setEwayBill(String(f.eway_bill || ''));
    setPoNumber(String(f.po_no || f.sales_order_no || ''));
    setPlaceOfSupply(String(f.place_of_supply || ''));
    setPackaging(String(f.packaging_details || ''));
    setEnquiryNo(String(f.enquiry_no || ''));
    setVehicleNo(String(f.vehicle_no || ''));
    setPhone(String(f.phone || ''));
    setCategory(String(f.category || ''));
    setProcess(String(f.process || ''));
    setReceiverName(String(f.receiver_name || ''));
    setSenderName(String(f.sender_name || ''));
    setCustSignature(f.customer_signature || null);
    setAuthSignature(f.authorized_signature || null);
    setLines(buildDcLines(rows || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsFingerprint]);

  // Add, Edit and View share one layout: the entry form is always drawn, and View just locks it.
  const editMode = true;
  const norm = (s: any) => String(s ?? '').trim().toLowerCase();
  const trackFor = (name: string) => (Array.isArray(qtyTracking?.products) ? qtyTracking.products : []).find((p: any) => norm(p.name) === norm(name));

  const save = async (): Promise<boolean> => {
    if (!String(date || '').trim()) { setError('Enter the date.'); return false; }
    if (!String(partyName || '').trim()) { setError('Enter the company name.'); return false; }
    const entered = lines.filter((l: any) => String(l.partName || '').trim());
    if (!entered.length) { setError('Add at least one product with a part name.'); return false; }
    for (const l of entered) {
      const qn = Number(l.qty) || 0;
      if (!(qn > 0)) { setError(`Enter a dispatch quantity greater than 0 for ${l.partName}.`); return false; }
      if (!String(l.unit || '').trim()) { setError(`Enter the unit for ${l.partName}.`); return false; }
      const t = trackFor(l.partName);
      const row = rows.find((r: any) => r.id === l.id);
      const already = Number(row?.dispatch_qty ?? row?.quantity) || 0;
      const cap = t ? (Number(t.available) || 0) + already : null;
      if (cap != null && qn > cap) { setError(`${l.partName}: quantity exceeds the available ${cap} pcs.`); return false; }
    }
    if (saving) return false;
    setSaving(true);
    setError('');
    try {
      const header: any = {
        delivery_date: date || null, customer_name: partyName.trim(),
        billing_address: partyAddress, customer_gstin: partyGstin, customer_code: partyCode,
        eway_bill: ewayBill, po_no: poNumber, place_of_supply: placeOfSupply, packaging_details: packaging,
        enquiry_no: enquiryNo, vehicle_no: vehicleNo, phone, category, process,
        receiver_name: receiverName, sender_name: senderName,
        customer_signature: custSignature, authorized_signature: authSignature,
      };
      const dropped = new Set<string>();
      for (const l of entered) {
        const qn = Number(l.qty) || 0;
        const pr = Number(l.price) || 0;
        (await updateDeliveryTolerant(l.id, {
          ...header,
          part_name: l.partName.trim(), quantity: qn, dispatch_qty: qn,
          hsn: l.hsn || '', unit: l.unit || 'Nos', unit_price: pr, total_amount: qn * pr,
        })).forEach((k) => dropped.add(k));
      }
      if (dropped.size) {
        alert(`Saved, but these fields have no database column yet and were not stored: ${[...dropped].join(', ')}. Apply the latest Supabase migration (deliveries_challan_fields).`);
      }
      // Refresh the linked sales order totals from live delivery rows.
      const soNo = String(first.sales_order_no || '');
      if (soNo) {
        try {
          const soR = await supabase.from('cnc_sales_orders').select('id,quantity').eq('order_no', soNo).maybeSingle();
          if (!soR.error && soR.data) {
            const dR = await supabase.from('cnc_deliveries').select('dispatch_qty,quantity,status').eq('sales_order_no', soNo);
            const act = ((dR.error ? [] : dR.data) ?? []).filter((d: any) => !['Cancelled', 'Returned', 'Return'].includes(String(d?.status ?? '')));
            const delivered = act.reduce((s: number, d: any) => s + (Number(d?.dispatch_qty ?? d?.quantity) || 0), 0);
            const qty0 = Number((soR.data as any).quantity) || 0;
            await supabase.from('cnc_sales_orders').update({
              delivered, status: delivered >= qty0 && qty0 > 0 ? 'Delivered' : delivered > 0 ? 'Partially Delivered' : 'Confirmed',
            }).eq('id', (soR.data as any).id);
          }
        } catch (e) { console.error('SO delivery refresh failed:', e); }
      }
      onSaved();
      return true;
    } catch (e: any) {
      setError('Unable to save changes: ' + (e?.message ?? e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // The footer Done Editing button triggers this save; no separate button here.
  useEffect(() => {
    if (saveRef) saveRef.current = save;
    return () => { if (saveRef && saveRef.current === save) saveRef.current = null; };
  });

  const onSelectParty = (c: any) => {
    const nm = String(c.company || c.name || '');
    const m: any = (customers || []).find((x: any) => String(x.name || '').trim().toLowerCase() === nm.trim().toLowerCase()) || {};
    setPartyName(nm);
    setPartyCode(m.id || '');
    setPartyAddress(m.city || c.city || '');
    setPartyGstin(m.gst || m.gstin || c.gst || '');
    setPhone(m.phone || c.phone || '');
  };

  const textCell = (label: string, v: any) => (
    <div key={label}>
      <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">{label}</span>
      <span className="text-sm text-slate-800 font-medium break-words">{v === null || v === undefined || v === '' ? '—' : String(v)}</span>
    </div>
  );

  const inputCls = 'w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-brand-500';

  return (
    <fieldset disabled={!editing} className="mb-6 min-w-0 border-0 p-0 m-0 [&_input:disabled]:bg-slate-50 [&_input:disabled]:text-slate-700 [&_input:disabled]:cursor-default [&_select:disabled]:bg-slate-50 [&_select:disabled]:text-slate-700 [&_.sig-pad]:pointer-events-none">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div>
          <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">DC No</span>
          <span className="text-sm text-slate-800 font-mono font-bold break-words">{first.delivery_no || '—'}</span>
        </div>
        <div>
          <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Date</span>
          {editMode ? (
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          ) : (
            <span className="text-sm text-slate-800 font-medium break-words">{date || '—'}</span>
          )}
        </div>
        <div className="col-span-2 md:col-span-1">
          {editMode ? (
            <CustomerAutocomplete
              label="Company Name"
              required
              value={partyName}
              onChange={(val) => setPartyName(val)}
              onSelectCustomer={onSelectParty}
              companies={companies}
              inputClass={inputClass}
              placeholder="Type or select company..."
            />
          ) : (
            textCell('Company Name', partyName)
          )}
        </div>
        {editMode ? (
          <>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Company Address</span><input className={inputCls} value={partyAddress} onChange={(e) => setPartyAddress(e.target.value)} /></div>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Company GSTIN</span><input className={inputCls} value={partyGstin} onChange={(e) => setPartyGstin(e.target.value)} /></div>
          </>
        ) : (
          <>
            {textCell('Company Address', partyAddress)}
            {textCell('Company GSTIN', partyGstin)}
          </>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
        {editMode ? (
          <>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Company Code</span><input className={inputCls} value={partyCode} onChange={(e) => setPartyCode(e.target.value)} /></div>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">E-Way Bill No</span><input className={inputCls} value={ewayBill} onChange={(e) => setEwayBill(e.target.value)} /></div>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">PO Number</span><input className={inputCls} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></div>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Place of Supply</span><input className={inputCls} value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} /></div>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Packaging Details</span><input className={inputCls} value={packaging} onChange={(e) => setPackaging(e.target.value)} /></div>
          </>
        ) : (
          <>
            {textCell('Company Code', partyCode)}
            {textCell('E-Way Bill No', ewayBill)}
            {textCell('PO Number', poNumber)}
            {textCell('Place of Supply', placeOfSupply)}
            {textCell('Packaging Details', packaging)}
          </>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
        {editMode ? (
          <>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Enquiry No</span><input className={inputCls} value={enquiryNo} onChange={(e) => setEnquiryNo(e.target.value)} /></div>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Vehicle No</span><input className={inputCls} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} /></div>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Phone No</span><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Category</span><input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} /></div>
            <div><span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Process</span><input className={inputCls} value={process} onChange={(e) => setProcess(e.target.value)} /></div>
          </>
        ) : (
          <>
            {textCell('Enquiry No', enquiryNo)}
            {textCell('Vehicle No', vehicleNo)}
            {textCell('Phone No', phone)}
            {textCell('Category', category)}
            {textCell('Process', process)}
          </>
        )}
      </div>
      <div className="mt-4">
        <div className="grid grid-cols-[minmax(0,1.5fr)_5rem_4.5rem_4rem_5.5rem_6rem] gap-2 items-center mb-1 px-1">
          {['Part Name', 'HSN', 'Qty', 'Unit', 'Price', 'Amount'].map(h => (
            <span key={h} className="text-[10px] font-bold text-slate-500 uppercase">{h}</span>
          ))}
        </div>
        {lines.map((it: any, idx: number) => {
          const amt = (Number(it.qty) || 0) * (Number(it.price) || 0);
          return (
            <div key={it.id || idx} className="grid grid-cols-[minmax(0,1.5fr)_5rem_4.5rem_4rem_5.5rem_6rem] gap-2 items-center bg-white rounded-lg border border-slate-200 p-2 mb-2">
              <div>
                {editMode ? (
                  <input className={inputCls} placeholder="Part name" list="saved-products" value={it.partName || ''} onChange={(e) => setLines((list) => list.map((r, i) => (i === idx ? { ...r, partName: e.target.value } : r)))} />
                ) : (
                  <span className="text-sm text-slate-800 font-medium break-words">{it.partName || '—'}</span>
                )}
              </div>
              <div>
                {editMode ? (
                  <input className={inputCls} placeholder="Select HSN" list={HSN_LIST_ID} value={it.hsn || ''} onChange={(e) => setLines((list) => list.map((r, i) => (i === idx ? { ...r, hsn: e.target.value } : r)))} />
                ) : (
                  <span className="text-sm text-slate-800 font-medium break-words">{it.hsn || '—'}</span>
                )}
              </div>
              <div>
                {editMode ? (
                  <input type="number" min={0} className={`${inputCls} tabular-nums`} value={it.qty ?? ''} placeholder="0" onChange={(e) => setLines((list) => list.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r)))} />
                ) : (
                  <span className="text-sm text-slate-800 font-medium tabular-nums">{it.qty === '' || it.qty == null ? '—' : it.qty}</span>
                )}
              </div>
              <div>
                {editMode ? (
                  <input className={inputCls} placeholder="Nos" value={it.unit || ''} onChange={(e) => setLines((list) => list.map((r, i) => (i === idx ? { ...r, unit: e.target.value } : r)))} />
                ) : (
                  <span className="text-sm text-slate-800 font-medium break-words">{it.unit || '—'}</span>
                )}
              </div>
              <div>
                {editMode ? (
                  <input type="number" min={0} className={inputCls} placeholder="0.00" value={it.price ?? ''} onChange={(e) => setLines((list) => list.map((r, i) => (i === idx ? { ...r, price: e.target.value } : r)))} />
                ) : (
                  <span className="text-sm text-slate-800 font-medium tabular-nums">{it.price === '' || it.price == null ? '—' : `Rs. ${Number(it.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}</span>
                )}
              </div>
              <div>
                <span className="text-sm text-slate-800 font-bold tabular-nums">{amt ? `Rs. ${amt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        <div>
          <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Receiver Name</span>
          {editMode ? (
            <input className={inputCls} value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
          ) : (
            <span className="text-sm text-slate-800 font-medium break-words">{receiverName || '—'}</span>
          )}
        </div>
        <div>
          <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Customer Signature</span>
          {editMode ? (
            <SignaturePad readOnly={!editing} value={custSignature} onChange={(v) => setCustSignature(v)} />
          ) : custSignature ? (
            <img src={custSignature} alt="Customer signature" className="h-12 w-auto rounded border border-slate-200 bg-white" />
          ) : (
            <span className="text-sm text-slate-400">—</span>
          )}
        </div>
        <div>
          <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Sender Name</span>
          {editMode ? (
            <input className={inputCls} value={senderName} onChange={(e) => setSenderName(e.target.value)} />
          ) : (
            <span className="text-sm text-slate-800 font-medium break-words">{senderName || '—'}</span>
          )}
        </div>
        <div>
          <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Authorized Signature</span>
          {editMode ? (
            <SignaturePad readOnly={!editing} value={authSignature} onChange={(v) => setAuthSignature(v)} />
          ) : authSignature ? (
            <img src={authSignature} alt="Authorized signature" className="h-12 w-auto rounded border border-slate-200 bg-white" />
          ) : (
            <span className="text-sm text-slate-400">—</span>
          )}
        </div>
      </div>
      {editing && error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>
      )}
    </fieldset>
  );
}

export function SalesPipelinePage() {
  const { profile, company, canView, canDo, permissions } = useAuth();
  const userName = profile?.full_name || '';
  const [activeView, setActiveView] = useState<'pipeline' | 'enquiry_list' | 'quotation_list' | 'sales_order_list' | 'inward_list' | 'rejected_list' | 'fg_list' | 'dc_list' | 'invoice_list'>('pipeline');
  const columns: Stage[] = ['Enquiry', 'Quotation', 'Sales Order', 'Inward', 'Finished Goods', 'DC', 'Invoice'];
  const [cards, setCards] = useState<KanbanCard[]>([]);
  // ERP-wide date filter: board, list/calendar views and KPI counts show only cards
  // whose record date falls in range. Pickers and quantity math keep using `cards`.
  const { inRange: inGlobalDateRange } = useGlobalDateFilter();
  const cardRecordDate = (c: KanbanCard): string | null =>
    recordDateOf({ date: c.date, ...(c.raw ?? {}) } as Record<string, unknown>,
      ['date', 'invoice_date', 'delivery_date', 'inward_date', 'order_date', 'date', 'received_date', 'created_at']);
  const boardCards = useMemo(
    () => cards.filter((c) => inGlobalDateRange(cardRecordDate(c))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, inGlobalDateRange],
  );
  const [draggedCard, setDraggedCard] = useState<KanbanCard | null>(null);
  // Single tap selects (multi-select), double tap opens the edit page.
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const clickTimer = useRef<any>(null);
  const toggleCardSelect = (id: string) => {
    setSelectedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const handleCardClick = (card: KanbanCard) => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      setViewEditMode(true);
      void openViewModal(card);
    } else {
      const id = card.id;
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        toggleCardSelect(id);
      }, 260);
    }
  };

  // ---- Checkbox stage progression: bulk "Move to Next Stage" --------------------
  // Ticking cards (and the single-click-to-select behaviour above) already existed.
  // What is added here is the toolbar action that advances the ticked cards, and it
  // deliberately reuses moveCardToStage - the very same transition, validation,
  // permissions, forms and backend writes that drag & drop uses.
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  /** Forward steps that open a form or a costing gate rather than writing straight
   *  away. Those can only take one card at a time - the user has to confirm in the
   *  form before the next card can be sent to the same form. */
  const moveOpensForm = (card: KanbanCard) =>
    card.type === 'lead' || card.type === 'order' || card.type === 'inward'
    || card.type === 'finished_goods' || card.type === 'dc';

  const selectedCardObjects = cards.filter(c => selectedCards.has(c.id));
  const selectedNextStages = Array.from(new Set(
    selectedCardObjects.map(c => NEXT_STAGE[c.stage]).filter((s): s is Stage => Boolean(s)),
  ));
  const bulkTarget = selectedNextStages.length === 1 ? selectedNextStages[0] : null;
  const bulkValid = selectedCardObjects.length > 0 && bulkTarget !== null;
  const bulkBlockReason =
    selectedCardObjects.length === 0 ? null
    : selectedNextStages.length === 0
      ? 'The selected cards are already at the end of the pipeline - there is no next stage.'
      : selectedNextStages.length > 1
        ? 'These cards sit in different stages, so they cannot move together. Advance them one stage at a time.'
        : null;

  const clearCardSelection = () => { setSelectedCards(new Set()); setBulkNotice(null); };

  // Invoice handoff (no pricing): when every ticked card is a Delivery Challan
  // bound for Invoice and the user cannot see the Invoice module, the toolbar
  // offers "Send to Invoice" instead of opening the pricing modal. Handoff only
  // flips DC rows to the "Ready for Invoice" queue state — no invoice, no prices.
  const showInvoiceHandoff = bulkTarget === 'Invoice'
    && selectedCardObjects.length > 0
    && selectedCardObjects.every((c) => c.stage === 'DC' && c.type === 'dc')
    && !canView(STAGE_MODULE['Invoice'] ?? 'invoices');

  const bulkMoveToNextStage = async () => {
    if (!bulkValid || bulkTarget === null || bulkMoving) return;
    const target = bulkTarget;
    const picked = selectedCardObjects;
    // Only one card at a time when the step opens a form / costing gate.
    const batch = picked.some(moveOpensForm) ? picked.slice(0, 1) : picked;
    const word = batch.length === 1 ? 'card' : 'cards';

    setBulkMoving(true);
    setBulkNotice(null);
    const failed: string[] = [];
    const doneIds: string[] = [];
    for (const card of batch) {
      const ok = await moveCardToStage(card, target);
      if (ok) doneIds.push(card.id);
      else failed.push(card.refNo || String(card.id));
    }
    // Success takes those cards out of the selection. A failure deliberately leaves the
    // selection exactly as it was so the user can retry it.
    setSelectedCards(prev => { const next = new Set(prev); doneIds.forEach(id => next.delete(id)); return next; });

    const left = picked.length - doneIds.length;
    // A form-gated step (Enquiry -> Quotation, Sales Order -> Inward, Inward -> FG,
    // FG -> DC, DC -> Invoice) hands the card to a form; it has not actually advanced
    // until the user saves there, so it gets its own wording rather than "moved".
    const openedForm = failed.length === 0 && batch.length === 1 && moveOpensForm(batch[0]);
    setBulkNotice(failed.length
      ? { kind: 'error', text: `${failed.length} of ${batch.length} could not move (${failed.join(', ')}). The rest of the selection was kept.` }
      : openedForm
        ? { kind: 'ok', text: `${batch[0].refNo || 'The card'} was sent to ${target}. Complete the form that opened - it only moves once you save it.${left > 1 ? ` ${left - 1} more stay ticked for the next round.` : ''}` }
        : left > 0
          ? { kind: 'ok', text: `Moved ${doneIds.length} to ${target}. ${left} still selected - press Move to Next Stage again to continue.` }
          : { kind: 'ok', text: `${batch.length} ${word} advanced to ${target}.` });
    await fetchPipeline();
    setBulkMoving(false);
  };

  // Queue the ticked Delivery Challans Ready for Invoice. Operational data only:
  // no pricing is read or written, so Delivery Challan edit access is the only
  // requirement (checked here and enforced by the deliveries row policy).
  // Idempotent — re-running only re-marks the same queue state and skips rows
  // that are already Billed / Cancelled / Ready; it never creates invoices.
  const sendDcToInvoiceQueue = async () => {
    const picked = selectedCardObjects.filter((c) => c.stage === 'DC' && c.type === 'dc');
    if (picked.length === 0 || bulkMoving) return;
    if (!canDo(STAGE_MODULE['DC'] ?? 'delivery', 'edit')) {
      alert('Not authorized: sending to invoice needs Delivery Challan edit access.');
      return;
    }
    setBulkMoving(true);
    setBulkNotice(null);
    try {
      const skipped: string[] = [];
      const ids: string[] = [];
      for (const card of picked) {
        const raw: any = card.raw ?? {};
        const st = String(raw.status ?? '').trim();
        if (st === 'Billed' || st === 'Cancelled' || st === 'Ready for Invoice') {
          skipped.push(`${card.refNo || card.id} (${st || 'no status'})`);
          continue;
        }
        const groupIds: string[] = Array.isArray(raw._groupIds) && raw._groupIds.length
          ? raw._groupIds.map(String)
          : (raw.id ? [String(raw.id)] : []);
        if (groupIds.length === 0) {
          skipped.push(`${card.refNo || card.id} (no delivery rows)`);
          continue;
        }
        for (const id of groupIds) if (!ids.includes(id)) ids.push(id);
      }
      if (ids.length === 0) {
        setBulkNotice({ kind: 'error', text: skipped.length ? `Nothing eligible: ${skipped.join(', ')}.` : 'Nothing eligible to send.' });
        return;
      }
      const { error } = await supabase.from('cnc_deliveries').update({ status: 'Ready for Invoice' }).in('id', ids);
      if (error) throw error;
      const done = new Set(picked.filter((card) => {
        const raw: any = card.raw ?? {};
        const g: string[] = Array.isArray(raw._groupIds) && raw._groupIds.length
          ? raw._groupIds.map(String)
          : (raw.id ? [String(raw.id)] : []);
        return g.length > 0 && g.every((id) => ids.includes(id));
      }).map((c) => c.id));
      setSelectedCards((prev) => { const next = new Set(prev); done.forEach((id) => next.delete(id)); return next; });
      const n = done.size;
      setBulkNotice({ kind: 'ok', text: `${n} Delivery Challan${n === 1 ? '' : 's'} queued Ready for Invoice. An authorized Invoice user will complete billing.${skipped.length ? ` Skipped: ${skipped.join(', ')}.` : ''}` });
      await fetchPipeline();
    } catch (e: any) {
      setBulkNotice({ kind: 'error', text: `Send to Invoice failed: ${e?.message ?? e}. Nothing was queued.` });
    } finally {
      setBulkMoving(false);
    }
  };

  const [, setLoading] = useState(true);
  const [pipelineViewMode, setPipelineViewMode] = useState<'kanban' | 'list' | 'companies' | 'calendar'>('kanban');
  // Per-column kanban search: term typed in each column's own search box.
  const [columnSearch, setColumnSearch] = useState<Record<string, string>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [activeCommentTarget, setActiveCommentTarget] = useState<KanbanCard | null>(null);
  const [customerFilter, setCustomerFilter] = useState<string>('All Companies');
  // Quotation tools (calculator, libraries ...) open inside this page instead of going to the side menu.
  const [quoteTool, setQuoteTool] = useState<string | null>(null);
  useEffect(() => { if (activeView !== 'quotation_list') setQuoteTool(null); }, [activeView]);
  // A ticked selection only means something on the board itself, so it is dropped as
  // soon as another view (list, companies, calendar) or a module list is shown.
  useEffect(() => { if (pipelineViewMode !== 'kanban' || activeView !== 'pipeline') clearCardSelection(); }, [pipelineViewMode, activeView]);
  // Pieces rejected so far (the Rejected tile); kept as production batches, so nothing is added to the board.
  const [rejectedTotal, setRejectedTotal] = useState(0);

  // KPI strip lives in the Topbar (single header line); the page supplies the data.
  const { setKpis, companyFilter, setCompanyFilter, setCompanyOptions } = useHeaderKpis();

  useEffect(() => {
    if (companyFilter) setCustomerFilter(companyFilter);
  }, [companyFilter]);
  const stageColors: Record<string, { tile: string; icon: string }> = {
    Enquiry: { tile: 'bg-gradient-to-br from-blue-800 to-blue-950 border-blue-950 hover:brightness-110', icon: 'bg-white/20 text-white' },
    Quotation: { tile: 'bg-gradient-to-br from-violet-800 to-violet-950 border-violet-950 hover:brightness-110', icon: 'bg-white/20 text-white' },
    'Sales Order': { tile: 'bg-gradient-to-br from-emerald-800 to-emerald-950 border-emerald-950 hover:brightness-110', icon: 'bg-white/20 text-white' },
    Inward: { tile: 'bg-gradient-to-br from-amber-700 to-amber-900 border-amber-950 hover:brightness-110', icon: 'bg-white/20 text-white' },
    Rejected: { tile: 'bg-gradient-to-br from-fuchsia-800 to-fuchsia-950 border-fuchsia-950 hover:brightness-110', icon: 'bg-white/20 text-white' },
    'Finished Goods': { tile: 'bg-gradient-to-br from-teal-800 to-teal-950 border-teal-950 hover:brightness-110', icon: 'bg-white/20 text-white' },
    DC: { tile: 'bg-gradient-to-br from-rose-800 to-rose-950 border-rose-950 hover:brightness-110', icon: 'bg-white/20 text-white' },
    Invoice: { tile: 'bg-gradient-to-br from-indigo-800 to-indigo-950 border-indigo-950 hover:brightness-110', icon: 'bg-white/20 text-white' },
  };
  const stageClick: Record<string, () => void> = {
    Enquiry: () => setActiveView(cur => cur === 'enquiry_list' ? 'pipeline' : 'enquiry_list'),
    Quotation: () => setActiveView(cur => cur === 'quotation_list' ? 'pipeline' : 'quotation_list'),
    'Sales Order': () => setActiveView(cur => cur === 'sales_order_list' ? 'pipeline' : 'sales_order_list'),
    Inward: () => setActiveView(cur => cur === 'inward_list' ? 'pipeline' : 'inward_list'),
    Rejected: () => setActiveView(cur => cur === 'rejected_list' ? 'pipeline' : 'rejected_list'),
    'Finished Goods': () => setActiveView(cur => cur === 'fg_list' ? 'pipeline' : 'fg_list'),
    DC: () => setActiveView(cur => cur === 'dc_list' ? 'pipeline' : 'dc_list'),
    Invoice: () => setActiveView(cur => cur === 'invoice_list' ? 'pipeline' : 'invoice_list'),
  };
  const kpiStats = [
    { key: 'enquiry', title: 'Enquiries', iconPath: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', stage: 'Enquiry' },
    { key: 'quotation', title: 'Quotations', iconPath: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', stage: 'Quotation' },
    { key: 'sales-order', title: 'Sales Orders', iconPath: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', stage: 'Sales Order' },
    { key: 'inward', title: 'Inward', iconPath: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4', stage: 'Inward' },
    { key: 'finished-goods', title: 'Finished Goods', iconPath: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', stage: 'Finished Goods' },
    { key: 'rejected', title: 'Rejected', iconPath: 'M6 18L18 6M6 6l12 12', stage: 'Rejected' },
    { key: 'dc', title: 'Delivery Challans', iconPath: 'M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z', stage: 'DC' },
    { key: 'invoice', title: 'Invoices', iconPath: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', stage: 'Invoice' },
  ];
  useEffect(() => {
    // Rejected counts pieces rejected (it is not a stage of the board); the others count cards.
    const isStageActive = (stage: string) => {
      if (stage === 'Enquiry') return activeView === 'enquiry_list';
      if (stage === 'Quotation') return activeView === 'quotation_list';
      if (stage === 'Sales Order') return activeView === 'sales_order_list';
      if (stage === 'Inward') return activeView === 'inward_list';
      if (stage === 'Rejected') return activeView === 'rejected_list';
      if (stage === 'Finished Goods') return activeView === 'fg_list';
      if (stage === 'DC') return activeView === 'dc_list';
      if (stage === 'Invoice') return activeView === 'invoice_list';
      return false;
    };
    setKpis(kpiStats.filter(s => canView(STAGE_MODULE[s.stage] ?? s.stage)).map(s => {
      const theme = MODULE_THEMES[s.stage] ?? MODULE_THEMES.Enquiry;
      return {
        key: s.key,
        label: s.title,
        count: s.stage === 'Rejected' ? rejectedTotal : boardCards.filter(c => c.stage === s.stage).length,
        tile: theme.kpiTile,
        icon: theme.kpiIcon,
        iconPath: s.iconPath,
        active: isStageActive(s.stage),
        activeClass: theme.kpiActive,
        dotClass: theme.kpiDot,
        onClick: stageClick[s.stage],
      };
    }));
    return () => setKpis([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardCards, rejectedTotal, setKpis, activeView, permissions]);

  // The enquiry form is always visible at the top of the Enquiries list, so it has no
  // open/closed flag any more. savingEnquiry blocks duplicate submits while a save is in
  // flight; enquirySaveNotice is the inline confirmation shown after a successful save.
  const [savingEnquiry, setSavingEnquiry] = useState(false);
  const [enquirySaveNotice, setEnquirySaveNotice] = useState<string | null>(null);
  // Original enquiry number when the form was pre-filled via Duplicate.
  const [duplicateSource, setDuplicateSource] = useState<string | null>(null);
  const [quotationModalTarget, setQuotationModalTarget] = useState<KanbanCard | null>(null);
  
  // The Inward form is inline on the Inward list, so its "entry session" (source card, or
  // INWARD_ENTRY_TARGET for a manual entry) exists from the first render instead of being
  // created when a popup was opened. saveInward and the product picker read it.
  const [inwardModalTarget, setInwardModalTarget] = useState<KanbanCard | null>(INWARD_ENTRY_TARGET);
  const [fgModalTarget, setFgModalTarget] = useState<KanbanCard | null>(null);
  const [fgForm, setFgForm] = useState<any>({});
  // The Finished Goods + Costing flow. On the Finished Goods list it is the module's
  // always-visible entry form (add mode); everywhere else - the board's drag gate, and
  // edit / view - it stays a popup. Null means "nothing opened": the list page supplies
  // its own blank picker (fgBlankPick) instead of priming this state, so the board
  // does not pop the picker open on page load.
  const [costingModalTarget, setCostingModalTarget] = useState<KanbanCard | null>(null);
  // Built once so the inline form's React key is stable across renders; resetting the
  // form deliberately makes a fresh one (new id) to remount and clear what was typed.
  const [fgBlankPick] = useState<KanbanCard>(() => makeFgPickTarget());
  const [costingMode, setCostingMode] = useState<'add' | 'edit' | 'view'>('add');
  const [fgPickOpen, setFgPickOpen] = useState(false);
  // The stage lists (opened from the top tiles) refetch whenever the board reloads, so edits and deletes show at once.
  const [listRefresh, setListRefresh] = useState(0);
  // How many inwards were saved in this popup session with "Save & Add Another Inward".
  const [inwardSavedCount, setInwardSavedCount] = useState(0);
  // Double-submit guard: saveInward inserts one row per line, so a retried
  // click must never run twice (no idempotency key exists on cnc_inwards).
  const [savingInward, setSavingInward] = useState(false);
  useEffect(() => { if (!inwardModalTarget) setInwardSavedCount(0); }, [inwardModalTarget]);
  useEffect(() => {
    void (async () => {
      try {
        const { data, error } = await supabase.from('cnc_production_batches').select('rejected_qty, created_at').gt('rejected_qty', 0);
        setRejectedTotal(error ? 0 : (data ?? []).filter((r: any) => inGlobalDateRange(r.created_at)).reduce((n: number, r: any) => n + (Number(r.rejected_qty) || 0), 0));
      } catch { setRejectedTotal(0); }
    })();
  }, [listRefresh, inGlobalDateRange]);
  const [fgPickId, setFgPickId] = useState('');
  const [invoiceCostingTarget, setInvoiceCostingTarget] = useState<KanbanCard | null>(null);
  // The DC entry form is inline on the DC list, so its "session" (source card, or the
  // blank DC_ENTRY_TARGET for a manual entry) starts open instead of being created when
  // a popup was opened. It drives the masters / price lookups and the work-order cap.
  const [dcModalTarget, setDcModalTarget] = useState<KanbanCard | null>(DC_ENTRY_TARGET);
  const [dcSaving, setDcSaving] = useState(false);
  // Inline confirmation shown after a successful save (the form stays on screen).
  const [dcSaveNotice, setDcSaveNotice] = useState<string | null>(null);
  const [dcForm, setDcForm] = useState<any>(() => makeDcBlankForm());
  // Multi-product DC lines (drag path): one selectable row per order product
  // with its own dispatch qty; saved as one delivery row each under the same
  // DC number (which the invoice flow already reads as a multi-item challan).
  const [dcItems, setDcItems] = useState<{ name: string; avail: number | null; qty: string; selected: boolean; hsn: string; unit: string; price: string }[]>(() => makeDcBlankItems());
  const dcItemNames = (dcItems || []).map((i: any) => i.name).join('|');
  // Approved-price display for the DC form (same source as the DC→Invoice
  // gate: latest Approved costing sheet for the quotation). The DC line can
  // name several products ("p1, p2"), so prices resolve per product and show
  // as a breakdown. Saved challan flow is unchanged.
  const [dcPricing, setDcPricing] = useState<{ lines: { name: string; unit: number; sheetRef: string }[]; loading: boolean }>({ lines: [], loading: false });
  // Product + process masters for the DC form (autofill only; masters are never written here).
  const [partsMaster, setPartsMaster] = useState<any[]>([]);
  const [processList, setProcessList] = useState<any[]>([]);
  // Snapshot of the opened form so Clear restores the prefilled values. On first render the
  // inline form already holds the blank DC, so that blank state is the initial snapshot.
  const [dcSnapshot, setDcSnapshot] = useState<{ form: any; items: any[] } | null>({ form: { ...dcForm }, items: dcItems.map((l) => ({ ...l })) });
  // Product + process masters for the DC form (autofill only; masters are never written here).
  useEffect(() => {
    if (!dcModalTarget) return;
    let cancelled = false;
    (async () => {
      try {
        const pm = await supabase.from('cnc_parts').select('part_name,part_no,unit,category,hsn');
        let rows: any[] = (!pm.error && pm.data) ? pm.data : [];
        if (pm.error) {
          const fb = await supabase.from('cnc_parts').select('part_name,part_no,unit,category');
          rows = (!fb.error && fb.data) ? fb.data : [];
        }
        if (!cancelled) setPartsMaster(rows);
      } catch { if (!cancelled) setPartsMaster([]); }
      try {
        const pr = await supabase.from('cnc_processes').select('process_code,process_name,status').eq('status', 'Active').order('process_name');
        if (!cancelled) setProcessList(!pr.error ? (pr.data ?? []) : []);
      } catch { if (!cancelled) setProcessList([]); }
    })();
    return () => { cancelled = true; };
  }, [dcModalTarget]);

  // ── Inward purchase catalogue (product + supplier masters) ──────────────
  // cnc_parts is the ERP product master and cnc_raw_materials holds bought-out
  // materials (the Purchase module already buys from both combined). Neither
  // was wired into Inward before: its product list only contained enquiry /
  // sales-order line items keyed by enquiry, never by product ID.
  // Pricing gap (no schema change): there is no supplier price-list table and
  // no GST% on parts, so the price chain is preferred-supplier configured
  // price → last paid price for that supplier+product (cnc_inwards history)
  // → master unit_price → mandatory manual entry (never an assumed zero).
  const [partsCatalogue, setPartsCatalogue] = useState<any[]>([]);
  const [makeBuyByCode, setMakeBuyByCode] = useState<Map<string, string>>(new Map());
  const [supplierDirectory, setSupplierDirectory] = useState<any[]>([]);
  const [lastPaidPrice, setLastPaidPrice] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pm, rm, sup] = await Promise.all([
          supabase.from('cnc_parts').select('id,part_no,part_name,category,unit,unit_price,hsn,preferred_supplier_id,status'),
          supabase.from('cnc_raw_materials').select('id,material_code,name,uom,unit_price,preferred_supplier_id,status'),
          supabase.from('cnc_suppliers').select('id,name,status').eq('status', 'Active').order('name'),
        ]);
        // cnc_bom is optional (absent from some databases): without it every
        // active master row stays eligible for purchase.
        let bom: any[] = [];
        try {
          const b = await supabase.from('cnc_bom').select('part_no,make');
          if (!b.error) bom = b.data ?? [];
        } catch { /* no Make/Buy classification available */ }
        if (cancelled) return;
        const cat: any[] = [];
        ((pm.error ? [] : pm.data) ?? []).forEach((p: any) => cat.push({ key: `part:${p.id}`, kind: 'part', id: p.id, code: p.part_no || '', name: p.part_name || '', category: p.category || '', unit: p.unit || '', unitPrice: Number(p.unit_price ?? 0) || 0, supplierId: p.preferred_supplier_id || '', hsn: p.hsn || '', status: p.status || 'Active' }));
        ((rm.error ? [] : rm.data) ?? []).forEach((r: any) => cat.push({ key: `raw:${r.id}`, kind: 'raw', id: r.id, code: r.material_code || '', name: r.name || '', category: 'RAW MATERIAL', unit: r.uom || '', unitPrice: Number(r.unit_price ?? 0) || 0, supplierId: r.preferred_supplier_id || '', hsn: '', status: r.status || 'Active' }));
        const mb = new Map<string, string>();
        bom.forEach((b: any) => {
          const code = String(b.part_no || '').trim(); const mk = String(b.make || '').trim().toLowerCase();
          if (!code || !mk) return;
          const prev = mb.get(code);
          mb.set(code, prev && prev !== mk ? 'both' : mk);
        });
        setPartsCatalogue(cat);
        setMakeBuyByCode(mb);
        if (!sup.error) setSupplierDirectory(sup.data ?? []);
      } catch { if (!cancelled) { setPartsCatalogue([]); setSupplierDirectory([]); } }
      try {
        const h = await supabase.from('cnc_inwards').select('party_name,product_name,part_name,price').order('created_at', { ascending: false }).limit(1000);
        if (cancelled || h.error) return;
        const m = new Map<string, number>();
        (h.data ?? []).forEach((r: any) => {
          const s = normStr(r.party_name); const p = Number(r.price) || 0;
          if (!s || !p) return;
          [r.product_name, r.part_name].forEach((n: any) => { const k = `${s}||${normStr(n)}`; if (normStr(n) && !m.has(k)) m.set(k, p); });
        });
        if (!cancelled) setLastPaidPrice(m);
      } catch { /* price history is a nice-to-have */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Purchase-eligible catalogue: active master rows, excluding only records
  // unanimously classified as manufactured-never-bought (Make on every BOM
  // line that mentions them). Anything bought somewhere — or unclassified —
  // stays purchasable, so dual make/buy products are never hidden by name.
  const eligibleCatalogue = useMemo(() => partsCatalogue.filter((p: any) => {
    if (!p.name || String(p.status || 'Active').toLowerCase() !== 'active') return false;
    const marks = [p.code, p.name].map((c: any) => makeBuyByCode.get(String(c || '').trim())).filter(Boolean);
    if (marks.length && marks.every(m => m === 'make')) return false;
    return true;
  }), [partsCatalogue, makeBuyByCode]);

  const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
  // GST-exclusive ERP convention (same as quotations: CGST+SGST on top):
  // Total = Q × P − discount% + GST% on the taxable amount, rounded to 2dp.
  const inwardLineTotal = (q: any, p: any, d: any, g: any) => {
    const Q = Number(q) || 0, P = Number(p) || 0, D = Number(d) || 0, G = Number(g) || 0;
    return round2(Q * P * (1 - D / 100) * (1 + G / 100));
  };
  const PURCHASE_CATEGORIES = ['GOODS PURCHASE', 'SERVICE PURCHASE', 'EXPENSES'];

  /** Resolve a typed company name to a supplier master row or a known company. */
  const resolveSupplier = (name: any): { kind: 'supplier' | 'company' | 'unknown'; id: string; name: string } => {
    const n = normStr(name);
    if (!n) return { kind: 'unknown', id: '', name: '' };
    const s = (supplierDirectory || []).find((x: any) => normStr(x.name) === n);
    if (s) return { kind: 'supplier', id: s.id, name: s.name };
    const c = (allKnownCompanies || []).find((x: any) => normStr(x.company) === n);
    if (c) return { kind: 'company', id: '', name: c.company };
    return { kind: 'unknown', id: '', name: String(name || '').trim() };
  };

  /** Supplier-aware purchase price: configured supplier price → last paid → master → manual. */
  const resolvePurchasePrice = (entry: any, supplierName: any): { price: number | ''; source: string } => {
    const sup = resolveSupplier(supplierName);
    const masterPrice = Number(entry?.unitPrice) || 0;
    if (sup.kind === 'supplier' && entry?.supplierId && entry.supplierId === sup.id && masterPrice > 0)
      return { price: masterPrice, source: 'supplier' };
    const sKey = normStr(sup.name || supplierName);
    const hist = lastPaidPrice.get(`${sKey}||${normStr(entry?.name)}`) ?? lastPaidPrice.get(`${sKey}||${normStr(entry?.code)}`);
    if (hist && hist > 0) return { price: hist, source: 'history' };
    if (masterPrice > 0) return { price: masterPrice, source: 'catalogue' };
    return { price: '', source: 'manual' };
  };

  /** Duplicate identity of a line: master key wins, otherwise the product name. */
  const inwardLineIdentity = (item: any): string => {
    if (item?.productKey && String(item.productKey).startsWith('part:')) return `id:${item.productKey}`;
    if (item?.productKey && String(item.productKey).startsWith('raw:')) return `id:${item.productKey}`;
    return `nm:${normStr(item?.productName)}`;
  };

  /** Product choices for one inward group: sales-order products plus earlier inward products, each name once.
   *  The Company on an inward is the supplier it came from, so it never narrows the product list. */
  const inwardLegacyOptions = (_group: any) => {
    const base = (s: any) => String(s||'').replace(/-\d{2}[A-Za-z]{3}\d{2}-\d{4}(AM|PM)$/, '');
    const u = (inwardForm.projectName || '').trim();
    const seen = new Set<string>();
    // From a sales order onward a product is identified as "Company - Product - date time", so only products that
    // have a sales order (or were already inwarded) are offered, each shown that way.
    // Older inwards were saved with just the product name: bring the company and the date/time back from the
    // order (or enquiry) they belong to, so old and new entries read the same.
    const orders: any[] = salesOrdersList || [];
    const leads: any[] = rawLeadsList || [];
    const enrich = (o: any) => {
      if (!String(o.key || '').startsWith('inward:')) return o;
      const order = orders.find((s: any) => (o.soRef && s.order_no === o.soRef) || (o.leadNo && base(s.lead_no) === base(o.leadNo)));
      const lead = leads.find((l: any) => (o.enquiryId && String(l.id) === String(o.enquiryId)) || (o.leadNo && (base(l.lead_no) === base(o.leadNo) || base(l.enquiry_no) === base(o.leadNo))));
      return {
        ...o,
        name: attachDateTimeToProduct(o.name, order || (o.stampAt ? { created_at: o.stampAt, order_date: o.stampAt } : null)),
        customer: o.customer || order?.customer || order?.customer_name || lead?.customer || '',
        saleOrderRef: order?.order_no || o.soRef || '',
      };
    };
    const all = [...(inwardForm.productOptions || []), ...inwardProdOptions.map(enrich)];
    // The same product from a sales order and from an earlier inward is listed once (the sales order wins).
    const baseKey = (o: any) => `${getProductBaseName(String(o.name || '')).toLowerCase()}|${base(o.leadNo)}`;
    const soKeys = new Set(all.filter((o: any) => !String(o.key || '').startsWith('inward:')).map(baseKey));
    return all.filter((o: any) => {
      const k = String(o.name || '').trim().toLowerCase();
      if (!k || seen.has(k) || (u && base(o.leadNo) !== base(u))) return false;
      if (!(o.saleOrderRef || o.saleStamp || String(o.key || '').startsWith('inward:'))) return false;
      if (String(o.key || '').startsWith('inward:') && soKeys.has(baseKey(o))) return false;
      seen.add(k); return true;
    }).map((o: any) => ({ ...o, display: productWithCompany(o.name, o.customer, o.quantity) }));
  };
  // Approved-price lookup for the DC form (same source as the DC→Invoice
  // gate: latest Approved costing sheet for the quotation).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const soNo = String((dcModalTarget as any)?.raw?.sales_order || (dcForm as any).salesOrderNo || '').trim();
        if (!dcModalTarget || !soNo) {
          if (!cancelled) setDcPricing({ lines: [], loading: false });
          return;
        }
        if (!cancelled) setDcPricing((p) => ({ ...p, loading: true }));
        const soR = await supabase.from('cnc_sales_orders').select('id,order_no,part_no,quotation_id,quote_no').eq('order_no', soNo).maybeSingle();
        const soRow = !soR.error ? soR.data : null;
        let qRow: any = null;
        if (soRow?.quotation_id) {
          const r = await supabase.from('cnc_quotations').select('quote_no').eq('id', soRow.quotation_id).limit(1);
          if (!r.error) qRow = (r.data ?? [])[0] ?? null;
        }
        if (!qRow && soRow?.quote_no) {
          const r = await supabase.from('cnc_quotations').select('quote_no').eq('quote_no', soRow.quote_no).limit(1);
          if (!r.error) qRow = (r.data ?? [])[0] ?? null;
        }
        if (cancelled) return;
        if (!qRow?.quote_no) { setDcPricing({ lines: [], loading: false }); return; }
        const v = await supabase.from('cnc_costing_sheets')
          .select('approved_price,quantity,version,product_code,product_name')
          .eq('quotation_no', qRow.quote_no).eq('status', 'Approved').order('version', { ascending: false });
        if (cancelled) return;
        const sheets = !v.error ? (v.data ?? []) : [];
        const lc = (s: any) => String(s ?? '').trim().toLowerCase();
        const frags = dcItemNames.split('|').map((s) => s.trim()).filter(Boolean);
        const candidates = [...frags, String(soRow?.part_no ?? '').trim()].filter(Boolean);
        const seen = new Set<string>();
        const lines: { name: string; unit: number; sheetRef: string }[] = [];
        for (const nm of candidates) {
          const key = lc(nm);
          if (!nm || seen.has(key)) continue;
          seen.add(key);
          const pick = sheets.find((s: any) => String(s.product_code ?? '').trim() !== '' && (lc(s.product_code) === key || (soRow?.part_no && lc(s.product_code) === lc(soRow.part_no))))
            ?? sheets.find((s: any) => lc(s.product_name) === key);
          if (pick && Number(pick.quantity) > 0 && pick.approved_price != null) {
            lines.push({ name: nm, unit: Math.round((Number(pick.approved_price) / Number(pick.quantity)) * 100) / 100, sheetRef: `${qRow.quote_no} V${pick.version}` });
          }
        }
        if (!cancelled) setDcPricing({ lines, loading: false });
      } catch {
        if (!cancelled) setDcPricing({ lines: [], loading: false });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dcModalTarget, (dcForm as any).salesOrderNo, dcItemNames]);
  // Fill empty HSN / unit / price on DC lines from the masters above.
  useEffect(() => {
    if (!dcModalTarget) return;
    setDcItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        if (!it.name) return it;
        const key = String(it.name).trim().toLowerCase();
        const m = partsMaster.find((p: any) => String(p.part_name || '').trim().toLowerCase() === key);
        const l = dcPricing.lines.find((x) => x.name.trim().toLowerCase() === key);
        const patch: any = {};
        if (!it.hsn && (m as any)?.hsn) patch.hsn = (m as any).hsn;
        if (!it.unit && m?.unit) patch.unit = m.unit;
        if (!it.price && l) patch.price = String(l.unit);
        if (Object.keys(patch).length) { changed = true; return { ...it, ...patch }; }
        return it;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dcModalTarget, partsMaster, dcPricing.lines]);


  const [invoiceModalTarget, setInvoiceModalTarget] = useState<KanbanCard | null>(null);
  // Sales Order creation is an always-visible inline form on the Sales Orders list, so
  // it has no popup target. savingSo blocks duplicate submits; soSaveNotice is the
  // inline confirmation shown after a successful save.
  const [savingSo, setSavingSo] = useState(false);
  const [soSaveNotice, setSoSaveNotice] = useState<string | null>(null);
  const [soForm, setSoForm] = useState<any>({});

  const [invoiceForm, setInvoiceForm] = useState<any>({});
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [viewModalTarget, setViewModalTarget] = useState<KanbanCard | null>(null);
  const [viewModalData, setViewModalData] = useState<any>(null);
  const [viewEditMode, setViewEditMode] = useState(false);
  // Pending sales-order save, flushed by the footer "Done Editing" button.
  const soSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  // Pending enquiry save, flushed the same way.
  const enquirySaveRef = useRef<(() => Promise<boolean>) | null>(null);
  // Pending delivery-challan save, flushed the same way.
  const dcSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [mockImages, setMockImages] = useState<Record<string, string>>({});

  const handleInlineEdit = async (title: string, id: string, field: string | Record<string, any>, value?: string) => {
    const tableMap: any = {
      'Enquiry': 'cnc_enquiries',
      'Quotation': 'cnc_quotations',
      'Sales Order': 'cnc_sales_orders',
      'Inward': 'cnc_inwards',
      'Finished Goods': 'cnc_work_orders',
      'DC': 'cnc_deliveries',
      'Invoice': 'cnc_invoices'
    };
    const table = tableMap[title];
    if (!table) return;

    const patch: Record<string, any> = typeof field === 'object' ? field : { [field]: value };

    if (field !== 'image_url') {
      const { error } = await supabase.from(table).update(patch).eq('id', id);
      if (error) {
         console.error("Failed to update:", error);
         alert("Failed to update field: " + error.message);
         return;
      }
    }

    setViewModalData((prev: any) => {
          if (!prev) return prev;
          const newPrev = { ...prev };
          const keyMap: any = { 'Enquiry': 'enquiry', 'Quotation': 'quotation', 'Sales Order': 'order', 'Inward': 'inward', 'Finished Goods': 'finished_goods', 'DC': 'dc', 'Invoice': 'invoice' };
          const stateKey = keyMap[title];
          if (newPrev[stateKey]) {
             newPrev[stateKey] = { ...newPrev[stateKey], ...patch };
          }
          if (title === 'Inward' && Array.isArray(newPrev.inwards)) {
             newPrev.inwards = newPrev.inwards.map((r: any) => String(r.id) === String(id) ? { ...r, ...patch } : r);
          }
          return newPrev;
       });
       fetchPipeline();
  };

  const handleItemAction = async (order: any, itemIndex: number, action: 'inward' | 'unavailable') => {
    if (!window.confirm(`Are you sure you want to mark this part as ${action}?`)) return;
    setLoading(true);
    
    const updatedItems = (order.items || []).map((it: any, idx: number) =>
      idx === itemIndex ? { ...it, status: action === 'inward' ? 'Inwarded' : 'Unavailable' } : it
    );
    
    let newOrderStatus = order.status;
    if (action === 'unavailable') {
        newOrderStatus = 'Waiting for Parts';
    } else {
        const allInwarded = updatedItems.every((i: any) => i.status === 'Inwarded');
        if (allInwarded) newOrderStatus = 'Confirmed';
    }
    
    if (action === 'inward') {
        const item = updatedItems[itemIndex];
        const iNo = `INW-2026-${Math.floor(1000 + Math.random() * 9000)}`;
        const { error: inwErr } = await supabase.from('cnc_inwards').insert([{
          id: crypto.randomUUID(), inward_no: iNo, category: 'CUSTOMER DC',
          project_name: order.lead_no || '', product_name: order.part_name || item.productName || item.partName || '',
          sales_order_ref: order.order_no, reference_no: '',
          inward_date: new Date().toISOString().split('T')[0],
          party_name: order.customer || '', remarks: 'Auto-generated from part-wise action',
          part_name: item.partName || '-', part_number: item.partNumber || '',
          quantity: Number(item.quantity) || 0, total_amount: 0, status: 'Received'
        }]);
        if (inwErr) {
          alert("Error creating inward: " + inwErr.message);
          setLoading(false);
          return;
        }
        // CUSTOMER DC flows to Production as a Draft work order (manual release).
        try {
          await createDraftWorkOrdersForInwards([{
            inward: {
              category: 'CUSTOMER DC',
              sales_order_ref: order.order_no,
              party_name: order.customer || '',
              part_name: item.partName || '-',
              part_number: item.partNumber || '',
              inward_date: new Date().toISOString().split('T')[0],
            },
            qty: Number(item.quantity) || 0,
            customer: order.customer || '',
          }]);
        } catch (woErr) {
          console.error('Draft work order auto-create failed:', woErr);
        }
    }
    
    const { error } = await supabase.from('cnc_sales_orders').update({
        items: updatedItems,
        status: newOrderStatus
    }).eq('id', order.id);
    
    if (error) alert("Error updating item: " + error.message);
    else {
        fetchPipeline();
        setViewModalTarget(null);
    }
    setLoading(false);
  };

  const openProductFile = async (path: string) => {
    const tab = window.open('', '_blank');
    if (!tab) { alert('Allow pop-ups to open the product attachment.'); return; }
    const { data, error } = await supabase.storage.from('inventory-images').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { tab.close(); alert(error?.message || 'Unable to open the product attachment.'); return; }
    tab.location.href = data.signedUrl;
  };

  const getItemFileEntries = (item: any): { name: string; path: string }[] => {
    const out: { name: string; path: string }[] = [];
    (item?.filePaths || []).forEach((fp: any) => {
      if (!fp) return;
      if (typeof fp === 'string') out.push({ name: fp.split('/').pop() || fp, path: fp });
      else if (typeof fp === 'object' && (fp.path || fp.url)) out.push({ name: fp.name || String(fp.path || fp.url).split('/').pop(), path: fp.path || fp.url });
    });
    return out;
  };

  const handleItemFileUpload = async (title: string, raw: any, itemIndex: number, files: FileList | File[]) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (!company?.id) { alert('Select a company before uploading product files.'); return; }
    setLoading(true);
    try {
      if (title === 'Inward') {
        const uploaded = await Promise.all(list.map(f => uploadInwardAttachment(company.id!, raw.id, f)));
        const nextAttachments = [...(raw.attachments || []), ...uploaded];
        const { error } = await supabase.from('cnc_inwards').update({ attachments: nextAttachments }).eq('id', raw.id);
        if (error) throw error;
        setViewModalData((prev: any) => prev ? { ...prev, inward: { ...prev.inward, attachments: nextAttachments } } : prev);
      } else {
        const uploadedPaths = await Promise.all(list.map(f => uploadEnquiryProductFile(company.id!, f)));
        const keyMap: any = { 'Enquiry': 'enquiry', 'Quotation': 'quotation', 'Sales Order': 'order' };
        const fieldMap: any = { 'Enquiry': 'enquiring_for', 'Quotation': 'description', 'Sales Order': 'items' };
        const tableMap: any = { 'Enquiry': 'cnc_enquiries', 'Quotation': 'cnc_quotations', 'Sales Order': 'cnc_sales_orders' };
        const stateKey = keyMap[title];
        const field = fieldMap[title];
        const table = tableMap[title];
        if (!stateKey || !field || !table) { alert('File upload is supported for Enquiry, Quotation, Sales Order and Inward.'); return; }
        let currentItems: any[] = [];
        if (title === 'Sales Order') {
          currentItems = Array.isArray(raw.items) ? raw.items : [];
        } else {
          const rawVal = raw[field];
          try {
            const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
            currentItems = Array.isArray(parsed) ? parsed : (Array.isArray(raw.items) ? raw.items : []);
          } catch { currentItems = Array.isArray(raw.items) ? raw.items : []; }
        }
        const nextItems = currentItems.map((it: any, idx: number) =>
          idx === itemIndex ? { ...it, filePaths: [...(it.filePaths || []), ...uploadedPaths] } : it
        );
        const payloadVal = title === 'Sales Order' ? nextItems : JSON.stringify(nextItems);
        const { error } = await supabase.from(table).update({ [field]: payloadVal }).eq('id', raw.id);
        if (error) throw error;
        setViewModalData((prev: any) => {
          if (!prev || !prev[stateKey]) return prev;
          const updated = { ...prev[stateKey], [field]: payloadVal, items: nextItems };
          return { ...prev, [stateKey]: updated };
        });
      }
      fetchPipeline();
    } catch (err: any) {
      alert(err?.message || 'File upload failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleItemFileRemove = async (title: string, raw: any, itemIndex: number, filePathToRemove: string) => {
    if (!confirm('Are you sure you want to remove this attached file?')) return;
    setLoading(true);
    try {
      if (title === 'Inward') {
        const nextAttachments = (raw.attachments || []).filter((att: any) => {
          const p = typeof att === 'string' ? att : (att.path || att.url || '');
          return p !== filePathToRemove;
        });
        const { error } = await supabase.from('cnc_inwards').update({ attachments: nextAttachments }).eq('id', raw.id);
        if (error) throw error;
        setViewModalData((prev: any) => prev ? { ...prev, inward: { ...prev.inward, attachments: nextAttachments } } : prev);
      } else {
        const keyMap: any = { 'Enquiry': 'enquiry', 'Quotation': 'quotation', 'Sales Order': 'order' };
        const fieldMap: any = { 'Enquiry': 'enquiring_for', 'Quotation': 'description', 'Sales Order': 'items' };
        const tableMap: any = { 'Enquiry': 'cnc_enquiries', 'Quotation': 'cnc_quotations', 'Sales Order': 'cnc_sales_orders' };
        const stateKey = keyMap[title];
        const field = fieldMap[title];
        const table = tableMap[title];
        if (!stateKey || !field || !table) return;
        let currentItems: any[] = [];
        if (title === 'Sales Order') {
          currentItems = Array.isArray(raw.items) ? raw.items : [];
        } else {
          const rawVal = raw[field];
          try {
            const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
            currentItems = Array.isArray(parsed) ? parsed : (Array.isArray(raw.items) ? raw.items : []);
          } catch { currentItems = Array.isArray(raw.items) ? raw.items : []; }
        }
        const nextItems = currentItems.map((it: any, idx: number) => {
          if (idx !== itemIndex) return it;
          const curPaths = Array.isArray(it.filePaths) ? it.filePaths : (it.filePath ? [it.filePath] : []);
          return {
            ...it,
            filePaths: curPaths.filter((p: any) => (typeof p === 'string' ? p : p.path || p.url) !== filePathToRemove)
          };
        });
        const payloadVal = title === 'Sales Order' ? nextItems : JSON.stringify(nextItems);
        const { error } = await supabase.from(table).update({ [field]: payloadVal }).eq('id', raw.id);
        if (error) throw error;
        setViewModalData((prev: any) => {
          if (!prev || !prev[stateKey]) return prev;
          const updated = { ...prev[stateKey], [field]: payloadVal, items: nextItems };
          return { ...prev, [stateKey]: updated };
        });
      }
      fetchPipeline();
    } catch (err: any) {
      alert(err?.message || 'Failed to remove file.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveItem = async (title: string, raw: any, itemIndex: number) => {
    const keyMap: any = { 'Enquiry': 'enquiry', 'Quotation': 'quotation', 'Sales Order': 'order' };
    const fieldMap: any = { 'Enquiry': 'enquiring_for', 'Quotation': 'description', 'Sales Order': 'items' };
    const tableMap: any = { 'Enquiry': 'cnc_enquiries', 'Quotation': 'cnc_quotations', 'Sales Order': 'cnc_sales_orders' };
    const stateKey = keyMap[title];
    const field = fieldMap[title];
    const table = tableMap[title];
    if (!stateKey || !field || !table) return;
    let currentItems: any[] = [];
    if (title === 'Sales Order') {
      currentItems = Array.isArray(raw.items) ? raw.items : [];
    } else {
      const rawVal = raw[field];
      try {
        const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
        currentItems = Array.isArray(parsed) ? parsed : (Array.isArray(raw.items) ? raw.items : []);
      } catch { currentItems = Array.isArray(raw.items) ? raw.items : []; }
    }
    if (currentItems.length <= 1) { alert('A record must keep at least one product.'); return; }
    if (!window.confirm('Remove this product from the ' + title.toLowerCase() + '?')) return;
    const nextItems = currentItems.filter((_: any, idx: number) => idx !== itemIndex);
    const names = nextItems.map((it: any) => String(it.partName || it.productName || it.part_name || '').trim()).filter(Boolean);
    const summary = names.length > 1 ? `${names.join(', ')} (${names.length} Products)` : (names[0] || '');
    const totalQty = nextItems.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);
    const payloadVal = title === 'Sales Order' ? nextItems : JSON.stringify(nextItems);
    setLoading(true);
    try {
      const { error } = await supabase.from(table).update({ [field]: payloadVal, part_name: summary, quantity: totalQty }).eq('id', raw.id);
      if (error) throw error;
      setViewModalData((prev: any) => {
        if (!prev || !prev[stateKey]) return prev;
        const updated = { ...prev[stateKey], [field]: payloadVal, items: nextItems, part_name: summary, quantity: totalQty };
        return { ...prev, [stateKey]: updated };
      });
      fetchPipeline();
    } catch (err: any) {
      alert(err?.message || 'Failed to remove product.');
    } finally {
      setLoading(false);
    }
  };

  // Inward history reads Product Name → Part Name → Category first.
  const orderDetailEntries = (title: string, entries: [string, any][]) => {
    if (title !== 'Inward') return entries;
    const first = ['product_name', 'part_name', 'category'];
    return [
      ...entries.filter(([k]) => first.includes(k)).sort((a, b) => first.indexOf(a[0]) - first.indexOf(b[0])),
      ...entries.filter(([k]) => !first.includes(k)),
    ];
  };

  // Inward history cell (row-aware so grouped multi-line inwards stay editable).
  const inwardCellFor = (row: any, key: string, label: string) => {
    const v = row ? row[key] : undefined;
    const money = ['price', 'total_amount'].includes(key) && v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
    const text = (v === null || v === undefined || v === '') ? '—' : (money ? Number(v).toFixed(2) : String(v));
    return (
      <div>
        {label ? <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">{label}</span> : null}
        {viewEditMode ? (
          <input
            type="text"
            className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-brand-500"
            defaultValue={v ?? ''}
            onBlur={(e) => {
              if (row && e.target.value !== String(v ?? '')) {
                handleInlineEdit('Inward', row.id, key, e.target.value);
              }
            }}
          />
        ) : (
          <input readOnly aria-label={label || key} className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-slate-50 text-slate-700 cursor-default focus:outline-none" value={text === '—' ? '' : text} />
        )}
      </div>
    );
  };

  const renderRecordData = (title: string, raw: any, showItems: boolean = true, headerSuffix: string = '') => {
    if (!raw) return null;
    // Inward history mirrors the entry card: product picker row, category row, one-line part rows.
    const inwardCell = (key: string, label: string) => {
      const v = raw[key];
      const money = ['price', 'total_amount'].includes(key) && v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
      const text = (v === null || v === undefined || v === '') ? '—' : (money ? Number(v).toFixed(2) : String(v));
      return (
        <div>
          <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">{label}</span>
          {viewEditMode ? (
            <input
              type="text"
              className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-brand-500"
              defaultValue={v ?? ''}
              onBlur={(e) => {
                if (e.target.value !== String(v ?? '')) {
                  handleInlineEdit(title, raw.id, key, e.target.value);
                }
              }}
            />
          ) : (
            <input readOnly aria-label={label || key} className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-slate-50 text-slate-700 cursor-default focus:outline-none" value={text === '—' ? '' : text} />
          )}
        </div>
      );
    };
    return (
      <div className="mb-6">
        <h4 className="font-bold text-sm text-brand-800 border-b border-brand-100 pb-2 mb-3 uppercase flex justify-between items-center">
          {title} Details{headerSuffix ? ` ${headerSuffix}` : ''}
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6 bg-slate-50 p-4 rounded-lg border border-slate-100">
          {title === 'Inward' ? (<>
            <div className="col-span-full">{inwardCellFor(raw, 'product_name', 'Product from Enquiry')}</div>
            <div className="col-span-full grid grid-cols-3 gap-4">
              {inwardCellFor(raw, 'category', 'Category')}
              {inwardCellFor(raw, 'reference_no', 'Reference No.')}
              {inwardCellFor(raw, 'inward_date', 'Inward Date')}
            </div>
            <div className="col-span-full">
              <div className="grid grid-cols-[minmax(0,1.5fr)_4.5rem_5.5rem_4.5rem_4.5rem_6rem] gap-2 items-center mb-1 px-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Part Name</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Quantity</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Price</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Discount</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">GST</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Total (Rs.)</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1.5fr)_4.5rem_5.5rem_4.5rem_4.5rem_6rem] gap-2 items-center bg-white rounded-lg border border-slate-200 p-2">
                {inwardCellFor(raw, 'part_name', '')}
                {inwardCellFor(raw, 'quantity', '')}
                {inwardCellFor(raw, 'price', '')}
                {inwardCellFor(raw, 'discount_percent', '')}
                {inwardCellFor(raw, 'gst_percent', '')}
                {inwardCellFor(raw, 'total_amount', '')}
              </div>
            </div>
          </>) : (
          orderDetailEntries(title, Object.entries(raw)).map(([key, value]) => {
            if (key === 'id' || key.startsWith('_') || key.endsWith('_id') || ((value === null || value === '') && !(title === 'Inward' && (key === 'product_name' || key === 'part_name' || key === 'category'))) || key === 'items' || key === 'contacts' || key === 'attachments' || key === 'quote_no' || key === 'order_no' || key === 'inward_no' || key === 'enquiry_no' || key === 'delivery_no' || key === 'dc_no' || key === 'invoice_no' || key === 'sales_order_no' || key === 'sales_order_ref' || key === 'image_url' || key === 'drawing_url' || key === 'enquiring_for' || key === 'description' || key === 'status' || key === 'delivered' || key === 'contact_person' || key === 'phone' || key === 'email' || key === 'part_no' || key === 'part_number' || key === 'partNo' || key === 'partNumber') return null;
            if (title === 'Enquiry' && (key === 'status' || key === 'estimated_value' || key === 'received_date' || key === 'pipeline_stage' || key === 'expected_date' || key === 'source' || key === 'created_at' || key === 'lead_no')) return null;
            if (title === 'Sales Order' && (key === 'part_name' || key === 'quantity' || key === 'lead_no' || key === 'value' || key === 'customer' || key === 'created_at' || key === 'payment_terms' || key === 'total_value' || key === 'delivery_date')) return null;
            if (title === 'Quotation' && (key === 'customer' || key === 'part_name' || key === 'salesperson')) return null;
            if (title === 'Inward' && (key === 'project_name' || key === 'sales_order_ref' || key === 'party_name' || key === 'created_at' || key === 'updated_at')) return null;
            if (title === 'Finished Goods' && (key === 'wo_no' || key === 'part_name' || key === 'customer' || key === 'sales_order' || key === 'quantity' || key === 'rejected' || key === 'due_date' || key === 'priority' || key === 'drawing_revision' || key === 'created_at')) return null;
            if (title === 'Invoice' && (key === 'customer_name' || key === 'part_name' || key === 'quantity' || key === 'created_at' || key === 'invoice_type' || key === 'basic_value' || key === 'cancelled' || key === 'created_by' || key === 'updated_at')) return null;
            if (title === 'Quotation' && (key === 'valid_till' || key === 'valid_until' || key === 'status' || key === 'created_at' || key === 'part_number' || key === 'part_no')) return null;
            let formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            if (key === 'lead_no') formattedKey = 'Company ID';
            if (key === 'part_name') formattedKey = 'Product Name';
            const displayVal = (key === 'part_name' && title !== 'Inward') ? formatLeadProductDisplay(raw) : value;
            return (
              <div key={key}>
                <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">{formattedKey}</span>
                {viewEditMode && key !== 'created_at' && key !== 'updated_at' ? (
                   <input 
                     type="text" 
                     className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-brand-500"
                     defaultValue={displayVal ?? ''}
                     onBlur={(e) => {
                       if (e.target.value !== String(displayVal ?? '')) {
                         handleInlineEdit(title, raw.id, key, e.target.value);
                       }
                     }}
                   />
                ) : (
                   <input readOnly aria-label={formattedKey} className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-slate-50 text-slate-700 cursor-default focus:outline-none"
                     value={displayVal === null || displayVal === undefined || displayVal === ''
                       ? ''
                       : ['value', 'total_value'].includes(key) && Number.isFinite(Number(displayVal))
                         ? Number(displayVal).toFixed(2)
                         : String(displayVal)} />
                )}
              </div>
            );
          }))}
        </div>
        {showItems && title !== 'Sales Order' && raw.items && Array.isArray(raw.items) && (
          <div className="bg-white rounded-lg border border-slate-200 mt-4">
            <h4 className="font-bold text-xs text-brand-800 border-b border-slate-200 p-2.5 bg-slate-50 rounded-t-lg uppercase">Items Breakdown</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-[10px] text-slate-500 bg-slate-50 uppercase border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2">Product Name</th>
                    <th className="px-4 py-2">Qty</th>
                    <th className="px-4 py-2">Unit Price</th>
                    <th className="px-4 py-2">Total</th>
                    {(title === 'Sales Order' || viewEditMode) && <th className="px-4 py-2 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {raw.items.map((item: any, i: number) => {
                    const fileEntries = getItemFileEntries(item);
                    return (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {item.partName || item.productName || '-'}
                        {fileEntries.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {fileEntries.map(fe => (
                              <span key={fe.path} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-blue-700">
                                <button type="button" className="inline-flex items-center gap-1 hover:underline truncate max-w-[140px]" onClick={e => { e.stopPropagation(); void openProductFile(fe.path); }}>
                                  <FileText size={11} className="shrink-0" />{fe.name}
                                </button>
                                {viewEditMode && (
                                  <button
                                    type="button"
                                    className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-xs font-bold leading-none"
                                    title={`Remove ${fe.name}`}
                                    aria-label={`Remove ${fe.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleItemFileRemove(title, raw, i, fe.path);
                                    }}
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">{item.quantity}</td>
                      <td className="px-4 py-3">{formatINR(item.unitPrice || 0)}</td>
                      <td className="px-4 py-3 font-bold text-brand-600">{formatINR((item.quantity||0) * (item.unitPrice||0))}</td>
                      {(title === 'Sales Order' || viewEditMode) && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {title === 'Sales Order' && !item.status && (
                              <button onClick={() => handleItemAction(raw, i, 'inward')} className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded border border-emerald-200" title="Available (Inward)">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                              </button>
                            )}
                            {viewEditMode && (title === 'Enquiry' || title === 'Quotation' || title === 'Sales Order') && (
                              <label className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700" title="Upload image / file / PDF for this product">
                                <UploadCloud size={13} /> Upload
                                <input type="file" multiple accept="*/*" className="hidden" onChange={e => { if (e.currentTarget.files?.length) void handleItemFileUpload(title, raw, i, e.currentTarget.files); e.currentTarget.value = ''; }} />
                              </label>
                            )}
                            {viewEditMode && (title === 'Enquiry' || title === 'Quotation' || title === 'Sales Order') && (
                              <button type="button" onClick={() => void handleRemoveItem(title, raw, i)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md border border-transparent hover:border-red-200" title="Remove product">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {title === 'Inward' && Array.isArray(raw.attachments) && raw.attachments.length > 0 && (
          <div className="bg-white rounded-lg border border-slate-200 mt-4">
            <h4 className="font-bold text-xs text-brand-800 border-b border-slate-200 p-2.5 bg-slate-50 rounded-t-lg uppercase">Attached Files</h4>
            <div className="p-3 flex flex-wrap gap-2">
              {raw.attachments.map((att: any, ai: number) => {
                const p = typeof att === 'string' ? att : (att.path || att.url || '');
                const n = typeof att === 'string' ? p.split('/').pop() : (att.name || p.split('/').pop() || `File ${ai + 1}`);
                if (!p) return null;
                return (
                  <span key={`${p}-${ai}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-blue-700">
                    <button type="button" className="inline-flex items-center gap-1 hover:underline truncate max-w-[180px]" onClick={() => void openProductFile(p)}>
                      <FileText size={12} className="shrink-0" />{n}
                    </button>
                    {viewEditMode && (
                      <button
                        type="button"
                        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-xs font-bold leading-none"
                        title={`Remove ${n}`}
                        aria-label={`Remove ${n}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleItemFileRemove(title, raw, 0, p);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
              {viewEditMode && (
                <label className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700">
                  <UploadCloud size={13} /> Upload image / file / PDF
                  <input type="file" multiple accept="*/*" className="hidden" onChange={e => { if (e.currentTarget.files?.length) void handleItemFileUpload(title, raw, 0, e.currentTarget.files); e.currentTarget.value = ''; }} />
                </label>
              )}
            </div>
          </div>
        )}
        {(raw.image_url || mockImages[raw.part_name || raw.id]) && (
           <div className="mt-4">
             <h4 className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Attached Files</h4>
             <img src={mockImages[raw.part_name || raw.id] || raw.image_url} alt="Attachment" className="h-24 w-auto object-contain rounded border border-slate-200 bg-white" />
           </div>
        )}
      </div>
    );
  };

  const pipelineDocumentInput = async (kind: 'dc' | 'invoice') => {
    const record = viewModalData?.[kind];
    if (!record) return null;
    const invoice = kind === 'invoice';
    if (invoice) {
      const items = Array.isArray(record.items) ? record.items : [];
      const comp = await fetchCompanyPrintDetails((company as any)?.id);
      const invBasic = Number(record.basic_value ?? record.subtotal ?? 0) || 0;
      const invCgst = Number(record.cgst ?? 0) || 0;
      const invSgst = Number(record.sgst ?? 0) || 0;
      const invIgst = Number(record.igst ?? 0) || 0;
      const invRate = (amt: number) => (invBasic > 0 && amt > 0 ? Math.round((amt / invBasic) * 10000) / 100 : null);
      const custMatch: any = (customerList || []).find((x: any) =>
        String(x.name || '').trim().toLowerCase() === String(record.customer_name || record.customer || '').trim().toLowerCase()) || {};
      let invDcDate: string | null = viewModalData?.dc?.delivery_date || null;
      const invDcNo = String(record.dc_no || record.delivery_no || '');
      if (!invDcDate && invDcNo) {
        try {
          const dr = await supabase.from('cnc_deliveries').select('delivery_date,po_no,customer_gstin,billing_address,customer_code')
            .eq('delivery_no', invDcNo).order('created_at').limit(1).maybeSingle();
          if (!dr.error && dr.data) invDcDate = (dr.data as any).delivery_date || null;
        } catch { /* date stays empty */ }
      }
      const invPo = String(record.po_no || viewModalData?.dc?.po_no || '');
      return {
        companyName: company?.company_name || 'ARGUS CNC',
        companyGstin: comp.gstin,
        title: record.invoice_type || 'Tax Invoice',
        docNo: String(record.invoice_no || record.inv_no || ''),
        invDate: record.invoice_date || record.date,
        partyName: String(record.customer_name || record.customer || ''),
        partyAddress: String(record.billing_address || viewModalData?.dc?.billing_address || ''),
        partyCode: String(custMatch.id || viewModalData?.dc?.customer_code || ''),
        partyGstin: String(record.customer_gstin || viewModalData?.dc?.customer_gstin || ''),
        dcNo: invDcNo,
        dcDate: invDcDate,
        poNo: invPo,
        items: items.length
          ? items.map((item: any) => {
              const q = Number(item.quantity ?? item.qty ?? 0) || 0;
              const r = Number(item.rate ?? item.unitPrice ?? 0) || 0;
              return {
                description: String(item.description || item.partName || item.part_name || ''),
                hsn: String(item.hsn || ''),
                qty: q, unit: String(item.unit || ''),
                price: r, amount: Number(item.amount ?? q * r) || 0,
              };
            })
          : [{
              description: String(record.part_name || record.description || ''),
              hsn: '', qty: Number(record.quantity || record.dispatch_qty || 0) || 0,
              unit: String(record.unit || ''), price: 0, amount: 0,
            }],
        basicValue: invBasic,
        cgstRate: invRate(invCgst), cgstAmt: invCgst,
        sgstRate: invRate(invSgst), sgstAmt: invSgst,
        igstRate: invRate(invIgst), igstAmt: invIgst,
        roundOff: Number((record as any).round_off ?? 0) || 0,
        grandTotal: Number(record.total || record.total_value || record.value || 0) || 0,
        bankLines: comp.bankLines,
      };
    }
    // ---- Delivery Challan: gather EVERY item from the same DC object/data shown
    // in the Details screen — never just the first product or the header quantity.
    const stripSummary = (v: any) => String(v ?? '').replace(/(\s*\(?\d+\s*products?\)?\s*)+$/i, '').trim();
    const isBareId = (v: string) => /^[\d\s,.\-()]+$/.test(v);
    const docNo = String(record.delivery_no || record.dc_no || record.challan_no || '').trim();
    let siblingRows: any[] = [];
    if (docNo) {
      try {
        const { data } = await supabase.from('cnc_deliveries').select('*').eq('delivery_no', docNo).order('created_at', { ascending: true });
        if (Array.isArray(data) && data.length) siblingRows = data;
      } catch { /* single-record fallback below */ }
    }
    const orderItems: any[] = Array.isArray(viewModalData?.order?.items) ? viewModalData.order.items : [];
    let items: any[] = Array.isArray(record.items) && record.items.length ? record.items : [];
    if (!items.length && siblingRows.length > 1) {
      items = siblingRows.map(r => ({
        partName: r.part_name, productName: r.part_name, description: r.description,
        quantity: r.dispatch_qty ?? r.quantity, unit: r.unit, remarks: r.remarks,
      }));
    }
    if (!items.length && orderItems.length) items = orderItems;
    // Product ID → Product Master → Product Name (+ unit). Bare IDs are looked up
    // in finished-goods and raw-material masters, one batched query each.
    const ownNameOf = (item: any) => [item.partName, item.productName, item.part_name, item.description]
      .map(x => String(x ?? '').trim()).find(Boolean) || '';
    const idKeysOf = (item: any) => [ownNameOf(item), item.product_id, item.part_id, item.part_number]
      .map(x => String(x ?? '').trim()).filter(v => v && isBareId(v));
    const bareIds = Array.from(new Set(items.flatMap(idKeysOf)));
    const masterById = new Map<string, { name: string; unit: string }>();
    if (bareIds.length) {
      try {
        const { data } = await supabase.from('cnc_parts').select('part_no,part_name,unit').in('part_no', bareIds);
        (data || []).forEach((r: any) => { if (r.part_no) masterById.set(String(r.part_no), { name: r.part_name || '', unit: r.unit || '' }); });
      } catch { /* master unavailable — fall back below */ }
      const missing = bareIds.filter(id => !masterById.has(id));
      if (missing.length) {
        try {
          const { data } = await supabase.from('cnc_raw_materials').select('material_code,name,uom').in('material_code', missing);
          (data || []).forEach((r: any) => { if (r.material_code) masterById.set(String(r.material_code), { name: r.name || '', unit: r.uom || '' }); });
        } catch { /* fall back below */ }
      }
    }
    const masterHit = (item: any) => {
      for (const k of idKeysOf(item)) {
        const m = masterById.get(k);
        if (m && m.name) return m;
      }
      return null;
    };
    const itemName = (item: any, idx: number) => {
      const own = ownNameOf(item);
      if (own && !isBareId(own)) return stripSummary(own) || own;
      const hit = masterHit(item);
      if (hit) return stripSummary(hit.name);
      const linked = orderItems[idx];
      const linkName = linked
        ? [linked.partName, linked.productName, linked.part_name, linked.description]
            .map(x => String(x ?? '').trim()).find(v => v && !isBareId(v))
        : '';
      if (linkName) return stripSummary(linkName);
      if (linked) {
        const linkHit = masterHit(linked);
        if (linkHit) return stripSummary(linkHit.name);
      }
      const header = String(record.part_name || record.description || '').trim();
      if (!own && header && !isBareId(header)) return stripSummary(header);
      return stripSummary(own) || '—';
    };
    const itemUnit = (item: any) => {
      const hit = masterHit(item);
      if (hit && hit.unit) return hit.unit;
      const fromItem = String(item.unit || '').trim();
      if (fromItem) return fromItem;
      return String(record.unit || '').trim() || 'Nos';
    };
    const itemQty = (item: any) => Number(item.quantity ?? item.qty ?? item.dispatch_qty ?? 0) || 0;
    const customerName = String(record.customer_name || record.customer || '').trim();
    const soRef = String(record.sales_order_no || record.order_no || viewModalData?.order?.order_no || '').trim();
    // Full-detail challan lines: prefer the raw sibling rows (every column),
    // fall back to the resolved items, then the header record.
    const money = (n: number) => (n ? `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '');
    let dcLines: { partName: string; hsn: string; qty: number; unit: string; price: number }[] = [];
    if (siblingRows.length) {
      dcLines = siblingRows.map((r: any) => ({
        partName: String(r.part_name || '').trim(),
        hsn: String(r.hsn || '').trim(),
        qty: Number(r.dispatch_qty ?? r.quantity) || 0,
        unit: String(r.unit || '').trim() || 'Nos',
        price: Number(r.unit_price ?? r.price) || 0,
      })).filter((l) => l.partName);
    }
    if (!dcLines.length && items.length) {
      dcLines = items.map((item: any, i: number) => ({
        partName: itemName(item, i),
        hsn: String(item.hsn || '').trim(),
        qty: itemQty(item),
        unit: itemUnit(item),
        price: Number(item.unit_price ?? item.price ?? item.rate) || 0,
      })).filter((l) => l.partName);
    }
    if (!dcLines.length) {
      dcLines = [{
        partName: stripSummary(record.part_name || record.description) || '—',
        hsn: String(record.hsn || '').trim(),
        qty: Number(record.dispatch_qty ?? record.quantity) || 0,
        unit: String(record.unit || '').trim() || 'Nos',
        price: Number(record.unit_price ?? record.price) || 0,
      }];
    }
    return {
      companyName: company?.company_name || 'ARGUS TECHNOLOGIES',
      dcNo: docNo,
      dcDate: record.delivery_date || record.date,
      ewayBill: String(record.eway_bill || ''),
      poNumber: String(record.po_no || soRef || ''),
      placeOfSupply: String(record.place_of_supply || ''),
      customerName,
      customerAddress: String(record.billing_address || record.customer_address || ''),
      customerGstin: String(record.customer_gstin || ''),
      customerCode: String(record.customer_code || ''),
      category: String(record.category || ''),
      packaging: String(record.packaging_details || ''),
      enquiryNo: String(record.enquiry_no || ''),
      process: String(record.process || ''),
      transportNo: String(record.vehicle_no || ''),
      phoneNo: String(record.phone || ''),
      receiverName: String(record.receiver_name || ''),
      senderName: String(record.sender_name || ''),
      items: dcLines.map((l) => ({
        partName: l.partName, hsn: l.hsn,
        qty: l.qty ? String(l.qty) : '', unit: l.unit,
        price: money(l.price), amount: money(l.qty * l.price),
      })),
      customerSignature: record.customer_signature || null,
      authorizedSignature: record.authorized_signature || null,
    };
  };
  const downloadPipelineDocument = async (kind: 'dc' | 'invoice') => {
    const input = await pipelineDocumentInput(kind);
    try {
      if (!input) return;
      if (kind === 'dc') await downloadDeliveryChallan(input as any);
      else if (kind === 'invoice') await downloadSalesInvoice(input as any);
      else await downloadBrandedDocument(input as any);
    }
    catch (error) { alert(error instanceof Error ? error.message : 'Unable to generate the document PDF.'); }
  };
  const viewPipelineDocument = async (kind: 'dc' | 'invoice') => {
    const input = await pipelineDocumentInput(kind);
    try {
      if (!input) return;
      if (kind === 'dc') await viewDeliveryChallan(input as any);
      else if (kind === 'invoice') await viewSalesInvoice(input as any);
      else await viewBrandedDocument(input as any);
    }
    catch (error) { alert(error instanceof Error ? error.message : 'Unable to preview the document PDF.'); }
  };

  const [rawLeadsList, setRawLeadsList] = useState<any[]>([]);
  const [salesOrdersList, setSalesOrdersList] = useState<any[]>([]);

  const resetEnquiryForm = (leads = rawLeadsList) => ({
    leadNo: generateUniqueProjectNo(leads),
    company: '', partName: '', partNumber: '', quantity: '', expectedDate: '', source: 'Direct',
    estimatedValue: '', receivedDate: new Date().toISOString().split('T')[0],
    contacts: [{ person: '', phone: '', email: '' }],
    remarks: '',
    items: [{ productName: '', partName: '', quantity: '', remarks: '', filePaths: [] as string[], files: [] as File[] }],
    files: [] as File[]
  });
  const [enquiryForm, setEnquiryForm] = useState(resetEnquiryForm());

  // Measures where the first product field starts in the enquiry entry row so
  // added product lines below can be indented to sit straight under it. The
  // first line itself is never restyled — only the wrapped lines get padding.
  const enquiryRowRef = useRef<HTMLDivElement | null>(null);
  const firstEnquiryItemRef = useRef<HTMLSpanElement | null>(null);
  const [enquiryItemIndent, setEnquiryItemIndent] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const row = enquiryRowRef.current;
      const anchor = firstEnquiryItemRef.current;
      if (row && anchor) {
        const next = Math.max(0, Math.round(anchor.offsetLeft));
        setEnquiryItemIndent(prev => (prev === next ? prev : next));
      }
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' && enquiryRowRef.current
      ? new ResizeObserver(measure)
      : null;
    if (ro && enquiryRowRef.current) ro.observe(enquiryRowRef.current);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  });

  const [quoteForm, setQuoteForm] = useState<any>({
    quoteNo: '', customer: '', leadNo: '', quoteDate: '', validTill: '', salesperson: 'Admin',
    contacts: [{ person: '', phone: '', email: '' }],
    partName: '', partNumber: '', description: '', quantity: '', unitPrice: '', discount: '0', unitDiscount: '0', gst: '18',
    items: [{ id: crypto.randomUUID(), partName: '', partNumber: '', quantity: '', unitPrice: '', discount: '0', unitDiscount: '0', gst: '18' }],
    paymentTerms: '', deliveryTerms: '', remarks: ''
  });

  

  const emptyInwardItem = (defaults: any = {}) => ({ partyName: defaults.partyName || '', productKey: defaults.productKey || '', productName: defaults.productName || '', enquiryId: defaults.enquiryId || '', projectName: defaults.projectName || '', partName: '', partNumber: '', quantity: '', price: '', discount: '0', gst: '18', remarks: defaults.remarks || '', files: (defaults.files || []) as File[] });
  const emptyInwardPart = (defaults: any = {}) => ({ category: defaults.category || 'GOODS PURCHASE', referenceNo: defaults.referenceNo || '', inwardDate: defaults.inwardDate || new Date().toISOString().split('T')[0], remarks: defaults.remarks || '', files: [] as File[], productKey: defaults.productKey || '', productName: defaults.productName || '', enquiryId: defaults.enquiryId || '', projectName: defaults.projectName || '', partyName: defaults.partyName || '', items: [emptyInwardItem({ partyName: defaults.partyName || '' })] });
  const [inwardForm, setInwardForm] = useState<any>({
    inwardNo: '', category: 'GOODS PURCHASE', projectName: '', salesOrderRef: '', referenceNo: '', inwardDate: new Date().toISOString().split('T')[0], partyName: '', remarks: '',
    productName: '', productKey: '', productOptions: [], enquiryId: '', parts: [emptyInwardPart()],
    contacts: [{ person: '', phone: '', email: '' }]
  });

  const [knownCompanies, setKnownCompanies] = useState<any[]>([]);
  const [customerList, setCustomerList] = useState<any[]>([]);

  useEffect(() => {
    async function fetchCustomers() {
      const { data } = await supabase.from('cnc_customers').select('*');
      if (data) setCustomerList(data);
    }
    fetchCustomers();
  }, []);

  const allKnownCompanies = useMemo(() => {
    const map = new Map<string, { company: string; contact_person?: string; phone?: string; email?: string; city?: string; gst?: string }>();
    (knownCompanies || []).forEach((c: any) => {
      const name = c.company?.trim();
      if (!name) return;
      const key = name.toLowerCase();
      const existing = map.get(key);
      map.set(key, {
        company: name,
        contact_person: c.contact_person || existing?.contact_person || '',
        phone: c.phone || existing?.phone || '',
        email: c.email || existing?.email || '',
        city: c.city || existing?.city || '',
        gst: c.gst || existing?.gst || ''
      });
    });
    (customerList || []).forEach((c: any) => {
      const name = c.name?.trim();
      if (!name) return;
      const key = name.toLowerCase();
      const existing = map.get(key);
      map.set(key, {
        company: name,
        contact_person: existing?.contact_person || c.contact || '',
        phone: existing?.phone || c.phone || '',
        email: existing?.email || c.email || '',
        city: existing?.city || c.city || '',
        gst: existing?.gst || c.gst || c.gstin || c.gst_number || ''
      });
    });
    // Active suppliers are valid inward companies too (purchase source). They
    // merge here so every company/supplier picker in the pipeline offers them.
    (supplierDirectory || []).forEach((s: any) => {
      const name = String(s.name || '').trim();
      if (!name || map.has(name.toLowerCase())) return;
      map.set(name.toLowerCase(), { company: name, contact_person: '', phone: '', email: '', city: '', gst: '' });
    });
    // Fallback: customers already visible on this user's own board cards, so the
    // company pickers keep working when the master tables are permission-gated
    // (customers need All Companies view, suppliers need Suppliers view).
    // Only stages the user may see contribute names — nothing leaks across.
    (cards || []).forEach((c: any) => {
      if (!canView(STAGE_MODULE[c.stage] ?? 'sales-pipeline')) return;
      const name = String(c.customer || '').trim();
      if (!name || map.has(name.toLowerCase())) return;
      const r = c.raw ?? {};
      map.set(name.toLowerCase(), {
        company: name,
        contact_person: String(r.contact_person || ''),
        phone: String(r.phone || ''),
        email: String(r.email || ''),
        city: String(r.city || ''),
        gst: String(r.gst || r.gstin || '')
      });
    });
    return Array.from(map.values()).sort((a, b) => a.company.localeCompare(b.company));
  }, [customerList, knownCompanies, supplierDirectory, cards, canView]);

  useEffect(() => {
    const fromCards = cards.map(c => c.customer);
    const fromCompanies = (allKnownCompanies || []).map((c: any) => c.company);
    const list = Array.from(new Set([...fromCards, ...fromCompanies]))
      .filter((n): n is string => Boolean(n && typeof n === 'string'))
      .sort((a, b) => a.localeCompare(b));
    setCompanyOptions(list);
  }, [cards, allKnownCompanies, setCompanyOptions]);

  // Already-entered product names across enquiries — for the Product Name dropdown
  // (user can still type a brand-new product name).
  const existingProductNames = useMemo(() => {
    const map = new Map<string, string>();
    enquiryProductOptions(rawLeadsList).forEach((p: any) => {
      const n = String(p.name || '').trim();
      if (n && !map.has(n.toLowerCase())) map.set(n.toLowerCase(), n);
    });
    (rawLeadsList || []).forEach((l: any) => {
      const n = String(l.part_name || '').trim();
      if (n && !/^multiple\s*products/i.test(n) && !map.has(n.toLowerCase())) map.set(n.toLowerCase(), n);
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [rawLeadsList]);

  // Products available when adding/editing an inward: includes Components & Raw Materials catalogue items,
  // plus all pipeline products from enquiries and sales orders (matching the options available when adding inward).
  const inwardEditProductOptions = useMemo(() => {
    const list: { name: string; detail?: string; group: 'catalogue' | 'pipeline' }[] = [];
    const seen = new Set<string>();

    // 1. Components / Raw Materials catalogue items (same source as eligibleCatalogue in inward entry form)
    (eligibleCatalogue || []).forEach((m: any) => {
      const name = String(m.name || '').trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        const detail = [m.code, m.unit ? `per ${m.unit}` : '', m.unitPrice ? `₹${m.unitPrice}` : ''].filter(Boolean).join(' · ');
        list.push({ name, detail, group: 'catalogue' });
      }
    });

    // 2. Enquiry & Sales Order pipeline products (same source as enquiryProductOptions in inward entry form)
    const pipe = enquiryProductOptions(rawLeadsList, undefined, salesOrdersList);
    (pipe || []).forEach((o: any) => {
      const name = String(o.name || '').trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        const detail = [o.customer || o.leadNo, o.saleLabel].filter(Boolean).join(' · ');
        list.push({ name, detail, group: 'pipeline' });
      }
    });

    // 3. Fallback: all distinct product names across existing enquiries/orders
    (existingProductNames || []).forEach((n: string) => {
      const name = String(n || '').trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        list.push({ name, group: 'pipeline' });
      }
    });

    // 4. Fallback: products on this user's visible Inward cards (same table),
    // so the list is never just the current value when masters are empty or
    // permission-gated. Only stages the user may see contribute names.
    (cards || []).filter((c: any) => c.stage === 'Inward' && canView(STAGE_MODULE[c.stage] ?? 'sales-pipeline')).forEach((c: any) => {
      [c.part, c.raw?.product_name, c.raw?.part_name].forEach((n: any) => {
        const name = String(n || '').trim();
        if (name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          list.push({ name, group: 'pipeline' });
        }
      });
    });

    return list;
  }, [eligibleCatalogue, rawLeadsList, salesOrdersList, existingProductNames, cards, canView]);

  const fetchPipeline = async () => {
    setLoading(true);
    try {
    // Fetch all leads to build a lookup map for Unique Numbers
    const { data: allLeads, error: leadsErr } = await supabase.from('cnc_enquiries').select('id, lead_no, enquiry_no, status, pipeline_stage, customer, part_name, quantity, estimated_value, expected_date, received_date, created_at, contact_person, phone, email, enquiring_for, gst, city');
    if (leadsErr) console.error("Error fetching leads:", leadsErr);
    
    const leadMap = new Map();
    const compMap = new Map();
    
    if (allLeads) {
      setRawLeadsList(allLeads);
      allLeads.forEach(l => {
        leadMap.set(l.id, l.lead_no || l.enquiry_no);
        const comp = l.customer?.trim();
        if (comp) {
           const existing = compMap.get(comp);
           compMap.set(comp, {
             company: comp,
             contact_person: existing?.contact_person || l.contact_person || '',
             phone: existing?.phone || l.phone || '',
             email: existing?.email || l.email || '',
             gst: existing?.gst || l.gst || '',
             city: existing?.city || l.city || ''
           });
        }
      });
      setNewLeadForm((prev: any) => {
        if (!prev.leadNo || prev.leadNo.startsWith('PROJ-')) {
          return { ...prev, leadNo: generateUniqueProjectNo(allLeads) };
        }
        return prev;
      });
      setEnquiryForm((prev: any) => {
        if (!prev.leadNo || prev.leadNo.startsWith('PROJ-')) {
          return { ...prev, leadNo: generateUniqueProjectNo(allLeads) };
        }
        return prev;
      });
    }
    setKnownCompanies(Array.from(compMap.values()));

    // Load all quotes / orders for the reference maps (converted quotes and inwarded orders are still
    // needed to resolve project numbers downstream); only the active ones become cards.
    const { data: allQuotes, error: quotesErr } = await supabase.from('cnc_quotations').select('*');
    if (quotesErr) console.error("Error fetching quotations:", quotesErr);
    let resolvedQuotes: any[] = allQuotes && allQuotes.length > 0 ? allQuotes : [];
    const quoteMap = new Map();
    resolvedQuotes.forEach(q => quoteMap.set(q.id, leadMap.get(q.lead_id) || q.enquiry_no || q.quote_no));
    const quotes = resolvedQuotes.filter(q => ['Sent', 'Under Review', 'Draft'].includes(q.status));

    const { data: allOrders, error: ordersErr } = await supabase.from('cnc_sales_orders').select('*');
    if (ordersErr) console.error("Error fetching sales orders:", ordersErr);
    if (allOrders) setSalesOrdersList(allOrders);
    const orderMap = new Map();
    if (allOrders) allOrders.forEach(o => orderMap.set(o.order_no, o.lead_no || quoteMap.get(o.quotation_id) || o.order_no));
    const orders = allOrders?.filter(o => ['Draft', 'Confirmed', 'Waiting for Parts', 'In Production'].includes(o.status));

    const { data: inwards, error: inwardErr } = await supabase.from('cnc_inwards').select('*').neq('status', 'Deleted');

    const newCards: KanbanCard[] = [];

    // Filter leads for the Enquiry column
    const activeLeads = allLeads?.filter(l => ['New', 'Contacted', 'Qualified', 'Under Review'].includes(l.status) && l.pipeline_stage !== null) || [];

    activeLeads.forEach(l => newCards.push({
      id: `lead_${l.id}`, stage: 'Enquiry', type: 'lead',
      refNo: leadMap.get(l.id), customer: l.customer, part: formatLeadProductDisplay(l),
      qty: l.quantity, value: l.estimated_value, date: l.expected_date || l.received_date || (l.created_at ? String(l.created_at).split('T')[0] : ''), status: l.status, raw: l
    }));

    if (quotes) quotes.forEach(q => newCards.push({
      id: `quote_${q.id}`, stage: 'Quotation', type: 'quotation',
      refNo: quoteMap.get(q.id) || q.enquiry_no || q.quote_no, customer: q.customer || q.customer_name, part: formatLeadProductDisplay(q),
      qty: q.quantity, value: q.total_value, date: q.valid_till || q.valid_until || q.date || q.quote_date, status: q.status, raw: q
    }));

    if (orders) orders.forEach(o => newCards.push({
      id: `order_${o.id}`, stage: 'Sales Order', type: 'order',
      refNo: orderMap.get(o.order_no), customer: o.customer || o.customer_name, part: formatLeadProductDisplay(o),
      qty: o.quantity || (o.items?.[0]?.quantity), value: Number(o.total_value ?? o.value) || 0, date: o.delivery_date, status: o.status, raw: o
    }));

    if (inwards && !inwardErr) {
      // Same unique number = one card (like history): group sibling inward rows.
      // Strip the order-time stamp suffix (e.g. 1010-28Sep26-0994PM -> 1010) so
      // repeat inwards for the same company + unique number land on one card.
      const groups = new Map<string, any[]>();
      inwards.filter(i => !String(i.category || '').trim().toUpperCase().startsWith('EXPENSE')).forEach(i => {
        const key = baseUniqueNo(orderMap.get(i.sales_order_ref) || i.project_name || i.inward_no || i.id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(i);
      });
      groups.forEach((list, key) => {
        const first = list[0];
        const parts = Array.from(new Set(list.map(x => x.product_name ? `${x.product_name} · ${x.part_name}` : x.part_name).filter(Boolean)));
        // Display the stamped unique number (like order/FG/DC cards); the
        // group key stays stamp-stripped so repeats still land on one card.
        const soMatch = (allOrders || []).find((o: any) => {
          const lead = String(o.lead_no || '').trim();
          return lead !== '' && baseUniqueNo(lead) === key;
        });
        const displayRef = soMatch?.lead_no || key;
        newCards.push({
          id: `inward_${first.id}`, stage: 'Inward', type: 'inward',
          refNo: displayRef, customer: first.party_name,
          part: parts.slice(0, 3).join(', ') + (parts.length > 3 ? ` +${parts.length - 3} more` : ''),
          qty: list.reduce((s, x) => s + (Number(x.quantity) || 0), 0),
          value: list.reduce((s, x) => s + (Number(x.total_amount) || 0), 0),
          date: list.map(x => x.inward_date).filter(Boolean).sort().reverse()[0] || first.inward_date,
          status: first.status,
          raw: list.length > 1 ? { ...first, _groupIds: list.map(x => x.id), _groupCount: list.length } : first,
        });
      });
    }

    // Quantities count every work order (dispatched ones too); only open ones become Finished Goods cards.
    const { data: allWos } = await supabase.from('cnc_work_orders').select('*');
    const fgs = allWos ? allWos.filter((w: any) => ['Completed', 'In Progress'].includes(String(w.status))) : allWos;
    const { data: dcs, error: dcErr } = await supabase.from('cnc_deliveries').select('*');
    if (dcErr) console.warn("Error fetching deliveries:", dcErr);
    let effectiveDcs: any[] = dcs && dcs.length > 0 ? dcs : [];

    let invoicesData: any[] = [];
    const { data: invs, error: invErr } = await supabase.from('cnc_invoices').select('*');
    if (invErr) console.error("Error fetching invoices:", invErr);
    else if (invs && invs.length > 0) invoicesData = invs;
    if (fgs) {
      // Same sales order = one card (like inward): group sibling FG rows so a
      // multi-product approval shows once with a per-product breakdown.
      const fgGroups = new Map<string, any[]>();
      fgs.filter(w => w.completed > 0 || w.status === 'Completed').forEach(w => {
        // Unique number only (raw sales_order/order numbers stay in backend).
        const key = orderMap.get(w.sales_order) || w.wo_no || `WO-${w.id.substring(0, 4)}`;
        if (!fgGroups.has(key)) fgGroups.set(key, []);
        fgGroups.get(key)!.push(w);
      });
      fgGroups.forEach((list, key) => {
        const first = list[0];
        const names = Array.from(new Set(list.map(x => x.part_name).filter(Boolean)));
        // Per-product order quantities (for remaining = ordered − finished).
        const soRow = (allOrders || []).find((o: any) => String(o.order_no ?? '') !== '' && (String(o.order_no) === String(first.sales_order ?? '') || String(o.lead_no ?? '') === String(key)));
        let itemQty: Record<string, number> = {};
        try {
          const rawItems = (soRow as any)?.items;
          const parsed = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
          if (Array.isArray(parsed)) parsed.forEach((it: any) => {
            const n = String(it.partName || it.productName || it.part_name || '').trim().toLowerCase();
            if (n) itemQty[n] = (itemQty[n] || 0) + (Number(it.quantity ?? it.qty) || 0);
          });
        } catch { /* per-product remaining unavailable */ }
        newCards.push({
          id: `fg_${first.id}`, stage: 'Finished Goods', type: 'finished_goods',
          refNo: key, customer: first.customer,
          part: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : ''),
          qty: list.reduce((s, x) => s + (Number(x.completed) || 0), 0), value: 0,
          date: list.map(x => x.created_at).filter(Boolean).sort().reverse()[0]?.split('T')[0] || '',
          status: first.status,
          raw: list.length > 1 ? { ...first, _groupIds: list.map(x => x.id), _groupCount: list.length, _groupRows: list, _itemQty: itemQty } : { ...first, _itemQty: itemQty },
        });
      });
    }

    const dcMap = new Map();
    // Same challan number = one card: group multi-product delivery rows.
    // Card shows the UNIQUE number (backend delivery_no stays stored); it
    // resolves through the linked sales order, else the legacy ref, else the
    // stamped project name. Raw backend numbers never display.
    const uniqueForDelivery = (d: any): string => {
      if (d?.sales_order_no && orderMap.get(d.sales_order_no)) return orderMap.get(d.sales_order_no);
      if (d?.sales_order_ref && orderMap.get(d.sales_order_ref)) return orderMap.get(d.sales_order_ref);
      if (d?.project_name) return d.project_name;
      return d?.delivery_no || '';
    };
    // Same challan number = one card: group multi-product delivery rows.
    const dcGroups = new Map<string, any[]>();
    effectiveDcs.forEach(d => {
      const key = d.delivery_no || orderMap.get(d.sales_order_no) || `DC-${d.id.substring(0, 4)}`;
      if (!dcGroups.has(key)) dcGroups.set(key, []);
      dcGroups.get(key)!.push(d);
    });
    dcGroups.forEach((list, key) => {
      const first = list[0];
      const ref = uniqueForDelivery(first);
      if (first.delivery_no) dcMap.set(first.delivery_no, ref);
      // A challan that has been invoiced has nothing left to do here: it moved on to Invoice.
      const billed = list.every(x => String(x.status ?? '') === 'Billed')
        || (invoicesData || []).some((inv: any) => String(inv.invoice_type ?? '') !== 'Proforma Invoice'
          && ((inv.delivery_id != null && list.some(x => String(x.id) === String(inv.delivery_id))) || (inv.dc_no && String(inv.dc_no) === String(first.delivery_no))));
      if (billed) return;
      const names = Array.from(new Set(list.map(x => x.part_name).filter(Boolean)));
      newCards.push({
        id: `dc_${first.id}`, stage: 'DC', type: 'dc', refNo: ref,
        customer: first.customer_name || first.party_name || 'Customer',
        part: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : ''),
        qty: list.reduce((s, x) => s + (Number(x.dispatch_qty ?? x.quantity) || 0), 0), value: 0,
        date: list.map(x => x.delivery_date).filter(Boolean).sort().reverse()[0] || first.delivery_date,
        status: first.status,
        raw: list.length > 1 ? { ...first, _groupIds: list.map(x => x.id), _groupCount: list.length } : first,
      });
    });

    if (invoicesData && invoicesData.length > 0) {
      // Card shows the UNIQUE number (backend invoice_no stays stored).
      const uniqueForInvoice = (inv: any): string => {
        if (inv?.sales_order_no && orderMap.get(inv.sales_order_no)) return orderMap.get(inv.sales_order_no);
        if (inv?.sales_order_id != null) {
          const o = (allOrders || []).find((x: any) => String(x.id) === String(inv.sales_order_id));
          if (o && o.order_no && orderMap.get(o.order_no)) return orderMap.get(o.order_no);
        }
        if (inv?.dc_no && dcMap.get(inv.dc_no)) return dcMap.get(inv.dc_no);
        return inv?.invoice_no || `INV-${String(inv.id).substring(0, 4)}`;
      };
      invoicesData.filter((inv: any) => !inv.pipeline_completed_at).forEach(inv => {
         const ref = uniqueForInvoice(inv);
         newCards.push({ id: inv.id, stage: 'Invoice', type: 'invoice', refNo: ref, customer: inv.customer_name || 'Customer', part: inv.item || inv.part_name || '-', qty: inv.quantity || 1, value: inv.amount || 0, date: inv.invoice_date || (inv.created_at ? inv.created_at.split('T')[0] : ''), status: inv.status, raw: inv });
      });
    }

    // ---- Order quantity reconciliation (single source of truth) ----
    // Summaries reconcile live rows: WO completed/rejected per sales order,
    // active deliveries, billable invoices and production batches. Rejected
    // quantity is visible for traceability, never as stock or billable qty.
    // Guarded: quantity extras must never blank the board on unexpected data.
    try {
    let batchesData: any[] = [];
    try {
      const { data: bq, error: bqErr } = await supabase.from('cnc_production_batches').select('*').limit(5000);
      if (!bqErr && bq) batchesData = bq;
    } catch { /* per-batch traceability unavailable; WO rows still reconcile */ }
    const qtyBySoNo = new Map<string, OrderQtySummary>();
    const qtyBySoId = new Map<string, OrderQtySummary>();
    (allOrders || []).forEach((o: any) => {
      const q = summarizeSalesOrder(o, allWos || [], effectiveDcs, invoicesData || [], batchesData);
      if (o.order_no) qtyBySoNo.set(String(o.order_no), q);
      if (o.id != null) qtyBySoId.set(String(o.id), q);
    });
    const qtyForDelivery = (d: any): OrderQtySummary | null => {
      if (d?.sales_order_id != null && qtyBySoId.has(String(d.sales_order_id))) return qtyBySoId.get(String(d.sales_order_id))!;
      if (d?.sales_order_no && qtyBySoNo.has(String(d.sales_order_no))) return qtyBySoNo.get(String(d.sales_order_no))!;
      return null;
    };
    const qtyForInvoice = (inv: any): OrderQtySummary | null => {
      if (inv?.sales_order_id != null && qtyBySoId.has(String(inv.sales_order_id))) return qtyBySoId.get(String(inv.sales_order_id))!;
      const dc = (effectiveDcs || []).find((dd: any) =>
        (inv?.delivery_id != null && String(dd.id) === String(inv.delivery_id)) ||
        (inv?.dc_no && String(dd.delivery_no) === String(inv.dc_no)));
      if (dc) return qtyForDelivery(dc);
      return null;
    };
    for (const c of newCards) {
      if (c.type === 'order' && c.raw?.order_no && qtyBySoNo.has(String(c.raw.order_no))) {
        c.qtyTrack = qtyBySoNo.get(String(c.raw.order_no))!;
      } else if (c.type === 'finished_goods' && c.raw?.sales_order) {
        c.qtyTrack = qtyBySoNo.get(String(c.raw.sales_order)) ?? null;
      } else if (c.type === 'dc') {
        c.qtyTrack = qtyForDelivery(c.raw);
      } else if (c.type === 'invoice') {
        c.qtyTrack = qtyForInvoice(c.raw);
      } else if (c.type === 'inward') {
        // Resolve the sales order (by ref, else by base unique number) so the
        // card uses the centralized reconciliation, not a parallel calculation.
        const rows = Array.isArray(c.raw?._groupIds) && c.raw._groupIds.length
          ? (inwards || []).filter((x: any) => c.raw._groupIds.includes(x.id))
          : [c.raw];
        const ref = String(rows.map((r: any) => r?.sales_order_ref).find(Boolean) ?? '');
        let hit: OrderQtySummary | null = ref && qtyBySoNo.has(ref) ? qtyBySoNo.get(ref)! : null;
        if (!hit) {
          const base = baseUniqueNo(rows[0]?.project_name || '');
          const o = base !== '' ? (allOrders || []).find((x: any) => baseUniqueNo(x.lead_no || '') === base) : null;
          if (o) hit = (o.order_no && qtyBySoNo.get(String(o.order_no))) || (o.id != null && qtyBySoId.get(String(o.id))) || null;
        }
        c.qtyTrack = hit;
        // Per-product inward remaining: received per part vs finished (work
        // orders scoped to the same base unique number).
        const bases = new Set([baseUniqueNo(c.refNo)]);
        const fin = new Map<string, number>();
        for (const w of (allWos || [])) {
          const rawKey = orderMap.get(w.sales_order) || w.sales_order || '';
          const b = rawKey ? baseUniqueNo(rawKey) : '';
          if (b !== '' && !bases.has(b)) continue;
          const n = String(w.part_name ?? '').trim().toLowerCase();
          if (!n) continue;
          fin.set(n, (fin.get(n) ?? 0) + (Number(w.completed) || 0));
        }
        const byName = new Map<string, { name: string; recv: number }>();
        rows.forEach((x: any) => {
          const n = String(x?.part_name || x?.product_name || '').trim() || '—';
          const e = byName.get(n.toLowerCase()) ?? { name: n, recv: 0 };
          e.recv += Number(x?.quantity) || 0;
          byName.set(n.toLowerCase(), e);
        });
        c.raw._inwardProd = [...byName.values()].map((e) => {
          const done = fin.get(e.name.toLowerCase()) ?? 0;
          return { name: e.name, recv: e.recv, done, left: Math.max(0, e.recv - done) };
        });
      }
    }
    } catch (e) {
      console.error('Quantity reconciliation failed; showing cards without quantity extras:', e);
    }

    try {
      let comms: any[] = [];
      const { data, error: commErr } = await supabase.from('cnc_pipeline_comments').select('record_id');
      if (data && !commErr) {
        comms = data;
      } else {
        comms = JSON.parse(localStorage.getItem('cnc_pipeline_comments') || '[]');
      }
      
      const counts: Record<string, number> = {};
      comms.forEach(c => {
         counts[c.record_id] = (counts[c.record_id] || 0) + 1;
      });
      setCommentCounts(counts);
    } catch {
      const comms = JSON.parse(localStorage.getItem('cnc_pipeline_comments') || '[]');
      const counts: Record<string, number> = {};
      comms.forEach((c: any) => {
         counts[c.record_id] = (counts[c.record_id] || 0) + 1;
      });
      setCommentCounts(counts);
    }

    // An inward whose order is fully produced (nothing remaining) leaves the board;
    // it is listed under the company's History instead.
    // One card per order: once every product of a sales order has been inwarded, its Sales Order card
    // leaves the board (the Inward card carries it on). If the inward is deleted it comes back.
    const liveInwards = (inwards || []).filter((i: any) => !String(i.category || '').trim().toUpperCase().startsWith('EXPENSE'));
    const inwardSoRefs = new Set(liveInwards.map((i: any) => String(i.sales_order_ref || '').trim().toLowerCase()).filter(Boolean));
    const inwardBases = new Set(liveInwards.map((i: any) => baseUniqueNo(i.project_name || '')).filter(Boolean));
    const inwardNames = new Set(liveInwards.flatMap((i: any) => [i.product_name, i.part_name]).map((n: any) => getProductBaseName(String(n || '')).toLowerCase()).filter(Boolean));
    const orderInwarded = (o: any): boolean => {
      const linked = inwardSoRefs.has(String(o?.order_no || '').trim().toLowerCase())
        || (!!baseUniqueNo(o?.lead_no || '') && inwardBases.has(baseUniqueNo(o.lead_no)));
      if (!linked) return false;
      let names: string[] = [];
      try {
        const raw = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
        if (Array.isArray(raw)) names = raw.map((it: any) => String(it.partName || it.productName || it.part_name || '').trim()).filter(Boolean);
      } catch { /* single product */ }
      return names.length === 0 || names.every(n => inwardNames.has(getProductBaseName(n).toLowerCase()));
    };
    setCards(newCards.filter(c => {
      if (c.type === 'order' && orderInwarded(c.raw)) return false;
      if (c.type !== 'inward') return true;
      if (c.qtyTrack && c.qtyTrack.ordered > 0) return c.qtyTrack.remaining > 0;
      // No linked sales order: everything received has been produced when no product has any left.
      const prod = ((c.raw as any)?._inwardProd ?? []) as { recv: number; left: number }[];
      return !(prod.length > 0 && prod.some(x => x.recv > 0) && prod.every(x => x.left <= 0));
    }));
    } catch (err) {
      console.error("Error loading pipeline:", err);
    } finally {
      void refreshSavedProducts(true); // a product saved just now is offered in every product field
      setLoading(false);
    }
  };

  const fetchRecentActivities = async () => {
    const activities: any[] = [];
    
    const { data: recentEnq } = await supabase.from('cnc_enquiries').select('enquiry_no, customer, status, created_at').order('created_at', { ascending: false }).limit(3);
    if (recentEnq) recentEnq.forEach(r => activities.push({ type: 'enquiry', ref: r.enquiry_no, customer: r.customer, action: r.status === 'New' ? 'received' : r.status?.toLowerCase() || 'updated', time: r.created_at, color: 'bg-blue-500' }));

    const { data: recentQuotes } = await supabase.from('cnc_quotations').select('quote_no, customer, status, created_at').order('created_at', { ascending: false }).limit(3);
    if (recentQuotes) recentQuotes.forEach(r => activities.push({ type: 'quotation', ref: r.quote_no, customer: r.customer, action: (r.status === 'Converted' || r.status === 'Accepted') ? 'accepted' : 'sent', time: r.created_at, color: 'bg-purple-500' }));

    const { data: recentSO } = await supabase.from('cnc_sales_orders').select('order_no, customer, status, created_at').order('created_at', { ascending: false }).limit(3);
    if (recentSO) recentSO.forEach(r => activities.push({ type: 'sales_order', ref: r.order_no, customer: r.customer, action: 'confirmed', time: r.created_at, color: 'bg-emerald-500' }));

    const { data: recentInw } = await supabase.from('cnc_inwards').select('inward_no, party_name, status, created_at').order('created_at', { ascending: false }).limit(3);
    if (recentInw) recentInw.forEach(r => activities.push({ type: 'inward', ref: r.inward_no, customer: r.party_name, action: 'received', time: r.created_at, color: 'bg-orange-500' }));

    const { data: recentDC } = await supabase.from('cnc_deliveries').select('delivery_no, customer_name, status, created_at').order('created_at', { ascending: false }).limit(3);
    if (recentDC) recentDC.forEach(r => activities.push({ type: 'dc', ref: r.delivery_no, customer: r.customer_name, action: 'dispatched', time: r.created_at, color: 'bg-rose-500' }));

    try {
      const { data: recentInv } = await supabase.from('cnc_invoices').select('invoice_no, customer_name, status, created_at').order('created_at', { ascending: false }).limit(3);
      if (recentInv) recentInv.forEach(r => activities.push({ type: 'invoice', ref: r.invoice_no, customer: r.customer_name, action: 'generated', time: r.created_at, color: 'bg-indigo-500' }));
    } catch (err) { console.error("Error fetching recent invoices:", err); }

    // Sort all by time descending and take top 5
    activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    setRecentActivities(activities.slice(0, 5));
  };

  useEffect(() => {
    fetchPipeline();
    fetchRecentActivities();
  }, [company?.id]);

  const parseContacts = (raw: any) => {
    if (!raw) return [{ person: '', phone: '', email: '' }];
    const persons = (raw.contact_person || '').split(' | ').map((s: string) => s.trim());
    const phones = (raw.phone || '').split(' | ').map((s: string) => s.trim());
    const emails = (raw.email || '').split(' | ').map((s: string) => s.trim());
    const maxLen = Math.max(persons.length, phones.length, emails.length, 1);
    const parsed = Array.from({ length: maxLen }).map((_, i) => ({ person: persons[i] || '', phone: phones[i] || '', email: emails[i] || '' }));
    const hasData = parsed.some(c => c.person || c.phone || c.email);
    return hasData ? parsed : [{ person: '', phone: '', email: '' }];
  };

  const handleCompanyChange = (val: string) => {
    setEnquiryForm((prev: any) => {
      const form = { ...prev, company: val };
      const matched = allKnownCompanies.find(c => c.company.toLowerCase() === val.toLowerCase());
      if (matched) {
        form.contacts = parseContacts(matched);
      }
      return form;
    });
  };

    const handleCompleteInvoice = async (card: KanbanCard) => {
      if (!window.confirm(`Mark "${card.refNo}" as complete? This will save the full deal history under the company record.`)) return;
      setLoading(true);
      try {
        // 1. Collect all the lineage data for this invoice
        const invoiceData = card.raw;
        const customer = card.customer;

        // Try to find the full chain: invoice -> DC -> FG -> Inward -> SO -> Quotation -> Enquiry
        const soRef = invoiceData.sales_order_no || '';
        let leadNo = '';
        let leadId = '';
        const totalValue = Number(invoiceData.amount) || 0;
        let parts: any[] = [];

        // Find SO
        if (soRef) {
          const { data: so } = await supabase.from('cnc_sales_orders').select('*').eq('order_no', soRef).single();
          if (so) {
            if (so.items && Array.isArray(so.items)) parts = so.items;
            leadNo = so.lead_no || '';
            if (so.quotation_id) {
              const { data: qt } = await supabase.from('cnc_quotations').select('*').eq('id', so.quotation_id).single();
              if (qt && qt.lead_id) {
                leadId = qt.lead_id;
                leadNo = qt.enquiry_no || leadNo;
              }
            }
          }
        }

        // If we still don't have a lead, try to find by customer name
        if (!leadId && customer) {
          const { data: enq } = await supabase.from('cnc_enquiries').select('id, lead_no').eq('customer', customer).order('created_at', { ascending: false }).limit(1).single();
          if (enq) { leadId = enq.id; leadNo = enq.lead_no || leadNo; }
        }

        // 2. Save purchase history record
        const historyRecord = {
          id: crypto.randomUUID(),
          customer: customer,
          lead_id: leadId || null,
          lead_no: leadNo || '',
          invoice_no: card.refNo,
          invoice_date: invoiceData.invoice_date || invoiceData.created_at || new Date().toISOString(),
          part_name: card.part || invoiceData.part_name || '',
          quantity: Number(card.qty) || 0,
          total_value: totalValue,
          parts: parts.length > 0 ? parts : null,
          sales_order_ref: soRef || '',
          completed_at: new Date().toISOString()
        };

        // Try to insert into purchase_history table, if it doesn't exist we'll store in enquiry remarks
        const { error: histErr } = await supabase.from('cnc_purchase_history').insert([historyRecord]);
        
        if (histErr) {
          // Table doesn't exist yet - store as JSON in enquiry's remarks field instead
          if (leadId) {
            const { data: existingEnq } = await supabase.from('cnc_enquiries').select('remarks').eq('id', leadId).single();
            let existingHistory: any[] = [];
            try { if (existingEnq?.remarks) existingHistory = JSON.parse(existingEnq.remarks); } catch { existingHistory = []; }
            if (!Array.isArray(existingHistory)) existingHistory = [];
            existingHistory.push(historyRecord);
            await supabase.from('cnc_enquiries').update({ remarks: JSON.stringify(existingHistory), status: 'Converted' }).eq('id', leadId);
          }
        }

        // Completion is pipeline history metadata; invoice payment status stays derived
        // from the same receipt records shown on the Invoices and Bank & Cash pages.
        const { error: completionError } = await supabase.from('cnc_invoices')
          .update({ pipeline_completed_at: new Date().toISOString() }).eq('id', card.raw.id);
        if (completionError) throw completionError;

        fetchPipeline();
      } catch (err: any) {
        alert("Error completing invoice: " + err.message);
      }
      setLoading(false);
    };

    const handleDeleteCard = async (e: React.MouseEvent, card: KanbanCard) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete this ${card.type}?`)) return;
    let table = '';
    if (card.type === 'lead') table = 'cnc_enquiries';
    if (card.type === 'quotation') table = 'cnc_quotations';
    if (card.type === 'order') table = 'cnc_sales_orders';
    if (card.type === 'inward') table = 'cnc_inwards';
    if (card.type === 'finished_goods') table = 'cnc_work_orders';
    if (card.type === 'dc') table = 'cnc_deliveries';
    if (card.type === 'invoice') table = 'cnc_invoices';

    if (table) {
      setLoading(true);
      const ids = Array.isArray((card.raw as any)?._groupIds) && (card.raw as any)._groupIds.length
        ? (card.raw as any)._groupIds.filter(Boolean)
        : [card.raw.id];
      // .select() returns the rows that were actually removed, so a silent no-op (permissions) is caught.
      const del = await supabase.from(table).delete().in('id', ids).select('id');
      const error = del.error ?? ((del.data ?? []).length === 0 ? { message: 'Nothing was deleted (the record may be protected or already gone).' } : null);
      if (error) alert("Error deleting: " + error.message);
      else {
        // A deleted finished-goods record takes its production batches with it. Left behind, they kept
        // counting the old rejected / gross quantities on the order and inward cards.
        if (card.type === 'finished_goods') {
          try {
            const uuids = ids.map(String).filter((v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));
            if (uuids.length) await supabase.from('cnc_production_batches').delete().in('work_order_id', uuids);
          } catch (e) { console.error('Batch clean-up after finished goods delete failed:', e); }
        }
        // A deleted challan returns its goods to Finished Goods and un-counts them on the order.
        if (card.type === 'dc') {
          try {
            const soNo = String((card.raw as any)?.sales_order_no || '');
            if (soNo) {
              await supabase.from('cnc_work_orders').update({ status: 'Completed' }).eq('sales_order', soNo).eq('status', 'Dispatched');
              const soR = await supabase.from('cnc_sales_orders').select('id,quantity').eq('order_no', soNo).maybeSingle();
              if (!soR.error && soR.data) {
                const dR = await supabase.from('cnc_deliveries').select('dispatch_qty,quantity,status').eq('sales_order_no', soNo);
                const act = ((dR.error ? [] : dR.data) ?? []).filter((d: any) => !['Cancelled', 'Returned', 'Return'].includes(String(d?.status ?? '')));
                const delivered = act.reduce((s: number, d: any) => s + (Number(d?.dispatch_qty ?? d?.quantity) || 0), 0);
                const qty0 = Number((soR.data as any).quantity) || 0;
                await supabase.from('cnc_sales_orders').update({
                  delivered, status: delivered >= qty0 && qty0 > 0 ? 'Delivered' : delivered > 0 ? 'Partially Delivered' : 'Confirmed',
                }).eq('id', (soR.data as any).id);
              }
            }
          } catch (e) { console.error('DC delete follow-up failed:', e); }
        }
        fetchPipeline();
      }
      setLoading(false);
    }
  };

  const getContactStrings = (form: any) => {
    const contacts = form.contacts || [];
    return {
      person: contacts.map((c: any) => c.person).join(' | '),
      phone: contacts.map((c: any) => c.phone).join(' | '),
      email: contacts.map((c: any) => c.email).join(' | '),
    };
  };

  // Finished Goods cards open the Finished Goods + Costing popup (view / edit), built from the order's inward lines.
  const openFgPopup = async (card: KanbanCard, mode: 'edit' | 'view') => {
    const rows: any[] = Array.isArray((card.raw as any)?._groupRows) && (card.raw as any)._groupRows.length ? (card.raw as any)._groupRows : [card.raw];
    const soNo = String(rows.map((w: any) => w?.sales_order).find(Boolean) ?? '');
    let ids: string[] = [];
    try {
      const r = await supabase.from('cnc_inwards').select('*').neq('status', 'Deleted');
      if (!r.error) {
        const base = baseUniqueNo(card.refNo);
        ids = (r.data ?? []).filter((x: any) => (soNo && String(x.sales_order_ref ?? '') === soNo) || (base !== '' && baseUniqueNo(x.project_name || '') === base)).map((x: any) => String(x.id));
      }
    } catch { /* the popup falls back to the order's products */ }
    setCostingMode(mode);
    setCostingModalTarget({
      ...card, stage: 'Inward', type: 'inward',
      raw: { ...(card.raw as any), id: ids[0] ?? (card.raw as any)?.id, sales_order_ref: soNo, project_name: card.refNo, _groupIds: ids },
    } as KanbanCard);
  };

  // Edit / Delete from the stage lists reuse the board's own edit view and delete (a record without a card gets one built from it).
  useEffect(() => { setListRefresh(n => n + 1); }, [cards]);

  // Add a record of a stage: the same form the board's "Add ..." button opens, also used by the stage lists.
  // The Kanban board's "Add" buttons open their form as a popup again. While the entry
  // forms were made inline they were pointed at the list pages (where the same forms now
  // sit inline above their tables); this puts the popup behaviour back for the board.
  // It reuses the very same renderXEntryForm() JSX and save handlers - the list pages,
  // their entryForm props and their inline rendering are deliberately untouched.
  const [addPopup, setAddPopup] = useState<null | 'Enquiry' | 'Sales Order' | 'Inward' | 'DC'>(null);
  const addPopupTitle = (stage: string): string => ({
    'Enquiry': 'New Enquiry',
    'Sales Order': 'New Sales Order',
    'Inward': 'New Inward Entry',
    'DC': 'New Delivery Challan',
  } as Record<string, string>)[stage] || 'New Entry';

  // Access control: a list/board view the user may not see bounces back to
  // the pipeline (which itself is route-guarded). Only runs once permissions load.
  const ACTIVE_VIEW_MODULE: Record<string, string> = {
    enquiry_list: 'enquiries', quotation_list: 'quotations', sales_order_list: 'sales-orders',
    inward_list: 'inward', rejected_list: 'rejected', fg_list: 'finished-goods',
    dc_list: 'delivery', invoice_list: 'invoices',
  };
  useEffect(() => {
    const m = ACTIVE_VIEW_MODULE[activeView];
    if (m && permissions && !canView(m)) setActiveView('pipeline');
    if (activeView === 'pipeline' && pipelineViewMode === 'companies' && permissions && !canView('companies')) {
      setPipelineViewMode('kanban');
    }
  }, [activeView, pipelineViewMode, permissions, canView]);

  // Cards visible in List/Calendar views (same rule as Kanban columns below).
  const visibleCards = useMemo(
    () => boardCards.filter((c) => canView(STAGE_MODULE[c.stage] ?? 'sales-pipeline')),
    [boardCards, canView],
  );

  const addForStage = (stageId: string) => {
                    if (stageId === 'Enquiry') { setEnquiryForm(resetEnquiryForm()); setDuplicateSource(null); setEnquirySaveNotice(null); setAddPopup('Enquiry'); }
                    else if (stageId === 'Quotation') {
                      setQuoteForm({
                        quoteNo: `QT-2026-${Math.floor(1000 + Math.random() * 9000)}`, customer: '', leadNo: '', quoteDate: new Date().toISOString().split('T')[0], validTill: '', salesperson: userName, contacts: [{ person: '', phone: '', email: '' }], partName: '', partNumber: '', description: '', quantity: '', unitPrice: '', discount: '0', unitDiscount: '0', gst: '18',
                        items: [{ id: crypto.randomUUID(), partName: '', partNumber: '', quantity: '', unitPrice: '', discount: '0', unitDiscount: '0', gst: '18' }],
                        paymentTerms: '', deliveryTerms: '', remarks: ''
                      });
                      setQuotationModalTarget({ id: 'dummy', stage: 'Enquiry', type: 'lead', refNo: '', customer: '', part: '', qty: 1, value: 0, date: '', raw: {} });
                    } else if (stageId === 'Sales Order') {
                      setSoForm(resetSoForm());
                      setSoSaveNotice(null);
                      setAddPopup('Sales Order');
                    } else if (stageId === 'Inward') {
                      openDummyInward();
                      setAddPopup('Inward');
                    } else if (stageId === 'Finished Goods') {
                      // Add Finished Good: the Finished Goods + Costing form opens first; company and product are chosen inside it.
                      setCostingMode('add');
                      setCostingModalTarget(makeFgPickTarget());
                    } else if (stageId === 'DC') {
                      setDcForm(makeDcBlankForm());
                      setDcItems(makeDcBlankItems());
                      setDcSnapshot(null);
                      setDcModalTarget(DC_ENTRY_TARGET);
                      setDcSaveNotice(null);
                      setAddPopup('DC');
                    } else if (stageId === 'Invoice') {
                      setInvoiceForm({
                        invoiceNo: '', partyName: '', dcNumber: '', date: new Date().toISOString().split('T')[0], partName: '', quantity: '', price: '', cgst: '', sgst: '', igst: ''
                      });
                      setInvoiceModalTarget({ id: 'dummy', stage: 'DC', type: 'dc', refNo: '', customer: '', part: '', qty: 1, value: 0, date: '', raw: {} });
                    }
  };

  const listCard = (type: KanbanCard['type'], stage: Stage, record: any, grouped: boolean): KanbanCard => {
    const found = grouped ? cards.find(c => c.type === type && (String((c.raw as any)?.id) === String(record.id) || ((c.raw as any)?._groupIds ?? []).includes(record.id))) : null;
    if (found) return found;
    return {
      id: `${type}_${record.id}`, stage, type, raw: record,
      refNo: record.lead_no || record.enquiry_no || record.quote_no || record.order_no || record.wo_no || record.delivery_no || record.inward_no || '',
      customer: record.customer || record.customer_name || record.party_name || '', part: record.part_name || '', qty: Number(record.quantity) || 0, value: 0, date: '',
    } as KanbanCard;
  };
  // View from a stage list opens the same view as the eye icon on the board card.
  const listView = (type: KanbanCard['type'], stage: Stage) => (record: any) => {
    const card = listCard(type, stage, record, true);
    setViewEditMode(false);
    if (type === 'finished_goods') { void openFgPopup(card, 'view'); return; }
    void openViewModal(card);
  };
  const listEdit = (type: KanbanCard['type'], stage: Stage) => (record: any) => {
    const card = listCard(type, stage, record, true);
    if (type === 'finished_goods') { void openFgPopup(card, 'edit'); return; }
    setViewEditMode(true);
    void openViewModal(card);
  };
  // Delete removes exactly the row that was clicked, never a whole grouped card.
  const listDelete = (type: KanbanCard['type'], stage: Stage) => async (record: any) => {
    await handleDeleteCard({ stopPropagation() { /* not a click event */ } } as unknown as React.MouseEvent, listCard(type, stage, record, false));
    setListRefresh(n => n + 1);
  };

  const openViewModal = async (card: KanbanCard) => {
    if (card.type === 'finished_goods') { void openFgPopup(card, 'view'); return; }
    setViewModalTarget(card);
    setLoading(true);
    const aggregated: any = { enquiry: null, quotation: null, order: null, inward: null, finished_goods: null, dc: null, invoice: null };
      const parseItems = (rawObj: any, field: string) => {
        if (!rawObj || !rawObj[field]) return;
        try { const parsed = JSON.parse(rawObj[field]); if (Array.isArray(parsed)) rawObj.items = parsed; } catch { /* not JSON */ }
      };
    try {
      if (card.type === 'inward') {
        aggregated.inward = card.raw;
        if (Array.isArray((card.raw as any)._groupIds) && (card.raw as any)._groupIds.length > 1) {
          try {
            const { data: groupRows } = await supabase.from('cnc_inwards').select('*').in('id', (card.raw as any)._groupIds).order('created_at', { ascending: true });
            if (groupRows && groupRows.length > 1) aggregated.inwards = groupRows;
          } catch { /* single-record fallback below */ }
        }
        // Backfill a missing product link for display only, when unambiguous:
        // rows saved before product_name existed recover it from a single-product enquiry.
        try {
          const scope = (Array.isArray(aggregated.inwards) && aggregated.inwards.length ? aggregated.inwards : [aggregated.inward]).filter(Boolean);
          const lacking = scope.filter((r: any) => !r.product_name && r.project_name);
          if (lacking.length) {
            const baseOf = (s: any) => String(s || '').replace(/-\d{2}[A-Za-z]{3}\d{2}-\d{4}(AM|PM)$/, '');
            const bases = Array.from(new Set(lacking.map((r: any) => baseOf(r.project_name)).filter(Boolean))) as string[];
            if (bases.length) {
              const { data: enqs } = await supabase.from('cnc_enquiries').select('lead_no,enquiry_no,part_name,enquiring_for').in('lead_no', bases);
              const byBase = new Map((enqs || []).map((e: any) => [String(e.lead_no || e.enquiry_no), e]));
              lacking.forEach((r: any) => {
                const marker = /\[Product:\s*([^\]]+)\]/.exec(String(r.remarks || ''));
                if (marker && marker[1].trim()) { r.product_name = marker[1].trim(); return; }
                const e = byBase.get(baseOf(r.project_name));
                if (!e) return;
                let names: string[] = [];
                try {
                  const parsed = typeof e.enquiring_for === 'string' ? JSON.parse(e.enquiring_for) : e.enquiring_for;
                  if (Array.isArray(parsed)) names = parsed.map((it: any) => String(it.productName || it.partName || it.part_name || '').trim()).filter(Boolean);
                } catch { /* plain text */ }
                if (!names.length && e.part_name) names = [String(e.part_name).trim()];
                if (names.length === 1 && names[0]) r.product_name = names[0];
              });
            }
          }
        } catch { /* dashes stay dashes */ }
        if (card.raw.sales_order_ref) {
           const { data: ord } = await supabase.from('cnc_sales_orders').select('*').eq('order_no', card.raw.sales_order_ref).single();
           if (ord) {
             aggregated.order = ord;
             if (ord.quotation_id) {
               const { data: qt } = await supabase.from('cnc_quotations').select('*').eq('id', ord.quotation_id).single();
               if (qt) {
                 aggregated.quotation = qt;
                 if (qt.lead_id) {
                   const { data: enq } = await supabase.from('cnc_enquiries').select('*').eq('id', qt.lead_id).single();
                   if (enq) aggregated.enquiry = enq;
                 }
               }
             }
           }
        }
      } else if (card.type === 'order') {
        aggregated.order = card.raw;
        if (card.raw.quotation_id) {
           const { data: qt } = await supabase.from('cnc_quotations').select('*').eq('id', card.raw.quotation_id).single();
           if (qt) {
             aggregated.quotation = qt;
             if (qt.lead_id) {
               const { data: enq } = await supabase.from('cnc_enquiries').select('*').eq('id', qt.lead_id).single();
               if (enq) aggregated.enquiry = enq;
             }
           }
        }
      } else if (card.type === 'quotation') {
        aggregated.quotation = card.raw;
        if (card.raw.lead_id) {
           const { data: enq } = await supabase.from('cnc_enquiries').select('*').eq('id', card.raw.lead_id).single();
           if (enq) aggregated.enquiry = enq;
        }
      } else if (card.type === 'lead') {
        aggregated.enquiry = card.raw;
      } else if (card.type === 'finished_goods') {
        aggregated.finished_goods = card.raw;
        if (card.raw.sales_order) {
          try {
            const { data: ord } = await supabase.from('cnc_sales_orders').select('*').eq('order_no', card.raw.sales_order).maybeSingle();
            if (ord) aggregated.order = ord;
          } catch { /* order linkage stays empty */ }
        }
      } else if (card.type === 'dc') {
        aggregated.dc = card.raw;
        // Sibling rows of the same challan number render as one multi-line bill.
        try {
          const dcNo = String(card.raw?.delivery_no || '').trim();
          if (dcNo) {
            const { data: sibs } = await supabase.from('cnc_deliveries').select('*').eq('delivery_no', dcNo).order('created_at', { ascending: true });
            if (sibs && sibs.length > 1) aggregated.dcRows = sibs;
          }
        } catch { /* single-row fallback below */ }
        // Optionally try to fetch order if we had a sales order id
        if (card.raw.sales_order_no) {
           const { data: ord } = await supabase.from('cnc_sales_orders').select('*').eq('order_no', card.raw.sales_order_no).single();
           if (ord) aggregated.order = ord;
        }
      } else if (card.type === 'invoice') {
        aggregated.invoice = card.raw;
        try {
          const { data: invItems } = await supabase.from('cnc_invoice_items').select('description,quantity,unit,rate,hsn,gst_rate,amount').eq('invoice_id', card.raw.id).order('line_no');
          if (invItems && invItems.length) {
            aggregated.invoice = {
              ...card.raw,
              items: invItems.map((r: any) => ({
                partName: r.description, quantity: r.quantity, unit: r.unit,
                unitPrice: r.rate, rate: r.rate, hsn: r.hsn, gst_rate: r.gst_rate, amount: r.amount,
              })),
            };
          }
        } catch { /* header-only fallback */ }
        // Source lineage: Quotation → Sales Order → Finished Goods → DC → Invoice.
        try {
          let dc: any = null;
          if (card.raw.delivery_id) {
            const { data } = await supabase.from('cnc_deliveries').select('*').eq('id', card.raw.delivery_id).limit(1);
            dc = (data ?? [])[0] ?? null;
          }
          if (!dc && card.raw.dc_no) {
            const { data } = await supabase.from('cnc_deliveries').select('*').eq('delivery_no', card.raw.dc_no).limit(1);
            dc = (data ?? [])[0] ?? null;
          }
          if (dc) {
            aggregated.dc = dc;
            const soNo = dc.sales_order_no || dc.sales_order_ref;
            if (soNo) {
              const { data: ord } = await supabase.from('cnc_sales_orders').select('*').eq('order_no', soNo).limit(1);
              if ((ord ?? []).length > 0) {
                aggregated.order = ord![0];
                if (ord![0].quotation_id) {
                  const { data: qt } = await supabase.from('cnc_quotations').select('*').eq('id', ord![0].quotation_id).limit(1);
                  if ((qt ?? []).length > 0) aggregated.quotation = qt![0];
                }
              }
            }
          } else if (card.raw.sales_order_id) {
            const { data: ord } = await supabase.from('cnc_sales_orders').select('*').eq('id', card.raw.sales_order_id).limit(1);
            if ((ord ?? []).length > 0) {
              aggregated.order = ord![0];
              if (ord![0].quotation_id) {
                const { data: qt } = await supabase.from('cnc_quotations').select('*').eq('id', ord![0].quotation_id).limit(1);
                if ((qt ?? []).length > 0) aggregated.quotation = qt![0];
              }
            }
          }
        } catch { /* lineage stays empty */ }
      }
    } catch (e) {
       console.error("Error fetching lineage", e);
    }
    if (aggregated.enquiry) parseItems(aggregated.enquiry, 'enquiring_for');
      if (aggregated.quotation) parseItems(aggregated.quotation, 'description');
      // Quantity tracking: one reconciliation (good / rejected / remaining /
      // FG available / delivered / invoiced) shared by every stage view.
      try {
        const soRef = String(aggregated.order?.order_no || '');
        const soId = aggregated.order?.id != null ? String(aggregated.order.id) : null;
        if (soRef || soId) {
          const { summary } = await fetchOrderQty(soId, soRef);
          if (summary) (aggregated as any).qtyTracking = summary;
        }
      } catch { /* details stay backward-compatible */ }
      setViewModalData(aggregated);
    
    // Load mock images for all records in the pipeline history
    const loaded: Record<string, string> = {};
    for (const k of Object.keys(aggregated)) {
      const rec = aggregated[k];
      if (rec) {
        const key = rec.part_name || rec.id;
        if (key) {
          const u = await getMockImage(key);
          if (u) loaded[key] = u;
        }
      }
    }
    setMockImages(prev => ({ ...prev, ...loaded }));
    
    setLoading(false);
  };

  // Delete inward rows from the details window. The rows are removed from the database (the price and cost
  // calculations read them), and the board is refreshed from the database afterwards.
  const deleteInwardRows = async (ids: string[], what: string) => {
    const real = ids.filter(Boolean);
    if (!real.length) return;
    if (!window.confirm(`Delete ${what}? It is removed permanently and the totals are recalculated.`)) return;
    const del = await supabase.from('cnc_inwards').delete().in('id', real).select('id');
    if (del.error) { alert('Error deleting: ' + del.error.message); return; }
    if ((del.data ?? []).length !== real.length) {
      alert(`Only ${(del.data ?? []).length} of ${real.length} row(s) were deleted. The rest may be protected; nothing else was changed.`);
    }
    setViewModalTarget(null); setViewEditMode(false);
    fetchPipeline();
  };

  const closeViewModal = () => {
    setViewModalTarget(null);
    setViewModalData(null);
    setViewEditMode(false);
    soSaveRef.current = null;
    enquirySaveRef.current = null;
    dcSaveRef.current = null;
  };

  const handleDragStart = (e: React.DragEvent, card: KanbanCard) => {
    e.dataTransfer.setData('text/plain', String(card.id));
    setDraggedCard(card);
  };

  /**
   * The single stage-transition routine for the whole pipeline. Drag & drop and the
   * checkbox "Move to Next Stage" action both land here, so validation, the forms and
   * costing gates some transitions open, quantity reconciliation and every backend
   * write are shared - there is deliberately no second transition path.
   */
  const moveCardToStage = async (card: KanbanCard, toStage: Stage): Promise<boolean> => {
    if (card.stage === toStage) return false;

    try {

    if (card.type === 'lead' && toStage === 'Quotation') {
      const qNo = `QT-2026-${Math.floor(1000 + Math.random() * 9000)}`;
      // Parse individual parts from the lead's enquiring_for JSON
      let parsedParts: any[] = [];
      try {
        const raw = card.raw.enquiring_for;
        if (raw) {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) parsedParts = parsed;
        }
      } catch { /* not valid JSON */ }
      
      // Build items array with individual pricing fields per part
      const quoteItems = parsedParts.length > 0 
        ? parsedParts.map((p: any) => ({
            id: crypto.randomUUID(),
            partName: p.partName || p.part_name || '',
            partNumber: p.partNumber || p.part_number || '',
            quantity: (p.quantity || p.qty || '0').toString(),
            filePaths: Array.isArray(p.filePaths) ? p.filePaths : [],
            unitPrice: '',
            discount: '0',
            unitDiscount: '0',
            gst: '18'
          }))
        : [{
            id: crypto.randomUUID(),
            partName: card.part || '',
            partNumber: card.raw.part_no !== 'N/A' ? (card.raw.part_no || '') : '',
            quantity: card.qty?.toString() || '',
            unitPrice: '',
            discount: '0',
            unitDiscount: '0',
            gst: '18',
            files: [],
            filePaths: []
          }];

      setQuoteForm({
        quoteNo: qNo, customer: card.customer, leadNo: card.refNo, quoteDate: new Date().toISOString().split('T')[0], validTill: card.date || '', salesperson: userName,
        contacts: parseContacts(card.raw),
        items: quoteItems,
        paymentTerms: '', deliveryTerms: '', remarks: ''
      });
      setQuotationModalTarget(card);
    } else if (card.type === 'quotation' && toStage === 'Sales Order') {
      const oNo = `SO-2026-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const q = Number(card.qty) || 0;
      let p = Number(card.raw.unit_price) || 0;
      if (!p && card.value && card.qty) {
        const d = Number(card.raw.discount_percent) || 0;
        const ud = Number(card.raw.unit_discount) || 0;
        const g = Number(card.raw.gst_percent) || 0;
        p = Number(((card.value / (q * (1 + g/100)) + ud) / (1 - d/100 || 1)).toFixed(2));
      }
      
      const item = {
         id: crypto.randomUUID(),
         partName: card.part,
         partNumber: card.raw.part_number || '',
         description: card.raw.description || '',
         quantity: q.toString(),
         unitPrice: p.toString(),
         discount: (card.raw.discount_percent || 0).toString(),
         unitDiscount: (card.raw.unit_discount || 0).toString(),
         gst: (card.raw.gst_percent || 18).toString(),
         filePaths: Array.isArray((card.raw as any).filePaths) ? (card.raw as any).filePaths : []
      };
      
      let itemsArr: any[] = [];
      try { itemsArr = JSON.parse(card.raw.description); } catch { /* plain-text description */ }
      let finalItems = [];
      if (itemsArr && Array.isArray(itemsArr) && itemsArr.length > 0) {
        finalItems = itemsArr.map(i => ({
          id: crypto.randomUUID(), partName: i.partName || i.productName || '', partNumber: i.partNumber || i.part_number || '', description: '',
          quantity: i.quantity?.toString() || '0', unitPrice: (i.unitPrice || p).toString(),
          discount: (i.discount || card.raw.discount_percent || 0).toString(),
          unitDiscount: (i.unitDiscount || card.raw.unit_discount || 0).toString(),
          gst: (i.gst || card.raw.gst_percent || 18).toString(),
          filePaths: Array.isArray(i.filePaths) ? i.filePaths : []
        }));
      } else {
        finalItems = [item];
      }
      
      const totalVal = card.value || 0;

      const nowStamp = new Date();
      const monNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const stampSuffix = `${String(nowStamp.getDate()).padStart(2, '0')}${monNames[nowStamp.getMonth()]}${String(nowStamp.getFullYear()).slice(-2)}-${String(nowStamp.getHours() % 12 || 12).padStart(2, '0')}${String(nowStamp.getMinutes()).padStart(2, '0')}${nowStamp.getHours() >= 12 ? 'PM' : 'AM'}`;
      const baseUnique = (card.refNo || '').trim();
      const stampedLeadNo = baseUnique
        ? (/-\d{2}[A-Za-z]{3}\d{2}-\d{4}(AM|PM)$/.test(baseUnique) ? baseUnique : `${baseUnique}-${stampSuffix}`)
        : stampSuffix;

      const stampedFinalItems = finalItems.map(i => {
        const rawName = String(i.partName || i.productName || '').trim();
        const stampedName = attachDateTimeToProduct(rawName, null, nowStamp);
        return {
          ...i,
          partName: stampedName,
          productName: stampedName,
        };
      });
      const names = stampedFinalItems.map(i => i.partName);

      const { error } = await supabase.from('cnc_sales_orders').insert([{
        id: crypto.randomUUID(),
        order_no: oNo, customer: card.customer, customer_id: card.raw.customer_id || null, quote_no: card.raw.quote_no || '',
        contact_person: card.raw.contact_person, phone: card.raw.phone, email: card.raw.email,
        billing_address: '', delivery_address: '',
        shipping_contact: '', shipping_phone: '',
        lead_no: stampedLeadNo, order_date: new Date().toISOString().split('T')[0],
        customer_po_no: '', customer_po_date: null,
        items: stampedFinalItems,

        part_name: stampedFinalItems.length > 1 ? `${names.join(', ')} (${stampedFinalItems.length} Products)` : names[0],
        part_number: item.partNumber, part_no: item.partNumber,
        quantity: q, delivered: 0,
        value: totalVal, total_value: totalVal,
        
        delivery_date: new Date().toISOString().split('T')[0], status: 'Confirmed',
        payment_terms: card.raw.payment_terms || 'Net 30', special_instructions: '',
        internal_remarks: '',
        quotation_id: card.raw.id
      }]);
      
      if (!error) {
        await supabase.from('cnc_quotations').update({ status: 'Converted' }).eq('id', card.raw.id);
        fetchPipeline();
      } else {
        alert("Error creating sales order: " + error.message);
        return false;
      }
    } else if (card.type === 'order' && toStage === 'Inward') {
      const orderPool = [...(salesOrdersList || [])];
      if (card.raw && !orderPool.some((o: any) => o.order_no && card.raw.order_no && o.order_no === card.raw.order_no)) orderPool.push(card.raw);
      const products = enquiryProductOptions(rawLeadsList, card.refNo, orderPool.length ? orderPool : (card.raw ? [card.raw] : []));
      const selectedProduct = products[0];
      setInwardForm({
        inwardNo: '', category: 'GOODS PURCHASE', projectName: card.refNo || '', salesOrderRef: card.raw.order_no || '', referenceNo: '', inwardDate: new Date().toISOString().split('T')[0], partyName: card.customer, remarks: '',
        productName: selectedProduct?.name || '', productKey: selectedProduct?.key || '', productOptions: products, enquiryId: selectedProduct?.enquiryId || '',
        parts: [{ ...emptyInwardPart({ partyName: card.customer || '' }), productKey: selectedProduct?.key || '', productName: selectedProduct?.name || '', enquiryId: selectedProduct?.enquiryId || '', projectName: selectedProduct?.leadNo || card.refNo || '', partyName: card.customer || '', items: [{ ...emptyInwardItem({ partyName: card.customer || '' }), productKey: selectedProduct?.key || '', productName: selectedProduct?.name || '', enquiryId: selectedProduct?.enquiryId || '', projectName: selectedProduct?.leadNo || card.refNo || '' }] }],
        contacts: parseContacts(card.raw)
      });
      setInwardModalTarget(card);
      // The Inward form opens as a popup right on the Kanban board (same
      // renderInwardEntryForm + saveInward as the board's Add button) — the
      // board never navigates away, and the list page is untouched.
      setInwardSavedCount(0);
      setAddPopup('Inward');
    } else if (card.type === 'inward' && toStage === 'Finished Goods') {
      // Costing gate: open the Finished Goods + Costing modal instead of moving.
      // Nothing is written until the user approves inside the modal; Cancel
      // leaves the card (and the database) exactly where it was.
      setCostingMode('add');
      setCostingModalTarget(card);
    } else if (card.type === 'finished_goods' && toStage === 'DC') {
      // Prefill with the deliverable quantity: never more than the good FG
      // available for the order (good completed minus already delivered).
      // Customer, product and quantity details come from the source
      // transaction — nothing is re-typed. Re-validated on save.
      const cardCust = card.customer || '';
      const cmatch: any = (customerList || []).find((c: any) => String(c.name || '').trim().toLowerCase() === String(cardCust).trim().toLowerCase()) || {};
      const kcmatch: any = (allKnownCompanies || []).find((c: any) => String(c.company || '').trim().toLowerCase() === String(cardCust).trim().toLowerCase()) || {};
      const soRefNo = card.raw.sales_order || card.raw.wo_no || '';
      const linkedSo: any = (salesOrdersList || []).find((o: any) => String(o.order_no || '') !== '' && String(o.order_no) === String(soRefNo || '')) || {};
      const customerPo = String((card.raw as any)?.customer_po_no || linkedSo.customer_po_no || '').trim();
      const dcInitForm = {
        dcNo: `DC-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        date: new Date().toISOString().split('T')[0], partyName: cardCust,
        partyAddress: cmatch.city || kcmatch.city || '',
        partyGstin: cmatch.gst || cmatch.gstin || kcmatch.gst || '',
        partyCode: cmatch.id || '',
        ewayBill: '', poNumber: customerPo, salesOrderNo: soRefNo, placeOfSupply: '', packaging: '',
        enquiryNo: baseUniqueNo(card.refNo || ''), vehicleNo: '', phone: cmatch.phone || kcmatch.phone || '',
        category: '', process: '',
        receiverName: '', senderName: '', custSignature: null, authSignature: null,
      };
      const avail = card.qtyTrack ? Math.max(0, card.qtyTrack.fgAvailable) : null;
      const wanted = Number(card.qty) || 0;
      const mkDcLine = (name: string, a: number | null, q: string) => ({ name, avail: a, qty: q, selected: true, hsn: '', unit: 'Nos', price: '' });
      const prods = ((card as any).qtyTrack?.products ?? []).filter((p: any) => (p.available ?? 0) > 0 || (p.good ?? 0) > 0);
      const dcInitItems = prods.length > 1
        ? prods.map((p: any) => mkDcLine(p.name, Math.max(0, Number(p.available) || 0), String(Math.max(0, Number(p.available) || 0))))
        : [mkDcLine(card.part || '', avail, String(avail == null ? (card.qty?.toString() || '0') : Math.min(wanted, avail)))];
      setDcForm(dcInitForm);
      setDcItems(dcInitItems);
      setDcSnapshot({ form: { ...dcInitForm }, items: dcInitItems.map((l: any) => ({ ...l })) });
      setDcModalTarget(card);
      // The DC form opens as a popup right on the Kanban board (same
      // renderDeliveryChallanEntryForm + saveDeliveryChallan as the board's Add
      // button) — the board never navigates away, and the list page is untouched.
      setDcSaveNotice(null);
      setAddPopup('DC');


    } else if (card.type === 'dc' && toStage === 'Invoice') {
      // Approved-price gate: open the invoice modal backed by FG costing instead
      // of the manual-price entry form. Nothing is written until approval there.
      setInvoiceCostingTarget(card);
    } else {
      if ((card.type === 'inward' && toStage === 'DC') || (card.type === 'inward' && toStage === 'Invoice') || (card.type === 'finished_goods' && toStage === 'Invoice')) {
         alert(`Please complete ${card.type === 'inward' ? 'Finished Goods entry' : 'the Delivery Challan'} before moving to ${toStage}.`);
      } else {
         alert(`Cannot move ${card.stage} directly to ${toStage}. Please follow the sequence.`);
      }
      // An alert here always means the card did not go anywhere.
      return false;
    }
    // Either the card advanced, or it was handed to the form / costing gate that has to
    // be confirmed before it advances. Both count as "the transition was accepted".
    return true;
    } catch(err: any) {
      alert("Runtime Error moving " + card.stage + " to " + toStage + ": " + err.message);
      return false;
    }
  };

  /** Drag & drop entry point: resolve the dragged card, then share the one transition. */
  const handleDrop = async (e: React.DragEvent, toStage: Stage) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData('text/plain');
    const card = draggedCard || cards.find(c => String(c.id) === String(cardId));
    if (!card) {
      alert("Error: Could not identify the dragged card. Please try again.");
      return;
    }
    // Stage moves change records: require edit access on the target module.
    if (!canDo(STAGE_MODULE[toStage] ?? 'sales-pipeline', 'edit')) {
      alert('Not authorized: your account cannot move records into this stage.');
      return;
    }
    await moveCardToStage(card, toStage);
  };

  // Duplicate = new enquiry using the old one as a template (new number,
  // new record, New status). Only enquiry-level fields are copied; nothing
  // downstream (quotations, orders, production, DCs, invoices) is touched.
  // Attachment paths are referenced (never moved/deleted); new uploads merge
  // on save through the existing saveEnquiry flow.
  const duplicateEnquiry = (card: KanbanCard) => {
    const raw = card.raw ?? {};
    let parsed: any[] = [];
    try {
      const ef = raw.enquiring_for;
      const p = typeof ef === 'string' ? JSON.parse(ef) : ef;
      if (Array.isArray(p)) parsed = p;
    } catch { /* fall back to part_name below */ }
    const mapped: { productName: string; partName: string; quantity: string; remarks: string; filePaths: string[]; files: File[] }[] = parsed
      .map((it: any) => ({
        productName: String(it.productName || it.partName || it.part_name || '').trim(),
        partName: String(it.productName || it.partName || it.part_name || '').trim(),
        quantity: String(it.quantity ?? it.qty ?? ''),
        remarks: String(it.remarks || ''),
        filePaths: Array.isArray(it.filePaths) ? it.filePaths.filter((p: any) => typeof p === 'string') : [],
        files: [] as File[],
      }))
      .filter((it: any) => it.productName);
    if (mapped.length === 0 && String(raw.part_name || '').trim()) {
      mapped.push({
        productName: String(raw.part_name).trim(),
        partName: String(raw.part_name).trim(),
        quantity: String(raw.quantity ?? ''),
        remarks: '',
        filePaths: [],
        files: [] as File[],
      });
    }
    setEnquiryForm({
      ...resetEnquiryForm(),
      company: raw.customer || '',
      expectedDate: raw.expected_date || '',
      source: raw.source || 'Direct',
      estimatedValue: raw.estimated_value ?? '',
      receivedDate: new Date().toISOString().split('T')[0],
      contacts: [{ person: raw.contact_person || '', phone: raw.phone || '', email: raw.email || '' }],
      items: mapped.length ? mapped : [{ productName: '', partName: '', quantity: '', remarks: '', filePaths: [] as string[], files: [] as File[] }],
    });
    setDuplicateSource(raw.lead_no || raw.enquiry_no || card.refNo || '');
    setEnquirySaveNotice(null);
    // The entry form lives on the Enquiries list, so take the user there with the
    // duplicated template pre-filled and ready to review.
    setActiveView('enquiry_list');
  };

  const saveEnquiry = async () => {
    if (savingEnquiry) return; // the form stays on screen after saving, so guard double clicks
    if (!enquiryForm.company) { alert("Please enter a company name."); return; }
    const enteredProducts = (enquiryForm.items || []).filter((item: any) => String(item.productName || item.partName || '').trim());
    if (!enteredProducts.length) { alert('Please enter at least one product name.'); return; }
    if (enteredProducts.some((item: any) => Number(item.quantity) < 0)) { alert('Product quantities cannot be negative.'); return; }
    if (enteredProducts.some((item: any) => (item.files || []).length) && !company?.id) {
      alert('Select a company before uploading product files.');
      return;
    }
    setSavingEnquiry(true);
    try {
      const itemsToSave = await Promise.all(enteredProducts.map(async (item: any) => {
        const uploadedPaths = company?.id
          ? await Promise.all((item.files || []).map((file: File) => uploadEnquiryProductFile(company.id!, file)))
          : [];
        return {
          productName: String(item.productName || item.partName).trim(),
          partName: String(item.productName || item.partName).trim(),
          quantity: item.quantity || '0',
          remarks: item.remarks || '',
          filePaths: [...(item.filePaths || []), ...uploadedPaths],
        };
      }));
      const firstItem = itemsToSave[0];
      const productNamesList = itemsToSave.map((it: any) => it.productName).join(', ');
      const multiplePartsString = itemsToSave.length > 1 ? `${productNamesList} (${itemsToSave.length} Products)` : firstItem.productName;
      const totalQty = itemsToSave.reduce((sum: number, it: any) => sum + (Number(it.quantity) || 0), 0);
      const cStr = getContactStrings(enquiryForm);
      const payload: any = {
        id: crypto.randomUUID(), lead_no: enquiryForm.leadNo, enquiry_no: enquiryForm.leadNo, customer: enquiryForm.company,
        contact_person: cStr.person, phone: cStr.phone, email: cStr.email,
        enquiring_for: JSON.stringify(itemsToSave),
        part_name: multiplePartsString, part_no: 'N/A', quantity: totalQty,
        expected_date: enquiryForm.expectedDate || null, received_date: enquiryForm.receivedDate || new Date().toISOString().split('T')[0], estimated_value: Number(enquiryForm.estimatedValue) || 0,
        source: enquiryForm.source, status: 'New', pipeline_stage: 'Enquiry'
      };
      if (company?.id) payload.company_id = company.id;

      const { error } = await supabase.from('cnc_enquiries').insert([payload]);
      if (!error) { 
        setEnquiryForm(resetEnquiryForm()); 
        setDuplicateSource(null);
        setEnquirySaveNotice(payload.enquiry_no);
        fetchPipeline();                // recomputes the board cards and the dashboard counts
        setListRefresh(n => n + 1);     // ...and refetches the enquiries table under the form
      } else { 
        alert("Error saving enquiry: " + error.message); 
      }
    } catch (err: any) {
      alert("Error saving enquiry: " + (err?.message || "Unknown error"));
    } finally {
      setSavingEnquiry(false);
    }
  };

  // The Create Quotation popup is the same page as Quotation > Create Quotation. Saving or exporting from it
  // records the quotation in the pipeline (first time inserts, later saves update the same row), which moves the enquiry card.
  const quoteRecordId = useRef<string | null>(null);
  const closeQuotationPopup = () => { setQuotationModalTarget(null); quoteRecordId.current = null; fetchPipeline(); };
  const quotationEmbed = useMemo<QuotationEmbed | undefined>(() => {
    if (!quotationModalTarget) return undefined;
    const target = quotationModalTarget;
    const items: any[] = Array.isArray(quoteForm.items) ? quoteForm.items : [];
    const contact = Array.isArray(quoteForm.contacts) ? quoteForm.contacts[0] : null;
    return {
      client: target.id === 'dummy' || !quoteForm.customer ? undefined : {
        name: String(quoteForm.customer), email: contact?.email || '', phone: contact?.phone || '', gstin: String(target.raw?.gst || ''), address: String(target.raw?.city || ''),
      },
      lines: items.filter(i => String(i.partName || '').trim()).map(i => ({ description: String(i.partName), qty: String(i.quantity || '1') })),
      onRecord: async (doc, total) => {
        const lineItems = doc.lines.filter(l => l.description.trim() || l.unitPrice.trim()).map(l => ({
          id: l.id, partName: l.description.trim(), partNumber: '', quantity: l.qty, unitPrice: l.unitPrice, discount: l.discount || '0', unitDiscount: '0',
          gst: String((Number(doc.tax.cgst) || 0) + (Number(doc.tax.sgst) || 0) + (Number(doc.tax.igst) || 0)), filePaths: [], files: [],
          workings: l.workings, // the cost breakdown behind the price, shown in Finished Goods + Costing
        }));
        const first = lineItems[0];
        const names = lineItems.map(i => i.partName).filter(Boolean).join(', ');
        const leadId = target.raw?.id || null;
        const payload: any = {
          quote_no: quoteForm.quoteNo, customer: doc.clients[0]?.name || quoteForm.customer, part_name: lineItems.length > 1 ? `${names} (${lineItems.length} Products)` : (first?.partName || 'TBD'),
          enquiry_no: target.raw?.enquiry_no || target.raw?.lead_no || null,
          contact_person: '', phone: doc.clients[0]?.phone || '', email: doc.clients[0]?.email || '',
          part_number: '', description: JSON.stringify(lineItems), unit_price: Number(first?.unitPrice) || 0, unit_discount: 0,
          quantity: lineItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0), total_value: total, date: doc.date || null, valid_till: quoteForm.validTill || null, status: 'Sent',
          salesperson: quoteForm.salesperson, discount_percent: Number(first?.discount) || 0, gst_percent: Number(first?.gst) || 18,
          payment_terms: '', delivery_terms: '', remarks: doc.notes, lead_id: leadId,
        };
        const newId = crypto.randomUUID();
        const write = (pl: any) => quoteRecordId.current
          ? supabase.from('cnc_quotations').update(pl).eq('id', quoteRecordId.current)
          : supabase.from('cnc_quotations').insert([{ id: newId, ...pl }]);
        let { error } = await write(payload);
        if (error && (error.message?.includes('unit_discount') || error.code === '42703')) { const { unit_discount, ...rest } = payload; ({ error } = await write(rest)); }
        if (error) throw new Error(`Could not record the quotation in the pipeline: ${error.message}`);
        if (!quoteRecordId.current) quoteRecordId.current = newId;
        if (leadId) {
          const { error: enqErr } = await supabase.from('cnc_enquiries').update({ status: 'Quoted', pipeline_stage: 'Quotation' }).eq('id', leadId);
          if (enqErr) console.error('Failed to update enquiry status:', enqErr);
        }
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotationModalTarget]);

  // Inwards of these categories flow to Production as Draft work orders
  // (released manually there). 'NEW PROJECT' is the legacy label of NEW PART.
  const PRODUCTION_CATEGORIES = ['CUSTOMER DC', 'DC', 'NO DC', 'NEW PART', 'NEW PROJECT'];
  const isProductionCategory = (c: any) => PRODUCTION_CATEGORIES.includes(String(c || '').trim().toUpperCase());

  const createDraftWorkOrdersForInwards = async (entries: { inward: any; qty: number; customer: string }[]) => {
    const eligible = entries.filter(e => isProductionCategory(e.inward.category) && (Number(e.qty) || 0) > 0);
    if (!eligible.length) return 0;
    const { data: existing } = await supabase.from('cnc_work_orders').select('wo_no,sales_order,part_name,quantity');
    const usedNos = new Set((existing ?? []).map((w: any) => w.wo_no));
    const keyOf = (so: string, part: string, q: number) => `${so}||${part}||${q}`;
    const seen = new Set((existing ?? []).map((w: any) => keyOf(w.sales_order ?? '', w.part_name ?? '', Number(w.quantity) || 0)));
    const d = new Date();
    const prefix = `WO-${d.getFullYear().toString().slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}-`;
    const nextNo = () => {
      for (let i = 0; i < 50; i++) {
        const c = `${prefix}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
        if (!usedNos.has(c)) { usedNos.add(c); return c; }
      }
      const f = `${prefix}${Date.now().toString().slice(-3)}`;
      usedNos.add(f);
      return f;
    };
    let created = 0;
    for (const e of eligible) {
      const soRef = e.inward.sales_order_ref || '';
      const k = keyOf(soRef, e.inward.part_name || '', Number(e.qty) || 0);
      if (seen.has(k)) continue;
      seen.add(k);
      const { error } = await supabase.from('cnc_work_orders').insert([{
        id: crypto.randomUUID(), wo_no: nextNo(),
        sales_order: soRef,
        customer: e.customer || e.inward.party_name || '',
        part_name: e.inward.part_name || '-', part_no: e.inward.part_number || 'N/A',
        quantity: Number(e.qty) || 0, completed: 0, rejected: 0,
        start_date: e.inward.inward_date || null, due_date: e.inward.inward_date || null,
        status: 'Draft', priority: 'Normal',
      }]);
      if (!error) created++;
      else console.error('Failed to auto-create draft work order:', error);
    }
    return created;
  };

  // another: keep the popup open on a fresh, blank inward after saving (the saved one is not shown again).
  const saveInward = async (another = false) => {
    if (!inwardModalTarget || savingInward) return;
    const cStr = getContactStrings(inwardForm);
    const groups = (inwardForm.parts || [])
      .map((g: any) => ({ ...g, items: (g.items || []).filter((it: any) => String(it.partName || '').trim()) }))
      .filter((g: any) => g.items.length);

    if (!groups.length) { alert('Add at least one part to inward for this product.'); return; }
    if (groups.some((g: any) => !(g.category || inwardForm.category))) { alert('Select a category for each inward.'); return; }
    if (groups.some((g: any) => !(g.inwardDate || inwardForm.inwardDate))) { alert('Select an inward date for each inward.'); return; }
    // The company is the actual purchase source: required always, and for
    // purchase categories it must be a known supplier/company — never an
    // arbitrary typed name.
    for (const g of groups) {
      const cat = String(g.category || inwardForm.category || '').trim().toUpperCase();
      const party = String(g.partyName || inwardForm.partyName || '').trim();
      if (!party) { alert('Select a company/supplier for each inward.'); return; }
      // Any name is accepted: the company is simply who the goods came from (a known supplier just gets its price terms).
      void cat;
    }
    const flatItems = groups.flatMap((g: any) => g.items.map((it: any) => ({ g, it })));
    for (const { g, it } of flatItems) {
      const cat = String(g.category || inwardForm.category || '').trim().toUpperCase();
      const label = it.productName || it.partName || 'this line';
      if (cat !== 'EXPENSES' && !it.productKey) { alert(`Select "${it.productName || 'the product'}" from the product catalogue or enquiry list — arbitrary names are not allowed.`); return; }
      if (!it.productName && !it.partName) { alert('Select a product for each line.'); return; }
      if ((Number(it.quantity) || 0) <= 0) { alert('Enter a quantity greater than zero for each part.'); return; }
      // A purchase price is never assumed: zero/blank blocks the save.
      if ((Number(it.price) || 0) <= 0) { alert(`Enter the purchase price for "${label}". A price is never assumed to be zero.`); return; }
      const d = Number(it.discount) || 0, gg = Number(it.gst) || 0;
      if (d < 0 || d > 100) { alert(`Discount for "${label}" must be between 0 and 100%.`); return; }
      if (gg < 0 || gg > 100) { alert(`GST for "${label}" must be between 0 and 100%.`); return; }
    }
    // Safety net: no duplicate product lines within one inward entry (same
    // master record or same product name). Repeats across entries stay allowed.
    {
      const seen = new Set<string>();
      for (const { it } of flatItems) {
        const id = inwardLineIdentity(it);
        if (id === 'nm:' || String(it.productKey) === 'expense') continue;
        if (seen.has(id)) { alert(`"${it.productName}" is added twice in this inward entry. Keep one line and adjust its quantity.`); return; }
        seen.add(id);
      }
    }
    const flatFiles = groups.flatMap((g: any) => [
      ...(g.files || []),
      ...(g.items || []).flatMap((it: any) => it.files || []),
    ]);
    if (flatFiles.some((file: File) => file.size > 50 * 1024 * 1024)) {
      alert('Each attachment must be 50 MB or smaller.');
      return;
    }
    if (flatFiles.length && !company?.id) {
      alert('Select a company before uploading attachments.');
      return;
    }

    setSavingInward(true);
    try {
      const rows = [];
      for (const { g, it } of flatItems) {
        const inwardId = crypto.randomUUID();
        const itemFiles = [...(g.files || []), ...(it.files || [])];
        const attachments = (itemFiles.length && company?.id)
          ? await Promise.all(itemFiles.map((file: File) => uploadInwardAttachment(company!.id, inwardId, file)))
          : [];
        const q = Number(it.quantity) || 0;
        const p = Number(it.price) || 0;
        const d = Number(it.discount) || 0;
        const gg = Number(it.gst) || 0;
        const total = inwardLineTotal(q, p, d, gg);
        rows.push({
          id: inwardId,
          inward_no: `INW-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
          category: g.category || inwardForm.category, product_name: it.productName || g.productName || inwardForm.productName, enquiry_id: it.enquiryId || g.enquiryId || inwardForm.enquiryId || null,
          project_name: it.projectName || g.projectName || inwardForm.projectName, contact_person: cStr.person, phone: cStr.phone, email: cStr.email,
          sales_order_ref: inwardForm.salesOrderRef, reference_no: g.referenceNo ?? inwardForm.referenceNo,
          inward_date: g.inwardDate || inwardForm.inwardDate || null, party_name: g.partyName || it.partyName || inwardForm.partyName, remarks: it.remarks ?? g.remarks ?? inwardForm.remarks,
          part_name: it.partName, part_number: it.partNumber || it.partCode || '', quantity: q, price: p,
          discount_percent: d, gst_percent: gg, total_amount: total, status: 'Pending', attachments,
        });
      }
      let payload: any[] = rows;
      const dropped: string[] = [];
      let saved = false;
      let lastError: any = null;
      for (let attempt = 0; attempt < 5 && !saved; attempt++) {
        const res = await supabase.from('cnc_inwards').insert(payload);
        if (!res.error) { saved = true; break; }
        // Cloud DB may predate newer columns: drop only the column the error
        // names and retry, so surviving columns (e.g. product_name) still save.
        const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(res.error.message || '');
        if (m && payload.length && Object.prototype.hasOwnProperty.call(payload[0], m[1])) {
          dropped.push(m[1]);
          payload = payload.map(r => { const c = { ...r }; delete c[m[1]]; return c; });
          lastError = res.error;
          continue;
        }
        throw res.error;
      }
      if (!saved) throw lastError;
      // Eligible categories (DC / NO DC / NEW PART) flow to Production as
      // Draft work orders, released manually from the Production page.
      try {
        await createDraftWorkOrdersForInwards(rows.map(r => ({
          inward: r, qty: r.quantity,
          customer: r.party_name || (inwardModalTarget as any)?.customer || inwardForm.partyName || '',
        })));
      } catch (woErr) {
        console.error('Draft work order auto-create failed:', woErr);
      }
      if (dropped.includes('product_name')) {
        // Preserve the product link inside remarks (parsed back on display)
        // until the migration adds the real column.
        const withProduct = rows.filter(r => String(r.product_name || '').trim());
        if (withProduct.length) {
          try {
            await Promise.all(withProduct.map(r => {
              const marker = `[Product: ${String(r.product_name).trim()}]`;
              const remarks = r.remarks ? `${marker} ${r.remarks}` : marker;
              return supabase.from('cnc_inwards').update({ remarks }).eq('id', r.id);
            }));
          } catch { /* display falls back to dashes */ }
        }
      }
      if (dropped.includes('attachments') && rows.some(r => (r.attachments || []).length > 0)) {
        alert('Inward entries saved, but file attachments were skipped (database update pending — apply the inward_attachments migration to enable files).');
      }
    } catch (error: any) {
      console.error('Create inward failed:', error);
      const msg = error?.message || error?.details || error?.hint || (typeof error === 'string' ? error : JSON.stringify(error));
      alert(`Unable to create inward entries: ${msg}`);
      setSavingInward(false);
      return;
    }
    // Customer inward is the customer's material (job work), so it is not added to company stock.
    if (inwardModalTarget.raw?.id && inwardModalTarget.type === 'order') {
        const { error: soErr } = await supabase.from('cnc_sales_orders').update({ status: 'Inwarded' }).eq('id', inwardModalTarget.raw.id);
        if (soErr) console.error("Failed to update sales order status:", soErr);
    }
    setSavingInward(false);
    fetchPipeline();
    setInwardRefreshSignal((n) => n + 1);
    if (another) {
      // Next inward: a completely blank form (the saved one is cleared), the popup stays open.
      openDummyInward();
      setInwardSavedCount((n) => n + 1);
      return;
    }
    // Submit: the inline form goes back to a fresh blank inward (what closing and
    // reopening the popup used to do) and the list above it is already refreshed.
    setInwardSavedCount(0);
    openDummyInward();
    setAddPopup(null); // Submit from the New Inward popup closes it
  };

  const saveFinishedGoods = async () => {
    if (!fgModalTarget) return;
    const q = Number(fgForm.completedQty) || 0;
    const maxQ = Number(fgForm.orderQty) || 0;
    if (q <= 0) {
       alert("Please enter the quantity to process.");
       return;
    }
    if (q > maxQ) {
       alert(`Quantity cannot exceed the inwarded amount of ${maxQ} pcs.`);
       return;
    }
    const fgDate = fgForm.date || new Date().toISOString().split('T')[0];
    const { error } = await supabase.from('cnc_work_orders').insert([{
       id: crypto.randomUUID(), wo_no: fgForm.woNo, customer: fgForm.customer,
       part_name: fgForm.partName, part_no: fgForm.partNo || 'N/A', completed: q, status: 'Completed',
       sales_order: fgModalTarget.raw?.sales_order_ref || '', quantity: maxQ, start_date: fgDate, due_date: fgDate, priority: 'Normal', drawing_revision: '0', description: '',
       created_at: fgDate + 'T00:00:00Z'
    }]);
    if (!error) {
       if (fgModalTarget.raw?.id) {
         const groupIds = Array.isArray(fgModalTarget.raw._groupIds) && fgModalTarget.raw._groupIds.length
           ? fgModalTarget.raw._groupIds : [fgModalTarget.raw.id];
         const inwQuery = supabase.from('cnc_inwards').update({ status: 'Processed' });
         const { error: inwErr } = groupIds.length > 1
           ? await inwQuery.in('id', groupIds)
           : await inwQuery.eq('id', groupIds[0]);
         if (inwErr) console.error("Failed to update inward status:", inwErr);
       }
       setFgModalTarget(null); fetchPipeline();
    } else { alert("Error: " + error.message); }
  };

  const saveDeliveryChallan = async () => {
    if (!dcModalTarget || dcSaving) return;
    const f = dcForm;
    if (!String(f.dcNo || '').trim()) { alert('Enter the DC number.'); return; }
    if (!String(f.date || '').trim()) { alert('Enter the date.'); return; }
    if (!String(f.partyName || '').trim()) { alert('Enter the company name.'); return; }
    // Product lines (selected rows only).
    const lines = (dcItems || []).filter((i) => i.selected).map((i) => ({
      name: String(i.name || '').trim(),
      qty: Number(i.qty) || 0,
      hsn: String(i.hsn || '').trim(),
      unit: String(i.unit || '').trim() || 'Nos',
      price: Number(i.price) || 0,
      avail: i.avail,
    })).filter((l) => l.name);
    if (!lines.length) { alert('Add at least one product with a part name.'); return; }
    for (const l of lines) {
      if (!(l.qty > 0)) { alert(`Enter a dispatch quantity greater than 0 for ${l.name}.`); return; }
      if (l.avail != null && l.qty > l.avail) { alert(`${l.name}: quantity exceeds the available ${l.avail} pcs.`); return; }
    }
    const q = lines.reduce((s, l) => s + l.qty, 0);
    const fromWorkOrder = !!dcModalTarget.raw?.id;
    if (fromWorkOrder) {
      const maxQ = Number(dcModalTarget.qty) || 0;
      if (q > maxQ) {
        alert(`Quantity cannot exceed the finished goods stock of ${maxQ} pcs.`);
        return;
      }
    }
    setDcSaving(true);
    try {
      // Duplicate guards: the same challan must never be recorded twice
      // (double-click, double drag, or re-typed manual entry).
      const dcNoTrimmed = (f.dcNo || '').trim();
      if (dcNoTrimmed) {
        const { data: sameNo, error: sameNoErr } = await supabase.from('cnc_deliveries')
          .select('id,delivery_no').eq('delivery_no', dcNoTrimmed).limit(1);
        if (!sameNoErr && (sameNo ?? []).length > 0) {
          alert(`Delivery Challan ${dcNoTrimmed} already exists. A duplicate was not created.`);
          return;
        }
      }
    // Resolve the real sales order (work orders store the SO order_no in `sales_order`)
    const soNo: string = (fromWorkOrder ? dcModalTarget.raw.sales_order : '') || f.salesOrderNo || '';
    let so: any = null;
    if (soNo) {
      const { data: soRow, error: soErr } = await supabase.from('cnc_sales_orders').select('id, customer_id, quantity, delivered').eq('order_no', soNo).maybeSingle();
      if (soErr) console.error("Failed to look up sales order:", soErr);
      so = soRow;
    }
    // Authoritative DC cap: deliverable = good completed minus delivered.
    // Enforced only when production rows exist for the order (deliveries
    // without work orders keep the previous behaviour).
    let availNow: number | null = null;
    let goodTotal = 0;
    let deliveredTotal = 0;
    if (so) {
      try {
        const { summary } = await fetchOrderQty(String(so.id), soNo);
        if (summary && summary.hasProduction) {
          availNow = summary.fgAvailable;
          goodTotal = summary.good;
          deliveredTotal = summary.delivered;
          if (q > availNow) {
            alert(`Only ${availNow} pcs are available for delivery (good completed ${goodTotal} minus already delivered ${deliveredTotal}). Rejected quantity can never be dispatched.`);
            return;
          }
        }
      } catch (e) { console.error('Delivery availability check failed:', e); }
    }
    // Near-duplicate guard: same order + product + qty + date within minutes.
    // Multi-product challans check each line.
    if (soNo) {
      try {
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        for (const ce of lines) {
          const { data: recent } = await supabase.from('cnc_deliveries')
            .select('id,delivery_no').eq('sales_order_no', soNo)
            .eq('part_name', ce.name).eq('dispatch_qty', ce.qty)
            .eq('delivery_date', f.date || null).gte('created_at', tenMinAgo).limit(1);
          if (recent && recent.length > 0 && !window.confirm(
            `A nearly identical challan (${recent[0].delivery_no}) was created minutes ago. Create this one anyway?`)) {
            return;
          }
        }
      } catch { /* guard is best-effort; the insert below still validates */ }
    }
    // customer_id is NOT NULL: resolve from the sales order, else match/auto-create the customer by name.
    let customerId: string | null = so?.customer_id || null;
    const partyName = (f.partyName || '').trim();
    if (!customerId && partyName) {
      const match = (customerList || []).find((c: any) => String(c.name || '').trim().toLowerCase() === partyName.toLowerCase());
      if (match) {
        customerId = match.id;
      } else {
        const newId = `CUST-${Math.floor(1000 + Math.random() * 9000)}`;
        const custPayload: any = { id: newId, name: partyName, status: 'Active' };
        if (company?.id) custPayload.company_id = company.id;
        const { error: cErr } = await supabase.from('cnc_customers').insert([custPayload]);
        if (!cErr) {
          customerId = newId;
          try { setCustomerList((prev: any[]) => [...(prev || []), { id: newId, name: partyName }]); } catch {}
        }
      }
    }
    if (!customerId) { alert('Could not resolve a company for this delivery. Add the party as a company first.'); return; }
    // One delivery row per product under the same challan number (multi-item
    // challans are read back together by the invoice flow). Extra columns are
    // attempted when the database already has them and skipped otherwise, so
    // the core save never breaks on older schemas.
    const baseRows = lines.map((l) => ({
      id: crypto.randomUUID(),
      delivery_no: f.dcNo, customer_name: f.partyName,
      customer_id: customerId, sales_order_id: so?.id || null, sales_order_no: soNo || null,
      part_name: l.name, quantity: l.qty, dispatch_qty: l.qty, delivery_date: f.date || null,
      vehicle_no: f.vehicleNo || '', status: 'Pending',
      created_at: new Date().toISOString(),
      billing_address: f.partyAddress || '', customer_gstin: f.partyGstin || '',
      customer_code: f.partyCode || '', eway_bill: f.ewayBill || '', po_no: f.poNumber || '',
      place_of_supply: f.placeOfSupply || '', packaging_details: f.packaging || '',
      enquiry_no: f.enquiryNo || '', phone: f.phone || '', category: f.category || '', process: f.process || '',
      hsn: l.hsn, unit: l.unit, unit_price: l.price, total_amount: l.qty * l.price,
      receiver_name: f.receiverName || '', sender_name: f.senderName || '',
      customer_signature: f.custSignature || null, authorized_signature: f.authSignature || null,
    }));
    const skipped = new Set<string>();
    let error: any = null;
    for (const r of baseRows) {
      const payload: any = { ...r };
      skipped.forEach((k) => delete payload[k]);
      for (let attempt = 0; attempt < 30; attempt++) {
        const res = await supabase.from('cnc_deliveries').insert([payload]);
        if (!res.error) break;
        const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(res.error.message || '');
        if (m && m[1] in payload) { delete payload[m[1]]; skipped.add(m[1]); continue; }
        error = res.error; break;
      }
      if (error) break;
    }
    if (error) { alert("Error: " + error.message); return; }
    if (skipped.size) {
      alert(`DC saved. These extra fields have no database column yet and were skipped: ${[...skipped].join(', ')}`);
    }
    if (fromWorkOrder) {
      // Partial DCs leave the batch open; only a fulfilling dispatch marks
      // it Dispatched. Orders without production rows keep old behaviour.
      // Grouped FG cards mark every row in the group.
      const fulfilled = availNow == null || (goodTotal > 0 && deliveredTotal + q >= goodTotal);
      if (fulfilled) {
        const woIds = Array.isArray((dcModalTarget.raw as any)?._groupIds) && (dcModalTarget.raw as any)._groupIds.length
          ? (dcModalTarget.raw as any)._groupIds : [dcModalTarget.raw.id];
        // Only fully produced work orders are closed as Dispatched; one with a balance left stays open for it.
        const { data: woRows } = await supabase.from('cnc_work_orders').select('id,quantity,completed').in('id', woIds.filter(Boolean));
        const doneIds = (woRows ?? []).filter((w: any) => (Number(w.completed) || 0) >= (Number(w.quantity) || 0)).map((w: any) => w.id);
        const { error: woErr } = doneIds.length ? await supabase.from('cnc_work_orders').update({ status: 'Dispatched' }).in('id', doneIds) : { error: null };
        if (woErr) console.error("Failed to update work order status:", woErr);
      }
    }
    if (so) {
      const delivered = (Number(so.delivered) || 0) + q;
      const status = delivered >= (Number(so.quantity) || 0) ? 'Delivered' : 'Partially Delivered';
      const { error: soUpdErr } = await supabase.from('cnc_sales_orders').update({ delivered, status }).eq('id', so.id);
      if (soUpdErr) console.error("Failed to update sales order delivery:", soUpdErr);
    }
      // The challan is saved: reset the inline form for the next one, confirm, refresh.
      const nextForm = makeDcBlankForm();
      const nextItems = makeDcBlankItems();
      setDcForm(nextForm);
      setDcItems(nextItems);
      setDcSnapshot({ form: { ...nextForm }, items: nextItems.map((l: any) => ({ ...l })) });
      setDcSaveNotice(f.dcNo || 'saved');
      fetchPipeline();
      setListRefresh(n => n + 1);
    } finally {
      setDcSaving(false);
    }
  };


    const saveStandaloneSalesOrder = async () => {
    if (savingSo) return; // the form stays on screen after saving, so guard double clicks
    if (!String(soForm.customer || '').trim()) { alert('Enter the company.'); return; }
    if (!soForm.orderDate) { alert('Enter the order date.'); return; }
    if (!soForm.deliveryDate) { alert('Enter the delivery date.'); return; }
    if (soForm.orderDate && soForm.deliveryDate && soForm.deliveryDate <= soForm.orderDate) {
      alert('Delivery date must be after order date.');
      return;
    }
    const entered = ((soForm.items || []) as any[])
      .map((it: any) => ({ ...it, partName: String(it.partName || '').trim() }))
      .filter((it: any) => it.partName);
    if (!entered.length) { alert('Enter at least one product.'); return; }
    if (entered.some((it: any) => Number(it.quantity) < 0)) { alert('Product quantities cannot be negative.'); return; }
    if (entered.some((it: any) => Number(it.rejectedQty) < 0)) { alert('Rejected quantities cannot be negative.'); return; }
    const hasFiles = entered.some((it: any) => (it.files || []).length);
    if (hasFiles && !company?.id) { alert('Select a company before uploading files.'); return; }
    setSavingSo(true);
    let uploadedPaths: string[][];
    try {
      uploadedPaths = await Promise.all(entered.map((it: any) => Promise.all(((it.files || []) as File[]).map(f => uploadOrderFile(company!.id, f)))));
    } catch (e: any) { setSavingSo(false); alert(e?.message || 'Could not upload the files.'); return; }
    const nowStamp = new Date();
    const finalItems = entered.map((it: any, fileIdx: number) => {
      const rawName = String(it.partName || '').trim();
      const stampedName = attachDateTimeToProduct(rawName, null, nowStamp);
      return {
        id: it.id || crypto.randomUUID(),
        filePaths: uploadedPaths[fileIdx] ?? [],
        partName: stampedName,
        partNumber: '',
        description: '',
        quantity: String(Number(it.quantity) || 0),
        rejectedQty: Number(it.rejectedQty) || 0,
        status: it.itemStatus || 'Confirmed',
        unitPrice: String(Number(it.unitPrice) || 0),
        discount: '0',
        unitDiscount: '0',
        gst: it.gst || '18'
      };
    });
    const totalQty = finalItems.reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);
    const names = finalItems.map((i: any) => i.partName);
    const prodStatuses = Array.from(new Set(finalItems.map((i: any) => String(i.status || '').trim()).filter(Boolean)));
    const totalVal = finalItems.reduce((s: number, i: any) =>
      s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0) * (1 + Number(i.gst || 18) / 100), 0);

    const { error } = await supabase.from('cnc_sales_orders').insert([{
      id: crypto.randomUUID(),
      order_no: soForm.orderNo, customer: String(soForm.customer).trim(),
      contact_person: '', phone: '', email: '',
      billing_address: '', delivery_address: '',
      shipping_contact: '', shipping_phone: '',
      lead_no: '', order_date: soForm.orderDate || null,
      customer_po_no: String(soForm.customerPoNo || '').trim(), customer_po_date: null,
      items: finalItems,
      part_name: finalItems.length > 1 ? `${names.join(', ')} (${finalItems.length} Products)` : names[0],
      part_number: '', part_no: '',
      quantity: totalQty, delivered: 0,
      value: totalVal, total_value: totalVal,
      delivery_date: soForm.deliveryDate || soForm.orderDate || null,
      status: prodStatuses.length === 1 ? prodStatuses[0] : 'Confirmed',
      payment_terms: 'Net 30', special_instructions: '',
      internal_remarks: '',
      quotation_id: null
    }]);
    
    if (!error) {
      // The form stays on screen for the next order: reset it, confirm, and refresh.
      setSoForm(resetSoForm());
      setSoSaveNotice(soForm.orderNo);
      fetchPipeline();
      setListRefresh(n => n + 1);
      setSavingSo(false);
    } else {
      alert("Error creating sales order: " + error.message);
      setSavingSo(false);
    }
  };
  
  const saveInvoice = async () => {
    if (!invoiceModalTarget) return;
    const q = Number(invoiceForm.quantity) || 0;
    const p = Number(invoiceForm.price) || 0;
    if (!invoiceForm.partyName?.trim() || !invoiceForm.partName?.trim() || q <= 0 || p < 0) {
      alert('Company, item, positive quantity and a valid unit price are required.');
      return;
    }
    try {
      const rates = [invoiceForm.cgst, invoiceForm.sgst, invoiceForm.igst]
        .map((value: string) => value === '' ? null : Number(value));
      const gstRate = rates.some((value: number | null) => value !== null)
        ? rates.reduce((sum: number, value: number | null) => sum + (value || 0), 0)
        : null;
      const target = invoiceModalTarget.raw || {};
      const deliveryId = invoiceModalTarget.type === 'dc' && target.id !== 'dummy' ? String(target.id) : null;
      await financeApi.saveInvoice({
        invoice_no: invoiceForm.invoiceNo || null,
        invoice_type: 'Sales Invoice',
        customer_name: invoiceForm.partyName.trim(),
        customer_id: target.customer_id || null,
        part_name: invoiceForm.partName.trim(),
        quantity: q,
        invoice_date: invoiceForm.date || null,
        dc_no: invoiceForm.dcNumber || null,
        delivery_id: deliveryId,
        sales_order_id: target.sales_order_id || null,
      }, [{ description: invoiceForm.partName.trim(), quantity: q, unit: target.unit || null, rate: p, gst_rate: gstRate }]);
      if (deliveryId) {
        const { error: dcErr } = await supabase.from('cnc_deliveries').update({ status: 'Billed' }).eq('id', deliveryId);
        if (dcErr) throw dcErr;
      }
      setInvoiceModalTarget(null);
      fetchPipeline();
    } catch (error: any) {
      alert('Error creating invoice: ' + (error?.message || 'Please try again.'));
    }
  };

  const calcQuoteTotal = () => {
    if (quoteForm.items && Array.isArray(quoteForm.items)) {
      return quoteForm.items.reduce((total: number, item: any) => {
        const q = Number(item.quantity) || 0; const p = Number(item.unitPrice) || 0;
        const d = Number(item.discount) || 0; const ud = Number(item.unitDiscount) || 0; const g = Number(item.gst) || 0;
        const discountedUnit = Math.max(0, p * (1 - d / 100) - ud);
        return total + (q * discountedUnit * (1 + g / 100));
      }, 0).toFixed(2);
    }
    const q = Number(quoteForm.quantity) || 0; const p = Number(quoteForm.unitPrice) || 0;
    const d = Number(quoteForm.discount) || 0; const ud = Number(quoteForm.unitDiscount) || 0; const g = Number(quoteForm.gst) || 0;
    const discountedUnit = Math.max(0, p * (1 - d / 100) - ud);
    return (q * discountedUnit * (1 + g / 100)).toFixed(2);
  };

  const calcItemTotal = (item: any) => {
    const q = Number(item.quantity) || 0; const p = Number(item.unitPrice) || 0;
    const d = Number(item.discount) || 0; const ud = Number(item.unitDiscount) || 0; const g = Number(item.gst) || 0;
    const discountedUnit = Math.max(0, p * (1 - d / 100) - ud);
    return (q * discountedUnit * (1 + g / 100)).toFixed(2);
  };

  const updateQuoteItem = (index: number, field: string, value: string) => {
    const newItems = [...(quoteForm.items || [])];
    newItems[index] = { ...newItems[index], [field]: value };
    setQuoteForm({ ...quoteForm, items: newItems });
  };

  const [showNewLead, setShowNewLead] = useState(false);
  // Company-master popup state (Company ID is auto-generated at save).
  const [newLeadForm, setNewLeadForm] = useState<any>({
    company: '', city: '', gst: '', source: 'Direct',
    contacts: [{ person: '', phone: '', email: '' }],
  });

  const stageDetailsTitle = (stage?: string) =>
    !stage ? 'Pipeline History' : stage === 'DC' ? 'Delivery Challan Details' : `${stage} Details`;

  // Standalone inward entry (kanban +Add and Inwards list share this).
  const [inwardRefreshSignal, setInwardRefreshSignal] = useState(0);
  // Products already received on earlier inwards (their stored product name already carries the sale date/time),
  // offered next to the sales-order products so the same product can be inwarded again.
  const [inwardProdOptions, setInwardProdOptions] = useState<any[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('cnc_inwards').select('product_name,enquiry_id,project_name,sales_order_ref,created_at,inward_date,status').neq('status', 'Deleted');
      if (cancelled || error) return;
      const seen = new Set<string>();
      const out: any[] = [];
      for (const r of data ?? []) {
        const name = String((r as any).product_name ?? '').trim();
        const k = name.toLowerCase();
        if (!name || seen.has(k)) continue;
        seen.add(k);
        out.push({ key: `inward:${k}`, name, quantity: '', enquiryId: (r as any).enquiry_id || '', leadNo: (r as any).project_name || '', soRef: (r as any).sales_order_ref || '', stampAt: (r as any).created_at || (r as any).inward_date || '', customer: '', saleLabel: 'earlier inward' });
      }
      setInwardProdOptions(out);
    })();
    return () => { cancelled = true; };
  }, [inwardRefreshSignal, company?.id]);
  const openDummyInward = () => {
    setInwardForm({
      category: 'GOODS PURCHASE', projectName: '', salesOrderRef: '', referenceNo: '', inwardDate: new Date().toISOString().split('T')[0], partyName: '', remarks: '',
      productName: '', productOptions: enquiryProductOptions(rawLeadsList, undefined, salesOrdersList), enquiryId: '',
      parts: [emptyInwardPart()], contacts: [{ person: '', phone: '', email: '' }]
    });
    setInwardModalTarget({ id: 'dummy', stage: 'Sales Order', type: 'order', refNo: '', customer: '', part: '', qty: 1, value: 0, date: '', raw: {} });
  };

  // The Inward entry form is on screen as soon as the Inward list opens, so its blank
  // session is opened once the enquiry / sales-order lists the product picker is built
  // from have loaded (clicking "Add Inward" used to do this). The guard makes sure an
  // inward that the user - or the board's drag-to-Inward - already filled in is never
  // overwritten by a later data load.
  const inwardBooted = useRef(false);
  useEffect(() => {
    if (inwardBooted.current) return;
    if (!rawLeadsList.length && !salesOrdersList.length) return;
    inwardBooted.current = true;
    const touched = (inwardForm.parts || []).some((p: any) =>
      (p.partyName || p.referenceNo) || (p.items || []).some((it: any) => it.partName || it.quantity || it.productKey));
    if (!touched) openDummyInward();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawLeadsList, salesOrdersList]);

  // Company-master popup: Company ID is generated in the background at save
  // time — it never appears in the UI. No enquiry/product is created here;
  // enquiries are added separately when needed.
  const openNewLeadModal = () => {
    setNewLeadForm({
      company: '', city: '', gst: '', source: 'Direct',
      contacts: [{ person: '', phone: '', email: '' }],
    });
    setShowNewLead(true);
  };



  // Company-master save only: upserts cnc_customers, never creates an
  // enquiry. The Company ID (CUST-xxxx) is generated in the background.
  // Extra keys are attempted when the database already has those columns
  // and skipped otherwise, so the save never breaks on older schemas.
  const saveNewLead = async () => {
    const name = String(newLeadForm.company || '').trim();
    if (!name) {
      alert("Please enter a company name.");
      return;
    }
    setLoading(true);
    try {
      const dup = (customerList || []).some((c: any) => String(c.name || '').trim().toLowerCase() === name.toLowerCase());
      if (dup) {
        alert(`Company "${name}" already exists in the company master.`);
        return;
      }
      const cStr = getContactStrings(newLeadForm);
      const custPayload: any = {
        id: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
        name,
        contact: cStr.person || null,
        phone: cStr.phone || null,
        email: cStr.email || null,
        city: newLeadForm.city || null,
        gst: newLeadForm.gst || null,
        source: newLeadForm.source || null,
        status: 'Active'
      };
      if (company?.id) custPayload.company_id = company.id;
      const skipped = new Set<string>();
      let error: any = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await supabase.from('cnc_customers').insert([custPayload]);
        if (!res.error) { error = null; break; }
        const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(res.error.message || '');
        if (m && Object.prototype.hasOwnProperty.call(custPayload, m[1])) {
          delete custPayload[m[1]];
          skipped.add(m[1]);
          continue;
        }
        error = res.error;
        break;
      }
      if (error) {
        console.error('Failed to save company:', error);
        alert("Failed to save company: " + error.message);
        return;
      }
      if (skipped.size) {
        alert(`Company saved. These fields have no database column yet and were skipped: ${[...skipped].join(', ')}`);
      }
      try {
        setCustomerList((prev: any[]) => [...(prev || []), {
          id: custPayload.id, name,
          contact: cStr.person || null, phone: cStr.phone || null, email: cStr.email || null,
          city: newLeadForm.city || null, gst: newLeadForm.gst || null, status: 'Active',
        }]);
      } catch {}
      setShowNewLead(false);
      setNewLeadForm({
        company: '', city: '', gst: '', source: 'Direct',
        contacts: [{ person: '', phone: '', email: '' }],
      });
      await fetchPipeline();
    } catch (err: any) {
      console.error('Exception in saveNewLead:', err);
      alert("Failed to save company: " + (err?.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  // ── New Enquiry entry form ──────────────────────────────────────────────
  // Inward product search resolution (shared by every category branch below).
  // Master catalogue wins over legacy enquiry names; unknown text stays visible
  // but unlinked so save-time validation — never an auto-created product — stops it.
  const onInwardProductInput = (index: number, ii: number, value: string, opts?: { allowFreeText?: boolean }) => {
    const parts = [...(inwardForm.parts || [])];
    const group = { ...(parts[index] || {}) };
    const items = [...(group.items || [])];
    const prev = { ...(items[ii] || {}) };
    const v = String(value ?? '');
    const dupeOf = (identity: string) => {
      const all: { gi: number; jj: number; label: string }[] = [];
      (inwardForm.parts || []).forEach((g: any, gi: number) => (g.items || []).forEach((it: any, jj: number) => {
        if (gi === index && jj === ii) return;
        if (inwardLineIdentity(it) === identity && normStr(it.productName)) all.push({ gi, jj, label: it.productName });
      }));
      return all[0];
    };
    const masterHit = partsCatalogue.find((m: any) => normStr(m.name) === normStr(v) || (m.code && normStr(m.code) === normStr(v)));
    if (masterHit && !eligibleCatalogue.some((m: any) => m.key === masterHit.key)) {
      alert(`"${masterHit.name}" is classified as a manufactured (Make-only) item and is not available for purchase.`);
      return;
    }
    if (masterHit) {
      const dupe = dupeOf(`id:${masterHit.key}`);
      if (dupe) { alert(`"${masterHit.name}" is already on line ${dupe.jj + 1}. Change the quantity there instead of adding it twice.`); return; }
      const supplier = group.partyName ?? inwardForm.partyName ?? '';
      const r = resolvePurchasePrice(masterHit, supplier);
      items[ii] = { ...prev, productDisplay: '', productKey: masterHit.key, productName: masterHit.name, partId: masterHit.id, partCode: masterHit.code, partName: String(prev.partName || '').trim() ? prev.partName : masterHit.name, enquiryId: '', projectName: '', price: r.price, _resolvedPrice: r.price, gst: prev.gst ?? '18', discount: prev.discount ?? '0' };
    } else {
      const leg = inwardLegacyOptions(group).find((o: any) => normStr(o.display) === normStr(v) || normStr(o.name) === normStr(v));
      if (leg) {
        // Expense entries (free-text lines) may repeat an item; only catalogue purchases stay single-line.
        const dupe = opts?.allowFreeText ? undefined : dupeOf(`nm:${normStr(leg.name)}`);
        if (dupe) { alert(`"${leg.name}" is already on line ${dupe.jj + 1}. Change the quantity there instead of adding it twice.`); return; }
        const patch: any = { productName: leg.name, productDisplay: leg.display || '', partName: String(prev.partName || '').trim() ? prev.partName : getProductBaseName(leg.name), quantity: String(prev.quantity || '').trim() ? prev.quantity : (Number(leg.quantity) > 0 ? String(leg.quantity) : ''), productKey: leg.key, partId: '', partCode: '', enquiryId: leg.enquiryId || '', projectName: leg.leadNo || '' };
        items[ii] = { ...prev, ...patch };
      } else if (opts?.allowFreeText) {
        // Expense items are bought repeatedly (e.g. a battery on several days), so the same name may be entered again.
        items[ii] = { ...prev, productDisplay: '', productName: v, productKey: v.trim() ? 'expense' : '', partId: '', partCode: '', enquiryId: '', projectName: v };
      } else {
        // Catalogue purchase: typed text that matches nothing stays visible so
        // the user can keep typing, but it carries no product link.
        items[ii] = { ...prev, productDisplay: '', productName: v, productKey: '', partId: '', partCode: '', enquiryId: '', projectName: '' };
      }
    }
    group.items = items; parts[index] = group;
    setInwardForm({ ...inwardForm, parts });
  };

  // Supplier change: refresh every selected line's price from the new
  // supplier's terms, but never touch quantities, remarks, or a price the
  // user deliberately overrode (tracked via _resolvedPrice).
  const onInwardCompanyChange = (index: number, value: string) => {
    const parts = [...(inwardForm.parts || [])];
    const group = { ...(parts[index] || {}) };
    group.partyName = value;
    group.items = (group.items || []).map((it: any) => {
      const master = it.productKey ? eligibleCatalogue.find((m: any) => m.key === it.productKey) : null;
      if (!master) return it;
      const r = resolvePurchasePrice(master, value);
      const untouched = it.price === '' || it.price == null || String(it.price) === String(it._resolvedPrice);
      return untouched ? { ...it, price: r.price, _resolvedPrice: r.price } : it;
    });
    parts[index] = group;
    setInwardForm({ ...inwardForm, parts });
  };

  // This used to be the body of the "New Enquiry" popup. It is now rendered by
  // EnquiryModule directly above the enquiries table, so the page loads with the
  // form already open. Every field, the company search/autocomplete, Add New
  // Company, the multi-row products, the file uploads and saveEnquiry are
  // untouched — only the modal chrome (backdrop, positioning, close button and
  // footer) has been replaced by a card with Save Enquiry / Clear Reset buttons.
  const renderEnquiryEntryForm = (opts?: { onBack?: () => void; searchSlot?: ReactNode; popup?: boolean }) => {
    // One product line's fields. The first product renders inline in the main
    // row; every added product renders on its own full-width line below, so
    // the form never needs sideways scrolling.
    const renderItemFields = (item: any, idx: number) => (
      <Fragment>
        <input className={`${compactInput} w-[9rem]`} placeholder="Product Name" list="enquiry-product-list" value={item.productName ?? item.partName ?? ''} onChange={e => {
          const newItems = [...(enquiryForm.items || [])];
          newItems[idx] = { ...newItems[idx], productName: e.target.value, partName: e.target.value };
          setEnquiryForm({...enquiryForm, items: newItems});
        }} />
        <input type="number" className={`${compactInput} w-[3.75rem]`} placeholder="Qty" value={item.quantity} onChange={e => {
          const newItems = [...(enquiryForm.items || [])];
          newItems[idx] = { ...newItems[idx], quantity: e.target.value };
          setEnquiryForm({...enquiryForm, items: newItems});
        }} />
        <label className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-dashed border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700">
          <UploadCloud size={13}/>{((item.files || []).length + getItemFileEntries(item).length) ? `${(item.files || []).length + getItemFileEntries(item).length} file(s)` : 'Upload file'}
          <input type="file" multiple accept="*/*" className="hidden" onChange={e => {
            const selectedFiles = Array.from(e.currentTarget.files || []);
            e.currentTarget.value = '';
            if (selectedFiles.length) {
              setEnquiryForm((prev: any) => ({
                ...prev,
                items: (prev.items || []).map((it: any, i: number) => i === idx ? { ...it, files: [...(it.files || []), ...selectedFiles] } : it)
              }));
            }
          }} />
        </label>
        {((item.files || []).length > 0 || getItemFileEntries(item).length > 0) && (
          <div className="flex flex-wrap gap-1 items-center">
            {((item.files || []) as File[]).map((file: File, fileIdx: number) => (
              <span key={`enq-f-${file.name}-${fileIdx}`} className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600">
                <span className="max-w-[8rem] truncate font-medium">{file.name}</span>
                <button
                  type="button"
                  title={`Remove ${file.name}`}
                  className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-xs font-bold leading-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnquiryForm((prev: any) => ({
                      ...prev,
                      items: (prev.items || []).map((it: any, i: number) => i === idx ? {
                        ...it,
                        files: (it.files || []).filter((_: File, j: number) => j !== fileIdx)
                      } : it)
                    }));
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            {getItemFileEntries(item).map((f: any, fpi: number) => (
              <span key={`enq-fp-${f.key || f.path}-${fpi}`} className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600">
                <button type="button" className="max-w-[8rem] truncate text-blue-700 hover:underline" onClick={() => void openProductFile(f.path)}>{f.name}</button>
                <button
                  type="button"
                  title={`Remove ${f.name}`}
                  className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-xs font-bold leading-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnquiryForm((prev: any) => ({
                      ...prev,
                      items: (prev.items || []).map((it: any, i: number) => i === idx ? {
                        ...it,
                        filePaths: (it.filePaths || []).filter((p: any) => (typeof p === 'string' ? p : p.path || p.url) !== f.path)
                      } : it)
                    }));
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input className={`${compactInput} w-[6.5rem]`} placeholder="Remarks..." value={item.remarks || ''} onChange={e => {
          const newItems = [...(enquiryForm.items || [])];
          newItems[idx] = { ...newItems[idx], remarks: e.target.value };
          setEnquiryForm({...enquiryForm, items: newItems});
        }} />
        {idx > 0 && (
          <button type="button" className="shrink-0 rounded p-1.5 text-red-500 hover:bg-red-50" title="Remove product" onClick={() => {
            const newItems = enquiryForm.items.filter((_: any, i: number) => i !== idx);
            setEnquiryForm({...enquiryForm, items: newItems});
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
          </button>
        )}
      </Fragment>
    );
    return (
    <section className={`rounded-xl border shadow-sm ${tint('Enquiry').panel}`} data-testid="enquiry-entry-form">
      <div className="space-y-2 p-2.5">
        {duplicateSource && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-1.5 text-xs font-semibold text-brand-800">
            <span>Duplicated from: {duplicateSource} · saving creates a brand-new enquiry with its own company ID.</span>
            <button type="button" onClick={() => setDuplicateSource(null)} className="font-bold text-brand-600 underline hover:text-brand-900">Dismiss</button>
          </div>
        )}

        {enquirySaveNotice && (
          <div role="status" data-testid="enquiry-saved-note" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
            <span>✓ Enquiry {enquirySaveNotice} saved. The list below has been refreshed.</span>
            <button type="button" onClick={() => setEnquirySaveNotice(null)} className="font-bold underline hover:text-emerald-900">Dismiss</button>
          </div>
        )}

        {/* One compact row: header (back + title), company, product line, actions, search. */}
        <div ref={enquiryRowRef} className="relative flex flex-wrap items-center gap-1.5">
          {opts?.onBack && (
            <div className="flex items-center gap-1.5 shrink-0 mr-1">
              <button 
                type="button" 
                onClick={opts.onBack} 
                title="Back to Pipeline"
                className="p-1 hover:bg-slate-200/80 rounded-md transition-colors text-slate-600 shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-sm font-bold text-slate-800 shrink-0">Enquiries</h2>
              <span className="h-5 w-px shrink-0 bg-slate-300 ml-1" aria-hidden="true" />
            </div>
          )}

          <CustomerAutocomplete
            label="Company"
            required
            inlineLabel
            value={enquiryForm.company}
            onChange={val => handleCompanyChange(val)}
            onSelectCustomer={c => handleCompanyChange(c.company)}
            companies={allKnownCompanies}
            inputClass={`${compactInput} w-[9rem]`}
            placeholder="Type or select company..."
          />
          <button type="button" onClick={openNewLeadModal} className="h-7 whitespace-nowrap rounded-md border border-brand-200 bg-brand-50/50 px-2 text-[11px] font-bold text-brand-600 transition-colors hover:border-brand-400 hover:text-brand-800">+ Add New Company</button>
          <button type="button" className="h-7 whitespace-nowrap rounded-md border border-brand-200 bg-brand-50/50 px-2 text-[11px] font-bold text-brand-600 transition-colors hover:border-brand-400 hover:text-brand-800" onClick={() => {
            setEnquiryForm({...enquiryForm, items: [...(enquiryForm.items || []), { productName: '', partName: '', quantity: '', remarks: '', filePaths: [] as string[], files: [] as File[] }]});
          }}>+ Add Product</button>

          <span className="h-6 w-px shrink-0 bg-slate-300" aria-hidden="true" />

          {(enquiryForm.items || [{ productName: '', partName: '', quantity: '', remarks: '', filePaths: [] as string[], files: [] as File[] }]).slice(0, 1).map((item: any, idx: number) => (
            <span key={idx} ref={firstEnquiryItemRef} className="inline-flex flex-wrap items-center gap-1.5">{renderItemFields(item, idx)}</span>
          ))}
          <datalist id="enquiry-product-list">{existingProductNames.map(n => <option key={n} value={n} />)}</datalist>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!opts?.popup && (
              <>
            <Button variant="secondary" size="sm" onClick={() => { setEnquiryForm(resetEnquiryForm()); setDuplicateSource(null); setEnquirySaveNotice(null); }}>Clear / Reset</Button>
            <Button size="sm" onClick={saveEnquiry} disabled={savingEnquiry} className={MODULE_THEMES.Enquiry.btnPrimary}>{savingEnquiry ? 'Saving...' : 'Save Enquiry'}</Button>
              </>
            )}
            {opts?.searchSlot && (
              <>
                <span className="h-6 w-px shrink-0 bg-slate-300 mx-0.5" aria-hidden="true" />
                {opts.searchSlot}
              </>
            )}
          </div>
          {/* Added products: each on its own full-width line below, indented to sit
              straight under the first line's product fields. No sideways scroll. */}
          {(enquiryForm.items || []).slice(1).map((item: any, i: number) => {
            const idx = i + 1;
            return (
              <div key={idx} style={{ paddingLeft: enquiryItemIndent }} className="flex flex-wrap items-center gap-1.5 basis-full border-t border-slate-200/60 pt-2">
                {renderItemFields(item, idx)}
              </div>
            );
          })}
        </div>
      </div>
    </section>
    );
  };

  // ── New Sales Order entry form ──────────────────────────────────────────
  // This used to be the body of the "Create Sales Order" popup. It is now rendered by
  // SalesOrderModule directly above its table, so the page loads with the form already
  // open. Every field, the company search/autocomplete, the dynamic product rows, the
  // drawing uploads and saveStandaloneSalesOrder are unchanged — only the modal chrome
  // (backdrop, positioning, close button and footer) is gone.
  const renderSalesOrderEntryForm = (opts?: { onBack?: () => void; searchSlot?: ReactNode; popup?: boolean }) => {
    const isSoDeliveryDateInvalid = Boolean(
      soForm.orderDate && soForm.deliveryDate && soForm.deliveryDate <= soForm.orderDate
    );
    const minDeliveryDate = soForm.orderDate ? (() => {
      const parts = String(soForm.orderDate).split('-');
      if (parts.length !== 3) return undefined;
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + 1);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })() : undefined;

    return (
    <section className={`rounded-xl border shadow-sm ${tint('Sales Order').panel}`} data-testid="so-entry-form">
      <div className="space-y-2.5 p-3">
        {soSaveNotice && (
          <div role="status" data-testid="so-saved-note" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
            <span>✓ Sales order {soSaveNotice} saved. The list below has been refreshed.</span>
            <button type="button" onClick={() => setSoSaveNotice(null)} className="font-bold underline hover:text-emerald-900">Dismiss</button>
          </div>
        )}

        {/* One compact row for the order fields on a single line. In the board
            popup the row wraps instead of scrolling, so the company dropdown
            is never clipped by the scroll container. */}
        <div className={opts?.popup ? 'flex flex-wrap items-center gap-2' : 'flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-thin'}>
          {opts?.onBack && (
            <div className="flex items-center gap-1.5 shrink-0 mr-1">
              <button 
                type="button" 
                onClick={opts.onBack} 
                title="Back to Pipeline"
                className="p-1 hover:bg-slate-200/80 rounded-md transition-colors text-slate-600 shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-sm font-bold text-slate-800 shrink-0 whitespace-nowrap">Sales Orders</h2>
              <span className="h-5 w-px shrink-0 bg-slate-300 ml-1" aria-hidden="true" />
            </div>
          )}

          <div className="shrink-0">
            <CustomerAutocomplete
              label="Company"
              required
              inlineLabel
              value={soForm.customer || ''}
              onChange={val => setSoForm((prev: any) => ({ ...prev, customer: val }))}
              companies={allKnownCompanies}
              inputClass={`${compactInput} w-[11rem]`}
              placeholder="Company..."
            />
          </div>
          <div className="shrink-0">
            <FormField label="Order Date" required inline><input type="date" className={`${compactInput} w-[8.25rem]`} value={soForm.orderDate || ''} onChange={e=>setSoForm({...soForm, orderDate: e.target.value})} /></FormField>
          </div>
          <div className="shrink-0">
            <FormField label="Delivery Date" required inline>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  className={`${compactInput} w-[8.25rem] transition-colors ${
                    isSoDeliveryDateInvalid
                      ? '!border-red-500 !text-red-600 !bg-red-50 font-semibold focus:!border-red-600 focus:!ring-red-200'
                      : ''
                  }`}
                  value={soForm.deliveryDate || ''}
                  min={minDeliveryDate}
                  title={isSoDeliveryDateInvalid ? 'Delivery date must be after order date' : undefined}
                  onChange={e => setSoForm({ ...soForm, deliveryDate: e.target.value })}
                />
                {isSoDeliveryDateInvalid && (
                  <span
                    className="text-[11px] font-bold text-red-600 whitespace-nowrap"
                    title="Delivery date must be after order date"
                  >
                    Must be after order date
                  </span>
                )}
              </div>
            </FormField>
          </div>
          <div className="shrink-0">
            <FormField label="PO No" inline><input className={`${compactInput} w-[7.5rem]`} placeholder="Customer PO" value={soForm.customerPoNo || ''} onChange={e=>setSoForm({...soForm, customerPoNo: e.target.value})} /></FormField>
          </div>

          <span className="h-6 w-px shrink-0 bg-slate-300" aria-hidden="true" />

          <button type="button" onClick={() => setSoForm((prev: any) => ({ ...prev, items: [...(prev.items || []), { id: crypto.randomUUID(), partName: '', quantity: '', rejectedQty: '', itemStatus: 'Confirmed', unitPrice: '', gst: '18', files: [] }] }))}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-brand-600 hover:text-brand-700">
            <span className="text-sm">+</span> Add Product
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!opts?.popup && (
              <>
            <Button variant="secondary" size="sm" onClick={() => { setSoForm(resetSoForm()); setSoSaveNotice(null); }}>Clear / Reset</Button>
            <Button size="sm" onClick={saveStandaloneSalesOrder} disabled={savingSo || isSoDeliveryDateInvalid} className={MODULE_THEMES['Sales Order'].btnPrimary}>{savingSo ? 'Saving...' : 'Save Order'}</Button>
              </>
            )}
            {opts?.searchSlot && (
              <>
                <span className="h-6 w-px shrink-0 bg-slate-300 mx-0.5" aria-hidden="true" />
                {opts.searchSlot}
              </>
            )}
          </div>
        </div>
        {(soForm.items || []).length > 0 && (
          <div className="grid grid-cols-[2rem_minmax(0,1fr)_4rem_6rem_3.75rem_6rem_2rem] gap-2 items-center px-1 pt-0.5">
            <span></span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Product Name</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Qty</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Unit Price (₹)</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">GST %</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Drawings</span>
            <span></span>
          </div>
        )}
        {(soForm.items || []).map((item: any, idx: number) => {
          const upd = (patch: any) => setSoForm((prev: any) => ({ ...prev, items: (prev.items || []).map((r: any, i: number) => (i === idx ? { ...r, ...patch } : r)) }));
          return (
            <div key={item.id || idx} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_4rem_6rem_3.75rem_6rem_2rem] gap-2 items-center">
                <span className="text-[11px] font-bold text-slate-400 text-center">{idx + 1}</span>
                <input className={compactCell} placeholder="Product name" list="saved-products" value={item.partName || ''} onChange={e=>upd({ partName: e.target.value })} />
                <input type="number" min={0} className={compactCell} placeholder="Qty" value={item.quantity ?? ''} onChange={e=>upd({ quantity: e.target.value })} />
                <input type="number" min={0} className={compactCell} placeholder="Unit Price (₹)" value={item.unitPrice ?? ''} onChange={e=>upd({ unitPrice: e.target.value })} />
                <input type="number" min={0} className={compactCell} placeholder="GST %" value={item.gst ?? ''} onChange={e=>upd({ gst: e.target.value })} />
                <label className="inline-flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700" title="Attach drawings or any file (all formats)">
                  <UploadCloud size={13} />{((item.files || []).length + getItemFileEntries(item).length) ? `${(item.files || []).length + getItemFileEntries(item).length} file${((item.files || []).length + getItemFileEntries(item).length) === 1 ? '' : 's'}` : 'Upload'}
                  <input type="file" multiple accept="*/*" className="hidden" aria-label={`Drawings for product ${idx + 1}`} onChange={e => {
                    const picked = Array.from(e.currentTarget.files || []);
                    e.currentTarget.value = '';
                    if (picked.length) {
                      setSoForm((prev: any) => ({
                        ...prev,
                        items: (prev.items || []).map((r: any, i: number) => i === idx ? { ...r, files: [...(r.files || []), ...picked] } : r)
                      }));
                    }
                  }} />
                </label>
                <button type="button" title={`Remove product ${idx + 1}`} aria-label={`Remove product ${idx + 1}`} className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-rose-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => setSoForm((prev: any) => ({ ...prev, items: (prev.items || []).filter((_: any, i: number) => i !== idx) }))}>×</button>
              </div>
              {((item.files || []).length > 0 || getItemFileEntries(item).length > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5 pl-9" data-testid="so-files">
                  {getItemFileEntries(item).map((f: any, fpi: number) => (
                    <span key={`so-fp-${f.key || f.path}-${fpi}`} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700 shadow-xs">
                      <button type="button" className="max-w-[180px] truncate font-medium text-blue-700 hover:underline" onClick={() => void openProductFile(f.path)}>{f.name}</button>
                      <button
                        type="button"
                        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-sm font-bold leading-none"
                        title={`Remove ${f.name}`}
                        aria-label={`Remove ${f.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSoForm((prev: any) => ({
                            ...prev,
                            items: (prev.items || []).map((r: any, i: number) => i === idx ? {
                              ...r,
                              filePaths: (r.filePaths || []).filter((p: any) => (typeof p === 'string' ? p : p.path || p.url) !== f.path)
                            } : r)
                          }));
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {((item.files || []) as File[]).map((f: File, fi: number) => (
                    <span key={`so-f-${f.name}-${fi}`} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700 shadow-xs">
                      <span className="max-w-[180px] truncate font-medium">{f.name}</span>
                      <button
                        type="button"
                        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-sm font-bold leading-none"
                        title={`Remove ${f.name}`}
                        aria-label={`Remove ${f.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSoForm((prev: any) => ({
                            ...prev,
                            items: (prev.items || []).map((r: any, i: number) => i === idx ? {
                              ...r,
                              files: (r.files || []).filter((_: any, j: number) => j !== fi)
                            } : r)
                          }));
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};


  // -- New Delivery Challan entry form ------------------------------------
  // This used to be the body of the "Delivery Challan Form" popup. DeliveryChallanModule
  // renders it directly above its table, so the page opens with the form ready. Every
  // field, the party search/autocomplete, the multi-product rows, the signature pads,
  // the approved-price panel and saveDeliveryChallan are unchanged - only the modal
  // wrapper (backdrop, positioning, close button, footer) is gone.
  const clearDcForm = () => {
    if (dcSnapshot) {
      const c = JSON.parse(JSON.stringify(dcSnapshot));
      setDcForm({ ...c.form, dcNo: `DC-2026-${Math.floor(1000 + Math.random() * 9000)}` });
      setDcItems(c.items.map((l: any) => ({ ...l })));
    }
    setDcSaveNotice(null);
  };
  const renderDeliveryChallanEntryForm = (opts?: { onBack?: () => void; searchSlot?: ReactNode; popup?: boolean }) => (
    <section className={`rounded-xl border shadow-sm ${tint('DC').panel}`} data-testid="dc-entry-form">
      <div className="space-y-2.5 p-3">
        {dcSaveNotice && (
          <div role="status" data-testid="dc-saved-note" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
            <span>&#10003; Delivery Challan {dcSaveNotice} saved. The list below has been refreshed.</span>
            <button type="button" onClick={() => setDcSaveNotice(null)} className="font-bold underline hover:text-emerald-900">Dismiss</button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {/* Row 1 - party identity. Inline labels + one shared centre line, so the whole
              block reads as a toolbar instead of five stacked label/control pairs. */}
          <div className="flex flex-wrap items-center gap-2">
            {opts?.onBack && (
              <div className="flex items-center gap-1.5 shrink-0 mr-1">
                <button 
                  type="button" 
                  onClick={opts.onBack} 
                  title="Back to Pipeline"
                  className="p-1 hover:bg-slate-200/80 rounded-md transition-colors text-slate-600 shrink-0 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <h2 className="text-sm font-bold text-slate-800 shrink-0">Delivery Challans</h2>
                <span className="h-5 w-px shrink-0 bg-slate-300 ml-1" aria-hidden="true" />
              </div>
            )}
            <FormField label="DC No" required inline><input className={`${compactInput} w-[9rem]`} value={dcForm.dcNo || ''} onChange={e=>setDcForm({...dcForm, dcNo: e.target.value})} /></FormField>
            <FormField label="Date" required inline><input type="date" className={`${compactInput} w-[10.5rem]`} value={dcForm.date || ''} onChange={e=>setDcForm({...dcForm, date: e.target.value})} /></FormField>
            <CustomerAutocomplete
              label="Company Name"
              required
              inlineLabel
              value={dcForm.partyName || ''}
              onChange={val => setDcForm((prev: any) => ({ ...prev, partyName: val }))}
              onSelectCustomer={(c: any) => {
                const nm = String(c.company || '');
                const m: any = (customerList || []).find((x: any) => String(x.name || '').trim().toLowerCase() === nm.trim().toLowerCase()) || {};
                setDcForm((prev: any) => ({
                  ...prev, partyName: nm,
                  partyCode: m.id || '',
                  partyAddress: m.city || c.city || '',
                  partyGstin: m.gst || m.gstin || (c as any).gst || '',
                  phone: m.phone || c.phone || '',
                }));
              }}
              companies={allKnownCompanies}
              inputClass={`${compactInput} w-[14rem]`}
              placeholder="Type or select company..."
            />
            <FormField label="Company Address" inline><input className={`${compactInput} w-[14rem]`} value={dcForm.partyAddress || ''} onChange={e=>setDcForm({...dcForm, partyAddress: e.target.value})} /></FormField>
            <FormField label="Company GSTIN" inline><input className={`${compactInput} w-[11rem]`} value={dcForm.partyGstin || ''} onChange={e=>setDcForm({...dcForm, partyGstin: e.target.value})} /></FormField>
          </div>
          {/* Row 2 - dispatch references. */}
          <div className="flex flex-wrap items-center gap-2">
            <FormField label="Company Code" inline><input className={`${compactInput} w-[8rem]`} value={dcForm.partyCode || ''} onChange={e=>setDcForm({...dcForm, partyCode: e.target.value})} /></FormField>
            <FormField label="E-Way Bill No" inline><input className={`${compactInput} w-[10rem]`} value={dcForm.ewayBill || ''} onChange={e=>setDcForm({...dcForm, ewayBill: e.target.value})} /></FormField>
            <FormField label="PO Number" inline><input className={`${compactInput} w-[10rem]`} value={dcForm.poNumber || ''} onChange={e=>setDcForm({...dcForm, poNumber: e.target.value})} /></FormField>
            <FormField label="Place of Supply" inline><input className={`${compactInput} w-[11rem]`} value={dcForm.placeOfSupply || ''} onChange={e=>setDcForm({...dcForm, placeOfSupply: e.target.value})} /></FormField>
            <FormField label="Packaging Details" inline><input className={`${compactInput} w-[12rem]`} value={dcForm.packaging || ''} onChange={e=>setDcForm({...dcForm, packaging: e.target.value})} /></FormField>
          </div>
          {/* Row 3 - logistics. */}
          <div className="flex flex-wrap items-center gap-2">
            <FormField label="Enquiry No" inline><input className={`${compactInput} w-[10rem]`} value={dcForm.enquiryNo || ''} onChange={e=>setDcForm({...dcForm, enquiryNo: e.target.value})} /></FormField>
            <FormField label="Vehicle No" inline><input className={`${compactInput} w-[9rem]`} value={dcForm.vehicleNo || ''} onChange={e=>setDcForm({...dcForm, vehicleNo: e.target.value})} /></FormField>
            <FormField label="Phone No" inline><input className={`${compactInput} w-[9rem]`} value={dcForm.phone || ''} onChange={e=>setDcForm({...dcForm, phone: e.target.value})} /></FormField>
            <FormField label="Category" inline><input className={`${compactInput} w-[13rem]`} list="dc-category-list" value={dcForm.category || ''} onChange={e=>setDcForm({...dcForm, category: e.target.value})} placeholder="Select or type category" /></FormField>
            <FormField label="Process" inline><input className={`${compactInput} w-[13rem]`} list="dc-process-list" value={dcForm.process || ''} onChange={e=>setDcForm({...dcForm, process: e.target.value})} placeholder="Select or type process" /></FormField>
          </div>
          <datalist id="dc-category-list">
            {(partsMaster.some((p: any) => p.category) ? Array.from(new Set(partsMaster.map((p: any) => p.category).filter(Boolean))) : ['GOODS PURCHASE', 'SERVICE PURCHASE', 'CUSTOMER DC', 'NEW PART', 'NO DC', 'EXPENSES']).map((c: string) => <option key={c} value={c} />)}
          </datalist>
          <datalist id="dc-process-list">
            {processList.map((p: any) => <option key={p.id || p.process_code} value={`${p.process_code} — ${p.process_name}`} />)}
          </datalist>
          <div>
            <div className="grid grid-cols-[auto_minmax(0,1.5fr)_5rem_4.5rem_4rem_5.5rem_6rem] gap-2 items-center mb-1 px-1">
              <span></span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">Part Name</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">HSN</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">Qty</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">Unit</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">Price</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">Amount</span>
            </div>
            {dcItems.map((it, idx) => {
              const amt = (Number(it.qty) || 0) * (Number(it.price) || 0);
              return (
                <div key={idx} className={`grid grid-cols-[auto_minmax(0,1.5fr)_5rem_4.5rem_4rem_5.5rem_6rem] gap-2 items-center rounded-lg border px-2 py-1.5 mb-1.5 ${it.selected ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200'}`}>
                  <input
                    type="checkbox"
                    checked={it.selected}
                    onChange={(e) => setDcItems((prev) => prev.map((x, i) => (i === idx ? { ...x, selected: e.target.checked } : x)))}
                    className="h-4 w-4 accent-orange-600"
                    aria-label={`Select ${it.name || 'product'}`}
                  />
                  <div>
                    <input
                      className={compactCell} list="dc-product-list" placeholder="Part name" value={it.name || ''}
                      onChange={(e) => {
                        const nm = e.target.value;
                        const key = nm.trim().toLowerCase();
                        const m = partsMaster.find((p: any) => String(p.part_name || '').trim().toLowerCase() === key);
                        const l = dcPricing.lines.find((x) => x.name.trim().toLowerCase() === key);
                        setDcItems((prev) => prev.map((x, i) => (i === idx ? {
                          ...x, name: nm,
                          hsn: x.hsn || (m as any)?.hsn || '',
                          unit: x.unit || m?.unit || 'Nos',
                          price: x.price || (l ? String(l.unit) : x.price),
                        } : x)));
                      }}
                    />
                  </div>
                  <input className={compactCell} placeholder="HSN" value={it.hsn || ''} onChange={(e) => setDcItems((prev) => prev.map((x, i) => (i === idx ? { ...x, hsn: e.target.value } : x)))} />
                  <div>
                    <input
                      type="number" min={0}
                      disabled={!it.selected}
                      value={it.qty}
                      onChange={(e) => setDcItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))}
                      className={`${compactCell} tabular-nums disabled:bg-slate-100`}
                    />
                    {it.avail != null && <p className="text-[10px] font-semibold text-violet-700 tabular-nums mt-0.5">Available: {it.avail}</p>}
                  </div>
                  <input className={compactCell} placeholder="Nos" value={it.unit || ''} onChange={(e) => setDcItems((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))} />
                  <input type="number" min={0} className={compactCell} placeholder="0.00" value={it.price || ''} onChange={(e) => setDcItems((prev) => prev.map((x, i) => (i === idx ? { ...x, price: e.target.value } : x)))} />
                  <input className={`${compactCell} bg-white font-bold tabular-nums`} value={amt ? amt.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 0} disabled />
                </div>
              );
            })}
            <datalist id="dc-product-list">
              {(() => {
                // Sales-order products carry their company and date/time as the second line; parts-master names follow.
                const so = enquiryProductOptions(rawLeadsList, undefined, salesOrdersList).filter((o: any) => o.saleOrderRef || o.saleStamp);
                const label = new Map<string, string>(so.map((o: any) => [o.name, [o.customer, o.saleLabel].filter(Boolean).join(' · ')]));
                return Array.from(new Set([...so.map((o: any) => o.name), ...partsMaster.map((p: any) => p.part_name)].filter(Boolean)))
                  .map((n: string) => <option key={n} value={n} label={label.get(n) || undefined} />);
              })()}
            </datalist>
            <button type="button" onClick={() => setDcItems((prev) => [...prev, { name: '', avail: null, qty: '', selected: true, hsn: '', unit: 'Nos', price: '' }])} className="mt-1 flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-brand-600 hover:text-brand-700">
              <span className="text-sm">+</span> Add Part
            </button>
            {dcPricing.loading ? (
              <p className="text-[11px] text-slate-400 mt-2">Resolving approved price…</p>
            ) : dcPricing.lines.length > 0 && (
              <div className="text-xs bg-brand-50/60 border border-brand-100 rounded-lg px-3 py-1.5 mt-2 space-y-0.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700">Approved price (costing sheet)</p>
                {dcPricing.lines.map((l) => (
                  <p key={l.name} className="font-semibold text-slate-700 tabular-nums">
                    {l.name} — {formatINR(l.unit)}/pc <span className="font-normal text-slate-500">({l.sheetRef})</span>
                  </p>
                ))}
              </div>
            )}
          </div>
          {/* Sign-off row. The pads cannot shrink to input height, so they keep their own
              compact line with the names set inline beside them. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-start">
            <FormField label="Receiver Name" inline><input className={`${compactInput} w-[8rem]`} value={dcForm.receiverName || ''} onChange={e=>setDcForm({...dcForm, receiverName: e.target.value})} /></FormField>
            <div>
              <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Customer Signature</span>
              <SignaturePad height={56} value={dcForm.custSignature || null} onChange={(v) => setDcForm((prev: any) => ({ ...prev, custSignature: v }))} />
            </div>
            <FormField label="Sender Name" inline><input className={`${compactInput} w-[8rem]`} value={dcForm.senderName || ''} onChange={e=>setDcForm({...dcForm, senderName: e.target.value})} /></FormField>
            <div>
              <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Authorized Signature</span>
              <SignaturePad height={56} value={dcForm.authSignature || null} onChange={(v) => setDcForm((prev: any) => ({ ...prev, authSignature: v }))} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-2.5">
          {opts?.searchSlot && (
            <div className="flex shrink-0 items-center">
              {opts.searchSlot}
            </div>
          )}
          {!opts?.popup && (
            <>
          <Button variant="secondary" size="sm" onClick={clearDcForm}>Clear / Reset</Button>
          <Button size="sm" onClick={saveDeliveryChallan} disabled={dcSaving} className={MODULE_THEMES.DC.btnPrimary}>{dcSaving ? 'Saving...' : 'Save'}</Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
 
  // -- New Inward Entry form ---------------------------------------------
  // This used to be the body of the "Create Inward Entry" popup. InwardModule renders it
  // directly above its table, so the page opens with the form ready. The parts/items
  // structure, file uploads, per-line validation, saveInward, the "Save & Add Another
  // Inward" flow and the saved-count badge are all unchanged - only the modal wrapper is
  // gone. Done/Cancel became Clear / Reset, because there is no popup to close.
  const clearInwardForm = () => { setInwardSavedCount(0); openDummyInward(); };
  const renderInwardEntryForm = (opts?: { onBack?: () => void; searchSlot?: ReactNode; popup?: boolean }) => (
    <section className={`rounded-xl border shadow-sm ${tint('Inward').panel}`} data-testid="inward-entry-form">
      <div className="space-y-2.5 p-3">
        <div className="flex flex-col gap-4">
          <datalist id="inward-customer-list">
            {(allKnownCompanies || []).map((c: any) => <option key={c.company} value={c.company} />)}
          </datalist>

          {inwardSavedCount > 0 && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700" data-testid="inward-saved-note">✓ {inwardSavedCount} saved — add the next inward</span>
            </div>
          )}
          <div className="space-y-2.5">
            {(inwardForm.parts || []).map((group: any, index: number) => {
              const setGroup = (patch: any) => { const parts=[...inwardForm.parts]; parts[index]={...group, ...patch}; setInwardForm({...inwardForm, parts}); };
              const setItem = (ii: number, patch: any) => { const items=[...(group.items || [])]; items[ii]={...items[ii], ...patch}; setGroup({ items }); };
              const lineTotal = (it: any) => inwardLineTotal(it.quantity, it.price, it.discount, it.gst);
              const productOptions = inwardLegacyOptions(group);
              const addPartBtn = (
                <button type="button" className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-brand-600 hover:text-brand-800" onClick={() => setGroup({ items: [...(group.items || []), emptyInwardItem()] })}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add part
                </button>
              );
              return (
              <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {index === 0 && opts?.onBack ? (
                    <div className="flex items-center gap-1.5 shrink-0 mr-1">
                      <button 
                        type="button" 
                        onClick={opts.onBack} 
                        title="Back to Pipeline"
                        className="p-1 hover:bg-slate-200/80 rounded-md transition-colors text-slate-600 shrink-0 cursor-pointer"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <h2 className="text-sm font-bold text-slate-800 shrink-0">Inwards</h2>
                      <span className="h-5 w-px shrink-0 bg-slate-300 ml-1" aria-hidden="true" />
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs font-bold uppercase text-slate-600">Inward {index + 1}</span>
                  )}
                  <FormField label="Category" required inline>
                    <select className={`${compactInput} w-[11rem]`} value={group.category || 'GOODS PURCHASE'} onChange={e=>setGroup({ category: e.target.value })}>
                      <option>EXPENSES</option>
                      <option>CUSTOMER DC</option>
                      <option>NEW PART</option>
                      <option>NO DC</option>
                      <option>GOODS PURCHASE</option>
                      <option>SERVICE PURCHASE</option>
                    </select>
                  </FormField>
                  <div className="flex items-center gap-1.5">
                    <span className={inlineLbl}>Company</span>
                    <input className={`${compactInput} w-[12rem]`} placeholder="Company" list="inward-customer-list" value={group.partyName ?? inwardForm.partyName ?? ''} onChange={e=>onInwardCompanyChange(index, e.target.value)} />
                  </div>
                  <FormField label="Inward Date" required inline><input type="date" className={`${compactInput} w-[10.5rem]`} value={group.inwardDate || ''} onChange={e=>setGroup({ inwardDate: e.target.value })} /></FormField>
                  <FormField label="Reference No." inline><input className={`${compactInput} w-[10rem]`} value={group.referenceNo || ''} onChange={e=>setGroup({ referenceNo: e.target.value })} placeholder="e.g. DC/Invoice No" /></FormField>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={inlineLbl}>Files</span>
                    <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-dashed border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700" title="Attach bills, DCs or any file (all formats)">
                      <UploadCloud size={13}/>{(group.files || []).length ? `${group.files.length} file${group.files.length === 1 ? '' : 's'}` : 'Choose Files'}
                      <input type="file" multiple accept="*/*" className="hidden" onChange={e=>{
                        const picked = Array.from(e.target.files || []);
                        e.currentTarget.value = '';
                        if (picked.length) {
                          setGroup({ files: [...(group.files || []), ...picked] });
                        }
                      }} />
                    </label>
                    {(group.files || []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {((group.files || []) as File[]).map((f: File, fi: number) => (
                          <span key={`inw-f-${f.name}-${fi}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-700 shadow-xs">
                            <span className="max-w-[110px] truncate font-medium">{f.name}</span>
                            <button
                              type="button"
                              className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-xs font-bold leading-none"
                              title={`Remove ${f.name}`}
                              aria-label={`Remove ${f.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setInwardForm((prev: any) => ({
                                  ...prev,
                                  parts: (prev.parts || []).map((p: any, pi: number) => pi === index ? {
                                    ...p,
                                    files: (p.files || []).filter((_: any, j: number) => j !== fi)
                                  } : p)
                                }));
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {addPartBtn}
                  {inwardForm.parts.length > 1 && <button type="button" onClick={() => setInwardForm({...inwardForm, parts: inwardForm.parts.filter((_: any, i: number) => i !== index)})} className="ml-auto shrink-0 text-xs font-medium text-rose-600 hover:text-rose-800">Remove</button>}
                </div>
                {(group.items || []).map((item: any, ii: number) => (
                  <div key={ii} className={opts?.popup ? 'mt-1.5 grid grid-cols-2 xl:grid-cols-4 items-center gap-x-2 gap-y-1.5 border-t border-slate-200 pt-1.5 pb-1' : 'mt-1.5 flex flex-nowrap items-center gap-1.5 border-t border-slate-200 pt-1.5 overflow-x-auto py-1'}>
                    <span className={opts?.popup ? 'hidden' : 'w-4 shrink-0 text-center text-[11px] font-bold text-slate-400'}>{ii + 1}</span>
                    <div className={opts?.popup ? 'flex min-w-0 items-center' : 'flex shrink-0 min-w-0 items-center'}>
                      {(group.category || 'GOODS PURCHASE') === 'EXPENSES' ? (
                        <>
                          <input className={opts?.popup ? `${compactInput} w-full min-w-0` : `${compactInput} w-[12.5rem]`} list={`expense-products-${index}-${ii}`} placeholder="Search & select product / project" title="Product" value={item.productName || ''}
                            onChange={e => onInwardProductInput(index, ii, e.target.value, { allowFreeText: true })} />
                          <datalist id={`expense-products-${index}-${ii}`}>
                            {eligibleCatalogue.map((m: any) => <option key={m.key} value={m.name}>{[m.code, m.unit ? `per ${m.unit}` : '', m.unitPrice ? `₹${m.unitPrice}` : ''].filter(Boolean).join(' · ')}</option>)}
                            {(inwardForm.productOptions || []).map((o: any) => <option key={o.key} value={o.name} />)}
                          </datalist>
                        </>
                      ) : (
                        <>
                          <input className={opts?.popup ? `${compactInput} w-full min-w-0` : `${compactInput} w-[12.5rem]`} list={`inward-products-${index}-${ii}`} placeholder="Search & select product" title="Product" value={item.productDisplay || item.productName || ''}
                            onChange={e => onInwardProductInput(index, ii, e.target.value)} />
                          <datalist id={`inward-products-${index}-${ii}`}>
                            {eligibleCatalogue.map((m: any) => <option key={m.key} value={m.name}>{[m.code, m.unit ? `per ${m.unit}` : '', m.unitPrice ? `₹${m.unitPrice}` : ''].filter(Boolean).join(' · ')}</option>)}
                            {productOptions.map((option: any) => <option key={option.key} value={option.display || option.name} />)}
                          </datalist>
                        </>
                      )}
                    </div>
                    <input className={opts?.popup ? `${compactInput} w-full min-w-0` : `${compactInput} w-[9.5rem] shrink-0`} placeholder="Part Name *" title="Part Name" list="saved-products" value={item.partName || ''} onChange={e=>setItem(ii, { partName: e.target.value })} />
                    <input className={opts?.popup ? `${compactInput} w-full min-w-0` : `${compactInput} w-[8.5rem] shrink-0`} placeholder="Remarks..." title="Remarks" value={item.remarks ?? ''} onChange={e=>setItem(ii, { remarks: e.target.value })} />
                    <div className={opts?.popup ? 'flex min-w-0 items-center gap-1' : 'flex shrink-0 items-center gap-1'}><span className={inlineLbl}>Qty *</span>
                      <input type="number" min="0" className={opts?.popup ? `${compactInput} w-full min-w-0` : `${compactInput} w-[4.25rem]`} placeholder="Qty" value={item.quantity || ''} onChange={e=>setItem(ii, { quantity: e.target.value })} /></div>
                    <div className={opts?.popup ? 'flex min-w-0 items-center gap-1' : 'flex shrink-0 items-center gap-1'}><span className={inlineLbl}>Price *</span>
                      <input type="number" min="0" className={opts?.popup ? `${compactInput} w-full min-w-0` : `${compactInput} w-[5.5rem]`} placeholder="Price" value={item.price || ''} onChange={e=>setItem(ii, { price: e.target.value })} /></div>
                    <div className={opts?.popup ? 'flex min-w-0 items-center gap-1' : 'flex shrink-0 items-center gap-1'}><span className={inlineLbl}>Disc %</span>
                      <input type="number" min="0" className={opts?.popup ? `${compactInput} w-full min-w-0` : `${compactInput} w-[3.75rem]`} placeholder="%" value={item.discount || ''} onChange={e=>setItem(ii, { discount: e.target.value })} /></div>
                    <div className={opts?.popup ? 'flex min-w-0 items-center gap-1' : 'flex shrink-0 items-center gap-1'}><span className={inlineLbl}>GST %</span>
                      <input type="number" min="0" className={opts?.popup ? `${compactInput} w-full min-w-0` : `${compactInput} w-[3.75rem]`} placeholder="%" value={item.gst || ''} onChange={e=>setItem(ii, { gst: e.target.value })} /></div>
                    <div className={opts?.popup ? 'flex min-w-0 items-center gap-1' : 'flex shrink-0 items-center gap-1'}><span className={inlineLbl}>Total</span>
                      <input className={opts?.popup ? `${compactInput} w-full min-w-0 bg-white font-bold` : `${compactInput} w-[5.5rem] bg-white font-bold`} value={lineTotal(item) || 0} title="Total" disabled /></div>
                    <div className={opts?.popup ? 'flex min-w-0 items-center gap-1 col-span-2' : 'flex shrink-0 items-center gap-1'}>
                      <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-dashed border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700" title="Attach drawing or spec for this product">
                        <UploadCloud size={13} />{(item.files || []).length ? `${item.files.length} file${item.files.length === 1 ? '' : 's'}` : 'Attach Drawing'}
                        <input type="file" multiple accept="*/*" className="hidden" onChange={e => {
                          const picked = Array.from(e.target.files || []);
                          e.currentTarget.value = '';
                          if (picked.length) {
                            setItem(ii, { files: [...(item.files || []), ...picked] });
                          }
                        }} />
                      </label>
                      {(item.files || []).length > 0 && (
                        <div className="flex items-center gap-1">
                          {((item.files || []) as File[]).map((f: File, fi: number) => (
                            <span key={`item-f-${f.name}-${fi}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-700 shadow-xs">
                              <span className="max-w-[90px] truncate font-medium">{f.name}</span>
                              <button
                                type="button"
                                className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-xs font-bold leading-none"
                                title={`Remove ${f.name}`}
                                aria-label={`Remove ${f.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setItem(ii, {
                                    files: (item.files || []).filter((_: any, j: number) => j !== fi)
                                  });
                                }}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {(group.items || []).length > 1 ? (
                      <button type="button" className="shrink-0 rounded p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 ml-auto" title="Remove line" onClick={() => setGroup({ items: (group.items || []).filter((_: any, j: number) => j !== ii) })}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                      </button>
                    ) : (item.productName || item.partName || (item.files || []).length > 0) ? (
                      <button type="button" className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 ml-auto" title="Clear line" onClick={() => setItem(ii, emptyInwardItem())}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                    ) : null}
                  </div>
                ))}
                {(inwardForm.productOptions || []).length === 0 && eligibleCatalogue.length === 0 && (group.category || 'GOODS PURCHASE') !== 'EXPENSES' && <span className="mt-1 block text-xs text-amber-700">No products found. Add the product to the Components / Raw Materials master or to an Enquiry first.</span>}
              </div>);
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
          {opts?.searchSlot && (
            <div className="mr-auto flex shrink-0 items-center gap-2">
              <span className="h-6 w-px shrink-0 bg-slate-300 mx-0.5" aria-hidden="true" />
              {opts.searchSlot}
            </div>
          )}
          {!opts?.popup && (
            <>
          <Button variant="secondary" size="sm" onClick={clearInwardForm}>Clear / Reset</Button>
          <Button variant="secondary" size="sm" disabled={savingInward} onClick={() => void saveInward(true)}>{savingInward ? 'Saving...' : 'Save & Add Another Inward'}</Button>
          <Button size="sm" disabled={savingInward} onClick={() => void saveInward(false)} className={MODULE_THEMES.Inward.btnPrimary}>{savingInward ? 'Saving...' : 'Submit'}</Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
 
  // -- Finished Goods + Costing entry form --------------------------------
  // One element, two homes: inline on the Finished Goods list (add mode, above its
  // table), or as a popup from the board drag gate and from Edit / View. Everything
  // inside - the company/product picker, the costing sheet, the pricing-approval gate,
  // saveDraft and approveAndMove - is FgCostingModal's own code, unchanged.
  const fgCostingInline = costingMode === 'add' && activeView === 'fg_list';
  const resetFgEntry = () => {
    // Inline, "Cancel" / "Approve & Move" put the form back on the blank picker so it is
    // ready for the next finished good. As a popup it is simply dismissed, as before.
    if (activeView === 'fg_list') { setCostingMode('add'); setCostingModalTarget(makeFgPickTarget()); }
    else setCostingModalTarget(null);
  };
  // Eligible companies & products for Finished Goods entry:
  // ONLY items from stages BEFORE Finished Goods (Inward, Sales Order).
  // Any items that have already reached or passed Finished Goods (Finished Goods, DC, Invoice)
  // are strictly excluded from the dropdown options.
  const fgPickOptions = useMemo(() => {
    const norm = (s: any) => String(s ?? '').trim().toLowerCase();
    
    // Set of companies & products that have already advanced to Finished Goods, DC, or Invoice
    const postFgProductKeys = new Set<string>();
    cards.filter(c => ['Finished Goods', 'DC', 'Invoice'].includes(c.stage)).forEach(c => {
      const comp = norm(c.customer);
      const part = norm(c.part);
      if (comp && part) postFgProductKeys.add(`${comp}||${part}`);
      if (comp && c.raw) {
        if (c.raw.part_name) postFgProductKeys.add(`${comp}||${norm(c.raw.part_name)}`);
        if (c.raw.product_name) postFgProductKeys.add(`${comp}||${norm(c.raw.product_name)}`);
      }
    });

    const optionsMap = new Map<string, { company: string; product: string; qty?: number }>();

    // 1. From Inward cards (directly before Finished Goods)
    cards.filter(c => c.stage === 'Inward').forEach(c => {
      const company = String(c.customer || '').trim();
      if (!company) return;
      
      const inwardProds = ((c.raw as any)?._inwardProd || []) as { name: string; left: number }[];
      if (inwardProds.length > 0) {
        inwardProds.forEach(p => {
          const prodName = String(p.name || '').trim();
          if (prodName && (p.left > 0 || !p.left)) {
            const key = `${norm(company)}||${norm(prodName)}`;
            optionsMap.set(key, { company, product: prodName, qty: Number((p as any).left) || 0 });
          }
        });
      } else {
        const prod = String(c.raw?.product_name || c.raw?.part_name || c.part || '').trim();
        if (prod && !/^multiple/i.test(prod)) {
          const key = `${norm(company)}||${norm(prod)}`;
          optionsMap.set(key, { company, product: prod, qty: Number(c.qty) || 0 });
        }
      }
    });

    // 2. From Sales Order cards (before Finished Goods)
    cards.filter(c => c.stage === 'Sales Order').forEach(c => {
      const company = String(c.customer || '').trim();
      if (!company) return;
      
      let items: any[] = [];
      try {
        const raw = c.raw?.items;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) items = parsed;
      } catch { /* no lines */ }

      if (items.length > 0) {
        items.forEach((it: any) => {
          let prodName = String(it.partName || it.productName || it.part_name || it.description || '').trim();
          if (prodName) {
            prodName = attachDateTimeToProduct(prodName, c.raw);
            const key = `${norm(company)}||${norm(prodName)}`;
            if (!postFgProductKeys.has(key)) {
              optionsMap.set(key, { company, product: prodName, qty: Number(it.quantity ?? it.qty) || 0 });
            }
          }
        });
      } else {
        let prod = String(c.raw?.part_name || c.part || '').trim();
        if (prod && !/^multiple/i.test(prod)) {
          prod = attachDateTimeToProduct(prod, c.raw);
          const key = `${norm(company)}||${norm(prod)}`;
          if (!postFgProductKeys.has(key)) {
            optionsMap.set(key, { company, product: prod, qty: Number(c.raw?.quantity ?? c.qty) || 0 });
          }
        }
      }
    });

    // 3. From active salesOrdersList (not completed / delivered / invoiced)
    (salesOrdersList || []).filter((o: any) =>
      ['Draft', 'Confirmed', 'Waiting for Parts', 'In Production'].includes(String(o.status || ''))
    ).forEach((o: any) => {
      const company = String(o.customer || o.customer_name || '').trim();
      if (!company) return;
      let items: any[] = [];
      try {
        const r = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
        if (Array.isArray(r)) items = r;
      } catch { /* no lines */ }
      items.forEach((it: any) => {
        let prodName = String(it.partName || it.productName || it.part_name || it.description || '').trim();
        if (prodName) {
          prodName = attachDateTimeToProduct(prodName, o);
          const key = `${norm(company)}||${norm(prodName)}`;
          if (!postFgProductKeys.has(key)) {
            optionsMap.set(key, { company, product: prodName, qty: Number(it.quantity ?? it.qty) || 0 });
          }
        }
      });
    });

    // The same product reached through its inward (plain name) and through its sales order (name + date/time)
    // is one product: keep the sales-order original, once per company.
    const byBase = new Map<string, { company: string; product: string; qty?: number }>();
    for (const o of optionsMap.values()) {
      const k = `${norm(o.company)}||${norm(getProductBaseName(o.product))}`;
      const have = byBase.get(k);
      const stamped = getProductBaseName(o.product) !== o.product;
      if (!have || (stamped && getProductBaseName(have.product) === have.product)) byBase.set(k, o);
    }
    return Array.from(byBase.values());
  }, [cards, salesOrdersList]);

  const fgPickCompanies = useMemo(() => {
    return Array.from(new Set(fgPickOptions.map(o => o.company).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [fgPickOptions]);

  const renderFgCosting = (inline: boolean, target: KanbanCard | null, slots?: { titleSlot?: ReactNode; searchSlot?: ReactNode }) => (
    <ErrorBoundary title="Finished Goods costing failed to open" onClose={() => setCostingModalTarget(null)}>
      <FgCostingModal
        key={`${inline ? 'inline' : 'popup'}-${target?.id ?? ''}`}
        card={target}
        pickOptions={fgPickOptions}
        pickCompanies={fgPickCompanies}
        onPick={(company, product) => {
          const k = (v: any) => String(v ?? '').trim().toLowerCase();
          // First check matching inward card (since Inward is directly before Finished Goods)
          const inwardCard = cards.find(c =>
            c.stage === 'Inward' &&
            k(c.customer) === k(company) &&
            (k(c.part).includes(k(product)) || k((c.raw as any)?.part_name) === k(product) || k((c.raw as any)?.product_name) === k(product) || getProductBaseName(c.part) === getProductBaseName(product))
          );
          // Next check matching order
          const order: any = (salesOrdersList || []).find((o: any) => {
            if (k(o.customer || o.customer_name) !== k(company)) return false;
            try {
              const r = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
              return Array.isArray(r) && r.some((it: any) => {
                const n = it.partName || it.productName || it.part_name || it.description;
                return k(attachDateTimeToProduct(n, o)) === k(product) || k(n) === k(getProductBaseName(product));
              });
            } catch { return false; }
          });
          const base = { id: `fg-${Date.now()}`, stage: 'Inward', type: 'inward', customer: company, part: product, qty: inwardCard?.qty || 0, value: 0, date: '' };
          if (inwardCard) {
            setCostingModalTarget({
              ...inwardCard,
              customer: company,
              part: product,
              raw: { ...inwardCard.raw, part_name: product, product_name: product }
            } as KanbanCard);
          } else if (order) {
            setCostingModalTarget({
              ...base,
              refNo: order.lead_no || order.order_no,
              raw: { sales_order_ref: order.order_no || '', project_name: order.lead_no || order.order_no, _groupIds: [] }
            } as KanbanCard);
          } else {
            setCostingModalTarget({
              ...base,
              refNo: '',
              raw: { sales_order_ref: '', project_name: '', part_name: product, product_name: product, _groupIds: [] }
            } as KanbanCard);
          }
        }}
        mode={costingMode}
        inline={inline}
        titleSlot={slots?.titleSlot}
        searchSlot={slots?.searchSlot}
        onClose={resetFgEntry}
        onMoved={() => { resetFgEntry(); fetchPipeline(); }}
      />
    </ErrorBoundary>
  );
 
  // Hoisted so the JSX below cannot narrow `activeView` part-way through the tree
  // (which would make later, perfectly valid comparisons fail to typecheck).
  const onPipelineView = activeView === 'pipeline';
  const onQuotationView = activeView === 'quotation_list';

  // The quotation tool shortcuts. When the quotation list is showing they are handed to
  // QuotationModule so they sit on the SAME line as its title, search and view toggles
  // instead of stacking a separate bar above the card. When a tool page is open instead,
  // QuotationModule is unmounted, so they fall back to a standalone row above that tool.
  const quotationTools = (
    <nav aria-label="Quotation tools" data-testid="quotation-tools" className="flex flex-wrap items-center gap-1 min-w-0">
      {([
        ['Metal Calculator', 'Calculator', '/quotation/metal-calculator', Calculator, 'text-orange-500'],
        ['Create Quotation', 'Create', '/quotation/create', FileText, 'text-sky-500'],
        ['Client Library', 'Clients', '/quotation/client-library', UsersIcon, 'text-cyan-500'],
        ['Product Library', 'Products', '/quotation/product-library', PackageIcon, 'text-emerald-500'],
        ['Terms Library', 'Terms', '/quotation/terms-library', ScrollText, 'text-amber-500'],
        ['Quotation Library', 'History', '/quotation/library', FolderOpen, 'text-violet-500'],
        ['Company Profile', 'Profile', '/quotation/company-profile', Building2, 'text-lime-600'],
      ] as const).map(([full, label, to, Icon, tone]) => (
        <button key={to} type="button" title={full} aria-label={full} aria-pressed={quoteTool === to}
          onClick={() => setQuoteTool(cur => (cur === to ? null : to))}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-2 border rounded-lg shadow-sm text-xs font-semibold transition-colors ${quoteTool === to ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-brand-50/40'}`}>
          <Icon size={14} className={tone} />{label}
        </button>
      ))}
    </nav>
  );

  // View tabs + All Companies toggle, hoisted so the companies directory can
  // reuse them INSIDE the table toolbar row (everything on one line) instead
  // of stacking a separate bar above the table.
  const viewTabs = (
    <div className="flex p-1 shrink-0 bg-white rounded-lg shadow-sm border border-slate-200">
      <button
        type="button"
        onClick={() => { setActiveView('pipeline'); setPipelineViewMode('kanban'); }}
        className={`px-4 py-1.5 text-sm font-bold rounded-md shadow-sm transition-all ${
          pipelineViewMode === 'kanban'
            ? 'bg-brand-600 text-white shadow-md shadow-brand-500/30 ring-2 ring-brand-500/40'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
        }`}
      >
        Kanban Board
      </button>
      <button
        type="button"
        onClick={() => { setActiveView('pipeline'); setPipelineViewMode('list'); }}
        className={`px-4 py-1.5 text-sm font-bold rounded-md shadow-sm transition-all ${
          pipelineViewMode === 'list'
            ? 'bg-brand-600 text-white shadow-md shadow-brand-500/30 ring-2 ring-brand-500/40'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
        }`}
      >
        List View
      </button>
      <button
        type="button"
        onClick={() => { setActiveView('pipeline'); setPipelineViewMode('calendar'); }}
        className={`px-4 py-1.5 text-sm font-bold rounded-md shadow-sm transition-all ${
          pipelineViewMode === 'calendar'
            ? 'bg-brand-600 text-white shadow-md shadow-brand-500/30 ring-2 ring-brand-500/40'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
        }`}
      >
        Calendar
      </button>
    </div>
  );

  const allCompaniesButton = canView('companies') ? (
    <button
      type="button"
      onClick={() => {
        setActiveView('pipeline');
        setPipelineViewMode(pipelineViewMode === 'companies' ? 'kanban' : 'companies');
      }}
      title="Open All Company Library"
      className={`flex items-center gap-2 px-3.5 py-1.5 text-sm font-semibold rounded-lg border shadow-sm transition-all cursor-pointer shrink-0 whitespace-nowrap ${
        pipelineViewMode === 'companies'
          ? 'bg-brand-600 text-white border-brand-600 shadow-md shadow-brand-500/25 ring-2 ring-brand-500/30'
          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      <Building2 size={15} className={pipelineViewMode === 'companies' ? 'text-white' : 'text-brand-500'} />
      <span>All Company Library</span>
    </button>
  ) : null;

  return (
    <div className="p-4 min-h-full flex flex-col font-sans transition-[background] duration-500" style={{ background: getSalesStageTheme(activeView).gradient }}>



      {/* 3. Tabs & Filters */}
      {/* The board's tabs and filters belong to the pipeline view itself. The list
          modules (Enquiries, Orders, Inward, DC ...) each render their own PageHeader
          with a back arrow, search and view toggles, so showing the board tabs above
          them stacked two headers and a gap for no reason. */}
      {/* 3. Pipeline Toolbar (Tabs, All Companies, and Search/Filters) */}
      {onPipelineView && pipelineViewMode !== 'companies' && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          {/* 1. Board View Toggles + Company Filter Pill */}
          <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap min-w-0">
            {viewTabs}

            {pipelineViewMode !== 'list' && pipelineViewMode !== 'companies' && (
              <div className="relative flex items-center gap-1.5 sm:gap-2 px-3 py-1 bg-white border border-amber-500 rounded-full shadow-xs shrink-0">
                <Building2 size={15} className="text-amber-500 shrink-0" />
                <span className="text-[11px] font-extrabold text-slate-500 tracking-wider uppercase shrink-0">COMPANY:</span>
                <div className="relative flex items-center">
                  <select 
                    className="appearance-none text-xs font-bold text-slate-800 bg-transparent border-0 focus:outline-none cursor-pointer pr-5 py-0 max-w-[150px] md:max-w-[200px] truncate"
                    value={customerFilter}
                    onChange={(e) => {
                      setCustomerFilter(e.target.value);
                      setCompanyFilter(e.target.value);
                    }}
                  >
                    <option value="All Companies">All Companies</option>
                    {Array.from(new Set(cards.map(c => c.customer))).filter(Boolean).sort().map(customer => (
                      <option key={customer} value={customer}>{customer}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="text-slate-700 pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 shrink-0" />
                </div>
              </div>
            )}
          </div>

          {/* The tool strip lives inside QuotationModule's header on the quotation list so
              it shares one line with that card's title, search and view toggles. It only
              needs its own row here when a tool page is open and the module is unmounted. */}
          {onQuotationView && !!quoteTool && (
            <div className="flex flex-1 items-center justify-end min-w-0">{quotationTools}</div>
          )}

          {/* 2. Right Side: All Companies Button + Search and Card Actions */}
          <div className="flex items-center ml-auto gap-2 sm:gap-3 flex-nowrap min-w-0">
            {allCompaniesButton}
            {!onQuotationView && (
              <>
                <div className="relative shrink-0">
                  <input type="text" placeholder="Search cards..." className="pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm w-32 md:w-48 focus:outline-none focus:border-brand-500 bg-white shadow-sm" />
                  <svg className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                </div>
                <button className="p-2 border border-slate-200 rounded-lg bg-white text-slate-600 hover:bg-slate-50 shadow-sm transition-colors shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                </button>
                <button className="p-2 border border-slate-200 rounded-lg bg-white text-slate-600 hover:bg-slate-50 shadow-sm transition-colors shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                </button>
              </>
            )}
          </div>
        </div>
      )}



      {/* 4. Kanban Pipeline (Horizontal Scroll) */}
      {activeView === 'enquiry_list' ? (
        <div className="mb-2.5">
          <EnquiryModule onBack={() => setActiveView('pipeline')} onView={listView('lead', 'Enquiry')} entryForm={canDo('enquiries', 'create') ? (opts => renderEnquiryEntryForm(opts)) : undefined} onEdit={canDo('enquiries', 'edit') ? listEdit('lead', 'Enquiry') : undefined} onDelete={canDo('enquiries', 'delete') ? listDelete('lead', 'Enquiry') : undefined} refreshSignal={listRefresh} />
        </div>
      ) : activeView === 'quotation_list' ? (
        <div className="mb-2.5">
          {quoteTool ? (
            <div data-testid="quotation-tool">
              <button type="button" onClick={() => setQuoteTool(null)} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-brand-600">← Back to quotations</button>
              {quoteTool === '/quotation/metal-calculator' && <MetalCalculatorPage />}
              {quoteTool === '/quotation/create' && <CreateQuotationPage />}
              {quoteTool === '/quotation/client-library' && <ClientLibraryPage />}
              {quoteTool === '/quotation/product-library' && <ProductLibraryPage />}
              {quoteTool === '/quotation/terms-library' && <TermsLibraryPage />}
              {quoteTool === '/quotation/library' && <QuotationLibraryPage />}
              {quoteTool === '/quotation/company-profile' && <CompanyProfilePage />}
            </div>
          ) : (
            <QuotationModule onBack={() => setActiveView('pipeline')} onView={listView('quotation', 'Quotation')} onEdit={canDo('quotations', 'edit') ? listEdit('quotation', 'Quotation') : undefined} onDelete={canDo('quotations', 'delete') ? listDelete('quotation', 'Quotation') : undefined} refreshSignal={listRefresh} toolbar={quotationTools} />
          )}
        </div>
      ) : activeView === 'sales_order_list' ? (
        <div className="mb-2.5">
          <SalesOrderModule onBack={() => setActiveView('pipeline')} onView={listView('order', 'Sales Order')} onEdit={canDo('sales-orders', 'edit') ? listEdit('order', 'Sales Order') : undefined} entryForm={canDo('sales-orders', 'create') ? (opts => renderSalesOrderEntryForm(opts)) : undefined} onDelete={canDo('sales-orders', 'delete') ? listDelete('order', 'Sales Order') : undefined} refreshSignal={listRefresh} />
        </div>
      ) : activeView === 'inward_list' ? (
        <div className="mb-2.5">
          <InwardModule onBack={() => setActiveView('pipeline')} onView={listView('inward', 'Inward')} entryForm={canDo('inward', 'create') ? (opts => renderInwardEntryForm(opts)) : undefined} refreshSignal={inwardRefreshSignal + listRefresh} onEdit={canDo('inward', 'edit') ? listEdit('inward', 'Inward') : undefined} onDelete={canDo('inward', 'delete') ? listDelete('inward', 'Inward') : undefined} />
        </div>
      ) : activeView === 'rejected_list' ? (
        <div className="mb-2.5">
          <RejectedModule onBack={() => setActiveView('pipeline')} refreshSignal={listRefresh} onChanged={() => setListRefresh(n => n + 1)} />
        </div>
      ) : activeView === 'fg_list' ? (
        <div className="mb-2.5">
          <FinishedGoodsModule onBack={() => setActiveView('pipeline')} entryForm={(slots) => (fgCostingInline && canDo('finished-goods', 'create') ? renderFgCosting(true, costingModalTarget ?? fgBlankPick, slots) : null)} onView={listView('finished_goods', 'Finished Goods')} onEdit={canDo('finished-goods', 'edit') ? listEdit('finished_goods', 'Finished Goods') : undefined} onDelete={canDo('finished-goods', 'delete') ? listDelete('finished_goods', 'Finished Goods') : undefined} refreshSignal={listRefresh} />
        </div>
      ) : activeView === 'dc_list' ? (
        <div className="mb-2.5">
          <DeliveryChallanModule onBack={() => setActiveView('pipeline')} onView={listView('dc', 'DC')} onEdit={canDo('delivery', 'edit') ? listEdit('dc', 'DC') : undefined} entryForm={canDo('delivery', 'create') ? (opts => renderDeliveryChallanEntryForm(opts)) : undefined} onDelete={canDo('delivery', 'delete') ? listDelete('dc', 'DC') : undefined} refreshSignal={listRefresh} />
        </div>
      ) : activeView === 'invoice_list' ? (
        <div className="mb-2.5">
          <InvoiceModule key={listRefresh} onBack={() => setActiveView('pipeline')} />
        </div>
      ) : pipelineViewMode === 'companies' ? (
        // All Companies is the existing /sales/leads view, reused verbatim as another
        // toolbar view. The -m-4 cancels this page's own p-4 so LeadsPage's p-4 / bg-grid
        // line up with the page edge instead of stacking padding on padding.
        <div className="-m-4 min-h-full">
          <LeadsPage hideHeader toolbarLeft={<div className="flex items-center gap-3 shrink-0">{viewTabs}{allCompaniesButton}</div>} />
        </div>
      ) : pipelineViewMode === 'list' ? (
        <div>
          <PipelineListView
            cards={visibleCards}
            onView={openViewModal}
            onEdit={card => { const m = STAGE_MODULE[card.stage] ?? 'sales-pipeline'; if (!canDo(m, 'edit')) { alert('Not authorized: your account cannot edit these records.'); return; } if (card.type === 'finished_goods') { void openFgPopup(card, 'edit'); return; } setViewEditMode(true); void openViewModal(card); }}
            onDelete={card => { const m = STAGE_MODULE[card.stage] ?? 'sales-pipeline'; if (!canDo(m, 'delete')) { alert('Not authorized: your account cannot delete these records.'); return; } void handleDeleteCard({ stopPropagation() { /* not a click event */ } } as unknown as React.MouseEvent, card); }}
          />
        </div>
      ) : pipelineViewMode === 'calendar' ? (
        <div className="mb-2.5">
          <PipelineCalendarView cards={visibleCards} onView={openViewModal} />
        </div>
      ) : (
      <>
        {/* Bulk stage progression: appears only while cards are ticked, and sits above
            (not inside) the horizontally scrolling columns so it never scrolls away. */}
        {selectedCards.size > 0 && (
          <div data-testid="pipeline-bulk-toolbar" className="flex flex-wrap items-center gap-2.5 mb-3 px-3 py-2 rounded-xl border border-brand-200 bg-brand-50/70 shadow-sm">
            <span className="text-sm font-bold text-brand-800" data-testid="pipeline-bulk-count">
              {selectedCards.size} card{selectedCards.size === 1 ? '' : 's'} selected
            </span>
            {showInvoiceHandoff ? (
              <button
                type="button"
                onClick={() => void sendDcToInvoiceQueue()}
                disabled={bulkMoving}
                data-testid="pipeline-bulk-send-invoice"
                title="Queue the selected Delivery Challans Ready for Invoice (no pricing is opened)"
                className="px-3 py-1.5 text-sm font-semibold rounded-lg shadow-sm transition-colors bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkMoving ? 'Sending…' : 'Send to Invoice'}
              </button>
            ) : (
            <button
              type="button"
              onClick={() => void bulkMoveToNextStage()}
              disabled={!bulkValid || bulkMoving}
              data-testid="pipeline-bulk-move"
              title={bulkValid ? `Move the selected card(s) forward to ${bulkTarget}` : (bulkBlockReason || 'This selection cannot be moved')}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg shadow-sm transition-colors bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkMoving ? 'Moving…' : `Move to Next Stage${bulkTarget ? ` → ${bulkTarget}` : ''}`}
            </button>
            )}
            <button
              type="button"
              onClick={clearCardSelection}
              data-testid="pipeline-bulk-clear"
              title="Deselect every ticked card"
              className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm transition-colors"
            >
              Clear Selection
            </button>
            {bulkBlockReason && (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{bulkBlockReason}</span>
            )}
            {bulkNotice && (
              <span
                role="status"
                data-testid="pipeline-bulk-notice"
                className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${bulkNotice.kind === 'ok' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200'}`}
              >
                {bulkNotice.text}
              </span>
            )}
          </div>
        )}
      <div className="overflow-x-auto scrollbar-thin pb-4 mt-2">
        <div className="flex gap-4 h-[550px] items-stretch min-w-max px-1">
          {[
            MODULE_THEMES.Enquiry.kanban,
            MODULE_THEMES.Quotation.kanban,
            MODULE_THEMES['Sales Order'].kanban,
            MODULE_THEMES.Inward.kanban,
            MODULE_THEMES['Finished Goods'].kanban,
            MODULE_THEMES.DC.kanban,
            MODULE_THEMES.Invoice.kanban,
          ].filter(stage => canView(STAGE_MODULE[stage.id] ?? 'sales-pipeline')).map(stage => {
            const term = (columnSearch[stage.id] || '').trim().toLowerCase();
            const stageCards = boardCards
              .filter(c => c.stage === stage.id && (customerFilter === 'All Companies' || c.customer === customerFilter))
              .filter(c => !term ||
                (c.refNo || '').toLowerCase().includes(term) ||
                (c.customer || '').toLowerCase().includes(term) ||
                (c.part || '').toLowerCase().includes(term))
              .sort((a, b) => (a.refNo || '').localeCompare(b.refNo || '', undefined, { numeric: true }));
            return (
              <div key={stage.id} 
                className={`w-[280px] flex-shrink-0 ${stage.bg} rounded-xl p-3 flex flex-col border ${stage.border} shadow-sm h-full`}
                onDragOver={(e) => e.preventDefault()} 
                onDrop={(e) => handleDrop(e, stage.id as Stage)}
              >
                <div className="flex justify-between items-start mb-3 px-1">
                  <div>
                    <h3 className={`font-bold text-sm tracking-wide ${stage.text}`}>{stage.title}</h3>
                    <p className="text-[10px] text-slate-300 font-semibold">{stage.desc}</p>
                  </div>
                  <span className={`${stage.badge} text-xs font-bold px-2 py-0.5 rounded-full shadow-sm`}>{stageCards.length}</span>
                </div>

                {/* Per-column search */}
                <div className="relative mb-3">
                  <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                  <input
                    type="text"
                    value={columnSearch[stage.id] || ''}
                    onChange={(e) => setColumnSearch(prev => ({ ...prev, [stage.id]: e.target.value }))}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={`Search ${stage.title.toLowerCase()}...`}
                    className={`w-full pl-8 pr-7 py-1.5 text-xs ${stage.search} rounded-lg placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-white/40`}
                  />
                  {columnSearch[stage.id] && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setColumnSearch(prev => ({ ...prev, [stage.id]: '' })); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      title="Clear search"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                  )}
                </div>

                {stage.id !== 'Quotation' && canDo(STAGE_MODULE[stage.id] ?? 'sales-pipeline', 'create') && (
                <button className={`w-full ${stage.button} border border-dashed text-xs font-semibold py-2 rounded-lg mb-3 shadow-sm transition-all flex items-center justify-center gap-1`}
                  onClick={() => addForStage(stage.id)}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  Add {stage.title === 'DELIVERY CHALLAN' ? 'Delivery Challan' : stage.title === 'FINISHED GOODS' ? 'Finished Good' : stage.id}
                </button>
                )}

                <div className="flex-1 overflow-y-auto scrollbar-thin space-y-3 pb-2 pr-1">
                  {stageCards.map(card => (
                    <div 
                      key={card.id} 
                      draggable 
                      onDragStart={(e) => handleDragStart(e, card)}
                        onDragEnd={() => setDraggedCard(null)} 
                      onClick={() => handleCardClick(card)}
                      className={`${stage.card} rounded-xl p-3.5 border shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer group ${selectedCards.has(card.id) ? 'ring-2 ring-amber-400' : ''}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={selectedCards.has(card.id)}
                            draggable={false}
                            // Keep the tick out of the card's own handlers: it must not
                            // start the parent's drag, nor single/double-click the card.
                            onDragStart={(e) => { e.stopPropagation(); }}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleCardSelect(card.id)}
                            className="w-3.5 h-3.5 accent-brand-600 cursor-pointer shrink-0"
                            title="Tick to select this card, then use Move to Next Stage in the toolbar above the board"
                            aria-label={`Select ${card.refNo} for a bulk move to the next stage`}
                          />
                          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded font-mono ${stage.code}`}>{card.refNo}</span>
                        </div>
                        <span className="text-[10px] text-slate-300 font-semibold">{card.date || 'No Date'}</span>
                      </div>
                      
                      <h4 className="font-bold text-[13px] text-white mb-0.5 line-clamp-1">{card.customer}</h4>
                      <p className="text-xs text-slate-200 mb-3 line-clamp-1">{card.part}</p>
                      
                      <div className="flex justify-between items-end">
                        <div>
                          {card.value > 0 ? (
                             <p className={`text-sm font-bold ${stage.amount}`}>₹{Number(card.value).toLocaleString('en-IN')}</p>
                          ) : (
                             <p className="text-xs font-semibold text-slate-200">{card.qty} pcs</p>
                          )}
                          {card.type === 'order' && (() => {
                            const raw = card.raw || {};
                            let up = 0;
                            try {
                              const items = typeof raw.items === 'string' ? JSON.parse(raw.items) : raw.items;
                              if (Array.isArray(items) && items.length) up = Number(items[0].unitPrice) || 0;
                            } catch { /* ignore */ }
                            if (!up) up = Number(raw.unit_price) || 0;
                            if (!up && card.value && Number(card.qty)) up = Number(card.value) / Number(card.qty);
                            if (!up) return null;
                            return <p className="text-[11px] font-semibold text-slate-700 tabular-nums">Unit Price ₹{up.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>;
                          })()}
                        </div>
                        <div className="flex items-center gap-2">
                          {card.type === 'invoice' && (
                            <button onClick={(e) => { e.stopPropagation(); handleCompleteInvoice(card); }} className="p-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded border border-emerald-200 transition-colors" title="Mark Complete & Save to History">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </button>
                          )}
                          <div className="flex -space-x-1">
                            <div className="w-5 h-5 rounded-full bg-slate-200 border border-white flex items-center justify-center text-[8px] font-bold text-slate-600" title="Assigned User">
                              {card.raw?.contact_person ? card.raw.contact_person.substring(0, 2).toUpperCase() : (card.customer ? card.customer.substring(0, 2).toUpperCase() : 'AD')}
                            </div>
                          </div>
                        </div>
                      </div>
                      {card.type === 'order' && card.qtyTrack && (
                        <div className="mt-1.5 space-y-1">
                          <QtyProgress q={card.qtyTrack} />
                          <p className="text-[10px] text-slate-500 tabular-nums leading-tight">
                            Ord {card.qtyTrack.ordered} · Good {card.qtyTrack.good} · Rej {card.qtyTrack.rejected} · Rem {card.qtyTrack.remaining} · Del {card.qtyTrack.delivered} · Inv {card.qtyTrack.invoiced}
                          </p>
                        </div>
                      )}
                      {card.type === 'finished_goods' && card.qtyTrack && (card.qtyTrack.products ?? []).length > 0 ? (
                        <div className="mt-1.5 space-y-1">
                          <div className="rounded-lg bg-emerald-600 px-2 py-1 text-center">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-50">Finished / Available</p>
                            <p className="text-sm font-extrabold tabular-nums text-white leading-tight">{card.qtyTrack.fgAvailable} pcs</p>
                          </div>
                          <p className="text-[10px] text-slate-500 tabular-nums leading-tight">
                            Order {card.qtyTrack.ordered} · Finished {card.qtyTrack.good} · Remaining {card.qtyTrack.remaining} · Delivered {card.qtyTrack.delivered} · Avail {card.qtyTrack.fgAvailable}
                          </p>
                          {card.qtyTrack.products.slice(0, 3).map((p) => (
                            <div key={p.name} className="rounded-md border border-slate-200 bg-white/70 px-1.5 py-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[10px] font-bold text-slate-700 truncate">{p.name}</span>
                                {p.rejected > 0 && <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1">Rej {p.rejected}</span>}
                              </div>
                              <p className="text-[10px] text-slate-500 tabular-nums leading-tight">
                                Finished {p.good} / {p.ordered} · Available {p.available}
                              </p>
                            </div>
                          ))}
                          {card.qtyTrack.products.length > 3 && <p className="text-[10px] text-slate-400">+{card.qtyTrack.products.length - 3} more products</p>}
                          <QtyProgress q={card.qtyTrack} />
                        </div>
                      ) : (
                      card.type === 'finished_goods' && (() => {
                        const rows = Array.isArray(card.raw?._groupRows) && card.raw._groupRows.length ? card.raw._groupRows : [card.raw];
                        const g = rows.reduce((s: number, x: any) => s + (Number(x?.completed) || 0), 0);
                        const rj = rows.reduce((s: number, x: any) => s + (Number(x?.rejected) || 0), 0);
                        const itemQty = (card.raw?._itemQty ?? {}) as Record<string, number>;
                        const byName = new Map<string, number>();
                        rows.forEach((x: any) => {
                          const n = String(x?.part_name ?? '').trim() || '—';
                          byName.set(n, (byName.get(n) ?? 0) + (Number(x?.completed) || 0));
                        });
                        const lines = [...byName.entries()].map(([n, done]) => {
                          const oq = itemQty[n.toLowerCase()];
                          return { n, done, left: oq != null && oq > 0 ? Math.max(0, oq - done) : null };
                        });
                        return (
                          <div className="mt-1.5 space-y-1">
                            <div className="flex flex-wrap gap-1">
                              {lines.slice(0, 3).map((l) => (
                                <span key={l.n} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] tabular-nums">
                                  <span className="font-semibold text-slate-700">{l.n}</span>
                                  <b className="text-emerald-700">{l.done} done</b>
                                  {l.left != null && <b className="text-amber-700">· {l.left} left</b>}
                                </span>
                              ))}
                              {lines.length > 3 && <span className="text-[10px] text-slate-400">+{lines.length - 3} more</span>}
                            </div>
                            <p className="text-[10px] text-slate-500 tabular-nums leading-tight">
                              Good {g} · Rej {rj}{card.qtyTrack ? ` · Order ${card.qtyTrack.good}/${card.qtyTrack.ordered} · Avail ${card.qtyTrack.fgAvailable}` : ''}
                            </p>
                          </div>
                        );
                      })())}
                      {card.type === 'inward' && card.qtyTrack && (card.qtyTrack.products ?? []).length > 0 ? (
                        <div className="mt-1.5 space-y-1">
                          <p className="text-[10px] text-slate-500 tabular-nums leading-tight">
                            Ordered {card.qtyTrack.ordered} · Finished {card.qtyTrack.good}
                          </p>
                          {card.qtyTrack.remaining > 0 || card.qtyTrack.ordered <= 0 ? (
                            <div className="rounded-lg bg-amber-500 px-2 py-1 text-center">
                              <p className="text-[9px] font-bold uppercase tracking-widest text-amber-50">Remaining to produce</p>
                              <p className="text-sm font-extrabold tabular-nums text-white leading-tight">{card.qtyTrack.remaining} pcs</p>
                            </div>
                          ) : (
                            <div className="rounded-lg bg-emerald-600 px-2 py-1 text-center">
                              <p className="text-[10px] font-extrabold uppercase tracking-widest text-white">Production complete</p>
                            </div>
                          )}
                          {card.qtyTrack.products.slice(0, 3).map((p) => (
                            <div key={p.name} className="rounded-md border border-slate-200 bg-white/70 px-1.5 py-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[10px] font-bold text-slate-700 truncate">{p.name}</span>
                                {p.rejected > 0 && <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1">Rej {p.rejected}</span>}
                              </div>
                              <p className="text-[10px] text-slate-500 tabular-nums leading-tight">
                                {p.good} / {p.ordered} finished · <b className="text-amber-700">Remaining {p.remaining}</b>
                              </p>
                            </div>
                          ))}
                          {card.qtyTrack.products.length > 3 && <p className="text-[10px] text-slate-400">+{card.qtyTrack.products.length - 3} more products</p>}
                          <QtyProgress q={card.qtyTrack} />
                        </div>
                      ) : (
                      card.type === 'inward' && Array.isArray(card.raw?._inwardProd) && card.raw._inwardProd.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {card.raw._inwardProd.slice(0, 3).map((l: any) => (
                            <span key={l.name} className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] tabular-nums">
                              <span className="font-semibold text-slate-700">{l.name}</span>
                              <span className="text-slate-500">{l.recv} in</span>
                              <b className="text-amber-700">· {l.left} left</b>
                            </span>
                          ))}
                          {card.raw._inwardProd.length > 3 && <span className="text-[10px] text-slate-400">+{card.raw._inwardProd.length - 3} more</span>}
                        </div>
                      ))}
                      {card.type === 'dc' && (
                        <p className="mt-1.5 text-[10px] text-slate-500 tabular-nums leading-tight">
                          Dispatched {card.qty}{card.qtyTrack ? ` · Deliverable left ${card.qtyTrack.fgAvailable} of order ${card.qtyTrack.ordered}` : ''}
                        </p>
                      )}
                      {card.type === 'invoice' && card.qtyTrack && (
                        <p className="mt-1.5 text-[10px] text-slate-500 tabular-nums leading-tight">
                          Invoiced {card.qtyTrack.invoiced} · Invoiceable left {card.qtyTrack.invoiceable}
                        </p>
                      )}
                      <div className="mt-2 pt-2 border-t border-slate-50 flex justify-between items-center transition-opacity">
                        <span 
                          className="text-[10px] font-medium text-slate-500 flex items-center gap-1 hover:text-brand-600 transition-colors z-10 relative"
                          onClick={(e) => { e.stopPropagation(); setActiveCommentTarget(card); }}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg> 
                          {commentCounts[card.id] || 0}
                        </span>
                        <div className="flex items-center gap-3 z-20 relative">
                          <button onClick={(e) => { e.stopPropagation(); openViewModal(card); }} className="text-slate-400 hover:text-brand-600 transition-colors" title="View Details">
                            <Eye size={14} />
                          </button>
                          {canDo(STAGE_MODULE[card.stage] ?? 'sales-pipeline', 'edit') && (
                          <button onClick={(e) => { e.stopPropagation(); if (card.type === 'finished_goods') { void openFgPopup(card, 'edit'); return; } setViewEditMode(true); openViewModal(card); }} className="text-slate-400 hover:text-blue-600 transition-colors" title="Inline Edit">
                            <Edit2 size={14} />
                          </button>
                          )}
                          {card.type === 'lead' && canDo('enquiries', 'create') && (
                            <button onClick={(e) => { e.stopPropagation(); duplicateEnquiry(card); }} className="text-slate-400 hover:text-brand-600 transition-colors" title="Duplicate Enquiry">
                              <Copy size={14} />
                            </button>
                          )}
                          {canDo(STAGE_MODULE[card.stage] ?? 'sales-pipeline', 'delete') && (
                          <button onClick={(e) => handleDeleteCard(e, card)} className="text-slate-400 hover:text-red-600 transition-colors" title="Delete">
                            <Trash2 size={14} />
                          </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </>
      )}

      {/* Board "Add" popups: the Kanban columns' Add buttons reopen the entry form as a
          dialog instead of navigating to the list page. Same form JSX, same handlers,
          same validation - only the surrounding chrome differs from the inline version. */}
      <Modal
        open={!!addPopup}
        onClose={() => setAddPopup(null)}
        title={addPopup ? addPopupTitle(addPopup) : ''}
        subtitle="Fill in the details and save. The board refreshes once the record is created."
        accent={addPopup ? tint(addPopup) : undefined}
        size="2xl"
        width={1240}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddPopup(null)}>Cancel</Button>
            {addPopup === 'Enquiry' && (
              <Button size="sm" onClick={saveEnquiry} disabled={savingEnquiry} className={MODULE_THEMES.Enquiry.btnPrimary}>{savingEnquiry ? 'Saving...' : 'Save Enquiry'}</Button>
            )}
            {addPopup === 'Sales Order' && (
              <Button size="sm" onClick={saveStandaloneSalesOrder} disabled={savingSo} className={MODULE_THEMES['Sales Order'].btnPrimary}>{savingSo ? 'Saving...' : 'Save Order'}</Button>
            )}
            {addPopup === 'Inward' && (
              <Button variant="secondary" size="sm" disabled={savingInward} onClick={() => void saveInward(true)}>{savingInward ? 'Saving...' : 'Save & Add Another Inward'}</Button>
            )}
            {addPopup === 'Inward' && (
              <Button size="sm" disabled={savingInward} onClick={() => void saveInward(false)} className={MODULE_THEMES.Inward.btnPrimary}>{savingInward ? 'Saving...' : 'Submit'}</Button>
            )}
            {addPopup === 'DC' && (
              <Button size="sm" onClick={saveDeliveryChallan} disabled={dcSaving} className={MODULE_THEMES.DC.btnPrimary}>{dcSaving ? 'Saving...' : 'Save'}</Button>
            )}
          </>
        }
      >
        {/* No scroll container here on purpose: every popup form wraps fluidly,
            so clipping ancestors would only cut off the autocomplete dropdowns.
            Tall content scrolls once, on the dialog body itself. */}
        <div className="overflow-visible pr-1">
          {addPopup === 'Enquiry' && renderEnquiryEntryForm({ popup: true })}
          {addPopup === 'Sales Order' && renderSalesOrderEntryForm({ popup: true })}
          {addPopup === 'Inward' && renderInwardEntryForm({ popup: true })}
          {addPopup === 'DC' && renderDeliveryChallanEntryForm({ popup: true })}
        </div>
      </Modal>

      {/* New Lead Modal */}
      <Modal open={showNewLead} onClose={() => setShowNewLead(false)} title="Create New Company" size="sm" footer={<><Button variant="secondary" onClick={() => setShowNewLead(false)}>Cancel</Button><Button onClick={saveNewLead}>Save Company</Button></>}>
        <div className="grid grid-cols-3 gap-3">
          <CustomerAutocomplete
            label="Company Name"
            required
            value={newLeadForm.company}
            onChange={val => {
              const matched = allKnownCompanies.find(c => c.company.toLowerCase() === val.trim().toLowerCase());
              setNewLeadForm((prev: any) => ({
                ...prev,
                company: val,
                contacts: matched && (matched.contact_person || matched.phone || matched.email)
                  ? [{ person: matched.contact_person || '', phone: matched.phone || '', email: matched.email || '' }]
                  : prev.contacts,
                city: matched?.city || prev.city,
                gst: matched?.gst || prev.gst
              }));
            }}
            onSelectCustomer={c => {
              setNewLeadForm((prev: any) => ({
                ...prev,
                company: c.company,
                contacts: (c.contact_person || c.phone || c.email)
                  ? [{ person: c.contact_person || '', phone: c.phone || '', email: c.email || '' }]
                  : prev.contacts,
                city: c.city || prev.city,
                gst: c.gst || prev.gst
              }));
            }}
            companies={allKnownCompanies}
            inputClass={inputClass}
            placeholder="e.g. Acme Corp"
          />
          <FormField label="Address"><input className={inputClass} value={newLeadForm.city} onChange={e => setNewLeadForm({...newLeadForm, city: e.target.value})} /></FormField>
          <FormField label="GST No."><input className={inputClass} value={newLeadForm.gst} onChange={e => setNewLeadForm({...newLeadForm, gst: e.target.value})} /></FormField>
          <div className="col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-500 uppercase">Contact Persons</label>
              <button type="button" onClick={() => setNewLeadForm({...newLeadForm, contacts: [...(newLeadForm.contacts || []), { person: '', phone: '', email: '' }]})} className="text-xs text-blue-600 font-bold flex items-center gap-1">+ Add Contact Person</button>
            </div>
            {(newLeadForm.contacts || [{ person: '', phone: '', email: '' }]).map((c: any, i: number) => (
              <div key={i} className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <input placeholder="Name" className={inputClass} value={c.person} onChange={e => { const nc = [...(newLeadForm.contacts || [])]; nc[i] = { ...nc[i], person: e.target.value }; setNewLeadForm({...newLeadForm, contacts: nc}); }} />
                <input placeholder="Phone" className={inputClass} value={c.phone} onChange={e => { const nc = [...(newLeadForm.contacts || [])]; nc[i] = { ...nc[i], phone: e.target.value }; setNewLeadForm({...newLeadForm, contacts: nc}); }} />
                <input placeholder="Email" className={inputClass} value={c.email} onChange={e => { const nc = [...(newLeadForm.contacts || [])]; nc[i] = { ...nc[i], email: e.target.value }; setNewLeadForm({...newLeadForm, contacts: nc}); }} />
              </div>
            ))}
          </div>
          <FormField label="Source">
            <select className={inputClass} value={newLeadForm.source} onChange={e => setNewLeadForm({...newLeadForm, source: e.target.value})}>
              <option>Direct</option><option>Website</option><option>Referral</option><option>Phone</option><option>Email</option><option>Other</option>
            </select>
          </FormField>
        </div>
      </Modal>


      {/* Quotation Modal */}
      <HsnDatalist />
      <Modal open={!!quotationModalTarget} onClose={closeQuotationPopup} title="Create Quotation" subtitle={quotationModalTarget?.customer ? `From enquiry · ${quotationModalTarget.customer}` : undefined} size="full" width={1040} windowControls>
        {quotationModalTarget && (
          <CreateQuotationPage key={quotationModalTarget.refNo + quoteForm.quoteNo} embed={quotationEmbed} />
        )}
      </Modal>

      


      {/* Generic View Modal */}

      {/* Finished Goods + Costing gate. Inline on the Finished Goods list (that module
          renders it above its table); a popup everywhere else - including the board drag
          gate and Edit / View, which always stay popups. */}
      {costingModalTarget && !fgCostingInline && renderFgCosting(false, costingModalTarget)}

      {/* Add Finished Good: choose the inward, then the Finished Goods + Costing popup */}
      <Modal open={fgPickOpen} onClose={() => setFgPickOpen(false)} title="Add Finished Good" size="sm" width={460}
        footer={<><Button variant="secondary" onClick={() => setFgPickOpen(false)}>Cancel</Button>
          <Button disabled={!fgPickId} onClick={() => {
            const c = cards.find(x => x.id === fgPickId);
            if (!c) return;
            setFgPickOpen(false); setCostingMode('add');
            // A sales order has no inward: the popup is built from the order's own products.
            setCostingModalTarget(c.type === 'order'
              ? { ...c, stage: 'Inward', type: 'inward', raw: { sales_order_ref: (c.raw as any)?.order_no || '', project_name: c.refNo, _groupIds: [] } } as KanbanCard
              : c);
          }}>Continue</Button></>}>
        <FormField label="Add finished goods for" required>
          <select className={inputClass} value={fgPickId} onChange={e => setFgPickId(e.target.value)}>
            <option value="">Select sales order or inward</option>
            <optgroup label="Sales orders (direct, no inward)">
              {cards.filter(c => c.type === 'order').map(c => <option key={c.id} value={c.id}>{c.refNo} — {c.customer} — {c.part}</option>)}
            </optgroup>
            <optgroup label="Inwards">
              {cards.filter(c => c.type === 'inward').map(c => <option key={c.id} value={c.id}>{c.refNo} — {c.customer} — {c.part}</option>)}
            </optgroup>
          </select>
        </FormField>
      </Modal>

      {/* Finished Goods Modal */}
      <Modal open={!!fgModalTarget} onClose={() => setFgModalTarget(null)} title="Finished Goods Entry" size="lg" width={720} footer={<><Button variant="secondary" onClick={() => setFgModalTarget(null)}>Cancel</Button><Button onClick={saveFinishedGoods}>Save</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Category" required><select className={inputClass}><option>Finished Goods</option></select></FormField>
          <FormField label="Date" required><input type="date" className={inputClass} value={fgForm.date || ''} onChange={e=>setFgForm({...fgForm, date: e.target.value})} /></FormField>
          {fgModalTarget?.raw?.id ? (
            <FormField label="Max Available Quantity (from Inward)"><input type="number" className={`${inputClass} bg-slate-100 font-bold`} value={fgForm.orderQty || ''} disabled /></FormField>
          ) : (
            <FormField label="Order Quantity" required><input type="number" className={inputClass} value={fgForm.orderQty || ''} onChange={e=>setFgForm({...fgForm, orderQty: e.target.value})} /></FormField>
          )}
          <FormField label="Quantity to Process" required><input type="number" className={inputClass} value={fgForm.completedQty || ''} onChange={e=>setFgForm({...fgForm, completedQty: e.target.value})} /></FormField>
        </div>
      </Modal>



      {/* DC → Invoice gate (approved FG price, no manual re-entry) */}
      {invoiceCostingTarget && (
        <ErrorBoundary title="Invoice entry failed to open" onClose={() => setInvoiceCostingTarget(null)}>
          <DcInvoiceModal
            card={invoiceCostingTarget}
            onClose={() => setInvoiceCostingTarget(null)}
            onMoved={() => { setInvoiceCostingTarget(null); fetchPipeline(); }}
          />
        </ErrorBoundary>
      )}

      {/* Invoice Modal */}
      <Modal open={!!invoiceModalTarget} onClose={() => setInvoiceModalTarget(null)} title="Invoice Entry" size="lg" width={780} footer={<><Button variant="secondary" onClick={() => setInvoiceModalTarget(null)}>Cancel</Button><Button onClick={saveInvoice}>Submit</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Document Type" required><select className={inputClass}><option>Tax Invoice</option></select></FormField>
          <CustomerAutocomplete
            label="Company Name"
            required
            value={invoiceForm.partyName || ''}
            onChange={val => setInvoiceForm((prev: any) => ({ ...prev, partyName: val }))}
            companies={allKnownCompanies}
            inputClass={inputClass}
            placeholder="Type or select company..."
          />
          <FormField label="DC Number"><input className={inputClass} value={invoiceForm.dcNumber || ''} onChange={e=>setInvoiceForm({...invoiceForm, dcNumber: e.target.value})} /></FormField>
          <FormField label="Date" required><input type="date" className={inputClass} value={invoiceForm.date || ''} onChange={e=>setInvoiceForm({...invoiceForm, date: e.target.value})} /></FormField>
          <div className="col-span-2 border-t border-slate-100 mt-2 pt-4">
            <h4 className="font-semibold text-sm text-slate-800 mb-3">Product Details</h4>
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-2"><FormField label="Product Name" required><input className={inputClass} list="saved-products" value={invoiceForm.partName || ''} onChange={e=>setInvoiceForm({...invoiceForm, partName: e.target.value})} /></FormField></div>
              <FormField label="Qty" required><input type="number" className={inputClass} value={invoiceForm.quantity || ''} onChange={e=>setInvoiceForm({...invoiceForm, quantity: e.target.value})} /></FormField>
              <FormField label="Unit Price" required><input type="number" className={inputClass} value={invoiceForm.price || ''} onChange={e=>setInvoiceForm({...invoiceForm, price: e.target.value})} /></FormField>
              <FormField label="CGST (%)"><input type="number" className={inputClass} value={invoiceForm.cgst || ''} onChange={e=>setInvoiceForm({...invoiceForm, cgst: e.target.value})} /></FormField>
              <FormField label="SGST (%)"><input type="number" className={inputClass} value={invoiceForm.sgst || ''} onChange={e=>setInvoiceForm({...invoiceForm, sgst: e.target.value})} /></FormField>
              <FormField label="IGST (%)"><input type="number" className={inputClass} value={invoiceForm.igst || ''} onChange={e=>setInvoiceForm({...invoiceForm, igst: e.target.value})} /></FormField>
              <FormField label="Tax / Total"><div className={`${inputClass} bg-slate-50 text-xs`}>
              {(() => {
                const q = Number(invoiceForm.quantity) || 0;
                const p = Number(invoiceForm.price) || 0;
                const basic = q * p;
                const num = (v: any) => (v === '' || v == null ? null : Number(v) || 0);
                const c = num(invoiceForm.cgst);
                const s = num(invoiceForm.sgst);
                const ig = num(invoiceForm.igst);
                const tax = basic * ((c || 0) + (s || 0) + (ig || 0)) / 100;
                const row = (label: string, amount: number) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-medium text-slate-700">{formatINR(amount)}</span>
                  </div>
                );
                return (
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Basic</span>
                      <span className="font-semibold text-slate-800">{formatINR(basic)}</span>
                    </div>
                    {c !== null && row(`CGST (${c}%)`, basic * c / 100)}
                    {s !== null && row(`SGST (${s}%)`, basic * s / 100)}
                    {ig !== null && row(`IGST (${ig}%)`, basic * ig / 100)}
                    {c === null && s === null && ig === null && (
                      <div className="text-slate-400">GST applied from company settings on save.</div>
                    )}
                    <div className="flex justify-between border-t border-slate-200 pt-1">
                      <span className="font-bold text-slate-800">Total</span>
                      <span className="font-bold text-brand-700">{formatINR(basic + tax)}</span>
                    </div>
                  </div>
                );
              })()}
            </div></FormField>
            </div>
          </div>
        </div>
      </Modal>

      
      {/* Shared View / Edit modal: opened from every stage list's View / Edit actions.
          The entry forms are inline now, so this popup is only for inspecting or
          revising a record that already exists. */}
<Modal open={!!viewModalTarget} onClose={closeViewModal} title={`${stageDetailsTitle(viewModalTarget?.stage)} — Company ID: ${viewModalData?.order?.lead_no || viewModalData?.enquiry?.lead_no || viewModalData?.enquiry?.enquiry_no || viewModalTarget?.refNo}`} size="xl" width={900} footer={<>{viewModalData?.dc && <><Button variant="secondary" onClick={() => void viewPipelineDocument('dc')}>View DC PDF</Button><Button variant="secondary" icon={<Download size={14}/>} onClick={() => void downloadPipelineDocument('dc')}>Download DC</Button></>}{viewModalData?.invoice && <><Button variant="secondary" onClick={() => void viewPipelineDocument('invoice')}>View Invoice PDF</Button><Button variant="secondary" icon={<Download size={14}/>} onClick={() => void downloadPipelineDocument('invoice')}>Download Invoice</Button></>}<Button variant={viewEditMode ? 'primary' : 'secondary'} onClick={() => { void (async () => {
                      if (viewEditMode && viewModalTarget?.stage === 'Sales Order' && soSaveRef.current) {
                        const ok = await soSaveRef.current();
                        if (!ok) return;
                      }
                      if (viewEditMode && viewModalTarget?.stage === 'Enquiry' && enquirySaveRef.current) {
                        const ok = await enquirySaveRef.current();
                        if (!ok) return;
                      }
                      if (viewEditMode && viewModalTarget?.stage === 'DC' && dcSaveRef.current) {
                        const ok = await dcSaveRef.current();
                        if (!ok) return;
                      }
                      setViewEditMode(!viewEditMode);
                    })(); }}>{viewEditMode ? 'Done Editing' : 'Enable Inline Editing'}</Button><Button variant="secondary" onClick={closeViewModal}>Close</Button></>}>
        {viewModalData ? (
          <div className="flex flex-col max-h-[75vh] overflow-y-auto pr-2">
            {/* Top banner hides where a section renders its own live strip (enquiry form, quotation). */}
            {(viewModalTarget?.stage === 'Finished Goods' || viewModalTarget?.stage === 'Inward') && viewModalData?.qtyTracking && (
              <QtyTrackingSection
                q={viewModalData.qtyTracking}
                userName={userName}
                allowReject={viewModalTarget?.stage !== 'Inward'}
                onSaved={(summary) => setViewModalData((prev: any) => (prev ? { ...prev, qtyTracking: summary } : prev))}
              />
            )}
            {(() => {
              // Show the opened card's own stage details first, then the rest in pipeline order.
              const sections = [
                { key: 'Invoice', node: renderRecordData('Invoice', viewModalData?.invoice) },
                { key: 'DC', node: (viewModalData.dcRows || (viewModalData.dc ? [viewModalData.dc] : [])).length ? (
                  <DcSection
                    key={(viewModalData.dcRows?.[0] || viewModalData.dc)?.id || 'dc'}
                    rows={viewModalData.dcRows || [viewModalData.dc]}
                    qtyTracking={viewModalData.qtyTracking}
                    editMode={viewEditMode}
                    saveRef={dcSaveRef}
                    customers={customerList}
                    companies={allKnownCompanies}
                    onSaved={() => { fetchPipeline(); if (viewModalTarget) void openViewModal(viewModalTarget); }}
                  />
                ) : null },
                { key: 'Finished Goods', node: renderRecordData('Finished Goods', viewModalData?.finished_goods) },
                { key: 'Inward', node: (() => {
                  // Rows saved from one inward card share product/category/ref/date:
                  // show them as one section with its part lines, like the entry card.
                  const list = (Array.isArray(viewModalData?.inwards) && viewModalData.inwards.length
                    ? viewModalData.inwards : (viewModalData.inward ? [viewModalData.inward] : []));
                  if (!list.length) return null;
                  const gkey = (r: any) => [r.product_name || '', r.category || '', r.reference_no || '', r.inward_date || ''].join('|');
                  const groups: any[][] = [];
                  list.forEach((r: any) => {
                    const k = gkey(r);
                    let g = groups.find(gg => gkey(gg[0]) === k);
                    if (!g) { g = []; groups.push(g); }
                    g.push(r);
                  });
                  const lineKeys = ['part_name', 'quantity', 'price', 'discount_percent', 'gst_percent', 'total_amount'];
                  const lineHead = ['Part Name', 'Qty', 'Price', 'Disc', 'GST', 'Total', 'Remarks'];
                  return (<>{groups.map((g, gi) => (
                    <div key={g[0].id || gi} className="mb-6">
                      <h4 className="font-bold text-sm text-brand-800 border-b border-brand-100 pb-2 mb-3 uppercase flex justify-between items-center">
                        <span>Inward Details #{gi + 1}</span>
                        {viewEditMode && (
                          <button type="button" data-testid="delete-inward" onClick={() => void deleteInwardRows(g.map((r: any) => String(r.id)), `inward #${gi + 1}`)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold normal-case text-red-600 hover:bg-red-50">
                            <Trash2 size={12} /> Delete inward
                          </button>
                        )}
                      </h4>
                      <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-4 mb-3">
                          {viewEditMode ? (
                            <div>
                              <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Category</span>
                              <select
                                className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-brand-500 cursor-pointer"
                                value={g[0].category || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val !== String(g[0].category || '')) {
                                    g.forEach((r: any) => { void handleInlineEdit('Inward', String(r.id), { category: val }); });
                                  }
                                }}
                              >
                                <option value="">Select category…</option>
                                {g[0].category && !['EXPENSES', 'CUSTOMER DC', 'NEW PART', 'NO DC', 'GOODS PURCHASE', 'SERVICE PURCHASE'].includes(String(g[0].category)) && (
                                  <option value={g[0].category}>{g[0].category}</option>
                                )}
                                {['EXPENSES', 'CUSTOMER DC', 'NEW PART', 'NO DC', 'GOODS PURCHASE', 'SERVICE PURCHASE'].map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </div>
                          ) : (inwardCellFor(g[0], 'category', 'Category'))}
                          {viewEditMode ? (
                            <div>
                              <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Company</span>
                              <select
                                className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-brand-500 cursor-pointer"
                                value={g[0].party_name || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === '__custom__') {
                                    const custom = window.prompt('Enter company name:', String(g[0].party_name || ''));
                                    if (custom && custom.trim() && custom.trim() !== String(g[0].party_name || '')) {
                                      g.forEach((r: any) => { void handleInlineEdit('Inward', String(r.id), { party_name: custom.trim() }); });
                                    }
                                    return;
                                  }
                                  if (val !== String(g[0].party_name || '')) {
                                    g.forEach((r: any) => { void handleInlineEdit('Inward', String(r.id), { party_name: val }); });
                                  }
                                }}
                              >
                                <option value="">Select company…</option>
                                <option value="__custom__">+ Enter custom company…</option>
                                {g[0].party_name && !allKnownCompanies.some((c: any) => String(c.company).toLowerCase() === String(g[0].party_name).toLowerCase()) && (
                                  <option value={g[0].party_name}>{g[0].party_name}</option>
                                )}
                                {(allKnownCompanies || []).map((c: any) => (
                                  <option key={c.company} value={c.company}>{c.company}</option>
                                ))}
                              </select>
                            </div>
                          ) : (inwardCellFor(g[0], 'party_name', 'Company'))}
                          {inwardCellFor(g[0], 'inward_date', 'Inward Date')}
                          {inwardCellFor(g[0], 'reference_no', 'Reference No.')}
                          <div>
                            <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Files</span>
                            <div className="flex flex-wrap gap-2">
                              {g.flatMap((r: any, ri: number) => (Array.isArray(r.attachments) ? r.attachments : []).map((att: any, ai: number) => {
                                const p = typeof att === 'string' ? att : (att.path || att.url || '');
                                const n = typeof att === 'string' ? p.split('/').pop() : (att.name || p.split('/').pop() || `File ${ai + 1}`);
                                if (!p) return null;
                                return <button key={`${ri}-${ai}`} type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-blue-700 hover:border-brand-300" onClick={() => void openProductFile(p)}><FileText size={12} />{n}</button>;
                              }))}
                              {!g.some((r: any) => Array.isArray(r.attachments) && r.attachments.length > 0) && (
                                <span className="text-sm text-slate-400">—</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_4rem_4.75rem_4rem_3.75rem_5rem_minmax(0,1fr)_1.75rem] gap-2 items-center mb-1 px-1 min-w-[760px]">
                          <span className="text-[10px] font-bold text-slate-500 uppercase">Product</span>
                          {lineHead.map(h => <span key={h} className="text-[10px] font-bold text-slate-500 uppercase">{h}</span>)}
                          <span />
                        </div>
                        {g.map((row: any, ri: number) => (
                          <div key={row.id || ri} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_4rem_4.75rem_4rem_3.75rem_5rem_minmax(0,1fr)_1.75rem] gap-2 items-center min-w-[760px] bg-white rounded-lg border border-slate-200 p-2 mb-2">
                            <div>
                              <select
                                disabled={!viewEditMode}
                                className="w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-brand-500 disabled:bg-slate-50 disabled:text-slate-700 cursor-pointer"
                                value={row.product_name || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === '__custom__') {
                                    const custom = window.prompt('Enter product name:');
                                    if (custom && custom.trim() && custom.trim() !== (row.product_name || '')) {
                                      void handleInlineEdit('Inward', row.id, 'product_name', custom.trim());
                                    }
                                    return;
                                  }
                                  if (val !== (row.product_name || '')) {
                                    const masterHit = (partsCatalogue || []).find((m: any) => normStr(m.name) === normStr(val) || (m.code && normStr(m.code) === normStr(val)));
                                    const patch: Record<string, any> = { product_name: val };
                                    if (masterHit) {
                                      if (!String(row.part_name || '').trim() || String(row.part_name).trim() === String(row.product_name || '').trim()) {
                                        patch.part_name = masterHit.name;
                                      }
                                    }
                                    void handleInlineEdit('Inward', row.id, patch);
                                  }
                                }}
                              >
                                <option value="">Select product…</option>
                                {viewEditMode && <option value="__custom__">+ Enter custom product name…</option>}
                                {row.product_name && !inwardEditProductOptions.some(o => o.name.toLowerCase() === String(row.product_name).toLowerCase()) && (
                                  <option value={row.product_name}>{row.product_name}</option>
                                )}
                                {inwardEditProductOptions.filter(o => o.group === 'catalogue').length > 0 && (
                                  <optgroup label="Components & Raw Materials (Catalogue)">
                                    {inwardEditProductOptions.filter(o => o.group === 'catalogue').map(o => (
                                      <option key={`cat-${o.name}`} value={o.name}>
                                        {o.name}{o.detail ? ` (${o.detail})` : ''}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {inwardEditProductOptions.filter(o => o.group === 'pipeline').length > 0 && (
                                  <optgroup label="Pipeline Products (Enquiry / Sales Order)">
                                    {inwardEditProductOptions.filter(o => o.group === 'pipeline').map(o => (
                                      <option key={`pipe-${o.name}`} value={o.name}>
                                        {o.name}{o.detail ? ` (${o.detail})` : ''}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                            </div>
                            {lineKeys.map(k => <div key={k} className="contents">{inwardCellFor(row, k, '')}</div>)}
                            <div>{inwardCellFor(row, 'remarks', '')}</div>
                            {viewEditMode && g.length > 1 ? (
                              <button type="button" data-testid="delete-inward-line" title="Delete this part line" onClick={() => void deleteInwardRows([String(row.id)], `the part line “${row.part_name || row.product_name || ri + 1}”`)}
                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                            ) : <span />}
                          </div>
                        ))}
                        </div>
                      </div>
                    </div>
                  ))}</>);
                })() },
                { key: 'Sales Order', node: viewModalTarget?.stage === 'DC' ? null : (viewModalData.order ? (
                  <SalesOrderSection
                    key={viewModalData.order.id || 'so'}
                    order={viewModalData.order}
                    qtyTracking={viewModalData.qtyTracking}
                    editMode={viewEditMode}
                    saveRef={soSaveRef}
                    onSaved={() => { fetchPipeline(); if (viewModalTarget) void openViewModal(viewModalTarget); }}
                    onInlineEdit={(field: string, value: string) => void handleInlineEdit('Sales Order', viewModalData.order.id, field, value)}
                  />
                ) : null) },
                { key: 'Quotation', node: viewModalTarget?.stage === 'Inward' ? null : (viewModalData.quotation ? (
                  <>
                    <QuotationEditForm
                      key={`${viewModalData.quotation.id || 'quo'}-${viewEditMode ? 'edit' : 'view'}`}
                      readOnly={!viewEditMode}
                      raw={viewModalData.quotation}
                      productNames={existingProductNames}
                      companyId={company?.id}
                      openFile={(p) => void openProductFile(p)}
                      onSaved={() => { fetchPipeline(); if (viewModalTarget) void openViewModal(viewModalTarget); }}
                    />
                  </>
                ) : renderRecordData('Quotation', viewModalData.quotation, !viewModalData.order)) },
                { key: 'Enquiry', node: viewModalData.enquiry ? (
                  <EnquiryEditForm
                    key={viewModalData.enquiry.id || 'enq'}
                    raw={viewModalData.enquiry}
                    companies={allKnownCompanies}
                    productNames={existingProductNames}
                    companyId={company?.id}
                    editMode={viewEditMode}
                    saveRef={enquirySaveRef}
                    onSaved={() => { fetchPipeline(); if (viewModalTarget) void openViewModal(viewModalTarget); }}
                  />
                ) : null },
              ];
              const cur = viewModalTarget?.stage || '';
              // Enquiry Details section only shows when opened from an Enquiry card.
              // From a Sales Order card the quotation block would repeat the same
              // products, so it is hidden — the sales-order block carries them.
              const visible = sections.filter(s => s.key !== 'Enquiry' || cur === 'Enquiry')
                .filter(s => !(cur === 'Sales Order' && s.key === 'Quotation'));
              const ordered = [...visible.filter(s => s.key === cur), ...visible.filter(s => s.key !== cur)];
              return <>{ordered.map(s => <div key={s.key} className="contents">{s.node}</div>)}</>;
            })()}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500">Loading historical data...</div>
        )}
      </Modal>

      {activeCommentTarget && (
        <CommentsModal 
          isOpen={true} 
          onClose={() => { setActiveCommentTarget(null); fetchPipeline(); }} 
          recordId={activeCommentTarget.id} 
          recordTitle={activeCommentTarget.refNo} 
        />
      )}

    </div>
  );
}
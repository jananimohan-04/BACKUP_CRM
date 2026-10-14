import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Card';
import { UploadCloud } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { itemFilePaths, openStoredFile, uploadOrderFile } from '@/lib/orderFiles';
import { attachDateTimeToProduct } from './SalesPipelinePage';
/** Sales-order line items: parsed `items` array, falling back to the header part name. */
export function soProductItems(order: any): any[] {
  try {
    const r = order?.items;
    const parsed = typeof r === 'string' ? JSON.parse(r) : r;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* fall through to part_name */ }
  const single = String(order?.part_name || '').trim().replace(/(\s*\(?\d+\s*products?\)?\s*)+$/i, '').trim();
  if (single && !/^multiple\s*products?/i.test(single)) {
    return [{ partName: single, quantity: order?.quantity ?? '', status: order?.status || '' }];
  }
  return [];
}

export function soProductNames(order: any, qtyTracking?: any): string[] {
  const fromTrack = Array.isArray(qtyTracking?.products)
    ? qtyTracking.products.map((p: any) => String(p?.name || '').trim()).filter(Boolean)
    : [];
  if (fromTrack.length) return Array.from(new Set(fromTrack.map((n: string) => attachDateTimeToProduct(n, order))));
  const names = soProductItems(order)
    .map((it: any) => attachDateTimeToProduct(String(it.partName || it.productName || it.part_name || it.description || '').trim(), order))
    .filter(Boolean);
  return Array.from(new Set(names));
}

/** Sales Order view/edit box: customer + date on the first line, then one block
 *  per product (name, qty, rej qty, status). Each product carries its own
 *  status; the order status follows the products when they agree. Rej qty
 *  combines live quantity reconciliation (`qtyTracking`) with manual entries. */
export function SalesOrderSection({ order, qtyTracking, editMode: editing, saveRef, onSaved, onInlineEdit }: {
  order: any; qtyTracking?: any; editMode: boolean;
  saveRef?: { current: (() => Promise<boolean>) | null };
  onSaved: () => void; onInlineEdit: (field: string, value: string) => void;
}) {
  const { company } = useAuth();
  const norm = (s: any) => String(s ?? '').trim().toLowerCase();
  const trackBy = new Map<string, any>();
  (Array.isArray(qtyTracking?.products) ? qtyTracking.products : []).forEach((p: any) => {
    if (p?.name) trackBy.set(norm(p.name), p);
  });
  const baseItems = soProductItems(order);
  const [customer, setCustomer] = useState(String(order?.customer || order?.customer_name || ''));
  const [orderDate, setOrderDate] = useState(String(order?.order_date || '').slice(0, 10));
  const [items, setItems] = useState<any[]>(baseItems.map((it: any) => ({
    partName: attachDateTimeToProduct(String(it.partName || it.productName || it.part_name || it.description || ''), order),
    quantity: it.quantity ?? it.qty ?? '',
    rejectedQty: it.rejectedQty ?? it.rejected_qty ?? it.rejected ?? '',
    unitPrice: it.unitPrice ?? '',
    itemStatus: it.status || '',
    gst: it.gst ?? '',
    // files already stored on the order (paths) and new ones picked now (uploaded on save)
    filePaths: itemFilePaths(it),
    files: [] as File[],
  })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const prodOf = (name: string) => trackBy.get(norm(name));

  // Scalar fields not covered above (kept visible so nothing disappears).
  // Internal id references (company_id, sales_order_id, …) stay hidden.
  const skipKeys = new Set(['id', 'items', 'customer', 'customer_name', 'customer_id', 'company_id', 'order_date', 'status',
    'part_name', 'quantity', 'value', 'total_value', 'lead_no', 'order_no', 'quote_no', 'quotation_id',
    'enquiry_no', 'created_at', 'updated_at', 'delivered', 'contact_person', 'phone', 'email',
    'part_no', 'part_number', 'partNo', 'partNumber', 'payment_terms']);
  // Delivery date stays editable even when empty so it can always be set.
  const extraEntries = Object.entries(order || {}).filter(([k, v]) => {
    if (skipKeys.has(k) || k.startsWith('_') || /_ids?$/.test(k)) return false;
    if (v === null || v === '' || typeof v === 'object') return editing && k === 'delivery_date';
    return true;
  });
  const isDateKey = (k: string) => k === 'date' || /_date$/.test(k);

  const save = async (): Promise<boolean> => {
    const entered = items
      .map((it: any) => ({ ...it, partName: String(it.partName || '').trim() }))
      .filter((it: any) => it.partName);
    if (!customer.trim()) { setError('Enter the company.'); return false; }
    if (!entered.length) { setError('Enter at least one product.'); return false; }
    if (entered.some((it: any) => Number(it.quantity) < 0)) { setError('Product quantities cannot be negative.'); return false; }
    if (entered.some((it: any) => Number(it.rejectedQty) < 0)) { setError('Rejected quantities cannot be negative.'); return false; }
    if (saving) return false;
    setSaving(true);
    setError('');
    try {
      if (entered.some((it: any) => (it.files || []).length) && !company?.id) throw new Error('Select a company before uploading files.');
      const uploaded: string[][] = await Promise.all(entered.map((it: any) => Promise.all(((it.files || []) as File[]).map(f => uploadOrderFile(company!.id, f)))));
      const prevItems = soProductItems(order);
      const saved = entered.map((it: any, idx: number) => {
        const prev = prevItems[idx] && typeof prevItems[idx] === 'object' ? prevItems[idx] : {};
        const stampedPartName = attachDateTimeToProduct(it.partName, order);
        return {
          ...prev,
          partName: stampedPartName,
          quantity: it.quantity === '' ? '0' : it.quantity,
          rejectedQty: it.rejectedQty === '' ? 0 : Number(it.rejectedQty) || 0,
          unitPrice: it.unitPrice === '' || it.unitPrice == null ? '0' : it.unitPrice,
          status: it.itemStatus || (prev as any).status || order?.status || 'Confirmed',
          gst: it.gst === '' || it.gst == null ? ((prev as any).gst ?? '18') : it.gst,
          filePaths: [...((it.filePaths || []) as { path: string }[]).map(f => f.path), ...(uploaded[idx] ?? [])],
        };
      });
      const totalQty = saved.reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);
      const names = saved.map((i: any) => i.partName);
      // Order status follows the products when they agree, else stays as-is.
      const prodStatuses = Array.from(new Set(saved.map((i: any) => String(i.status || '').trim()).filter(Boolean)));
      let totalVal: number | null = null;
      if (saved.some((i: any) => Number(i.unitPrice))) {
        totalVal = saved.reduce((s: number, i: any) => {
          const q = Number(i.quantity) || 0; const p = Number(i.unitPrice) || 0;
          const d = Number(i.discount) || 0; const ud = Number(i.unitDiscount) || 0; const g = Number(i.gst) || 0;
          return s + q * Math.max(0, p * (1 - d / 100) - ud) * (1 + g / 100);
        }, 0);
      }
      const payload: any = {
        customer: customer.trim(),
        order_date: orderDate || null,
        status: prodStatuses.length === 1 ? prodStatuses[0] : (order?.status || 'Confirmed'),
        items: saved,
        quantity: totalQty,
        part_name: saved.length > 1 ? `${names.join(', ')} (${saved.length} Products)` : saved[0].partName,
      };
      if (totalVal !== null) {
        payload.total_value = Number(totalVal.toFixed(2));
        payload.value = payload.total_value;
      }
      const { error: updErr } = await supabase.from('cnc_sales_orders').update(payload).eq('id', order.id);
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

  // Add, Edit and View share the entry layout (Company, Order Date, one line per product); View just locks it.
  const inputBox = 'w-full text-sm font-medium text-slate-800 border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-brand-500';
  const updItem = (idx: number, patch: any) => setItems((list) => list.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  return (
    <fieldset disabled={!editing} className="mb-6 min-w-0 border-0 p-0 m-0 [&_input:disabled]:bg-slate-50 [&_input:disabled]:text-slate-700 [&_input:disabled]:cursor-default [&_select:disabled]:bg-slate-50 [&_select:disabled]:text-slate-700">
      <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-100">
        <div>
          <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Company</span>
          <input className={inputBox} value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </div>
        <div>
          <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Order Date</span>
          <input type="date" className={inputBox} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 space-y-2 overflow-x-auto">
        {items.length > 0 && (
          <div className="grid grid-cols-[2rem_minmax(0,1fr)_4rem_6rem_3.75rem_7.5rem_6.5rem] min-w-[640px] gap-2 items-center px-1">
            <span></span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Product Name</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Qty</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Unit Price (₹)</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">GST %</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Status</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Drawings</span>
          </div>
        )}
        {items.map((it: any, idx: number) => (
          <div key={idx} className="rounded-lg border border-slate-200 bg-white px-2 py-2">
            <div className="grid grid-cols-[2rem_minmax(0,1fr)_4rem_6rem_3.75rem_7.5rem_6.5rem] min-w-[640px] gap-2 items-center">
              <span className="text-[11px] font-bold text-slate-400 text-center">{idx + 1}</span>
              <input className={inputBox} placeholder="Product name" value={it.partName || ''} onChange={(e) => updItem(idx, { partName: e.target.value })} />
              <input type="number" min={0} className={`${inputBox} tabular-nums`} value={it.quantity ?? ''} placeholder="0" onChange={(e) => updItem(idx, { quantity: e.target.value })} />
              <input type="number" min={0} className={`${inputBox} tabular-nums`} value={it.unitPrice ?? ''} placeholder="0.00" onChange={(e) => updItem(idx, { unitPrice: e.target.value })} />
              <input type="number" min={0} className={`${inputBox} tabular-nums`} value={it.gst ?? ''} placeholder="18" onChange={(e) => updItem(idx, { gst: e.target.value })} />
              <select className={inputBox} value={it.itemStatus || it.status || order?.status || 'Confirmed'} onChange={(e) => updItem(idx, { itemStatus: e.target.value })}>
                {Array.from(new Set(['Draft', 'Confirmed', 'Waiting for Parts', 'In Production', 'Inwarded', 'Unavailable', it.itemStatus, it.status, order?.status].filter(Boolean))).map((st: string) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
              {editing ? (
                <label className="inline-flex h-[30px] w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed border-slate-300 bg-white px-2 text-xs font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700" title="Attach drawings or any file (all formats)">
                  <UploadCloud size={13} />{((it.files || []).length + (it.filePaths || []).length) ? `${(it.files || []).length + (it.filePaths || []).length} file${((it.files || []).length + (it.filePaths || []).length) === 1 ? '' : 's'}` : 'Upload'}
                  <input type="file" multiple accept="*/*" className="hidden" aria-label={`Drawings for product ${idx + 1}`} onChange={(e) => { const picked = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; if (picked.length) updItem(idx, { files: [...(it.files || []), ...picked] }); }} />
                </label>
              ) : <span className="text-xs text-slate-400">{(it.filePaths || []).length ? `${it.filePaths.length} file${it.filePaths.length === 1 ? '' : 's'}` : '—'}</span>}
            </div>
            {((it.filePaths || []).length > 0 || (it.files || []).length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5 pl-9" data-testid="so-item-files">
                {(it.filePaths as { name: string; path: string }[]).map((f) => (
                  <span key={f.path} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] shadow-xs">
                    <button type="button" className="max-w-[220px] truncate text-blue-700 hover:underline" onClick={() => void openStoredFile(f.path)}>{f.name}</button>
                    {editing && (
                      <button
                        type="button"
                        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-sm font-bold leading-none"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => updItem(idx, { filePaths: (it.filePaths as { path: string }[]).filter(x => x.path !== f.path) })}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {(it.files as File[] || []).map((f, fi) => (
                  <span key={`${f.name}-${fi}`} className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 shadow-xs">
                    <span className="max-w-[200px] truncate">{f.name} (new)</span>
                    <button
                      type="button"
                      className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer text-sm font-bold leading-none"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => updItem(idx, { files: (it.files as File[]).filter((_, j) => j !== fi) })}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {!items.length && (
          <p className="text-xs text-slate-500 italic">No products on this sales order yet.</p>
        )}
      </div>
      {editing && (
        <button type="button" onClick={() => setItems((list) => [...list, { partName: '', quantity: '', rejectedQty: '', unitPrice: '', itemStatus: '', gst: '18', filePaths: [], files: [] }])}
          className="mt-2 text-sm text-brand-600 font-semibold hover:text-brand-700 flex items-center gap-1">
          <span className="text-lg">+</span> Add Another Product
        </button>
      )}
      {extraEntries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6 bg-slate-50 p-4 rounded-lg border border-slate-100 mt-3">
          {extraEntries.map(([key, value]) => (
            <div key={key}>
              <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                {key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              </span>
              <input type={isDateKey(key) ? 'date' : 'text'} className={inputBox}
                defaultValue={isDateKey(key) ? String(value ?? '').slice(0, 10) : String(value ?? '')}
                onBlur={(e) => { const cur = isDateKey(key) ? String(value ?? '').slice(0, 10) : String(value ?? ''); if (e.target.value !== cur) onInlineEdit(key, e.target.value); }} />
            </div>
          ))}
        </div>
      )}
      {editing && error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>
      )}
    </fieldset>
  );
}

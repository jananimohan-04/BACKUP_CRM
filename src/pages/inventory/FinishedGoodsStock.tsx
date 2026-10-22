import { useCallback, useEffect, useState } from 'react';
import { Star, Plus, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { finishedGoodsStock, type FgStockRow, type WoLike } from '@/lib/finishedGoodsStock';
import { retailSyncApi } from '@/lib/retailSync';

// Finished goods that production has completed and no delivery challan has taken out yet, with the warehouse
// they sit in, plus the Warehouse Master (create warehouses, choose the default).

interface Wh { id: string; code: string; name: string; type?: string; status?: string; is_default?: boolean }

const outlineBtn = 'h-9 px-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50';
const field = 'h-9 w-full px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';
const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
const missingColumn = (e: unknown) => /column|schema cache|42703/i.test(`${(e as { code?: string })?.code ?? ''} ${errText(e)}`);

async function loadWarehouses(): Promise<{ list: Wh[]; hasDefault: boolean }> {
  const r = await supabase.from('cnc_warehouses').select('*').order('created_at', { ascending: true });
  if (r.error) throw r.error;
  const list = ((r.data ?? []) as Record<string, unknown>[]).map(w => ({
    id: String(w.id), code: String(w.code ?? ''), name: String(w.name ?? ''), type: String(w.type ?? ''), status: String(w.status ?? 'Active'),
    is_default: w.is_default === true,
  }));
  const rows = (r.data ?? []) as Record<string, unknown>[];
  return { list, hasDefault: rows.length === 0 || 'is_default' in rows[0] };
}

export function WarehouseMasterModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Wh[]>([]);
  const [hasDefault, setHasDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('Finished Goods');

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await loadWarehouses(); setRows(r.list); setHasDefault(r.hasDefault); setError(''); }
    catch (e) { setError(errText(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!code.trim() || !name.trim()) return setError('Enter the warehouse code and name.');
    if (rows.some(w => w.code.trim().toLowerCase() === code.trim().toLowerCase())) return setError('That code is already used.');
    setBusy(true); setError('');
    try {
      const payload: Record<string, unknown> = { code: code.trim(), name: name.trim(), type, status: 'Active' };
      if (hasDefault && !rows.some(w => w.is_default)) payload.is_default = true; // the first warehouse becomes the default
      const r = await supabase.from('cnc_warehouses').insert([payload]);
      if (r.error) throw r.error;
      setCode(''); setName(''); await load(); onChanged();
    } catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };

  const makeDefault = async (w: Wh) => {
    setBusy(true); setError('');
    try {
      const c = await supabase.from('cnc_warehouses').update({ is_default: false }).eq('is_default', true);
      if (c.error) throw c.error;
      const s = await supabase.from('cnc_warehouses').update({ is_default: true }).eq('id', w.id);
      if (s.error) throw s.error;
      await load(); onChanged();
    } catch (e) { setError(missingColumn(e) ? 'The default option needs the latest database migration (20261007000000_fg_warehouse.sql). Run it in Supabase, then try again.' : errText(e)); }
    finally { setBusy(false); }
  };

  const toggle = async (w: Wh) => {
    setBusy(true); setError('');
    try {
      const r = await supabase.from('cnc_warehouses').update({ status: w.status === 'Active' ? 'Inactive' : 'Active' }).eq('id', w.id);
      if (r.error) throw r.error;
      await load(); onChanged();
    } catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Warehouse Master" subtitle="Create warehouses and choose the default for finished goods" size="lg" width={760}
      footer={<button className={outlineBtn} onClick={onClose}>Close</button>}>
      <div className="space-y-4">
        {error && <p role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</p>}
        <div className="grid grid-cols-2 md:grid-cols-[8rem_minmax(0,1fr)_10rem_auto] gap-2 items-end">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Code<input aria-label="Warehouse code" className={`${field} mt-1 normal-case font-normal`} placeholder="WH-001" value={code} onChange={e => setCode(e.target.value)} /></label>
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Name<input aria-label="Warehouse name" className={`${field} mt-1 normal-case font-normal`} placeholder="Main Plant Warehouse" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add(); }} /></label>
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Type
            <select aria-label="Warehouse type" className={`${field} mt-1 normal-case font-normal`} value={type} onChange={e => setType(e.target.value)}>
              {['Finished Goods', 'General', 'Raw Material', 'Quarantine'].map(t => <option key={t}>{t}</option>)}</select></label>
          <button className={`${outlineBtn} !bg-blue-600 !text-white !border-blue-600 hover:!bg-blue-700`} disabled={busy} onClick={() => void add()}><Plus size={15} />Add</button>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-600"><th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Default</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
            <tbody>
              {rows.map(w => (
                <tr key={w.id} data-testid="wh-row" className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-slate-600">{w.code}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{w.name}{w.status !== 'Active' && <span className="ml-2 text-[11px] text-slate-400">(inactive)</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{w.type}</td>
                  <td className="px-3 py-2">{w.is_default ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200"><Star size={11} className="fill-current" />Default</span> : ''}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {!w.is_default && w.status === 'Active' && <button className="text-xs font-semibold text-blue-600 hover:underline mr-3 disabled:opacity-50" disabled={busy} onClick={() => void makeDefault(w)}>Set as default</button>}
                    {!w.is_default && <button className="text-xs font-semibold text-slate-500 hover:underline disabled:opacity-50" disabled={busy} onClick={() => void toggle(w)}>{w.status === 'Active' ? 'Deactivate' : 'Activate'}</button>}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No warehouses yet. Add the first one above; it becomes the default.</td></tr>}
              {loading && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400"><Loader2 size={16} className="inline animate-spin mr-1" />Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

/** Finished goods waiting for delivery plus the warehouses; the Inventory table lists them next to the item register. */
export function useFinishedGoods(refreshKey: number) {
  const [rows, setRows] = useState<FgStockRow[] | null>(null);
  const [whs, setWhs] = useState<Wh[]>([]);
  const [canAssign, setCanAssign] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      let wos: WoLike[] = [];
      let assignable = true;
      const full = await supabase.from('cnc_work_orders').select('id,wo_no,sales_order,part_name,customer,completed,warehouse_id');
      if (full.error) {
        if (!missingColumn(full.error)) throw full.error;
        assignable = false;
        const base = await supabase.from('cnc_work_orders').select('id,wo_no,sales_order,part_name,customer,completed');
        if (base.error) throw base.error;
        wos = (base.data ?? []) as WoLike[];
      } else wos = (full.data ?? []) as WoLike[];
      // Part orders are not finished product (the flag column exists once the part-orders migration has run).
      const partIds = await supabase.from('cnc_work_orders').select('id').eq('is_part_order', true);
      if (!partIds.error) {
        const skip = new Set((partIds.data ?? []).map((r: { id: string }) => String(r.id)));
        wos = wos.filter(w => !skip.has(String(w.id)));
      }
      const dcs = await supabase.from('cnc_deliveries').select('sales_order_no,part_name,dispatch_qty,quantity,status');
      if (dcs.error) throw dcs.error;
      setRows(finishedGoodsStock(wos, (dcs.data ?? []) as never[]));
      setCanAssign(assignable);
      try { setWhs((await loadWarehouses()).list); } catch { setWhs([]); }
    } catch (e) { setRows([]); setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const def = whs.find(w => w.is_default && w.status === 'Active') ?? null;
  /** The warehouse a row sits in: the one chosen for it, else the default. */
  const warehouseOf = (r: FgStockRow): { id: string; name: string; isDefault: boolean } | null => {
    const own = r.warehouseId ? whs.find(w => w.id === r.warehouseId) : undefined;
    if (own) return { id: own.id, name: own.name, isDefault: false };
    return def ? { id: def.id, name: def.name, isDefault: true } : null;
  };

  const assign = async (r: FgStockRow, warehouseId: string) => {
    setBusyKey(r.key); setError('');
    try {
      const u = await supabase.from('cnc_work_orders').update({ warehouse_id: warehouseId || null }).in('id', r.woIds);
      if (u.error) throw u.error;
      const d = await retailSyncApi.resolveDesignation();
      if (d) {
        const isRetail = warehouseId === d.id;
        const res = await retailSyncApi.syncItem({
          id: r.key || r.product,
          item_kind: 'FG',
          code: r.product || (r as any).code || r.key,
          name: r.product || (r as any).name || r.key,
          category_name: 'Finished Goods',
          unit: 'Nos',
          stock: isRetail ? r.available : 0,
          warehouse_id: warehouseId || (d ? d.id : null),
          warehouse_name: isRetail ? d.warehouse_name : undefined,
          status: isRetail ? 'Active' : 'Inactive',
        }, isRetail);
        if (!res.ok) setError(`Warehouse saved, but the Retail Store was not updated: ${res.error ?? 'sync failed'}.`);
      }
      await load();
    } catch (e) { setError(missingColumn(e) ? 'Choosing a warehouse needs the latest database migration (20261007000000_fg_warehouse.sql). Run it in Supabase first.' : errText(e)); }
    finally { setBusyKey(''); }
  };

  return { rows, whs, def, canAssign, error, busyKey, assign, warehouseOf, reload: load };
}

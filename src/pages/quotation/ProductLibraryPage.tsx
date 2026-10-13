import { useMemo, useState } from 'react';
import { Package, Search, Plus, LayoutGrid, List, Pencil, Trash2, ArrowUpDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { formatINR } from '@/lib/format';
import { Modal, FormField } from '@/components/ui/Modal';
import {
  PRODUCT_UNITS, emptyDraft, loadProducts, newId, priceOf, saveProducts, searchSort, validateDraft,
  type LibraryProduct, type ProductDraft, type ProductSort,
} from '@/lib/productLibrary';

const field = 'w-full h-10 px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-cyan-600 focus:ring-2 focus:ring-cyan-600/20';
const numeric = (v: string) => v.replace(/[^0-9.,]/g, '');
const SORTS: { id: ProductSort; label: string }[] = [
  { id: 'newest', label: 'Newest First' }, { id: 'oldest', label: 'Oldest First' }, { id: 'name', label: 'Name (A-Z)' },
  { id: 'price-high', label: 'Price: High to Low' }, { id: 'price-low', label: 'Price: Low to High' },
];

export function ProductLibraryPage() {
  const { company } = useAuth();
  const cid = company?.id ?? null;
  const [products, setProducts] = useState<LibraryProduct[]>(() => loadProducts(cid));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProductSort>('newest');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ editingId?: string } | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft());
  const [touched, setTouched] = useState(false);
  const [toDelete, setToDelete] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const shown = useMemo(() => searchSort(products, query, sort), [products, query, sort]);
  const errors = modal ? validateDraft(draft, products, modal.editingId) : {};
  const allTicked = shown.length > 0 && shown.every(p => selected.has(p.id));

  const commit = (next: LibraryProduct[], okText: string) => {
    if (!saveProducts(cid, next)) { setNotice('Could not save: browser storage is unavailable or full.'); return false; }
    setProducts(next); setNotice(okText); return true;
  };
  const openAdd = () => { setDraft(emptyDraft()); setTouched(false); setModal({}); };
  const openEdit = (p: LibraryProduct) => { setDraft({ name: p.name, hsn: p.hsn, unit: p.unit, price: p.price, qty: p.qty, description: p.description }); setTouched(false); setModal({ editingId: p.id }); };

  const save = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    const clean: ProductDraft = { ...draft, name: draft.name.trim(), hsn: draft.hsn.trim(), description: draft.description.trim() };
    const ok = modal?.editingId
      ? commit(products.map(p => (p.id === modal.editingId ? { ...p, ...clean } : p)), 'Product updated')
      : commit([{ id: newId(), createdAt: new Date().toISOString(), ...clean }, ...products], 'Product saved to directory');
    if (ok) setModal(null);
  };
  const confirmDelete = () => {
    if (!toDelete) return;
    const ids = new Set(toDelete);
    if (commit(products.filter(p => !ids.has(p.id)), `${ids.size} product${ids.size === 1 ? '' : 's'} deleted`)) setSelected(s => new Set([...s].filter(x => !ids.has(x))));
    setToDelete(null);
  };
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(s => (allTicked ? new Set([...s].filter(id => !shown.some(p => p.id === id))) : new Set([...s, ...shown.map(p => p.id)])));

  const actions = (p: LibraryProduct) => (
    <div className="flex items-center gap-1">
      <button aria-label={`Edit ${p.name}`} onClick={() => openEdit(p)} className="p-1.5 text-slate-400 hover:text-cyan-700 rounded"><Pencil size={15} /></button>
      <button aria-label={`Delete ${p.name}`} onClick={() => setToDelete([p.id])} className="p-1.5 text-slate-400 hover:text-red-600 rounded"><Trash2 size={15} /></button>
    </div>
  );

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Package className="text-orange-500" size={26} /> Product &amp; Pricing Library</h1>
          <p className="text-sm text-slate-500 mt-1">Manage products, pricing, and costing details for quick quotation creation.</p>
        </div>

        {notice && <div role="status" className="flex justify-between text-sm rounded-lg px-3 py-2 border bg-slate-50 border-slate-200 text-slate-700"><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div>}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-3 text-slate-400" />
            <input aria-label="Search products" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products, HSN, description…" className={`${field} pl-9`} />
          </div>
          <label className="relative flex items-center">
            <ArrowUpDown size={14} className="absolute right-3 text-slate-400 pointer-events-none" />
            <select aria-label="Sort products" value={sort} onChange={e => setSort(e.target.value as ProductSort)} className={`${field} w-52 font-semibold appearance-none pr-8`}>
              {SORTS.map(s => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
            </select>
          </label>
          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            <button aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={`p-2.5 ${view === 'grid' ? 'bg-cyan-50 text-cyan-700' : 'text-slate-400'}`}><LayoutGrid size={16} /></button>
            <button aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`p-2.5 ${view === 'list' ? 'bg-cyan-50 text-cyan-700' : 'text-slate-400'}`}><List size={16} /></button>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {selected.size > 0 && <button onClick={() => setToDelete([...selected])} className="h-10 px-3 text-sm font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50">Delete {selected.size} selected</button>}
            <span data-testid="count" className="text-sm font-semibold text-cyan-700 bg-cyan-50 border border-cyan-100 rounded-lg px-3 h-10 flex items-center">{products.length} {products.length === 1 ? 'Product' : 'Products'}</span>
            <button onClick={openAdd} className="flex items-center gap-1.5 h-10 px-4 text-sm font-semibold text-white bg-cyan-600 rounded-lg hover:bg-cyan-700"><Plus size={16} /> Add Product</button>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-center border border-slate-200 rounded-xl">
            <div className="w-12 h-12 rounded-xl bg-cyan-50 flex items-center justify-center mb-3"><Package size={22} className="text-cyan-600" /></div>
            <p className="font-semibold text-slate-800">{products.length ? 'No products match your search' : 'No Organisation Products Found'}</p>
            <p className="text-xs text-slate-500 mt-1">{products.length ? 'Try a different name, HSN or description.' : 'Click “+ Add Product” to build your catalog.'}</p>
          </div>
        ) : view === 'list' ? (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500"><tr>
                <th className="px-3 py-3 w-10"><input type="checkbox" aria-label="Select all" checked={allTicked} onChange={toggleAll} /></th>
                {['Sl.No', 'Product / Assembly Name', 'HSN/SAC', 'Unit', 'Default Qty', 'Rate', 'Actions'].map(h => <th key={h} className="text-left font-semibold px-3 py-3">{h}</th>)}
              </tr></thead>
              <tbody>
                {shown.map((p, i) => (
                  <tr key={p.id} className="border-t border-slate-100" data-testid="product-row">
                    <td className="px-3 py-3"><input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                    <td className="px-3 py-3 text-slate-500">{i + 1}</td>
                    <td className="px-3 py-3"><p className="font-semibold text-slate-800">{p.name}</p>{p.description && <p className="text-xs text-slate-500 line-clamp-1">{p.description}</p>}</td>
                    <td className="px-3 py-3 font-mono text-slate-600">{p.hsn || '—'}</td>
                    <td className="px-3 py-3">{p.unit}</td><td className="px-3 py-3">{p.qty}</td>
                    <td className="px-3 py-3 font-mono font-semibold">{p.price.trim() === '' ? '—' : formatINR(priceOf(p), { decimals: 'always' })}</td>
                    <td className="px-3 py-3">{actions(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {shown.map(p => (
              <div key={p.id} data-testid="product-card" className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-800">{p.name}</p>{actions(p)}
                </div>
                {p.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description}</p>}
                <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
                  <span>HSN {p.hsn || '—'} · {p.qty} {p.unit}</span>
                  <span className="font-mono text-sm font-bold text-slate-900">{p.price.trim() === '' ? '—' : formatINR(priceOf(p), { decimals: 'always' })}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} size="md"
        title={modal?.editingId ? 'Edit Product' : 'Add Product to Directory'} subtitle="Register a product in your organization directory catalog.">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <FormField label="Product / Assembly Name" required>
              <input autoFocus aria-label="Product name" className={field} placeholder="e.g. Hydraulic Flange Assembly 100mm" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
              {touched && errors.name && <p className="text-[11px] text-red-600 mt-1">{errors.name}</p>}
            </FormField>
          </div>
          <FormField label="HSN / SAC Code"><input aria-label="HSN code" className={`${field} font-mono`} placeholder="E.g. 7318, 8483" value={draft.hsn} onChange={e => setDraft(d => ({ ...d, hsn: e.target.value }))} /></FormField>
          <FormField label="Unit of Measurement">
            <select aria-label="Unit" className={`${field} font-semibold`} value={draft.unit} onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))}>{PRODUCT_UNITS.map(u => <option key={u}>{u}</option>)}</select>
          </FormField>
          <FormField label="Unit Price / Rate (₹)">
            <input aria-label="Rate" inputMode="decimal" className={field} placeholder="₹ 0.00" value={draft.price} onChange={e => setDraft(d => ({ ...d, price: numeric(e.target.value) }))} />
            {touched && errors.price && <p className="text-[11px] text-red-600 mt-1">{errors.price}</p>}
          </FormField>
          <FormField label="Default Quantity">
            <input aria-label="Default quantity" inputMode="decimal" className={field} value={draft.qty} onChange={e => setDraft(d => ({ ...d, qty: numeric(e.target.value) }))} />
            {touched && errors.qty && <p className="text-[11px] text-red-600 mt-1">{errors.qty}</p>}
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Description / Specifications (Optional)">
              <textarea aria-label="Description" rows={3} className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-cyan-600" placeholder="Material grades, dimensional tolerances, finishing specifications…" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
            </FormField>
          </div>
        </div>
        <div className="flex justify-end items-center gap-3 mt-5 pt-4 border-t border-slate-100">
          <button onClick={() => setModal(null)} className="text-sm font-semibold text-slate-600 px-3">Cancel</button>
          <button onClick={save} className="flex items-center gap-1.5 h-10 px-5 text-sm font-semibold text-white bg-cyan-600 rounded-lg hover:bg-cyan-700"><Plus size={15} /> {modal?.editingId ? 'Save changes' : 'Save to Directory'}</button>
        </div>
      </Modal>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} size="sm" title="Delete products?">
        <p className="text-sm text-slate-600">{toDelete?.length === 1 ? 'This product' : `These ${toDelete?.length} products`} will be removed from the library. Existing quotations are not affected.</p>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => setToDelete(null)} className="text-sm font-semibold text-slate-600 px-3">Cancel</button>
          <button onClick={confirmDelete} className="h-10 px-5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700">Delete</button>
        </div>
      </Modal>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { ScrollText, Search, PlusCircle, Pencil, Trash2, Check, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Modal } from '@/components/ui/Modal';
import {
  addTemplate, filterTemplates, loadTerms, removeTemplate, saveTerms, updateTemplate, validateTemplate,
  type TermsStore, type TermsTemplate,
} from '@/lib/termsLibrary';

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t${Date.now()}${Math.random().toString(36).slice(2, 8)}`);
const labelCls = 'block text-xs font-bold uppercase tracking-wide text-slate-700 mb-2';
const inputCls = 'w-full text-sm bg-slate-50 border border-slate-200 rounded-xl px-4 focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20';

export function TermsLibraryPage() {
  const { company } = useAuth();
  const cid = company?.id ?? null;
  const [store, setStore] = useState<TermsStore>(() => loadTerms(cid));
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<{ editing?: TermsTemplate } | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [touched, setTouched] = useState(false);
  const [toDelete, setToDelete] = useState<TermsTemplate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const shown = useMemo(() => filterTemplates(store.templates, query), [store.templates, query]);
  const errors = modal ? validateTemplate(title, body, store.templates, modal.editing?.id) : {};

  const commit = (next: TermsStore, text: string): boolean => {
    if (!saveTerms(cid, next)) { setNotice('Could not save: browser storage is unavailable or full.'); return false; }
    setStore(next); setNotice(text); return true;
  };
  const openNew = () => { setTitle(''); setBody(''); setMakeDefault(false); setTouched(false); setModal({}); };
  const openEdit = (t: TermsTemplate) => { setTitle(t.title); setBody(t.body); setMakeDefault(t.id === store.defaultId); setTouched(false); setModal({ editing: t }); };

  const save = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    const ed = modal?.editing;
    const ok = ed ? commit(updateTemplate(store, ed.id, title, body, makeDefault), 'Template updated')
      : commit(addTemplate(store, title, body, makeDefault, newId()), 'Template saved');
    if (ok) setModal(null);
  };

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ScrollText className="text-orange-500" size={26} /> Terms &amp; Conditions Library</h1>
          <p className="text-sm text-slate-500 mt-1">Create, save, and reuse terms and conditions for your quotations.</p>
        </div>

        {notice && <div role="status" className="flex justify-between text-sm rounded-lg px-3 py-2 border bg-slate-50 border-slate-200 text-slate-700"><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div>}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-xl">
            <Search size={15} className="absolute left-3 top-3 text-slate-400" />
            <input aria-label="Search templates" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates by title or content…" className={`${inputCls} h-10 pl-9`} />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span data-testid="count" className="text-sm font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-xl px-4 h-10 flex items-center">{store.templates.length} {store.templates.length === 1 ? 'Template' : 'Templates'}</span>
            <button onClick={openNew} className="flex items-center gap-2 h-10 px-4 text-sm font-semibold text-white bg-orange-500 rounded-xl hover:bg-orange-600"><PlusCircle size={16} /> Add New Template</button>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-center border border-slate-200 rounded-xl">
            <ScrollText size={26} className="text-orange-400 mb-2" />
            <p className="font-semibold text-slate-800">{store.templates.length ? 'No templates match your search' : 'No templates yet'}</p>
            <p className="text-xs text-slate-500 mt-1">{store.templates.length ? 'Try different words from the title or content.' : 'Click “Add New Template” to save your first set of terms.'}</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {shown.map(t => {
              const isDefault = t.id === store.defaultId;
              return (
                <div key={t.id} data-testid="terms-card" data-default={isDefault} className={`flex flex-col rounded-xl border p-4 ${isDefault ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{t.title}</p>
                      {isDefault && <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-white bg-emerald-500 rounded-full px-2 py-0.5"><Check size={10} /> Default Template</span>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button aria-label={`Edit ${t.title}`} onClick={() => openEdit(t)} className="p-1.5 text-slate-400 hover:text-orange-600"><Pencil size={15} /></button>
                      <button aria-label={`Delete ${t.title}`} onClick={() => setToDelete(t)} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
                    </div>
                  </div>
                  <pre className="mt-3 flex-1 max-h-44 overflow-y-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-600 bg-white/70 border border-slate-100 rounded-lg p-3">{t.body}</pre>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-xs">
                    <span className="text-slate-400">{isDefault ? 'Applied to new quotations by default' : 'Click to apply as default'}</span>
                    {isDefault
                      ? <span className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 size={14} /> Active Default</span>
                      : <button onClick={() => commit({ ...store, defaultId: t.id }, `“${t.title}” is now the default`)} className="flex items-center gap-1 font-semibold text-orange-600 hover:text-orange-700">Set as Default <Check size={14} /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} size="md"
        title={modal?.editing ? 'Edit Terms Template' : 'Create Terms Template'} subtitle="Save reusable commercial conditions for quotations">
        <div className="space-y-5">
          <div>
            <label className={labelCls} htmlFor="terms-title">Template Name / Title *</label>
            <input id="terms-title" autoFocus className={`${inputCls} h-11`} placeholder="e.g. Standard Fabrication & Dispatch Terms" value={title} onChange={e => setTitle(e.target.value)} />
            {touched && errors.title && <p className="text-[11px] text-red-600 mt-1">{errors.title}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="terms-body">Terms &amp; Conditions Text *</label>
            <textarea id="terms-body" rows={6} className={`${inputCls} py-3 leading-relaxed`} placeholder={'1. Quotation validity: 15 days from date of issue.\n2. 50% advance on confirmation, balance before dispatch.\n3. GST 18% charged additionally as applicable.\n4. Subject to local jurisdiction.'} value={body} onChange={e => setBody(e.target.value)} />
            {touched && errors.body && <p className="text-[11px] text-red-600 mt-1">{errors.body}</p>}
            <p className="text-xs text-slate-400 mt-2">Write terms line by line. These will be formatted and printed cleanly on quotation PDFs.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
            <input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} /> Set as Default Template for new quotations
          </label>
          <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-100">
            <button onClick={() => setModal(null)} className="h-10 px-5 text-sm font-semibold text-slate-700 border border-slate-200 rounded-xl">Cancel</button>
            <button onClick={save} className="flex items-center gap-2 h-10 px-5 text-sm font-semibold text-white bg-orange-500 rounded-xl hover:bg-orange-600"><Check size={15} /> Save Template</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} size="sm" title="Delete template?">
        <p className="text-sm text-slate-600">“{toDelete?.title}” will be removed from the library.{toDelete?.id === store.defaultId && ' It is the current default, so the first remaining template becomes the default.'} Saved quotations are not affected.</p>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => setToDelete(null)} className="text-sm font-semibold text-slate-600 px-3">Cancel</button>
          <button onClick={() => { if (toDelete) commit(removeTemplate(store, toDelete.id), 'Template deleted'); setToDelete(null); }} className="h-10 px-5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700">Delete</button>
        </div>
      </Modal>
    </div>
  );
}

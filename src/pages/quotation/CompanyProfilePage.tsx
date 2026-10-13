import { useRef, useState } from 'react';
import { Building2, ImageIcon, PenLine, Upload, Phone, Mail, Globe, Landmark, Plus, Check, Trash2, Pencil, X, UploadCloud } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Modal } from '@/components/ui/Modal';
import {
  cleanProfile, hasErrors, loadProfileStore, prepareImage, saveProfileStore, validateProfile, validateSub,
  type OrgProfile, type ProfileStore, type SubCompany,
} from '@/lib/companyProfile';

const inputCls = 'w-full h-12 px-4 text-sm bg-slate-50 border rounded-xl focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20';
const lbl = 'block text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1.5';
const card = 'rounded-2xl border border-slate-200 p-5';
const border = (err?: string) => (err ? 'border-red-400' : 'border-slate-200');
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`);
const emptySub = { name: '', gstin: '', address: '', phone: '', email: '' };

function Err({ text }: { text?: string }) { return text ? <p className="text-[11px] text-red-600 mt-1">{text}</p> : null; }

export function CompanyProfilePage() {
  const { company, email: authEmail } = useAuth();
  const cid = company?.id ?? null;
  const [store, setStore] = useState<ProfileStore>(() => loadProfileStore(cid, { orgName: company?.company_name ?? '', email: authEmail ?? '' }));
  const [p, setP] = useState<OrgProfile>(store.profile);
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [subModal, setSubModal] = useState<{ editingId?: string } | null>(null);
  const [subDraft, setSubDraft] = useState(emptySub);
  const [subTouched, setSubTouched] = useState(false);
  const [subDelete, setSubDelete] = useState<SubCompany | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const sigRef = useRef<HTMLInputElement>(null);

  const errors = validateProfile(p);
  const dirty = JSON.stringify(p) !== JSON.stringify(store.profile);
  const set = <K extends keyof OrgProfile>(k: K, v: OrgProfile[K]) => setP(x => ({ ...x, [k]: v }));
  const setList = (k: 'phones' | 'emails', i: number, v: string) => setP(x => ({ ...x, [k]: x[k].map((e, j) => (j === i ? v : e)) }));
  const addToList = (k: 'phones' | 'emails') => setP(x => ({ ...x, [k]: [...x[k], ''] }));
  const dropFromList = (k: 'phones' | 'emails', i: number) => setP(x => ({ ...x, [k]: x[k].length > 1 ? x[k].filter((_, j) => j !== i) : [''] }));

  const persist = (next: ProfileStore, okText: string): boolean => {
    if (!saveProfileStore(cid, next)) { setNotice({ kind: 'err', text: 'Could not save: browser storage is unavailable or full. Try a smaller logo / signature.' }); return false; }
    setStore(next); setNotice({ kind: 'ok', text: okText }); return true;
  };

  const save = () => {
    setTouched(true);
    if (hasErrors(errors)) { setNotice({ kind: 'err', text: 'Fix the highlighted fields before saving.' }); return; }
    const clean = cleanProfile(p);
    if (persist({ ...store, profile: clean }, 'Organisation settings saved')) setP(clean);
  };

  const pickImage = async (file: File | undefined, kind: 'logo' | 'signature') => {
    if (!file) return;
    try { set(kind, await prepareImage(file, kind === 'logo' ? 600 : 500)); setNotice({ kind: 'ok', text: `${kind === 'logo' ? 'Logo' : 'Signature'} loaded. Click Save Organisation Settings to keep it.` }); }
    catch (e) { setNotice({ kind: 'err', text: (e as Error).message }); }
  };

  const subErrors = subModal ? validateSub(subDraft, store.subs, subModal.editingId) : {};
  const openSub = (s?: SubCompany) => { setSubDraft(s ? { name: s.name, gstin: s.gstin, address: s.address, phone: s.phone, email: s.email } : emptySub); setSubTouched(false); setSubModal({ editingId: s?.id }); };
  const saveSub = () => {
    setSubTouched(true);
    if (Object.keys(subErrors).length) return;
    const d = { name: subDraft.name.trim(), gstin: subDraft.gstin.trim().toUpperCase(), address: subDraft.address.trim(), phone: subDraft.phone.trim(), email: subDraft.email.trim() };
    const id = subModal?.editingId;
    const subs = id ? store.subs.map(s => (s.id === id ? { ...s, ...d } : s)) : [...store.subs, { id: newId(), ...d }];
    // Only the sub-company list changes here; unsaved edits to the main form are left untouched.
    if (persist({ profile: store.profile, subs }, id ? 'Sub-company updated' : 'Sub-company added')) setSubModal(null);
  };

  const imageBox = (data: string, empty: string, Icon: typeof ImageIcon, w: string) => (
    <div className={`${w} h-32 shrink-0 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden`}>
      {data ? <img src={data} alt={empty} className="max-w-full max-h-full object-contain" /> : (
        <div className="flex flex-col items-center text-slate-400"><Icon size={22} /><span className="text-[10px] font-bold tracking-wider mt-2">{empty}</span></div>
      )}
    </div>
  );

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 max-w-4xl">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Building2 className="text-orange-500" size={26} /> Company Profile &amp; Business Details</h1>
          <p className="text-sm text-slate-500 mt-1">Manage company details, branding, contact information, and banking details.</p>
        </div>

        {notice && <div role="status" className={`flex justify-between text-sm rounded-lg px-3 py-2 border ${notice.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}><span>{notice.text}</span><button aria-label="Dismiss" onClick={() => setNotice(null)}><X size={14} /></button></div>}

        <section className={card}>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-800"><ImageIcon size={16} className="text-orange-500" /> Organisation Logo</h2>
          <p className="text-xs text-slate-500 mb-4">Upload your company logo to display on exported quotation PDFs and reports.</p>
          <div className="flex flex-wrap items-center gap-5 border-t border-slate-100 pt-4">
            {imageBox(p.logo, 'NO LOGO', UploadCloud, 'w-32')}
            <div>
              <input ref={logoRef} type="file" accept="image/png,image/jpeg" aria-label="Logo file" className="hidden" onChange={e => { pickImage(e.target.files?.[0], 'logo'); e.target.value = ''; }} />
              <div className="flex gap-2">
                <button onClick={() => logoRef.current?.click()} className="flex items-center gap-2 h-10 px-4 text-sm font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-xl"><Upload size={15} /> {p.logo ? 'Change Logo' : 'Choose Logo'}</button>
                {p.logo && <button onClick={() => set('logo', '')} className="h-10 px-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl">Remove</button>}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">Recommended: Square or horizontal PNG/JPG with transparent background (Max 2MB).</p>
            </div>
          </div>
        </section>

        <section className={card}>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-800"><PenLine size={16} className="text-orange-500" /> Authorized Signature / Digital Stamp</h2>
          <p className="text-xs text-slate-500 mb-4">Upload authorized signature or stamp to automatically embed in quotation PDFs.</p>
          <div className="flex flex-wrap items-center gap-5 border-t border-slate-100 pt-4">
            {imageBox(p.signature, 'NO SIGNATURE', PenLine, 'w-40')}
            <div>
              <input ref={sigRef} type="file" accept="image/png,image/jpeg" aria-label="Signature file" className="hidden" onChange={e => { pickImage(e.target.files?.[0], 'signature'); e.target.value = ''; }} />
              <div className="flex gap-2">
                <button onClick={() => sigRef.current?.click()} className="flex items-center gap-2 h-10 px-4 text-sm font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-xl"><Upload size={15} /> {p.signature ? 'Change Signature' : 'Choose Signature'}</button>
                {p.signature && <button onClick={() => set('signature', '')} className="h-10 px-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl">Remove</button>}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">Recommended: Clean transparent PNG with black or blue signature (Max 2MB).</p>
            </div>
          </div>
        </section>

        <section className={card}>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-800 mb-4"><Building2 size={16} className="text-orange-500" /> Corporate Information</h2>
          <div className="space-y-4 border-t border-slate-100 pt-4">
            <div><label className={lbl} htmlFor="org-name">Organisation Name *</label>
              <input id="org-name" className={`${inputCls} font-semibold ${border(touched ? errors.orgName : undefined)}`} value={p.orgName} onChange={e => set('orgName', e.target.value)} /><Err text={touched ? errors.orgName : undefined} /></div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div><label className={lbl} htmlFor="org-gstin">GSTIN Number (Optional)</label>
                <input id="org-gstin" className={`${inputCls} font-mono uppercase ${border(touched ? errors.gstin : undefined)}`} placeholder="E.G. 33ADNFS8459B1ZT" maxLength={15} value={p.gstin} onChange={e => set('gstin', e.target.value.toUpperCase())} /><Err text={touched ? errors.gstin : undefined} /></div>
              <div><label className={lbl} htmlFor="org-web">Official Website</label>
                <div className="relative"><Globe size={15} className="absolute left-4 top-4 text-slate-400" /><input id="org-web" className={`${inputCls} pl-10 ${border(touched ? errors.website : undefined)}`} placeholder="https://www.yourcompany.com" value={p.website} onChange={e => set('website', e.target.value)} /></div><Err text={touched ? errors.website : undefined} /></div>
            </div>
            <div><label className={lbl} htmlFor="org-addr">Registered Corporate / Factory Address</label>
              <textarea id="org-addr" rows={3} className={`${inputCls} h-auto py-3 border-slate-200`} placeholder="e.g. Plot No. 42, Industrial Park Phase II, Ambattur, Chennai - 600058, Tamil Nadu, India" value={p.address} onChange={e => set('address', e.target.value)} /></div>
          </div>
        </section>

        <section className={card}>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-800 mb-4"><Phone size={16} className="text-orange-500" /> Contact Channels</h2>
          {([['phones', 'Phone Numbers', 'Add Phone Number', Phone, 'e.g. +91 98765 43210'], ['emails', 'Email Addresses', 'Add Email Address', Mail, 'e.g. sales@yourcompany.com']] as const).map(([k, title, add, Icon, ph]) => (
            <div key={k} className="border-t border-slate-100 pt-4 pb-3">
              <div className="flex items-center justify-between mb-2"><span className={lbl + ' mb-0'}>{title}</span><button onClick={() => addToList(k)} className="flex items-center gap-1 text-xs font-bold text-orange-600"><Plus size={13} /> {add}</button></div>
              <div className="space-y-2">
                {p[k].map((v, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1"><Icon size={15} className="absolute left-4 top-3.5 text-slate-400" />
                        <input aria-label={`${title} ${i + 1}`} className={`${inputCls} h-11 pl-10 ${border(touched ? errors[k][i] : undefined)}`} placeholder={ph} value={v} onChange={e => setList(k, i, e.target.value)} /></div>
                      <button aria-label={`Remove ${title} ${i + 1}`} onClick={() => dropFromList(k, i)} className="p-2 text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                    </div>
                    <Err text={touched ? errors[k][i] : undefined} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className={card}>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-800"><Landmark size={16} className="text-orange-500" /> Bank &amp; Payment Details</h2>
          <p className="text-xs text-slate-500 mb-4">These banking particulars will appear in the payment instructions of your generated invoices/quotes.</p>
          <div className="grid sm:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
            <div><label className={lbl} htmlFor="bank-name">Bank Name</label><input id="bank-name" className={`${inputCls} border-slate-200`} placeholder="e.g. State Bank of India / HDFC Bank" value={p.bankName} onChange={e => set('bankName', e.target.value)} /></div>
            <div><label className={lbl} htmlFor="bank-acc">Account Number</label><input id="bank-acc" inputMode="numeric" className={`${inputCls} font-mono ${border(touched ? errors.accountNo : undefined)}`} placeholder="e.g. 50200012345678" value={p.accountNo} onChange={e => set('accountNo', e.target.value.replace(/\s/g, ''))} /><Err text={touched ? errors.accountNo : undefined} /></div>
            <div><label className={lbl} htmlFor="bank-branch">Branch</label><input id="bank-branch" className={`${inputCls} border-slate-200`} placeholder="e.g. Ambattur Industrial Estate" value={p.branch} onChange={e => set('branch', e.target.value)} /></div>
            <div><label className={lbl} htmlFor="bank-ifsc">IFSC Code</label><input id="bank-ifsc" maxLength={11} className={`${inputCls} font-mono uppercase ${border(touched ? errors.ifsc : undefined)}`} placeholder="E.G. SBIN0001234" value={p.ifsc} onChange={e => set('ifsc', e.target.value.toUpperCase())} /><Err text={touched ? errors.ifsc : undefined} /></div>
            <div className="sm:col-span-2"><label className={lbl} htmlFor="bank-upi">UPI ID / UPI Number (Optional)</label><input id="bank-upi" className={`${inputCls} ${border(touched ? errors.upi : undefined)}`} placeholder="e.g. companyname@okhdfcbank or 9876543210@upi" value={p.upi} onChange={e => set('upi', e.target.value)} /><Err text={touched ? errors.upi : undefined} /></div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={save} className="flex items-center gap-2 h-12 px-6 text-sm font-bold text-white bg-orange-500 rounded-xl hover:bg-orange-600 shadow-sm"><Check size={16} /> Save Organisation Settings</button>
          <button onClick={() => openSub()} className="flex items-center gap-2 h-12 px-5 text-sm font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100"><Plus size={16} /> Add Sub-Company</button>
          {dirty && <span className="text-xs font-semibold text-amber-600">Unsaved changes</span>}
        </div>

        <section className="border-t border-slate-200 pt-5">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><Building2 size={18} className="text-blue-600" /> Organisation Sub-Companies</h2>
          <p className="text-sm text-slate-500 mb-4">Manage additional company branches, subsidiaries, or departmental profiles for quotation generation.</p>
          {store.subs.length === 0 ? (
            <div className="flex flex-col items-center text-center py-10 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
              <Building2 size={28} className="text-slate-300 mb-2" />
              <p className="text-sm font-bold text-slate-800">No Sub-Companies Added</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">Click the <b className="text-blue-600">+ Add Sub-Company</b> button above to register additional company branches, divisions, or subsidiary entities.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {store.subs.map(s => (
                <div key={s.id} data-testid="sub-card" className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-slate-900">{s.name}</p>
                    <div className="flex shrink-0"><button aria-label={`Edit ${s.name}`} onClick={() => openSub(s)} className="p-1.5 text-slate-400 hover:text-orange-600"><Pencil size={15} /></button>
                      <button aria-label={`Delete ${s.name}`} onClick={() => setSubDelete(s)} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={15} /></button></div>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 space-y-0.5">{s.gstin && <p className="font-mono">GSTIN {s.gstin}</p>}{s.address && <p>{s.address}</p>}{(s.phone || s.email) && <p>{[s.phone, s.email].filter(Boolean).join(' · ')}</p>}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Modal open={!!subModal} onClose={() => setSubModal(null)} size="md" title={subModal?.editingId ? 'Edit Sub-Company' : 'Add Sub-Company'} subtitle="Branch, subsidiary or department that can issue quotations">
        <div className="space-y-4">
          <div><label className={lbl} htmlFor="sub-name">Name *</label><input id="sub-name" autoFocus className={`${inputCls} ${border(subTouched ? subErrors.name : undefined)}`} value={subDraft.name} onChange={e => setSubDraft(d => ({ ...d, name: e.target.value }))} /><Err text={subTouched ? subErrors.name : undefined} /></div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label className={lbl} htmlFor="sub-gstin">GSTIN</label><input id="sub-gstin" maxLength={15} className={`${inputCls} font-mono ${border(subTouched ? subErrors.gstin : undefined)}`} value={subDraft.gstin} onChange={e => setSubDraft(d => ({ ...d, gstin: e.target.value.toUpperCase() }))} /><Err text={subTouched ? subErrors.gstin : undefined} /></div>
            <div><label className={lbl} htmlFor="sub-phone">Phone</label><input id="sub-phone" className={`${inputCls} ${border(subTouched ? subErrors.phone : undefined)}`} value={subDraft.phone} onChange={e => setSubDraft(d => ({ ...d, phone: e.target.value }))} /><Err text={subTouched ? subErrors.phone : undefined} /></div>
          </div>
          <div><label className={lbl} htmlFor="sub-email">Email</label><input id="sub-email" className={`${inputCls} ${border(subTouched ? subErrors.email : undefined)}`} value={subDraft.email} onChange={e => setSubDraft(d => ({ ...d, email: e.target.value }))} /><Err text={subTouched ? subErrors.email : undefined} /></div>
          <div><label className={lbl} htmlFor="sub-addr">Address</label><textarea id="sub-addr" rows={2} className={`${inputCls} h-auto py-3 border-slate-200`} value={subDraft.address} onChange={e => setSubDraft(d => ({ ...d, address: e.target.value }))} /></div>
          <p className="text-xs text-slate-400">A sub-company uses the organisation's logo, signature and bank details on its quotations.</p>
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setSubModal(null)} className="h-10 px-5 text-sm font-semibold text-slate-700 border border-slate-200 rounded-xl">Cancel</button>
            <button onClick={saveSub} className="h-10 px-5 text-sm font-semibold text-white bg-orange-500 rounded-xl">{subModal?.editingId ? 'Save changes' : 'Save Sub-Company'}</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!subDelete} onClose={() => setSubDelete(null)} size="sm" title="Delete sub-company?">
        <p className="text-sm text-slate-600">“{subDelete?.name}” will be removed. Saved quotations that used it keep their printed details, but new PDFs from them will use the main organisation.</p>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => setSubDelete(null)} className="text-sm font-semibold text-slate-600 px-3">Cancel</button>
          <button onClick={() => { if (subDelete) persist({ profile: store.profile, subs: store.subs.filter(s => s.id !== subDelete.id) }, 'Sub-company deleted'); setSubDelete(null); }} className="h-10 px-5 text-sm font-semibold text-white bg-red-600 rounded-lg">Delete</button>
        </div>
      </Modal>
    </div>
  );
}

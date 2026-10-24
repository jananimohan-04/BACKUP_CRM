import { supabase } from './supabase';
// Organisation profile used on quotation PDFs (logo, signature, GSTIN, contacts, bank) plus
// optional sub-companies (branches / subsidiaries). Stored in this browser, per company; there is
// no database table for it yet.

export interface OrgProfile {
  orgName: string;
  gstin: string;
  website: string;
  address: string;
  phones: string[];
  emails: string[];
  bankName: string;
  accountNo: string;
  branch: string;
  ifsc: string;
  upi: string;
  /** PNG / JPEG data URLs (already downscaled). */
  logo: string;
  signature: string;
}

export interface SubCompany { id: string; name: string; gstin: string; address: string; phone: string; email: string }
export interface ProfileStore { profile: OrgProfile; subs: SubCompany[] }

/** What the PDF prints for the issuing company. */
export interface QuoteSeller {
  name: string; gstin: string; address: string; website: string;
  phones: string[]; emails: string[];
  bankLines: string[]; logo: string; signature: string;
}

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg'];

const key = (companyId: string | null | undefined) => `argus.orgprofile.${companyId ?? 'all'}`;

export const emptyProfile = (orgName = '', email = ''): OrgProfile => ({
  orgName, gstin: '', website: '', address: '', phones: [''], emails: [email], bankName: '', accountNo: '', branch: '', ifsc: '', upi: '', logo: '', signature: '',
});

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function loadProfileStore(companyId: string | null | undefined, defaults: { orgName: string; email: string }): ProfileStore {
  const base = emptyProfile(defaults.orgName, defaults.email);
  try {
    const raw = localStorage.getItem(key(companyId));
    if (!raw) return { profile: base, subs: [] };
    const v = JSON.parse(raw);
    const p = (v?.profile ?? {}) as Partial<OrgProfile>;
    const s = (x: unknown) => (typeof x === 'string' ? x : '');
    const phones = strs(p.phones), emails = strs(p.emails);
    return {
      profile: {
        orgName: s(p.orgName) || base.orgName, gstin: s(p.gstin), website: s(p.website), address: s(p.address),
        phones: phones.length ? phones : [''], emails: emails.length ? emails : [''],
        bankName: s(p.bankName), accountNo: s(p.accountNo), branch: s(p.branch), ifsc: s(p.ifsc), upi: s(p.upi),
        logo: s(p.logo), signature: s(p.signature),
      },
      subs: Array.isArray(v?.subs) ? v.subs.filter((x: SubCompany) => x && typeof x.id === 'string' && typeof x.name === 'string').map((x: SubCompany) => ({ id: x.id, name: x.name, gstin: s(x.gstin), address: s(x.address), phone: s(x.phone), email: s(x.email) })) : [],
    };
  } catch { return { profile: base, subs: [] }; }
}

const hasContent = (v: any): boolean => {
  const p = v?.profile ?? {};
  return !!(p.address || p.gstin || p.website || p.bankName || p.accountNo || p.branch || p.ifsc || p.upi || p.logo || p.signature
    || (Array.isArray(p.phones) && p.phones.some(Boolean)) || (Array.isArray(v?.subs) && v.subs.length));
};

/**
 * The profile is shared by everyone in the company (database), with this browser's copy kept as a cache:
 *   - the company already has a saved profile  -> it replaces the browser copy
 *   - it has none, but this browser has one      -> that one is uploaded, so it becomes the company's
 * Falls back to the browser copy if the database call is not available (migration not applied, offline).
 */
export async function syncProfileStore(companyId: string | null | undefined, defaults: { orgName: string; email: string }): Promise<ProfileStore> {
  if (!companyId) return loadProfileStore(companyId, defaults);
  try {
    const { data, error } = await supabase.rpc('erp_get_company_profile');
    if (!error) {
      if (data && typeof data === 'object') {
        localStorage.setItem(key(companyId), JSON.stringify(data));
      } else {
        const raw = localStorage.getItem(key(companyId));
        const local = raw ? JSON.parse(raw) : null;
        if (local && hasContent(local)) await supabase.rpc('erp_save_company_profile', { p_data: local });
      }
    }
  } catch { /* keep the browser copy */ }
  return loadProfileStore(companyId, defaults);
}

/** Saves the profile for the whole company. Returns an error message, or null when saved. */
export async function saveProfileRemote(st: ProfileStore): Promise<string | null> {
  try {
    const { error } = await supabase.rpc('erp_save_company_profile', { p_data: st });
    return error ? error.message : null;
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}

export function saveProfileStore(companyId: string | null | undefined, st: ProfileStore): boolean {
  try { localStorage.setItem(key(companyId), JSON.stringify(st)); return true; } catch { return false; }
}

// ---- validation ---------------------------------------------------------------------------------
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UPI_RE = /^[\w.-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$/;
const UPI_NUMBER_RE = /^\d{10,15}$/;   // a UPI number (the mobile number linked to UPI) is accepted as well

export interface ProfileErrors {
  orgName?: string; gstin?: string; website?: string; accountNo?: string; ifsc?: string; upi?: string;
  phones: Record<number, string>; emails: Record<number, string>;
}

export const normaliseWebsite = (w: string) => { const t = w.trim(); return t && !/^https?:\/\//i.test(t) ? `https://${t}` : t; };

export function validateProfile(p: OrgProfile): ProfileErrors {
  const e: ProfileErrors = { phones: {}, emails: {} };
  if (!p.orgName.trim()) e.orgName = 'Organisation name is required';
  if (p.gstin.trim() && !GSTIN_RE.test(p.gstin.trim().toUpperCase())) e.gstin = 'GSTIN must be 15 characters, e.g. 33ADNFS8459B1ZT';
  if (p.website.trim()) { try { const u = new URL(normaliseWebsite(p.website)); if (!u.hostname.includes('.')) throw new Error('x'); } catch { e.website = 'Enter a valid website address'; } }
  if (p.accountNo.trim() && !/^\d{9,18}$/.test(p.accountNo.trim())) e.accountNo = 'Account number must be 9 to 18 digits';
  if (p.ifsc.trim() && !IFSC_RE.test(p.ifsc.trim().toUpperCase())) e.ifsc = 'IFSC must be 11 characters, e.g. SBIN0001234';
  if (p.upi.trim() && !UPI_RE.test(p.upi.trim()) && !UPI_NUMBER_RE.test(p.upi.trim().replace(/[\s-]/g, ''))) e.upi = 'Enter a UPI ID like name@bank or a UPI number (10 to 15 digits)';
  p.phones.forEach((ph, i) => { const d = ph.replace(/\D/g, ''); if (ph.trim() && (d.length < 7 || d.length > 15 || /[^\d\s+()-]/.test(ph))) e.phones[i] = 'Enter a valid phone number'; });
  p.emails.forEach((em, i) => { if (em.trim() && !EMAIL_RE.test(em.trim())) e.emails[i] = 'Enter a valid email address'; });
  return e;
}
export const hasErrors = (e: ProfileErrors) => !!(e.orgName || e.gstin || e.website || e.accountNo || e.ifsc || e.upi || Object.keys(e.phones).length || Object.keys(e.emails).length);

/** Trims, upper-cases codes and drops blank phone / email rows (keeping one empty row to type in). */
export function cleanProfile(p: OrgProfile): OrgProfile {
  const keep = (a: string[]) => { const r = a.map(x => x.trim()).filter(Boolean); return r.length ? r : ['']; };
  return {
    ...p, orgName: p.orgName.trim(), gstin: p.gstin.trim().toUpperCase(), website: normaliseWebsite(p.website), address: p.address.trim(),
    phones: keep(p.phones), emails: keep(p.emails), bankName: p.bankName.trim(), accountNo: p.accountNo.trim(), branch: p.branch.trim(),
    ifsc: p.ifsc.trim().toUpperCase(), upi: p.upi.trim(),
  };
}

export type SubErrors = Partial<Record<'name' | 'gstin' | 'email' | 'phone', string>>;
export function validateSub(d: Omit<SubCompany, 'id'>, subs: SubCompany[], editingId?: string): SubErrors {
  const e: SubErrors = {};
  const n = d.name.trim();
  if (!n) e.name = 'Name is required';
  else if (subs.some(s => s.id !== editingId && s.name.trim().toLowerCase() === n.toLowerCase())) e.name = 'A sub-company with this name already exists';
  if (d.gstin.trim() && !GSTIN_RE.test(d.gstin.trim().toUpperCase())) e.gstin = 'GSTIN must be 15 characters';
  if (d.email.trim() && !EMAIL_RE.test(d.email.trim())) e.email = 'Enter a valid email address';
  if (d.phone.trim()) { const dg = d.phone.replace(/\D/g, ''); if (dg.length < 7 || dg.length > 15 || /[^\d\s+()-]/.test(d.phone)) e.phone = 'Enter a valid phone number'; }
  return e;
}

/** Issuing company for a quotation: the main profile, or a sub-company that borrows its logo, signature and bank. */
export function resolveSeller(st: ProfileStore, ref: string | undefined): QuoteSeller {
  const p = st.profile;
  const bankLines = [
    p.bankName && `Bank: ${p.bankName}`, p.accountNo && `A/c No: ${p.accountNo}`, p.branch && `Branch: ${p.branch}`, p.ifsc && `IFSC: ${p.ifsc}`, p.upi && `UPI: ${p.upi}`,
  ].filter(Boolean) as string[];
  const sub = ref ? st.subs.find(s => s.id === ref) : undefined;
  if (sub) {
    return { name: sub.name, gstin: sub.gstin, address: sub.address, website: p.website, phones: sub.phone ? [sub.phone] : [], emails: sub.email ? [sub.email] : [], bankLines, logo: p.logo, signature: p.signature };
  }
  return { name: p.orgName, gstin: p.gstin, address: p.address, website: p.website, phones: p.phones.filter(Boolean), emails: p.emails.filter(Boolean), bankLines, logo: p.logo, signature: p.signature };
}

/** Reads an image file, checks type / size, and downscales it (keeping transparency for PNG) so storage stays small. */
export async function prepareImage(file: File, maxEdge: number): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Choose a PNG or JPG image.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('The image is larger than 2 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This file is not a readable image.')); i.src = url; });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); if (!ctx) throw new Error('Could not process the image.');
    ctx.drawImage(img, 0, 0, w, h);
    return file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
  } finally { URL.revokeObjectURL(url); }
}

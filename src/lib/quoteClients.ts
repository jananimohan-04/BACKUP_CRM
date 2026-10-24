import { supabase } from './supabase';
import type { QuoteClient } from './quotationDocument';

// A quotation's client can reach the PDF without its address / GSTIN (a pipeline card, an older saved quotation).
// The company master (Add Company) holds them, so the gaps are filled from it by company name. Only empty fields are filled.

const str = (v: unknown) => (v == null ? '' : String(v).trim());
const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export async function fillClientDetails(clients: QuoteClient[], companyId: string | null | undefined): Promise<QuoteClient[]> {
  const missing = clients.filter(c => c.name && (!c.address || !c.gstin || !c.phone || !c.email));
  if (!missing.length) return clients;
  try {
    let q = supabase.from('cnc_customers').select('*');
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error || !data) return clients;
    const byName = new Map<string, Record<string, unknown>>();
    for (const r of data as Record<string, unknown>[]) { const k = nameKey(str(r.name)); if (k && !byName.has(k)) byName.set(k, r); }
    return clients.map(c => {
      const r = byName.get(nameKey(c.name));
      if (!r) return c;
      const address = str(r.address) || [r.city, r.state, r.pincode].map(str).filter(Boolean).join(', ');
      return {
        ...c,
        address: c.address || address,
        gstin: c.gstin || str(r.gstin) || str(r.gst) || str(r.gst_number),
        phone: c.phone || str(r.phone) || str(r.mobile),
        email: c.email || str(r.email),
      };
    });
  } catch { return clients; }
}

/** True when filling changed anything (so a caller can avoid a pointless state update). */
export const clientsDiffer = (a: QuoteClient[], b: QuoteClient[]) =>
  a.length !== b.length || a.some((c, i) => c.address !== b[i].address || c.gstin !== b[i].gstin || c.phone !== b[i].phone || c.email !== b[i].email);

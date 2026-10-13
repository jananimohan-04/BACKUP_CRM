import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Calculator, Layers, PencilRuler, Shapes, BarChart3, RotateCcw, Info } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { LIVE_METAL_OF, LIVE_METALS, ageLabel, describeRateIssue, inrLabel, quoteStamp, isStale, needsRefresh, parseRates, rateInUnit, type LiveMetal, type MarketRate } from '@/lib/marketRates';
import {
  PROFILES, PROFILE_BY_ID, MATERIALS, UNITS, PRICE_UNITS, LENGTH_KEY,
  calculate, convertDims, defaultDims,
  type DimMap, type DimValue, type PriceUnit, type ProfileId, type Unit,
} from '@/lib/metalCalc';
import { ProfileGlyph, ProfilePreview } from './MetalProfilePreview';

// Metal Weight & Cost Calculator. Everything is calculated in the browser by src/lib/metalCalc.ts
// (no database, no company data), so it works for every role.

type AllDims = Record<ProfileId, DimMap>;
const initialDims = (): AllDims => Object.fromEntries(PROFILES.map(p => [p.id, defaultDims(p)])) as AllDims;

const fmt = (n: number, digits: number) => n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const kg = (n: number) => fmt(n, n >= 0.1 ? 2 : 4);
const grams = (n: number) => fmt(n, n >= 100 ? 0 : 2);

const fieldBox = (error: boolean) =>
  `flex rounded-lg border bg-slate-50 transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:border-brand-500 ${error ? 'border-red-400' : 'border-slate-200'}`;
const inputCls = 'flex-1 min-w-0 h-10 px-3 bg-transparent text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none';
const unitSelectCls = 'h-10 pl-2 pr-1 text-sm font-semibold text-slate-600 bg-transparent border-l border-slate-200 focus:outline-none cursor-pointer';
const labelCls = 'block text-xs text-slate-500 mb-1';
const sectionTitle = 'text-[11px] font-bold text-slate-700 uppercase tracking-wider';

const numeric = (v: string) => v.replace(/[^0-9.,-]/g, '');

function DimField({ label, v, error, onValue, onUnit }: {
  label: string; v: DimValue; error?: string; onValue: (s: string) => void; onUnit: (u: Unit) => void;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className={fieldBox(!!error)}>
        <input className={inputCls} inputMode="decimal" aria-label={label} aria-invalid={!!error} value={v.value} onChange={e => onValue(numeric(e.target.value))} />
        <select className={unitSelectCls} aria-label={`${label} unit`} value={v.unit} onChange={e => onUnit(e.target.value as Unit)}>
          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  );
}

const METAL_LABEL: Record<LiveMetal, string> = { aluminum: 'Aluminium', copper: 'Copper', lead: 'Lead', nickel: 'Nickel', zinc: 'Zinc', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', palladium: 'Palladium' };
const METAL_ORDER: LiveMetal[] = LIVE_METALS;

/** Reference only: today's market price per kg, next to the dealer price the user types. */
function MarketPanel({ rates, state, selected, price, unit, fromLive, issue }: {
  issue: string | null;
  rates: Partial<Record<LiveMetal, MarketRate>>; state: 'loading' | 'ready' | 'error'; selected?: LiveMetal; price: string; unit: PriceUnit; fromLive: boolean;
}) {
  const have = METAL_ORDER.filter(m => rates[m]);
  const newest = have.map(m => rates[m]!.quotedAt ?? rates[m]!.fetchedAt).sort().pop() ?? null;
  const sel = selected ? rates[selected] : undefined;
  const typed = Number(price.replace(/,/g, ''));
  // Compare in the same unit the user typed in.
  const marketInUnit = sel ? Number(rateInUnit(sel.inrPerKg, unit)) : NaN;
  const diff = !fromLive && sel && typed > 0 && marketInUnit > 0 ? ((typed - marketInUnit) / marketInUnit) * 100 : null;
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3" data-testid="market-panel">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Market price today <span className="font-medium normal-case text-slate-400">· reference, ₹ per kg</span></h4>
        {newest && <span className="text-[10px] text-slate-400">{ageLabel(newest)} · Metals.Dev</span>}
      </div>
      {state === 'loading' && <p className="text-xs text-slate-400 mt-2">Loading market prices…</p>}
      {state !== 'loading' && have.length === 0 && (
        <p className="text-xs text-amber-600 mt-2" data-testid="market-empty">Market prices are not available right now{issue ? ` — ${issue}` : ''}. Enter your dealer price.</p>
      )}
      {have.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
          {have.map(m => (
            <div key={m} data-testid={`market-${m}`} className={`rounded-md border px-2 py-1.5 ${m === selected ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white'}`}>
              <p className="text-[10px] text-slate-500">{METAL_LABEL[m]}</p>
              <p className="font-mono text-sm font-semibold text-slate-800">₹{inrLabel(rates[m]!.inrPerKg)}</p>
            </div>
          ))}
        </div>
      )}
      {diff !== null && (
        <p className="text-[11px] mt-2 text-slate-600" data-testid="market-diff">
          Your price is <b className={diff > 0 ? 'text-amber-700' : 'text-emerald-700'}>{Math.abs(diff).toFixed(1)}% {diff >= 0 ? 'above' : 'below'}</b> the market price of {METAL_LABEL[selected!]}.
        </p>
      )}
      <p className="text-[10px] text-slate-400 mt-2">Exchange (LME/MCX-based) prices, before dealer margin, freight and GST. Steel, stainless and brass have no free live feed — use your dealer price.</p>
    </div>
  );
}

let refreshInFlight: Promise<{ error: unknown }> | null = null;

function RateNote({ materialId, liveMetal, rate, fresh, state, unit, applied, onUse }: {
  materialId: string; liveMetal?: LiveMetal; rate?: MarketRate; fresh: boolean; state: 'loading' | 'ready' | 'error'; unit: PriceUnit; applied: boolean; onUse: () => void;
}) {
  const cls = 'text-[11px] mt-1';
  if (materialId === 'custom' || !materialId) return null;
  if (!liveMetal) return <p className={`${cls} text-slate-400`} data-testid="rate-note">No live market feed for this material — enter your dealer price.</p>;
  if (state === 'loading') return <p className={`${cls} text-slate-400`} data-testid="rate-note">Checking live market rate…</p>;
  if (!rate) return <p className={`${cls} text-amber-600`} data-testid="rate-note">Live rate unavailable right now — enter your own price.</p>;
  const when = ageLabel(rate.quotedAt ?? rate.fetchedAt);
  if (!fresh) return <p className={`${cls} text-amber-600`} data-testid="rate-note">Last market rate (₹{rateInUnit(rate.inrPerKg, 'kg')}/kg) is out of date ({when}) — not applied.</p>;
  return (
    <p className={`${cls} text-emerald-700`} data-testid="rate-note">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 align-middle" />
      Live market rate ₹{rateInUnit(rate.inrPerKg, unit)} / {unit} · Metals.Dev · {when}
      {applied ? ' · applied — type your dealer price to replace it' : <> · <button type="button" onClick={onUse} className="underline font-semibold">Use live rate</button></>}
    </p>
  );
}

type Badge = { v: number } | null;

/** The newest quote time across all metals, as an ISO string. */
function newestQuote(rates: Partial<Record<LiveMetal, MarketRate>>): string | null {
  const t = LIVE_METALS.map(m => rates[m]).filter(Boolean).map(r => r!.quotedAt ?? r!.fetchedAt).sort().pop();
  return t ?? null;
}

/** Material picker: name, density and the ₹/kg rate for each (your saved dealer rate, else today's market price). */
function MaterialSelect({ value, onChange, badge, density, asOf, issue }: { value: string; onChange: (id: string) => void; badge: (id: string) => Badge; density: string; asOf: string | null; issue: string | null }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const current = MATERIALS.find(m => m.id === value);
  const label = current ? `${current.name} (${current.density} g/cm³)` : `Custom (${density.trim() || '—'} g/cm³)`;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const choose = (id: string) => { onChange(id); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setActive(Math.max(0, MATERIALS.findIndex(m => m.id === value))); setOpen(true); return; }
      setActive(i => (e.key === 'ArrowDown' ? Math.min(MATERIALS.length - 1, i + 1) : Math.max(0, i - 1)));
    } else if ((e.key === 'Enter' || e.key === ' ') && open) { e.preventDefault(); choose(MATERIALS[active].id); }
  };

  return (
    <div ref={box} className="relative" onKeyDown={onKey}>
      <button type="button" aria-label="Material presets" aria-haspopup="listbox" aria-expanded={open} data-value={value}
        onClick={() => { setActive(Math.max(0, MATERIALS.findIndex(m => m.id === value))); setOpen(o => !o); }}
        className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm font-medium text-slate-800 flex items-center justify-between gap-2 text-left focus:outline-none focus:bg-white focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500">
        <span className="truncate">{label}</span>
        <ChevronDown size={16} className="text-slate-400 shrink-0" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Materials" className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg pb-1">
          <li role="presentation" data-testid="mat-asof" className="sticky top-0 z-10 bg-white/95 backdrop-blur px-3 py-1.5 text-[10px] text-slate-500 border-b border-slate-100">
            {asOf ? <>Live market rates · <b className="text-slate-700">{quoteStamp(asOf)}</b> ({ageLabel(asOf)})</> : <span className="text-amber-700" data-testid="mat-issue">Live market rates not available{issue ? ` — ${issue}` : ' yet'}</span>}
          </li>
          {MATERIALS.map((m, i) => {
            const b = badge(m.id);
            return (
              <li key={m.id} role="option" aria-selected={m.id === value} data-testid={`mat-opt-${m.id}`}
                onMouseEnter={() => setActive(i)} onClick={() => choose(m.id)}
                className={`flex items-center justify-between gap-3 px-3 py-2 cursor-pointer text-sm ${i === active ? 'bg-slate-50' : ''} ${m.id === value ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                <span className="truncate">{m.name}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[11px] text-slate-400">{m.density} g/cm³</span>
                  {b ? (
                    <span data-testid={`mat-badge-${m.id}`} title="Market price today (from the live feed)"
                      className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full border bg-sky-50 text-sky-700 border-sky-200">
                      ₹{inrLabel(b.v)}/kg
                    </span>
                  ) : <span className="text-[11px] text-slate-300 px-2">—</span>}
                </span>
              </li>
            );
          })}
          <li role="option" aria-selected={value === 'custom'} data-testid="mat-opt-custom" onClick={() => choose('custom')}
            className={`flex items-center justify-between gap-3 px-3 py-2 cursor-pointer text-sm border-t border-slate-100 mt-1 ${value === 'custom' ? 'bg-orange-50 font-semibold text-orange-700' : 'text-slate-700 hover:bg-slate-50'}`}>
            <span>Custom Material</span>
            <span className="font-mono text-[11px] text-slate-400">{density.trim() || '—'} g/cm³</span>
          </li>
        </ul>
      )}
    </div>
  );
}

/** One metal component handed to a product's cost sheet. */
export interface BomMetalItem { description: string; weightKg: number; ratePerKg: number | null }

/** `embedded`: used inside the Product Workings page (no page header, adds an "Add to Product BOM" button). */
export function MetalCalculatorPage({ embedded }: { embedded?: { onAdd: (item: BomMetalItem) => void } } = {}) {
  const [profileId, setProfileId] = useState<ProfileId>('i-beam');
  const [all, setAll] = useState<AllDims>(initialDims);
  const [unitMode, setUnitMode] = useState<'mm' | 'in'>('mm');
  const [materialId, setMaterialId] = useState('steel');
  const [density, setDensity] = useState('7.85');
  const [price, setPrice] = useState('');
  const [priceUnit, setPriceUnit] = useState<PriceUnit>('kg');
  const [qty, setQty] = useState('1');
  // Live market rate (INR/kg) for the metals a feed quotes; the price field follows it until you type your own.
  const [rates, setRates] = useState<Partial<Record<LiveMetal, MarketRate>>>({});
  const [ratesState, setRatesState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [ratesIssue, setRatesIssue] = useState<string | null>(null);
  const [priceFromLive, setPriceFromLive] = useState(false);

  // Read the stored rates; if they are missing or old, ask the server to refresh them (it refuses to call the
  // provider more than once every few hours, so opening this page often is harmless).
  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await supabase.from('market_rates').select('metal, inr_per_kg, quoted_at, fetched_at');
      if (r.error) throw Object.assign(new Error(describeRateIssue('table', r.error)), { already: true });
      return parseRates(r.data);
    };
    (async () => {
      try {
        let issue: string | null = null;
        let got = await load();
        if (live) setRates(got);
        const needs = LIVE_METALS.some(m => needsRefresh(got[m]));
        if (needs) {
          // One refresh at a time, even if the page mounts twice (React dev double-mount, quick re-opens).
          refreshInFlight ??= supabase.functions.invoke('refresh-metal-rates').finally(() => { refreshInFlight = null; });
          const f = await refreshInFlight;
          if (f.error) {
            console.error('Rate refresh failed:', f.error);
            const res = (f.error as { context?: Response }).context;
            let body: unknown = null;
            try { body = await res?.clone().json(); } catch { /* not JSON */ }
            issue = describeRateIssue('function', f.error, res?.status, body);
          } else got = await load();
        }
        if (live) { setRates(got); setRatesIssue(Object.keys(got).length ? null : issue); setRatesState(Object.keys(got).length ? 'ready' : 'error'); }
      } catch (e) {
        console.error('Could not load market rates:', e);
        if (live) { setRatesIssue(e instanceof Error ? e.message : 'Could not load market rates.'); setRatesState('error'); }
      }
    })();
    return () => { live = false; };
  }, []);

  const profile = PROFILE_BY_ID[profileId];
  const dims = all[profileId];

  const outcome = useMemo(
    () => calculate({ profile: profileId, dims, density, qty, price, priceUnit }),
    [profileId, dims, density, qty, price, priceUnit],
  );
  const errorOf: Record<string, string> = {};
  if (outcome.status === 'error') for (const i of outcome.issues) if (i.key) errorOf[i.key] = i.message;
  const generalIssues = outcome.status === 'error' ? outcome.issues.filter(i => !i.key) : [];

  const setField = (key: string, patch: Partial<DimValue>) =>
    setAll(prev => ({ ...prev, [profileId]: { ...prev[profileId], [key]: { ...prev[profileId][key], ...patch } } }));

  // MM / IN switches every dimension of every profile, keeping the physical size.
  const switchUnits = (u: 'mm' | 'in') => {
    setUnitMode(u);
    setAll(prev => Object.fromEntries(Object.entries(prev).map(([id, d]) => [id, convertDims(d, u)])) as AllDims);
  };

  const pickMaterial = (id: string) => {
    setMaterialId(id);
    const m = MATERIALS.find(x => x.id === id);
    if (m) setDensity(String(m.density));
  };
  const onDensity = (v: string) => {
    const clean = numeric(v);
    setDensity(clean);
    setMaterialId(MATERIALS.find(m => String(m.density) === clean.trim())?.id ?? 'custom');
  };

  const clearAll = () => {
    setAll(prev => ({
      ...prev,
      [profileId]: Object.fromEntries(Object.entries(prev[profileId]).map(([k, v]) => [k, { value: '', unit: v.unit }])),
    }));
    setPrice('');
    setPriceFromLive(false);
    setQty('1');
  };

  const ok = outcome.status === 'ok' ? outcome.result : null;

  const liveMetal = LIVE_METAL_OF[materialId];
  const liveRate = liveMetal ? rates[liveMetal] : undefined;
  const liveFresh = !!liveRate && !isStale(liveRate);
  // The price follows today's market rate (from the API) until the user types their own.
  const autoPerKg = liveRate && liveFresh ? liveRate.inrPerKg : undefined;
  const liveValue = autoPerKg !== undefined ? rateInUnit(autoPerKg, priceUnit) : null;
  // Keep the price on the live rate (when it is fresh) until the user types their own; drop a live price that no
  // longer applies (material changed to one with no feed, or the rate went stale).
  useEffect(() => {
    if (liveValue !== null) { if (price === '' || priceFromLive) { setPrice(liveValue); setPriceFromLive(true); } }
    else if (priceFromLive) { setPrice(''); setPriceFromLive(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveValue]);

  return (
    <div className={embedded ? '' : 'p-4 lg:p-6 bg-grid min-h-full'}>
      <div className={embedded ? '' : 'bg-white border border-slate-200 rounded-2xl shadow-sm p-4'}>
        {!embedded && <div className="flex items-center gap-3 pb-4 mb-5 border-b border-slate-100">
          <div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center flex-shrink-0"><Calculator size={20} /></div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Metal Weight &amp; Cost Calculator</h1>
            <p className="text-sm text-slate-500">Calculate metal weight and material cost quickly and accurately.</p>
          </div>
        </div>}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-5">
          {/* ---------------- left column ---------------- */}
          <div className="space-y-5 min-w-0">
            <section className="rounded-xl border border-orange-100 bg-orange-50/40 p-4">
              <div className="flex items-center justify-between mb-3 gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800"><Layers size={15} className="text-violet-600" /> Select Metal Profile</h2>
                <span className="text-[11px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-0.5">{profile.chip}</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2">
                {PROFILES.map(p => {
                  const active = p.id === profileId;
                  return (
                    <button
                      key={p.id} type="button" aria-pressed={active} onClick={() => setProfileId(p.id)}
                      className={`flex flex-col items-center justify-center gap-1.5 h-[58px] rounded-lg border text-[11px] font-semibold px-1 text-center leading-tight transition-all ${
                        active ? 'bg-brand-600 border-brand-600 text-white shadow-md shadow-brand-600/25' : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300 hover:text-brand-700'}`}
                    >
                      <ProfileGlyph id={p.id} size={22} />
                      <span>{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-3"><PencilRuler size={15} className="text-orange-600" /> Parameters &amp; Material</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <label className={`${labelCls} uppercase tracking-wide`}>Material presets</label>
                  <MaterialSelect value={materialId} onChange={pickMaterial} density={density} asOf={newestQuote(rates)} issue={ratesIssue}
                    badge={id => { const m = LIVE_METAL_OF[id]; const r = m ? rates[m] : undefined; return r && !isStale(r) ? { v: r.inrPerKg } : null; }} />
                </div>
                <div>
                  <label className={`${labelCls} uppercase tracking-wide`}>Density (g/cm³)</label>
                  <div className={fieldBox(!!errorOf.density)}>
                    <input className={inputCls} inputMode="decimal" aria-label="Density" aria-invalid={!!errorOf.density} value={density} onChange={e => onDensity(e.target.value)} />
                    <span className="h-10 px-3 flex items-center text-xs text-slate-400 select-none">g/cm³</span>
                  </div>
                  {errorOf.density && <p className="text-[11px] text-red-600 mt-1">{errorOf.density}</p>}
                </div>
              </div>

              <div className="flex items-center justify-between mt-5 mb-2 pb-2 border-b border-slate-100">
                <h3 className={sectionTitle}>Enter profile dimensions</h3>
                <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[10px] font-bold" role="group" aria-label="Units">
                  {(['mm', 'in'] as const).map(u => (
                    <button key={u} type="button" aria-pressed={unitMode === u} onClick={() => switchUnits(u)}
                      className={`px-2.5 py-1 uppercase ${unitMode === u ? 'bg-orange-50 text-orange-600' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>{u}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                {profile.fields.map(f => (
                  <DimField key={f.key} label={f.label} v={dims[f.key]} error={errorOf[f.key]}
                    onValue={s => setField(f.key, { value: s })} onUnit={u => setField(f.key, { unit: u })} />
                ))}
                <DimField label={profile.lengthLabel} v={dims[LENGTH_KEY]} error={errorOf[LENGTH_KEY]}
                  onValue={s => setField(LENGTH_KEY, { value: s })} onUnit={u => setField(LENGTH_KEY, { unit: u })} />
              </div>
              {generalIssues.map(i => <p key={i.message} className="text-xs text-red-600 mt-3">{i.message}</p>)}

              <h3 className={`${sectionTitle} mt-5 mb-2 pt-4 border-t border-slate-100`}>Costing &amp; quantity</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <label className={labelCls}>Your / dealer price per unit weight (optional)</label>
                  <div className={fieldBox(!!errorOf.price)}>
                    <span className="h-10 w-9 flex items-center justify-center text-sm text-slate-500 border-r border-slate-200 select-none">₹</span>
                    <input className={inputCls} inputMode="decimal" placeholder="0.00" aria-label="Price per unit weight" aria-invalid={!!errorOf.price}
                      value={price} onChange={e => { setPrice(numeric(e.target.value)); setPriceFromLive(false); }} />
                    <select className={unitSelectCls} aria-label="Price unit" value={priceUnit} onChange={e => setPriceUnit(e.target.value as PriceUnit)}>
                      {PRICE_UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                    </select>
                  </div>
                  {errorOf.price && <p className="text-[11px] text-red-600 mt-1">{errorOf.price}</p>}
                  <RateNote materialId={materialId} liveMetal={liveMetal} rate={liveRate} fresh={liveFresh} state={ratesState} unit={priceUnit}
                    applied={priceFromLive} onUse={() => { if (liveValue !== null) { setPrice(liveValue); setPriceFromLive(true); } }} />
                </div>
                <div>
                  <label className={labelCls}>Quantity (Pcs)</label>
                  <div className={fieldBox(!!errorOf.qty)}>
                    <input className={inputCls} inputMode="numeric" aria-label="Quantity" aria-invalid={!!errorOf.qty} value={qty}
                      onChange={e => setQty(e.target.value.replace(/[^0-9]/g, ''))} />
                  </div>
                  {errorOf.qty && <p className="text-[11px] text-red-600 mt-1">{errorOf.qty}</p>}
                </div>
              </div>

              <MarketPanel issue={ratesIssue} rates={rates} state={ratesState} selected={liveMetal} price={price} unit={priceUnit} fromLive={priceFromLive} />

              <div className={`flex ${embedded ? 'justify-between gap-3' : 'justify-end'} mt-5 pt-4 border-t border-slate-100`}>
                {embedded && (
                  <button type="button" data-testid="add-to-bom" disabled={!ok} onClick={() => {
                    if (!ok) return;
                    const dimTxt = [...profile.fields.map(f => ({ short: f.short, v: dims[f.key] })), { short: 'L', v: dims[LENGTH_KEY] }]
                      .filter(x => x.v && x.v.value.trim()).map(x => `${x.short} ${x.v.value.trim()}${x.v.unit}`).join(' × ');
                    const mat = MATERIALS.find(m => m.id === materialId)?.name ?? `density ${density}`;
                    const n = Number(price.replace(/,/g, ''));
                    const perKg = ok.cost ? ok.cost.perKgRate : (Number.isFinite(n) && n > 0 ? null : null);
                    embedded.onAdd({ description: `${profile.name} ${dimTxt} · ${mat}${ok.qty > 1 ? ` × ${ok.qty} pcs` : ''}`, weightKg: Math.round(ok.weightKgTotal * 10000) / 10000, ratePerKg: perKg });
                  }}
                    className="flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-lg bg-orange-600 text-white text-sm font-bold hover:bg-orange-700 disabled:opacity-40">
                    + Add Metal Item to Product BOM
                  </button>
                )}
                <button type="button" onClick={clearAll}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <RotateCcw size={14} /> Clear
                </button>
              </div>
            </section>
          </div>

          {/* ---------------- right column ---------------- */}
          <div className="space-y-5 min-w-0">
            <section className="rounded-xl border border-slate-200 p-4">
              <h2 className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2"><Shapes size={14} /> Component preview</h2>
              <div className="flex items-center justify-center min-h-[210px]"><ProfilePreview profile={profile} dims={dims} /></div>
            </section>

            <section className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-white p-4">
              <h2 className="flex items-center gap-2 text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-3"><BarChart3 size={14} className="text-emerald-600" /> Calculation summary</h2>

              <div className="rounded-lg border border-slate-100 bg-white/80 text-center py-4 px-3">
                <p className="text-xs font-semibold text-slate-600">Approximate Weight (Total)</p>
                {ok ? (
                  <p className="mt-1 font-mono text-4xl font-bold text-slate-900" data-testid="total-weight">
                    {kg(ok.weightKgTotal)} <span className="text-base font-semibold text-orange-600">kg</span>
                  </p>
                ) : (
                  <p className="mt-1 font-mono text-4xl font-bold text-slate-300">—</p>
                )}
                {ok && ok.qty > 1 && <p className="text-xs text-slate-500 mt-1">{kg(ok.weightKgPiece)} kg per piece × {fmt(ok.qty, 0)} pcs</p>}
                {outcome.status === 'incomplete' && <p className="text-xs text-slate-500 mt-2">Enter {outcome.missing.join(', ')} to see the weight.</p>}
                {outcome.status === 'error' && (
                  <ul className="text-xs text-red-600 mt-2 space-y-0.5">{outcome.issues.map(i => <li key={i.message}>{i.message}</li>)}</ul>
                )}
                <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-100 text-xs text-slate-600">
                  <span data-testid="w-lbs">{ok ? `${fmt(ok.weightLbs, 2)} lbs` : '— lbs'}</span>
                  <span data-testid="w-g">{ok ? `${grams(ok.weightG)} g` : '— g'}</span>
                  <span data-testid="w-t">{ok ? `${fmt(ok.weightTonnes, 4)} tonnes` : '— tonnes'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="rounded-lg border border-slate-100 bg-white/80 p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Volume{ok && ok.qty > 1 ? ' (total)' : ''}</p>
                  <p className="font-mono text-sm font-semibold text-slate-800 mt-1" data-testid="volume">{ok ? `${fmt(ok.volumeCm3Total, 2)} cm³` : '—'}</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white/80 p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Density</p>
                  <p className="font-mono text-sm font-semibold text-slate-800 mt-1">{ok ? `${ok.density} g/cm³` : '—'}</p>
                </div>
              </div>

              {ok?.cost && (
                <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 mt-3" data-testid="cost-block">
                  <p className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">Material cost</p>
                  <p className="font-mono text-2xl font-bold text-slate-900 mt-1" data-testid="cost-total">{formatINR(ok.cost.total)}</p>
                  <p className="text-xs text-slate-600 mt-1">
                    {ok.qty > 1 && <span data-testid="cost-piece">{formatINR(ok.cost.piece)} per piece · </span>}
                    {formatINR(ok.cost.perKgRate)} / kg
                  </p>
                </div>
              )}

              <p className="flex gap-1.5 text-[11px] text-slate-500 mt-3">
                <Info size={13} className="flex-shrink-0 mt-px" />
                Theoretical weight from the cross-section area. Corner radii, mill fillets and rolling tolerances are not included, so a rolled section can weigh slightly more.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

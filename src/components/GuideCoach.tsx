import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Compass, Database, HelpCircle, Languages, Volume2, VolumeX, X } from 'lucide-react';
import { GUIDES } from '@/lib/guides';
import { dialogTitle, findTarget, guidesFor, pick, stepSpeech, topDialog, type Guide, type GuideLang, type GuideStep } from '@/lib/guides/engine';
import { say, stopSpeaking } from '@/components/HelpAssistant';

// Walkthrough coach: shows what to enter in each field, why, and where it is saved, with a spotlight on the field, a pointer,
// spoken narration (the Help voice) and, after the real Save, a glowing dot that flies to the menu / tab holding the record.
// Start it from the Help area ("Guide me"), by saying "guide me", or let Auto-guide start it when a guided form opens.

const ls = {
  get: (k: string, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const readLang = (): GuideLang => { const v = ls.get('help.vlang', 'ta'); return v === 'en' || v === 'tanglish' ? v : 'ta'; };

type Rect = { x: number; y: number; w: number; h: number };
const rectOf = (el: Element | null): Rect | null => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width || r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };
const same = (a: Rect | null, b: Rect | null) => (!a && !b) || (!!a && !!b && Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6 && Math.abs(a.w - b.w) < 0.6 && Math.abs(a.h - b.h) < 0.6);

const CSS = `
@keyframes guidePulse{0%{box-shadow:0 0 0 0 rgba(249,115,22,.75)}70%{box-shadow:0 0 0 14px rgba(249,115,22,0)}100%{box-shadow:0 0 0 0 rgba(249,115,22,0)}}
@keyframes guideBob{0%,100%{transform:translateY(0)}50%{transform:translateY(7px)}}
@keyframes guideBobUp{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes guideIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
@keyframes guideRing{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.4);opacity:0}}
@keyframes guidePop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}
`;

export function GuideCoach() {
  const location = useLocation();
  const [dialog, setDialog] = useState('');
  const [active, setActive] = useState<{ guide: Guide; i: number } | null>(null);
  const [picker, setPicker] = useState<Guide[] | null>(null);
  const [offer, setOffer] = useState<Guide | null>(null);
  const [lang, setLang] = useState<GuideLang>(readLang);
  const [voice, setVoice] = useState(() => ls.get('argus.guide.voice', '1') === '1');
  const [auto, setAuto] = useState(() => ls.get('argus.guide.auto', '0') === '1');
  const [rect, setRect] = useState<Rect | null>(null);
  const [toast, setToast] = useState('');
  const [flight, setFlight] = useState<{ key: number; from: { x: number; y: number }; to: Rect | null; caption: string; arrived: boolean } | null>(null);
  const targetEl = useRef<HTMLElement | null>(null);
  const autoShown = useRef('');
  const flightDot = useRef<HTMLDivElement>(null);

  const path = location.pathname;
  const offers = useMemo(() => guidesFor(GUIDES, path, dialog), [path, dialog]);
  const step: GuideStep | null = active ? active.guide.steps[active.i] ?? null : null;

  // Which pop-up is open: watch the page, cheaply.
  useEffect(() => {
    let t = 0;
    const read = () => setDialog(dialogTitle(topDialog()));
    const mo = new MutationObserver(() => { window.clearTimeout(t); t = window.setTimeout(read, 220); });
    mo.observe(document.body, { childList: true, subtree: true });
    read();
    return () => { mo.disconnect(); window.clearTimeout(t); };
  }, [path]);

  const close = useCallback(() => { stopSpeaking(); setActive(null); setPicker(null); setFlight(null); setRect(null); targetEl.current = null; }, []);
  const start = useCallback((g: Guide) => {
    window.dispatchEvent(new Event('argus:voice-pause'));
    setOffer(null); setPicker(null); setFlight(null); setActive({ guide: g, i: 0 });
  }, []);

  // "Guide me" from the Help area / voice
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      const g = id ? GUIDES.find(x => x.id === id) : undefined;
      if (g) { start(g); return; }
      if (offers.length === 1) start(offers[0]);
      else if (offers.length > 1) setPicker(offers);
      else { setToast(lang === 'ta' ? 'இந்தத் திரைக்கு இன்னும் வழிகாட்டி இல்லை. கேள்வி கேளுங்கள்.' : 'There is no walkthrough for this screen yet. Ask Help a question instead.'); window.setTimeout(() => setToast(''), 4000); }
    };
    window.addEventListener('argus:guide', on);
    return () => window.removeEventListener('argus:guide', on);
  }, [offers, start, lang]);

  // A guided form opened: offer a walkthrough once, or start it straight away when Auto-guide is on.
  useEffect(() => {
    if (active) return;
    const g = offers[0];
    if (!g) { autoShown.current = ''; setOffer(null); return; }
    if (autoShown.current === g.id) return;
    autoShown.current = g.id;
    if (auto) { start(g); return; }
    let seen: string[] = []; try { seen = JSON.parse(ls.get('argus.guide.seen', '[]')); } catch { /* none */ }
    if (seen.includes(g.id)) return;
    ls.set('argus.guide.seen', JSON.stringify([...seen, g.id]));
    setOffer(g);
    const t = window.setTimeout(() => setOffer(o => (o?.id === g.id ? null : o)), 10000);
    return () => window.clearTimeout(t);
  }, [offers, active, auto, start]);

  // Entering a step: open what it needs, find the field, scroll to it, read it out.
  useEffect(() => {
    if (!active || !step) return;
    let off = false;
    stopSpeaking();
    const go = async () => {
      if (step.open) {
        const b = findTarget({ button: step.open });
        if (b && !findTarget(step.target)) { b.click(); await new Promise(r => window.setTimeout(r, 450)); }
      }
      if (off) return;
      const el = findTarget(step.target);
      targetEl.current = el;
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (voice) say(stepSpeech(step, lang), () => {}, undefined);
    };
    void go();
    return () => { off = true; stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.guide.id, active?.i, lang, voice]);

  // Keep the spotlight on the field while the page moves (scroll, a pop-up being dragged, a field appearing).
  useEffect(() => {
    if (!active || !step) return;
    let raf = 0; let n = 0;
    const tick = () => {
      if (n++ % 15 === 0 || !targetEl.current || !targetEl.current.isConnected) targetEl.current = findTarget(step.target);
      const r = rectOf(targetEl.current);
      setRect(prev => (same(prev, r) ? prev : r));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active?.guide.id, active?.i]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    setFlight(null);
    setActive(a => (a && a.i < a.guide.steps.length - 1 ? { ...a, i: a.i + 1 } : null));
  }, []);
  const back = () => { setFlight(null); setActive(a => (a && a.i > 0 ? { ...a, i: a.i - 1 } : a)); };

  // The step waits for the real Save: then the dot flies to where the record now lives.
  useEffect(() => {
    if (!active || !step?.onSave) return;
    const want = step.onSave.button.trim().toLowerCase();
    const hadDialog = !!topDialog();
    const onClick = (e: MouseEvent) => {
      const b = (e.target as HTMLElement | null)?.closest('button');
      if (!b || !(b.textContent ?? '').trim().toLowerCase().includes(want)) return;
      const from = rectOf(b); if (!from) return;
      window.setTimeout(() => {
        const stillOpen = hadDialog && !!topDialog() && dialogTitle(topDialog()) === dialog;
        if (stillOpen) return;   // the form refused (a field is missing): stay on this step
        if (step.onSave!.okText && !document.body.innerText.toLowerCase().includes(step.onSave!.okText.toLowerCase())) return;   // a form on the page: wait for its "saved" message
        const dest = findTarget({ button: step.onSave!.flyTo }) ?? findTarget({ text: step.onSave!.flyTo });
        const caption = pick(step.onSave!.caption, lang);
        setFlight({ key: Date.now(), from: { x: from.x + from.w / 2, y: from.y + from.h / 2 }, to: rectOf(dest), caption, arrived: false });
        if (voice) say(caption, () => {}, undefined);
      }, 1000);
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [active, step, lang, voice, dialog]);

  // Run the flight, then carry on to the next step.
  useEffect(() => {
    if (!flight) return;
    const dot = flightDot.current;
    const to = flight.to ? { x: flight.to.x + flight.to.w / 2, y: flight.to.y + flight.to.h / 2 } : { x: flight.from.x, y: flight.from.y - 160 };
    const mid = { x: (flight.from.x + to.x) / 2, y: Math.min(flight.from.y, to.y) - 140 };
    const frames = [
      { transform: `translate(${flight.from.x}px,${flight.from.y}px) scale(1)`, opacity: 1 },
      { transform: `translate(${mid.x}px,${mid.y}px) scale(1.5)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${to.x}px,${to.y}px) scale(.7)`, opacity: 1 },
    ];
    const anims: Animation[] = [];
    const ghosts = document.querySelectorAll<HTMLElement>('[data-guide-ghost]');
    ghosts.forEach((g, i) => anims.push(g.animate(frames.map(f => ({ ...f, opacity: 0.55 - i * 0.08 })), { duration: 1100, delay: (i + 1) * 55, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' })));
    const main = dot?.animate(frames, { duration: 1100, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    const t1 = window.setTimeout(() => setFlight(f => (f && f.key === flight.key ? { ...f, arrived: true } : f)), 1100);
    const t2 = window.setTimeout(() => next(), 4200);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); main?.cancel(); anims.forEach(a => a.cancel()); };
  }, [flight?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape ends the walkthrough (and is not also treated as "go back a page").
  useEffect(() => {
    if (!active && !picker) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [active, picker, close]);

  useEffect(() => () => stopSpeaking(), []);
  const toggleLang = () => { const n: GuideLang = lang === 'ta' ? 'en' : 'ta'; setLang(n); ls.set('help.vlang', n); };
  const toggleVoice = () => { const n = !voice; setVoice(n); ls.set('argus.guide.voice', n ? '1' : '0'); if (!n) stopSpeaking(); };
  const toggleAuto = () => { const n = !auto; setAuto(n); ls.set('argus.guide.auto', n ? '1' : '0'); };

  const ta = lang === 'ta';
  const L = (en: string, tm: string) => (ta ? tm : en);
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardTop = rect ? rect.y + rect.h / 2 > vh * 0.5 : false;   // target in the lower half: card goes to the top
  const arrowAbove = !!rect && rect.y > 150;

  const ui = (
    <>
      <style>{CSS}</style>

      {toast && <div role="status" className="fixed bottom-24 right-5 z-[95] max-w-xs rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow-xl" style={{ animation: 'guideIn .25s ease-out' }}>{toast}</div>}

      {offer && !active && (
        <div className="fixed bottom-24 right-5 z-[95] w-72 rounded-2xl border border-orange-200 bg-white p-3.5 shadow-2xl" style={{ animation: 'guideIn .3s ease-out' }}>
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Compass size={17} /></span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800">{pick(offer.title, lang)}</p>
              <p className="mt-0.5 text-xs text-slate-500">{L('Want me to walk you through it? I will tell you what to enter, why, and where it is saved.', 'நான் வழிகாட்டவா? என்ன எழுதுவது, ஏன், எங்கே சேமிக்கப்படும் என்று சொல்கிறேன்.')}</p>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100" onClick={() => setOffer(null)}>{L('Not now', 'பிறகு')}</button>
            <button className="rounded-lg bg-orange-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-orange-700" onClick={() => start(offer)}>{L('Guide me', 'வழிகாட்டு')}</button>
          </div>
        </div>
      )}

      {picker && !active && (
        <div className="fixed inset-0 z-[94] flex items-end justify-end p-5 pb-24">
          <div className="w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl" style={{ animation: 'guideIn .25s ease-out' }}>
            <div className="mb-2 flex items-center justify-between"><p className="text-sm font-bold text-slate-800">{L('Which walkthrough?', 'எந்த வழிகாட்டி?')}</p><button aria-label="Close" onClick={close} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={15} /></button></div>
            {picker.map(g => (
              <button key={g.id} onClick={() => start(g)} className="mb-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-orange-300 hover:bg-orange-50">
                <p className="text-sm font-semibold text-slate-800">{pick(g.title, lang)}</p>
                {g.blurb && <p className="text-xs text-slate-500">{pick(g.blurb, lang)}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {active && step && (
        <>
          {/* The dim (a huge static shadow) and the pulsing ring are separate layers: the ring's animation would otherwise replace the dim. */}
          {rect && !flight && (
            <div aria-hidden className="pointer-events-none fixed z-[90]" style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12, borderRadius: 12, boxShadow: '0 0 0 9999px rgba(15,23,42,.5)', transition: 'all .25s ease' }}>
              <div className="absolute inset-0" style={{ borderRadius: 12, outline: '3px solid #f97316', animation: 'guidePulse 1.6s infinite' }} />
            </div>
          )}
          {rect && !flight && (
            <div aria-hidden className="pointer-events-none fixed z-[91]" style={{ left: rect.x + rect.w / 2 - 14, top: arrowAbove ? rect.y - 46 : rect.y + rect.h + 10, animation: `${arrowAbove ? 'guideBob' : 'guideBobUp'} .9s ease-in-out infinite` }}>
              <svg width="28" height="34" viewBox="0 0 28 34" fill="#f97316" style={{ transform: arrowAbove ? 'none' : 'rotate(180deg)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' }}><path d="M14 34 2 16h8V0h8v16h8z" /></svg>
            </div>
          )}

          {flight && (
            <>
              {[0, 1, 2, 3, 4].map(i => <div key={i} data-guide-ghost aria-hidden className="pointer-events-none fixed left-0 top-0 z-[92] -ml-2 -mt-2 h-4 w-4 rounded-full bg-orange-400" style={{ opacity: 0 }} />)}
              <div ref={flightDot} aria-hidden className="pointer-events-none fixed left-0 top-0 z-[93] -ml-3 -mt-3 h-6 w-6 rounded-full bg-gradient-to-br from-amber-300 to-orange-600" style={{ boxShadow: '0 0 18px 6px rgba(249,115,22,.7)' }} />
              {flight.arrived && flight.to && (
                <>
                  <div aria-hidden className="pointer-events-none fixed z-[92] rounded-full border-4 border-orange-500" style={{ left: flight.to.x + flight.to.w / 2 - 22, top: flight.to.y + flight.to.h / 2 - 22, width: 44, height: 44, animation: 'guideRing 1.1s ease-out infinite' }} />
                  <div className="pointer-events-none fixed z-[93] flex max-w-[16rem] items-start gap-2 rounded-xl bg-orange-600 px-3 py-2 text-xs font-semibold text-white shadow-2xl"
                    style={{ left: Math.min(Math.max(8, flight.to.x + flight.to.w / 2 - 128), window.innerWidth - 264), top: flight.to.y + flight.to.h + 18, animation: 'guidePop .35s ease-out' }}>
                    <Database size={14} className="mt-0.5 shrink-0" />{flight.caption}
                  </div>
                </>
              )}
            </>
          )}

          <div role="region" aria-label="Walkthrough" className={`fixed right-5 z-[95] w-[22rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-slate-200 bg-white shadow-2xl ${cardTop ? 'top-20' : 'bottom-24'}`} style={{ animation: 'guideIn .3s ease-out' }}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Compass size={15} /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-500">{pick(active.guide.title, lang)}</p>
                <p className="text-[10px] text-slate-400">{L('Step', 'படி')} {active.i + 1} / {active.guide.steps.length}</p></div>
              <button type="button" aria-label={voice ? 'Mute narration' : 'Read aloud'} title={voice ? 'Mute' : 'Read aloud'} onClick={toggleVoice} className="rounded p-1.5 text-slate-400 hover:bg-slate-100">{voice ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
              <button type="button" aria-label="Language" title="தமிழ் / English" onClick={toggleLang} className="flex items-center gap-1 rounded p-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-100"><Languages size={14} />{ta ? 'EN' : 'தமிழ்'}</button>
              <button type="button" aria-label="Close walkthrough" onClick={close} className="rounded p-1.5 text-slate-400 hover:bg-slate-100"><X size={15} /></button>
            </div>
            <div className="max-h-[46vh] space-y-2.5 overflow-y-auto px-3.5 py-3">
              <p className="text-[15px] font-bold leading-snug text-slate-900">{pick(step.title, lang)}</p>
              <p className="text-[13px] leading-relaxed text-slate-700">{pick(step.say, lang)}</p>
              {step.why && <div className="rounded-lg bg-sky-50 px-2.5 py-2 text-xs text-sky-900"><span className="mr-1 inline-flex items-center gap-1 font-bold"><HelpCircle size={12} />{L('Why', 'ஏன்')}:</span>{pick(step.why, lang)}</div>}
              {step.saves && <div className="rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-900"><span className="mr-1 inline-flex items-center gap-1 font-bold"><Database size={12} />{L('Saved in', 'சேமிக்கப்படும் இடம்')}:</span>{pick(step.saves, lang)}</div>}
              {step.onSave && !flight && <p className="text-xs font-semibold text-orange-600">{L(`Now click “${step.onSave.button}”. I will show you where it goes.`, `இப்போது “${step.onSave.button}” அழுத்துங்கள். எங்கே போகிறது என்று காட்டுகிறேன்.`)}</p>}
              {step.target && !rect && !flight && <p className="text-[11px] text-slate-400">{L('That field is not on screen yet. Open the form first, then press Next.', 'அந்தப் புலம் இன்னும் திரையில் இல்லை. முதலில் படிவத்தைத் திறந்து, பிறகு Next அழுத்துங்கள்.')}</p>}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-500"><input type="checkbox" checked={auto} onChange={toggleAuto} />{L('Auto-guide', 'தானாக வழிகாட்டு')}</label>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={back} disabled={active.i === 0} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ArrowLeft size={13} />{L('Back', 'பின்')}</button>
                <button type="button" onClick={active.i === active.guide.steps.length - 1 ? close : next} className="inline-flex h-8 items-center gap-1 rounded-lg bg-orange-600 px-3.5 text-xs font-bold text-white hover:bg-orange-700">{active.i === active.guide.steps.length - 1 ? L('Done', 'முடிந்தது') : L('Next', 'அடுத்து')}{active.i < active.guide.steps.length - 1 && <ArrowRight size={13} />}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
  return typeof document === 'undefined' ? null : createPortal(ui, document.body);
}

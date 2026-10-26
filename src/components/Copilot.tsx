import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, CheckCircle2, Languages, Loader2, Mic, MicOff, Send, Volume2, VolumeX, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getBreadcrumbs } from '@/config/navigation';
import { say, stopSpeaking, offlineAnswer } from '@/components/HelpAssistant';
import { findRecords, previewAction, runAction, type ActionCtx, type Preview } from '@/lib/copilot/actions';
import {
  ACTION_INTENTS, FIELD_QUESTION, missingOf, resolvePage, understandLocal,
  type Intent, type Params, type Pending, type Understood,
} from '@/lib/copilot/understand';

// Copilot: say or type what you want ("add enquiry for ABC, flicker tool x 10") and it does it, after a confirm card.
// It also answers "how do I ..." questions (Teaching) and starts the step-by-step walkthrough (Guiding).

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/help-assistant`;
type Lang = 'ta' | 'tanglish' | 'en';
const ls = {
  get: (k: string, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const readLang = (): Lang => { const v = ls.get('help.vlang', 'ta'); return v === 'en' || v === 'tanglish' ? v : 'ta'; };

interface Msg { id: number; role: 'user' | 'ai'; text: string; rows?: string[]; go?: { path: string; label: string }; error?: boolean }
interface Awaiting { intent: Intent; params: Params; preview: Preview }
let seq = 0;

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ''}`, apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''), 'content-type': 'application/json' };
}

/** The AI service understands free language; returns null when it cannot be reached so the local rules take over. */
async function understandRemote(message: string, lang: Lang, page: string, pending: Pending | null, history: Msg[]): Promise<Understood | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST', headers: await authHeaders(),
      body: JSON.stringify({
        copilot: {
          message, lang, page, pending, today: new Date().toISOString().slice(0, 10),
          history: history.slice(-6).map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', text: m.text })),
        },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const intent = String(j.intent ?? 'unknown') as Intent;
    const params = (j.params && typeof j.params === 'object' ? j.params : {}) as Params;
    return { intent, params, missing: missingOf(intent, params), reply: String(j.reply ?? '') };
  } catch { return null; }
}

/** A "how do I ..." question: the help service, or the written notes when it is not reachable. */
async function askHelp(question: string, page: string, pageTitle: string, lang: Lang): Promise<string> {
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ question, page, pageTitle, lang, history: [] }) });
    if (res.ok && res.body) {
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let text = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const p of parts) { const line = p.replace(/^data:\s*/, ''); try { const o = JSON.parse(line); if (o.t) text += o.t; } catch { /* partial */ } }
      }
      if (text.trim()) return text.trim();
    }
  } catch { /* use the notes */ }
  return offlineAnswer(question, page, lang);
}

const YES = /^(yes|y|ok|okay|confirm|sure|go ahead|do it|aamam|aama|seri|sari|சரி|ஆம்|ஆமாம்)\b/i;
const NO = /^(no|n|cancel|stop|don'?t|venam|vendam|illa|இல்லை|வேண்டாம்)\b/i;

export function Copilot() {
  const navigate = useNavigate();
  const location = useLocation();
  const { company, canDo } = useAuth();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Lang>(readLang);
  const [speak, setSpeak] = useState(() => ls.get('argus.copilot.speak', '1') === '1');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const recRef = useRef<any>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const ta = lang === 'ta';
  const L = (en: string, tm: string) => (ta ? tm : en);

  const page = location.pathname;
  const pageTitle = useMemo(() => { try { const b = getBreadcrumbs(page.replace(/^\//, '')); return b[b.length - 1]?.label ?? ''; } catch { return ''; } }, [page]);
  const ctx: ActionCtx = useMemo(() => ({ companyId: company?.id ?? null, canDo: canDo as ActionCtx['canDo'] }), [company?.id, canDo]);

  useEffect(() => {
    const on = (e: Event) => { const want = (e as CustomEvent<{ on?: boolean }>).detail?.on; setOpen((o) => (typeof want === 'boolean' ? want : !o)); };
    window.addEventListener('argus:copilot', on);
    return () => window.removeEventListener('argus:copilot', on);
  }, []);
  useEffect(() => { window.dispatchEvent(new CustomEvent('argus:mode', { detail: { mode: 'coworker', on: open } })); }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, awaiting, busy]);
  useEffect(() => { if (!open) { stopSpeaking(); try { recRef.current?.abort?.(); } catch { /* ignore */ } setListening(false); } }, [open]);
  useEffect(() => () => { stopSpeaking(); try { recRef.current?.abort?.(); } catch { /* ignore */ } }, []);

  const add = useCallback((m: Omit<Msg, 'id'>, speakIt = true) => {
    setMsgs((x) => [...x, { ...m, id: ++seq }]);
    if (speakIt && speak && m.role === 'ai' && m.text) say(m.text, () => {}, undefined);
  }, [speak]);

  const askFor = (u: Understood) => {
    const field = u.missing[0];
    const q = FIELD_QUESTION[field];
    return u.reply || (q ? L(q[0], q[1]) : L('Tell me a little more.', 'இன்னும் கொஞ்சம் சொல்லுங்கள்.'));
  };

  const confirm = useCallback(async () => {
    if (!awaiting) return;
    const a = awaiting; setAwaiting(null); setBusy(true);
    const r = await runAction(a.intent, a.params, ctx);
    setBusy(false);
    add({ role: 'ai', text: r.ok ? `✓ ${r.message}` : `${L('Not saved: ', 'சேமிக்கவில்லை: ')}${r.message}`, go: r.ok ? r.where : undefined, error: !r.ok });
    window.dispatchEvent(new Event('argus:data-changed'));
  }, [awaiting, ctx, add]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = useCallback(() => { setAwaiting(null); setPending(null); add({ role: 'ai', text: L('Cancelled. Nothing was saved.', 'ரத்து செய்யப்பட்டது. எதுவும் சேமிக்கப்படவில்லை.') }); }, [add]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');
    add({ role: 'user', text }, false);
    if (awaiting && YES.test(text)) { await confirm(); return; }
    if (awaiting && NO.test(text)) { cancel(); return; }
    if (awaiting) setAwaiting(null);   // a new instruction replaces the card that was waiting
    setBusy(true);
    try {
      let u: Understood | null = await understandRemote(text, lang, page, pending, msgs);
      if (!u) u = understandLocal(text, pending);
      // Anything the AI left unfilled is asked for.
      u.missing = missingOf(u.intent, u.params);

      if (u.intent === 'guide') { setPending(null); window.dispatchEvent(new CustomEvent('argus:guide')); add({ role: 'ai', text: L('Starting the walkthrough for this screen.', 'இந்தத் திரைக்கான வழிகாட்டியைத் தொடங்குகிறேன்.') }); return; }
      if (u.intent === 'help') { setPending(null); add({ role: 'ai', text: await askHelp(String(u.params.question ?? text), page, pageTitle, lang) }); return; }
      if (u.intent === 'unknown') {
        setPending(null);
        add({ role: 'ai', text: u.reply || L('I can add a company, an enquiry or a sales order, open a page, find records, answer “how do I…” questions, or guide you step by step. Try: “add enquiry for ABC Industries, flicker tool x 10”.', 'நான் company, enquiry, sales order சேர்க்கவும், பக்கத்தைத் திறக்கவும், பதிவுகளைத் தேடவும், “எப்படி…” கேள்விகளுக்குப் பதில் சொல்லவும், படிப்படியாக வழிகாட்டவும் முடியும். எ.கா: “add enquiry for ABC Industries, flicker tool x 10”.') });
        return;
      }
      if (u.intent === 'open_page') {
        const hit = resolvePage(String(u.params.page || u.params.label || ''));
        if (!hit) { add({ role: 'ai', text: L('Which page? For example: invoices, inventory, bank entry, opening balances.', 'எந்தப் பக்கம்? எ.கா: invoices, inventory, bank entry, opening balances.') }); setPending({ intent: 'open_page', params: {} }); return; }
        setPending(null); navigate(`/${hit.page}`); add({ role: 'ai', text: L(`Opening ${hit.label}.`, `${hit.label} பக்கத்தைத் திறக்கிறேன்.`) });
        return;
      }
      if (u.intent === 'find_records') {
        if (u.missing.length) { setPending({ intent: u.intent, params: u.params }); add({ role: 'ai', text: askFor(u) }); return; }
        setPending(null);
        const r = await findRecords(String(u.params.kind), String(u.params.query ?? ''), ctx);
        add({ role: 'ai', text: r.title, rows: r.rows });
        return;
      }
      if (ACTION_INTENTS.includes(u.intent)) {
        if (u.missing.length) { setPending({ intent: u.intent, params: u.params }); add({ role: 'ai', text: askFor(u) }); return; }
        setPending(null);
        const pv = await previewAction(u.intent, u.params, ctx);
        if (pv.blocked) { add({ role: 'ai', text: pv.blocked, error: true }); return; }
        setAwaiting({ intent: u.intent, params: u.params, preview: pv });
        add({ role: 'ai', text: L('Please check this and confirm.', 'இதைச் சரிபார்த்து உறுதிப்படுத்துங்கள்.') });
      }
    } catch (e) {
      add({ role: 'ai', text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }, [busy, awaiting, pending, msgs, lang, page, pageTitle, ctx, add, confirm, cancel, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMic = () => {
    if (listening) { try { recRef.current?.stop?.(); } catch { /* ignore */ } return; }
    if (!SR) { add({ role: 'ai', text: L('This browser has no speech recognition. Please type, or use Chrome / Edge.', 'இந்த browser-ல் பேச்சு அறிதல் இல்லை. தட்டச்சு செய்யுங்கள் அல்லது Chrome / Edge பயன்படுத்துங்கள்.'), error: true }, false); return; }
    stopSpeaking();
    const r = new SR();
    r.lang = ta ? 'ta-IN' : 'en-IN'; r.interimResults = true; r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t; else interim += t; }
      setInput((finalText + interim).trim());
    };
    r.onerror = () => setListening(false);
    r.onend = () => { setListening(false); const t = finalText.trim(); if (t) void submit(t); };
    recRef.current = r; setListening(true);
    try { r.start(); } catch { setListening(false); }
  };

  const toggleLang = () => { const n: Lang = lang === 'ta' ? 'en' : 'ta'; setLang(n); ls.set('help.vlang', n); };
  const toggleSpeak = () => { const n = !speak; setSpeak(n); ls.set('argus.copilot.speak', n ? '1' : '0'); if (!n) stopSpeaking(); };

  if (!open) return null;
  return (
    <div role="dialog" aria-label="Copilot" data-voice-ignore
      className="fixed bottom-[4.5rem] left-[5.5rem] z-[75] flex h-[30rem] max-h-[calc(100vh-6rem)] w-[24rem] max-w-[calc(100vw-1rem)] flex-col rounded-2xl border border-slate-200 bg-white font-sans shadow-2xl max-lg:bottom-[8.5rem] max-lg:left-2">
      <div className="flex items-center gap-2 rounded-t-2xl bg-gradient-to-r from-violet-700 to-indigo-700 px-3.5 py-2.5 text-white">
        <Bot size={18} />
        <div className="min-w-0 flex-1"><p className="text-sm font-bold leading-tight">Copilot</p><p className="truncate text-[10px] text-white/70">{L('Say or type what you want to do', 'என்ன செய்யவேண்டும் என்று சொல்லுங்கள் / தட்டச்சு செய்யுங்கள்')}</p></div>
        <button type="button" aria-label={speak ? 'Mute replies' : 'Speak replies'} title={speak ? 'Mute replies' : 'Speak replies'} onClick={toggleSpeak} className="rounded p-1.5 hover:bg-white/15">{speak ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
        <button type="button" aria-label="Language" title="தமிழ் / English" onClick={toggleLang} className="flex items-center gap-1 rounded p-1.5 text-[11px] font-bold hover:bg-white/15"><Languages size={14} />{ta ? 'EN' : 'தமிழ்'}</button>
        <button type="button" aria-label="Close Copilot" onClick={() => setOpen(false)} className="rounded p-1.5 hover:bg-white/15"><X size={16} /></button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3 text-[13px]">
        {msgs.length === 0 && (
          <div className="rounded-xl bg-slate-50 p-3 text-slate-600">
            <p className="font-semibold text-slate-800">{L('Try saying:', 'இப்படிச் சொல்லுங்கள்:')}</p>
            <ul className="mt-1.5 space-y-1 text-xs">
              {['add enquiry for ABC Industries, flicker tool x 10', 'add company Kumar Industries, gst 33ABCDE1234F1Z5', 'create sales order for ABC Industries, product gear qty 5 price 1200', 'open invoices', 'find orders for ABC', 'how do I make an invoice?'].map((x) => (
                <li key={x}><button type="button" className="text-left text-violet-700 hover:underline" onClick={() => void submit(x)}>“{x}”</button></li>
              ))}
            </ul>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex'}>
            <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${m.role === 'user' ? 'bg-violet-600 text-white' : m.error ? 'bg-red-50 text-red-800' : 'bg-slate-100 text-slate-800'}`}>
              {m.text}
              {m.rows && m.rows.length > 0 && <ul className="mt-1.5 space-y-1 border-t border-slate-200 pt-1.5 text-xs">{m.rows.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              {m.go && <button type="button" onClick={() => navigate(m.go!.path)} className="mt-2 block rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-violet-700 shadow-sm hover:bg-violet-50">{L('Show me', 'காட்டு')}: {m.go.label}</button>}
            </div>
          </div>
        ))}
        {awaiting && (
          <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/60 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">{awaiting.preview.title}</p>
            <ul className="mt-1.5 space-y-0.5 text-[13px] text-slate-800">{awaiting.preview.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            {awaiting.preview.warnings.map((w, i) => <p key={i} className="mt-1.5 text-xs text-amber-700">⚠ {w}</p>)}
            <div className="mt-2.5 flex gap-2">
              <button type="button" onClick={() => void confirm()} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50"><CheckCircle2 size={14} />{L('Confirm', 'உறுதி')}</button>
              <button type="button" onClick={cancel} className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">{L('Cancel', 'ரத்து')}</button>
            </div>
          </div>
        )}
        {busy && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" />{L('Working…', 'செய்கிறேன்…')}</div>}
        <div ref={endRef} />
      </div>

      <form className="flex items-center gap-1.5 border-t border-slate-100 p-2.5" onSubmit={(e) => { e.preventDefault(); void submit(input); }}>
        <button type="button" onClick={toggleMic} aria-label={listening ? 'Stop listening' : 'Speak'} title={listening ? 'Stop' : 'Speak'}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${listening ? 'animate-pulse bg-red-600' : 'bg-violet-600 hover:bg-violet-700'}`}>{listening ? <MicOff size={16} /> : <Mic size={16} />}</button>
        <input aria-label="Message to Copilot" value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? L('Listening…', 'கேட்கிறேன்…') : L('Type a command or question…', 'கட்டளை அல்லது கேள்வியை எழுதுங்கள்…')}
          className="h-9 min-w-0 flex-1 rounded-full border border-slate-200 px-3.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20" />
        <button type="submit" aria-label="Send" disabled={busy || !input.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white disabled:opacity-40"><Send size={15} /></button>
      </form>
    </div>
  );
}

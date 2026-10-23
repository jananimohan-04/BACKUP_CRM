import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CircleHelp, Loader2, Mic, Square, Volume2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getBreadcrumbs } from '@/config/navigation';
import { useDraggable } from '@/lib/useDraggable';
import { rankNotes } from '../../supabase/functions/help-assistant/knowledge';

// "உதவி / Help": a VOICE assistant, no chat window. Press Help and it says "yes, tell me", listens, answers out loud, then
// listens again, until you say "stop" (or press the stop button, or stay quiet). It answers from the written ERP notes
// (help-assistant edge function) in Tamil, English or Tanglish, and starts speaking as soon as the first sentence is ready.

type Lang = 'ta' | 'tanglish' | 'en';
type Phase = 'idle' | 'greeting' | 'listening' | 'thinking' | 'speaking';

const LANGS: { code: Lang; label: string }[] = [{ code: 'ta', label: 'தமிழ்' }, { code: 'tanglish', label: 'Tanglish' }, { code: 'en', label: 'English' }];
const store = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const TAMIL = /[஀-௿]/;
const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/help-assistant`;
const STOP_WORDS = /^(stop|bye|goodbye|that'?s all|enough|exit|close|நிறுத்து|போதும்|நிறுத்தவும்|பை|nirutthu|nirutha|podhum|pothum|bye bye)\b/i;

const GREETING: Record<Lang, string> = { ta: 'ஆம், சொல்லுங்கள்.', tanglish: 'Yes, sollunga.', en: 'Yes, tell me.' };
const GOODBYE: Record<Lang, string> = { ta: 'சரி, தேவைப்படும்போது கூப்பிடுங்கள்.', tanglish: 'Sari, venumbodhu koopidunga.', en: 'Okay, call me when you need me.' };
const NOT_HEARD: Record<Lang, string> = { ta: 'எனக்கு கேட்கவில்லை.', tanglish: 'Enakku kekkala.', en: "I didn't hear anything." };

// ---------------------------------------------------------------- speaking
let voices: SpeechSynthesisVoice[] = [];
const loadVoices = () => { try { voices = window.speechSynthesis.getVoices(); } catch { voices = []; } };
function voiceFor(text: string): SpeechSynthesisVoice | undefined {
  const want = TAMIL.test(text) ? ['ta-IN', 'ta'] : ['en-IN', 'en-GB', 'en'];
  for (const w of want) { const v = voices.find((x) => x.lang === w) ?? voices.find((x) => x.lang.startsWith(w)); if (v) return v; }
  return undefined;
}
// Windows and Chrome usually have NO Tamil voice installed, so Tamil text would be silent. When no Tamil voice exists, the
// Tamil sentences are played from an online voice instead (Google's text-to-speech web address, one small piece at a time).
let onlineAudio: HTMLAudioElement | null = null;
let onlineToken = 0;
function chunksOf(text: string, max = 180): string[] {
  const out: string[] = [];
  let cur = '';
  for (const part of text.split(/(?<=[.!?।,;])\s+|\n+/)) {
    if ((cur + ' ' + part).trim().length > max && cur) { out.push(cur.trim()); cur = part; } else cur = `${cur} ${part}`;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.flatMap((c) => (c.length <= max ? [c] : c.match(new RegExp('.{1,' + max + '}( |$)', 'g')) ?? [c]));
}
function playOnline(text: string, tl: string, onEnd: () => void) {
  const parts = chunksOf(text);
  const token = ++onlineToken;
  const next = (i: number) => {
    if (token !== onlineToken) return;               // stopped or replaced
    if (i >= parts.length) { onEnd(); return; }
    const a = new Audio(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(parts[i].trim())}`);
    onlineAudio = a;
    a.onended = () => next(i + 1);
    a.onerror = () => { if (token === onlineToken) onEnd(); };
    void a.play().catch(() => { if (token === onlineToken) onEnd(); });
  };
  next(0);
}
let announcedOnline = false;
/** Speaks one piece of text; `onEnd` runs when it has finished (or could not be spoken). */
function say(text: string, onEnd: () => void, notify?: (m: string) => void) {
  const t = text.replace(/[*#_`]/g, '').trim();
  if (!t) { onEnd(); return; }
  loadVoices();
  const tamil = TAMIL.test(t);
  const v = voiceFor(t);
  if (tamil && !v && voices.length > 0) {
    if (!announcedOnline) { announcedOnline = true; notify?.('No Tamil voice is installed on this PC, so an online Tamil voice is used.'); }
    playOnline(t, 'ta', onEnd);
    return;
  }
  if (!('speechSynthesis' in window)) { onEnd(); return; }
  const u = new SpeechSynthesisUtterance(t);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = tamil ? 'ta-IN' : 'en-IN';
  u.rate = 1.03;
  u.onend = onEnd;
  u.onerror = onEnd;
  window.speechSynthesis.speak(u);
}
const REFUSAL: Record<Lang, string> = {
  ta: 'இந்த ERP-ஐ எப்படி பயன்படுத்துவது என்பது பற்றிய கேள்விகளுக்கு மட்டுமே என்னால் உதவ முடியும். ERP பற்றி கேளுங்கள்.',
  tanglish: 'Indha ERP-ah eppadi use panradhu pathina kelvigalukku mattum dhaan help panna mudiyum. ERP pathi kelunga.',
  en: 'I can only help with questions about using this ERP. Please ask about the ERP.',
};
/**
 * Used when the help service cannot be reached (not deployed yet / no connection): the best matching written note is read out
 * as it is. It only ever answers from the notes, and refuses anything that matches none of them.
 */
function offlineAnswer(question: string, page: string, lang: Lang): string {
  const generic = /\b(page|screen)\b|இந்த|indha|intha|ithu/i.test(question);
  const ranked = rankNotes(question, page).filter((r) => r.n.id !== 'overview' || r.kw > 0);
  const best = ranked.find((r) => r.kw > 0) ?? (generic ? ranked.find((r) => r.total > 0) : undefined);
  if (!best) return REFUSAL[lang];
  const [en, ta] = best.n.body.split(/\nTA:/);
  const english = en.replace(/^EN:\s*/, '').trim();
  const text = lang === 'ta' && ta ? ta.trim() : english;
  return text.length > 900 ? `${text.slice(0, 900).replace(/\s+\S*$/, '')}.` : text;
}
const stopSpeaking = () => {
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  onlineToken += 1;
  try { onlineAudio?.pause(); } catch { /* ignore */ }
  onlineAudio = null;
};

export function HelpAssistant() {
  const location = useLocation();
  const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [note, setNote] = useState('');
  const [lang, setLang] = useState<Lang>(() => (store.get('help.vlang', 'ta') as Lang));
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useDraggable('argus.help.pos', rootRef);

  const activeRef = useRef(false);          // a help conversation is going on
  const langRef = useRef(lang);
  langRef.current = lang;
  const recRef = useRef<any>(null);
  const history = useRef<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const misses = useRef(0);                  // times in a row nothing was heard
  const pageRef = useRef({ page: '', title: '' });
  const listenRef = useRef<() => void>(() => {});

  const page = location.pathname;
  const pageTitle = (() => { try { const b = getBreadcrumbs(page.replace(/^\//, '')); return b[b.length - 1]?.label ?? ''; } catch { return ''; } })();
  pageRef.current = { page, title: pageTitle };

  useEffect(() => { loadVoices(); try { window.speechSynthesis.onvoiceschanged = loadVoices; } catch { /* no speech */ } }, []);
  useEffect(() => { store.set('help.vlang', lang); }, [lang]);

  const endSession = useCallback((goodbye: boolean) => {
    const wasActive = activeRef.current;
    activeRef.current = false;
    try { recRef.current?.abort?.(); } catch { /* ignore */ }
    recRef.current = null;
    stopSpeaking();
    setHeard('');
    if (goodbye && wasActive) { setPhase('speaking'); say(GOODBYE[langRef.current], () => setPhase('idle')); } else setPhase('idle');
  }, []);

  // ------------------------------------------------ the answer: stream it and speak each sentence as it completes
  const ask = useCallback(async (question: string) => {
    setPhase('thinking');
    setHeard(question);
    let full = '';
    let spokenUpTo = 0;
    let pending = 0;
    let streamDone = false;
    let failed = false;
    const finish = () => { if (activeRef.current && streamDone && pending === 0 && !failed) listenRef.current(); };
    const speakPart = (chunk: string) => {
      if (!chunk.trim() || !activeRef.current) return;
      pending += 1;
      setPhase('speaking');
      say(chunk, () => { pending -= 1; finish(); }, setNote);
    };
    const speakReady = (final: boolean) => {
      const rest = full.slice(spokenUpTo);
      const done = rest.match(/^[\s\S]*?[.!?।\n]+(?=\s|$)/g)?.join('') ?? '';
      const chunk = final ? rest : done;
      if (chunk.trim()) { speakPart(chunk); spokenUpTo += chunk.length; }
    };
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''), 'content-type': 'application/json' },
        body: JSON.stringify({ question, page: pageRef.current.page, pageTitle: pageRef.current.title, lang: langRef.current, history: history.current.slice(-6) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || (res.status === 404 ? 'The help function is not deployed yet (administrator: supabase functions deploy help-assistant).' : `Help is not available right now (HTTP ${res.status}).`));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done || !activeRef.current) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          let j: any;
          try { j = JSON.parse(line.slice(5)); } catch { continue; }
          if (j.error) throw new Error(j.error);
          if (j.t) { full += j.t; speakReady(false); }
        }
      }
      speakReady(true);
      if (full.trim()) {
        history.current.push({ role: 'user', text: question }, { role: 'assistant', text: full });
        history.current = history.current.slice(-8);
      } else { failed = true; setNote('No answer came back.'); }
    } catch (e) {
      failed = true;
      let msg = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|networkerror|load failed|not deployed|HTTP 404|HTTP 5\d\d/i.test(msg) && !full) {
        // The help service is not reachable (usually: not deployed yet). Answer from the built-in notes so Help still talks.
        setNote('The online help service is not reachable, so this answer is read from the built-in notes.');
        full = offlineAnswer(question, pageRef.current.page, langRef.current);
        speakReady(true);
        history.current.push({ role: 'user', text: question }, { role: 'assistant', text: full });
        history.current = history.current.slice(-8);
        failed = false;
      } else setNote(msg);
    } finally {
      streamDone = true;
      if (failed && activeRef.current) { // say so briefly, then stop (a loop of errors would only be annoying)
        const l = langRef.current;
        say(l === 'ta' ? 'மன்னிக்கவும், இப்போது பதில் சொல்ல முடியவில்லை.' : l === 'tanglish' ? 'Sorry, ippo answer panna mudiyala.' : "Sorry, I can't answer right now.", () => endSession(false));
      } else finish();
    }
  }, [endSession]);

  // ------------------------------------------------ listening for the next question
  const listen = useCallback(() => {
    if (!SR || !activeRef.current) return;
    const r = new SR();
    r.lang = langRef.current === 'ta' ? 'ta-IN' : 'en-IN';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    r.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += tr; else interim += tr;
      }
      setHeard((finalText + interim).trim());
    };
    r.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { setNote('The microphone is blocked. Allow it in the browser address bar, then try again.'); endSession(false); }
    };
    r.onend = () => {
      if (!activeRef.current || recRef.current !== r) return;
      const said = finalText.trim();
      if (!said) {
        misses.current += 1;
        if (misses.current >= 2) { endSession(true); return; }
        say(NOT_HEARD[langRef.current], () => listenRef.current(), setNote);
        return;
      }
      misses.current = 0;
      if (STOP_WORDS.test(said)) { endSession(true); return; }
      void ask(said);
    };
    recRef.current = r;
    setHeard('');
    setPhase('listening');
    try { r.start(); } catch { endSession(false); }
  }, [SR, ask, endSession]);
  listenRef.current = listen;

  const begin = () => {
    if (!SR) { setNote('Voice help needs Chrome or Edge on a computer.'); return; }
    window.dispatchEvent(new Event('argus:voice-pause')); // the form voice control would fight over the microphone
    activeRef.current = true;
    misses.current = 0;
    history.current = [];
    setNote('');
    setPhase('greeting');
    stopSpeaking();
    say(GREETING[langRef.current], () => listenRef.current(), setNote);
  };

  useEffect(() => () => { activeRef.current = false; try { recRef.current?.abort?.(); } catch { /* ignore */ } stopSpeaking(); }, []);

  const active = phase !== 'idle';
  const status = phase === 'greeting' ? '…' : phase === 'listening' ? 'Listening… பேசுங்கள் / speak now' : phase === 'thinking' ? 'Thinking…' : phase === 'speaking' ? 'Speaking…' : '';
  const rightSide = !!drag.pos && drag.pos.x > window.innerWidth / 2;

  return (
    <div ref={rootRef} style={drag.style} data-voice-ignore
      className={`fixed bottom-5 left-[5.5rem] z-[60] flex items-end gap-2 font-sans ${rightSide ? 'flex-row-reverse' : ''}`}>
      <button type="button" {...drag.bind}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { if (drag.wasDragged()) return; if (active) endSession(true); else begin(); }}
        aria-label={active ? 'Stop help' : 'Help'} title={active ? 'Click to stop · drag to move' : 'Ask for help by voice · drag to move'}
        className={`relative flex h-12 touch-none cursor-grab select-none items-center gap-2 rounded-full pl-4 pr-5 text-white shadow-lg active:cursor-grabbing ${active ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
        {active && phase === 'listening' && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/30" />}
        <span className="relative">
          {!active ? <CircleHelp size={20} /> : phase === 'listening' ? <Mic size={20} /> : phase === 'thinking' ? <Loader2 size={20} className="animate-spin" /> : phase === 'speaking' ? <Volume2 size={20} /> : <Square size={18} />}
        </span>
        <span className="relative text-sm font-semibold">{active ? 'Stop' : 'உதவி · Help'}</span>
      </button>
      {(active || note) && (
        <div role="status" className="max-w-[20rem] rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
          {active && <p className="font-semibold text-red-600">{status}</p>}
          {heard && <p className="mt-0.5 truncate text-slate-700">“{heard}”</p>}
          {note && <p className="mt-0.5 text-slate-500">{note}</p>}
          {active && (
            <div className="mt-1.5 flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
              <span className="text-[10px] font-semibold uppercase text-slate-400">Language</span>
              {LANGS.map((l) => (
                <button key={l.code} type="button" onClick={() => setLang(l.code)}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${lang === l.code ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}>{l.label}</button>
              ))}
            </div>
          )}
          {active && <p className="mt-1 text-[10px] text-slate-400">Say “stop” or “நிறுத்து” to end.</p>}
        </div>
      )}
    </div>
  );
}

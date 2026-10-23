import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CircleHelp, Mic, MicOff, Send, ThumbsDown, ThumbsUp, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getBreadcrumbs } from '@/config/navigation';

// "உதவி / Help": ask how the ERP works, by typing or by voice, in Tamil, English or Tanglish. The answer streams in and is
// spoken sentence by sentence while it is still being written. It answers from the written ERP notes (help-assistant
// edge function), never from the company's records.

type Lang = 'auto' | 'ta' | 'en' | 'tanglish';
type Turn = { role: 'user' | 'assistant'; text: string; id?: string | null; helpful?: boolean | null; error?: boolean };

const LANGS: { code: Lang; label: string }[] = [
  { code: 'auto', label: 'Auto' }, { code: 'ta', label: 'தமிழ்' }, { code: 'tanglish', label: 'Tanglish' }, { code: 'en', label: 'English' },
];
const store = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const TAMIL = /[஀-௿]/;
const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/help-assistant`;

// ---------------------------------------------------------------- speaking (queue of sentences)
let voices: SpeechSynthesisVoice[] = [];
const loadVoices = () => { try { voices = window.speechSynthesis.getVoices(); } catch { voices = []; } };
function voiceFor(text: string): SpeechSynthesisVoice | undefined {
  const want = TAMIL.test(text) ? ['ta-IN', 'ta'] : ['en-IN', 'en-GB', 'en'];
  for (const w of want) { const v = voices.find((x) => x.lang === w) ?? voices.find((x) => x.lang.startsWith(w)); if (v) return v; }
  return undefined;
}
function say(text: string) {
  const t = text.replace(/[*#_`]/g, '').trim();
  if (!t || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(t);
  const v = voiceFor(t);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = TAMIL.test(t) ? 'ta-IN' : 'en-IN';
  u.rate = 1.02;
  window.speechSynthesis.speak(u);
}
const stopSpeaking = () => { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } };

export function HelpAssistant() {
  const location = useLocation();
  const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<Lang>(() => store.get('help.lang', 'auto') as Lang);
  const [speak, setSpeak] = useState(() => store.get('help.speak', '1') === '1');
  const [listening, setListening] = useState(false);
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const recRef = useRef<any>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  useEffect(() => { loadVoices(); try { window.speechSynthesis.onvoiceschanged = loadVoices; } catch { /* no speech */ } }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [turns, open]);
  useEffect(() => { store.set('help.lang', lang); }, [lang]);
  useEffect(() => { store.set('help.speak', speak ? '1' : '0'); if (!speak) stopSpeaking(); }, [speak]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => { if (!open) { stopSpeaking(); recRef.current?.stop?.(); } }, [open]);

  const page = location.pathname;
  const pageTitle = (() => { try { const b = getBreadcrumbs(page.replace(/^\//, '')); return b[b.length - 1]?.label ?? ''; } catch { return ''; } })();

  const ask = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    stopSpeaking();
    setBusy(true);
    setText('');
    const history = turnsRef.current.filter((t) => !t.error).slice(-6).map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'user', text: question }, { role: 'assistant', text: '' }]);
    const patchLast = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));
    let spokenUpTo = 0;
    let full = '';
    const speakReady = (final: boolean) => {
      if (!speakRef.current) return;
      const rest = full.slice(spokenUpTo);
      const done = rest.match(/^[\s\S]*?[.!?।\n]+(?=\s|$)/g)?.join('') ?? '';
      const chunk = final ? rest : done;
      if (chunk.trim()) { say(chunk); spokenUpTo += chunk.length; }
    };
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''), 'content-type': 'application/json' },
        body: JSON.stringify({ question, page, pageTitle, lang, history }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || (res.status === 404 ? 'The help assistant is not deployed yet (supabase functions deploy help-assistant).' : `Help is not available right now (HTTP ${res.status}).`));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          let j: any;
          try { j = JSON.parse(line.slice(5)); } catch { continue; }
          if (j.id) patchLast((t) => ({ ...t, id: j.id }));
          if (j.error) throw new Error(j.error);
          if (j.t) { full += j.t; patchLast((t) => ({ ...t, text: full })); speakReady(false); }
        }
      }
      speakReady(true);
      if (!full.trim()) patchLast((t) => ({ ...t, text: 'No answer came back. Please try again.', error: true }));
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      // A browser reports an unreachable or not-yet-deployed function as just "Failed to fetch".
      if (/failed to fetch|networkerror|load failed/i.test(msg)) msg = 'Could not reach the help service. If this is a new setup, the help function has not been deployed yet (administrator: supabase functions deploy help-assistant). Otherwise check your internet connection.';
      patchLast((t) => ({ ...t, text: full ? `${full}\n\n${msg}` : msg, error: !full }));
    } finally { setBusy(false); }
  }, [busy, lang, page, pageTitle]);

  const rate = async (t: Turn, helpful: boolean) => {
    setTurns((all) => all.map((x) => (x === t ? { ...x, helpful } : x)));
    if (t.id) await supabase.from('help_questions').update({ helpful }).eq('id', t.id);
  };

  const toggleMic = () => {
    if (!SR) return;
    if (listening) { recRef.current?.stop?.(); return; }
    stopSpeaking();
    const r = new SR();
    r.lang = lang === 'ta' ? 'ta-IN' : 'en-IN';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    r.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += tr; else interim += tr;
      }
      setText((finalText + interim).trim());
    };
    r.onend = () => { setListening(false); if (finalText.trim()) void ask(finalText); };
    r.onerror = () => setListening(false);
    recRef.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  };

  const chips = lang === 'ta'
    ? ['இந்த page-ஐ எப்படி பயன்படுத்துவது?', 'முழு process என்ன?', 'DC எப்படி போடுவது?']
    : lang === 'tanglish'
      ? ['Indha page-ah eppadi use pannanum?', 'Full process enna?', 'DC eppadi podanum?']
      : ['How do I use this page?', 'What is the full process?', 'How do I make a DC?'];

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="Help"
          className="fixed bottom-5 left-[5.5rem] z-40 flex h-12 items-center gap-2 rounded-full bg-emerald-600 pl-4 pr-5 text-white shadow-lg hover:bg-emerald-700">
          <CircleHelp size={20} /><span className="text-sm font-semibold">உதவி · Help</span>
        </button>
      )}
      {open && (
        <div role="dialog" aria-label="ERP help" className="fixed bottom-5 left-5 z-50 flex h-[min(560px,calc(100vh-2.5rem))] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-2 bg-emerald-700 px-3 py-2 text-white">
            <div className="flex min-w-0 items-center gap-2"><CircleHelp size={18} /><div className="min-w-0"><p className="truncate text-sm font-bold">ERP உதவி · Help</p>{pageTitle && <p className="truncate text-[10px] opacity-80">{pageTitle}</p>}</div></div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => { const next = !speak; setSpeak(next); if (next) { loadVoices(); say(lang === 'ta' ? 'குரல் இயக்கப்பட்டது' : lang === 'tanglish' ? 'Voice on aagiduchu' : 'Voice is on'); } }} title={speak ? 'Voice answers on' : 'Voice answers off'} aria-label="Toggle voice answers" className="rounded p-1.5 hover:bg-white/15">{speak ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
              <button type="button" onClick={() => { stopSpeaking(); setTurns([]); }} title="Clear" aria-label="Clear chat" className="rounded p-1.5 hover:bg-white/15"><Trash2 size={16} /></button>
              <button type="button" onClick={() => setOpen(false)} title="Close" aria-label="Close help" className="rounded p-1.5 hover:bg-white/15"><X size={16} /></button>
            </div>
          </div>
          <div className="flex items-center gap-1 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
            {LANGS.map((l) => (
              <button key={l.code} type="button" onClick={() => setLang(l.code)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${lang === l.code ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>{l.label}</button>
            ))}
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3 text-sm">
            {turns.length === 0 && (
              <div className="space-y-2 text-slate-600">
                <p>ERP பற்றிய சந்தேகத்தை தமிழ், English அல்லது Tanglish-ல் கேளுங்கள். Ask anything about how to use the ERP.</p>
                <div className="flex flex-wrap gap-1.5">{chips.map((c) => <button key={c} type="button" onClick={() => void ask(c)} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 hover:bg-emerald-100">{c}</button>)}</div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${t.role === 'user' ? 'bg-emerald-600 text-white' : t.error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-800'}`}>
                  {t.text || (busy && i === turns.length - 1 ? '…' : '')}
                  {t.role === 'assistant' && t.text && !t.error && !(busy && i === turns.length - 1) && (
                    <div className="mt-1 flex items-center gap-1.5 text-slate-400">
                      <button type="button" aria-label="Helpful" onClick={() => void rate(t, true)} className={`hover:text-emerald-600 ${t.helpful === true ? 'text-emerald-600' : ''}`}><ThumbsUp size={13} /></button>
                      <button type="button" aria-label="Not helpful" onClick={() => void rate(t, false)} className={`hover:text-red-600 ${t.helpful === false ? 'text-red-600' : ''}`}><ThumbsDown size={13} /></button>
                      {speak && <button type="button" aria-label="Read aloud" onClick={() => { stopSpeaking(); say(t.text); }} className="hover:text-slate-700"><Volume2 size={13} /></button>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <form className="flex items-center gap-1.5 border-t border-slate-200 p-2" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            {SR && (
              <button type="button" onClick={toggleMic} title={listening ? 'Stop' : 'Speak your question'} aria-label="Microphone"
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${listening ? 'animate-pulse bg-red-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                {listening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            )}
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? 'Listening…' : 'உங்கள் கேள்வி / Your question…'} disabled={busy}
              className="h-9 min-w-0 flex-1 rounded-full border border-slate-300 px-3 text-sm focus:border-emerald-500 focus:outline-none" />
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"><Send size={15} /></button>
          </form>
        </div>
      )}
    </>
  );
}

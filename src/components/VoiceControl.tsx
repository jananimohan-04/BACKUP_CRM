import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleHelp, Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import {
  activeScope, clearField, fillField, focusStep, listFields, matchFieldCommand, norm, pressCancel, pressOpen, pressSave, type Field,
} from '@/lib/voiceFill';
import { prepareTranslator, toEnglish, type SpeechLang } from '@/lib/voiceLang';

// Voice control for every form: say a field name and its value ("company Aabee Poly", "quantity 50",
// "date 15 October 2026") and it is typed in; say "save" / "cancel" / "next" and it presses the button.
// Works on any form (add or edit) because it reads the labels on screen. Chrome / Edge only (Web Speech API).

const LANGS = [{ code: 'en-IN', label: 'English' }, { code: 'ta-IN', label: 'தமிழ்' }, { code: 'hi-IN', label: 'हिन्दी' }];
const store = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function VoiceControl() {
  const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const [on, setOn] = useState(false);
  const [heard, setHeard] = useState('');
  const [note, setNote] = useState('');
  const [help, setHelp] = useState(false);
  const [lang, setLang] = useState<SpeechLang>(() => (store.get('voice.lang', 'en-IN') as SpeechLang));
  const [out, setOut] = useState(() => store.get('voice.out', 'en'));
  const langRef = useRef(lang);
  const outRef = useRef(out);
  langRef.current = lang;
  outRef.current = out;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [replies, setReplies] = useState(() => store.get('voice.replies', '1') === '1');
  const recRef = useRef<any>(null);
  const wantRef = useRef(false);
  const speakingRef = useRef(false);
  const lastField = useRef<Field | null>(null);
  const repliesRef = useRef(replies);
  repliesRef.current = replies;

  useEffect(() => {
    const track = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.closest('[data-voice-ignore]')) lastField.current = t as Field;
    };
    document.addEventListener('focusin', track);
    return () => document.removeEventListener('focusin', track);
  }, []);

  const say = useCallback((text: string, spoken = true) => {
    setNote(text);
    if (!spoken || !repliesRef.current || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-IN';
      u.rate = 1.05;
      speakingRef.current = true;
      const done = () => { window.setTimeout(() => { speakingRef.current = false; }, 500); };
      u.onend = done; u.onerror = done;
      window.speechSynthesis.speak(u);
    } catch { speakingRef.current = false; }
  }, []);

  const currentField = (): Field | null => {
    const scope = activeScope();
    const a = document.activeElement as HTMLElement | null;
    const fields = listFields(scope);
    if (a && fields.includes(a as Field)) return a as Field;
    const l = lastField.current;
    return l && l.isConnected && fields.includes(l) ? l : null;
  };

  const doSave = (another: boolean) => {
    const scope = activeScope();
    const orig = window.alert;
    let problem = '';
    window.alert = (m?: any) => { problem = String(m ?? ''); orig.call(window, m); };
    const label = pressSave(scope, another);
    if (!label) { window.alert = orig; say(another ? 'I could not find a save and add another button.' : 'I could not find a save button here.'); return; }
    say(another ? 'Saving…' : 'Saving…', false);
    window.setTimeout(() => {
      window.alert = orig;
      if (problem) say(`Not saved. ${problem.split('\n')[0].slice(0, 140)}`);
      else say(another ? 'Saved. Ready for the next one.' : 'Saved.');
    }, 2500);
  };

  const handle = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setHeard(text);
    const n = norm(text);
    if (/^(stop|pause|turn off) (listening|voice|mic)$|^stop voice$/.test(n)) { stopRef.current(); say('Voice off.'); return; }
    if (/^(save|submit) (and|&) (add|new|next)( another| one)?( \w+)?$|^add another$|^save and add another$/.test(n)) return doSave(true);
    if (/^(save|submit|save it|save this|done|create|confirm|save form|save entry|save record|save enquiry|save order|save inward|save quotation|save customer)$/.test(n)) return doSave(false);
    if (/^(cancel|close|go back|discard|close this|cancel this)$/.test(n)) { say(pressCancel(activeScope()) ? 'Closed.' : 'Nothing to close.'); return; }
    if (/^(next|next field|skip|skip this)$/.test(n)) { const f = focusStep(activeScope(), currentField(), 1); say(f ? 'Next.' : 'No fields here.', false); return; }
    if (/^(previous|previous field|go back one|back field)$/.test(n)) { const f = focusStep(activeScope(), currentField(), -1); say(f ? 'Previous.' : 'No fields here.', false); return; }
    if (/^(clear|clear field|clear this|erase|erase this)$/.test(n)) { const f = currentField(); if (f) { clearField(f); say('Cleared.', false); } else say('Click a field first.'); return; }
    if (/^(help|voice help|what can i say)$/.test(n)) { setHelp(true); return; }

    const scope = activeScope();
    const fields = listFields(scope);
    const m = matchFieldCommand(text, fields);
    if (m) {
      m.field.focus();
      if (m.focusOnly) { say(`${m.label}`, false); return; }
      const v = fillField(m.field, m.value, 'replace');
      if (v === null) say(`That does not fit ${m.label}.`);
      else say(`${m.label}: ${v}`, false);
      return;
    }
    const open = /^(new|add|open|create) (.+)$/.exec(n);
    if (open) {
      const hit = pressOpen(open[2]);
      if (hit) { say(`Opening ${hit.replace(/^\+\s*/, '')}.`); return; }
    }
    // Plain dictation: into the field you are in, else the first empty field on screen.
    let target = currentField();
    if (!target) target = fields.find((f) => !f.value) ?? null;
    if (!target) { say('I could not find a field to type in.'); return; }
    target.focus();
    const v = fillField(target, text, 'append');
    if (v === null) say('That does not fit this field.');
    else say(`Typed: ${v}`, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say]);

  const handleRef = useRef(handle);
  handleRef.current = handle;
  const stopRef = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    wantRef.current = false;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    recRef.current = null;
    setOn(false);
    setHeard('');
  }, []);
  stopRef.current = stop;

  const start = useCallback(() => {
    if (!SR) { setNote('Voice input needs Chrome or Edge.'); return; }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = String(res[0]?.transcript ?? '');
        if (speakingRef.current) continue; // ignore our own spoken replies
        if (!res.isFinal) { setHeard(t); continue; }
        // Spoken language -> English (when asked), one phrase at a time and in order.
        queue.current = queue.current.then(async () => {
          const eng = await toEnglish(t, langRef.current, outRef.current === 'en');
          if (eng.trim() !== t.trim()) setHeard(`${t} → ${eng}`);
          handleRef.current(eng);
        }).catch(() => handleRef.current(t));
      }
    };
    r.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRef.current = false;
        setNote('The microphone is blocked. Allow it in the browser address bar, then try again.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setNote(`Voice error: ${e.error}`);
      }
    };
    r.onend = () => {
      if (wantRef.current && recRef.current === r) { try { r.start(); } catch { /* restarting */ } }
      else setOn(false);
    };
    recRef.current = r;
    wantRef.current = true;
    prepareTranslator(lang);
    try { r.start(); setOn(true); setNote(''); } catch { setNote('Could not start the microphone.'); }
  }, [SR, lang]);

  // Changing the language restarts listening in the new one.
  useEffect(() => {
    store.set('voice.lang', lang);
    if (wantRef.current) { try { recRef.current?.stop(); } catch { /* ignore */ } recRef.current = null; start(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);
  useEffect(() => { store.set('voice.replies', replies ? '1' : '0'); }, [replies]);
  useEffect(() => { store.set('voice.out', out); }, [out]);
  useEffect(() => () => { wantRef.current = false; try { recRef.current?.stop(); } catch { /* ignore */ } }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.altKey && e.key.toLowerCase() === 'v') { e.preventDefault(); if (wantRef.current) stopRef.current(); else start(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [start]);

  if (!SR) return null;

  const examples: [string, string][] = [
    ['company Aabee Poly Products', 'types it in the Company field'],
    ['quantity 50  ·  price 1200', 'numbers go into number fields'],
    ['date 15 October 2026  ·  date today', 'date fields'],
    ['category service purchase', 'picks from a dropdown'],
    ['email name at gmail dot com', 'email fields'],
    ['next  ·  previous  ·  clear', 'move between fields, or clear one'],
    ['save  ·  submit', 'presses Save / Submit and tells you if it saved'],
    ['save and add another', 'saves, then gives a blank form'],
    ['cancel  ·  close', 'closes the form'],
    ['new enquiry  ·  add sales order', 'opens that form'],
    ['stop listening', 'turns the microphone off'],
  ];

  return (
    <div data-voice-ignore className="fixed left-4 bottom-4 z-[70] flex items-end gap-2 font-sans">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (on ? stop() : start())}
        title={on ? 'Voice is on. Click to stop (Alt+V)' : 'Start voice control (Alt+V)'}
        aria-label={on ? 'Stop voice control' : 'Start voice control'}
        aria-pressed={on}
        className={`relative flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg transition-colors ${on ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600'}`}
      >
        {on && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />}
        {on ? <Mic size={20} className="relative" /> : <MicOff size={20} className="relative" />}
      </button>
      {(on || note) && (
        <div className="max-w-[22rem] rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur" role="status">
          {on && <p className="font-semibold text-red-600">Listening… say a field name and its value</p>}
          {heard && <p className="mt-0.5 truncate text-slate-700">“{heard}”</p>}
          {note && <p className="mt-0.5 text-slate-500">{note}</p>}
          {on && (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase text-slate-400">Speak</span>
              <select
                aria-label="Voice language"
                value={lang}
                onChange={(e) => setLang(e.target.value as SpeechLang)}
                onMouseDown={(e) => e.stopPropagation()}
                className="h-6 rounded border border-slate-200 bg-white px-1 text-[11px]"
              >
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <span className="text-[10px] font-semibold uppercase text-slate-400">Type</span>
              <select
                aria-label="Typed language"
                value={out}
                onChange={(e) => setOut(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                className="h-6 rounded border border-slate-200 bg-white px-1 text-[11px]"
              >
                <option value="en">English</option>
                <option value="same">As spoken</option>
              </select>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setReplies((v) => !v)} title={replies ? 'Spoken replies on' : 'Spoken replies off'} aria-label="Toggle spoken replies" className="text-slate-500 hover:text-slate-800">
                {replies ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setHelp((v) => !v)} title="What can I say?" aria-label="Voice help" className="text-slate-500 hover:text-slate-800">
                <CircleHelp size={15} />
              </button>
            </div>
          )}
        </div>
      )}
      {help && (
        <div className="absolute bottom-14 left-0 w-[24rem] max-w-[90vw] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">What you can say</p>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setHelp(false)} aria-label="Close help" className="text-slate-400 hover:text-slate-700"><X size={15} /></button>
          </div>
          <ul className="space-y-1">
            {examples.map(([say1, what]) => (
              <li key={say1} className="text-xs"><b className="text-slate-800">“{say1}”</b> <span className="text-slate-500">— {what}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-400">Say the field name exactly as it is written on the form. In Tamil or Hindi, say "நிறுவனம்", "விலை", "சேமி" and so on; set Speak to your language and Type to English. Names, quantities and prices are typed as you say them. Shortcut: Alt+V.</p>
        </div>
      )}
    </div>
  );
}

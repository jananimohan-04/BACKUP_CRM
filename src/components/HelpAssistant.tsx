import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Bot, CheckCircle2, GraduationCap, Lightbulb, Loader2, Mic, Sparkles, Volume2, X } from 'lucide-react';
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
// "Guide me": starts the on-screen walkthrough of the current screen (GuideCoach) instead of answering by voice.
const GUIDE_WORDS = /(guide me|walk me through|walkthrough|show me how|step by step|guide pannu|guide pannunga|vazhi ?kaattu)|வழிகாட்டு|வழி காட்டு|வழிகாட்டுங்கள்/i;
const STOP_WORDS = /^(stop|bye|goodbye|that'?s all|enough|exit|close|நிறுத்து|போதும்|நிறுத்தவும்|பை|nirutthu|nirutha|podhum|pothum|bye bye)\b/i;

const GREETING: Record<Lang, string> = { ta: 'ஆம், சொல்லுங்கள்.', tanglish: 'Yes, sollunga.', en: 'Yes, tell me.' };

// Proactive suggestions for each page (Adviser mode)
const PAGE_SUGGESTIONS: Record<string, { en: string; ta: string }[]> = {
  '/sales/pipeline': [
    { en: 'Add a new enquiry by clicking "+ New Enquiry"', ta: '"+ New Enquiry" கிளிக் செய்து புதிய விசாரணை சேர்க்கவும்' },
    { en: 'Drag enquiries between columns to change status', ta: 'நிலையை மாற்ற விசாரணைகளை நெடுவரிசைகளுக்கு இடையே இழுக்கவும்' },
    { en: 'Click an enquiry card to view or edit details', ta: 'விவரங்களைப் பார்க்க விசாரணை அட்டையைக் கிளிக் செய்யவும்' },
    { en: 'Create quotation from an enquiry using the "Quote" button', ta: '"Quote" பட்டனைப் பயன்படுத்தி விசாரணையிலிருந்து quote உருவாக்கவும்' },
  ],
  '/production/scheduling': [
    { en: 'Drag jobs to schedule them on machines', ta: 'இயந்திரங்களில் திட்டமிட வேலைகளை இழுக்கவும்' },
    { en: 'Double-click a scheduled block to edit it', ta: 'திட்டமிடப்பட்ட தொகுதியைத் திருத்த இருமுறை கிளிக் செய்யவும்' },
    { en: 'Use filters to show specific machines or date ranges', ta: 'குறிப்பிட்ட இயந்திரங்கள் அல்லது தேதி வரம்புகளைக் காட்ட வடிப்பான்களைப் பயன்படுத்தவும்' },
  ],
  '/production/planning': [
    { en: 'View all production orders and their status', ta: 'அனைத்து உற்பத்தி ஆர்டர்களையும் அவற்றின் நிலையையும் பாருங்கள்' },
    { en: 'Create job cards for each operation', ta: 'ஒவ்வொரு செயல்பாட்டிற்கும் ஜாப் கார்டுகளை உருவாக்கவும்' },
    { en: 'Track work order progress in real-time', ta: 'வேலை ஆர்டர் முன்னேற்றத்தை நிகழ்நேரத்தில் கண்காணிக்கவும்' },
  ],
  '/finance/invoices': [
    { en: 'Create invoice from a delivery challan', ta: 'டெலிவரி சலானிலிருந்து இன்வாய்ஸ் உருவாக்கவும்' },
    { en: 'Record payment by clicking "Record Receipt"', ta: '"Record Receipt" கிளிக் செய்து பணம் செலுத்துதலைப் பதிவு செய்யவும்' },
    { en: 'Print or download invoice as PDF', ta: 'இன்வாய்ஸை PDF ஆக பிரிண்ட் அல்லது டவுன்லோட் செய்யவும்' },
  ],
  '/finance/bank-entry': [
    { en: 'Record bank deposits and withdrawals', ta: 'வங்கி வைப்புகள் மற்றும் பணம் எடுத்தலைப் பதிவு செய்யவும்' },
    { en: 'Import bank statement to reconcile transactions', ta: 'பரிவர்த்தனைகளைச் சரிசெய்ய வங்கி அறிக்கையை இறக்குமதி செய்யவும்' },
  ],
  '/accounts/ledger': [
    { en: 'View account transactions by selecting an account', ta: 'கணக்கைத் தேர்ந்தெடுத்து பரிவர்த்தனைகளைப் பாருங்கள்' },
    { en: 'Export ledger as PDF or Excel', ta: 'லெட்ஜரை PDF அல்லது Excel ஆக ஏற்றுமதி செய்யவும்' },
    { en: 'Filter by date range to see specific periods', ta: 'குறிப்பிட்ட காலங்களைப் பார்க்க தேதி வரம்பு மூலம் வடிகட்டவும்' },
  ],
  '/accounts/trial-balance': [
    { en: 'View debit and credit balances of all accounts', ta: 'அனைத்து கணக்குகளின் டெபிட் மற்றும் கிரெடிட் இருப்புகளைப் பாருங்கள்' },
    { en: 'Export trial balance for auditing', ta: 'தணிக்கைக்கு trial balance ஐ ஏற்றுமதி செய்யவும்' },
  ],
  '/inventory/stock': [
    { en: 'Check low stock alerts in the alerts tab', ta: 'குறைந்த ஸ்டாக் எச்சரிக்கைகளை அலர்ட் டேபில் பாருங்கள்' },
    { en: 'Add stock movement to track inventory changes', ta: 'சரக்கு மாற்றங்களைக் கண்காணிக்க ஸ்டாக் நகர்வைச் சேர்க்கவும்' },
    { en: 'View stock value and quantity at a glance', ta: 'ஸ்டாக் மதிப்பு மற்றும் அளவை ஒரே பார்வையில் பாருங்கள்' },
  ],
  '/purchasing/orders': [
    { en: 'Create purchase orders for suppliers', ta: 'சப்ளையர்களுக்கு purchase orders உருவாக்கவும்' },
    { en: 'Track order status and delivery dates', ta: 'ஆர்டர் நிலை மற்றும் டெலிவரி தேதிகளைக் கண்காணிக்கவும்' },
  ],
  '/dashboard': [
    { en: 'View key performance indicators at a glance', ta: 'முக்கிய செயல்திறன் குறிகாட்டிகளை ஒரே பார்வையில் பாருங்கள்' },
    { en: 'Click on any metric to drill down into details', ta: 'விவரங்களுக்கு எந்த மெட்ரிக் மீதும் கிளிக் செய்யவும்' },
    { en: 'Use date filters to change the reporting period', ta: 'அறிக்கை காலத்தை மாற்ற தேதி வடிப்பான்களைப் பயன்படுத்தவும்' },
  ],
  '/costing/job-costing': [
    { en: 'View project-wise cost breakdown', ta: 'திட்டம் வாரியான செலவு விவரங்களைப் பாருங்கள்' },
    { en: 'Compare estimated vs actual costs', ta: 'மதிப்பிடப்பட்ட vs உண்மையான செலவுகளை ஒப்பிடவும்' },
  ],
  '/engineering/cnc-vault': [
    { en: 'Upload drawings and technical documents', ta: 'வரைபடங்கள் மற்றும் தொழில்நுட்ப ஆவணங்களை பதிவேற்றவும்' },
    { en: 'Link products to their drawings and BOMs', ta: 'தயாரிப்புகளை அவற்றின் வரைபடங்கள் மற்றும் BOM-களுடன் இணைக்கவும்' },
  ],
};

// The first time Help is switched on in a browser session it welcomes the person.
const WELCOME: Record<Lang, string> = {
  ta: 'ARGUS ERP-க்கு வரவேற்கிறோம்! சொல்லுங்கள், எப்படி உதவலாம்?',
  tanglish: 'Welcome to Argus ERP! Sollunga, eppadi help pannalam?',
  en: 'Welcome to Argus ERP! How can I help you?',
};
const welcomedOnce = () => { try { return sessionStorage.getItem('argus.help.welcomed') === '1'; } catch { return false; } };
const markWelcomed = () => { try { sessionStorage.setItem('argus.help.welcomed', '1'); } catch { /* ignore */ } };
const GOODBYE: Record<Lang, string> = { ta: 'சரி, தேவைப்படும்போது கூப்பிடுங்கள்.', tanglish: 'Sari, venumbodhu koopidunga.', en: 'Okay, call me when you need me.' };
const NOT_HEARD: Record<Lang, string> = { ta: 'எனக்கு கேட்கவில்லை.', tanglish: 'Enakku kekkala.', en: "I didn't hear anything." };

// ---------------------------------------------------------------- speaking
let voices: SpeechSynthesisVoice[] = [];
const loadVoices = () => { try { voices = window.speechSynthesis.getVoices(); } catch { voices = []; } };
// The clearest voices are the "Natural" / "Neural" / online ones (Microsoft Edge has them; Chrome has Google's), so those are
// preferred; the person can also pick a voice (it is remembered).
const voiceScore = (v: SpeechSynthesisVoice) =>
  (/natural|neural/i.test(v.name) ? 8 : 0) + (/online/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.lang === 'en-IN' || v.lang === 'ta-IN' ? 1 : 0);
function voiceList(kind: 'ta' | 'en'): SpeechSynthesisVoice[] {
  return voices.filter((v) => v.lang.toLowerCase().startsWith(kind)).sort((x, y) => voiceScore(y) - voiceScore(x) || x.name.localeCompare(y.name));
}
function voiceFor(text: string): SpeechSynthesisVoice | undefined {
  const kind = TAMIL.test(text) ? 'ta' : 'en';
  const list = voiceList(kind);
  const saved = store.get(`help.voice.${kind}`, '');
  return list.find((v) => v.name === saved) ?? list[0];
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
let serverVoiceDown = false;   // the server voice failed once: do not keep trying it
let tamilVoiceFailed = false;  // neither online voice worked
async function serverVoice(text: string): Promise<HTMLAudioElement | null> {
  if (serverVoiceDown) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''), 'content-type': 'application/json' },
      body: JSON.stringify({ tts: text, lang: 'ta' }),
    });
    if (!res.ok) { serverVoiceDown = true; return null; }
    return new Audio(URL.createObjectURL(await res.blob()));
  } catch { serverVoiceDown = true; return null; }
}
function playOnline(text: string, tl: string, onEnd: () => void, notify?: (m: string) => void) {
  const parts = chunksOf(text);
  const token = ++onlineToken;
  const play = (a: HTMLAudioElement) => new Promise<boolean>((resolve) => {
    onlineAudio = a;
    a.volume = 1;
    a.onended = () => resolve(true);
    a.onerror = () => resolve(false);
    a.play().catch(() => resolve(false));
  });
  const next = async (i: number) => {
    if (token !== onlineToken) return;               // stopped or replaced
    if (i >= parts.length) { onEnd(); return; }
    const piece = parts[i].trim();
    // 1) the server's voice (needs the help function + OPENAI_API_KEY), 2) Google's online voice.
    let ok = false;
    const sv = await serverVoice(piece);
    if (token !== onlineToken) return;
    if (sv) ok = await play(sv);
    if (!ok && token === onlineToken) ok = await play(new Audio(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(piece)}`));
    if (token !== onlineToken) return;
    if (!ok) {
      if (!tamilVoiceFailed) { tamilVoiceFailed = true; notify?.('Tamil voice is not available on this PC. Open the ERP in Microsoft Edge (it has Tamil voices built in), or install a Tamil voice in Windows, or switch Language to English / Tanglish.'); }
      onEnd();
      return;
    }
    void next(i + 1);
  };
  void next(0);
}
let announcedOnline = false;
/** Speaks one piece of text; `onEnd` runs when it has finished (or could not be spoken). */
export function say(text: string, onEnd: () => void, notify?: (m: string) => void) {
  const t = text.replace(/[*#_`]/g, '').trim();
  if (!t) { onEnd(); return; }
  loadVoices();
  const tamil = TAMIL.test(t);
  const v = voiceFor(t);
  if (tamil && !v && voices.length > 0) {
    if (!announcedOnline) { announcedOnline = true; notify?.('No Tamil voice is installed on this PC, so an online Tamil voice is used.'); }
    playOnline(t, 'ta', onEnd, notify);
    return;
  }
  if (!('speechSynthesis' in window)) { onEnd(); return; }
  const u = new SpeechSynthesisUtterance(t);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = tamil ? 'ta-IN' : 'en-IN';
  u.rate = 0.95;     // a little slower is clearer
  u.pitch = 1;
  u.volume = 1;
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
export function offlineAnswer(question: string, page: string, lang: Lang): string {
  const generic = /\b(page|screen)\b|இந்த|indha|intha|ithu/i.test(question);
  const ranked = rankNotes(question, page).filter((r) => r.n.id !== 'overview' || r.kw > 0);
  const best = ranked.find((r) => r.kw > 0) ?? (generic ? ranked.find((r) => r.total > 0) : undefined);
  if (!best) return REFUSAL[lang];
  const [en, ta] = best.n.body.split(/\nTA:/);
  const english = en.replace(/^EN:\s*/, '').trim();
  const text = lang === 'ta' && ta ? ta.trim() : english;
  // Only the lines that answer THIS question are read out, not the whole note: lines are scored by the question's words.
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const qWords = question.toLowerCase().replace(/[^\p{L}\p{N}+\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !OFFLINE_STOP.has(w));
  const scored = lines.map((l, i) => ({ l, i, s: qWords.reduce((n, w) => n + (l.toLowerCase().includes(w) ? 1 : 0), 0) }));
  const hit = scored.filter((x) => x.s > 0).sort((a, c) => c.s - a.s || a.i - c.i).slice(0, 3).sort((a, c) => a.i - c.i);
  const pick = hit.length ? hit.map((x) => x.l) : lines.slice(0, 2);   // nothing specific: the start of the note
  const out = pick.join(' ');
  return out.length > 700 ? `${out.slice(0, 700).replace(/\s+\S*$/, '')}.` : out;
}
const OFFLINE_STOP = new Set(['how', 'what', 'where', 'when', 'why', 'the', 'and', 'for', 'this', 'that', 'with', 'eppadi', 'enna', 'podanum', 'pannanum', 'indha', 'page', 'screen', 'tell', 'about', 'explain', 'can', 'you', 'are', 'does', 'make', 'use']);
export const stopSpeaking = () => {
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
  const [, setVoiceTick] = useState(0);
  const [lang, setLang] = useState<Lang>(() => (store.get('help.vlang', 'ta') as Lang));
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useDraggable('argus.help.pos', rootRef);
  const [menu, setMenu] = useState(false);
  const [modes, setModes] = useState({ teaching: false, coworker: false });
  const [showSuggestions, setShowSuggestions] = useState(false);  // Proactive suggestions panel

  const activeRef = useRef(false);          // a help conversation is going on
  const langRef = useRef(lang);
  langRef.current = lang;
  const recRef = useRef<any>(null);
  const history = useRef<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const misses = useRef(0);                  // times in a row nothing was heard
  const pageRef = useRef({ page: '', title: '' });
  const listenRef = useRef<() => void>(() => {});
  const lastSpoken = useRef('');

  const page = location.pathname;
  const pageTitle = (() => { try { const b = getBreadcrumbs(page.replace(/^\//, '')); return b[b.length - 1]?.label ?? ''; } catch { return ''; } })();
  pageRef.current = { page, title: pageTitle };
  
  // Get suggestions for current page
  const suggestions = PAGE_SUGGESTIONS[page] || [];

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
      lastSpoken.current = `${lastSpoken.current} ${chunk}`.slice(-1500);
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
      // Its own voice picked up by the microphone is not a question.
      const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
      if (norm(said).length > 8 && norm(lastSpoken.current).includes(norm(said))) { listenRef.current(); return; }
      misses.current = 0;
      if (STOP_WORDS.test(said)) { endSession(true); return; }
      if (GUIDE_WORDS.test(said)) { endSession(false); window.dispatchEvent(new CustomEvent('argus:guide')); return; }
      lastSpoken.current = '';
      void ask(said);
    };
    recRef.current = r;
    setHeard('');
    setPhase('listening');
    // A short pause first, so the end of Help's own voice has died away before the microphone opens.
    window.setTimeout(() => { if (activeRef.current && recRef.current === r) { try { r.start(); } catch { endSession(false); } } }, 600);
  }, [SR, ask, endSession]);
  listenRef.current = listen;
  const beginRef = useRef<() => void>(() => {});


  // ------------------------------------------------ the three modes and their keyboard shortcuts
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ mode: 'teaching' | 'coworker'; on: boolean }>).detail; if (d) setModes((m) => ({ ...m, [d.mode]: d.on })); };
    window.addEventListener('argus:mode', on);
    return () => window.removeEventListener('argus:mode', on);
  }, []);
  const modesRef = useRef(modes);
  modesRef.current = modes;
  const toggleMode = useCallback((id: 'teaching' | 'coworker' | 'adviser') => {
    const m = modesRef.current;
    const adviserOn = activeRef.current;
    const wasOn = id === 'teaching' ? m.teaching : id === 'coworker' ? m.coworker : adviserOn;
    // one mode at a time: the other two are switched off first
    if (id !== 'teaching' && m.teaching) window.dispatchEvent(new CustomEvent('argus:teach', { detail: { on: false } }));
    if (id !== 'coworker' && m.coworker) window.dispatchEvent(new CustomEvent('argus:copilot', { detail: { on: false } }));
    if (id !== 'adviser' && adviserOn) endSession(false);
    if (id === 'teaching') window.dispatchEvent(new CustomEvent('argus:teach', { detail: { on: !wasOn } }));
    else if (id === 'coworker') window.dispatchEvent(new CustomEvent('argus:copilot', { detail: { on: !wasOn } }));
    else if (wasOn) endSession(true); else beginRef.current();
  }, [endSession]);
  const toggleRef = useRef(toggleMode);
  toggleRef.current = toggleMode;
  useEffect(() => {
    // Ctrl+Shift (pressed and released on their own) = Teaching; Ctrl+Tab = Co-worker; Ctrl+Enter or Ctrl+CapsLock = Adviser.
    let armed = false; let dirty = false;
    const down = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'Control' || k === 'Shift') { if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && !dirty) armed = true; return; }
      dirty = true; armed = false;
      if (e.repeat) return;
      const ctrlOnly = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
      const altShift = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;
      let id: 'teaching' | 'coworker' | 'adviser' | '' = '';
      if (ctrlOnly && k === 'Tab') id = 'coworker';
      else if (ctrlOnly && (k === 'Enter' || k === 'CapsLock')) id = 'adviser';
      else if (altShift && e.code === 'KeyT') id = 'teaching';
      else if (altShift && e.code === 'KeyC') id = 'coworker';
      else if (altShift && e.code === 'KeyA') id = 'adviser';
      if (id) { e.preventDefault(); e.stopPropagation(); toggleRef.current(id); }
    };
    const up = (e: KeyboardEvent) => {
      if ((e.key === 'Control' || e.key === 'Shift') && armed) { armed = false; dirty = true; toggleRef.current('teaching'); return; }
      if (!e.ctrlKey && !e.shiftKey) { dirty = false; armed = false; }
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const out = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [menu]);

  const begin = () => {
    if (!SR) { setNote('Voice help needs Chrome or Edge on a computer.'); return; }
    window.dispatchEvent(new Event('argus:voice-pause')); // the form voice control would fight over the microphone
    activeRef.current = true;
    misses.current = 0;
    history.current = [];
    setNote('');
    setPhase('greeting');
    stopSpeaking();
    const first = !welcomedOnce();
    markWelcomed();
    say(first ? WELCOME[langRef.current] : GREETING[langRef.current], () => listenRef.current(), setNote);
  };

  beginRef.current = begin;
  useEffect(() => () => { activeRef.current = false; try { recRef.current?.abort?.(); } catch { /* ignore */ } stopSpeaking(); }, []);

  const active = phase !== 'idle';
  const anyOn = active || modes.teaching || modes.coworker;
  const status = phase === 'greeting' ? '…' : phase === 'listening' ? 'Listening… பேசுங்கள் / speak now' : phase === 'thinking' ? 'Thinking…' : phase === 'speaking' ? 'Speaking…' : '';
  const rightSide = !!drag.pos && drag.pos.x > window.innerWidth / 2;
  const kind: 'ta' | 'en' = lang === 'ta' ? 'ta' : 'en';
  const choices = voiceList(kind);
  const chosen = voiceFor(kind === 'ta' ? 'ta அ' : 'en')?.name ?? '';
  const pickVoice = (name: string) => {
    store.set(`help.voice.${kind}`, name);
    setVoiceTick((n) => n + 1);
    stopSpeaking();
    say(kind === 'ta' ? 'ARGUS ERP-க்கு வரவேற்கிறோம்!' : 'Welcome to Argus ERP!', () => {}, setNote);
  };

  return (
    <>
    <TamilVoiceNotice lang={lang} />
    <div ref={rootRef} style={drag.style} data-voice-ignore
      className={`fixed bottom-5 max-lg:bottom-[4.75rem] left-[5.5rem] z-[60] flex items-end gap-2 font-sans ${rightSide ? 'flex-row-reverse' : ''}`}>
      <button type="button" {...drag.bind}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { if (drag.wasDragged()) return; setMenu((m) => !m); }}
        aria-label="AI assistant" aria-expanded={menu} title="AI assistant: Teaching, Co-worker, Adviser · drag to move"
        className={`relative flex h-12 touch-none cursor-grab select-none items-center gap-2 rounded-full pl-4 pr-5 text-white shadow-lg active:cursor-grabbing ${anyOn ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
        {active && phase === 'listening' && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/30" />}
        <span className="relative">
          {active && phase === 'listening' ? <Mic size={20} /> : active && phase === 'thinking' ? <Loader2 size={20} className="animate-spin" /> : active && phase === 'speaking' ? <Volume2 size={20} /> : <Sparkles size={20} />}
        </span>
        <span className="relative text-sm font-semibold">{modes.teaching ? 'Teaching' : modes.coworker ? 'Co-worker' : active ? 'Adviser' : 'AI · உதவி'}</span>
      </button>
      {menu && (
        <div role="menu" aria-label="AI modes" data-voice-ignore onMouseDown={(e) => e.stopPropagation()}
          className={`absolute bottom-14 ${rightSide ? 'right-0' : 'left-0'} w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl`}>
          {([
            { id: 'teaching', icon: GraduationCap, color: 'bg-orange-100 text-orange-600', title: 'Teaching', sub: 'Learn the entire ERP page by page with voice narration & animations', keys: 'Ctrl + Shift', on: modes.teaching },
            { id: 'coworker', icon: Bot, color: 'bg-violet-100 text-violet-600', title: 'Co-worker', sub: 'Type or speak commands — I\'ll do them: "add enquiry for ABC"', keys: 'Ctrl + Tab', on: modes.coworker },
            { id: 'adviser', icon: Lightbulb, color: 'bg-emerald-100 text-emerald-600', title: 'Adviser', sub: 'Get suggestions & ask questions — answers with animations', keys: 'Ctrl + Enter', on: active },
          ] as const).map((m) => (
            <button key={m.id} type="button" role="menuitem" onClick={() => { setMenu(false); toggleMode(m.id); }}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left last:mb-0 ${m.on ? 'border-red-300 bg-red-50' : 'border-transparent hover:bg-slate-50'}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${m.color}`}><m.icon size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-800">{m.title}{m.on && <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">On · click to stop</span>}</span>
                <span className="block text-[11px] leading-snug text-slate-500">{m.sub}</span>
                <kbd className="mt-0.5 inline-block rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-semibold text-slate-500">{m.keys}</kbd>
              </span>
            </button>
          ))}
          <p className="px-2 pt-1 text-[10px] text-slate-400">Press the same keys again to switch it off. Alt + Shift + T / C / A also work.</p>
        </div>
      )}
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
          {active && choices.length > 1 && (
            <div className="mt-1.5 flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
              <span className="text-[10px] font-semibold uppercase text-slate-400">Voice</span>
              <select aria-label="Choose the voice" value={chosen} onChange={(e) => pickVoice(e.target.value)} className="h-6 max-w-[13rem] rounded border border-slate-200 bg-white px-1 text-[11px]">
                {choices.map((v) => <option key={v.name} value={v.name}>{v.name.replace(/^(Microsoft|Google)\s+/, '$1 ')}</option>)}
              </select>
            </div>
          )}
          {active && <p className="mt-1 text-[10px] text-slate-400">Say "stop" or "நிறுத்து" to end.</p>}
          {active && suggestions.length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setShowSuggestions(v => !v)} className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 hover:text-emerald-700">
                <Lightbulb size={12} /> {showSuggestions ? 'Hide suggestions' : 'Show suggestions'}
              </button>
            </div>
          )}
        </div>
      )}
      
      {/* Proactive Suggestions Panel (Adviser mode) */}
      {active && showSuggestions && suggestions.length > 0 && (
        <div className="max-w-[20rem] rounded-xl border border-emerald-200 bg-emerald-50 p-3 shadow-lg" style={{ animation: 'fadeIn .3s ease-out' }}>
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb size={16} className="text-emerald-600" />
            <span className="text-xs font-bold text-emerald-800">{lang === 'ta' ? 'பரிந்துரைகள்' : 'Suggestions'}</span>
          </div>
          <ul className="space-y-1.5">
            {suggestions.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-emerald-900">
                <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span>{lang === 'ta' ? s.ta : s.en}</span>
              </li>
            ))}
          </ul>
          <button 
            type="button" 
            onClick={() => {
              const text = suggestions.map(s => lang === 'ta' ? s.ta : s.en).join('. ');
              say(text, () => {}, setNote);
            }}
            className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-emerald-600 hover:text-emerald-700"
          >
            <Volume2 size={12} /> {lang === 'ta' ? 'படித்துக் காட்டு' : 'Read aloud'}
          </button>
        </div>
      )}
    </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------
// "Tamil voice is not installed": a bar at the top, and the steps to install it for this device.
// A website cannot install a voice itself; it can notice the voice is missing, guide the person through the install, and check again.
// ------------------------------------------------------------------------------------------------
const NOTICE_KEY = 'help.tamilNoticeHiddenUntil';
type Platform = 'windows' | 'android' | 'ios' | 'mac' | 'other';
const detectPlatform = (): Platform => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac';
  return 'other';
};
const tamilVoices = () => { loadVoices(); return voiceList('ta'); };

function TamilVoiceNotice({ lang }: { lang: Lang }) {
  const [missing, setMissing] = useState(false);
  const [hidden, setHidden] = useState(() => Number(store.get(NOTICE_KEY, '0')) > Date.now());
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<'' | 'found' | 'missing'>('');
  const [found, setFound] = useState('');
  const platform = detectPlatform();

  // Voices load a moment after the page does, so look a few times before deciding the voice is missing.
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const look = () => setMissing(tamilVoices().length === 0);
    look();
    try { window.speechSynthesis.addEventListener('voiceschanged', look); } catch { /* ignore */ }
    const timers = [800, 2500, 6000].map((ms) => window.setTimeout(look, ms));
    return () => { timers.forEach(window.clearTimeout); try { window.speechSynthesis.removeEventListener('voiceschanged', look); } catch { /* ignore */ } };
  }, []);

  const hide = () => { store.set(NOTICE_KEY, String(Date.now() + 7 * 24 * 3600 * 1000)); setHidden(true); };   // asked again in a week
  const recheck = () => {
    const v = tamilVoices();
    setMissing(v.length === 0);
    setChecked(v.length ? 'found' : 'missing');
    setFound(v[0]?.name ?? '');
    if (v.length) { setVoiceTickGlobal(); say('வணக்கம்! தமிழ் குரல் தயாராக உள்ளது.', () => {}); }
  };

  const steps: Record<Platform, { title: string; items: string[]; link?: { href: string; label: string } }> = {
    windows: {
      title: 'Windows (Chrome or Edge)',
      items: [
        'Open Windows Settings → Time & language → Language & region. (Use the button below to open it.)',
        'Click “Add a language”, choose Tamil (தமிழ்), press Next, and keep “Text-to-speech” ticked. Press Install.',
        'Wait for the install to finish (a few minutes). Then close ALL Chrome windows and open Chrome again.',
        'Open the ERP, press Help, and press “Check again” here.',
      ],
      link: { href: 'ms-settings:regionlanguage', label: 'Open Windows language settings' },
    },
    android: {
      title: 'Android',
      items: [
        'Open Settings → System → Languages → Text-to-speech output.',
        'Choose “Google Text-to-speech Engine” → Settings → Install voice data → Tamil (India).',
        'Update the Google Text-to-speech app in Play Store if Tamil is not listed. Then reopen Chrome and press “Check again”.',
      ],
    },
    ios: {
      title: 'iPhone / iPad',
      items: ['Open Settings → Accessibility → Spoken Content → Voices → Tamil, and download a voice.', 'Reopen the browser and press “Check again”.'],
    },
    mac: {
      title: 'Mac',
      items: ['Open System Settings → Accessibility → Spoken Content → System voice → Manage Voices → Tamil, and download a voice.', 'Restart the browser and press “Check again”.'],
    },
    other: { title: 'Your device', items: ['Install a Tamil text-to-speech voice in your system settings, restart the browser, and press “Check again”.'] },
  };
  const st = steps[platform];

  if (!missing && !open) return null;
  if (typeof document === 'undefined') return null;
  const bar = missing && !hidden && lang === 'ta' && !open;
  return createPortal(
    <>
      {bar && (
        <div role="status" className="fixed inset-x-0 top-0 z-[96] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg" data-voice-ignore>
          <span>Tamil voice is not installed on this device, so Help cannot speak Tamil.</span>
          <button type="button" onClick={() => setOpen(true)} className="rounded-md bg-white px-3 py-1 text-xs font-bold text-amber-700 hover:bg-amber-50">How to install</button>
          <button type="button" aria-label="Hide for a week" title="Hide for a week" onClick={hide} className="rounded p-1 hover:bg-amber-600"><X size={16} /></button>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-[97] flex items-center justify-center bg-slate-900/50 p-4" data-voice-ignore onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-label="Install the Tamil voice" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Install the Tamil voice</h2>
                <p className="text-xs text-slate-500">{st.title}. One-time setup; after that every Tamil answer is spoken.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
              {st.items.map((i) => <li key={i}>{i}</li>)}
            </ol>
            {st.link && (
              <a href={st.link.href} className="mt-3 inline-flex rounded-lg bg-orange-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-orange-700">{st.link.label}</a>
            )}
            <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
              Faster option: open the ERP in <b>Microsoft Edge</b>. It already includes natural Tamil voices, so nothing needs to be installed.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs">
                {checked === 'found' && <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 size={14} />Tamil voice found{found ? `: ${found}` : ''}. You can close this.</span>}
                {checked === 'missing' && <span className="font-semibold text-amber-700">Not found yet. After installing, close every browser window and open it again.</span>}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={recheck} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Check again</button>
                <button type="button" onClick={() => { setOpen(false); hide(); }} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">Remind me later</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
// Tells the rest of the page the voice list changed (the Voice dropdown re-reads it).
const setVoiceTickGlobal = () => { try { window.dispatchEvent(new Event('voiceschanged')); } catch { /* ignore */ } };

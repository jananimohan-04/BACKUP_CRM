// Speak in Tamil / Hindi, type in English. Three steps, all in the browser (no server, no keys):
//  1. Command and field words in the spoken language are swapped for their English names (save, cancel, quantity...).
//  2. Whatever is left in another script is translated with Chrome's built-in Translator when it has that language.
//  3. If it does not, Tamil is written out letter by letter in English (a sound-alike), so names still come out readable.

export type SpeechLang = 'en-IN' | 'ta-IN' | 'hi-IN';

const KEYWORDS: Record<'ta-IN' | 'hi-IN', [string, string][]> = {
  'ta-IN': [
    ['சேமிக்கவும்', 'save'], ['சேமிக்க', 'save'], ['சேமி', 'save'], ['சப்மிட்', 'submit'], ['சமர்ப்பி', 'submit'],
    ['ரத்து செய்', 'cancel'], ['ரத்துசெய்', 'cancel'], ['ரத்து', 'cancel'], ['மூடு', 'close'],
    ['அடுத்த புலம்', 'next'], ['அடுத்து', 'next'], ['முந்தைய', 'previous'], ['பின்னே', 'previous'],
    ['அழிக்கவும்', 'clear'], ['அழி', 'clear'], ['நீக்கு', 'clear'],
    ['கேட்பதை நிறுத்து', 'stop listening'], ['நிறுத்து', 'stop listening'],
    ['மற்றொன்று சேமி', 'save and add another'],
    ['நிறுவனம்', 'company'], ['கம்பெனி', 'company'], ['நிறுவன பெயர்', 'company'], ['வாடிக்கையாளர்', 'company'],
    ['எண்ணிக்கை', 'quantity'], ['அளவு', 'quantity'], ['விலை', 'price'], ['தொகை', 'amount'],
    ['தேதி', 'date'], ['பெயர்', 'name'], ['மின்னஞ்சல்', 'email'], ['தொலைபேசி', 'phone'], ['கைபேசி', 'phone'], ['மொபைல்', 'phone'],
    ['குறிப்பு', 'remarks'], ['குறிப்புகள்', 'remarks'], ['வகை', 'category'], ['முகவரி', 'address'], ['நகரம்', 'city'],
    ['பொருள் பெயர்', 'part name'], ['பாகம் பெயர்', 'part name'], ['பொருள்', 'product'], ['பாகம்', 'part'],
    ['புதிய விசாரணை', 'new enquiry'], ['புதிய ஆர்டர்', 'new sales order'], ['இன்று', 'today'], ['நாளை', 'tomorrow'],
  ],
  'hi-IN': [
    ['सेव करें', 'save'], ['सेव', 'save'], ['सहेजें', 'save'], ['जमा करें', 'submit'], ['सबमिट', 'submit'],
    ['रद्द करें', 'cancel'], ['रद्द', 'cancel'], ['बंद करें', 'close'], ['बंद', 'close'],
    ['अगला', 'next'], ['पिछला', 'previous'], ['साफ करें', 'clear'], ['साफ', 'clear'], ['हटाएं', 'clear'],
    ['सुनना बंद करो', 'stop listening'],
    ['कंपनी', 'company'], ['कम्पनी', 'company'], ['ग्राहक', 'company'], ['मात्रा', 'quantity'], ['संख्या', 'quantity'],
    ['कीमत', 'price'], ['दाम', 'price'], ['राशि', 'amount'], ['तारीख', 'date'], ['नाम', 'name'], ['ईमेल', 'email'],
    ['फोन', 'phone'], ['मोबाइल', 'phone'], ['टिप्पणी', 'remarks'], ['श्रेणी', 'category'], ['पता', 'address'], ['शहर', 'city'],
    ['पार्ट नाम', 'part name'], ['उत्पाद', 'product'], ['आज', 'today'], ['कल', 'tomorrow'],
  ],
};

const TA_CONS: Record<string, string> = {
  'க': 'k', 'ங': 'ng', 'ச': 's', 'ஞ': 'nj', 'ட': 't', 'ண': 'n', 'த': 'th', 'ந': 'n', 'ப': 'p', 'ம': 'm', 'ய': 'y', 'ர': 'r',
  'ல': 'l', 'வ': 'v', 'ழ': 'zh', 'ள': 'l', 'ற': 'r', 'ன': 'n', 'ஜ': 'j', 'ஷ': 'sh', 'ஸ': 's', 'ஹ': 'h',
};
const TA_VOWEL: Record<string, string> = { 'அ': 'a', 'ஆ': 'aa', 'இ': 'i', 'ஈ': 'ee', 'உ': 'u', 'ஊ': 'oo', 'எ': 'e', 'ஏ': 'e', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'o', 'ஔ': 'au', 'ஃ': 'h' };
const TA_SIGN: Record<string, string> = { 'ா': 'aa', 'ி': 'i', 'ீ': 'ee', 'ு': 'u', 'ூ': 'oo', 'ெ': 'e', 'ே': 'e', 'ை': 'ai', 'ொ': 'o', 'ோ': 'o', 'ௌ': 'au' };
const PULLI = '்';

/** Tamil script -> English letters (sound-alike). Other characters pass through. */
export function transliterateTamil(text: string): string {
  let out = '';
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (TA_CONS[c] !== undefined) {
      const nx = chars[i + 1];
      if (nx === PULLI) { out += TA_CONS[c]; i++; }
      else if (nx && TA_SIGN[nx] !== undefined) { out += TA_CONS[c] + TA_SIGN[nx]; i++; }
      else out += TA_CONS[c] + 'a';
    } else if (TA_VOWEL[c] !== undefined) out += TA_VOWEL[c];
    else out += c;
  }
  return out.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

const NON_LATIN = /[^\u0000-ɏ\s\d.,@&/()+\-:%₹]+(?:\s+[^\u0000-ɏ\s\d.,@&/()+\-:%₹]+)*/g;

type Translator = { translate: (t: string) => Promise<string> };
const translators = new Map<string, Promise<Translator | null>>();

function getTranslator(source: string): Promise<Translator | null> {
  let p = translators.get(source);
  if (!p) {
    p = (async () => {
      const T = (globalThis as any).Translator;
      if (!T?.create) return null;
      try {
        const a = await T.availability({ sourceLanguage: source, targetLanguage: 'en' });
        if (a === 'unavailable') return null;
        return (await T.create({ sourceLanguage: source, targetLanguage: 'en' })) as Translator;
      } catch { return null; }
    })();
    translators.set(source, p);
  }
  return p;
}

/** Call from a click so the browser may download the language model the first time. */
export function prepareTranslator(lang: SpeechLang) {
  if (lang === 'en-IN') return;
  void getTranslator(lang.slice(0, 2));
}

/** What was said (in `lang`) as English text ready for the voice commands / fields. */
export async function toEnglish(text: string, lang: SpeechLang, translate: boolean): Promise<string> {
  if (lang === 'en-IN') return text;
  let t = text;
  // Longest keywords first so "ரத்து செய்" wins over "ரத்து".
  const words = [...KEYWORDS[lang as 'ta-IN' | 'hi-IN']].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of words) t = t.split(from).join(` ${to} `);
  t = t.replace(/\s+/g, ' ').trim();
  if (!translate) return t;
  const runs = t.match(NON_LATIN);
  if (!runs) return t;
  const tr = await getTranslator(lang.slice(0, 2));
  for (const run of new Set(runs)) {
    let eng = '';
    if (tr) { try { eng = (await tr.translate(run)).trim(); } catch { eng = ''; } }
    if (!eng) eng = lang === 'ta-IN' ? transliterateTamil(run) : run;
    t = t.split(run).join(eng);
  }
  return t.replace(/\s+/g, ' ').trim();
}

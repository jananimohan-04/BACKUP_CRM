// Voice control helpers: find the form fields on screen, fill them from what was said, and press
// the buttons a spoken command names. Pure DOM code, so it works on every form without touching them.

export type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

export const norm = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[*:₹%]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** "fifty", "two hundred and fifty", "1,500", "rupees 200" -> number (or null). */
export function spokenNumber(text: string): number | null {
  const digits = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (digits) return Number(digits[0]);
  let total = 0, current = 0, seen = false;
  for (const w of norm(text).split(' ')) {
    if (w in WORD_NUM) { current += WORD_NUM[w]; seen = true; }
    else if (w === 'hundred') { current = (current || 1) * 100; seen = true; }
    else if (w === 'thousand') { total += (current || 1) * 1000; current = 0; seen = true; }
    else if (w === 'lakh' || w === 'lakhs') { total += (current || 1) * 100000; current = 0; seen = true; }
  }
  return seen ? total + current : null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "today", "tomorrow", "15 october 2026", "15 10 2026" -> yyyy-mm-dd (or null). */
export function spokenDate(text: string): string | null {
  const t = norm(text).replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');
  const now = new Date();
  if (t === 'today') return ymd(now);
  if (t === 'tomorrow') return ymd(new Date(now.getTime() + 86400000));
  if (t === 'yesterday') return ymd(new Date(now.getTime() - 86400000));
  let m = /^(\d{1,2}) ([a-z]+) ?(\d{4})?$/.exec(t);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m![2].slice(0, 3)));
    if (mi >= 0) return `${m[3] ?? now.getFullYear()}-${pad(mi + 1)}-${pad(Number(m[1]))}`;
  }
  m = /^([a-z]+) (\d{1,2}) ?(\d{4})?$/.exec(t);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m![1].slice(0, 3)));
    if (mi >= 0) return `${m[3] ?? now.getFullYear()}-${pad(mi + 1)}-${pad(Number(m[2]))}`;
  }
  m = /^(\d{1,2}) (\d{1,2}) (\d{4})$/.exec(t);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return null;
}

const visible = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
};

/** The part of the page the voice commands act on: the top-most open popup, else the whole page. */
export function activeScope(): HTMLElement {
  const popups = Array.from(document.querySelectorAll<HTMLElement>('div.fixed.inset-0')).filter((d) => visible(d) && d.querySelector('input,select,textarea,button'));
  return popups[popups.length - 1] ?? document.body;
}

export function listFields(scope: HTMLElement): Field[] {
  return Array.from(scope.querySelectorAll<Field>('input, textarea, select')).filter((el) => {
    if (el.closest('[data-voice-ignore]')) return false;
    if (el instanceof HTMLInputElement && ['hidden', 'file', 'checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(el.type)) return false;
    return !el.disabled && !(el as HTMLInputElement).readOnly && visible(el);
  });
}

const shortText = (s: string | null | undefined) => (s && s.trim().length > 0 && s.trim().length <= 40 ? norm(s) : '');

/** Every name a person might use for a field: its label, placeholder, title, or the caption beside it. */
export function fieldLabels(el: Field): string[] {
  const out = new Set<string>();
  const add = (s: string) => { if (s) out.add(s); };
  add(shortText(el.getAttribute('aria-label')));
  add(shortText(el.getAttribute('placeholder')));
  add(shortText(el.getAttribute('title')));
  if (el.id) add(shortText(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent));
  const wrap = el.closest('label');
  if (wrap) add(shortText(Array.from(wrap.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ')));
  // Caption just before the field (FormField puts a label / span before the control).
  let prev = el.previousElementSibling;
  for (let i = 0; i < 2 && prev; i++, prev = prev.previousElementSibling) {
    if (['SPAN', 'LABEL', 'P', 'H4'].includes(prev.tagName) && !prev.querySelector('input,select,textarea')) add(shortText(prev.textContent));
  }
  const cap = el.parentElement?.querySelector(':scope > label, :scope > span');
  if (cap && !cap.contains(el)) add(shortText(cap.textContent));
  const stripped = [...out].map((l) => l.replace(/^e g /, '').trim());
  return [...new Set([...out, ...stripped])].filter(Boolean);
}

const ALIASES: [string, string][] = [['quantity', 'qty'], ['qty', 'quantity'], ['mobile', 'phone'], ['phone number', 'phone'], ['company name', 'company'], ['customer', 'company'], ['rate', 'price'], ['amount', 'price']];

export interface FieldMatch { field: Field; value: string; focusOnly: boolean; label: string }

/** "quantity 50" -> the Qty field with "50". Longest label wins; empty fields win ties. */
export function matchFieldCommand(transcript: string, fields: Field[]): FieldMatch | null {
  const words = transcript.trim().split(/\s+/);
  const lead = new Set(['enter', 'type', 'set', 'fill', 'put', 'write', 'add']);
  const body = lead.has(norm(words[0])) && words.length > 1 ? words.slice(1) : words;
  const variants: string[][] = [body];
  const joined = norm(body.join(' '));
  for (const [a, b] of ALIASES) if (joined.startsWith(a + ' ') || joined === a) variants.push((b + ' ' + body.slice(a.split(' ').length).join(' ')).trim().split(/\s+/));
  if (/^(reference|ref|phone|mobile|contact|invoice|dc|gst|pan|hsn|order|part|po) number\b/.test(joined)) {
    variants.push(body.map((w, i) => (i === 1 && norm(w) === 'number' ? 'no' : w)));
  }
  // Short names ("date" for "Inward Date", "reference" for "Reference No."): only when exactly one field has it.
  const labelsOf = new Map<Field, string[]>(fields.map((f) => [f, fieldLabels(f)]));
  const shortCount = new Map<string, number>();
  const shortsOf = (labels: string[]) => [...new Set(labels.flatMap((l) => { const w = l.split(' '); return w.length > 1 ? [w[w.length - 1], w[0]] : []; }).filter((s) => s.length >= 3 && !['name', 'no', 'the', 'new'].includes(s)))];
  for (const f of fields) for (const s of shortsOf(labelsOf.get(f)!)) shortCount.set(s, (shortCount.get(s) ?? 0) + 1);
  let best: (FieldMatch & { score: number }) | null = null;
  for (const f of fields) {
    const labels = labelsOf.get(f)!;
    const candidates = [...labels.map((l) => ({ l, weak: false })), ...shortsOf(labels).filter((s) => shortCount.get(s) === 1 && !labels.includes(s)).map((l) => ({ l, weak: true }))];
    for (const { l: label, weak } of candidates) {
      const lw = label.split(' ');
      for (const v of variants) {
        const vn = v.map(norm);
        if (vn.length < lw.length || !lw.every((w, i) => vn[i] === w)) continue;
        const rest = v.slice(lw.length).join(' ').trim();
        const score = lw.length * 10 + (f.value ? 0 : 1) + (rest ? 0 : -5) - (weak ? 4 : 0);
        if (!best || score > best.score) best = { field: f, value: rest, focusOnly: rest === '', label, score };
      }
    }
  }
  return best;
}

function setNative(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Put spoken text into a field in the form that field expects. Returns what was entered, or null if it did not fit. */
export function fillField(el: Field, spoken: string, mode: 'replace' | 'append' = 'replace'): string | null {
  const text = spoken.trim();
  if (!text) return null;
  if (el instanceof HTMLSelectElement) {
    const t = norm(text);
    const opts = Array.from(el.options);
    const hit = opts.find((o) => norm(o.text) === t) ?? opts.find((o) => norm(o.text).includes(t)) ?? opts.find((o) => t.includes(norm(o.text)) && norm(o.text));
    if (!hit) return null;
    setNative(el, hit.value);
    return hit.text;
  }
  const type = el instanceof HTMLInputElement ? el.type : 'text';
  const labels = fieldLabels(el).join(' ');
  let value = text;
  if (type === 'number') {
    const n = spokenNumber(text);
    if (n === null) return null;
    value = String(n);
  } else if (type === 'date') {
    const d = spokenDate(text);
    if (!d) return null;
    value = d;
  } else if (type === 'email' || /\bemail\b/.test(labels)) {
    value = text.toLowerCase().replace(/\s+at(\s+the\s+rate)?\s+/g, '@').replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
  } else if (type === 'tel' || /\b(phone|mobile|contact no)\b/.test(labels)) {
    const n = text.replace(/\D/g, '');
    value = n || text;
  } else if (mode === 'append' && el.value) {
    value = `${el.value} ${text}`;
  } else {
    value = text.charAt(0).toUpperCase() + text.slice(1);
  }
  setNative(el, value);
  return value;
}

export function clearField(el: Field) {
  setNative(el, el instanceof HTMLSelectElement ? (el.options[0]?.value ?? '') : '');
}

const buttonText = (b: HTMLElement) => norm(b.textContent || b.getAttribute('aria-label') || b.getAttribute('title'));

const SAVE_ORDER = [/^submit$/, /^save( [a-z]+)?$/, /^create( [a-z]+)*$/, /^(add|update|confirm|approve|done|send)( [a-z]+)*$/];

/** Press the form's main button (Save / Submit / ...). Returns the button's label, or null. */
export function pressSave(scope: HTMLElement, another = false): string | null {
  const btns = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).filter((b) => !b.disabled && visible(b));
  if (another) {
    const b = btns.find((x) => /another|and add|and new/.test(buttonText(x)));
    if (b) { b.click(); return b.textContent?.trim() ?? 'Save and add another'; }
    return null;
  }
  for (const rx of SAVE_ORDER) {
    const b = btns.find((x) => { const t = buttonText(x); return rx.test(t) && !/another|cancel|close|clear|reset/.test(t); });
    if (b) { b.click(); return b.textContent?.trim() || 'Save'; }
  }
  return null;
}

export function pressCancel(scope: HTMLElement): boolean {
  const btns = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).filter((b) => !b.disabled && visible(b));
  const b = btns.find((x) => /^(cancel|close|discard|back)$/.test(buttonText(x)))
    ?? btns.find((x) => /^(cancel|close)/.test(buttonText(x)))
    ?? btns.find((x) => x.querySelector('svg') && !buttonText(x) && x.closest('div.fixed.inset-0') && /close|×|x/.test((x.getAttribute('aria-label') ?? 'x').toLowerCase()));
  if (!b) return false;
  b.click();
  return true;
}

/** "new enquiry" / "add sales order": press a visible Add / New / Create button that names it. */
export function pressOpen(what: string): string | null {
  const t = norm(what);
  if (!t) return null;
  const cands = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role=button]')).filter((b) => visible(b) && !(b as HTMLButtonElement).disabled);
  const hit = cands.find((b) => { const x = buttonText(b); return /^(add|new|create)\b/.test(x) && x.includes(t); })
    ?? cands.find((b) => { const x = buttonText(b); return x === t || x.startsWith(t + ' '); });
  if (!hit) return null;
  hit.click();
  return hit.textContent?.trim() || what;
}

export function focusStep(scope: HTMLElement, from: Element | null, dir: 1 | -1): Field | null {
  const fields = listFields(scope);
  if (!fields.length) return null;
  const i = from ? fields.indexOf(from as Field) : -1;
  const next = fields[i < 0 ? (dir === 1 ? 0 : fields.length - 1) : (i + dir + fields.length) % fields.length];
  next.focus();
  if (next instanceof HTMLInputElement && next.type !== 'date' && next.type !== 'number') next.select?.();
  return next;
}

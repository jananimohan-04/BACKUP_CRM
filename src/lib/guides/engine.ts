// Guided walkthroughs: what to type, why, and where it is saved. Pure helpers (no React) so the lookup rules are testable.

/** A text in English, or [English, Tamil]. Tanglish speakers get the English text. */
export type Bi = string | [string, string];
export type GuideLang = 'ta' | 'tanglish' | 'en';

export const pick = (b: Bi | undefined, lang: GuideLang): string => (b == null ? '' : typeof b === 'string' ? b : lang === 'ta' ? b[1] || b[0] : b[0]);

/** Where on screen a step points. Everything is matched by the words the user can see, so the real forms need no changes. */
export interface Target {
  /** A field label ("Company Name"): points at the input / dropdown that belongs to it. */
  label?: string;
  /** A button or link text ("Save Company"). */
  button?: string;
  /** Any visible text (a heading, a column title, a tab). */
  text?: string;
  /** An input by its placeholder text ("Product Name"). */
  placeholder?: string;
  /** A CSS selector, when the words are not enough. */
  css?: string;
}

export interface GuideStep {
  target?: Target;
  title: Bi;
  /** What to enter or do here. */
  say: Bi;
  /** Why it is needed. */
  why?: Bi;
  /** Where it is kept / what it feeds. */
  saves?: Bi;
  /** Clicked automatically before the step is shown (to open a form / tab). Text of a button. */
  open?: string;
  /**
   * The step waits for the person to click this button; when they do (and the form closed / was accepted),
   * a glowing dot flies from the button to the menu / tab where the record now lives.
   */
  onSave?: { button: string; flyTo: string; caption: Bi; /** For a form that stays on the page: text that appears on screen only when the save worked (e.g. "saved"). */ okText?: string };
}

export interface Guide {
  id: string;
  title: Bi;
  /** Short line shown in the picker. */
  blurb?: Bi;
  match: {
    /** Matches location.pathname (string = prefix). */
    route: string | RegExp;
    /** The guide belongs to a pop-up whose title contains this text (case-insensitive). Without it, no pop-up may be open. */
    modal?: string;
  };
  steps: GuideStep[];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[*:]+$/g, '').trim().toLowerCase();
const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };

/** The pop-up on top, if any. */
export function topDialog(doc: Document = document): HTMLElement | null {
  const all = [...doc.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(visible);
  return all.length ? all[all.length - 1] : null;
}

export function dialogTitle(dlg: HTMLElement | null): string {
  if (!dlg) return '';
  const h = dlg.querySelector('h1,h2,h3');
  return (h?.textContent ?? '').trim();
}

const ownText = (el: Element) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent ?? '').join(' ');

/** The element a target points at, or null when it is not on screen. */
export function findTarget(t: Target | undefined, doc: Document = document): HTMLElement | null {
  if (!t) return null;
  const scope: ParentNode = topDialog(doc) ?? doc;
  const scopes: ParentNode[] = scope === doc ? [doc] : [scope, doc];
  for (const s of scopes) {
    if (t.placeholder) {
      const want = t.placeholder.toLowerCase();
      const el = [...s.querySelectorAll<HTMLElement>('input,textarea,select')].filter(visible).find(e => (e.getAttribute('placeholder') ?? '').toLowerCase().includes(want));
      if (el) return el;
      continue;
    }
    if (t.css) { const el = s.querySelector<HTMLElement>(t.css); if (el && visible(el)) return el; continue; }
    if (t.button) {
      const want = norm(t.button);
      const els = [...s.querySelectorAll<HTMLElement>('button,a,[role="button"],[role="tab"]')].filter(visible);
      const hit = els.find(e => norm(e.textContent ?? '') === want) ?? els.find(e => norm(e.textContent ?? '').includes(want));
      if (hit) return hit;
      continue;
    }
    if (t.label) {
      const want = norm(t.label);
      const labels = [...s.querySelectorAll<HTMLElement>('label,span,p,legend,th,h3,h4,div')].filter(visible)
        .filter(e => { const own = norm(ownText(e)) || (e.children.length === 0 ? norm(e.textContent ?? '') : ''); return own === want || (own !== '' && own.startsWith(want) && own.length <= want.length + 3); });
      for (const lab of labels) {
        let box: HTMLElement | null = lab.parentElement;
        for (let i = 0; i < 3 && box; i++, box = box.parentElement) {
          const ctl = [...box.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]),select,textarea')].find(visible);
          if (ctl) return ctl;
        }
        const forId = lab.getAttribute('for');
        if (forId) { const c = doc.getElementById(forId); if (c && visible(c)) return c; }
      }
      if (labels[0]) return labels[0];
      continue;
    }
    if (t.text) {
      const want = norm(t.text);
      const els = [...s.querySelectorAll<HTMLElement>('*')].filter(e => e.children.length === 0 && visible(e) && norm(e.textContent ?? '').includes(want));
      const exact = els.find(e => norm(e.textContent ?? '') === want);
      if (exact || els[0]) return (exact ?? els[0]);
    }
  }
  return null;
}

/** Whether a guide applies to this page / pop-up. */
export function guideMatches(g: Guide, pathname: string, dialog: string): boolean {
  const r = g.match.route;
  const routeOk = typeof r === 'string' ? pathname === r || pathname.startsWith(r.endsWith('/') ? r : `${r}/`) || pathname === r : r.test(pathname);
  if (!routeOk) return false;
  if (g.match.modal) return dialog.toLowerCase().includes(g.match.modal.toLowerCase());
  return dialog === '';
}

/** Guides for the current screen, pop-up guides first. */
export function guidesFor(all: Guide[], pathname: string, dialog: string): Guide[] {
  return all.filter(g => guideMatches(g, pathname, dialog)).sort((a, b) => (b.match.modal ? 1 : 0) - (a.match.modal ? 1 : 0));
}

/** The text read aloud for a step. */
export function stepSpeech(s: GuideStep, lang: GuideLang): string {
  return [pick(s.say, lang), s.why ? (lang === 'ta' ? 'ஏன்: ' : 'Why: ') + pick(s.why, lang) : '', s.saves ? (lang === 'ta' ? 'சேமிக்கப்படும் இடம்: ' : 'Saved in: ') + pick(s.saves, lang) : '']
    .filter(Boolean).join(' ');
}

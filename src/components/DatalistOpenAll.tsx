import { useEffect } from 'react';

// A text box with a dropdown list (<input list="...">) only offers the entries that match what is already typed, so
// once a product is chosen the list shrinks to that one entry. Here every such box shows the FULL list again when it
// is clicked or focused, like a normal dropdown: the current value is parked in the placeholder while the box is
// open, and put back when the box is left without choosing or typing anything. Choosing an entry or typing
// (including clearing the box) works exactly as before, because those still fire the normal input event.

const PARKED = 'dlOpenAllPrev';
const PARKED_PH = 'dlOpenAllPh';

const isListBox = (el: EventTarget | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && el.hasAttribute('list') && (el.type === 'text' || el.type === 'search' || el.type === '') && !el.readOnly && !el.disabled;

function park(el: HTMLInputElement) {
  if (!el.value || el.dataset[PARKED] !== undefined) return;
  el.dataset[PARKED] = el.value;
  el.dataset[PARKED_PH] = el.placeholder;
  el.placeholder = el.value;
  el.value = '';
}

function restore(el: HTMLInputElement) {
  const prev = el.dataset[PARKED];
  if (prev === undefined) return;
  const ph = el.dataset[PARKED_PH] ?? '';
  delete el.dataset[PARKED];
  delete el.dataset[PARKED_PH];
  el.placeholder = ph;
  if (el.value === '') el.value = prev;
}

export function DatalistOpenAll() {
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => { if (isListBox(e.target)) park(e.target); };
    const onClick = (e: MouseEvent) => { if (isListBox(e.target) && document.activeElement === e.target) park(e.target); };
    // The person chose an entry or typed / deleted something: keep exactly what they did.
    const onInput = (e: Event) => {
      if (!isListBox(e.target)) return;
      delete e.target.dataset[PARKED];
      if (e.target.dataset[PARKED_PH] !== undefined) { e.target.placeholder = e.target.dataset[PARKED_PH] ?? ''; delete e.target.dataset[PARKED_PH]; }
    };
    const onFocusOut = (e: FocusEvent) => { if (isListBox(e.target)) restore(e.target); };
    // Backspace / Delete while the old value is parked means "clear this box": make it a real, empty value.
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target;
      if (!isListBox(el) || el.dataset[PARKED] === undefined) return;
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const prev = el.dataset[PARKED] ?? '';
      el.placeholder = el.dataset[PARKED_PH] ?? '';
      delete el.dataset[PARKED];
      delete el.dataset[PARKED_PH];
      // React only reports a change when the value differs from the one it last saw: show it the old value again, then
      // set the box to empty behind its back and fire the event.
      el.value = prev;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
  return null;
}

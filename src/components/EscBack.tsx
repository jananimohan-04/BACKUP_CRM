import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Esc goes back to the page that was used before this one, from anywhere in the app. It stays out of the way of
// everything else Esc already does: it does nothing while a popup / menu / dropdown is open (that Esc closes it),
// while you are typing in a box (the first Esc there just leaves the box), or when there is no earlier page to go back to.

const OPEN_LAYER = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [aria-haspopup][aria-expanded="true"], [data-floating-menu][data-open="true"]';
const STORE = 'argus.esc.pages';

// The pages visited, newest last. Kept for the whole browser session (not in a component), so it survives the layout
// being rebuilt (for example when the sign-in is refreshed) and a page reload.
function readStack(): string[] {
  try { const v = JSON.parse(sessionStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
function writeStack(s: string[]) {
  try { sessionStorage.setItem(STORE, JSON.stringify(s.slice(-50))); } catch { /* storage unavailable: the shortcut then falls back to browser history */ }
}

export function EscBack() {
  const location = useLocation();
  const navigate = useNavigate();

  // Remember every page as it is opened (a page repeated straight away counts once).
  useEffect(() => {
    const s = readStack();
    if (s[s.length - 1] === location.pathname) return;
    // Arriving at the page before the current one (browser Back button) steps back through the list instead of adding to it.
    if (s.length >= 2 && s[s.length - 2] === location.pathname) s.pop();
    else s.push(location.pathname);
    writeStack(s);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      // In a box: the first Esc only leaves the box (so you can press Esc again to go back); it never leaves the page while typing.
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) {
        if (t.tagName !== 'SELECT') (t as HTMLElement).blur();
        return;
      }
      // Checked right now, while the popup is still on screen: the Esc that closes a popup must not also leave the page.
      if (document.querySelector(OPEN_LAYER)) return;
      const s = readStack();
      if (s.length >= 2) {
        s.pop(); // leave this page
        const back = s[s.length - 1];
        writeStack(s);
        if (back) navigate(back);
        return;
      }
      // Nothing recorded yet (for example right after opening the app on a deep link): use the browser's own history.
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) navigate(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);

  return null;
}

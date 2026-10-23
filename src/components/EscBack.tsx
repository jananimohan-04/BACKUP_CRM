import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Esc goes back to the page that was used before this one, from anywhere in the app. It stays out of the way of
// everything else Esc already does: it does nothing while a popup / menu / dropdown is open (that Esc closes it),
// while you are typing in a box (Esc there is for the box), or when there is no earlier page to go back to.

const OPEN_LAYER = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [aria-haspopup][aria-expanded="true"], [data-floating-menu][data-open="true"]';

export function EscBack() {
  const location = useLocation();
  const navigate = useNavigate();
  // The pages visited in this session, newest last (a page repeated straight away is counted once).
  const stack = useRef<string[]>([]);
  useEffect(() => {
    const here = location.pathname;
    const s = stack.current;
    if (s[s.length - 1] !== here) s.push(here);
    if (s.length > 50) s.shift();
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (document.querySelector(OPEN_LAYER)) return;
      const s = stack.current;
      if (s.length < 2) return;
      s.pop(); // leave this page
      const back = s[s.length - 1];
      if (back) navigate(back);
    };
    // Run after the popups' own Esc handlers so a popup that is closing is not mistaken for "nothing open".
    const handler = (e: KeyboardEvent) => { window.setTimeout(() => onKey(e), 0); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [navigate]);

  return null;
}

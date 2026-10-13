import { useEffect, type RefObject } from 'react';

/**
 * Ensures clean table scrolling without creating nested vertical scroll traps or clipping.
 *
 * Horizontal scrolling (`overflow-x: auto`) is preserved on table containers so wide tables
 * scroll smoothly horizontally without overflowing cards, while vertical scrolling uses
 * normal document/page flow on <main> without artificial height constraints or row overlap.
 */
export function useStickyTableHeads(ref: RefObject<HTMLElement | null>, routeKey: string) {
  useEffect(() => {
    const main = ref.current;
    if (!main) return;

    // Clean up any previously applied artificial height or nested scroll styles
    const cleanup = () => {
      main.querySelectorAll<HTMLElement>('[data-sticky-box="1"]').forEach(el => {
        el.style.overflowY = '';
        el.style.maxHeight = '';
        delete el.dataset.stickyBox;
      });
      main.querySelectorAll<HTMLTableElement>('[data-sticky-head="1"]').forEach(table => {
        delete table.dataset.stickyHead;
      });
    };

    cleanup();

    const observer = new MutationObserver(cleanup);
    observer.observe(main, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cleanup();
    };
  }, [ref, routeKey]);
}

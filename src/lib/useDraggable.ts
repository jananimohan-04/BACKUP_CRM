import { useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';

// Lets a floating button be dragged anywhere on the page. Its spot is remembered (per browser).
// Put `bind` on the part you grab, attach `rootRef` + `style` to the thing that moves, and in the button's onClick return
// early when `wasDragged()` is true so letting go of a drag does not also count as a click.
type Pos = { x: number; y: number };

export function useDraggable(storeKey: string, rootRef: RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<Pos | null>(() => {
    try { const p = JSON.parse(localStorage.getItem(storeKey) || 'null'); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; } catch { return null; }
  });
  const start = useRef<{ dx: number; dy: number; sx: number; sy: number } | null>(null);
  const moved = useRef(false);
  const latest = useRef<Pos | null>(pos);

  const onPointerDown = (e: RPointerEvent<HTMLElement>) => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    start.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
    moved.current = false;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  };
  const onPointerMove = (e: RPointerEvent<HTMLElement>) => {
    const s = start.current;
    const el = rootRef.current;
    if (!s || !el) return;
    if (!moved.current && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) < 5) return; // a small wobble is still a click
    moved.current = true;
    const next = {
      x: Math.min(Math.max(0, e.clientX - s.dx), Math.max(0, window.innerWidth - el.offsetWidth)),
      y: Math.min(Math.max(0, e.clientY - s.dy), Math.max(0, window.innerHeight - el.offsetHeight)),
    };
    latest.current = next;
    setPos(next);
  };
  const onPointerUp = () => {
    if (moved.current && latest.current) { try { localStorage.setItem(storeKey, JSON.stringify(latest.current)); } catch { /* not remembered */ } }
    start.current = null;
  };
  /** True once after a drag, so the click that follows the drop can be ignored. */
  const wasDragged = () => { const m = moved.current; moved.current = false; return m; };

  const style = pos
    ? { left: Math.min(pos.x, Math.max(0, window.innerWidth - 60)), top: Math.min(pos.y, Math.max(0, window.innerHeight - 50)), right: 'auto', bottom: 'auto' } as const
    : undefined;
  return { pos, style, bind: { onPointerDown, onPointerMove, onPointerUp }, wasDragged };
}

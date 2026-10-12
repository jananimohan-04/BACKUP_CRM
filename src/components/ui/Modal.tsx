import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';

// Light scrim only: the page behind stays clearly visible (never blurred).
const SCRIM = 'bg-[rgba(15,23,42,0.12)]';

// Consistent desktop defaults; always clamped into the viewport.
const MIN_W = 600;
const MAX_W = 1100;
const MIN_H = 400;
const MAX_H = 850;

const initialWidth = (size: string, vw: number, width?: number): number => {
  const preset =
    size === 'sm' ? 520 :
    size === 'md' ? 640 :
    size === 'lg' ? 860 :
    size === 'xl' ? 1024 :
    size === 'full' ? vw - 64 :
    MAX_W; // 2xl, 3xl
  const base = width ?? preset;
  return Math.min(Math.max(base, Math.min(MIN_W, vw - 32)), Math.min(MAX_W, vw - 32));
};

const clampWidth = (w: number, vw: number): number =>
  Math.min(Math.max(w, Math.min(MIN_W, vw - 32)), Math.min(MAX_W, vw - 32));

const clampHeight = (h: number, vh: number): number =>
  Math.min(Math.max(h, Math.min(MIN_H, vh - 32)), Math.min(MAX_H, vh * 0.9, vh - 32));

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  width,
  draggable = true,
  isDirty = false,
  dirtyMessage = 'Discard unsaved changes?',
  inline = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full';
  /** Starting width in px; overrides the size preset. */
  width?: number;
  /** Header drag handle. Disable only for flows that must stay centered. */
  draggable?: boolean;
  /** External dirty flag (OR-ed with automatic form-interaction tracking). */
  isDirty?: boolean;
  dirtyMessage?: string;
  /**
   * Inline mode: the same title / body / footer chrome is rendered as a normal card in the
   * page flow (no backdrop, no overlay, no page scroll lock) so the form can sit above its
   * table. Everything else - field markup, footer buttons, handlers - is unchanged.
   */
  inline?: boolean;
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dim, setDim] = useState<{ w: number; h: number | null }>({ w: 640, h: null });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; w: number; h: number; dir: 'se' | 'e' | 's' } | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const movedRef = useRef(false);

  const dirty = isDirty || touched;

  // Every open starts centered at the default size; position is kept until close.
  useEffect(() => {
    if (open) {
      const vw = window.innerWidth;
      setDim({ w: initialWidth(size, vw, width), h: null });
      setTouched(false);
      setConfirming(false);
      setDragging(false);
      setResizing(false);
      movedRef.current = false;
      // Center once laid out (natural height is measured, not assumed).
      requestAnimationFrame(() => {
        const el = boxRef.current;
        const h = el?.offsetHeight ?? 400;
        const vh = window.innerHeight;
        setPos({
          x: Math.max(16, (vw - (el?.offsetWidth ?? initialWidth(size, vw, width))) / 2),
          y: Math.max(16, (vh - h) / 2),
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open ]);

  // ESC closes (or asks, when dirty). Native selects keep their own behavior.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (confirming) {
        setConfirming(false);
        return;
      }
      if (dirty) setConfirming(true);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dirty, confirming, onClose]);

  if (!open) return null;

  // Inline: no backdrop, no overlay, no scroll lock, no drag/resize - just the same
  // header / body / footer laid out as a card so the form flows with the page.
  if (inline) {
    return (
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col" data-testid="inline-form">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider truncate">{title}</h2>
              {subtitle && <p className="text-xs font-medium text-slate-500 mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 bg-slate-50/30 min-h-0">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 shrink-0">
            {footer}
          </div>
        )}
      </section>
    );
  }

  const requestClose = () => {
    if (dirty) setConfirming(true);
    else onClose();
  };

  // Clamp so at least a grabbable portion always stays on screen.
  const clampPos = (x: number, y: number, w: number, h: number | null) => {
    const el = boxRef.current;
    const hh = h ?? el?.offsetHeight ?? 400;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: Math.min(Math.max(x, 120 - w), vw - 120),
      y: Math.min(Math.max(y, -(hh - 56)), vh - 64),
    };
  };

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!draggable) return;
    // Never start a drag from a control inside the header (e.g. the X).
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    movedRef.current = true;
    setPos(clampPos(d.ox + e.clientX - d.sx, d.oy + e.clientY - d.sy, dim.w, dim.h));
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const onResizePointerDown = (dir: 'se' | 'e' | 's') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const el = boxRef.current;
    resizeRef.current = {
      sx: e.clientX, sy: e.clientY,
      w: dim.w, h: dim.h ?? el?.offsetHeight ?? 400, dir,
    };
    setResizing(true);
  };
  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r) return;
    movedRef.current = true;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let w = r.w;
    let h = r.h;
    if (r.dir === 'se' || r.dir === 'e') w = clampWidth(r.w + e.clientX - r.sx, vw);
    if (r.dir === 'se' || r.dir === 's') h = clampHeight(r.h + e.clientY - r.sy, vh);
    setDim({ w, h });
    setPos((p) => clampPos(p.x, p.y, w, h));
  };
  const endResize = () => {
    resizeRef.current = null;
    setResizing(false);
  };

  return (
    <div className={`fixed inset-0 z-50 ${dragging || resizing ? 'select-none' : ''}`}>
      <div
        className={`absolute inset-0 ${SCRIM}`}
        onPointerDown={(e) => { downRef.current = { x: e.clientX, y: e.clientY }; }}
        onClick={(e) => {
          // A press that travelled is a drag across the backdrop, not a close click.
          const d = downRef.current;
          downRef.current = null;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
          requestClose();
        }}
      />
      <div
        ref={boxRef}
        className="absolute"
        style={{
          left: pos.x,
          top: pos.y,
          width: dim.w,
          maxWidth: 'calc(100vw - 2rem)',
          height: dim.h ?? undefined,
          maxHeight: 'min(80vh, 850px)',
        }}
      >
        <div
          className="relative bg-white rounded-2xl shadow-2xl w-full border border-slate-200 flex flex-col animate-scale-in overflow-hidden"
          style={{ height: dim.h ? `${dim.h}px` : undefined, maxHeight: 'min(80vh, 850px)' }}
          onChange={() => setTouched(true)}
        >
          <div
            className={`flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0 select-none ${
              draggable ? 'touch-none' : ''
            } ${draggable ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
            onPointerDown={onHeaderPointerDown}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            title={draggable ? 'Drag to move' : undefined}
          >
            <div className="flex items-center gap-2 min-w-0">
              {draggable && <GripVertical size={15} className="shrink-0 text-slate-300" />}
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider truncate">{title}</h2>
                {subtitle && <p className="text-xs font-medium text-slate-500 mt-0.5 truncate">{subtitle}</p>}
              </div>
            </div>
            <button
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-8 h-8 flex items-center justify-center rounded border border-transparent hover:border-slate-200 hover:bg-white text-slate-500 transition-colors shadow-sm shrink-0"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 bg-slate-50/30 min-h-0">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 shrink-0">
              {footer}
            </div>
          )}
          {/* Resize handles (desktop only). */}
          <div
            className="hidden sm:block absolute bottom-0 right-0 w-2 cursor-ew-resize"
            style={{ top: 0 }}
            onPointerDown={onResizePointerDown('e')}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <div
            className="hidden sm:block absolute bottom-0 left-0 h-2 cursor-ns-resize"
            style={{ right: 0 }}
            onPointerDown={onResizePointerDown('s')}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <div
            className="hidden sm:block absolute bottom-1 right-1 w-4 h-4 cursor-nwse-resize text-slate-300 hover:text-brand-500"
            onPointerDown={onResizePointerDown('se')}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            title="Resize"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 3 L13 13 M5 11 L11 13 M13 5 L13 13 L5 13" opacity="0.9" />
            </svg>
          </div>
        </div>
      </div>
      {confirming && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className={`absolute inset-0 ${SCRIM}`} onClick={() => setConfirming(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm p-6 animate-scale-in">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Discard unsaved changes?</h2>
            <p className="text-sm font-medium text-slate-500 mt-2">{dirtyMessage}</p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setConfirming(false)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-100 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirming(false); onClose(); }}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-white rounded transition-colors shadow-sm bg-red-600 hover:bg-red-700"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <h3 className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-4 border-b border-brand-100 pb-2">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className={`absolute inset-0 ${SCRIM}`} onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm p-6 animate-scale-in">
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">{title}</h2>
        <p className="text-sm font-medium text-slate-500 mt-2">{message}</p>
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-100 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider text-white rounded transition-colors shadow-sm ${
              danger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-brand-600 hover:bg-brand-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FormField({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] font-medium text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'w-full px-3 py-2 text-sm font-medium rounded border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm';

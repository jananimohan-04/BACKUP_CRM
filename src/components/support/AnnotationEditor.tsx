import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Square, Circle, Highlighter, Type, Undo2, Trash2, Check, X } from 'lucide-react';

type Tool = 'arrow' | 'rect' | 'circle' | 'highlight' | 'text';

interface Marking {
  id: string;
  tool: Tool;
  color: string;
  points: { x: number; y: number }[];
  text?: string;
}

const TOOLS: { id: Tool; label: string; Icon: typeof ArrowRight }[] = [
  { id: 'arrow', label: 'Arrow', Icon: ArrowRight },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'highlight', label: 'Highlight', Icon: Highlighter },
  { id: 'text', label: 'Text', Icon: Type },
];

const COLORS = ['#dc2626', '#facc15', '#16a34a', '#2563eb', '#111827'];

const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

/** Draw one marking on a 2d context (coordinates already in that canvas' pixels). */
function paint(ctx: CanvasRenderingContext2D, m: Marking) {
  const [a, b] = m.points;
  if (!a) return;
  ctx.save();
  ctx.strokeStyle = m.color;
  ctx.fillStyle = m.color;
  ctx.lineWidth = m.tool === 'highlight' ? 14 : 3;
  ctx.lineCap = 'round';
  ctx.globalAlpha = m.tool === 'highlight' ? 0.35 : 1;
  if (m.tool === 'rect' || m.tool === 'highlight') {
    if (!b) { ctx.restore(); return; }
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (m.tool === 'highlight') {
      ctx.fillStyle = m.color;
      ctx.fillRect(x, y, Math.max(w, 4), Math.max(h, 10));
    } else {
      ctx.strokeRect(x, y, Math.max(w, 2), Math.max(h, 2));
    }
  } else if (m.tool === 'circle') {
    if (!b) { ctx.restore(); return; }
    ctx.beginPath();
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(Math.abs(b.x - a.x) / 2, 2), Math.max(Math.abs(b.y - a.y) / 2, 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (m.tool === 'arrow') {
    if (!b) { ctx.restore(); return; }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = 14;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
    ctx.stroke();
  } else if (m.tool === 'text') {
    ctx.globalAlpha = 1;
    ctx.font = `bold 22px sans-serif`;
    ctx.fillText(m.text || '', a.x + 4, a.y - 6 > 12 ? a.y - 6 : a.y + 24);
  }
  ctx.restore();
}

/**
 * Screenshot marking: draw arrows, rectangles, circles, highlights and text
 * labels over the uploaded image. Saving renders a NEW annotated PNG — the
 * original file is kept untouched and both are attached to the ticket.
 */
export function AnnotationEditor({ src, onSave, onCancel }: {
  src: string;
  onSave: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState(COLORS[0]);
  const [markings, setMarkings] = useState<Marking[]>([]);
  const [draft, setDraft] = useState<Marking | null>(null);
  const [size, setSize] = useState<{ w: number; h: number; dw: number; dh: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const maxW = 860;
      const scale = Math.min(1, maxW / img.naturalWidth);
      setSize({ w: img.naturalWidth, h: img.naturalHeight, dw: Math.round(img.naturalWidth * scale), dh: Math.round(img.naturalHeight * scale) });
      imgRef.current = img;
    };
    img.src = src;
  }, [src]);

  const toNatural = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * size.w,
      y: ((e.clientY - r.top) / r.height) * size.h,
    };
  }, [size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !size) return;
    canvas.width = size.dw;
    canvas.height = size.dh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, size.dw, size.dh);
    const k = size.dw / size.w;
    const scaled = (m: Marking): Marking => ({ ...m, points: m.points.map((p) => ({ x: p.x * k, y: p.y * k })) });
    markings.forEach((m) => paint(ctx, scaled(m)));
    if (draft) paint(ctx, scaled(draft));
  }, [size, markings, draft]);

  const handleDown = (e: React.MouseEvent) => {
    if (!size) return;
    const p = toNatural(e);
    if (tool === 'text') {
      const text = window.prompt('Label text:');
      if (text && text.trim()) {
        setMarkings((ms) => [...ms, { id: uid(), tool, color, points: [p], text: text.trim() }]);
      }
      return;
    }
    setDraft({ id: uid(), tool, color, points: [p] });
  };

  const handleMove = (e: React.MouseEvent) => {
    if (!draft) return;
    const p = toNatural(e);
    setDraft({ ...draft, points: [draft.points[0], p] });
  };

  const handleUp = () => {
    if (!draft) return;
    const [a, b] = draft.points;
    // Ignore accidental clicks that draw nothing.
    if (!b || (Math.abs(b.x - a.x) < 4 && Math.abs(b.y - a.y) < 4 && draft.tool !== 'highlight')) {
      setDraft(null);
      return;
    }
    setMarkings((ms) => [...ms, draft]);
    setDraft(null);
  };

  const handleSave = () => {
    const img = imgRef.current;
    if (!img || !size || markings.length === 0) return;
    const out = document.createElement('canvas');
    out.width = size.w;
    out.height = size.h;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, size.w, size.h);
    markings.forEach((m) => paint(ctx, m));
    out.toBlob((blob) => {
      if (blob) onSave(blob);
    }, 'image/png');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOLS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTool(id)}
            title={label}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${tool === id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={`Color ${c}`}
            onClick={() => setColor(c)}
            className={`h-6 w-6 rounded-full border-2 transition-transform ${color === c ? 'border-slate-800 scale-110' : 'border-white shadow'}`}
            style={{ background: c }}
          />
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
        <button
          type="button"
          onClick={() => setMarkings((ms) => ms.slice(0, -1))}
          disabled={markings.length === 0}
          title="Undo last marking"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-40"
        >
          <Undo2 size={14} /> Undo
        </button>
        <button
          type="button"
          onClick={() => { setMarkings([]); setDraft(null); }}
          disabled={markings.length === 0 && !draft}
          title="Clear all markings"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-40"
        >
          <Trash2 size={14} /> Clear
        </button>
        <span className="ml-auto text-[11px] text-slate-400">{markings.length} marking{markings.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-2">
        {!size ? (
          <p className="py-10 text-center text-sm text-slate-500">Loading image…</p>
        ) : (
          <canvas
            ref={canvasRef}
            style={{ width: size.dw, height: size.dh, maxWidth: '100%' }}
            className="mx-auto block cursor-crosshair touch-none rounded bg-white"
            onMouseDown={handleDown}
            onMouseMove={handleMove}
            onMouseUp={handleUp}
            onMouseLeave={handleUp}
          />
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          <X size={14} /> Back
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={markings.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Check size={14} /> Save marked image
        </button>
      </div>
    </div>
  );
}

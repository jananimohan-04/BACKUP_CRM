import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface SearchOption { key: string; label: string }

/**
 * A dropdown you can type into. Typing matches any word of the option text (so a company name finds its
 * products), the list is drawn on the page itself so no panel can clip it, and `onPick` gets the chosen key.
 * `value` is the text shown for the current choice ('' when nothing is chosen).
 */
export function SearchSelect({ options, value, onPick, onClear, placeholder = 'Type or select', className = '', disabled = false, emptyText = 'Nothing matches' }: {
  options: SearchOption[]; value: string; onPick: (key: string) => void; onClear?: () => void;
  placeholder?: string; className?: string; disabled?: boolean; emptyText?: string;
}) {
  const [text, setText] = useState<string | null>(null); // null = show the chosen value
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-search-select-list]') || box.current?.contains(t as Node)) return;
      setOpen(false); setText(null);
    };
    const follow = () => setTick((n) => n + 1);
    document.addEventListener('mousedown', down);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); };
  }, [open]);

  const shown = text ?? value;
  const words = (text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const rows = options.filter((o) => words.every((w) => o.label.toLowerCase().includes(w)));
  const rect = open ? input.current?.getBoundingClientRect() : undefined;
  void tick;

  return (
    <div ref={box} className={`relative ${className}`}>
      <input
        ref={input}
        disabled={disabled}
        className="h-7 w-full rounded-md border border-slate-300 bg-white px-2 pr-6 text-xs focus:border-brand-500 focus:outline-none disabled:bg-slate-100"
        placeholder={placeholder}
        value={shown}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true); if (value && onClear) onClear(); }}
      />
      <button type="button" tabIndex={-1} disabled={disabled} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600" onClick={() => { setOpen((o) => !o); input.current?.focus(); }}>
        <ChevronDown size={14} />
      </button>
      {open && rect && createPortal(
        <div
          data-search-select-list
          style={{ position: 'fixed', left: Math.max(8, Math.min(rect.left, window.innerWidth - 8 - Math.max(rect.width, 420))), top: rect.bottom + 4, width: Math.max(rect.width, 420), maxWidth: 'calc(100vw - 16px)', maxHeight: Math.max(160, Math.min(320, window.innerHeight - rect.bottom - 16)), zIndex: 100 }}
          className="overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
        >
          {rows.length > 0 ? rows.map((o) => (
            <div
              key={o.key}
              title={o.label}
              className="cursor-pointer px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-800"
              onMouseDown={(e) => { e.preventDefault(); onPick(o.key); setText(null); setOpen(false); }}
            >
              {o.label}
            </div>
          )) : <div className="px-3 py-2 text-xs italic text-slate-400">{emptyText}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

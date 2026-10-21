import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FormField } from './Modal';

export interface CustomerOption {
  company: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  city?: string;
  gst?: string;
  address?: string;
  gstin?: string;
  id?: string;
  [key: string]: any;
}

export interface CustomerAutocompleteProps {
  label?: string;
  required?: boolean;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSelectCustomer?: (customer: CustomerOption) => void;
  companies: CustomerOption[];
  placeholder?: string;
  inputClass?: string;
  hint?: string;
  /** Compact variant: the label sits to the left of the field so it can share a row. */
  inlineLabel?: boolean;
}

export function CustomerAutocomplete({
  label = "Company",
  required = false,
  value,
  disabled = false,
  onChange,
  onSelectCustomer,
  companies = [],
  placeholder = "Type or select company...",
  inputClass = "w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-brand-500 bg-white",
  hint,
  inlineLabel = false,
}: CustomerAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number; minWidth: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Prefix match on what the user typed: typing "a" offers companies
  // starting with "a", not random substring hits.
  const filtered = useMemo(() => {
    const q = (value || '').toLowerCase().trim();
    if (!q) return companies.slice(0, 50);
    return companies
      .filter(c => (c.company || '').toLowerCase().startsWith(q))
      .slice(0, 50);
  }, [value, companies]);

  // The menu is portalled to the body with viewport coordinates, so no
  // ancestor scroll container (table rows, modal bodies, page mains) can
  // clip it the way an in-place absolute menu gets cut off.
  const openMenu = useCallback(() => {
    const el = inputRef.current;
    if (!el || disabled) return;
    const r = el.getBoundingClientRect();
    const estH = 232;
    const below = window.innerHeight - r.bottom;
    if (below < 140 && r.top > estH + 8) {
      setMenuPos({ bottom: Math.max(8, window.innerHeight - r.top + 4), left: Math.max(8, Math.min(r.left, window.innerWidth - 328)), minWidth: r.width });
    } else {
      setMenuPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 328)), minWidth: r.width });
    }
    setIsOpen(true);
  }, [disabled]);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setMenuPos(null);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(t)
        && !(menuRef.current && menuRef.current.contains(t))) {
        closeMenu();
      }
    };
    const handleScroll = (e: Event) => {
      // Scrolling inside the menu itself must not close it.
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      closeMenu();
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closeMenu]);

  const pick = (c: CustomerOption) => {
    onChange(c.company);
    if (onSelectCustomer) onSelectCustomer(c);
    closeMenu();
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <FormField label={label} required={required} hint={hint} inline={inlineLabel}>
      <div className="relative" ref={containerRef}>
        <input
          ref={inputRef}
          className={inputClass}
          value={value || ''}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value);
            if (!disabled) openMenu();
          }}
          onFocus={() => {
            if (!disabled) openMenu();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              closeMenu();
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
        {!disabled && isOpen && menuPos && companies.length > 0 && createPortal(
          <div
            ref={menuRef}
            className="bg-white border border-slate-200 rounded-lg shadow-xl overflow-y-auto"
            style={{
              position: 'fixed',
              zIndex: 9999,
              left: menuPos.left,
              minWidth: Math.max(menuPos.minWidth, 200),
              maxWidth: 320,
              maxHeight: 224,
              ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }),
            }}
          >
            {filtered.length > 0 ? (
              filtered.map((c, i) => (
                <div
                  key={`${c.company}-${i}`}
                  className="px-3.5 py-2.5 text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-800 cursor-pointer border-b border-slate-50 last:border-0 flex justify-between items-center transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                >
                  <div className="truncate">
                    <span className="font-semibold text-slate-800">{c.company}</span>
                    {c.city && <span className="text-xs text-slate-400 ml-1.5">• {c.city}</span>}
                  </div>
                  {c.contact_person && (
                    <span className="text-xs text-slate-500 ml-2 shrink-0 truncate max-w-[96px]">
                      {c.contact_person}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className="px-3.5 py-2.5 text-xs text-slate-500 italic">
                No company starts with that — keep typing to add “{value.trim()}” as new
              </div>
            )}
          </div>,
          document.body
        )}
      </div>
    </FormField>
  );
}

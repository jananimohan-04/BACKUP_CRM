import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';

interface CompanyFilterInputProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  allLabel?: string;
}

/**
 * A searchable company filter input that replaces the standard select dropdown.
 * Type to filter, click to select. "All" option is always available at the top.
 */
export function CompanyFilterInput({
  value,
  onChange,
  options,
  placeholder = 'All',
  className = '',
  allLabel = 'All Companies',
}: CompanyFilterInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAllSelected = !value || value === allLabel;

  // Filter options based on search text
  const filteredOptions = useMemo(() => {
    const q = searchText.toLowerCase().trim();
    if (!q) return options.slice(0, 100);
    return options
      .filter(opt => opt.toLowerCase().includes(q))
      .slice(0, 100);
  }, [searchText, options]);

  const openMenu = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const estH = 280;
    const below = window.innerHeight - r.bottom;
    if (below < 160 && r.top > estH + 8) {
      setMenuPos({ bottom: window.innerHeight - r.top + 4, left: r.left, width: Math.max(r.width, 200) });
    } else {
      setMenuPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) });
    }
    setIsOpen(true);
    setSearchText('');
  }, []);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setMenuPos(null);
    setSearchText('');
  }, []);

  const selectOption = (opt: string) => {
    onChange(opt);
    closeMenu();
  };

  const clearFilter = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(allLabel);
    closeMenu();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(t)
        && !(menuRef.current && menuRef.current.contains(t))) {
        closeMenu();
      }
    };
    const handleScroll = (e: Event) => {
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
  }, [isOpen, closeMenu]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={openMenu}
        className="flex items-center gap-1 text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 normal-case focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer max-w-[140px] truncate shadow-xs hover:border-brand-400 transition-colors"
        title={isAllSelected ? 'All Companies' : value}
      >
        <Search size={10} className="text-slate-400 shrink-0" />
        <span className="truncate">{isAllSelected ? placeholder : value}</span>
        {!isAllSelected && (
          <X
            size={12}
            className="text-slate-400 hover:text-rose-500 shrink-0 ml-auto"
            onClick={clearFilter}
          />
        )}
      </button>

      {isOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          className="bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
          style={{
            position: 'fixed',
            zIndex: 9999,
            left: Math.max(8, Math.min(menuPos.left, window.innerWidth - menuPos.width - 8)),
            width: menuPos.width,
            maxWidth: 280,
            ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }),
          }}
        >
          {/* Search input */}
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:border-brand-500"
                placeholder="Type to search..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeMenu();
                  if (e.key === 'Enter' && filteredOptions.length > 0) {
                    selectOption(filteredOptions[0]);
                  }
                }}
              />
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-[220px] overflow-y-auto">
            {/* All option */}
            <div
              className={`px-3 py-2 text-xs cursor-pointer border-b border-slate-50 flex items-center gap-2 ${
                isAllSelected ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(allLabel);
              }}
            >
              <span>All</span>
              {isAllSelected && <span className="ml-auto text-brand-500">✓</span>}
            </div>

            {/* Filtered options */}
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt, i) => (
                <div
                  key={`${opt}-${i}`}
                  className={`px-3 py-2 text-xs cursor-pointer border-b border-slate-50 last:border-0 truncate ${
                    value === opt ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  title={opt}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(opt);
                  }}
                >
                  <span className="truncate">{opt}</span>
                  {value === opt && <span className="ml-2 text-brand-500">✓</span>}
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-xs text-slate-400 italic text-center">
                No companies match "{searchText}"
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

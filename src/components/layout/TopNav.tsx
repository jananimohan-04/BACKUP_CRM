import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Menu } from 'lucide-react';
import { useVisibleNavSections, isNavItemActive, isSectionActive } from '@/lib/useVisibleNavSections';
import type { NavSection } from '@/config/navigation';

/** Width reserved for the "More" overflow button when categories don't all fit. */
const MORE_RESERVED = 110;
const PANEL_W = 264;
const OVERFLOW_PANEL_W = 300;

const clampX = (left: number, width: number) =>
  Math.max(8, Math.min(left, window.innerWidth - width - 8));

/**
 * Premium top-navigation layout ("Menu Position: Top"). The logo and the
 * navigation categories sit in a dark bar across the top; categories with
 * several pages open a dropdown, single-page categories navigate directly, and
 * categories that don't fit on the row move into a "More" overflow menu so
 * every existing navigation item stays reachable.
 */
export function TopNav({
  currentPage,
  onNavigate,
  onMenuClick,
}: {
  currentPage: string;
  onNavigate: (page: string) => void;
  onMenuClick?: () => void;
}) {
  const visibleSections = useVisibleNavSections();
  const [dropdown, setDropdown] = useState<{ section: NavSection; rect: DOMRect } | null>(null);
  const [overflow, setOverflow] = useState<{ rect: DOMRect } | null>(null);
  const [overflowFrom, setOverflowFrom] = useState(Number.MAX_SAFE_INTEGER);
  const rootRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The panels are portalled to document.body, so outside-clicks must ignore them too.
  const dropdownPanelRef = useRef<HTMLDivElement>(null);
  const overflowPanelRef = useRef<HTMLDivElement>(null);

  const closeMenus = useCallback(() => {
    setDropdown(null);
    setOverflow(null);
  }, []);

  // Close dropdowns on outside click / Escape.
  useEffect(() => {
    const isInside = (t: EventTarget | null) =>
      (rootRef.current?.contains(t as Node) ?? false) ||
      (dropdownPanelRef.current?.contains(t as Node) ?? false) ||
      (overflowPanelRef.current?.contains(t as Node) ?? false);
    const onDown = (e: MouseEvent) => {
      if (!isInside(e.target)) closeMenus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [closeMenus]);

  // Measure which categories fit on the row; the rest move into "More".
  // Overflowed buttons stay rendered (visibility:hidden keeps their natural
  // width for measuring) so the measurement never oscillates.
  useLayoutEffect(() => {
    const measure = () => {
      const list = listRef.current;
      if (!list) return;
      const btns = btnRefs.current.filter(Boolean) as HTMLButtonElement[];
      if (btns.length === 0) return;
      const fitsIn = (limit: number) => {
        let count = 0;
        for (const b of btns) {
          if (b.offsetLeft + b.offsetWidth <= limit + 1) count++;
          else break;
        }
        return count;
      };
      let k = fitsIn(list.clientWidth);
      if (k < btns.length) k = fitsIn(list.clientWidth - MORE_RESERVED);
      setOverflowFrom((prev) => (prev === k ? prev : k));
    };
    measure();
    // Dropdowns are anchored to fixed coordinates: drop them on resize.
    window.addEventListener('resize', measure);
    window.addEventListener('resize', closeMenus);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('resize', closeMenus);
    };
  }, [visibleSections, closeMenus]);

  const toggleCategory = (section: NavSection, index: number) => {
    const btn = btnRefs.current[index];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setOverflow(null);
    setDropdown((prev) => (prev?.section.label === section.label ? null : { section, rect }));
  };

  const openOverflow = () => {
    const rect = listRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDropdown(null);
    setOverflow((prev) => (prev ? null : { rect: new DOMRect(rect.right - OVERFLOW_PANEL_W - 4, rect.bottom, 0, 0) }));
  };

  const navigateAndClose = (page: string) => {
    onNavigate(page);
    closeMenus();
  };

  const underline = <span className="absolute -bottom-2.5 left-2 right-2 h-0.5 bg-brand-500 rounded-full" aria-hidden="true" />;

  return (
    <header
      ref={rootRef}
      className="relative flex-shrink-0 h-14 bg-navy-950 text-white flex items-center gap-2 px-2 sm:px-3 border-b border-navy-800 shadow-lg z-40 animate-nav-in-top"
    >
      {/* Mobile: menu toggle opens the slide-in navigation drawer */}
      <button
        onClick={onMenuClick}
        aria-label="Open menu"
        className="lg:hidden p-2 -ml-1 rounded-lg text-navy-300 hover:text-white hover:bg-navy-900 transition-colors"
      >
        <Menu size={18} />
      </button>

      {/* Logo */}
      <button
        onClick={() => navigateAndClose('dashboard')}
        title="Go to Dashboard"
        className="flex items-center shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <img src="/arguscnc-logo.jpg" alt="ARGUSCNC Logo" className="h-9 w-auto max-w-[130px] sm:max-w-[160px] object-contain rounded-lg" />
      </button>

      {/* Categories */}
      <div ref={listRef} className="relative hidden lg:flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
        {visibleSections.map((section, index) => {
          const hidden = index >= overflowFrom;
          const sectionActive = isSectionActive(section, currentPage);
          const isOpen = dropdown?.section.label === section.label;
          const shared = `relative shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            hidden ? 'invisible pointer-events-none' : ''
          }`;

          // Single-page category: navigate directly.
          if (section.items.length === 1) {
            const item = section.items[0];
            const active = isNavItemActive(currentPage, item.page);
            return (
              <button
                key={section.label}
                ref={(el) => { btnRefs.current[index] = el; }}
                aria-hidden={hidden}
                tabIndex={hidden ? -1 : 0}
                onClick={() => navigateAndClose(item.page)}
                className={`${shared} ${active ? 'bg-navy-900 text-white' : 'text-navy-300 hover:text-white hover:bg-navy-900/60'}`}
              >
                {section.label}
                {active && underline}
              </button>
            );
          }

          // Multi-page category: dropdown.
          return (
            <button
              key={section.label}
              ref={(el) => { btnRefs.current[index] = el; }}
              aria-hidden={hidden}
              tabIndex={hidden ? -1 : 0}
              aria-expanded={isOpen}
              onClick={() => toggleCategory(section, index)}
              className={`${shared} ${
                sectionActive || isOpen ? 'bg-navy-900 text-white' : 'text-navy-300 hover:text-white hover:bg-navy-900/60'
              }`}
            >
              {section.label}
              <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
              {(sectionActive || isOpen) && underline}
            </button>
          );
        })}

        {/* Overflow menu: every category that doesn't fit on the row */}
        {overflowFrom < visibleSections.length && (
          <button
            onClick={openOverflow}
            aria-expanded={!!overflow}
            className="absolute right-0 top-0 h-full flex items-center gap-1.5 pl-5 pr-1.5 text-xs font-bold text-navy-300 hover:text-white bg-navy-950 hover:bg-navy-900/60 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            More
            <ChevronDown size={12} className={`transition-transform duration-200 ${overflow ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Category dropdown (portalled out of the clipped row) */}
      {dropdown &&
        createPortal(
          <div
            ref={dropdownPanelRef}
            style={{ position: 'fixed', top: dropdown.rect.bottom + 6, left: clampX(dropdown.rect.left, PANEL_W) } satisfies CSSProperties}
            className="w-[264px] bg-navy-900 border border-navy-700 rounded-xl shadow-2xl overflow-hidden z-[120] animate-scale-in py-1.5"
          >
            <p className="px-3 pt-0.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-navy-400">{dropdown.section.label}</p>
            {dropdown.section.items.map((item) => {
              const active = isNavItemActive(currentPage, item.page);
              return (
                <button
                  key={item.page}
                  onClick={() => navigateAndClose(item.page)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors text-left ${
                    active ? 'bg-brand-600 text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                  }`}
                >
                  <item.icon size={15} className={active ? 'text-white shrink-0' : `${item.iconClass ?? 'text-navy-300'} shrink-0`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}

      {/* Overflow menu panel (portalled out of the clipped row) */}
      {overflow &&
        createPortal(
          <div
            ref={overflowPanelRef}
            style={{
              position: 'fixed',
              top: overflow.rect.bottom + 6,
              left: clampX(window.innerWidth - OVERFLOW_PANEL_W - 12, OVERFLOW_PANEL_W),
            } satisfies CSSProperties}
            className="w-[300px] max-h-[70vh] overflow-y-auto scrollbar-dark bg-navy-900 border border-navy-700 rounded-xl shadow-2xl z-[120] animate-scale-in py-1.5"
          >
            {visibleSections.slice(overflowFrom).map((section) => (
              <div key={section.label} className="px-1.5 py-0.5">
                <p className="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-navy-400">{section.label}</p>
                {section.items.map((item) => {
                  const active = isNavItemActive(currentPage, item.page);
                  return (
                    <button
                      key={item.page}
                      onClick={() => navigateAndClose(item.page)}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 text-xs font-medium transition-colors text-left rounded-md ${
                        active ? 'bg-brand-600 text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                      }`}
                    >
                      <item.icon size={15} className={active ? 'text-white shrink-0' : `${item.iconClass ?? 'text-navy-300'} shrink-0`} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </header>
  );
}

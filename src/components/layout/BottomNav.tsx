import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, LayoutGrid, X } from 'lucide-react';
import { useVisibleNavSections, isNavItemActive, isSectionActive } from '@/lib/useVisibleNavSections';

/**
 * Premium bottom-navigation layout ("Menu Position: Bottom"). A compact bar is
 * docked to the bottom edge (always reserving its own space so it never covers
 * page content, tables or buttons) with quick shortcuts on the left and an
 * "All Modules" panel that expands upward with every category and nested page.
 * On mobile the bar respects the device safe-area inset.
 */
export function BottomNav({
  currentPage,
  onNavigate,
}: {
  currentPage: string;
  onNavigate: (page: string) => void;
}) {
  const visibleSections = useVisibleNavSections();
  const [panelOpen, setPanelOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the panel on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // When the panel opens, make sure the active section (and the others) are readable.
  useEffect(() => {
    if (!panelOpen) return;
    setExpandedSections((prev) => {
      if (visibleSections.every((s) => prev.has(s.label))) return prev;
      const next = new Set(prev);
      visibleSections.forEach((s) => next.add(s.label));
      return next;
    });
  }, [panelOpen, visibleSections]);

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  // Quick shortcuts: the active page first, then a few common entries. Permission
  // filtering already happened in useVisibleNavSections, so everything here is allowed.
  const quickItems = useMemo(() => {
    const flat = visibleSections.flatMap((s) => s.items);
    const active = flat.filter((i) => isNavItemActive(currentPage, i.page));
    const rest = flat.filter((i) => !active.includes(i));
    return [...active, ...rest].slice(0, 5);
  }, [visibleSections, currentPage]);

  const navigateAndClose = (page: string) => {
    onNavigate(page);
    setPanelOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className="relative flex-shrink-0 z-40 bg-navy-950 text-white border-t border-navy-800 shadow-[0_-4px_24px_rgba(0,0,0,0.15)] pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] animate-nav-in-bottom"
    >
      {/* Expandable panel — opens upward from the bar */}
      {panelOpen && (
        <div className="absolute bottom-full inset-x-0 max-h-[70dvh] overflow-y-auto scrollbar-dark bg-navy-950 border-t border-navy-800 rounded-t-2xl shadow-[0_-12px_32px_rgba(0,0,0,0.35)] animate-fade-in">
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-navy-400">All Modules</p>
            <button
              onClick={() => setPanelOpen(false)}
              aria-label="Close menu"
              className="p-1 rounded-md text-navy-400 hover:text-white hover:bg-navy-900 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <div className="px-2 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-3 gap-y-0.5">
            {visibleSections.map((section) => {
              const isExpanded = expandedSections.has(section.label);
              const hasActive = isSectionActive(section, currentPage);
              return (
                <div key={section.label} className="min-w-0">
                  <button
                    onClick={() => toggleSection(section.label)}
                    aria-expanded={isExpanded}
                    className={`w-full flex items-center justify-between px-2.5 py-2.5 sm:py-1.5 my-0.5 rounded-md bg-navy-900/70 text-[11px] sm:text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      hasActive ? 'text-brand-400' : 'text-navy-400 hover:text-navy-200'
                    }`}
                  >
                    <span>{section.label}</span>
                    <ChevronDown size={12} className={`transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
                  </button>
                  {isExpanded && (
                    <div className="flex flex-col gap-0.5 pb-1">
                      {section.items.map((item) => {
                        const active = isNavItemActive(currentPage, item.page);
                        return (
                          <button
                            key={item.page}
                            onClick={() => navigateAndClose(item.page)}
                            className={`w-full flex items-center gap-2 px-2.5 py-2.5 sm:py-1.5 rounded-md text-sm transition-all duration-200 text-left ${
                              active
                                ? 'bg-brand-600 text-white font-bold shadow-md shadow-brand-500/25 ring-1 ring-white/20'
                                : 'text-navy-300 hover:bg-navy-900 hover:text-white'
                            }`}
                          >
                            <item.icon size={14} className={active ? 'text-white shrink-0' : `${item.iconClass ?? 'text-navy-400'} shrink-0`} />
                            <span className="text-[14px] sm:text-[12.5px] leading-tight truncate">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* The bar itself */}
      <div className="flex items-center gap-1 px-1.5 sm:px-2 h-12">
        <button
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          className={`shrink-0 flex items-center gap-1.5 px-2.5 sm:px-3 h-9 rounded-lg text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            panelOpen ? 'bg-brand-600 text-white shadow-md shadow-brand-500/25' : 'text-navy-300 hover:text-white hover:bg-navy-900'
          }`}
        >
          <LayoutGrid size={16} />
          <span>Menu</span>
          <ChevronDown size={12} className={`transition-transform duration-200 ${panelOpen ? 'rotate-180' : ''}`} />
        </button>

        <span className="w-px h-6 bg-navy-800 mx-1 shrink-0" aria-hidden="true" />

        <div className="flex-1 flex items-center gap-1 min-w-0 overflow-hidden">
          {quickItems.map((item, idx) => {
            const active = isNavItemActive(currentPage, item.page);
            // Keep the bar uncluttered on small screens; the active entry always shows.
            const hideClass = idx >= 3 ? 'hidden xl:flex' : idx >= 2 ? 'hidden md:flex' : idx >= 1 ? 'hidden sm:flex' : '';
            return (
              <button
                key={item.page}
                onClick={() => navigateAndClose(item.page)}
                title={item.label}
                className={`${hideClass} shrink-0 min-w-0 flex items-center gap-1.5 px-2.5 h-9 rounded-lg text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  active ? 'bg-brand-600 text-white shadow-md shadow-brand-500/25' : 'text-navy-300 hover:text-white hover:bg-navy-900'
                }`}
              >
                <item.icon size={15} className={`${active ? 'text-white' : item.iconClass ?? 'text-navy-400'} shrink-0`} />
                <span className="truncate max-w-[110px] hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

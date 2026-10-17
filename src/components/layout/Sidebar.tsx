import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { navSections } from '@/config/navigation';
import { useAuth } from '@/contexts/AuthContext';

export function Sidebar({
  collapsed: pinnedClosed,
  onToggle,
  currentPage,
  onNavigate,
  mobileOpen,
  onCloseMobile
}: {
  collapsed: boolean;
  onToggle: () => void;
  currentPage: string;
  onNavigate: (page: string) => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}) {
  const { profile, canView, permissions } = useAuth();
  // Closed by default: an icon rail that opens (over the page, without pushing it) while the mouse is on it.
  const [hovered, setHovered] = useState(false);
  const closed = pinnedClosed && !hovered && !mobileOpen;
  const collapsed = false; // when visible the menu always shows full labels; 'closed' hides it entirely
  // One permission system: role gates (legacy) AND module view access. While
  // permissions load, nothing renders so unauthorized menus never flash.
  const permsReady = permissions !== null;
  const visibleSections = !permsReady
    ? []
    : navSections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (i) =>
            (!i.roles || (profile && i.roles.includes(profile.role))) &&
            (!i.module || canView(i.module)),
        ),
      }))
      .filter((s) => s.items.length > 0);

  const isItemActive = (itemPage: string) => {
    if (currentPage === itemPage) return true;
    if (currentPage.startsWith(itemPage + '/')) return true;
    if (itemPage === 'sales/pipeline' && (currentPage.startsWith('sales/') || currentPage === 'sales')) return true;
    return false;
  };

  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    navSections.forEach((s) => initial.add(s.label));
    return initial;
  });

  useEffect(() => {
    const activeSection = visibleSections.find((s) => s.items.some((i) => isItemActive(i.page)));
    if (activeSection) {
      setExpandedSections((prev) => {
        if (!prev.has(activeSection.label)) {
          const next = new Set(prev);
          next.add(activeSection.label);
          return next;
        }
        return prev;
      });
    }
  }, [currentPage]);

  // Fit the whole menu in one view: shrink the content just enough that it never needs a scrollbar.
  const navRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const measure = () => {
      const nav = navRef.current, inner = innerRef.current;
      if (!nav || !inner) return;
      const natural = inner.getBoundingClientRect().height / fit;
      const next = Math.max(0.6, Math.min(1, (nav.clientHeight - 20) / natural));
      setFit((prev) => (Math.abs(prev - next) > 0.005 ? next : prev));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={onCloseMobile}
        />
      )}
      {/* Keeps the page's left edge fixed while the rail opens over it. */}
      <div className={`flex-shrink-0 w-0 ${pinnedClosed ? 'lg:w-0' : 'lg:w-[360px]'}`}>
      {/* Closed: only a small arrow tab on the left edge; the mouse on it opens the menu. */}
      {closed && (
        <div onMouseEnter={() => setHovered(true)} className="hidden lg:flex fixed left-0 top-1/2 -translate-y-1/2 z-50 h-14 w-4 items-center justify-center rounded-r-lg bg-navy-950 text-navy-300 shadow-lg cursor-pointer hover:w-5 hover:text-white" aria-label="Open menu">
          <ChevronRight size={14} />
        </div>
      )}
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`${
          'w-[360px]'
        } ${
          mobileOpen ? 'translate-x-0' : closed ? '-translate-x-full' : 'translate-x-0 lg:translate-x-0'
        } fixed bg-navy-950 text-white flex flex-col overflow-x-hidden h-screen top-0 left-0 z-50 shadow-[4px_0_24px_rgba(0,0,0,0.15)]`}
      >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-navy-800 flex-shrink-0 bg-navy-950 shadow-sm relative z-10">
        {!collapsed ? (
          <img src="/arguscnc-logo.jpg" alt="ARGUSCNC Logo" className="w-full h-11 object-contain rounded-xl" />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0 shadow-glow-orange overflow-hidden border border-brand-500/20">
            <img src="/arguscnc-mark.jpg" alt="ARGUSCNC Mark" className="w-full h-full object-contain p-1" />
          </div>
        )}
      </div>

        {/* Navigation */}
      <nav ref={navRef} className="flex-1 overflow-hidden py-2 px-2 relative z-0"><div ref={innerRef} style={{ zoom: fit }} className="grid grid-cols-2 gap-x-2 gap-y-1 items-start">
        {visibleSections.map((section) => {
          const isExpanded = expandedSections.has(section.label);
          const hasActive = section.items.some((i) => isItemActive(i.page));
          return (
            <div key={section.label} className="min-w-0">
              {!collapsed && (
                <button
                  onClick={() => toggleSection(section.label)}
                  className={`w-full flex items-center justify-between px-2.5 py-1 mb-0.5 rounded-md bg-navy-900/70 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                    hasActive ? 'text-brand-400 font-extrabold' : 'text-navy-400 hover:text-navy-200'
                  }`}
                >
                  <span>{section.label}</span>
                  <ChevronDown size={12} className={`transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
                </button>
              )}
              {collapsed && (
                <div className="h-px bg-navy-800/60 my-2 mx-1" />
              )}
              {(isExpanded || collapsed) && (
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const active = isItemActive(item.page);
                    return (
                      <button
                        key={item.page}
                        onClick={() => {
                          onNavigate(item.page);
                          if (onCloseMobile) onCloseMobile();
                        }}
                        title={collapsed ? item.label : undefined}
                        className={`w-full flex items-center px-2.5 py-1 rounded-md text-sm transition-all duration-200 group relative ${
                          active
                            ? 'bg-brand-600 text-white font-bold shadow-md shadow-brand-500/25 ring-1 ring-white/20'
                            : 'text-navy-300 hover:bg-navy-900 hover:text-white'
                        }`}
                      >
                        {active && (
                           <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-white rounded-r-full shadow-sm" />
                        )}
                        {!collapsed && <span className="text-[12.5px] leading-tight text-left py-0.5">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div></nav>

      {/* Collapse toggle */}
      <div className="px-3 py-2 border-t border-navy-800 bg-navy-950 flex-shrink-0 relative z-10">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs text-navy-400 hover:text-white bg-navy-900/50 hover:bg-navy-800 border border-navy-800 hover:border-navy-700 rounded-lg transition-all"
        >
          <ChevronRight size={14} className={`transition-transform duration-300 ${pinnedClosed ? '' : 'rotate-180'}`} />
          {!collapsed && <span className="font-medium tracking-wide">{pinnedClosed ? 'Pin Menu Open' : 'Collapse Menu'}</span>}
        </button>
      </div>
    </aside>
      </div>
    </>
  );
}

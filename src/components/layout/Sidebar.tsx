import { useState } from 'react';
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
  const { profile } = useAuth();
  // Closed by default: an icon rail that opens (over the page, without pushing it) while the mouse is on it.
  const [hovered, setHovered] = useState(false);
  const closed = pinnedClosed && !hovered && !mobileOpen;
  const collapsed = false; // when visible the menu always shows full labels; 'closed' hides it entirely
  const visibleSections = navSections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || (profile && i.roles.includes(profile.role))) }))
    .filter((s) => s.items.length > 0);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    navSections.forEach((s) => initial.add(s.label));
    return initial;
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
      <div className={`flex-shrink-0 w-0 ${pinnedClosed ? 'lg:w-0' : 'lg:w-[220px]'}`}>
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
          'w-[220px]'
        } ${
          mobileOpen ? 'translate-x-0' : closed ? '-translate-x-full' : 'translate-x-0 lg:translate-x-0'
        } fixed bg-navy-950 text-white flex flex-col overflow-x-hidden h-screen top-0 left-0 z-50 shadow-[4px_0_24px_rgba(0,0,0,0.15)]`}
      >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-24 border-b border-navy-800 flex-shrink-0 bg-navy-950 shadow-sm relative z-10">
        {!collapsed ? (
          <img src="/arguscnc-logo.jpg" alt="ARGUSCNC Logo" className="w-full h-16 object-contain rounded-2xl" />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0 shadow-glow-orange overflow-hidden border border-brand-500/20">
            <img src="/arguscnc-mark.jpg" alt="ARGUSCNC Mark" className="w-full h-full object-contain p-1" />
          </div>
        )}
      </div>

        {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-dark py-4 px-3 space-y-1 relative z-0">
        {visibleSections.map((section) => {
          const isExpanded = expandedSections.has(section.label);
          const hasActive = section.items.some((i) => currentPage === i.page);
          return (
            <div key={section.label} className="mb-2">
              {!collapsed && (
                <button
                  onClick={() => toggleSection(section.label)}
                  className={`w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                    hasActive ? 'text-brand-400' : 'text-navy-400 hover:text-navy-200'
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
                <div className="mt-1 space-y-1">
                  {section.items.map((item) => {
                    const active = currentPage === item.page;
                    return (
                      <button
                        key={item.page}
                        onClick={() => {
                          onNavigate(item.page);
                          if (onCloseMobile) onCloseMobile();
                        }}
                        title={collapsed ? item.label : undefined}
                        className={`w-full flex items-center px-3 py-1.5 rounded-lg text-sm transition-all duration-200 group relative ${
                          active
                            ? 'bg-brand-600/10 text-brand-500 font-semibold'
                            : 'text-navy-300 hover:bg-navy-900 hover:text-white'
                        }`}
                      >
                        {active && (
                           <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-brand-500 rounded-r-full shadow-glow-red" />
                        )}
                        {!collapsed && <span className="truncate text-[13px]">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="p-3 border-t border-navy-800 bg-navy-950 flex-shrink-0 relative z-10">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs text-navy-400 hover:text-white bg-navy-900/50 hover:bg-navy-800 border border-navy-800 hover:border-navy-700 rounded-lg transition-all"
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

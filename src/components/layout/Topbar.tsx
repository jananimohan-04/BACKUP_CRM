import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Settings,
  LogOut,
  User as UserIcon,
  Menu,
  HelpCircle,
  Building2,
  CalendarDays,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Company Admin',
  USER: 'User',
};

export function Topbar({
  currentPage,
  onNavigate,
  onLogout,
  onMenuClick,
}: {
  currentPage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  onMenuClick?: () => void;
}) {
  const [showProfile, setShowProfile] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const { profile, company, companies, isSuperAdmin, setActiveCompany } = useAuth();

  const displayName = profile?.full_name || profile?.email || '';
  const initials = displayName.split(/[s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { kpis, header } = useHeaderKpis();
  // Live clock: date + time, ticking every second.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const datePart = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/,/g, '');
  const timePart = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  return (
    <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-lg border-b border-slate-200 shadow-sm min-h-[50px] h-[50px] flex items-center px-2 sm:px-3 md:px-4 gap-2 sm:gap-3">
      {/* Mobile Menu Toggle */}
      <div className="flex items-center lg:hidden">
        <Menu size={18} className="text-slate-400 flex-shrink-0 cursor-pointer hover:text-slate-600 transition-colors" onClick={onMenuClick} />
      </div>

      {/* Opt-in page title — same line as date/profile (page hides its own header) */}
      {header && (
        <div className="flex items-center gap-2 shrink min-w-0 max-w-[45%]">
          <h1 className="text-sm font-bold text-slate-800 truncate">{header.title}</h1>
          {header.subtitle && <span className="text-[11px] text-slate-400 truncate hidden md:inline">{header.subtitle}</span>}
        </div>
      )}

      {/* Sales Pipeline KPIs — inline strip sharing the header row (page supplies the data) */}
      {kpis.length > 0 && (() => {
        const hasAnyActive = kpis.some(k => k.active);
        return (
          <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 py-1">
            {kpis.map(kpi => (
              <button
                key={kpi.key}
                type="button"
                onClick={kpi.onClick}
                title={`${kpi.label}: ${kpi.count}`}
                className={`${kpi.tile} flex-1 min-w-0 max-w-[130px] rounded-md px-1 sm:px-1.5 md:px-2 py-1 shadow-sm border cursor-pointer flex items-center justify-between gap-1 transition-all duration-200 ${
                  kpi.active
                    ? (kpi.activeClass ?? '!opacity-100 ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900 border-2 border-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.7)] brightness-110 font-black scale-[1.03] z-10')
                    : hasAnyActive
                      ? 'opacity-40 saturate-50 hover:opacity-90 hover:saturate-90'
                      : 'opacity-85 hover:opacity-100 hover:-translate-y-0.5'
                }`}
              >
                <span className="flex items-baseline gap-1 min-w-0 flex-1">
                  <span className="text-[7.5px] sm:text-[8px] md:text-[9px] font-bold text-white uppercase tracking-tight whitespace-nowrap truncate flex items-center gap-0.5 min-w-0">
                    {kpi.active && <span className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${kpi.dotClass ?? 'bg-amber-300'} animate-ping inline-block shrink-0`} />}
                    <span className="truncate">{kpi.label}</span>
                  </span>
                  <span className="text-xs sm:text-sm font-black leading-tight text-white tabular-nums shrink-0">{kpi.count}</span>
                </span>
                <span className={`w-4 h-4 sm:w-5 sm:h-5 shrink-0 rounded-full flex items-center justify-center ${kpi.icon} ${kpi.active ? 'ring-1 sm:ring-2 ring-white/60 shadow-[0_0_8px_rgba(255,255,255,0.6)]' : ''}`}>
                  <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={kpi.iconPath} /></svg>
                </span>
              </button>
            ))}
          </div>
        );
      })()}

      {/* Company: shown read-only for normal users */}
      {company && !isSuperAdmin && (
        <div className="hidden md:flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs font-bold text-slate-700">
          <Building2 size={14} className="text-slate-400" />
          {company.company_name}
        </div>
      )}

      {/* Date + profile box */}
      <div className="relative shrink-0" ref={profileRef}>
        <button
          onClick={() => setShowProfile(!showProfile)}
          className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-slate-100 rounded-md transition-colors border border-slate-200 bg-white shadow-sm shrink-0"
        >
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-brand-500 to-brand-800 flex items-center justify-center text-white shrink-0">
              <CalendarDays size={12} />
            </div>
            <p className="text-[9px] font-extrabold text-slate-700 whitespace-nowrap tabular-nums leading-none">{datePart} <span className="text-brand-600 font-bold">{timePart}</span></p>
            <span className="h-6 w-px shrink-0 bg-slate-200 mx-0.5" aria-hidden="true" />
          </div>
          <div className="w-6 h-6 rounded bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center text-white text-[10px] font-bold shadow-sm shrink-0">
            {initials}
          </div>
          <div className="hidden lg:flex items-center gap-1.5 text-left leading-none min-w-0">
            <p className="text-[9px] font-bold text-slate-700 max-w-[120px] truncate">{displayName}</p>
            <span className="text-[8px] text-slate-400 font-medium uppercase tracking-wider whitespace-nowrap">· {ROLE_LABELS[profile?.role ?? ''] ?? ''}</span>
          </div>
          <ChevronDown size={12} className="text-slate-400" />
        </button>
        {showProfile && (
          <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-2xl border border-slate-200 animate-scale-in overflow-hidden z-50">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
              <p className="text-sm font-bold text-slate-800 truncate">{displayName}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{profile?.email}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-2">
                {ROLE_LABELS[profile?.role ?? '']}
              </p>
            </div>
            {/* Company: switchable by the Super Admin, read-only for everyone else */}
            <div className="px-5 py-3 border-b border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Company</p>
              {isSuperAdmin ? (
                <div className="flex items-center gap-1.5">
                  <Building2 size={14} className="text-slate-400 shrink-0" />
                  <select
                    value={company?.id ?? ''}
                    onChange={(e) => setActiveCompany(e.target.value || null)}
                    className="min-w-0 flex-1 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-brand-500"
                    title="Company whose data is shown"
                  >
                    <option value="">All companies</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.company_name}{c.status === 'Inactive' ? ' (inactive)' : ''}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-xs font-bold text-slate-700">{company?.company_name ?? '—'}</p>
              )}
            </div>
            <div className="p-2">
              <button onClick={() => { setShowProfile(false); onNavigate('/admin/settings'); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors text-left cursor-pointer"><Settings size={15} className="text-slate-400" /> Settings</button>
              <button onClick={() => { setShowProfile(false); onNavigate('/help'); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors text-left cursor-pointer"><HelpCircle size={15} className="text-slate-400" /> Help & Support</button>
              <div className="my-1 border-t border-slate-100" />
              <button onClick={() => { setShowProfile(false); onLogout(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors text-left cursor-pointer"><LogOut size={15} className="text-red-400" /> Sign Out</button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

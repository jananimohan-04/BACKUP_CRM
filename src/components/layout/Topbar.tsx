import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Bell,
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
import { fetchRecentActivity, timeAgo, type ActivityItem } from '@/lib/recentActivity';

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
  const [showNotif, setShowNotif] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const { profile, company, companies, isSuperAdmin, setActiveCompany } = useAuth();
  const [notifications, setNotifications] = useState<ActivityItem[]>([]);

  const displayName = profile?.full_name || profile?.email || '';
  const initials = displayName.split(/[s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

  useEffect(() => {
    if (showNotif) fetchRecentActivity(5).then(setNotifications).catch(err => console.error('Notifications failed:', err));
  }, [showNotif, company?.id]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { kpis } = useHeaderKpis();
  // Live clock: date + time, ticking every second.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const datePart = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/,/g, '');
  const timePart = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  return (
    <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-lg border-b border-slate-200 shadow-sm min-h-[50px] h-[50px] flex items-center px-4 lg:px-5 gap-4">
      {/* Mobile Menu Toggle */}
      <div className="flex items-center lg:hidden">
        <Menu size={18} className="text-slate-400 flex-shrink-0 cursor-pointer hover:text-slate-600 transition-colors" onClick={onMenuClick} />
      </div>

      {/* Sales Pipeline KPIs — inline strip sharing the header row (page supplies the data) */}
      {kpis.length > 0 && (() => {
        const hasAnyActive = kpis.some(k => k.active);
        return (
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-none py-1">
            {kpis.map(kpi => (
              <button
                key={kpi.key}
                type="button"
                onClick={kpi.onClick}
                title={kpi.label}
                className={`${kpi.tile} shrink-0 rounded-md px-2 py-1 shadow-sm border cursor-pointer flex items-center justify-between gap-1 w-[124px] transition-all duration-200 ${
                  kpi.active
                    ? '!opacity-100 ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900 border-2 border-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.7)] brightness-110 font-black scale-[1.04] z-10'
                    : hasAnyActive
                      ? 'opacity-40 saturate-50 hover:opacity-90 hover:saturate-90'
                      : 'opacity-85 hover:opacity-100 hover:-translate-y-0.5'
                }`}
              >
                <span className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-[9px] font-bold text-white uppercase tracking-wide whitespace-nowrap truncate flex items-center gap-1">
                    {kpi.active && <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-ping inline-block shrink-0" />}
                    {kpi.label}
                  </span>
                  <span className="text-sm font-extrabold leading-tight text-white tabular-nums">{kpi.count}</span>
                </span>
                <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center ${kpi.icon} ${kpi.active ? 'ring-2 ring-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.8)]' : ''}`}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={kpi.iconPath} /></svg>
                </span>
              </button>
            ))}
          </div>
        );
      })()}

      {/* Company: shown read-only for normal users, switchable for the Super Admin (in the profile menu) */}
      {company && !isSuperAdmin && (
        <div className="hidden md:flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs font-bold text-slate-700">
          <Building2 size={14} className="text-slate-400" />
          {company.company_name}
        </div>
      )}

      {/* Date + time — compact square box */}
      <div className="hidden xl:flex items-center gap-1.5 px-2 py-1 rounded-md bg-white border border-slate-200 shadow-sm">
        <div className="w-5 h-5 rounded bg-gradient-to-br from-brand-500 to-brand-800 flex items-center justify-center text-white shrink-0">
          <CalendarDays size={12} />
        </div>
        <div className="leading-none">
          <p className="text-[9px] font-extrabold text-slate-700 whitespace-nowrap tabular-nums">{datePart}</p>
          <p className="text-[9px] font-bold text-brand-600 whitespace-nowrap tabular-nums mt-0.5">{timePart}</p>
        </div>
      </div>

      {/* System Status — compact square box */}
      <div className="hidden xl:flex flex-col items-center justify-center gap-0.5 px-2 py-1 bg-white border border-slate-200 rounded-md shadow-sm">
        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-ring" />
        <span className="text-[9px] font-bold text-green-700 tracking-wide uppercase whitespace-nowrap leading-none">System</span>
        <span className="text-[9px] font-bold text-green-700 tracking-wide uppercase whitespace-nowrap leading-none">Online</span>
      </div>

      {/* Notifications — compact bordered box */}
      <div className="relative" ref={notifRef}>
        <button
          onClick={() => setShowNotif(!showNotif)}
          className="relative px-2 py-1.5 border border-slate-200 bg-white rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 shadow-sm transition-colors"
        >
          <Bell size={16} />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-brand-500 rounded-full ring-2 ring-white" />
        </button>
        {showNotif && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 animate-scale-in overflow-hidden z-50">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="text-sm font-bold text-slate-800">Notifications</h3>
            </div>
            <div className="max-h-80 overflow-y-auto scrollbar-thin">
              {notifications.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-slate-400">No recent activity.</p>
              )}
              {notifications.map((n) => (
                <div key={n.id} className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors group">
                  <p className="text-sm text-slate-700 font-medium group-hover:text-brand-700 transition-colors">{n.message}</p>
                  <p className="text-xs text-slate-400 mt-1">{timeAgo(n.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Profile — compact bordered box */}
      <div className="relative" ref={profileRef}>
        <button
          onClick={() => setShowProfile(!showProfile)}
          className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-slate-100 rounded-md transition-colors border border-slate-200 bg-white shadow-sm"
        >
          <div className="w-6 h-6 rounded bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center text-white text-[10px] font-bold shadow-sm shrink-0">
            {initials}
          </div>
          <div className="hidden lg:block text-left leading-none">
            <p className="text-[9px] font-bold text-slate-700 max-w-[120px] truncate">{displayName}</p>
            <p className="text-[8px] text-slate-500 font-medium uppercase tracking-wider truncate">{ROLE_LABELS[profile?.role ?? ''] ?? ''}</p>
          </div>
          <ChevronDown size={12} className="hidden lg:block text-slate-400" />
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
                <p className="text-xs font-bold text-slate-700 truncate">{company?.company_name || '—'}</p>
              )}
            </div>
            <div className="py-2">
              <button className="w-full flex items-center gap-3 px-5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-brand-600 transition-colors font-medium">
                <UserIcon size={16} /> My Profile
              </button>
              <button className="w-full flex items-center gap-3 px-5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-brand-600 transition-colors font-medium">
                <Settings size={16} /> Preferences
              </button>
              <button className="w-full flex items-center gap-3 px-5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-brand-600 transition-colors font-medium">
                <HelpCircle size={16} /> Documentation
              </button>
            </div>
            <div className="border-t border-slate-100 py-2">
              <button
                onClick={onLogout}
                className="w-full flex items-center gap-3 px-5 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors font-medium"
              >
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

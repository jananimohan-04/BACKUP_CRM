import type { ReactNode, MouseEvent as ReactMouseEvent } from 'react';

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200/60 shadow-premium transition-shadow duration-300 ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
      <div className="flex items-center gap-3">
        {icon && <div className="text-brand-600">{icon}</div>}
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  trend,
  trendUp,
  accent = 'brand',
  compact = false,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  trend?: string;
  trendUp?: boolean;
  accent?: 'brand' | 'accent' | 'success' | 'warning' | 'error' | 'navy' | 'neutral' | 'info';
  compact?: boolean;
}) {
  const accentMap: Record<string, string> = {
    brand: 'bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600 border-brand-200 shadow-inner',
    accent: 'bg-gradient-to-br from-accent-50 to-accent-100 text-accent-600 border-accent-200 shadow-inner',
    success: 'bg-gradient-to-br from-green-50 to-green-100 text-green-600 border-green-200 shadow-inner',
    warning: 'bg-gradient-to-br from-amber-50 to-amber-100 text-amber-600 border-amber-200 shadow-inner',
    error: 'bg-gradient-to-br from-red-50 to-red-100 text-red-600 border-red-200 shadow-inner',
    navy: 'bg-gradient-to-br from-navy-50 to-navy-100 text-navy-700 border-navy-200 shadow-inner',
    neutral: 'bg-gradient-to-br from-slate-50 to-slate-100 text-slate-600 border-slate-200 shadow-inner',
    info: 'bg-gradient-to-br from-blue-50 to-blue-100 text-blue-600 border-blue-200 shadow-inner',
  };

  if (compact) {
    return (
      <Card className="px-3 py-2 flex items-center justify-between gap-2.5 shadow-xs border border-slate-200/90 hover:shadow-sm transition-all duration-200 group overflow-hidden">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider truncate leading-tight mb-0.5">{label}</p>
          <p className="text-base font-bold text-slate-900 tracking-tight leading-tight group-hover:text-brand-600 transition-colors">{value}</p>
        </div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${accentMap[accent]} [&>svg]:w-4 [&>svg]:h-4`}>
          {icon}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 hover:shadow-premium-hover hover:-translate-y-1 transition-all duration-300 group overflow-hidden relative">
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-white/40 to-transparent rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
          <p className="text-[28px] font-bold text-slate-800 tracking-tight leading-none group-hover:text-brand-600 transition-colors">{value}</p>
          {trend && (
            <div className="flex items-center gap-1 mt-3">
              <span
                className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                  trendUp ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}
              >
                {trendUp ? '↑' : '↓'} {trend}
              </span>
            </div>
          )}
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${accentMap[accent]} transition-transform duration-300 group-hover:scale-110`}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

type BadgeVariant =
  | 'brand' | 'success' | 'warning' | 'error' | 'neutral' | 'info' | 'accent';

const badgeStyles: Record<BadgeVariant, string> = {
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
  success: 'bg-green-50 text-green-700 border-green-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  accent: 'bg-accent-50 text-accent-700 border-accent-200',
};

export function Badge({
  children,
  variant = 'neutral',
  dot = false,
  className = '',
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  className?: string;
}) {
  const dotColors: Record<BadgeVariant, string> = {
    brand: 'bg-brand-500',
    success: 'bg-green-500',
    warning: 'bg-amber-500',
    error: 'bg-red-500',
    neutral: 'bg-slate-400',
    info: 'bg-blue-500',
    accent: 'bg-accent-500',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${badgeStyles[variant] ?? badgeStyles.neutral} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant] ?? dotColors.neutral}`} />}
      {children}
    </span>
  );
}

export function statusToVariant(status: string | null | undefined): BadgeVariant {
  const s = (status ?? '').toString().toLowerCase();
  if (['running', 'active', 'completed', 'pass', 'delivered', 'received', 'released', 'accepted', 'confirmed'].includes(s)) return 'success';
  if (['idle', 'planning', 'pending', 'draft', 'scheduled', 'sent', 'new', 'setup'].includes(s)) return 'neutral';
  if (['in progress', 'partially delivered', 'partially received', 'under review', 'quoted', 'in production', 'on order', 'under investigation', 'action taken'].includes(s)) return 'brand';
  if (['maintenance', 'on hold', 'paused', 'low stock', 'delayed', 'overdue', 'rework', 'prototype'].includes(s)) return 'warning';
  if (['breakdown', 'cancelled', 'rejected', 'fail', 'out of stock', 'lost', 'expired', 'suspended', 'open', 'critical'].includes(s)) return 'error';
  if (['obsolete', 'superseded', 'inactive'].includes(s)) return 'neutral';
  return 'neutral';
}

export function priorityToVariant(priority: string | null | undefined): BadgeVariant {
  const p = (priority ?? '').toString().toLowerCase();
  if (p === 'critical') return 'error';
  if (p === 'high') return 'warning';
  if (p === 'medium') return 'brand';
  return 'neutral';
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  onClick,
  className = '',
  type = 'button',
  disabled = false,
  title,
}: {
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'error' | 'brand' | 'success' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  title?: string;
}) {
  const variants: Record<string, string> = {
    primary: 'bg-brand-600 hover:bg-brand-500 text-white shadow-md shadow-brand-500/20 hover:shadow-brand-500/40 border border-brand-600 hover:-translate-y-0.5',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 shadow-sm hover:shadow-md hover:-translate-y-0.5',
    ghost: 'hover:bg-slate-100 text-slate-600 hover:-translate-y-0.5',
    danger: 'bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-500/20 hover:shadow-red-500/40 border border-red-600 hover:-translate-y-0.5',
    error: 'bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-500/20 hover:shadow-red-500/40 border border-red-600 hover:-translate-y-0.5',
    brand: 'bg-brand-600 hover:bg-brand-500 text-white shadow-md shadow-brand-500/20 hover:shadow-brand-500/40 border border-brand-600 hover:-translate-y-0.5',
    success: 'bg-green-600 hover:bg-green-500 text-white shadow-md shadow-green-500/20 hover:shadow-green-500/40 border border-green-600 hover:-translate-y-0.5',
    outline: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 shadow-sm hover:shadow-md hover:-translate-y-0.5',
  };
  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-sm',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-all duration-150 active:scale-[0.98] ${variants[variant] ?? variants.primary} ${sizes[size] ?? sizes.md} ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function ProgressBar({
  value,
  max = 100,
  color = 'brand',
  showLabel = false,
  height = 'h-2',
}: {
  value: number;
  max?: number;
  color?: 'brand' | 'success' | 'warning' | 'error' | 'accent' | 'neutral';
  showLabel?: boolean;
  height?: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  const colors: Record<string, string> = {
    brand: 'bg-brand-500',
    success: 'bg-green-500',
    warning: 'bg-amber-500',
    error: 'bg-red-500',
    accent: 'bg-accent-500',
    neutral: 'bg-slate-400',
  };
  return (
    <div className="w-full">
      <div className={`w-full bg-slate-100 rounded-full overflow-hidden ${height}`}>
        <div
          className={`${colors[color]} ${height} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-slate-500 mt-1 inline-block">{pct.toFixed(0)}%</span>
      )}
    </div>
  );
}

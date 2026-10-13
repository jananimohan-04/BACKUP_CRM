import type { ReactElement } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PAGE_MODULE } from '@/config/permissions';

// Route-level module guard: same effective permissions as the sidebar/KPIs.
// Unmapped pages keep the previous behaviour (authorized users may open them).
// Denied access renders a friendly notice instead of flashing the page.
export function RequireModule({ module, action = 'view', children }: {
  module?: string;
  action?: 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export';
  children: ReactElement;
}) {
  const { canView, canDo, permissions } = useAuth();
  if (!module) return children;
  if (permissions === null) {
    return (
      <div className="p-4 lg:p-6 bg-grid min-h-full">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-3 border-slate-200 border-t-brand-500 rounded-full animate-spin" style={{ borderWidth: '3px' }} />
        </div>
      </div>
    );
  }
  const allowed = action === 'view' ? canView(module) : canDo(module, action);
  if (!allowed) {
    return (
      <div className="p-4 lg:p-6 bg-grid min-h-full">
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-700">Not Authorized</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-sm">Your account does not have access to this module. Ask your Company Admin or Super Admin to grant it.</p>
        </div>
      </div>
    );
  }
  return children;
}

/** Resolve the owning module for a route page (no leading slash). */
export function moduleForPage(page: string): string | undefined {
  return PAGE_MODULE[page];
}

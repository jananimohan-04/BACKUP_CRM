// Minimal self-contained toast host for the desktop shell.
//
// The ERP web app has no global toast system (the vault subtree has its own sonner
// instance), so the desktop shell carries this tiny dependency-free one instead of
// pulling a new provider into the shared layout. Only rendered in the Tauri app.

import { useSyncExternalStore } from 'react';

export type DesktopToastKind = 'success' | 'error' | 'info';

export interface DesktopToast {
  id: number;
  kind: DesktopToastKind;
  title: string;
  message?: string;
  /** Milliseconds before auto-dismiss (0 = stays until clicked). */
  duration: number;
}

let nextId = 1;
let toasts: DesktopToast[] = [];
const listeners = new Set<() => void>();

function emit() {
  const snapshot = toasts;
  listeners.forEach((fn) => fn());
  void snapshot;
}

export function desktopToast(
  kind: DesktopToastKind,
  title: string,
  message?: string,
  duration = 5000,
): void {
  const id = nextId++;
  toasts = [...toasts, { id, kind, title, message, duration }];
  emit();
  if (duration > 0) {
    window.setTimeout(() => dismissDesktopToast(id), duration);
  }
}

export function dismissDesktopToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function getSnapshot() {
  return toasts;
}

const KIND_STYLES: Record<DesktopToastKind, { bar: string; icon: string; text: string }> = {
  success: { bar: 'bg-emerald-500', icon: '✓', text: 'text-emerald-600' },
  error: { bar: 'bg-rose-500', icon: '✕', text: 'text-rose-600' },
  info: { bar: 'bg-sky-500', icon: 'ℹ', text: 'text-sky-600' },
};

/** Fixed top-right toast stack. Mounted only in the desktop shell (App.tsx). */
export function DesktopToasts() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (items.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[2147483000] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {items.map((t) => {
        const style = KIND_STYLES[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className="relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10 pl-4 pr-3 py-3"
          >
            <span className={`absolute left-0 top-0 h-full w-1 ${style.bar}`} />
            <div className="flex items-start gap-2">
              <span className={`text-sm font-bold leading-5 ${style.text}`}>{style.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 leading-5">{t.title}</p>
                {t.message && (
                  <p className="text-xs text-slate-500 mt-0.5 break-all leading-4">{t.message}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismissDesktopToast(t.id)}
                className="text-slate-400 hover:text-slate-600 text-sm leading-5 px-1"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

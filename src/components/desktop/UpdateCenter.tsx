// Desktop update center: the in-app notification + download/install UI.
//
// Mounted only in the Tauri shell (App.tsx). Listens for update state events
// emitted by lib/desktop/updater.ts (startup/periodic/manual checks) and shows:
//   * an "Update available" card  →  Update Now  /  Remind Me Later
//   * download progress           →  Installing… (the app restarts itself)
//   * errors                      →  Retry / Dismiss (manual checks only)
//
// The updater plugin verifies the minisign signature of every downloaded
// artifact against the public key compiled into tauri.conf.json before install;
// this UI never touches that path.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearRemindLater,
  discardPendingUpdate,
  getPendingUpdate,
  getRemindUntil,
  runUpdateCheck,
  setRemindLater,
  type UpdateSummary,
} from '@/lib/desktop/updater';

type ViewState =
  | { kind: 'hidden' }
  | { kind: 'available'; summary: UpdateSummary }
  | { kind: 'downloading'; received: number; total?: number }
  | { kind: 'installing' }
  | { kind: 'error'; message: string }
  | { kind: 'uptodate' };

interface StateEventDetail {
  kind: 'available' | 'none' | 'error';
  summary?: UpdateSummary;
  origin?: string;
  message?: string;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function UpdateCenter() {
  const [view, setView] = useState<ViewState>({ kind: 'hidden' });
  const dismissing = useRef(false);

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<StateEventDetail>).detail;
      if (!detail) return;
      if (detail.kind === 'available' && detail.summary) {
        const summary = detail.summary;
        if (dismissing.current) return;
        // Automatic checks honour "Remind Me Later"; manual checks always show.
        if (summary.origin !== 'manual' && getRemindUntil() > Date.now()) return;
        setView({ kind: 'available', summary });
      } else if (detail.kind === 'error') {
        // Only manual checks surface errors (offline startup stays silent).
        if (detail.origin === 'manual') setView({ kind: 'error', message: detail.message || 'Update check failed.' });
      } else if (detail.kind === 'none' && detail.origin === 'manual') {
        setView({ kind: 'uptodate' });
        window.setTimeout(() => {
          setView((v) => (v.kind === 'uptodate' ? { kind: 'hidden' } : v));
        }, 4000);
      }
    };
    window.addEventListener('cncforge:update-state', onState);
    return () => window.removeEventListener('cncforge:update-state', onState);
  }, []);

  const dismiss = useCallback(() => {
    setView({ kind: 'hidden' });
    if (getPendingUpdate()) discardPendingUpdate();
  }, []);

  const remindLater = useCallback(() => {
    setRemindLater();
    setView({ kind: 'hidden' });
    // Discard this candidate; a later check re-detects it after the snooze ends.
    if (getPendingUpdate()) discardPendingUpdate();
  }, []);

  const startInstall = useCallback(async () => {
    const update = getPendingUpdate();
    if (!update) {
      setView({ kind: 'error', message: 'Update information expired. Please check again.' });
      return;
    }
    // A fresh check clears any "remind later" snooze once the user commits.
    clearRemindLater();
    let received = 0;
    let total: number | undefined;
    setView({ kind: 'downloading', received: 0, total: undefined });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength;
          setView({ kind: 'downloading', received, total });
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          setView({ kind: 'downloading', received, total });
        } else if (event.event === 'Finished') {
          setView({ kind: 'installing' });
        }
      });
      // On Windows the process normally exits inside install() and the NSIS
      // updater restarts the app (restartAfterInstall defaults to true). If we
      // ever get here, restart explicitly so the user is never left stale.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The installer taking the process down mid-flight is expected on Windows.
      if (/exit|closed|destroyed|shutdown/i.test(message)) {
        setView({ kind: 'installing' });
        return;
      }
      console.error('[updater] install failed:', err);
      setView({ kind: 'error', message });
    }
  }, []);

  const retry = useCallback(() => {
    setView({ kind: 'hidden' });
    void runUpdateCheck('manual');
  }, []);

  if (view.kind === 'hidden' || view.kind === 'uptodate') return null;

  const cardBase =
    'fixed bottom-4 right-4 z-[2147483500] w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/25 overflow-hidden';
  const titleBar =
    'flex items-center gap-2 bg-navy-950 text-white px-4 py-3'; // matches ERP chrome
  const actions = 'flex items-center justify-end gap-2 px-4 py-3 bg-slate-50 border-t border-slate-200';
  const btnPrimary =
    'px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold transition-colors disabled:opacity-60';
  const btnGhost =
    'px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-100 transition-colors';

  if (view.kind === 'available') {
    const { summary } = view;
    return (
      <div className={cardBase} role="alertdialog" aria-label="Update available">
        <div className={titleBar}>
          <span className="text-base">⬆</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Update available</p>
            <p className="text-xs text-slate-300 leading-tight mt-0.5">
              v{summary.currentVersion} → v{summary.version}
            </p>
          </div>
        </div>
        <div className="px-4 py-3">
          {summary.notes && (
            <p className="text-xs text-slate-600 line-clamp-4 whitespace-pre-wrap max-h-28 overflow-y-auto">
              {summary.notes}
            </p>
          )}
          {!summary.notes && (
            <p className="text-xs text-slate-500">
              A new version of CNCFORGE ERP is ready to install. Your data is preserved.
            </p>
          )}
        </div>
        <div className={actions}>
          <button type="button" className={btnGhost} onClick={remindLater}>
            Remind Me Later
          </button>
          <button type="button" className={btnPrimary} onClick={() => void startInstall()}>
            Update Now
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === 'downloading') {
    const pct =
      view.total && view.total > 0 ? Math.min(100, Math.round((view.received / view.total) * 100)) : null;
    return (
      <div className={cardBase} role="status" aria-label="Downloading update">
        <div className={titleBar}>
          <span className="text-base">⬇</span>
          <p className="text-sm font-semibold flex-1">Downloading update…</p>
          <span className="text-xs text-slate-300">{pct !== null ? `${pct}%` : formatBytes(view.received)}</span>
        </div>
        <div className="px-4 py-4">
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-brand-500 transition-[width] duration-200"
              style={{ width: pct !== null ? `${pct}%` : '35%' }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            The update is signature-verified before installation.
          </p>
        </div>
      </div>
    );
  }

  if (view.kind === 'installing') {
    return (
      <div className={cardBase} role="status" aria-label="Installing update">
        <div className={titleBar}>
          <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          <p className="text-sm font-semibold flex-1">Installing update…</p>
        </div>
        <div className="px-4 py-4">
          <p className="text-xs text-slate-600">
            CNCFORGE ERP will restart automatically. Please do not shut down the app.
          </p>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className={cardBase} role="alertdialog" aria-label="Update error">
      <div className={`${titleBar} !bg-rose-950`}>
        <span className="text-base">⚠</span>
        <p className="text-sm font-semibold flex-1">Update failed</p>
      </div>
      <div className="px-4 py-3">
        <p className="text-xs text-slate-600 break-words max-h-28 overflow-y-auto">{view.message}</p>
        <p className="text-xs text-slate-400 mt-1">
          You can keep working — updates will be checked again automatically.
        </p>
      </div>
      <div className={actions}>
        <button type="button" className={btnGhost} onClick={dismiss}>
          Dismiss
        </button>
        <button type="button" className={btnPrimary} onClick={retry}>
          Try Again
        </button>
      </div>
    </div>
  );
}

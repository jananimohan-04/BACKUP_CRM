// Desktop-only Settings → Updates & About section.
//
// Rendered by SettingsPage in pages/admin/AdminPages.tsx *only* inside the Tauri
// shell; the web build keeps the original AdminStub placeholder. Provides:
//   * About: app name, installed version (from the OS bundle), identifier
//   * Updates: "Check for updates" (manual, always visible result), the startup
//     and periodic check toggles, and a note about signature verification
//
// Manual checks dispatch `cncforge:check-updates`; lib/desktop/updater.ts runs
// the check and answers through `cncforge:update-state` events (this component
// and the UpdateCenter card both listen).

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Card';
import { getVersion } from '@tauri-apps/api/app';
import { getUpdateSettings, setUpdateSettings, type UpdateCheckSettings } from '@/lib/desktop/updater';

type CheckStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'uptodate' }
  | { kind: 'error'; message: string };

interface StateEventDetail {
  kind: 'available' | 'none' | 'error';
  summary?: { version?: string; origin?: string };
  origin?: string;
  message?: string;
}

export function UpdatesSettingsPage() {
  const [version, setVersion] = useState<string | null>(null);
  const [settings, setSettings] = useState<UpdateCheckSettings>(() => getUpdateSettings());
  const [status, setStatus] = useState<CheckStatus>({ kind: 'idle' });

  useEffect(() => {
    let alive = true;
    getVersion()
      .then((v) => { if (alive) setVersion(v); })
      .catch(() => { /* version shown as unknown */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<StateEventDetail>).detail;
      if (!detail) return;
      if (detail.kind === 'available') {
        setStatus({ kind: 'available', version: detail.summary?.version ?? 'a newer version' });
      } else if (detail.kind === 'none') {
        setStatus({ kind: 'uptodate' });
      } else if (detail.kind === 'error') {
        setStatus({ kind: 'error', message: detail.message || 'Update check failed.' });
      }
    };
    window.addEventListener('cncforge:update-state', onState);
    return () => window.removeEventListener('cncforge:update-state', onState);
  }, []);

  const checkNow = () => {
    setStatus({ kind: 'checking' });
    window.dispatchEvent(new CustomEvent('cncforge:check-updates'));
  };

  const toggle = (key: keyof UpdateCheckSettings) => {
    const next = setUpdateSettings({ [key]: !settings[key] } as Partial<UpdateCheckSettings>);
    setSettings(next);
  };

  const card = 'rounded-xl border border-slate-200 bg-white shadow-sm';
  const rowLabel = 'text-sm font-medium text-slate-800';
  const rowHint = 'text-xs text-slate-500 mt-0.5';
  const switchTrack = (on: boolean) =>
    `relative inline-flex items-center h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${on ? 'bg-brand-500' : 'bg-slate-300'}`;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader
        title="Company Settings"
        description="Global ERP configuration and preferences"
      />

      <div className="grid gap-4 max-w-3xl">
        {/* About ---------------------------------------------------------- */}
        <section className={`${card} p-5`}>
          <h2 className="text-base font-bold text-slate-800 mb-4">About</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-slate-500">Application</dt>
            <dd className="text-slate-800 font-semibold">CNCFORGE ERP</dd>
            <dt className="text-slate-500">Version</dt>
            <dd className="text-slate-800 font-semibold">{version ? `${version} (stable)` : '—'}</dd>
            <dt className="text-slate-500">Identifier</dt>
            <dd className="text-slate-800 font-mono text-xs self-center">com.cncforge.erp</dd>
            <dt className="text-slate-500">Edition</dt>
            <dd className="text-slate-800">Windows desktop</dd>
          </dl>
        </section>

        {/* Updates -------------------------------------------------------- */}
        <section className={`${card} p-5`}>
          <h2 className="text-base font-bold text-slate-800 mb-1">Updates</h2>
          <p className="text-xs text-slate-500 mb-4">
            Updates are downloaded from GitHub Releases and cryptographically verified
            before anything is installed. The app never installs an unsigned or
            tampered package, and your data is preserved across updates.
          </p>

          <div className="flex items-center justify-between gap-4 py-3 border-t border-slate-100">
            <div>
              <p className={rowLabel}>Check at startup</p>
              <p className={rowHint}>Look for a new version shortly after the app opens.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.checkOnStartup}
              onClick={() => toggle('checkOnStartup')}
              className={switchTrack(settings.checkOnStartup)}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${settings.checkOnStartup ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 py-3 border-t border-slate-100">
            <div>
              <p className={rowLabel}>Check every 4 hours</p>
              <p className={rowHint}>Periodic background check while the app is open.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.checkPeriodic}
              onClick={() => toggle('checkPeriodic')}
              className={switchTrack(settings.checkPeriodic)}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${settings.checkPeriodic ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}
              />
            </button>
          </div>

          <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
            <Button variant="primary" size="sm" onClick={checkNow} disabled={status.kind === 'checking'}>
              {status.kind === 'checking' ? 'Checking…' : 'Check for Updates'}
            </Button>
            <span className="text-sm">
              {status.kind === 'available' && (
                <span className="text-emerald-600 font-semibold">
                  v{status.version} is available — use the update card to install it.
                </span>
              )}
              {status.kind === 'uptodate' && (
                <span className="text-slate-600">You are on the latest version.</span>
              )}
              {status.kind === 'error' && (
                <span className="text-rose-600">{status.message}</span>
              )}
              {status.kind === 'idle' && (
                <span className="text-slate-400 text-xs">Manual check available any time.</span>
              )}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

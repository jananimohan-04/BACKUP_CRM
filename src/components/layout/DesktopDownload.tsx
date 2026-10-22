// "Download Desktop App" affordances for the web build: a compact topbar
// button plus a matching item in the profile menu (so it is reachable on
// mobile too). Both render nothing inside the Tauri desktop shell — desktop
// users already have the app. URL + version come from src/lib/desktopDownload.ts.

import { useState } from 'react';
import { Download } from 'lucide-react';
import { isTauri } from '@/lib/desktop/isTauri';
import { DESKTOP_APP_VERSION, downloadDesktopApp } from '@/lib/desktopDownload';

type Status = 'idle' | 'busy' | 'error';

/** Shown after the installer starts downloading: the installer is not yet signed with a Windows publisher certificate. */
export const INSTALL_HELP =
  'If Windows says "Windows protected your PC": click More info, then Run anyway. If it is blocked completely, right-click the downloaded file > Properties > tick Unblock > OK, or install from the browser instead (address bar > Install icon).';

function useInstallerDownload() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [hint, setHint] = useState(false);

  /** Returns true when the download was handed to the browser. */
  const start = async (): Promise<boolean> => {
    setStatus('busy');
    setError('');
    try {
      await downloadDesktopApp();
      setStatus('idle');
      setHint(true);
      window.setTimeout(() => setHint(false), 30000);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The download could not be started. Please try again.');
      setStatus('error');
      return false;
    }
  };

  return { status, error, hint, start };
}

/** Compact topbar trigger — icon on smaller screens, full label on wide ones. */
export function DesktopDownloadButton() {
  const { status, error, hint, start } = useInstallerDownload();
  if (isTauri()) return null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => void start()}
        disabled={status === 'busy'}
        title={`Download the Windows desktop application (v${DESKTOP_APP_VERSION})`}
        aria-label={`Download Desktop App version ${DESKTOP_APP_VERSION}`}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border shadow-sm transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-60 ${
          status === 'error'
            ? 'border-red-200 bg-red-50 hover:bg-red-100'
            : 'border-slate-200 bg-white hover:bg-brand-50 hover:border-brand-300'
        }`}
      >
        <Download size={14} className={status === 'error' ? 'text-red-500' : 'text-brand-600'} />
        <span className={`hidden xl:inline text-xs font-bold whitespace-nowrap ${status === 'error' ? 'text-red-600' : 'text-slate-700'}`}>
          Download Desktop App
        </span>
        <span className="hidden lg:inline text-[9px] font-extrabold text-slate-400 tabular-nums">v{DESKTOP_APP_VERSION}</span>
      </button>
      {hint && status !== 'error' && (
        <div role="status" className="absolute right-0 top-full mt-2 w-72 p-2.5 bg-sky-50 border border-sky-200 rounded-lg shadow-lg text-[11px] font-medium text-sky-800 z-50">
          {INSTALL_HELP}
        </div>
      )}
      {status === 'error' && (
        <div role="alert" className="absolute right-0 top-full mt-2 w-60 p-2.5 bg-red-50 border border-red-200 rounded-lg shadow-lg text-[11px] font-medium text-red-700 z-50">
          {error}
          <span className="block mt-1 font-bold">Click the button again to retry.</span>
        </div>
      )}
    </div>
  );
}

/** Profile-menu row — full label + version, works at every screen size. */
export function DesktopDownloadMenuItem({ onDone }: { onDone?: () => void }) {
  const { status, error, hint, start } = useInstallerDownload();
  if (isTauri()) return null;

  return (
    <>
      <button
        type="button"
        disabled={status === 'busy'}
        onClick={() => void start().then(ok => { if (ok) onDone?.(); })}
        title="Download the Windows desktop application"
        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors text-left cursor-pointer disabled:opacity-60 disabled:cursor-wait"
      >
        <Download size={15} className="text-slate-400" />
        Download Desktop App
        <span className="ml-auto text-[10px] font-bold text-slate-400 tabular-nums">v{DESKTOP_APP_VERSION}</span>
      </button>
      {hint && status !== 'error' && <p role="status" className="px-3 pb-2 text-[11px] font-medium text-sky-800">{INSTALL_HELP}</p>}
      {status === 'error' && (
        <p role="alert" className="px-3 pb-2 text-[11px] font-medium text-red-600">
          {error} <span className="font-bold">Tap the item to retry.</span>
        </p>
      )}
    </>
  );
}

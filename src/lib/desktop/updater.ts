// Update orchestration for the desktop shell.
//
// Responsibilities (UI lives in components/desktop/UpdateCenter.tsx):
//   * schedule automatic checks: shortly after startup + every 4 hours (both
//     individually configurable, persisted in localStorage)
//   * respond to the manual "Check for updates" action (window event
//     `cncforge:check-updates`, dispatched from Settings → Updates)
//   * keep the latest `Update` resource so the UI can download/install it
//   * treat offline / endpoint failures as non-events for silent checks
//     (the web app keeps working; only manual checks report the error)
//
// Never disables signature verification: the pubkey is compiled into
// tauri.conf.json and enforced by tauri-plugin-updater regardless of this code.

import { check, type Update } from '@tauri-apps/plugin-updater';

/** Suppresses the "Update available" card until this timestamp (Remind Me Later). */
export const REMIND_UNTIL_KEY = 'cncforge.update.remindUntil';
export const CHECK_STARTUP_KEY = 'cncforge.update.checkStartup';
export const CHECK_PERIODIC_KEY = 'cncforge.update.checkPeriodic';

const STARTUP_DELAY_MS = 8_000;
const PERIODIC_MS = 4 * 60 * 60 * 1000; // every 4 hours
const REMIND_LATER_MS = 24 * 60 * 60 * 1000; // re-offer tomorrow

export interface UpdateCheckSettings {
  checkOnStartup: boolean;
  checkPeriodic: boolean;
}

export type UpdateCheckOrigin = 'startup' | 'periodic' | 'manual';

/** Serializable summary of an available update (the live `Update` stays module-side). */
export interface UpdateSummary {
  currentVersion: string;
  version: string;
  date?: string;
  notes?: string;
  origin: UpdateCheckOrigin;
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v !== 'false';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch { /* private mode / quota: defaults still apply */ }
}

export function getUpdateSettings(): UpdateCheckSettings {
  return {
    checkOnStartup: readBool(CHECK_STARTUP_KEY, true),
    checkPeriodic: readBool(CHECK_PERIODIC_KEY, true),
  };
}

export function setUpdateSettings(settings: Partial<UpdateCheckSettings>): UpdateCheckSettings {
  if (settings.checkOnStartup !== undefined) writeBool(CHECK_STARTUP_KEY, settings.checkOnStartup);
  if (settings.checkPeriodic !== undefined) writeBool(CHECK_PERIODIC_KEY, settings.checkPeriodic);
  return getUpdateSettings();
}

export function getRemindUntil(): number {
  try {
    return Number(localStorage.getItem(REMIND_UNTIL_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function setRemindLater(): void {
  try {
    localStorage.setItem(REMIND_UNTIL_KEY, String(Date.now() + REMIND_LATER_MS));
  } catch { /* ignore */ }
}

export function clearRemindLater(): void {
  try {
    localStorage.removeItem(REMIND_UNTIL_KEY);
  } catch { /* ignore */ }
}

// The live Update resource (holds a Rust-side handle; closed when replaced/dismissed).
let pendingUpdate: Update | null = null;

export function getPendingUpdate(): Update | null {
  return pendingUpdate;
}

/** Releases the current update resource without installing (e.g. user dismissed). */
export function discardPendingUpdate(): void {
  const current = pendingUpdate;
  pendingUpdate = null;
  if (current) void current.close().catch(() => { /* already gone */ });
}

type UpdateEventDetail =
  | { kind: 'available'; summary: UpdateSummary }
  | { kind: 'none'; origin: UpdateCheckOrigin }
  | { kind: 'error'; origin: UpdateCheckOrigin; message: string };

function dispatch(detail: UpdateEventDetail): void {
  window.dispatchEvent(new CustomEvent<UpdateEventDetail>('cncforge:update-state', { detail }));
}

export type CheckOutcome =
  | { status: 'available'; update: Update }
  | { status: 'up-to-date' }
  | { status: 'error'; message: string };

/** Runs one update check. Silent checks swallow errors; manual ones report them. */
export async function runUpdateCheck(
  origin: UpdateCheckOrigin,
  options: { manual?: boolean } = {},
): Promise<CheckOutcome> {
  const manual = options.manual ?? origin === 'manual';
  try {
    const update = await check();
    if (update) {
      if (pendingUpdate && pendingUpdate !== update) {
        // Replace the previous candidate so its Rust resource is released.
        void pendingUpdate.close().catch(() => { /* ignore */ });
      }
      pendingUpdate = update;
      dispatch({
        kind: 'available',
        summary: {
          currentVersion: update.currentVersion,
          version: update.version,
          date: update.date,
          notes: update.body,
          origin,
        },
      });
      return { status: 'available', update };
    }
    if (manual) dispatch({ kind: 'none', origin });
    return { status: 'up-to-date' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Offline / DNS / GitHub outage: never interrupt the user on automatic checks.
    console.warn(`[updater] check failed (${origin}):`, message);
    if (manual) dispatch({ kind: 'error', origin, message });
    return { status: 'error', message };
  }
}

let started = false;

/** Called once from main.tsx in the desktop shell. */
export function startUpdateScheduler(): void {
  if (started) return;
  started = true;

  const settings = getUpdateSettings();
  if (settings.checkOnStartup) {
    window.setTimeout(() => { void runUpdateCheck('startup'); }, STARTUP_DELAY_MS);
  }
  // The interval always runs; the user's preference is re-read on every tick so a
  // toggle in Settings applies immediately without a restart.
  window.setInterval(() => {
    if (!getUpdateSettings().checkPeriodic) return;
    void runUpdateCheck('periodic');
  }, PERIODIC_MS);

  // Manual checks from Settings (and anywhere else in the app).
  window.addEventListener('cncforge:check-updates', () => {
    void runUpdateCheck('manual');
  });
}

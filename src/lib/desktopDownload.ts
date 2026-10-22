// Configuration for the web app's "Download Desktop App" button â€” the SINGLE
// SOURCE OF TRUTH for the public installer URL and the version it advertises.
//
// Releasing a new desktop version (see docs/desktop/RELEASING.md):
//   1. Replace public/downloads/cncforge-erp-setup.exe with the new NSIS
//      installer (src-tauri/target/release/bundle/nsis/*-setup.exe), keeping
//      the stable filename. The file is copied verbatim into dist/ by Vite and
//      served at https://with-cnc.vercel.app/downloads/cncforge-erp-setup.exe.
//   2. Bump DESKTOP_APP_VERSION below to the new semver (keep it in sync with
//      package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml).
//   3. Re-run `npm run build` and confirm dist/downloads/cncforge-erp-setup.exe
//      has the new installer's size.
//
// Alternative hosting: once GitHub Releases are published, the URL may point at
// the release asset instead (e.g.
// https://github.com/jananimohan-04/with_cnc/releases/download/vX.Y.Z/...),
// which removes the need to commit the binary. The .sig file is NOT needed
// here â€” signatures are only consumed by the in-app auto-updater.

/** Version shown to users; keep in sync with the desktop release version. */
export const DESKTOP_APP_VERSION = '1.0.2';

/** Public, same-origin URL of the Windows installer (served from public/). */
export const DESKTOP_DOWNLOAD_URL = '/downloads/cncforge-erp-setup.exe';

/** Meaningful filename the browser suggests for the downloaded file. */
export const DESKTOP_DOWNLOAD_FILENAME = `CNCFORGE-ERP-Setup-${DESKTOP_APP_VERSION}.exe`;

/** Below this size (bytes) a served installer is considered truncated. */
const MIN_EXPECTED_SIZE = 1_000_000;

/**
 * Checks that DESKTOP_DOWNLOAD_URL actually serves the installer â€” guarding
 * against the SPA fallback returning index.html (or a 404 page) for a missing
 * file, which would otherwise download a useless HTML "installer".
 */
export async function verifyDesktopDownloadUrl(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(DESKTOP_DOWNLOAD_URL, { method: 'HEAD', cache: 'no-store' });
  } catch {
    throw new Error('Could not reach the server. Check your internet connection and try again.');
  }

  if (!res.ok) {
    throw new Error(`The desktop installer is not available yet (server returned ${res.status}). Please try again later.`);
  }

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error('The download link is not set up yet â€” the server returned the web page instead of the installer.');
  }

  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 0 && contentLength < MIN_EXPECTED_SIZE) {
    throw new Error('The installer on the server looks incomplete. Please try again later.');
  }
}

/**
 * Verifies the URL, then starts the download with a meaningful filename.
 * Resolves when the download has been handed to the browser; throws an
 * Error with a user-facing message on any failure (caller shows it + retry).
 */
export async function downloadDesktopApp(): Promise<void> {
  await verifyDesktopDownloadUrl();

  const anchor = document.createElement('a');
  anchor.href = DESKTOP_DOWNLOAD_URL;
  anchor.download = DESKTOP_DOWNLOAD_FILENAME;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

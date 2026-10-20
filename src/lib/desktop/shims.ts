// Desktop compatibility shims for the WebView2 shell.
//
// The ERP's print/preview flows are built around browser popups:
//   * `const tab = window.open('', '_blank'); tab.document.write(html); ... window.print()`
//   * `const tab = window.open(''); tab.location.href = blobUrlOrSignedUrl; tab.close()`
//   * `<a download>` + `URL.createObjectURL` for CSV/PDF exports
//
// WebView2 has no real popups (Tauri denies window.open), so this module keeps the
// same calling conventions working without touching any call site:
//
//   1. `window.open('')` / `about:blank` returns a *popup panel* — a full-screen
//      overlay with a same-origin `about:blank` iframe. The returned handle exposes
//      `.document` (the iframe document, so `document.write` works), `.location`
//      (navigates the iframe), `.print()`, `.focus()` and `.close()`.
//   2. `window.open(blob:/data:/same-origin URL)` opens the same panel and
//      navigates it immediately.
//   3. `window.open(http(s)/mailto/tel)` hands the link to the OS default handler
//      (system browser) and returns `null`, exactly like `noopener` does on the web.
//   4. `<a download>` clicks on blob:/data: URLs are intercepted and written into
//      the user's Downloads folder through the `save_download` command (WebView2's
//      own blob-download path is unreliable). http(s) downloads keep flowing through
//      the Rust `on_download` handler and toast via the `cncforge-download-finished`
//      event.
//
// Installed once from main.tsx, before React renders.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { desktopToast } from './toast';

let installed = false;

/** Set once the desktop shims are live; the smoke test waits on this marker so it
 * never asserts against a half-booted cold Vite dev load. */
declare global {
  interface Window { __CNCFORGE_DESKTOP_SHELL__?: boolean }
}

export function installDesktopShims(): void {
  if (installed) return;
  installed = true;
  shimWindowOpen();
  installAnchorDownloadInterceptor();
  void listenNativeDownloads();
  window.__CNCFORGE_DESKTOP_SHELL__ = true;
}

// ---------------------------------------------------------------------------
// Popup panel (the `window.open('')` replacement)
// ---------------------------------------------------------------------------

let openPopups = 0;
let savedBodyOverflow: string | null = null;

function parseSize(features?: string): { width: number; height: number } {
  let width = 1000;
  let height = 800;
  if (features) {
    const w = /(?:^|[\s,])width=(\d+)/.exec(features);
    const h = /(?:^|[\s,])height=(\d+)/.exec(features);
    if (w) width = Math.max(320, Number(w[1]));
    if (h) height = Math.max(240, Number(h[1]));
  }
  return { width, height };
}

function createOverlayPopup(features?: string): Window {
  const { width, height } = parseSize(features);
  let closed = false;
  let currentHref = 'about:blank';

  const host = document.createElement('div');
  host.setAttribute('data-cncforge-popup', '');
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147482000;background:rgba(2,6,23,.55);' +
    'display:flex;align-items:center;justify-content:center;padding:16px;';

  const panel = document.createElement('div');
  panel.style.cssText =
    `display:flex;flex-direction:column;overflow:hidden;border-radius:10px;background:#fff;` +
    `box-shadow:0 24px 80px rgba(0,0,0,.5);width:min(${width}px,100%);height:min(${height}px,100%);`;

  const bar = document.createElement('div');
  bar.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:6px 10px;background:#0b1220;' +
    "color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;font-size:12px;user-select:none;";

  const title = document.createElement('span');
  title.textContent = 'CNCFORGE ERP — Preview';
  title.style.cssText = 'flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

  const buttonStyle =
    'border:1px solid #334155;background:#111a2e;color:#e2e8f0;border-radius:6px;' +
    'padding:3px 10px;font-size:12px;cursor:pointer;font-family:inherit;';
  const mkButton = (label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = buttonStyle;
    return b;
  };

  const printBtn = mkButton('Print');
  const extBtn = mkButton('Open in browser ↗');
  const closeBtn = mkButton('✕');
  closeBtn.setAttribute('aria-label', 'Close preview');
  bar.append(title, printBtn, extBtn, closeBtn);

  const iframe = document.createElement('iframe');
  iframe.title = 'Preview';
  iframe.style.cssText = 'border:0;flex:1;width:100%;min-height:0;background:#fff;';

  panel.append(bar, iframe);
  host.append(panel);

  // No `src` on purpose: a freshly inserted iframe already has an *initial*
  // same-origin about:blank document that is ready synchronously, so callers can
  // run `tab.document.write(...)` immediately after window.open returns.

  const updateExternalButton = () => {
    extBtn.style.display = /^https?:/i.test(currentHref) ? '' : 'none';
  };

  const navigate = (value: string) => {
    let href: string;
    try {
      href = new URL(value, window.location.href).href;
    } catch {
      href = value;
    }
    currentHref = href;
    iframe.src = href;
    updateExternalButton();
  };

  const locationHandle = {
    get href() { return currentHref; },
    set href(value: string) { navigate(String(value)); },
    assign(value: string) { navigate(String(value)); },
    replace(value: string) { navigate(String(value)); },
    reload() { navigate(currentHref); },
    toString() { return currentHref; },
  };

  const closeOverlay = () => {
    if (closed) return;
    closed = true;
    host.remove();
    document.removeEventListener('keydown', onKeydown, true);
    openPopups -= 1;
    if (openPopups <= 0 && savedBodyOverflow !== null) {
      document.body.style.overflow = savedBodyOverflow;
      savedBodyOverflow = null;
    }
  };

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeOverlay();
  }

  const handle: Record<string, unknown> = {};
  Object.defineProperties(handle, {
    document: {
      get: () => {
        if (closed) return null;
        // Throws SecurityError once the frame is on a cross-origin URL — a real
        // popup would behave the same, and no flow reads .document after navigating.
        try { return iframe.contentWindow?.document ?? null; } catch { return null; }
      },
    },
    location: { get: () => locationHandle },
    closed: { get: () => closed },
    opener: { get: () => (closed ? null : window) },
    name: { get: () => 'cncforge-popup', set: () => { /* no-op */ } },
    parent: { get: () => (closed ? null : window) },
    top: { get: () => (closed ? null : window) },
    length: { get: () => 0 },
  });
  handle.window = handle;
  handle.self = handle;
  handle.close = closeOverlay;
  handle.focus = () => { if (!closed) iframe.contentWindow?.focus(); };
  handle.blur = () => { /* no-op */ };
  handle.print = () => {
    if (closed) return;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.warn('print failed:', err);
      desktopToast('error', 'Could not open the print dialog', String(err));
    }
  };
  // Present as no-ops: the few flows that wire listeners still behave.
  handle.addEventListener = () => { /* no-op */ };
  handle.removeEventListener = () => { /* no-op */ };
  handle.dispatchEvent = () => true;
  handle.postMessage = () => { /* no-op */ };
  handle.moveTo = () => { /* no-op */ };
  handle.moveBy = () => { /* no-op */ };
  handle.resizeTo = () => { /* no-op */ };
  handle.resizeBy = () => { /* no-op */ };
  handle.scroll = () => { /* no-op */ };

  printBtn.addEventListener('click', () => (handle.print as () => void)());
  extBtn.addEventListener('click', () => {
    void invoke('open_external', { url: currentHref }).catch((err) =>
      desktopToast('error', 'Could not open the link', String(err)),
    );
  });
  closeBtn.addEventListener('click', closeOverlay);
  document.addEventListener('keydown', onKeydown, true);

  if (openPopups === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  openPopups += 1;
  updateExternalButton();
  document.body.append(host);
  iframe.contentWindow?.focus();

  return handle as unknown as Window;
}

// ---------------------------------------------------------------------------
// window.open
// ---------------------------------------------------------------------------

function shimWindowOpen(): void {
  const originalOpen = window.open.bind(window);

  const openFn = (url?: string | URL | null, _target?: string, features?: string): Window | null => {
    const raw = url == null ? '' : String(url).trim();

    // Blank popups: the document.write + print flows.
    if (raw === '' || raw === 'about:blank') return createOverlayPopup(features);

    let parsed: URL;
    try {
      parsed = new URL(raw, window.location.href);
    } catch {
      return createOverlayPopup(features);
    }

    const proto = parsed.protocol;

    // Blob/data previews and same-origin app routes render inside the panel.
    if (proto === 'blob:' || proto === 'data:') {
      const popup = createOverlayPopup(features);
      (popup as unknown as { location: { href: string } }).location.href = parsed.href;
      return popup;
    }
    if ((proto === 'http:' || proto === 'https:') && parsed.origin === window.location.origin) {
      const popup = createOverlayPopup(features);
      (popup as unknown as { location: { href: string } }).location.href = parsed.href;
      return popup;
    }

    // Everything else (external web links, mailto, tel) belongs to the OS.
    if (proto === 'http:' || proto === 'https:' || proto === 'mailto:' || proto === 'tel:') {
      void invoke('open_external', { url: parsed.href }).catch((err) => {
        console.warn('open_external failed:', err);
        // Safety net: let WebView2's native handler (Rust on_new_window) take it.
        try { originalOpen(parsed.href, '_blank', 'noopener'); } catch { /* ignore */ }
      });
      return null;
    }

    console.warn('window.open: blocked unsupported scheme', proto);
    return null;
  };

  window.open = openFn as unknown as typeof window.open;
}

// ---------------------------------------------------------------------------
// <a download> interception (blob:/data: → Downloads folder via save_download)
// ---------------------------------------------------------------------------

function anchorDownloadName(anchor: HTMLAnchorElement, href: string): string {
  const attr = anchor.getAttribute('download');
  if (attr && attr.trim()) return attr.trim();
  try {
    const last = new URL(href).pathname.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch { /* fall through */ }
  return `download-${Date.now()}`;
}

async function saveBlobDownload(href: string, name: string): Promise<void> {
  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    const path = await invoke<string>('save_download', { suggestedName: name, bytes });
    const saved = path.split(/[\\/]/).pop() || name;
    desktopToast('success', 'Saved to Downloads', saved);
  } catch (err) {
    console.error('save_download failed:', err);
    desktopToast('error', 'Download failed', name);
  }
}

function installAnchorDownloadInterceptor(): void {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || !anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href') || '';
      if (!/^(blob:|data:)/i.test(href)) return; // http(s): Rust on_download handles it
      event.preventDefault();
      event.stopPropagation();
      void saveBlobDownload(anchor.href, anchorDownloadName(anchor, href));
    },
    true,
  );
}

// ---------------------------------------------------------------------------
// Toasts for downloads the browser performed natively (http/https, PDF viewer)
// ---------------------------------------------------------------------------

async function listenNativeDownloads(): Promise<void> {
  await listen<{ url: string; path: string; success: boolean }>(
    'cncforge-download-finished',
    (event) => {
      const { path, success } = event.payload;
      const name = path.split(/[\\/]/).pop() || event.payload.url;
      if (success) desktopToast('success', 'Saved to Downloads', name);
      else desktopToast('error', 'Download failed', name);
    },
  );
}

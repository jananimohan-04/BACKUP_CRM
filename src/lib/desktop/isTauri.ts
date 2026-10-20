// Detects whether the app is running inside the CNCFORGE ERP Tauri desktop shell
// (WebView2) or in a normal browser tab (the deployed web app).
//
// `__TAURI_INTERNALS__` is injected by the Tauri IPC initialization script into every
// webview it creates, before any application code runs. It never exists in a browser,
// so this check is safe to use anywhere — including module scope — and requires no
// build flag: the same bundle runs both on the web and in the desktop shell.

export function isTauri(): boolean {
  try {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  } catch {
    return false;
  }
}

# CNCFORGE ERP — Windows desktop edition (Tauri v2)

The desktop app is a **thin shell around the existing React app**. No business
logic was rewritten: the same `src/` tree, same Supabase schema/RLS/API
contracts, same components — bundled into an NSIS installer with a signed
automatic-update channel. The web deployment (Vercel) is untouched and stays
independently deployable.

```
┌────────────────────────────────────────────────────────────┐
│ WebView2  (same SPA as the web app)                        │
│   src/main.tsx   — desktop bootstrap (shims, title,        │
│                    update scheduler) — runs only if        │
│                    isTauri()                               │
│   src/lib/desktop/*   detection, popup/download shims,     │
│                       updater client, loopback sign-in     │
│   src/components/desktop/*  update card, settings section  │
├────────────────────────────────────────────────────────────┤
│ src-tauri/ (Rust)                                          │
│   lib.rs       main window (create:false → handlers first) │
│     on_new_window  external links → OS browser,           │
│                    about:blank → native child window       │
│     on_download    all downloads → Downloads folder +      │
│                    cncforge-download-finished event        │
│   oauth.rs     loopback server (127.0.0.1:53672-53674)     │
│   commands.rs  save_download (blob exports), open_external │
│   plugins: updater, process, opener, http (scoped)         │
└────────────────────────────────────────────────────────────┘
```

## Files

### Rust shell (`src-tauri/`)

| File | Role |
|------|------|
| `tauri.conf.json` | identity `com.cncforge.erp`, product "CNCFORGE ERP", version (sync with package.json), NSIS + updater endpoint + **public** signing key, window config (`create:false`, `dragDropEnabled:false` for HTML5 drag&drop) |
| `src/lib.rs` | window creation with `on_new_window` / `on_download` handlers attached **before** first load |
| `src/oauth.rs` | single-shot loopback HTTP server for the Google redirect (`AUTH_SETUP.md`) |
| `src/commands.rs` | `save_download` (blob → Downloads, collision-free name), `open_external` (scheme-whitelisted) |
| `capabilities/default.json` | ACL: `core`, `opener`, `updater`, `process`, and `http` scoped to `https://with-cnc.vercel.app/*` + `https://*.supabase.co/*` only |
| `.gitignore` | excludes `target/`, generated schemas, **and the signing key if ever placed here** |

### Frontend desktop layer (`src/lib/desktop/`, `src/components/desktop/`)

Desktop-only code is gated at runtime by `isTauri()` (`__TAURI_INTERNALS__`
presence) — the web build executes none of it.

| Module | Role |
|--------|------|
| `isTauri.ts` | runtime detection (no build flag, same bundle both platforms) |
| `shims.ts` | `window.open` → in-app popup panel (document.write/print/location flows kept working); `<a download>` blob exports → Downloads; toast listener for native downloads |
| `updater.ts` | check scheduling (startup + 4 h + manual), remind-later, state events; holds the `Update` resource |
| `auth.ts` | system-browser Google sign-in via loopback + `setSession` |
| `toast.tsx` | tiny self-contained toast host (no shared-layout changes) |
| `components/desktop/UpdateCenter.tsx` | update card: Update Now / Remind Me Later, progress, install/restart, error states |
| `components/desktop/UpdatesSettingsPage.tsx` | Settings → About (version) + Updates (toggles, manual check); web keeps `AdminStub` |

### Deliberate edits to existing files

* `main.tsx` — `if (isTauri())` block (title, shims, scheduler).
* `App.tsx` — mounts `<UpdateCenter/>` + `<DesktopToasts/>` when `isTauri()`.
* `AuthContext.tsx` — `signInWithGoogle` branches to the loopback flow on desktop; the web branch is unchanged.
* `retailSync.ts` — `fetch('/api/retail-sync/*')` goes through `tauri-plugin-http` **only on desktop** (same URL/headers/body, backend untouched).
* `AdminPages.tsx` — `SettingsPage` renders the desktop section on desktop only.
* `package.json` — version `1.0.0`, `tauri*` scripts, Tauri packages.

## Behaviour map: web popup flows → desktop

| Web pattern | Desktop behaviour |
|---|---|
| `window.open('')` + `document.write` + `window.print()` | Full-screen preview panel with the report rendered in-frame; title bar: Print / Open in browser / ✕ (also Esc) |
| `window.open('')` → `tab.location.href = blobUrl` (PDF previews) | Same panel navigates to the blob URL (PDF viewer in-frame) |
| `window.open('')` → `tab.location.href = signedUrl` (attachments) | Same panel shows the attachment; "Open in browser ↗" fallback if a host blocks framing |
| `window.open('https://…')` (WhatsApp, Drive, drawings, files) | Opens in the system default browser, returns `null` (like `noopener`) |
| `<a download>` + blob URL (CSV/PDF exports, jsPDF `.save()`) | Bytes written to the user's Downloads folder (`(1)`-style unique names) + toast |
| http(s) file downloads / PDF-viewer "save" | Rust `on_download` → Downloads folder + toast |
| HTML5 drag & drop (kanban, scheduling) | Works — `dragDropEnabled:false` keeps native HTML5 DnD |

## Security notes

* Update packages are minisign-verified with the public key compiled into
  `tauri.conf.json`; verification is not switchable from the UI or runtime.
* The private signing key lives outside the repo (`C:\Users\Janan\.tauri\`) and
  exists in CI only as a masked secret.
* `open_external` accepts only `http/https/mailto/tel/whatsapp`.
* HTTP plugin scope is limited to the two API origins; no other hosts are
  reachable through IPC from the webview.
* OAuth loopback binds `127.0.0.1` only, single-shot, 5-minute timeout.

## Setup & operations

* Google login setup: `AUTH_SETUP.md`
* Releasing / update channel: `RELEASING.md`
* Local dev: `npm run tauri:dev` (Vite on :5173 + debug shell); production
  build: `npm run tauri:build` → `src-tauri/target/release/bundle/nsis/`

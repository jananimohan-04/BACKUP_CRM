# Releasing CNCFORGE ERP (Windows desktop)

Exact steps from a clean tree to an auto-updating release. Releases are hosted
on **GitHub Releases** of this repository and checked by installed apps at:

```
https://github.com/jananimohan-04/with_cnc/releases/latest/download/latest.json
```

---

## One-time setup (already done / to verify)

| # | Step | Status |
|---|------|--------|
| 1 | Signing keypair generated **outside the repo**: `C:\Users\Janan\.tauri\cncforge-erp.key` (+ `.key.pub`). The public key is embedded in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). | Done on this machine |
| 2 | **Back the private key up now** (password manager/offline copy). It is excluded from git by `src-tauri/.gitignore`. Losing it or regenerating it makes already-distributed apps refuse future updates — there is no key rotation without a manual reinstall. | **ACTION REQUIRED** |
| 3 | Repository secret `TAURI_SIGNING_PRIVATE_KEY` = full file contents of `cncforge-erp.key` (including `untrusted comment:`/`WTt` lines). Settings → Secrets and variables → Actions → New repository secret. | **ACTION REQUIRED** |
| 4 | Repository secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the key's password (ours was generated without one → create the secret with an empty value, or omit it). | **ACTION REQUIRED** |
| 5 | Supabase redirect URLs for desktop login (3 entries) — see `AUTH_SETUP.md`. | **ACTION REQUIRED** |
| 6 | Workflow present: `.github/workflows/desktop-release.yml` (gates: `npm run build`, `cargo check`). | Done |

Never print, log, or commit the private key. CI only ever sees it as a masked
secret; the signature verification in the app uses only the public key that is
already compiled in, and cannot be disabled at runtime.

---

## Cutting a release

1. **Keep the three versions in sync** (must all match the new semver, e.g. `1.0.1`):
   * `package.json` → `"version"`
   * `src-tauri/tauri.conf.json` → `"version"` ← this is what the updater compares against
   * `src-tauri/Cargo.toml` → `version` (then run `cargo check` in `src-tauri/` once so `Cargo.lock` picks it up)
2. **Local gates before tagging:**
   ```powershell
   npm run build          # production web bundle must succeed
   npm run typecheck      # must stay at the pre-existing baseline (109 errors), no new ones
   cd src-tauri; cargo check; cd ..
   ```
3. **Commit and tag** (tag = `v` + the same version):
   ```powershell
   git add -A
   git commit -m "release: v1.0.1"
   git tag v1.0.1
   git push origin main
   git push origin v1.0.1
   ```
4. **CI runs** (`.github/workflows/desktop-release.yml`): install → web build →
   `cargo check` → `tauri build` with `TAURI_SIGNING_PRIVATE_KEY` → creates a
   **draft** release for the tag containing:
   * `CNCFORGE ERP_<version>_x64-setup.exe` (NSIS installer)
   * `CNCFORGE ERP_<version>_x64-setup.nsis.zip` + `.nsis.zip.sig` (updater package + signature)
   * `latest.json` (updater manifest: version, notes, `pub_date`, per-platform `url` + `signature`)
5. **Review the draft release**, then press **Publish release**. Only then do
   installed apps see it (`releases/latest` only resolves to *published* releases).
6. **Verify after publishing:**
   * `https://github.com/jananimohan-04/with_cnc/releases/latest/download/latest.json` opens and shows the new version, a `.sig` signature, and an installer URL.
   * Install the new build from the release over the previous one → app opens on the new version (Settings → Updates & About → About shows it).
   * In the *previously installed* version, Settings → Updates → **Check for Updates** finds it → **Update Now** → progress → app restarts on the new version.

---

## Web "Download Desktop App" button

The deployed web app serves a copy of the installer so visitors can install the
desktop app themselves:

* **Config (single source of truth):** `src/lib/desktopDownload.ts` — the URL,
  the suggested filename, and `DESKTOP_APP_VERSION` shown in the tooltip.
* **File:** `public/downloads/cncforge-erp-setup.exe` (byte-identical copy of
  `src-tauri/target/release/bundle/nsis/CNCFORGE ERP_<version>_x64-setup.exe`).
* **Public URL:** `https://with-cnc.vercel.app/downloads/cncforge-erp-setup.exe`
  (locally: `http://localhost:5176/downloads/cncforge-erp-setup.exe`).

**When releasing a new desktop version, update the button too** (the button
does NOT read GitHub Releases automatically — it will keep serving 1.0.0 until
you replace the file):

1. Copy the new NSIS installer over the old file, keeping the stable name:
   ```powershell
   Copy-Item "src-tauri\target\release\bundle\nsis\CNCFORGE ERP_<new>_x64-setup.exe" `
             "public\downloads\cncforge-erp-setup.exe" -Force
   ```
2. Bump `DESKTOP_APP_VERSION` in `src/lib/desktopDownload.ts` to `<new>`.
3. `npm run build`, then confirm `dist\downloads\cncforge-erp-setup.exe` has
   the new size (proves it ships in the deployment).
4. Commit both files together with the release commit — Vercel deploys `public/`
   verbatim, so the URL serves the new installer as soon as the deploy lands.

The `.sig` and `latest.json` for the in-app auto-updater come from GitHub
Releases and are unaffected by this file; conversely this file is only for
first-time manual installs and is never read by the updater. The private
signing key is never part of the web bundle.

---

## What the updater does (and does not do)

* Checks: startup (after ~8 s), every 4 hours, and manual — both automatic
  checks can be switched off in Settings → Updates (persisted locally).
* "Remind Me Later" snoozes the update card for 24 hours; a manual check
  always shows immediately.
* Every downloaded package is **minisign-verified against the embedded public
  key before install** — signature verification cannot be turned off by the UI,
  and a tampered package fails with an error card (the app keeps running the
  current version).
* Install: NSIS *passive* mode over the current install (`currentUser`),
  user data lives under `%LOCALAPPDATA%\com.cncforge.erp` (WebView2 profile) and
  the browser storage used for sessions — neither is touched by the installer,
  so users keep their data and stay signed in.
* Offline / endpoint unreachable: automatic checks fail silently (console only);
  manual checks show a dismissible error; nothing else changes.

---

## Known limitations (honest status)

1. **First published release is required before any in-app update works** —
   the endpoint is `releases/latest/download/latest.json`; a draft or missing
   release means "check for updates" reports an error (offline handling).
2. **End-to-end update test needs a published pair of versions** (e.g. 1.0.0 →
   1.0.1 on GitHub). This was not run against the real endpoint from this
   machine (no GitHub CLI auth available); local checks were limited to
   signature/manifest tooling and code paths.
3. **Native dialogs are not automatable here**: WebView2's print dialog, the
   NSIS install/upgrade UI, and the "restart to update" hand-off were exercised
   manually, not asserted by tests.
4. **Desktop Google login** requires the three Supabase redirect URLs
   (`AUTH_SETUP.md`) — until they are added, sign-in fails with Supabase's
   redirect-not-allowed error.
5. **Windows x64 only** for now (single updater platform entry). No macOS
   signing/notarization, no Linux artifacts.
6. **`npm run lint` (≈1960 errors) and `npm run typecheck` (109 errors) are
   pre-existing baselines**; CI gates on `npm run build` + `cargo check`, which
   are green. Do not "fix" the baseline in a release commit — keep diffs out.
7. **WebView2 runtime** is installed on demand by the installer (silent
   download bootstrapper); machines without internet access need WebView2
   preinstalled.

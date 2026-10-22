# "Windows is blocking the app" — why, and how to fix it

The installer (`CNCFORGE ERP_x.y.z_x64-setup.exe`) is **not signed with a Windows
code-signing certificate**. (The minisign key in `tauri.conf.json` only protects
the in-app *updater*; Windows does not look at it.) An unsigned, rarely downloaded
`.exe` is stopped by:

| What the manager sees | Cause | Fix |
|---|---|---|
| "Windows protected your PC" (blue) | Microsoft Defender SmartScreen | **More info → Run anyway** |
| Downloaded file will not open / "blocked" | File carries the "downloaded from internet" mark | Right-click file → **Properties → tick Unblock → OK** |
| "Smart App Control blocked this app" (Windows 11, no Run anyway) | Smart App Control only allows signed apps | Needs a **signed** installer (below), or use the browser install |
| Antivirus / company IT removes it | Unknown publisher | Needs a signed installer, or IT allow-lists it |
| Chrome / Edge says "not commonly downloaded" | Reputation | Keep / Keep anyway; signing fixes it over time |
| Installer says it cannot download WebView2 | Locked-down network | Fixed in this repo: the WebView2 bootstrapper is now bundled (`embedBootstrapper`). On a PC with no internet at all, preinstall WebView2 |

## Install without any installer file (works today, no blocking)

The web app is installable from the browser: open
https://with-cnc.vercel.app in **Edge or Chrome** → click the **Install** icon at the
right end of the address bar (or ⋮ → *Install ARGUS CNC ERP*). It opens in its own
window, has a desktop shortcut, and needs no admin rights. (Added in this repo:
`public/manifest.webmanifest`.)

## The permanent fix: sign the installer

Windows only stops warning when the `.exe` is signed by a certificate it trusts.
Options, cheapest first:

1. **Microsoft Artifact (Trusted) Signing** — about US$10/month; reputation is immediate.
2. **OV/EV code-signing certificate** (DigiCert, Sectigo, SSL.com …). EV removes
   SmartScreen warnings at once; OV builds reputation after some downloads.

Once you have a `.pfx`:

1. Base64 it: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("codesign.pfx"))`
2. In GitHub → Settings → Secrets → Actions add `WINDOWS_CERTIFICATE` (that base64)
   and `WINDOWS_CERTIFICATE_PASSWORD`.
3. Tag a release (`v1.0.2`). `.github/workflows/desktop-release.yml` imports the
   certificate and signs the installer automatically; without the secrets it still
   builds an unsigned one.
4. Copy the signed installer to `public/downloads/cncforge-erp-setup.exe` and bump
   `DESKTOP_APP_VERSION` (see RELEASING.md).

## Other things that look like "blocked"

* **Sign-in fails with a redirect error** — add the three Supabase redirect URLs
  in `AUTH_SETUP.md` (desktop Google login).
* **The app opens but pages stay empty** — the PC cannot reach
  `*.supabase.co` / `with-cnc.vercel.app` (company firewall/proxy). Ask IT to allow both.

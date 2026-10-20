//! CNCFORGE ERP desktop shell (Tauri v2).
//!
//! Scope of this crate (deliberately minimal):
//!   * window/bundle identity and the updater (see tauri.conf.json)
//!   * main window creation with WebView2 handlers attached *before* load:
//!       - `on_new_window` — external links open in the system browser,
//!         stray `about:blank` popups become native child windows
//!       - `on_download`   — every download lands in the user's Downloads
//!         folder (unique name) and emits `cncforge-download-finished`
//!   * `save_download`   — blob/HTTP file saves routed to Downloads (JS shim)
//!   * `open_external`   — system-browser link opening (scheme-whitelisted)
//!   * `oauth_listen`/`oauth_cancel` — loopback server for desktop Google sign-in
//!   * official plugins  — opener (external links), process (relaunch),
//!     updater, http (CORS-free fetch to the deployed API for Retail Sync)
//!
//! No business logic lives here; the ERP frontend is bundled unchanged.

mod commands;
mod oauth;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// Monotonic label source for native popup/child windows (`popup-1`, `popup-2`, ...).
pub(crate) static NEXT_POPUP: AtomicU32 = AtomicU32::new(1);

pub(crate) fn next_popup_label() -> String {
    format!("popup-{}", NEXT_POPUP.fetch_add(1, Ordering::Relaxed))
}

/// Schemes the app is allowed to hand to the operating system.
fn is_external_scheme(scheme: &str) -> bool {
    matches!(scheme, "http" | "https" | "mailto" | "tel" | "whatsapp")
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            commands::save_download,
            commands::open_external,
            oauth::oauth_listen,
            oauth::oauth_cancel,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // The main window is configured with `"create": false` so that the
            // new-window/download handlers below are attached before the first
            // page load (attaching them afterwards would leave the first
            // navigation and any early download unhandled).
            let config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .expect("tauri.conf.json must define at least one window");

            let open_handle = handle.clone();
            let download_dir: Option<PathBuf> = handle.path().download_dir().ok();
            let emit_handle = handle.clone();

            let main_window = WebviewWindowBuilder::from_config(&handle, &config)?
                // window.open / target=_blank safety net. The frontend shim
                // intercepts first; this is the native fallback.
                .on_new_window(move |url, features| match url.scheme() {
                    scheme if is_external_scheme(scheme) => {
                        // Real web links (http/https/mailto/...) leave the app.
                        let _ = open_handle.opener().open_url(url.to_string(), None::<&str>);
                        NewWindowResponse::Deny
                    }
                    "about" => {
                        // `window.open('')` / about:blank: give the caller a real
                        // child window (label unique, sized from the request).
                        let mut builder = WebviewWindowBuilder::new(
                            &open_handle,
                            next_popup_label(),
                            WebviewUrl::External("about:blank".parse().expect("static url")),
                        )
                        .title("CNCFORGE ERP")
                        .center();
                        if let Some(size) = features.size() {
                            builder = builder.inner_size(size.width, size.height);
                        }
                        if let Some(position) = features.position() {
                            builder = builder.position(position.x, position.y);
                        }
                        match builder.build() {
                            Ok(window) => NewWindowResponse::Create { window },
                            Err(_) => NewWindowResponse::Deny,
                        }
                    }
                    // blob:/data: cannot cross webview boundaries, anything else
                    // is not a web scheme — deny rather than navigate the shell.
                    _ => NewWindowResponse::Deny,
                })
                // Every download (http, https, blob via the PDF viewer, ...) is
                // redirected into the Downloads folder with a unique name and
                // announced to the frontend with a toast.
                .on_download(move |_webview, event| match event {
                    DownloadEvent::Requested { url, destination } => {
                        if let Some(dir) = &download_dir {
                            if let Some(name) = destination.file_name() {
                                let safe = commands::sanitize_file_name(&name.to_string_lossy());
                                *destination = commands::unique_path(dir, &safe);
                                let _ = url; // destination comes from the URL's file name
                            }
                        }
                        true // let WebView2 perform the download to `destination`
                    }
                    DownloadEvent::Finished { url, path, success } => {
                        let _ = emit_handle.emit(
                            "cncforge-download-finished",
                            serde_json::json!({
                                "url": url.to_string(),
                                "path": path
                                    .as_ref()
                                    .map(|p| p.display().to_string())
                                    .unwrap_or_default(),
                                "success": success,
                            }),
                        );
                        true
                    }
                    _ => true,
                })
                .build()?;

            let _ = main_window;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CNCFORGE ERP");
}

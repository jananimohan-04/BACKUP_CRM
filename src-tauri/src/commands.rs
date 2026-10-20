//! File-save support for the desktop app.
//!
//! WebView2 does not reliably honour `<a download>` / `URL.createObjectURL` downloads,
//! so the frontend shim collects the bytes (same-origin or via the http plugin) and hands
//! them to this command, which writes them into the user's Downloads folder.

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Keep only Windows-safe filename characters; preserve a usable extension.
pub(crate) fn sanitize_file_name(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c == ' ').to_string();
    let mut name = if cleaned.is_empty() {
        "download".to_string()
    } else {
        cleaned
    };
    if name.len() > 120 {
        // Preserve the extension while truncating the stem.
        let ext_idx = name.rfind('.').filter(|i| *i > 0).unwrap_or(name.len());
        let (stem, ext) = name.split_at(ext_idx);
        let mut truncated = stem[..110.min(stem.len())].to_string();
        truncated.push_str(ext);
        name = truncated;
    }
    name
}

/// Returns a path that does not yet exist by appending " (n)" before the extension.
pub(crate) fn unique_path(dir: &PathBuf, name: &str) -> PathBuf {
    let mut candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1..1000 {
        candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem}-{}{ext}", std::process::id()))
}

/// Write `bytes` to the user's Downloads folder under a sanitized, collision-free name.
/// Returns the absolute path of the written file.
#[tauri::command]
pub fn save_download(app: tauri::AppHandle, suggested_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
        .map_err(|e| format!("Could not resolve the Downloads folder: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let target = unique_path(&dir, &sanitize_file_name(&suggested_name));
    fs::write(&target, bytes).map_err(|e| format!("Could not write {}: {e}", target.display()))?;
    Ok(target.to_string_lossy().to_string())
}

/// Schemes the app is allowed to hand to the operating system (mirror of lib.rs).
fn is_allowed_scheme(scheme: &str) -> bool {
    matches!(scheme, "http" | "https" | "mailto" | "tel" | "whatsapp")
}

/// Open a URL with the system default handler (external links from the frontend).
/// Only web/e-mail schemes are accepted so the shell can never be used to launch
/// arbitrary programs (e.g. `file:` or custom protocol handlers).
#[tauri::command]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let parsed = url::Url::parse(url.trim()).map_err(|e| format!("Not a valid URL: {e}"))?;
    if !is_allowed_scheme(parsed.scheme()) {
        return Err(format!("Links with the '{}' scheme cannot be opened.", parsed.scheme()));
    }
    app.opener()
        .open_url(parsed.to_string(), None::<&str>)
        .map_err(|e| format!("Could not open the link: {e}"))
}

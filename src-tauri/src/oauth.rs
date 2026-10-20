//! Loopback OAuth callback server for desktop Google sign-in.
//!
//! Flow (only active when the user presses "Sign in with Google" in the desktop app):
//!   1. The frontend asks Supabase for the Google authorize URL with
//!      `skipBrowserRedirect: true` and `redirectTo = http://localhost:<port>/callback`.
//!   2. The URL opens in the user's DEFAULT browser (system-level sign-in, unchanged
//!      Google/Supabase identity checks, RLS untouched).
//!   3. Supabase redirects the browser back to this loopback server. Because the app uses
//!      the implicit grant, the tokens arrive in the URL *fragment*, which browsers never
//!      send to servers — so we serve a tiny relay page that POSTs `path+search+hash` to
//!      `/__capture`.
//!   4. The full callback URL is emitted to the frontend (`oauth-callback` event), where
//!      supabase-js stores the session exactly as it would on the web.
//!
//! Security notes:
//!   * Binds 127.0.0.1 only (never external).
//!   * Single-shot: stops listening after the first capture (or after 5 minutes).
//!   * Tokens are delivered only to the local machine; signature/validity is enforced by
//!     Supabase when the session is established.
//!   * `oauth_cancel` lets the UI abandon the attempt (e.g. user closed the browser).

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Preferred ports, in order. All three should be present in the Supabase Auth
/// "Redirect URLs" allow-list (docs/desktop/AUTH_SETUP.md lists the exact entries).
const PORTS: [u16; 3] = [53672, 53673, 53674];
const LISTEN_TIMEOUT: Duration = Duration::from_secs(300);

static CANCELLED: AtomicBool = AtomicBool::new(false);

const RELAY_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8"><title>CNCFORGE ERP — Signing in</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; background:#0b1220; color:#e2e8f0;
         display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
  .card { text-align:center; padding:40px 48px; background:#111a2e; border:1px solid #24314d;
          border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.45); }
  h2 { margin:0 0 10px; } p { margin:4px 0; color:#94a3b8; }
  .spin { width:34px; height:34px; margin:0 auto 18px; border:3px solid #334155;
          border-top-color:#38bdf8; border-radius:50%; animation:sp .8s linear infinite; }
  @keyframes sp { to { transform:rotate(360deg); } }
  .done .spin { display:none; }
</style></head>
<body><div class="card" id="c"><div class="spin"></div>
  <h2>Completing sign-in…</h2><p>You can return to CNCFORGE ERP.</p></div>
<script>
(function () {
  var payload = location.pathname + location.search + location.hash;
  fetch('/__capture?d=' + encodeURIComponent(payload), { method: 'GET' })
    .then(function () {
      var c = document.getElementById('c');
      c.className = 'done';
      c.innerHTML = '<h2>Sign-in complete</h2><p>You can close this window and return to CNCFORGE ERP.</p>';
    })
    .catch(function () {
      document.getElementById('c').innerHTML =
        '<h2>Sign-in could not be forwarded</h2><p>Please return to CNCFORGE ERP and try again.</p>';
    });
})();
</script></body></html>"#;

const CAPTURE_OK_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8"><title>CNCFORGE ERP</title>
<style>body{font-family:'Segoe UI',system-ui,sans-serif;background:#0b1220;color:#e2e8f0;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style></head>
<body><div style="text-align:center"><h2>You can close this window</h2></div></body></html>"#;

/// Minimal percent-decoder for the `d=` payload (encodeURIComponent output).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() + 1 && i + 2 <= bytes.len() + 1 => {
                let hex = bytes.get(i + 1..i + 3);
                match hex.and_then(|h| u8::from_str_radix(std::str::from_utf8(h).unwrap_or(""), 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn http_response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    )
}

/// Extract `d` from a request target like `/__capture?d=%2Fcallback%23access_token…`.
fn capture_payload(target: &str) -> Option<String> {
    let query = target.split_once('?')?.1;
    let query = query.split('#').next().unwrap_or(query);
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if k == "d" {
            let decoded = percent_decode(v);
            if decoded.starts_with('/') {
                return Some(decoded);
            }
            return None;
        }
    }
    None
}

fn run_accept_loop(app: tauri::AppHandle, listener: TcpListener) {
    let deadline = Instant::now() + LISTEN_TIMEOUT;
    while Instant::now() < deadline {
        if CANCELLED.load(Ordering::SeqCst) {
            break;
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
                let mut line = String::new();
                let read = {
                    let mut reader = BufReader::new(&stream);
                    reader.read_line(&mut line).unwrap_or(0)
                };
                if read == 0 {
                    continue;
                }
                // Request line: "GET /path?query HTTP/1.1"
                let target = line.split_whitespace().nth(1).unwrap_or("/").to_string();
                let path = target.split('?').next().unwrap_or("/").to_string();

                if path.starts_with("/__capture") {
                    let mut ok = false;
                    if let Some(payload) = capture_payload(&target) {
                        let _ = stream.write_all(http_response("200 OK", CAPTURE_OK_HTML).as_bytes());
                        let _ = stream.flush();
                        ok = app.emit("oauth-callback", payload).is_ok();
                        if ok {
                            break;
                        }
                    }
                    if !ok {
                        let _ = stream
                            .write_all(http_response("400 Bad Request", "<!doctype html><p>Invalid callback.</p>")
                                .as_bytes());
                    }
                    break;
                }

                // Anything else (the Supabase redirect landing): serve the relay page.
                let _ = stream.write_all(http_response("200 OK", RELAY_HTML).as_bytes());
                let _ = stream.flush();
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(60));
            }
            Err(_) => break,
        }
    }
    // Closing the listener ends the loop; the port becomes free again.
    drop(listener);
}

/// Start listening for the OAuth redirect. Tries the preferred ports in order and
/// returns the port that bound successfully (use it to build `redirectTo`).
#[tauri::command]
pub fn oauth_listen(app: tauri::AppHandle) -> Result<u16, String> {
    CANCELLED.store(false, Ordering::SeqCst);
    let mut last_err = String::new();
    for port in PORTS {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => {
                if let Err(e) = listener.set_nonblocking(true) {
                    last_err = format!("port {port}: {e}");
                    continue;
                }
                std::thread::spawn(move || run_accept_loop(app, listener));
                return Ok(port);
            }
            Err(e) => last_err = format!("port {port}: {e}"),
        }
    }
    Err(format!(
        "Could not open a local sign-in port ({last_err}). Close any other program using ports 53672-53674 and try again."
    ))
}

/// Abandon a pending sign-in (stops the loopback listener).
#[tauri::command]
pub fn oauth_cancel() {
    CANCELLED.store(true, Ordering::SeqCst);
}

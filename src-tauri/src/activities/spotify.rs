//! Spotify connection helpers (the API calls themselves run in the island
//! webview). Sign-in uses Authorization Code with PKCE, so there is no client
//! secret: the browser returns to a loopback address that this module listens
//! on only for the duration of a sign-in, and the refresh token is kept in
//! Windows Credential Manager (or the macOS Keychain).

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

pub const REDIRECT_PORT: u16 = 47819;
const CRED_TARGET: &str = "DynIs/Spotify";

/// The `code` (or `error`) query value from a request line like
/// `GET /callback?code=abc&state=xyz HTTP/1.1`.
pub fn query_value(request_line: &str, key: &str) -> Option<String> {
    let path = request_line.split_whitespace().nth(1)?;
    let query = path.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then(|| v.replace('+', " "))
    })
}

/// Opens the Spotify sign-in page and waits (up to 3 minutes) for the browser
/// to come back with the authorization code. Returns `code`.
#[tauri::command]
pub async fn spotify_authorize(auth_url: String, state: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
            .map_err(|e| format!("Port {REDIRECT_PORT} is busy: {e}"))?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        if !auth_url.starts_with("https://accounts.spotify.com/") {
            return Err("Unexpected sign-in address.".into());
        }
        crate::platform::open_url(&auth_url);
        let deadline = Instant::now() + Duration::from_secs(180);
        while Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let line = request.lines().next().unwrap_or("");
                    if !line.contains("/callback") {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                        continue;
                    }
                    let ok = query_value(line, "state").as_deref() == Some(state.as_str());
                    let code = query_value(line, "code");
                    let body = if ok && code.is_some() {
                        "<html><body style=\"font-family:Segoe UI;background:#000;color:#fff;text-align:center;padding-top:20vh\"><h2>Spotify is connected to DynIs.</h2><p>You can close this tab.</p></body></html>"
                    } else {
                        "<html><body style=\"font-family:Segoe UI;background:#000;color:#fff;text-align:center;padding-top:20vh\"><h2>Spotify sign-in didn't finish.</h2><p>Close this tab and try again from DynIs settings.</p></body></html>"
                    };
                    let _ = stream.write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        )
                        .as_bytes(),
                    );
                    return match (ok, code) {
                        (true, Some(code)) => Ok(code),
                        _ => Err(query_value(line, "error").unwrap_or_else(|| "Sign-in was cancelled.".into())),
                    };
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(150));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        Err("Sign-in timed out.".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn spotify_store_token(token: String) -> Result<(), String> {
    crate::platform::cred_write(CRED_TARGET, &token)
}

#[tauri::command]
pub fn spotify_load_token() -> Option<String> {
    crate::platform::cred_read(CRED_TARGET)
}

#[tauri::command]
pub fn spotify_clear_token() {
    crate::platform::cred_delete(CRED_TARGET)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_callback_query() {
        let line = "GET /callback?code=AQD_x-1&state=s123 HTTP/1.1";
        assert_eq!(query_value(line, "code").as_deref(), Some("AQD_x-1"));
        assert_eq!(query_value(line, "state").as_deref(), Some("s123"));
        assert_eq!(query_value(line, "error"), None);
        assert_eq!(query_value("GET /callback?error=access_denied HTTP/1.1", "error").as_deref(), Some("access_denied"));
    }
}

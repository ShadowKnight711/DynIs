//! Google Calendar (read-only), off until you connect it.
//!
//! Sign-in is the OAuth 2.0 installed-app flow with PKCE: DynIs opens your
//! browser at Google's consent page and listens on 127.0.0.1 at a random port
//! for the redirect, only during sign-in. The refresh token is kept in Windows
//! Credential Manager (or the macOS Keychain) ("DynIs/GoogleCalendar"); signing out revokes it at
//! Google and deletes it. Scope: calendar.readonly. Google requires an OAuth
//! client: you create a "Desktop app" client in Google Cloud and paste its
//! Client ID and secret into Settings (desktop secrets are not confidential).

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const CRED_TARGET: &str = "DynIs/GoogleCalendar";
const SCOPE: &str = "https://www.googleapis.com/auth/calendar.readonly";

static ACCESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn setting(key: &str) -> String {
    crate::platform::setting_str(key).unwrap_or_default().trim().to_string()
}

fn client() -> Result<(String, String), String> {
    let id = setting("bloom-google-client-id");
    let secret = setting("bloom-google-client-secret");
    if id.is_empty() {
        return Err("Add your Google Client ID in Settings first.".into());
    }
    Ok((id, secret))
}

// ── Credential store (Credential Manager / Keychain) ──
fn store_refresh(token: &str) -> Result<(), String> {
    crate::platform::cred_write(CRED_TARGET, token)
}

fn load_refresh() -> Option<String> {
    crate::platform::cred_read(CRED_TARGET)
}

fn clear_refresh() {
    crate::platform::cred_delete(CRED_TARGET)
}

// ── PKCE helpers ──
fn random_string(len: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut bytes = vec![0u8; len];
    getrandom::fill(&mut bytes).expect("random");
    bytes.iter().map(|b| CHARS[*b as usize % CHARS.len()] as char).collect()
}

pub fn challenge(verifier: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn query_value(request_line: &str, key: &str) -> Option<String> {
    let path = request_line.split_whitespace().nth(1)?;
    let query = path.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then(|| percent_decode(v))
    })
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 3 <= bytes.len() {
            if let Some(v) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn form(pairs: &[(&str, &str)]) -> String {
    fn enc(s: &str) -> String {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
                _ => format!("%{b:02X}"),
            })
            .collect()
    }
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<_>>().join("&")
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

async fn token_request(body: String) -> Result<TokenResponse, String> {
    let res = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Google didn't accept the sign-in ({}). Check the Client ID and secret, then try again.", res.status()));
    }
    res.json::<TokenResponse>().await.map_err(|e| e.to_string())
}

fn remember(t: &TokenResponse) {
    if let Ok(mut g) = ACCESS.lock() {
        *g = Some((t.access_token.clone(), Instant::now() + Duration::from_secs(t.expires_in.saturating_sub(60))));
    }
}

async fn access_token() -> Result<String, String> {
    if let Some((tok, until)) = ACCESS.lock().ok().and_then(|g| g.clone()) {
        if Instant::now() < until {
            return Ok(tok);
        }
    }
    let refresh = load_refresh().ok_or("Not connected")?;
    let (id, secret) = client()?;
    let t = token_request(form(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh),
        ("client_id", &id),
        ("client_secret", &secret),
    ]))
    .await?;
    remember(&t);
    Ok(t.access_token)
}

/// Opens Google sign-in and finishes the connection.
#[tauri::command]
pub async fn google_connect() -> Result<(), String> {
    let (id, secret) = client()?;
    let verifier = random_string(64);
    let state = random_string(16);
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?{}",
        form(&[
            ("client_id", &id),
            ("redirect_uri", &redirect),
            ("response_type", "code"),
            ("scope", SCOPE),
            ("code_challenge", &challenge(&verifier)),
            ("code_challenge_method", "S256"),
            ("state", &state),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ])
    );
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &url, &state))
        .await
        .map_err(|e| e.to_string())??;
    let t = token_request(form(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect),
        ("client_id", &id),
        ("client_secret", &secret),
        ("code_verifier", &verifier),
    ]))
    .await?;
    let refresh = t.refresh_token.clone().ok_or("Google didn't finish the sign-in. Click Connect to try again.")?;
    store_refresh(&refresh)?;
    remember(&t);
    Ok(())
}

fn wait_for_code(listener: TcpListener, url: &str, state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    crate::platform::open_url(url);
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
                let ok = query_value(line, "state").as_deref() == Some(state);
                let code = query_value(line, "code");
                if code.is_none() && query_value(line, "error").is_none() {
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                    continue;
                }
                let body = if ok && code.is_some() {
                    "<html><body style=\"font-family:Segoe UI;background:#000;color:#fff;text-align:center;padding-top:20vh\"><h2>Google Calendar is connected to DynIs.</h2><p>You can close this tab.</p></body></html>"
                } else {
                    "<html><body style=\"font-family:Segoe UI;background:#000;color:#fff;text-align:center;padding-top:20vh\"><h2>Sign-in didn't finish.</h2><p>Close this tab and try again from DynIs settings.</p></body></html>"
                };
                let _ = stream.write_all(
                    format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
                        .as_bytes(),
                );
                return match (ok, code) {
                    (true, Some(c)) => Ok(c),
                    _ => Err(query_value(line, "error").unwrap_or_else(|| "Sign-in was cancelled.".into())),
                };
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Sign-in timed out. Click Connect to try again.".into())
}

/// Revokes the token at Google and deletes it from this PC.
#[tauri::command]
pub async fn google_sign_out() {
    if let Some(refresh) = load_refresh() {
        let _ = reqwest::Client::new()
            .post("https://oauth2.googleapis.com/revoke")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(form(&[("token", &refresh)]))
            .send()
            .await;
    }
    clear_refresh();
    if let Ok(mut g) = ACCESS.lock() {
        *g = None;
    }
}

#[tauri::command]
pub fn google_connected() -> bool {
    load_refresh().is_some()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    /// RFC 3339 start, or a date for all-day events.
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub location: Option<String>,
}

#[derive(Deserialize)]
struct EventTime {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
}

#[derive(Deserialize)]
struct RawEvent {
    id: String,
    summary: Option<String>,
    start: Option<EventTime>,
    end: Option<EventTime>,
    location: Option<String>,
    status: Option<String>,
}

#[derive(Deserialize)]
struct EventList {
    items: Vec<RawEvent>,
}

fn convert(e: RawEvent) -> Option<CalendarEvent> {
    if e.status.as_deref() == Some("cancelled") {
        return None;
    }
    let start = e.start?;
    let end = e.end?;
    let all_day = start.date_time.is_none();
    Some(CalendarEvent {
        id: e.id,
        title: e.summary.unwrap_or_else(|| "(No title)".into()),
        start: start.date_time.or(start.date)?,
        end: end.date_time.or(end.date)?,
        all_day,
        location: e.location,
    })
}

/// Events from `time_min` to `time_max` (RFC 3339) on the primary calendar.
#[tauri::command]
pub async fn google_events(time_min: String, time_max: String) -> Result<Vec<CalendarEvent>, String> {
    let token = access_token().await?;
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?{}",
        form(&[
            ("timeMin", &time_min),
            ("timeMax", &time_max),
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
            ("maxResults", "50"),
        ])
    );
    let res = reqwest::Client::new()
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Couldn't load your calendar ({}). Try Sign Out, then Connect again.", res.status()));
    }
    let list: EventList = res.json().await.map_err(|e| e.to_string())?;
    Ok(list.items.into_iter().filter_map(convert).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        // RFC 7636 appendix B.
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn reads_the_redirect() {
        let line = "GET /?state=abc&code=4%2F0Ad-x&scope=https%3A%2F%2Fwww.googleapis.com HTTP/1.1";
        assert_eq!(query_value(line, "code").as_deref(), Some("4/0Ad-x"));
        assert_eq!(query_value(line, "state").as_deref(), Some("abc"));
    }

    #[test]
    fn converts_events() {
        let timed = RawEvent {
            id: "1".into(),
            summary: Some("Standup".into()),
            start: Some(EventTime { date_time: Some("2026-11-06T09:00:00+05:30".into()), date: None }),
            end: Some(EventTime { date_time: Some("2026-11-06T09:15:00+05:30".into()), date: None }),
            location: None,
            status: None,
        };
        let e = convert(timed).unwrap();
        assert!(!e.all_day && e.title == "Standup");
        let cancelled = RawEvent {
            id: "2".into(),
            summary: None,
            start: Some(EventTime { date_time: None, date: Some("2026-11-06".into()) }),
            end: Some(EventTime { date_time: None, date: Some("2026-11-07".into()) }),
            location: None,
            status: Some("cancelled".into()),
        };
        assert!(convert(cancelled).is_none());
    }

    #[test]
    fn encodes_forms() {
        assert_eq!(form(&[("a b", "x/y")]), "a%20b=x%2Fy");
    }
}

//! Notifications from other apps, shown as island activities (off by default).
//!
//! Windows keeps the toasts it shows in the signed-in user's own notification
//! database (`%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db`).
//! DynIs reads new rows from it read-only, so no app package, certificate or
//! extra permission is needed. Nothing is stored or sent anywhere.

use super::{lift, module_enabled, Activity};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

static STATUS: Mutex<String> = Mutex::new(String::new());

fn set_status(s: &str) {
    if let Ok(mut g) = STATUS.lock() {
        *g = s.to_string();
    }
}

#[tauri::command]
pub fn notifications_status() -> String {
    STATUS.lock().map(|s| s.clone()).unwrap_or_default()
}

fn db_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(base).join("Microsoft\\Windows\\Notifications\\wpndatabase.db"))
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// The text lines of a toast payload, in order (title first).
pub fn toast_texts(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<text") {
        let after = &rest[start..];
        let Some(open_end) = after.find('>') else { break };
        if after[..open_end].ends_with('/') {
            rest = &after[open_end + 1..];
            continue;
        }
        let body = &after[open_end + 1..];
        let Some(close) = body.find("</text>") else { break };
        let text = unescape(body[..close].trim());
        if !text.is_empty() {
            out.push(text);
        }
        rest = &body[close + 7..];
    }
    out
}

/// A readable app name from a handler id ("Microsoft.Teams_8wekyb3d8bbwe!App",
/// "C:\…\slack.exe", "Microsoft.Windows.Explorer").
pub fn app_name(handler: &str) -> String {
    let base = handler.split('!').next().unwrap_or(handler);
    let base = base.rsplit(['\\', '/']).next().unwrap_or(base);
    let base = base.split('_').next().unwrap_or(base);
    let base = base.trim_end_matches(".exe");
    let last = base.rsplit('.').next().unwrap_or(base);
    let name = if last.len() <= 2 { base } else { last };
    let mut chars = name.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => "App".into(),
    }
}

fn open_db() -> Result<rusqlite::Connection, String> {
    let path = db_path().ok_or("No LOCALAPPDATA")?;
    // Strictly read-only: the file belongs to Windows. Each poll is one short
    // read, so it never holds a lock Windows would wait on.
    let conn = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "query_only", "ON").map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_millis(50)).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn max_id(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT IFNULL(MAX(Id), 0) FROM Notification", [], |r| r.get(0))
        .unwrap_or(0)
}

pub fn setup(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-notifications".into())
        .spawn(move || {
            let mut conn: Option<rusqlite::Connection> = None;
            let mut last_id: i64 = -1;
            set_status("off");
            loop {
                std::thread::sleep(std::time::Duration::from_millis(2000));
                if !module_enabled("bloom-activity-notifications", false) {
                    conn = None;
                    last_id = -1;
                    set_status("off");
                    continue;
                }
                if conn.is_none() {
                    match open_db() {
                        Ok(c) => conn = Some(c),
                        Err(e) => {
                            set_status(&format!("unavailable: {e}"));
                            continue;
                        }
                    }
                }
                let Some(c) = conn.as_ref() else { continue };
                if last_id < 0 {
                    // Start from now: older toasts aren't replayed.
                    last_id = max_id(c);
                    set_status("ok");
                    continue;
                }
                let rows: Result<Vec<(i64, String, Vec<u8>)>, _> = (|| {
                    let mut stmt = c.prepare_cached(
                        "SELECT n.Id, h.PrimaryId, n.Payload FROM Notification n \
                         JOIN NotificationHandler h ON h.RecordId = n.HandlerId \
                         WHERE n.Type = 'toast' AND n.Id > ?1 ORDER BY n.Id LIMIT 10",
                    )?;
                    let mapped = stmt.query_map([last_id], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Vec<u8>>(2)?))
                    })?;
                    mapped.collect::<Result<Vec<_>, _>>()
                })();
                let rows = match rows {
                    Ok(r) => r,
                    Err(e) => {
                        set_status(&format!("unavailable: {e}"));
                        conn = None;
                        continue;
                    }
                };
                set_status("ok");
                for (id, handler, payload) in rows {
                    last_id = last_id.max(id);
                    if handler.to_lowercase().contains("dynis") || handler.contains("com.kevin.dynis") {
                        continue;
                    }
                    let xml = String::from_utf8_lossy(&payload);
                    let texts = toast_texts(&xml);
                    let Some(title) = texts.first().cloned() else { continue };
                    let body = texts.get(1).cloned();
                    let name = app_name(&handler);
                    let action = if handler.contains('!') || !handler.contains('\\') {
                        format!("open:shell:AppsFolder\\{handler}")
                    } else {
                        format!("open:{handler}")
                    };
                    lift(
                        &app,
                        Activity {
                            id: format!("notif-{id}"),
                            kind: "notification".into(),
                            priority: 4,
                            started_ms: 0,
                            expires_ms: None,
                            lift_until_ms: None,
                            signal: None,
                            icon: Some("bell".into()),
                            title: format!("{name}: {title}"),
                            value: None,
                            detail: body,
                            progress: None,
                            action: Some(action),
                        },
                        // Kept a while so it is still listed when the island opens.
                        60_000,
                    );
                }
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_toast_text_lines() {
        let xml = r#"<toast><visual><binding template="ToastGeneric"><text>Claude</text><text hint-maxLines="1">82% used &amp; rising</text><text/></binding></visual></toast>"#;
        assert_eq!(toast_texts(xml), vec!["Claude", "82% used & rising"]);
    }

    /// Reads this PC's real notification database (run with --ignored).
    #[test]
    #[ignore]
    fn reads_the_live_database() {
        let conn = open_db().expect("open");
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId WHERE n.Type = 'toast'",
                [],
                |r| r.get(0),
            )
            .expect("query");
        println!("toasts readable: {n}, max id {}", max_id(&conn));
    }

    #[test]
    fn names_apps_from_handlers() {
        assert_eq!(app_name("Microsoft.Teams_8wekyb3d8bbwe!App"), "Teams");
        assert_eq!(app_name("C:\\Apps\\slack.exe"), "Slack");
        assert_eq!(app_name("Microsoft.Windows.Explorer"), "Explorer");
    }
}

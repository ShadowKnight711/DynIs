//! Web media in the island (2.1): what the DynIs browser extension reports
//! for YouTube, YouTube Music, Spotify, Apple Music, SoundCloud and other
//! sites, and the island's controls back to it.
//!
//! The native-messaging host (a separate DynIs process the browser starts,
//! see `native_host`) writes the active tab's media to `browser-media.json`.
//! This module watches that file (a time-stamp check twice a second) and emits
//! `browser-media` to the windows when it changes. Commands and the per-site
//! settings (`bloom-web-media-sites`) go the other way through
//! `browser-media-command.json`, which the host relays to the extension.

use crate::native_host::{command_path, media_path, write_json_atomic, CommandFile, MediaState, WEB_SITES};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub const SITES_KEY: &str = "bloom-web-media-sites";

/// Serializes writes to the command file (commands and settings share it).
static COMMAND_LOCK: Mutex<()> = Mutex::new(());
static LAST_SEQ: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The per-site setting (a JSON object string) → the map sent to the
/// extension. Unknown keys are dropped; missing sites use the defaults
/// (everything on except "generic").
pub fn sites_from_setting(value: Option<&str>) -> serde_json::Map<String, serde_json::Value> {
    let parsed: serde_json::Map<String, serde_json::Value> =
        value.and_then(|v| serde_json::from_str(v).ok()).unwrap_or_default();
    WEB_SITES
        .iter()
        .map(|site| {
            let on = parsed
                .get(*site)
                .and_then(|v| v.as_bool())
                .unwrap_or(*site != "generic");
            (site.to_string(), serde_json::Value::Bool(on))
        })
        .collect()
}

/// A checked island command → the message for the extension.
pub fn command_message(action: &str, position_ms: Option<f64>, index: Option<u32>) -> Option<serde_json::Value> {
    match action {
        "play" | "pause" | "toggle" | "next" | "previous" => {
            Some(serde_json::json!({ "type": "command", "action": action }))
        }
        "seek" => {
            let p = position_ms.filter(|p| p.is_finite() && *p >= 0.0)?;
            Some(serde_json::json!({ "type": "command", "action": "seek", "positionMs": p.round() as u64 }))
        }
        "jump" => Some(serde_json::json!({ "type": "command", "action": "jump", "index": index? })),
        _ => None,
    }
}

fn update_command_file(change: impl FnOnce(&mut CommandFile)) {
    let Some(path) = command_path() else { return };
    let _guard = COMMAND_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut file: CommandFile = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    change(&mut file);
    write_json_atomic(&path, &file);
}

/// Tell the extension which sites may report (on start and when it changes).
pub fn write_sites(value: Option<&str>) {
    let sites = sites_from_setting(value);
    update_command_file(|f| f.sites = Some(sites));
}

/// Play/pause, next, previous, seek or jump to a queue row, in the browser
/// tab that is playing.
#[tauri::command]
pub fn browser_media_command(action: String, position_ms: Option<f64>, index: Option<u32>) -> Result<(), String> {
    let message = command_message(&action, position_ms, index).ok_or("Unknown media command")?;
    update_command_file(|f| {
        // Strictly increasing, also across app restarts.
        let seq = (now_ms() as u64).max(LAST_SEQ.load(Ordering::Relaxed) + 1).max(f.seq + 1);
        LAST_SEQ.store(seq, Ordering::Relaxed);
        f.seq = seq;
        f.at = now_ms();
        f.command = Some(message);
    });
    Ok(())
}

/// The current web media, for windows that start after it was reported.
#[tauri::command]
pub fn browser_media_state() -> Option<MediaState> {
    read_state().filter(|s| s.connected && s.media.is_some())
}

fn read_state() -> Option<MediaState> {
    serde_json::from_slice(&std::fs::read(media_path()?).ok()?).ok()
}

/// Watches `browser-media.json` and emits `browser-media` (the state, or
/// null when nothing is playing in a browser) when it changes.
pub fn setup(app: AppHandle) {
    write_sites(crate::platform::setting_str(SITES_KEY).as_deref());
    std::thread::Builder::new()
        .name("dynis-web-media".into())
        .spawn(move || {
            let path = media_path();
            let mut last_modified = None;
            let mut last_sent: Option<Option<MediaState>> = None;
            loop {
                let modified = path
                    .as_ref()
                    .and_then(|p| std::fs::metadata(p).ok())
                    .and_then(|m| m.modified().ok());
                if modified != last_modified {
                    last_modified = modified;
                    let state = read_state().filter(|s| s.connected && s.media.is_some());
                    if last_sent.as_ref() != Some(&state) {
                        let _ = app.emit("browser-media", &state);
                        last_sent = Some(state);
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sites_default_to_on_except_other_sites() {
        let s = sites_from_setting(None);
        assert_eq!(s.len(), 6);
        assert_eq!(s["youtube"], true);
        assert_eq!(s["generic"], false);
        let s = sites_from_setting(Some(r#"{"youtube":false,"generic":true,"evil":true}"#));
        assert_eq!(s["youtube"], false);
        assert_eq!(s["generic"], true);
        assert_eq!(s["spotify"], true);
        assert!(!s.contains_key("evil"));
        assert_eq!(sites_from_setting(Some("not json"))["soundcloud"], true);
    }

    #[test]
    fn island_commands_are_checked() {
        assert_eq!(command_message("next", None, None).unwrap()["action"], "next");
        assert_eq!(command_message("seek", Some(1234.6), None).unwrap()["positionMs"], 1235);
        assert!(command_message("seek", Some(-1.0), None).is_none());
        assert!(command_message("seek", None, None).is_none());
        assert_eq!(command_message("jump", None, Some(3)).unwrap()["index"], 3);
        assert!(command_message("jump", None, None).is_none());
        assert!(command_message("rm -rf", None, None).is_none());
    }
}

//! Downloads in progress: watches the Downloads folder for the temporary files
//! browsers write while downloading (.crdownload for Chrome/Edge, .part for
//! Firefox) and shows name, size and speed. Browsers don't report a total
//! size this way, so there is no percentage.

use super::{end, lift, module_enabled, now_ms, upsert, Activity};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;

#[cfg(windows)]
fn downloads_dir() -> Option<PathBuf> {
    unsafe {
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
        let p = SHGetKnownFolderPath(&FOLDERID_Downloads, KF_FLAG_DEFAULT, None).ok()?;
        let path = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        path.map(PathBuf::from)
    }
}

/// The XDG download folder (localised, e.g. ~/Descargas), else ~/Downloads.
#[cfg(target_os = "linux")]
fn downloads_dir() -> Option<PathBuf> {
    let from_tool = std::process::Command::new("xdg-user-dir")
        .arg("DOWNLOAD")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|p| !p.is_empty() && std::path::Path::new(p).is_dir());
    from_tool.map(PathBuf::from).or_else(|| Some(PathBuf::from(std::env::var_os("HOME")?).join("Downloads")))
}

/// ~/Downloads
#[cfg(target_os = "macos")]
fn downloads_dir() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("HOME")?).join("Downloads"))
}

/// The file's display name without the browser's temporary extension.
pub fn display_name(file: &str) -> Option<String> {
    let lower = file.to_lowercase();
    for ext in [".crdownload", ".part"] {
        if lower.ends_with(ext) {
            let base = &file[..file.len() - ext.len()];
            // Chrome uses "Unconfirmed 123456" until the real name is known.
            return Some(if base.to_lowercase().starts_with("unconfirmed ") {
                "Downloading…".into()
            } else {
                base.to_string()
            });
        }
    }
    None
}

pub fn format_bytes(bytes: u64) -> String {
    let b = bytes as f64;
    if b >= 1024.0 * 1024.0 * 1024.0 {
        format!("{:.1} GB", b / (1024.0 * 1024.0 * 1024.0))
    } else if b >= 1024.0 * 1024.0 {
        format!("{:.0} MB", b / (1024.0 * 1024.0))
    } else {
        format!("{:.0} KB", (b / 1024.0).max(1.0))
    }
}

/// The extension's latest report, if it's fresh (the host rewrites it every
/// second while downloads run).
fn read_browser_state(now: i64) -> Option<crate::native_host::BrowserState> {
    let path = crate::native_host::state_path()?;
    let text = std::fs::read_to_string(path).ok()?;
    let state: crate::native_host::BrowserState = serde_json::from_str(&text).ok()?;
    (now - state.updated <= 5_000).then_some(state)
}

/// "64% · 14 MB/s", or "120 MB · 14 MB/s" when the size is unknown.
pub fn browser_value(received: u64, total: Option<u64>, speed: u64) -> String {
    match total {
        Some(t) if t > 0 => format!("{}% · {}/s", (received * 100 / t).min(100), format_bytes(speed)),
        _ => format!("{} · {}/s", format_bytes(received), format_bytes(speed)),
    }
}

fn show_browser_state(
    app: &AppHandle,
    state: &crate::native_host::BrowserState,
    now: i64,
    shown: &mut std::collections::HashSet<String>,
) {
    let live: std::collections::HashSet<String> = state.downloads.iter().map(|d| d.id.clone()).collect();
    for id in shown.iter().filter(|id| !live.contains(*id)) {
        end(app, &format!("bdl-{id}"));
    }
    for d in &state.downloads {
        upsert(
            app,
            Activity {
                id: format!("bdl-{}", d.id),
                kind: "download".into(),
                priority: 3,
                started_ms: 0,
                expires_ms: None,
                lift_until_ms: None,
                signal: Some("transfer".into()),
                icon: Some("download".into()),
                title: d.name.clone(),
                value: Some(if d.paused { "Paused".into() } else { browser_value(d.received, d.total, d.speed) }),
                detail: None,
                progress: d.total.filter(|t| *t > 0).map(|t| (d.received as f32 / t as f32).min(1.0)),
                action: None,
            },
        );
    }
    *shown = live;
    for f in &state.finished {
        // Each finish lifts once (the host keeps them ~30 s).
        let key = format!("bdl-done-{}", f.id);
        if now - f.at > 6_000 || FINISHED.lock().map(|g| g.contains(&key)).unwrap_or(true) {
            continue;
        }
        if let Ok(mut g) = FINISHED.lock() {
            g.insert(key.clone());
        }
        let done = f.state == "complete";
        lift(
            app,
            Activity {
                id: key,
                kind: "download".into(),
                priority: 4,
                started_ms: 0,
                expires_ms: None,
                lift_until_ms: None,
                signal: Some(if done { "positive" } else { "alert" }.into()),
                icon: Some(if done { "download-done" } else { "custom-failed" }.into()),
                title: f.name.clone(),
                value: Some(if done { "Downloaded" } else { "Failed" }.into()),
                detail: None,
                progress: None,
                action: f.path.as_ref().map(|p| format!("open:{p}")),
            },
            3000,
        );
    }
}

static FINISHED: std::sync::Mutex<std::collections::BTreeSet<String>> =
    std::sync::Mutex::new(std::collections::BTreeSet::new());

struct Seen {
    size: u64,
    at: i64,
    speed: f64,
    /// When the file last grew (ms).
    grew_at: i64,
}

/// A temp file counts as a live download only while it is being written:
/// modified within `RECENT_MS`, or grown within `STALL_MS`. A leftover from a
/// download that died months ago never shows.
pub const RECENT_MS: i64 = 30_000;
pub const STALL_MS: i64 = 60_000;

pub fn is_live(now: i64, modified_ms: Option<i64>, grew_at: Option<i64>) -> bool {
    let recently_modified = modified_ms.is_some_and(|m| now - m <= RECENT_MS);
    let recently_grew = grew_at.is_some_and(|g| now - g <= STALL_MS);
    recently_modified || recently_grew
}

fn modified_ms(meta: &std::fs::Metadata) -> Option<i64> {
    meta.modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

pub fn setup(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-downloads".into())
        .spawn(move || {
            let Some(dir) = downloads_dir() else { return };
            let mut seen: HashMap<String, Seen> = HashMap::new();
            let mut browser_seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            loop {
                // 1 s while something is downloading, 3 s otherwise.
                let busy = !seen.is_empty() || !browser_seen.is_empty();
                std::thread::sleep(std::time::Duration::from_millis(if busy { 1000 } else { 3000 }));
                if !module_enabled("bloom-activity-downloads", true) {
                    for name in seen.drain().map(|(k, _)| k) {
                        end(&app, &format!("dl-{name}"));
                    }
                    continue;
                }
                let now = now_ms();
                // Exact progress from the browser extension, when it's active.
                let browser = read_browser_state(now);
                if let Some(state) = &browser {
                    show_browser_state(&app, state, now, &mut browser_seen);
                } else if !browser_seen.is_empty() {
                    for id in browser_seen.drain() {
                        end(&app, &format!("bdl-{id}"));
                    }
                }
                let mut current: HashMap<String, (String, u64)> = HashMap::new();
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let file = entry.file_name().to_string_lossy().to_string();
                        // Chromium downloads come from the extension when it's on.
                        if browser.is_some() && file.to_lowercase().ends_with(".crdownload") {
                            continue;
                        }
                        if let Some(display) = display_name(&file) {
                            let Ok(meta) = entry.metadata() else { continue };
                            let size = meta.len();
                            let grew_at = seen
                                .get(&file)
                                .map(|s| if size != s.size { now } else { s.grew_at });
                            if is_live(now, modified_ms(&meta), grew_at) {
                                current.insert(file, (display, size));
                            }
                        }
                    }
                }
                // Finished (or cancelled) downloads: the temp file is gone.
                let gone: Vec<String> = seen.keys().filter(|k| !current.contains_key(*k)).cloned().collect();
                for file in gone {
                    end(&app, &format!("dl-{file}"));
                    seen.remove(&file);
                    if dir.join(&file).exists() {
                        // Stalled, not finished: drop it silently.
                        continue;
                    }
                    if let Some(display) = display_name(&file) {
                        let final_path = dir.join(&file[..file.rfind('.').unwrap_or(file.len())]);
                        if final_path.exists() {
                            lift(
                                &app,
                                Activity {
                                    id: format!("dl-done-{display}"),
                                    kind: "download".into(),
                                    priority: 4,
                                    started_ms: 0,
                                    expires_ms: None,
                                    lift_until_ms: None,
                                    signal: Some("positive".into()),
                                    icon: Some("download-done".into()),
                                    title: display,
                                    value: Some("Downloaded".into()),
                                    detail: None,
                                    progress: None,
                                    action: Some(format!("open:{}", final_path.display())),
                                },
                                3000,
                            );
                        }
                    }
                }
                for (file, (display, size)) in current {
                    let entry = seen
                        .entry(file.clone())
                        .or_insert(Seen { size, at: now, speed: 0.0, grew_at: now });
                    if size != entry.size {
                        entry.grew_at = now;
                    }
                    let dt = (now - entry.at) as f64 / 1000.0;
                    if dt > 0.0 && size >= entry.size {
                        let instant = (size - entry.size) as f64 / dt;
                        entry.speed = entry.speed * 0.6 + instant * 0.4;
                    }
                    entry.size = size;
                    entry.at = now;
                    upsert(
                        &app,
                        Activity {
                            id: format!("dl-{file}"),
                            kind: "download".into(),
                            priority: 3,
                            started_ms: 0,
                            expires_ms: None,
                            lift_until_ms: None,
                            signal: None,
                            icon: Some("download".into()),
                            title: display,
                            value: Some(format!(
                                "{} · {}/s",
                                format_bytes(size),
                                format_bytes(entry.speed as u64)
                            )),
                            detail: None,
                            progress: None,
                            action: Some(format!("open:{}", dir.display())),
                        },
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
    fn names_browser_temp_files() {
        assert_eq!(display_name("ubuntu.iso.crdownload").as_deref(), Some("ubuntu.iso"));
        assert_eq!(display_name("song.mp3.part").as_deref(), Some("song.mp3"));
        assert_eq!(display_name("Unconfirmed 123.crdownload").as_deref(), Some("Downloading…"));
        assert_eq!(display_name("notes.txt"), None);
    }

    #[test]
    fn browser_values() {
        assert_eq!(browser_value(64, Some(100), 14 * 1024 * 1024), "64% · 14 MB/s");
        assert_eq!(browser_value(120 * 1024 * 1024, None, 2048), "120 MB · 2 KB/s");
    }

    #[test]
    fn stale_leftovers_are_not_live() {
        let now = 10_000_000;
        // Last written in August, never seen growing: ignored.
        assert!(!is_live(now, Some(now - 90 * 24 * 3600 * 1000), None));
        // Written a few seconds ago: live.
        assert!(is_live(now, Some(now - 5_000), None));
        // Grew 40 s ago (mtime lagging): still live.
        assert!(is_live(now, Some(now - 120_000), Some(now - 40_000)));
        // No growth for over a minute: dropped.
        assert!(!is_live(now, Some(now - 120_000), Some(now - 61_000)));
    }

    #[test]
    fn formats_sizes() {
        assert_eq!(format_bytes(512), "1 KB");
        assert_eq!(format_bytes(14 * 1024 * 1024), "14 MB");
        assert_eq!(format_bytes(2_576_980_378), "2.4 GB");
    }
}

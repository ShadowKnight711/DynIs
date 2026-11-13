//! Custom activities from your own scripts, without any network listener: a
//! script writes a small JSON file into
//! `%LOCALAPPDATA%\com.kevin.dynis\activities\` and DynIs shows it. Deleting
//! the file ends the activity. See `scripts/dynis-activity.ps1`.
//!
//! File format (all but `title` optional):
//! `{"title":"build","value":"running","state":"running|done|failed","progress":0.4}`

use super::{end, lift, module_enabled, upsert, Activity};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Deserialize)]
struct FileActivity {
    title: String,
    value: Option<String>,
    state: Option<String>,
    progress: Option<f32>,
    detail: Option<String>,
}

#[cfg(windows)]
pub fn folder() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(base).join("com.kevin.dynis").join("activities"))
}

/// ~/.local/share/com.kevin.dynis/activities
#[cfg(target_os = "linux")]
pub fn folder() -> Option<PathBuf> {
    Some(crate::native_host::linux_data_dir()?.join("activities"))
}

/// ~/Library/Application Support/com.kevin.dynis/activities
#[cfg(target_os = "macos")]
pub fn folder() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Application Support/com.kevin.dynis/activities"))
}

fn to_activity(id: &str, f: FileActivity) -> (Activity, bool) {
    let state = f.state.unwrap_or_else(|| "running".into());
    let finished = state == "done" || state == "failed";
    let signal = match state.as_str() {
        "done" => Some("positive".into()),
        "failed" => Some("alert".into()),
        _ => None,
    };
    (
        Activity {
            id: format!("custom-{id}"),
            kind: "custom".into(),
            priority: 3,
            started_ms: 0,
            expires_ms: None,
            lift_until_ms: None,
            signal,
            icon: Some(format!("custom-{state}")),
            title: f.title.chars().take(40).collect(),
            value: f.value.or_else(|| Some(state.clone())),
            detail: f.detail,
            progress: f.progress.map(|p| p.clamp(0.0, 1.0)),
            action: None,
        },
        finished,
    )
}

pub fn setup(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-custom-activities".into())
        .spawn(move || {
            let Some(dir) = folder() else { return };
            let _ = std::fs::create_dir_all(&dir);
            // file -> last modified, so unchanged files aren't re-read.
            let mut seen: HashMap<String, std::time::SystemTime> = HashMap::new();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(700));
                if !module_enabled("bloom-activity-custom", true) {
                    continue;
                }
                let mut present = Vec::new();
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.extension().and_then(|e| e.to_str()) != Some("json") {
                            continue;
                        }
                        let id = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                        present.push(id.clone());
                        let modified = entry.metadata().and_then(|m| m.modified()).ok();
                        if modified.is_some() && seen.get(&id) == modified.as_ref() {
                            continue;
                        }
                        if let Some(m) = modified {
                            seen.insert(id.clone(), m);
                        }
                        let Ok(text) = std::fs::read_to_string(&path) else { continue };
                        let Ok(parsed) = serde_json::from_str::<FileActivity>(&text) else { continue };
                        let (activity, finished) = to_activity(&id, parsed);
                        if finished {
                            // A finished job lifts once, then the file is cleaned up.
                            end(&app, &activity.id);
                            lift(&app, activity, 4000);
                            let _ = std::fs::remove_file(&path);
                            seen.remove(&id);
                        } else {
                            upsert(&app, activity);
                        }
                    }
                }
                let removed: Vec<String> = seen.keys().filter(|k| !present.contains(k)).cloned().collect();
                for id in removed {
                    seen.remove(&id);
                    end(&app, &format!("custom-{id}"));
                }
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_and_finished_states() {
        let (a, done) = to_activity(
            "b",
            FileActivity { title: "build".into(), value: None, state: None, progress: Some(1.5), detail: None },
        );
        assert!(!done);
        assert_eq!(a.value.as_deref(), Some("running"));
        assert_eq!(a.progress, Some(1.0));
        let (a, done) = to_activity(
            "b",
            FileActivity { title: "build".into(), value: None, state: Some("failed".into()), progress: None, detail: None },
        );
        assert!(done);
        assert_eq!(a.signal.as_deref(), Some("alert"));
    }
}

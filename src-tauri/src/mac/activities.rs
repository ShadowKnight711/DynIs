//! Live activities fed by the macOS backend: headphones (AirPods and other
//! Bluetooth audio with a battery level) and the clipboard.

use crate::activities::{end, lift, module_enabled, upsert, Activity};
use crate::macparse::{parse_bluetooth_json, Headset};
use std::collections::HashSet;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub fn setup(app: AppHandle) {
    headphones(app.clone());
    clipboard(app);
}

fn read_headsets() -> Vec<Headset> {
    std::process::Command::new("/usr/sbin/system_profiler")
        .args(["SPBluetoothDataType", "-json", "-detailLevel", "mini"])
        .output()
        .map(|o| parse_bluetooth_json(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

/// Same behaviour as Windows: a calm status bubble with the battery level,
/// and a short lift when a device connects. system_profiler is slow, so
/// every 30 s.
fn headphones(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-headphones".into())
        .spawn(move || {
            let mut known: HashSet<String> = read_headsets().into_iter().map(|h| h.name).collect();
            loop {
                std::thread::sleep(Duration::from_secs(30));
                if !module_enabled("bloom-activity-bluetooth", true) {
                    for name in known.drain() {
                        end(&app, &format!("bt-status-{name}"));
                    }
                    continue;
                }
                let devices = read_headsets();
                let connected: HashSet<String> = devices.iter().map(|d| d.name.clone()).collect();
                for d in &devices {
                    upsert(
                        &app,
                        Activity {
                            id: format!("bt-status-{}", d.name),
                            kind: "headphones-status".into(),
                            priority: 1,
                            started_ms: 0,
                            expires_ms: None,
                            lift_until_ms: None,
                            signal: Some(if d.battery <= 20 { "alert" } else { "positive" }.into()),
                            icon: Some("headphones".into()),
                            title: d.name.clone(),
                            value: Some(format!("{}%", d.battery)),
                            detail: None,
                            progress: Some(d.battery as f32 / 100.0),
                            action: Some("panel:bluetooth".into()),
                        },
                    );
                    if !known.contains(&d.name) {
                        lift(
                            &app,
                            Activity {
                                id: format!("bt-{}", d.name),
                                kind: "headphones".into(),
                                priority: 5,
                                started_ms: 0,
                                expires_ms: None,
                                lift_until_ms: None,
                                signal: Some("positive".into()),
                                icon: Some("headphones".into()),
                                title: d.name.clone(),
                                value: Some(format!("{}%", d.battery)),
                                detail: Some("Connected".into()),
                                progress: None,
                                action: Some("panel:bluetooth".into()),
                            },
                            3500,
                        );
                    }
                }
                for name in known.difference(&connected) {
                    end(&app, &format!("bt-status-{name}"));
                }
                known = connected;
            }
        })
        .ok();
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Captured {
    text: Option<String>,
    files: Vec<String>,
    image: bool,
}

/// Copied text goes to the island's Recent copies, like on Windows (off
/// unless the clipboard activity is turned on). NSPasteboard's change count
/// tells when something new was copied, so the text is only read then.
fn clipboard(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-clipboard".into())
        .spawn(move || {
            let count = || objc2_app_kit::NSPasteboard::generalPasteboard().changeCount();
            let mut last = count();
            loop {
                std::thread::sleep(Duration::from_millis(500));
                let now = count();
                if now == last {
                    continue;
                }
                last = now;
                if !module_enabled("bloom-activity-clipboard", false) || super::actions::take_clipboard_ignore() {
                    continue;
                }
                let Ok(mut cb) = arboard::Clipboard::new() else { continue };
                if let Ok(text) = cb.get_text() {
                    if !text.trim().is_empty() {
                        let _ = app.emit("clipboard-captured", Captured { text: Some(text), files: vec![], image: false });
                    }
                }
            }
        })
        .ok();
}

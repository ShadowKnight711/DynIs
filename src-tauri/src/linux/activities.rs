//! Live activities fed by the Linux backend: Bluetooth headphones (BlueZ,
//! battery level), the clipboard, and other apps' notifications (opt-in,
//! off by default, like on Windows).

use crate::activities::{end, lift, module_enabled, upsert, Activity};
use crate::linuxparse::{bluez_headset, notification_text};
use crate::macparse::Headset;
use std::collections::{HashMap, HashSet};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use zbus::zvariant::{OwnedValue, Value};

pub fn setup(app: AppHandle) {
    headphones(app.clone());
    clipboard(app.clone());
    notifications(app);
}

// ── Headphones (BlueZ) ──

fn read_headsets(conn: &zbus::blocking::Connection) -> Vec<Headset> {
    let Ok(om) = zbus::blocking::fdo::ObjectManagerProxy::builder(conn)
        .destination("org.bluez")
        .and_then(|b| b.path("/"))
        .and_then(|b| b.build())
    else {
        return vec![];
    };
    let Ok(objects) = om.get_managed_objects() else { return vec![] };
    objects
        .values()
        .filter_map(|ifaces| {
            let find = |name: &str| ifaces.iter().find(|(k, _)| k.as_str() == name).map(|(_, v)| v);
            let dev = find("org.bluez.Device1")?;
            let battery = find("org.bluez.Battery1")?;
            let s = |k: &str| match dev.get(k).map(|v| &**v) {
                Some(Value::Str(s)) => Some(s.to_string()),
                _ => None,
            };
            let connected = matches!(dev.get("Connected").map(|v| &**v), Some(Value::Bool(true)));
            let pct = match battery.get("Percentage").map(|v| &**v) {
                Some(Value::U8(p)) => Some(*p),
                _ => None,
            };
            bluez_headset(&s("Alias").or_else(|| s("Name"))?, s("Icon").as_deref(), connected, pct)
        })
        .collect()
}

fn headphone_activity(d: &Headset, lifted: bool) -> Activity {
    Activity {
        id: if lifted { format!("bt-{}", d.name) } else { format!("bt-status-{}", d.name) },
        kind: if lifted { "headphones" } else { "headphones-status" }.into(),
        priority: if lifted { 5 } else { 1 },
        started_ms: 0,
        expires_ms: None,
        lift_until_ms: None,
        signal: Some(if d.battery <= 20 && !lifted { "alert" } else { "positive" }.into()),
        icon: Some("headphones".into()),
        title: d.name.clone(),
        value: Some(format!("{}%", d.battery)),
        detail: lifted.then(|| "Connected".into()),
        progress: (!lifted).then_some(d.battery as f32 / 100.0),
        action: Some("panel:bluetooth".into()),
    }
}

/// Same behaviour as Windows: a calm status bubble with the battery level,
/// and a short lift when a device connects. Woken by BlueZ signals.
fn headphones(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-headphones".into())
        .spawn(move || {
            let Ok(conn) = zbus::blocking::Connection::system() else { return };
            let (tx, rx) = mpsc::channel::<()>();
            if let Ok(rule) = zbus::MatchRule::builder().msg_type(zbus::message::Type::Signal).sender("org.bluez").map(|r| r.build()) {
                let c = conn.clone();
                std::thread::spawn(move || {
                    let Ok(iter) = zbus::blocking::MessageIterator::for_match_rule(rule, &c, Some(32)) else { return };
                    for _ in iter {
                        if tx.send(()).is_err() {
                            return;
                        }
                    }
                });
            }
            let mut known: HashSet<String> = read_headsets(&conn).into_iter().map(|h| h.name).collect();
            loop {
                // Battery levels change without a signal on some devices: re-read every 5 min too.
                if rx.recv_timeout(Duration::from_secs(300)).is_ok() {
                    std::thread::sleep(Duration::from_millis(500));
                    while rx.try_recv().is_ok() {}
                }
                if !module_enabled("bloom-activity-bluetooth", true) {
                    for name in known.drain() {
                        end(&app, &format!("bt-status-{name}"));
                    }
                    continue;
                }
                let devices = read_headsets(&conn);
                let connected: HashSet<String> = devices.iter().map(|d| d.name.clone()).collect();
                for d in &devices {
                    upsert(&app, headphone_activity(d, false));
                    if !known.contains(&d.name) {
                        lift(&app, headphone_activity(d, true), 3500);
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

// ── Clipboard ──

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Captured {
    text: Option<String>,
    files: Vec<String>,
    image: bool,
}

/// Copied text goes to the island's Recent copies, like on Windows. Off
/// unless the clipboard activity is turned on; the clipboard isn't read
/// while it's off.
fn clipboard(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-clipboard".into())
        .spawn(move || {
            let mut cb: Option<arboard::Clipboard> = None;
            let mut last: Option<u64> = None;
            loop {
                std::thread::sleep(Duration::from_millis(800));
                if !module_enabled("bloom-activity-clipboard", false) {
                    cb = None;
                    last = None;
                    continue;
                }
                if cb.is_none() {
                    cb = arboard::Clipboard::new().ok();
                }
                let Some(text) = cb.as_mut().and_then(|c| c.get_text().ok()) else { continue };
                use std::hash::{Hash, Hasher};
                let mut h = std::collections::hash_map::DefaultHasher::new();
                text.hash(&mut h);
                let hash = h.finish();
                // The first reading is what was already there, not a new copy.
                let first = last.is_none();
                if last == Some(hash) {
                    continue;
                }
                last = Some(hash);
                if first || super::actions::take_clipboard_ignore() || text.trim().is_empty() {
                    continue;
                }
                let _ = app.emit("clipboard-captured", Captured { text: Some(text), files: vec![], image: false });
            }
        })
        .ok();
}

// ── Notifications (opt-in) ──

type NotifyArgs = (String, u32, String, String, String, Vec<String>, HashMap<String, OwnedValue>, i32);

/// Watches other apps' notifications on the session bus (a D-Bus monitor
/// that only sees Notify calls). Only while "Notifications" is turned on in
/// Settings → Notch → Live Activities.
fn notifications(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-notifications".into())
        .spawn(move || {
            let mut n = 0u64;
            loop {
                if !module_enabled("bloom-activity-notifications", false) {
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
                let Ok(conn) = zbus::blocking::Connection::session() else {
                    std::thread::sleep(Duration::from_secs(30));
                    continue;
                };
                let rule = "type='method_call',interface='org.freedesktop.Notifications',member='Notify'";
                let monitoring = conn.call_method(
                    Some("org.freedesktop.DBus"),
                    "/org/freedesktop/DBus",
                    Some("org.freedesktop.DBus.Monitoring"),
                    "BecomeMonitor",
                    &(vec![rule], 0u32),
                );
                if monitoring.is_err() {
                    std::thread::sleep(Duration::from_secs(60));
                    continue;
                }
                for msg in zbus::blocking::MessageIterator::from(&conn) {
                    if !module_enabled("bloom-activity-notifications", false) {
                        break; // Dropping the connection ends the monitor.
                    }
                    let Ok(msg) = msg else { continue };
                    if msg.header().member().map(|m| m.as_str()) != Some("Notify") {
                        continue;
                    }
                    let Ok((app_name, _, _, summary, body, ..)) = msg.body().deserialize::<NotifyArgs>() else { continue };
                    let Some((title, detail)) = notification_text(&app_name, &summary, &body) else { continue };
                    n += 1;
                    let name = if app_name.trim().is_empty() { "Notification".to_string() } else { app_name.clone() };
                    lift(
                        &app,
                        Activity {
                            id: format!("notif-{n}"),
                            kind: "notification".into(),
                            priority: 4,
                            started_ms: 0,
                            expires_ms: None,
                            lift_until_ms: None,
                            signal: None,
                            icon: Some("bell".into()),
                            title: format!("{name}: {title}"),
                            value: None,
                            detail: (!detail.is_empty()).then_some(detail),
                            progress: None,
                            action: None,
                        },
                        // Kept a while so it is still listed when the island opens.
                        60_000,
                    );
                }
            }
        })
        .ok();
}

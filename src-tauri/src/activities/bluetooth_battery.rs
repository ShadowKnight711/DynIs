//! Headphones / Bluetooth connected: a lift with the device name and, when
//! Windows reports it, the battery level. Works for any headset that sends
//! battery over Bluetooth (most do, e.g. Sennheiser Momentum 4).

use super::{end, lift, module_enabled, upsert, Activity};
use std::collections::HashSet;
use tauri::AppHandle;

pub fn setup(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-bt-activity".into())
        .spawn(move || {
            // Devices already connected at startup don't announce themselves.
            let mut known: HashSet<String> = crate::bluetooth::list_sync()
                .into_iter()
                .filter(|d| d.connected)
                .map(|d| d.name)
                .collect();
            loop {
                // Device enumeration is relatively heavy: every 10 s is plenty.
                std::thread::sleep(std::time::Duration::from_secs(10));
                if !module_enabled("bloom-activity-bluetooth", true) {
                    for name in known.iter() {
                        end(&app, &format!("bt-status-{name}"));
                    }
                    continue;
                }
                let devices = crate::bluetooth::list_sync();
                let connected: HashSet<String> = devices
                    .iter()
                    .filter(|d| d.connected)
                    .map(|d| d.name.clone())
                    .collect();
                // A calm status bubble for connected headphones, kept up to date.
                for device in devices.iter().filter(|d| d.connected && d.kind == "audio") {
                    upsert(
                        &app,
                        Activity {
                            id: format!("bt-status-{}", device.name),
                            kind: "headphones-status".into(),
                            priority: 1,
                            started_ms: 0,
                            expires_ms: None,
                            lift_until_ms: None,
                            signal: Some(match device.battery {
                                Some(b) if b <= 20 => "alert".into(),
                                _ => "positive".into(),
                            }),
                            icon: Some("headphones".into()),
                            title: device.name.clone(),
                            value: device.battery.map(|b| format!("{b}%")),
                            detail: None,
                            progress: device.battery.map(|b| b as f32 / 100.0),
                            action: Some("panel:bluetooth".into()),
                        },
                    );
                }
                for name in known.difference(&connected) {
                    end(&app, &format!("bt-status-{name}"));
                }
                for device in devices.iter().filter(|d| d.connected) {
                    if known.contains(&device.name) {
                        continue;
                    }
                    lift(
                        &app,
                        Activity {
                            id: format!("bt-{}", device.name),
                            kind: "headphones".into(),
                            priority: 5,
                            started_ms: 0,
                            expires_ms: None,
                            lift_until_ms: None,
                            signal: Some("positive".into()),
                            icon: Some(if device.kind == "audio" { "headphones" } else { "bluetooth" }.into()),
                            title: device.name.clone(),
                            value: Some(match device.battery {
                                Some(level) => format!("{level}%"),
                                None => "Connected".into(),
                            }),
                            detail: Some("Connected".into()),
                            progress: None,
                            action: Some("panel:bluetooth".into()),
                        },
                        3500,
                    );
                }
                known = connected;
            }
        })
        .ok();
}

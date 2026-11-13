//! Pure parsing for the macOS backend (AppleScript, pmset, system_profiler,
//! screen geometry). Compiled on every platform so it is unit-tested on the
//! Windows build machine too.

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Serialize;

/// One player's state from the AppleScript line (tab-separated).
#[derive(Debug, Clone, PartialEq)]
pub struct PlayerState {
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub duration_s: f64,
    pub position_s: f64,
    pub shuffle: bool,
    /// "none" | "track" | "list"
    pub repeat: String,
    pub artwork_url: String,
    pub track_id: String,
}

/// AppleScript prints reals with the user's decimal separator ("3,5").
fn num(s: &str) -> f64 {
    s.trim().replace(',', ".").parse().unwrap_or(0.0)
}

/// `state \t title \t artist \t duration_s \t position_s \t shuffle \t repeat \t artwork \t id`
pub fn parse_player_line(line: &str, spotify: bool) -> Option<PlayerState> {
    let line = line.trim_end_matches(['\n', '\r']);
    if line.is_empty() || line == "stopped" {
        return None;
    }
    let f: Vec<&str> = line.split('\t').collect();
    if f.len() < 9 {
        return None;
    }
    let repeat = if spotify {
        if f[6].trim() == "true" { "list" } else { "none" }
    } else {
        match f[6].trim() {
            "one" => "track",
            "all" => "list",
            _ => "none",
        }
    };
    Some(PlayerState {
        playing: f[0].trim() == "playing",
        title: f[1].to_string(),
        artist: f[2].to_string(),
        duration_s: num(f[3]),
        position_s: num(f[4]),
        shuffle: f[5].trim() == "true",
        repeat: repeat.into(),
        artwork_url: f[7].trim().to_string(),
        track_id: f[8].trim().to_string(),
    })
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct BatteryDetails {
    pub present: bool,
    pub percent: Option<u8>,
    pub plugged_in: bool,
    pub charging: bool,
    pub seconds_left: Option<u64>,
    pub seconds_to_full: Option<u64>,
    pub health_percent: Option<u8>,
    pub power_mode: Option<&'static str>,
}

/// Parses `pmset -g batt`, e.g.
/// `Now drawing from 'AC Power'\n -InternalBattery-0 (id=…)\t87%; charging; 0:45 remaining present: true`.
pub fn parse_pmset(text: &str) -> BatteryDetails {
    let mut d = BatteryDetails { plugged_in: text.contains("'AC Power'"), ..Default::default() };
    let Some(line) = text.lines().find(|l| l.contains("InternalBattery")) else {
        return d;
    };
    d.present = true;
    d.percent = line
        .split(['\t', ' '])
        .find(|w| w.ends_with("%;") || w.ends_with('%'))
        .and_then(|w| w.trim_end_matches(';').trim_end_matches('%').parse().ok());
    let lower = line.to_lowercase();
    d.charging = lower.contains("; charging") || lower.contains("; finishing charge");
    if let Some(i) = lower.find(" remaining") {
        if let Some((h, m)) = lower[..i].rsplit(' ').next().and_then(|t| t.split_once(':')) {
            if let (Ok(h), Ok(m)) = (h.parse::<u64>(), m.parse::<u64>()) {
                let secs = h * 3600 + m * 60;
                if d.charging {
                    d.seconds_to_full = Some(secs);
                } else if !d.plugged_in {
                    d.seconds_left = Some(secs);
                }
            }
        }
    }
    d
}

/// A connected Bluetooth audio device with a battery level.
#[derive(Debug, Clone, PartialEq)]
pub struct Headset {
    pub name: String,
    /// The lowest of the reported levels (left, right, single).
    pub battery: u8,
}

fn pct(v: &serde_json::Value) -> Option<u8> {
    v.as_str()?.trim().trim_end_matches('%').trim().parse().ok()
}

/// `system_profiler SPBluetoothDataType -json`: connected devices with a
/// battery (AirPods report Left/Right/Case; others a single level).
pub fn parse_bluetooth_json(text: &str) -> Vec<Headset> {
    let Ok(root) = serde_json::from_str::<serde_json::Value>(text) else {
        return vec![];
    };
    let mut out = vec![];
    for section in root["SPBluetoothDataType"].as_array().into_iter().flatten() {
        for group in section["device_connected"].as_array().into_iter().flatten() {
            let Some(obj) = group.as_object() else { continue };
            for (name, props) in obj {
                let levels: Vec<u8> = ["device_batteryLevelLeft", "device_batteryLevelRight", "device_batteryLevelMain", "device_batteryLevel"]
                    .iter()
                    .filter_map(|k| pct(&props[*k]))
                    .collect();
                if let Some(min) = levels.into_iter().min() {
                    out.push(Headset { name: name.clone(), battery: min });
                }
            }
        }
    }
    out
}

/// Where the island goes on a Mac screen (points, top-left origin).
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct MacDisplay {
    pub has_notch: bool,
    /// Width of the camera housing (0 without a notch).
    pub notch_width: f64,
    /// Height of the menu bar / notch area.
    pub top_inset: f64,
    pub screen_width: f64,
}

/// From NSScreen: frame width, safeAreaInsets.top, and the widths of the
/// auxiliary areas left and right of the notch.
pub fn mac_display(frame_width: f64, safe_top: f64, aux_left_width: f64, aux_right_width: f64) -> MacDisplay {
    let has_notch = safe_top > 0.0 && aux_left_width > 0.0 && aux_right_width > 0.0;
    MacDisplay {
        has_notch,
        notch_width: if has_notch { (frame_width - aux_left_width - aux_right_width).max(0.0) } else { 0.0 },
        top_inset: safe_top.max(0.0),
        screen_width: frame_width,
    }
}

/// Target frame for "Snap" on the visible area (x, y, w, h) in points.
pub fn snap_frame(layout: &str, area: (f64, f64, f64, f64)) -> Option<(f64, f64, f64, f64)> {
    let (x, y, w, h) = area;
    let (hw, hh) = (w / 2.0, h / 2.0);
    Some(match layout {
        "left" => (x, y, hw, h),
        "right" => (x + hw, y, hw, h),
        "full" => (x, y, w, h),
        "center" => (x + w * 0.15, y + h * 0.1, w * 0.7, h * 0.8),
        "top-left" => (x, y, hw, hh),
        "top-right" => (x + hw, y, hw, hh),
        "bottom-left" => (x, y + hh, hw, hh),
        "bottom-right" => (x + hw, y + hh, hw, hh),
        _ => return None,
    })
}

/// Whether the pointer (screen px) is over the island's interactive rect
/// (window-relative logical px), with a small margin.
pub fn pointer_inside(pointer: (f64, f64), window_origin: (f64, f64), scale: f64, rect: (i32, i32, i32, i32), margin: f64) -> bool {
    let (px, py) = pointer;
    let (wx, wy) = window_origin;
    let (rx, ry, rw, rh) = rect;
    let left = wx + (rx as f64 - margin) * scale;
    let top = wy + (ry as f64 - margin).max(0.0) * scale;
    let right = wx + (rx as f64 + rw as f64 + margin) * scale;
    let bottom = wy + (ry as f64 + rh as f64 + margin) * scale;
    // The top edge counts as inside (Fitts: the island touches the screen edge).
    px >= left && px <= right && py >= wy.min(top) && py <= bottom
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_spotify_and_music_lines() {
        let s = parse_player_line("playing\tBlinding Lights\tThe Weeknd\t200,04\t12,5\tfalse\ttrue\thttps://i.scdn.co/image/ab67\tspotify:track:0VjI\n", true).unwrap();
        assert!(s.playing && !s.shuffle);
        assert_eq!(s.title, "Blinding Lights");
        assert_eq!(s.duration_s, 200.04);
        assert_eq!(s.position_s, 12.5);
        assert_eq!(s.repeat, "list");
        assert_eq!(s.artwork_url, "https://i.scdn.co/image/ab67");
        let m = parse_player_line("paused\tSong\tArtist\t180.5\t3\ttrue\tone\t\tABCDEF\n", false).unwrap();
        assert!(!m.playing && m.shuffle);
        assert_eq!(m.repeat, "track");
        assert_eq!(m.track_id, "ABCDEF");
        assert!(parse_player_line("stopped\n", true).is_none());
        assert!(parse_player_line("", false).is_none());
        assert!(parse_player_line("playing\tonly\tthree", false).is_none());
    }

    #[test]
    fn parses_pmset_on_battery_charging_and_desktop() {
        let d = parse_pmset("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t87%; discharging; 5:12 remaining present: true\n");
        assert!(d.present && !d.plugged_in && !d.charging);
        assert_eq!((d.percent, d.seconds_left), (Some(87), Some(5 * 3600 + 12 * 60)));
        let d = parse_pmset("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234)\t42%; charging; 1:05 remaining present: true\n");
        assert!(d.plugged_in && d.charging);
        assert_eq!((d.percent, d.seconds_to_full), (Some(42), Some(3900)));
        let d = parse_pmset("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n");
        assert!(d.plugged_in && !d.charging && d.percent == Some(100));
        assert!(!parse_pmset("Now drawing from 'AC Power'\n").present);
    }

    #[test]
    fn parses_airpods_and_single_battery_devices() {
        let json = r#"{"SPBluetoothDataType":[{"device_connected":[
            {"AirPods Pro":{"device_batteryLevelLeft":"80%","device_batteryLevelRight":"74%","device_batteryLevelCase":"40%"}},
            {"MOMENTUM 4":{"device_batteryLevelMain":"55%"}},
            {"Magic Mouse":{"device_minorType":"Mouse"}}
        ]}]}"#;
        let h = parse_bluetooth_json(json);
        assert_eq!(h, vec![
            Headset { name: "AirPods Pro".into(), battery: 74 },
            Headset { name: "MOMENTUM 4".into(), battery: 55 },
        ]);
        assert!(parse_bluetooth_json("not json").is_empty());
    }

    #[test]
    fn detects_the_notch() {
        // 14" MacBook Pro: 1512 pt wide, 32 pt safe top, ~657 pt either side.
        let d = mac_display(1512.0, 32.0, 657.0, 657.0);
        assert!(d.has_notch);
        assert_eq!(d.notch_width, 198.0);
        assert_eq!(d.top_inset, 32.0);
        let d = mac_display(1920.0, 0.0, 0.0, 0.0);
        assert!(!d.has_notch && d.notch_width == 0.0);
    }

    #[test]
    fn snap_frames_and_pointer_hit_test() {
        assert_eq!(snap_frame("left", (0.0, 25.0, 1000.0, 800.0)), Some((0.0, 25.0, 500.0, 800.0)));
        assert_eq!(snap_frame("bottom-right", (0.0, 0.0, 1000.0, 800.0)), Some((500.0, 400.0, 500.0, 400.0)));
        assert_eq!(snap_frame("diagonal", (0.0, 0.0, 1.0, 1.0)), None);
        // Pill at x 600..800, y 0..40 in a window at (0,0), scale 2.
        let rect = (600, 0, 200, 40);
        assert!(pointer_inside((1400.0, 0.0), (0.0, 0.0), 2.0, rect, 4.0));
        assert!(pointer_inside((1200.0, 80.0), (0.0, 0.0), 2.0, rect, 4.0));
        assert!(!pointer_inside((1000.0, 20.0), (0.0, 0.0), 2.0, rect, 4.0));
        assert!(!pointer_inside((1400.0, 200.0), (0.0, 0.0), 2.0, rect, 4.0));
    }
}

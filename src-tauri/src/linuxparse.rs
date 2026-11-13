//! Pure parsing for the Linux backend (DynIs 2.2, Zorin OS and other
//! GNOME/Ubuntu desktops): desktop entries, MPRIS players, PipeWire/PulseAudio
//! volume, UPower, backlight, BlueZ and window geometry. Compiled on every
//! platform so it is unit-tested on the Windows build machine too.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::collections::HashMap;

// ── Desktop entries (installed apps) ──

#[derive(Debug, Clone, PartialEq, Default)]
pub struct DesktopApp {
    pub name: String,
    pub exec: String,
    pub icon: Option<String>,
}

/// The `[Desktop Entry]` group of a .desktop file. None for entries that
/// aren't shown as apps (NoDisplay, Hidden, not an Application, no Exec).
pub fn parse_desktop_entry(text: &str) -> Option<DesktopApp> {
    let mut in_main = false;
    let mut fields: HashMap<&str, &str> = HashMap::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with('[') {
            in_main = line == "[Desktop Entry]";
            continue;
        }
        if !in_main || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            // Unlocalized keys only ("Name", not "Name[de]").
            fields.entry(k.trim()).or_insert(v.trim());
        }
    }
    let truthy = |k: &str| fields.get(k).is_some_and(|v| v.eq_ignore_ascii_case("true"));
    if fields.get("Type").copied().unwrap_or("Application") != "Application" || truthy("NoDisplay") || truthy("Hidden") {
        return None;
    }
    let name = fields.get("Name")?.to_string();
    let exec = fields.get("Exec")?.to_string();
    if name.is_empty() || exec.is_empty() {
        return None;
    }
    Some(DesktopApp { name, exec, icon: fields.get("Icon").map(|s| s.to_string()).filter(|s| !s.is_empty()) })
}

/// An Exec line → program and arguments, without the %f/%U… field codes
/// (DynIs launches apps without files). Handles double quotes and `%%`.
pub fn exec_argv(exec: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut has = false;
    let mut chars = exec.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                quoted = !quoted;
                has = true;
            }
            '\\' if quoted => {
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            ' ' | '\t' if !quoted => {
                if has || !cur.is_empty() {
                    args.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            '%' => match chars.next() {
                Some('%') => cur.push('%'),
                Some(_) => {} // field code: dropped
                None => cur.push('%'),
            },
            _ => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        args.push(cur);
    }
    args.retain(|a| !a.is_empty());
    args
}

// ── MPRIS (media players on the session bus) ──

pub const MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.";

#[derive(Debug, Clone, PartialEq, Default)]
pub struct PlayerSnapshot {
    /// Bus name, e.g. "org.mpris.MediaPlayer2.spotify".
    pub bus: String,
    /// "Playing", "Paused" or "Stopped".
    pub status: String,
    pub title: String,
    pub artists: Vec<String>,
    pub art_url: Option<String>,
    pub length_us: Option<i64>,
    pub position_us: Option<i64>,
    pub track_id: Option<String>,
    pub shuffle: Option<bool>,
    /// "None", "Track" or "Playlist".
    pub loop_status: Option<String>,
    pub can_seek: bool,
}

impl PlayerSnapshot {
    pub fn playing(&self) -> bool {
        self.status == "Playing"
    }
    pub fn has_track(&self) -> bool {
        !self.title.trim().is_empty() && self.status != "Stopped"
    }
}

/// The app part of a player's bus name: "spotify", "firefox", "chromium",
/// "brave", "vlc"… (instance suffixes like ".instance_1_23" dropped).
pub fn player_app(bus: &str) -> String {
    let name = bus.strip_prefix(MPRIS_PREFIX).unwrap_or(bus);
    name.split(".instance").next().unwrap_or(name).to_string()
}

/// Which player the island follows: one that is playing (the one that started
/// most recently), else the most recently playing one that still has a track.
/// `started` maps bus → when it last started playing (ms).
pub fn pick_player(players: &[PlayerSnapshot], started: &HashMap<String, u64>) -> Option<usize> {
    let at = |p: &PlayerSnapshot| started.get(&p.bus).copied().unwrap_or(0);
    let best = |want_playing: bool| {
        players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.has_track() && p.playing() == want_playing)
            .max_by_key(|(_, p)| at(p))
            .map(|(i, _)| i)
    };
    best(true).or_else(|| best(false))
}

/// MPRIS LoopStatus → the island's repeat value.
pub fn loop_to_repeat(status: Option<&str>) -> Option<String> {
    Some(
        match status? {
            "Track" => "track",
            "Playlist" => "list",
            _ => "none",
        }
        .to_string(),
    )
}

/// None → Playlist → Track → None, like the island's repeat button.
pub fn next_loop_status(status: Option<&str>) -> &'static str {
    match status {
        Some("Playlist") => "Track",
        Some("Track") => "None",
        _ => "Playlist",
    }
}

/// `file:///…` art (Firefox, Chromium, VLC write a temp file) → the local
/// path. Only real files under /tmp, the user's cache or home are read.
pub fn local_art_path(url: &str) -> Option<String> {
    let path = url.strip_prefix("file://")?;
    let path = percent_decode(path);
    if path.contains("..") || !path.starts_with('/') {
        return None;
    }
    Some(path)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Spotify's desktop app still reports art on the retired open.spotify.com
/// image host; point it at i.scdn.co, which the island may load.
pub fn fix_art_url(url: &str) -> String {
    url.replacen("https://open.spotify.com/image/", "https://i.scdn.co/image/", 1)
}

// ── Volume ──

/// `wpctl get-volume @DEFAULT_AUDIO_SINK@` → "Volume: 0.40" or "Volume: 0.40 [MUTED]".
pub fn parse_wpctl_volume(text: &str) -> Option<(f32, bool)> {
    let line = text.lines().find(|l| l.trim_start().starts_with("Volume:"))?;
    let rest = line.trim_start().trim_start_matches("Volume:").trim();
    let value: f32 = rest.split_whitespace().next()?.parse().ok()?;
    Some((value.clamp(0.0, 1.5), rest.contains("[MUTED]")))
}

/// `pactl get-sink-volume @DEFAULT_SINK@` → the first channel's percent.
pub fn parse_pactl_volume(text: &str) -> Option<f32> {
    let pct = text.split('/').find(|p| p.trim().ends_with('%'))?;
    let n: f32 = pct.trim().trim_end_matches('%').trim().parse().ok()?;
    Some((n / 100.0).clamp(0.0, 1.5))
}

/// `pactl get-sink-mute @DEFAULT_SINK@` → "Mute: yes".
pub fn parse_pactl_mute(text: &str) -> bool {
    text.lines().any(|l| l.trim().eq_ignore_ascii_case("mute: yes"))
}

/// A `pactl subscribe` line about the output (sink) or the default device.
pub fn is_sink_event(line: &str) -> bool {
    let l = line.to_lowercase();
    l.contains("change") && (l.contains("on sink #") || l.contains("on server"))
}

// ── Battery (UPower) ──

/// UPower's DisplayDevice → the island's battery details.
/// State: 1 charging, 2 discharging, 3 empty, 4 fully charged,
/// 5 pending charge, 6 pending discharge.
pub fn upower_details(
    is_present: bool,
    percentage: f64,
    state: u32,
    time_to_empty_s: i64,
    time_to_full_s: i64,
    on_battery: bool,
) -> crate::macparse::BatteryDetails {
    if !is_present {
        return Default::default();
    }
    let charging = state == 1;
    crate::macparse::BatteryDetails {
        present: true,
        percent: Some(percentage.round().clamp(0.0, 100.0) as u8),
        plugged_in: !on_battery || matches!(state, 1 | 4 | 5),
        charging,
        seconds_left: (state == 2 && time_to_empty_s > 0).then_some(time_to_empty_s as u64),
        seconds_to_full: (charging && time_to_full_s > 0).then_some(time_to_full_s as u64),
        health_percent: None,
        power_mode: None,
    }
}

// ── Backlight ──

/// Brightness 0–100 from /sys/class/backlight/*/{brightness,max_brightness}.
pub fn backlight_percent(current: u32, max: u32) -> u32 {
    if max == 0 {
        return 0;
    }
    ((current as f64 / max as f64) * 100.0).round().clamp(0.0, 100.0) as u32
}

/// The raw value for a 0–100 level, never fully dark (1% minimum).
pub fn backlight_value(percent: u32, max: u32) -> u32 {
    let p = percent.clamp(1, 100) as f64 / 100.0;
    ((max as f64 * p).round() as u32).clamp(1, max.max(1))
}

// ── Bluetooth headsets (BlueZ) ──

/// A connected BlueZ device with a Battery1 interface, if it's audio.
pub fn bluez_headset(alias: &str, icon: Option<&str>, connected: bool, percentage: Option<u8>) -> Option<crate::macparse::Headset> {
    if !connected {
        return None;
    }
    let audio = icon.is_none_or(|i| i.starts_with("audio-") || i.contains("headset") || i.contains("headphone"));
    if !audio {
        return None;
    }
    Some(crate::macparse::Headset { name: alias.to_string(), battery: percentage?.min(100) })
}

// ── Windows on screen (X11 / EWMH) ──

/// Whether the focused window covers the island's strip: full screen, or
/// maximized (it reaches the top of the screen). Smart mode then hides the
/// island, like on Windows.
pub fn covers_island(states: &[&str], win: (i32, i32, i32, i32), screen: (i32, i32, i32, i32), island_bottom: i32) -> bool {
    if states.contains(&"_NET_WM_STATE_FULLSCREEN") {
        return true;
    }
    let maximized = states.contains(&"_NET_WM_STATE_MAXIMIZED_VERT") && states.contains(&"_NET_WM_STATE_MAXIMIZED_HORZ");
    let (wx, wy, ww, wh) = win;
    let (sx, sy, sw, sh) = screen;
    let on_screen = wx < sx + sw && wx + ww > sx && wy < sy + sh && wy + wh > sy;
    on_screen && (maximized || (wy <= sy + island_bottom && ww >= sw * 9 / 10))
}

// ── Notifications ──

/// Text for a notification activity: one line, bounded.
pub fn notification_text(app: &str, summary: &str, body: &str) -> Option<(String, String)> {
    let clean = |s: &str, n: usize| -> String {
        // Notification bodies may carry simple markup.
        let mut out = String::new();
        let mut tag = false;
        for c in s.chars() {
            match c {
                '<' => tag = true,
                '>' => tag = false,
                _ if !tag => out.push(if c == '\n' { ' ' } else { c }),
                _ => {}
            }
        }
        let t = out.split_whitespace().collect::<Vec<_>>().join(" ");
        if t.chars().count() > n {
            t.chars().take(n - 1).chain(std::iter::once('…')).collect()
        } else {
            t
        }
    };
    let title = clean(if summary.trim().is_empty() { app } else { summary }, 80);
    if title.is_empty() || app.eq_ignore_ascii_case("dynis") {
        return None;
    }
    Some((title, clean(body, 140)))
}

// ── Browsers (native messaging hosts) ──

/// Where each Linux browser looks for native messaging hosts, relative to
/// the home folder, and whether it's Firefox (its own manifest format).
/// Snap and Flatpak browsers can't run an outside host; see LINUX-BUILD.md.
pub const LINUX_HOST_DIRS: [(&str, &str, bool); 6] = [
    ("Brave", ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts", false),
    ("Chrome", ".config/google-chrome/NativeMessagingHosts", false),
    ("Chromium", ".config/chromium/NativeMessagingHosts", false),
    ("Edge", ".config/microsoft-edge/NativeMessagingHosts", false),
    ("Vivaldi", ".config/vivaldi/NativeMessagingHosts", false),
    ("Firefox", ".mozilla/native-messaging-hosts", true),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_desktop_entries() {
        let text = "[Desktop Entry]\nType=Application\nName=Firefox Web Browser\nName[de]=Firefox-Webbrowser\nExec=firefox %u\nIcon=firefox\n\n[Desktop Action new-window]\nName=New Window\nExec=firefox --new-window %u\n";
        let app = parse_desktop_entry(text).unwrap();
        assert_eq!(app.name, "Firefox Web Browser");
        assert_eq!(app.exec, "firefox %u");
        assert_eq!(app.icon.as_deref(), Some("firefox"));
        assert!(parse_desktop_entry("[Desktop Entry]\nName=Hidden\nExec=x\nNoDisplay=true\n").is_none());
        assert!(parse_desktop_entry("[Desktop Entry]\nType=Link\nName=L\nURL=https://x\n").is_none());
        assert!(parse_desktop_entry("[Desktop Entry]\nName=No exec\n").is_none());
    }

    #[test]
    fn exec_lines_drop_field_codes() {
        assert_eq!(exec_argv("firefox %u"), vec!["firefox"]);
        assert_eq!(exec_argv("/usr/bin/code --unity-launch %F"), vec!["/usr/bin/code", "--unity-launch"]);
        assert_eq!(exec_argv(r#""/opt/My App/app" --name "a b" 100%%"#), vec!["/opt/My App/app", "--name", "a b", "100%"]);
        assert_eq!(exec_argv("env BAMF=1 gimp-2.10 %U"), vec!["env", "BAMF=1", "gimp-2.10"]);
    }

    fn player(bus: &str, status: &str, title: &str) -> PlayerSnapshot {
        PlayerSnapshot { bus: bus.into(), status: status.into(), title: title.into(), ..Default::default() }
    }

    #[test]
    fn follows_the_player_that_started_last() {
        let ps = vec![
            player("org.mpris.MediaPlayer2.spotify", "Paused", "Song"),
            player("org.mpris.MediaPlayer2.firefox.instance_1_42", "Playing", "Video"),
            player("org.mpris.MediaPlayer2.vlc", "Playing", "Movie"),
            player("org.mpris.MediaPlayer2.rhythmbox", "Stopped", "Old"),
        ];
        let mut started = HashMap::new();
        started.insert("org.mpris.MediaPlayer2.vlc".to_string(), 50);
        started.insert("org.mpris.MediaPlayer2.firefox.instance_1_42".to_string(), 90);
        assert_eq!(pick_player(&ps, &started), Some(1));
        // Nothing playing: the paused one with a track.
        let paused = vec![ps[0].clone(), ps[3].clone()];
        assert_eq!(pick_player(&paused, &started), Some(0));
        assert_eq!(pick_player(&[player("x", "Stopped", "")], &started), None);
    }

    #[test]
    fn names_players_and_their_repeat() {
        assert_eq!(player_app("org.mpris.MediaPlayer2.spotify"), "spotify");
        assert_eq!(player_app("org.mpris.MediaPlayer2.firefox.instance_1_42"), "firefox");
        assert_eq!(player_app("org.mpris.MediaPlayer2.chromium.instance12345"), "chromium");
        assert_eq!(loop_to_repeat(Some("Playlist")).as_deref(), Some("list"));
        assert_eq!(loop_to_repeat(Some("None")).as_deref(), Some("none"));
        assert_eq!(loop_to_repeat(None), None);
        assert_eq!(next_loop_status(Some("None")), "Playlist");
        assert_eq!(next_loop_status(Some("Playlist")), "Track");
        assert_eq!(next_loop_status(Some("Track")), "None");
    }

    #[test]
    fn artwork_addresses() {
        assert_eq!(local_art_path("file:///tmp/firefox-mpris/a%20b.png").as_deref(), Some("/tmp/firefox-mpris/a b.png"));
        assert_eq!(local_art_path("https://i.scdn.co/image/x"), None);
        assert_eq!(local_art_path("file:///tmp/../etc/shadow"), None);
        assert_eq!(fix_art_url("https://open.spotify.com/image/ab67"), "https://i.scdn.co/image/ab67");
    }

    #[test]
    fn reads_volume_from_pipewire_and_pulseaudio() {
        assert_eq!(parse_wpctl_volume("Volume: 0.40\n"), Some((0.4, false)));
        assert_eq!(parse_wpctl_volume("Volume: 0.25 [MUTED]\n"), Some((0.25, true)));
        assert_eq!(parse_wpctl_volume("nothing"), None);
        let pactl = "Volume: front-left: 26214 /  40% / -23.88 dB,   front-right: 26214 /  40% / -23.88 dB\n        balance 0.00\n";
        assert_eq!(parse_pactl_volume(pactl), Some(0.4));
        assert!(parse_pactl_mute("Mute: yes\n"));
        assert!(!parse_pactl_mute("Mute: no\n"));
        assert!(is_sink_event("Event 'change' on sink #52"));
        assert!(!is_sink_event("Event 'change' on source-output #3"));
    }

    #[test]
    fn battery_from_upower() {
        let d = upower_details(true, 76.6, 2, 5400, 0, true);
        assert_eq!(d.percent, Some(77));
        assert!(!d.charging && !d.plugged_in);
        assert_eq!(d.seconds_left, Some(5400));
        let c = upower_details(true, 40.0, 1, 0, 1800, false);
        assert!(c.charging && c.plugged_in);
        assert_eq!(c.seconds_to_full, Some(1800));
        assert!(upower_details(true, 100.0, 4, 0, 0, false).plugged_in);
        assert!(!upower_details(false, 0.0, 0, 0, 0, false).present);
    }

    #[test]
    fn backlight_levels() {
        assert_eq!(backlight_percent(512, 1024), 50);
        assert_eq!(backlight_percent(5, 0), 0);
        assert_eq!(backlight_value(50, 1024), 512);
        assert_eq!(backlight_value(0, 1024), 10); // never fully dark
        assert_eq!(backlight_value(100, 255), 255);
    }

    #[test]
    fn bluetooth_headsets() {
        let h = bluez_headset("WH-1000XM4", Some("audio-headset"), true, Some(70)).unwrap();
        assert_eq!((h.name.as_str(), h.battery), ("WH-1000XM4", 70));
        assert!(bluez_headset("Mouse", Some("input-mouse"), true, Some(50)).is_none());
        assert!(bluez_headset("Buds", Some("audio-headphones"), false, Some(50)).is_none());
        assert!(bluez_headset("Buds", None, true, None).is_none());
    }

    #[test]
    fn windows_that_cover_the_island() {
        let screen = (0, 0, 1920, 1080);
        assert!(covers_island(&["_NET_WM_STATE_FULLSCREEN"], (0, 0, 1920, 1080), screen, 40));
        assert!(covers_island(&["_NET_WM_STATE_MAXIMIZED_VERT", "_NET_WM_STATE_MAXIMIZED_HORZ"], (0, 32, 1920, 1048), screen, 40));
        assert!(!covers_island(&[], (300, 200, 800, 600), screen, 40));
        // A window on another monitor doesn't count.
        assert!(!covers_island(&["_NET_WM_STATE_MAXIMIZED_VERT", "_NET_WM_STATE_MAXIMIZED_HORZ"], (1920, 0, 1920, 1080), screen, 40));
    }

    #[test]
    fn notification_text_is_one_short_line() {
        let (t, b) = notification_text("Slack", "New message", "<b>Ana</b>: hi\nthere").unwrap();
        assert_eq!(t, "New message");
        assert_eq!(b, "Ana: hi there");
        assert_eq!(notification_text("Mail", " ", "x").unwrap().0, "Mail");
        assert!(notification_text("DynIs", "Hello", "").is_none());
        assert_eq!(notification_text("A", &"x".repeat(200), "").unwrap().0.chars().count(), 80);
    }
}

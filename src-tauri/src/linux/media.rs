//! Now Playing on Linux through MPRIS, the standard D-Bus interface every
//! Linux player offers: Spotify, browsers (Firefox, Chromium, Brave, Chrome,
//! Edge), VLC, Rhythmbox, Lollypop, mpv… The island follows the player that
//! started playing last. Updates come from D-Bus signals (PropertiesChanged,
//! Seeked, players appearing and leaving), not polling.

use crate::linuxparse::{fix_art_url, local_art_path, loop_to_repeat, next_loop_status, pick_player, player_app, PlayerSnapshot, MPRIS_PREFIX};
use crate::types::MediaInfo;
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use zbus::blocking::Connection;
use zbus::zvariant::{OwnedValue, Value};

const PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";

/// The player the island is showing (bus name, track id, loop status).
static ACTIVE: Mutex<Option<(String, Option<String>, Option<String>, Option<bool>)>> = Mutex::new(None);
static ART: Mutex<Option<(String, String)>> = Mutex::new(None); // (file path, data URL)

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn session() -> Option<Connection> {
    static CONN: std::sync::OnceLock<Option<Connection>> = std::sync::OnceLock::new();
    CONN.get_or_init(|| Connection::session().ok()).clone()
}

fn str_of(v: &Value) -> Option<String> {
    match v {
        Value::Str(s) => Some(s.to_string()),
        Value::ObjectPath(p) => Some(p.to_string()),
        Value::Value(inner) => str_of(inner),
        _ => None,
    }
}

fn int_of(v: &Value) -> Option<i64> {
    match v {
        Value::I64(n) => Some(*n),
        Value::U64(n) => Some(*n as i64),
        Value::I32(n) => Some(*n as i64),
        Value::U32(n) => Some(*n as i64),
        Value::F64(n) => Some(*n as i64),
        Value::Value(inner) => int_of(inner),
        _ => None,
    }
}

fn strings_of(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().filter_map(str_of).collect(),
        Value::Value(inner) => strings_of(inner),
        other => str_of(other).into_iter().collect(),
    }
}

fn player_names(conn: &Connection) -> Vec<String> {
    let Ok(proxy) = zbus::blocking::fdo::DBusProxy::new(conn) else { return vec![] };
    proxy
        .list_names()
        .map(|names| names.into_iter().map(|n| n.to_string()).filter(|n| n.starts_with(MPRIS_PREFIX)).collect())
        .unwrap_or_default()
}

fn snapshot(conn: &Connection, bus: &str) -> Option<PlayerSnapshot> {
    let props = zbus::blocking::fdo::PropertiesProxy::builder(conn).destination(bus.to_string()).ok()?.path(PATH).ok()?.build().ok()?;
    let iface = zbus::names::InterfaceName::try_from(PLAYER_IFACE).ok()?;
    let all: HashMap<String, OwnedValue> = props.get_all(iface).ok()?;
    let get = |k: &str| all.get(k).map(|v| &**v);
    let mut s = PlayerSnapshot {
        bus: bus.to_string(),
        status: get("PlaybackStatus").and_then(str_of).unwrap_or_default(),
        position_us: get("Position").and_then(int_of),
        shuffle: match get("Shuffle") {
            Some(Value::Bool(b)) => Some(*b),
            _ => None,
        },
        loop_status: get("LoopStatus").and_then(str_of),
        can_seek: matches!(get("CanSeek"), Some(Value::Bool(true))),
        ..Default::default()
    };
    // Metadata is a{sv}: a map from field name to a variant.
    let meta: HashMap<String, OwnedValue> = all
        .get("Metadata")
        .and_then(|v| v.try_clone().ok())
        .and_then(|v| HashMap::<String, OwnedValue>::try_from(v).ok())
        .unwrap_or_default();
    let field = |k: &str| meta.get(k).map(|v| &**v);
    s.title = field("xesam:title").and_then(str_of).unwrap_or_default();
    s.artists = field("xesam:artist").map(strings_of).unwrap_or_default();
    s.art_url = field("mpris:artUrl").and_then(str_of).filter(|u| !u.is_empty());
    s.length_us = field("mpris:length").and_then(int_of);
    s.track_id = field("mpris:trackid").and_then(str_of);
    Some(s)
}

/// http(s) art as is (Spotify); local files (browsers, VLC) as a data URL,
/// read once per file and at most 1 MB.
fn art_for(url: &str) -> Option<String> {
    if url.starts_with("https://") {
        return Some(fix_art_url(url));
    }
    let path = local_art_path(url)?;
    if let Some((p, data)) = ART.lock().ok()?.as_ref() {
        if *p == path {
            return Some(data.clone());
        }
    }
    let bytes = std::fs::read(&path).ok().filter(|b| b.len() <= 1024 * 1024)?;
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/jpeg" };
    use base64::Engine;
    let data = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes));
    *ART.lock().ok()? = Some((path, data.clone()));
    Some(data)
}

fn to_info(s: &PlayerSnapshot) -> MediaInfo {
    MediaInfo {
        title: s.title.clone(),
        artist: s.artists.join(", "),
        is_playing: s.playing(),
        has_media: true,
        artwork: s.art_url.as_deref().and_then(art_for).map(|a| vec![a]),
        position_ms: s.position_us.unwrap_or(0) / 1000,
        duration_ms: s.length_us.unwrap_or(0) / 1000,
        seek_enabled: s.can_seek && s.track_id.is_some(),
        position_updated_at: now_ms(),
        shuffle: s.shuffle,
        repeat: loop_to_repeat(s.loop_status.as_deref()),
        source_app: player_app(&s.bus),
    }
}

fn empty() -> MediaInfo {
    MediaInfo {
        title: String::new(),
        artist: String::new(),
        is_playing: false,
        has_media: false,
        artwork: None,
        position_ms: 0,
        duration_ms: 0,
        seek_enabled: false,
        position_updated_at: now_ms(),
        shuffle: None,
        repeat: None,
        source_app: String::new(),
    }
}

/// Wakes the media loop on every MPRIS signal and when players come or go.
fn spawn_signal_listener(conn: Connection, tx: mpsc::Sender<()>) {
    let rules = [
        zbus::MatchRule::builder().msg_type(zbus::message::Type::Signal).path(PATH).map(|r| r.build()),
        zbus::MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface("org.freedesktop.DBus")
            .and_then(|r| r.member("NameOwnerChanged"))
            .map(|r| r.build()),
    ];
    for rule in rules.into_iter().flatten() {
        let conn = conn.clone();
        let tx = tx.clone();
        std::thread::spawn(move || {
            let Ok(iter) = zbus::blocking::MessageIterator::for_match_rule(rule, &conn, Some(64)) else { return };
            for _ in iter {
                if tx.send(()).is_err() {
                    return;
                }
            }
        });
    }
}

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-media".into())
        .spawn(move || {
            let Some(conn) = session() else { return };
            let (tx, rx) = mpsc::channel();
            spawn_signal_listener(conn.clone(), tx);
            let mut started: HashMap<String, u64> = HashMap::new();
            let mut was_playing: HashMap<String, bool> = HashMap::new();
            let mut last_key = String::new();
            let mut last_pos: Option<(u64, i64)> = None;
            loop {
                let players: Vec<PlayerSnapshot> = player_names(&conn).iter().filter_map(|b| snapshot(&conn, b)).collect();
                for p in &players {
                    let before = was_playing.insert(p.bus.clone(), p.playing()).unwrap_or(false);
                    if p.playing() && !before {
                        started.insert(p.bus.clone(), now_ms());
                    }
                }
                let chosen = pick_player(&players, &started).map(|i| &players[i]);
                if let Ok(mut a) = ACTIVE.lock() {
                    *a = chosen.map(|p| (p.bus.clone(), p.track_id.clone(), p.loop_status.clone(), p.shuffle));
                }
                let info = chosen.map(to_info).unwrap_or_else(empty);
                // Re-send on any change, or when the position moved > 2 s from
                // where the island predicts it (a seek).
                let key = format!(
                    "{}|{}|{}|{}|{:?}|{:?}|{}|{}",
                    info.title, info.artist, info.is_playing, info.has_media, info.shuffle, info.repeat, info.source_app, info.duration_ms
                );
                let drifted = last_pos.is_some_and(|(at, pos)| {
                    let predicted = pos + if info.is_playing { now_ms().saturating_sub(at) as i64 } else { 0 };
                    (predicted - info.position_ms).abs() > 2000
                });
                if key != last_key || drifted {
                    last_key = key;
                    last_pos = Some((info.position_updated_at, info.position_ms));
                    let _ = app.emit("media-update", &info);
                }
                // Wait for the next signal; a slow check while playing keeps
                // players that don't signal seeks honest.
                let wait = if info.is_playing { Duration::from_secs(5) } else { Duration::from_secs(60) };
                if rx.recv_timeout(wait).is_ok() {
                    // Players send bursts (status, then metadata): settle first.
                    std::thread::sleep(Duration::from_millis(120));
                    while rx.try_recv().is_ok() {}
                }
            }
        })
        .ok();
}

fn call(member: &str, body: &(impl serde::Serialize + zbus::zvariant::DynamicType)) {
    let Some(bus) = ACTIVE.lock().ok().and_then(|a| a.as_ref().map(|a| a.0.clone())) else { return };
    let Some(conn) = session() else { return };
    let _ = conn.call_method(Some(bus.as_str()), PATH, Some(PLAYER_IFACE), member, body);
}

fn set_prop(name: &str, value: Value<'_>) {
    let Some(bus) = ACTIVE.lock().ok().and_then(|a| a.as_ref().map(|a| a.0.clone())) else { return };
    let Some(conn) = session() else { return };
    let _ = conn.call_method(
        Some(bus.as_str()),
        PATH,
        Some("org.freedesktop.DBus.Properties"),
        "Set",
        &(PLAYER_IFACE, name, value),
    );
}

#[tauri::command]
pub fn media_play_pause() {
    call("PlayPause", &());
}

#[tauri::command]
pub fn media_next() {
    call("Next", &());
}

#[tauri::command]
pub fn media_previous() {
    call("Previous", &());
}

#[tauri::command]
pub fn media_seek(position_ms: f64) {
    let Some(track) = ACTIVE.lock().ok().and_then(|a| a.as_ref().and_then(|a| a.1.clone())) else { return };
    let Ok(path) = zbus::zvariant::ObjectPath::try_from(track.as_str()) else { return };
    call("SetPosition", &(path, (position_ms.max(0.0) * 1000.0) as i64));
}

#[tauri::command]
pub fn media_toggle_shuffle() {
    let current = ACTIVE.lock().ok().and_then(|a| a.as_ref().and_then(|a| a.3));
    if let Some(on) = current {
        set_prop("Shuffle", Value::Bool(!on));
    }
}

#[tauri::command]
pub fn media_cycle_repeat() {
    let current = ACTIVE.lock().ok().and_then(|a| a.as_ref().and_then(|a| a.2.clone()));
    if current.is_some() {
        set_prop("LoopStatus", Value::from(next_loop_status(current.as_deref())));
    }
}

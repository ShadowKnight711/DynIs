//! Now Playing on macOS for Apple Music and Spotify, through AppleScript.
//!
//! macOS 15.4 closed the private MediaRemote "now playing" API to third-party
//! apps, so DynIs asks the two players directly. A player is only queried
//! while its process is running (asking launches it otherwise). The first
//! time, macOS asks "DynIs wants to control Music/Spotify" (Automation).
//! Other players (browsers, Podcasts…) aren't covered on macOS.

use crate::macparse::{parse_player_line, PlayerState};
use crate::types::MediaInfo;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Player {
    Spotify,
    Music,
}

impl Player {
    fn app(self) -> &'static str {
        match self {
            Player::Spotify => "Spotify",
            Player::Music => "Music",
        }
    }
}

/// The player the island is showing (for the controls).
static ACTIVE: Mutex<Option<Player>> = Mutex::new(None);
static ART: Mutex<Option<(String, String)>> = Mutex::new(None); // (track id, data URL)

fn running(app: &str) -> bool {
    std::process::Command::new("/usr/bin/pgrep")
        .args(["-xq", app])
        .status()
        .is_ok_and(|s| s.success())
}

const SPOTIFY_SCRIPT: &str = r#"tell application "Spotify"
if player state is stopped then return "stopped"
set t to current track
return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & ((duration of t) / 1000) & tab & (player position) & tab & (shuffling as text) & tab & (repeating as text) & tab & (artwork url of t) & tab & (id of t)
end tell"#;

const MUSIC_SCRIPT: &str = r#"tell application "Music"
if player state is stopped then return "stopped"
set t to current track
set r to song repeat as text
return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & (duration of t) & tab & (player position) & tab & (shuffle enabled as text) & tab & r & tab & "" & tab & (persistent ID of t)
end tell"#;

fn query(player: Player) -> Option<PlayerState> {
    if !running(player.app()) {
        return None;
    }
    let script = match player {
        Player::Spotify => SPOTIFY_SCRIPT,
        Player::Music => MUSIC_SCRIPT,
    };
    let out = super::osascript(script).ok()?;
    parse_player_line(&out, player == Player::Spotify)
}

/// Music's artwork is raw image data: write it to a temp file once per track
/// and send it as a data URL.
fn music_artwork(track_id: &str) -> Option<String> {
    if let Some((id, url)) = ART.lock().ok()?.as_ref() {
        if id == track_id {
            return Some(url.clone());
        }
    }
    let file = std::env::temp_dir().join("dynis-music-art");
    let script = format!(
        r#"tell application "Music" to set d to raw data of artwork 1 of current track
set f to open for access (POSIX file "{}") with write permission
set eof f to 0
write d to f
close access f
return "ok""#,
        file.to_string_lossy()
    );
    super::osascript(&script).ok()?;
    let bytes = std::fs::read(&file).ok()?;
    let _ = std::fs::remove_file(&file);
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/jpeg" };
    use base64::Engine;
    let url = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes));
    *ART.lock().ok()? = Some((track_id.to_string(), url.clone()));
    Some(url)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn to_info(player: Player, s: &PlayerState) -> MediaInfo {
    let artwork = match player {
        Player::Spotify => (!s.artwork_url.is_empty()).then(|| vec![s.artwork_url.clone()]),
        Player::Music => music_artwork(&s.track_id).map(|u| vec![u]),
    };
    MediaInfo {
        title: s.title.clone(),
        artist: s.artist.clone(),
        is_playing: s.playing,
        has_media: true,
        artwork,
        position_ms: (s.position_s * 1000.0) as i64,
        duration_ms: (s.duration_s * 1000.0) as i64,
        seek_enabled: true,
        position_updated_at: now_ms(),
        shuffle: Some(s.shuffle),
        repeat: Some(s.repeat.clone()),
        source_app: match player {
            Player::Spotify => "Spotify".into(),
            Player::Music => "Music".into(),
        },
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

/// Polls the players (1 s while playing, 3 s otherwise) and emits
/// `media-update` when something changed. Playing beats paused; Spotify is
/// checked first.
pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-media".into())
        .spawn(move || {
            let mut last_key = String::new();
            let mut last_pos_check: Option<(u64, i64)> = None; // (sent at, position)
            loop {
                let mut best: Option<(Player, PlayerState)> = None;
                for p in [Player::Spotify, Player::Music] {
                    if let Some(s) = query(p) {
                        let better = match &best {
                            None => true,
                            Some((_, b)) => s.playing && !b.playing,
                        };
                        if better {
                            best = Some((p, s));
                        }
                    }
                }
                if let Ok(mut a) = ACTIVE.lock() {
                    *a = best.as_ref().map(|(p, _)| *p);
                }
                let playing = best.as_ref().is_some_and(|(_, s)| s.playing);
                let info = match &best {
                    Some((p, s)) => to_info(*p, s),
                    None => empty(),
                };
                // Re-send on any change, or when the position drifts > 2 s
                // from where the island predicts it (a seek).
                let key = format!("{}|{}|{}|{}|{:?}|{:?}", info.title, info.artist, info.is_playing, info.has_media, info.shuffle, info.repeat);
                let drifted = last_pos_check.is_some_and(|(at, pos)| {
                    let predicted = pos + if info.is_playing { (now_ms() - at) as i64 } else { 0 };
                    (predicted - info.position_ms).abs() > 2000
                });
                if key != last_key || drifted {
                    last_key = key;
                    last_pos_check = Some((info.position_updated_at, info.position_ms));
                    let _ = app.emit("media-update", &info);
                }
                std::thread::sleep(Duration::from_millis(if playing { 1000 } else { 3000 }));
            }
        })
        .ok();
}

fn active() -> Option<Player> {
    ACTIVE.lock().ok().and_then(|a| *a)
}

fn tell(cmd: &str) {
    if let Some(p) = active() {
        let _ = super::osascript_spawn(&format!("tell application \"{}\" to {cmd}", p.app()));
    }
}

#[tauri::command]
pub fn media_play_pause() {
    tell("playpause");
}

#[tauri::command]
pub fn media_next() {
    tell("next track");
}

#[tauri::command]
pub fn media_previous() {
    tell("previous track");
}

#[tauri::command]
pub fn media_seek(position_ms: f64) {
    tell(&format!("set player position to {}", (position_ms / 1000.0).max(0.0)));
}

#[tauri::command]
pub fn media_toggle_shuffle() {
    match active() {
        Some(Player::Spotify) => tell("set shuffling to not shuffling"),
        Some(Player::Music) => tell("set shuffle enabled to not shuffle enabled"),
        None => {}
    }
}

#[tauri::command]
pub fn media_cycle_repeat() {
    match active() {
        Some(Player::Spotify) => tell("set repeating to not repeating"),
        Some(Player::Music) => {
            let _ = super::osascript_spawn(
                "tell application \"Music\"\nif song repeat is off then\nset song repeat to all\nelse if song repeat is all then\nset song repeat to one\nelse\nset song repeat to off\nend if\nend tell",
            );
        }
        None => {}
    }
}

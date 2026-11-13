//! Browser bridge for the "DynIs Downloads & Media" extension
//! (extension/dynis-downloads): browser downloads and, since 2.1, the media
//! playing in browser tabs (now playing, up next, and the island's controls).
//!
//! Chromium browsers (Brave, Chrome, Edge) start `DynIs.exe` as a *native
//! messaging host* and talk to it over stdin/stdout: each message is a
//! 4-byte little-endian length followed by JSON. In that mode DynIs does not
//! start its UI; it only writes the latest download state to
//! `%LOCALAPPDATA%\com.kevin.dynis\browser-downloads.json`, which the running
//! app's downloads module reads. Only the pinned extension ID is accepted.
//!
//! Web media: the host writes the active tab's now playing and up next to
//! `browser-media.json` (read by `crate::browser_media` in the app), and
//! relays the island's commands and the per-site settings, which the app
//! writes to `browser-media-command.json`, back to the extension.
//!
//! Registration: the app writes a host manifest and one per-user registry
//! key per browser (HKCU\Software\…\NativeMessagingHosts\com.kevin.dynis) on
//! start; the uninstaller removes them. On macOS the manifests go in each
//! browser's `~/Library/Application Support/…/NativeMessagingHosts` folder
//! instead (see the macOS section at the end of this file).

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::PathBuf;

pub const HOST_NAME: &str = "com.kevin.dynis";
pub const EXTENSION_ID: &str = "folieobmpnijgjlbildfpaikmlhiegfb";
/// The Firefox build of the extension (browser_specific_settings.gecko.id).
pub const FIREFOX_ID: &str = "downloads@dynis.kevin";
/// Firefox looks up native hosts here (per user).
#[cfg_attr(not(windows), allow(dead_code))]
pub const FIREFOX_KEY: &str = "Software\\Mozilla\\NativeMessagingHosts\\com.kevin.dynis";

/// Registry paths (under HKCU) where each browser looks for hosts.
#[cfg_attr(not(windows), allow(dead_code))]
pub const BROWSER_KEYS: [&str; 3] = [
    "Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.kevin.dynis",
    "Software\\Google\\Chrome\\NativeMessagingHosts\\com.kevin.dynis",
    "Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.kevin.dynis",
];

#[cfg(windows)]
fn data_dir() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("com.kevin.dynis"))
}

pub fn state_path() -> Option<PathBuf> {
    Some(data_dir()?.join("browser-downloads.json"))
}

/// Web media from the extension: written by the host, read by the app.
pub fn media_path() -> Option<PathBuf> {
    Some(data_dir()?.join("browser-media.json"))
}

/// Commands and the per-site settings: written by the app, read by the host.
pub fn command_path() -> Option<PathBuf> {
    Some(data_dir()?.join("browser-media-command.json"))
}

/// True when the browser started us as a host (it passes the caller origin).
/// Chromium passes the caller origin; Firefox passes the manifest path and
/// the add-on ID.
pub fn is_host_invocation(args: &[String]) -> bool {
    args.iter().any(|a| a.starts_with("chrome-extension://") || a == FIREFOX_ID)
}

/// The origin is accepted only for the pinned extension.
pub fn origin_allowed(args: &[String]) -> bool {
    let expected = format!("chrome-extension://{EXTENSION_ID}/");
    args.iter().any(|a| a == &expected || a == FIREFOX_ID)
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct BrowserDownload {
    pub id: String,
    pub name: String,
    pub received: u64,
    pub total: Option<u64>,
    #[serde(default)]
    pub speed: u64,
    #[serde(default)]
    pub paused: bool,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Finished {
    pub id: String,
    pub name: String,
    pub state: String,
    pub path: Option<String>,
    #[serde(default)]
    pub at: i64,
}

/// What the host writes and the app reads.
#[derive(Deserialize, Serialize, Clone, Debug, Default, PartialEq)]
pub struct BrowserState {
    pub updated: i64,
    pub downloads: Vec<BrowserDownload>,
    pub finished: Vec<Finished>,
}

/// One row of a web player's up next list. `index` is the row's place on
/// the page, used to jump to it.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub art: Option<String>,
    #[serde(default)]
    pub index: u32,
}

/// What a browser tab is playing (see extension/dynis-downloads/media-core.js).
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebMedia {
    pub site: String,
    #[serde(default)]
    pub source: String,
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub art: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub position_ms: Option<u64>,
    #[serde(default)]
    pub position_at: i64,
    #[serde(default)]
    pub playing: bool,
    #[serde(default)]
    pub can_next: bool,
    #[serde(default)]
    pub can_prev: bool,
    #[serde(default)]
    pub can_seek: bool,
    /// "queue" (a real queue or playlist), "upnext" (suggestions) or "none".
    #[serde(default)]
    pub queue_kind: String,
    #[serde(default)]
    pub queue: Vec<QueueItem>,
}

/// What the host writes to `browser-media.json`.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub updated: i64,
    /// False once the browser closed the connection.
    pub connected: bool,
    pub browser: String,
    pub media: Option<WebMedia>,
}

/// What the app writes to `browser-media-command.json`.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Default)]
pub struct CommandFile {
    /// Increases with every command.
    pub seq: u64,
    /// When the command was written (ms); stale ones are dropped.
    #[serde(default)]
    pub at: i64,
    /// `{"type":"command","action":…}`, passed to the extension as is.
    #[serde(default)]
    pub command: Option<serde_json::Value>,
    /// Which sites may report: `{"youtube":true,…}`.
    #[serde(default)]
    pub sites: Option<serde_json::Map<String, serde_json::Value>>,
}

pub const WEB_SITES: [&str; 6] = ["youtube", "ytmusic", "spotify", "applemusic", "soundcloud", "generic"];

/// Whether `site` may report, by the per-site settings (all on except
/// "generic" when unset). Mirrors `isSiteEnabled` in media-core.js.
pub fn site_enabled(sites: Option<&serde_json::Map<String, serde_json::Value>>, site: &str) -> bool {
    match sites.and_then(|s| s.get(site)).and_then(|v| v.as_bool()) {
        Some(on) => on,
        None => WEB_SITES.contains(&site) && site != "generic",
    }
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max - 1).chain(std::iter::once('…')).collect()
    }
}

fn https_only(url: Option<String>) -> Option<String> {
    url.filter(|u| u.starts_with("https://") && u.len() <= 1000 && !u.contains(['"', '<', '>', ' ']))
}

/// Bounds what a page can hand the app: short text, https images, at most
/// 10 queue rows, a known site.
pub fn sanitize_media(media: WebMedia) -> Option<WebMedia> {
    if !WEB_SITES.contains(&media.site.as_str()) || media.title.trim().is_empty() {
        return None;
    }
    let queue: Vec<QueueItem> = media
        .queue
        .iter()
        .filter(|q| !q.title.trim().is_empty())
        .take(10)
        .map(|q| QueueItem {
            title: clip(q.title.trim(), 160),
            artist: clip(q.artist.trim(), 120),
            art: https_only(q.art.clone()),
            index: q.index.min(500),
        })
        .collect();
    let queue_kind = match media.queue_kind.as_str() {
        "queue" | "upnext" if !queue.is_empty() => media.queue_kind.clone(),
        _ => "none".to_string(),
    };
    Some(WebMedia {
        source: clip(media.source.trim(), 40),
        title: clip(media.title.trim(), 200),
        artist: clip(media.artist.trim(), 120),
        art: https_only(media.art.clone()),
        queue_kind,
        queue,
        ..media
    })
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Message {
    Downloads { downloads: Vec<BrowserDownload> },
    Finished { id: String, name: String, state: String, path: Option<String> },
    Media {
        #[serde(default)]
        browser: String,
        #[serde(default)]
        media: Option<WebMedia>,
    },
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Reads one native-messaging frame. None on EOF or a malformed frame.
pub fn read_frame(input: &mut impl Read) -> Option<Vec<u8>> {
    let mut len = [0u8; 4];
    input.read_exact(&mut len).ok()?;
    let len = u32::from_le_bytes(len) as usize;
    // Chrome caps host-bound messages at 64 MiB; ours are tiny.
    if len == 0 || len > 1024 * 1024 {
        return None;
    }
    let mut buf = vec![0u8; len];
    input.read_exact(&mut buf).ok()?;
    Some(buf)
}

/// One native-messaging frame: 4-byte little-endian length, then JSON.
pub fn encode_frame(value: &serde_json::Value) -> Vec<u8> {
    let body = serde_json::to_vec(value).unwrap_or_default();
    let mut out = (body.len() as u32).to_le_bytes().to_vec();
    out.extend_from_slice(&body);
    out
}

pub fn write_json_atomic(path: &std::path::Path, value: &impl Serialize) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    if let Ok(json) = serde_json::to_vec(value) {
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

fn write_media(state: &MediaState) {
    if let Some(path) = media_path() {
        write_json_atomic(&path, state);
    }
}

pub fn read_command_file() -> Option<CommandFile> {
    serde_json::from_slice(&std::fs::read(command_path()?).ok()?).ok()
}

/// What the relay sends the extension for a new command file, given what it
/// sent last. Updates `last_seq` and `last_sites`.
pub fn relay_frames(
    file: &CommandFile,
    now: i64,
    last_seq: &mut u64,
    last_sites: &mut Option<serde_json::Map<String, serde_json::Value>>,
) -> Vec<serde_json::Value> {
    let mut frames = Vec::new();
    if file.sites.is_some() && file.sites != *last_sites {
        last_sites.clone_from(&file.sites);
        frames.push(serde_json::json!({ "type": "config", "sites": file.sites }));
    }
    if file.seq > *last_seq {
        *last_seq = file.seq;
        if let Some(cmd) = &file.command {
            // A command the island sent while no browser was listening is stale.
            if now - file.at <= 5_000 && cmd.get("type").and_then(|t| t.as_str()) == Some("command") {
                frames.push(cmd.clone());
            }
        }
    }
    frames
}

type SharedSites = std::sync::Arc<std::sync::Mutex<Option<serde_json::Map<String, serde_json::Value>>>>;

/// Sends the island's commands and the per-site settings to the extension
/// while the browser keeps the host open. Checks the command file's time
/// stamp every 200 ms (a file stat); the browser ends the process on exit.
fn spawn_command_relay(sites: SharedSites) {
    std::thread::spawn(move || {
        let path = command_path();
        let mut last_modified = None;
        // Commands written before this browser connected are not replayed.
        let mut last_seq = read_command_file().map(|f| f.seq).unwrap_or(0);
        let mut last_sites = None;
        loop {
            let modified = path
                .as_ref()
                .and_then(|p| std::fs::metadata(p).ok())
                .and_then(|m| m.modified().ok());
            if modified.is_some() && modified != last_modified {
                last_modified = modified;
                if let Some(file) = read_command_file() {
                    let frames = relay_frames(&file, now_ms(), &mut last_seq, &mut last_sites);
                    if let Ok(mut s) = sites.lock() {
                        s.clone_from(&last_sites);
                    }
                    let mut out = std::io::stdout().lock();
                    for frame in frames {
                        if out.write_all(&encode_frame(&frame)).is_err() || out.flush().is_err() {
                            return;
                        }
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    });
}

fn write_state(state: &BrowserState) {
    let Some(path) = state_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    if let Ok(json) = serde_json::to_vec(state) {
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
}

/// Host mode main loop. Returns when the browser closes the pipe.
pub fn run_host(args: &[String]) {
    if !origin_allowed(args) {
        return;
    }
    let mut stdin = std::io::stdin().lock();
    let mut state = BrowserState::default();
    let sites: SharedSites = std::sync::Arc::new(std::sync::Mutex::new(read_command_file().and_then(|f| f.sites)));
    spawn_command_relay(sites.clone());
    let mut media = MediaState::default();
    while let Some(frame) = read_frame(&mut stdin) {
        let Ok(message) = serde_json::from_slice::<Message>(&frame) else { continue };
        let now = now_ms();
        if let Message::Media { browser, media: m } = message {
            let allowed = sites.lock().ok().and_then(|s| s.clone());
            media = MediaState {
                updated: now,
                connected: true,
                browser: clip(browser.trim(), 40),
                // A site turned off in DynIs never reaches the app.
                media: m.and_then(sanitize_media).filter(|m| site_enabled(allowed.as_ref(), &m.site)),
            };
            write_media(&media);
            continue;
        }
        match message {
            Message::Downloads { downloads } => state.downloads = downloads,
            Message::Finished { id, name, state: s, path } => {
                state.downloads.retain(|d| d.id != id);
                state.finished.push(Finished { id, name, state: s, path, at: now });
                // Keep only recent finishes.
                state.finished.retain(|f| now - f.at < 30_000);
            }
            Message::Media { .. } => {}
        }
        state.updated = now;
        write_state(&state);
    }
    // Browser gone: no tab is playing any more.
    if media.connected {
        write_media(&MediaState { updated: now_ms(), connected: false, browser: media.browser, media: None });
    }
    // Browser gone: clear in-progress downloads.
    state.downloads.clear();
    state.updated = now_ms();
    write_state(&state);
    let _ = std::io::stdout().flush();
}

fn manifest_json(exe: &str) -> String {
    serde_json::json!({
        "name": HOST_NAME,
        "description": "DynIs island: browser downloads",
        "path": exe,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")]
    })
    .to_string()
}

/// Firefox's host manifest names allowed add-on IDs instead of origins.
fn firefox_manifest_json(exe: &str) -> String {
    serde_json::json!({
        "name": HOST_NAME,
        "description": "DynIs island: browser downloads",
        "path": exe,
        "type": "stdio",
        "allowed_extensions": [FIREFOX_ID]
    })
    .to_string()
}

fn write_if_changed(path: &std::path::Path, content: &str) -> bool {
    std::fs::read_to_string(path).ok().as_deref() == Some(content) || std::fs::write(path, content).is_ok()
}

#[cfg(windows)]
fn set_default_value(subkey: &str, value: &str) -> windows::core::Result<()> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    unsafe {
        let mut key = HKEY::default();
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(subkey),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
        .ok()?;
        let wide: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        let bytes = std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2);
        let result = RegSetValueExW(key, PCWSTR::null(), None, REG_SZ, Some(bytes)).ok();
        let _ = RegCloseKey(key);
        result
    }
}

#[cfg(windows)]
/// Writes the host manifest and the per-browser registry keys (per user, no
/// admin). Idempotent; refreshes the exe path if DynIs moved.
pub fn register() {
    let (Some(dir), Ok(exe)) = (data_dir(), std::env::current_exe()) else { return };
    let _ = std::fs::create_dir_all(&dir);
    let exe = exe.to_string_lossy();
    let manifest = dir.join("native-host.json");
    if write_if_changed(&manifest, &manifest_json(&exe)) {
        let manifest_path = manifest.to_string_lossy().to_string();
        for key in BROWSER_KEYS {
            let _ = set_default_value(key, &manifest_path);
        }
    }
    let firefox = dir.join("native-host-firefox.json");
    if write_if_changed(&firefox, &firefox_manifest_json(&exe)) {
        let _ = set_default_value(FIREFOX_KEY, &firefox.to_string_lossy());
    }
}

#[cfg(windows)]
/// Which supported browsers are installed (App Paths, per user or machine).
#[tauri::command]
pub fn detect_browsers() -> Vec<String> {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ,
    };
    let has = |exe: &str| {
        let sub = HSTRING::from(format!("Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{exe}"));
        [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE].into_iter().any(|root| unsafe {
            let mut key = HKEY::default();
            let ok = RegOpenKeyExW(root, &sub, None, KEY_READ, &mut key).is_ok();
            if ok {
                let _ = RegCloseKey(key);
            }
            ok
        })
    };
    [("Brave", "brave.exe"), ("Chrome", "chrome.exe"), ("Edge", "msedge.exe"), ("Firefox", "firefox.exe")]
        .into_iter()
        .filter(|(_, exe)| has(exe))
        .map(|(name, _)| name.to_string())
        .collect()
}

#[cfg(windows)]
/// Opens Firefox's temporary add-on page and the folder with the extension.
#[tauri::command]
pub fn open_firefox_extension_install(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?.join("extension-firefox");
    if !dir.join("manifest.json").exists() {
        return Err("The Firefox extension folder is missing. Reinstall DynIs to restore it.".into());
    }
    let folder = dir.to_string_lossy().to_string();
    let folder = folder.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(folder);
    let launch = |file: &str, args: &str| unsafe {
        use windows::core::{HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let r = ShellExecuteW(None, windows::core::w!("open"), &HSTRING::from(file), &HSTRING::from(args), PCWSTR::null(), SW_SHOWNORMAL);
        r.0 as isize > 32
    };
    launch("explorer.exe", &format!("\"{folder}\""));
    if launch("firefox.exe", "about:debugging#/runtime/this-firefox") {
        Ok(folder)
    } else {
        Err("Firefox wasn't found on this PC.".into())
    }
}

/// Where the installer put the extension folder.
#[tauri::command]
pub fn extension_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri::Manager;
    let dir = app.path().resource_dir().ok()?.join("extension");
    let path = dir.to_string_lossy().to_string();
    let path = path.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(path);
    dir.join("manifest.json").exists().then_some(path)
}

/// Whether the extension has ever reached DynIs (a download or, since 2.1,
/// a song or video).
#[tauri::command]
pub fn extension_connected() -> bool {
    state_path().is_some_and(|p| p.exists()) || media_path().is_some_and(|p| p.exists())
}

#[cfg(windows)]
/// Opens the extension folder in Explorer and the browser's extensions page
/// (Brave, else Chrome, else Edge).
#[tauri::command]
pub fn open_extension_install(app: tauri::AppHandle) -> Result<String, String> {
    let folder = extension_folder(app).ok_or("The extension folder is missing. Reinstall DynIs to restore it.")?;
    let launch = |file: &str, args: &str| unsafe {
        use windows::core::{HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let r = ShellExecuteW(None, windows::core::w!("open"), &HSTRING::from(file), &HSTRING::from(args), PCWSTR::null(), SW_SHOWNORMAL);
        r.0 as isize > 32
    };
    launch("explorer.exe", &format!("\"{folder}\""));
    for (exe, url) in [("brave.exe", "brave://extensions"), ("chrome.exe", "chrome://extensions"), ("msedge.exe", "edge://extensions")] {
        if launch(exe, url) {
            return Ok(exe.into());
        }
    }
    Err("Brave, Chrome or Edge wasn't found on this PC.".into())
}

// ── macOS ──

/// ~/Library/Application Support/com.kevin.dynis
#[cfg(target_os = "macos")]
fn data_dir() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support/com.kevin.dynis"))
}

/// Where each browser looks for native hosts on macOS (per user), relative
/// to ~/Library/Application Support. Firefox gets its own manifest.
#[cfg(target_os = "macos")]
pub const MAC_HOST_DIRS: [&str; 4] = [
    "BraveSoftware/Brave-Browser/NativeMessagingHosts",
    "Google/Chrome/NativeMessagingHosts",
    "Microsoft Edge/NativeMessagingHosts",
    "Mozilla/NativeMessagingHosts",
];

/// Writes `com.kevin.dynis.json` into each browser's host folder. Idempotent.
#[cfg(target_os = "macos")]
pub fn register() {
    let (Some(home), Ok(exe)) = (std::env::var_os("HOME"), std::env::current_exe()) else { return };
    let base = PathBuf::from(home).join("Library/Application Support");
    let exe = exe.to_string_lossy();
    for dir in MAC_HOST_DIRS {
        let firefox = dir.starts_with("Mozilla");
        // Only browsers that are installed have their support folder.
        let browser_root = base.join(dir.split('/').next().unwrap_or(dir));
        if !browser_root.exists() {
            continue;
        }
        let folder = base.join(dir);
        let _ = std::fs::create_dir_all(&folder);
        let content = if firefox { firefox_manifest_json(&exe) } else { manifest_json(&exe) };
        let _ = write_if_changed(&folder.join(format!("{HOST_NAME}.json")), &content);
    }
}

#[cfg(target_os = "macos")]
const MAC_BROWSERS: [(&str, &str); 4] = [
    ("Brave", "Brave Browser"),
    ("Chrome", "Google Chrome"),
    ("Edge", "Microsoft Edge"),
    ("Firefox", "Firefox"),
];

#[cfg(target_os = "macos")]
fn mac_app_installed(app: &str) -> bool {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    [PathBuf::from("/Applications"), home.join("Applications")]
        .iter()
        .any(|d| d.join(format!("{app}.app")).exists())
}

/// Which supported browsers are installed (/Applications or ~/Applications).
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn detect_browsers() -> Vec<String> {
    MAC_BROWSERS
        .iter()
        .filter(|(_, app)| mac_app_installed(app))
        .map(|(name, _)| name.to_string())
        .collect()
}

#[cfg(target_os = "macos")]
fn mac_open(args: &[&str]) -> bool {
    std::process::Command::new("/usr/bin/open").args(args).status().is_ok_and(|s| s.success())
}

/// Opens the extension folder in Finder and the browser's extensions page
/// (Brave, else Chrome, else Edge). Returns the same names as on Windows.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_extension_install(app: tauri::AppHandle) -> Result<String, String> {
    let folder = extension_folder(app).ok_or("The extension folder is missing. Reinstall DynIs to restore it.")?;
    mac_open(&[&folder]);
    for (token, app, url) in [
        ("brave.exe", "Brave Browser", "brave://extensions"),
        ("chrome.exe", "Google Chrome", "chrome://extensions"),
        ("msedge.exe", "Microsoft Edge", "edge://extensions"),
    ] {
        if mac_app_installed(app) && mac_open(&["-a", app, url]) {
            return Ok(token.into());
        }
    }
    Err("Brave, Chrome or Edge wasn't found on this Mac.".into())
}

/// Opens Firefox's temporary add-on page and the folder with the extension.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_firefox_extension_install(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?.join("extension-firefox");
    if !dir.join("manifest.json").exists() {
        return Err("The Firefox extension folder is missing. Reinstall DynIs to restore it.".into());
    }
    let folder = dir.to_string_lossy().to_string();
    mac_open(&[&folder]);
    if mac_app_installed("Firefox") && mac_open(&["-a", "Firefox", "about:debugging#/runtime/this-firefox"]) {
        Ok(folder)
    } else {
        Err("Firefox wasn't found on this Mac.".into())
    }
}

// ── Linux ──

/// $XDG_DATA_HOME/com.kevin.dynis (~/.local/share/com.kevin.dynis).
#[cfg(target_os = "linux")]
pub fn linux_data_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| Some(PathBuf::from(std::env::var_os("HOME")?).join(".local/share")))?;
    Some(base.join("com.kevin.dynis"))
}

#[cfg(target_os = "linux")]
fn data_dir() -> Option<PathBuf> {
    linux_data_dir()
}

/// The program browsers start as the host. An AppImage runs from a new
/// temporary mount each time, so its own file ($APPIMAGE) is registered.
#[cfg(target_os = "linux")]
fn linux_host_exe() -> Option<String> {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return Some(PathBuf::from(appimage).to_string_lossy().into_owned());
    }
    std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned())
}

/// Writes `com.kevin.dynis.json` into each installed browser's host folder
/// (~/.config/…/NativeMessagingHosts, ~/.mozilla/native-messaging-hosts).
/// Snap and Flatpak browsers are sandboxed and can't start it; see
/// LINUX-BUILD.md. Idempotent.
#[cfg(target_os = "linux")]
pub fn register() {
    let (Some(home), Some(exe)) = (std::env::var_os("HOME"), linux_host_exe()) else { return };
    let home = PathBuf::from(home);
    for (_, dir, firefox) in crate::linuxparse::LINUX_HOST_DIRS {
        // Only browsers that have been run have their profile folder.
        let profile_root = home.join(dir.rsplit_once('/').map(|(p, _)| p).unwrap_or(dir));
        if !profile_root.exists() {
            continue;
        }
        let folder = home.join(dir);
        let _ = std::fs::create_dir_all(&folder);
        let content = if firefox { firefox_manifest_json(&exe) } else { manifest_json(&exe) };
        let _ = write_if_changed(&folder.join(format!("{HOST_NAME}.json")), &content);
    }
}

/// (name shown, programs to try, extensions page) for each Chromium browser.
#[cfg(target_os = "linux")]
const LINUX_CHROMIUMS: [(&str, &[&str], &str); 5] = [
    ("Brave", &["brave-browser", "brave"], "brave://extensions"),
    ("Chrome", &["google-chrome", "google-chrome-stable"], "chrome://extensions"),
    ("Chromium", &["chromium", "chromium-browser"], "chrome://extensions"),
    ("Edge", &["microsoft-edge", "microsoft-edge-stable"], "edge://extensions"),
    ("Vivaldi", &["vivaldi", "vivaldi-stable"], "vivaldi://extensions"),
];

#[cfg(target_os = "linux")]
fn on_path(program: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| d.join(program).is_file()))
}

/// Which supported browsers are installed.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn detect_browsers() -> Vec<String> {
    let mut found: Vec<String> = LINUX_CHROMIUMS
        .iter()
        .filter(|(_, programs, _)| programs.iter().any(|p| on_path(p)))
        .map(|(name, _, _)| name.to_string())
        .collect();
    if on_path("firefox") {
        found.push("Firefox".into());
    }
    found
}

#[cfg(target_os = "linux")]
fn xdg_open(target: &str) -> bool {
    std::process::Command::new("xdg-open").arg(target).spawn().is_ok()
}

/// Opens the extension folder and a Chromium browser's extensions page
/// (Brave, Chrome, Chromium, Edge or Vivaldi). Returns the same names as on
/// Windows for the first three.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn open_extension_install(app: tauri::AppHandle) -> Result<String, String> {
    let folder = extension_folder(app).ok_or("The extension folder is missing. Reinstall DynIs to restore it.")?;
    xdg_open(&folder);
    for (name, programs, url) in LINUX_CHROMIUMS {
        if let Some(p) = programs.iter().find(|p| on_path(p)) {
            if std::process::Command::new(p).arg(url).spawn().is_ok() {
                return Ok(match name {
                    "Brave" => "brave.exe",
                    "Chrome" => "chrome.exe",
                    "Edge" => "msedge.exe",
                    other => other,
                }
                .into());
            }
        }
    }
    Err("Brave, Chrome, Chromium or Edge wasn't found on this PC.".into())
}

/// Opens Firefox's temporary add-on page and the folder with the extension.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn open_firefox_extension_install(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?.join("extension-firefox");
    if !dir.join("manifest.json").exists() {
        return Err("The Firefox extension folder is missing. Reinstall DynIs to restore it.".into());
    }
    let folder = dir.to_string_lossy().to_string();
    xdg_open(&folder);
    if on_path("firefox") && std::process::Command::new("firefox").arg("about:debugging#/runtime/this-firefox").spawn().is_ok() {
        Ok(folder)
    } else {
        Err("Firefox wasn't found on this PC.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_pinned_extension_is_accepted() {
        let ok = vec!["DynIs.exe".into(), format!("chrome-extension://{EXTENSION_ID}/"), "--parent-window=0".into()];
        assert!(is_host_invocation(&ok) && origin_allowed(&ok));
        let other = vec!["DynIs.exe".into(), "chrome-extension://abcdefghijklmnopabcdefghijklmnop/".into()];
        assert!(is_host_invocation(&other) && !origin_allowed(&other));
        assert!(!is_host_invocation(&["DynIs.exe".to_string()]));
    }

    #[test]
    fn reads_length_prefixed_frames() {
        let msg = br#"{"type":"downloads","downloads":[{"id":"7","name":"ubuntu.iso","received":50,"total":200,"speed":10}]}"#;
        let mut data = (msg.len() as u32).to_le_bytes().to_vec();
        data.extend_from_slice(msg);
        let frame = read_frame(&mut &data[..]).unwrap();
        match serde_json::from_slice::<Message>(&frame).unwrap() {
            Message::Downloads { downloads } => {
                assert_eq!(downloads[0].name, "ubuntu.iso");
                assert_eq!(downloads[0].total, Some(200));
            }
            _ => panic!("wrong message"),
        }
        assert!(read_frame(&mut &[0u8, 0, 0][..]).is_none());
    }

    #[test]
    fn firefox_host_is_recognised_and_restricted() {
        let args = vec!["DynIs.exe".into(), r"C:\x\native-host-firefox.json".into(), FIREFOX_ID.into()];
        assert!(is_host_invocation(&args) && origin_allowed(&args));
        let other = vec!["DynIs.exe".into(), r"C:\x\m.json".into(), "evil@example.com".into()];
        assert!(!is_host_invocation(&other) && !origin_allowed(&other));
        let m: serde_json::Value = serde_json::from_str(&firefox_manifest_json(r"C:\DynIs\DynIs.exe")).unwrap();
        assert_eq!(m["allowed_extensions"][0], FIREFOX_ID);
        assert!(m.get("allowed_origins").is_none());
        assert_eq!(m["name"], HOST_NAME);
        assert_eq!(FIREFOX_KEY, r"Software\Mozilla\NativeMessagingHosts\com.kevin.dynis");
        assert!(BROWSER_KEYS.iter().all(|k| k.ends_with(r"\NativeMessagingHosts\com.kevin.dynis")));
    }

    fn frame(json: &str) -> Vec<u8> {
        let mut data = (json.len() as u32).to_le_bytes().to_vec();
        data.extend_from_slice(json.as_bytes());
        data
    }

    #[test]
    fn reads_a_media_message_from_the_extension() {
        let json = r#"{"type":"media","protocol":1,"browser":"Brave","media":{"site":"youtube","source":"YouTube","title":"Lo-fi beats","artist":"Chill","art":"https://i.ytimg.com/vi/abc/mqdefault.jpg","durationMs":240000,"positionMs":1000,"positionAt":5,"playing":true,"canNext":true,"canPrev":true,"canSeek":true,"queueKind":"upnext","queue":[{"title":"Next one","artist":"Ch","art":null,"index":0}]}}"#;
        let bytes = frame(json);
        let f = read_frame(&mut &bytes[..]).unwrap();
        match serde_json::from_slice::<Message>(&f).unwrap() {
            Message::Media { browser, media: Some(m) } => {
                assert_eq!(browser, "Brave");
                assert_eq!(m.site, "youtube");
                assert_eq!(m.duration_ms, Some(240_000));
                assert!(m.playing && m.can_next);
                assert_eq!(m.queue_kind, "upnext");
                assert_eq!(m.queue[0].title, "Next one");
            }
            _ => panic!("wrong message"),
        }
        // Nothing playing any more.
        let bytes = frame(r#"{"type":"media","browser":"Edge","media":null}"#);
        let f = read_frame(&mut &bytes[..]).unwrap();
        assert!(matches!(serde_json::from_slice::<Message>(&f).unwrap(), Message::Media { media: None, .. }));
    }

    #[test]
    fn media_from_pages_is_bounded() {
        let long = "x".repeat(500);
        let m = WebMedia {
            site: "soundcloud".into(),
            title: format!("  {long} "),
            art: Some("javascript:alert(1)".into()),
            queue_kind: "queue".into(),
            queue: (0..30)
                .map(|i| QueueItem { title: format!("t{i}"), art: Some("http://insecure/a.jpg".into()), index: i, ..Default::default() })
                .collect(),
            ..Default::default()
        };
        let s = sanitize_media(m).unwrap();
        assert_eq!(s.title.chars().count(), 200);
        assert_eq!(s.art, None);
        assert_eq!(s.queue.len(), 10);
        assert!(s.queue.iter().all(|q| q.art.is_none()));
        // Unknown sites and empty titles are dropped; an empty queue is "none".
        assert!(sanitize_media(WebMedia { site: "evil".into(), title: "t".into(), ..Default::default() }).is_none());
        assert!(sanitize_media(WebMedia { site: "youtube".into(), title: "  ".into(), ..Default::default() }).is_none());
        let q = sanitize_media(WebMedia { site: "youtube".into(), title: "t".into(), queue_kind: "queue".into(), ..Default::default() }).unwrap();
        assert_eq!(q.queue_kind, "none");
    }

    #[test]
    fn sites_turned_off_never_report() {
        let mut sites = serde_json::Map::new();
        sites.insert("youtube".into(), false.into());
        assert!(!site_enabled(Some(&sites), "youtube"));
        assert!(site_enabled(Some(&sites), "spotify"));
        assert!(site_enabled(None, "ytmusic"));
        assert!(!site_enabled(None, "generic"));
        assert!(!site_enabled(None, "evil"));
    }

    #[test]
    fn relays_new_commands_and_settings_once() {
        let mut last_seq = 10;
        let mut last_sites = None;
        let mut sites = serde_json::Map::new();
        sites.insert("youtube".into(), true.into());
        let file = CommandFile {
            seq: 11,
            at: 1_000,
            command: Some(serde_json::json!({ "type": "command", "action": "next" })),
            sites: Some(sites.clone()),
        };
        let frames = relay_frames(&file, 2_000, &mut last_seq, &mut last_sites);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0]["type"], "config");
        assert_eq!(frames[1]["action"], "next");
        // The same file again sends nothing.
        assert!(relay_frames(&file, 2_000, &mut last_seq, &mut last_sites).is_empty());
        // A command older than 5 s (no browser was listening) is dropped.
        let stale = CommandFile { seq: 12, at: 0, ..file.clone() };
        assert!(relay_frames(&stale, 10_000, &mut last_seq, &mut last_sites).is_empty());
        // Frames are length-prefixed JSON.
        let bytes = encode_frame(&serde_json::json!({ "a": 1 }));
        assert_eq!(&bytes[..4], &7u32.to_le_bytes());
        assert_eq!(&bytes[4..], br#"{"a":1}"#);
    }

    #[test]
    fn manifest_restricts_origins() {
        let m: serde_json::Value = serde_json::from_str(&manifest_json("C:\\DynIs\\DynIs.exe")).unwrap();
        assert_eq!(m["allowed_origins"][0], format!("chrome-extension://{EXTENSION_ID}/"));
        assert_eq!(m["type"], "stdio");
    }
}

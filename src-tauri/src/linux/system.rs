//! System status on Linux: CPU, memory, disk, network (sysinfo), battery
//! (UPower over D-Bus, event-driven), volume (PipeWire's `wpctl`, else
//! PulseAudio's `pactl`; changes come from `pactl subscribe`), screen
//! brightness (the backlight, set through logind so no root is needed),
//! drives, uptime and lock.

use crate::linuxparse::{
    backlight_percent, backlight_value, is_sink_event, parse_pactl_mute, parse_pactl_volume, parse_wpctl_volume,
    upower_details,
};
use serde::Serialize;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::{Disks, Networks, System};
use tauri::{AppHandle, Emitter};

fn sys() -> &'static Mutex<System> {
    static S: OnceLock<Mutex<System>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(System::new()))
}

#[tauri::command]
pub fn get_cpu_usage() -> Result<u32, String> {
    let mut s = sys().lock().map_err(|e| e.to_string())?;
    s.refresh_cpu_usage();
    Ok(s.global_cpu_usage().round().clamp(0.0, 100.0) as u32)
}

#[tauri::command]
pub fn get_ram_usage() -> Result<f32, String> {
    let mut s = sys().lock().map_err(|e| e.to_string())?;
    s.refresh_memory();
    let total = s.total_memory().max(1) as f64;
    Ok(((s.used_memory() as f64 / total) * 100.0).round() as f32)
}

/// Free space on the root file system, in GB (same unit as Windows).
#[tauri::command]
pub fn get_disk_space() -> Result<u64, String> {
    let disks = Disks::new_with_refreshed_list();
    let root = disks
        .list()
        .iter()
        .find(|d| d.mount_point() == std::path::Path::new("/"))
        .or_else(|| disks.list().first())
        .ok_or("No disk found.")?;
    Ok(root.available_space() / (1024 * 1024 * 1024))
}

/// (upload, download) in bytes per second since the previous call.
#[tauri::command]
pub fn get_network_speed() -> Result<(u64, u64), String> {
    static NET: OnceLock<Mutex<(Networks, Instant)>> = OnceLock::new();
    let lock = NET.get_or_init(|| Mutex::new((Networks::new_with_refreshed_list(), Instant::now())));
    let mut guard = lock.lock().map_err(|e| e.to_string())?;
    let (nets, last) = &mut *guard;
    nets.refresh(true);
    let secs = last.elapsed().as_secs_f64().max(0.001);
    *last = Instant::now();
    let (mut up, mut down) = (0u64, 0u64);
    for (name, data) in nets.iter() {
        // Skip loopback, containers and VPN tunnels.
        if name == "lo" || name.starts_with("docker") || name.starts_with("veth") || name.starts_with("br-") || name.starts_with("virbr") {
            continue;
        }
        up = up.saturating_add(data.transmitted());
        down = down.saturating_add(data.received());
    }
    Ok(((up as f64 / secs) as u64, (down as f64 / secs) as u64))
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Drive {
    pub root: String,
    pub free: u64,
    pub total: u64,
}

/// The root file system, /home if separate, and mounted drives (/media, /mnt).
#[tauri::command]
pub fn widget_drives() -> Vec<Drive> {
    let disks = Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|d| {
            let m = d.mount_point().to_string_lossy();
            m == "/" || m == "/home" || m.starts_with("/media/") || m.starts_with("/mnt/") || m.starts_with("/run/media/")
        })
        .map(|d| {
            let m = d.mount_point().to_string_lossy().to_string();
            let root = match m.as_str() {
                "/" => "System".to_string(),
                "/home" => "Home".to_string(),
                _ => m.rsplit('/').next().unwrap_or(&m).to_string(),
            };
            Drive { root, free: d.available_space(), total: d.total_space() }
        })
        .collect()
}

/// Milliseconds since boot (same unit as Windows' GetTickCount64).
#[tauri::command]
pub fn widget_uptime() -> u64 {
    System::uptime() * 1000
}

/// Locks the screen (logind, which GNOME's lock screen follows).
#[tauri::command]
pub fn widget_lock_pc() {
    if !super::spawn("loginctl", &["lock-session"]) {
        let _ = super::spawn("xdg-screensaver", &["lock"]);
    }
}

/// An image file as a data URL (images only, up to 8 MB).
#[tauri::command]
pub fn widget_image(path: String) -> Result<String, String> {
    use base64::Engine;
    let lower = path.to_lowercase();
    let mime = [("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp"), ("bmp", "image/bmp")]
        .iter()
        .find(|(ext, _)| lower.ends_with(&format!(".{ext}")))
        .map(|(_, m)| *m)
        .ok_or("Choose a PNG, JPEG, GIF, WebP or BMP image.")?;
    let meta = std::fs::metadata(&path).map_err(|_| "That photo can't be found. Choose it again.".to_string())?;
    if meta.len() > 8 * 1024 * 1024 {
        return Err("That photo is larger than 8 MB. Choose a smaller one.".into());
    }
    let bytes = std::fs::read(&path).map_err(|_| "That photo can't be read. Choose it again.".to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

// ── Battery (UPower) ──

pub use crate::macparse::BatteryDetails;

const UPOWER: &str = "org.freedesktop.UPower";
const DISPLAY_DEVICE: &str = "/org/freedesktop/UPower/devices/DisplayDevice";

fn bus() -> Option<zbus::blocking::Connection> {
    static CONN: OnceLock<Option<zbus::blocking::Connection>> = OnceLock::new();
    CONN.get_or_init(|| zbus::blocking::Connection::system().ok()).clone()
}

fn prop<T: TryFrom<zbus::zvariant::OwnedValue>>(conn: &zbus::blocking::Connection, dest: &str, path: &str, iface: &str, name: &str) -> Option<T> {
    let proxy = zbus::blocking::Proxy::new(conn, dest.to_string(), path.to_string(), iface.to_string()).ok()?;
    let v: zbus::zvariant::OwnedValue = proxy.get_property(name).ok()?;
    T::try_from(v).ok()
}

fn read_battery() -> BatteryDetails {
    let Some(c) = bus() else { return Default::default() };
    let dev = "org.freedesktop.UPower.Device";
    let present: bool = prop(&c, UPOWER, DISPLAY_DEVICE, dev, "IsPresent").unwrap_or(false);
    // DisplayDevice type 2 = battery; desktops report no battery.
    let kind: u32 = prop(&c, UPOWER, DISPLAY_DEVICE, dev, "Type").unwrap_or(0);
    upower_details(
        present && kind == 2,
        prop(&c, UPOWER, DISPLAY_DEVICE, dev, "Percentage").unwrap_or(0.0),
        prop(&c, UPOWER, DISPLAY_DEVICE, dev, "State").unwrap_or(0),
        prop(&c, UPOWER, DISPLAY_DEVICE, dev, "TimeToEmpty").unwrap_or(0),
        prop(&c, UPOWER, DISPLAY_DEVICE, dev, "TimeToFull").unwrap_or(0),
        prop(&c, UPOWER, "/org/freedesktop/UPower", UPOWER, "OnBattery").unwrap_or(false),
    )
}

#[tauri::command]
pub async fn get_battery_details() -> Result<BatteryDetails, String> {
    tauri::async_runtime::spawn_blocking(read_battery).await.map_err(|e| e.to_string())
}

/// GNOME's power-saver profile (power-profiles-daemon).
#[tauri::command]
pub fn get_battery_saver_state() -> bool {
    let Some(c) = bus() else { return false };
    let p: Option<String> = prop(&c, "net.hadess.PowerProfiles", "/net/hadess/PowerProfiles", "net.hadess.PowerProfiles", "ActiveProfile");
    p.as_deref() == Some("power-saver")
}

// ── Volume ──

#[derive(Serialize, Clone)]
pub struct VolumeState {
    pub volume: f32,
    pub is_muted: bool,
}

fn output(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).stderr(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

fn read_volume() -> Option<VolumeState> {
    if let Some((v, muted)) = output("wpctl", &["get-volume", "@DEFAULT_AUDIO_SINK@"]).as_deref().and_then(parse_wpctl_volume) {
        return Some(VolumeState { volume: v.min(1.0), is_muted: muted });
    }
    let v = parse_pactl_volume(&output("pactl", &["get-sink-volume", "@DEFAULT_SINK@"])?)?;
    let muted = output("pactl", &["get-sink-mute", "@DEFAULT_SINK@"]).as_deref().is_some_and(parse_pactl_mute);
    Some(VolumeState { volume: v.min(1.0), is_muted: muted })
}

#[tauri::command]
pub async fn get_volume_state() -> Result<VolumeState, String> {
    tauri::async_runtime::spawn_blocking(|| read_volume().ok_or_else(|| "No audio output found.".to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_volume(volume: f32) {
    let v = volume.clamp(0.0, 1.0);
    let ok = Command::new("wpctl")
        .args(["set-volume", "@DEFAULT_AUDIO_SINK@", &format!("{v:.2}")])
        .status()
        .is_ok_and(|s| s.success());
    if ok {
        let _ = Command::new("wpctl").args(["set-mute", "@DEFAULT_AUDIO_SINK@", "0"]).status();
    } else {
        let pct = format!("{}%", (v * 100.0).round() as i32);
        let _ = Command::new("pactl").args(["set-sink-volume", "@DEFAULT_SINK@", &pct]).status();
        let _ = Command::new("pactl").args(["set-sink-mute", "@DEFAULT_SINK@", "0"]).status();
    }
}

// ── Brightness (backlight) ──

/// The first backlight device: /sys/class/backlight/<name>.
fn backlight() -> Option<(String, PathBuf)> {
    let dir = std::fs::read_dir("/sys/class/backlight").ok()?.flatten().next()?;
    Some((dir.file_name().to_string_lossy().into_owned(), dir.path()))
}

fn read_u32(path: PathBuf) -> Option<u32> {
    std::fs::read_to_string(path).ok()?.trim().parse().ok()
}

fn read_brightness() -> Option<u32> {
    let (_, dir) = backlight()?;
    Some(backlight_percent(read_u32(dir.join("brightness"))?, read_u32(dir.join("max_brightness"))?))
}

/// 0–100. Desktops with external monitors have no backlight.
#[tauri::command]
pub fn get_brightness() -> Result<u32, String> {
    read_brightness().ok_or_else(|| "unsupported".into())
}

/// Sets the backlight through logind (no root needed for the active session).
#[tauri::command]
pub fn set_brightness(brightness: u32) -> Result<(), String> {
    let (name, dir) = backlight().ok_or("unsupported")?;
    let max = read_u32(dir.join("max_brightness")).ok_or("unsupported")?;
    let value = backlight_value(brightness, max);
    let conn = bus().ok_or("No system bus.")?;
    conn.call_method(
        Some("org.freedesktop.login1"),
        "/org/freedesktop/login1/session/auto",
        Some("org.freedesktop.login1.Session"),
        "SetBrightness",
        &("backlight", name.as_str(), value),
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

// ── Events ──

/// The island's battery (UPower signals), volume (`pactl subscribe`) and
/// brightness (backlight file) updates. All waits, no tight polling.
pub fn start_events(app: AppHandle) {
    battery_events(app.clone());
    volume_events(app.clone());
    brightness_events(app);
}

fn battery_events(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-battery".into())
        .spawn(move || {
            let send = |app: &AppHandle, last: &mut Option<(u8, bool)>| {
                let d = read_battery();
                if let Some(p) = d.percent {
                    let now = (p, d.charging || d.plugged_in);
                    if *last != Some(now) {
                        *last = Some(now);
                        let _ = app.emit("battery-update", serde_json::json!({ "level": p, "charging": now.1 }));
                    }
                }
            };
            let mut last = None;
            send(&app, &mut last);
            let Some(conn) = bus() else { return };
            let rule = zbus::MatchRule::builder()
                .msg_type(zbus::message::Type::Signal)
                .interface("org.freedesktop.DBus.Properties")
                .and_then(|r| r.member("PropertiesChanged"))
                .and_then(|r| r.path(DISPLAY_DEVICE))
                .map(|r| r.build());
            let Ok(rule) = rule else { return };
            let Ok(iter) = zbus::blocking::MessageIterator::for_match_rule(rule, &conn, Some(16)) else { return };
            for _ in iter {
                send(&app, &mut last);
            }
        })
        .ok();
}

fn volume_events(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-volume".into())
        .spawn(move || loop {
            // `pactl subscribe` works with PipeWire (pipewire-pulse) too.
            let child = Command::new("pactl").arg("subscribe").stdout(Stdio::piped()).stderr(Stdio::null()).spawn();
            let Ok(mut child) = child else { return };
            let Some(stdout) = child.stdout.take() else { return };
            let key = |v: &VolumeState| ((v.volume * 100.0).round() as u32, v.is_muted);
            // The current level is the starting point, not a change.
            let mut last: Option<(u32, bool)> = read_volume().as_ref().map(key);
            for line in std::io::BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if !is_sink_event(&line) {
                    continue;
                }
                if let Some(v) = read_volume() {
                    if last != Some(key(&v)) {
                        last = Some(key(&v));
                        let _ = app.emit("volume-change", serde_json::json!({ "volume": v.volume, "is_muted": v.is_muted }));
                    }
                }
            }
            let _ = child.wait();
            // The sound server restarted: reconnect.
            std::thread::sleep(Duration::from_secs(3));
        })
        .ok();
}

/// Brightness keys change the backlight file; it's checked twice a second
/// only on machines that have one.
fn brightness_events(app: AppHandle) {
    if backlight().is_none() {
        return;
    }
    std::thread::Builder::new()
        .name("dynis-brightness".into())
        .spawn(move || {
            let mut last = read_brightness();
            loop {
                std::thread::sleep(Duration::from_millis(500));
                let now = read_brightness();
                if now.is_some() && now != last {
                    last = now;
                    let _ = app.emit("brightness-change", serde_json::json!({ "brightness": now }));
                }
            }
        })
        .ok();
}

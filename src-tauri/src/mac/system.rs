//! System status on macOS: CPU, memory, disk, network (sysinfo), battery
//! (`pmset`), volume (AppleScript), drives, uptime, lock.

use serde::Serialize;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
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

/// Free space on the startup disk, in GB (same unit as Windows).
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
        // Skip loopback and virtual tunnels.
        if name.starts_with("lo") || name.starts_with("utun") || name.starts_with("awdl") || name.starts_with("llw") {
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

/// Internal and external volumes (not system snapshots).
#[tauri::command]
pub fn widget_drives() -> Vec<Drive> {
    let disks = Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|d| {
            let m = d.mount_point().to_string_lossy();
            m == "/" || m.starts_with("/Volumes/")
        })
        .map(|d| {
            let m = d.mount_point().to_string_lossy().to_string();
            let root = if m == "/" { "Macintosh HD".to_string() } else { m.trim_start_matches("/Volumes/").to_string() };
            Drive { root, free: d.available_space(), total: d.total_space() }
        })
        .collect()
}

/// Milliseconds since boot (same unit as Windows' GetTickCount64).
#[tauri::command]
pub fn widget_uptime() -> u64 {
    System::uptime() * 1000
}

/// Locks the screen (sleeps the display; macOS asks for the password).
#[tauri::command]
pub fn widget_lock_pc() {
    let _ = Command::new("/usr/bin/pmset").arg("displaysleepnow").spawn();
}

/// An image file as a data URL (images only, up to 8 MB).
#[tauri::command]
pub fn widget_image(path: String) -> Result<String, String> {
    use base64::Engine;
    let lower = path.to_lowercase();
    let mime = [
        ("png", "image/png"),
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("gif", "image/gif"),
        ("webp", "image/webp"),
        ("bmp", "image/bmp"),
        ("heic", "image/heic"),
    ]
    .iter()
    .find(|(ext, _)| lower.ends_with(&format!(".{ext}")))
    .map(|(_, m)| *m)
    .ok_or("Choose a PNG, JPEG, GIF, WebP, BMP or HEIC image.")?;
    let meta = std::fs::metadata(&path).map_err(|_| "That photo can't be found. Choose it again.".to_string())?;
    if meta.len() > 8 * 1024 * 1024 {
        return Err("That photo is larger than 8 MB. Choose a smaller one.".into());
    }
    let bytes = std::fs::read(&path).map_err(|_| "That photo can't be read. Choose it again.".to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

// ── Battery ──

pub use crate::macparse::{parse_pmset, BatteryDetails};

fn read_battery() -> BatteryDetails {
    Command::new("/usr/bin/pmset")
        .args(["-g", "batt"])
        .output()
        .map(|o| parse_pmset(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

#[tauri::command]
pub async fn get_battery_details() -> Result<BatteryDetails, String> {
    tauri::async_runtime::spawn_blocking(read_battery).await.map_err(|e| e.to_string())
}

/// Low Power Mode (`pmset -g` shows "lowpowermode 1").
#[tauri::command]
pub fn get_battery_saver_state() -> bool {
    Command::new("/usr/bin/pmset")
        .arg("-g")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().any(|l| l.trim().starts_with("lowpowermode") && l.trim().ends_with('1')))
        .unwrap_or(false)
}

/// The webview on macOS has no Battery API, so the island gets
/// `battery-update` events instead (on change, checked every 30 s).
pub fn start_battery_events(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-battery".into())
        .spawn(move || {
            let mut last: Option<(u8, bool)> = None;
            loop {
                let d = read_battery();
                if let Some(p) = d.percent {
                    let now = (p, d.charging || d.plugged_in);
                    if last != Some(now) {
                        last = Some(now);
                        let _ = app.emit("battery-update", serde_json::json!({ "level": p, "charging": now.1 }));
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(30));
            }
        })
        .ok();
}

// ── Volume (AppleScript "volume settings", public) ──

#[derive(Serialize, Clone)]
pub struct VolumeState {
    pub volume: f32,
    pub is_muted: bool,
}

#[tauri::command]
pub async fn get_volume_state() -> Result<VolumeState, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let out = super::osascript("set s to get volume settings\nreturn ((output volume of s) as text) & \",\" & ((output muted of s) as text)")?;
        let (v, m) = out.split_once(',').ok_or("No volume.")?;
        Ok(VolumeState { volume: v.trim().parse::<f32>().unwrap_or(0.0) / 100.0, is_muted: m.trim() == "true" })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_volume(volume: f32) {
    let v = (volume.clamp(0.0, 1.0) * 100.0).round() as i32;
    let _ = super::osascript_spawn(&format!("set volume output volume {v} without output muted"));
}

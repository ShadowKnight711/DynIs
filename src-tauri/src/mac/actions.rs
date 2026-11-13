//! Actions on macOS: keep awake, keyboard focus for typing in the island,
//! snapping the front window, opening apps and system screens, quit/restart.

use crate::macparse::snap_frame;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// ── Keep awake: `caffeinate` holds the power assertion while it runs ──

static CAFFEINATE: Mutex<Option<Child>> = Mutex::new(None);

#[tauri::command]
pub fn set_keep_awake(on: bool) -> bool {
    let mut slot = CAFFEINATE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if on {
        // -d display, -i idle sleep; -w ends it if DynIs quits.
        let pid = std::process::id().to_string();
        *slot = Command::new("/usr/bin/caffeinate").args(["-d", "-i", "-w", &pid]).spawn().ok();
    }
    slot.is_some()
}

#[tauri::command]
pub fn get_keep_awake() -> bool {
    let mut slot = CAFFEINATE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(child) = slot.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_))) {
            *slot = None;
        }
    }
    slot.is_some()
}

// ── Focus: the island only takes the keyboard while you type in it ──

/// The app that was in front before the island took focus (pid).
static PREVIOUS_APP: AtomicI32 = AtomicI32::new(0);

/// Remembers the frontmost app (not DynIs) every second, so Snap and
/// "give focus back" know which app you were using.
pub fn start_front_app_tracker() {
    std::thread::Builder::new()
        .name("dynis-front-app".into())
        .spawn(|| {
            let me = std::process::id() as i32;
            loop {
                if let Some(pid) = frontmost_pid() {
                    if pid != me {
                        PREVIOUS_APP.store(pid, Ordering::Relaxed);
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        })
        .ok();
}

fn frontmost_pid() -> Option<i32> {
    use objc2_app_kit::NSWorkspace;
    let ws = NSWorkspace::sharedWorkspace();
    let app = ws.frontmostApplication()?;
    Some(app.processIdentifier())
}

#[tauri::command]
pub fn focus_island(window: tauri::WebviewWindow) {
    let _ = window.set_ignore_cursor_events(false);
    let _ = window.set_focus();
}

/// Gives the keyboard back to the app you were using.
#[tauri::command]
pub fn restore_foreground(app: AppHandle) {
    let pid = PREVIOUS_APP.load(Ordering::Relaxed);
    if pid <= 0 {
        return;
    }
    let _ = app.run_on_main_thread(move || {
        use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
        if let Some(other) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
            #[allow(deprecated)]
            other.activateWithOptions(NSApplicationActivationOptions::empty());
        }
    });
}

// ── Snap the window you were using (needs Accessibility) ──

const ACCESSIBILITY_PANE: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

/// The visible area of the main screen (no menu bar or Dock), top-left origin.
fn visible_area() -> Option<(f64, f64, f64, f64)> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    let mtm = MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;
    let full = screen.frame();
    let v = screen.visibleFrame();
    let top = full.size.height - (v.origin.y + v.size.height);
    Some((v.origin.x, top, v.size.width, v.size.height))
}

static AREA: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);

pub fn cache_visible_area(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| {
        if let (Some(a), Ok(mut slot)) = (visible_area(), AREA.lock()) {
            *slot = Some(a);
        }
    });
}

#[tauri::command]
pub fn snap_window(app: AppHandle, layout: String) -> Result<(), String> {
    cache_visible_area(&app);
    let area = visible_area().or_else(|| AREA.lock().ok().and_then(|a| *a)).ok_or("No screen found.")?;
    let (x, y, w, h) = snap_frame(&layout, area).ok_or("Unknown layout.")?;
    let pid = PREVIOUS_APP.load(Ordering::Relaxed);
    if pid <= 0 {
        return Err("Click the window you want to snap first.".into());
    }
    let script = format!(
        "tell application \"System Events\"\nset p to first application process whose unix id is {pid}\nset frontmost of p to true\ntell window 1 of p\nset position to {{{}, {}}}\nset size to {{{}, {}}}\nend tell\nend tell",
        x.round() as i64,
        y.round() as i64,
        w.round() as i64,
        h.round() as i64
    );
    match super::osascript(&script) {
        Ok(_) => Ok(()),
        Err(e) if e.contains("-1719") || e.contains("-25211") || e.to_lowercase().contains("assistive") => {
            crate::platform::open_url(ACCESSIBILITY_PANE);
            Err("Allow DynIs in System Settings → Privacy & Security → Accessibility, then try again.".into())
        }
        Err(_) => Err("That window can't be moved.".into()),
    }
}

// ── Apps and system screens ──

#[tauri::command]
pub fn open_app(app_name: String) -> Result<(), String> {
    let ok = if app_name.starts_with('/') {
        Command::new("/usr/bin/open").arg(&app_name).status()
    } else {
        Command::new("/usr/bin/open").args(["-a", &app_name]).status()
    }
    .is_ok_and(|s| s.success());
    if ok { Ok(()) } else { Err(format!("{app_name} couldn't be opened.")) }
}

/// Matches the Windows action names the UI sends; ones without a macOS
/// equivalent open System Settings.
#[tauri::command]
pub fn open_system_action(action: String) -> Result<(), String> {
    let target: &[&str] = match action.as_str() {
        "task-manager" => &["-a", "Activity Monitor"],
        "disk-management" => &["-a", "Disk Utility"],
        "snipping-tool" => &["-a", "Screenshot"],
        "calculator" => &["-a", "Calculator"],
        "file-explorer" => &["-a", "Finder"],
        "task-view" => &["-a", "Mission Control"],
        "installed-apps" => &["/Applications"],
        "power-options" => &["x-apple.systempreferences:com.apple.Battery-Settings.extension"],
        "network-connections" => &["x-apple.systempreferences:com.apple.Network-Settings.extension"],
        "night-light" => &["x-apple.systempreferences:com.apple.Displays-Settings.extension"],
        _ => &["x-apple.systempreferences:"],
    };
    Command::new("/usr/bin/open").args(target).status().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_sound_settings() {
    crate::platform::open_url("x-apple.systempreferences:com.apple.Sound-Settings.extension");
}

#[tauri::command]
pub fn open_audio_output_picker() {
    open_sound_settings();
}

#[tauri::command]
pub fn open_bluetooth_settings() {
    crate::platform::open_url("x-apple.systempreferences:com.apple.BluetoothSettings");
}

#[tauri::command]
pub fn wifi_open_settings() {
    crate::platform::open_url("x-apple.systempreferences:com.apple.wifi-settings-extension");
}

#[tauri::command]
pub fn open_battery_saver_settings() {
    crate::platform::open_url("x-apple.systempreferences:com.apple.Battery-Settings.extension");
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn close_window(window: tauri::Window) {
    let _ = window.hide();
}

#[tauri::command]
pub fn quit_bloom(app: AppHandle) {
    let _ = set_keep_awake(false);
    app.exit(0);
}

#[tauri::command]
pub fn restart_bloom(app: AppHandle) {
    let _ = set_keep_awake(false);
    app.restart();
}

static CLIPBOARD_IGNORE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// DynIs's own next copy (shelf, setup) isn't captured.
#[tauri::command]
pub fn clipboard_ignore_next() {
    CLIPBOARD_IGNORE.store(true, Ordering::Relaxed);
}

pub fn take_clipboard_ignore() -> bool {
    CLIPBOARD_IGNORE.swap(false, Ordering::Relaxed)
}

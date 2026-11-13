//! Actions on Linux: keep awake, keyboard focus for typing in the island,
//! snapping the window you were using (EWMH, X11), opening apps and GNOME
//! Settings pages, quit/restart.

use crate::linuxparse::{exec_argv, parse_desktop_entry};
use crate::macparse::snap_frame;
use std::process::{Child, Command};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// ── Keep awake ──

enum Inhibit {
    /// GNOME session inhibitor: (connection that owns it, cookie).
    Gnome(zbus::blocking::Connection, u32),
    /// `systemd-inhibit … sleep infinity` holds a logind lock while it runs.
    Logind(Child),
}

static INHIBIT: Mutex<Option<Inhibit>> = Mutex::new(None);

fn release(slot: &mut Option<Inhibit>) {
    match slot.take() {
        Some(Inhibit::Gnome(conn, cookie)) => {
            let _ = conn.call_method(
                Some("org.gnome.SessionManager"),
                "/org/gnome/SessionManager",
                Some("org.gnome.SessionManager"),
                "Uninhibit",
                &(cookie,),
            );
        }
        Some(Inhibit::Logind(mut child)) => {
            let _ = child.kill();
            let _ = child.wait();
        }
        None => {}
    }
}

#[tauri::command]
pub fn set_keep_awake(on: bool) -> bool {
    let mut slot = INHIBIT.lock().unwrap_or_else(|e| e.into_inner());
    release(&mut slot);
    if on {
        // Idle (4) + suspend (8): the screen stays on and the PC awake.
        let gnome = zbus::blocking::Connection::session().ok().and_then(|conn| {
            let reply = conn
                .call_method(
                    Some("org.gnome.SessionManager"),
                    "/org/gnome/SessionManager",
                    Some("org.gnome.SessionManager"),
                    "Inhibit",
                    &("DynIs", 0u32, "Keep Awake is on", 4u32 | 8u32),
                )
                .ok()?;
            let cookie: u32 = reply.body().deserialize().ok()?;
            Some(Inhibit::Gnome(conn, cookie))
        });
        *slot = gnome.or_else(|| {
            Command::new("systemd-inhibit")
                .args(["--what=idle:sleep", "--who=DynIs", "--why=Keep Awake is on", "--mode=block", "sleep", "infinity"])
                .spawn()
                .ok()
                .map(Inhibit::Logind)
        });
    }
    slot.is_some()
}

#[tauri::command]
pub fn get_keep_awake() -> bool {
    let mut slot = INHIBIT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(Inhibit::Logind(child)) = slot.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_))) {
            *slot = None;
        }
    }
    slot.is_some()
}

// ── Focus: the island only takes the keyboard while you type in it ──

/// The focused window is followed by the window module's X11 watcher.
pub fn start_active_window_tracker() {}

#[tauri::command]
pub fn focus_island(window: tauri::WebviewWindow) {
    super::window::set_click_through(&window, false);
    let _ = window.set_focus();
}

/// Gives the keyboard back to the window you were using.
#[tauri::command]
pub fn restore_foreground() {
    let win = super::window::LAST_OTHER_WINDOW.load(Ordering::Relaxed);
    if win == 0 {
        return;
    }
    if let Some(x) = super::window::x11::X::open() {
        x.activate(win);
    }
}

// ── Snap the window you were using ──

#[tauri::command]
pub fn snap_window(layout: String) -> Result<(), String> {
    let win = super::window::LAST_OTHER_WINDOW.load(Ordering::Relaxed);
    if win == 0 {
        return Err("Click the window you want to snap first.".into());
    }
    let x = super::window::x11::X::open().ok_or("Snap needs an X11 session (Zorin Desktop on Xorg).")?;
    let (ax, ay, aw, ah) = x.work_area().ok_or("No screen found.")?;
    let (fx, fy, fw, fh) = snap_frame(&layout, (ax as f64, ay as f64, aw as f64, ah as f64)).ok_or("Unknown layout.")?;
    x.move_resize(win, fx.round() as i32, fy.round() as i32, fw.round() as i32, fh.round() as i32);
    x.activate(win);
    Ok(())
}

// ── Apps and system screens ──

/// Opens an app: a .desktop file (from the app list), a program name, or a
/// file, folder or link (with the default app).
#[tauri::command]
pub fn open_app(app_name: String) -> Result<(), String> {
    if app_name.ends_with(".desktop") {
        // `gio launch` honours the entry fully (Terminal=, DBusActivatable…).
        if Command::new("gio").args(["launch", &app_name]).spawn().is_ok() {
            return Ok(());
        }
        let entry = std::fs::read_to_string(&app_name).ok().and_then(|t| parse_desktop_entry(&t)).ok_or("That app can't be opened.")?;
        let argv = exec_argv(&entry.exec);
        let (prog, args) = argv.split_first().ok_or("That app can't be opened.")?;
        return Command::new(prog).args(args).spawn().map(|_| ()).map_err(|_| format!("{} couldn't be opened.", entry.name));
    }
    let ok = if app_name.contains('/') || app_name.contains(':') {
        Command::new("xdg-open").arg(&app_name).spawn().is_ok()
    } else {
        Command::new(&app_name).spawn().is_ok() || Command::new("gtk-launch").arg(&app_name).spawn().is_ok()
    };
    if ok {
        Ok(())
    } else {
        Err(format!("{app_name} couldn't be opened."))
    }
}

/// Runs the first command that exists.
fn first_of(candidates: &[&[&str]]) -> bool {
    candidates.iter().any(|c| super::have(c[0]) && super::spawn(c[0], &c[1..]))
}

fn gnome_settings(panel: &str) {
    if !first_of(&[&["gnome-control-center", panel], &["zorin-settings"]]) {
        crate::platform::open_url("settings://");
    }
}

/// Matches the Windows action names the UI sends.
#[tauri::command]
pub fn open_system_action(action: String) -> Result<(), String> {
    let ok = match action.as_str() {
        "task-manager" => first_of(&[&["gnome-system-monitor"], &["plasma-systemmonitor"], &["xfce4-taskmanager"]]),
        "disk-management" => first_of(&[&["gnome-disks"], &["baobab"]]),
        "snipping-tool" => first_of(&[&["gnome-screenshot", "--interactive"], &["flameshot", "gui"], &["spectacle", "-r"]]),
        "calculator" => first_of(&[&["gnome-calculator"], &["galculator"], &["kcalc"]]),
        "file-explorer" => first_of(&[&["nautilus"], &["xdg-open", "."]]),
        "installed-apps" => first_of(&[&["gnome-software"], &["snap-store"]]),
        "power-options" => {
            gnome_settings("power");
            true
        }
        "network-connections" => {
            gnome_settings("network");
            true
        }
        "night-light" => {
            gnome_settings("display");
            true
        }
        _ => {
            gnome_settings("");
            true
        }
    };
    if ok {
        Ok(())
    } else {
        Err("That app isn't installed.".into())
    }
}

#[tauri::command]
pub fn open_sound_settings() {
    gnome_settings("sound");
}

#[tauri::command]
pub fn open_audio_output_picker() {
    open_sound_settings();
}

#[tauri::command]
pub fn open_bluetooth_settings() {
    gnome_settings("bluetooth");
}

#[tauri::command]
pub fn wifi_open_settings() {
    gnome_settings("wifi");
}

#[tauri::command]
pub fn open_battery_saver_settings() {
    gnome_settings("power");
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

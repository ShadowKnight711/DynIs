//! The Linux backend (DynIs 2.1: Zorin OS and other GNOME/Ubuntu desktops).
//! The UI is the same React app; this module answers the commands it calls
//! with Linux implementations, like `crate::mac` does on macOS. Features Linux
//! can't offer are reported by `platform_info` and hidden by the UI; the few
//! Windows-only calls the island still makes are harmless no-ops here.
//!
//! The island runs on X11 (XWayland under a Wayland session): GNOME's
//! Wayland compositor doesn't let apps place an always-on-top bar at the
//! screen edge or make parts of it click-through, X11 does.

pub mod actions;
pub mod activities;
pub mod media;
pub mod system;
pub mod window;

// The settings store is the same as on macOS (settings.json in the app's
// config folder: ~/.config/com.kevin.dynis on Linux).
#[path = "../mac/settings.rs"]
pub mod settings;

use crate::linuxparse::{exec_argv, parse_desktop_entry};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

/// Runs a program detached, without waiting.
pub fn spawn(program: &str, args: &[&str]) -> bool {
    Command::new(program).args(args).spawn().is_ok()
}

/// Whether a program is on PATH.
pub fn have(program: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(program).is_file()))
        .unwrap_or(false)
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

/// Where desktop entries live (system, user, Snap, Flatpak).
fn application_dirs() -> Vec<PathBuf> {
    let h = home();
    let mut dirs = vec![h.join(".local/share/applications")];
    let data = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    dirs.extend(data.split(':').filter(|d| !d.is_empty()).map(|d| Path::new(d).join("applications")));
    dirs.push(PathBuf::from("/var/lib/snapd/desktop/applications"));
    dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
    dirs.push(h.join(".local/share/flatpak/exports/share/applications"));
    dirs.dedup();
    dirs
}

// ── Apps ──

/// Installed apps from their .desktop files. `path` is the .desktop file.
#[tauri::command]
pub fn get_installed_apps() -> Vec<crate::types::AppInfo> {
    let mut seen = std::collections::HashSet::new();
    let mut apps: Vec<crate::types::AppInfo> = application_dirs()
        .iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "desktop"))
        // The first folder wins for the same file name (user over system).
        .filter(|p| seen.insert(p.file_name().map(|n| n.to_os_string()).unwrap_or_default()))
        .filter_map(|p| {
            let entry = parse_desktop_entry(&std::fs::read_to_string(&p).ok()?)?;
            Some(crate::types::AppInfo {
                name: entry.name,
                path: p.to_string_lossy().to_string(),
                icon: None,
                is_running: false,
                hwnd: None,
                executable: exec_argv(&entry.exec).into_iter().next(),
                all_hwnds: None,
            })
        })
        .collect();
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps.dedup_by(|a, b| a.name == b.name);
    apps
}

/// Finds an icon by theme name in the common icon folders (PNG preferred,
/// then SVG), or takes an absolute path as is.
fn find_icon(name: &str) -> Option<PathBuf> {
    if name.starts_with('/') {
        return Path::new(name).is_file().then(|| PathBuf::from(name));
    }
    let h = home();
    let roots = [
        h.join(".local/share/icons/hicolor"),
        PathBuf::from("/usr/share/icons/hicolor"),
        PathBuf::from("/var/lib/flatpak/exports/share/icons/hicolor"),
        h.join(".local/share/flatpak/exports/share/icons/hicolor"),
        PathBuf::from("/var/lib/snapd/desktop/icons"),
    ];
    for root in &roots {
        for size in ["64x64", "48x48", "128x128", "96x96", "256x256", "32x32"] {
            let p = root.join(size).join("apps").join(format!("{name}.png"));
            if p.is_file() {
                return Some(p);
            }
        }
        let svg = root.join("scalable/apps").join(format!("{name}.svg"));
        if svg.is_file() {
            return Some(svg);
        }
        let flat = root.join(format!("{name}.png"));
        if flat.is_file() {
            return Some(flat);
        }
    }
    let pixmap = Path::new("/usr/share/pixmaps").join(format!("{name}.png"));
    if pixmap.is_file() {
        return Some(pixmap);
    }
    let svg = Path::new("/usr/share/pixmaps").join(format!("{name}.svg"));
    svg.is_file().then_some(svg)
}

/// An app's icon (from its .desktop file) as a data URL.
#[tauri::command]
pub async fn get_app_icon(path: String, _name: Option<String>, _hwnd: Option<isize>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let entry = parse_desktop_entry(&std::fs::read_to_string(&path).ok()?)?;
        let file = find_icon(entry.icon.as_deref()?)?;
        let bytes = std::fs::read(&file).ok()?;
        if bytes.len() > 2 * 1024 * 1024 {
            return None;
        }
        let mime = if file.extension().is_some_and(|x| x == "svg") { "image/svg+xml" } else { "image/png" };
        Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    })
    .await
    .ok()
    .flatten()
}

// ── Windows-only calls the UI makes: no-ops on Linux ──

#[tauri::command]
pub fn set_window_region() {}
#[tauri::command]
pub fn set_menu_open() {}
#[tauri::command]
pub fn change_notch_mode(app: AppHandle) {
    window::position(&app);
}
#[tauri::command]
pub fn sync_appbar(app: AppHandle) {
    window::position(&app);
}
#[tauri::command]
pub fn set_splash_fullscreen() {}
#[tauri::command]
pub fn hide_native_osd() {}
#[tauri::command]
pub fn setup_shelf_drop() {}
#[tauri::command]
pub fn shelf_prune() {}
#[tauri::command]
pub fn set_volume_mixer_rect() {}
#[tauri::command]
pub fn clear_volume_mixer_rect() {}
#[tauri::command]
pub fn sync_overlay_position() {}
#[tauri::command]
pub fn hide_overlay(app: AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.hide();
    }
}
#[tauri::command]
pub fn update_dock_rect() {}
#[tauri::command]
pub fn set_dock_hovered() {}
#[tauri::command]
pub fn init_dock() {}
#[tauri::command]
pub fn toggle_dock() {}
#[tauri::command]
pub fn change_dock_mode() {}
#[tauri::command]
pub fn get_audio_sessions() -> Vec<serde_json::Value> {
    vec![]
}
#[tauri::command]
pub fn notifications_status() -> serde_json::Value {
    serde_json::json!({ "supported": true, "linux": true })
}
#[tauri::command]
pub fn glass_capture() -> Result<(), String> {
    Err("unsupported".into())
}
/// GNOME's accent isn't exposed to webviews; DynIs uses its own.
#[tauri::command]
pub fn get_system_accent_color() -> Result<String, String> {
    Ok("#0a84ff".into())
}
#[tauri::command]
pub fn resize_settings_window(app: AppHandle, width: f64, height: f64) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.set_size(tauri::LogicalSize::new(width, height));
    }
}
/// The macOS notch geometry; there is no notch on Linux.
#[tauri::command]
pub fn mac_display_info() -> Option<()> {
    None
}

/// Before GTK starts: the island needs X11 (XWayland on Wayland sessions),
/// and WebKitGTK's DMA-BUF renderer shows a blank or opaque window on some
/// GPUs (NVIDIA, VMs), so it's turned off unless the user set it.
fn prepare_environment() {
    // SAFETY: called first thing in main, before any other thread exists.
    unsafe {
        if std::env::var_os("DYNIS_ALLOW_WAYLAND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

pub fn run() {
    // Started by a browser as the "DynIs Downloads & Media" native host: no UI.
    let all_args: Vec<String> = std::env::args().collect();
    if crate::native_host::is_host_invocation(&all_args) {
        crate::native_host::run_host(&all_args);
        return;
    }
    prepare_environment();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_drag::init())
        // Linux: an ~/.config/autostart/DynIs.desktop entry.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![])))
        .invoke_handler(tauri::generate_handler![
            crate::platform::platform_info,
            settings::load_settings,
            settings::save_setting,
            settings::reset_settings,
            settings::settings_file_readable,
            settings::finish_onboarding,
            mac_display_info,
            window::update_notch_rect,
            window::set_notch_hovered,
            window::set_notch_visible,
            window::set_ignore_cursor_events,
            media::media_play_pause,
            media::media_next,
            media::media_previous,
            media::media_seek,
            media::media_toggle_shuffle,
            media::media_cycle_repeat,
            system::get_cpu_usage,
            system::get_ram_usage,
            system::get_disk_space,
            system::get_network_speed,
            system::widget_drives,
            system::widget_uptime,
            system::widget_lock_pc,
            system::widget_image,
            system::get_battery_details,
            system::get_battery_saver_state,
            system::get_volume_state,
            system::set_volume,
            system::get_brightness,
            system::set_brightness,
            actions::set_keep_awake,
            actions::get_keep_awake,
            actions::focus_island,
            actions::restore_foreground,
            actions::snap_window,
            actions::open_app,
            actions::open_system_action,
            actions::open_sound_settings,
            actions::open_audio_output_picker,
            actions::open_bluetooth_settings,
            actions::wifi_open_settings,
            actions::open_battery_saver_settings,
            actions::open_settings_window,
            actions::close_window,
            actions::quit_bloom,
            actions::restart_bloom,
            actions::clipboard_ignore_next,
            get_installed_apps,
            get_app_icon,
            crate::activities::activity_upsert,
            crate::activities::activity_lift,
            crate::activities::activity_end,
            crate::activities::activity_presentation,
            crate::activities::google_calendar::google_connect,
            crate::activities::google_calendar::google_sign_out,
            crate::activities::google_calendar::google_connected,
            crate::activities::google_calendar::google_events,
            crate::activities::spotify::spotify_authorize,
            crate::activities::spotify::spotify_store_token,
            crate::activities::spotify::spotify_load_token,
            crate::activities::spotify::spotify_clear_token,
            crate::native_host::extension_folder,
            crate::native_host::extension_connected,
            crate::native_host::open_extension_install,
            crate::native_host::detect_browsers,
            crate::native_host::open_firefox_extension_install,
            crate::browser_media::browser_media_command,
            crate::browser_media::browser_media_state,
            set_window_region,
            set_menu_open,
            change_notch_mode,
            sync_appbar,
            set_splash_fullscreen,
            hide_native_osd,
            setup_shelf_drop,
            shelf_prune,
            set_volume_mixer_rect,
            clear_volume_mixer_rect,
            sync_overlay_position,
            hide_overlay,
            update_dock_rect,
            set_dock_hovered,
            init_dock,
            toggle_dock,
            change_dock_mode,
            get_audio_sessions,
            notifications_status,
            glass_capture,
            get_system_accent_color,
            resize_settings_window,
        ])
        .setup(|app| {
            settings::init(app.handle());
            window::setup(app.handle());
            actions::start_active_window_tracker();
            media::start(app.handle().clone());
            system::start_events(app.handle().clone());
            crate::activities::setup(app.handle());
            std::thread::spawn(crate::native_host::register);
            crate::browser_media::setup(app.handle().clone());
            tray(app.handle())?;

            // The dock is a Windows feature: its window never shows here.
            if let Some(dock) = app.get_webview_window("dock") {
                let _ = dock.hide();
            }
            // Settings hides instead of closing.
            if let Some(settings_win) = app.get_webview_window("settings") {
                let w = settings_win.clone();
                settings_win.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }
            // First run: setup opens; the island appears when it's done.
            if settings::onboarding_complete() {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                }
            } else if let Some(w) = app.get_webview_window("settings") {
                let _ = w.center();
                let _ = w.show();
                let _ = w.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DynIs");
}

/// Top bar (system tray) icon: Settings and Quit (Open Setup until setup is
/// done). On Zorin/GNOME it appears through the AppIndicator extension.
fn tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let label = if settings::onboarding_complete() { "Settings…" } else { "Open Setup" };
    let settings_item = MenuItem::with_id(app, "settings", label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit DynIs", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings_item, &quit])?;
    let mut builder = TrayIconBuilder::with_id("dynis-tray").menu(&menu).tooltip("DynIs");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, e| match e.id().as_ref() {
            "settings" => actions::open_settings_window(app.clone()),
            "quit" => actions::quit_bloom(app.clone()),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

//! The macOS backend (DynIs 2.1). The UI is the same React app; this module
//! answers the commands it calls, with macOS implementations. Features macOS
//! can't offer are reported by `platform_info` and hidden by the UI; the few
//! Windows-only calls the island still makes are harmless no-ops here.

pub mod actions;
pub mod activities;
pub mod media;
pub mod settings;
pub mod system;
pub mod window;

use std::process::Command;
use tauri::{AppHandle, Manager};

/// Runs an AppleScript and returns its output (trimmed of the newline).
pub fn osascript(script: &str) -> Result<String, String> {
    let out = Command::new("/usr/bin/osascript").args(["-e", script]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Fire-and-forget AppleScript (controls shouldn't wait).
pub fn osascript_spawn(script: &str) -> std::io::Result<()> {
    Command::new("/usr/bin/osascript").args(["-e", script]).spawn().map(|_| ())
}

// ── Apps ──

/// Apps in /Applications, /System/Applications and ~/Applications.
#[tauri::command]
pub fn get_installed_apps() -> Vec<crate::types::AppInfo> {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_default();
    let mut apps: Vec<crate::types::AppInfo> = [
        std::path::PathBuf::from("/Applications"),
        std::path::PathBuf::from("/System/Applications"),
        std::path::PathBuf::from("/System/Applications/Utilities"),
        home.join("Applications"),
    ]
    .iter()
    .filter_map(|dir| std::fs::read_dir(dir).ok())
    .flatten()
    .flatten()
    .filter(|e| e.path().extension().is_some_and(|x| x == "app"))
    .map(|e| {
        let path = e.path();
        crate::types::AppInfo {
            name: path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
            path: path.to_string_lossy().to_string(),
            icon: None,
            is_running: false,
            hwnd: None,
            executable: None,
            all_hwnds: None,
        }
    })
    .collect();
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps.dedup_by(|a, b| a.name == b.name);
    apps
}

/// An app's icon as a PNG data URL (from its .icns, via `sips`), cached.
#[tauri::command]
pub async fn get_app_icon(path: String, _name: Option<String>, _hwnd: Option<isize>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let app = std::path::Path::new(&path);
        if app.extension().is_none_or(|x| x != "app") {
            return None;
        }
        let resources = app.join("Contents/Resources");
        let icns = std::fs::read_dir(&resources)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().is_some_and(|x| x == "icns"))?;
        let out = std::env::temp_dir().join(format!("dynis-icon-{:x}.png", {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            path.hash(&mut h);
            h.finish()
        }));
        if !out.exists() {
            Command::new("/usr/bin/sips")
                .args(["-s", "format", "png", "-Z", "64"])
                .arg(&icns)
                .arg("--out")
                .arg(&out)
                .output()
                .ok()?;
        }
        let bytes = std::fs::read(&out).ok()?;
        Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    })
    .await
    .ok()
    .flatten()
}

// ── Windows-only calls the UI makes: no-ops on macOS ──

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
    serde_json::json!({ "supported": false })
}
#[tauri::command]
pub fn get_brightness() -> Result<f32, String> {
    Err("unsupported".into())
}
#[tauri::command]
pub fn set_brightness() -> Result<(), String> {
    Err("unsupported".into())
}
#[tauri::command]
pub fn glass_capture() -> Result<(), String> {
    Err("unsupported".into())
}
/// macOS accent colours aren't exposed to webviews; DynIs uses its own.
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

pub fn run() {
    // Started by a browser as the "DynIs Downloads" native host: no UI.
    let all_args: Vec<String> = std::env::args().collect();
    if crate::native_host::is_host_invocation(&all_args) {
        crate::native_host::run_host(&all_args);
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![])))
        .invoke_handler(tauri::generate_handler![
            crate::platform::platform_info,
            settings::load_settings,
            settings::save_setting,
            settings::reset_settings,
            settings::settings_file_readable,
            settings::finish_onboarding,
            window::mac_display_info,
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
            get_brightness,
            set_brightness,
            glass_capture,
            get_system_accent_color,
            resize_settings_window,
        ])
        .setup(|app| {
            // No Dock icon or app switcher entry: DynIs lives in the island
            // and the menu bar icon.
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            settings::init(app.handle());
            window::setup(app.handle());
            actions::start_front_app_tracker();
            actions::cache_visible_area(app.handle());
            media::start(app.handle().clone());
            system::start_battery_events(app.handle().clone());
            crate::activities::setup(app.handle());
            std::thread::spawn(crate::native_host::register);
            tray(app.handle())?;

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

/// Menu bar icon: Settings and Quit (Open Setup until setup is done).
fn tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let label = if settings::onboarding_complete() { "Settings…" } else { "Open Setup" };
    let settings_item = MenuItem::with_id(app, "settings", label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit DynIs", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app, &[&settings_item, &quit])?;
    let mut builder = TrayIconBuilder::with_id("dynis-tray").menu(&menu).tooltip("DynIs").icon_as_template(true);
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

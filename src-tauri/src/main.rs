#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Shared by every platform.
mod activities;
#[cfg(any(test, target_os = "macos", target_os = "linux"))]
mod macparse;
#[cfg(any(test, target_os = "linux"))]
mod linuxparse;
mod native_host;
mod platform;
mod types;

// The Windows backend (DynIs 2.0, unchanged).
#[cfg(windows)]
mod battery;
#[cfg(windows)]
mod bluetooth;
#[cfg(any(windows, target_os = "linux"))]
mod browser_media;
#[cfg(windows)]
mod commands;
#[cfg(windows)]
mod diagnostics;
#[cfg(windows)]
mod dock_extras;
#[cfg(windows)]
mod media_pick;
#[cfg(windows)]
mod services;
#[cfg(windows)]
mod shelf;
#[cfg(windows)]
mod shelf_preview;
#[cfg(windows)]
mod state;
#[cfg(windows)]
mod tray;
#[cfg(windows)]
mod utils;
#[cfg(windows)]
mod wifi;
#[cfg(windows)]
mod window_region;

// The macOS backend (2.1).
#[cfg(target_os = "macos")]
mod mac;

// The Linux backend (2.1: Zorin OS, Ubuntu and other GNOME desktops).
#[cfg(target_os = "linux")]
mod linux;

#[cfg(windows)]
use std::sync::atomic::Ordering;
#[cfg(windows)]
use tauri::Manager;
#[cfg(windows)]
use windows::core::BOOL;
#[cfg(windows)]
use windows::Win32::System::Console::SetConsoleCtrlHandler;
#[cfg(windows)]
use windows::Win32::System::Console::{CTRL_BREAK_EVENT, CTRL_CLOSE_EVENT, CTRL_C_EVENT};

#[cfg(windows)]
use crate::commands::*;
#[cfg(windows)]
use crate::services::*;
#[cfg(windows)]
use crate::state::*;
#[cfg(windows)]
use crate::utils::*;

#[cfg(windows)]
unsafe extern "system" fn ctrl_handler(ctrl_type: u32) -> BOOL {
    if ctrl_type == CTRL_C_EVENT || ctrl_type == CTRL_BREAK_EVENT || ctrl_type == CTRL_CLOSE_EVENT {
        set_taskbar_visibility(true, true);
        NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
        set_native_osd_suppressed(false);
    }
    BOOL(0)
}

#[cfg(target_os = "macos")]
fn main() {
    mac::run();
}

#[cfg(target_os = "linux")]
fn main() {
    linux::run();
}

#[cfg(windows)]
fn main() {
    // Started by Brave/Chrome/Edge as the "DynIs Downloads" native host: no UI.
    let all_args: Vec<String> = std::env::args().collect();
    if native_host::is_host_invocation(&all_args) {
        native_host::run_host(&all_args);
        return;
    }
    let mut args = std::env::args_os();
    if args.nth(1).as_deref() == Some(std::ffi::OsStr::new("--taskbar-watchdog")) {
        if let (Some(pid), Some(marker)) = (args.next(), args.next()) {
            if let Ok(pid) = pid.to_string_lossy().parse::<u32>() {
                utils::run_taskbar_watchdog(pid, marker.into());
            }
        }
        return;
    }
    unsafe {
        let _ = SetConsoleCtrlHandler(Some(ctrl_handler), true);
    }

    // Single-instance enforcement
    unsafe {
        use windows::Win32::Foundation::{CloseHandle, GetLastError};
        use windows::Win32::System::Threading::{
            CreateEventW, CreateMutexW, OpenEventW, SetEvent, SYNCHRONIZATION_ACCESS_RIGHTS,
        };

        let mutex_name: Vec<u16> = "DynIsSingleInstance"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let event_name: Vec<u16> = "DynIsOpenSettings"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let h_mutex = CreateMutexW(None, true, windows::core::PCWSTR(mutex_name.as_ptr())).ok();
        let err = GetLastError();

        if err.0 == 183 {
            // Another instance is already running — signal it to open settings
            if let Ok(h_event) = OpenEventW(
                SYNCHRONIZATION_ACCESS_RIGHTS(0x00100002),
                false,
                windows::core::PCWSTR(event_name.as_ptr()),
            ) {
                let _ = SetEvent(h_event);
                let _ = CloseHandle(h_event);
            }
            if let Some(h) = h_mutex {
                let _ = CloseHandle(h);
            }
            return;
        }

        if let Ok(h_event) = CreateEventW(
            None,
            false,
            false,
            windows::core::PCWSTR(event_name.as_ptr()),
        ) {
            let _ = SINGLE_INSTANCE_EVENT_HANDLE.set(h_event.0 as isize);
        }
        if let Some(h) = h_mutex {
            let _ = SINGLE_INSTANCE_MUTEX_HANDLE.set(h.0 as isize);
        }
    }

    diagnostics::initialize();
    setup_brightness_worker();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![
            platform::platform_info,
            hide_native_osd,
            open_settings_window,
            open_wifi_settings,
            open_sound_settings,
            open_notification_center,
            open_system_tray,
            set_ignore_cursor_events,
            set_window_height,
            resize_settings_window,
            hide_overlay,
            set_splash_fullscreen,
            sync_overlay_position,
            media_play_pause,
            media_next,
            media_previous,
            media_seek,
            open_media_source_app,
            init_dock,
            toggle_dock,
            change_dock_mode,
            change_notch_mode,
            sync_appbar,
            open_app,
            launch_new_instance,
            update_dock_rect,
            update_notch_rect,
            window_region::set_window_region,
            set_dock_hovered,
            set_notch_hovered,
            set_notch_visible,
            setup_shelf_drop,
            shelf_thumbnail,
            shelf_drag_icon,
            shelf_prune,
            shelf_open,
            get_active_windows,
            get_tray_apps,
            show_tray_context_menu,
            activate_tray_icon,
            open_system_action,
            get_app_icon,
            get_installed_apps,
            save_pinned_apps,
            load_pinned_apps,
            clear_icon_cache,
            set_custom_icon,
            remove_custom_icon,
            get_custom_icons,
            set_menu_open,
            focus_window,
            focus_app_windows,
            close_window,
            quit_bloom,
            restart_bloom,
            get_volume,
            get_volume_state,
            get_brightness,
            set_volume,
            get_audio_sessions,
            set_app_volume,
            set_app_mute,
            set_volume_mixer_rect,
            clear_volume_mixer_rect,
            save_setting,
            load_settings,
            settings_file_readable,
            capture_window_thumbnail,
            get_wifi_status,
            set_wifi_state,
            get_bluetooth_state,
            set_bluetooth_state,
            open_bluetooth_settings,
            open_airplane_mode_settings,
            set_brightness,
            get_battery_saver_state,
            open_battery_saver_settings,
            battery::get_battery_details,
            get_system_accent_color,
            get_cpu_usage,
            get_ram_usage,
            get_disk_space,
            get_network_speed,
            export_settings_to_file,
            import_settings_from_file,
            reset_settings,
            dock_extras::get_dock_extras,
            dock_extras::open_dock_extra,
            dock_extras::eject_dock_extra,
            dock_extras::get_dock_drives,
            wifi::wifi_list_networks,
            wifi::wifi_scan,
            wifi::wifi_connect,
            wifi::wifi_disconnect,
            wifi::wifi_forget,
            wifi::wifi_open_settings,
            bluetooth::bluetooth_list_devices,
            bluetooth::bluetooth_set_connected,
            bluetooth::bluetooth_discovery,
            bluetooth::bluetooth_pair,
            bluetooth::bluetooth_pairing_respond,
            bluetooth::bluetooth_unpair,
            activities::activity_upsert,
            activities::activity_lift,
            activities::activity_end,
            activities::activity_presentation,
            activities::keep_awake::set_keep_awake,
            activities::keep_awake::get_keep_awake,
            activities::snap::snap_window,
            activities::notifications::notifications_status,
            activities::spotify::spotify_authorize,
            activities::spotify::spotify_store_token,
            activities::spotify::spotify_load_token,
            activities::spotify::spotify_clear_token,
            commands::clipboard_ignore_next,
            commands::media_toggle_shuffle,
            commands::media_cycle_repeat,
            commands::open_audio_output_picker,
            commands::finish_onboarding,
            activities::widgets::widget_drives,
            activities::widgets::widget_uptime,
            activities::widgets::widget_lock_pc,
            activities::widgets::widget_image,
            activities::snap::restore_foreground,
            activities::snap::focus_island,
            native_host::extension_folder,
            native_host::extension_connected,
            native_host::open_extension_install,
            native_host::detect_browsers,
            native_host::open_firefox_extension_install,
            browser_media::browser_media_command,
            browser_media::browser_media_state,
            activities::glass::glass_capture,
            activities::google_calendar::google_connect,
            activities::google_calendar::google_sign_out,
            activities::google_calendar::google_connected,
            activities::google_calendar::google_events
        ])
        .setup(|app| {
            init_taskbar_marker(app.handle());
            activities::setup(app.handle());
            // First run (or first launch of 2.0): open setup instead of the island.
            if !commands::onboarding_complete() {
                let h = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(900)).await;
                    commands::open_settings_window(h.clone());
                    if let Some(w) = h.get_webview_window("settings") {
                        let _ = w.center();
                    }
                });
            }
            std::thread::spawn(native_host::register);
            // Populate the settings cache before anything else: a webview can
            // invoke save_setting as soon as it loads, which happens before the
            // rest of this hook runs.
            crate::utils::init_settings_cache(app.handle());
            // Web media from the browser extension (needs the settings cache).
            crate::browser_media::setup(app.handle().clone());
            // Crash-recovery: if a previous session was force-killed while the native
            // taskbar was hidden, restore it now. Runs before the frontend re-hides it
            // (init_dock fires after a delay), so the flag must be removed first.
            if taskbar_marker_exists() {
                restore_taskbar_after_crash();
                NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
            }


            let window = app.get_webview_window("main").unwrap();
            // tao rebuilds the extended style from its own flags whenever one
            // changes (show, hide, ...). With its ignore-cursor flag on, every
            // rebuild keeps the notch window layered, which its window region
            // needs to stay transparent; set_click_through then drives the
            // click-through bit directly. The worst a rebuild does is make the
            // window click-through until the next cursor update.
            let _ = window.set_ignore_cursor_events(true);
            let dock_win = app.get_webview_window("dock").unwrap();
            // Same for the dock window, which has a region too.
            let _ = dock_win.set_ignore_cursor_events(true);
            if !crate::utils::dock_enabled() {
                crate::services::webview_memory_low(&dock_win, true);
            }
            if let Ok(hwnd) = dock_win.hwnd() {
                DOCK_HWND.store(hwnd.0 as isize, Ordering::Relaxed);
            }

            // Sync window rects initially and on event
            let win_clone = window.clone();
            let update_main_rect = move || {
                if let (Ok(p), Ok(s)) = (win_clone.outer_position(), win_clone.outer_size()) {
                    if let Ok(mut lock) = MAIN_WINDOW_RECT.lock() {
                        *lock = Some((p, s));
                    }
                }
            };

            let dock_clone = dock_win.clone();
            let update_dock_window_rect = move || {
                if let (Ok(p), Ok(s)) = (dock_clone.outer_position(), dock_clone.outer_size()) {
                    if let Ok(mut lock) = DOCK_WINDOW_RECT.lock() {
                        *lock = Some((p, s));
                    }
                }
            };

            update_main_rect();
            update_dock_window_rect();

            let u_main = update_main_rect.clone();
            let handle_for_events = app.handle().clone();
            window.on_window_event(move |e| match e {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    u_main();
                    sync_overlays(&handle_for_events);
                }
                tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    // Re-evaluate against the configured notch mode instead of
                    // registering unconditionally: on wake / display re-init a
                    // scale change in smart/peek mode must not reserve the top
                    // strip (issue #109).
                    let h = handle_for_events.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        reconcile_main_appbar(&h);
                        sync_overlays(&h);
                    });
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    restore_taskbar_and_exit(&handle_for_events);
                }
                _ => {}
            });

            let u_dock = update_dock_window_rect.clone();
            let dock_for_events = dock_win.clone();
            let handle_for_dock_events = app.handle().clone();
            dock_win.on_window_event(move |e| match e {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    u_dock();
                    sync_overlays(&handle_for_dock_events);
                }
                tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    let h = handle_for_dock_events.clone();
                    if DOCK_APPBAR_REGISTERED.load(Ordering::Relaxed) {
                        let w = dock_for_events.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                            register_dock_appbar(w);
                            sync_overlays(&h);
                        });
                    } else {
                        sync_overlays(&h);
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    restore_taskbar_and_exit(&handle_for_dock_events);
                }
                _ => {}
            });

            sync_overlays(app.handle());

            // Initialize the overlay window — on Windows, set_position doesn't
            // take effect on a window that has never been shown. Show it once
            // to register it with the compositor, then hide immediately.
            if let Some(ov_win) = app.get_webview_window("overlay") {
                // Layered from the start, like the notch and dock (see
                // set_click_through): the overlay has a window region too.
                let _ = ov_win.set_ignore_cursor_events(true);
                let _ = ov_win.show();
                let _ = ov_win.hide();
                let overlay_handle = app.handle().clone();
                ov_win.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        restore_taskbar_and_exit(&overlay_handle);
                    }
                });
            }

            watch_webview_processes(app.handle());
            setup_mouse_hook(app.handle().clone());
            setup_display_change_monitor(app.handle().clone());
            setup_window_change_hook(app.handle().clone());
            {
                let _ = crate::state::THUMBNAIL_CACHE
                    .set(std::sync::Mutex::new(std::collections::HashMap::new()));
                let _ = crate::state::FOCUS_TIMESTAMPS
                    .set(std::sync::Mutex::new(std::collections::HashMap::new()));
                // Initialize before the scan so its results are actually stored.
                let _ = crate::state::INSTALLED_APPS_CACHE.set(std::sync::Mutex::new(Vec::new()));
            }
            setup_thumbnail_capture(app.handle().clone());
            trigger_app_scan();
            let tx = setup_system_worker(app.handle().clone());
            let _ = COMMAND_SENDER.set(tx.clone());
            services::setup_keyboard_hook(app.handle().clone());
            setup_taskbar_hook();
            setup_audio_visualization(app.handle().clone());
            setup_settings_watcher(app.handle().clone());
            diagnostics::record("services_ready", "hooks and settings watcher initialized");
            wifi::setup_wifi_notifications(app.handle().clone());
            bluetooth::setup_bluetooth_notifications(app.handle().clone());

            // Listen for second-instance signal to open settings
            if let Some(&h_event) = SINGLE_INSTANCE_EVENT_HANDLE.get() {
                if h_event != 0 {
                    let app_handle = app.handle().clone();
                    std::thread::spawn(move || {
                        use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
                        use windows::Win32::System::Threading::{WaitForSingleObject, INFINITE};
                        let h_event = HANDLE(h_event as *mut _);
                        loop {
                            let result = unsafe { WaitForSingleObject(h_event, INFINITE) };
                            if result == WAIT_OBJECT_0 {
                                crate::commands::open_settings_window(app_handle.clone());
                            }
                        }
                    });
                }
            }

            if let Some(settings_win) = app.get_webview_window("settings") {
                #[cfg(target_os = "windows")]
                {
                    let _ = window_vibrancy::apply_mica(&settings_win, None);
                }
                let win_clone = settings_win.clone();
                settings_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                        crate::services::webview_memory_low(&win_clone, true);
                    }
                });
            }
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                // During first-run setup the tray only offers setup and quit.
                let menu = if commands::onboarding_complete() {
                    commands::full_tray_menu(app.handle())?
                } else {
                    let setup_item = MenuItem::with_id(app, "settings", "Open Setup", true, None::<&str>)?;
                    let quit_item = MenuItem::with_id(app, "quit", "Quit DynIs", true, None::<&str>)?;
                    Menu::with_items(app, &[&setup_item, &quit_item])?
                };
                let ah = app.handle().clone();
                TrayIconBuilder::with_id("dynis-tray")
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("DynIs")
                    .menu(&menu)
                    .on_menu_event(move |_, event| match event.id().as_ref() {
                        "quit" => {
                            diagnostics::record("shutdown", "source=tray");
                            SHUTTING_DOWN.store(true, Ordering::Relaxed);
                            crate::commands::release_appbars(&ah);
                            set_taskbar_visibility(true, true);
                            NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
                            set_native_osd_suppressed(false);

                            ah.exit(0);
                        }
                        "restart" => {
                            diagnostics::record("restart", "source=tray");
                            SHUTTING_DOWN.store(true, Ordering::Relaxed);
                            crate::commands::release_appbars(&ah);
                            if let Some(w) = ah.get_webview_window("settings") {
                                let _ = w.destroy();
                            }
                            set_taskbar_visibility(true, true);
                            NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
                            set_native_osd_suppressed(false);
                            close_single_instance_handles();

                            ah.restart();
                        }
                        "settings" => {
                            crate::commands::open_settings_window(ah.clone());
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            crate::commands::open_settings_window(tray.app_handle().clone());
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|_, event| {
        if let tauri::RunEvent::Exit = event {
            diagnostics::record("exit", "restoring native taskbar");
            set_taskbar_visibility(true, true);
            NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
            set_native_osd_suppressed(false);
        }
    });
}

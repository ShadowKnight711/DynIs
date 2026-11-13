//! The island window on macOS: a transparent, click-through strip across the
//! top of the main screen at status-bar level, on every Space and over
//! full-screen apps. A pointer tracker makes it clickable only while the
//! pointer is over the island (the rect the island reports), like the
//! Windows build does with its window region.

use crate::macparse::{mac_display, pointer_inside, MacDisplay};
use crate::types::IntRect;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

static NOTCH_RECT: Mutex<Option<IntRect>> = Mutex::new(None);
static HOVERED: AtomicBool = AtomicBool::new(false);
static VISIBLE: AtomicBool = AtomicBool::new(true);

/// NSStatusWindowLevel (25) + 1: above the menu bar, like the system's own
/// status items.
const ISLAND_LEVEL: isize = 26;

/// Window height in points (the same 420 pt strip as on Windows, scaled).
fn thickness(_app: &AppHandle) -> f64 {
    let scale = super::settings::get_str("bloom-scale").and_then(|s| s.parse::<f64>().ok()).unwrap_or(1.0);
    420.0 * scale.clamp(0.5, 2.0)
}

/// Main screen geometry in points (needs the main thread).
fn read_display() -> Option<MacDisplay> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    let mtm = MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;
    let frame = screen.frame();
    let insets = screen.safeAreaInsets();
    let left = screen.auxiliaryTopLeftArea();
    let right = screen.auxiliaryTopRightArea();
    Some(mac_display(frame.size.width, insets.top, left.size.width, right.size.width))
}

static DISPLAY: Mutex<Option<MacDisplay>> = Mutex::new(None);

/// `{ has_notch, notch_width, top_inset, screen_width }` for the island's
/// Classic style, which wraps the real notch.
#[tauri::command]
pub fn mac_display_info() -> Option<MacDisplay> {
    if let Some(d) = read_display() {
        *DISPLAY.lock().ok()? = Some(d.clone());
        return Some(d);
    }
    DISPLAY.lock().ok()?.clone()
}

/// Level, Spaces behaviour and no shadow. Runs on the main thread.
fn configure_ns_window(win: &WebviewWindow) {
    let w = win.clone();
    let _ = win.run_on_main_thread(move || {
        use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
        let Ok(ptr) = w.ns_window() else { return };
        if ptr.is_null() {
            return;
        }
        // SAFETY: Tauri hands out the live NSWindow of this webview window,
        // and we are on the main thread.
        let ns: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
        ns.setLevel(ISLAND_LEVEL);
        ns.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns.setHasShadow(false);
        if let Some(d) = read_display() {
            if let Ok(mut slot) = DISPLAY.lock() {
                *slot = Some(d);
            }
        }
    });
}

/// Across the top of the main screen (or the bottom, if chosen).
pub fn position(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let Ok(Some(monitor)) = win.primary_monitor() else { return };
    let scale = monitor.scale_factor();
    let (mw, mh) = (monitor.size().width as f64 / scale, monitor.size().height as f64 / scale);
    let (mx, my) = (monitor.position().x as f64 / scale, monitor.position().y as f64 / scale);
    let h = thickness(app).min(mh);
    let bottom = super::settings::get_str("bloom-notch-edge").as_deref() == Some("bottom");
    // Leave room for the Dock at the bottom.
    let y = if bottom { my + mh - h - 80.0 } else { my };
    let _ = win.set_size(tauri::LogicalSize::new(mw, h));
    let _ = win.set_position(tauri::LogicalPosition::new(mx, y));
}

pub fn setup(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_visible_on_all_workspaces(true);
    let _ = win.set_always_on_top(true);
    configure_ns_window(&win);
    position(app);
    start_pointer_tracker(app.clone());
}

/// Makes the window clickable only over the island, and tells the island
/// when the pointer leaves (the webview can't see that once it's
/// click-through). 30 checks a second near the island, 8 when far away.
fn start_pointer_tracker(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-pointer".into())
        .spawn(move || {
            let mut interactive = false;
            let mut edge = false;
            loop {
                let mut near = false;
                if let (Some(win), Ok(pointer)) = (app.get_webview_window("main"), app.cursor_position()) {
                    let rect = NOTCH_RECT.lock().ok().and_then(|r| *r);
                    let origin = win.outer_position().map(|p| (p.x as f64, p.y as f64)).unwrap_or((0.0, 0.0));
                    let scale = win.scale_factor().unwrap_or(1.0);
                    let visible = VISIBLE.load(Ordering::Relaxed);
                    let inside = visible
                        && rect.is_some_and(|r| pointer_inside((pointer.x, pointer.y), origin, scale, (r.x, r.y, r.width, r.height), 4.0));
                    near = rect.is_some_and(|r| pointer.y < origin.1 + (r.y + r.height + 150) as f64 * scale);
                    let want = inside;
                    if want != interactive {
                        interactive = want;
                        let _ = win.set_ignore_cursor_events(!want);
                        if !want {
                            let _ = app.emit_to("main", "notch-pointer-left", ());
                        }
                    }
                    // Touching the top edge above the island (peek mode).
                    let at_edge = inside && pointer.y <= origin.1 + 2.0 * scale;
                    if at_edge != edge {
                        edge = at_edge;
                        let _ = app.emit_to("main", "notch-edge-hover", at_edge);
                    }
                }
                std::thread::sleep(Duration::from_millis(if near || interactive { 33 } else { 120 }));
            }
        })
        .ok();
}

#[tauri::command]
pub fn update_notch_rect(rect: IntRect) {
    if let Ok(mut r) = NOTCH_RECT.lock() {
        *r = Some(rect);
    }
}

#[tauri::command]
pub fn set_notch_hovered(hovered: bool) {
    HOVERED.store(hovered, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_notch_visible(visible: bool) {
    VISIBLE.store(visible, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_ignore_cursor_events(window: tauri::Window, ignore: bool) {
    let _ = window.set_ignore_cursor_events(ignore);
}

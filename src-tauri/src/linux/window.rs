//! The island window on Linux (X11, or XWayland on a Wayland session): a
//! transparent, undecorated strip at the top of the primary monitor, above
//! other windows, on every workspace, not in the taskbar or Alt+Tab. It is
//! click-through except over the island (the rect the island reports), like
//! the Windows build does with its window region. It never reserves screen
//! space: Smart and Overlay only.
//!
//! Smart mode: an X11 watcher follows the focused window (EWMH properties,
//! event-driven, no polling) and emits `notch-overlap` while a full-screen
//! or maximized window covers the island's strip, so the island steps aside.

use crate::linuxparse::covers_island;
use crate::macparse::pointer_inside;
use crate::types::IntRect;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

static NOTCH_RECT: Mutex<Option<IntRect>> = Mutex::new(None);
static HOVERED: AtomicBool = AtomicBool::new(false);
static VISIBLE: AtomicBool = AtomicBool::new(true);
/// The last focused window that isn't DynIs (for Snap and giving focus back).
pub static LAST_OTHER_WINDOW: AtomicU32 = AtomicU32::new(0);

/// Window height in CSS px (the same 420 px strip as on Windows, scaled).
fn thickness() -> f64 {
    let scale = super::settings::get_str("bloom-scale").and_then(|s| s.parse::<f64>().ok()).unwrap_or(1.0);
    420.0 * scale.clamp(0.5, 2.0)
}

/// Across the top of the primary monitor (or the bottom, if chosen).
pub fn position(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let Ok(Some(monitor)) = win.primary_monitor() else { return };
    let scale = monitor.scale_factor();
    let (mw, mh) = (monitor.size().width as f64 / scale, monitor.size().height as f64 / scale);
    let (mx, my) = (monitor.position().x as f64 / scale, monitor.position().y as f64 / scale);
    let h = thickness().min(mh);
    let bottom = super::settings::get_str("bloom-notch-edge").as_deref() == Some("bottom");
    // Zorin's taskbar sits at the bottom: stay above it.
    let y = if bottom { my + mh - h - 56.0 } else { my };
    let _ = win.set_size(tauri::LogicalSize::new(mw, h));
    let _ = win.set_position(tauri::LogicalPosition::new(mx, y));
}

/// GTK hints: not in the taskbar or the workspace switcher, no focus on map,
/// and a utility window so the window manager keeps it out of Alt+Tab.
fn configure_gtk(win: &WebviewWindow) {
    let w = win.clone();
    let _ = win.run_on_main_thread(move || {
        use gtk::prelude::GtkWindowExt;
        if let Ok(gw) = w.gtk_window() {
            gw.set_skip_taskbar_hint(true);
            gw.set_skip_pager_hint(true);
            gw.set_focus_on_map(false);
            gw.set_keep_above(true);
            gw.set_type_hint(gtk::gdk::WindowTypeHint::Utility);
        }
    });
}

pub fn setup(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let _ = win.set_decorations(false);
    let _ = win.set_shadow(false);
    let _ = win.set_skip_taskbar(true);
    let _ = win.set_always_on_top(true);
    let _ = win.set_visible_on_all_workspaces(true);
    // Click-through is applied by the pointer tracker once the window is on
    // screen: GTK has no input region before the window is realized (tao
    // would panic).
    configure_gtk(&win);
    position(app);
    start_pointer_tracker(app.clone());
    start_overlap_watcher(app.clone());
}

/// Click-through on or off, only while the window is on screen (a hidden,
/// unrealized GTK window has no input region to change).
pub fn set_click_through(win: &WebviewWindow, through: bool) -> bool {
    if !win.is_visible().unwrap_or(false) {
        return false;
    }
    win.set_ignore_cursor_events(through).is_ok()
}

/// Makes the window clickable only over the island, and tells the island
/// when the pointer leaves (the webview can't see that once it's
/// click-through). 30 checks a second near the island, 8 when far away.
fn start_pointer_tracker(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-pointer".into())
        .spawn(move || {
            let mut interactive = false;
            // What the window currently has (None = not applied yet).
            let mut applied: Option<bool> = None;
            let mut edge = false;
            loop {
                let mut near = false;
                if let Some(win) = app.get_webview_window("main") {
                    if !win.is_visible().unwrap_or(false) {
                        applied = None;
                    } else if applied != Some(interactive) && set_click_through(&win, !interactive) {
                        applied = Some(interactive);
                    }
                }
                if let (Some(win), Ok(pointer)) = (app.get_webview_window("main"), app.cursor_position()) {
                    let rect = NOTCH_RECT.lock().ok().and_then(|r| *r);
                    let origin = win.outer_position().map(|p| (p.x as f64, p.y as f64)).unwrap_or((0.0, 0.0));
                    let scale = win.scale_factor().unwrap_or(1.0);
                    let visible = VISIBLE.load(Ordering::Relaxed);
                    let inside = visible
                        && rect.is_some_and(|r| pointer_inside((pointer.x, pointer.y), origin, scale, (r.x, r.y, r.width, r.height), 4.0));
                    near = rect.is_some_and(|r| pointer.y < origin.1 + (r.y + r.height + 150) as f64 * scale);
                    if inside != interactive {
                        interactive = inside;
                        if set_click_through(&win, !inside) {
                            applied = Some(inside);
                        }
                        if !inside {
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

// ── X11 (EWMH) helpers, shared with Snap and focus ──

pub mod x11 {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        AtomEnum, ChangeWindowAttributesAux, ClientMessageEvent, ConnectionExt, EventMask, Window,
    };
    use x11rb::rust_connection::RustConnection;

    pub struct X {
        pub conn: RustConnection,
        pub root: Window,
    }

    impl X {
        pub fn open() -> Option<X> {
            let (conn, screen) = x11rb::connect(None).ok()?;
            let root = conn.setup().roots.get(screen)?.root;
            Some(X { conn, root })
        }

        pub fn atom(&self, name: &str) -> u32 {
            self.conn
                .intern_atom(false, name.as_bytes())
                .ok()
                .and_then(|c| c.reply().ok())
                .map(|r| r.atom)
                .unwrap_or(0)
        }

        fn prop32(&self, win: Window, name: &str, kind: AtomEnum) -> Vec<u32> {
            let atom = self.atom(name);
            self.conn
                .get_property(false, win, atom, kind, 0, 1024)
                .ok()
                .and_then(|c| c.reply().ok())
                .and_then(|r| r.value32().map(|v| v.collect()))
                .unwrap_or_default()
        }

        pub fn active_window(&self) -> Option<Window> {
            self.prop32(self.root, "_NET_ACTIVE_WINDOW", AtomEnum::WINDOW).first().copied().filter(|w| *w != 0)
        }

        pub fn pid(&self, win: Window) -> Option<u32> {
            self.prop32(win, "_NET_WM_PID", AtomEnum::CARDINAL).first().copied()
        }

        pub fn states(&self, win: Window) -> Vec<String> {
            self.prop32(win, "_NET_WM_STATE", AtomEnum::ATOM)
                .into_iter()
                .filter_map(|a| self.conn.get_atom_name(a).ok()?.reply().ok())
                .map(|r| String::from_utf8_lossy(&r.name).into_owned())
                .collect()
        }

        /// The window's client area on the root window: (x, y, width, height).
        pub fn geometry(&self, win: Window) -> Option<(i32, i32, i32, i32)> {
            let g = self.conn.get_geometry(win).ok()?.reply().ok()?;
            let t = self.conn.translate_coordinates(win, self.root, 0, 0).ok()?.reply().ok()?;
            Some((t.dst_x as i32, t.dst_y as i32, g.width as i32, g.height as i32))
        }

        /// The usable area of the current workspace (no panels): x, y, w, h.
        pub fn work_area(&self) -> Option<(i32, i32, i32, i32)> {
            let v = self.prop32(self.root, "_NET_WORKAREA", AtomEnum::CARDINAL);
            (v.len() >= 4).then(|| (v[0] as i32, v[1] as i32, v[2] as i32, v[3] as i32))
        }

        /// Get property-change events from `win`.
        pub fn watch(&self, win: Window) {
            let _ = self
                .conn
                .change_window_attributes(win, &ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE));
            let _ = self.conn.flush();
        }

        fn client_message(&self, win: Window, name: &str, data: [u32; 5]) {
            let ev = ClientMessageEvent::new(32, win, self.atom(name), data);
            let _ = self.conn.send_event(
                false,
                self.root,
                EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                ev,
            );
            let _ = self.conn.flush();
        }

        /// Brings a window to the front (as a pager would, source 2).
        pub fn activate(&self, win: Window) {
            self.client_message(win, "_NET_ACTIVE_WINDOW", [2, 0, 0, 0, 0]);
        }

        /// Un-maximizes a window and moves/resizes its frame.
        pub fn move_resize(&self, win: Window, x: i32, y: i32, w: i32, h: i32) {
            let vert = self.atom("_NET_WM_STATE_MAXIMIZED_VERT");
            let horz = self.atom("_NET_WM_STATE_MAXIMIZED_HORZ");
            let full = self.atom("_NET_WM_STATE_FULLSCREEN");
            // _NET_WM_STATE_REMOVE = 0
            self.client_message(win, "_NET_WM_STATE", [0, vert, horz, 2, 0]);
            self.client_message(win, "_NET_WM_STATE", [0, full, 0, 2, 0]);
            // Flags: x, y, width, height set (bits 8–11), source 2 (bits 12–13), gravity static (10).
            let flags = 10 | (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11) | (2 << 12);
            self.client_message(win, "_NET_MOVERESIZE_WINDOW", [flags, x as u32, y as u32, w.max(1) as u32, h.max(1) as u32]);
        }
    }
}

/// Follows the focused window and reports when it covers the island's strip
/// (Smart mode hides the island then). Event-driven: it waits for X11
/// property changes on the root window and the focused window.
fn start_overlap_watcher(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-overlap".into())
        .spawn(move || {
            let Some(x) = x11::X::open() else { return };
            let me = std::process::id();
            x.watch(x.root);
            let mut watched = 0u32;
            let mut last: Option<bool> = None;
            loop {
                let active = x.active_window();
                if let Some(w) = active {
                    if w != watched {
                        x.watch(w);
                        watched = w;
                    }
                }
                let mine = active.and_then(|w| x.pid(w)) == Some(me);
                if let Some(w) = active.filter(|_| !mine) {
                    LAST_OTHER_WINDOW.store(w, Ordering::Relaxed);
                }
                // While DynIs itself is focused (typing in the island) keep the last answer.
                if !mine {
                    let covered = active.is_some_and(|w| {
                        let states = x.states(w);
                        let refs: Vec<&str> = states.iter().map(String::as_str).collect();
                        let screen = app
                            .get_webview_window("main")
                            .and_then(|m| m.primary_monitor().ok().flatten())
                            .map(|m| (m.position().x, m.position().y, m.size().width as i32, m.size().height as i32))
                            .unwrap_or((0, 0, 1920, 1080));
                        x.geometry(w).is_some_and(|g| covers_island(&refs, g, screen, 40))
                    });
                    if last != Some(covered) {
                        last = Some(covered);
                        let _ = app.emit("notch-overlap", covered);
                    }
                }
                // Wait for the next property change (focus, maximize, fullscreen).
                use x11rb::connection::Connection;
                if x.conn.wait_for_event().is_err() {
                    return;
                }
                // Drain bursts so one change is handled once.
                while let Ok(Some(_)) = x.conn.poll_for_event() {}
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
    if window.is_visible().unwrap_or(false) {
        let _ = window.set_ignore_cursor_events(ignore);
    }
}

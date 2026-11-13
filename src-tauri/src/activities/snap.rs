//! Snap window: places the active window (the one in front of DynIs) into a
//! layout on its monitor's work area.

use serde::Deserialize;
use std::sync::atomic::{AtomicIsize, Ordering};

/// The window that was in front before DynIs took focus (command search).
static LAST_FOREGROUND: AtomicIsize = AtomicIsize::new(0);

pub fn remember_foreground() {
    unsafe {
        let hwnd = windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow();
        let mut pid = 0u32;
        windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if !hwnd.0.is_null() && pid != std::process::id() {
            LAST_FOREGROUND.store(hwnd.0 as isize, Ordering::Relaxed);
        }
    }
}

/// Gives focus back to the window that had it before command search.
#[tauri::command]
pub fn restore_foreground() {
    let raw = LAST_FOREGROUND.load(Ordering::Relaxed);
    if raw != 0 {
        unsafe {
            let _ = windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(
                windows::Win32::Foundation::HWND(raw as *mut _),
            );
        }
    }
}

/// Lets the island take keyboard focus (command search, to-dos).
#[tauri::command]
pub fn focus_island(window: tauri::WebviewWindow) {
    let _ = window.set_focus();
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let _ = windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(hwnd);
        }
    }
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum SnapLayout {
    Left,
    Right,
    Full,
    Center,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// Target rect (x, y, w, h) inside a work area (x, y, w, h).
pub fn snap_rect(layout: SnapLayout, area: (i32, i32, i32, i32)) -> (i32, i32, i32, i32) {
    let (x, y, w, h) = area;
    let (hw, hh) = (w / 2, h / 2);
    match layout {
        SnapLayout::Left => (x, y, hw, h),
        SnapLayout::Right => (x + w - hw, y, hw, h),
        SnapLayout::Full => (x, y, w, h),
        SnapLayout::Center => {
            let cw = w * 2 / 3;
            let ch = h * 3 / 4;
            (x + (w - cw) / 2, y + (h - ch) / 2, cw, ch)
        }
        SnapLayout::TopLeft => (x, y, hw, hh),
        SnapLayout::TopRight => (x + w - hw, y, hw, hh),
        SnapLayout::BottomLeft => (x, y + h - hh, hw, hh),
        SnapLayout::BottomRight => (x + w - hw, y + h - hh, hw, hh),
    }
}

#[tauri::command]
pub fn snap_window(layout: SnapLayout) -> Result<(), String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetWindowPos, ShowWindow, SWP_NOACTIVATE,
        SWP_NOZORDER, SW_MAXIMIZE, SW_RESTORE,
    };
    unsafe {
        let mut hwnd = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if hwnd.0.is_null() || pid == std::process::id() {
            // DynIs has focus (command search): use the window it took it from.
            let raw = LAST_FOREGROUND.load(Ordering::Relaxed);
            if raw == 0 {
                return Err("Click the window you want to snap first.".into());
            }
            hwnd = windows::Win32::Foundation::HWND(raw as *mut _);
        }
        if layout == SnapLayout::Full {
            let _ = ShowWindow(hwnd, SW_MAXIMIZE);
            return Ok(());
        }
        let _ = ShowWindow(hwnd, SW_RESTORE);
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return Err("Couldn't read the monitor.".into());
        }
        let RECT { left, top, right, bottom } = info.rcWork;
        let (x, y, w, h) = snap_rect(layout, (left, top, right - left, bottom - top));
        SetWindowPos(hwnd, None, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halves_and_quarters_tile_the_work_area() {
        let area = (0, 0, 1920, 1040);
        assert_eq!(snap_rect(SnapLayout::Left, area), (0, 0, 960, 1040));
        assert_eq!(snap_rect(SnapLayout::Right, area), (960, 0, 960, 1040));
        assert_eq!(snap_rect(SnapLayout::BottomRight, area), (960, 520, 960, 520));
        assert_eq!(snap_rect(SnapLayout::Center, area), (320, 130, 1280, 780));
    }
}

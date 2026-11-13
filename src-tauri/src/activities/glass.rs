//! Live blur for the "Glass (live blur)" material.
//!
//! While that material is selected, the island window is excluded from screen
//! capture (SetWindowDisplayAffinity / WDA_EXCLUDEFROMCAPTURE) so DynIs can
//! read the screen *behind* itself. About 30 times a second it copies just the
//! area under the island at a quarter of its size and sends it to the island,
//! which blurs it. Nothing is stored or sent anywhere.
//!
//! Trade-off (shown in Settings): an excluded window is also missing from
//! screenshots, recordings and screen sharing.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

static EXCLUDED: AtomicBool = AtomicBool::new(false);

/// Downscale factor: the blur hides the detail anyway.
pub const SCALE_DOWN: i32 = 4;

pub fn live_blur_enabled() -> bool {
    crate::utils::get_setting_str_static("bloom-island-material").as_deref() == Some("glass-live")
        && crate::utils::get_setting_str_static("bloom-island-style").as_deref() != Some("notch")
}

fn set_excluded(app: &AppHandle, exclude: bool) {
    if EXCLUDED.load(Ordering::Relaxed) == exclude {
        return;
    }
    let Some(hwnd) = app.get_webview_window("main").and_then(|w| w.hwnd().ok()) else { return };
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
    let result = unsafe { SetWindowDisplayAffinity(hwnd, if exclude { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE }) };
    // Only count as excluded once Windows accepted it: capturing without the
    // exclusion would capture the island itself.
    match result {
        Ok(()) => EXCLUDED.store(exclude, Ordering::Relaxed),
        Err(e) => {
            static REPORTED: AtomicBool = AtomicBool::new(false);
            if !REPORTED.swap(true, Ordering::Relaxed) {
                crate::diagnostics::record("live_blur", &format!("display affinity failed: {e}"));
            }
        }
    }
}

/// BGRA (bottom-up DIB rows already flipped by a negative height) → RGBA.
pub fn bgra_to_rgba(pixels: &mut [u8]) {
    for px in pixels.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
        px[3] = 255;
    }
}

/// Copies the screen rect (x, y, w, h) at 1/SCALE_DOWN size.
fn grab(x: i32, y: i32, w: i32, h: i32) -> Option<(i32, i32, Vec<u8>)> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
        SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        COLORONCOLOR, SRCCOPY,
    };
    let (tw, th) = ((w / SCALE_DOWN).max(1), (h / SCALE_DOWN).max(1));
    unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, tw, th);
        let old = SelectObject(mem, bmp.into());
        // Plain decimation: the island blurs the image anyway.
        SetStretchBltMode(mem, COLORONCOLOR);
        let ok = StretchBlt(mem, 0, 0, tw, th, Some(screen), x, y, w, h, SRCCOPY).as_bool();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: tw,
                biHeight: -th,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (tw * th * 4) as usize];
        // GetDIBits needs the bitmap deselected from the DC first.
        SelectObject(mem, old);
        let lines = if ok {
            GetDIBits(mem, bmp, 0, th as u32, Some(pixels.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS)
        } else {
            0
        };
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if lines == 0 {
            return None;
        }
        bgra_to_rgba(&mut pixels);
        Some((tw, th, pixels))
    }
}

/// Keeps the capture exclusion in line with the setting. The frames
/// themselves are pulled by the island (`glass_capture`), so nothing is
/// captured unless the island is on screen and asking.
pub fn setup(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-live-blur".into())
        .spawn(move || loop {
            set_excluded(&app, live_blur_enabled());
            std::thread::sleep(std::time::Duration::from_millis(700));
        })
        .ok();
}

/// Apply the capture exclusion right away after the material or style
/// changes, so live blur draws its first frame without waiting for the
/// background loop's next tick.
pub fn sync_now(app: &AppHandle) {
    set_excluded(app, live_blur_enabled());
}

/// One frame of the screen behind the island: 8 header bytes (width, height
/// as little-endian u32) then RGBA pixels. Empty when live blur is off, the
/// island is hidden, or a fullscreen app is in front.
#[tauri::command]
pub fn glass_capture(app: AppHandle) -> tauri::ipc::Response {
    use std::sync::atomic::Ordering::Relaxed;
    let empty = || tauri::ipc::Response::new(Vec::<u8>::new());
    if !live_blur_enabled()
        || !EXCLUDED.load(Relaxed)
        || !crate::state::NOTCH_IS_VISIBLE.load(Relaxed)
        || crate::state::CURRENT_FOREGROUND_FULLSCREEN.load(Relaxed)
    {
        return empty();
    }
    let rect = crate::state::MAIN_WINDOW_RECT.lock().ok().and_then(|g| *g);
    let notch = crate::state::NOTCH_RECT.lock().ok().and_then(|g| *g);
    let scale = app
        .get_webview_window("main")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0);
    let (Some((pos, _)), Some(r)) = (rect, notch) else { return empty() };
    let margin = (16.0 * scale) as i32;
    let x = pos.x + (r.x as f64 * scale) as i32 - margin;
    let y = pos.y + (r.y as f64 * scale) as i32 - margin;
    let w = (r.width as f64 * scale) as i32 + margin * 2;
    let h = (r.height as f64 * scale) as i32 + margin * 2;
    if w <= 0 || h <= 0 {
        return empty();
    }
    match grab(x, y, w, h) {
        Some((tw, th, pixels)) => {
            let mut out = Vec::with_capacity(8 + pixels.len());
            out.extend_from_slice(&(tw as u32).to_le_bytes());
            out.extend_from_slice(&(th as u32).to_le_bytes());
            out.extend_from_slice(&pixels);
            tauri::ipc::Response::new(out)
        }
        None => empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Measures one capture of a 680×332 area (run with --ignored --nocapture).
    #[test]
    #[ignore]
    fn measure_grab_cost() {
        let start = std::time::Instant::now();
        let n = 60;
        for _ in 0..n {
            let (w, h, px) = grab(600, 0, 680, 332).expect("grab");
            let lit = px.chunks(4).filter(|c| c[0] as u32 + c[1] as u32 + c[2] as u32 > 30).count();
            assert!(lit > 0, "captured an all-black frame");
            assert!(w > 0 && h > 0);
        }
        let per = start.elapsed().as_secs_f64() * 1000.0 / n as f64;
        println!("per frame: {per:.2} ms; at 30 fps that is {:.1}% of one core", per * 30.0 / 10.0);
    }

    #[test]
    fn converts_bgra_to_opaque_rgba() {
        let mut px = vec![10, 20, 30, 0, 1, 2, 3, 0];
        bgra_to_rgba(&mut px);
        assert_eq!(px, vec![30, 20, 10, 255, 3, 2, 1, 255]);
    }
}

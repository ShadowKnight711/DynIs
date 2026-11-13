//! Clipboard → Shelf: when on (off by default), text and files you copy are
//! handed to the island, which adds them to the shelf and shows a short
//! "Copied to the shelf" activity.
//!
//! Copies that apps mark as private are skipped: password managers set the
//! "ExcludeClipboardContentFromMonitorProcessing" format, or
//! "CanIncludeInClipboardHistory" to 0, exactly so clipboard monitors ignore
//! them.

use super::module_enabled;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Captured {
    text: Option<String>,
    files: Vec<String>,
    /// The files are a copied image DynIs saved (in the clips folder).
    image: bool,
}

/// Wraps a clipboard DIB in a BMP file header and saves it. Returns the path.
fn save_bmp(dib: &[u8]) -> Option<String> {
    if dib.len() < 40 {
        return None;
    }
    let header_size = u32::from_le_bytes(dib[0..4].try_into().ok()?);
    let bit_count = u16::from_le_bytes(dib[14..16].try_into().ok()?);
    let compression = u32::from_le_bytes(dib[16..20].try_into().ok()?);
    let colors_used = u32::from_le_bytes(dib[32..36].try_into().ok()?);
    let palette = if bit_count <= 8 {
        (if colors_used == 0 { 1u32 << bit_count } else { colors_used }) * 4
    } else if compression == 3 && header_size == 40 {
        12 // BI_BITFIELDS masks follow a 40-byte header
    } else {
        0
    };
    let offset = 14 + header_size + palette;
    let mut file = Vec::with_capacity(dib.len() + 14);
    file.extend_from_slice(b"BM");
    file.extend_from_slice(&((dib.len() + 14) as u32).to_le_bytes());
    file.extend_from_slice(&[0, 0, 0, 0]);
    file.extend_from_slice(&offset.to_le_bytes());
    file.extend_from_slice(dib);
    let dir = std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("com.kevin.dynis").join("clips");
    std::fs::create_dir_all(&dir).ok()?;
    let name = format!("Copied image {}.bmp", super::now_ms());
    let path = dir.join(name);
    std::fs::write(&path, file).ok()?;
    Some(path.to_string_lossy().to_string())
}

/// Reads the clipboard, or None when it is private, unreadable or empty.
fn read_clipboard() -> Option<Captured> {
    use windows::core::w;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
        RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::System::Ole::{CF_DIB, CF_HDROP, CF_UNICODETEXT};
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

    unsafe {
        let exclude = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
        let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        if !opened {
            return None;
        }
        let result = (|| {
            if exclude != 0 && IsClipboardFormatAvailable(exclude).is_ok() {
                return None;
            }
            if history != 0 && IsClipboardFormatAvailable(history).is_ok() {
                if let Ok(handle) = GetClipboardData(history) {
                    let mem = HGLOBAL(handle.0);
                    let ptr = GlobalLock(mem) as *const u32;
                    let allowed = ptr.is_null() || *ptr != 0;
                    let _ = GlobalUnlock(mem);
                    if !allowed {
                        return None;
                    }
                }
            }
            if IsClipboardFormatAvailable(CF_DIB.0 as u32).is_ok()
                && IsClipboardFormatAvailable(CF_HDROP.0 as u32).is_err()
            {
                let handle = GetClipboardData(CF_DIB.0 as u32).ok()?;
                let mem = HGLOBAL(handle.0);
                let ptr = GlobalLock(mem) as *const u8;
                if ptr.is_null() {
                    return None;
                }
                let size = GlobalSize(mem);
                let dib = std::slice::from_raw_parts(ptr, size).to_vec();
                let _ = GlobalUnlock(mem);
                let path = save_bmp(&dib)?;
                return Some(Captured { text: None, files: vec![path], image: true });
            }
            if IsClipboardFormatAvailable(CF_HDROP.0 as u32).is_ok() {
                let handle: HANDLE = GetClipboardData(CF_HDROP.0 as u32).ok()?;
                let drop = HDROP(handle.0);
                let count = DragQueryFileW(drop, u32::MAX, None);
                let mut files = Vec::new();
                for i in 0..count {
                    let len = DragQueryFileW(drop, i, None) as usize;
                    let mut buf = vec![0u16; len + 1];
                    DragQueryFileW(drop, i, Some(&mut buf));
                    files.push(String::from_utf16_lossy(&buf[..len]));
                }
                return (!files.is_empty()).then_some(Captured { text: None, files, image: false });
            }
            if IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32).is_ok() {
                let handle = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
                let mem = HGLOBAL(handle.0);
                let ptr = GlobalLock(mem) as *const u16;
                if ptr.is_null() {
                    return None;
                }
                let max = GlobalSize(mem) / 2;
                let slice = std::slice::from_raw_parts(ptr, max);
                let len = slice.iter().position(|&c| c == 0).unwrap_or(max);
                let text = String::from_utf16_lossy(&slice[..len]);
                let _ = GlobalUnlock(mem);
                let trimmed = text.trim();
                if trimmed.is_empty() || trimmed.len() > 20_000 {
                    return None;
                }
                return Some(Captured { text: Some(text), files: Vec::new(), image: false });
            }
            None
        })();
        let _ = CloseClipboard();
        result
    }
}

pub fn setup(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-clipboard".into())
        .spawn(move || {
            use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
            let mut last = unsafe { GetClipboardSequenceNumber() };
            loop {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let seq = unsafe { GetClipboardSequenceNumber() };
                if seq == last {
                    continue;
                }
                last = seq;
                // Off by default: the clipboard is only read when enabled.
                if !module_enabled("bloom-activity-clipboard", false) {
                    continue;
                }
                // DynIs's own copies (from the shelf) must not loop back in.
                if crate::state::SHELF_COPYING.swap(false, std::sync::atomic::Ordering::Relaxed) {
                    continue;
                }
                if let Some(captured) = read_clipboard() {
                    let _ = app.emit("clipboard-captured", captured);
                }
            }
        })
        .ok();
}

//! Small read-only helpers for the Home → Widgets tab.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub root: String,
    pub free: u64,
    pub total: u64,
}

/// Fixed drives with their free and total space.
#[tauri::command]
pub fn widget_drives() -> Vec<Drive> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives};
    const DRIVE_FIXED: u32 = 3;
    let mask = unsafe { GetLogicalDrives() };
    (0..26u32)
        .filter(|i| mask & (1 << i) != 0)
        .filter_map(|i| {
            let root = format!("{}:\\", (b'A' + i as u8) as char);
            let h = HSTRING::from(root.as_str());
            if unsafe { GetDriveTypeW(&h) } != DRIVE_FIXED {
                return None;
            }
            let (mut free, mut total) = (0u64, 0u64);
            unsafe { GetDiskFreeSpaceExW(&h, Some(&mut free), Some(&mut total), None).ok()? };
            Some(Drive { root, free, total })
        })
        .collect()
}

/// Milliseconds since Windows started.
#[tauri::command]
pub fn widget_uptime() -> u64 {
    unsafe { windows::Win32::System::SystemInformation::GetTickCount64() }
}

/// Locks the PC (same as Win+L).
#[tauri::command]
pub fn widget_lock_pc() {
    unsafe {
        let _ = windows::Win32::System::Shutdown::LockWorkStation();
    }
}

/// An image file as a data URL for the Photo widget (images only, ≤ 8 MB).
#[tauri::command]
pub fn widget_image(path: String) -> Result<String, String> {
    use base64::Engine;
    let lower = path.to_lowercase();
    let mime = [("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp"), ("bmp", "image/bmp")]
        .iter()
        .find(|(ext, _)| lower.ends_with(&format!(".{ext}")))
        .map(|(_, m)| *m)
        .ok_or("Pick a PNG, JPG, GIF, WebP or BMP image.")?;
    let meta = std::fs::metadata(&path).map_err(|_| "That image can't be opened.".to_string())?;
    if meta.len() > 8 * 1024 * 1024 {
        return Err("Pick an image smaller than 8 MB.".into());
    }
    let bytes = std::fs::read(&path).map_err(|_| "That image can't be opened.".to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_images() {
        assert!(widget_image("C:\\notes.txt".into()).is_err());
    }

    #[test]
    fn lists_at_least_the_system_drive() {
        assert!(widget_drives().iter().any(|d| d.total > 0));
    }
}

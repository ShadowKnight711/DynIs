//! Small helpers that shared modules (Google Calendar, Spotify, the activity
//! registry, the downloads native host) need on every platform.
//!
//! Windows keeps the exact calls DynIs 2.0 made (Credential Manager,
//! ShellExecute, the settings cache in `utils`). macOS uses the Keychain, the
//! `open` command and the mac settings store.

#[cfg(windows)]
mod windows_impl;
#[cfg(windows)]
pub use windows_impl::*;

#[cfg(target_os = "macos")]
mod macos_impl;
#[cfg(target_os = "macos")]
pub use macos_impl::*;

#[cfg(target_os = "linux")]
mod linux_impl;
#[cfg(target_os = "linux")]
pub use linux_impl::*;

/// Which features this platform can offer. The UI hides anything not listed
/// (setup steps, Settings rows, widgets, Control Center tiles).
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct PlatformInfo {
    pub os: &'static str,
    pub features: Vec<&'static str>,
}

pub fn platform_features() -> PlatformInfo {
    #[cfg(windows)]
    let (os, features) = (
        "windows",
        vec![
            "media", "battery", "headphones", "notifications", "downloads", "idm", "keep-awake", "snap",
            "clipboard", "stats", "volume", "brightness", "wifi", "bluetooth", "dock", "live-blur",
            "app-volume", "lock", "screenshot", "calendar", "spotify",
        ],
    );
    #[cfg(target_os = "macos")]
    let (os, features) = (
        "macos",
        vec![
            "media", "battery", "headphones", "downloads", "keep-awake", "snap", "clipboard", "stats",
            "volume", "lock", "screenshot", "calendar", "spotify",
        ],
    );
    // Linux (2.1): no IDM, live blur, DynIs dock, Wi-Fi/Bluetooth panels or
    // per-app volume; the rest has a Linux backend (see crate::linux).
    #[cfg(target_os = "linux")]
    let (os, features) = (
        "linux",
        vec![
            "media", "battery", "headphones", "notifications", "downloads", "keep-awake", "snap", "clipboard",
            "stats", "volume", "brightness", "lock", "screenshot", "calendar", "spotify",
        ],
    );
    PlatformInfo { os, features }
}

/// `{ os, features }` for the UI.
#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    platform_features()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_keeps_every_feature_and_mac_hides_the_rest() {
        let info = platform_features();
        assert!(info.features.contains(&"media") && info.features.contains(&"spotify"));
        #[cfg(windows)]
        {
            assert_eq!(info.os, "windows");
            for f in ["notifications", "idm", "live-blur", "dock", "brightness"] {
                assert!(info.features.contains(&f), "{f}");
            }
        }
        #[cfg(target_os = "macos")]
        for f in ["notifications", "idm", "live-blur", "dock", "brightness"] {
            assert!(!info.features.contains(&f), "{f}");
        }
    }
}

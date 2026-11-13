//! macOS: Keychain (Security framework via `keyring`), `open`, and the mac
//! settings store.

use std::process::Command;

/// Opens a URL in the default browser.
pub fn open_url(url: &str) {
    let _ = Command::new("/usr/bin/open").arg(url).spawn();
}

const SERVICE: &str = "DynIs";

fn entry(target: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, target).map_err(|e| e.to_string())
}

/// Keychain generic password: service "DynIs", account = target. Uses the
/// Security framework directly, so the secret never appears in a command line.
pub fn cred_write(target: &str, secret: &str) -> Result<(), String> {
    entry(target)?.set_password(secret).map_err(|e| e.to_string())
}

pub fn cred_read(target: &str) -> Option<String> {
    entry(target).ok()?.get_password().ok()
}

pub fn cred_delete(target: &str) {
    if let Ok(e) = entry(target) {
        let _ = e.delete_credential();
    }
}

/// A string setting from the mac settings store.
pub fn setting_str(key: &str) -> Option<String> {
    crate::mac::settings::get_str(key)
}

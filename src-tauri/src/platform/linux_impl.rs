//! Linux: the Secret Service (GNOME Keyring, via `keyring`) for sign-in
//! tokens, `xdg-open` for links, and the Linux settings store.

use std::process::Command;

/// Opens a URL in the default browser.
pub fn open_url(url: &str) {
    let _ = Command::new("xdg-open").arg(url).spawn();
}

const SERVICE: &str = "DynIs";

fn entry(target: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, target).map_err(|e| e.to_string())
}

/// A Secret Service item: service "DynIs", user = target (GNOME Keyring
/// unlocks it with the login). The secret never appears in a command line.
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

/// A string setting from the Linux settings store.
pub fn setting_str(key: &str) -> Option<String> {
    crate::linux::settings::get_str(key)
}

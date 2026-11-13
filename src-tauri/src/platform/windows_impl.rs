//! Windows: the same calls DynIs 2.0 made inline in each module.

/// Opens a URL in the default browser.
pub fn open_url(url: &str) {
    let wide: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    unsafe {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        ShellExecuteW(None, windows::core::w!("open"), PCWSTR(wide.as_ptr()), None, None, SW_SHOWNORMAL);
    }
}

fn wide(target: &str) -> Vec<u16> {
    target.encode_utf16().chain(Some(0)).collect()
}

/// Credential Manager (generic credential, local machine persistence).
pub fn cred_write(target: &str, secret: &str) -> Result<(), String> {
    use windows::core::PWSTR;
    use windows::Win32::Security::Credentials::{CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC};
    let mut t = wide(target);
    let mut blob = secret.as_bytes().to_vec();
    let cred = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(t.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    unsafe { CredWriteW(&cred, 0).map_err(|e| e.to_string()) }
}

pub fn cred_read(target: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};
    let t = wide(target);
    unsafe {
        let mut ptr: *mut CREDENTIALW = std::ptr::null_mut();
        CredReadW(PCWSTR(t.as_ptr()), CRED_TYPE_GENERIC, None, &mut ptr).ok()?;
        let c = &*ptr;
        let s = String::from_utf8_lossy(std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize)).to_string();
        CredFree(ptr as *const _);
        Some(s)
    }
}

pub fn cred_delete(target: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
    let t = wide(target);
    unsafe {
        let _ = CredDeleteW(PCWSTR(t.as_ptr()), CRED_TYPE_GENERIC, None);
    }
}

/// A string setting from the settings cache.
pub fn setting_str(key: &str) -> Option<String> {
    crate::utils::get_setting_str_static(key)
}

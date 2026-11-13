//! Internet Download Manager (IDM) downloads, read-only.
//!
//! IDM has no public progress API, but for every download it keeps an entry
//! under HKCU\Software\DownloadManager\<n> with the file name, total size and
//! its temporary folder (LocalPath), where it writes the parts while
//! downloading. DynIs reads those entries and sums the temporary folder's
//! size to get exact progress and speed. When the folder disappears after
//! growing, IDM has finished and moved the file. IDM and its settings are
//! never modified.

use super::{end, lift, module_enabled, now_ms, upsert, Activity};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;

const ROOT: &str = "Software\\DownloadManager";
/// IDM's "complete" status.
const STATUS_COMPLETE: u32 = 3;

#[derive(Debug, Clone)]
pub struct IdmEntry {
    pub id: String,
    pub name: String,
    pub total: Option<u64>,
    pub temp_dir: PathBuf,
    #[cfg_attr(not(test), allow(dead_code))]
    pub status: u32,
}

/// Total size from IDM's 8-byte little-endian REG_BINARY value.
pub fn parse_size(raw: &[u8]) -> Option<u64> {
    (raw.len() >= 8).then(|| u64::from_le_bytes(raw[..8].try_into().unwrap())).filter(|s| *s > 0)
}

mod reg {
    use windows::core::{HSTRING, PCWSTR, PWSTR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        REG_VALUE_TYPE,
    };

    pub struct Key(pub HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    pub fn open(path: &str) -> Option<Key> {
        let mut key = HKEY::default();
        unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(path), None, KEY_READ, &mut key).ok().ok()? };
        Some(Key(key))
    }

    pub fn subkeys(key: &Key) -> Vec<String> {
        let mut out = Vec::new();
        for i in 0.. {
            let mut buf = [0u16; 256];
            let mut len = buf.len() as u32;
            let r = unsafe {
                RegEnumKeyExW(key.0, i, Some(PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None)
            };
            if r.is_err() {
                break;
            }
            out.push(String::from_utf16_lossy(&buf[..len as usize]));
        }
        out
    }

    pub fn raw(key: &Key, name: &str) -> Option<(u32, Vec<u8>)> {
        let name = HSTRING::from(name);
        let mut kind = REG_VALUE_TYPE::default();
        let mut size = 0u32;
        unsafe {
            RegQueryValueExW(key.0, PCWSTR(name.as_ptr()), None, Some(&mut kind), None, Some(&mut size)).ok().ok()?;
            let mut data = vec![0u8; size as usize];
            RegQueryValueExW(key.0, PCWSTR(name.as_ptr()), None, Some(&mut kind), Some(data.as_mut_ptr()), Some(&mut size))
                .ok()
                .ok()?;
            data.truncate(size as usize);
            Some((kind.0, data))
        }
    }

    pub fn string(key: &Key, name: &str) -> Option<String> {
        let (_, data) = raw(key, name)?;
        let wide: Vec<u16> = data.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
        Some(String::from_utf16_lossy(&wide[..end]))
    }

    pub fn dword(key: &Key, name: &str) -> Option<u32> {
        let (_, data) = raw(key, name)?;
        (data.len() >= 4).then(|| u32::from_le_bytes([data[0], data[1], data[2], data[3]]))
    }
}

/// IDM's download entries that aren't complete yet.
fn unfinished_entries() -> Vec<IdmEntry> {
    let Some(root) = reg::open(ROOT) else { return Vec::new() };
    reg::subkeys(&root)
        .into_iter()
        .filter(|id| id.chars().all(|c| c.is_ascii_digit()))
        .filter_map(|id| {
            let key = reg::open(&format!("{ROOT}\\{id}"))?;
            let status = reg::dword(&key, "Status").unwrap_or(0);
            if status == STATUS_COMPLETE {
                return None;
            }
            let temp_dir = PathBuf::from(reg::string(&key, "LocalPath")?);
            let name = clean_name(&reg::string(&key, "FileName").unwrap_or_default());
            let total = reg::raw(&key, "FileSize").and_then(|(_, d)| parse_size(&d));
            Some(IdmEntry { id, name, total, temp_dir, status })
        })
        .collect()
}

/// A readable name from IDM's FileName, which is sometimes a raw URL tail
/// ("redirection?filename=Book%20Title.pdf&s=…").
pub fn clean_name(raw: &str) -> String {
    let decode = |s: &str| {
        let b = s.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < b.len() {
            if b[i] == b'%' && i + 3 <= b.len() {
                if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    out.push(v);
                    i += 3;
                    continue;
                }
            }
            out.push(if b[i] == b'+' { b' ' } else { b[i] });
            i += 1;
        }
        String::from_utf8_lossy(&out).to_string()
    };
    let (path, query) = raw.split_once('?').unwrap_or((raw, ""));
    let from_query = query
        .split('&')
        .find_map(|p| p.strip_prefix("filename=").or_else(|| p.strip_prefix("file=")))
        .map(decode);
    let name = from_query.unwrap_or_else(|| decode(path.rsplit('/').next().unwrap_or(path)));
    let name = name.trim();
    if name.is_empty() {
        return "Download".into();
    }
    if name.chars().count() > 48 {
        format!("{}…", name.chars().take(47).collect::<String>())
    } else {
        name.to_string()
    }
}

fn dir_size(dir: &std::path::Path) -> Option<u64> {
    let entries = std::fs::read_dir(dir).ok()?;
    Some(entries.flatten().filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum())
}

struct Track {
    name: String,
    total: Option<u64>,
    bytes: u64,
    at: i64,
    grew_at: i64,
    speed: f64,
}

pub fn setup(app: AppHandle) {
    std::thread::Builder::new()
        .name("dynis-idm".into())
        .spawn(move || {
            let mut tracked: HashMap<String, Track> = HashMap::new();
            let mut entries: Vec<IdmEntry> = Vec::new();
            let mut last_scan = 0i64;
            loop {
                let busy = !tracked.is_empty();
                std::thread::sleep(std::time::Duration::from_millis(if busy { 1000 } else { 3000 }));
                if !module_enabled("bloom-activity-idm", true) || reg::open(ROOT).is_none() {
                    for id in tracked.drain().map(|(k, _)| k) {
                        end(&app, &format!("idm-{id}"));
                    }
                    continue;
                }
                let now = now_ms();
                // The registry list changes rarely: rescan every 3 s.
                if now - last_scan > 2_500 {
                    entries = unfinished_entries();
                    last_scan = now;
                }
                let mut seen_now = Vec::new();
                for e in &entries {
                    let Some(bytes) = dir_size(&e.temp_dir) else { continue };
                    let t = tracked.entry(e.id.clone()).or_insert(Track {
                        name: e.name.clone(),
                        total: e.total,
                        bytes,
                        at: now,
                        grew_at: if bytes > 0 { 0 } else { now },
                        speed: 0.0,
                    });
                    let dt = (now - t.at) as f64 / 1000.0;
                    if bytes > t.bytes {
                        if dt > 0.0 {
                            let instant = (bytes - t.bytes) as f64 / dt;
                            t.speed = if t.speed == 0.0 { instant } else { t.speed * 0.6 + instant * 0.4 };
                        }
                        t.grew_at = now;
                    }
                    t.bytes = bytes;
                    t.at = now;
                    t.total = e.total.or(t.total);
                    // Only downloads that are actually moving show (paused ones and
                    // old leftovers don't).
                    if now - t.grew_at > 8_000 {
                        end(&app, &format!("idm-{}", e.id));
                        continue;
                    }
                    seen_now.push(e.id.clone());
                    let progress = t.total.map(|tot| (t.bytes as f32 / tot as f32).min(1.0));
                    let value = super::downloads::browser_value(t.bytes, t.total, t.speed as u64);
                    upsert(
                        &app,
                        Activity {
                            id: format!("idm-{}", e.id),
                            kind: "download".into(),
                            priority: 3,
                            started_ms: 0,
                            expires_ms: None,
                            lift_until_ms: None,
                            signal: Some("transfer".into()),
                            icon: Some("download".into()),
                            title: t.name.clone(),
                            value: Some(value),
                            detail: Some("IDM".into()),
                            progress,
                            action: None,
                        },
                    );
                }
                // Temp folder gone after it was growing: IDM finished and moved the file.
                let gone: Vec<String> = tracked
                    .iter()
                    .filter(|(id, t)| {
                        !seen_now.contains(id)
                            && t.grew_at > 0
                            && !entries.iter().any(|e| &e.id == *id && e.temp_dir.exists())
                    })
                    .map(|(id, _)| id.clone())
                    .collect();
                for id in gone {
                    if let Some(t) = tracked.remove(&id) {
                        end(&app, &format!("idm-{id}"));
                        if now - t.grew_at < 30_000 {
                            lift(
                                &app,
                                Activity {
                                    id: format!("idm-done-{id}"),
                                    kind: "download".into(),
                                    priority: 4,
                                    started_ms: 0,
                                    expires_ms: None,
                                    lift_until_ms: None,
                                    signal: Some("positive".into()),
                                    icon: Some("download-done".into()),
                                    title: t.name,
                                    value: Some("Downloaded".into()),
                                    detail: Some("IDM".into()),
                                    progress: None,
                                    action: None,
                                },
                                3000,
                            );
                        }
                    }
                }
                // Forget entries that vanished from IDM's list entirely.
                tracked.retain(|id, _| entries.iter().any(|e| &e.id == id) || seen_now.contains(id));
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_url_names() {
        assert_eq!(clean_name("arduino-ide_2.3.10_Windows_64bit.exe"), "arduino-ide_2.3.10_Windows_64bit.exe");
        assert_eq!(clean_name("redirection?filename=Rosen%20Discrete%20Math.pdf&s=davinci"), "Rosen Discrete Math.pdf");
        assert_eq!(clean_name("ppkd7sp94o5f?v=LXBL"), "ppkd7sp94o5f");
        assert!(clean_name(&"x".repeat(200)).ends_with('…'));
    }

    #[test]
    fn reads_idm_sizes() {
        assert_eq!(parse_size(&[8, 7, 108, 9, 0, 0, 0, 0]), Some(158_074_632));
        assert_eq!(parse_size(&[0; 8]), None);
        assert_eq!(parse_size(&[1, 2]), None);
    }

    /// Lists IDM's unfinished downloads on this PC (run with --ignored).
    #[test]
    #[ignore]
    fn reads_live_idm_registry() {
        let all = unfinished_entries();
        println!("unfinished IDM entries: {}", all.len());
        for e in all.iter().take(5) {
            println!("{} status={} total={:?} dir_exists={}", e.name, e.status, e.total, e.temp_dir.exists());
        }
    }
}

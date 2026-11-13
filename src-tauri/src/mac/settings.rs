//! Settings on macOS: the same flat `bloom-*` keys in `settings.json`, kept
//! in ~/Library/Application Support/com.kevin.dynis, with an in-memory cache
//! for the backend.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

static CACHE: Mutex<Option<HashMap<String, serde_json::Value>>> = Mutex::new(None);
static FILE_LOCK: Mutex<()> = Mutex::new(());

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

pub fn read_file(path: &std::path::Path) -> Result<HashMap<String, serde_json::Value>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Ok(HashMap::new()),
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Writes atomically (temp file, then rename).
fn write_file(path: &std::path::Path, settings: &HashMap<String, serde_json::Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn init(app: &AppHandle) {
    let settings = path(app).and_then(|p| read_file(&p).ok()).unwrap_or_default();
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some(settings);
}

pub fn get_str(key: &str) -> Option<String> {
    let cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    cache.as_ref()?.get(key)?.as_str().map(str::to_string)
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<HashMap<String, serde_json::Value>, String> {
    match path(&app) {
        Some(p) => read_file(&p),
        None => Ok(HashMap::new()),
    }
}

#[tauri::command]
pub fn settings_file_readable(app: AppHandle) -> bool {
    path(&app).is_some_and(|p| p.exists() && read_file(&p).is_ok())
}

pub fn save(app: &AppHandle, key: String, value: serde_json::Value) -> Result<(), String> {
    let p = path(app).ok_or("No settings folder.")?;
    let settings = {
        let _guard = FILE_LOCK.lock().map_err(|e| e.to_string())?;
        let mut settings = read_file(&p)?;
        settings.insert(key.clone(), value);
        write_file(&p, &settings)?;
        settings
    };
    let value = settings.get(&key).cloned().unwrap_or(serde_json::Value::Null);
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some(settings);
    let _ = app.emit("settings-changed", serde_json::json!({ "key": &key, "value": value }));
    Ok(())
}

#[tauri::command]
pub fn save_setting(app: AppHandle, key: String, value: serde_json::Value) -> Result<(), String> {
    save(&app, key, value)
}

#[tauri::command]
pub fn reset_settings(app: AppHandle) -> Result<(), String> {
    let p = path(&app).ok_or("No settings folder.")?;
    let _ = std::fs::remove_file(&p);
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some(HashMap::new());
    Ok(())
}

/// Setup is done: remember it and tell every window.
#[tauri::command]
pub fn finish_onboarding(app: AppHandle) -> Result<(), String> {
    save(&app, "bloom-onboarding-complete".into(), serde_json::json!("2.0.0"))?;
    let _ = app.emit("onboarding-complete", ());
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.hide();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
    }
    Ok(())
}

pub fn onboarding_complete() -> bool {
    get_str("bloom-onboarding-complete").as_deref() == Some("2.0.0")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_and_empty_files_read_as_empty() {
        let dir = std::env::temp_dir().join(format!("dynis-settings-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("settings.json");
        assert!(read_file(&p).unwrap().is_empty());
        std::fs::write(&p, "").unwrap();
        assert!(read_file(&p).unwrap().is_empty());
        let mut m = HashMap::new();
        m.insert("bloom-island-style".to_string(), serde_json::json!("pill"));
        write_file(&p, &m).unwrap();
        assert_eq!(read_file(&p).unwrap()["bloom-island-style"], "pill");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

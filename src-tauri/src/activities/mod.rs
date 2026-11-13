//! The Island Engine: one registry of live activities (charging, headphones,
//! downloads, timers, notifications, scripts…) and the rule that decides what
//! the island shows: one main activity, at most one split bubble, and the rest
//! listed inside the open island.
//!
//! Backend modules (one file each) and the island webview both feed the same
//! registry, so the choice is made in one place.

// Shared by every platform.
pub mod custom;
pub mod downloads;
pub mod google_calendar;
pub mod spotify;

// Windows backends (macOS has its own in `crate::mac`).
#[cfg(windows)]
pub mod bluetooth_battery;
#[cfg(windows)]
pub mod clipboard;
#[cfg(windows)]
pub mod glass;
#[cfg(windows)]
pub mod idm;
#[cfg(windows)]
pub mod keep_awake;
#[cfg(windows)]
pub mod notifications;
#[cfg(windows)]
pub mod snap;
#[cfg(windows)]
pub mod widgets;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

/// How long a "lift" (a short alert that swells the island) lasts.
pub const LIFT_MS: i64 = 2500;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    /// "charging", "headphones", "download", "timer", "notification", "custom", …
    pub kind: String,
    /// Higher wins the main slot.
    #[serde(default)]
    pub priority: u8,
    #[serde(default)]
    pub started_ms: i64,
    /// Removed after this time (None = until ended).
    #[serde(default)]
    pub expires_ms: Option<i64>,
    /// While set and in the future, the activity takes over the island.
    #[serde(default)]
    pub lift_until_ms: Option<i64>,
    /// Signal colour: "positive", "timer", "alert", "focus", "music", or none.
    #[serde(default)]
    pub signal: Option<String>,
    /// Icon key the island knows ("battery", "headphones", "download", …) or a data URL.
    #[serde(default)]
    pub icon: Option<String>,
    /// Left wing: what is happening.
    pub title: String,
    /// Right wing: its value.
    #[serde(default)]
    pub value: Option<String>,
    /// One more line, shown when the island is open.
    #[serde(default)]
    pub detail: Option<String>,
    /// 0..1 progress shown as a fill, if any.
    #[serde(default)]
    pub progress: Option<f32>,
    /// What a click does: "open:<path or shell:AppsFolder\\aumid>", "panel:<name>".
    #[serde(default)]
    pub action: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Presentation {
    /// Shown in the island itself.
    pub main: Option<Activity>,
    /// Shown as the one round bubble beside it.
    pub bubble: Option<Activity>,
    /// Everything else, listed when the island is open.
    pub rest: Vec<Activity>,
    /// True while `main` is a lift alert.
    pub lifting: bool,
}

static REGISTRY: Mutex<Vec<Activity>> = Mutex::new(Vec::new());
static LAST_SENT: Mutex<Option<Presentation>> = Mutex::new(None);

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Decides what the island shows. Pure, so it is unit tested.
///
/// Expired activities are dropped. A live lift always wins the main slot
/// (newest lift first); otherwise the highest priority wins, newest first on
/// ties. The next one becomes the bubble and the rest are listed.
pub fn present(activities: &[Activity], now: i64) -> Presentation {
    let mut live: Vec<&Activity> = activities
        .iter()
        .filter(|a| a.expires_ms.is_none_or(|e| e > now))
        .collect();
    let lifting = |a: &Activity| a.lift_until_ms.is_some_and(|l| l > now);
    live.sort_by(|a, b| {
        lifting(b)
            .cmp(&lifting(a))
            .then(b.priority.cmp(&a.priority))
            .then(b.started_ms.cmp(&a.started_ms))
    });
    let mut iter = live.into_iter().cloned();
    let main = iter.next();
    let bubble = iter.next();
    let rest = iter.collect();
    Presentation {
        lifting: main.as_ref().is_some_and(lifting),
        main,
        bubble,
        rest,
    }
}

fn emit_if_changed(app: &AppHandle) {
    let now = now_ms();
    let presentation = {
        let mut reg = REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
        reg.retain(|a| a.expires_ms.is_none_or(|e| e > now));
        present(&reg, now)
    };
    let mut last = LAST_SENT.lock().unwrap_or_else(|e| e.into_inner());
    if last.as_ref() != Some(&presentation) {
        let _ = app.emit("activities-changed", &presentation);
        *last = Some(presentation);
    }
}

/// Adds or replaces an activity (matched by id).
pub fn upsert(app: &AppHandle, mut activity: Activity) {
    {
        let mut reg = REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(existing) = reg.iter_mut().find(|a| a.id == activity.id) {
            if activity.started_ms == 0 {
                activity.started_ms = existing.started_ms;
            }
            *existing = activity;
        } else {
            if activity.started_ms == 0 {
                activity.started_ms = now_ms();
            }
            reg.push(activity);
        }
    }
    emit_if_changed(app);
}

pub fn end(app: &AppHandle, id: &str) {
    {
        let mut reg = REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
        reg.retain(|a| a.id != id);
    }
    emit_if_changed(app);
}

/// A short alert: swells the island for LIFT_MS and is gone after `ttl_ms`.
pub fn lift(app: &AppHandle, mut activity: Activity, ttl_ms: i64) {
    let now = now_ms();
    activity.started_ms = now;
    activity.lift_until_ms = Some(now + LIFT_MS);
    activity.expires_ms = Some(now + ttl_ms.max(LIFT_MS));
    upsert(app, activity);
}

pub fn module_enabled(key: &str, default: bool) -> bool {
    match crate::platform::setting_str(key) {
        Some(v) => v == "true",
        None => default,
    }
}

#[tauri::command]
pub fn activity_upsert(app: AppHandle, activity: Activity) {
    upsert(&app, activity);
}

#[tauri::command]
pub fn activity_lift(app: AppHandle, activity: Activity, ttl_ms: Option<i64>) {
    lift(&app, activity, ttl_ms.unwrap_or(LIFT_MS));
}

#[tauri::command]
pub fn activity_end(app: AppHandle, id: String) {
    end(&app, &id);
}

#[tauri::command]
pub fn activity_presentation() -> Presentation {
    let reg = REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
    present(&reg, now_ms())
}

/// Starts the expiry ticker and every backend module.
pub fn setup(app: &AppHandle) {
    let ticker = app.clone();
    std::thread::Builder::new()
        .name("dynis-activity-ticker".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            emit_if_changed(&ticker);
        })
        .ok();
    #[cfg(windows)]
    {
        bluetooth_battery::setup(app.clone());
        downloads::setup(app.clone());
        clipboard::setup(app.clone());
        custom::setup(app.clone());
        notifications::setup(app.clone());
        glass::setup(app.clone());
        idm::setup(app.clone());
    }
    #[cfg(target_os = "macos")]
    {
        custom::setup(app.clone());
        downloads::setup(app.clone());
        crate::mac::activities::setup(app.clone());
    }
    #[cfg(target_os = "linux")]
    {
        custom::setup(app.clone());
        downloads::setup(app.clone());
        crate::linux::activities::setup(app.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn act(id: &str, priority: u8, started: i64) -> Activity {
        Activity {
            id: id.into(),
            kind: "test".into(),
            priority,
            started_ms: started,
            expires_ms: None,
            lift_until_ms: None,
            signal: None,
            icon: None,
            title: id.into(),
            value: None,
            detail: None,
            progress: None,
            action: None,
        }
    }

    #[test]
    fn empty_registry_shows_nothing() {
        let p = present(&[], 1000);
        assert!(p.main.is_none() && p.bubble.is_none() && p.rest.is_empty() && !p.lifting);
    }

    #[test]
    fn highest_priority_is_main_then_one_bubble_then_the_rest() {
        let list = [act("low", 1, 10), act("high", 9, 5), act("mid", 5, 20), act("mid-old", 5, 1)];
        let p = present(&list, 100);
        assert_eq!(p.main.unwrap().id, "high");
        assert_eq!(p.bubble.unwrap().id, "mid");
        let rest: Vec<_> = p.rest.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(rest, ["mid-old", "low"]);
    }

    #[test]
    fn a_live_lift_beats_priority_and_stops_lifting_when_over() {
        let mut alert = act("alert", 0, 50);
        alert.lift_until_ms = Some(200);
        let list = [act("timer", 9, 10), alert];
        let p = present(&list, 100);
        assert_eq!(p.main.as_ref().unwrap().id, "alert");
        assert!(p.lifting);
        assert_eq!(p.bubble.unwrap().id, "timer");
        let later = present(&list, 300);
        assert_eq!(later.main.unwrap().id, "timer");
        assert!(!later.lifting);
    }

    #[test]
    fn expired_activities_are_dropped() {
        let mut old = act("old", 9, 1);
        old.expires_ms = Some(50);
        let list = [old, act("keep", 1, 2)];
        let p = present(&list, 100);
        assert_eq!(p.main.unwrap().id, "keep");
        assert!(p.bubble.is_none());
    }

    #[test]
    fn only_one_bubble_ever() {
        let list: Vec<_> = (0..6).map(|i| act(&format!("a{i}"), 1, i)).collect();
        let p = present(&list, 100);
        assert!(p.main.is_some() && p.bubble.is_some());
        assert_eq!(p.rest.len(), 4);
    }
}

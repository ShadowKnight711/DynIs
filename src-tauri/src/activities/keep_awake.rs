//! Keep awake ("Caffeine"): stops the PC and display from sleeping while on.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

static ON: AtomicBool = AtomicBool::new(false);
static WORKER: OnceLock<Mutex<Sender<bool>>> = OnceLock::new();

/// SetThreadExecutionState applies to the calling thread, so one long-lived
/// thread owns the request.
fn worker() -> &'static Mutex<Sender<bool>> {
    WORKER.get_or_init(|| {
        let (tx, rx) = channel::<bool>();
        std::thread::Builder::new()
            .name("dynis-keep-awake".into())
            .spawn(move || {
                use windows::Win32::System::Power::{
                    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
                };
                for on in rx {
                    unsafe {
                        if on {
                            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
                        } else {
                            SetThreadExecutionState(ES_CONTINUOUS);
                        }
                    }
                }
            })
            .ok();
        Mutex::new(tx)
    })
}

#[tauri::command]
pub fn set_keep_awake(on: bool) -> bool {
    ON.store(on, Ordering::Relaxed);
    if let Ok(tx) = worker().lock() {
        let _ = tx.send(on);
    }
    on
}

#[tauri::command]
pub fn get_keep_awake() -> bool {
    ON.load(Ordering::Relaxed)
}

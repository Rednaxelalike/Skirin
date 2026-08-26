//! Shared application state.

use std::sync::atomic::AtomicBool;
use std::sync::OnceLock;

use parking_lot::Mutex;

use crate::capture::{Engine, Registry};
use crate::overlay::Session;
use crate::store::Store;
use crate::types::UpdateStatus;

pub struct App {
    pub store: Store,
    pub engine: Engine,
    pub registry: Registry,
    pub overlay: Mutex<Option<Session>>,
    pub update: Mutex<UpdateStatus>,
    /// Set once the user has really asked to leave, so the tray's
    /// hide-instead-of-close guard steps out of the way.
    pub quitting: AtomicBool,
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}

impl App {
    pub fn new() -> Self {
        Self {
            store: Store::load(),
            engine: Engine::start(),
            registry: Registry::default(),
            overlay: Mutex::new(None),
            update: Mutex::new(UpdateStatus::default()),
            quitting: AtomicBool::new(false),
        }
    }
}

/// A process-wide handle, for code Tauri cannot hand one to directly.
static HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn remember(app: &tauri::AppHandle) {
    let _ = HANDLE.set(app.clone());
}

pub fn handle() -> Option<tauri::AppHandle> {
    HANDLE.get().cloned()
}

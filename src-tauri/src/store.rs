//! Persistence for settings, presets, history and window bounds.
//!
//! Deliberately the same `%APPDATA%\Skirin\skirin.json` the Electron build
//! wrote, with the same key names, so upgrading in place carries a user's
//! shortcuts, save folder and history across the rewrite instead of resetting
//! them.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::types::{AppSettings, HistoryEntry, Preset, WindowBounds};

const HISTORY_LIMIT: usize = 60;

/// Bumped when a stored value changes meaning rather than shape. Version 2 is
/// the move to physical pixels; see [`migrate`].
const SCHEMA: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Persisted {
    #[serde(default)]
    schema: u32,
    settings: AppSettings,
    #[serde(default)]
    presets: Vec<Preset>,
    #[serde(default)]
    history: Vec<HistoryEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    window_bounds: Option<WindowBounds>,
}

/// Brings a file written by an older build up to date.
///
/// The only value whose meaning changed is `lastRegion`. The Electron build
/// stored it in Chromium's DIP space; this one stores physical pixels. On a
/// 100%-scale display the two are identical, but on a scaled one "repeat last
/// region" would grab the wrong rectangle — and there is nothing in the value
/// itself to tell the two apart. Dropping it costs the user one re-selection;
/// keeping it costs them a wrong capture they have to notice first.
fn migrate(state: &mut Persisted) {
    if state.schema < 2 {
        state.settings.last_region = None;
        // A window position is also DIP-derived, but Tauri clamps a restored
        // position onto a real monitor, so a stale one self-corrects.
    }
    state.schema = SCHEMA;
}

pub struct Store {
    path: PathBuf,
    state: Mutex<Persisted>,
}

fn app_data_dir() -> PathBuf {
    // `%APPDATA%\Skirin` — Electron's `app.getPath('userData')` for a product
    // named Skirin. Tauri would default to the bundle identifier instead,
    // which would silently strand every existing install's settings.
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Skirin")
}

fn default_save_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join("Pictures").join("Skirin")
}

fn seed() -> Persisted {
    Persisted {
        schema: SCHEMA,
        settings: AppSettings::seed(default_save_dir().to_string_lossy().into_owned()),
        presets: Vec::new(),
        history: Vec::new(),
        window_bounds: None,
    }
}

/// Recursively overlays `patch` onto `base`, so a settings patch that only
/// carries `{ shortcuts: { area } }` cannot wipe the other four bindings.
fn merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            for (key, value) in p {
                match b.get_mut(key) {
                    Some(slot) if value.is_object() => merge(slot, value),
                    _ => {
                        b.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (slot, value) => *slot = value.clone(),
    }
}

impl Store {
    pub fn load() -> Self {
        let path = app_data_dir().join("skirin.json");
        let mut state = Self::read(&path).unwrap_or_else(seed);
        migrate(&mut state);
        let store = Self {
            path,
            state: Mutex::new(state),
        };
        // Written back straight away so the migration is recorded even if the
        // session ends before anything else touches settings.
        store.flush(&store.state.lock());
        store
    }

    /// Reads the file field by field over a fresh seed, so a settings key added
    /// after a user's last save arrives with its default rather than failing
    /// the whole parse and resetting everything.
    fn read(path: &PathBuf) -> Option<Persisted> {
        let raw = fs::read_to_string(path).ok()?;
        let parsed: Value = serde_json::from_str(&raw).ok()?;

        let mut base = serde_json::to_value(seed()).ok()?;
        merge(&mut base, &parsed);

        // The seed carries the current schema, and a file written before the
        // field existed has none to overwrite it with — so after the merge it
        // would claim to be current and skip its own migration. The version on
        // disk is the only one that means anything here.
        if let Some(slot) = base.get_mut("schema") {
            *slot = parsed.get("schema").cloned().unwrap_or(Value::from(0));
        }

        serde_json::from_value(base).ok()
    }

    /// Writes through a temporary file so a crash mid-write cannot leave a
    /// truncated `skirin.json` behind — that file is the whole user profile.
    fn flush(&self, state: &Persisted) {
        let Some(parent) = self.path.parent() else {
            return;
        };
        if let Err(error) = fs::create_dir_all(parent) {
            eprintln!("[skirin] could not create the settings folder: {error}");
            return;
        }

        let tmp = self.path.with_extension("json.tmp");
        let write = (|| -> std::io::Result<()> {
            let mut file = fs::File::create(&tmp)?;
            file.write_all(serde_json::to_string_pretty(state)?.as_bytes())?;
            file.sync_all()?;
            drop(file);
            fs::rename(&tmp, &self.path)
        })();

        if let Err(error) = write {
            eprintln!("[skirin] failed to persist settings: {error}");
            let _ = fs::remove_file(&tmp);
        }
    }

    pub fn settings(&self) -> AppSettings {
        self.state.lock().settings.clone()
    }

    pub fn patch_settings(&self, patch: &Value) -> AppSettings {
        let mut state = self.state.lock();
        let mut current = serde_json::to_value(&state.settings).unwrap_or(Value::Null);
        merge(&mut current, patch);
        if let Ok(next) = serde_json::from_value::<AppSettings>(current) {
            state.settings = next;
        }
        self.flush(&state);
        state.settings.clone()
    }

    pub fn presets(&self) -> Vec<Preset> {
        self.state.lock().presets.clone()
    }

    pub fn set_presets(&self, presets: Vec<Preset>) -> Vec<Preset> {
        let mut state = self.state.lock();
        state.presets = presets;
        self.flush(&state);
        state.presets.clone()
    }

    pub fn history(&self) -> Vec<HistoryEntry> {
        self.state.lock().history.clone()
    }

    pub fn push_history(&self, entry: HistoryEntry) -> Vec<HistoryEntry> {
        let mut state = self.state.lock();
        state.history.retain(|h| h.id != entry.id);
        state.history.insert(0, entry);
        state.history.truncate(HISTORY_LIMIT);
        self.flush(&state);
        state.history.clone()
    }

    pub fn clear_history(&self) -> Vec<HistoryEntry> {
        let mut state = self.state.lock();
        state.history.clear();
        self.flush(&state);
        Vec::new()
    }

    pub fn window_bounds(&self) -> Option<WindowBounds> {
        self.state.lock().window_bounds
    }

    pub fn set_window_bounds(&self, bounds: WindowBounds) {
        let mut state = self.state.lock();
        state.window_bounds = Some(bounds);
        self.flush(&state);
    }

    /// The configured capture folder, created on demand.
    pub fn ensure_save_dir(&self) -> PathBuf {
        let dir = PathBuf::from(self.settings().save_dir);
        let _ = fs::create_dir_all(&dir);
        dir
    }
}

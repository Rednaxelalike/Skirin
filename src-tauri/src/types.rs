//! Serde mirrors of `src/shared/types.ts`.
//!
//! Only the shapes that actually cross the IPC boundary live here. Anything
//! the backend never inspects — a preset's scene, for instance — is carried as
//! an opaque `Value` so the editor can evolve its own schema without the Rust
//! side needing to know or a round-trip through disk dropping fields.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }

    pub fn intersects(&self, other: &Rect) -> bool {
        self.x + self.width > other.x
            && self.x < other.x + other.width
            && self.y + self.height > other.y
            && self.y < other.y + other.height
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: i64,
    pub bounds: Rect,
    pub work_area: Rect,
    pub scale_factor: f64,
    pub is_primary: bool,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSource {
    pub id: String,
    pub name: String,
    pub app_icon: Option<String>,
    pub thumbnail: String,
}

/// A raw capture handed from the backend to the editor.
///
/// `src` is a `skirin://frame/<id>` URL rather than a data URL: the pixels stay
/// in Rust and the webview streams them over the custom protocol, which skips
/// the base64 round-trip the Electron build paid on every shot.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub id: String,
    pub src: String,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub kind: String,
    pub source_name: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<Rect>,
}

/* ------------------------------ app config ------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shortcuts {
    pub fullscreen: String,
    pub window: String,
    pub area: String,
    pub last_region: String,
    pub open_editor: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            area: "Control+Shift+1".into(),
            fullscreen: "Control+Shift+2".into(),
            window: "Control+Shift+3".into(),
            last_region: "Control+Shift+4".into(),
            open_editor: "Control+Shift+S".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    pub format: String,
    pub scale: f64,
    pub quality: f64,
    pub max_size_kb: Option<f64>,
    pub transparent: bool,
}

impl Default for ExportSettings {
    fn default() -> Self {
        Self {
            format: "png".into(),
            scale: 2.0,
            quality: 0.92,
            max_size_kb: None,
            transparent: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub shortcuts: Shortcuts,
    pub after_capture: String,
    pub save_dir: String,
    pub filename_template: String,
    pub auto_launch: bool,
    pub show_tray: bool,
    pub capture_sound: bool,
    pub capture_delay: f64,
    pub theme: String,
    pub default_preset_id: String,
    pub export_defaults: ExportSettings,
    pub smart_redact_on_capture: bool,
    pub copy_on_export: bool,
    pub magnifier: bool,
    pub remember_last_region: bool,
    pub last_region: Option<Rect>,
}

impl AppSettings {
    pub fn seed(save_dir: String) -> Self {
        Self {
            shortcuts: Shortcuts::default(),
            after_capture: "editor".into(),
            save_dir,
            filename_template: "Skirin {yyyy}-{MM}-{dd} at {HH}.{mm}.{ss}".into(),
            auto_launch: false,
            show_tray: true,
            capture_sound: true,
            capture_delay: 0.0,
            theme: "dark".into(),
            default_preset_id: "aurora".into(),
            export_defaults: ExportSettings::default(),
            smart_redact_on_capture: false,
            copy_on_export: true,
            magnifier: true,
            remember_last_region: true,
            last_region: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub builtin: bool,
    /// The editor owns this shape; the backend only stores it.
    pub scene: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub file: String,
    pub thumb: String,
    pub created_at: i64,
    pub width: u32,
    pub height: u32,
    pub source_name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

/* -------------------------------- ipc ----------------------------------- */

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canceled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Payload handed to each per-display selection overlay.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInit {
    pub display_id: i64,
    pub bounds: Rect,
    pub scale_factor: f64,
    pub src: String,
    pub magnifier: bool,
    pub last_region: Option<Rect>,
    pub windows: Vec<Rect>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub state: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub percent: u8,
    pub error: Option<String>,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            version: None,
            notes: None,
            percent: 0,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub save_dir: String,
    pub channel: String,
    pub webview: String,
    pub tauri: String,
    pub rustc: String,
}

//! The command surface the editor talks to.
//!
//! One-for-one with what the Electron preload exposed, with two deliberate
//! changes: images travel as `skirin://` URLs rather than data URLs, and export
//! bytes arrive as a raw IPC body instead of a base64 string.

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::app::{self, CaptureKind};
use crate::capture::{self};
use crate::files;
use crate::state::App;
use crate::types::{
    AppInfo, AppSettings, Capture, DisplayInfo, HistoryEntry, OverlayInit, Point, Preset, Rect,
    SaveResult, UpdateStatus, WindowSource,
};
use crate::{autostart, shortcuts, tray, updater};

/// An image the editor loaded from somewhere other than a capture.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedImage {
    pub src: String,
    pub width: u32,
    pub height: u32,
}

/* ------------------------------- settings ------------------------------- */

#[tauri::command]
pub fn settings_get(state: State<'_, App>) -> AppSettings {
    state.store.settings()
}

#[tauri::command]
pub fn settings_set(app: AppHandle, state: State<'_, App>, patch: Value) -> AppSettings {
    let next = state.store.patch_settings(&patch);

    // Only redo the expensive side effects the patch actually touched.
    if patch.get("shortcuts").is_some() {
        shortcuts::apply(&app);
    }
    if patch.get("showTray").is_some() || patch.get("shortcuts").is_some() {
        if let Err(error) = tray::apply(&app) {
            eprintln!("[skirin] tray rebuild failed: {error}");
        }
    }
    if patch.get("autoLaunch").is_some() && !tauri::is_dev() {
        autostart::set(next.auto_launch);
    }

    let _ = app.emit("settings:changed", &next);
    next
}

#[tauri::command]
pub fn presets_get(state: State<'_, App>) -> Vec<Preset> {
    state.store.presets()
}

#[tauri::command]
pub fn presets_set(state: State<'_, App>, presets: Vec<Preset>) -> Vec<Preset> {
    state.store.set_presets(presets)
}

#[tauri::command]
pub fn history_get(state: State<'_, App>) -> Vec<HistoryEntry> {
    state.store.history()
}

#[tauri::command]
pub fn history_clear(state: State<'_, App>) -> Vec<HistoryEntry> {
    state.store.clear_history()
}

/* -------------------------------- capture ------------------------------- */

/// Capture blocks: on the overlay's channel, or on DWM producing a frame.
/// Every entry point hops to a blocking task so the UI thread keeps painting.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    tauri::async_runtime::spawn_blocking(f).await.ok()
}

#[tauri::command]
pub async fn capture_area(app: AppHandle) -> Option<Capture> {
    blocking(move || app::run_capture(&app, CaptureKind::Area)).await?
}

#[tauri::command]
pub async fn capture_last(app: AppHandle) -> Option<Capture> {
    blocking(move || app::run_capture(&app, CaptureKind::LastRegion)).await?
}

#[tauri::command]
pub async fn capture_display(app: AppHandle, id: Option<i64>) -> Option<Capture> {
    blocking(move || app::run_capture(&app, CaptureKind::Display(id))).await?
}

#[tauri::command]
pub fn capture_displays() -> Vec<DisplayInfo> {
    capture::describe_displays()
}

#[tauri::command]
pub async fn capture_window_sources(app: AppHandle) -> Vec<WindowSource> {
    blocking(move || {
        // Hidden first, or the picker lists — and thumbnails — the editor.
        app::with_hidden_editor(&app, || {
            let state = app.state::<App>();
            capture::list_window_sources(&state.engine, &state.registry)
        })
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn capture_window(app: AppHandle, id: String) -> Option<Capture> {
    let hwnd: isize = id.parse().ok()?;
    blocking(move || {
        let capture = app::with_hidden_editor(&app, || app::capture_window(&app, hwnd));
        app::deliver(&app, capture)
    })
    .await?
}

/* --------------------------------- image -------------------------------- */

fn raw_body(request: &Request<'_>) -> Option<Vec<u8>> {
    match request.body() {
        InvokeBody::Raw(bytes) => Some(bytes.clone()),
        InvokeBody::Json(_) => None,
    }
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

/// Undoes the bridge's `encodeURIComponent`.
///
/// Filenames and window titles are arbitrary Unicode, and a header value is
/// ASCII — so they arrive percent-encoded. Written out rather than pulling in
/// a dependency: this is the only place in the app that needs it.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(byte) = hex {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }

    // Lossy on purpose: a malformed sequence should cost one character, not
    // the whole filename.
    String::from_utf8_lossy(&out).into_owned()
}

fn text_header(request: &Request<'_>, name: &str) -> Option<String> {
    header(request, name).map(percent_decode)
}

#[tauri::command]
pub fn image_copy(request: Request<'_>) -> bool {
    let Some(bytes) = raw_body(&request) else {
        return false;
    };
    let Some(image) = files::decode(&bytes) else {
        return false;
    };
    files::copy_image(&image).is_ok()
}

#[tauri::command]
pub fn image_paste(state: State<'_, App>) -> Option<LoadedImage> {
    let image = files::paste_image()?;
    let capture = capture::publish(
        &state.registry,
        image,
        "clipboard",
        "Clipboard".into(),
        1.0,
        None,
    );
    Some(LoadedImage {
        src: capture.src,
        width: capture.width,
        height: capture.height,
    })
}

/// Opened images come back as data URLs rather than registry URLs: a chosen
/// background or watermark is stored inside a preset, and a preset has to
/// survive both frame eviction and a restart.
#[tauri::command]
pub async fn image_open(app: AppHandle) -> Option<LoadedImage> {
    let picked = app
        .dialog()
        .file()
        .set_title("Open image")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])
        .blocking_pick_file()?;

    let path = match picked {
        FilePath::Path(path) => path,
        FilePath::Url(url) => url.to_file_path().ok()?,
    };

    let image = files::read_image(&path)?;
    let (width, height) = (image.width(), image.height());
    Some(LoadedImage {
        src: capture::png_data_url(&capture::encode_png_compact(&image)),
        width,
        height,
    })
}

/// Writes the bytes the canvas already encoded — no decode, no re-encode.
#[tauri::command]
pub fn image_save(app: AppHandle, window: WebviewWindow, request: Request<'_>) -> SaveResult {
    let Some(bytes) = raw_body(&request) else {
        return SaveResult {
            ok: false,
            error: Some("no image data".into()),
            ..Default::default()
        };
    };

    let state = app.state::<App>();
    let settings = state.store.settings();
    let format = header(&request, "x-format").unwrap_or("png").to_string();
    let ext = files::extension_for(&format);
    let ask_where = header(&request, "x-ask-where") == Some("1");
    let stem = text_header(&request, "x-name")
        .map(|name| files::sanitize(&name))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| files::render_template(&settings.filename_template));

    let target = if ask_where {
        let picked = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Export screenshot")
            .set_directory(&settings.save_dir)
            .set_file_name(format!("{stem}.{ext}"))
            .add_filter("PNG image", &["png"])
            .add_filter("JPEG image", &["jpg", "jpeg"])
            .add_filter("WebP image", &["webp"])
            .blocking_save_file();

        match picked {
            Some(FilePath::Path(path)) => path,
            Some(FilePath::Url(url)) => match url.to_file_path() {
                Ok(path) => path,
                Err(_) => {
                    return SaveResult {
                        ok: false,
                        canceled: Some(true),
                        ..Default::default()
                    }
                }
            },
            None => {
                return SaveResult {
                    ok: false,
                    canceled: Some(true),
                    ..Default::default()
                }
            }
        }
    } else {
        files::unique_path(&state.store.ensure_save_dir(), &stem, ext)
    };

    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(error) = std::fs::write(&target, &bytes) {
        return SaveResult {
            ok: false,
            error: Some(error.to_string()),
            ..Default::default()
        };
    }

    let width = header(&request, "x-width")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let height = header(&request, "x-height")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let source = text_header(&request, "x-source")
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Screenshot".to_string());

    if let Some(image) = files::decode(&bytes) {
        state.store.push_history(crate::types::HistoryEntry {
            id: format!(
                "{}-{}",
                capture::now_millis(),
                target.file_name().unwrap_or_default().to_string_lossy()
            ),
            file: target.to_string_lossy().into_owned(),
            thumb: files::thumbnail_data_url(&image, 320),
            created_at: capture::now_millis(),
            width,
            height,
            source_name: source,
        });
    }

    SaveResult {
        ok: true,
        path: Some(target.to_string_lossy().into_owned()),
        ..Default::default()
    }
}

/* --------------------------------- shell -------------------------------- */

#[tauri::command]
pub fn shell_reveal(path: String) {
    files::reveal(&path);
}

#[tauri::command]
pub fn shell_open(path: String) {
    let _ = std::fs::create_dir_all(&path);
    let _ = tauri_plugin_opener::open_path(path, None::<&str>);
}

#[tauri::command]
pub fn shell_external(url: String) {
    // Only ever a link the app itself put in the UI, but the scheme is
    // checked anyway so a value that reached here from stored state cannot
    // turn into a local command.
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = tauri_plugin_opener::open_url(url, None::<&str>);
    }
}

/* ---------------------------------- app --------------------------------- */

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<'_, App>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        save_dir: state.store.settings().save_dir,
        channel: updater::channel(&app).to_string(),
        webview: tauri::webview_version().unwrap_or_else(|_| "unknown".into()),
        tauri: tauri::VERSION.to_string(),
        rustc: env!("SKIRIN_RUSTC").to_string(),
    }
}

/* -------------------------------- updates ------------------------------- */

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateStatus {
    updater::status(&app)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> UpdateStatus {
    updater::check(&app, true).await
}

#[tauri::command]
pub async fn update_download(app: AppHandle) -> UpdateStatus {
    updater::download(&app, true).await
}

#[tauri::command]
pub fn update_install(app: AppHandle) -> bool {
    updater::install(&app)
}

#[tauri::command]
pub fn update_open_releases() {
    updater::open_releases();
}

/* -------------------------------- window -------------------------------- */

#[tauri::command]
pub fn window_minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
pub fn window_toggle_maximize(window: WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
pub fn window_close(window: WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
pub fn window_hide(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
pub fn window_is_maximized(window: WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}

/* -------------------------------- overlay ------------------------------- */

/// Each overlay pulls its own payload on mount, keyed by its window label —
/// no race between the push and the listener being attached.
#[tauri::command]
pub fn overlay_init(window: WebviewWindow, state: State<'_, App>) -> Option<OverlayInit> {
    state
        .overlay
        .lock()
        .as_ref()
        .and_then(|session| session.payload(window.label()))
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle, window: WebviewWindow) {
    crate::overlay::mark_ready(&app, window.label());
}

#[tauri::command]
pub fn overlay_cancel(app: AppHandle) {
    crate::overlay::cancel(&app);
}

#[tauri::command]
pub fn overlay_confirm(app: AppHandle, rect: Rect, label: String) {
    crate::overlay::confirm(&app, rect, label);
}

/// Keeps every overlay in step while the pointer travels between monitors —
/// the one the cursor left drops its crosshair and window highlight.
#[tauri::command]
pub fn overlay_broadcast_cursor(app: AppHandle, window: WebviewWindow, point: Point) {
    let state = app.state::<App>();
    let labels = match state.overlay.lock().as_ref() {
        Some(session) => session.labels.clone(),
        None => return,
    };
    let origin = window.label().to_string();

    for label in labels {
        if label == origin {
            continue;
        }
        let _ = app.emit_to(label.as_str(), "overlay:cursor", point);
    }
}

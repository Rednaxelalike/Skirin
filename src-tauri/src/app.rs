//! The main window, and what happens to a capture once it exists.

use std::sync::atomic::Ordering;

use tauri::window::{Effect, EffectsBuilder};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::capture::{self, Frame};
use crate::files;
use crate::state::App;
use crate::types::{Capture, HistoryEntry, WindowBounds};

pub const MAIN: &str = "main";

/// Long enough for the compositor to actually drop the window off screen
/// before the frame is grabbed. Anything shorter and the editor photographs
/// itself.
const HIDE_SETTLE_MS: u64 = 140;

pub fn create_main(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let state = app.state::<App>();
    let saved = state.store.window_bounds();

    let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Skirin")
        .inner_size(1280.0, 820.0)
        .min_inner_size(1000.0, 660.0)
        // Our own title bar, so no system caption — the buttons are drawn in
        // the header and the frame keeps native resize, snap and shadow.
        .decorations(false)
        .transparent(true)
        .visible(false)
        // Tauri swallows file drops by default and re-emits them as its own
        // event carrying paths. The welcome screen already handles a real
        // HTML5 drop, so handing the webview the native event keeps that
        // working rather than making it a second code path.
        .disable_drag_drop_handler()
        .effects(EffectsBuilder::new().effect(Effect::Mica).build())
        .build()?;

    if let Some(bounds) = saved {
        // Physical, because a saved position can be on a monitor with a
        // different scale factor than the one Tauri would assume.
        let _ = window.set_size(PhysicalSize::new(
            bounds.width.max(400),
            bounds.height.max(300),
        ));
        let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
        if bounds.maximized {
            let _ = window.maximize();
        }
    }

    Ok(window)
}

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

/// The editor, brought to the front — created first if the tray closed it.
pub fn show_editor(app: &AppHandle) -> Option<WebviewWindow> {
    let window = match main_window(app) {
        Some(window) => window,
        None => create_main(app).ok()?,
    };
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
    Some(window)
}

pub fn remember_bounds(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    let maximized = window.is_maximized().unwrap_or(false);
    // A maximized window's outer bounds are the screen; the size worth
    // restoring is the one it had before, so only the flag is updated.
    if maximized {
        let state = app.state::<App>();
        if let Some(mut bounds) = state.store.window_bounds() {
            bounds.maximized = true;
            state.store.set_window_bounds(bounds);
        }
        return;
    }

    if let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) {
        app.state::<App>().store.set_window_bounds(WindowBounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized: false,
        });
    }
}

/// Runs `f` with the editor off screen, then puts it back exactly as it was.
/// Without this the editor ends up in its own screenshot.
pub fn with_hidden_editor<T>(app: &AppHandle, f: impl FnOnce() -> T) -> T {
    let window = main_window(app).filter(|w| w.is_visible().unwrap_or(false));

    if let Some(window) = &window {
        let _ = window.hide();
        std::thread::sleep(std::time::Duration::from_millis(HIDE_SETTLE_MS));
    }

    let result = f();

    if let Some(window) = &window {
        // Back on screen without stealing focus from whatever the user was
        // actually looking at.
        let _ = window.show();
    }

    result
}

/* -------------------------------- delivery ------------------------------- */

/// Applies the user's "after capture" preference: copy, save, open the editor,
/// or some combination.
pub fn deliver(app: &AppHandle, capture: Option<Capture>) -> Option<Capture> {
    deliver_with(app, capture, false)
}

/// `force_editor` overrides the "after capture" preference for the one case
/// that is unambiguously a request to edit — a Windows capture key, pressed
/// with Skirin already in front of the user.
fn deliver_with(app: &AppHandle, capture: Option<Capture>, force_editor: bool) -> Option<Capture> {
    let capture = capture?;
    let state = app.state::<App>();
    let settings = state.store.settings();
    let after = settings.after_capture.as_str();

    if matches!(after, "copy" | "copy-save" | "editor-copy") {
        if let Some(frame) = state.registry.get(&capture.id) {
            if let Some(image) = files::decode(&frame.png) {
                let _ = files::copy_image(&image);
            }
        }
    }

    if matches!(after, "save" | "copy-save") {
        let _ = save_capture(app, &capture);
    }

    if force_editor || matches!(after, "editor" | "editor-copy") {
        if let Some(window) = show_editor(app) {
            let _ = window.emit("capture:new", &capture);
        }
    } else if let Some(window) = main_window(app) {
        // The editor is not being brought forward, but if it is already open
        // it should still learn about the shot.
        let _ = window.emit("capture:stored", &capture);
    }

    Some(capture)
}

/// Writes a capture straight to the save folder using the stored PNG, with no
/// re-encode and no decode round-trip.
pub fn save_capture(app: &AppHandle, capture: &Capture) -> Option<String> {
    let state = app.state::<App>();
    let settings = state.store.settings();
    let frame = state.registry.get(&capture.id)?;

    let dir = state.store.ensure_save_dir();
    let stem = files::render_template(&settings.filename_template);
    let path = files::unique_path(&dir, &stem, "png");

    if let Err(error) = std::fs::write(&path, &frame.png) {
        eprintln!("[skirin] could not save capture: {error}");
        return None;
    }

    add_history(app, &path, &frame, &capture.source_name);
    Some(path.to_string_lossy().into_owned())
}

pub fn add_history(app: &AppHandle, path: &std::path::Path, frame: &Frame, source_name: &str) {
    let Some(image) = files::decode(&frame.png) else {
        return;
    };
    let state = app.state::<App>();
    state.store.push_history(HistoryEntry {
        id: format!(
            "{}-{}",
            capture::now_millis(),
            path.file_name().unwrap_or_default().to_string_lossy()
        ),
        file: path.to_string_lossy().into_owned(),
        thumb: files::thumbnail_data_url(&image, 320),
        created_at: capture::now_millis(),
        width: frame.width,
        height: frame.height,
        source_name: source_name.to_string(),
    });
}

/* --------------------------------- capture ------------------------------- */

#[derive(Clone, Copy)]
pub enum CaptureKind {
    Area,
    Display(Option<i64>),
    LastRegion,
    /// An area selection started from one of Windows' own capture keys. Same
    /// selection, two differences: the editor stays on screen so it can be in
    /// the shot, and the result always lands back in it.
    SystemArea,
}

impl CaptureKind {
    fn keeps_editor(self) -> bool {
        matches!(self, CaptureKind::SystemArea)
    }
}

/// The whole capture path: honour the delay, get out of the way, grab, deliver.
///
/// Blocking by design — it is always called from a blocking task, and the
/// overlay's own wait is a channel receive.
pub fn run_capture(app: &AppHandle, kind: CaptureKind) -> Option<Capture> {
    let delay = app.state::<App>().store.settings().capture_delay;
    if delay > 0.0 {
        std::thread::sleep(std::time::Duration::from_secs_f64(delay));
    }

    let shoot = || match kind {
        CaptureKind::Area | CaptureKind::SystemArea => crate::overlay::begin(app),
        CaptureKind::LastRegion => {
            // Nothing to repeat yet: fall through to a fresh selection rather
            // than doing nothing at all.
            crate::overlay::last_region(app).or_else(|| crate::overlay::begin(app))
        }
        CaptureKind::Display(id) => capture_display(app, id),
    };

    // Getting out of the way is the usual thing to want, and the exception is
    // the whole point of the Windows keys: photographing Skirin's own window.
    let capture = if kind.keeps_editor() {
        shoot()
    } else {
        with_hidden_editor(app, shoot)
    };

    deliver_with(app, capture, kind.keeps_editor())
}

pub fn capture_display(app: &AppHandle, id: Option<i64>) -> Option<Capture> {
    let state = app.state::<App>();
    let shots = state.engine.all_monitors();

    let shot = id
        .and_then(|id| shots.iter().find(|s| s.monitor.id() == id))
        .or_else(|| shots.iter().find(|s| s.monitor.is_primary))
        .or_else(|| shots.first())?;

    let displays = capture::describe_displays();
    let name = displays
        .iter()
        .find(|d| d.id == shot.monitor.id())
        .map(|d| d.label.clone())
        .unwrap_or_else(|| "Display".into());

    Some(capture::publish(
        &state.registry,
        shot.image.clone(),
        "display",
        name,
        shot.monitor.scale_factor,
        Some(shot.monitor.bounds),
    ))
}

pub fn capture_window(app: &AppHandle, hwnd: isize) -> Option<Capture> {
    let state = app.state::<App>();
    let windows = capture::windows_list::enumerate();
    let target = windows.iter().find(|w| w.hwnd == hwnd)?;

    let image = state.engine.window(hwnd, target.rect)?;
    let scale = capture::monitors::enumerate()
        .iter()
        .find(|m| m.bounds.intersects(&target.rect))
        .map(|m| m.scale_factor)
        .unwrap_or(1.0);

    Some(capture::publish(
        &state.registry,
        image,
        "window",
        target.title.clone(),
        scale,
        Some(target.rect),
    ))
}

pub fn is_quitting(app: &AppHandle) -> bool {
    app.state::<App>().quitting.load(Ordering::SeqCst)
}

pub fn set_quitting(app: &AppHandle) {
    app.state::<App>().quitting.store(true, Ordering::SeqCst);
}

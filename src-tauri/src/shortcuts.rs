//! Global hotkeys.
//!
//! Accelerators are stored in Electron's format (`Control+Shift+1`) and the
//! plugin's parser understands it verbatim, so an upgraded install keeps the
//! bindings the user already had.

use std::str::FromStr;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::app::{self, CaptureKind};
use crate::state::App;

/// What a bound key does. Kept as a small enum rather than closures so the
/// handler can be one function that the plugin dispatches into.
#[derive(Clone, Copy, PartialEq)]
enum Action {
    Area,
    Fullscreen,
    Window,
    LastRegion,
    OpenEditor,
}

fn perform(app: &AppHandle, action: Action) {
    let handle = app.clone();
    match action {
        Action::Window => {
            if let Some(window) = app::show_editor(app) {
                let _ = window.emit("ui:open-window-picker", ());
            }
        }
        Action::OpenEditor => {
            app::show_editor(app);
        }
        // Capture blocks — on the overlay's channel, or on DWM handing over a
        // frame — so it never runs on the UI thread.
        Action::Area => spawn_capture(handle, CaptureKind::Area),
        Action::Fullscreen => spawn_capture(handle, CaptureKind::Display(None)),
        Action::LastRegion => spawn_capture(handle, CaptureKind::LastRegion),
    }
}

fn spawn_capture(app: AppHandle, kind: CaptureKind) {
    tauri::async_runtime::spawn_blocking(move || {
        app::run_capture(&app, kind);
    });
}

/// Re-registers every binding from the current settings. Called on boot and
/// whenever the user edits a shortcut, so there is only one code path that can
/// decide what is bound.
pub fn apply(app: &AppHandle) {
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();

    let shortcuts = app.state::<App>().store.settings().shortcuts;
    let bindings = [
        (shortcuts.area, Action::Area),
        (shortcuts.fullscreen, Action::Fullscreen),
        (shortcuts.window, Action::Window),
        (shortcuts.last_region, Action::LastRegion),
        (shortcuts.open_editor, Action::OpenEditor),
    ];

    for (accelerator, action) in bindings {
        if accelerator.trim().is_empty() {
            continue;
        }
        let Ok(shortcut) = Shortcut::from_str(&accelerator) else {
            eprintln!("[skirin] unusable accelerator: {accelerator}");
            continue;
        };

        // A hotkey another application already owns is not an error worth
        // showing — the rest of the bindings still take.
        let handle = app.clone();
        let registered = manager.on_shortcut(shortcut, move |_, _, event| {
            // Without this the action fires twice: once down, once up.
            if event.state() == ShortcutState::Pressed {
                perform(&handle, action);
            }
        });

        if registered.is_err() {
            eprintln!("[skirin] {accelerator} is already taken by another app");
        }
    }
}

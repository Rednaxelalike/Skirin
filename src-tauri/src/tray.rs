//! The tray icon and its menu.

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::app::{self, CaptureKind};
use crate::state::App;

pub const TRAY_ID: &str = "skirin-tray";

/// Baked into the binary at compile time, so there is no file beside the exe
/// that a portable copy could be separated from.
const TRAY_PNG: &[u8] = include_bytes!("../icons/tray.png");

fn tray_icon(app: &AppHandle) -> tauri::image::Image<'static> {
    if let Ok(image) = tauri::image::Image::from_bytes(TRAY_PNG) {
        return image.to_owned();
    }
    // The app icon is borrowed from the handle. `Image::to_owned` consumes by
    // value, so the clone is what lets it be called at all — without it Rust
    // reaches for the blanket `ToOwned`, which keeps the borrow.
    match app.default_window_icon() {
        Some(icon) => icon.clone().to_owned(),
        None => tauri::image::Image::new_owned(vec![0; 4], 1, 1),
    }
}

/// Builds the tray, or takes it away if the user has turned it off. Called on
/// boot and whenever `showTray` changes, so the menu's accelerator hints stay
/// in step with the bindings.
pub fn apply(app: &AppHandle) -> tauri::Result<()> {
    if let Some(existing) = app.tray_by_id(TRAY_ID) {
        app.remove_tray_by_id(TRAY_ID);
        drop(existing);
    }

    let settings = app.state::<App>().store.settings();
    if !settings.show_tray {
        return Ok(());
    }

    let s = &settings.shortcuts;
    let menu = MenuBuilder::new(app)
        .items(&[
            &MenuItemBuilder::with_id("capture-area", "Capture area")
                .accelerator(&s.area)
                .build(app)?,
            &MenuItemBuilder::with_id("capture-display", "Capture full screen")
                .accelerator(&s.fullscreen)
                .build(app)?,
            &MenuItemBuilder::with_id("capture-window", "Capture window…")
                .accelerator(&s.window)
                .build(app)?,
            &MenuItemBuilder::with_id("capture-last", "Repeat last region")
                .accelerator(&s.last_region)
                .build(app)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItemBuilder::with_id("open", "Open Skirin").build(app)?,
            &MenuItemBuilder::with_id("update", "Check for updates…").build(app)?,
            &MenuItemBuilder::with_id("folder", "Open captures folder").build(app)?,
            &MenuItemBuilder::with_id("settings", "Settings…").build(app)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItemBuilder::with_id("quit", "Quit Skirin").build(app)?,
        ])
        .build()?;

    TrayIconBuilder::with_id(TRAY_ID)
        // A purpose-drawn 32px glyph rather than the 256px app icon. The shell
        // renders the tray at 16 or 24 px, and downscaling the large icon that
        // far turns the crop marks into mush.
        .icon(tray_icon(app))
        .tooltip("Skirin — screenshot studio")
        .menu(&menu)
        // Left-click should open the editor, not drop the menu — the menu is
        // the right-click gesture Windows users expect.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                app::show_editor(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "capture-area" => spawn(app, CaptureKind::Area),
        "capture-display" => spawn(app, CaptureKind::Display(None)),
        "capture-last" => spawn(app, CaptureKind::LastRegion),
        "capture-window" => {
            if let Some(window) = app::show_editor(app) {
                let _ = window.emit("ui:open-window-picker", ());
            }
        }
        "open" => {
            app::show_editor(app);
        }
        "settings" => {
            if let Some(window) = app::show_editor(app) {
                let _ = window.emit("ui:open-settings", ());
            }
        }
        "folder" => {
            let dir = app.state::<App>().store.settings().save_dir;
            let _ = std::fs::create_dir_all(&dir);
            let _ = tauri_plugin_opener::open_path(dir, None::<&str>);
        }
        "update" => {
            app::show_editor(app);
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                crate::updater::check(&handle, true).await;
            });
        }
        "quit" => {
            app::set_quitting(app);
            app::remember_bounds(app);
            app.exit(0);
        }
        _ => {}
    }
}

fn spawn(app: &AppHandle, kind: CaptureKind) {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app::run_capture(&handle, kind);
    });
}

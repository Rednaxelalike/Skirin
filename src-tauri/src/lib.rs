//! Skirin — a screenshot studio for Windows.
//!
//! The editor is the same React app the Electron build shipped; everything
//! under here is what used to be `src/main`, rewritten against Win32 and
//! WinRT directly. The seams the editor sees are unchanged: the same settings
//! file, the same accelerators, the same events.

pub mod app;
pub mod autostart;
pub mod capture;
pub mod commands;
pub mod files;
pub mod overlay;
pub mod protocol;
pub mod shortcuts;
pub mod snap;
pub mod state;
pub mod store;
pub mod tray;
pub mod types;
pub mod updater;

use tauri::{Emitter, Manager, RunEvent, WindowEvent};

use state::App;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // A second launch — a Start-menu click while the tray copy is running
        // — should surface the window that already exists, not start a rival
        // process holding the same hotkeys.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            app::show_editor(app);
        }))
        .register_uri_scheme_protocol(protocol::SCHEME, protocol::handle)
        .manage(App::new())
        .invoke_handler(tauri::generate_handler![
            commands::settings_get,
            commands::settings_set,
            commands::presets_get,
            commands::presets_set,
            commands::history_get,
            commands::history_clear,
            commands::capture_area,
            commands::capture_last,
            commands::capture_display,
            commands::capture_displays,
            commands::capture_window_sources,
            commands::capture_window,
            commands::image_copy,
            commands::image_paste,
            commands::image_open,
            commands::image_save,
            commands::shell_reveal,
            commands::shell_open,
            commands::shell_external,
            commands::app_info,
            commands::update_status,
            commands::update_check,
            commands::update_download,
            commands::update_install,
            commands::update_open_releases,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::window_hide,
            commands::window_is_maximized,
            commands::overlay_init,
            commands::overlay_ready,
            commands::overlay_cancel,
            commands::overlay_confirm,
            commands::overlay_broadcast_cursor,
            commands::caption_set_max_rect,
        ])
        .setup(|tauri_app| {
            let handle = tauri_app.handle().clone();
            // Parked before anything else: the Win32 hook in `snap` is called
            // by the shell and has no other route back into the app.
            state::remember(&handle);

            shortcuts::apply(&handle);
            if let Err(error) = tray::apply(&handle) {
                eprintln!("[skirin] tray setup failed: {error}");
            }

            let window = app::create_main(&handle)?;
            // Windows 11's Snap Layouts flyout only appears for a window that
            // claims a maximise button; ours is drawn in HTML, so the claim has
            // to be made by hand.
            snap::attach(&window);
            // `--tray` is how a sign-in launch asks to come up quietly: the
            // hotkeys and tray are live, but nothing appears on screen.
            if !std::env::args().any(|arg| arg == "--tray") {
                let _ = window.show();
            }

            updater::start(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                WindowEvent::CloseRequested { api, .. } if window.label() == app::MAIN => {
                    // With a tray, closing the editor puts it away rather than
                    // ending the session — the hotkeys are the point.
                    if !app::is_quitting(app) && app.state::<App>().store.settings().show_tray {
                        api.prevent_close();
                        app::remember_bounds(app);
                        let _ = window.hide();
                    } else {
                        app::remember_bounds(app);
                    }
                }
                WindowEvent::Destroyed if window.label().starts_with("overlay-") => {
                    // A overlay that goes away on its own — a crash, or the
                    // user closing it through the shell — still has to release
                    // whoever is waiting on the selection.
                    overlay::cancel(app);
                }
                WindowEvent::Resized(_) if window.label() == app::MAIN => {
                    let maximized = window.is_maximized().unwrap_or(false);
                    let _ = window.emit("window:state", maximized);
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start Skirin")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                app::remember_bounds(app);
            }
        });
}

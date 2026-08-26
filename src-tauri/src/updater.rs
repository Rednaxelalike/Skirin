//! Background update checks and one-click install.
//!
//! The shape the editor sees is unchanged from the Electron build: a single
//! `UpdateStatus` broadcast on every transition, and one click that carries the
//! whole way through download, install and relaunch.

use std::time::Duration;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::state::App;
use crate::types::UpdateStatus;

/// First check runs once the window has settled, not during the boot rush.
const FIRST_CHECK: Duration = Duration::from_secs(12);
/// Background re-check cadence for long-running sessions.
const INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

const RELEASES: &str = "https://github.com/Rednaxelalike/Skirin/releases/latest";

/// The pending update and its bytes, held between "download" and "install" so
/// a user who downloads now and restarts later does not pay for it twice.
static PENDING: Mutex<Option<(Update, Vec<u8>)>> = Mutex::new(None);

/// How this copy was installed. Only an NSIS install can replace itself in
/// place; the others get sent to the release page.
pub fn channel(app: &AppHandle) -> &'static str {
    if tauri::is_dev() {
        return "development";
    }
    let installed = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").exists()))
        .unwrap_or(false);
    let _ = app;
    if installed {
        "installed"
    } else {
        "portable"
    }
}

fn can_self_update(app: &AppHandle) -> bool {
    channel(app) == "installed"
}

pub fn status(app: &AppHandle) -> UpdateStatus {
    app.state::<App>().update.lock().clone()
}

/// Records a transition and tells every window about it in one place, so the
/// pill in the title bar and the Settings panel can never disagree.
fn broadcast(app: &AppHandle, apply: impl FnOnce(&mut UpdateStatus)) -> UpdateStatus {
    let next = {
        let state = app.state::<App>();
        let mut status = state.update.lock();
        apply(&mut status);
        status.clone()
    };
    let _ = app.emit("update:status", &next);
    next
}

fn fail(app: &AppHandle, message: String) {
    broadcast(app, |status| {
        status.state = "error".into();
        status.error = Some(message);
        status.percent = 0;
    });
}

/// A check the user asked for reports back either way — including "you're up to
/// date", which the quiet background check swallows.
pub async fn check(app: &AppHandle, explicit: bool) -> UpdateStatus {
    if !can_self_update(app) {
        if explicit {
            let _ = tauri_plugin_opener::open_url(RELEASES, None::<&str>);
        }
        return status(app);
    }

    if explicit {
        broadcast(app, |status| {
            status.state = "checking".into();
            status.error = None;
        });
    }

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => {
            if explicit {
                fail(app, error.to_string());
            }
            return status(app);
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let found = broadcast(app, |status| {
                status.state = "available".into();
                status.version = Some(update.version.clone());
                status.notes = update.body.clone();
                status.percent = 0;
                status.error = None;
            });
            // Park the handle so a later download does not have to check again
            // just to get it back, and drop any package from a previous round.
            *PENDING.lock() = None;
            *PARKED.lock() = Some(update);
            found
        }
        Ok(None) => broadcast(app, |status| {
            status.state = "idle".into();
            status.percent = 0;
            status.error = None;
        }),
        Err(error) => {
            // A quiet check that fails is almost always "offline" or "no
            // release yet". Only say so when the user is watching.
            if explicit {
                fail(app, error.to_string());
            }
            status(app)
        }
    }
}

/// The update found by the last check, waiting to be downloaded.
static PARKED: Mutex<Option<Update>> = Mutex::new(None);

/// Downloads the package and, unless told otherwise, installs and relaunches
/// straight through — one click from "Update" to a restarted app.
pub async fn download(app: &AppHandle, install_when_ready: bool) -> UpdateStatus {
    if !can_self_update(app) {
        let _ = tauri_plugin_opener::open_url(RELEASES, None::<&str>);
        return status(app);
    }

    // Taken into a local first: a parking_lot guard is not Send, and holding
    // one across the await below would make this whole future unspawnable.
    let parked = PARKED.lock().take();
    let update = match parked {
        Some(update) => update,
        None => {
            // Nothing parked: the user clicked before a check landed, or the
            // app has been open since before the release.
            check(app, true).await;
            let retry = PARKED.lock().take();
            match retry {
                Some(update) => update,
                None => return status(app),
            }
        }
    };

    broadcast(app, |status| {
        status.state = "downloading".into();
        status.percent = 0;
        status.error = None;
    });

    let total = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let seen = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let last = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));

    let progress_app = app.clone();
    let (total_c, seen_c, last_c) = (total.clone(), seen.clone(), last.clone());

    let downloaded = update
        .download(
            move |chunk, length| {
                use std::sync::atomic::Ordering::Relaxed;
                if let Some(length) = length {
                    total_c.store(length, Relaxed);
                }
                let done = seen_c.fetch_add(chunk as u64, Relaxed) + chunk as u64;
                let size = total_c.load(Relaxed);
                if size == 0 {
                    return;
                }
                let percent = (done * 100 / size).min(100);
                // One event per whole percent: a 60 MB download would
                // otherwise fire thousands of times and the progress bar
                // spends more time in IPC than moving.
                if percent > last_c.swap(percent, Relaxed) {
                    broadcast(&progress_app, |status| {
                        status.state = "downloading".into();
                        status.percent = percent as u8;
                    });
                }
            },
            || {},
        )
        .await;

    let bytes = match downloaded {
        Ok(bytes) => bytes,
        Err(error) => {
            fail(app, error.to_string());
            return status(app);
        }
    };

    let version = update.version.clone();
    broadcast(app, |status| {
        status.state = "ready".into();
        status.version = Some(version);
        status.percent = 100;
        status.error = None;
    });

    *PENDING.lock() = Some((update, bytes));

    if install_when_ready {
        // A beat so the renderer can paint "Restarting…" before the window
        // goes away under it.
        tokio::time::sleep(Duration::from_millis(700)).await;
        install(app);
    }

    status(app)
}

/// Applies a downloaded update and relaunches. Never returns on success.
pub fn install(app: &AppHandle) -> bool {
    let Some((update, bytes)) = PENDING.lock().take() else {
        return false;
    };

    crate::app::set_quitting(app);
    crate::app::remember_bounds(app);

    if let Err(error) = update.install(bytes) {
        fail(app, error.to_string());
        return false;
    }

    app.restart();
}

pub fn open_releases() {
    let _ = tauri_plugin_opener::open_url(RELEASES, None::<&str>);
}

/// Quiet background checks — the editor only hears about actual findings.
pub fn start(app: &AppHandle) {
    if !can_self_update(app) {
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            check(&handle, false).await;
            tokio::time::sleep(INTERVAL).await;
        }
    });
}

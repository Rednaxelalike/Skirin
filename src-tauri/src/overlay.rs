//! The area-selection overlay.
//!
//! One borderless, transparent, always-on-top window per monitor, each showing
//! that monitor's frozen frame. The frames are grabbed first and the windows
//! opened over them, so what the user drags a box on is a still — dragging
//! across a playing video selects the frame they actually saw.
//!
//! Unlike the Electron build, an overlay pulls its own payload with a command
//! on mount instead of waiting for a push after `did-finish-load`. There is no
//! window in which the event can arrive before the listener is attached.

use std::collections::HashMap;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use crate::capture::{self, Shot};
use crate::state::App;
use crate::types::{Capture, OverlayInit, Rect};

const LABEL_PREFIX: &str = "overlay-";

pub struct Session {
    pub shots: Vec<Shot>,
    pub payloads: HashMap<String, OverlayInit>,
    pub labels: Vec<String>,
    reply: SyncSender<Option<Capture>>,
    done: bool,
}

impl Session {
    pub fn payload(&self, label: &str) -> Option<OverlayInit> {
        self.payloads.get(label).cloned()
    }
}

/// Tears every overlay window down and hands the result back to whoever asked
/// for the selection. Safe to call twice — a click that lands at the same
/// moment as an Escape must not resolve the capture twice.
pub fn finish(app: &AppHandle, capture: Option<Capture>) {
    let state = app.state::<App>();
    let session = {
        let mut slot = state.overlay.lock();
        match slot.as_mut() {
            Some(session) if !session.done => {
                session.done = true;
                slot.take()
            }
            _ => None,
        }
    };

    let Some(session) = session else {
        return;
    };

    for label in &session.labels {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.destroy();
        }
    }
    let _ = session.reply.try_send(capture);
}

pub fn cancel(app: &AppHandle) {
    finish(app, None);
}

/// Resolves a selection rect, in physical screen pixels, against the frozen
/// frames and finishes the session.
pub fn confirm(app: &AppHandle, rect: Rect, label: String) {
    let state = app.state::<App>();

    let normalized = Rect {
        x: rect.x,
        y: rect.y,
        width: rect.width.max(1),
        height: rect.height.max(1),
    };

    let capture = {
        let slot = state.overlay.lock();
        let Some(session) = slot.as_ref() else {
            return;
        };
        capture::shot_for_rect(&session.shots, &normalized)
            .and_then(|shot| capture::crop(shot, normalized).map(|cropped| (shot, cropped)))
            .map(|(shot, (image, actual))| {
                let name = if label.is_empty() {
                    "Selection".to_string()
                } else {
                    label
                };
                capture::publish(
                    &state.registry,
                    image,
                    "area",
                    name,
                    shot.monitor.scale_factor,
                    Some(actual),
                )
            })
    };

    if let Some(capture) = &capture {
        if state.store.settings().remember_last_region {
            if let Some(region) = capture.region {
                let patch = serde_json::json!({ "lastRegion": region });
                state.store.patch_settings(&patch);
            }
        }
    }

    finish(app, capture);
}

/// Opens the overlay across every monitor and blocks until the user picks a
/// region or backs out.
pub fn begin(app: &AppHandle) -> Option<Capture> {
    // A second overlay would fight the first for the pointer; the older one
    // loses.
    cancel(app);

    let state = app.state::<App>();
    let settings = state.store.settings();

    let shots = state.engine.all_monitors();
    if shots.is_empty() {
        return None;
    }
    // The editor snaps like any other window when it is on screen; when it is
    // hidden for the capture it drops out on its own.
    let native_windows = capture::windows_list::enumerate_with(crate::app::main_hwnd(app));

    let (tx, rx): (SyncSender<Option<Capture>>, Receiver<Option<Capture>>) = sync_channel(1);

    let mut payloads = HashMap::new();
    let mut labels = Vec::new();

    for (index, shot) in shots.iter().enumerate() {
        let bounds = shot.monitor.bounds;
        let label = format!("{LABEL_PREFIX}{index}");

        // The frozen frame goes through the same registry as a capture, so the
        // overlay streams it over the custom protocol instead of receiving a
        // multi-megabyte data URL per monitor.
        let frame_id = format!("overlay-{}-{}", shot.monitor.id(), capture::now_millis());
        let png = capture::encode_png(&shot.image);
        let (width, height) = (shot.image.width(), shot.image.height());
        state
            .registry
            .insert(frame_id.clone(), capture::Frame { png, width, height });

        payloads.insert(
            label.clone(),
            OverlayInit {
                display_id: shot.monitor.id(),
                bounds,
                scale_factor: shot.monitor.scale_factor,
                src: capture::frame_url(&frame_id),
                magnifier: settings.magnifier,
                last_region: settings.last_region,
                // Only the windows that actually touch this monitor, so the
                // hit test on the other side stays a short linear scan.
                windows: native_windows
                    .iter()
                    .map(|w| w.rect)
                    .filter(|r| r.intersects(&bounds))
                    .collect(),
            },
        );

        let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("overlay.html".into()))
            .title("Skirin selection")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .shadow(false)
            .visible(false)
            .build();

        match built {
            Ok(window) => {
                // Physical units throughout: a logical size would be scaled by
                // whichever monitor Tauri considers current, which is wrong for
                // every other screen in a mixed-DPI setup.
                let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
                let _ = window.set_size(PhysicalSize::new(
                    bounds.width.max(1) as u32,
                    bounds.height.max(1) as u32,
                ));
                labels.push(label);
            }
            Err(error) => eprintln!("[skirin] overlay window failed: {error}"),
        }
    }

    if labels.is_empty() {
        return None;
    }

    *state.overlay.lock() = Some(Session {
        shots,
        payloads,
        labels,
        reply: tx,
        done: false,
    });

    rx.recv().unwrap_or(None)
}

/// Re-uses the previously captured region without showing the overlay at all.
pub fn last_region(app: &AppHandle) -> Option<Capture> {
    let state = app.state::<App>();
    let region = state.store.settings().last_region?;

    let shots = state.engine.all_monitors();
    let shot = capture::shot_for_rect(&shots, &region)?;
    let (image, actual) = capture::crop(shot, region)?;

    Some(capture::publish(
        &state.registry,
        image,
        "area",
        "Last region".into(),
        shot.monitor.scale_factor,
        Some(actual),
    ))
}

/// Shows an overlay once its webview has decoded the frozen frame — before
/// that it would flash an empty transparent window over the desktop.
pub fn mark_ready(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

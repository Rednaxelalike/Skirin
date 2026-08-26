//! The `skirin://` protocol that hands captured frames to the webview.
//!
//! This is what replaces Electron's data URLs. A capture stays in Rust as PNG
//! bytes and the editor is given `skirin://frame/<id>`; the webview then
//! fetches it like any other image, decoding off the main thread. For a 4K
//! screen that is roughly 8 MB streamed once instead of 24 MB of base64 built,
//! copied across the IPC boundary, and parsed again.

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeContext};

use crate::state::App;

pub const SCHEME: &str = "skirin";

pub fn handle(
    context: UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let app: &AppHandle = context.app_handle();

    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap_or_default()
    };

    // `skirin://frame/<id>` arrives here as `http://skirin.localhost/frame/<id>`
    // on Windows, so the id is simply the last path segment either way.
    let path = request.uri().path();
    let Some(id) = path.rsplit('/').next().filter(|id| !id.is_empty()) else {
        return not_found();
    };

    let Some(frame) = app.state::<App>().registry.get(id) else {
        return not_found();
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/png")
        .header(header::CONTENT_LENGTH, frame.png.len())
        // The editor reads these back through a canvas — for the colour
        // picker, the trim detector and every export. Without an explicit
        // allow-origin the canvas is tainted and `toDataURL` throws.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        // Ids are unique per capture and the pool evicts old frames, so there
        // is nothing a cache could usefully hold on to.
        .header(header::CACHE_CONTROL, "no-store")
        .body(frame.png.clone())
        .unwrap_or_else(|_| not_found())
}

//! Snap Layouts support for the custom title bar.
//!
//! Electron drew the caption buttons natively, so Windows 11's Snap Layouts
//! flyout — the grid of arrangements that appears when you hover Maximise —
//! came for free. Tauri has no native caption, so the app draws its own, and
//! that flyout only ever appears for a window that answers `WM_NCHITTEST` with
//! `HTMAXBUTTON`. Without this the rewrite would quietly lose a feature.
//!
//! The shell also expects the button to *behave* like a caption button once it
//! claims to be one: the click arrives as a non-client message that the webview
//! never sees, so maximising is handled here too.

use std::sync::atomic::{AtomicI32, Ordering};

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    HTCLIENT, HTMAXBUTTON, WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP,
};

use tauri::{Emitter, Manager, WebviewWindow};

const SUBCLASS_ID: usize = 0x5C12;

/// The maximise button's bounds, in physical pixels relative to the window's
/// client area. Reported by the renderer, which is the only side that knows
/// where it laid the button out.
static RECT: [AtomicI32; 4] = [
    AtomicI32::new(0),
    AtomicI32::new(0),
    AtomicI32::new(0),
    AtomicI32::new(0),
];

pub fn set_button_rect(x: i32, y: i32, width: i32, height: i32) {
    RECT[0].store(x, Ordering::Relaxed);
    RECT[1].store(y, Ordering::Relaxed);
    RECT[2].store(width, Ordering::Relaxed);
    RECT[3].store(height, Ordering::Relaxed);
}

fn hits_button(hwnd: HWND, lparam: LPARAM) -> bool {
    let width = RECT[2].load(Ordering::Relaxed);
    let height = RECT[3].load(Ordering::Relaxed);
    if width <= 0 || height <= 0 {
        return false;
    }

    // WM_NCHITTEST carries screen coordinates; the reported rect is relative to
    // the window, so the window's own origin is the bridge between them.
    let screen_x = (lparam.0 & 0xFFFF) as i16 as i32;
    let screen_y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;

    let mut origin = windows::Win32::Foundation::RECT::default();
    if unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut origin) }.is_err()
    {
        return false;
    }

    let x = screen_x - origin.left;
    let y = screen_y - origin.top;
    let left = RECT[0].load(Ordering::Relaxed);
    let top = RECT[1].load(Ordering::Relaxed);

    x >= left && x < left + width && y >= top && y < top + height
}

unsafe extern "system" fn proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match message {
        WM_NCHITTEST => {
            // Let Tauri answer first so the resize borders keep priority — a
            // maximise button in the corner must not swallow the grip.
            let base = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            if base.0 as u32 == HTCLIENT && hits_button(hwnd, lparam) {
                return LRESULT(HTMAXBUTTON as isize);
            }
            base
        }

        // Claiming HTMAXBUTTON means the press never reaches the webview, so
        // the hover and click states the button paints have to be driven here.
        WM_NCLBUTTONDOWN if wparam.0 as u32 == HTMAXBUTTON => LRESULT(0),

        WM_NCLBUTTONUP if wparam.0 as u32 == HTMAXBUTTON => {
            if hits_button(hwnd, lparam) {
                notify_click();
            }
            LRESULT(0)
        }

        _ => unsafe { DefSubclassProc(hwnd, message, wparam, lparam) },
    }
}

/// Posted rather than handled inline: toggling the window from inside its own
/// window procedure re-enters the message loop, and doing that during
/// non-client handling deadlocks against the shell's snap animation.
///
/// Only the editor is ever subclassed, so there is no need to match the HWND
/// back to a window — which is just as well, since Tauri hands out handles
/// from its own vendored copy of the `windows` crate.
fn notify_click() {
    let Some(app) = crate::state::handle() else {
        return;
    };
    let _ = app.clone().run_on_main_thread(move || {
        let Some(window) = app.get_webview_window(crate::app::MAIN) else {
            return;
        };
        let maximized = window.is_maximized().unwrap_or(false);
        let _ = if maximized {
            window.unmaximize()
        } else {
            window.maximize()
        };
        let _ = window.emit("window:state", !maximized);
    });
}

/// Attaches the hook. Safe to call once per window; a second call for the same
/// window is a no-op as far as the shell is concerned.
pub fn attach(window: &WebviewWindow) {
    let Ok(handle) = window.hwnd() else {
        return;
    };
    // Tauri's `HWND` comes from a different `windows` release than this crate
    // links, so the handle travels across as the raw pointer it has always
    // been underneath.
    let hwnd = HWND(handle.0);
    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(proc), SUBCLASS_ID, 0);
    }
}

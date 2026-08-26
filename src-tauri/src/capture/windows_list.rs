//! Top-level window enumeration, front-most first.
//!
//! The Electron build shelled out to PowerShell with an inline C# type for
//! this, which cost a process spawn plus a Roslyn compile — several hundred
//! milliseconds on the first area capture, every session. `EnumWindows` is the
//! same API that script was reaching for, so this is the identical result
//! without the detour: a warm call lands in well under a millisecond.

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowLongPtrW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, GWL_STYLE, WS_CHILD,
    WS_EX_TOOLWINDOW,
};

use crate::types::Rect;

/// Anything smaller than this is a tooltip, a drop shadow or a splash — never
/// something a user means to snap a capture to.
const MIN_EDGE: i32 = 60;

#[derive(Debug, Clone)]
pub struct NativeWindow {
    pub hwnd: isize,
    pub title: String,
    pub process: String,
    /// Screen coordinates, physical pixels, DWM frame bounds.
    pub rect: Rect,
}

fn wide_to_string(buf: &[u16], len: usize) -> String {
    String::from_utf16_lossy(&buf[..len.min(buf.len())])
}

fn process_name(pid: u32) -> String {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = windows::Win32::Foundation::CloseHandle(handle);
        if ok.is_err() {
            return String::new();
        }
        let path = wide_to_string(&buf, len as usize);
        path.rsplit('\\')
            .next()
            .unwrap_or_default()
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_string()
    }
}

/// The frame the user actually sees. `GetWindowRect` includes the invisible
/// resize border DWM leaves around modern windows, so a capture snapped to it
/// carries a few pixels of whatever is behind.
fn frame_bounds(hwnd: HWND) -> Option<Rect> {
    let mut r = RECT::default();
    let extended = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut r as *mut RECT as *mut core::ffi::c_void,
            size_of::<RECT>() as u32,
        )
    };
    if extended.is_err() {
        unsafe { GetWindowRect(hwnd, &mut r) }.ok()?;
    }
    Some(Rect {
        x: r.left,
        y: r.top,
        width: r.right - r.left,
        height: r.bottom - r.top,
    })
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    let ok = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut core::ffi::c_void,
            size_of::<u32>() as u32,
        )
    };
    ok.is_ok() && cloaked != 0
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = unsafe { &mut *(lparam.0 as *mut (Vec<NativeWindow>, u32)) };
    let (list, own_pid) = (&mut state.0, state.1);

    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return BOOL(1);
        }

        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if style & WS_CHILD.0 != 0 || ex_style & WS_EX_TOOLWINDOW.0 != 0 {
            return BOOL(1);
        }

        // UWP keeps a fleet of invisible host windows parked off-screen; DWM
        // flags them cloaked and they are the reason a naive EnumWindows list
        // is full of phantoms.
        if is_cloaked(hwnd) {
            return BOOL(1);
        }

        let title_len = GetWindowTextLengthW(hwnd);
        if title_len <= 0 {
            return BOOL(1);
        }
        let mut title_buf = vec![0u16; title_len as usize + 1];
        let written = GetWindowTextW(hwnd, &mut title_buf);
        if written <= 0 {
            return BOOL(1);
        }
        let title = wide_to_string(&title_buf, written as usize);

        let Some(rect) = frame_bounds(hwnd) else {
            return BOOL(1);
        };
        if rect.width < MIN_EDGE || rect.height < MIN_EDGE {
            return BOOL(1);
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == own_pid {
            return BOOL(1);
        }

        list.push(NativeWindow {
            hwnd: hwnd.0 as isize,
            title,
            process: process_name(pid),
            rect,
        });
    }

    BOOL(1)
}

/// `EnumWindows` walks the z-order, so index 0 is the front-most window and a
/// hit test can stop at the first match.
pub fn enumerate() -> Vec<NativeWindow> {
    let mut state: (Vec<NativeWindow>, u32) = (Vec::new(), unsafe { GetCurrentProcessId() });
    unsafe {
        let _ = EnumWindows(
            Some(collect),
            LPARAM(&mut state as *mut (Vec<NativeWindow>, u32) as isize),
        );
    }
    state.0
}

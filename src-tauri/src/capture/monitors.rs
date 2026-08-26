//! Monitor enumeration.
//!
//! Everything here is in **physical pixels**. The Electron build worked in
//! Chromium's global DIP space and converted at the edges, which is ambiguous
//! the moment two monitors run at different scale factors. Physical pixels are
//! the coordinate space Win32, DXGI and the capture APIs all already agree on,
//! so the backend never converts and only the overlay — which knows its own
//! monitor's scale — deals in CSS pixels.

use windows::core::BOOL;
use windows::Win32::Foundation::{LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayDevicesW, EnumDisplayMonitors, GetMonitorInfoW, DISPLAY_DEVICEW, HDC, HMONITOR,
    MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

use crate::types::{DisplayInfo, Rect};

#[derive(Debug, Clone, Copy)]
pub struct Monitor {
    pub handle: isize,
    pub bounds: Rect,
    pub work_area: Rect,
    pub scale_factor: f64,
    pub is_primary: bool,
    /// `\\.\DISPLAY1` — the adapter key `EnumDisplayDevicesW` wants.
    device: [u16; 32],
}

impl Monitor {
    pub fn hmonitor(&self) -> HMONITOR {
        HMONITOR(self.handle as *mut core::ffi::c_void)
    }

    pub fn id(&self) -> i64 {
        self.handle as i64
    }
}

fn to_rect(r: RECT) -> Rect {
    Rect {
        x: r.left,
        y: r.top,
        width: r.right - r.left,
        height: r.bottom - r.top,
    }
}

fn wide_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

unsafe extern "system" fn collect(
    handle: HMONITOR,
    _hdc: HDC,
    _clip: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let list = unsafe { &mut *(lparam.0 as *mut Vec<Monitor>) };

    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
    let ok =
        unsafe { GetMonitorInfoW(handle, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO) };
    if !ok.as_bool() {
        return BOOL(1);
    }

    // Effective DPI is the one the shell actually renders at, and the one the
    // webview will report as `devicePixelRatio`.
    let mut dpi_x = 96u32;
    let mut dpi_y = 96u32;
    let scale = unsafe {
        match GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) {
            Ok(()) => dpi_x as f64 / 96.0,
            Err(_) => 1.0,
        }
    };

    list.push(Monitor {
        handle: handle.0 as isize,
        bounds: to_rect(info.monitorInfo.rcMonitor),
        work_area: to_rect(info.monitorInfo.rcWork),
        scale_factor: if scale > 0.0 { scale } else { 1.0 },
        is_primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
        device: info.szDevice,
    });

    BOOL(1)
}

/// Primary monitor first, then left-to-right — a stable order the display
/// picker can number against.
pub fn enumerate() -> Vec<Monitor> {
    let mut list: Vec<Monitor> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(collect),
            LPARAM(&mut list as *mut Vec<Monitor> as isize),
        );
    }
    list.sort_by_key(|m| (!m.is_primary, m.bounds.x, m.bounds.y));
    list
}

pub fn primary() -> Option<Monitor> {
    enumerate().into_iter().find(|m| m.is_primary)
}

/// The adapter's friendly name — "Dell U2720Q" rather than `\.\DISPLAY2`.
fn friendly_name(monitor: &Monitor) -> Option<String> {
    let mut device = DISPLAY_DEVICEW {
        cb: size_of::<DISPLAY_DEVICEW>() as u32,
        ..Default::default()
    };
    let ok = unsafe {
        EnumDisplayDevicesW(
            windows::core::PCWSTR(monitor.device.as_ptr()),
            0,
            &mut device,
            0,
        )
    };
    if !ok.as_bool() {
        return None;
    }
    let name = wide_to_string(&device.DeviceString);
    if name.trim().is_empty() {
        None
    } else {
        Some(name)
    }
}

pub fn describe(monitors: &[Monitor]) -> Vec<DisplayInfo> {
    monitors
        .iter()
        .enumerate()
        .map(|(index, m)| DisplayInfo {
            id: m.id(),
            bounds: m.bounds,
            work_area: m.work_area,
            scale_factor: m.scale_factor,
            is_primary: m.is_primary,
            label: friendly_name(m).unwrap_or_else(|| format!("Display {}", index + 1)),
        })
        .collect()
}

/// The monitor a screen-space rect sits on, chosen by its centre point so a
/// selection that overhangs an edge still lands on the screen it started from.
pub fn for_rect(monitors: &[Monitor], rect: &Rect) -> Option<usize> {
    let cx = rect.x + rect.width / 2;
    let cy = rect.y + rect.height / 2;
    monitors
        .iter()
        .position(|m| m.bounds.contains(cx, cy))
        .or(if monitors.is_empty() { None } else { Some(0) })
}

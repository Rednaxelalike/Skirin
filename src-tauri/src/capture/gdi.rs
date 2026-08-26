//! GDI fallback.
//!
//! Only reached when Windows.Graphics.Capture is unavailable or refuses an
//! item — an unpatched Windows 10, a remote session, or a window whose
//! compositor surface DWM will not hand over. The result is a plain blit, so
//! it cannot see behind an occluding window and it flattens layered surfaces,
//! but a slightly wrong screenshot beats no screenshot.

use image::RgbaImage;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HBITMAP, HDC,
    HGDIOBJ, SRCCOPY,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::PW_RENDERFULLCONTENT;

use crate::types::Rect;

/// A device-independent bitmap plus the handles that keep it alive, so every
/// exit path releases GDI objects exactly once.
struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    bits: *mut core::ffi::c_void,
    width: i32,
    height: i32,
}

impl Surface {
    fn new(reference: HDC, width: i32, height: i32) -> Option<Self> {
        if width <= 0 || height <= 0 {
            return None;
        }

        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = width;
        // Negative height asks GDI for a top-down bitmap, which saves flipping
        // every row by hand on the way out.
        info.bmiHeader.biHeight = -height;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB.0;

        unsafe {
            let dc = CreateCompatibleDC(Some(reference));
            if dc.is_invalid() {
                return None;
            }
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let bitmap = match CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
            {
                Ok(bitmap) if !bits.is_null() => bitmap,
                _ => {
                    let _ = DeleteDC(dc);
                    return None;
                }
            };
            let previous = SelectObject(dc, HGDIOBJ(bitmap.0));
            Some(Self {
                dc,
                bitmap,
                previous,
                bits,
                width,
                height,
            })
        }
    }

    /// BGRX as GDI leaves it, to opaque RGBA. GDI never writes a meaningful
    /// alpha channel, so trusting it here is what produces the classic
    /// fully-transparent screenshot.
    fn into_image(self) -> Option<RgbaImage> {
        let pixels = (self.width as usize) * (self.height as usize);
        let mut out = vec![0u8; pixels * 4];
        unsafe {
            let src = std::slice::from_raw_parts(self.bits as *const u8, pixels * 4);
            for (s, d) in src.chunks_exact(4).zip(out.chunks_exact_mut(4)) {
                d[0] = s[2];
                d[1] = s[1];
                d[2] = s[0];
                d[3] = 255;
            }
        }
        RgbaImage::from_raw(self.width as u32, self.height as u32, out)
    }
}

impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.previous);
            let _ = DeleteObject(HGDIOBJ(self.bitmap.0));
            let _ = DeleteDC(self.dc);
        }
    }
}

/// Blits a screen-space rect straight off the desktop DC. Coordinates are
/// virtual-screen physical pixels, so a monitor left of the primary blits from
/// a negative x — which is exactly what the desktop DC expects.
pub fn monitor(bounds: Rect) -> Option<RgbaImage> {
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return None;
        }
        let surface = Surface::new(screen, bounds.width, bounds.height);
        let image = surface.and_then(|surface| {
            let blit = BitBlt(
                surface.dc,
                0,
                0,
                bounds.width,
                bounds.height,
                Some(screen),
                bounds.x,
                bounds.y,
                // CAPTUREBLT pulls in layered windows, which is most tooltips
                // and every modern drop shadow.
                ROP(SRCCOPY.0 | CAPTUREBLT.0),
            );
            if blit.is_err() {
                None
            } else {
                surface.into_image()
            }
        });
        ReleaseDC(None, screen);
        image
    }
}

/// Asks the window to redraw itself into our bitmap. `PW_RENDERFULLCONTENT` is
/// what makes this work for DirectComposition windows — browsers, terminals,
/// anything hardware-accelerated — which a plain `PrintWindow` renders blank.
pub fn window(hwnd: HWND, bounds: Rect) -> Option<RgbaImage> {
    unsafe {
        let reference = GetDC(None);
        if reference.is_invalid() {
            return None;
        }
        let surface = Surface::new(reference, bounds.width, bounds.height);
        ReleaseDC(None, reference);

        let surface = surface?;
        let ok = PrintWindow(hwnd, surface.dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT));
        if !ok.as_bool() {
            return None;
        }
        surface.into_image()
    }
}

/// `BitBlt` takes a single raster op code; `SRCCOPY | CAPTUREBLT` has to be
/// rebuilt into one rather than passed as two flags.
#[allow(non_snake_case)]
fn ROP(value: u32) -> windows::Win32::Graphics::Gdi::ROP_CODE {
    windows::Win32::Graphics::Gdi::ROP_CODE(value)
}

//! Window icons for the picker.
//!
//! Electron handed these over as part of `getSources({ fetchWindowIcons: true })`.
//! Asking the window itself is both the same source and cheaper: `WM_GETICON`
//! with a short timeout, falling back to the class icon, so a hung application
//! costs the listing a few milliseconds rather than blocking it.

use image::RgbaImage;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassLongPtrW, GetIconInfo, SendMessageTimeoutW, GCLP_HICON, HICON, ICONINFO, ICON_BIG,
    ICON_SMALL2, SMTO_ABORTIFHUNG, WM_GETICON,
};

/// Long enough for a responsive window, short enough that a wedged one does
/// not stall the whole listing.
const ASK_TIMEOUT_MS: u32 = 60;

fn ask(hwnd: HWND, which: u32) -> Option<HICON> {
    let mut result: usize = 0;
    unsafe {
        SendMessageTimeoutW(
            hwnd,
            WM_GETICON,
            WPARAM(which as usize),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            ASK_TIMEOUT_MS,
            Some(&mut result),
        );
    }
    if result == 0 {
        None
    } else {
        Some(HICON(result as *mut core::ffi::c_void))
    }
}

fn handle(hwnd: HWND) -> Option<HICON> {
    ask(hwnd, ICON_BIG)
        .or_else(|| ask(hwnd, ICON_SMALL2))
        .or_else(|| {
            let class = unsafe { GetClassLongPtrW(hwnd, GCLP_HICON) };
            if class == 0 {
                None
            } else {
                Some(HICON(class as *mut core::ffi::c_void))
            }
        })
}

/// Reads an icon's colour bitmap into RGBA.
///
/// Icons older than XP carry no alpha channel at all, and come back fully
/// transparent if the DIB is trusted blindly — hence the all-zero check and
/// the fall back to the AND mask, where a set bit means "leave this pixel".
pub fn window_icon(hwnd: isize) -> Option<RgbaImage> {
    let hwnd = HWND(hwnd as *mut core::ffi::c_void);
    let icon = handle(hwnd)?;

    unsafe {
        let mut info = ICONINFO::default();
        GetIconInfo(icon, &mut info).ok()?;

        let colour = info.hbmColor;
        let mask = info.hbmMask;

        let cleanup = |image: Option<RgbaImage>| {
            use windows::Win32::Graphics::Gdi::DeleteObject;
            if !colour.is_invalid() {
                let _ = DeleteObject(HGDIOBJ(colour.0));
            }
            if !mask.is_invalid() {
                let _ = DeleteObject(HGDIOBJ(mask.0));
            }
            image
        };

        if colour.is_invalid() {
            return cleanup(None);
        }

        let mut bitmap = BITMAP::default();
        let read = GetObjectW(
            HGDIOBJ(colour.0),
            size_of::<BITMAP>() as i32,
            Some(&mut bitmap as *mut BITMAP as *mut core::ffi::c_void),
        );
        if read == 0 || bitmap.bmWidth <= 0 || bitmap.bmHeight <= 0 {
            return cleanup(None);
        }

        let width = bitmap.bmWidth as u32;
        let height = bitmap.bmHeight as u32;

        let dc = CreateCompatibleDC(None);
        if dc.is_invalid() {
            return cleanup(None);
        }

        let mut header = BITMAPINFO::default();
        header.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        header.bmiHeader.biWidth = bitmap.bmWidth;
        header.bmiHeader.biHeight = -bitmap.bmHeight;
        header.bmiHeader.biPlanes = 1;
        header.bmiHeader.biBitCount = 32;
        header.bmiHeader.biCompression = BI_RGB.0;

        let mut bgra = vec![0u8; (width * height * 4) as usize];
        let lines = GetDIBits(
            dc,
            colour,
            0,
            height,
            Some(bgra.as_mut_ptr() as *mut core::ffi::c_void),
            &mut header,
            DIB_RGB_COLORS,
        );

        if lines == 0 {
            let _ = DeleteDC(dc);
            return cleanup(None);
        }

        let opaque = bgra.chunks_exact(4).all(|p| p[3] == 0);
        let mut mask_bits = vec![0u8; (width * height * 4) as usize];
        if opaque && !mask.is_invalid() {
            GetDIBits(
                dc,
                mask,
                0,
                height,
                Some(mask_bits.as_mut_ptr() as *mut core::ffi::c_void),
                &mut header,
                DIB_RGB_COLORS,
            );
        }
        let _ = DeleteDC(dc);

        let mut out = vec![0u8; bgra.len()];
        for (index, (src, dst)) in bgra
            .chunks_exact(4)
            .zip(out.chunks_exact_mut(4))
            .enumerate()
        {
            dst[0] = src[2];
            dst[1] = src[1];
            dst[2] = src[0];
            dst[3] = if opaque {
                // A white mask pixel is a hole in the icon.
                if mask_bits.get(index * 4).copied().unwrap_or(0) != 0 {
                    0
                } else {
                    255
                }
            } else {
                src[3]
            };
        }

        cleanup(RgbaImage::from_raw(width, height, out))
    }
}

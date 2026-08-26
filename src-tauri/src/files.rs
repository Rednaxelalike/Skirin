//! Saving, opening, and the clipboard.
//!
//! Export bytes arrive already encoded by the canvas, so a save is a straight
//! write — the Electron build decoded a base64 data URL first, which for a 4x
//! export meant holding tens of megabytes of string and buffer at once.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};

use image::RgbaImage;
use windows::Win32::System::SystemInformation::GetLocalTime;

use crate::capture::{encode_png_compact, png_data_url};

/// Characters Windows will not accept in a file name, plus the ones that would
/// quietly turn a name into a path.
const FORBIDDEN: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

pub fn extension_for(format: &str) -> &'static str {
    match format {
        "jpeg" => "jpg",
        "webp" => "webp",
        _ => "png",
    }
}

pub fn mime_for(format: &str) -> &'static str {
    match format {
        "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

/// Expands `{yyyy}`-style placeholders against the local wall clock and strips
/// anything the filesystem would reject.
pub fn render_template(template: &str) -> String {
    let now = unsafe { GetLocalTime() };
    let mut out = String::with_capacity(template.len() + 8);
    let mut rest = template;

    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        match after.find('}') {
            Some(close) => {
                let key = &after[..close];
                let replaced = match key {
                    "yyyy" => Some(format!("{:04}", now.wYear)),
                    "MM" => Some(format!("{:02}", now.wMonth)),
                    "dd" => Some(format!("{:02}", now.wDay)),
                    "HH" => Some(format!("{:02}", now.wHour)),
                    "mm" => Some(format!("{:02}", now.wMinute)),
                    "ss" => Some(format!("{:02}", now.wSecond)),
                    _ => None,
                };
                match replaced {
                    Some(value) => out.push_str(&value),
                    // An unknown placeholder is left as the user typed it
                    // rather than silently vanishing from every file name.
                    None => {
                        out.push('{');
                        out.push_str(key);
                        out.push('}');
                    }
                }
                rest = &after[close + 1..];
            }
            None => {
                out.push_str(after);
                rest = "";
            }
        }
    }
    out.push_str(rest);

    sanitize(&out)
}

pub fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| {
            if FORBIDDEN.contains(&c) || (c as u32) < 32 {
                '-'
            } else {
                c
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Never overwrite: a second export in the same second becomes `… (2)`.
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    for n in 2..1000 {
        let candidate = dir.join(format!("{stem} ({n}).{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    first
}

/* ------------------------------- clipboard ------------------------------ */

/// Puts an image on the clipboard as a DIB, which is the format every Windows
/// app knows how to paste.
pub fn copy_image(image: &RgbaImage) -> Result<(), String> {
    let data = arboard::ImageData {
        width: image.width() as usize,
        height: image.height() as usize,
        bytes: std::borrow::Cow::Borrowed(image.as_raw()),
    };
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_image(data)
        .map_err(|e| e.to_string())
}

pub fn paste_image() -> Option<RgbaImage> {
    let data = arboard::Clipboard::new().ok()?.get_image().ok()?;
    RgbaImage::from_raw(
        data.width as u32,
        data.height as u32,
        data.bytes.into_owned(),
    )
}

/* --------------------------------- files -------------------------------- */

/// Decodes any format the `image` crate understands, so the editor accepts the
/// same PNG/JPEG/WebP/GIF/BMP set the Electron open dialog offered.
pub fn decode(bytes: &[u8]) -> Option<RgbaImage> {
    image::load_from_memory(bytes)
        .ok()
        .map(|image| image.to_rgba8())
}

pub fn read_image(path: &Path) -> Option<RgbaImage> {
    decode(&std::fs::read(path).ok()?)
}

/// A history thumbnail: small, long-lived, and stored inside `skirin.json` —
/// so unlike a capture frame it is worth compressing properly.
pub fn thumbnail_data_url(image: &RgbaImage, width: u32) -> String {
    let ratio = (width as f32 / image.width() as f32).min(1.0);
    let thumb = image::imageops::resize(
        image,
        ((image.width() as f32 * ratio).round() as u32).max(1),
        ((image.height() as f32 * ratio).round() as u32).max(1),
        image::imageops::FilterType::Triangle,
    );
    png_data_url(&encode_png_compact(&thumb))
}

/// Opens the folder containing `path` with the file already selected.
pub fn reveal(path: &str) {
    let _ = std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{path}\""))
        .spawn();
}

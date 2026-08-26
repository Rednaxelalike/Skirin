//! Screen capture: monitor enumeration, frame grabbing, and the registry that
//! hands frames to the webview.
//!
//! Two things are deliberately different from the Electron build:
//!
//! * **Pixels never become base64.** A capture is registered here and the
//!   editor is handed a `skirin://frame/<id>` URL, which the webview streams
//!   over a custom protocol. Electron serialised every shot to a data URL —
//!   about 24 MB of string for one 4K screen, built on the main thread and
//!   parsed again in the renderer.
//! * **One warm D3D device.** All capture work runs on a single MTA thread
//!   that owns the device and the grabber, so a repeat capture skips the
//!   pipeline setup entirely.

pub mod gdi;
pub mod icons;
pub mod monitors;
pub mod wgc;
pub mod windows_list;

use std::collections::VecDeque;
use std::sync::mpsc::{channel, Sender};
use std::time::{SystemTime, UNIX_EPOCH};

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder, RgbaImage};
use parking_lot::Mutex;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

use crate::types::{Capture, DisplayInfo, Rect, WindowSource};
use monitors::Monitor;

/// Captures a user can still be looking at: the editor's current shot, the
/// overlay's frozen frames across a few monitors, and a little slack.
const FRAME_POOL: usize = 10;

/* ------------------------------- registry ------------------------------- */

pub struct Frame {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct Registry {
    frames: Mutex<VecDeque<(String, std::sync::Arc<Frame>)>>,
    thumbs: Mutex<Vec<(String, std::sync::Arc<Frame>)>>,
}

impl Registry {
    pub fn insert(&self, id: String, frame: Frame) {
        let mut frames = self.frames.lock();
        frames.push_back((id, std::sync::Arc::new(frame)));
        while frames.len() > FRAME_POOL {
            frames.pop_front();
        }
    }

    /// Window-picker thumbnails live and die with one listing, so the previous
    /// batch is dropped rather than aged out of the main pool.
    pub fn replace_thumbs(&self, batch: Vec<(String, Frame)>) {
        *self.thumbs.lock() = batch
            .into_iter()
            .map(|(id, frame)| (id, std::sync::Arc::new(frame)))
            .collect();
    }

    pub fn get(&self, id: &str) -> Option<std::sync::Arc<Frame>> {
        if let Some((_, frame)) = self.frames.lock().iter().find(|(key, _)| key == id) {
            return Some(frame.clone());
        }
        self.thumbs
            .lock()
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, frame)| frame.clone())
    }
}

static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn uid(prefix: &str) -> String {
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let millis = now_millis();
    format!("{prefix}{millis:x}{n:x}")
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// The URL shape the webview fetches a registered frame through. Windows
/// serves Tauri custom protocols over an `http://<scheme>.localhost` origin
/// rather than `scheme://`, and the CSP has to match it exactly.
pub fn frame_url(id: &str) -> String {
    format!("http://skirin.localhost/frame/{id}")
}

/// Fast deflate, no row filter. A screenshot is going straight onto a canvas
/// and then re-encoded on export, so spending 300 ms squeezing the intermediate
/// is time taken directly out of how quickly the editor appears.
pub fn encode_png(image: &RgbaImage) -> Vec<u8> {
    let mut out = Vec::with_capacity(image.as_raw().len() / 3);
    let encoder =
        PngEncoder::new_with_quality(&mut out, CompressionType::Fast, FilterType::NoFilter);
    let _ = encoder.write_image(
        image.as_raw(),
        image.width(),
        image.height(),
        ExtendedColorType::Rgba8,
    );
    out
}

/// Smaller images are re-encoded properly: they are stored in `skirin.json` or
/// held in a list, so the bytes stick around and are worth compressing.
pub fn encode_png_compact(image: &RgbaImage) -> Vec<u8> {
    let mut out = Vec::new();
    let encoder =
        PngEncoder::new_with_quality(&mut out, CompressionType::Default, FilterType::Adaptive);
    let _ = encoder.write_image(
        image.as_raw(),
        image.width(),
        image.height(),
        ExtendedColorType::Rgba8,
    );
    out
}

pub fn png_data_url(png: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    )
}

/* -------------------------------- engine -------------------------------- */

/// One monitor's frozen frame, kept in raw form so a selection can be cropped
/// out of it without a decode round-trip.
pub struct Shot {
    pub monitor: Monitor,
    pub image: RgbaImage,
}

enum Job {
    Monitors {
        monitors: Vec<Monitor>,
        reply: Sender<Vec<Shot>>,
    },
    Window {
        hwnd: isize,
        bounds: Rect,
        reply: Sender<Option<RgbaImage>>,
    },
}

/// Capture work is pinned to one multithreaded-apartment thread: WinRT wants a
/// COM apartment, D3D resources are cheapest when they outlive a single call,
/// and serialising the grabs keeps two hotkeys pressed together from fighting
/// over the GPU.
pub struct Engine {
    jobs: Sender<Job>,
}

impl Engine {
    pub fn start() -> Self {
        let (tx, rx) = channel::<Job>();

        std::thread::Builder::new()
            .name("skirin-capture".into())
            .spawn(move || {
                unsafe {
                    // WinRT's free-threaded frame pool needs an MTA; the
                    // result is ignored because an already-initialised
                    // apartment is a success for our purposes.
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                }

                let grabber = if wgc::supported() {
                    wgc::Grabber::new().ok()
                } else {
                    None
                };
                if grabber.is_none() {
                    eprintln!("[skirin] Windows.Graphics.Capture unavailable — using GDI");
                }

                while let Ok(job) = rx.recv() {
                    match job {
                        Job::Monitors { monitors, reply } => {
                            let shots = monitors
                                .into_iter()
                                .filter_map(|monitor| {
                                    let image = grabber
                                        .as_ref()
                                        .and_then(|g| g.monitor(monitor.hmonitor()).ok())
                                        .or_else(|| gdi::monitor(monitor.bounds))?;
                                    Some(Shot { monitor, image })
                                })
                                .collect();
                            let _ = reply.send(shots);
                        }
                        Job::Window {
                            hwnd,
                            bounds,
                            reply,
                        } => {
                            let handle = HWND(hwnd as *mut core::ffi::c_void);
                            let image = grabber
                                .as_ref()
                                .and_then(|g| g.window(handle).ok())
                                .or_else(|| gdi::window(handle, bounds));
                            let _ = reply.send(image);
                        }
                    }
                }

                unsafe { CoUninitialize() };
            })
            .expect("capture thread");

        Self { jobs: tx }
    }

    /// Grabs every monitor. They are captured back to back on the capture
    /// thread, so the frames are as close to simultaneous as the API allows —
    /// which is what keeps a selection dragged across two screens coherent.
    pub fn all_monitors(&self) -> Vec<Shot> {
        let monitors = monitors::enumerate();
        if monitors.is_empty() {
            return Vec::new();
        }
        let (tx, rx) = channel();
        if self
            .jobs
            .send(Job::Monitors {
                monitors,
                reply: tx,
            })
            .is_err()
        {
            return Vec::new();
        }
        rx.recv().unwrap_or_default()
    }

    pub fn window(&self, hwnd: isize, bounds: Rect) -> Option<RgbaImage> {
        let (tx, rx) = channel();
        self.jobs
            .send(Job::Window {
                hwnd,
                bounds,
                reply: tx,
            })
            .ok()?;
        rx.recv().ok().flatten()
    }
}

/* -------------------------------- public -------------------------------- */

pub fn describe_displays() -> Vec<DisplayInfo> {
    monitors::describe(&monitors::enumerate())
}

/// Registers a frame and returns the `Capture` the editor sees.
pub fn publish(
    registry: &Registry,
    image: RgbaImage,
    kind: &str,
    source_name: String,
    scale_factor: f64,
    region: Option<Rect>,
) -> Capture {
    let id = uid("cap-");
    let (width, height) = (image.width(), image.height());
    let png = encode_png(&image);

    registry.insert(id.clone(), Frame { png, width, height });

    Capture {
        src: frame_url(&id),
        id,
        width,
        height,
        scale_factor,
        kind: kind.to_string(),
        source_name,
        created_at: now_millis(),
        region,
    }
}

/// Crops a monitor's frozen frame to a screen-space rect.
///
/// Both are physical pixels in the same virtual-desktop space, so this is a
/// straight subtraction — no DIP conversion, and none of the half-pixel drift
/// that came with it on mixed-DPI setups.
pub fn crop(shot: &Shot, screen_rect: Rect) -> Option<(RgbaImage, Rect)> {
    let bounds = shot.monitor.bounds;
    let max_x = shot.image.width() as i32;
    let max_y = shot.image.height() as i32;

    let x = (screen_rect.x - bounds.x).clamp(0, (max_x - 1).max(0));
    let y = (screen_rect.y - bounds.y).clamp(0, (max_y - 1).max(0));
    let width = screen_rect.width.clamp(1, max_x - x);
    let height = screen_rect.height.clamp(1, max_y - y);
    if width <= 0 || height <= 0 {
        return None;
    }

    let cropped =
        image::imageops::crop_imm(&shot.image, x as u32, y as u32, width as u32, height as u32)
            .to_image();

    Some((
        cropped,
        Rect {
            x: bounds.x + x,
            y: bounds.y + y,
            width,
            height,
        },
    ))
}

pub fn shot_for_rect<'a>(shots: &'a [Shot], rect: &Rect) -> Option<&'a Shot> {
    let cx = rect.x + rect.width / 2;
    let cy = rect.y + rect.height / 2;
    shots
        .iter()
        .find(|shot| shot.monitor.bounds.contains(cx, cy))
        .or_else(|| shots.first())
}

/// Thumbnails for the window picker.
///
/// Every window is grabbed on the one warm capture thread and downscaled here,
/// then parked in the registry's thumbnail pool so the listing costs one small
/// IPC message instead of a megabyte of base64 per window.
pub fn list_window_sources(engine: &Engine, registry: &Registry) -> Vec<WindowSource> {
    const THUMB_W: u32 = 480;
    const THUMB_H: u32 = 300;

    let mut batch: Vec<(String, Frame)> = Vec::new();
    let mut sources: Vec<WindowSource> = Vec::new();

    for window in windows_list::enumerate() {
        let Some(image) = engine.window(window.hwnd, window.rect) else {
            continue;
        };
        if image.width() == 0 || image.height() == 0 {
            continue;
        }

        // Fit inside the thumbnail box without distorting the window's shape,
        // and never upscale a window that is already smaller than the box.
        let ratio = (THUMB_W as f32 / image.width() as f32)
            .min(THUMB_H as f32 / image.height() as f32)
            .min(1.0);
        let thumb = image::imageops::resize(
            &image,
            ((image.width() as f32 * ratio).round() as u32).max(1),
            ((image.height() as f32 * ratio).round() as u32).max(1),
            image::imageops::FilterType::Triangle,
        );

        let id = format!("thumb-{:x}", window.hwnd);
        let png = encode_png(&thumb);
        let (width, height) = (thumb.width(), thumb.height());

        sources.push(WindowSource {
            id: window.hwnd.to_string(),
            name: window.title.clone(),
            app_icon: icons::window_icon(window.hwnd)
                .map(|icon| png_data_url(&encode_png_compact(&icon))),
            thumbnail: frame_url(&id),
        });
        batch.push((id, Frame { png, width, height }));
    }

    registry.replace_thumbs(batch);
    sources
}

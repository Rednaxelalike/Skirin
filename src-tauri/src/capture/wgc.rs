//! Windows.Graphics.Capture — the frame grabber.
//!
//! This is the same API Chromium's `desktopCapturer` sits on, so a shot comes
//! back looking exactly as it did under Electron: composited by DWM, correct
//! for hardware-accelerated and occluded windows, and free of the black
//! rectangles a naive GDI blit leaves behind on layered surfaces.
//!
//! The D3D11 device is created once and reused for every capture. Electron
//! stood up a fresh capture pipeline per `getSources` call; keeping the device
//! warm is most of why a repeat capture here is noticeably quicker.

use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use image::RgbaImage;
use windows::core::{Interface, Result as WinResult};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

/// How long to wait for DWM to hand over the first composited frame. A cold
/// session on a busy desktop is typically ready inside two vsyncs; this is the
/// give-up point, not the expected wait.
const FRAME_TIMEOUT: Duration = Duration::from_millis(900);

pub struct Grabber {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    winrt_device: IDirect3DDevice,
}

/// Whether this machine can capture at all. Windows 10 1803 and up — every
/// machine that can render the app's Mica title bar is well past that.
pub fn supported() -> bool {
    GraphicsCaptureSession::IsSupported().unwrap_or(false)
}

fn create_device(driver: D3D_DRIVER_TYPE) -> WinResult<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            None,
            driver,
            HMODULE::default(),
            // BGRA support is required for D3D11 to interop with WinRT surfaces.
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    match (device, context) {
        (Some(device), Some(context)) => Ok((device, context)),
        _ => Err(windows::core::Error::empty()),
    }
}

fn capture_item_interop() -> WinResult<IGraphicsCaptureItemInterop> {
    windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
}

impl Grabber {
    pub fn new() -> WinResult<Self> {
        // WARP is the software rasteriser. A machine with no usable GPU driver
        // still gets working captures, just slower — the same reason the
        // Electron build kept `vk_swiftshader.dll` in the bundle.
        let (device, context) = create_device(D3D_DRIVER_TYPE_HARDWARE)
            .or_else(|_| create_device(D3D_DRIVER_TYPE_WARP))?;

        let dxgi: IDXGIDevice = device.cast()?;
        let winrt_device: IDirect3DDevice =
            unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;

        Ok(Self {
            device,
            context,
            winrt_device,
        })
    }

    pub fn monitor(&self, monitor: HMONITOR) -> WinResult<RgbaImage> {
        let item: GraphicsCaptureItem =
            unsafe { capture_item_interop()?.CreateForMonitor(monitor)? };
        // A desktop is opaque by definition, and DWM occasionally hands back a
        // zeroed alpha channel for the primary surface — which would render
        // the whole shot invisible in the editor.
        self.grab(&item, true)
    }

    pub fn window(&self, hwnd: HWND) -> WinResult<RgbaImage> {
        let item: GraphicsCaptureItem = unsafe { capture_item_interop()?.CreateForWindow(hwnd)? };
        // Rounded corners are genuinely transparent here, and the editor
        // composites the shot over its own background — so keep the alpha the
        // compositor produced.
        self.grab(&item, false)
    }

    fn grab(&self, item: &GraphicsCaptureItem, force_opaque: bool) -> WinResult<RgbaImage> {
        let size: SizeInt32 = item.Size()?;
        if size.Width <= 0 || size.Height <= 0 {
            return Err(windows::core::Error::empty());
        }

        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &self.winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            1,
            size,
        )?;
        let session = pool.CreateCaptureSession(item)?;

        // The pointer is chrome, not content — the editor draws its own.
        let _ = session.SetIsCursorCaptureEnabled(false);
        // Windows 11 draws a yellow "this is being captured" border unless
        // asked not to. Older builds reject the call, which is fine to ignore.
        let _ = session.SetIsBorderRequired(false);

        // Waiting on the pool's own event rather than polling means the grab
        // returns the instant DWM has a frame, instead of on the next tick of
        // a sleep loop.
        let signal = Arc::new((Mutex::new(false), Condvar::new()));
        let notify = signal.clone();
        let handler =
            TypedEventHandler::<Direct3D11CaptureFramePool, windows::core::IInspectable>::new(
                move |_, _| {
                    let (lock, cvar) = &*notify;
                    if let Ok(mut ready) = lock.lock() {
                        *ready = true;
                        cvar.notify_all();
                    }
                    Ok(())
                },
            );
        let token = pool.FrameArrived(&handler)?;

        session.StartCapture()?;

        let frame = {
            let deadline = Instant::now() + FRAME_TIMEOUT;
            loop {
                if let Ok(frame) = pool.TryGetNextFrame() {
                    break Some(frame);
                }
                if Instant::now() >= deadline {
                    break None;
                }
                let (lock, cvar) = &*signal;
                match lock.lock() {
                    Ok(guard) => {
                        let _ = cvar.wait_timeout(guard, Duration::from_millis(8));
                    }
                    Err(_) => break None,
                }
            }
        };

        let _ = pool.RemoveFrameArrived(token);

        let result = match frame {
            Some(frame) => {
                let content = frame.ContentSize().unwrap_or(size);
                let read = (|| -> WinResult<RgbaImage> {
                    let surface = frame.Surface()?;
                    let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
                    let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
                    self.read_back(
                        &texture,
                        content.Width.max(0) as u32,
                        content.Height.max(0) as u32,
                        force_opaque,
                    )
                })();
                let _ = frame.Close();
                read
            }
            None => Err(windows::core::Error::empty()),
        };

        let _ = session.Close();
        let _ = pool.Close();
        result
    }

    /// Copies the GPU texture into a CPU-visible staging texture and unpacks it
    /// into straight-alpha RGBA, which is what both PNG and a canvas want.
    fn read_back(
        &self,
        texture: &ID3D11Texture2D,
        content_width: u32,
        content_height: u32,
        force_opaque: bool,
    ) -> WinResult<RgbaImage> {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { texture.GetDesc(&mut desc) };

        // The frame pool allocates at the item's size. A window that shrank
        // between session start and this frame reports a smaller content size,
        // and the slack around it is stale pixels.
        let width = content_width.clamp(1, desc.Width.max(1));
        let height = content_height.clamp(1, desc.Height.max(1));

        let staging_desc = D3D11_TEXTURE2D_DESC {
            Width: desc.Width,
            Height: desc.Height,
            MipLevels: 1,
            ArraySize: 1,
            Format: desc.Format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };

        let mut staging: Option<ID3D11Texture2D> = None;
        unsafe {
            self.device
                .CreateTexture2D(&staging_desc, None, Some(&mut staging))?
        };
        let staging = staging.ok_or_else(windows::core::Error::empty)?;

        unsafe { self.context.CopyResource(&staging, texture) };

        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            self.context
                .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?
        };

        let row_bytes = width as usize * 4;
        let mut out = vec![0u8; row_bytes * height as usize];
        let pitch = mapped.RowPitch as usize;

        unsafe {
            let base = mapped.pData as *const u8;
            for y in 0..height as usize {
                let src = std::slice::from_raw_parts(base.add(y * pitch), row_bytes);
                let dst = &mut out[y * row_bytes..(y + 1) * row_bytes];
                unswizzle(src, dst, force_opaque);
            }
            self.context.Unmap(&staging, 0);
        }

        RgbaImage::from_raw(width, height, out).ok_or_else(windows::core::Error::empty)
    }
}

/// BGRA premultiplied — what DWM composites into — to RGBA straight alpha.
#[inline]
fn unswizzle(src: &[u8], dst: &mut [u8], force_opaque: bool) {
    for (s, d) in src.chunks_exact(4).zip(dst.chunks_exact_mut(4)) {
        let (b, g, r, a) = (s[0], s[1], s[2], s[3]);
        if force_opaque || a == 255 {
            d[0] = r;
            d[1] = g;
            d[2] = b;
            d[3] = 255;
        } else if a == 0 {
            d.copy_from_slice(&[0, 0, 0, 0]);
        } else {
            let alpha = a as u32;
            d[0] = ((r as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
            d[1] = ((g as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
            d[2] = ((b as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
            d[3] = a;
        }
    }
}

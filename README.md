# Skirin

A screenshot studio for Windows. Capture an area, a window or a whole display,
then dress the result in gradients, padding, shadows, perspective and
annotations — and paste it anywhere in a couple of seconds.

Built as a native-feeling Windows 11 app: Mica window material, global hotkeys,
a tray icon, and a frozen-frame selection overlay that snaps to real windows.

One Windows 11 nicety is missing: hovering the maximise button does not open
the Snap Layouts flyout. That needs the top-level window to answer
`WM_NCHITTEST` with `HTMAXBUTTON`, and the WebView2 child covers the client
area, so the hit test never reaches it. Dragging to an edge and Win+Arrow snap
normally.

---

## Install

Grab the latest build from the [Releases page](../../releases):

- `Skirin_<version>_x64-setup.exe` — the installer. Start menu and desktop
  shortcuts, and it can update itself.
- `Skirin-<version>-portable.exe` — no install, run it from anywhere. It is
  the same binary the installer places, about 6 MB.

Both need the WebView2 runtime, which every supported Windows 11 already has;
the installer fetches it on the rare machine that does not.

Windows will show a SmartScreen warning the first time, because the build is
not code-signed: choose **More info → Run anyway**.

---

## Updates

The installer build keeps itself current. Skirin checks GitHub Releases twelve
seconds after launch and every six hours after that; when a newer version is
published an **Update** pill appears in the title bar.

That pill is the whole interaction. One click downloads the update, installs it
and relaunches Skirin — there is no second button. Nothing is downloaded before
you ask for it, and `Check for updates…` in the tray menu forces a look.

Every update is signed, and the signature is checked before anything is run.
The whole installer is fetched rather than a delta, which for a ~6 MB build is
a smaller download than the deltas the Electron version used to pull.

The **portable** exe cannot update itself — there is no installer to hand the
download to — so it opens the Releases page instead.

---

## Getting started

```bash
npm install
```

```bash
npm run dev
```

Build the installer and the standalone exe:

```bash
npm run build
```

Building needs a Rust toolchain (`rustup`, stable MSVC) and the Visual Studio
Build Tools with the C++ workload — the editor is TypeScript, but everything
under `src-tauri/` is Rust.

Other scripts: `npm run build:renderer` (editor bundle only),
`npm run dev:renderer` (Vite alone, no app window), `npm run typecheck`,
`npm run icons` (regenerate the app icons).

---

## Capture

| Action | Default hotkey |
| --- | --- |
| Capture an area | `Ctrl + Shift + 1` |
| Capture the screen | `Ctrl + Shift + 2` |
| Pick a window | `Ctrl + Shift + 3` |
| Repeat the last region | `Ctrl + Shift + 4` |
| Open Skirin | `Ctrl + Shift + S` |

All five are rebindable in Settings, and each one also lives in the tray menu.

**The selection overlay** freezes the screen first, so what you drag over is
exactly what you get — no flicker, no chasing a moving target.

- Drag for a freehand region.
- Hover a window and click to grab it — window rectangles come from
  `user32`/`dwmapi` via a short PowerShell probe, so the highlight follows real
  window bounds including shadows-excluded frame geometry.
- A pixel loupe follows the cursor with a hex readout; `C` copies the colour.
- `F` grabs the whole display, `R` repeats your last region, `Esc` cancels.
- Multi-monitor aware, including mixed-DPI setups.

After a capture Skirin can open the editor, copy, save, or any combination —
set it under Settings → After a capture.

---

## The editor

**Backdrop** — 30 gradient presets across five families, 6 mesh-gradient
presets with editable blobs, solid colours, your own image (cover / fit / tile,
with blur, zoom and opacity), a colour sampled automatically from the
screenshot, or nothing at all for a transparent PNG. Grain and vignette on top.

**Frame** — padding, corner radius, size, drop shadow (blur, distance, offset,
spread, opacity, colour), border, reflection, and true 3-D perspective: tilt on
X and Y with an adjustable perspective distance, plus Z rotation and nudge.
Window chrome can be drawn around the capture in macOS, browser-with-URL,
Windows or minimal styles.

**Canvas** — auto ratio or 1:1, 4:3, 3:2, 16:9, 2:1, 3:4, 4:5, 9:16. Auto
balance trims uniform edges off the capture so the padding looks even. Crop,
rotate in 90° steps, flip.

**Looks** — eight one-click presets (Aurora, Studio, Tilt, Paper, Flat, Glass,
Punch, Ink) on keys `1`–`8`, and you can save your own.

**Annotations** — arrows (curved, single or double headed, dashed), rectangles,
ellipses, lines, freehand, text with a backdrop, numbered step markers,
highlight, spotlight, blur, pixelate and redaction bars. Everything stays live:
select, move, resize, restyle, reorder, lock, hide or delete at any point.

**Smart redact** — runs OCR on the capture and hides anything that looks
private: email addresses, phone numbers, card numbers (Luhn-checked), API keys
and tokens, IPs and URLs. Results arrive as ordinary shapes, so you can nudge
or remove any of them. The OCR model downloads once on first use and then works
offline.

**Export** — PNG, JPEG or WebP at 1×, 2× or 3×; quality slider; transparent
background; and a "keep under 1 MB" mode that binary-searches quality and then
resolution until the file fits a chat app. Copy to clipboard, save to your
captures folder, or save-as. Saving copies to the clipboard too.

---

## Keyboard

| | |
| --- | --- |
| Select / Crop / Pan | `V` `C` `Space` |
| Arrow, Rect, Ellipse, Line, Draw | `A` `R` `O` `L` `D` |
| Text, Step number | `T` `N` |
| Highlight, Spotlight, Blur, Pixelate, Redact | `H` `S` `B` `P` `X` |
| Undo / Redo | `Ctrl Z` / `Ctrl Y` |
| Duplicate / Delete selection | `Ctrl D` / `Delete` |
| Nudge selection | Arrows (`Shift` for bigger steps) |
| Constrain while dragging | `Shift` |
| Rule-of-thirds grid | `G` |
| Zoom / Fit | `Ctrl Scroll` / `Ctrl 0` |
| Copy / Save / Save as | `Ctrl C` / `Ctrl S` / `Ctrl Shift S` |
| Paste / Open an image | `Ctrl V` / `Ctrl O` |
| Apply a look | `1` – `8` |
| Shortcut reference | `?` |

---

## How it is put together

The editor is a React app in a WebView2 surface. Everything the editor cannot
do itself — capture, the overlay windows, the tray, hotkeys, files — is Rust.

```
src/
  shared/types.ts  the contract between the two halves
  renderer/
    src/lib/
      bridge.ts    window.skirin, implemented over Tauri commands and events
      render.ts    the compositor — background, frame, shadow, watermark
      geometry.ts  projective quads, homographies, perspective texture mapping
      annotations.ts  annotation drawing, hit-testing and handles
      ocr.ts       OCR plus the sensitive-data patterns
      exporter.ts  encoding and the size budget search
    src/components/  editor UI
    src/overlay/     the selection overlay UI
src-tauri/src/
  lib.rs           wiring: plugins, commands, window events
  app.rs           the main window, and what happens to a capture once it exists
  overlay.rs       per-monitor selection overlays and their lifecycle
  capture/
    wgc.rs         Windows.Graphics.Capture — the frame grabber
    gdi.rs         BitBlt/PrintWindow fallback
    monitors.rs    monitor enumeration, physical bounds, per-monitor DPI
    windows_list.rs  z-ordered window enumeration through user32/dwmapi
    icons.rs       window icons for the picker
  files.rs         save, clipboard, dialogs, capture history
  store.rs         JSON settings/preset/history persistence
  protocol.rs      the skirin:// scheme that serves frames to the webview
```

Four details worth knowing:

**Pixels never become base64.** A capture is registered in Rust and the editor
is handed a `skirin://frame/<id>` URL, which the webview streams and decodes
off the main thread. The Electron build serialised every shot to a data URL —
roughly 24 MB of string for one 4K screen, built on the main process and parsed
again in the renderer.

**Physical pixels end to end.** Monitor bounds, window rects and selections are
all in one virtual-desktop pixel space, so cropping is plain subtraction. The
old code converted between Chromium's DIP space and Win32 at the boundary,
which has no single right answer once two monitors run at different scales.

**One renderer, two consumers.** The preview and the export run the exact same
`renderScene` function at different scales, so what you see is what you get —
there is no second code path that can drift.

**The raster follows the output.** Geometry is measured in capture units before
anything is rasterised, so the artwork can be drawn at the resolution it will
actually occupy. A 4x export composes window chrome, borders, corner radii and
annotations at 4x as real vectors instead of enlarging a 1x bitmap, and the
screenshot itself is stepped up by a whole-number factor with smoothing off —
pixel art stays pixel-sharp rather than being blurred by bilinear interpolation.

**Real perspective, not a skew.** Tilt builds a projective quad, derives the
homography from the unit square onto it, and texture-maps the artwork through a
subdivided mesh. Axis-aligned and merely-rotated frames take a single-pass
affine fast path instead. The same homography is inverted for hit-testing, so
annotations stay grabbable even while the frame is tilted.

---

## Privacy

Everything stays on the machine. Captures, settings, presets and history live in
`%APPDATA%/Skirin`, exports go to `Pictures/Skirin`, and nothing is uploaded.

There are exactly two outbound requests in the whole app, neither of which
carries any of your data: the one-time OCR model download for smart redaction,
and the update check against the GitHub Releases API.

---

## Not included

Screen recording, the Loom-style video studio, transcription and cloud sharing
are out of scope for this build — Skirin is the screenshot half of that idea.
The capture layer (`src-tauri/src/capture/`) already holds a warm D3D11 device
and a Windows.Graphics.Capture session, which is exactly what a recorder needs,
but none of it is written yet.

---

## Releasing

Every push to `main` builds the Windows installer on a GitHub Actions runner
and attaches it to the run as an artifact. Pushing a version tag publishes a
Release with the installer and the portable exe:

```bash
npm version patch && git push --follow-tags
```

The workflow refuses to publish if the tag, `package.json` and
`tauri.conf.json` do not all agree on the version.

Signing needs two repository secrets: `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Without them the build fails rather than
shipping an installer no client will accept.

Tag builds upload **two** update feeds. `latest.json` is the one Skirin 2.x
reads. `latest.yml` is hand-built to point at the same installer, because
every Skirin 1.x install in the wild is still an electron-updater client
watching for that file — pointing it at the Tauri installer is what carries
those users across the rewrite instead of stranding them. A final step re-reads
the Release from the API and fails the build if either feed is missing.

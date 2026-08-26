# Skirin

A screenshot studio for Windows. Capture an area, a window or a whole display,
then dress the result in gradients, padding, shadows, perspective and
annotations — and paste it anywhere in a couple of seconds.

Built as a native-feeling Windows 11 app: Mica window material, real caption
buttons, global hotkeys, a tray icon, and a frozen-frame selection overlay that
snaps to real windows.

---

## Install

Grab the latest build from the [Releases page](../../releases):

- `Skirin-<version>-x64.exe` — the installer. Pick an install folder, get a
  Start menu and desktop shortcut.
- `Skirin-<version>-portable.exe` — no install, run it from anywhere.

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

Downloads are differential: electron-updater compares block maps and pulls only
the parts of the installer that actually changed, so a patch release is usually
a couple of megabytes rather than the full download.

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

Build an installer and a portable exe into `release/`:

```bash
npm run dist
```

Other scripts: `npm run build` (bundle only), `npm run start` (preview the
bundle), `npm run typecheck`, `npm run icons` (regenerate the app icons).

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

```
src/
  shared/          types + defaults shared across all three processes
  main/
    index.ts       lifecycle, windows, tray, global shortcuts, IPC
    capture.ts     desktopCapturer wrappers, display/window grabs, cropping
    overlay.ts     per-display selection overlays and their lifecycle
    winapi.ts      z-ordered window enumeration through user32/dwmapi
    files.ts       save, clipboard, dialogs, capture history
    store.ts       JSON settings/preset/history persistence
  preload/         the single `window.skirin` bridge
  renderer/
    src/lib/
      render.ts    the compositor — background, frame, shadow, watermark
      geometry.ts  projective quads, homographies, perspective texture mapping
      annotations.ts  annotation drawing, hit-testing and handles
      ocr.ts       OCR plus the sensitive-data patterns
      exporter.ts  encoding and the size budget search
    src/components/  editor UI
    src/overlay/     the selection overlay UI
```

Two details worth knowing:

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
The capture layer (`src/main/capture.ts`) already speaks `desktopCapturer`, so
recording would slot in beside it, but none of it is written yet.

---

## Releasing

Every push to `main` builds the Windows installer on a GitHub Actions runner
and attaches it to the run as an artifact. Pushing a version tag publishes a
Release with the installer and the portable exe:

```bash
npm version patch && git push --follow-tags
```

The workflow refuses to publish if the tag and `package.json` version disagree.
Building in CI also sidesteps Smart App Control, which blocks the NSIS
installer step on locked-down Windows 11 machines.

Tag builds run `npm run release`, which lets electron-builder create the
Release itself. That matters: alongside the installer it uploads `latest.yml`
and the `.blockmap`, and those two files *are* the update feed. A release
assembled by hand without them leaves every installed copy stranded on its
current version.

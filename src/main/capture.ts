import { desktopCapturer, nativeImage, screen } from 'electron'
import type { NativeImage, Display } from 'electron'
import type { Capture, DisplayInfo, Rect, WindowSource } from '../shared/types'

export interface DisplayShot {
  display: Display
  image: NativeImage
  /** Physical pixel size of the shot. */
  width: number
  height: number
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function describeDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    bounds: d.bounds,
    workArea: d.workArea,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === primary.id,
    label: d.label || `Display ${i + 1}`
  }))
}

/**
 * Grabs every display at native resolution. Electron matches sources to
 * displays through `display_id`; on the rare miss we fall back to index order.
 */
export async function captureAllDisplays(): Promise<DisplayShot[]> {
  const displays = screen.getAllDisplays()
  const max = displays.reduce(
    (acc, d) => ({
      width: Math.max(acc.width, Math.round(d.size.width * d.scaleFactor)),
      height: Math.max(acc.height, Math.round(d.size.height * d.scaleFactor))
    }),
    { width: 0, height: 0 }
  )

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: max,
    fetchWindowIcons: false
  })

  return displays.map((display, index) => {
    const match =
      sources.find((s) => s.display_id === String(display.id)) ?? sources[index] ?? sources[0]
    const image = match ? match.thumbnail : nativeImage.createEmpty()
    const size = image.getSize()
    return { display, image, width: size.width, height: size.height }
  })
}

export async function captureDisplay(displayId?: number): Promise<Capture> {
  const shots = await captureAllDisplays()
  const shot =
    (displayId != null ? shots.find((s) => s.display.id === displayId) : undefined) ??
    shots.find((s) => s.display.id === screen.getPrimaryDisplay().id) ??
    shots[0]

  return {
    id: uid(),
    dataUrl: shot.image.toDataURL(),
    width: shot.width,
    height: shot.height,
    scaleFactor: shot.display.scaleFactor,
    kind: 'display',
    sourceName: shot.display.label || 'Display',
    createdAt: Date.now()
  }
}

export async function listWindowSources(): Promise<WindowSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 480, height: 300 },
    fetchWindowIcons: true
  })
  return sources
    .filter((s) => s.name && s.name !== 'Skirin' && !s.thumbnail.isEmpty())
    .map((s) => ({
      id: s.id,
      name: s.name,
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      thumbnail: s.thumbnail.toDataURL()
    }))
}

export async function captureWindowById(id: string): Promise<Capture | null> {
  const bounds = screen.getPrimaryDisplay()
  const target = Math.round(
    Math.max(bounds.size.width, bounds.size.height) * bounds.scaleFactor * 1.5
  )
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: target, height: target }
  })
  const source = sources.find((s) => s.id === id)
  if (!source || source.thumbnail.isEmpty()) return null
  const size = source.thumbnail.getSize()
  return {
    id: uid(),
    dataUrl: source.thumbnail.toDataURL(),
    width: size.width,
    height: size.height,
    scaleFactor: bounds.scaleFactor,
    kind: 'window',
    sourceName: source.name,
    createdAt: Date.now()
  }
}

/**
 * Crops a display shot to a screen-space (DIP) rect and returns a capture.
 * The rect is in global screen coordinates, matching Electron display bounds.
 */
export function cropDisplayShot(shot: DisplayShot, screenRect: Rect, label: string): Capture {
  const { display } = shot
  const sx = shot.width / display.bounds.width
  const sy = shot.height / display.bounds.height

  const local = {
    x: Math.round((screenRect.x - display.bounds.x) * sx),
    y: Math.round((screenRect.y - display.bounds.y) * sy),
    width: Math.round(screenRect.width * sx),
    height: Math.round(screenRect.height * sy)
  }

  local.x = Math.max(0, Math.min(local.x, shot.width - 1))
  local.y = Math.max(0, Math.min(local.y, shot.height - 1))
  local.width = Math.max(1, Math.min(local.width, shot.width - local.x))
  local.height = Math.max(1, Math.min(local.height, shot.height - local.y))

  const cropped = shot.image.crop(local)
  const size = cropped.getSize()

  return {
    id: uid(),
    dataUrl: cropped.toDataURL(),
    width: size.width,
    height: size.height,
    scaleFactor: display.scaleFactor,
    kind: 'area',
    sourceName: label,
    createdAt: Date.now(),
    region: screenRect
  }
}

export function findShotForRect(shots: DisplayShot[], rect: Rect): DisplayShot | undefined {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  return (
    shots.find(
      (s) =>
        cx >= s.display.bounds.x &&
        cx < s.display.bounds.x + s.display.bounds.width &&
        cy >= s.display.bounds.y &&
        cy < s.display.bounds.y + s.display.bounds.height
    ) ?? shots[0]
  )
}

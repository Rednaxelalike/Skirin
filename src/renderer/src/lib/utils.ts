import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function round(value: number, precision = 2): number {
  const f = 10 ** precision
  return Math.round(value * f) / f
}

/* --------------------------------- color -------------------------------- */

export interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

export function parseColor(input: string): Rgb {
  const value = input.trim()
  if (value.startsWith('#')) {
    let hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('')
    }
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    return { r: r || 0, g: g || 0, b: b || 0, a: Number.isNaN(a) ? 1 : a }
  }
  const match = value.match(/rgba?\(([^)]+)\)/i)
  if (match) {
    const parts = match[1].split(/[,/\s]+/).filter(Boolean).map(Number)
    return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 }
  }
  return { r: 0, g: 0, b: 0, a: 1 }
}

export function toRgba(color: string, alpha: number): string {
  const { r, g, b, a } = parseColor(color)
  return `rgba(${r}, ${g}, ${b}, ${clamp(a * alpha, 0, 1)})`
}

export function toHex({ r, g, b }: Rgb): string {
  const hex = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

export function luminance(color: string): number {
  const { r, g, b } = parseColor(color)
  const channel = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function readableOn(color: string): string {
  return luminance(color) > 0.45 ? '#111114' : '#ffffff'
}

export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  return toHex({
    r: lerp(ca.r, cb.r, t),
    g: lerp(ca.g, cb.g, t),
    b: lerp(ca.b, cb.b, t),
    a: 1
  })
}

export function shift(color: string, amount: number): string {
  const c = parseColor(color)
  return amount >= 0 ? mix(toHex(c), '#ffffff', amount) : mix(toHex(c), '#000000', -amount)
}

/* --------------------------------- image -------------------------------- */

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Captures are served from the `skirin://` protocol, which is a different
    // origin to the app itself. Without this the canvas the editor draws them
    // on is tainted, and every export — plus the colour picker and the trim
    // detector — throws on the first pixel read.
    if (!src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = src
  })
}

/**
 * A surface the renderer can draw on. The editor draws on DOM canvases; the
 * export worker has no document and draws on `OffscreenCanvas` instead. Every
 * function in `render.ts` is written against the union so one implementation
 * serves both.
 */
export type Surface = HTMLCanvasElement | OffscreenCanvas

/** Anything the renderer accepts as a bitmap source. */
export type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap

/** Intrinsic size of a bitmap source, whichever kind it is. */
export function sourceSize(image: ImageSource): { width: number; height: number } {
  return 'naturalWidth' in image
    ? { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }
    : { width: image.width, height: image.height }
}

export function createCanvas(width: number, height: number): Surface {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

/**
 * Hands an intermediate canvas' backing store back to the GC straight away.
 * An export render juggles several full-resolution surfaces at once, and
 * waiting for collection is what tips a 4x export into an out-of-memory
 * failure.
 */
export function release(canvas: Surface): void {
  canvas.width = 0
  canvas.height = 0
}

/**
 * Whether this module is running in the export worker.
 *
 * Nothing drawn there is ever composited to screen, so a GPU-backed surface
 * buys it nothing — and costs a great deal, because that work queues up in the
 * same GPU process the editor paints through and stalls it, which is the
 * stutter moving the export off-thread was meant to remove in the first place.
 * `willReadFrequently` is the only lever a 2D context gives over its backing
 * store, and asking for the CPU one keeps the export entirely on this thread.
 *
 * This is a real trade, not a free win. Measured on a 4x export of a 1080p
 * capture: the editor's worst frame during an export falls from ~750ms to
 * ~40ms — a solid 60fps throughout — while the export itself goes from ~1.6s
 * to ~3.8s. Leaving these surfaces on the GPU instead lands in between: ~1.3s
 * to compose, but the editor still loses ~380ms frames to the contention.
 * Smooth is the better default for something the user is not sat waiting on,
 * and flipping this constant to `false` buys the speed back.
 */
const OFF_MAIN_THREAD = typeof document === 'undefined'

export function context2d(canvas: Surface): CanvasRenderingContext2D {
  // The two context interfaces are identical across everything the renderer
  // touches; `OffscreenCanvasRenderingContext2D` only drops the DOM-only
  // extras (`drawFocusIfNeeded` and friends), none of which are used here.
  const ctx = (canvas as HTMLCanvasElement).getContext('2d', {
    willReadFrequently: OFF_MAIN_THREAD
  })
  if (!ctx) throw new Error('2D canvas is unavailable')
  return ctx
}

/**
 * Encodes a surface. DOM canvases hand back a blob through a callback,
 * `OffscreenCanvas` through a promise; both are wrapped here so the encoder
 * does not care which thread it is running on.
 */
export function toBlob(canvas: Surface, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
      type,
      quality
    )
  })
}

/** Average color of an image region — used for the "auto" background. */
export function averageColor(
  source: CanvasImageSource,
  width: number,
  height: number
): { color: string; dark: boolean } {
  const w = 24
  const h = Math.max(1, Math.round((height / width) * w))
  const canvas = createCanvas(w, h)
  const ctx = context2d(canvas)
  ctx.drawImage(source, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
    count++
  }
  const avg = { r: r / count, g: g / count, b: b / count, a: 1 }
  const hex = toHex(avg)
  return { color: hex, dark: luminance(hex) < 0.4 }
}

/**
 * Detects a uniform border around a capture (window chrome padding, desktop
 * bleed) so "auto balance" can trim it before composing.
 */
export function detectTrim(
  source: CanvasImageSource,
  width: number,
  height: number,
  tolerance = 10
): { x: number; y: number; w: number; h: number } {
  const maxSide = 320
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const w = Math.max(2, Math.round(width * scale))
  const h = Math.max(2, Math.round(height * scale))
  const canvas = createCanvas(w, h)
  const ctx = context2d(canvas)
  ctx.drawImage(source, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * w + x) * 4
    return [data[i], data[i + 1], data[i + 2]]
  }

  const corner = at(0, 0)
  const same = (p: [number, number, number]): boolean =>
    Math.abs(p[0] - corner[0]) <= tolerance &&
    Math.abs(p[1] - corner[1]) <= tolerance &&
    Math.abs(p[2] - corner[2]) <= tolerance

  const rowUniform = (y: number): boolean => {
    for (let x = 0; x < w; x++) if (!same(at(x, y))) return false
    return true
  }
  const colUniform = (x: number): boolean => {
    for (let y = 0; y < h; y++) if (!same(at(x, y))) return false
    return true
  }

  let top = 0
  let bottom = h - 1
  let left = 0
  let right = w - 1
  while (top < bottom && rowUniform(top)) top++
  while (bottom > top && rowUniform(bottom)) bottom--
  while (left < right && colUniform(left)) left++
  while (right > left && colUniform(right)) right--

  const trimmed = {
    x: left / w,
    y: top / h,
    w: (right - left + 1) / w,
    h: (bottom - top + 1) / h
  }

  // Ignore useless results (nothing to trim, or a near-empty capture).
  if (trimmed.w < 0.2 || trimmed.h < 0.2) return { x: 0, y: 0, w: 1, h: 1 }
  return trimmed
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

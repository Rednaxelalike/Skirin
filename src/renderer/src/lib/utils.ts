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

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

/**
 * Hands an intermediate canvas' backing store back to the GC straight away.
 * An export render juggles several full-resolution surfaces at once, and
 * waiting for collection is what tips a 4x export into an out-of-memory
 * failure.
 */
export function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('2D canvas is unavailable')
  return ctx
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

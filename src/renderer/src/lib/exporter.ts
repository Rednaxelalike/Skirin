import type { ExportSettings, Scene } from '@shared/types'
import { renderScene } from './render'
import type { SceneImages } from './render'
import { context2d, createCanvas, release, toBlob } from './utils'
import type { Surface } from './utils'

const MIME: Record<ExportSettings['format'], string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

export interface EncodedImage {
  blob: Blob
  bytes: number
  width: number
  height: number
  quality: number
}

/**
 * The stages of an export worth telling the user about.
 *
 * These are the real time boundaries, not a progress bar: composing dominates,
 * encoding a 30MP surface is not instant, and the size budget re-encodes it up
 * to seven more times, which is by far the longest an export ever takes.
 */
export type ExportPhase = 'composing' | 'encoding' | 'fitting'

export type OnPhase = (phase: ExportPhase) => void

/**
 * Encodes the canvas, and when a size budget is set, binary-searches quality
 * (then resolution) until the result fits — the "keep it under 1 MB" workflow.
 */
export async function encodeCanvas(
  canvas: Surface,
  settings: ExportSettings,
  onPhase?: OnPhase
): Promise<EncodedImage> {
  const mime = MIME[settings.format]
  const lossless = settings.format === 'png'
  // A blob rather than a data URL: nothing becomes a base64 string, and
  // `blob.size` is the real file size rather than an estimate derived from
  // string length. That last part matters — the budget below searches on it.
  const at = (quality: number, source: Surface = canvas): Promise<Blob> =>
    toBlob(source, mime, lossless ? undefined : quality)

  let quality = settings.quality
  let blob = await at(quality)

  const budget = settings.maxSizeKb ? settings.maxSizeKb * 1024 : null
  if (!budget || blob.size <= budget) {
    return { blob, bytes: blob.size, width: canvas.width, height: canvas.height, quality }
  }

  onPhase?.('fitting')

  if (!lossless) {
    let low = 0.25
    let high = quality
    for (let i = 0; i < 7 && high - low > 0.02; i++) {
      const mid = (low + high) / 2
      const candidate = await at(mid)
      if (candidate.size <= budget) {
        low = mid
        blob = candidate
        quality = mid
      } else {
        high = mid
      }
    }
    if (blob.size <= budget) {
      return { blob, bytes: blob.size, width: canvas.width, height: canvas.height, quality }
    }
  }

  // Still too heavy — step the resolution down.
  let working = canvas
  for (let i = 0; i < 6 && blob.size > budget; i++) {
    const next = createCanvas(working.width * 0.8, working.height * 0.8)
    const ctx = context2d(next)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(working, 0, 0, next.width, next.height)
    if (working !== canvas) release(working)
    working = next
    blob = await at(quality, working)
  }

  return { blob, bytes: blob.size, width: working.width, height: working.height, quality }
}

export async function renderAndEncode(
  scene: Scene,
  images: SceneImages,
  settings: ExportSettings,
  onPhase?: OnPhase
): Promise<EncodedImage> {
  onPhase?.('composing')
  const result = renderScene(scene, images, {
    scale: settings.scale,
    forceTransparent: settings.transparent && settings.format !== 'jpeg'
  })
  onPhase?.('encoding')
  return encodeCanvas(result.canvas, settings, onPhase)
}

export function suggestedName(sourceName: string): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`
  const clean = sourceName.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 48)
  return clean ? `${clean} — ${stamp}` : `Skirin ${stamp}`
}

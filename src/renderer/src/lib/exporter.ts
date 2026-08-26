import type { ExportSettings, Scene } from '@shared/types'
import { renderScene } from './render'
import type { SceneImages } from './render'

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
 * `toBlob` rather than `toDataURL`: the browser encodes off the main thread,
 * the result never becomes a base64 string, and `blob.size` is the real file
 * size instead of an estimate derived from string length. That last part
 * matters here — the size budget below binary-searches against it.
 */
function encode(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number | undefined
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
      mime,
      quality
    )
  })
}

/**
 * Encodes the canvas, and when a size budget is set, binary-searches quality
 * (then resolution) until the result fits — the "keep it under 1 MB" workflow.
 */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  settings: ExportSettings
): Promise<EncodedImage> {
  const mime = MIME[settings.format]
  const lossless = settings.format === 'png'
  const at = (quality: number, source: HTMLCanvasElement = canvas): Promise<Blob> =>
    encode(source, mime, lossless ? undefined : quality)

  let quality = settings.quality
  let blob = await at(quality)

  const budget = settings.maxSizeKb ? settings.maxSizeKb * 1024 : null
  if (!budget || blob.size <= budget) {
    return { blob, bytes: blob.size, width: canvas.width, height: canvas.height, quality }
  }

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
    const next = document.createElement('canvas')
    next.width = Math.max(1, Math.round(working.width * 0.8))
    next.height = Math.max(1, Math.round(working.height * 0.8))
    const ctx = next.getContext('2d')
    if (!ctx) break
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(working, 0, 0, next.width, next.height)
    working = next
    blob = await at(quality, working)
  }

  return { blob, bytes: blob.size, width: working.width, height: working.height, quality }
}

export async function renderAndEncode(
  scene: Scene,
  images: SceneImages,
  settings: ExportSettings
): Promise<EncodedImage> {
  const result = renderScene(scene, images, {
    scale: settings.scale,
    forceTransparent: settings.transparent && settings.format !== 'jpeg'
  })
  return encodeCanvas(result.canvas, settings)
}

export function suggestedName(sourceName: string): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`
  const clean = sourceName.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 48)
  return clean ? `${clean} — ${stamp}` : `Skirin ${stamp}`
}

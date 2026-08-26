import type { ExportSettings, Scene } from '@shared/types'
import { renderScene } from './render'
import type { SceneImages } from './render'
import { dataUrlBytes } from './utils'

const MIME: Record<ExportSettings['format'], string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

export interface EncodedImage {
  dataUrl: string
  bytes: number
  width: number
  height: number
  quality: number
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
  const encode = (quality: number, source: HTMLCanvasElement = canvas): string =>
    source.toDataURL(mime, settings.format === 'png' ? undefined : quality)

  let quality = settings.quality
  let dataUrl = encode(quality)
  let bytes = dataUrlBytes(dataUrl)

  const budget = settings.maxSizeKb ? settings.maxSizeKb * 1024 : null
  if (!budget || bytes <= budget) {
    return { dataUrl, bytes, width: canvas.width, height: canvas.height, quality }
  }

  if (settings.format !== 'png') {
    let low = 0.25
    let high = quality
    for (let i = 0; i < 7 && high - low > 0.02; i++) {
      const mid = (low + high) / 2
      const candidate = encode(mid)
      const size = dataUrlBytes(candidate)
      if (size <= budget) {
        low = mid
        dataUrl = candidate
        bytes = size
        quality = mid
      } else {
        high = mid
      }
    }
    if (bytes <= budget) {
      return { dataUrl, bytes, width: canvas.width, height: canvas.height, quality }
    }
  }

  // Still too heavy — step the resolution down.
  let working = canvas
  for (let i = 0; i < 6 && bytes > budget; i++) {
    const next = document.createElement('canvas')
    next.width = Math.max(1, Math.round(working.width * 0.8))
    next.height = Math.max(1, Math.round(working.height * 0.8))
    const ctx = next.getContext('2d')
    if (!ctx) break
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(working, 0, 0, next.width, next.height)
    working = next
    dataUrl = encode(quality, working)
    bytes = dataUrlBytes(dataUrl)
  }

  return { dataUrl, bytes, width: working.width, height: working.height, quality }
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

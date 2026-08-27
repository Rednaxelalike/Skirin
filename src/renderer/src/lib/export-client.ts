import type { ExportSettings, Scene } from '@shared/types'
import { renderAndEncode } from './exporter'
import type { EncodedImage, OnPhase } from './exporter'
import type { SceneImages } from './render'
import type { ExportRequest, ExportResponse } from './export-worker'

let worker: Worker | null = null
let unsupported = false
let seq = 0
interface Waiting {
  resolve: (value: EncodedImage) => void
  reject: (error: Error) => void
  onPhase?: OnPhase
}

const pending = new Map<number, Waiting>()

/**
 * Fails every in-flight export and gives up on the worker for this session.
 *
 * Nothing that reaches here is recoverable by retrying: the render's own
 * failures come back as messages, so an error on the worker itself means the
 * script would not load or the thread died outright. Falling back to the main
 * thread costs the user a frozen editor during exports, which is a great deal
 * better than costing them the export.
 */
function abandon(reason: string): void {
  for (const entry of pending.values()) entry.reject(new Error(reason))
  pending.clear()
  worker?.terminate()
  worker = null
  unsupported = true
}

function ensureWorker(): Worker | null {
  if (worker) return worker
  if (unsupported) return null
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    unsupported = true
    return null
  }

  try {
    worker = new Worker(new URL('./export-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    unsupported = true
    return null
  }

  worker.onmessage = (event: MessageEvent<ExportResponse>): void => {
    const message = event.data
    const entry = pending.get(message.id)
    if (!entry) return
    if (message.type === 'progress') {
      entry.onPhase?.(message.phase)
      return
    }
    pending.delete(message.id)
    if (message.type === 'done') entry.resolve(message)
    else entry.reject(new Error(message.message))
  }
  worker.onerror = (event): void => abandon(event.message || 'The export worker stopped')
  worker.onmessageerror = (): void => abandon('The export worker sent back an unreadable result')

  return worker
}

/** Resolves once the browser has had a chance to paint. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/**
 * Composes and encodes an export, off the main thread wherever the runtime
 * allows it.
 */
export async function exportImage(
  scene: Scene,
  images: SceneImages,
  settings: ExportSettings,
  onPhase?: OnPhase
): Promise<EncodedImage> {
  const target = ensureWorker()
  if (!target) {
    // Without a worker the render blocks this thread, so let the caller's
    // "busy" state reach the screen before the freeze starts. The phases still
    // fire, but only the last one before each block will have been painted.
    await nextPaint()
    return renderAndEncode(scene, images, settings, onPhase)
  }

  const [base, background, watermark] = await Promise.all([
    createImageBitmap(images.base),
    images.background ? createImageBitmap(images.background) : null,
    images.watermark ? createImageBitmap(images.watermark) : null
  ])

  const id = ++seq
  const request: ExportRequest = {
    id,
    scene,
    settings,
    base,
    baseWidth: images.baseWidth,
    baseHeight: images.baseHeight,
    background,
    watermark
  }

  const transfer: Transferable[] = [base]
  if (background) transfer.push(background)
  if (watermark) transfer.push(watermark)

  return new Promise<EncodedImage>((resolve, reject) => {
    pending.set(id, { resolve, reject, onPhase })
    target.postMessage(request, transfer)
  })
}

import type { ExportSettings, Scene } from '@shared/types'
import { renderAndEncode } from './exporter'
import type { ExportPhase } from './exporter'

/**
 * Composing an export is seconds of solid canvas work, and on the main thread
 * that is seconds the editor cannot repaint in — the window goes grey and the
 * "Saving…" state never even reaches the screen. None of the render path needs
 * a document, so it runs here instead, on `OffscreenCanvas`.
 *
 * Bitmaps arrive transferred rather than copied, and the finished blob goes
 * back the same way.
 */
export interface ExportRequest {
  id: number
  scene: Scene
  settings: ExportSettings
  base: ImageBitmap
  baseWidth: number
  baseHeight: number
  background: ImageBitmap | null
  watermark: ImageBitmap | null
}

export type ExportResponse =
  | { id: number; type: 'progress'; phase: ExportPhase }
  | {
      id: number
      type: 'done'
      blob: Blob
      bytes: number
      width: number
      height: number
      quality: number
    }
  | { id: number; type: 'error'; message: string }

/**
 * This file's view of the worker global. `lib.dom` types `self` as a window,
 * and `lib.webworker` — which would type it properly — cannot be in the same
 * program as `lib.dom`, so the two handles used here are spelled out instead.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<ExportRequest>) => void) | null
  postMessage(message: ExportResponse): void
}

const worker = self as unknown as WorkerScope

worker.onmessage = async (event: MessageEvent<ExportRequest>): Promise<void> => {
  const { id, scene, settings, base, baseWidth, baseHeight, background, watermark } = event.data
  try {
    const encoded = await renderAndEncode(
      scene,
      { base, baseWidth, baseHeight, background, watermark },
      settings,
      (phase) => worker.postMessage({ id, type: 'progress', phase })
    )
    worker.postMessage({ id, type: 'done', ...encoded } satisfies ExportResponse)
  } catch (error) {
    worker.postMessage({
      id,
      type: 'error',
      message: (error as Error).message || 'The export could not be composed'
    } satisfies ExportResponse)
  } finally {
    // These were transferred in, so this worker owns them.
    base.close()
    background?.close()
    watermark?.close()
  }
}

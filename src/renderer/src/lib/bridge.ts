/**
 * The bridge between the editor and the Rust backend.
 *
 * This is what the Electron preload used to be. The shape is deliberately
 * unchanged — every component still calls `window.skirin.capture.area()` and
 * friends — so the port stayed a backend rewrite rather than a rewrite of the
 * whole app.
 *
 * Two things behave differently underneath, and both are faster:
 *
 * * **Images are URLs, not data URLs.** A capture arrives as
 *   `skirin://frame/<id>`; the webview streams and decodes it off the main
 *   thread instead of parsing megabytes of base64 on it.
 * * **Export bytes go out raw.** `image.copy` and `image.save` hand Tauri an
 *   `ArrayBuffer` as the invoke body, with the metadata riding along in
 *   headers, so a 4x export never becomes a string.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  AppInfo,
  AppSettings,
  Capture,
  DisplayInfo,
  ExportFormat,
  HistoryEntry,
  OverlayInit,
  Point,
  Preset,
  Rect,
  SaveResult,
  UpdateStatus,
  WindowSource
} from '@shared/types'

export interface LoadedImage {
  src: string
  width: number
  height: number
}

/** Subscribes to a backend event, returning the unsubscribe the editor expects. */
function on<T>(event: string, cb: (payload: T) => void): () => void {
  // `listen` resolves asynchronously, so unsubscribing before it settles has
  // to be remembered rather than ignored — otherwise a component that mounts
  // and unmounts quickly leaks a listener for the life of the window.
  let stop: (() => void) | null = null
  let cancelled = false

  void listen<T>(event, (e) => cb(e.payload)).then((unlisten) => {
    if (cancelled) unlisten()
    else stop = unlisten
  })

  return () => {
    cancelled = true
    stop?.()
  }
}

/**
 * Header values have to be ASCII, and both the suggested filename and the
 * source window's title are arbitrary Unicode — a default export name carries
 * an em dash, which alone is enough to make setting the header throw. Percent
 * encoding is the cheapest thing both sides already understand.
 */
function ascii(value: string): string {
  return encodeURIComponent(value)
}

/** Sends raw bytes as the invoke body, with metadata in headers. */
function sendBytes<T>(
  command: string,
  blob: Blob,
  headers: Record<string, string>
): Promise<T> {
  return blob
    .arrayBuffer()
    .then((buffer) => invoke<T>(command, buffer, { headers }))
}

const api = {
  settings: {
    get: (): Promise<AppSettings> => invoke('settings_get'),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      invoke('settings_set', { patch }),
    onChange: (cb: (settings: AppSettings) => void) => on('settings:changed', cb)
  },

  presets: {
    get: (): Promise<Preset[]> => invoke('presets_get'),
    set: (presets: Preset[]): Promise<Preset[]> => invoke('presets_set', { presets })
  },

  history: {
    get: (): Promise<HistoryEntry[]> => invoke('history_get'),
    clear: (): Promise<HistoryEntry[]> => invoke('history_clear')
  },

  capture: {
    area: (): Promise<Capture | null> => invoke('capture_area'),
    lastRegion: (): Promise<Capture | null> => invoke('capture_last'),
    display: (id?: number): Promise<Capture | null> =>
      invoke('capture_display', { id: id ?? null }),
    displays: (): Promise<DisplayInfo[]> => invoke('capture_displays'),
    windowSources: (): Promise<WindowSource[]> => invoke('capture_window_sources'),
    window: (id: string): Promise<Capture | null> => invoke('capture_window', { id }),
    onCapture: (cb: (capture: Capture) => void) => {
      // `new` opens the editor, `stored` lands while it is already open —
      // the editor treats both the same way.
      const offNew = on<Capture>('capture:new', cb)
      const offStored = on<Capture>('capture:stored', cb)
      return () => {
        offNew()
        offStored()
      }
    }
  },

  image: {
    /**
     * The backend decodes and sets the clipboard on a background thread — a 4x
     * export is a 56-megapixel PNG and doing it inline froze the window — so
     * the outcome arrives as an event rather than as the invoke's result. The
     * listener goes up first so a fast copy cannot land before it.
     */
    copy: async (blob: Blob): Promise<boolean> => {
      let settle: (ok: boolean) => void = () => {}
      const result = new Promise<boolean>((resolve) => {
        settle = resolve
      })
      const unlisten = await listen<boolean>('clipboard:result', (event) =>
        settle(event.payload)
      )
      try {
        const accepted = await sendBytes<boolean>('image_copy', blob, {})
        return accepted ? await result : false
      } finally {
        unlisten()
      }
    },
    paste: (): Promise<LoadedImage | null> => invoke('image_paste'),
    open: (): Promise<LoadedImage | null> => invoke('image_open'),
    save: (
      blob: Blob,
      options: {
        format: ExportFormat
        askWhere?: boolean
        suggestedName?: string
        width?: number
        height?: number
        sourceName?: string
        copy?: boolean
      }
    ): Promise<SaveResult> =>
      sendBytes('image_save', blob, {
        'x-format': options.format,
        'x-ask-where': options.askWhere ? '1' : '0',
        'x-name': ascii(options.suggestedName ?? ''),
        'x-width': String(options.width ?? 0),
        'x-height': String(options.height ?? 0),
        'x-source': ascii(options.sourceName ?? ''),
        'x-copy': options.copy ? '1' : '0'
      })
  },

  shell: {
    reveal: (path: string): Promise<void> => invoke('shell_reveal', { path }),
    open: (path: string): Promise<void> => invoke('shell_open', { path }),
    external: (url: string): Promise<void> => invoke('shell_external', { url })
  },

  app: {
    info: (): Promise<AppInfo> => invoke('app_info')
  },

  update: {
    status: (): Promise<UpdateStatus> => invoke('update_status'),
    check: (): Promise<UpdateStatus> => invoke('update_check'),
    download: (): Promise<UpdateStatus> => invoke('update_download'),
    install: (): Promise<boolean> => invoke('update_install'),
    openReleases: (): Promise<void> => invoke('update_open_releases'),
    onStatus: (cb: (status: UpdateStatus) => void) => on('update:status', cb)
  },

  window: {
    minimize: (): void => void invoke('window_minimize'),
    toggleMaximize: (): void => void invoke('window_toggle_maximize'),
    close: (): void => void invoke('window_close'),
    hide: (): void => void invoke('window_hide'),
    isMaximized: (): Promise<boolean> => invoke('window_is_maximized'),
    onState: (cb: (maximized: boolean) => void) => on('window:state', cb)
  },

  ui: {
    onOpenWindowPicker: (cb: () => void) => on('ui:open-window-picker', cb),
    onOpenSettings: (cb: () => void) => on('ui:open-settings', cb)
  },

  overlay: {
    // Pulled on mount rather than pushed, so there is no window in which the
    // payload can arrive before the listener exists.
    init: (): Promise<OverlayInit | null> => invoke('overlay_init'),
    onCursor: (cb: (point: Point) => void) => on('overlay:cursor', cb),
    ready: (): void => void invoke('overlay_ready'),
    cancel: (): void => void invoke('overlay_cancel'),
    confirm: (rect: Rect, label: string): void => void invoke('overlay_confirm', { rect, label }),
    broadcastCursor: (point: Point): void => void invoke('overlay_broadcast_cursor', { point })
  }
}

export type SkirinApi = typeof api

declare global {
  interface Window {
    skirin: SkirinApi
  }
}

window.skirin = api

// WebView2 offers a browser context menu — reload, back, inspect — that
// Electron never had and that has nothing to do with this app. Text fields
// keep theirs, because cut/copy/paste there is genuinely useful.
window.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement | null
  const editable =
    !!target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  if (!editable) event.preventDefault()
})

export { api }

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  AppSettings,
  Capture,
  DisplayInfo,
  ExportFormat,
  HistoryEntry,
  OverlayInit,
  Preset,
  Rect,
  SaveResult,
  UpdateStatus,
  WindowSource
} from '../shared/types'

const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:set', patch),
    onChange: (cb: (settings: AppSettings) => void) => {
      const handler = (_e: unknown, s: AppSettings): void => cb(s)
      ipcRenderer.on('settings:changed', handler)
      return () => {
        ipcRenderer.off('settings:changed', handler)
      }
    }
  },

  presets: {
    get: (): Promise<Preset[]> => ipcRenderer.invoke('presets:get'),
    set: (presets: Preset[]): Promise<Preset[]> => ipcRenderer.invoke('presets:set', presets)
  },

  history: {
    get: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:get'),
    clear: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:clear')
  },

  capture: {
    area: (): Promise<Capture | null> => ipcRenderer.invoke('capture:area'),
    lastRegion: (): Promise<Capture | null> => ipcRenderer.invoke('capture:last'),
    display: (id?: number): Promise<Capture | null> => ipcRenderer.invoke('capture:display', id),
    displays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('capture:displays'),
    windowSources: (): Promise<WindowSource[]> => ipcRenderer.invoke('capture:window-sources'),
    window: (id: string): Promise<Capture | null> => ipcRenderer.invoke('capture:window', id),
    onCapture: (cb: (capture: Capture) => void) => {
      const handler = (_e: unknown, c: Capture): void => cb(c)
      ipcRenderer.on('capture:new', handler)
      ipcRenderer.on('capture:stored', handler)
      return () => {
        ipcRenderer.off('capture:new', handler)
        ipcRenderer.off('capture:stored', handler)
      }
    }
  },

  image: {
    copy: (dataUrl: string): Promise<boolean> => ipcRenderer.invoke('image:copy', dataUrl),
    paste: (): Promise<string | null> => ipcRenderer.invoke('image:paste'),
    open: (): Promise<string | null> => ipcRenderer.invoke('image:open'),
    save: (
      dataUrl: string,
      options: {
        format: ExportFormat
        askWhere?: boolean
        suggestedName?: string
        width?: number
        height?: number
        sourceName?: string
      }
    ): Promise<SaveResult> => ipcRenderer.invoke('image:save', dataUrl, options)
  },

  shell: {
    reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
    open: (path: string): Promise<void> => ipcRenderer.invoke('shell:open', path),
    external: (url: string): Promise<void> => ipcRenderer.invoke('shell:external', url)
  },

  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info')
  },

  update: {
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
    download: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:download'),
    install: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
    openReleases: (): Promise<void> => ipcRenderer.invoke('update:open-releases'),
    onStatus: (cb: (status: UpdateStatus) => void) => {
      const handler = (_e: unknown, s: UpdateStatus): void => cb(s)
      ipcRenderer.on('update:status', handler)
      return () => {
        ipcRenderer.off('update:status', handler)
      }
    }
  },

  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    hide: (): void => ipcRenderer.send('window:hide'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onState: (cb: (maximized: boolean) => void) => {
      const handler = (_e: unknown, v: boolean): void => cb(v)
      ipcRenderer.on('window:state', handler)
      return () => {
        ipcRenderer.off('window:state', handler)
      }
    }
  },

  ui: {
    onOpenWindowPicker: (cb: () => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('ui:open-window-picker', handler)
      return () => {
        ipcRenderer.off('ui:open-window-picker', handler)
      }
    },
    onOpenSettings: (cb: () => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('ui:open-settings', handler)
      return () => {
        ipcRenderer.off('ui:open-settings', handler)
      }
    }
  },

  overlay: {
    onInit: (cb: (init: OverlayInit) => void) => {
      const handler = (_e: unknown, init: OverlayInit): void => cb(init)
      ipcRenderer.on('overlay:init', handler)
      return () => {
        ipcRenderer.off('overlay:init', handler)
      }
    },
    onCursor: (cb: (point: { x: number; y: number }) => void) => {
      const handler = (_e: unknown, p: { x: number; y: number }): void => cb(p)
      ipcRenderer.on('overlay:cursor', handler)
      return () => {
        ipcRenderer.off('overlay:cursor', handler)
      }
    },
    ready: (): void => ipcRenderer.send('overlay:ready'),
    cancel: (): void => ipcRenderer.send('overlay:cancel'),
    confirm: (rect: Rect, label: string): void => ipcRenderer.send('overlay:confirm', rect, label),
    broadcastCursor: (point: { x: number; y: number }): void =>
      ipcRenderer.send('overlay:broadcast-cursor', point)
  }
}

export type SkirinApi = typeof api

contextBridge.exposeInMainWorld('skirin', api)

import type { AppSettings, Crop, Scene } from './types'

export const APP_NAME = 'Skirin'

export const defaultCrop = (): Crop => ({
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  flipH: false,
  flipV: false,
  quarterTurns: 0
})

export const defaultScene = (): Scene => ({
  canvas: {
    ratio: 'auto',
    padding: 0.09,
    autoBalance: true
  },
  background: {
    kind: 'gradient',
    solid: '#0f172a',
    gradient: {
      type: 'linear',
      angle: 135,
      stops: [
        { color: '#6366f1', pos: 0 },
        { color: '#a855f7', pos: 0.5 },
        { color: '#ec4899', pos: 1 }
      ]
    },
    mesh: {
      base: '#1e1b4b',
      points: [
        { x: 0.2, y: 0.2, color: '#6366f1', radius: 0.7 },
        { x: 0.8, y: 0.25, color: '#ec4899', radius: 0.6 },
        { x: 0.5, y: 0.85, color: '#22d3ee', radius: 0.65 }
      ]
    },
    image: { src: null, fit: 'cover', blur: 0, scale: 1, opacity: 1 },
    noise: 0,
    vignette: 0
  },
  frame: {
    radius: 14,
    shadow: {
      enabled: true,
      x: 0,
      y: 24,
      blur: 60,
      spread: 0,
      color: '#000000',
      opacity: 0.38
    },
    border: { enabled: false, width: 1, color: '#ffffff40', inset: true },
    rotate: 0,
    tiltX: 0,
    tiltY: 0,
    perspective: 1400,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    reflection: 0,
    browser: { style: 'none', url: 'https://example.com', title: 'Untitled', dark: true }
  },
  crop: defaultCrop(),
  annotations: [],
  watermark: {
    enabled: false,
    text: 'Made with Skirin',
    imageSrc: null,
    position: 'bottom-right',
    color: '#ffffff',
    opacity: 0.75,
    size: 16,
    margin: 20
  }
})

export const defaultSettings = (saveDir: string): AppSettings => ({
  shortcuts: {
    area: 'Control+Shift+1',
    fullscreen: 'Control+Shift+2',
    window: 'Control+Shift+3',
    lastRegion: 'Control+Shift+4',
    openEditor: 'Control+Shift+S'
  },
  systemKeys: {
    printScreen: false,
    snip: false
  },
  afterCapture: 'editor',
  saveDir,
  filenameTemplate: 'Skirin {yyyy}-{MM}-{dd} at {HH}.{mm}.{ss}',
  autoLaunch: false,
  showTray: true,
  captureSound: true,
  captureDelay: 0,
  theme: 'dark',
  defaultPresetId: 'aurora',
  exportDefaults: {
    format: 'png',
    scale: 2,
    quality: 0.92,
    maxSizeKb: null,
    transparent: false
  },
  smartRedactOnCapture: false,
  copyOnExport: true,
  magnifier: true,
  rememberLastRegion: true,
  lastRegion: null
})

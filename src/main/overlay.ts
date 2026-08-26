import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { captureAllDisplays, cropDisplayShot, findShotForRect } from './capture'
import type { DisplayShot } from './capture'
import { listWindows } from './winapi'
import { getSettings, setSettings } from './store'
import type { Capture, Rect } from '../shared/types'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

interface Session {
  windows: BrowserWindow[]
  shots: DisplayShot[]
  resolve: (capture: Capture | null) => void
  done: boolean
}

let session: Session | null = null

/**
 * Win32 reports window rects in physical pixels; Electron works in DIPs.
 * `screenToDipRect` is the only mapping that stays correct across mixed-DPI
 * monitor setups.
 */
function toDip(rect: Rect): Rect {
  if (process.platform !== 'win32') return rect
  try {
    return screen.screenToDipRect(null, rect)
  } catch {
    return rect
  }
}

function overlayUrl(displayId: number): { url: string; isFile: boolean } {
  if (isDev) {
    return { url: `${process.env['ELECTRON_RENDERER_URL']}/overlay.html?d=${displayId}`, isFile: false }
  }
  return { url: join(__dirname, '../renderer/overlay.html'), isFile: true }
}

function teardown(): void {
  if (!session) return
  const s = session
  session = null
  for (const win of s.windows) {
    if (!win.isDestroyed()) win.destroy()
  }
}

function finish(capture: Capture | null): void {
  if (!session || session.done) return
  session.done = true
  const resolve = session.resolve
  teardown()
  resolve(capture)
}

export async function beginAreaSelection(): Promise<Capture | null> {
  if (session) {
    finish(null)
  }

  const [shots, nativeWindows] = await Promise.all([captureAllDisplays(), listWindows()])
  if (!shots.length) return null

  const settings = getSettings()

  return new Promise<Capture | null>((resolve) => {
    const windows: BrowserWindow[] = []
    session = { windows, shots, resolve, done: false }

    for (const shot of shots) {
      const { display } = shot
      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        show: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        roundedCorners: false,
        alwaysOnTop: true,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false,
          backgroundThrottling: false
        }
      })

      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setBounds(display.bounds)

      // Scoped payload: only this display's frozen frame and window rects.
      const payload = {
        displayId: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        dataUrl: shot.image.toDataURL(),
        magnifier: settings.magnifier,
        lastRegion: settings.lastRegion,
        windows: nativeWindows
          .map((w) => toDip(w.rect))
          .filter(
            (r) =>
              r.x + r.width > display.bounds.x &&
              r.x < display.bounds.x + display.bounds.width &&
              r.y + r.height > display.bounds.y &&
              r.y < display.bounds.y + display.bounds.height
          )
      }

      win.webContents.once('did-finish-load', () => {
        win.webContents.send('overlay:init', payload)
      })

      const target = overlayUrl(display.id)
      if (target.isFile) {
        win.loadFile(target.url, { query: { d: String(display.id) } })
      } else {
        win.loadURL(target.url)
      }

      win.on('closed', () => finish(null))
      windows.push(win)
    }
  })
}

/** Re-uses the previously captured region without showing the overlay. */
export async function captureLastRegion(): Promise<Capture | null> {
  const region = getSettings().lastRegion
  if (!region) return null
  const shots = await captureAllDisplays()
  const shot = findShotForRect(shots, region)
  if (!shot) return null
  return cropDisplayShot(shot, region, 'Last region')
}

export function registerOverlayIpc(): void {
  ipcMain.on('overlay:ready', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    win.show()
    win.focus()
    win.moveTop()
  })

  ipcMain.on('overlay:cancel', () => finish(null))

  ipcMain.on('overlay:confirm', (_event, rect: Rect, label: string) => {
    if (!session) return
    const normalized: Rect = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    }
    const shot = findShotForRect(session.shots, normalized)
    if (!shot) {
      finish(null)
      return
    }
    const capture = cropDisplayShot(shot, normalized, label || 'Selection')
    if (getSettings().rememberLastRegion) setSettings({ lastRegion: normalized })
    finish(capture)
  })

  // Keeps every overlay in sync while the pointer travels between monitors.
  ipcMain.on('overlay:broadcast-cursor', (event, point: { x: number; y: number }) => {
    if (!session) return
    for (const win of session.windows) {
      if (win.isDestroyed() || win.webContents === event.sender) continue
      win.webContents.send('overlay:cursor', point)
    }
  })
}

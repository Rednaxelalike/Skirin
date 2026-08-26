import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import {
  captureDisplay,
  captureWindowById,
  describeDisplays,
  listWindowSources
} from './capture'
import { beginAreaSelection, captureLastRegion, registerOverlayIpc } from './overlay'
import {
  copyImageToClipboard,
  openPath,
  pickImage,
  readImageFromClipboard,
  reveal,
  saveImage
} from './files'
import type { SaveOptions } from './files'
import {
  clearHistory,
  getHistory,
  getPresets,
  getSettings,
  getWindowBounds,
  setPresets,
  setSettings,
  setWindowBounds
} from './store'
import {
  checkForUpdatesNow,
  registerUpdater,
  startUpdateChecks,
  stopUpdateChecks
} from './updater'
import type { AppSettings, Capture, ExportFormat, Preset } from '../shared/types'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

/* --------------------------------- icon --------------------------------- */

function iconPath(name: string): string | null {
  const candidates = [
    join(__dirname, '../../resources', name),
    join(process.resourcesPath, name),
    join(app.getAppPath(), 'resources', name)
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function appIcon(): Electron.NativeImage | undefined {
  const p = iconPath('icon.png')
  return p ? nativeImage.createFromPath(p) : undefined
}

/* ------------------------------ main window ----------------------------- */

function createMainWindow(): BrowserWindow {
  const saved = getWindowBounds()
  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 820,
    x: saved?.x,
    y: saved?.y,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    // Native caption buttons, our own title bar underneath.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e0e13', symbolColor: '#9ca3af', height: 40 },
    backgroundColor: '#0a0a0c',
    backgroundMaterial: 'mica',
    icon: appIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      spellcheck: false
    }
  })

  // `ready-to-show` is the happy path; the other two are belt-and-braces so a
  // slow or failed first paint can never leave the app running headless.
  const reveal = (): void => {
    if (!win.isDestroyed() && !win.isVisible() && !process.argv.includes('--tray')) win.show()
  }
  win.once('ready-to-show', reveal)
  win.webContents.once('did-finish-load', reveal)
  win.webContents.on('did-fail-load', (_e, code, description, url) => {
    console.error('[skirin] renderer failed to load', code, description, url)
    reveal()
  })
  win.webContents.on('render-process-gone', (_e, details) =>
    console.error('[skirin] renderer gone', details)
  )
  setTimeout(reveal, 4000)

  win.on('close', (event) => {
    if (!quitting && getSettings().showTray) {
      event.preventDefault()
      win.hide()
      return
    }
    const bounds = win.getNormalBounds()
    setWindowBounds(bounds)
  })

  win.on('maximize', () => win.webContents.send('window:state', true))
  win.on('unmaximize', () => win.webContents.send('window:state', false))

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function showEditor(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  return mainWindow
}

/* ------------------------------ capture flow ---------------------------- */

async function withHiddenEditor<T>(run: () => Promise<T>): Promise<T> {
  const wasVisible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
  if (wasVisible) {
    mainWindow!.hide()
    // Give the compositor a frame to actually remove the window.
    await new Promise((r) => setTimeout(r, 140))
  }
  try {
    return await run()
  } finally {
    if (wasVisible && mainWindow && !mainWindow.isDestroyed()) mainWindow.showInactive()
  }
}

async function deliver(capture: Capture | null): Promise<Capture | null> {
  if (!capture) return null
  const settings = getSettings()

  if (settings.afterCapture === 'copy' || settings.afterCapture === 'copy-save') {
    await copyImageToClipboard(capture.dataUrl)
  }
  if (settings.afterCapture === 'save' || settings.afterCapture === 'copy-save') {
    await saveImage(capture.dataUrl, {
      format: 'png',
      width: capture.width,
      height: capture.height,
      sourceName: capture.sourceName
    })
  }

  const opensEditor =
    settings.afterCapture === 'editor' || settings.afterCapture === 'editor-copy'
  if (settings.afterCapture === 'editor-copy') await copyImageToClipboard(capture.dataUrl)

  if (opensEditor) {
    const win = showEditor()
    const send = (): void => win.webContents.send('capture:new', capture)
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', send)
    } else {
      send()
    }
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('capture:stored', capture)
  }

  return capture
}

async function runCapture(kind: 'area' | 'display' | 'last', id?: number): Promise<Capture | null> {
  const delay = getSettings().captureDelay
  if (delay > 0) await new Promise((r) => setTimeout(r, delay * 1000))

  return withHiddenEditor(async () => {
    if (kind === 'area') return deliver(await beginAreaSelection())
    if (kind === 'last') {
      const capture = await captureLastRegion()
      return deliver(capture ?? (await beginAreaSelection()))
    }
    return deliver(await captureDisplay(id))
  })
}

/* -------------------------------- shortcuts ------------------------------ */

function registerShortcuts(): void {
  globalShortcut.unregisterAll()
  const { shortcuts } = getSettings()
  const bind = (accel: string, fn: () => void): void => {
    if (!accel) return
    try {
      globalShortcut.register(accel, fn)
    } catch {
      /* an accelerator owned by another app — ignore */
    }
  }

  bind(shortcuts.area, () => void runCapture('area'))
  bind(shortcuts.fullscreen, () => void runCapture('display'))
  bind(shortcuts.lastRegion, () => void runCapture('last'))
  bind(shortcuts.window, () => {
    const win = showEditor()
    win.webContents.send('ui:open-window-picker')
  })
  bind(shortcuts.openEditor, () => showEditor())
}

/* ---------------------------------- tray -------------------------------- */

function buildTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
  if (!getSettings().showTray) return

  const p = iconPath('tray.png') ?? iconPath('icon.png')
  const image = p
    ? nativeImage.createFromPath(p).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()

  tray = new Tray(image)
  tray.setToolTip('Skirin — screenshot studio')

  const rebuild = (): void => {
    const { shortcuts } = getSettings()
    tray!.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Capture area', accelerator: shortcuts.area, click: () => void runCapture('area') },
        {
          label: 'Capture full screen',
          accelerator: shortcuts.fullscreen,
          click: () => void runCapture('display')
        },
        {
          label: 'Capture window…',
          accelerator: shortcuts.window,
          click: () => showEditor().webContents.send('ui:open-window-picker')
        },
        {
          label: 'Repeat last region',
          accelerator: shortcuts.lastRegion,
          click: () => void runCapture('last')
        },
        { type: 'separator' },
        { label: 'Open Skirin', click: () => showEditor() },
        {
          label: 'Check for updates…',
          click: () => {
            showEditor()
            void checkForUpdatesNow()
          }
        },
        {
          label: 'Open captures folder',
          click: () => openPath(getSettings().saveDir)
        },
        {
          label: 'Settings…',
          click: () => showEditor().webContents.send('ui:open-settings')
        },
        { type: 'separator' },
        {
          label: 'Quit Skirin',
          click: () => {
            quitting = true
            app.quit()
          }
        }
      ])
    )
  }

  rebuild()
  tray.on('click', () => showEditor())
  tray.on('double-click', () => void runCapture('area'))
}

/* ---------------------------------- ipc --------------------------------- */

function registerIpc(): void {
  registerOverlayIpc()
  registerUpdater()

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const next = setSettings(patch)
    if (patch.shortcuts) registerShortcuts()
    if (patch.showTray !== undefined) buildTray()
    if (patch.autoLaunch !== undefined && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: patch.autoLaunch, args: ['--tray'] })
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:changed', next)
    }
    return next
  })

  ipcMain.handle('presets:get', () => getPresets())
  ipcMain.handle('presets:set', (_e, presets: Preset[]) => setPresets(presets))

  ipcMain.handle('history:get', () => getHistory())
  ipcMain.handle('history:clear', () => {
    clearHistory()
    return []
  })

  ipcMain.handle('capture:area', () => runCapture('area'))
  ipcMain.handle('capture:last', () => runCapture('last'))
  ipcMain.handle('capture:display', (_e, id?: number) => runCapture('display', id))
  ipcMain.handle('capture:displays', () => describeDisplays())
  ipcMain.handle('capture:window-sources', () =>
    withHiddenEditor(() => listWindowSources())
  )
  ipcMain.handle('capture:window', async (_e, id: string) => {
    const capture = await withHiddenEditor(() => captureWindowById(id))
    return deliver(capture)
  })

  ipcMain.handle('image:copy', (_e, dataUrl: string) => copyImageToClipboard(dataUrl))
  ipcMain.handle('image:paste', () => readImageFromClipboard())
  ipcMain.handle('image:open', (e) => pickImage(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle(
    'image:save',
    (e, dataUrl: string, options: SaveOptions & { format: ExportFormat }) =>
      saveImage(dataUrl, options, BrowserWindow.fromWebContents(e.sender))
  )

  ipcMain.handle('shell:reveal', (_e, path: string) => reveal(path))
  ipcMain.handle('shell:open', (_e, path: string) => openPath(path))
  ipcMain.handle('shell:external', (_e, url: string) => shell.openExternal(url))

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    saveDir: getSettings().saveDir
  }))

  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window:toggle-maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.on('window:hide', (e) => BrowserWindow.fromWebContents(e.sender)?.hide())
  ipcMain.handle('window:is-maximized', (e) =>
    BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false
  )
}

/* --------------------------------- boot --------------------------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showEditor())

  app.whenReady().then(() => {
    app.setAppUserModelId('com.skirin.app')
    Menu.setApplicationMenu(null)

    try {
      registerIpc()
      registerShortcuts()
      buildTray()
    } catch (error) {
      console.error('[skirin] startup task failed', error)
    }

    mainWindow = createMainWindow()
    startUpdateChecks()
    app.on('activate', () => showEditor())
  })

  // electron-updater emits this on the app object just before it relaunches,
  // but it is not part of Electron's own event union — hence the cast. Without
  // it, the tray's hide-instead-of-close guard would block the restart.
  ;(app as NodeJS.EventEmitter).on('before-quit-for-update', () => {
    quitting = true
  })

  app.on('before-quit', () => {
    quitting = true
    if (mainWindow && !mainWindow.isDestroyed()) {
      setWindowBounds(mainWindow.getNormalBounds())
    }
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopUpdateChecks()
  })

  app.on('window-all-closed', () => {
    if (!getSettings().showTray) app.quit()
  })
}

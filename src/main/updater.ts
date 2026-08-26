import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateStatus } from '../shared/types'

/** First check runs once the window has settled, not during the boot rush. */
const FIRST_CHECK_DELAY = 12_000
/** Background re-check cadence for long-running sessions. */
const CHECK_INTERVAL = 6 * 60 * 60 * 1000

let status: UpdateStatus = { state: 'idle', version: null, notes: null, percent: 0, error: null }
let timer: NodeJS.Timeout | null = null

/**
 * electron-builder bakes the publish target into `app-update.yml`, so reading
 * it back keeps the "view the release" link in step with wherever the build
 * actually publishes — no second copy of the owner/repo to drift.
 */
function releasesUrl(): string {
  try {
    const yml = readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const owner = /^\s*owner:\s*(\S+)/m.exec(yml)?.[1]
    const repo = /^\s*repo:\s*(\S+)/m.exec(yml)?.[1]
    if (owner && repo) return `https://github.com/${owner}/${repo}/releases/latest`
  } catch {
    /* dev run, or a build with no publish target */
  }
  return 'https://github.com/'
}

function broadcast(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:status', status)
  }
}

/**
 * Portable and unpacked builds have no installer to hand the download to, so
 * electron-updater cannot apply anything — those users get the release page
 * instead of a background failure.
 */
function canSelfUpdate(): boolean {
  return app.isPackaged && !process.env['PORTABLE_EXECUTABLE_DIR']
}

export function registerUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking', error: null }))

  autoUpdater.on('update-available', (info) =>
    broadcast({
      state: 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
      percent: 0,
      error: null
    })
  )

  autoUpdater.on('update-not-available', () => broadcast({ state: 'idle', percent: 0, error: null }))

  autoUpdater.on('download-progress', (progress) =>
    broadcast({ state: 'downloading', percent: Math.round(progress.percent) })
  )

  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ state: 'ready', version: info.version, percent: 100, error: null })
  )

  autoUpdater.on('error', (error) =>
    broadcast({ state: 'error', error: error?.message ?? 'Update check failed' })
  )

  ipcMain.handle('update:status', () => status)

  ipcMain.handle('update:check', async () => {
    if (!canSelfUpdate()) {
      await shell.openExternal(releasesUrl())
      return status
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      broadcast({ state: 'error', error: (error as Error).message })
    }
    return status
  })

  ipcMain.handle('update:download', async () => {
    if (!canSelfUpdate()) {
      await shell.openExternal(releasesUrl())
      return status
    }
    try {
      broadcast({ state: 'downloading', percent: 0, error: null })
      await autoUpdater.downloadUpdate()
    } catch (error) {
      broadcast({ state: 'error', error: (error as Error).message })
    }
    return status
  })

  ipcMain.handle('update:install', () => {
    if (status.state !== 'ready') return false
    // `isSilent: false` shows the installer UI; the second flag reopens Skirin.
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return true
  })

  ipcMain.handle('update:open-releases', () => shell.openExternal(releasesUrl()))
}

/** Quiet background checks — the renderer only hears about actual findings. */
export function startUpdateChecks(): void {
  if (!canSelfUpdate()) return

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => {
      /* offline, rate-limited, or no release yet — stay quiet and retry later */
    })
  }

  setTimeout(check, FIRST_CHECK_DELAY)
  timer = setInterval(check, CHECK_INTERVAL)
}

export function stopUpdateChecks(): void {
  if (timer) clearInterval(timer)
  timer = null
}

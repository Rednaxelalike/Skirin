import { BrowserWindow, clipboard, dialog, nativeImage, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ensureSaveDir, getSettings, pushHistory } from './store'
import type { ExportFormat, SaveResult } from '../shared/types'

const EXT: Record<ExportFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' }

function pad(n: number, size = 2): string {
  return String(n).padStart(size, '0')
}

export function renderTemplate(template: string, date = new Date()): string {
  const map: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    dd: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds())
  }
  return template
    .replace(/\{(yyyy|MM|dd|HH|mm|ss)\}/g, (_, key: string) => map[key])
    .replace(/[<>:"/\\|?*]/g, '-')
    .trim()
}

function decode(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

export function copyImageToClipboard(dataUrl: string): boolean {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) return false
  clipboard.writeImage(image)
  return true
}

export function readImageFromClipboard(): string | null {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  return image.toDataURL()
}

export interface SaveOptions {
  format: ExportFormat
  askWhere?: boolean
  suggestedName?: string
  addToHistory?: boolean
  width?: number
  height?: number
  sourceName?: string
}

export async function saveImage(
  dataUrl: string,
  options: SaveOptions,
  parent?: BrowserWindow | null
): Promise<SaveResult> {
  const settings = getSettings()
  const ext = EXT[options.format]
  const name = `${options.suggestedName ?? renderTemplate(settings.filenameTemplate)}.${ext}`

  let target: string
  if (options.askWhere) {
    const owner = parent ?? BrowserWindow.getFocusedWindow()
    const dialogOptions = {
      title: 'Export screenshot',
      defaultPath: join(settings.saveDir, name),
      filters: [
        { name: 'PNG image', extensions: ['png'] },
        { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
        { name: 'WebP image', extensions: ['webp'] }
      ]
    }
    const result = owner
      ? await dialog.showSaveDialog(owner, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    target = result.filePath
  } else {
    const dir = ensureSaveDir()
    mkdirSync(dir, { recursive: true })
    target = join(dir, name)
  }

  try {
    writeFileSync(target, decode(dataUrl))
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }

  if (options.addToHistory !== false) {
    const thumb = nativeImage.createFromDataURL(dataUrl).resize({ width: 320, quality: 'good' })
    pushHistory({
      id: `${Date.now()}-${basename(target)}`,
      file: target,
      thumb: thumb.toDataURL(),
      createdAt: Date.now(),
      width: options.width ?? 0,
      height: options.height ?? 0,
      sourceName: options.sourceName ?? basename(target)
    })
  }

  return { ok: true, path: target }
}

export function reveal(path: string): void {
  shell.showItemInFolder(path)
}

export function openPath(path: string): void {
  void shell.openPath(path)
}

export async function pickImage(parent?: BrowserWindow | null): Promise<string | null> {
  const owner = parent ?? BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    title: 'Open image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths.length) return null
  const image = nativeImage.createFromPath(result.filePaths[0])
  if (image.isEmpty()) return null
  return image.toDataURL()
}

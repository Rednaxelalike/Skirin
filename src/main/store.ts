import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings } from '../shared/defaults'
import type { AppSettings, HistoryEntry, Preset } from '../shared/types'

interface Persisted {
  settings: AppSettings
  presets: Preset[]
  history: HistoryEntry[]
  windowBounds?: { x: number; y: number; width: number; height: number }
}

let cache: Persisted | null = null

function file(): string {
  return join(app.getPath('userData'), 'skirin.json')
}

function seed(): Persisted {
  const pictures = join(app.getPath('pictures'), 'Skirin')
  return { settings: defaultSettings(pictures), presets: [], history: [] }
}

function read(): Persisted {
  if (cache) return cache
  try {
    const raw = readFileSync(file(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Persisted>
    const base = seed()
    cache = {
      settings: { ...base.settings, ...parsed.settings, shortcuts: { ...base.settings.shortcuts, ...parsed.settings?.shortcuts }, exportDefaults: { ...base.settings.exportDefaults, ...parsed.settings?.exportDefaults } },
      presets: parsed.presets ?? [],
      history: parsed.history ?? [],
      windowBounds: parsed.windowBounds
    }
  } catch {
    cache = seed()
  }
  return cache
}

function flush(): void {
  if (!cache) return
  try {
    writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf8')
  } catch (err) {
    console.error('[skirin] failed to persist settings', err)
  }
}

export function getSettings(): AppSettings {
  return read().settings
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const state = read()
  state.settings = { ...state.settings, ...patch }
  flush()
  return state.settings
}

export function getPresets(): Preset[] {
  return read().presets
}

export function setPresets(presets: Preset[]): Preset[] {
  const state = read()
  state.presets = presets
  flush()
  return state.presets
}

export function getHistory(): HistoryEntry[] {
  return read().history
}

export function pushHistory(entry: HistoryEntry): HistoryEntry[] {
  const state = read()
  state.history = [entry, ...state.history.filter((h) => h.id !== entry.id)].slice(0, 60)
  flush()
  return state.history
}

export function clearHistory(): void {
  const state = read()
  state.history = []
  flush()
}

export function getWindowBounds(): Persisted['windowBounds'] {
  return read().windowBounds
}

export function setWindowBounds(bounds: NonNullable<Persisted['windowBounds']>): void {
  const state = read()
  state.windowBounds = bounds
  flush()
}

export function ensureSaveDir(): string {
  const dir = getSettings().saveDir
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

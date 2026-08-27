import type { Annotation, EffectAnnotation } from '@shared/types'
import { uid } from './utils'
import type { Surface } from './utils'

export type SensitiveKind =
  | 'email'
  | 'phone'
  | 'card'
  | 'ip'
  | 'token'
  | 'url'
  | 'address'
  | 'all'

export interface DetectedField {
  kind: SensitiveKind
  text: string
  /** Normalized to the analysed image. */
  x: number
  y: number
  w: number
  h: number
}

interface WordBox {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  confidence: number
}

interface LineBox {
  words: WordBox[]
}

/* ------------------------------- patterns -------------------------------- */

interface Pattern {
  kind: SensitiveKind
  re: RegExp
  validate?: (value: string) => boolean
}

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

const PATTERNS: Pattern[] = [
  { kind: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g },
  { kind: 'card', re: /\b(?:\d[ -]?){13,19}\b/g, validate: luhn },
  {
    kind: 'phone',
    re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3}[\s.-]?\d{3,4}[\s.-]?\d{0,4}/g,
    validate: (v) => v.replace(/\D/g, '').length >= 9 && v.replace(/\D/g, '').length <= 15
  },
  { kind: 'ip', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  {
    kind: 'token',
    re: /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|\bAKIA[0-9A-Z]{12,}|\b[A-Fa-f0-9]{32,}\b/g
  },
  { kind: 'url', re: /https?:\/\/[^\s]{6,}/g }
]

export const KIND_LABELS: Record<SensitiveKind, string> = {
  email: 'Email addresses',
  phone: 'Phone numbers',
  card: 'Card numbers',
  ip: 'IP addresses',
  token: 'Keys and tokens',
  url: 'URLs',
  address: 'Addresses',
  all: 'All detected text'
}

export const DEFAULT_KINDS: SensitiveKind[] = ['email', 'phone', 'card', 'token', 'ip']

/* --------------------------------- OCR ----------------------------------- */

type WorkerLike = {
  recognize: (image: unknown, options?: unknown, output?: unknown) => Promise<{ data: unknown }>
  terminate: () => Promise<unknown>
}

let workerPromise: Promise<WorkerLike> | null = null

async function getWorker(onProgress?: (message: string, ratio: number) => void): Promise<WorkerLike> {
  if (workerPromise) return workerPromise
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js')
    return (await createWorker('eng', 1, {
      logger: (m: { status?: string; progress?: number }) => {
        if (onProgress && m.status) onProgress(m.status, m.progress ?? 0)
      }
    })) as unknown as WorkerLike
  })().catch((error) => {
    workerPromise = null
    throw error
  })
  return workerPromise
}

export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return
  const worker = await workerPromise.catch(() => null)
  workerPromise = null
  if (worker) await worker.terminate().catch(() => undefined)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function collectLines(data: any): LineBox[] {
  const lines: LineBox[] = []

  const pushWords = (words: any[]): void => {
    const mapped = words
      .filter((w) => w && w.text && w.bbox)
      .map((w) => ({
        text: String(w.text),
        x0: w.bbox.x0,
        y0: w.bbox.y0,
        x1: w.bbox.x1,
        y1: w.bbox.y1,
        confidence: w.confidence ?? 0
      }))
    if (mapped.length) lines.push({ words: mapped })
  }

  // tesseract.js exposes either a flat word list or a block tree depending on
  // the requested output — handle both.
  if (Array.isArray(data?.lines) && data.lines.length) {
    for (const line of data.lines) pushWords(line.words ?? [])
    return lines
  }

  if (Array.isArray(data?.blocks)) {
    for (const block of data.blocks) {
      for (const para of block?.paragraphs ?? []) {
        for (const line of para?.lines ?? []) pushWords(line?.words ?? [])
      }
    }
    if (lines.length) return lines
  }

  if (Array.isArray(data?.words) && data.words.length) pushWords(data.words)
  return lines
}

/**
 * Runs OCR then scans each recognised line for sensitive patterns,
 * returning normalized boxes for the words that matched.
 */
export async function detectSensitive(
  source: Surface,
  kinds: SensitiveKind[],
  onProgress?: (message: string, ratio: number) => void
): Promise<DetectedField[]> {
  const worker = await getWorker(onProgress)
  // Tesseract only accepts a DOM canvas. OCR is an editor action, and on the
  // main thread `createCanvas` always makes one — `OffscreenCanvas` is reached
  // only from the export worker, which never runs OCR.
  const { data } = await worker.recognize(
    source as HTMLCanvasElement,
    {},
    { blocks: true, text: false }
  )
  const lines = collectLines(data)
  const width = source.width
  const height = source.height
  const wantAll = kinds.includes('all')
  const results: DetectedField[] = []

  for (const line of lines) {
    const usable = line.words.filter((w) => w.confidence >= 40 && w.text.trim())
    if (!usable.length) continue

    if (wantAll) {
      for (const word of usable) {
        results.push(box('all', word.text, [word], width, height))
      }
      continue
    }

    // Rebuild the line text while remembering where each word starts.
    let text = ''
    const spans: Array<{ start: number; end: number; word: WordBox }> = []
    usable.forEach((word, i) => {
      if (i > 0) text += ' '
      const start = text.length
      text += word.text
      spans.push({ start, end: text.length, word })
    })

    for (const pattern of PATTERNS) {
      if (!kinds.includes(pattern.kind)) continue
      pattern.re.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.re.exec(text)) !== null) {
        const value = match[0].trim()
        if (value.length < 4) continue
        if (pattern.validate && !pattern.validate(value)) continue
        const start = match.index
        const end = start + match[0].length
        const hit = spans.filter((s) => s.end > start && s.start < end).map((s) => s.word)
        if (!hit.length) continue
        results.push(box(pattern.kind, value, hit, width, height))
      }
    }
  }

  return dedupe(results)
}

function box(
  kind: SensitiveKind,
  text: string,
  words: WordBox[],
  width: number,
  height: number
): DetectedField {
  const x0 = Math.min(...words.map((w) => w.x0))
  const y0 = Math.min(...words.map((w) => w.y0))
  const x1 = Math.max(...words.map((w) => w.x1))
  const y1 = Math.max(...words.map((w) => w.y1))
  const padX = (x1 - x0) * 0.02
  const padY = (y1 - y0) * 0.14
  return {
    kind,
    text,
    x: Math.max(0, x0 - padX) / width,
    y: Math.max(0, y0 - padY) / height,
    w: Math.min(width, x1 - x0 + padX * 2) / width,
    h: Math.min(height, y1 - y0 + padY * 2) / height
  }
}

function dedupe(fields: DetectedField[]): DetectedField[] {
  const kept: DetectedField[] = []
  for (const f of fields) {
    const overlap = kept.find(
      (k) =>
        Math.abs(k.x - f.x) < 0.01 && Math.abs(k.y - f.y) < 0.01 && Math.abs(k.w - f.w) < 0.02
    )
    if (!overlap) kept.push(f)
  }
  return kept
}

export function toAnnotations(
  fields: DetectedField[],
  style: 'blur' | 'pixelate' | 'redact',
  color = '#111114'
): Annotation[] {
  return fields.map((field) => {
    const annotation: EffectAnnotation = {
      id: uid('an-'),
      type: style,
      x: field.x,
      y: field.y,
      w: field.w,
      h: field.h,
      color: style === 'redact' ? color : '#000000',
      strokeWidth: 0,
      opacity: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      amount: style === 'pixelate' ? 10 : 14,
      radius: 4,
      shape: 'rect',
      label: undefined
    }
    return annotation
  })
}

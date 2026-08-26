/**
 * Generates Skirin's app icons without any native image dependency:
 * rasterise into a raw RGBA buffer, encode PNG by hand, then pack an ICO.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

/* --------------------------------- paint --------------------------------- */

const STOPS = [
  { at: 0, rgb: [124, 108, 255] },
  { at: 0.52, rgb: [168, 85, 247] },
  { at: 1, rgb: [255, 107, 168] }
]

function gradientAt(t) {
  const clamped = Math.min(1, Math.max(0, t))
  for (let i = 1; i < STOPS.length; i++) {
    const a = STOPS[i - 1]
    const b = STOPS[i]
    if (clamped <= b.at) {
      const k = (clamped - a.at) / (b.at - a.at)
      return [0, 1, 2].map((c) => a.rgb[c] + (b.rgb[c] - a.rgb[c]) * k)
    }
  }
  return STOPS[STOPS.length - 1].rgb
}

/** Signed distance to a rounded rectangle, used for anti-aliased edges. */
function roundedRectSdf(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius)
  const qy = Math.abs(py - cy) - (halfH - radius)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius
}

function render(size) {
  const ss = 4
  const dim = size * ss
  const acc = new Float32Array(size * size * 4)

  const outerHalf = dim * 0.5
  const outerRadius = dim * 0.225
  const markHalf = dim * 0.238
  const markRadius = dim * 0.072
  const markStroke = dim * 0.062

  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const px = x + 0.5
      const py = y + 0.5

      const body = roundedRectSdf(px, py, outerHalf, outerHalf, outerHalf, outerHalf, outerRadius)
      if (body > 0.7) continue
      const bodyAlpha = Math.min(1, Math.max(0, 0.5 - body))

      const [r, g, b] = gradientAt((px / dim) * 0.55 + (py / dim) * 0.45)

      // A soft top-left sheen keeps the mark from looking flat.
      const sheen = Math.max(0, 1 - Math.hypot(px - dim * 0.28, py - dim * 0.2) / (dim * 0.75))
      let cr = r + sheen * 34
      let cg = g + sheen * 30
      let cb = b + sheen * 26

      const mark = Math.abs(
        roundedRectSdf(px, py, outerHalf, outerHalf, markHalf, markHalf, markRadius)
      )
      // Erase the middle of each side so the ring reads as four crop marks.
      const dx = Math.abs(px - outerHalf)
      const dy = Math.abs(py - outerHalf)
      const corner = Math.min(dx, dy) - markHalf * 0.4
      const cornerAlpha = Math.min(1, Math.max(0, corner / (dim * 0.012) + 0.5))
      const markAlpha =
        Math.min(1, Math.max(0, markStroke / 2 - mark + 0.5)) * cornerAlpha
      if (markAlpha > 0) {
        cr = cr + (255 - cr) * markAlpha
        cg = cg + (255 - cg) * markAlpha
        cb = cb + (255 - cb) * markAlpha
      }

      const i = (Math.floor(y / ss) * size + Math.floor(x / ss)) * 4
      acc[i] += cr * bodyAlpha
      acc[i + 1] += cg * bodyAlpha
      acc[i + 2] += cb * bodyAlpha
      acc[i + 3] += bodyAlpha
    }
  }

  const samples = ss * ss
  const out = Buffer.alloc(size * size * 4)
  for (let p = 0; p < size * size; p++) {
    const i = p * 4
    const alpha = acc[i + 3] / samples
    out[i + 3] = Math.round(Math.min(1, alpha) * 255)
    if (alpha > 0) {
      out[i] = Math.round(Math.min(255, acc[i] / samples / alpha))
      out[i + 1] = Math.round(Math.min(255, acc[i + 1] / samples / alpha))
      out[i + 2] = Math.round(Math.min(255, acc[i + 2] / samples / alpha))
    }
  }
  return out
}

/* ---------------------------------- png ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------------------------------- ico ---------------------------------- */

function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  let offset = 6 + entries.length * 16
  const directory = []
  for (const entry of entries) {
    const record = Buffer.alloc(16)
    record[0] = entry.size >= 256 ? 0 : entry.size
    record[1] = entry.size >= 256 ? 0 : entry.size
    record.writeUInt16LE(1, 4)
    record.writeUInt16LE(32, 6)
    record.writeUInt32LE(entry.png.length, 8)
    record.writeUInt32LE(offset, 12)
    offset += entry.png.length
    directory.push(record)
  }
  return Buffer.concat([header, ...directory, ...entries.map((e) => e.png)])
}

/* --------------------------------- write --------------------------------- */

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((size) => ({ size, png: encodePng(render(size), size) }))

writeFileSync(join(outDir, 'icon.png'), pngs.find((p) => p.size === 256).png)
writeFileSync(join(outDir, 'tray.png'), pngs.find((p) => p.size === 32).png)
writeFileSync(join(outDir, 'icon.ico'), encodeIco(pngs))

console.log(`icons written to ${outDir}`)

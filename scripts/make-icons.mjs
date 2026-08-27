/**
 * Writes Skirin's app icons: render each size with the icon renderer, encode
 * PNG, then pack the whole ladder into a single ICO. No native image
 * dependency is involved — see icon-art.mjs for how the artwork is painted.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng, render } from './icon-art.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

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
const at = (size) => pngs.find((p) => p.size === size).png

writeFileSync(join(outDir, 'icon.png'), at(256))
writeFileSync(join(outDir, 'tray.png'), at(32))
writeFileSync(join(outDir, 'icon.ico'), encodeIco(pngs))

// The bundler reads its own set out of src-tauri/icons: the .ico becomes the
// executable's Windows resource, and the PNGs are what the installer and the
// tray hand to the shell.
const tauriDir = join(here, '..', 'src-tauri', 'icons')
mkdirSync(tauriDir, { recursive: true })
writeFileSync(join(tauriDir, '32x32.png'), at(32))
writeFileSync(join(tauriDir, '128x128.png'), at(128))
writeFileSync(join(tauriDir, '128x128@2x.png'), at(256))
writeFileSync(join(tauriDir, 'icon.png'), at(256))
writeFileSync(join(tauriDir, 'tray.png'), at(32))
writeFileSync(join(tauriDir, 'icon.ico'), encodeIco(pngs))

console.log(`icons written to ${outDir} and ${tauriDir}`)

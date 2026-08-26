/**
 * Trims dead weight out of the packaged Electron runtime.
 *
 * Skirin's own code is ~1.5 MB; everything else in the unpacked folder is
 * Chromium. Chromium's translated UI strings are the one large piece that is
 * genuinely unused, and they are removed here rather than through
 * electron-builder's `electronLanguages` because that option does not cover
 * the Windows `locales/*.pak` layout.
 *
 * Deliberately kept, despite being tempting targets:
 *   d3dcompiler_47.dll        — ANGLE needs it to compile shaders on D3D11.
 *   vk_swiftshader.dll        — the software rasteriser Chromium falls back to
 *                               when a machine has no usable GPU driver.
 *                               Skirin is one big canvas; without it the
 *                               editor renders blank on those machines.
 *   ffmpeg.dll                — nothing plays media today, but Electron
 *                               resolves it eagerly on some Windows builds and
 *                               then refuses to start.
 *   icudtl.dat                — Unicode tables; needs a custom Electron build
 *                               to shrink.
 *   LICENSES.chromium.html    — 11 MB, but the BSD/MIT terms in it require the
 *                               notices to travel with the binary, and it
 *                               compresses to well under 2 MB in the installer.
 */
const { existsSync, readdirSync, rmSync, statSync } = require('node:fs')
const { join } = require('node:path')

/** Chromium's own UI strings. Skirin ships English only. */
const KEEP_LOCALES = new Set(['en-US.pak'])

function sizeOf(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

exports.default = async function afterPack(context) {
  const locales = join(context.appOutDir, 'locales')
  if (!existsSync(locales)) return

  let freed = 0
  for (const name of readdirSync(locales)) {
    if (KEEP_LOCALES.has(name)) continue
    const file = join(locales, name)
    freed += sizeOf(file)
    rmSync(file, { force: true })
  }

  console.log(`[skirin] trimmed ${(freed / 1024 / 1024).toFixed(1)} MB of unused Chromium locales`)
}

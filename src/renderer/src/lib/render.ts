import type { Background, Crop, Scene, Watermark } from '@shared/types'
import {
  applyMatrix,
  drawImageQuad,
  projectQuad,
  quadBounds,
  roundedRectPath,
  translateQuad,
  unitSquareToQuad
} from './geometry'
import type { Quad } from './geometry'
import { drawAnnotations } from './annotations'
import {
  averageColor,
  clamp,
  context2d,
  createCanvas,
  release,
  shift,
  sourceSize,
  toRgba
} from './utils'
import type { ImageSource, Surface } from './utils'
import { ratioValue } from './presets'

export interface SceneImages {
  base: ImageSource
  baseWidth: number
  baseHeight: number
  background?: ImageSource | null
  watermark?: ImageSource | null
}

export interface RenderOptions {
  /** Multiplier applied to the natural composition size. */
  scale?: number
  /** Hard cap on the longest output edge, guards absurd exports. */
  maxEdge?: number
  /** Skip the grain pass while dragging sliders. */
  fast?: boolean
  /** Force a transparent background regardless of the scene setting. */
  forceTransparent?: boolean
}

export interface RenderResult {
  canvas: Surface
  width: number
  height: number
  /** Screenshot corners in canvas space — drives preview hit-testing. */
  contentQuad: Quad
  contentWidth: number
  contentHeight: number
  /** Natural (unscaled) composition size. */
  naturalWidth: number
  naturalHeight: number
}

/* ------------------------------- geometry -------------------------------- */

interface CropPx {
  sx: number
  sy: number
  sw: number
  sh: number
  outW: number
  outH: number
}

export function resolveCrop(crop: Crop, width: number, height: number): CropPx {
  const sx = clamp(crop.x, 0, 0.99) * width
  const sy = clamp(crop.y, 0, 0.99) * height
  const sw = clamp(crop.w, 0.01, 1 - clamp(crop.x, 0, 0.99)) * width
  const sh = clamp(crop.h, 0.01, 1 - clamp(crop.y, 0, 0.99)) * height
  const swapped = crop.quarterTurns % 2 === 1
  return {
    sx,
    sy,
    sw,
    sh,
    outW: Math.max(1, Math.round(swapped ? sh : sw)),
    outH: Math.max(1, Math.round(swapped ? sw : sh))
  }
}

/* ------------------------------ background ------------------------------- */

function paintGradient(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  w: number,
  h: number
): void {
  const { gradient } = bg
  const stops = [...gradient.stops].sort((a, b) => a.pos - b.pos)
  let grad: CanvasGradient

  if (gradient.type === 'radial') {
    grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2)
  } else if (gradient.type === 'conic') {
    grad = ctx.createConicGradient(((gradient.angle - 90) * Math.PI) / 180, w / 2, h / 2)
  } else {
    // CSS-style angle: 0deg points up, growing clockwise.
    const a = ((gradient.angle - 90) * Math.PI) / 180
    const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))
    const cx = w / 2
    const cy = h / 2
    grad = ctx.createLinearGradient(
      cx - (Math.cos(a) * len) / 2,
      cy - (Math.sin(a) * len) / 2,
      cx + (Math.cos(a) * len) / 2,
      cy + (Math.sin(a) * len) / 2
    )
  }

  for (const stop of stops) grad.addColorStop(clamp(stop.pos, 0, 1), stop.color)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

function paintMesh(ctx: CanvasRenderingContext2D, bg: Background, w: number, h: number): void {
  ctx.fillStyle = bg.mesh.base
  ctx.fillRect(0, 0, w, h)
  const reach = Math.hypot(w, h)
  for (const point of bg.mesh.points) {
    const r = Math.max(1, point.radius * reach * 0.6)
    const grad = ctx.createRadialGradient(point.x * w, point.y * h, 0, point.x * w, point.y * h, r)
    grad.addColorStop(0, toRgba(point.color, 0.95))
    grad.addColorStop(0.55, toRgba(point.color, 0.4))
    grad.addColorStop(1, toRgba(point.color, 0))
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  image: ImageSource,
  w: number,
  h: number
): void {
  const { width: iw, height: ih } = sourceSize(image)
  ctx.save()
  ctx.globalAlpha = bg.image.opacity
  if (bg.image.blur > 0) ctx.filter = `blur(${bg.image.blur}px)`

  if (bg.image.fit === 'tile') {
    const pattern = ctx.createPattern(image, 'repeat')
    if (pattern) {
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, w, h)
    }
  } else {
    const cover = bg.image.fit === 'cover'
    const ratio = cover ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih)
    const s = ratio * bg.image.scale
    // Bleed slightly so the blur never reveals the canvas edge.
    const bleed = bg.image.blur > 0 ? 1 + bg.image.blur / Math.min(w, h) : 1
    const dw = iw * s * bleed
    const dh = ih * s * bleed
    ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh)
  }
  ctx.restore()
}

let noiseTile: Surface | null = null

function getNoiseTile(): Surface {
  if (noiseTile) return noiseTile
  const size = 128
  const canvas = createCanvas(size, size)
  const ctx = context2d(canvas)
  const data = ctx.createImageData(size, size)
  for (let i = 0; i < data.data.length; i += 4) {
    const v = 120 + Math.random() * 135
    data.data[i] = v
    data.data[i + 1] = v
    data.data[i + 2] = v
    data.data[i + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  noiseTile = canvas
  return canvas
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  images: SceneImages,
  w: number,
  h: number,
  fast: boolean
): void {
  const bg = scene.background

  switch (bg.kind) {
    case 'transparent':
      break
    case 'solid':
      ctx.fillStyle = bg.solid
      ctx.fillRect(0, 0, w, h)
      break
    case 'mesh':
      paintMesh(ctx, bg, w, h)
      break
    case 'image':
      if (images.background) {
        paintImage(ctx, bg, images.background, w, h)
      } else {
        ctx.fillStyle = bg.solid
        ctx.fillRect(0, 0, w, h)
      }
      break
    case 'auto': {
      const { color } = averageColor(images.base, images.baseWidth, images.baseHeight)
      const grad = ctx.createLinearGradient(0, 0, w, h)
      grad.addColorStop(0, shift(color, 0.22))
      grad.addColorStop(0.5, color)
      grad.addColorStop(1, shift(color, -0.28))
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
      break
    }
    default:
      paintGradient(ctx, bg, w, h)
  }

  if (bg.vignette > 0 && bg.kind !== 'transparent') {
    const grad = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.25,
      w / 2,
      h / 2,
      Math.hypot(w, h) / 1.7
    )
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, `rgba(0,0,0,${clamp(bg.vignette, 0, 1)})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  if (bg.noise > 0 && !fast && bg.kind !== 'transparent') {
    const pattern = ctx.createPattern(getNoiseTile(), 'repeat')
    if (pattern) {
      ctx.save()
      ctx.globalAlpha = clamp(bg.noise, 0, 1) * 0.5
      ctx.globalCompositeOperation = 'overlay'
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    }
  }
}

/* ----------------------------- browser chrome ---------------------------- */

function chromeHeight(scene: Scene, contentWidth: number): number {
  const style = scene.frame.browser.style
  if (style === 'none') return 0
  const unit = contentWidth / 1000
  if (style === 'minimal') return Math.round(28 * unit)
  if (style === 'macos') return Math.round(38 * unit)
  return Math.round(46 * unit)
}

function paintChrome(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  width: number,
  height: number
): void {
  const { browser } = scene.frame
  const unit = width / 1000
  const dark = browser.dark
  ctx.fillStyle = dark ? '#22232a' : '#e9eaee'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = dark ? '#ffffff14' : '#00000012'
  ctx.fillRect(0, height - Math.max(1, unit), width, Math.max(1, unit))

  const cy = height / 2

  if (browser.style === 'windows') {
    // Right-aligned minimise / maximise / close glyphs.
    ctx.strokeStyle = dark ? '#c9cad1' : '#4a4b55'
    ctx.lineWidth = Math.max(1, 1.4 * unit)
    const gap = 46 * unit
    const size = 10 * unit
    for (let i = 0; i < 3; i++) {
      const cx = width - gap * (3 - i) + gap / 2
      ctx.beginPath()
      if (i === 0) {
        ctx.moveTo(cx - size / 2, cy)
        ctx.lineTo(cx + size / 2, cy)
      } else if (i === 1) {
        ctx.rect(cx - size / 2, cy - size / 2, size, size)
      } else {
        ctx.moveTo(cx - size / 2, cy - size / 2)
        ctx.lineTo(cx + size / 2, cy + size / 2)
        ctx.moveTo(cx + size / 2, cy - size / 2)
        ctx.lineTo(cx - size / 2, cy + size / 2)
      }
      ctx.stroke()
    }
    if (browser.title) {
      ctx.fillStyle = dark ? '#d5d6dd' : '#33343c'
      ctx.font = `500 ${13 * unit}px 'Segoe UI Variable Text', 'Segoe UI', sans-serif`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText(browser.title, 18 * unit, cy)
    }
    return
  }

  // macOS traffic lights.
  const colors = ['#ff5f57', '#febc2e', '#28c840']
  const r = (browser.style === 'minimal' ? 4.5 : 6) * unit
  colors.forEach((color, i) => {
    ctx.beginPath()
    ctx.arc(20 * unit + i * (r * 3.1), cy, r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  })

  if (browser.style === 'macos-url') {
    const barX = 150 * unit
    const barW = width - barX * 1.35
    const barH = 26 * unit
    ctx.fillStyle = dark ? '#00000040' : '#ffffffcc'
    roundedRectPath(ctx, barX, cy - barH / 2, barW, barH, barH / 2)
    ctx.fill()
    ctx.fillStyle = dark ? '#9ea0aa' : '#5b5c66'
    ctx.font = `400 ${12.5 * unit}px 'Segoe UI Variable Text', 'Segoe UI', sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(browser.url, barX + 14 * unit, cy)
  } else if (browser.style === 'macos' && browser.title) {
    ctx.fillStyle = dark ? '#b7b9c2' : '#44454e'
    ctx.font = `600 ${13 * unit}px 'Segoe UI Variable Text', 'Segoe UI', sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(browser.title, width / 2, cy)
  }
}

/* ------------------------------- resampling ------------------------------ */

/** Longest edge we are willing to rasterise the artwork at. */
const MAX_RASTER_EDGE = 8192
/** Pixel budget for the same raster, so huge captures cannot exhaust memory. */
const MAX_RASTER_PIXELS = 32e6

/**
 * How much the budget may be overshot to land on the requested scale exactly.
 *
 * Landing just short of the target is the expensive case: the stage then has to
 * resample the whole artwork by a hair on its way in, and a non-identity
 * `drawImage` of a 30MP surface costs several times the straight blit it would
 * otherwise have been. A 1920x1080 capture at 4x misses by 1.8% — 3.93 instead
 * of 4 — and pays a full high-quality resample for it. Buying those last few
 * percent of pixels is cheaper than the resample they avoid, so the budget
 * bends by up to a third when doing so reaches the target exactly.
 */
const RASTER_BUDGET_SLACK = 1.35

/**
 * How much bigger than capture resolution the artwork raster should be.
 * Never below 1 — the capture is already authored at its native size — and
 * capped so a 5K screenshot at 4x does not try to allocate a gigabyte.
 */
function rasterScaleFor(target: number, logicalW: number, logicalH: number): number {
  const longest = Math.max(1, Math.max(logicalW, logicalH))
  const area = Math.max(1, logicalW * logicalH)
  const capped = Math.max(
    1,
    Math.min(target, MAX_RASTER_EDGE / longest, Math.sqrt(MAX_RASTER_PIXELS / area))
  )

  // Close enough to the target that hitting it exactly is worth the pixels.
  // The edge cap is a hard limit on what the platform will allocate, so it is
  // never bent — only the pixel budget is.
  if (
    capped < target &&
    target * longest <= MAX_RASTER_EDGE &&
    target * target * area <= MAX_RASTER_PIXELS * RASTER_BUDGET_SLACK
  ) {
    return target
  }

  return capped
}

/**
 * Screenshots are pixel art. Bilinear upscaling smears the hard edges of glyphs
 * and 1px rules, which is why a 4x export used to read softer than the 1x
 * original. Stepping up by a whole number with smoothing off keeps every edge
 * hard — it invents no new colours — and a single high-quality downsample then
 * lands on the exact target when the factor is not an integer.
 */
function drawResampled(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const factor = Math.min(dw / sw, dh / sh)

  if (factor <= 1.002) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh)
    return
  }

  const step = Math.max(2, Math.ceil(factor - 0.002))
  const stepW = Math.max(1, Math.round(sw * step))
  const stepH = Math.max(1, Math.round(sh * step))

  const crisp = createCanvas(stepW, stepH)
  const cctx = context2d(crisp)
  cctx.imageSmoothingEnabled = false
  cctx.drawImage(source, sx, sy, sw, sh, 0, 0, stepW, stepH)

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(crisp, 0, 0, stepW, stepH, dx, dy, dw, dh)
  release(crisp)
}

/* -------------------------------- content -------------------------------- */

/**
 * Cropped, oriented screenshot with every annotation baked in.
 *
 * `raster` multiplies the capture resolution. Annotations are stored in
 * normalised coordinates, so raising it draws them — and, downstream, the
 * window chrome, border and corner radius — as true vectors at export
 * resolution instead of blowing a 1x bitmap up at the very end.
 */
export function buildContentCanvas(scene: Scene, images: SceneImages, raster = 1): Surface {
  const crop = resolveCrop(scene.crop, images.baseWidth, images.baseHeight)
  const outW = Math.max(1, Math.round(crop.outW * raster))
  const outH = Math.max(1, Math.round(crop.outH * raster))
  const canvas = createCanvas(outW, outH)
  const ctx = context2d(canvas)

  // Inside the rotated frame a quarter turn swaps which axis is which.
  const swapped = scene.crop.quarterTurns % 2 === 1
  const dw = swapped ? outH : outW
  const dh = swapped ? outW : outH

  ctx.save()
  ctx.translate(outW / 2, outH / 2)
  ctx.rotate((scene.crop.quarterTurns * Math.PI) / 2)
  ctx.scale(scene.crop.flipH ? -1 : 1, scene.crop.flipV ? -1 : 1)
  drawResampled(ctx, images.base, crop.sx, crop.sy, crop.sw, crop.sh, -dw / 2, -dh / 2, dw, dh)
  ctx.restore()

  if (scene.annotations.length) {
    drawAnnotations(ctx, scene.annotations, outW, outH, {
      image: canvas,
      sx: 0,
      sy: 0,
      sw: outW,
      sh: outH
    })
  }

  return canvas
}

/** Content plus optional window chrome, rounded corners and border. */
function buildFramedCanvas(
  scene: Scene,
  content: Surface
): { canvas: Surface; contentTop: number } {
  const { frame } = scene
  const chrome = chromeHeight(scene, content.width)
  const width = content.width
  const height = content.height + chrome
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)

  const unit = width / 1000
  const radius = frame.radius * unit * 1.35

  ctx.save()
  roundedRectPath(ctx, 0, 0, width, height, radius)
  ctx.clip()
  if (chrome > 0) paintChrome(ctx, scene, width, chrome)
  ctx.drawImage(content, 0, chrome)
  ctx.restore()

  if (frame.border.enabled && frame.border.width > 0) {
    const bw = frame.border.width * unit * 1.6
    ctx.save()
    ctx.strokeStyle = frame.border.color
    ctx.lineWidth = bw
    roundedRectPath(
      ctx,
      frame.border.inset ? bw / 2 : 0,
      frame.border.inset ? bw / 2 : 0,
      width - (frame.border.inset ? bw : 0),
      height - (frame.border.inset ? bw : 0),
      radius
    )
    ctx.stroke()
    ctx.restore()
  }

  return { canvas, contentTop: chrome }
}

/* -------------------------------- shadow --------------------------------- */

/** Flat-colour copy of the artwork's alpha, optionally at a reduced size. */
function silhouette(
  source: Surface,
  color: string,
  width = source.width,
  height = source.height
): Surface {
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

/* -------------------------------- measure -------------------------------- */

export interface SceneMetrics {
  naturalWidth: number
  naturalHeight: number
  contentWidth: number
  contentHeight: number
  framedWidth: number
  framedHeight: number
  chrome: number
}

/**
 * Computes the composition size without rasterising anything, so the preview
 * can pick a render scale in one pass.
 */
export function measureScene(scene: Scene, images: SceneImages): SceneMetrics {
  const crop = resolveCrop(scene.crop, images.baseWidth, images.baseHeight)
  const chrome = chromeHeight(scene, crop.outW)
  const framedWidth = crop.outW
  const framedHeight = crop.outH + chrome
  const { frame } = scene

  const quad = projectQuad(framedWidth * frame.scale, framedHeight * frame.scale, {
    tiltX: frame.tiltX,
    tiltY: frame.tiltY,
    rotate: frame.rotate,
    perspective: frame.perspective
  })
  const footprint = quadBounds(quad)
  const pad = scene.canvas.padding * Math.max(framedWidth, framedHeight)
  const reflect = frame.reflection > 0 ? footprint.height * frame.reflection * 0.55 : 0

  let naturalWidth = footprint.width + pad * 2
  let naturalHeight = footprint.height + pad * 2 + reflect

  const ratio = ratioValue(scene.canvas.ratio)
  if (ratio) {
    if (naturalWidth / naturalHeight < ratio) naturalWidth = naturalHeight * ratio
    else naturalHeight = naturalWidth / ratio
  }

  return {
    naturalWidth,
    naturalHeight,
    contentWidth: crop.outW,
    contentHeight: crop.outH,
    framedWidth,
    framedHeight,
    chrome
  }
}

/* -------------------------------- render --------------------------------- */

export function renderScene(
  scene: Scene,
  images: SceneImages,
  options: RenderOptions = {}
): RenderResult {
  const { frame } = scene

  // Geometry is measured in capture ("logical") units before anything is
  // rasterised, so the artwork raster can be sized to the pixels it will
  // actually occupy in the output.
  const crop = resolveCrop(scene.crop, images.baseWidth, images.baseHeight)
  const chrome = chromeHeight(scene, crop.outW)
  const logicalW = crop.outW
  const logicalH = crop.outH + chrome

  const baseQuad = projectQuad(logicalW * frame.scale, logicalH * frame.scale, {
    tiltX: frame.tiltX,
    tiltY: frame.tiltY,
    rotate: frame.rotate,
    perspective: frame.perspective
  })
  const footprint = quadBounds(baseQuad)

  // Padding is anchored to the artwork, not the projected footprint, so
  // tilting does not make the frame breathe.
  const pad = scene.canvas.padding * Math.max(logicalW, logicalH)
  const reflect = frame.reflection > 0 ? footprint.height * frame.reflection * 0.55 : 0

  let naturalW = footprint.width + pad * 2
  let naturalH = footprint.height + pad * 2 + reflect

  const ratio = ratioValue(scene.canvas.ratio)
  if (ratio) {
    if (naturalW / naturalH < ratio) naturalW = naturalH * ratio
    else naturalH = naturalW / ratio
  }

  const requested = options.scale ?? 1
  const maxEdge = options.maxEdge ?? 12000
  const fit = Math.min(1, maxEdge / (Math.max(naturalW, naturalH) * requested))
  const scale = requested * fit

  const width = Math.max(1, Math.round(naturalW * scale))
  const height = Math.max(1, Math.round(naturalH * scale))

  // The artwork ends up occupying frame.scale * scale of its capture size.
  // Rasterising it at exactly that resolution is what keeps chrome text,
  // borders, corner radii and annotations crisp in a 2x/3x/4x export, rather
  // than blowing a 1x bitmap up at the very end.
  const raster = rasterScaleFor(frame.scale * scale, logicalW, logicalH)
  const content = buildContentCanvas(scene, images, raster)
  const framed = buildFramedCanvas(scene, content)
  release(content)

  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const transparent = options.forceTransparent || scene.background.kind === 'transparent'
  if (!transparent) {
    paintBackground(ctx, scene, images, width, height, options.fast ?? false)
  }

  // Place the projected quad, honouring the artwork offsets. The nudge step is
  // anchored to the artwork so it still works when padding is zero.
  const nudge = Math.max(pad, Math.max(logicalW, logicalH) * 0.04)
  const cx = width / 2 + frame.offsetX * nudge * scale * 0.06
  const cy = (height - reflect * scale) / 2 + frame.offsetY * nudge * scale * 0.06
  const placed = translateQuad(
    baseQuad.map((p) => ({ x: p.x * scale, y: p.y * scale })) as Quad,
    cx,
    cy
  )
  const placedBounds = quadBounds(placed)

  // Stage the (possibly warped) artwork once, so shadow and reflection operate
  // on a single silhouette instead of dozens of triangles. The stage origin is
  // snapped to whole pixels: compositing it at a fractional offset resamples —
  // and visibly softens — the entire composition. Sub-pixel placement survives
  // inside the stage, carried by the quad itself.
  const stageX = Math.floor(placedBounds.x) - 2
  const stageY = Math.floor(placedBounds.y) - 2
  const stage = createCanvas(
    Math.ceil(placedBounds.x + placedBounds.width) - stageX + 2,
    Math.ceil(placedBounds.y + placedBounds.height) - stageY + 2
  )
  const sctx = context2d(stage)
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  const stageQuad = translateQuad(placed, -stageX, -stageY)
  drawImageQuad(
    sctx,
    framed.canvas,
    framed.canvas.width,
    framed.canvas.height,
    stageQuad,
    frame.tiltX === 0 && frame.tiltY === 0 ? 1 : 26
  )
  release(framed.canvas)

  if (frame.reflection > 0) {
    const mirror = createCanvas(stage.width, stage.height)
    const mctx = context2d(mirror)
    mctx.save()
    mctx.translate(0, stage.height)
    mctx.scale(1, -1)
    mctx.drawImage(stage, 0, 0)
    mctx.restore()
    const fade = mctx.createLinearGradient(0, 0, 0, stage.height)
    fade.addColorStop(0, `rgba(0,0,0,${clamp(frame.reflection, 0, 1)})`)
    fade.addColorStop(0.55, 'rgba(0,0,0,0)')
    mctx.globalCompositeOperation = 'destination-in'
    mctx.fillStyle = fade
    mctx.fillRect(0, 0, stage.width, stage.height)
    ctx.drawImage(mirror, stageX, stageY + stage.height * 0.995)
    release(mirror)
  }

  if (frame.shadow.enabled && frame.shadow.opacity > 0) {
    const unit = Math.max(width, height) / 1400
    const blur = frame.shadow.blur * unit
    const spread = frame.shadow.spread * unit
    const grow = spread === 0 ? 1 : 1 + (spread * 2) / Math.max(stage.width, stage.height)

    // Where the silhouette sits before the shadow is offset. Spread grows it
    // around its own centre, so the artwork stays put.
    const gx = stageX - (stage.width * (grow - 1)) / 2
    const gy = stageY - (stage.height * (grow - 1)) / 2
    const gw = stage.width * grow
    const gh = stage.height * grow

    // `shadowBlur` is twice the Gaussian sigma; `filter: blur()` is the sigma.
    const sigma = Math.max(0, blur) / 2

    // A shadow is a blurred silhouette, and at export resolution that blur is
    // hundreds of pixels across — a 4x export of a 1080p capture asks for a
    // 423px one. Nothing in the result survives at full resolution, so it is
    // built on a downsampled surface and scaled back up on the way out. The
    // output is indistinguishable and this stage stops dominating the render:
    // measured on a 9860x5652 export it fell from 4.6s to under 0.2s, and the
    // silhouette from 139MB to 3MB.
    const shrink = clamp(sigma / 16, 1, 8)
    const mw = Math.max(1, Math.round(stage.width / shrink))
    const mh = Math.max(1, Math.round(stage.height / shrink))
    const mini = silhouette(stage, frame.shadow.color, mw, mh)

    ctx.save()
    ctx.globalAlpha = clamp(frame.shadow.opacity, 0, 1)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const sx = gw / mw
    const sy = gh / mh
    const ox = frame.shadow.x * unit
    const oy = frame.shadow.y * unit

    if (sigma > 0) {
      // Margin so the blur can bleed past the silhouette instead of clipping.
      const margin = Math.ceil((sigma / shrink) * 3) + 2
      const soft = createCanvas(mw + margin * 2, mh + margin * 2)
      const softCtx = context2d(soft)
      softCtx.filter = `blur(${sigma / shrink}px)`
      softCtx.drawImage(mini, margin, margin)
      ctx.drawImage(
        soft,
        gx - margin * sx + ox,
        gy - margin * sy + oy,
        soft.width * sx,
        soft.height * sy
      )
      release(soft)
    } else {
      // A zero blur is still a shadow — a hard-edged one at the offset. There
      // is no blur to hide resampling here, so `shrink` is 1 and this is the
      // silhouette at full resolution.
      ctx.drawImage(mini, gx + ox, gy + oy, gw, gh)
    }

    // The unblurred, unoffset silhouette. The artwork covers it exactly unless
    // spread has pushed it out, which is precisely the spread rim — and that
    // rim has a hard edge, so it needs a sharper copy than the blur does.
    if (grow > 1) {
      const rim =
        shrink <= 2
          ? mini
          : silhouette(
              stage,
              frame.shadow.color,
              Math.max(1, Math.round(stage.width / 2)),
              Math.max(1, Math.round(stage.height / 2))
            )
      ctx.drawImage(rim, gx, gy, gw, gh)
      if (rim !== mini) release(rim)
    }

    ctx.restore()
    release(mini)
  }

  ctx.drawImage(stage, stageX, stageY)
  release(stage)

  if (scene.watermark.enabled) paintWatermark(ctx, scene.watermark, images, width, height)

  // Corners of the screenshot itself (excluding chrome) in canvas space.
  const m = unitSquareToQuad(placed)
  const topV = logicalH === 0 ? 0 : chrome / logicalH
  const contentQuad: Quad = [
    applyMatrix(m, 0, topV),
    applyMatrix(m, 1, topV),
    applyMatrix(m, 1, 1),
    applyMatrix(m, 0, 1)
  ]

  return {
    canvas,
    width,
    height,
    contentQuad,
    contentWidth: crop.outW,
    contentHeight: crop.outH,
    naturalWidth: naturalW,
    naturalHeight: naturalH
  }
}

function paintWatermark(
  ctx: CanvasRenderingContext2D,
  mark: Watermark,
  images: SceneImages,
  width: number,
  height: number
): void {
  const unit = Math.max(width, height) / 1000
  const margin = mark.margin * unit
  const size = mark.size * unit

  ctx.save()
  ctx.globalAlpha = clamp(mark.opacity, 0, 1)

  let w = 0
  let h = 0
  if (mark.imageSrc && images.watermark) {
    const img = images.watermark
    const { width: iw, height: ih } = sourceSize(img)
    h = size * 2
    w = h * (iw / ih)
  } else {
    ctx.font = `600 ${size}px 'Segoe UI Variable Text', 'Segoe UI', sans-serif`
    w = ctx.measureText(mark.text).width
    h = size
  }

  let x = margin
  let y = margin
  if (mark.position.includes('right')) x = width - w - margin
  if (mark.position.includes('bottom')) y = height - h - margin
  if (mark.position === 'bottom-center') x = (width - w) / 2

  if (mark.imageSrc && images.watermark) {
    ctx.drawImage(images.watermark, x, y, w, h)
  } else {
    ctx.fillStyle = mark.color
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 6 * unit
    ctx.fillText(mark.text, x, y)
  }

  ctx.restore()
}

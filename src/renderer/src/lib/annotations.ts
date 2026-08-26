import type {
  Annotation,
  AnnotationType,
  ArrowAnnotation,
  EffectAnnotation,
  PenAnnotation,
  Point,
  ShapeAnnotation,
  StepAnnotation,
  TextAnnotation
} from '@shared/types'
import { context2d, createCanvas, readableOn, toRgba, uid } from './utils'
import { distToSegment, roundedRectPath } from './geometry'

/** Keeps stroke weights visually identical across capture resolutions. */
export function unitScale(width: number, height: number): number {
  return Math.max(width, height) / 1400
}

export interface DrawBase {
  image: CanvasImageSource
  /** Source rect inside `image` that maps onto the full annotation canvas. */
  sx: number
  sy: number
  sw: number
  sh: number
}

/* ------------------------------- factories ------------------------------ */

const BASE = {
  opacity: 1,
  rotation: 0,
  locked: false,
  hidden: false
}

export function createAnnotation(
  type: AnnotationType,
  start: Point,
  color: string,
  nextStep = 1
): Annotation {
  const common = { id: uid('an-'), x: start.x, y: start.y, w: 0, h: 0, color, ...BASE }

  switch (type) {
    case 'arrow':
    case 'line':
      return {
        ...common,
        type,
        strokeWidth: 6,
        curve: type === 'arrow' ? 0.12 : 0,
        headSize: 3.4,
        dashed: false,
        heads: type === 'arrow' ? 'end' : 'none'
      } satisfies ArrowAnnotation

    case 'rect':
    case 'ellipse':
      return {
        ...common,
        type,
        strokeWidth: 6,
        fill: null,
        radius: type === 'rect' ? 10 : 0,
        dashed: false
      } satisfies ShapeAnnotation

    case 'pen':
      return {
        ...common,
        type,
        strokeWidth: 6,
        points: [{ x: start.x, y: start.y }],
        smooth: true
      } satisfies PenAnnotation

    case 'text':
      return {
        ...common,
        type,
        strokeWidth: 0,
        w: 0.28,
        h: 0.07,
        text: 'Double-click to edit',
        fontSize: 34,
        fontFamily: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
        fontWeight: 650,
        align: 'left',
        background: null,
        padding: 14,
        radius: 10,
        shadow: true
      } satisfies TextAnnotation

    case 'step':
      return {
        ...common,
        type,
        strokeWidth: 0,
        w: 0.055,
        h: 0.055,
        index: nextStep,
        fontSize: 34,
        textColor: readableOn(color)
      } satisfies StepAnnotation

    default:
      return {
        ...common,
        type,
        strokeWidth: 0,
        amount: type === 'pixelate' ? 14 : type === 'blur' ? 18 : 0.62,
        radius: 8,
        shape: 'rect'
      } satisfies EffectAnnotation
  }
}

/* -------------------------------- drawing ------------------------------- */

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  width: number,
  height: number,
  base: DrawBase
): void {
  const k = unitScale(width, height)
  for (const a of annotations) {
    if (a.hidden) continue
    ctx.save()
    ctx.globalAlpha = a.opacity
    try {
      drawOne(ctx, a, width, height, k, base)
    } catch {
      /* never let one malformed shape break the whole render */
    }
    ctx.restore()
  }
}

function px(a: Annotation, width: number, height: number): {
  x: number
  y: number
  w: number
  h: number
} {
  return { x: a.x * width, y: a.y * height, w: a.w * width, h: a.h * height }
}

/** Normalizes a possibly-negative box to positive width/height. */
function norm(box: { x: number; y: number; w: number; h: number }): {
  x: number
  y: number
  w: number
  h: number
} {
  return {
    x: box.w < 0 ? box.x + box.w : box.x,
    y: box.h < 0 ? box.y + box.h : box.y,
    w: Math.abs(box.w),
    h: Math.abs(box.h)
  }
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  a: Annotation,
  width: number,
  height: number,
  k: number,
  base: DrawBase
): void {
  switch (a.type) {
    case 'rect':
    case 'ellipse':
      return drawShape(ctx, a, width, height, k)
    case 'arrow':
    case 'line':
      return drawArrow(ctx, a, width, height, k)
    case 'pen':
      return drawPen(ctx, a, width, height, k)
    case 'text':
      return drawText(ctx, a, width, height, k)
    case 'step':
      return drawStep(ctx, a, width, height, k)
    case 'highlight':
      return drawHighlight(ctx, a, width, height)
    case 'spotlight':
      return drawSpotlight(ctx, a, width, height)
    case 'blur':
    case 'pixelate':
    case 'redact':
      return drawObscure(ctx, a, width, height, k, base)
  }
}

function shapePath(
  ctx: CanvasRenderingContext2D,
  type: 'rect' | 'ellipse',
  box: { x: number; y: number; w: number; h: number },
  radius: number
): void {
  if (type === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2)
  } else {
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, radius)
  }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  a: ShapeAnnotation,
  width: number,
  height: number,
  k: number
): void {
  const box = norm(px(a, width, height))
  const lw = a.strokeWidth * k
  shapePath(ctx, a.type, box, a.radius * k)

  if (a.fill) {
    ctx.fillStyle = a.fill
    ctx.fill()
  }
  if (lw > 0) {
    ctx.lineWidth = lw
    ctx.strokeStyle = a.color
    ctx.lineJoin = 'round'
    if (a.dashed) ctx.setLineDash([lw * 2.2, lw * 1.6])
    ctx.stroke()
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  a: ArrowAnnotation,
  width: number,
  height: number,
  k: number
): void {
  const from = { x: a.x * width, y: a.y * height }
  const to = { x: (a.x + a.w) * width, y: (a.y + a.h) * height }
  const lw = Math.max(1, a.strokeWidth * k)

  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const control = {
    x: mx + (-dy / len) * len * a.curve,
    y: my + (dx / len) * len * a.curve
  }

  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (a.dashed) ctx.setLineDash([lw * 2.2, lw * 1.8])

  const head = a.heads === 'none' ? 0 : lw * a.headSize
  // Stop the shaft short of the head so the tip stays crisp.
  const shaftEnd = shorten(from, control, to, head * 0.82)
  const shaftStart = a.heads === 'both' ? shorten(to, control, from, head * 0.82) : from

  ctx.beginPath()
  ctx.moveTo(shaftStart.x, shaftStart.y)
  ctx.quadraticCurveTo(control.x, control.y, shaftEnd.x, shaftEnd.y)
  ctx.stroke()
  ctx.setLineDash([])

  if (a.heads === 'end' || a.heads === 'both') arrowHead(ctx, control, to, head)
  if (a.heads === 'both') arrowHead(ctx, control, from, head)
}

function quadPoint(p0: Point, p1: Point, p2: Point, t: number): Point {
  const mt = 1 - t
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
  }
}

function shorten(from: Point, control: Point, to: Point, amount: number): Point {
  if (amount <= 0) return to
  // Walk back along the curve until we are `amount` away from the tip.
  for (let i = 1; i <= 40; i++) {
    const t = 1 - i / 40
    const p = quadPoint(from, control, to, t)
    if (Math.hypot(p.x - to.x, p.y - to.y) >= amount) return p
  }
  return to
}

function arrowHead(ctx: CanvasRenderingContext2D, control: Point, tip: Point, size: number): void {
  if (size <= 0) return
  const angle = Math.atan2(tip.y - control.y, tip.x - control.x)
  const spread = 0.44
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(tip.x - size * Math.cos(angle - spread), tip.y - size * Math.sin(angle - spread))
  ctx.lineTo(tip.x - size * 0.62 * Math.cos(angle), tip.y - size * 0.62 * Math.sin(angle))
  ctx.lineTo(tip.x - size * Math.cos(angle + spread), tip.y - size * Math.sin(angle + spread))
  ctx.closePath()
  ctx.fill()
}

function drawPen(
  ctx: CanvasRenderingContext2D,
  a: PenAnnotation,
  width: number,
  height: number,
  k: number
): void {
  if (a.points.length < 2) return
  const pts = a.points.map((p) => ({ x: p.x * width, y: p.y * height }))
  ctx.strokeStyle = a.color
  ctx.lineWidth = Math.max(1, a.strokeWidth * k)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  if (a.smooth) {
    for (let i = 1; i < pts.length - 1; i++) {
      const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y)
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
  } else {
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
}

export function measureText(
  ctx: CanvasRenderingContext2D,
  a: TextAnnotation,
  k: number
): { lines: string[]; lineHeight: number; width: number; height: number } {
  const size = a.fontSize * k
  ctx.font = `${a.fontWeight} ${size}px ${a.fontFamily}`
  const lines = a.text.split('\n')
  const lineHeight = size * 1.28
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width), 1)
  return { lines, lineHeight, width, height: lineHeight * lines.length }
}

function drawText(
  ctx: CanvasRenderingContext2D,
  a: TextAnnotation,
  width: number,
  height: number,
  k: number
): void {
  const x = a.x * width
  const y = a.y * height
  const { lines, lineHeight, width: textWidth, height: textHeight } = measureText(ctx, a, k)
  const pad = a.padding * k

  if (a.background) {
    ctx.fillStyle = a.background
    roundedRectPath(ctx, x - pad, y - pad, textWidth + pad * 2, textHeight + pad * 2, a.radius * k)
    ctx.fill()
  }

  if (a.shadow && !a.background) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 8 * k
    ctx.shadowOffsetY = 2 * k
  }

  ctx.fillStyle = a.color
  ctx.textBaseline = 'top'
  ctx.textAlign = a.align
  const anchor = a.align === 'left' ? x : a.align === 'center' ? x + textWidth / 2 : x + textWidth
  lines.forEach((line, i) => ctx.fillText(line, anchor, y + i * lineHeight))
}

function drawStep(
  ctx: CanvasRenderingContext2D,
  a: StepAnnotation,
  width: number,
  height: number,
  k: number
): void {
  const box = norm(px(a, width, height))
  const r = Math.max(box.w, box.h) / 2 || 24 * k
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2

  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 10 * k
  ctx.shadowOffsetY = 3 * k
  ctx.fillStyle = a.color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'

  ctx.fillStyle = a.textColor
  ctx.font = `700 ${r * 1.05}px ${"'Segoe UI Variable Display', 'Segoe UI', sans-serif"}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(a.index), cx, cy + r * 0.04)
}

function drawHighlight(
  ctx: CanvasRenderingContext2D,
  a: EffectAnnotation,
  width: number,
  height: number
): void {
  const box = norm(px(a, width, height))
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = toRgba(a.color, a.amount)
  shapePath(ctx, a.shape, box, a.radius)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
}

function drawSpotlight(
  ctx: CanvasRenderingContext2D,
  a: EffectAnnotation,
  width: number,
  height: number
): void {
  const box = norm(px(a, width, height))
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  if (a.shape === 'ellipse') {
    ctx.ellipse(
      box.x + box.w / 2,
      box.y + box.h / 2,
      box.w / 2,
      box.h / 2,
      0,
      0,
      Math.PI * 2,
      true
    )
  } else {
    // Reverse winding punches the hole out of the dimming rectangle.
    const r = Math.min(a.radius, Math.min(box.w, box.h) / 2)
    ctx.moveTo(box.x + box.w - r, box.y)
    ctx.arcTo(box.x, box.y, box.x, box.y + box.h, r)
    ctx.arcTo(box.x, box.y + box.h, box.x + box.w, box.y + box.h, r)
    ctx.arcTo(box.x + box.w, box.y + box.h, box.x + box.w, box.y, r)
    ctx.arcTo(box.x + box.w, box.y, box.x, box.y, r)
    ctx.closePath()
  }
  ctx.fillStyle = toRgba(a.color === '#ffffff' ? '#000000' : a.color, a.amount)
  ctx.fill('evenodd')
  ctx.restore()
}

function drawObscure(
  ctx: CanvasRenderingContext2D,
  a: EffectAnnotation,
  width: number,
  height: number,
  k: number,
  base: DrawBase
): void {
  const box = norm(px(a, width, height))
  if (box.w < 1 || box.h < 1) return

  ctx.save()
  shapePath(ctx, a.shape, box, a.radius * k)
  ctx.clip()

  if (a.type === 'redact') {
    ctx.fillStyle = a.color
    ctx.fillRect(box.x, box.y, box.w, box.h)
    if (a.label) {
      ctx.fillStyle = readableOn(a.color)
      const size = Math.min(box.h * 0.55, 20 * k)
      ctx.font = `600 ${size}px ${"'Segoe UI Variable Display', 'Segoe UI', sans-serif"}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.globalAlpha = 0.75
      ctx.fillText(a.label, box.x + box.w / 2, box.y + box.h / 2)
    }
  } else if (a.type === 'blur') {
    ctx.filter = `blur(${Math.max(1, a.amount * k)}px)`
    // Overdraw beyond the clip so the blur kernel has real pixels to chew on.
    ctx.drawImage(base.image, base.sx, base.sy, base.sw, base.sh, 0, 0, width, height)
    ctx.filter = 'none'
  } else {
    const cells = Math.max(2, Math.round(Math.max(box.w, box.h) / Math.max(2, a.amount * k)))
    const small = createCanvas(cells, Math.max(2, Math.round((box.h / box.w) * cells)))
    const sctx = context2d(small)
    sctx.imageSmoothingEnabled = true
    const rx = base.sx + (box.x / width) * base.sw
    const ry = base.sy + (box.y / height) * base.sh
    const rw = (box.w / width) * base.sw
    const rh = (box.h / height) * base.sh
    sctx.drawImage(base.image, rx, ry, rw, rh, 0, 0, small.width, small.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(small, box.x, box.y, box.w, box.h)
    ctx.imageSmoothingEnabled = true
  }

  ctx.restore()
}

/* ------------------------------ interaction ----------------------------- */

export type HandleId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'start'
  | 'end'
  | 'move'

export interface Handle {
  id: HandleId
  x: number
  y: number
  cursor: string
}

const CORNER_CURSORS: Record<string, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize'
}

export function handlesFor(a: Annotation): Handle[] {
  if (a.type === 'arrow' || a.type === 'line') {
    return [
      { id: 'start', x: a.x, y: a.y, cursor: 'crosshair' },
      { id: 'end', x: a.x + a.w, y: a.y + a.h, cursor: 'crosshair' }
    ]
  }
  const box = boundsOf(a)
  const midX = box.x + box.w / 2
  const midY = box.y + box.h / 2
  const right = box.x + box.w
  const bottom = box.y + box.h
  const ids: Array<[HandleId, number, number]> = [
    ['nw', box.x, box.y],
    ['n', midX, box.y],
    ['ne', right, box.y],
    ['e', right, midY],
    ['se', right, bottom],
    ['s', midX, bottom],
    ['sw', box.x, bottom],
    ['w', box.x, midY]
  ]
  const skipEdges = a.type === 'step'
  return ids
    .filter(([id]) => !skipEdges || id.length === 2)
    .map(([id, x, y]) => ({ id, x, y, cursor: CORNER_CURSORS[id] ?? 'move' }))
}

export function boundsOf(a: Annotation): { x: number; y: number; w: number; h: number } {
  if (a.type === 'pen') {
    const xs = a.points.map((p) => p.x)
    const ys = a.points.map((p) => p.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }
  return norm({ x: a.x, y: a.y, w: a.w, h: a.h })
}

/**
 * Hit-testing runs in normalized image space; `aspect` converts vertical
 * distances so tolerances feel even on non-square captures.
 */
export function hitTest(
  annotations: Annotation[],
  point: Point,
  tolerance: number,
  aspect: number
): Annotation | null {
  const scale = (p: Point): Point => ({ x: p.x, y: p.y * aspect })
  const target = scale(point)

  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]
    if (a.hidden || a.locked) continue

    if (a.type === 'arrow' || a.type === 'line') {
      const from = scale({ x: a.x, y: a.y })
      const to = scale({ x: a.x + a.w, y: a.y + a.h })
      if (distToSegment(target, from, to) <= tolerance * 1.6) return a
      continue
    }

    if (a.type === 'pen') {
      for (let p = 1; p < a.points.length; p++) {
        if (
          distToSegment(target, scale(a.points[p - 1]), scale(a.points[p])) <=
          tolerance * 1.6
        ) {
          return a
        }
      }
      continue
    }

    const box = boundsOf(a)
    const t = tolerance * 0.5
    if (
      point.x >= box.x - t &&
      point.x <= box.x + box.w + t &&
      point.y >= box.y - t / aspect &&
      point.y <= box.y + box.h + t / aspect
    ) {
      return a
    }
  }
  return null
}

export function nextStepIndex(annotations: Annotation[]): number {
  const steps = annotations.filter((a): a is StepAnnotation => a.type === 'step')
  return steps.length ? Math.max(...steps.map((s) => s.index)) + 1 : 1
}

export function isEffect(a: Annotation): a is EffectAnnotation {
  return (
    a.type === 'blur' ||
    a.type === 'pixelate' ||
    a.type === 'highlight' ||
    a.type === 'spotlight' ||
    a.type === 'redact'
  )
}

export const TOOL_LABELS: Record<AnnotationType, string> = {
  arrow: 'Arrow',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  pen: 'Draw',
  text: 'Text',
  step: 'Step',
  highlight: 'Highlight',
  blur: 'Blur',
  pixelate: 'Pixelate',
  spotlight: 'Spotlight',
  redact: 'Redact'
}

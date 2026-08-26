import type { Point } from '@shared/types'

/** Corner order is always TL, TR, BR, BL. */
export type Quad = [Point, Point, Point, Point]

/** Row-major 3x3 homography. */
export type Matrix3 = [number, number, number, number, number, number, number, number, number]

const rad = (deg: number): number => (deg * Math.PI) / 180

interface Vec3 {
  x: number
  y: number
  z: number
}

function rotX(p: Vec3, a: number): Vec3 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }
}

function rotY(p: Vec3, a: number): Vec3 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }
}

function rotZ(p: Vec3, a: number): Vec3 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z }
}

export interface ProjectOptions {
  tiltX: number
  tiltY: number
  rotate: number
  perspective: number
}

/**
 * Projects a w x h rectangle centred on the origin through the same pinhole
 * model CSS uses, so the exported bitmap matches what the preview shows.
 */
export function projectQuad(w: number, h: number, opts: ProjectOptions): Quad {
  const hw = w / 2
  const hh = h / 2
  const base: Vec3[] = [
    { x: -hw, y: -hh, z: 0 },
    { x: hw, y: -hh, z: 0 },
    { x: hw, y: hh, z: 0 },
    { x: -hw, y: hh, z: 0 }
  ]

  const ax = rad(opts.tiltX)
  const ay = rad(opts.tiltY)
  const az = rad(opts.rotate)
  // Perspective distance scales with the artwork so the effect reads the same
  // at any capture resolution.
  const d = Math.max(200, opts.perspective) * (Math.max(w, h) / 1000)

  const projected = base.map((p) => {
    let v = rotY(p, ay)
    v = rotX(v, ax)
    v = rotZ(v, az)
    const denom = Math.max(d - v.z, d * 0.15)
    const k = d / denom
    return { x: v.x * k, y: v.y * k }
  })

  return projected as Quad
}

export function isAxisAligned(q: Quad, epsilon = 0.01): boolean {
  return (
    Math.abs(q[0].y - q[1].y) < epsilon &&
    Math.abs(q[2].y - q[3].y) < epsilon &&
    Math.abs(q[0].x - q[3].x) < epsilon &&
    Math.abs(q[1].x - q[2].x) < epsilon
  )
}

export function quadBounds(q: Quad): { x: number; y: number; width: number; height: number } {
  const xs = q.map((p) => p.x)
  const ys = q.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

export function translateQuad(q: Quad, dx: number, dy: number): Quad {
  return q.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad
}

export function scaleQuad(q: Quad, s: number): Quad {
  return q.map((p) => ({ x: p.x * s, y: p.y * s })) as Quad
}

/**
 * Homography mapping the unit square (0,0)(1,0)(1,1)(0,1) onto `q`.
 * Standard projective-quad solution — degenerates to affine when the quad
 * is a parallelogram.
 */
export function unitSquareToQuad(q: Quad): Matrix3 {
  const [p0, p1, p2, p3] = q
  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const sx = p0.x - p1.x + p2.x - p3.x
  const sy = p0.y - p1.y + p2.y - p3.y

  const det = dx1 * dy2 - dx2 * dy1
  let g = 0
  let h = 0
  if (Math.abs(det) > 1e-9 && (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9)) {
    g = (sx * dy2 - dx2 * sy) / det
    h = (dx1 * sy - sx * dy1) / det
  }

  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1
  ]
}

export function applyMatrix(m: Matrix3, u: number, v: number): Point {
  const w = m[6] * u + m[7] * v + m[8]
  const safe = Math.abs(w) < 1e-9 ? 1e-9 : w
  return { x: (m[0] * u + m[1] * v + m[2]) / safe, y: (m[3] * u + m[4] * v + m[5]) / safe }
}

export function invertMatrix(m: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return null
  const inv = 1 / det
  return [
    A * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    C * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv
  ]
}

/**
 * Perspective-correct texture mapping onto a quad. The unit square is
 * subdivided and each cell drawn as two affinely-transformed triangles;
 * the destination points come from the exact homography, so the result
 * converges on true perspective rather than a bilinear approximation.
 */
export function drawImageQuad(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  quad: Quad,
  subdivisions = 24
): void {
  const m = unitSquareToQuad(quad)

  // A parallelogram (no tilt, any rotation) is exactly affine — draw it in one
  // pass instead of tessellating, which avoids diagonal seams entirely.
  if (Math.abs(m[6]) < 1e-9 && Math.abs(m[7]) < 1e-9) {
    ctx.save()
    ctx.transform(
      m[0] / imageWidth,
      m[3] / imageWidth,
      m[1] / imageHeight,
      m[4] / imageHeight,
      m[2],
      m[5]
    )
    ctx.drawImage(image, 0, 0)
    ctx.restore()
    return
  }

  const n = Math.max(2, subdivisions)

  // Cache the projected grid so each vertex is only solved once.
  const grid: Point[][] = []
  for (let row = 0; row <= n; row++) {
    const line: Point[] = []
    for (let col = 0; col <= n; col++) {
      line.push(applyMatrix(m, col / n, row / n))
    }
    grid.push(line)
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const u0 = (col / n) * imageWidth
      const u1 = ((col + 1) / n) * imageWidth
      const v0 = (row / n) * imageHeight
      const v1 = ((row + 1) / n) * imageHeight

      const a = grid[row][col]
      const b = grid[row][col + 1]
      const c = grid[row + 1][col + 1]
      const d = grid[row + 1][col]

      drawTriangle(ctx, image, u0, v0, u1, v0, u1, v1, a, b, c)
      drawTriangle(ctx, image, u0, v0, u1, v1, u0, v1, a, c, d)
    }
  }
}

/** Nudges a triangle outward from its centroid to hide sub-pixel seams. */
function expand(p: Point, cx: number, cy: number, amount: number): Point {
  const dx = p.x - cx
  const dy = p.y - cy
  const len = Math.hypot(dx, dy) || 1
  return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount }
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sx0: number,
  sy0: number,
  sx1: number,
  sy1: number,
  sx2: number,
  sy2: number,
  d0: Point,
  d1: Point,
  d2: Point
): void {
  const denom = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0)
  if (Math.abs(denom) < 1e-9) return

  const cx = (d0.x + d1.x + d2.x) / 3
  const cy = (d0.y + d1.y + d2.y) / 3
  const e0 = expand(d0, cx, cy, 0.6)
  const e1 = expand(d1, cx, cy, 0.6)
  const e2 = expand(d2, cx, cy, 0.6)

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(e0.x, e0.y)
  ctx.lineTo(e1.x, e1.y)
  ctx.lineTo(e2.x, e2.y)
  ctx.closePath()
  ctx.clip()

  const a = ((d1.x - d0.x) * (sy2 - sy0) - (d2.x - d0.x) * (sy1 - sy0)) / denom
  const b = ((d1.y - d0.y) * (sy2 - sy0) - (d2.y - d0.y) * (sy1 - sy0)) / denom
  const c = ((d2.x - d0.x) * (sx1 - sx0) - (d1.x - d0.x) * (sx2 - sx0)) / denom
  const d = ((d2.y - d0.y) * (sx1 - sx0) - (d1.y - d0.y) * (sx2 - sx0)) / denom

  ctx.transform(a, b, c, d, d0.x - a * sx0 - c * sy0, d0.y - b * sx0 - d * sy0)
  ctx.drawImage(image, 0, 0)
  ctx.restore()
}

export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  if ('roundRect' in ctx && typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, radius)
    return
  }
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

export function pointInQuad(p: Point, q: Quad): boolean {
  let inside = false
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = q[i]
    const b = q[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  if (l2 === 0) return dist(p, a)
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2
  t = Math.max(0, Math.min(1, t))
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
}

/**
 * Skirin's app icon, painted from scratch.
 *
 * There is no image library in this project and no source PSD — the icon is a
 * tiny renderer. Geometry comes from signed distance fields, which give exact
 * coverage for anti-aliasing at any size; depth comes from treating each SDF as
 * a height field, reading its gradient for a surface normal, and running a
 * small Blinn-Phong pass over it. That is what makes the shapes read as moulded
 * objects catching a single light rather than flat vector fills.
 *
 * The composition, back to front:
 *   1. an obsidian squircle body with a chamfered edge and a top rim light;
 *   2. four crop corners engraved into that body — visible on the desktop,
 *      dissolved into the surface by the time it is a 16px tray icon;
 *   3. a thick pane of glass floating above the body, bevelled at the edge so
 *      it refracts the key light, with a contact shadow underneath.
 */

/* -------------------------------- helpers -------------------------------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a, b, t) => a + (b - a) * t

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function mixRgb(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
}

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

/** Signed distance to a rounded rectangle: negative inside, zero on the edge. */
function sdRoundRect(px, py, cx, cy, half, radius) {
  const qx = Math.abs(px - cx) - (half - radius)
  const qy = Math.abs(py - cy) - (half - radius)
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  )
}

/**
 * The outward-pointing gradient of an SDF, by central differences. For a
 * height field this is the direction the surface tilts, which is all the
 * shading below needs.
 */
function sdGradient(sd, px, py, eps) {
  const gx = sd(px + eps, py) - sd(px - eps, py)
  const gy = sd(px, py + eps) - sd(px, py - eps)
  const len = Math.hypot(gx, gy)
  return len < 1e-9 ? [0, 0] : [gx / len, gy / len]
}

/**
 * How steeply a bevel tilts at distance `d` inside an edge: full tilt at the
 * edge itself, easing to flat `width` further in. Both ends are smooth, so the
 * chamfer meets the face without a crease.
 */
function bevel(d, width, slope) {
  return slope * (1 - smoothstep(0, 1, clamp01(-d / width)))
}

/* -------------------------------- lighting ------------------------------- */

/* One key light, high and a little to the left — the angle every physical
   product shot uses, and the reason the top edge is the bright one. */
const KEY = norm3(-0.3, -0.68, 0.67)
/* A dim cool bounce from below-right so the shadow side keeps some form. */
const FILL = norm3(0.55, 0.5, 0.66)
/* Halfway between the key and the viewer: the Blinn-Phong specular direction. */
const HALF = norm3(KEY[0], KEY[1], KEY[2] + 1)

function shade(n, base, m) {
  const key = Math.max(0, n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2])
  const fill = Math.max(0, n[0] * FILL[0] + n[1] * FILL[1] + n[2] * FILL[2])
  const spec = Math.pow(Math.max(0, n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2]), m.shine)
  /* Grazing angles go bright — the edge-lit look of anything glossy. */
  const fresnel = Math.pow(1 - clamp01(n[2]), 4)

  const lit = m.ambient + m.diffuse * key + m.fill * fill
  return [
    base[0] * lit + m.spec[0] * spec * m.specular + m.rim[0] * fresnel * m.rimStrength,
    base[1] * lit + m.spec[1] * spec * m.specular + m.rim[1] * fresnel * m.rimStrength,
    base[2] * lit + m.spec[2] * spec * m.specular + m.rim[2] * fresnel * m.rimStrength
  ]
}

/* -------------------------------- geometry ------------------------------- */

/* Everything is expressed in a unit square so the same numbers hold at 16px
   and at 1024px. The body fills it; the pane and the crop corners are sized
   off it. */
const BODY = { half: 0.5, radius: 0.2255, bevel: 0.052, slope: 2.05 }
/* Two optical sizes of the same drawing. Below about 40px there is no room
   for the engraved corners and the pane needs to grow into the space they
   leave, or the icon turns into a dark tile with a speck on it — the tray and
   the taskbar are where this thing is seen most. */
const PANE = { half: 0.238, radius: 0.101, bevel: 0.055, slope: 1.58 }
const PANE_SMALL = { half: 0.298, radius: 0.122, bevel: 0.062, slope: 1.5 }
/* How far the pane's far face sits behind its near one. Sweeping the pane
   along this vector and painting the difference is what gives the slab a
   visible side wall — the thing that separates an object from a sticker. */
const SLAB = { dx: 0.009, dy: 0.038 }
const CROP = { half: 0.356, radius: 0.058, stroke: 0.0165, wall: 0.014, gap: 0.198 }
/* How far the pane's shadow falls — it is floating, not printed on. */
const DROP = { offset: 0.03, blur: 0.085, strength: 0.55, contact: 0.024 }

const sdBody = (px, py) => sdRoundRect(px, py, 0.5, 0.5, BODY.half, BODY.radius)
/** The near face of the pane, and the whole slab: that face union its offset
    copy, which is the silhouette the side wall fills. */
const paneShapes = (pane) => {
  const sdPane = (px, py) => sdRoundRect(px, py, 0.5, 0.5, pane.half, pane.radius)
  const sdSlab = (px, py) => Math.min(sdPane(px, py), sdPane(px - SLAB.dx, py - SLAB.dy))
  return { sdPane, sdSlab }
}
/** The crop ring, as a stroke: distance to the outline of a rounded square. */
const sdCrop = (px, py) =>
  Math.abs(sdRoundRect(px, py, 0.5, 0.5, CROP.half, CROP.radius)) - CROP.stroke

/* -------------------------------- palettes ------------------------------- */

/* Linear-ish sRGB in 0..1. The body is deliberately near-monochrome: the only
   colour in the icon is the glass, which is what a single accent buys you —
   the mark stays legible when Windows renders it 16px tall on a dark taskbar,
   and it never reads as a gradient sticker. */
export const PALETTES = {
  /** Machined graphite with a pane of glacier-blue glass. The shipped one. */
  obsidian: {
    label: 'Obsidian',
    bodyTop: [0.196, 0.216, 0.243],
    bodyBottom: [0.043, 0.051, 0.063],
    bodySheen: [0.42, 0.47, 0.55],
    glassTop: [0.04, 0.19, 0.44],
    glassMid: [0.16, 0.53, 0.87],
    glassBottom: [0.68, 0.9, 1.0],
    glassRim: [0.9, 0.97, 1.0],
    wallDeep: [0.027, 0.098, 0.216],
    wallLit: [0.2, 0.51, 0.78]
  },
  /** Deep petrol body, pale aqua glass — cooler, more saturated. */
  petrol: {
    label: 'Petrol',
    bodyTop: [0.09, 0.24, 0.29],
    bodyBottom: [0.02, 0.078, 0.11],
    bodySheen: [0.28, 0.55, 0.6],
    glassTop: [0.02, 0.16, 0.22],
    glassMid: [0.11, 0.6, 0.66],
    glassBottom: [0.66, 0.95, 0.96],
    glassRim: [0.9, 1.0, 1.0],
    wallDeep: [0.02, 0.09, 0.12],
    wallLit: [0.14, 0.53, 0.58]
  },
  /** Warm graphite and champagne — the same icon in a different metal. */
  champagne: {
    label: 'Champagne',
    bodyTop: [0.216, 0.204, 0.184],
    bodyBottom: [0.059, 0.051, 0.043],
    bodySheen: [0.5, 0.46, 0.4],
    glassTop: [0.28, 0.16, 0.04],
    glassMid: [0.85, 0.6, 0.2],
    glassBottom: [1.0, 0.93, 0.78],
    glassRim: [1.0, 0.96, 0.87],
    wallDeep: [0.13, 0.075, 0.02],
    wallLit: [0.72, 0.5, 0.19]
  }
}

const BODY_MATERIAL = {
  ambient: 0.6,
  diffuse: 0.62,
  fill: 0.14,
  specular: 0.4,
  shine: 34,
  spec: [1, 1, 1],
  rimStrength: 0.26,
  rim: [0.72, 0.8, 0.92]
}

const GLASS_MATERIAL = {
  ambient: 0.68,
  diffuse: 0.5,
  fill: 0.2,
  specular: 1.15,
  shine: 96,
  spec: [1, 1, 1],
  rimStrength: 0.5,
  rim: [1, 1, 1]
}

/* --------------------------------- paint --------------------------------- */

export function render(size, paletteKey = 'obsidian') {
  const pal = PALETTES[paletteKey]
  if (!pal) throw new Error(`unknown palette: ${paletteKey}`)

  /* Supersample, then box-filter down. Cheaper than being clever, and the
     small sizes are where an icon lives or dies. */
  const small = size <= 40
  const pane = small ? PANE_SMALL : PANE
  const { sdPane, sdSlab } = paneShapes(pane)

  const ss = size > 256 ? 3 : 4
  const dim = size * ss
  const aa = 1 / dim
  const eps = aa * 0.75
  const acc = new Float32Array(size * size * 4)

  for (let y = 0; y < dim; y++) {
    const py = (y + 0.5) / dim
    for (let x = 0; x < dim; x++) {
      const px = (x + 0.5) / dim

      const dBody = sdBody(px, py)
      if (dBody > aa) continue
      const bodyAlpha = clamp01(0.5 - dBody / aa)

      /* --- body: chamfered edge, vertical ramp, sheen from the key light --- */
      const bodyGrad = sdGradient(sdBody, px, py, eps)
      const bodyTilt = bevel(dBody, BODY.bevel, BODY.slope)
      let nx = bodyGrad[0] * bodyTilt
      let ny = bodyGrad[1] * bodyTilt

      let base = mixRgb(pal.bodyTop, pal.bodyBottom, smoothstep(0.02, 0.94, py))
      const sheen = Math.max(0, 1 - Math.hypot(px - 0.26, py - 0.16) / 0.92)
      base = mixRgb(base, pal.bodySheen, sheen * sheen * 0.22)
      /* ...and a matching fall-off into the far corner, so the face is never
         a flat fill even where nothing sits on top of it. */
      const vignette = 1 - 0.22 * smoothstep(0.35, 1.05, Math.hypot(px - 0.3, py - 0.24))
      base = [base[0] * vignette, base[1] * vignette, base[2] * vignette]

      /* --- crop corners, engraved: the walls tilt in, the trough is dark --- */
      const dCrop = small ? 1 : sdCrop(px, py)
      if (dCrop < CROP.wall) {
        /* Erase the middle of each side, so a ring becomes four brackets. */
        const corner = Math.min(Math.abs(px - 0.5), Math.abs(py - 0.5)) - CROP.gap
        const inCorner = smoothstep(0, 0.018, corner)
        if (inCorner > 0) {
          const wall = (1 - smoothstep(0, CROP.wall, Math.abs(dCrop))) * inCorner
          const cropGrad = sdGradient(sdCrop, px, py, eps)
          /* Negative slope: the surface falls away into the groove. */
          nx -= cropGrad[0] * wall * 1.55
          ny -= cropGrad[1] * wall * 1.55
          const inside = (1 - smoothstep(-CROP.wall, CROP.stroke * 0.6, dCrop)) * inCorner
          const shadowed = 1 - 0.42 * inside
          base = [base[0] * shadowed, base[1] * shadowed, base[2] * shadowed]
        }
      }

      /* --- the pane's shadow and the tight contact occlusion under it --- */
      const dDrop = sdSlab(px, py - DROP.offset)
      const drop = (1 - smoothstep(-DROP.blur * 0.35, DROP.blur, dDrop)) * DROP.strength
      const dPaneOut = sdPane(px, py)
      const dSlab = sdSlab(px, py)
      const contact = (1 - smoothstep(0, DROP.contact, dSlab)) * 0.35
      const occ = 1 - clamp01(drop + contact)
      base = [base[0] * occ, base[1] * occ, base[2] * occ]

      let color = shade(norm3(nx, ny, 1), base, BODY_MATERIAL)

      /* A hairline of light where the top of the squircle turns away. */
      const rim =
        (1 - smoothstep(0, BODY.bevel * 0.6, -dBody)) * Math.max(0, -bodyGrad[1]) * 0.5
      color = [color[0] + rim * 0.5, color[1] + rim * 0.55, color[2] + rim * 0.62]

      /* --- the slab's side wall, seen because the pane is lifted off the
             body: darkest where it meets the near face, warming towards the
             bottom edge where light bounces back up off the body --- */
      const slabAlpha = clamp01(0.5 - dSlab / aa)
      if (slabAlpha > 0) {
        const depth = clamp01(dPaneOut / Math.hypot(SLAB.dx, SLAB.dy))
        let wall = mixRgb(pal.wallDeep, pal.wallLit, smoothstep(0.3, 1, depth))
        const seat = 0.72 + 0.28 * smoothstep(0, 0.55, depth)
        wall = [wall[0] * seat, wall[1] * seat, wall[2] * seat]
        color = mixRgb(color, wall, slabAlpha)
      }

      /* --- the near face of the glass --- */
      const paneAlpha = clamp01(0.5 - dPaneOut / aa)
      if (paneAlpha > 0) {
        const paneGrad = sdGradient(sdPane, px, py, eps)
        const paneTilt = bevel(dPaneOut, pane.bevel, pane.slope)
        const pn = norm3(paneGrad[0] * paneTilt, paneGrad[1] * paneTilt, 1)

        /* A diagonal ramp through three stops, deep at the top and bright at
           the bottom: looking through the near face of the slab you see into
           shadow, while the light that made it through collects against the
           far face. Thick glass reads dark where it is thin on light. */
        const t = clamp01((px - 0.5) * 0.62 + (py - 0.5) * 1.28 + 0.5)
        let glass =
          t < 0.5
            ? mixRgb(pal.glassTop, pal.glassMid, smoothstep(0, 0.5, t))
            : mixRgb(pal.glassMid, pal.glassBottom, smoothstep(0.5, 1, t))

        /* A wide, soft sweep across the upper half — polish, not a glare. */
        const sweep = 1 - smoothstep(0, 0.2, Math.abs((px - 0.5) * 0.5 + (py - 0.5) + 0.13))
        glass = mixRgb(glass, [1, 1, 1], sweep * 0.06)

        const glassMaterial = { ...GLASS_MATERIAL, rim: pal.glassRim }

        /* The pane is not a coloured rectangle, it is a slab you can see into.
           Shade the glass, then blend it over the body underneath: sheer at
           the top, where you are looking through into shadow, and denser at
           the bottom, where the light that made it through the slab pools.
           That transmitted body is what keeps it from reading as candy. */
        let paneColor = mixRgb(color, shade(pn, glass, glassMaterial), mix(0.84, 1, t))

        /* The chamfer is where glass announces itself. The top of it takes the
           key light almost square on; the bottom of it glows from light that
           went through the slab and bounced off the body; the sides sit in
           between. Together they draw a bright wire around the pane, which is
           what reads as thickness rather than as a coloured rectangle.
           Reflections sit on the surface, so they go on after the blend. */
        const edge = 1 - smoothstep(0, pane.bevel, -dPaneOut)
        const up = Math.max(0, -paneGrad[1])
        const down = Math.max(0, paneGrad[1])
        const side = Math.max(0, Math.abs(paneGrad[0]) - 0.4)
        const wire = edge * (0.6 * up + 0.32 * down + 0.14 * side)
        paneColor = [
          paneColor[0] + wire * 0.72,
          paneColor[1] + wire * 0.8,
          paneColor[2] + wire * 0.86
        ]

        /* Just inside the top chamfer, a thin band of shade: the far wall of
           the glass seen through the near one. */
        const throat =
          smoothstep(0, pane.bevel * 0.8, -dPaneOut) *
          (1 - smoothstep(pane.bevel * 0.8, pane.bevel * 2.6, -dPaneOut)) *
          up
        const throatDim = 1 - 0.2 * throat
        paneColor = [paneColor[0] * throatDim, paneColor[1] * throatDim, paneColor[2] * throatDim]

        /* One soft specular pool, off-centre, where a dome would catch the
           room — the difference between polished and matte. */
        const pool = 1 - smoothstep(0.02, 0.21, Math.hypot((px - 0.4) * 1.1, (py - 0.38) * 0.95))
        paneColor = [
          paneColor[0] + pool * 0.12,
          paneColor[1] + pool * 0.12,
          paneColor[2] + pool * 0.11
        ]

        color = mixRgb(color, paneColor, paneAlpha)
      }

      const i = (Math.floor(y / ss) * size + Math.floor(x / ss)) * 4
      acc[i] += clamp01(color[0]) * bodyAlpha
      acc[i + 1] += clamp01(color[1]) * bodyAlpha
      acc[i + 2] += clamp01(color[2]) * bodyAlpha
      acc[i + 3] += bodyAlpha
    }
  }

  const samples = ss * ss
  const out = Buffer.alloc(size * size * 4)
  for (let p = 0; p < size * size; p++) {
    const i = p * 4
    const alpha = acc[i + 3] / samples
    out[i + 3] = Math.round(clamp01(alpha) * 255)
    if (alpha > 0) {
      /* Un-premultiply: the accumulator holds colour weighted by coverage. */
      out[i] = Math.round(clamp01(acc[i] / samples / alpha) * 255)
      out[i + 1] = Math.round(clamp01(acc[i + 1] / samples / alpha) * 255)
      out[i + 2] = Math.round(clamp01(acc[i + 2] / samples / alpha) * 255)
    }
  }
  return out
}

/* ---------------------------------- png ---------------------------------- */

import { deflateSync } from 'node:zlib'

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

export function encodePng(rgba, size) {
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

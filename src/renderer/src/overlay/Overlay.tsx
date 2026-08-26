import * as React from 'react'
import type { OverlayInit, Rect } from '@shared/types'
import { clamp } from '@/lib/utils'

interface Selection {
  x: number
  y: number
  w: number
  h: number
}

const LOUPE = 132
const LOUPE_ZOOM = 8

/**
 * The area-selection overlay, one instance per monitor.
 *
 * Coordinates come in from the backend as physical pixels in virtual-desktop
 * space, and everything the DOM deals with is CSS pixels local to this
 * monitor. `toLocal` and `toScreen` are the only two places that conversion
 * happens; keeping it at the edges is what makes a mixed-DPI setup behave,
 * where the Electron build had to guess at a shared DIP space.
 */
export function Overlay(): React.JSX.Element | null {
  const [init, setInit] = React.useState<OverlayInit | null>(null)
  const [image, setImage] = React.useState<HTMLImageElement | null>(null)
  const [pointer, setPointer] = React.useState({ x: -9999, y: -9999 })
  const [inside, setInside] = React.useState(false)
  const [selection, setSelection] = React.useState<Selection | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [hovered, setHovered] = React.useState<Selection | null>(null)
  const [colorLocked, setColorLocked] = React.useState<string | null>(null)

  const originRef = React.useRef<{ x: number; y: number } | null>(null)
  const loupeRef = React.useRef<HTMLCanvasElement>(null)
  const movedRef = React.useRef(false)

  /* ------------------------------ bootstrap ----------------------------- */

  React.useEffect(() => {
    let cancelled = false

    // Pulled, not pushed: the backend keeps this window's payload keyed by its
    // label, so there is no race with the listener being attached.
    void window.skirin.overlay.init().then((payload) => {
      if (cancelled || !payload) return
      setInit(payload)

      const img = new Image()
      img.crossOrigin = 'anonymous'
      // Only reveal the window once the frozen frame has decoded, or it
      // flashes an empty transparent pane over the desktop first.
      img.onload = () => {
        setImage(img)
        window.skirin.overlay.ready()
      }
      img.onerror = () => window.skirin.overlay.ready()
      img.src = payload.src
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Another monitor took over the pointer — drop our local highlight.
  React.useEffect(
    () =>
      window.skirin.overlay.onCursor(() => {
        setInside(false)
        setHovered(null)
      }),
    []
  )

  /* ------------------------------ geometry ------------------------------ */

  /** This monitor in CSS pixels. */
  const size = React.useMemo(() => {
    if (!init) return { width: 0, height: 0 }
    return {
      width: init.bounds.width / init.scaleFactor,
      height: init.bounds.height / init.scaleFactor
    }
  }, [init])

  const toLocal = React.useCallback(
    (rect: Rect): Selection | null => {
      if (!init) return null
      return {
        x: (rect.x - init.bounds.x) / init.scaleFactor,
        y: (rect.y - init.bounds.y) / init.scaleFactor,
        w: rect.width / init.scaleFactor,
        h: rect.height / init.scaleFactor
      }
    },
    [init]
  )

  const toScreen = React.useCallback(
    (rect: Selection): Rect | null => {
      if (!init) return null
      return {
        x: Math.round(init.bounds.x + rect.x * init.scaleFactor),
        y: Math.round(init.bounds.y + rect.y * init.scaleFactor),
        width: Math.max(1, Math.round(rect.w * init.scaleFactor)),
        height: Math.max(1, Math.round(rect.h * init.scaleFactor))
      }
    },
    [init]
  )

  const localWindows = React.useMemo(() => {
    if (!init) return []
    return init.windows
      .map(toLocal)
      .filter((r): r is Selection => !!r && r.w > 40 && r.h > 40)
  }, [init, toLocal])

  const windowUnder = React.useCallback(
    (x: number, y: number): Selection | null => {
      // The list is z-ordered front-to-back, so the first hit is the top window.
      for (const r of localWindows) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r
      }
      return null
    },
    [localWindows]
  )

  const commit = React.useCallback(
    (rect: Selection, label: string) => {
      if (!init) return
      if (rect.w < 3 || rect.h < 3) {
        window.skirin.overlay.cancel()
        return
      }
      // Clamped to this monitor: a drag that overshoots an edge should stop at
      // it rather than crop out of the neighbouring screen's frame.
      const clamped: Selection = {
        x: clamp(rect.x, 0, size.width),
        y: clamp(rect.y, 0, size.height),
        w: Math.min(rect.w, size.width - clamp(rect.x, 0, size.width)),
        h: Math.min(rect.h, size.height - clamp(rect.y, 0, size.height))
      }
      const screen = toScreen(clamped)
      if (screen) window.skirin.overlay.confirm(screen, label)
    },
    [init, size, toScreen]
  )

  /* ------------------------------- pointer ------------------------------ */

  React.useEffect(() => {
    if (!init) return

    const onMove = (event: PointerEvent): void => {
      const p = { x: event.clientX, y: event.clientY }
      setPointer(p)
      setInside(true)
      window.skirin.overlay.broadcastCursor({
        x: init.bounds.x + p.x * init.scaleFactor,
        y: init.bounds.y + p.y * init.scaleFactor
      })

      const origin = originRef.current
      if (origin) {
        movedRef.current =
          movedRef.current || Math.abs(p.x - origin.x) > 3 || Math.abs(p.y - origin.y) > 3
        setSelection({
          x: Math.min(origin.x, p.x),
          y: Math.min(origin.y, p.y),
          w: Math.abs(p.x - origin.x),
          h: Math.abs(p.y - origin.y)
        })
      } else {
        setHovered(windowUnder(p.x, p.y))
      }
    }

    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      originRef.current = { x: event.clientX, y: event.clientY }
      movedRef.current = false
      setDragging(true)
      setSelection({ x: event.clientX, y: event.clientY, w: 0, h: 0 })
    }

    const onUp = (): void => {
      const origin = originRef.current
      originRef.current = null
      setDragging(false)
      if (!origin) return

      if (!movedRef.current) {
        // A plain click grabs the window beneath the cursor.
        const target = windowUnder(origin.x, origin.y)
        if (target) {
          commit(target, 'Window')
          return
        }
        setSelection(null)
        return
      }

      setSelection((current) => {
        if (current) commit(current, 'Selection')
        return current
      })
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        window.skirin.overlay.cancel()
        return
      }
      if (event.key === 'Enter') {
        if (selection && selection.w > 3) commit(selection, 'Selection')
        else if (hovered) commit(hovered, 'Window')
        return
      }
      if (event.key.toLowerCase() === 'f') {
        commit({ x: 0, y: 0, w: size.width, h: size.height }, 'Display')
        return
      }
      if (event.key.toLowerCase() === 'r' && init.lastRegion) {
        const local = toLocal(init.lastRegion)
        if (local) commit(local, 'Last region')
        return
      }
      if (event.key.toLowerCase() === 'c') {
        const hex = sampleColor(image, size.width, pointer)
        if (hex) {
          setColorLocked(hex)
          void navigator.clipboard.writeText(hex).catch(() => undefined)
        }
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [init, image, windowUnder, commit, selection, hovered, pointer, size, toLocal])

  /* -------------------------------- loupe ------------------------------- */

  React.useEffect(() => {
    const canvas = loupeRef.current
    if (!canvas || !image || !init || !init.magnifier || !inside) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = LOUPE * dpr
    canvas.height = LOUPE * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false

    const scale = image.naturalWidth / size.width
    const span = LOUPE / LOUPE_ZOOM
    const sx = pointer.x * scale - (span * scale) / 2
    const sy = pointer.y * scale - (span * scale) / 2

    ctx.fillStyle = '#0b0b0f'
    ctx.fillRect(0, 0, LOUPE, LOUPE)
    ctx.drawImage(image, sx, sy, span * scale, span * scale, 0, 0, LOUPE, LOUPE)

    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 1
    for (let i = 0; i <= LOUPE; i += LOUPE_ZOOM) {
      ctx.beginPath()
      ctx.moveTo(i + 0.5, 0)
      ctx.lineTo(i + 0.5, LOUPE)
      ctx.moveTo(0, i + 0.5)
      ctx.lineTo(LOUPE, i + 0.5)
      ctx.stroke()
    }

    ctx.strokeStyle = '#7c6cff'
    ctx.lineWidth = 1.5
    ctx.strokeRect(
      LOUPE / 2 - LOUPE_ZOOM / 2,
      LOUPE / 2 - LOUPE_ZOOM / 2,
      LOUPE_ZOOM,
      LOUPE_ZOOM
    )
  }, [image, init, pointer, inside, size])

  if (!init) return null

  const hex = colorLocked ?? sampleColor(image, size.width, pointer) ?? '#000000'
  const highlight = selection && (dragging || selection.w > 3) ? selection : hovered

  const loupePlacement = {
    left: clamp(pointer.x + 22, 8, size.width - LOUPE - 8),
    top: clamp(pointer.y + 22, 8, size.height - LOUPE - 62)
  }

  return (
    <div className="fixed inset-0 select-none overflow-hidden">
      <img
        src={init.src}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-fill"
      />

      {/* Dimming, with the live selection punched out. */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <mask id="hole">
            <rect width="100%" height="100%" fill="white" />
            {highlight && (
              <rect
                x={highlight.x}
                y={highlight.y}
                width={highlight.w}
                height={highlight.h}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(8,8,12,0.48)" mask="url(#hole)" />
      </svg>

      {highlight && (
        <div
          className="pointer-events-none absolute border border-white/90"
          style={{
            left: highlight.x,
            top: highlight.y,
            width: highlight.w,
            height: highlight.h,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.45), 0 0 34px rgba(124,108,255,0.35)'
          }}
        >
          {[
            'left-0 top-0',
            'right-0 top-0',
            'left-0 bottom-0',
            'right-0 bottom-0'
          ].map((position) => (
            <span
              key={position}
              className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ${position}`}
              style={{ transform: 'translate(-50%, -50%)' }}
            />
          ))}
        </div>
      )}

      {/* Crosshair guides. */}
      {inside && !highlight && (
        <>
          <div
            className="pointer-events-none absolute left-0 h-px w-full bg-white/35"
            style={{ top: pointer.y }}
          />
          <div
            className="pointer-events-none absolute top-0 h-full w-px bg-white/35"
            style={{ left: pointer.x }}
          />
        </>
      )}

      {highlight && (
        <div
          className="pointer-events-none absolute rounded-md bg-black/78 px-2 py-1 font-mono text-[11px] tabular-nums text-white shadow-lg backdrop-blur-sm"
          style={{
            left: clamp(highlight.x, 6, size.width - 120),
            top: highlight.y > 30 ? highlight.y - 26 : highlight.y + highlight.h + 8
          }}
        >
          {/* Reported in real pixels, which is what the exported file will be. */}
          {Math.round(highlight.w * init.scaleFactor)} ×{' '}
          {Math.round(highlight.h * init.scaleFactor)}
        </div>
      )}

      {inside && init.magnifier && (
        <div
          className="pointer-events-none absolute overflow-hidden rounded-xl border border-white/25 bg-black/80 shadow-2xl backdrop-blur-md"
          style={loupePlacement}
        >
          <canvas
            ref={loupeRef}
            style={{ width: LOUPE, height: LOUPE }}
            className="block"
          />
          <div className="flex items-center gap-2 border-t border-white/15 px-2 py-1.5">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded border border-white/30"
              style={{ background: hex }}
            />
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-white/85">
              {hex}
            </span>
          </div>
          <div className="border-t border-white/15 px-2 py-1 font-mono text-[9.5px] text-white/45">
            {Math.round(pointer.x * init.scaleFactor)},{' '}
            {Math.round(pointer.y * init.scaleFactor)}
          </div>
        </div>
      )}

      {!dragging && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-xl border border-white/12 bg-black/72 px-3.5 py-2 text-[11.5px] text-white/80 shadow-2xl backdrop-blur-xl">
          <span className="text-white">Drag</span> to select ·{' '}
          <span className="text-white">Click</span> a window ·{' '}
          <Key>F</Key> full screen · <Key>R</Key> last region · <Key>C</Key> copy color ·{' '}
          <Key>Esc</Key> cancel
        </div>
      )}
    </div>
  )
}

function Key({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded border border-white/20 bg-white/10 px-1 py-px font-mono text-[10px] text-white">
      {children}
    </kbd>
  )
}

let sampler: CanvasRenderingContext2D | null = null

/**
 * Reads one pixel out of the frozen frame. The frame is served cross-origin
 * from `skirin://`, so the image is loaded with `crossOrigin` set — without it
 * this canvas is tainted and `getImageData` throws.
 */
function sampleColor(
  image: HTMLImageElement | null,
  cssWidth: number,
  point: { x: number; y: number }
): string | null {
  if (!image || point.x < 0 || cssWidth <= 0) return null
  if (!sampler) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    sampler = canvas.getContext('2d', { willReadFrequently: true })
  }
  if (!sampler) return null
  const scale = image.naturalWidth / cssWidth
  try {
    sampler.clearRect(0, 0, 1, 1)
    sampler.drawImage(image, point.x * scale, point.y * scale, 1, 1, 0, 0, 1, 1)
    const [r, g, b] = sampler.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
  } catch {
    return null
  }
}

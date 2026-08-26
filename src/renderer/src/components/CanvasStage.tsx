import * as React from 'react'
import type { Annotation, AnnotationType, Point, TextAnnotation } from '@shared/types'
import { measureScene, renderScene } from '@/lib/render'
import type { RenderResult } from '@/lib/render'
import { applyMatrix, invertMatrix, unitSquareToQuad } from '@/lib/geometry'
import type { Quad } from '@/lib/geometry'
import { boundsOf, handlesFor, hitTest, unitScale } from '@/lib/annotations'
import type { Handle, HandleId } from '@/lib/annotations'
import { useEditor } from '@/store/editor'
import { clamp, context2d } from '@/lib/utils'

const MAX_PREVIEW_PIXELS = 4_200_000

type Gesture =
  | { kind: 'none' }
  | { kind: 'create'; id: string; origin: Point }
  | { kind: 'move'; id: string; grab: Point; start: Annotation }
  | { kind: 'resize'; id: string; handle: HandleId; start: Annotation }
  | { kind: 'pen'; id: string }
  | { kind: 'crop'; handle: HandleId | 'new'; origin: Point; start: { x: number; y: number; w: number; h: number } }
  | { kind: 'pan'; origin: { x: number; y: number }; scroll: { x: number; y: number } }

export function CanvasStage(): React.JSX.Element {
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const overlayRef = React.useRef<HTMLCanvasElement>(null)

  const scene = useEditor((s) => s.scene)
  const images = useEditor((s) => s.images)
  const capture = useEditor((s) => s.capture)
  const tool = useEditor((s) => s.tool)
  const selectedId = useEditor((s) => s.selectedId)
  const editingTextId = useEditor((s) => s.editingTextId)
  const zoom = useEditor((s) => s.zoom)
  const showGrid = useEditor((s) => s.showGrid)

  const [box, setBox] = React.useState({ width: 0, height: 0 })
  const [cssSize, setCssSize] = React.useState({ width: 0, height: 0 })
  const renderRef = React.useRef<RenderResult | null>(null)
  const gestureRef = React.useRef<Gesture>({ kind: 'none' })
  const [cursor, setCursor] = React.useState('default')
  const rafRef = React.useRef(0)

  const cropping = tool === 'crop'

  /* ----------------------------- measure box ----------------------------- */

  React.useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /* ------------------------------- rendering ----------------------------- */

  // While cropping we present the untouched capture so the handles map 1:1.
  const effectiveScene = React.useMemo(() => {
    if (!cropping) return scene
    return {
      ...scene,
      crop: { ...scene.crop, x: 0, y: 0, w: 1, h: 1 },
      canvas: { ...scene.canvas, ratio: 'auto' as const, padding: 0.02 },
      frame: {
        ...scene.frame,
        radius: 0,
        rotate: 0,
        tiltX: 0,
        tiltY: 0,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        reflection: 0,
        shadow: { ...scene.frame.shadow, enabled: false },
        browser: { ...scene.frame.browser, style: 'none' as const }
      },
      background: { ...scene.background, kind: 'solid' as const, solid: '#0a0a0c' }
    }
  }, [scene, cropping])

  const draw = React.useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !images.base || !capture) return

    const bundle = {
      base: images.base,
      baseWidth: capture.width,
      baseHeight: capture.height,
      background: images.background,
      watermark: images.watermark
    }

    const metrics = measureScene(effectiveScene, bundle)
    const available = {
      width: Math.max(120, box.width - 72),
      height: Math.max(120, box.height - 72)
    }
    const fit = Math.min(
      available.width / metrics.naturalWidth,
      available.height / metrics.naturalHeight
    )
    const cssScale = zoom === 'fit' ? Math.min(fit, 1.4) : zoom
    const dpr = window.devicePixelRatio || 1

    // Keep preview rasters inside a sane pixel budget.
    let renderScale = cssScale * dpr
    const pixels = metrics.naturalWidth * metrics.naturalHeight * renderScale ** 2
    if (pixels > MAX_PREVIEW_PIXELS) {
      renderScale *= Math.sqrt(MAX_PREVIEW_PIXELS / pixels)
    }

    const result = renderScene(effectiveScene, bundle, {
      scale: renderScale,
      fast: gestureRef.current.kind !== 'none'
    })
    renderRef.current = result

    canvas.width = result.width
    canvas.height = result.height
    const ctx = context2d(canvas)
    ctx.clearRect(0, 0, result.width, result.height)
    ctx.drawImage(result.canvas, 0, 0)

    const width = metrics.naturalWidth * cssScale
    const height = metrics.naturalHeight * cssScale
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    setCssSize({ width, height })

    drawOverlay(width, height)
  }, [effectiveScene, images, capture, box, zoom])

  const schedule = React.useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
  }, [draw])

  React.useEffect(() => {
    schedule()
    return () => cancelAnimationFrame(rafRef.current)
  }, [schedule])

  /* -------------------------- coordinate mapping ------------------------- */

  /** CSS point (relative to the canvas) -> normalized screenshot coords. */
  const toContent = React.useCallback((clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current
    const result = renderRef.current
    if (!canvas || !result) return null
    const rect = canvas.getBoundingClientRect()
    const px = ((clientX - rect.left) / rect.width) * result.width
    const py = ((clientY - rect.top) / rect.height) * result.height
    const inverse = invertMatrix(unitSquareToQuad(result.contentQuad))
    if (!inverse) return null
    return applyMatrix(inverse, px, py)
  }, [])

  /** Normalized screenshot coords -> CSS point relative to the canvas. */
  const toCss = React.useCallback((p: Point): Point => {
    const result = renderRef.current
    if (!result) return { x: 0, y: 0 }
    const m = unitSquareToQuad(result.contentQuad)
    const projected = applyMatrix(m, p.x, p.y)
    const canvas = canvasRef.current
    const ratio = canvas ? canvas.clientWidth / result.width : 1
    return { x: projected.x * ratio, y: projected.y * ratio }
  }, [])

  /* -------------------------------- overlay ------------------------------ */

  const drawOverlay = React.useCallback(
    (width: number, height: number) => {
      const overlay = overlayRef.current
      const result = renderRef.current
      if (!overlay || !result) return
      const dpr = window.devicePixelRatio || 1
      overlay.width = Math.max(1, Math.round(width * dpr))
      overlay.height = Math.max(1, Math.round(height * dpr))
      overlay.style.width = `${width}px`
      overlay.style.height = `${height}px`
      const ctx = context2d(overlay)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const state = useEditor.getState()

      if (cropping) {
        drawCropOverlay(ctx, state.scene.crop, toCss)
        return
      }

      if (showGrid) drawGrid(ctx, width, height)

      const selected = state.scene.annotations.find((a) => a.id === state.selectedId)
      if (!selected || state.editingTextId === selected.id) return

      // Outline follows the projected quad so it stays correct under tilt.
      const b = boundsOf(selected)
      const corners: Quad = [
        toCss({ x: b.x, y: b.y }),
        toCss({ x: b.x + b.w, y: b.y }),
        toCss({ x: b.x + b.w, y: b.y + b.h }),
        toCss({ x: b.x, y: b.y + b.h })
      ] as Quad

      ctx.save()
      ctx.strokeStyle = '#7c6cff'
      ctx.lineWidth = 1.25
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(corners[0].x, corners[0].y)
      for (const c of corners.slice(1)) ctx.lineTo(c.x, c.y)
      ctx.closePath()
      ctx.stroke()
      ctx.setLineDash([])

      for (const handle of handlesFor(selected)) {
        const p = toCss({ x: handle.x, y: handle.y })
        ctx.beginPath()
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#7c6cff'
        ctx.lineWidth = 1.5
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    },
    [cropping, showGrid, toCss]
  )

  React.useEffect(() => {
    drawOverlay(cssSize.width, cssSize.height)
  }, [drawOverlay, cssSize, selectedId, editingTextId, scene.annotations, scene.crop])

  /* ------------------------------ interaction ---------------------------- */

  const findHandle = React.useCallback(
    (clientX: number, clientY: number, annotation: Annotation): Handle | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const local = { x: clientX - rect.left, y: clientY - rect.top }
      for (const handle of handlesFor(annotation)) {
        const p = toCss({ x: handle.x, y: handle.y })
        if (Math.hypot(p.x - local.x, p.y - local.y) <= 8) return handle
      }
      return null
    },
    [toCss]
  )

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!capture) return
    const state = useEditor.getState()
    const point = toContent(event.clientX, event.clientY)
    if (!point) return

    if (event.button === 1 || (event.button === 0 && state.tool === 'pan')) {
      const scroller = scrollRef.current
      if (scroller) {
        gestureRef.current = {
          kind: 'pan',
          origin: { x: event.clientX, y: event.clientY },
          scroll: { x: scroller.scrollLeft, y: scroller.scrollTop }
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      return
    }
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)

    if (cropping) {
      const crop = state.scene.crop
      const handle = cropHandleAt(point, crop)
      state.snapshot()
      gestureRef.current = {
        kind: 'crop',
        handle: handle ?? 'new',
        origin: point,
        start: { x: crop.x, y: crop.y, w: crop.w, h: crop.h }
      }
      if (!handle) {
        state.patchCrop({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1), w: 0, h: 0 })
      }
      return
    }

    if (state.tool === 'select') {
      const selected = state.scene.annotations.find((a) => a.id === state.selectedId)
      if (selected) {
        const handle = findHandle(event.clientX, event.clientY, selected)
        if (handle) {
          state.snapshot()
          gestureRef.current = { kind: 'resize', id: selected.id, handle: handle.id, start: { ...selected } }
          return
        }
      }
      const aspect = (renderRef.current?.contentHeight ?? 1) / (renderRef.current?.contentWidth ?? 1)
      const hit = hitTest(state.scene.annotations, point, 0.012, aspect)
      state.select(hit?.id ?? null)
      state.setEditingText(null)
      if (hit) {
        state.snapshot()
        gestureRef.current = { kind: 'move', id: hit.id, grab: point, start: { ...hit } }
      }
      return
    }

    if (state.tool === 'pen') {
      const annotation = state.addAnnotation('pen', point)
      gestureRef.current = { kind: 'pen', id: annotation.id }
      return
    }

    // Every remaining tool at this point is an annotation type.
    const annotation = state.addAnnotation(state.tool as AnnotationType, point)
    if (annotation.type === 'text') {
      state.setEditingText(annotation.id)
      state.setTool('select')
      gestureRef.current = { kind: 'none' }
      return
    }
    if (annotation.type === 'step') {
      const size = 0.055
      state.updateAnnotation(annotation.id, {
        x: point.x - size / 2,
        y: point.y - size / 2,
        w: size,
        h: size * ((renderRef.current?.contentWidth ?? 1) / (renderRef.current?.contentHeight ?? 1))
      })
      state.setTool('select')
      gestureRef.current = { kind: 'none' }
      schedule()
      return
    }
    gestureRef.current = { kind: 'create', id: annotation.id, origin: point }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current
    const state = useEditor.getState()

    if (gesture.kind === 'pan') {
      const scroller = scrollRef.current
      if (scroller) {
        scroller.scrollLeft = gesture.scroll.x - (event.clientX - gesture.origin.x)
        scroller.scrollTop = gesture.scroll.y - (event.clientY - gesture.origin.y)
      }
      return
    }

    const point = toContent(event.clientX, event.clientY)
    if (!point) return

    if (gesture.kind === 'none') {
      updateCursor(event, point, state)
      return
    }

    switch (gesture.kind) {
      case 'create': {
        const shift = event.shiftKey
        let w = point.x - gesture.origin.x
        let h = point.y - gesture.origin.y
        const annotation = state.scene.annotations.find((a) => a.id === gesture.id)
        if (shift && annotation) {
          if (annotation.type === 'arrow' || annotation.type === 'line') {
            // Snap the shaft to 15-degree increments.
            const angle = Math.atan2(h, w)
            const step = Math.PI / 12
            const snapped = Math.round(angle / step) * step
            const len = Math.hypot(w, h)
            w = Math.cos(snapped) * len
            h = Math.sin(snapped) * len
          } else {
            const aspect = (renderRef.current?.contentWidth ?? 1) / (renderRef.current?.contentHeight ?? 1)
            const size = Math.max(Math.abs(w), Math.abs(h) / aspect)
            w = Math.sign(w || 1) * size
            h = Math.sign(h || 1) * size * aspect
          }
        }
        state.updateAnnotation(gesture.id, { w, h })
        break
      }

      case 'pen': {
        const annotation = state.scene.annotations.find((a) => a.id === gesture.id)
        if (annotation && annotation.type === 'pen') {
          const last = annotation.points[annotation.points.length - 1]
          if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.002) {
            state.updateAnnotation(gesture.id, { points: [...annotation.points, point] })
          }
        }
        break
      }

      case 'move': {
        const dx = point.x - gesture.grab.x
        const dy = point.y - gesture.grab.y
        const start = gesture.start
        if (start.type === 'pen') {
          state.updateAnnotation(gesture.id, {
            points: start.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
          })
        } else {
          state.updateAnnotation(gesture.id, { x: start.x + dx, y: start.y + dy })
        }
        break
      }

      case 'resize': {
        applyResize(state, gesture.id, gesture.handle, gesture.start, point, event.shiftKey)
        break
      }

      case 'crop': {
        applyCrop(state, gesture, point, event.shiftKey)
        break
      }
    }

    schedule()
  }

  const updateCursor = (
    event: React.PointerEvent<HTMLDivElement>,
    point: Point,
    state: ReturnType<typeof useEditor.getState>
  ): void => {
    if (state.tool === 'pan') return setCursor('grab')
    if (cropping) return setCursor('crosshair')
    if (state.tool !== 'select') return setCursor('crosshair')
    const selected = state.scene.annotations.find((a) => a.id === state.selectedId)
    if (selected) {
      const handle = findHandle(event.clientX, event.clientY, selected)
      if (handle) return setCursor(handle.cursor)
    }
    const aspect = (renderRef.current?.contentHeight ?? 1) / (renderRef.current?.contentWidth ?? 1)
    setCursor(hitTest(state.scene.annotations, point, 0.012, aspect) ? 'move' : 'default')
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current
    gestureRef.current = { kind: 'none' }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const state = useEditor.getState()

    if (gesture.kind === 'create') {
      const annotation = state.scene.annotations.find((a) => a.id === gesture.id)
      // A click without a drag should still leave a usable default shape.
      if (annotation && Math.abs(annotation.w) < 0.01 && Math.abs(annotation.h) < 0.01) {
        if (annotation.type === 'arrow' || annotation.type === 'line') {
          state.updateAnnotation(gesture.id, { w: 0.18, h: 0.12 })
        } else {
          state.updateAnnotation(gesture.id, { w: 0.2, h: 0.14 })
        }
      }
      state.setTool('select')
    }

    if (gesture.kind === 'crop') {
      const crop = state.scene.crop
      if (crop.w < 0.02 || crop.h < 0.02) {
        state.patchCrop({ x: 0, y: 0, w: 1, h: 1 })
      }
    }

    if (gesture.kind === 'pen') state.setTool('select')
    schedule()
  }

  const onDoubleClick = (event: React.MouseEvent): void => {
    const state = useEditor.getState()
    const point = toContent(event.clientX, event.clientY)
    if (!point) return
    const aspect = (renderRef.current?.contentHeight ?? 1) / (renderRef.current?.contentWidth ?? 1)
    const hit = hitTest(state.scene.annotations, point, 0.012, aspect)
    if (hit?.type === 'text') {
      state.select(hit.id)
      state.setEditingText(hit.id)
    }
  }

  const onWheel = (event: React.WheelEvent): void => {
    if (!event.ctrlKey) return
    event.preventDefault()
    const state = useEditor.getState()
    const current =
      state.zoom === 'fit'
        ? cssSize.width / (renderRef.current?.naturalWidth ?? Math.max(1, cssSize.width))
        : state.zoom
    state.setZoom(clamp(current * (event.deltaY < 0 ? 1.12 : 0.89), 0.08, 6))
  }

  /* ------------------------------ text editor ---------------------------- */

  const editing = scene.annotations.find(
    (a): a is TextAnnotation => a.id === editingTextId && a.type === 'text'
  )

  return (
    <div
      ref={wrapRef}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      onWheel={onWheel}
    >
      <div
        ref={scrollRef}
        className="flex min-h-0 w-full items-center justify-center overflow-auto p-9"
      >
        <div
          className="relative shrink-0"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <div
            className="checker absolute inset-0 rounded-[3px]"
            style={{ opacity: scene.background.kind === 'transparent' ? 1 : 0 }}
          />
          <canvas
            ref={canvasRef}
            className="relative block rounded-[3px] shadow-[0_24px_70px_-24px_rgba(0,0,0,0.85)]"
          />
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute left-0 top-0 block"
          />
          {editing && (
            <TextEditor
              annotation={editing}
              anchor={toCss({ x: editing.x, y: editing.y })}
              fontScale={cssFontScale(renderRef.current, toCss)}
              onDone={() => schedule()}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ text editing ----------------------------- */

/** CSS pixels per unit of `fontSize`, matching what the renderer will bake in. */
function cssFontScale(
  result: RenderResult | null,
  toCss: (p: Point) => Point
): number {
  if (!result) return 1
  const left = toCss({ x: 0, y: 0 })
  const right = toCss({ x: 1, y: 0 })
  const cssContentWidth = Math.hypot(right.x - left.x, right.y - left.y)
  const k = unitScale(result.contentWidth, result.contentHeight)
  return (k * cssContentWidth) / Math.max(1, result.contentWidth)
}

function TextEditor({
  annotation,
  anchor,
  fontScale,
  onDone
}: {
  annotation: TextAnnotation
  anchor: Point
  fontScale: number
  onDone: () => void
}): React.JSX.Element {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const setEditingText = useEditor((s) => s.setEditingText)
  const updateAnnotation = useEditor((s) => s.updateAnnotation)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const fontPx = Math.max(11, annotation.fontSize * fontScale)

  return (
    <textarea
      ref={ref}
      value={annotation.text}
      spellCheck={false}
      onChange={(e) => updateAnnotation(annotation.id, { text: e.target.value })}
      onBlur={() => {
        setEditingText(null)
        onDone()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur()
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
        e.stopPropagation()
      }}
      style={{
        left: anchor.x,
        top: anchor.y,
        fontSize: `${fontPx}px`,
        color: annotation.color,
        fontWeight: annotation.fontWeight,
        textAlign: annotation.align,
        minWidth: 120
      }}
      className="absolute z-10 resize-none rounded-md border border-brand bg-black/55 px-1.5 py-1 leading-tight outline-none backdrop-blur-sm"
      rows={Math.max(1, annotation.text.split('\n').length)}
    />
  )
}

/* -------------------------------- helpers -------------------------------- */

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 1
  for (let i = 1; i < 3; i++) {
    const x = (width / 3) * i
    const y = (height / 3) * i
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawCropOverlay(
  ctx: CanvasRenderingContext2D,
  crop: { x: number; y: number; w: number; h: number },
  toCss: (p: Point) => Point
): void {
  const tl = toCss({ x: crop.x, y: crop.y })
  const br = toCss({ x: crop.x + crop.w, y: crop.y + crop.h })
  const w = br.x - tl.x
  const h = br.y - tl.y
  const full = toCss({ x: 1, y: 1 })
  const origin = toCss({ x: 0, y: 0 })

  ctx.save()
  ctx.fillStyle = 'rgba(6,6,10,0.62)'
  ctx.beginPath()
  ctx.rect(origin.x, origin.y, full.x - origin.x, full.y - origin.y)
  ctx.rect(tl.x, tl.y, w, h)
  ctx.fill('evenodd')

  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.25
  ctx.strokeRect(tl.x, tl.y, w, h)

  ctx.strokeStyle = 'rgba(255,255,255,0.32)'
  ctx.lineWidth = 1
  for (let i = 1; i < 3; i++) {
    ctx.beginPath()
    ctx.moveTo(tl.x + (w / 3) * i, tl.y)
    ctx.lineTo(tl.x + (w / 3) * i, tl.y + h)
    ctx.moveTo(tl.x, tl.y + (h / 3) * i)
    ctx.lineTo(tl.x + w, tl.y + (h / 3) * i)
    ctx.stroke()
  }

  const corners = [
    [tl.x, tl.y],
    [tl.x + w, tl.y],
    [tl.x + w, tl.y + h],
    [tl.x, tl.y + h]
  ]
  ctx.fillStyle = '#ffffff'
  for (const [x, y] of corners) {
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function cropHandleAt(
  point: Point,
  crop: { x: number; y: number; w: number; h: number }
): HandleId | null {
  const t = 0.022
  const near = (a: number, b: number): boolean => Math.abs(a - b) < t
  const insideX = point.x > crop.x - t && point.x < crop.x + crop.w + t
  const insideY = point.y > crop.y - t && point.y < crop.y + crop.h + t
  if (!insideX || !insideY) return null

  const left = near(point.x, crop.x)
  const right = near(point.x, crop.x + crop.w)
  const top = near(point.y, crop.y)
  const bottom = near(point.y, crop.y + crop.h)

  if (left && top) return 'nw'
  if (right && top) return 'ne'
  if (right && bottom) return 'se'
  if (left && bottom) return 'sw'
  if (left) return 'w'
  if (right) return 'e'
  if (top) return 'n'
  if (bottom) return 's'
  return 'move'
}

function applyCrop(
  state: ReturnType<typeof useEditor.getState>,
  gesture: Extract<Gesture, { kind: 'crop' }>,
  point: Point,
  lockRatio: boolean
): void {
  const start = gesture.start
  const dx = point.x - gesture.origin.x
  const dy = point.y - gesture.origin.y

  if (gesture.handle === 'new') {
    const x = Math.min(gesture.origin.x, point.x)
    const y = Math.min(gesture.origin.y, point.y)
    state.patchCrop({
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      w: clamp(Math.abs(point.x - gesture.origin.x), 0, 1 - clamp(x, 0, 1)),
      h: clamp(Math.abs(point.y - gesture.origin.y), 0, 1 - clamp(y, 0, 1))
    })
    return
  }

  if (gesture.handle === 'move') {
    state.patchCrop({
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h)
    })
    return
  }

  let { x, y, w, h } = start
  const h0 = gesture.handle
  if (h0.includes('w')) {
    x = clamp(start.x + dx, 0, start.x + start.w - 0.02)
    w = start.x + start.w - x
  }
  if (h0.includes('e')) w = clamp(start.w + dx, 0.02, 1 - start.x)
  if (h0.includes('n')) {
    y = clamp(start.y + dy, 0, start.y + start.h - 0.02)
    h = start.y + start.h - y
  }
  if (h0.includes('s')) h = clamp(start.h + dy, 0.02, 1 - start.y)

  if (lockRatio) {
    const ratio = start.w / start.h
    h = w / ratio
  }

  state.patchCrop({ x, y, w, h })
}

function applyResize(
  state: ReturnType<typeof useEditor.getState>,
  id: string,
  handle: HandleId,
  start: Annotation,
  point: Point,
  lockRatio: boolean
): void {
  if (handle === 'start') {
    state.updateAnnotation(id, {
      x: point.x,
      y: point.y,
      w: start.x + start.w - point.x,
      h: start.y + start.h - point.y
    })
    return
  }
  if (handle === 'end') {
    state.updateAnnotation(id, { w: point.x - start.x, h: point.y - start.y })
    return
  }

  const box = boundsOf(start)
  let { x, y, w, h } = box

  if (handle.includes('w')) {
    x = point.x
    w = box.x + box.w - point.x
  }
  if (handle.includes('e')) w = point.x - box.x
  if (handle.includes('n')) {
    y = point.y
    h = box.y + box.h - point.y
  }
  if (handle.includes('s')) h = point.y - box.y

  if (lockRatio && box.w > 0 && box.h > 0) h = w * (box.h / box.w)

  if (start.type === 'pen') {
    const sx = box.w === 0 ? 1 : w / box.w
    const sy = box.h === 0 ? 1 : h / box.h
    state.updateAnnotation(id, {
      points: start.points.map((p) => ({
        x: x + (p.x - box.x) * sx,
        y: y + (p.y - box.y) * sy
      }))
    })
    return
  }

  state.updateAnnotation(id, { x, y, w, h })
}

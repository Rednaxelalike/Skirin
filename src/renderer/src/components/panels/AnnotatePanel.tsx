import * as React from 'react'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  ScanSearch,
  Trash2
} from 'lucide-react'
import type { Annotation, EffectAnnotation, TextAnnotation } from '@shared/types'
import { useEditor } from '@/store/editor'
import { ANNOTATION_COLORS } from '@/lib/presets'
import { TOOL_LABELS, isEffect } from '@/lib/annotations'
import { buildContentCanvas } from '@/lib/render'
import { DEFAULT_KINDS, KIND_LABELS, detectSensitive, toAnnotations } from '@/lib/ocr'
import type { SensitiveKind } from '@/lib/ocr'
import { ColorPicker, Empty, IconButton, Row, Section, Segmented, Select, Slider, Switch } from '../ui'
import { cn, uid } from '@/lib/utils'

export function AnnotatePanel(): React.JSX.Element {
  return (
    <>
      <SelectedSection />
      <SmartRedactSection />
      <LayersSection />
    </>
  )
}

/* ------------------------------- selection ------------------------------- */

function SelectedSection(): React.JSX.Element | null {
  const selectedId = useEditor((s) => s.selectedId)
  const annotation = useEditor((s) => s.scene.annotations.find((a) => a.id === s.selectedId))
  const update = useEditor((s) => s.updateAnnotation)
  const remove = useEditor((s) => s.removeAnnotation)
  const snapshot = useEditor((s) => s.snapshot)
  const pushAnnotations = useEditor((s) => s.pushAnnotations)

  if (!annotation || !selectedId) {
    return (
      <Section title="Selection">
        <p className="text-[11.5px] leading-relaxed text-text-3">
          Pick a tool on the left and drag on the canvas. Select a shape to fine-tune it here.
        </p>
      </Section>
    )
  }

  const patch = (value: Partial<Annotation>): void => update(selectedId, value)

  return (
    <Section
      title={TOOL_LABELS[annotation.type]}
      action={
        <div className="flex items-center gap-0.5">
          <IconButton
            className="h-6 w-6"
            onClick={() => {
              const copy = {
                ...annotation,
                id: uid('an-'),
                x: annotation.x + 0.02,
                y: annotation.y + 0.02
              } as Annotation
              pushAnnotations([copy])
            }}
            aria-label="Duplicate"
          >
            <Copy size={12} />
          </IconButton>
          <IconButton
            className="h-6 w-6 hover:text-red-400"
            onClick={() => remove(selectedId)}
            aria-label="Delete"
          >
            <Trash2 size={12} />
          </IconButton>
        </div>
      }
    >
      {annotation.type !== 'blur' && annotation.type !== 'pixelate' && (
        <Row label="Color">
          <ColorPicker
            value={annotation.color}
            onChange={(color) => patch({ color })}
            onCommit={snapshot}
            swatches={ANNOTATION_COLORS}
          />
        </Row>
      )}

      {'strokeWidth' in annotation && annotation.strokeWidth > 0 && (
        <Slider
          label="Stroke"
          value={annotation.strokeWidth}
          min={1}
          max={40}
          onChange={(strokeWidth) => patch({ strokeWidth })}
          onCommit={snapshot}
        />
      )}

      <Slider
        label="Opacity"
        value={annotation.opacity}
        min={0.05}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(opacity) => patch({ opacity })}
        onCommit={snapshot}
      />

      {(annotation.type === 'arrow' || annotation.type === 'line') && (
        <>
          <Slider
            label="Curve"
            value={annotation.curve}
            min={-0.6}
            max={0.6}
            step={0.01}
            onChange={(curve) => patch({ curve } as Partial<Annotation>)}
            onCommit={snapshot}
          />
          <Slider
            label="Head size"
            value={annotation.headSize}
            min={1.5}
            max={8}
            step={0.1}
            onChange={(headSize) => patch({ headSize } as Partial<Annotation>)}
            onCommit={snapshot}
          />
          <Row label="Ends">
            <Segmented
              value={annotation.heads}
              options={[
                { value: 'none', label: 'None' },
                { value: 'end', label: 'One' },
                { value: 'both', label: 'Both' }
              ]}
              onChange={(heads) => patch({ heads } as Partial<Annotation>)}
              className="w-[150px]"
            />
          </Row>
          <Row label="Dashed">
            <Switch
              checked={annotation.dashed}
              onChange={(dashed) => patch({ dashed } as Partial<Annotation>)}
            />
          </Row>
        </>
      )}

      {(annotation.type === 'rect' || annotation.type === 'ellipse') && (
        <>
          {annotation.type === 'rect' && (
            <Slider
              label="Corner radius"
              value={annotation.radius}
              min={0}
              max={80}
              onChange={(radius) => patch({ radius } as Partial<Annotation>)}
              onCommit={snapshot}
            />
          )}
          <Row label="Fill">
            <Switch
              checked={!!annotation.fill}
              onChange={(on) =>
                patch({ fill: on ? `${annotation.color}33` : null } as Partial<Annotation>)
              }
            />
            {annotation.fill && (
              <ColorPicker
                value={annotation.fill}
                onChange={(fill) => patch({ fill } as Partial<Annotation>)}
                onCommit={snapshot}
                allowAlpha
              />
            )}
          </Row>
          <Row label="Dashed">
            <Switch
              checked={annotation.dashed}
              onChange={(dashed) => patch({ dashed } as Partial<Annotation>)}
            />
          </Row>
        </>
      )}

      {annotation.type === 'text' && <TextControls annotation={annotation} patch={patch} />}

      {annotation.type === 'step' && (
        <Slider
          label="Number"
          value={annotation.index}
          min={1}
          max={99}
          onChange={(index) => patch({ index } as Partial<Annotation>)}
          onCommit={snapshot}
        />
      )}

      {isEffect(annotation) && <EffectControls annotation={annotation} patch={patch} />}
    </Section>
  )
}

function TextControls({
  annotation,
  patch
}: {
  annotation: TextAnnotation
  patch: (value: Partial<Annotation>) => void
}): React.JSX.Element {
  const snapshot = useEditor((s) => s.snapshot)
  return (
    <>
      <textarea
        value={annotation.text}
        onChange={(e) => patch({ text: e.target.value } as Partial<Annotation>)}
        rows={2}
        className="focus-ring w-full resize-none rounded-lg border border-hair bg-white/5 px-2.5 py-1.5 text-[12px] text-text-1"
      />
      <Slider
        label="Size"
        value={annotation.fontSize}
        min={10}
        max={140}
        onChange={(fontSize) => patch({ fontSize } as Partial<Annotation>)}
        onCommit={snapshot}
      />
      <Row label="Weight">
        <Select
          value={String(annotation.fontWeight)}
          options={[
            { value: '400', label: 'Regular' },
            { value: '600', label: 'Semibold' },
            { value: '700', label: 'Bold' },
            { value: '800', label: 'Black' }
          ]}
          onChange={(v) => patch({ fontWeight: Number(v) } as Partial<Annotation>)}
          className="w-[110px]"
        />
      </Row>
      <Row label="Align">
        <Segmented
          value={annotation.align}
          options={[
            { value: 'left', label: 'L' },
            { value: 'center', label: 'C' },
            { value: 'right', label: 'R' }
          ]}
          onChange={(align) => patch({ align } as Partial<Annotation>)}
          className="w-[92px]"
        />
      </Row>
      <Row label="Backdrop">
        <Switch
          checked={!!annotation.background}
          onChange={(on) => patch({ background: on ? '#000000b8' : null } as Partial<Annotation>)}
        />
        {annotation.background && (
          <ColorPicker
            value={annotation.background}
            onChange={(background) => patch({ background } as Partial<Annotation>)}
            onCommit={snapshot}
            allowAlpha
          />
        )}
      </Row>
    </>
  )
}

function EffectControls({
  annotation,
  patch
}: {
  annotation: EffectAnnotation
  patch: (value: Partial<Annotation>) => void
}): React.JSX.Element {
  const snapshot = useEditor((s) => s.snapshot)
  const isStrength = annotation.type === 'highlight' || annotation.type === 'spotlight'
  return (
    <>
      <Slider
        label={isStrength ? 'Strength' : annotation.type === 'blur' ? 'Blur radius' : 'Cell size'}
        value={annotation.amount}
        min={isStrength ? 0.05 : 2}
        max={isStrength ? 1 : 60}
        step={isStrength ? 0.01 : 1}
        format={isStrength ? (v) => `${Math.round(v * 100)}%` : undefined}
        onChange={(amount) => patch({ amount } as Partial<Annotation>)}
        onCommit={snapshot}
      />
      <Row label="Shape">
        <Segmented
          value={annotation.shape}
          options={[
            { value: 'rect', label: 'Rect' },
            { value: 'ellipse', label: 'Oval' }
          ]}
          onChange={(shape) => patch({ shape } as Partial<Annotation>)}
          className="w-[110px]"
        />
      </Row>
      {annotation.shape === 'rect' && (
        <Slider
          label="Corner radius"
          value={annotation.radius}
          min={0}
          max={60}
          onChange={(radius) => patch({ radius } as Partial<Annotation>)}
          onCommit={snapshot}
        />
      )}
    </>
  )
}

/* ------------------------------ smart redact ----------------------------- */

function SmartRedactSection(): React.JSX.Element {
  const scene = useEditor((s) => s.scene)
  const images = useEditor((s) => s.images)
  const capture = useEditor((s) => s.capture)
  const pushAnnotations = useEditor((s) => s.pushAnnotations)
  const busy = useEditor((s) => s.busy)
  const setBusy = useEditor((s) => s.setBusy)

  const [kinds, setKinds] = React.useState<SensitiveKind[]>(DEFAULT_KINDS)
  const [style, setStyle] = React.useState<'blur' | 'pixelate' | 'redact'>('redact')

  const run = async (): Promise<void> => {
    if (!capture || !images.base) return
    setBusy('Reading text…')
    try {
      const content = buildContentCanvas(
        { ...scene, annotations: [] },
        {
          base: images.base,
          baseWidth: capture.width,
          baseHeight: capture.height
        }
      )
      const found = await detectSensitive(content, kinds, (status, ratio) => {
        setBusy(`${status} ${Math.round(ratio * 100)}%`)
      })
      if (!found.length) {
        toast.info('Nothing sensitive found', {
          description: 'Try adding a category, or redact manually with the X tool.'
        })
        return
      }
      pushAnnotations(toAnnotations(found, style))
      toast.success(`Hid ${found.length} item${found.length === 1 ? '' : 's'}`, {
        description: 'Each one is a normal shape — nudge or delete any of them.'
      })
    } catch (error) {
      toast.error('Text recognition unavailable', {
        description:
          error instanceof Error && /network|fetch|load/i.test(error.message)
            ? 'The OCR model downloads once on first use and needs an internet connection.'
            : 'Redact manually with the X tool instead.'
      })
    } finally {
      setBusy(null)
    }
  }

  const toggle = (kind: SensitiveKind): void =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind]
    )

  return (
    <Section title="Smart redact">
      <p className="text-[11.5px] leading-relaxed text-text-3">
        Reads the capture on-device and hides anything that looks private.
      </p>
      <div className="flex flex-wrap gap-1">
        {(['email', 'phone', 'card', 'token', 'ip', 'url'] as SensitiveKind[]).map((kind) => (
          <button
            key={kind}
            onClick={() => toggle(kind)}
            className={cn(
              'focus-ring h-6 rounded-md border px-2 text-[11px] transition-colors',
              kinds.includes(kind)
                ? 'border-brand/50 bg-brand/16 text-brand-soft'
                : 'border-hair bg-white/4 text-text-3 hover:text-text-2'
            )}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
      </div>
      <Row label="Style">
        <Segmented
          value={style}
          options={[
            { value: 'redact', label: 'Bar' },
            { value: 'blur', label: 'Blur' },
            { value: 'pixelate', label: 'Pixel' }
          ]}
          onChange={setStyle}
          className="w-[160px]"
        />
      </Row>
      <button
        onClick={run}
        disabled={!!busy || !capture || !kinds.length}
        className="focus-ring flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-white/8 text-[12px] font-medium text-text-1 hover:bg-white/14 disabled:opacity-40"
      >
        <ScanSearch size={14} />
        {busy ?? 'Find and hide sensitive data'}
      </button>
    </Section>
  )
}

/* --------------------------------- layers -------------------------------- */

function LayersSection(): React.JSX.Element {
  const annotations = useEditor((s) => s.scene.annotations)
  const selectedId = useEditor((s) => s.selectedId)
  const select = useEditor((s) => s.select)
  const update = useEditor((s) => s.updateAnnotation)
  const remove = useEditor((s) => s.removeAnnotation)
  const reorder = useEditor((s) => s.reorderAnnotation)
  const clear = useEditor((s) => s.clearAnnotations)

  return (
    <Section
      title={`Layers${annotations.length ? ` · ${annotations.length}` : ''}`}
      action={
        annotations.length > 0 && (
          <button
            onClick={clear}
            className="focus-ring text-[11px] text-text-3 hover:text-red-400"
          >
            Clear all
          </button>
        )
      }
    >
      {!annotations.length ? (
        <Empty
          icon={<ScanSearch size={17} />}
          title="No annotations yet"
          body="Arrows, callouts, blurs and step numbers all show up here as editable layers."
        />
      ) : (
        <div className="space-y-1">
          {[...annotations].reverse().map((annotation) => (
            <div
              key={annotation.id}
              onClick={() => select(annotation.id)}
              className={cn(
                'group flex h-8 cursor-default items-center gap-2 rounded-lg border px-2 transition-colors',
                selectedId === annotation.id
                  ? 'border-brand/45 bg-brand/12'
                  : 'border-transparent bg-white/3 hover:bg-white/7'
              )}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-black/30"
                style={{ background: annotation.color }}
              />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-2">
                {annotation.type === 'text'
                  ? annotation.text.split('\n')[0] || 'Text'
                  : annotation.type === 'step'
                    ? `Step ${annotation.index}`
                    : TOOL_LABELS[annotation.type]}
              </span>
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <IconButton
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation()
                    reorder(annotation.id, 'up')
                  }}
                >
                  <ChevronUp size={11} />
                </IconButton>
                <IconButton
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation()
                    reorder(annotation.id, 'down')
                  }}
                >
                  <ChevronDown size={11} />
                </IconButton>
                <IconButton
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation()
                    update(annotation.id, { locked: !annotation.locked })
                  }}
                >
                  {annotation.locked ? <Lock size={11} /> : <LockOpen size={11} />}
                </IconButton>
                <IconButton
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation()
                    update(annotation.id, { hidden: !annotation.hidden })
                  }}
                >
                  {annotation.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                </IconButton>
                <IconButton
                  className="h-6 w-6 hover:text-red-400"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(annotation.id)
                  }}
                >
                  <Trash2 size={11} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

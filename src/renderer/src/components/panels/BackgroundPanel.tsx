import * as React from 'react'
import { ImagePlus, Plus, Trash2, Wand2, X } from 'lucide-react'
import type { BackgroundKind, GradientStop } from '@shared/types'
import { useEditor, setSceneImage } from '@/store/editor'
import { GRADIENTS, MESHES, SOLIDS } from '@/lib/presets'
import { ColorPicker, IconButton, Row, Section, Segmented, Select, Slider, Switch } from '../ui'
import { cn } from '@/lib/utils'

const KINDS: Array<{ value: BackgroundKind; label: string }> = [
  { value: 'gradient', label: 'Gradient' },
  { value: 'mesh', label: 'Mesh' },
  { value: 'solid', label: 'Solid' },
  { value: 'image', label: 'Image' }
]

function gradientCss(stops: GradientStop[], angle: number, type: string): string {
  const list = [...stops]
    .sort((a, b) => a.pos - b.pos)
    .map((s) => `${s.color} ${Math.round(s.pos * 100)}%`)
    .join(', ')
  if (type === 'radial') return `radial-gradient(circle at 50% 50%, ${list})`
  if (type === 'conic') return `conic-gradient(from ${angle}deg at 50% 50%, ${list})`
  return `linear-gradient(${angle}deg, ${list})`
}

export function BackgroundPanel(): React.JSX.Element {
  const background = useEditor((s) => s.scene.background)
  const patchBackground = useEditor((s) => s.patchBackground)
  const applyGradient = useEditor((s) => s.applyGradient)
  const applyMesh = useEditor((s) => s.applyMesh)
  const snapshot = useEditor((s) => s.snapshot)
  const [group, setGroup] = React.useState<string>('All')

  const groups = ['All', ...Array.from(new Set(GRADIENTS.map((g) => g.group)))]
  const visible = group === 'All' ? GRADIENTS : GRADIENTS.filter((g) => g.group === group)

  const pickImage = async (): Promise<void> => {
    const opened = await window.skirin.image.open()
    if (!opened) return
    snapshot()
    await setSceneImage('background', opened.src)
    patchBackground({ kind: 'image', image: { ...background.image, src: opened.src } })
  }

  const updateStop = (index: number, patch: Partial<GradientStop>): void => {
    const stops = background.gradient.stops.map((s, i) => (i === index ? { ...s, ...patch } : s))
    patchBackground({ gradient: { ...background.gradient, stops } })
  }

  return (
    <>
      <Section>
        <Segmented
          value={background.kind === 'auto' || background.kind === 'transparent' ? 'gradient' : background.kind}
          options={KINDS}
          onChange={(kind) => {
            snapshot()
            patchBackground({ kind })
          }}
        />
        <div className="flex gap-2">
          <button
            onClick={() => {
              snapshot()
              patchBackground({ kind: 'auto' })
            }}
            className={cn(
              'focus-ring flex h-8 flex-1 items-center justify-center gap-1.5 rounded-ctl border text-[11.5px] font-medium',
              background.kind === 'auto'
                ? 'sk-selected border-transparent'
                : 'sk-raise bg-ink-3 text-text-2'
            )}
          >
            <Wand2 size={12} /> Auto from image
          </button>
          <button
            onClick={() => {
              snapshot()
              patchBackground({ kind: 'transparent' })
            }}
            className={cn(
              'focus-ring flex h-8 flex-1 items-center justify-center gap-1.5 rounded-ctl border text-[11.5px] font-medium',
              background.kind === 'transparent'
                ? 'sk-selected border-transparent'
                : 'sk-raise bg-ink-3 text-text-2'
            )}
          >
            <X size={12} /> None
          </button>
        </div>
      </Section>

      {background.kind === 'gradient' && (
        <>
          <Section title="Presets">
            <div className="-mx-0.5 flex flex-wrap gap-1">
              {groups.map((g) => (
                <button
                  key={g}
                  onClick={() => setGroup(g)}
                  className={cn(
                    'focus-ring h-6 rounded-[7px] px-2 text-[11px] font-medium transition-[background-color,color,box-shadow] duration-150',
                    group === g
                      ? 'bg-ink-4 text-text-1 shadow-[var(--shadow-raise)]'
                      : 'text-text-3 hover:bg-white/[0.05] hover:text-text-2'
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {visible.map((preset) => (
                <button
                  key={preset.id}
                  title={preset.name}
                  onClick={() => applyGradient(preset.id)}
                  className="focus-ring aspect-square rounded-ctl border border-hair-strong shadow-[var(--shadow-raise)] transition-transform duration-150 ease-[var(--ease-out-soft)] hover:scale-108"
                  style={{
                    background: gradientCss(preset.def.stops, preset.def.angle, preset.def.type)
                  }}
                />
              ))}
            </div>
          </Section>

          <Section title="Gradient">
            <Row label="Type">
              <Select
                value={background.gradient.type}
                options={[
                  { value: 'linear', label: 'Linear' },
                  { value: 'radial', label: 'Radial' },
                  { value: 'conic', label: 'Conic' }
                ]}
                onChange={(type) =>
                  patchBackground({ gradient: { ...background.gradient, type } })
                }
                className="w-[104px]"
              />
            </Row>
            {background.gradient.type !== 'radial' && (
              <Slider
                label="Angle"
                value={background.gradient.angle}
                min={0}
                max={360}
                unit="°"
                onChange={(angle) =>
                  patchBackground({ gradient: { ...background.gradient, angle } })
                }
                onCommit={snapshot}
              />
            )}
            <div className="space-y-1.5">
              {background.gradient.stops.map((stop, index) => (
                <div key={index} className="flex items-center gap-2">
                  <ColorPicker
                    value={stop.color}
                    onChange={(color) => updateStop(index, { color })}
                    onCommit={snapshot}
                    size="sm"
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(stop.pos * 100)}
                    onChange={(e) => updateStop(index, { pos: Number(e.target.value) / 100 })}
                    className="h-1 flex-1 accent-[#7c6cff]"
                  />
                  <span className="w-8 text-right font-mono text-[10.5px] text-text-3">
                    {Math.round(stop.pos * 100)}
                  </span>
                  <IconButton
                    className="h-6 w-6"
                    disabled={background.gradient.stops.length <= 2}
                    onClick={() => {
                      snapshot()
                      patchBackground({
                        gradient: {
                          ...background.gradient,
                          stops: background.gradient.stops.filter((_, i) => i !== index)
                        }
                      })
                    }}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </div>
              ))}
              <button
                onClick={() => {
                  snapshot()
                  patchBackground({
                    gradient: {
                      ...background.gradient,
                      stops: [...background.gradient.stops, { color: '#ffffff', pos: 1 }]
                    }
                  })
                }}
                className="focus-ring flex h-8 w-full items-center justify-center gap-1.5 rounded-ctl border border-dashed border-hair-strong text-[11.5px] font-medium text-text-3 transition-colors duration-150 hover:border-brand/60 hover:bg-brand/[0.07] hover:text-text-1"
              >
                <Plus size={12} /> Add stop
              </button>
            </div>
          </Section>
        </>
      )}

      {background.kind === 'mesh' && (
        <Section title="Mesh presets">
          <div className="grid grid-cols-3 gap-2">
            {MESHES.map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyMesh(preset.id)}
                className="focus-ring relative aspect-[4/3] overflow-hidden rounded-ctl border border-hair-strong shadow-[var(--shadow-raise)] transition-transform duration-150 ease-[var(--ease-out-soft)] hover:scale-105"
                style={{ background: preset.def.base }}
                title={preset.name}
              >
                {preset.def.points.map((p, i) => (
                  <span
                    key={i}
                    className="absolute rounded-full blur-md"
                    style={{
                      left: `${p.x * 100}%`,
                      top: `${p.y * 100}%`,
                      width: `${p.radius * 90}%`,
                      height: `${p.radius * 90}%`,
                      transform: 'translate(-50%, -50%)',
                      background: p.color,
                      opacity: 0.85
                    }}
                  />
                ))}
              </button>
            ))}
          </div>
          <div className="space-y-2 pt-1">
            {background.mesh.points.map((point, index) => (
              <div key={index} className="flex items-center gap-2">
                <ColorPicker
                  value={point.color}
                  onChange={(color) => {
                    const points = background.mesh.points.map((p, i) =>
                      i === index ? { ...p, color } : p
                    )
                    patchBackground({ mesh: { ...background.mesh, points } })
                  }}
                  onCommit={snapshot}
                  size="sm"
                />
                <span className="flex-1 text-[11.5px] text-text-3">Blob {index + 1}</span>
                <input
                  type="range"
                  min={20}
                  max={120}
                  value={Math.round(point.radius * 100)}
                  onChange={(e) => {
                    const points = background.mesh.points.map((p, i) =>
                      i === index ? { ...p, radius: Number(e.target.value) / 100 } : p
                    )
                    patchBackground({ mesh: { ...background.mesh, points } })
                  }}
                  className="h-1 w-20 accent-[#7c6cff]"
                />
              </div>
            ))}
          </div>
          <Row label="Base color">
            <ColorPicker
              value={background.mesh.base}
              onChange={(base) => patchBackground({ mesh: { ...background.mesh, base } })}
              onCommit={snapshot}
            />
          </Row>
        </Section>
      )}

      {background.kind === 'solid' && (
        <Section title="Color">
          <div className="grid grid-cols-6 gap-1.5">
            {SOLIDS.map((color) => (
              <button
                key={color}
                onClick={() => {
                  snapshot()
                  patchBackground({ solid: color })
                }}
                className={cn(
                  'focus-ring aspect-square rounded-ctl border transition-transform duration-150 ease-[var(--ease-out-soft)] hover:scale-108',
                  background.solid.toLowerCase() === color.toLowerCase()
                    ? 'sk-swatch-on border-brand-soft'
                    : 'border-hair-strong shadow-[var(--shadow-raise)]'
                )}
                style={{ background: color }}
              />
            ))}
          </div>
          <Row label="Custom">
            <ColorPicker
              value={background.solid}
              onChange={(solid) => patchBackground({ solid })}
              onCommit={snapshot}
            />
          </Row>
        </Section>
      )}

      {background.kind === 'image' && (
        <Section title="Image">
          <button
            onClick={pickImage}
            className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-ctl border border-dashed border-hair-strong text-[12px] font-medium text-text-2 transition-colors duration-150 hover:border-brand/60 hover:bg-brand/[0.07] hover:text-text-1"
          >
            <ImagePlus size={14} />
            {background.image.src ? 'Replace image' : 'Choose an image'}
          </button>
          {background.image.src && (
            <>
              <Row label="Fit">
                <Segmented
                  value={background.image.fit}
                  options={[
                    { value: 'cover', label: 'Cover' },
                    { value: 'contain', label: 'Fit' },
                    { value: 'tile', label: 'Tile' }
                  ]}
                  onChange={(fit) =>
                    patchBackground({ image: { ...background.image, fit } })
                  }
                  className="w-[150px]"
                />
              </Row>
              <Slider
                label="Blur"
                value={background.image.blur}
                min={0}
                max={80}
                unit="px"
                onChange={(blur) => patchBackground({ image: { ...background.image, blur } })}
                onCommit={snapshot}
              />
              <Slider
                label="Zoom"
                value={background.image.scale}
                min={0.5}
                max={2.5}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(scale) => patchBackground({ image: { ...background.image, scale } })}
                onCommit={snapshot}
              />
              <Slider
                label="Opacity"
                value={background.image.opacity}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(opacity) =>
                  patchBackground({ image: { ...background.image, opacity } })
                }
                onCommit={snapshot}
              />
            </>
          )}
        </Section>
      )}

      {background.kind !== 'transparent' && (
        <Section title="Finish">
          <Slider
            label="Grain"
            value={background.noise}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(noise) => patchBackground({ noise })}
            onCommit={snapshot}
          />
          <Slider
            label="Vignette"
            value={background.vignette}
            min={0}
            max={0.8}
            step={0.01}
            format={(v) => `${Math.round(v * 125)}%`}
            onChange={(vignette) => patchBackground({ vignette })}
            onCommit={snapshot}
          />
        </Section>
      )}
    </>
  )
}

export function WatermarkSection(): React.JSX.Element {
  const watermark = useEditor((s) => s.scene.watermark)
  const patchWatermark = useEditor((s) => s.patchWatermark)
  const snapshot = useEditor((s) => s.snapshot)

  return (
    <Section
      title="Watermark"
      action={
        <Switch
          checked={watermark.enabled}
          onChange={(enabled) => {
            snapshot()
            patchWatermark({ enabled })
          }}
        />
      }
    >
      {watermark.enabled && (
        <>
          <input
            value={watermark.text}
            onChange={(e) => patchWatermark({ text: e.target.value })}
            placeholder="Your text"
            className="sk-field h-8 w-full rounded-ctl px-2.5 text-[12px] text-text-1 placeholder:text-text-3"
          />
          <Row label="Position">
            <Select
              value={watermark.position}
              options={[
                { value: 'bottom-right', label: 'Bottom right' },
                { value: 'bottom-left', label: 'Bottom left' },
                { value: 'bottom-center', label: 'Bottom center' },
                { value: 'top-right', label: 'Top right' },
                { value: 'top-left', label: 'Top left' }
              ]}
              onChange={(position) => patchWatermark({ position })}
              className="w-[128px]"
            />
          </Row>
          <Row label="Color">
            <ColorPicker
              value={watermark.color}
              onChange={(color) => patchWatermark({ color })}
              onCommit={snapshot}
            />
          </Row>
          <Slider
            label="Size"
            value={watermark.size}
            min={8}
            max={48}
            onChange={(size) => patchWatermark({ size })}
            onCommit={snapshot}
          />
          <Slider
            label="Opacity"
            value={watermark.opacity}
            min={0.05}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(opacity) => patchWatermark({ opacity })}
            onCommit={snapshot}
          />
        </>
      )}
    </Section>
  )
}

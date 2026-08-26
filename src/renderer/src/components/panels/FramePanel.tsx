import * as React from 'react'
import { FlipHorizontal, FlipVertical, RotateCcw, RotateCw, Sparkles } from 'lucide-react'
import { useEditor } from '@/store/editor'
import { LOOKS, RATIOS } from '@/lib/presets'
import { ColorPicker, IconButton, Row, Section, Segmented, Select, Slider, Switch, Tip } from '../ui'
import { cn } from '@/lib/utils'

export function LooksSection(): React.JSX.Element {
  const applyLook = useEditor((s) => s.applyLook)
  const presets = useEditor((s) => s.presets)
  const applyPreset = useEditor((s) => s.applyPreset)
  const deletePreset = useEditor((s) => s.deletePreset)
  const savePreset = useEditor((s) => s.savePreset)
  const [name, setName] = React.useState('')

  return (
    <Section title="Looks">
      <div className="grid grid-cols-2 gap-1.5">
        {LOOKS.map((look) => (
          <button
            key={look.id}
            onClick={() => applyLook(look)}
            title={look.description}
            className="focus-ring group flex h-[38px] items-center gap-2 rounded-lg border border-hair bg-white/4 px-2.5 text-left transition-colors hover:border-hair-strong hover:bg-white/8"
          >
            <Sparkles size={13} className="shrink-0 text-text-3 group-hover:text-brand-soft" />
            <span className="truncate text-[12px] text-text-1">{look.name}</span>
          </button>
        ))}
      </div>

      {presets.length > 0 && (
        <div className="space-y-1 pt-1">
          {presets.map((preset) => (
            <div key={preset.id} className="flex items-center gap-1.5">
              <button
                onClick={() => applyPreset(preset)}
                className="focus-ring h-7 flex-1 truncate rounded-lg bg-white/4 px-2.5 text-left text-[12px] text-text-1 hover:bg-white/8"
              >
                {preset.name}
              </button>
              <IconButton className="h-7 w-7" onClick={() => deletePreset(preset.id)}>
                <RotateCcw size={12} className="rotate-45" />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Save current look as…"
          className="focus-ring h-7 min-w-0 flex-1 rounded-lg border border-hair bg-white/5 px-2.5 text-[11.5px] text-text-1 placeholder:text-text-3"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              savePreset(name.trim())
              setName('')
            }
          }}
        />
        <button
          disabled={!name.trim()}
          onClick={() => {
            savePreset(name.trim())
            setName('')
          }}
          className="focus-ring h-7 shrink-0 rounded-lg bg-white/8 px-2.5 text-[11.5px] text-text-1 hover:bg-white/14 disabled:opacity-35"
        >
          Save
        </button>
      </div>
    </Section>
  )
}

export function FramePanel(): React.JSX.Element {
  const canvas = useEditor((s) => s.scene.canvas)
  const frame = useEditor((s) => s.scene.frame)
  const crop = useEditor((s) => s.scene.crop)
  const patchCanvas = useEditor((s) => s.patchCanvas)
  const patchFrame = useEditor((s) => s.patchFrame)
  const patchShadow = useEditor((s) => s.patchShadow)
  const patchBorder = useEditor((s) => s.patchBorder)
  const patchBrowser = useEditor((s) => s.patchBrowser)
  const patchCrop = useEditor((s) => s.patchCrop)
  const snapshot = useEditor((s) => s.snapshot)

  return (
    <>
      <Section title="Canvas">
        <div className="grid grid-cols-3 gap-1.5">
          {RATIOS.map((ratio) => (
            <button
              key={ratio.id}
              title={ratio.hint}
              onClick={() => {
                snapshot()
                patchCanvas({ ratio: ratio.id })
              }}
              className={cn(
                'focus-ring h-7 rounded-lg border text-[11.5px] font-medium transition-colors',
                canvas.ratio === ratio.id
                  ? 'border-brand/50 bg-brand/16 text-brand-soft'
                  : 'border-hair bg-white/4 text-text-2 hover:bg-white/8'
              )}
            >
              {ratio.label}
            </button>
          ))}
        </div>
        <Slider
          label="Padding"
          value={canvas.padding}
          min={0}
          max={0.4}
          step={0.005}
          format={(v) => `${Math.round(v * 200)}`}
          onChange={(padding) => patchCanvas({ padding })}
          onCommit={snapshot}
        />
        <Row label="Auto balance" hint="Trim uniform edges from the capture">
          <Switch
            checked={canvas.autoBalance}
            onChange={(autoBalance) => patchCanvas({ autoBalance })}
          />
        </Row>
        <Row label="Orientation">
          <Tip label="Rotate left" side="top">
            <IconButton
              className="h-7 w-7"
              onClick={() => {
                snapshot()
                patchCrop({ quarterTurns: (crop.quarterTurns + 3) % 4 })
              }}
            >
              <RotateCcw size={13} />
            </IconButton>
          </Tip>
          <Tip label="Rotate right" side="top">
            <IconButton
              className="h-7 w-7"
              onClick={() => {
                snapshot()
                patchCrop({ quarterTurns: (crop.quarterTurns + 1) % 4 })
              }}
            >
              <RotateCw size={13} />
            </IconButton>
          </Tip>
          <Tip label="Flip horizontally" side="top">
            <IconButton
              className="h-7 w-7"
              active={crop.flipH}
              onClick={() => {
                snapshot()
                patchCrop({ flipH: !crop.flipH })
              }}
            >
              <FlipHorizontal size={13} />
            </IconButton>
          </Tip>
          <Tip label="Flip vertically" side="top">
            <IconButton
              className="h-7 w-7"
              active={crop.flipV}
              onClick={() => {
                snapshot()
                patchCrop({ flipV: !crop.flipV })
              }}
            >
              <FlipVertical size={13} />
            </IconButton>
          </Tip>
        </Row>
      </Section>

      <Section title="Frame">
        <Slider
          label="Corner radius"
          value={frame.radius}
          min={0}
          max={64}
          onChange={(radius) => patchFrame({ radius })}
          onCommit={snapshot}
        />
        <Slider
          label="Size"
          value={frame.scale}
          min={0.3}
          max={1.4}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(scale) => patchFrame({ scale })}
          onCommit={snapshot}
        />
        <Slider
          label="Reflection"
          value={frame.reflection}
          min={0}
          max={0.8}
          step={0.01}
          format={(v) => `${Math.round(v * 125)}%`}
          onChange={(reflection) => patchFrame({ reflection })}
          onCommit={snapshot}
        />
      </Section>

      <Section
        title="Shadow"
        action={
          <Switch
            checked={frame.shadow.enabled}
            onChange={(enabled) => {
              snapshot()
              patchShadow({ enabled })
            }}
          />
        }
      >
        {frame.shadow.enabled && (
          <>
            <Slider
              label="Blur"
              value={frame.shadow.blur}
              min={0}
              max={180}
              onChange={(blur) => patchShadow({ blur })}
              onCommit={snapshot}
            />
            <Slider
              label="Distance"
              value={frame.shadow.y}
              min={-80}
              max={160}
              onChange={(y) => patchShadow({ y })}
              onCommit={snapshot}
            />
            <Slider
              label="Offset X"
              value={frame.shadow.x}
              min={-120}
              max={120}
              onChange={(x) => patchShadow({ x })}
              onCommit={snapshot}
            />
            <Slider
              label="Spread"
              value={frame.shadow.spread}
              min={-20}
              max={60}
              onChange={(spread) => patchShadow({ spread })}
              onCommit={snapshot}
            />
            <Slider
              label="Opacity"
              value={frame.shadow.opacity}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(opacity) => patchShadow({ opacity })}
              onCommit={snapshot}
            />
            <Row label="Color">
              <ColorPicker
                value={frame.shadow.color}
                onChange={(color) => patchShadow({ color })}
                onCommit={snapshot}
              />
            </Row>
          </>
        )}
      </Section>

      <Section
        title="Border"
        action={
          <Switch
            checked={frame.border.enabled}
            onChange={(enabled) => {
              snapshot()
              patchBorder({ enabled })
            }}
          />
        }
      >
        {frame.border.enabled && (
          <>
            <Slider
              label="Width"
              value={frame.border.width}
              min={0.5}
              max={16}
              step={0.5}
              onChange={(width) => patchBorder({ width })}
              onCommit={snapshot}
            />
            <Row label="Color">
              <ColorPicker
                value={frame.border.color}
                onChange={(color) => patchBorder({ color })}
                onCommit={snapshot}
              />
            </Row>
            <Row label="Inside edge">
              <Switch
                checked={frame.border.inset}
                onChange={(inset) => patchBorder({ inset })}
              />
            </Row>
          </>
        )}
      </Section>

      <Section title="3D & position">
        <Slider
          label="Tilt X"
          value={frame.tiltX}
          min={-45}
          max={45}
          onChange={(tiltX) => patchFrame({ tiltX })}
          onCommit={snapshot}
          unit="°"
        />
        <Slider
          label="Tilt Y"
          value={frame.tiltY}
          min={-45}
          max={45}
          onChange={(tiltY) => patchFrame({ tiltY })}
          onCommit={snapshot}
          unit="°"
        />
        <Slider
          label="Rotate"
          value={frame.rotate}
          min={-30}
          max={30}
          step={0.5}
          onChange={(rotate) => patchFrame({ rotate })}
          onCommit={snapshot}
          unit="°"
        />
        <Slider
          label="Perspective"
          value={frame.perspective}
          min={400}
          max={4000}
          step={20}
          onChange={(perspective) => patchFrame({ perspective })}
          onCommit={snapshot}
        />
        <Slider
          label="Nudge X"
          value={frame.offsetX}
          min={-100}
          max={100}
          onChange={(offsetX) => patchFrame({ offsetX })}
          onCommit={snapshot}
        />
        <Slider
          label="Nudge Y"
          value={frame.offsetY}
          min={-100}
          max={100}
          onChange={(offsetY) => patchFrame({ offsetY })}
          onCommit={snapshot}
        />
        <button
          onClick={() => {
            snapshot()
            patchFrame({ tiltX: 0, tiltY: 0, rotate: 0, offsetX: 0, offsetY: 0, scale: 1 })
          }}
          className="focus-ring h-7 w-full rounded-lg bg-white/5 text-[11.5px] text-text-2 hover:bg-white/10 hover:text-text-1"
        >
          Reset transform
        </button>
      </Section>

      <Section title="Window chrome">
        <Row label="Style">
          <Select
            value={frame.browser.style}
            options={[
              { value: 'none', label: 'None' },
              { value: 'macos', label: 'macOS' },
              { value: 'macos-url', label: 'Browser' },
              { value: 'windows', label: 'Windows' },
              { value: 'minimal', label: 'Minimal' }
            ]}
            onChange={(style) => {
              snapshot()
              patchBrowser({ style })
            }}
            className="w-[118px]"
          />
        </Row>
        {frame.browser.style !== 'none' && (
          <>
            <Row label="Theme">
              <Segmented
                value={frame.browser.dark ? 'dark' : 'light'}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' }
                ]}
                onChange={(v) => patchBrowser({ dark: v === 'dark' })}
                className="w-[110px]"
              />
            </Row>
            {frame.browser.style === 'macos-url' ? (
              <input
                value={frame.browser.url}
                onChange={(e) => patchBrowser({ url: e.target.value })}
                placeholder="https://example.com"
                className="focus-ring h-7 w-full rounded-lg border border-hair bg-white/5 px-2.5 text-[12px] text-text-1 placeholder:text-text-3"
              />
            ) : (
              <input
                value={frame.browser.title}
                onChange={(e) => patchBrowser({ title: e.target.value })}
                placeholder="Window title"
                className="focus-ring h-7 w-full rounded-lg border border-hair bg-white/5 px-2.5 text-[12px] text-text-1 placeholder:text-text-3"
              />
            )}
          </>
        )}
      </Section>
    </>
  )
}

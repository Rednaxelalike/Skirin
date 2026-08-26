import * as React from 'react'
import { toast } from 'sonner'
import { Check, ClipboardCopy, Download, FolderOpen, Save } from 'lucide-react'
import type { ExportFormat } from '@shared/types'
import { useEditor } from '@/store/editor'
import { measureScene } from '@/lib/render'
import { renderAndEncode, suggestedName } from '@/lib/exporter'
import { formatBytes } from '@/lib/utils'
import { Row, Section, Segmented, Slider, Switch } from '../ui'

export function useExporter(): {
  busy: boolean
  copy: () => Promise<void>
  save: (askWhere?: boolean) => Promise<void>
  dimensions: { width: number; height: number } | null
} {
  const [busy, setBusy] = React.useState(false)

  const bundle = (): {
    scene: ReturnType<typeof useEditor.getState>['scene']
    images: Parameters<typeof measureScene>[1]
    name: string
  } | null => {
    const state = useEditor.getState()
    if (!state.capture || !state.images.base) return null
    return {
      scene: state.scene,
      images: {
        base: state.images.base,
        baseWidth: state.capture.width,
        baseHeight: state.capture.height,
        background: state.images.background,
        watermark: state.images.watermark
      },
      name: state.capture.sourceName
    }
  }

  const copy = async (): Promise<void> => {
    const data = bundle()
    if (!data) return
    setBusy(true)
    try {
      const settings = useEditor.getState().exportSettings
      const encoded = await renderAndEncode(data.scene, data.images, {
        ...settings,
        // The Windows clipboard is a bitmap surface — always hand it PNG.
        format: 'png'
      })
      const ok = await window.skirin.image.copy(encoded.dataUrl)
      if (ok) {
        toast.success('Copied to clipboard', {
          description: `${encoded.width} × ${encoded.height} · ${formatBytes(encoded.bytes)}`
        })
      } else {
        toast.error('Could not copy the image')
      }
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const save = async (askWhere = false): Promise<void> => {
    const data = bundle()
    if (!data) return
    setBusy(true)
    try {
      const state = useEditor.getState()
      const settings = state.exportSettings
      const encoded = await renderAndEncode(data.scene, data.images, settings)
      const result = await window.skirin.image.save(encoded.dataUrl, {
        format: settings.format,
        askWhere,
        suggestedName: suggestedName(data.name),
        width: encoded.width,
        height: encoded.height,
        sourceName: data.name
      })

      if (result.canceled) return
      if (!result.ok) {
        toast.error('Could not save', { description: result.error })
        return
      }

      if (state.settings?.copyOnExport) await window.skirin.image.copy(encoded.dataUrl)

      toast.success('Saved', {
        description: `${encoded.width} × ${encoded.height} · ${formatBytes(encoded.bytes)}`,
        action: {
          label: 'Show',
          onClick: () => void window.skirin.shell.reveal(result.path!)
        }
      })
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const scene = useEditor((s) => s.scene)
  const capture = useEditor((s) => s.capture)
  const baseImage = useEditor((s) => s.images.base)
  const exportScale = useEditor((s) => s.exportSettings.scale)

  const dimensions = React.useMemo(() => {
    if (!capture || !baseImage) return null
    const metrics = measureScene(scene, {
      base: baseImage,
      baseWidth: capture.width,
      baseHeight: capture.height
    })
    return {
      width: Math.round(metrics.naturalWidth * exportScale),
      height: Math.round(metrics.naturalHeight * exportScale)
    }
  }, [scene, capture, baseImage, exportScale])

  return { busy, copy, save, dimensions }
}

export function ExportPanel(): React.JSX.Element {
  const settings = useEditor((s) => s.exportSettings)
  const setExportSettings = useEditor((s) => s.setExportSettings)
  const appSettings = useEditor((s) => s.settings)
  const { busy, copy, save, dimensions } = useExporter()

  return (
    <>
      <Section title="Format">
        <Segmented
          value={settings.format}
          options={[
            { value: 'png' as ExportFormat, label: 'PNG' },
            { value: 'jpeg' as ExportFormat, label: 'JPEG' },
            { value: 'webp' as ExportFormat, label: 'WebP' }
          ]}
          onChange={(format) => setExportSettings({ format })}
        />
        <Row label="Resolution">
          <Segmented
            value={String(settings.scale)}
            options={[
              { value: '1', label: '1×' },
              { value: '2', label: '2×' },
              { value: '3', label: '3×' },
              { value: '4', label: '4×' }
            ]}
            onChange={(v) => setExportSettings({ scale: Number(v) })}
            className="w-[168px]"
          />
        </Row>
        {dimensions && (
          <div className="rounded-lg border border-hair bg-white/3 px-2.5 py-2 font-mono text-[11px] tabular-nums text-text-3">
            {dimensions.width} × {dimensions.height} px
          </div>
        )}
        {settings.format !== 'png' && (
          <Slider
            label="Quality"
            value={settings.quality}
            min={0.3}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(quality) => setExportSettings({ quality })}
          />
        )}
        {settings.format === 'png' && (
          <Row label="Transparent background" hint="Ignore the backdrop">
            <Switch
              checked={settings.transparent}
              onChange={(transparent) => setExportSettings({ transparent })}
            />
          </Row>
        )}
        <Row label="Keep under 1 MB" hint="Trims quality to fit chat apps">
          <Switch
            checked={settings.maxSizeKb === 1024}
            onChange={(on) => setExportSettings({ maxSizeKb: on ? 1024 : null })}
          />
        </Row>
      </Section>

      <Section title="Send it">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => void copy()}
            disabled={busy}
            className="focus-ring flex h-9 items-center justify-center gap-2 rounded-lg bg-white/8 text-[12px] font-medium text-text-1 hover:bg-white/14 disabled:opacity-40"
          >
            <ClipboardCopy size={14} /> Copy
          </button>
          <button
            onClick={() => void save(false)}
            disabled={busy}
            className="focus-ring flex h-9 items-center justify-center gap-2 rounded-lg bg-brand text-[12px] font-medium text-white hover:bg-brand/88 disabled:opacity-40"
          >
            <Download size={14} /> Save
          </button>
        </div>
        <button
          onClick={() => void save(true)}
          disabled={busy}
          className="focus-ring flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-hair text-[12px] text-text-2 hover:bg-white/6 hover:text-text-1 disabled:opacity-40"
        >
          <Save size={13} /> Save as…
        </button>
        {appSettings && (
          <button
            onClick={() => void window.skirin.shell.open(appSettings.saveDir)}
            className="focus-ring flex h-8 w-full items-center justify-center gap-2 rounded-lg text-[11.5px] text-text-3 hover:bg-white/5 hover:text-text-2"
          >
            <FolderOpen size={13} /> Open captures folder
          </button>
        )}
        <div className="flex items-start gap-2 rounded-lg border border-hair bg-white/3 px-2.5 py-2 text-[11px] leading-relaxed text-text-3">
          <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
          Saving also copies the result to your clipboard, so you can paste it straight into
          Slack, Notion or a PR.
        </div>
      </Section>
    </>
  )
}

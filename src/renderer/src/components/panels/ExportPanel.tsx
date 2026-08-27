import * as React from 'react'
import { toast } from 'sonner'
import { Check, ClipboardCopy, Download, FolderOpen, Loader2, Save } from 'lucide-react'
import type { ExportFormat } from '@shared/types'
import { useEditor } from '@/store/editor'
import { measureScene } from '@/lib/render'
import { suggestedName } from '@/lib/exporter'
import type { ExportPhase } from '@/lib/exporter'
import { exportImage } from '@/lib/export-client'
import { formatBytes } from '@/lib/utils'
import { Button, Row, Section, Segmented, Slider, Switch } from '../ui'

const PHASE_LABEL: Record<ExportPhase, string> = {
  composing: 'Composing…',
  encoding: 'Encoding…',
  fitting: 'Trimming to fit…'
}

export function useExporter(): {
  busy: string | null
  copy: () => Promise<void>
  save: (askWhere?: boolean) => Promise<void>
  dimensions: { width: number; height: number } | null
} {
  // App-wide rather than local: this hook is mounted three times over (here,
  // the title bar and the shortcut handler in App), and a local flag left each
  // copy blind to the others' work. Sharing the store's `busy` is what stops
  // Ctrl+S firing a second export on top of the first — which only became
  // reachable once the export stopped blocking the main thread.
  const busy = useEditor((s) => s.busy)
  const setBusy = useEditor((s) => s.setBusy)

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

  /** One heavy job at a time — the check and the claim share a tick. */
  const claim = (label: string): boolean => {
    if (useEditor.getState().busy) return false
    setBusy(label)
    return true
  }

  const copy = async (): Promise<void> => {
    const data = bundle()
    if (!data) return
    if (!claim(PHASE_LABEL.composing)) return
    try {
      const settings = useEditor.getState().exportSettings
      const encoded = await exportImage(
        data.scene,
        data.images,
        {
          ...settings,
          // The Windows clipboard is a bitmap surface — always hand it PNG.
          format: 'png'
        },
        (phase) => setBusy(PHASE_LABEL[phase])
      )
      const ok = await window.skirin.image.copy(encoded.blob)
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
      setBusy(null)
    }
  }

  const save = async (askWhere = false): Promise<void> => {
    const data = bundle()
    if (!data) return
    if (!claim(PHASE_LABEL.composing)) return
    try {
      const state = useEditor.getState()
      const settings = state.exportSettings
      const encoded = await exportImage(data.scene, data.images, settings, (phase) =>
        setBusy(PHASE_LABEL[phase])
      )
      const result = await window.skirin.image.save(encoded.blob, {
        format: settings.format,
        askWhere,
        suggestedName: suggestedName(data.name),
        width: encoded.width,
        height: encoded.height,
        sourceName: data.name,
        // Handed to the save rather than sent as a second call: the backend
        // has to decode the export for the history thumbnail either way, and
        // one decode of a 4x export is quite enough.
        copy: state.settings?.copyOnExport ?? false
      })

      if (result.canceled) return
      if (!result.ok) {
        toast.error('Could not save', { description: result.error })
        return
      }

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
      setBusy(null)
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
          <div className="sk-well rounded-ctl px-2.5 py-2 font-mono text-[11px] tabular-nums text-text-3">
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
          <Button variant="solid" size="lg" onClick={() => void copy()} disabled={!!busy}>
            <ClipboardCopy size={14} /> Copy
          </Button>
          <Button variant="brand" size="lg" onClick={() => void save(false)} disabled={!!busy}>
            <Download size={14} /> Save
          </Button>
        </div>
        <Button
          variant="ghost"
          onClick={() => void save(true)}
          disabled={!!busy}
          className="w-full"
        >
          <Save size={13} /> Save as…
        </Button>
        {busy && (
          // Says why all three buttons just went grey. `busy` is app-wide, so
          // this covers the annotate panel's OCR pass too — an export and a
          // scan both want the whole machine, and neither runs while the other
          // does.
          <div className="sk-well flex items-center gap-2 rounded-ctl px-2.5 py-2 text-[11px] text-text-2">
            <Loader2 size={12} className="shrink-0 animate-spin text-brand" />
            {busy}
          </div>
        )}
        {appSettings && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void window.skirin.shell.open(appSettings.saveDir)}
            className="w-full text-text-3"
          >
            <FolderOpen size={13} /> Open captures folder
          </Button>
        )}
        <div className="sk-well flex items-start gap-2 rounded-ctl px-2.5 py-2 text-[11px] leading-relaxed text-text-3">
          <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
          Saving also copies the result to your clipboard, so you can paste it straight into
          Slack, Notion or a PR.
        </div>
      </Section>
    </>
  )
}

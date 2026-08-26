import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { AppWindow, FolderOpen, Image as ImageIcon, RefreshCw, Trash2, X } from 'lucide-react'
import type { AfterCapture, AppSettings, HistoryEntry, WindowSource } from '@shared/types'
import { useEditor } from '@/store/editor'
import { LOOKS } from '@/lib/presets'
import { Button, Empty, Kbd, Row, Section, Segmented, Select, Slider, Switch } from './ui'
import { cn } from '@/lib/utils'

/* --------------------------------- shell --------------------------------- */

function Shell({
  open,
  onOpenChange,
  title,
  description,
  width = 'w-[560px]',
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  width?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            'animate-pop fixed left-1/2 top-1/2 z-50 flex max-h-[82vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-hair bg-ink-1/96 shadow-2xl shadow-black/70 backdrop-blur-2xl',
            width
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-hair px-5 py-4">
            <div>
              <Dialog.Title className="text-[14px] font-semibold text-text-1">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 text-[11.5px] text-text-3">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close className="focus-ring -mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-lg text-text-3 hover:bg-white/8 hover:text-text-1">
              <X size={14} />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ----------------------------- window picker ----------------------------- */

export function WindowPicker({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [sources, setSources] = React.useState<WindowSource[] | null>(null)
  const loadCapture = useEditor((s) => s.loadCapture)

  const refresh = React.useCallback(async () => {
    setSources(null)
    setSources(await window.skirin.capture.windowSources())
  }, [])

  React.useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const pick = async (id: string): Promise<void> => {
    onOpenChange(false)
    const capture = await window.skirin.capture.window(id)
    if (capture) await loadCapture(capture)
    else toast.error('That window could not be captured')
  }

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title="Capture a window"
      description="Windows are grabbed at full resolution, without the desktop behind them."
      width="w-[720px]"
    >
      <div className="p-4">
        {sources === null ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[124px] animate-pulse rounded-xl bg-white/5" />
            ))}
          </div>
        ) : sources.length === 0 ? (
          <Empty
            icon={<AppWindow size={18} />}
            title="No windows available"
            body="Open an app window and try again."
            action={
              <Button variant="subtle" onClick={() => void refresh()}>
                <RefreshCw size={13} /> Refresh
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {sources.map((source) => (
              <button
                key={source.id}
                onClick={() => void pick(source.id)}
                className="focus-ring group overflow-hidden rounded-xl border border-hair bg-white/3 text-left transition-colors hover:border-brand/50 hover:bg-white/7"
              >
                <div className="flex h-[104px] items-center justify-center overflow-hidden bg-black/30 p-2">
                  <img
                    src={source.thumbnail}
                    alt=""
                    className="max-h-full max-w-full rounded-md object-contain shadow-lg"
                  />
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-2">
                  {source.appIcon && <img src={source.appIcon} alt="" className="h-3.5 w-3.5" />}
                  <span className="truncate text-[11.5px] text-text-2 group-hover:text-text-1">
                    {source.name}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

/* -------------------------------- history -------------------------------- */

export function HistoryDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [items, setItems] = React.useState<HistoryEntry[]>([])
  const loadImageSource = useEditor((s) => s.loadImageSource)

  React.useEffect(() => {
    if (open) void window.skirin.history.get().then(setItems)
  }, [open])

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title="Recent captures"
      description="Everything Skirin has exported on this machine."
      width="w-[680px]"
    >
      <div className="p-4">
        {!items.length ? (
          <Empty
            icon={<ImageIcon size={18} />}
            title="Nothing exported yet"
            body="Saved screenshots land here so you can jump back to them."
          />
        ) : (
          <>
            <div className="mb-3 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => setItems(await window.skirin.history.clear())}
              >
                <Trash2 size={12} /> Clear history
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="group overflow-hidden rounded-xl border border-hair bg-white/3"
                >
                  <button
                    onClick={() => {
                      onOpenChange(false)
                      void loadImageSource(item.thumb, item.sourceName)
                    }}
                    className="focus-ring block h-[84px] w-full overflow-hidden bg-black/30"
                    title="Reopen in the editor"
                  >
                    <img src={item.thumb} alt="" className="h-full w-full object-cover" />
                  </button>
                  <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                    <span className="truncate text-[10.5px] text-text-3">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => void window.skirin.shell.reveal(item.file)}
                      className="focus-ring text-text-3 hover:text-text-1"
                      title="Show in Explorer"
                    >
                      <FolderOpen size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}

/* ------------------------------- shortcuts ------------------------------- */

const SHORTCUT_HELP: Array<[string, Array<[string, string]>]> = [
  [
    'Capture',
    [
      ['Capture an area', 'Ctrl Shift 1'],
      ['Capture the screen', 'Ctrl Shift 2'],
      ['Pick a window', 'Ctrl Shift 3'],
      ['Repeat last region', 'Ctrl Shift 4'],
      ['Open Skirin', 'Ctrl Shift S']
    ]
  ],
  [
    'Tools',
    [
      ['Select', 'V'],
      ['Crop', 'C'],
      ['Arrow', 'A'],
      ['Rectangle', 'R'],
      ['Ellipse', 'O'],
      ['Line', 'L'],
      ['Draw', 'D'],
      ['Text', 'T'],
      ['Step number', 'N'],
      ['Highlight', 'H'],
      ['Spotlight', 'S'],
      ['Blur', 'B'],
      ['Pixelate', 'P'],
      ['Redact', 'X']
    ]
  ],
  [
    'Editing',
    [
      ['Undo', 'Ctrl Z'],
      ['Redo', 'Ctrl Y'],
      ['Delete selection', 'Delete'],
      ['Duplicate selection', 'Ctrl D'],
      ['Nudge selection', 'Arrows'],
      ['Deselect / cancel', 'Esc'],
      ['Rule-of-thirds grid', 'G'],
      ['Constrain while dragging', 'Shift']
    ]
  ],
  [
    'Canvas & output',
    [
      ['Zoom', 'Ctrl Scroll'],
      ['Fit to window', 'Ctrl 0'],
      ['Copy result', 'Ctrl C'],
      ['Save result', 'Ctrl S'],
      ['Save as…', 'Ctrl Shift S'],
      ['Paste an image', 'Ctrl V'],
      ['Open an image', 'Ctrl O'],
      ['Cycle looks', '1 – 8']
    ]
  ]
]

export function ShortcutsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      width="w-[640px]"
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-5">
        {SHORTCUT_HELP.map(([group, rows]) => (
          <div key={group}>
            <h4 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-text-3">
              {group}
            </h4>
            <div className="space-y-1">
              {rows.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-text-2">{label}</span>
                  <div className="flex gap-1">
                    {keys.split(' ').map((key, i) => (
                      <Kbd key={i}>{key}</Kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  )
}

/* -------------------------------- settings ------------------------------- */

function ShortcutField({
  value,
  onChange
}: {
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const [recording, setRecording] = React.useState(false)

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    if (event.key === 'Escape') {
      setRecording(false)
      return
    }
    const parts: string[] = []
    if (event.ctrlKey) parts.push('Control')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push('Shift')
    if (event.metaKey) parts.push('Super')

    const key = event.key
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return
    const named =
      key.length === 1
        ? key.toUpperCase()
        : key === ' '
          ? 'Space'
          : key.replace(/^Arrow/, '')
    parts.push(named)
    if (parts.length < 2) return
    onChange(parts.join('+'))
    setRecording(false)
  }

  return (
    <button
      onKeyDown={onKeyDown}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      className={cn(
        'focus-ring h-7 min-w-[150px] rounded-lg border px-2.5 font-mono text-[11px] transition-colors',
        recording
          ? 'border-brand bg-brand/12 text-brand-soft'
          : 'border-hair bg-white/5 text-text-2 hover:bg-white/8'
      )}
    >
      {recording ? 'Press a combination…' : value.replace(/\+/g, ' + ')}
    </button>
  )
}

export function SettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const settings = useEditor((s) => s.settings)
  const setSettings = useEditor((s) => s.setSettings)

  const patch = async (value: Partial<AppSettings>): Promise<void> => {
    const next = await window.skirin.settings.set(value)
    setSettings(next)
  }

  if (!settings) return <></>

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Skirin keeps everything on this machine — nothing is uploaded."
      width="w-[600px]"
    >
      <Section title="Global shortcuts">
        <Row label="Capture an area">
          <ShortcutField
            value={settings.shortcuts.area}
            onChange={(area) => void patch({ shortcuts: { ...settings.shortcuts, area } })}
          />
        </Row>
        <Row label="Capture the screen">
          <ShortcutField
            value={settings.shortcuts.fullscreen}
            onChange={(fullscreen) =>
              void patch({ shortcuts: { ...settings.shortcuts, fullscreen } })
            }
          />
        </Row>
        <Row label="Pick a window">
          <ShortcutField
            value={settings.shortcuts.window}
            onChange={(w) => void patch({ shortcuts: { ...settings.shortcuts, window: w } })}
          />
        </Row>
        <Row label="Repeat last region">
          <ShortcutField
            value={settings.shortcuts.lastRegion}
            onChange={(lastRegion) =>
              void patch({ shortcuts: { ...settings.shortcuts, lastRegion } })
            }
          />
        </Row>
        <Row label="Open Skirin">
          <ShortcutField
            value={settings.shortcuts.openEditor}
            onChange={(openEditor) =>
              void patch({ shortcuts: { ...settings.shortcuts, openEditor } })
            }
          />
        </Row>
      </Section>

      <Section title="After a capture">
        <Row label="What happens next">
          <Select
            value={settings.afterCapture}
            options={[
              { value: 'editor' as AfterCapture, label: 'Open the editor' },
              { value: 'editor-copy' as AfterCapture, label: 'Editor + copy' },
              { value: 'copy' as AfterCapture, label: 'Copy only' },
              { value: 'save' as AfterCapture, label: 'Save only' },
              { value: 'copy-save' as AfterCapture, label: 'Copy and save' }
            ]}
            onChange={(afterCapture) => void patch({ afterCapture })}
            className="w-[168px]"
          />
        </Row>
        <Row label="Default look">
          <Select
            value={settings.defaultPresetId}
            options={LOOKS.map((l) => ({ value: l.id, label: l.name }))}
            onChange={(defaultPresetId) => void patch({ defaultPresetId })}
            className="w-[140px]"
          />
        </Row>
        <Slider
          label="Delay before capture"
          value={settings.captureDelay}
          min={0}
          max={10}
          format={(v) => (v === 0 ? 'None' : `${v}s`)}
          onChange={(captureDelay) => void patch({ captureDelay })}
        />
        <Row label="Copy on export" hint="Also put exports on the clipboard">
          <Switch
            checked={settings.copyOnExport}
            onChange={(copyOnExport) => void patch({ copyOnExport })}
          />
        </Row>
        <Row label="Remember last region">
          <Switch
            checked={settings.rememberLastRegion}
            onChange={(rememberLastRegion) => void patch({ rememberLastRegion })}
          />
        </Row>
      </Section>

      <Section title="Selection overlay">
        <Row label="Magnifier" hint="Pixel loupe while you drag">
          <Switch checked={settings.magnifier} onChange={(magnifier) => void patch({ magnifier })} />
        </Row>
      </Section>

      <Section title="Files">
        <Row label="Save folder" hint={settings.saveDir}>
          <Button variant="subtle" size="sm" onClick={() => void window.skirin.shell.open(settings.saveDir)}>
            <FolderOpen size={12} /> Open
          </Button>
        </Row>
        <Row label="Filename">
          <input
            value={settings.filenameTemplate}
            onChange={(e) => void patch({ filenameTemplate: e.target.value })}
            className="focus-ring h-7 w-[240px] rounded-lg border border-hair bg-white/5 px-2.5 font-mono text-[11px] text-text-1"
          />
        </Row>
        <Row label="Default format">
          <Segmented
            value={settings.exportDefaults.format}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'webp', label: 'WebP' }
            ]}
            onChange={(format) =>
              void patch({ exportDefaults: { ...settings.exportDefaults, format } })
            }
            className="w-[168px]"
          />
        </Row>
      </Section>

      <Section title="System">
        <Row label="Keep in the tray" hint="Closing the window hides it instead of quitting">
          <Switch checked={settings.showTray} onChange={(showTray) => void patch({ showTray })} />
        </Row>
        <Row label="Start with Windows">
          <Switch
            checked={settings.autoLaunch}
            onChange={(autoLaunch) => void patch({ autoLaunch })}
          />
        </Row>
      </Section>
    </Shell>
  )
}

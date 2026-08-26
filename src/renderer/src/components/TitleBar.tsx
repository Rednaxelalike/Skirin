import * as React from 'react'
import { toast } from 'sonner'
import {
  AppWindow,
  ClipboardPaste,
  Crop,
  FolderOpen,
  History,
  Keyboard,
  Monitor,
  Repeat,
  Settings,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useEditor } from '@/store/editor'
import { useExporter } from './panels/ExportPanel'
import { UpdatePill } from './UpdatePill'
import { Button, IconButton, Tip } from './ui'
import { clamp } from '@/lib/utils'

export function TitleBar({
  onOpenWindows,
  onOpenSettings,
  onOpenShortcuts,
  onOpenHistory
}: {
  onOpenWindows: () => void
  onOpenSettings: () => void
  onOpenShortcuts: () => void
  onOpenHistory: () => void
}): React.JSX.Element {
  const zoom = useEditor((s) => s.zoom)
  const setZoom = useEditor((s) => s.setZoom)
  const capture = useEditor((s) => s.capture)
  const loadCapture = useEditor((s) => s.loadCapture)
  const loadImageSource = useEditor((s) => s.loadImageSource)
  const settings = useEditor((s) => s.settings)
  const { busy, copy, save } = useExporter()

  const shoot = async (kind: 'area' | 'display' | 'last'): Promise<void> => {
    const result =
      kind === 'area'
        ? await window.skirin.capture.area()
        : kind === 'last'
          ? await window.skirin.capture.lastRegion()
          : await window.skirin.capture.display()
    if (result) await loadCapture(result)
  }

  const paste = async (): Promise<void> => {
    const dataUrl = await window.skirin.image.paste()
    if (!dataUrl) {
      toast.info('No image on the clipboard')
      return
    }
    await loadImageSource(dataUrl, 'Clipboard')
  }

  const openFile = async (): Promise<void> => {
    const dataUrl = await window.skirin.image.open()
    if (dataUrl) await loadImageSource(dataUrl, 'Imported image')
  }

  const zoomLabel = zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`

  return (
    <header className="drag-region flex h-10 shrink-0 items-center gap-1 border-b border-hair bg-ink-1/70 pl-2.5 pr-[148px] backdrop-blur-xl">
      <div className="no-drag flex items-center gap-2 pr-1.5">
        <Mark />
        <span className="text-[12.5px] font-semibold tracking-tight text-text-1">Skirin</span>
      </div>

      <div className="mx-1 h-4 w-px bg-hair" />

      <Tip label="Capture an area" hint={settings?.shortcuts.area} side="bottom">
        <Button variant="subtle" size="sm" onClick={() => void shoot('area')}>
          <Crop size={13} /> Area
        </Button>
      </Tip>
      <Tip label="Capture a window" hint={settings?.shortcuts.window} side="bottom">
        <Button variant="ghost" size="sm" onClick={onOpenWindows}>
          <AppWindow size={13} /> Window
        </Button>
      </Tip>
      <Tip label="Capture the whole screen" hint={settings?.shortcuts.fullscreen} side="bottom">
        <Button variant="ghost" size="sm" onClick={() => void shoot('display')}>
          <Monitor size={13} /> Screen
        </Button>
      </Tip>
      <Tip label="Repeat the last region" hint={settings?.shortcuts.lastRegion} side="bottom">
        <IconButton onClick={() => void shoot('last')} aria-label="Repeat last region">
          <Repeat size={15} />
        </IconButton>
      </Tip>

      <div className="mx-1 h-4 w-px bg-hair" />

      <Tip label="Paste from clipboard" hint="Ctrl V" side="bottom">
        <IconButton onClick={() => void paste()} aria-label="Paste">
          <ClipboardPaste size={15} />
        </IconButton>
      </Tip>
      <Tip label="Open an image" hint="Ctrl O" side="bottom">
        <IconButton onClick={() => void openFile()} aria-label="Open image">
          <FolderOpen size={15} />
        </IconButton>
      </Tip>
      <Tip label="Recent captures" side="bottom">
        <IconButton onClick={onOpenHistory} aria-label="History">
          <History size={15} />
        </IconButton>
      </Tip>

      <div className="flex-1" />

      {capture && (
        <div className="no-drag mr-1 flex items-center gap-0.5 rounded-lg bg-white/5 px-0.5">
          <IconButton
            className="h-7 w-7"
            onClick={() =>
              setZoom(clamp((zoom === 'fit' ? 1 : zoom) * 0.85, 0.08, 6))
            }
            aria-label="Zoom out"
          >
            <ZoomOut size={13} />
          </IconButton>
          <button
            onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}
            className="focus-ring h-7 min-w-[46px] rounded-md px-1.5 font-mono text-[11px] tabular-nums text-text-2 hover:bg-white/8 hover:text-text-1"
          >
            {zoomLabel}
          </button>
          <IconButton
            className="h-7 w-7"
            onClick={() => setZoom(clamp((zoom === 'fit' ? 1 : zoom) * 1.18, 0.08, 6))}
            aria-label="Zoom in"
          >
            <ZoomIn size={13} />
          </IconButton>
        </div>
      )}

      {capture && (
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void copy()}
            className="no-drag"
          >
            Copy
          </Button>
          <Button
            variant="brand"
            size="sm"
            disabled={busy}
            onClick={() => void save(false)}
            className="no-drag"
          >
            Save
          </Button>
        </>
      )}

      <div className="mx-1 h-4 w-px bg-hair" />

      <UpdatePill />

      <Tip label="Keyboard shortcuts" hint="?" side="bottom">
        <IconButton onClick={onOpenShortcuts} aria-label="Shortcuts">
          <Keyboard size={15} />
        </IconButton>
      </Tip>
      <Tip label="Settings" hint="Ctrl ," side="bottom">
        <IconButton onClick={onOpenSettings} aria-label="Settings">
          <Settings size={15} />
        </IconButton>
      </Tip>
    </header>
  )
}

function Mark(): React.JSX.Element {
  return (
    <span className="flex h-[19px] w-[19px] items-center justify-center rounded-[6px] bg-gradient-to-br from-[#7c6cff] via-[#a855f7] to-[#ff6ba8]">
      <CropMarks className="h-[11px] w-[11px]" />
    </span>
  )
}

/** The four corner brackets from the app icon. */
export function CropMarks({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        className="text-white"
      />
    </svg>
  )
}

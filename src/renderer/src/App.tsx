import * as React from 'react'
import { Toaster, toast } from 'sonner'
import { TitleBar } from './components/TitleBar'
import { Toolbar } from './components/Toolbar'
import { CanvasStage } from './components/CanvasStage'
import { Inspector } from './components/Inspector'
import { Welcome } from './components/Welcome'
import {
  HistoryDialog,
  SettingsDialog,
  ShortcutsDialog,
  WindowPicker
} from './components/Dialogs'
import { TooltipProvider } from './components/ui'
import { useExporter } from './components/panels/ExportPanel'
import { useEditor, setSceneImage } from './store/editor'
import type { Tool } from './store/editor'
import { LOOKS } from './lib/presets'
import { uid } from './lib/utils'

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  c: 'crop',
  a: 'arrow',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  d: 'pen',
  t: 'text',
  n: 'step',
  h: 'highlight',
  s: 'spotlight',
  b: 'blur',
  p: 'pixelate',
  x: 'redact'
}

export function App(): React.JSX.Element {
  const capture = useEditor((s) => s.capture)
  const setSettings = useEditor((s) => s.setSettings)
  const setPresets = useEditor((s) => s.setPresets)
  const loadCapture = useEditor((s) => s.loadCapture)
  const loadImageSource = useEditor((s) => s.loadImageSource)
  const backgroundSrc = useEditor((s) => s.scene.background.image.src)

  const [windows, setWindows] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)

  const { copy, save } = useExporter()

  /* ------------------------------ bootstrap ----------------------------- */

  React.useEffect(() => {
    void window.skirin.settings.get().then(setSettings)
    void window.skirin.presets.get().then(setPresets)
    return window.skirin.settings.onChange(setSettings)
  }, [setSettings, setPresets])

  React.useEffect(
    () =>
      window.skirin.capture.onCapture((incoming) => {
        void loadCapture(incoming)
      }),
    [loadCapture]
  )

  React.useEffect(() => window.skirin.ui.onOpenWindowPicker(() => setWindows(true)), [])
  React.useEffect(() => window.skirin.ui.onOpenSettings(() => setSettingsOpen(true)), [])

  // Keep the decoded background bitmap in step with the stored source.
  React.useEffect(() => {
    void setSceneImage('background', backgroundSrc)
  }, [backgroundSrc])

  /* ------------------------------ shortcuts ----------------------------- */

  React.useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useEditor.getState()
      const mod = event.ctrlKey || event.metaKey

      if (event.key === 'Escape') {
        state.select(null)
        state.setEditingText(null)
        if (state.tool !== 'select') state.setTool('select')
        return
      }

      if (isTyping(event.target)) return

      if (mod) {
        switch (event.key.toLowerCase()) {
          case 'z':
            event.preventDefault()
            event.shiftKey ? state.redo() : state.undo()
            return
          case 'y':
            event.preventDefault()
            state.redo()
            return
          case 'c':
            event.preventDefault()
            void copy()
            return
          case 's':
            event.preventDefault()
            void save(event.shiftKey)
            return
          case 'o':
            event.preventDefault()
            void window.skirin.image.open().then((opened) => {
              if (opened) void loadImageSource(opened.src, 'Imported image')
            })
            return
          case 'v':
            event.preventDefault()
            void window.skirin.image.paste().then((pasted) => {
              if (pasted) void loadImageSource(pasted.src, 'Clipboard')
              else toast.info('No image on the clipboard')
            })
            return
          case 'd': {
            event.preventDefault()
            const selected = state.scene.annotations.find((a) => a.id === state.selectedId)
            if (selected) {
              state.pushAnnotations([
                { ...selected, id: uid('an-'), x: selected.x + 0.02, y: selected.y + 0.02 }
              ])
            }
            return
          }
          case ',':
            event.preventDefault()
            setSettingsOpen(true)
            return
          case '0':
            event.preventDefault()
            state.setZoom('fit')
            return
        }
        return
      }

      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        setShortcutsOpen(true)
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selectedId) {
          event.preventDefault()
          state.removeAnnotation(state.selectedId)
        }
        return
      }

      if (event.key.startsWith('Arrow') && state.selectedId) {
        event.preventDefault()
        const step = event.shiftKey ? 0.02 : 0.004
        const selected = state.scene.annotations.find((a) => a.id === state.selectedId)
        if (!selected) return
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        if (selected.type === 'pen') {
          state.updateAnnotation(selected.id, {
            points: selected.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
          })
        } else {
          state.updateAnnotation(selected.id, { x: selected.x + dx, y: selected.y + dy })
        }
        return
      }

      if (event.key === 'g') {
        state.toggleGrid()
        return
      }

      if (/^[1-8]$/.test(event.key)) {
        const look = LOOKS[Number(event.key) - 1]
        if (look) state.applyLook(look)
        return
      }

      const tool = TOOL_KEYS[event.key.toLowerCase()]
      if (tool && state.capture) state.setTool(tool)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [copy, save, loadImageSource])

  /* --------------------------------- ui --------------------------------- */

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-hidden bg-ink-0/72">
        <TitleBar
          onOpenWindows={() => setWindows(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onOpenHistory={() => setHistoryOpen(true)}
        />

        <div className="flex min-h-0 flex-1">
          <Toolbar />
          {capture ? (
            <>
              <CanvasStage />
              <Inspector />
            </>
          ) : (
            <Welcome onOpenWindows={() => setWindows(true)} />
          )}
        </div>
      </div>

      <WindowPicker open={windows} onOpenChange={setWindows} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />

      <Toaster
        theme="dark"
        position="bottom-center"
        offset={20}
        toastOptions={{
          // Same recipe as every other floating surface: a lit top edge, a
          // hairline, and two drops at different radii.
          style: {
            background: 'rgba(22,22,29,0.95)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            color: '#f6f6f9',
            fontFamily: 'inherit',
            letterSpacing: '-0.008em',
            boxShadow:
              'inset 0 1px 0 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(0,0,0,0.45), 0 16px 40px -12px rgba(0,0,0,0.72), 0 4px 12px -4px rgba(0,0,0,0.58)',
            backdropFilter: 'blur(28px) saturate(1.4)'
          }
        }}
      />
    </TooltipProvider>
  )
}

import * as React from 'react'
import { AppWindow, ClipboardPaste, Crop, ImageDown, Monitor } from 'lucide-react'
import { useEditor } from '@/store/editor'
import { CropMarks } from './TitleBar'
import { Kbd } from './ui'
import { cn } from '@/lib/utils'

export function Welcome({ onOpenWindows }: { onOpenWindows: () => void }): React.JSX.Element {
  const loadCapture = useEditor((s) => s.loadCapture)
  const loadImageSource = useEditor((s) => s.loadImageSource)
  const settings = useEditor((s) => s.settings)
  const [dragging, setDragging] = React.useState(false)

  const actions = [
    {
      icon: <Crop size={18} />,
      title: 'Capture an area',
      hint: settings?.shortcuts.area ?? 'Ctrl+Shift+1',
      run: async () => {
        const capture = await window.skirin.capture.area()
        if (capture) await loadCapture(capture)
      }
    },
    {
      icon: <AppWindow size={18} />,
      title: 'Capture a window',
      hint: settings?.shortcuts.window ?? 'Ctrl+Shift+3',
      run: async () => onOpenWindows()
    },
    {
      icon: <Monitor size={18} />,
      title: 'Capture the screen',
      hint: settings?.shortcuts.fullscreen ?? 'Ctrl+Shift+2',
      run: async () => {
        const capture = await window.skirin.capture.display()
        if (capture) await loadCapture(capture)
      }
    },
    {
      icon: <ClipboardPaste size={18} />,
      title: 'Paste an image',
      hint: 'Ctrl+V',
      run: async () => {
        const dataUrl = await window.skirin.image.paste()
        if (dataUrl) await loadImageSource(dataUrl, 'Clipboard')
      }
    }
  ]

  const onDrop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => void loadImageSource(String(reader.result), file.name)
    reader.readAsDataURL(file)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className="flex flex-1 items-center justify-center p-10"
    >
      <div
        className={cn(
          'flex w-full max-w-[540px] flex-col items-center rounded-2xl border border-dashed p-9 transition-colors',
          dragging ? 'border-brand bg-brand/8' : 'border-hair'
        )}
      >
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c6cff] via-[#a855f7] to-[#ff6ba8] shadow-[0_12px_40px_-10px_rgba(124,108,255,0.7)]">
          <CropMarks className="h-8 w-8" />
        </div>

        <h1 className="text-[19px] font-semibold tracking-tight text-text-1">
          Make a screenshot worth sharing
        </h1>
        <p className="mt-1.5 max-w-[380px] text-center text-[12.5px] leading-relaxed text-text-2">
          Capture, then dress it in gradients, padding, shadows and annotations — and paste it
          anywhere in a couple of seconds.
        </p>

        <div className="mt-7 grid w-full grid-cols-2 gap-2">
          {actions.map((action) => (
            <button
              key={action.title}
              onClick={() => void action.run()}
              className="focus-ring group flex items-center gap-3 rounded-xl border border-hair bg-white/4 px-3.5 py-3 text-left transition-colors hover:border-hair-strong hover:bg-white/8"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/6 text-text-2 transition-colors group-hover:text-brand-soft">
                {action.icon}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-text-1">
                  {action.title}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10.5px] text-text-3">
                  {action.hint}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-2 text-[11.5px] text-text-3">
          <ImageDown size={13} />
          Drop an image here, or press <Kbd>Ctrl</Kbd> <Kbd>O</Kbd> to open one
        </div>
      </div>
    </div>
  )
}

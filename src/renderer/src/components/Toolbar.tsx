import * as React from 'react'
import {
  ArrowUpRight,
  Circle,
  Crop,
  Droplets,
  Eraser,
  Grid3x3,
  Hand,
  Highlighter,
  ListOrdered,
  Minus,
  MousePointer2,
  Grid2x2,
  Pencil,
  Redo2,
  Square,
  SunDim,
  Type,
  Undo2
} from 'lucide-react'
import { useEditor } from '@/store/editor'
import type { Tool } from '@/store/editor'
import { ANNOTATION_COLORS } from '@/lib/presets'
import { ColorPicker, IconButton, Tip } from './ui'
import { cn } from '@/lib/utils'

interface ToolDef {
  id: Tool
  icon: React.ReactNode
  label: string
  key: string
}

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', icon: <MousePointer2 size={16} />, label: 'Select', key: 'V' },
    { id: 'pan', icon: <Hand size={16} />, label: 'Pan', key: 'Space' },
    { id: 'crop', icon: <Crop size={16} />, label: 'Crop', key: 'C' }
  ],
  [
    { id: 'arrow', icon: <ArrowUpRight size={16} />, label: 'Arrow', key: 'A' },
    { id: 'rect', icon: <Square size={16} />, label: 'Rectangle', key: 'R' },
    { id: 'ellipse', icon: <Circle size={16} />, label: 'Ellipse', key: 'O' },
    { id: 'line', icon: <Minus size={16} />, label: 'Line', key: 'L' },
    { id: 'pen', icon: <Pencil size={16} />, label: 'Draw', key: 'D' },
    { id: 'text', icon: <Type size={16} />, label: 'Text', key: 'T' },
    { id: 'step', icon: <ListOrdered size={16} />, label: 'Step number', key: 'N' }
  ],
  [
    { id: 'highlight', icon: <Highlighter size={16} />, label: 'Highlight', key: 'H' },
    { id: 'spotlight', icon: <SunDim size={16} />, label: 'Spotlight', key: 'S' },
    { id: 'blur', icon: <Droplets size={16} />, label: 'Blur', key: 'B' },
    { id: 'pixelate', icon: <Grid2x2 size={16} />, label: 'Pixelate', key: 'P' },
    { id: 'redact', icon: <Eraser size={16} />, label: 'Redact', key: 'X' }
  ]
]

export function Toolbar(): React.JSX.Element {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const toolColor = useEditor((s) => s.toolColor)
  const setToolColor = useEditor((s) => s.setToolColor)
  const toolStroke = useEditor((s) => s.toolStroke)
  const setToolStroke = useEditor((s) => s.setToolStroke)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const showGrid = useEditor((s) => s.showGrid)
  const toggleGrid = useEditor((s) => s.toggleGrid)
  const hasCapture = useEditor((s) => !!s.capture)

  const strokeVisible = ['arrow', 'line', 'rect', 'ellipse', 'pen'].includes(tool)

  return (
    <aside
      className={cn(
        'flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-hair bg-ink-1/60 py-2.5 backdrop-blur-xl',
        !hasCapture && 'pointer-events-none opacity-40'
      )}
    >
      {GROUPS.map((group, index) => (
        <React.Fragment key={index}>
          {index > 0 && <div className="my-1 h-px w-6 bg-hair" />}
          {group.map((item) => (
            <Tip key={item.id} label={item.label} hint={item.key}>
              <IconButton
                active={tool === item.id}
                onClick={() => setTool(item.id)}
                aria-label={item.label}
              >
                {item.icon}
              </IconButton>
            </Tip>
          ))}
        </React.Fragment>
      ))}

      <div className="my-1 h-px w-6 bg-hair" />

      <Tip label="Annotation color">
        <div className="flex h-8 w-8 items-center justify-center">
          <ColorPicker
            value={toolColor}
            onChange={setToolColor}
            swatches={ANNOTATION_COLORS}
            size="sm"
          />
        </div>
      </Tip>

      {strokeVisible && (
        <div className="mt-1 w-full px-2">
          <StrokeDots value={toolStroke} onChange={setToolStroke} />
        </div>
      )}

      <div className="flex-1" />

      <Tip label="Rule of thirds" hint="G">
        <IconButton active={showGrid} onClick={toggleGrid} aria-label="Toggle grid">
          <Grid3x3 size={16} />
        </IconButton>
      </Tip>
      <Tip label="Undo" hint="Ctrl Z">
        <IconButton onClick={undo} disabled={!canUndo} aria-label="Undo">
          <Undo2 size={16} />
        </IconButton>
      </Tip>
      <Tip label="Redo" hint="Ctrl Y">
        <IconButton onClick={redo} disabled={!canRedo} aria-label="Redo">
          <Redo2 size={16} />
        </IconButton>
      </Tip>
    </aside>
  )
}

function StrokeDots({
  value,
  onChange
}: {
  value: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const sizes = [3, 6, 10, 16]
  return (
    <div className="sk-well flex flex-col items-center gap-1.5 rounded-[10px] py-1.5">
      {sizes.map((size) => (
        <button
          key={size}
          onClick={() => onChange(size)}
          className="focus-ring flex h-5 w-5 items-center justify-center rounded-[6px] transition-colors duration-150 hover:bg-white/[0.08]"
          aria-label={`Stroke ${size}`}
        >
          <span
            className={cn(
              'block rounded-full transition-[background-color,box-shadow] duration-150',
              value === size
                ? 'bg-brand-soft shadow-[0_0_8px_0_color-mix(in_srgb,var(--color-brand)_80%,transparent)]'
                : 'bg-text-3'
            )}
            style={{ width: size / 1.6 + 3, height: size / 1.6 + 3 }}
          />
        </button>
      ))}
    </div>
  )
}

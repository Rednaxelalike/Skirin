import * as React from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { Frame, Palette, PenLine, Share2 } from 'lucide-react'
import { BackgroundPanel, WatermarkSection } from './panels/BackgroundPanel'
import { FramePanel, LooksSection } from './panels/FramePanel'
import { AnnotatePanel } from './panels/AnnotatePanel'
import { ExportPanel } from './panels/ExportPanel'
import { cn } from '@/lib/utils'

const TABS = [
  { value: 'style', label: 'Style', icon: <Palette size={14} /> },
  { value: 'frame', label: 'Frame', icon: <Frame size={14} /> },
  { value: 'annotate', label: 'Mark', icon: <PenLine size={14} /> },
  { value: 'export', label: 'Export', icon: <Share2 size={14} /> }
]

export function Inspector(): React.JSX.Element {
  const [tab, setTab] = React.useState('style')

  return (
    <aside className="flex w-[302px] shrink-0 flex-col border-l border-hair bg-ink-1/60 backdrop-blur-xl">
      <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-hair p-2">
          {/* One segmented control, not four loose buttons: the well holds the
              group together and the raised active tab reads as pressed out of
              it. */}
          <Tabs.List className="sk-well flex rounded-[10px] p-1">
            {TABS.map((item) => (
              <Tabs.Trigger
                key={item.value}
                value={item.value}
                className={cn(
                  'focus-ring flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-transparent',
                  'text-[12px] font-medium text-text-3',
                  'transition-[background-color,color,box-shadow,border-color] duration-150 ease-[var(--ease-out-soft)]',
                  'hover:bg-white/[0.04] hover:text-text-2',
                  'data-[state=active]:border-hair data-[state=active]:bg-ink-4 data-[state=active]:text-text-1',
                  'data-[state=active]:shadow-[var(--shadow-raise)]'
                )}
              >
                {item.icon}
                {item.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>

        <ScrollArea.Root className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea.Viewport className="h-full w-full">
            <Tabs.Content value="style" className="focus:outline-none">
              <LooksSection />
              <BackgroundPanel />
              <WatermarkSection />
            </Tabs.Content>
            <Tabs.Content value="frame" className="focus:outline-none">
              <FramePanel />
            </Tabs.Content>
            <Tabs.Content value="annotate" className="focus:outline-none">
              <AnnotatePanel />
            </Tabs.Content>
            <Tabs.Content value="export" className="focus:outline-none">
              <ExportPanel />
            </Tabs.Content>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar
            orientation="vertical"
            className="flex w-2.5 touch-none select-none p-0.5 transition-colors duration-150"
          >
            <ScrollArea.Thumb className="flex-1 rounded-full bg-white/[0.14] transition-colors hover:bg-white/25" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </Tabs.Root>
    </aside>
  )
}

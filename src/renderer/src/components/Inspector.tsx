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
        <Tabs.List className="flex shrink-0 gap-0.5 border-b border-hair px-2 py-2">
          {TABS.map((item) => (
            <Tabs.Trigger
              key={item.value}
              value={item.value}
              className={cn(
                'focus-ring flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium transition-colors',
                'text-text-3 hover:text-text-2',
                'data-[state=active]:bg-white/8 data-[state=active]:text-text-1'
              )}
            >
              {item.icon}
              {item.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

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
            className="flex w-2 touch-none select-none p-0.5"
          >
            <ScrollArea.Thumb className="flex-1 rounded-full bg-white/14" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </Tabs.Root>
    </aside>
  )
}

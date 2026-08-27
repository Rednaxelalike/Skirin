import * as React from 'react'
import { toast } from 'sonner'
import { ArrowUpCircle, Loader2, RotateCw } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'

const IDLE: UpdateStatus = {
  state: 'idle',
  version: null,
  notes: null,
  percent: 0,
  error: null
}

/**
 * Live update state for the title bar. The main process pushes every
 * transition, so this only mirrors — it never polls.
 */
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = React.useState<UpdateStatus>(IDLE)

  React.useEffect(() => {
    let alive = true
    void window.skirin.update.status().then((s) => {
      if (alive) setStatus(s)
    })
    const off = window.skirin.update.onStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])

  // One toast per version, once the download lands. The main process restarts
  // on its own a beat later; the action is only here in case that stalls.
  const announced = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (status.state !== 'ready' || !status.version) return
    if (announced.current === status.version) return
    announced.current = status.version
    toast.success(`Skirin ${status.version} downloaded`, {
      description: 'Restarting to finish installing…',
      duration: 12_000,
      action: {
        label: 'Restart now',
        onClick: () => void window.skirin.update.install()
      }
    })
  }, [status.state, status.version])

  return status
}

/**
 * Only visible when there is something to say. One click on Update carries the
 * whole way through — download, install, relaunch — so there is no second
 * button to hunt for.
 */
export function UpdatePill(): React.JSX.Element | null {
  const status = useUpdateStatus()

  if (status.state === 'idle' || status.state === 'checking' || status.state === 'error') {
    return null
  }

  const base =
    'no-drag focus-ring flex h-7 items-center gap-1.5 rounded-ctl border px-2 text-[11.5px] font-medium transition-[background-color,box-shadow] duration-150'

  if (status.state === 'available') {
    const start = (): void => {
      toast.info(`Updating to Skirin ${status.version}`, {
        description: 'Downloading now — Skirin will restart when it lands.'
      })
      void window.skirin.update.download()
    }
    return (
      <button
        onClick={start}
        className={`${base} sk-selected border-transparent`}
        title={`Skirin ${status.version} is available — click to install it`}
      >
        <ArrowUpCircle size={13} />
        Update
      </button>
    )
  }

  if (status.state === 'downloading') {
    return (
      <span
        className={`${base} sk-well border-hair text-text-2`}
        title="Downloading — Skirin restarts automatically when this finishes"
      >
        <Loader2 size={13} className="animate-spin" />
        <span className="font-mono tabular-nums">{status.percent}%</span>
      </span>
    )
  }

  return (
    <button
      onClick={() => void window.skirin.update.install()}
      className={`${base} border-emerald-400/30 bg-emerald-500/15 text-emerald-300 shadow-[0_2px_10px_-4px_#10b981a6] hover:bg-emerald-500/25`}
      title={`Restarting into Skirin ${status.version}`}
    >
      <RotateCw size={13} />
      Restarting…
    </button>
  )
}

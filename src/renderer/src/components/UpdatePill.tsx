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

  // One toast per version, the moment a build is ready to install.
  const announced = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (status.state !== 'ready' || !status.version) return
    if (announced.current === status.version) return
    announced.current = status.version
    toast.success(`Skirin ${status.version} is ready`, {
      description: 'Restart to finish installing.',
      duration: 10_000,
      action: {
        label: 'Restart',
        onClick: () => void window.skirin.update.install()
      }
    })
  }, [status.state, status.version])

  return status
}

/**
 * Only visible when there is something to say — an available build, a download
 * in flight, or an install waiting on a restart.
 */
export function UpdatePill(): React.JSX.Element | null {
  const status = useUpdateStatus()

  if (status.state === 'idle' || status.state === 'checking' || status.state === 'error') {
    return null
  }

  const base =
    'no-drag focus-ring flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-medium transition-colors'

  if (status.state === 'available') {
    return (
      <button
        onClick={() => void window.skirin.update.download()}
        className={`${base} bg-brand/15 text-brand hover:bg-brand/25`}
        title={`Skirin ${status.version} is available`}
      >
        <ArrowUpCircle size={13} />
        Update
      </button>
    )
  }

  if (status.state === 'downloading') {
    return (
      <span className={`${base} bg-white/6 text-text-2`} title="Downloading the update">
        <Loader2 size={13} className="animate-spin" />
        <span className="font-mono tabular-nums">{status.percent}%</span>
      </span>
    )
  }

  return (
    <button
      onClick={() => void window.skirin.update.install()}
      className={`${base} bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25`}
      title={`Restart to install Skirin ${status.version}`}
    >
      <RotateCw size={13} />
      Restart
    </button>
  )
}

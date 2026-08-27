import * as React from 'react'

/**
 * The app mark: the desktop icon, redrawn as vector so it stays crisp at 19px
 * in the title bar and at 56px on the welcome screen.
 *
 * Every number here is the matching constant from `scripts/icon-art.mjs`,
 * multiplied by the 64-unit viewBox — the body radius, where the brackets
 * start and stop, how far the glass slab is lifted off the face. The renderer
 * shades those shapes per pixel with a light model; this one fakes the same
 * result with four gradients, which is all that survives at these sizes
 * anyway. If the icon's proportions change, they change in one place and this
 * file follows.
 */
export function SkirinMark({ className }: { className?: string }): React.JSX.Element {
  /* Gradient ids have to be unique — the mark is on screen twice at once. */
  const id = React.useId()
  const g = (name: string): string => `${id}-${name}`

  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={g('body')} x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#454C56" />
          <stop offset="0.5" stopColor="#2A2F35" />
          <stop offset="1" stopColor="#0C0E12" />
        </linearGradient>
        <radialGradient id={g('sheen')} cx="0.26" cy="0.16" r="0.78">
          <stop offset="0" stopColor="#9FB2CE" stopOpacity="0.13" />
          <stop offset="1" stopColor="#8FA2BF" stopOpacity="0" />
        </radialGradient>
        {/* The hairline of light where the top of the squircle turns away. */}
        <linearGradient id={g('rim')} x1="0" y1="0" x2="0" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.24" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id={g('glass')}
          x1="18"
          y1="18"
          x2="46"
          y2="47"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#3F7DC4" />
          <stop offset="0.5" stopColor="#3497F3" />
          <stop offset="1" stopColor="#6FC4FF" />
        </linearGradient>
        {/* The bevel: near-white where the key light hits it square on. */}
        <linearGradient
          id={g('bevel')}
          x1="0"
          y1="17"
          x2="0"
          y2="47"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#96D0FF" stopOpacity="0.95" />
          <stop offset="0.4" stopColor="#BEE4FF" stopOpacity="0.06" />
          <stop offset="1" stopColor="#AEE6FF" stopOpacity="0.8" />
        </linearGradient>
        <filter id={g('lift')} x="-40%" y="-40%" width="180%" height="190%">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.7" floodColor="#04070C" floodOpacity="0.6" />
        </filter>
      </defs>

      {/* body */}
      <rect width="64" height="64" rx="14.43" fill={`url(#${g('body')})`} />
      <rect width="64" height="64" rx="14.43" fill={`url(#${g('sheen')})`} />
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="63"
        rx="13.93"
        fill="none"
        stroke={`url(#${g('rim')})`}
        strokeWidth="1"
      />

      {/* the four crop brackets, raised off the face */}
      <g
        fill="none"
        stroke="#D9E0EE"
        strokeWidth="2.24"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9.22 19.33V12.93A3.71 3.71 0 0 1 12.93 9.22h6.4" />
        <path d="M44.67 9.22h6.4a3.71 3.71 0 0 1 3.71 3.71v6.4" />
        <path d="M54.78 44.67v6.4a3.71 3.71 0 0 1-3.71 3.71h-6.4" />
        <path d="M19.33 54.78h-6.4a3.71 3.71 0 0 1-3.71-3.71v-6.4" />
      </g>

      {/* the glass slab: side wall, near face, bevel */}
      <g filter={`url(#${g('lift')})`}>
        <rect x="17.34" y="19.2" width="30.46" height="30.46" rx="6.46" fill="#1C4B7C" />
        <rect x="16.77" y="16.77" width="30.46" height="30.46" rx="6.46" fill={`url(#${g('glass')})`} />
        <rect
          x="17.37"
          y="17.37"
          width="29.26"
          height="29.26"
          rx="5.86"
          fill="none"
          stroke={`url(#${g('bevel')})`}
          strokeWidth="1.2"
        />
      </g>
    </svg>
  )
}

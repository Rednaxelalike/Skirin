import * as React from 'react'
import * as RSlider from '@radix-ui/react-slider'
import * as RSwitch from '@radix-ui/react-switch'
import * as RTooltip from '@radix-ui/react-tooltip'
import * as RPopover from '@radix-ui/react-popover'
import * as RSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * The control kit.
 *
 * Every control here is built from the same four primitives, defined in
 * `styles.css`: `sk-raise` (a lit surface that sits above the panel),
 * `sk-well` (a channel carved into it), `sk-brand` (the violet call to
 * action) and `sk-field` (a recessed input). Anything that reads as raised
 * gets a hairline of light along its top edge and two soft drops beneath it;
 * anything recessed gets the same trick inverted. That single rule is what
 * makes the set look like one piece of hardware rather than a pile of divs.
 */

/* -------------------------------- tooltip -------------------------------- */

export function TooltipProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <RTooltip.Provider delayDuration={420} skipDelayDuration={200}>
      {children}
    </RTooltip.Provider>
  )
}

export function Tip({
  label,
  hint,
  side = 'right',
  children
}: {
  label: string
  hint?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={8}
          className="sk-pop animate-pop z-50 flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[11.5px] font-medium text-text-1"
        >
          {label}
          {hint && <Kbd>{hint}</Kbd>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

/* -------------------------------- buttons -------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'solid' | 'brand' | 'subtle'
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'ghost', size = 'md', active, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'focus-ring no-drag inline-flex shrink-0 items-center justify-center gap-1.5 rounded-ctl font-medium',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'h-7 px-2.5 text-[11.5px]',
        size === 'md' && 'h-8 px-3 text-[12.5px]',
        size === 'lg' && 'h-9 px-3.5 text-[13px]',
        // Ghost stays flat until you touch it — it is the only variant that
        // does not claim elevation, which is what keeps toolbars quiet.
        variant === 'ghost' &&
          'text-text-2 transition-colors duration-150 hover:bg-white/[0.07] hover:text-text-1 active:bg-white/[0.04]',
        variant === 'subtle' && 'sk-raise bg-ink-3 text-text-1',
        variant === 'solid' && 'sk-raise text-text-1',
        variant === 'brand' && 'sk-brand',
        active && variant === 'ghost' && 'bg-white/[0.09] text-text-1',
        className
      )}
      {...props}
    />
  )
})

export function IconButton({
  className,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }): React.JSX.Element {
  return (
    <button
      className={cn(
        'focus-ring no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl text-text-2',
        'transition-[background-color,color,box-shadow] duration-150',
        'hover:bg-white/[0.07] hover:text-text-1',
        'disabled:pointer-events-none disabled:opacity-35',
        // Selected tools glow rather than merely tint: a violet wash, a violet
        // hairline, and a soft bloom underneath.
        active && 'sk-selected',
        className
      )}
      {...props}
    />
  )
}

/* -------------------------------- sections ------------------------------- */

export function Section({
  title,
  action,
  children,
  className
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={cn('border-b border-hair px-4 py-3.5 last:border-b-0', className)}>
      {title && (
        <header className="mb-3 flex h-5 items-center justify-between">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-text-3">
            {title}
          </h3>
          {action}
        </header>
      )}
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export function Row({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="truncate text-[12px] text-text-2">{label}</div>
        {hint && <div className="truncate text-[10.5px] text-text-3">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** The small recessed chip a numeric read-out sits in. */
export function Chip({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'sk-well inline-flex h-[19px] items-center justify-center rounded-[6px] px-1.5',
        'font-mono text-[10.5px] tabular-nums leading-none text-text-2',
        className
      )}
    >
      {children}
    </span>
  )
}

/* --------------------------------- slider -------------------------------- */

/**
 * A channel carved into the panel, filled with violet, with a hairline of
 * white marking the value. The read-out lives in its own chip so the eye can
 * find it without reading the track — the same split the reference uses.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  format,
  onChange,
  onCommit,
  disabled
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  format?: (value: number) => string
  onChange: (value: number) => void
  onCommit?: () => void
  disabled?: boolean
}): React.JSX.Element {
  const display = format ? format(value) : `${Math.round(value * 100) / 100}${unit ?? ''}`
  return (
    <div className={cn('space-y-2', disabled && 'pointer-events-none opacity-40')}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] text-text-2">{label}</span>
        <Chip>{display}</Chip>
      </div>
      <RSlider.Root
        className="group relative flex h-5 w-full touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={onCommit}
      >
        <RSlider.Track className="sk-well relative h-5 w-full grow overflow-hidden rounded-[7px] transition-colors duration-150 group-hover:bg-ink-4">
          <RSlider.Range className="sk-range absolute inset-y-0 left-0" />
        </RSlider.Track>
        <RSlider.Thumb
          className="focus-ring block h-3 w-[3px] rounded-full bg-white shadow-[var(--shadow-thumb)]
                     transition-[height,width] duration-150 ease-[var(--ease-out-soft)]
                     group-hover:h-3.5 active:h-3.5 active:w-[4px]"
          aria-label={label}
        />
      </RSlider.Root>
    </div>
  )
}

/* -------------------------------- switch --------------------------------- */

export function Switch({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className={cn(
        'focus-ring relative flex h-5 w-9 shrink-0 items-center rounded-full border',
        'transition-[background,border-color,box-shadow] duration-200 ease-[var(--ease-out-soft)]',
        checked ? 'sk-on' : 'sk-well border-hair',
        disabled && 'opacity-40'
      )}
    >
      <RSwitch.Thumb
        className={cn(
          'block h-3.5 w-3.5 rounded-full shadow-[var(--shadow-thumb)] will-change-transform',
          'translate-x-[2px] transition-[transform,background-color] duration-200 ease-[var(--ease-out-soft)]',
          'data-[state=checked]:translate-x-[18px]',
          // Off, the knob is warm grey, not white — white on a dark track
          // reads as "on" at a glance, which is the whole failure mode.
          checked ? 'bg-white' : 'bg-[#b4b4c1]'
        )}
      />
    </RSwitch.Root>
  )
}

/* -------------------------------- checkbox ------------------------------- */

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: React.ReactNode
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  const box = (
    <span
      className={cn(
        'relative flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border',
        'transition-[background,border-color,box-shadow] duration-150 ease-[var(--ease-out-soft)]',
        checked ? 'sk-on' : 'sk-well border-hair-strong'
      )}
    >
      <Check
        size={11}
        strokeWidth={3.25}
        className={cn(
          'text-white transition-[opacity,transform] duration-150 ease-[var(--ease-out-soft)]',
          checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
        )}
      />
    </span>
  )

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring group inline-flex items-center gap-2 rounded-[7px] text-left',
        'disabled:pointer-events-none disabled:opacity-40',
        label && 'min-w-0',
        className
      )}
    >
      {box}
      {label && (
        <span
          className={cn(
            'truncate text-[12px] transition-colors duration-150',
            checked ? 'text-text-1' : 'text-text-2 group-hover:text-text-1'
          )}
        >
          {label}
        </span>
      )}
    </button>
  )
}

/* ------------------------------- segmented ------------------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className
}: {
  value: T
  options: Array<{ value: T; label: React.ReactNode; title?: string }>
  onChange: (value: T) => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('sk-well flex rounded-[10px] p-1', className)}>
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'focus-ring flex h-6.5 flex-1 items-center justify-center gap-1 rounded-[6px] border px-2',
              'text-[11.5px] font-medium',
              'transition-[background-color,color,box-shadow,border-color] duration-150 ease-[var(--ease-out-soft)]',
              selected
                ? 'border-hair bg-ink-4 text-text-1 shadow-[var(--shadow-raise)]'
                : 'border-transparent text-text-3 hover:bg-white/[0.04] hover:text-text-2'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* --------------------------------- select -------------------------------- */

export function Select<T extends string>({
  value,
  options,
  onChange,
  className
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  className?: string
}): React.JSX.Element {
  return (
    <RSelect.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <RSelect.Trigger
        className={cn(
          'sk-field group inline-flex h-8 items-center justify-between gap-2 rounded-ctl px-2.5',
          'text-[12px] text-text-1',
          className
        )}
      >
        <RSelect.Value />
        <RSelect.Icon>
          <ChevronDown
            size={13}
            className="text-text-3 transition-transform duration-200 ease-[var(--ease-out-soft)] group-data-[state=open]:rotate-180"
          />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={6}
          className="sk-pop animate-pop z-50 overflow-hidden rounded-pop p-1"
        >
          <RSelect.Viewport>
            {options.map((option) => (
              <RSelect.Item
                key={option.value}
                value={option.value}
                className="relative flex h-7 cursor-default select-none items-center rounded-[7px] pl-7 pr-3 text-[12px] text-text-2 outline-none
                           transition-colors duration-100
                           data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-text-1
                           data-[state=checked]:text-text-1"
              >
                <RSelect.ItemIndicator className="absolute left-2">
                  <Check size={12} strokeWidth={3} className="text-brand-soft" />
                </RSelect.ItemIndicator>
                <RSelect.ItemText>{option.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}

/* --------------------------------- input --------------------------------- */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'sk-field h-8 min-w-0 rounded-ctl px-2.5 text-[12px] text-text-1 placeholder:text-text-3',
          className
        )}
        {...props}
      />
    )
  }
)

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  className
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('relative', className)}>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn('w-full text-right font-mono tabular-nums', suffix && 'pr-6')}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] text-text-3">
          {suffix}
        </span>
      )}
    </div>
  )
}

/* ------------------------------ color picker ----------------------------- */

const QUICK_COLORS = [
  '#ffffff',
  '#000000',
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#00c7be',
  '#007aff',
  '#5856d6',
  '#af52de',
  '#ff2d55',
  '#8e8e93'
]

export function ColorPicker({
  value,
  onChange,
  onCommit,
  swatches = QUICK_COLORS,
  allowAlpha,
  size = 'md'
}: {
  value: string
  onChange: (color: string) => void
  onCommit?: () => void
  swatches?: string[]
  allowAlpha?: boolean
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const solid = value.length > 7 ? value.slice(0, 7) : value
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>
        <button
          className={cn(
            'focus-ring checker relative shrink-0 overflow-hidden rounded-[7px] border border-hair-strong',
            'shadow-[var(--shadow-raise)] transition-transform duration-150 ease-[var(--ease-out-soft)]',
            'hover:scale-[1.06] active:scale-95',
            size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'
          )}
          aria-label="Pick a color"
        >
          <span className="absolute inset-0" style={{ background: value }} />
          {/* The same top hairline every raised control gets, drawn over the
              swatch so the colour itself stays true. */}
          <span className="pointer-events-none absolute inset-0 rounded-[6px] shadow-[inset_0_1px_0_0_#ffffff33,inset_0_-1px_0_0_#0000002e]" />
        </button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          sideOffset={8}
          align="end"
          className="sk-pop animate-pop z-50 w-[220px] rounded-pop p-3"
        >
          <div className="grid grid-cols-6 gap-1.5">
            {swatches.map((color) => (
              <button
                key={color}
                onClick={() => {
                  onChange(color)
                  onCommit?.()
                }}
                className={cn(
                  'focus-ring h-6 w-6 rounded-[6px] border transition-transform duration-150 ease-[var(--ease-out-soft)] hover:scale-110',
                  solid.toLowerCase() === color.toLowerCase()
                    ? 'sk-swatch-on border-brand-soft'
                    : 'border-hair-strong shadow-[inset_0_1px_0_0_#ffffff2e]'
                )}
                style={{ background: color }}
                aria-label={color}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="color"
              value={solid}
              onChange={(e) =>
                onChange(allowAlpha ? e.target.value + (value.slice(7) || '') : e.target.value)
              }
              onBlur={onCommit}
              className="sk-field h-8 w-9 cursor-pointer rounded-ctl p-1"
            />
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onCommit}
              spellCheck={false}
              className="w-full font-mono text-[11px] uppercase"
            />
          </div>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  )
}

/* ---------------------------------- misc --------------------------------- */

export function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd
      className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] border border-hair bg-white/[0.07] px-1
                 font-sans text-[10px] font-medium leading-none text-text-2
                 shadow-[inset_0_1px_0_0_#ffffff1f,0_1px_1px_0_#00000059]"
    >
      {children}
    </kbd>
  )
}

export function Empty({
  icon,
  title,
  body,
  action
}: {
  icon: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="sk-well flex h-11 w-11 items-center justify-center rounded-[13px] text-text-3">
        {icon}
      </div>
      <div>
        <div className="text-[13px] font-medium text-text-1">{title}</div>
        <div className="mt-1 max-w-[240px] text-[11.5px] leading-relaxed text-text-3">{body}</div>
      </div>
      {action}
    </div>
  )
}

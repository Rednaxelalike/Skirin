import * as React from 'react'
import * as RSlider from '@radix-ui/react-slider'
import * as RSwitch from '@radix-ui/react-switch'
import * as RTooltip from '@radix-ui/react-tooltip'
import * as RPopover from '@radix-ui/react-popover'
import * as RSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

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
          className="animate-pop z-50 rounded-lg border border-hair bg-ink-2/95 px-2.5 py-1.5 text-[11.5px] text-text-1 shadow-xl shadow-black/50 backdrop-blur-xl"
        >
          {label}
          {hint && <span className="ml-2 text-text-3">{hint}</span>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

/* -------------------------------- buttons -------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'solid' | 'brand' | 'subtle'
  size?: 'sm' | 'md'
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
        'focus-ring no-drag inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2 text-[11.5px]' : 'h-8 px-3 text-[12.5px]',
        variant === 'ghost' && 'text-text-2 hover:bg-white/6 hover:text-text-1',
        variant === 'subtle' && 'bg-white/5 text-text-1 hover:bg-white/10',
        variant === 'solid' && 'bg-ink-4 text-text-1 hover:bg-ink-5',
        variant === 'brand' &&
          'bg-brand text-white shadow-[0_1px_0_0_#ffffff2e_inset] hover:bg-brand/88',
        active && 'bg-white/10 text-text-1',
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
        'focus-ring no-drag inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-2 transition-colors duration-150 hover:bg-white/8 hover:text-text-1 disabled:pointer-events-none disabled:opacity-35',
        active && 'bg-brand/18 text-brand-soft',
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

/* --------------------------------- slider -------------------------------- */

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
    <div className={cn('space-y-1.5', disabled && 'pointer-events-none opacity-40')}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-text-2">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-text-3">{display}</span>
      </div>
      <RSlider.Root
        className="relative flex h-4 w-full touch-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={onCommit}
      >
        <RSlider.Track className="relative h-1 w-full grow rounded-full bg-white/10">
          <RSlider.Range className="absolute h-full rounded-full bg-brand/80" />
        </RSlider.Track>
        <RSlider.Thumb
          className="focus-ring block h-3.5 w-3.5 rounded-full border border-black/40 bg-white shadow-md transition-transform hover:scale-110 active:scale-95"
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
        'focus-ring relative h-[18px] w-[32px] shrink-0 rounded-full border border-hair transition-colors',
        checked ? 'bg-brand' : 'bg-white/8',
        disabled && 'opacity-40'
      )}
    >
      <RSwitch.Thumb className="block h-3.5 w-3.5 translate-x-[2px] rounded-full bg-white transition-transform duration-150 will-change-transform data-[state=checked]:translate-x-[15px]" />
    </RSwitch.Root>
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
    <div className={cn('flex rounded-lg bg-white/5 p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'focus-ring flex h-6.5 flex-1 items-center justify-center gap-1 rounded-[6px] px-2 text-[11.5px] font-medium transition-colors',
            value === option.value
              ? 'bg-ink-4 text-text-1 shadow-sm'
              : 'text-text-3 hover:text-text-2'
          )}
        >
          {option.label}
        </button>
      ))}
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
          'focus-ring inline-flex h-7 items-center justify-between gap-2 rounded-lg border border-hair bg-white/5 px-2.5 text-[12px] text-text-1 hover:bg-white/8',
          className
        )}
      >
        <RSelect.Value />
        <RSelect.Icon>
          <ChevronDown size={13} className="text-text-3" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={6}
          className="animate-pop z-50 overflow-hidden rounded-xl border border-hair bg-ink-2/97 p-1 shadow-2xl shadow-black/60 backdrop-blur-2xl"
        >
          <RSelect.Viewport>
            {options.map((option) => (
              <RSelect.Item
                key={option.value}
                value={option.value}
                className="focus-ring relative flex h-7 cursor-default select-none items-center rounded-lg pl-7 pr-3 text-[12px] text-text-2 outline-none data-[highlighted]:bg-white/8 data-[highlighted]:text-text-1"
              >
                <RSelect.ItemIndicator className="absolute left-2">
                  <Check size={12} className="text-brand-soft" />
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
          'focus-ring h-7 min-w-0 rounded-lg border border-hair bg-white/5 px-2.5 text-[12px] text-text-1 placeholder:text-text-3 hover:bg-white/8',
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
            'focus-ring checker relative shrink-0 overflow-hidden rounded-lg border border-hair-strong transition-transform hover:scale-105',
            size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'
          )}
          aria-label="Pick a color"
        >
          <span className="absolute inset-0" style={{ background: value }} />
        </button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          sideOffset={8}
          align="end"
          className="animate-pop z-50 w-[220px] rounded-xl border border-hair bg-ink-2/97 p-3 shadow-2xl shadow-black/60 backdrop-blur-2xl"
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
                  'focus-ring h-6 w-6 rounded-md border transition-transform hover:scale-110',
                  solid.toLowerCase() === color.toLowerCase()
                    ? 'border-brand-soft ring-2 ring-brand/40'
                    : 'border-hair-strong'
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
              onChange={(e) => onChange(allowAlpha ? e.target.value + (value.slice(7) || '') : e.target.value)}
              onBlur={onCommit}
              className="h-7 w-9 cursor-pointer rounded-md border border-hair bg-transparent p-0"
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

export function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded border border-hair bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-text-3">
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
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-hair bg-white/4 text-text-3">
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

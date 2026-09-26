import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ---------- Button ---------- */

type Variant = 'primary' | 'secondary' | 'accent' | 'ghost'

const variants: Record<Variant, string> = {
  // White paper button that fills with red marker on hover.
  primary: 'bg-white text-pencil hover:bg-marker hover:text-white',
  // Old-paper button that fills with blue pen on hover.
  secondary: 'bg-muted text-pencil hover:bg-pen hover:text-white',
  // Pre-filled red for the one most important action on a screen.
  accent: 'bg-marker text-white hover:bg-pencil',
  ghost: 'bg-transparent text-pencil border-dashed shadow-none hover:bg-muted',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'md' | 'lg'
  block?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', block, icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-wobbly border-[3px] border-pencil font-body',
        'shadow-hard transition-all duration-100',
        'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-hardSm',
        'active:translate-x-[4px] active:translate-y-[4px] active:shadow-none',
        'disabled:pointer-events-none disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pen/30',
        size === 'lg' ? 'min-h-[60px] px-7 text-2xl' : 'min-h-[48px] px-5 text-xl',
        block && 'w-full',
        variants[variant],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/* ---------- Card ---------- */

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  decoration?: 'tape' | 'tack' | 'none'
  tone?: 'white' | 'postit' | 'paper'
  tilt?: number
}

export function Card({ decoration = 'none', tone = 'white', tilt = 0, className, style, children, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      style={{ transform: tilt ? `rotate(${tilt}deg)` : undefined, ...style }}
      className={cx(
        'relative rounded-wobblyMd border-2 border-pencil p-5',
        tone === 'postit' ? 'bg-postit shadow-hard' : tone === 'paper' ? 'bg-paper shadow-soft' : 'bg-white shadow-soft',
        className,
      )}
    >
      {decoration === 'tape' && <Tape />}
      {decoration === 'tack' && <Tack />}
      {children}
    </div>
  )
}

export function Tape({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'pointer-events-none absolute -top-3 left-1/2 h-7 w-24 -translate-x-1/2 -rotate-2 border border-pencil/10 bg-pencil/15 backdrop-blur-[1px]',
        className,
      )}
      style={{ clipPath: 'polygon(3% 0, 97% 4%, 100% 50%, 96% 100%, 2% 96%, 0 50%)' }}
    />
  )
}

export function Tack() {
  return (
    <span aria-hidden className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2">
      <span className="block h-6 w-6 rounded-full border-2 border-pencil bg-marker shadow-hardSm" />
    </span>
  )
}

/* ---------- Input ---------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      {...rest}
      className={cx(
        'min-h-[52px] w-full rounded-wobblySm border-2 border-pencil bg-white px-4 font-body text-xl text-pencil',
        'placeholder:text-pencil/40 focus:border-pen focus:outline-none focus:ring-4 focus:ring-pen/20',
        className,
      )}
    />
  )
})

export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1 block font-heading text-lg font-bold">{children}</span>
}

/* ---------- Icon in a rough circle ---------- */

export function IconBlob({ children, tone = 'white', className }: { children: ReactNode; tone?: 'white' | 'postit' | 'marker' | 'pen' | 'leaf'; className?: string }) {
  const bg = { white: 'bg-white', postit: 'bg-postit', marker: 'bg-marker text-white', pen: 'bg-pen text-white', leaf: 'bg-leaf text-white' }[tone]
  return (
    <span className={cx('inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-blob border-2 border-pencil', bg, className)}>
      {children}
    </span>
  )
}

/* ---------- Status sticker ---------- */

export function StatusSticker({ status, label }: { status: 'waiting' | 'paid' | 'cancelled'; label: string }) {
  const tone = {
    paid: 'bg-leaf text-white rotate-2',
    waiting: 'bg-postit text-pencil -rotate-2',
    cancelled: 'bg-muted text-pencil/70 line-through rotate-1',
  }[status]
  return (
    <span className={cx('inline-block whitespace-nowrap rounded-wobblySm border-2 border-pencil px-2.5 py-0.5 text-base leading-tight', tone)}>
      {label}
    </span>
  )
}

/* ---------- Hand-drawn doodles ---------- */

export function Squiggle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 12" preserveAspectRatio="none" className={cx('h-3 w-full', className)} aria-hidden>
      <path d="M2 7 Q 15 1 28 7 T 54 7 T 80 7 T 106 7 T 132 7 T 158 7 T 184 7 T 198 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export function Arrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 60" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M6 8 C 30 4, 58 14, 66 46" strokeDasharray="5 5" />
      <path d="M56 40 L 67 50 L 74 36" />
    </svg>
  )
}

export function Underline({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('relative inline-block', className)}>
      {children}
      <Squiggle className="absolute -bottom-2 left-0 text-marker" />
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-block h-5 w-5 animate-spin rounded-blob border-[3px] border-pencil border-t-transparent', className)}
    />
  )
}

export { cx }

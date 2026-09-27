import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react'
import { cx } from './ui'

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** True once the element has scrolled into view (stays true). */
export function useInView<T extends Element>(margin = '0px 0px -12% 0px') {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    if (!('IntersectionObserver' in window)) return setInView(true)
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView, margin])
  return [ref, inView] as const
}

/** Fades/tilts its content in when scrolled into view. */
export function Reveal({
  as: Tag = 'div',
  delay = 0,
  tilt = -1,
  className,
  style,
  children,
}: {
  as?: ElementType
  delay?: number
  tilt?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const [ref, inView] = useInView<HTMLElement>()
  return (
    <Tag
      ref={ref}
      className={cx('reveal', inView && 'is-in', className)}
      style={{ '--delay': `${delay}ms`, '--tilt': `${tilt}deg`, ...style } as CSSProperties}
    >
      {children}
    </Tag>
  )
}

/** Animates a number from its previous value to `value` (ease-out). */
export function useCountUp(value: number, duration = 900, start = true) {
  const [shown, setShown] = useState(start ? 0 : value)
  const from = useRef(0)
  useEffect(() => {
    if (!start) return
    if (reducedMotion()) return setShown(value)
    const begin = performance.now()
    const a = from.current
    let raf = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - begin) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(a + (value - a) * eased)
      if (p < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, start])
  return shown
}

const CONFETTI_COLORS = ['#ff4d4d', '#2d5da1', '#fff9c4', '#2f8f4e', '#ffffff']

/** A one-shot burst of paper confetti. Re-fires when `fire` changes. */
export function Confetti({ fire, count = 26, spread = 190 }: { fire: unknown; count?: number; spread?: number }) {
  const [pieces, setPieces] = useState<CSSProperties[]>([])
  useEffect(() => {
    if (!fire || reducedMotion()) return
    setPieces(
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5
        const dist = spread * (0.45 + Math.random() * 0.55)
        const size = 7 + Math.random() * 7
        return {
          '--x': `${Math.cos(angle) * dist}px`,
          '--y': `${Math.sin(angle) * dist - 40}px`,
          '--rot': `${Math.random() * 720 - 360}deg`,
          width: size,
          height: size * (Math.random() > 0.5 ? 0.5 : 1),
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          borderRadius: i % 3 === 0 ? '50%' : '2px 5px 2px 4px',
          animationDelay: `${Math.random() * 90}ms`,
        } as CSSProperties
      }),
    )
    const id = window.setTimeout(() => setPieces([]), 1400)
    return () => clearTimeout(id)
  }, [fire, count, spread])
  if (!pieces.length) return null
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-30 overflow-visible">
      {pieces.map((s, i) => (
        <span key={i} className="confetti-piece" style={s} />
      ))}
    </span>
  )
}

/** Three bouncing dots — "someone is typing". */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 py-1', className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-2.5 w-2.5 animate-dot rounded-blob bg-current" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  )
}

/** Reveals text word by word, like it's being written right now. */
export function WriteOn({ text, step = 35 }: { text: string; step?: number }) {
  const words = text.split(/(\s+)/)
  let n = 0
  return (
    <>
      {words.map((w, i) =>
        /^\s+$/.test(w) ? (
          w
        ) : (
          <span key={i} className="inline-block animate-word" style={{ animationDelay: `${n++ * step}ms` }}>
            {w}
          </span>
        ),
      )}
    </>
  )
}

/**
 * Pointer-driven 3D tilt. Writes --rx/--ry (degrees) and --px/--py (-1..1)
 * as CSS variables so children can parallax at different depths.
 */
export function useTilt<T extends HTMLElement>(max = 10) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion() || !window.matchMedia('(hover: hover)').matches) return
    let raf = 0
    const set = (px: number, py: number) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--px', px.toFixed(3))
        el.style.setProperty('--py', py.toFixed(3))
        el.style.setProperty('--rx', `${(-py * max).toFixed(2)}deg`)
        el.style.setProperty('--ry', `${(px * max).toFixed(2)}deg`)
      })
    }
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1)
    }
    const leave = () => set(0, 0)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [max])
  return ref
}

/** Page scroll progress (px), throttled to animation frames. */
export function useScrollY() {
  const [y, setY] = useState(0)
  useEffect(() => {
    if (reducedMotion()) return
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setY(window.scrollY))
    }
    window.addEventListener('scroll', on, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', on)
    }
  }, [])
  return y
}

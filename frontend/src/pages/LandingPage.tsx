import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BellRing,
  Check,
  ChevronDown,
  CreditCard,
  Languages,
  MessageCircle,
  Mic,
  PiggyBank,
  Plus,
  ReceiptText,
  Send,
  Sparkles,
  Users,
} from 'lucide-react'
import { LANGS, type LangCode } from '../i18n/strings'
import { FEE_RATE, LANDING, type LandingStrings } from '../i18n/landing'
import { localeOf, useApp } from '../lib/app'
import { Arrow, Button, Card, cx, IconBlob, Squiggle, Tape } from '../components/ui'
import { Confetti, Reveal, TypingDots, useCountUp, useInView, useTilt, WriteOn } from '../components/motion'
import { WhatsAppLogo } from '../components/ShareActions'

/* ---------- copy helpers ---------- */

function useLanding() {
  const { settings } = useApp()
  const fee = new Intl.NumberFormat(localeOf(settings.lang), { style: 'percent', minimumFractionDigits: 2 }).format(FEE_RATE)
  const l = (key: keyof LandingStrings, vars: Record<string, string> = {}) => {
    let s = LANDING[settings.lang][key] ?? LANDING.en[key]
    for (const [k, v] of Object.entries({ fee, ...vars })) s = s.split(`{${k}}`).join(v)
    return s
  }
  return { l, fee }
}

/** Scroll position → CSS variables (--sy px, --sp 0..1) on <html>, without re-rendering React. */
function useScrollVars() {
  useEffect(() => {
    const root = document.documentElement
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const max = Math.max(1, root.scrollHeight - window.innerHeight)
        root.style.setProperty('--sy', String(window.scrollY))
        root.style.setProperty('--sp', String(window.scrollY / max))
      })
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      root.style.removeProperty('--sy')
      root.style.removeProperty('--sp')
    }
  }, [])
}

const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/* ---------- page ---------- */

export default function LandingPage() {
  const { settings } = useApp()
  const navigate = useNavigate()
  const { l } = useLanding()
  useScrollVars()

  useEffect(() => {
    const prev = document.title
    document.title = `Easy Pay — ${l('heroTitle1')} ${l('heroTitle2')} ${l('heroTitleLink')}`
    return () => {
      document.title = prev
    }
  })

  const start = () => navigate(settings.onboarded ? '/' : '/onboarding')

  return (
    <div className="min-h-full overflow-x-clip">
      {/* Scroll progress: a red marker line across the top. */}
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 h-1.5 origin-left bg-marker rtl:origin-right"
        style={{ transform: 'scaleX(var(--sp, 0))' }}
      />
      <Nav onStart={start} />
      <Hero onStart={start} />
      <Marquee />
      <HowItWorks />
      <Pricing onStart={start} />
      <Features />
      <Faq />
      <FinalCta onStart={start} />
      <Footer />
    </div>
  )
}

/* ---------- nav ---------- */

function Nav({ onStart }: { onStart: () => void }) {
  const { settings, update } = useApp()
  const { l } = useLanding()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  const links: [string, keyof LandingStrings][] = [
    ['how', 'navHow'],
    ['price', 'navPrice'],
    ['faq', 'navFaq'],
  ]

  return (
    <header
      className={cx(
        'sticky top-0 z-40 transition-all duration-300',
        scrolled ? 'border-b-2 border-dashed border-pencil/40 bg-paper/85 py-2 backdrop-blur-md' : 'py-4',
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 md:px-6">
        <a href="#" onClick={(e) => (e.preventDefault(), window.scrollTo({ top: 0, behavior: 'smooth' }))} className="group me-auto shrink-0">
          <span className="font-heading text-3xl font-bold leading-none md:text-4xl">
            Easy
            <span className="inline-block -rotate-6 text-marker transition-transform duration-200 group-hover:rotate-6 group-hover:scale-110">Pay</span>
          </span>
        </a>
        <nav className="hidden items-center gap-6 md:flex">
          {links.map(([id, key]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => (e.preventDefault(), scrollToId(id))}
              className="group relative text-xl text-pencil/80 transition-colors hover:text-pencil"
            >
              {l(key)}
              <Squiggle className="absolute -bottom-2 left-0 origin-left scale-x-0 text-marker transition-transform duration-300 group-hover:scale-x-100 rtl:origin-right" />
            </a>
          ))}
        </nav>
        <label className="relative">
          <span className="sr-only">Language</span>
          <select
            value={settings.lang}
            onChange={(e) => update({ lang: e.target.value as LangCode })}
            className="min-h-[44px] cursor-pointer appearance-none rounded-wobblySm border-2 border-pencil bg-white pe-8 ps-3 text-lg shadow-hardSm transition-transform duration-100 hover:-rotate-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-pen/30"
          >
            {LANGS.map((lg) => (
              <option key={lg.code} value={lg.code}>
                {lg.flag} {lg.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden strokeWidth={3} className="pointer-events-none absolute end-2 top-1/2 h-4 w-4 -translate-y-1/2" />
        </label>
        <Button variant="accent" onClick={onStart} className="hidden !min-h-[44px] sm:inline-flex">
          {l('openApp')}
        </Button>
      </div>
    </header>
  )
}

/* ---------- hero ---------- */

function Hero({ onStart }: { onStart: () => void }) {
  const { l } = useLanding()
  return (
    <section className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-6 md:grid-cols-[1.05fr_1fr] md:px-6 md:pb-24 md:pt-12">
      {/* Background doodles drifting slower than the page (scroll parallax). */}
      <span
        aria-hidden
        className="pointer-events-none absolute -start-10 top-10 hidden h-40 w-40 rounded-blob border-[3px] border-dashed border-pen/30 md:block"
        style={{ transform: 'translateY(calc(var(--sy, 0) * 0.25px)) rotate(calc(var(--sy, 0) * 0.05deg))' }}
      />

      <div className="relative z-10">
        <p className="mb-5 inline-flex animate-rise items-center gap-2 rounded-wobblySm border-2 border-pencil bg-postit px-3 py-1 text-lg shadow-hardSm [rotate:-2deg]">
          <MessageCircle strokeWidth={2.5} className="h-5 w-5 text-pen" />
          {l('heroKicker')}
        </p>
        <h1 className="font-heading text-5xl font-bold leading-[1.05] sm:text-6xl lg:text-7xl">
          <span className="block">
            <WriteOn text={l('heroTitle1')} step={110} />
          </span>
          <span className="block">
            <span className="inline-block animate-word [animation-delay:.35s]">{l('heroTitle2')}</span>{' '}
            <span className="relative inline-block animate-word text-marker [animation-delay:.5s]">
              {l('heroTitleLink')}
              <svg aria-hidden viewBox="0 0 200 20" preserveAspectRatio="none" className="absolute -bottom-3 left-0 h-4 w-full">
                <path
                  d="M3 12 C 40 4, 80 18, 120 9 S 180 6, 197 11"
                  fill="none"
                  stroke="#2d5da1"
                  strokeWidth="5"
                  strokeLinecap="round"
                  className="animate-draw [animation-delay:.9s]"
                  style={{ strokeDasharray: 220, '--len': 220 } as CSSProperties}
                />
              </svg>
            </span>
            <span className="ms-1 inline-block animate-wiggle text-pen [animation-delay:1.2s] [rotate:12deg]">!</span>
          </span>
        </h1>
        <p className="mt-7 max-w-xl animate-rise text-xl leading-relaxed text-pencil/80 [animation-delay:.6s] md:text-2xl">{l('heroSub')}</p>

        <div className="relative mt-8 flex animate-rise flex-wrap items-center gap-4 [animation-delay:.75s]">
          <Button variant="accent" size="lg" onClick={onStart} className="group" icon={<Sparkles strokeWidth={2.5} className="transition-transform duration-300 group-hover:rotate-45 group-hover:scale-125" />}>
            {l('ctaStart')}
            <ArrowRight strokeWidth={3} className="transition-transform duration-200 group-hover:translate-x-1.5 rtl:rotate-180 rtl:group-hover:-translate-x-1.5" />
          </Button>
          <Button variant="ghost" size="lg" onClick={() => scrollToId('how')}>
            {l('ctaHow')}
          </Button>
          <Arrow className="absolute -bottom-16 start-40 hidden h-14 w-16 -scale-y-100 text-pencil/50 lg:block rtl:-scale-x-100" />
        </div>
        <p className="mt-6 flex animate-rise items-center gap-2 text-lg text-pencil/60 [animation-delay:.9s]">
          <Check strokeWidth={3} className="h-5 w-5 text-leaf" />
          {l('heroNote')}
        </p>
      </div>

      <HeroScene />
    </section>
  )
}

/** A 3D scene: the phone plus floating paper bits at different depths. Pointer tilts it; scroll drifts it. */
function HeroScene() {
  const { l, fee } = useLanding()
  const ref = useTilt<HTMLDivElement>(9)

  const layer = (z: number, drift: number): CSSProperties => ({
    transform: `translateZ(${z}px) translateY(calc(var(--sy, 0) * ${drift}px))`,
  })

  return (
    <div ref={ref} className="relative mx-auto h-[560px] w-full max-w-[520px] animate-pageIn [animation-delay:.2s] [perspective:1400px] sm:h-[640px]">
      <div
        className="preserve-3d absolute inset-0 transition-transform duration-300 ease-out"
        style={{ transform: 'rotateX(calc(var(--rx, 0deg) + 6deg)) rotateY(calc(var(--ry, 0deg) - 12deg))' }}
      >
        {/* Far back: dashed blob and scribble */}
        <div className="preserve-3d absolute inset-0" style={layer(-120, -0.05)}>
          <span className="absolute left-1/2 top-1/2 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-blob border-[3px] border-dashed border-marker/40 sm:h-[520px] sm:w-[520px]" />
          <span className="absolute left-1/2 top-1/2 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-blob bg-postit/70 [rotate:25deg] sm:h-[440px] sm:w-[440px]" />
        </div>

        {/* The phone */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ transform: 'translate(-50%, -50%) translateZ(0)' }}>
          <div className="origin-center scale-[.88] sm:scale-100">
            <PhoneDemo />
          </div>
        </div>

        {/* Floating bits, nearer to the viewer = more parallax */}
        <div className="absolute -start-2 top-6 sm:start-0" style={layer(110, -0.12)}>
          <div className="animate-float [--r:-8deg]">
            <FeeSticker text={l('feeBadge')} fee={fee} />
          </div>
        </div>

        <div className="absolute -end-2 top-24 sm:-end-6" style={layer(70, -0.08)}>
          <div className="animate-float [--r:4deg] [animation-delay:-2s]">
            <div className="flex max-w-[190px] items-start gap-2 rounded-wobblyMd border-2 border-pencil bg-[#dcf8c6] px-3 py-2 text-base leading-snug shadow-hard">
              <WhatsAppLogo className="mt-0.5 h-5 w-5 shrink-0 fill-[#25D366]" />
              <span>{l('demoWhats')}</span>
            </div>
          </div>
        </div>

        <div className="absolute bottom-20 start-0 sm:-start-4" style={layer(150, -0.18)}>
          <div className="animate-float [--r:-12deg] [animation-delay:-1s]">
            <Coin />
          </div>
        </div>

        <div className="absolute -end-1 bottom-10 sm:-end-8" style={layer(60, -0.1)}>
          <div className="animate-float [--r:3deg] [animation-delay:-3s]">
            <div className="flex items-center gap-2 rounded-wobblySm border-2 border-pencil bg-white px-3 py-2 text-base shadow-hard">
              <span className="rounded-md bg-pencil px-1.5 text-sm font-bold text-white"> Pay</span>
              <span className="rounded-md border-2 border-pencil px-1.5 text-sm font-bold">G Pay</span>
              <CreditCard strokeWidth={2.5} className="h-5 w-5 text-pen" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Circular sticker with rotating text around the fee. */
function FeeSticker({ text, fee }: { text: string; fee: string }) {
  const ring = `${text} ★ ${text} ★ `.toUpperCase()
  return (
    <div className="relative h-32 w-32 sm:h-36 sm:w-36">
      <div className="absolute inset-0 rounded-full border-[3px] border-pencil bg-marker shadow-hard" />
      <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full animate-[spin_16s_linear_infinite] text-white" aria-hidden>
        <defs>
          <path id="fee-ring" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" />
        </defs>
        <text fontSize="10.5" fill="currentColor" fontFamily="Patrick Hand, cursive" letterSpacing="1">
          <textPath href="#fee-ring" textLength="274" lengthAdjust="spacingAndGlyphs">
            {ring}
          </textPath>
        </text>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-heading text-2xl font-bold text-white [text-shadow:2px_2px_0_#2d2d2d] sm:text-3xl">{fee}</span>
      </div>
    </div>
  )
}

function Coin() {
  const { settings } = useApp()
  const symbol =
    new Intl.NumberFormat(localeOf(settings.lang), { style: 'currency', currency: settings.currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '$'
  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-pencil bg-[#ffd54a] shadow-hard">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-pencil/60 font-heading text-2xl font-bold">{symbol}</div>
    </div>
  )
}

/* ---------- animated phone ---------- */

const PHASES = 8

/** A looping, scripted chat: type → send → AI receipt → create link → paid. */
function PhoneDemo() {
  const { fmt } = useApp()
  const { l } = useLanding()
  const userText = l('demoUser')
  const [phase, setPhase] = useState(0)
  const [chars, setChars] = useState(0)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setPhase(7)
      return
    }
    const durations = [900, userText.length * 38 + 400, 500, 1100, 1900, 550, 2300, 3000]
    const id = window.setTimeout(() => setPhase((p) => (p + 1) % PHASES), durations[phase])
    return () => clearTimeout(id)
  }, [phase, userText.length])

  useEffect(() => {
    if (phase !== 1) return setChars(phase > 1 ? userText.length : 0)
    setChars(0)
    const id = window.setInterval(() => setChars((c) => Math.min(userText.length, c + 1)), 38)
    return () => clearInterval(id)
  }, [phase, userText.length])

  const total = fmt(3600)

  return (
    <div className="relative h-[580px] w-[290px] rounded-[46px] border-[3px] border-pencil bg-pencil p-2.5 shadow-hardLg">
      <div className="relative flex h-full flex-col overflow-hidden rounded-[36px] bg-paper paper-bg">
        {/* notch */}
        <div className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-pencil" />
        {/* chat header */}
        <div className="flex items-center gap-2 border-b-2 border-dashed border-pencil/30 bg-paper/90 px-3 pb-2 pt-9">
          <span className="flex h-8 w-8 -rotate-6 items-center justify-center rounded-blob border-2 border-pencil bg-postit text-sm">☺</span>
          <div className="leading-tight">
            <p className="font-heading text-sm font-bold">Easy Pay</p>
            <p className="flex items-center gap-1 text-xs text-leaf">
              <span className="h-1.5 w-1.5 rounded-full bg-leaf" /> online
            </p>
          </div>
        </div>

        {/* messages, pinned to the bottom so new ones push old ones up */}
        <div className="flex flex-1 flex-col justify-end gap-3 overflow-hidden px-3 pb-3 text-[15px] leading-snug">
          {phase >= 2 && (
            <div className="flex animate-inRight justify-end">
              <div className="max-w-[85%] rotate-1 rounded-wobblySm border-2 border-pencil bg-pen px-3 py-2 text-white shadow-hardSm">{userText}</div>
            </div>
          )}
          {phase === 3 && (
            <div className="flex animate-inLeft">
              <div className="-rotate-1 rounded-wobblyMd border-2 border-pencil bg-white px-3 py-1.5 shadow-hardSm">
                <TypingDots className="text-pencil/60" />
              </div>
            </div>
          )}
          {phase >= 4 && (
            <>
              <div className="flex animate-inLeft">
                <div className="-rotate-1 rounded-wobblyMd border-2 border-pencil bg-white px-3 py-2 shadow-hardSm">
                  <WriteOn text={l('demoBot')} step={45} />
                </div>
              </div>
              <div className={cx('relative animate-flipIn rounded-wobblyMd border-2 border-pencil bg-white p-3 shadow-soft [rotate:-1deg]', phase >= 6 && 'opacity-60')}>
                <Tape className="!h-5 !w-16" />
                <ul className="stagger space-y-1">
                  <li className="flex gap-1">
                    <b className="font-heading text-pen">2×</b> {l('demoItem1')}
                    <span className="flex-1 translate-y-[-3px] border-b-2 border-dotted border-pencil/30" />
                    {fmt(3000)}
                  </li>
                  <li className="flex gap-1">
                    {l('demoItem2')}
                    <span className="flex-1 translate-y-[-3px] border-b-2 border-dotted border-pencil/30" />
                    {fmt(600)}
                  </li>
                </ul>
                <div className="mt-2 flex items-baseline justify-between border-t-2 border-dashed border-pencil pt-1.5">
                  <span className="font-heading font-bold">Total</span>
                  <span className="font-heading text-2xl font-bold text-marker">{total}</span>
                </div>
                {phase < 6 && (
                  <div
                    className={cx(
                      'mt-2 flex items-center justify-center gap-1.5 rounded-wobbly border-2 border-pencil bg-marker py-1.5 font-bold text-white transition-all duration-150',
                      phase === 5 ? 'translate-x-[3px] translate-y-[3px] shadow-none' : 'shadow-hardSm',
                    )}
                  >
                    <Check strokeWidth={3} className="h-4 w-4" /> {l('demoCreate')}
                  </div>
                )}
              </div>
            </>
          )}
          {phase >= 6 && (
            <div className="relative animate-rise">
              <Confetti fire={phase === 6 ? 'go' : null} count={22} spread={150} />
              <div className="relative rounded-wobblyMd border-2 border-pencil bg-postit p-3 text-center shadow-hardSm [rotate:1deg]">
                <p className="font-heading font-bold">🎉 {l('demoReady')}</p>
                <div className="mt-1.5 flex items-center justify-center gap-1.5 rounded-wobbly border-2 border-pencil bg-[#25D366] py-1.5 text-sm font-bold text-white">
                  <WhatsAppLogo className="h-4 w-4 fill-white" /> WhatsApp
                </div>
                {phase === 7 && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="animate-stamp rounded-wobbly border-[4px] border-leaf bg-white/80 px-4 font-heading text-3xl font-bold uppercase tracking-wider text-leaf">
                      {l('demoPaid')}
                    </span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* composer */}
        <div className="flex items-center gap-2 border-t-2 border-dashed border-pencil/30 bg-paper/90 px-3 py-2.5">
          <div className="min-h-[38px] flex-1 truncate rounded-wobbly border-2 border-pencil bg-white px-3 py-1.5 text-[15px]">
            {phase === 1 ? (
              <>
                {userText.slice(0, chars)}
                <span className="ms-px inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-pencil" />
              </>
            ) : (
              <span className="text-pencil/40">…</span>
            )}
          </div>
          <span className={cx('flex h-10 w-10 items-center justify-center rounded-blob border-2 border-pencil text-white shadow-hardSm transition-colors', phase === 1 ? 'bg-pen' : 'bg-marker')}>
            {phase === 1 ? <Send strokeWidth={2.5} className="h-4 w-4" /> : <Mic strokeWidth={2.5} className="h-5 w-5" />}
          </span>
        </div>

        {/* "you got paid" toast */}
        {phase === 7 && (
          <div className="absolute inset-x-3 top-10 z-30 animate-toastIn rounded-wobbly border-2 border-pencil bg-leaf px-3 py-2 text-center font-heading font-bold text-white shadow-hard">
            💰 {l('demoToast', { amount: total })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- marquee ---------- */

function Marquee() {
  const { l } = useLanding()
  const items = l('marquee').split('|')
  const band = (reverse?: boolean) => (
    <div dir="ltr" className="flex w-max animate-marquee gap-10 pe-10" style={reverse ? { animationDirection: 'reverse', animationDuration: '36s' } : undefined}>
      {[...items, ...items].map((it, i) => (
        <span key={i} className="flex items-center gap-3 whitespace-nowrap font-heading text-2xl font-bold md:text-3xl">
          <MessageCircle strokeWidth={2.5} className="h-6 w-6" />“{it}”
        </span>
      ))}
    </div>
  )
  return (
    <section aria-hidden className="relative h-40 md:h-48">
      <div className="absolute inset-x-[-5%] top-1/2 -translate-y-1/2 rotate-3 overflow-hidden border-y-[3px] border-pencil bg-pen py-3 text-white/90">
        {band(true)}
      </div>
      <div className="absolute inset-x-[-5%] top-1/2 -translate-y-1/2 -rotate-2 overflow-hidden border-y-[3px] border-pencil bg-marker py-4 text-white shadow-hard">
        {band()}
      </div>
    </section>
  )
}

/* ---------- how it works ---------- */

function TiltCard({ children, className, tilt = 0 }: { children: ReactNode; className?: string; tilt?: number }) {
  const ref = useTilt<HTMLDivElement>(12)
  return (
    <div ref={ref} className="h-full [perspective:900px]">
      <div
        className={cx('preserve-3d h-full transition-transform duration-200 ease-out', className)}
        style={{ transform: `rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)) rotate(${tilt}deg)` }}
      >
        {children}
      </div>
    </div>
  )
}

function SectionTitle({ kicker, title, className }: { kicker: string; title: string; className?: string }) {
  return (
    <Reveal className={cx('mb-12 text-center md:mb-16', className)}>
      <p className="mb-2 inline-block -rotate-2 rounded-wobblySm border-2 border-pencil bg-postit px-3 py-0.5 text-lg shadow-hardSm">{kicker}</p>
      <h2 className="font-heading text-4xl font-bold leading-tight md:text-6xl">{title}</h2>
    </Reveal>
  )
}

function HowItWorks() {
  const { l } = useLanding()
  const [lineRef, lineIn] = useInView<SVGSVGElement>()
  const steps = [
    {
      title: l('step1T'),
      desc: l('step1D'),
      tone: 'bg-white',
      tilt: -2,
      art: (
        <div className="flex items-center gap-2">
          <div className="tail-right relative flex-1 rotate-1 rounded-wobblySm border-2 border-pencil bg-pen px-3 py-2 text-base text-white">“{l('demoUser')}”</div>
          <IconBlob tone="marker" className="animate-pulseRing">
            <Mic strokeWidth={2.5} />
          </IconBlob>
        </div>
      ),
    },
    {
      title: l('step2T'),
      desc: l('step2D'),
      tone: 'bg-postit',
      tilt: 1.5,
      art: <MiniReceipt />,
    },
    {
      title: l('step3T'),
      desc: l('step3D'),
      tone: 'bg-white',
      tilt: -1,
      art: (
        <div className="flex items-center justify-center gap-2 rounded-wobbly border-[3px] border-pencil bg-[#25D366] px-4 py-2.5 font-heading text-lg font-bold text-white shadow-hard">
          <WhatsAppLogo className="h-6 w-6 fill-white" /> WhatsApp
        </div>
      ),
    },
  ]

  return (
    <section id="how" className="relative mx-auto max-w-6xl scroll-mt-24 px-4 py-20 md:px-6 md:py-28">
      <SectionTitle kicker={l('howKicker')} title={l('howTitle')} />

      <div className="relative">
        {/* Squiggly line connecting the steps, drawn as it scrolls in. */}
        <svg ref={lineRef} aria-hidden viewBox="0 0 1000 80" preserveAspectRatio="none" className={cx('absolute inset-x-0 top-6 hidden h-20 w-full md:block', lineIn && 'is-in')}>
          <path
            d="M60 50 C 180 -10, 280 90, 400 40 S 620 -10, 700 45 S 880 70, 950 30"
            fill="none"
            stroke="#2d2d2d"
            strokeOpacity=".45"
            strokeWidth="3"
            strokeLinecap="round"
            className="draw-path"
            style={{ '--len': 1200 } as CSSProperties}
          />
        </svg>

        <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
          {steps.map((s, i) => (
            <Reveal as="li" key={i} delay={i * 150} tilt={i % 2 ? 2 : -2} className="h-full">
              <TiltCard tilt={s.tilt}>
                <div className={cx('relative flex h-full flex-col rounded-wobblyMd border-[3px] border-pencil p-6 pt-10 shadow-hard', s.tone)}>
                  <span
                    className="absolute -top-7 start-6 flex h-14 w-14 items-center justify-center rounded-blob border-[3px] border-pencil bg-marker font-heading text-3xl font-bold text-white shadow-hardSm"
                    style={{ transform: 'translateZ(50px)' }}
                  >
                    {i + 1}
                  </span>
                  <div className="mb-5" style={{ transform: 'translateZ(30px)' }}>
                    {s.art}
                  </div>
                  <h3 className="font-heading text-3xl font-bold">{s.title}</h3>
                  <p className="mt-2 text-xl leading-snug text-pencil/75">{s.desc}</p>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </ol>
      </div>

      <Reveal delay={300} className="mt-14 flex justify-center">
        <p className="inline-flex -rotate-1 items-center gap-2 rounded-wobbly border-2 border-dashed border-pencil bg-white px-5 py-2 text-xl">
          ⏱ {l('howTime')}
        </p>
      </Reveal>
    </section>
  )
}

function MiniReceipt() {
  const { fmt } = useApp()
  const { l } = useLanding()
  return (
    <div className="rounded-wobblySm border-2 border-pencil bg-white p-3 text-base shadow-hardSm [rotate:-1deg]">
      <p className="flex gap-1">
        <b className="font-heading text-pen">2×</b> {l('demoItem1')}
        <span className="flex-1 translate-y-[-3px] border-b-2 border-dotted border-pencil/30" />
        {fmt(3000)}
      </p>
      <p className="flex gap-1">
        {l('demoItem2')}
        <span className="flex-1 translate-y-[-3px] border-b-2 border-dotted border-pencil/30" />
        {fmt(600)}
      </p>
      <p className="mt-1 flex justify-between border-t-2 border-dashed border-pencil pt-1 font-heading font-bold">
        Total <span className="text-marker">{fmt(3600)}</span>
      </p>
    </div>
  )
}

/* ---------- pricing ---------- */

function Pricing({ onStart }: { onStart: () => void }) {
  const { settings } = useApp()
  const { l } = useLanding()
  const [ref, inView] = useInView<HTMLDivElement>()
  const pct = useCountUp(FEE_RATE * 10000, 1400, inView) / 10000
  const shownFee = new Intl.NumberFormat(localeOf(settings.lang), { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pct)
  const perks = [l('perk1'), l('perk2'), l('perk3'), l('perk4')]

  return (
    <section id="price" className="relative scroll-mt-24 overflow-hidden border-y-[3px] border-dashed border-pencil bg-white/60 py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 md:grid-cols-2 md:px-6">
        <div ref={ref} className={cx('text-center md:text-start', inView && 'is-in')}>
          <Reveal>
            <p className="mb-2 inline-block -rotate-2 rounded-wobblySm border-2 border-pencil bg-postit px-3 py-0.5 text-lg shadow-hardSm">{l('priceKicker')}</p>
            <h2 className="font-heading text-4xl font-bold md:text-6xl">{l('priceTitle')}</h2>
          </Reveal>

          <div className="relative my-6 inline-block px-6 py-2">
            <span className="font-heading text-[5.5rem] font-bold leading-none text-marker tabular-nums sm:text-[7.5rem]">{shownFee}</span>
            {/* Hand-drawn circle around the number */}
            <svg aria-hidden viewBox="0 0 400 180" preserveAspectRatio="none" className="pointer-events-none absolute -inset-x-2 -inset-y-3 h-[calc(100%+1.5rem)] w-[calc(100%+1rem)]">
              <path
                d="M200 12 C 330 8, 392 50, 388 95 C 384 150, 290 172, 190 170 C 80 168, 10 140, 14 88 C 18 40, 90 14, 215 16"
                fill="none"
                stroke="#2d5da1"
                strokeWidth="5"
                strokeLinecap="round"
                className="draw-path"
                style={{ '--len': 1000, '--delay': '400ms' } as CSSProperties}
              />
            </svg>
            <span className="absolute -end-4 -top-4 rotate-12 rounded-wobblySm border-2 border-pencil bg-postit px-2 text-lg shadow-hardSm">
              {l('perSale')}
            </span>
          </div>

          <Reveal delay={150}>
            <p className="mx-auto max-w-md text-2xl leading-snug text-pencil/80 md:mx-0">{l('priceSub')}</p>
          </Reveal>

          <ul className="mx-auto mt-8 grid max-w-md gap-3 text-start sm:grid-cols-2 md:mx-0">
            {perks.map((p, i) => (
              <Reveal as="li" key={p} delay={200 + i * 90} tilt={0} className="flex items-center gap-2 text-xl">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-blob border-2 border-pencil bg-leaf text-white">
                  <Check strokeWidth={3.5} className="h-4 w-4" />
                </span>
                {p}
              </Reveal>
            ))}
          </ul>
        </div>

        <Reveal delay={200} tilt={3}>
          <Calculator onStart={onStart} />
        </Reveal>
      </div>
    </section>
  )
}

function Calculator({ onStart }: { onStart: () => void }) {
  const { fmt } = useApp()
  const { l } = useLanding()
  const [sale, setSale] = useState(100)
  const [burst, setBurst] = useState(0)
  const cents = sale * 100
  const feeCents = Math.round(cents * FEE_RATE)
  const youCents = cents - feeCents
  const shownYou = useCountUp(youCents, 350)
  const shownFee = useCountUp(feeCents, 350)
  const min = 10
  const max = 2000
  const p = ((sale - min) / (max - min)) * 100
  const last = useRef(sale)

  // A little confetti when crossing each 500 mark.
  useEffect(() => {
    if (Math.floor(sale / 500) > Math.floor(last.current / 500)) setBurst((b) => b + 1)
    last.current = sale
  }, [sale])

  return (
    <Card tone="postit" decoration="tack" tilt={1.5} className="!p-6 md:!p-8">
      <h3 className="mb-6 flex items-center gap-2 font-heading text-3xl font-bold">
        <PiggyBank strokeWidth={2.5} className="h-8 w-8 text-marker" /> {l('calcTitle')}
      </h3>

      <label className="block">
        <span className="flex items-baseline justify-between gap-3 text-xl">
          {l('calcSale')}
          <span className="relative font-heading text-4xl font-bold tabular-nums">
            {fmt(cents)}
            <Confetti fire={burst || null} count={18} spread={110} />
          </span>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={10}
          value={sale}
          onChange={(e) => setSale(Number(e.target.value))}
          className="range-sketch mt-4"
          style={{ '--p': `${p}%` } as CSSProperties}
        />
      </label>

      <div className="mt-8 space-y-3 text-xl">
        <div className="flex items-baseline gap-2">
          <span>{l('calcFee')}</span>
          <span aria-hidden className="mx-1 flex-1 translate-y-[-4px] border-b-2 border-dotted border-pencil/30" />
          <span className="tabular-nums text-marker">− {fmt(Math.round(shownFee))}</span>
        </div>
        {/* Proportion bar: how thin the fee slice really is */}
        <div className="flex h-5 overflow-hidden rounded-wobblySm border-2 border-pencil bg-white">
          <span className="h-full bg-leaf transition-all duration-300" style={{ width: `${100 - FEE_RATE * 100}%` }} />
          <span className="h-full min-w-[4px] flex-1 bg-marker" />
        </div>
        <div className="flex items-baseline justify-between gap-2 border-t-[3px] border-dashed border-pencil pt-3">
          <span className="font-heading text-2xl font-bold">{l('calcYou')}</span>
          <span className="font-heading text-4xl font-bold text-leaf tabular-nums md:text-5xl">{fmt(Math.round(shownYou))}</span>
        </div>
      </div>

      <Button variant="accent" size="lg" block className="group mt-8" onClick={onStart}>
        {l('ctaStart')}
        <ArrowRight strokeWidth={3} className="transition-transform duration-200 group-hover:translate-x-1.5 rtl:rotate-180" />
      </Button>
    </Card>
  )
}

/* ---------- features ---------- */

function Features() {
  const { l } = useLanding()
  const items = [
    { icon: Mic, t: l('f1T'), d: l('f1D'), tone: 'marker' as const },
    { icon: Sparkles, t: l('f2T'), d: l('f2D'), tone: 'postit' as const },
    { icon: Users, t: l('f3T'), d: l('f3D'), tone: 'pen' as const },
    { icon: ReceiptText, t: l('f4T'), d: l('f4D'), tone: 'leaf' as const },
    { icon: BellRing, t: l('f5T'), d: l('f5D'), tone: 'marker' as const },
    { icon: Languages, t: l('f6T'), d: l('f6D'), tone: 'white' as const },
  ]
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionTitle kicker={l('featKicker')} title={l('featTitle')} />
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ icon: Icon, t, d, tone }, i) => (
          <Reveal key={t} delay={(i % 3) * 120} tilt={i % 2 ? 2 : -2} className="h-full">
            <TiltCard tilt={[-1.5, 1, -0.5, 1.5, -1, 0.8][i]}>
              <div
                className={cx(
                  'group relative h-full rounded-wobblyMd border-2 border-pencil p-6 shadow-hard transition-shadow duration-200 hover:shadow-hardLg',
                  i % 2 ? 'bg-postit' : 'bg-white',
                )}
              >
                {i % 3 === 1 ? <Tape /> : <span aria-hidden className="absolute -top-3 left-1/2 block h-6 w-6 -translate-x-1/2 rounded-full border-2 border-pencil bg-marker shadow-hardSm" />}
                <div style={{ transform: 'translateZ(40px)' }}>
                  <IconBlob tone={tone} className="mb-4 h-14 w-14 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110">
                    <Icon strokeWidth={2.5} className="h-7 w-7" />
                  </IconBlob>
                </div>
                <h3 className="font-heading text-2xl font-bold">{t}</h3>
                <p className="mt-1 text-xl leading-snug text-pencil/75">{d}</p>
              </div>
            </TiltCard>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ---------- FAQ ---------- */

function Faq() {
  const { l } = useLanding()
  const qa: [keyof LandingStrings, keyof LandingStrings][] = [
    ['q1', 'a1'],
    ['q2', 'a2'],
    ['q3', 'a3'],
    ['q4', 'a4'],
  ]
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-20 md:px-6">
      <SectionTitle kicker="?" title={l('faqTitle')} />
      <div className="space-y-5">
        {qa.map(([q, a], i) => (
          <Reveal key={q} delay={i * 90} tilt={i % 2 ? 1 : -1}>
            <details
              className={cx(
                'group rounded-wobblyMd border-2 border-pencil bg-white shadow-hardSm transition-all duration-150 open:bg-postit open:shadow-hard',
                i % 2 ? 'hover:rotate-[0.6deg]' : 'hover:-rotate-[0.6deg]',
              )}
            >
              <summary className="flex min-h-[60px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-heading text-xl font-bold md:text-2xl [&::-webkit-details-marker]:hidden">
                {l(q)}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-blob border-2 border-pencil bg-white transition-transform duration-300 group-open:rotate-[135deg] group-open:bg-marker group-open:text-white">
                  <Plus strokeWidth={3} className="h-5 w-5" />
                </span>
              </summary>
              <p className="animate-rise px-5 pb-5 text-xl leading-snug text-pencil/80">{l(a)}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ---------- final CTA + footer ---------- */

function FinalCta({ onStart }: { onStart: () => void }) {
  const { l } = useLanding()
  return (
    <section className="relative mx-auto max-w-4xl px-4 pb-24 pt-10 md:px-6">
      <Reveal tilt={-3}>
        <div className="relative rotate-[-1.5deg] rounded-wobbly border-[3px] border-pencil bg-postit px-6 py-14 text-center shadow-hardLg md:px-12 md:py-16">
          <Tape className="!w-32" />
          <span aria-hidden className="absolute -end-5 -top-8 hidden h-20 w-20 animate-bob rounded-blob border-[3px] border-dashed border-marker md:block" />
          <span aria-hidden className="absolute -bottom-6 -start-4 hidden text-6xl md:block">
            <span className="inline-block animate-float [--r:-10deg]">💸</span>
          </span>
          <h2 className="font-heading text-5xl font-bold md:text-7xl">
            {l('finalTitle')}
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-2xl text-pencil/75">{l('finalSub')}</p>
          <div className="mt-8 flex justify-center">
            <Button variant="accent" size="lg" onClick={onStart} className="group md:!min-h-[68px] md:!px-10 md:!text-3xl">
              {l('ctaStart')}
              <ArrowRight strokeWidth={3} className="transition-transform duration-200 group-hover:translate-x-2 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

function Footer() {
  const { l } = useLanding()
  return (
    <footer className="border-t-[3px] border-dashed border-pencil/50 px-4 py-10 text-center md:px-6">
      <p className="font-heading text-3xl font-bold">
        Easy<span className="inline-block -rotate-6 text-marker">Pay</span>
      </p>
      <p className="mt-2 text-lg text-pencil/60">
        {l('footer')} · © {new Date().getFullYear()}
      </p>
    </footer>
  )
}

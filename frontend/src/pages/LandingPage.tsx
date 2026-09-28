import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, Copy, Link2, Mic, Plus, Send } from 'lucide-react'
import { LANGS, type LangCode } from '../i18n/strings'
import { FEE_RATE, LANDING, type LandingStrings } from '../i18n/landing'
import { localeOf, useApp } from '../lib/app'
import { Button, cx, Squiggle } from '../components/ui'
import { Confetti, Reveal, TypingDots, useCountUp, useInView, useScene3D, WriteOn } from '../components/motion'
import { WhatsAppLogo } from '../components/ShareActions'

/* ---------- helpers ---------- */

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

const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const host = () => window.location.host
/** A made-up link id so the demo shows what a real link looks like. */
const DEMO_LINK = 'p/k7Q2x'

/** Steps through `durations` in a loop while `active`. Returns the current step. */
function useLoop(durations: number[], active = true) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!active) return
    if (reduced()) return setStep(durations.length - 1)
    const id = window.setTimeout(() => setStep((s) => (s + 1) % durations.length), durations[step])
    return () => clearTimeout(id)
  }, [step, active]) // durations is a module constant
  return step
}

/** Text with *marked* words painted over with a highlighter. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split('*').map((part, i) =>
        i % 2 ? (
          <span key={i} className="relative inline-block text-marker">
            <span
              aria-hidden
              className="absolute inset-x-[-4px] bottom-[6%] -z-10 h-[42%] origin-left -rotate-[1.5deg] animate-highlight rounded-wobblySm bg-postit rtl:origin-right"
            />
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="mb-4 inline-flex items-center gap-2 rounded-wobblySm border-2 border-pencil bg-white px-3 py-1 text-lg">{children}</p>
}

/* ---------- page ---------- */

export default function LandingPage() {
  const { me } = useApp()
  const navigate = useNavigate()
  const { l } = useLanding()

  useEffect(() => {
    const prev = document.title
    document.title = `Easy Pay — ${l('heroKicker')}`
    return () => {
      document.title = prev
    }
  })

  // The live demo is the app itself.
  const start = () => navigate(me ? '/' : '/signup')

  return (
    <div className="min-h-full overflow-x-clip">
      <Nav onStart={start} />
      <Hero onStart={start} />
      <HowItWorks />
      <Pricing />
      <Faq />
      <FinalCta onStart={start} />
      <footer className="border-t-2 border-dashed border-pencil/30 px-5 py-8 text-center text-lg text-pencil/50">
        <span className="font-heading font-bold text-pencil">
          Easy<span className="text-marker">Pay</span>
        </span>{' '}
        · {l('footer')}
      </footer>
    </div>
  )
}

/* ---------- nav ---------- */

function Nav({ onStart }: { onStart: () => void }) {
  const { settings, update, me, t } = useApp()
  const navigate = useNavigate()
  const { l } = useLanding()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
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
        scrolled ? 'bg-paper/80 py-2 shadow-[0_2px_0_0_rgba(45,45,45,0.08)] backdrop-blur-md' : 'py-4',
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5">
        <a
          href="#"
          onClick={(e) => (e.preventDefault(), window.scrollTo({ top: 0, behavior: 'smooth' }))}
          className="group me-auto font-heading text-3xl font-bold leading-none"
        >
          Easy<span className="inline-block -rotate-6 text-marker transition-transform duration-200 group-hover:rotate-6">Pay</span>
        </a>
        <nav className="hidden items-center gap-7 lg:flex">
          {links.map(([id, key]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => (e.preventDefault(), scrollToId(id))}
              className="group relative text-xl text-pencil/70 transition-colors hover:text-pencil"
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
            className="min-h-[44px] cursor-pointer appearance-none rounded-wobblySm border-2 border-pencil/20 bg-transparent pe-8 ps-3 text-lg transition-colors hover:border-pencil focus:outline-none focus-visible:ring-4 focus-visible:ring-pen/30"
          >
            {LANGS.map((lg) => (
              <option key={lg.code} value={lg.code}>
                {lg.flag} {lg.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden strokeWidth={3} className="pointer-events-none absolute end-2 top-1/2 h-4 w-4 -translate-y-1/2" />
        </label>
        {!me && (
          <button onClick={() => navigate('/login')} className="min-h-[44px] px-2 text-lg font-bold text-pen underline decoration-wavy underline-offset-4">
            {t('loginCta')}
          </button>
        )}
        <Button variant="accent" onClick={onStart} className="hidden !min-h-[44px] !text-lg sm:inline-flex">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-white/70" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          {l('demoBtn')}
        </Button>
      </div>
    </header>
  )
}

/* ---------- hero ---------- */

function Hero({ onStart }: { onStart: () => void }) {
  const { l, fee } = useLanding()
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-4 px-5 pb-10 pt-8 md:min-h-[calc(100svh-80px)] md:grid-cols-[1.15fr_1fr] md:gap-8 md:pb-16 md:pt-4">
      <div className="relative z-10">
        <h1 className="font-heading text-[2.9rem] font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          <span className="block animate-rise">{l('heroTitle1')}</span>
          <span className="isolate block animate-rise [animation-delay:.12s]">
            <Marked text={l('heroTitle2')} />
          </span>
        </h1>
        <p className="mt-6 max-w-md animate-rise text-xl leading-relaxed text-pencil/70 [animation-delay:.25s] md:text-2xl">{l('heroSub')}</p>
        <div className="mt-8 flex animate-rise flex-wrap items-center gap-4 [animation-delay:.38s]">
          <Button variant="accent" size="lg" onClick={onStart} className="group">
            {l('ctaDemo')}
            <ArrowRight
              strokeWidth={3}
              className="transition-transform duration-200 group-hover:translate-x-1.5 rtl:rotate-180 rtl:group-hover:-translate-x-1.5"
            />
          </Button>
          <Button variant="ghost" size="lg" onClick={() => scrollToId('how')}>
            {l('ctaHow')}
          </Button>
        </div>
        <ul className="mt-8 flex animate-rise flex-wrap gap-x-5 gap-y-2 text-lg text-pencil/70 [animation-delay:.5s]">
          <li className="flex items-center gap-1.5">
            <Check strokeWidth={3} className="h-5 w-5 text-leaf" />
            <b className="font-heading text-marker">{fee}</b> {l('perSale')}
          </li>
          <li className="flex items-center gap-1.5">
            <WhatsAppLogo className="h-5 w-5 fill-[#25D366]" /> WhatsApp
          </li>
          <li className="flex items-center gap-1.5">
            <Check strokeWidth={3} className="h-5 w-5 text-leaf" /> {l('perk1')}
          </li>
        </ul>
      </div>
      <HeroScene />
    </section>
  )
}

/* ---------- 3D scene ---------- */

// 0 idle · 1 typing · 2 sent · 3 dots · 4 receipt · 5 tap "create" · 6 link ready · 7 paid
const DEMO_STEPS = [450, 1000, 250, 550, 1100, 300, 1700, 2000]

function HeroScene() {
  const { fmt } = useApp()
  const { l } = useLanding()
  const ref = useScene3D<HTMLDivElement>()
  const phase = useLoop(DEMO_STEPS)
  const total = fmt(3600)

  // Pointer (--mx/--my) + scroll (--sp) → rotation. Scrolling tips the phone back.
  const scene: CSSProperties = {
    transform:
      'translateY(calc(var(--sp, 0) * 100px)) ' +
      'rotateX(calc(4deg - var(--my, 0) * 6deg + var(--sp, 0) * 22deg)) ' +
      'rotateY(calc(-10deg + var(--mx, 0) * 14deg - var(--sp, 0) * 6deg))',
  }
  const float = (z: number, amp: number): CSSProperties => ({
    transform: `translate3d(calc(var(--mx, 0) * ${amp}px), calc(var(--my, 0) * ${amp * 0.7}px), ${z}px)`,
  })

  return (
    <div ref={ref} className="relative mx-auto h-[470px] w-full max-w-[520px] [perspective:1800px] sm:h-[620px]">
      <div className="preserve-3d absolute inset-0 scale-[.76] sm:scale-100">
        <div className="preserve-3d absolute inset-0" style={scene}>
          <div className="preserve-3d absolute inset-0 animate-phoneIn">
            <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px]" style={{ transform: 'translate(-50%, -50%) translateZ(-160px)' }}>
              <div className="h-full w-full rounded-blob bg-postit" />
            </div>

            <Phone3D phase={phase} />

            {/* The generated link flies out of the phone */}
            {phase >= 6 && (
              <div className="absolute -end-2 top-[46%] sm:-end-12" style={float(120, 12)}>
                <div className="animate-popIn rounded-wobblyMd border-[3px] border-pencil bg-white px-4 py-3 shadow-hardLg">
                  <p className="flex items-center gap-1.5 text-base text-pencil/60">
                    <Link2 strokeWidth={2.5} className="h-4 w-4 text-marker" /> {l('demoLink')}
                  </p>
                  <p className="font-heading text-lg font-bold text-pen underline decoration-2 underline-offset-4">
                    {host()}/{DEMO_LINK}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="font-heading text-2xl font-bold text-marker">{total}</span>
                    <span className="flex items-center gap-1.5 rounded-wobblySm border-2 border-pencil bg-[#25D366] px-2.5 py-1 text-base font-bold text-white">
                      <WhatsAppLogo className="h-4 w-4 fill-white" /> <Send strokeWidth={2.5} className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              </div>
            )}

            {phase === 7 && (
              <div className="absolute -start-2 bottom-16 sm:-start-8" style={float(140, 14)}>
                <div className="relative animate-popIn rounded-wobbly border-2 border-pencil bg-leaf px-4 py-2.5 font-heading text-xl font-bold text-white shadow-hard">
                  💰 {l('demoToast', { amount: total })}
                  <Confetti fire="paid" count={20} spread={130} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A phone with real thickness (stacked slices), a moving glare and a cast shadow. */
function Phone3D({ phase }: { phase: number }) {
  return (
    <div className="preserve-3d absolute left-1/2 top-1/2 -ml-[140px] -mt-[285px] h-[570px] w-[280px]">
      <div className="absolute inset-0 rounded-[46px] bg-pencil/15" style={{ transform: 'translate3d(34px, 30px, -70px)' }} />
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="absolute inset-0 rounded-[46px] bg-pencil" style={{ transform: `translateZ(${-(i + 1) * 1.5}px)` }} />
      ))}
      <div className="absolute inset-0 rounded-[46px] border-[3px] border-pencil bg-pencil p-2.5">
        <PhoneScreen phase={phase} />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-2.5 rounded-[36px]"
        style={{
          transform: 'translateZ(1px)',
          background: 'linear-gradient(115deg, transparent 35%, rgba(255,255,255,.28) 48%, transparent 60%)',
          backgroundSize: '260% 100%',
          backgroundPosition: 'calc(50% - var(--mx, 0) * 60%) 0',
        }}
      />
    </div>
  )
}

function PhoneScreen({ phase }: { phase: number }) {
  const { fmt } = useApp()
  const { l } = useLanding()
  const userText = l('demoUser')
  const typed = useTypedChars(userText.length, phase === 1)

  return (
    <div className="paper-bg relative flex h-full flex-col overflow-hidden rounded-[36px]">
      <div className="absolute left-1/2 top-2 z-20 h-5 w-20 -translate-x-1/2 rounded-full bg-pencil" />
      <div className="flex items-center gap-2 border-b-2 border-dashed border-pencil/20 px-3 pb-2 pt-9">
        <span className="flex h-8 w-8 items-center justify-center rounded-blob border-2 border-pencil bg-postit text-sm">☺</span>
        <div className="leading-tight">
          <p className="font-heading text-sm font-bold">Easy Pay</p>
          <p className="flex items-center gap-1 text-xs text-leaf">
            <span className="h-1.5 w-1.5 rounded-full bg-leaf" /> online
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-end gap-2.5 overflow-hidden px-3 pb-3 text-[15px] leading-snug">
        {phase >= 2 && (
          <div className="flex animate-inRight justify-end">
            <div className="max-w-[85%] rounded-wobblySm border-2 border-pencil bg-pen px-3 py-2 text-white">{userText}</div>
          </div>
        )}
        {phase === 3 && (
          <div className="flex animate-inLeft">
            <div className="rounded-wobblyMd border-2 border-pencil bg-white px-3 py-1">
              <TypingDots className="text-pencil/60" />
            </div>
          </div>
        )}
        {phase >= 4 && (
          <div
            className={cx(
              'animate-flipIn rounded-wobblyMd border-2 border-pencil bg-white p-3 transition-opacity duration-300',
              phase >= 6 && 'opacity-50',
            )}
          >
            <p className="mb-1 text-pencil/60">{l('demoBot')}</p>
            <ul className="stagger space-y-1">
              <li className="flex gap-1">
                <b className="font-heading text-pen">2×</b> {l('demoItem1')}
                <span className="flex-1 translate-y-[-3px] border-b-2 border-dotted border-pencil/25" />
                {fmt(3000)}
              </li>
              <li className="flex gap-1">
                {l('demoItem2')}
                <span className="flex-1 translate-y-[-3px] border-b-2 border-dotted border-pencil/25" />
                {fmt(600)}
              </li>
            </ul>
            <div className="mt-2 flex items-baseline justify-between border-t-2 border-dashed border-pencil pt-1.5">
              <span className="font-heading font-bold">Total</span>
              <span className="font-heading text-2xl font-bold text-marker">{fmt(3600)}</span>
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
        )}
        {phase >= 6 && (
          <div className="relative animate-rise rounded-wobblyMd border-2 border-pencil bg-postit p-3">
            <p className="font-heading font-bold">🎉 {l('demoReady')}</p>
            <p className="truncate text-sm text-pen underline">
              {host()}/{DEMO_LINK}
            </p>
            {phase === 7 && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="animate-stamp rounded-wobbly border-[4px] border-leaf bg-white/85 px-4 font-heading text-3xl font-bold uppercase tracking-wider text-leaf">
                  {l('demoPaid')}
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t-2 border-dashed border-pencil/20 px-3 py-2.5">
        <div className="min-h-[38px] flex-1 truncate rounded-wobbly border-2 border-pencil bg-white px-3 py-1.5 text-[15px]">
          {phase === 1 ? (
            <>
              {userText.slice(0, typed)}
              <span className="ms-px inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-pencil" />
            </>
          ) : (
            <span className="text-pencil/30">…</span>
          )}
        </div>
        <span
          className={cx(
            'flex h-10 w-10 items-center justify-center rounded-blob border-2 border-pencil text-white transition-colors',
            phase === 1 ? 'bg-pen' : 'bg-marker',
          )}
        >
          {phase === 1 ? <Send strokeWidth={2.5} className="h-4 w-4" /> : <Mic strokeWidth={2.5} className="h-5 w-5" />}
        </span>
      </div>
    </div>
  )
}

/** Counts characters up while `active` (typing effect). */
function useTypedChars(length: number, active: boolean) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) return setN(0)
    const per = (DEMO_STEPS[1] - 150) / length
    const id = window.setInterval(() => setN((c) => Math.min(length, c + 1)), per)
    return () => clearInterval(id)
  }, [active, length])
  return n
}

/* ---------- how it works: message → link ---------- */

function SectionHead({ kicker, title }: { kicker: string; title: string }) {
  return (
    <Reveal className="mb-12 max-w-2xl md:mb-16">
      <Kicker>{kicker}</Kicker>
      <h2 className="font-heading text-4xl font-bold leading-tight tracking-tight md:text-6xl">{title}</h2>
    </Reveal>
  )
}

function HowItWorks() {
  const { l } = useLanding()
  const { fmt } = useApp()
  const examples = l('examples')
    .split('|')
    .map((e) => {
      const [text, amount] = e.split('=')
      return { text, cents: Math.round(Number(amount) * 100) }
    })
  const [ref, inView] = useInView<HTMLDivElement>()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!inView || reduced()) return
    const id = window.setInterval(() => setI((n) => (n + 1) % examples.length), 3200)
    return () => clearInterval(id)
  }, [inView, examples.length])
  const ex = examples[i % examples.length]
  const steps = [l('step1'), l('step2'), l('step3')]

  return (
    <section id="how" className="scroll-mt-20 border-y-2 border-dashed border-pencil/25 bg-white/50">
      <div ref={ref} className="mx-auto max-w-6xl px-5 py-20 md:py-28">
        <SectionHead kicker={l('howKicker')} title={l('howTitle')} />

        {/* Re-keyed per example so the whole message → link sequence replays. */}
        <div key={i} className="grid min-h-[260px] items-center gap-4 md:grid-cols-[1fr_auto_1fr] md:gap-8">
          <div className="flex md:justify-end">
            <div className="tail-right relative max-w-md animate-inLeft rounded-wobblySm border-[3px] border-pencil bg-pen px-5 py-4 text-2xl text-white shadow-hard md:text-3xl">
              <WriteOn text={`“${ex.text}”`} step={60} />
            </div>
          </div>

          <svg
            aria-hidden
            viewBox="0 0 120 60"
            className="mx-auto h-16 w-24 rotate-90 text-marker md:h-20 md:w-32 md:rotate-0 rtl:-scale-x-100"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          >
            <path
              d="M6 34 C 36 12, 70 50, 104 28"
              className="animate-draw [animation-delay:.55s]"
              style={{ strokeDasharray: 120, '--len': 120 } as CSSProperties}
            />
            <path
              d="M88 16 L 106 27 L 92 44"
              className="animate-draw [animation-delay:.95s]"
              style={{ strokeDasharray: 50, '--len': 50 } as CSSProperties}
            />
          </svg>

          <div className="flex">
            <div className="w-full max-w-sm animate-popIn rounded-wobblyMd border-[3px] border-pencil bg-white p-5 shadow-hardLg [animation-delay:1.1s]">
              <p className="flex items-center gap-2 text-lg text-pencil/60">
                <Link2 strokeWidth={2.5} className="h-5 w-5 text-marker" /> {l('demoLink')}
              </p>
              <p className="mt-1 truncate font-heading text-xl font-bold text-pen underline decoration-2 underline-offset-4">
                {host()}/{DEMO_LINK}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3 border-t-2 border-dashed border-pencil/40 pt-3">
                <span className="font-heading text-4xl font-bold text-marker">{fmt(ex.cents)}</span>
                <span className="flex items-center gap-2 rounded-wobbly border-2 border-pencil bg-[#25D366] px-3 py-1.5 font-bold text-white shadow-hardSm">
                  <WhatsAppLogo className="h-5 w-5 fill-white" /> WhatsApp
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-center gap-2" aria-hidden>
          {examples.map((_, n) => (
            <span
              key={n}
              className={cx('h-2.5 rounded-full border-2 border-pencil transition-all duration-300', n === i ? 'w-8 bg-marker' : 'w-2.5 bg-white')}
            />
          ))}
        </div>

        <ol className="mx-auto mt-14 grid max-w-4xl gap-6 sm:grid-cols-3">
          {steps.map((s, n) => (
            <Reveal as="li" key={s} delay={n * 120} className="flex items-center gap-3 text-xl">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-blob border-2 border-pencil bg-postit font-heading text-xl font-bold">
                {n + 1}
              </span>
              {s}
            </Reveal>
          ))}
        </ol>
        <p className="mt-8 flex items-center justify-center gap-2 text-center text-lg text-pencil/60">
          <Mic strokeWidth={2.5} className="h-5 w-5 shrink-0 text-marker" /> {l('howNote')}
        </p>
      </div>
    </section>
  )
}

/* ---------- pricing ---------- */

function Pricing() {
  const { settings, fmt } = useApp()
  const { l } = useLanding()
  const [ref, inView] = useInView<HTMLDivElement>()
  const pct = useCountUp(FEE_RATE * 10000, 1200, inView) / 10000
  const shownFee = new Intl.NumberFormat(localeOf(settings.lang), { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    pct,
  )

  const [sale, setSale] = useState(100)
  const cents = sale * 100
  const feeCents = Math.round(cents * FEE_RATE)
  const shownYou = useCountUp(cents - feeCents, 300)
  const shownFeeCents = useCountUp(feeCents, 300)
  const min = 10
  const max = 2000

  return (
    <section id="price" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 md:py-28">
      <div className="grid items-center gap-14 md:grid-cols-2">
        <div ref={ref} className={cx(inView && 'is-in')}>
          <SectionHead kicker={l('priceKicker')} title={l('priceTitle')} />
          <div className="relative -mt-4 inline-flex items-end gap-3">
            <span className="relative px-4 font-heading text-[5.5rem] font-bold leading-none text-marker tabular-nums sm:text-[7rem]">
              {shownFee}
              <svg
                aria-hidden
                viewBox="0 0 400 180"
                preserveAspectRatio="none"
                className="pointer-events-none absolute -inset-3 h-[calc(100%+1.5rem)] w-[calc(100%+1.5rem)]"
              >
                <path
                  d="M200 12 C 330 8, 392 50, 388 95 C 384 150, 290 172, 190 170 C 80 168, 10 140, 14 88 C 18 40, 90 14, 215 16"
                  fill="none"
                  stroke="#2d2d2d"
                  strokeOpacity=".7"
                  strokeWidth="4"
                  strokeLinecap="round"
                  className="draw-path"
                  style={{ '--len': 1000, '--delay': '400ms' } as CSSProperties}
                />
              </svg>
            </span>
            <span className="mb-3 text-2xl text-pencil/60">{l('perSale')}</span>
          </div>
          <p className="mt-8 max-w-md text-2xl leading-snug text-pencil/70">{l('priceSub')}</p>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xl">
            {[l('perk1'), l('perk2'), l('perk3')].map((p) => (
              <li key={p} className="flex items-center gap-2">
                <Check strokeWidth={3} className="h-5 w-5 text-leaf" /> {p}
              </li>
            ))}
          </ul>
        </div>

        <Reveal delay={150}>
          <div className="rounded-wobblyMd border-[3px] border-pencil bg-white p-6 shadow-hardLg md:p-8">
            <label className="block">
              <span className="flex items-baseline justify-between gap-3 text-xl text-pencil/70">
                {l('calcSale')}
                <span className="font-heading text-4xl font-bold text-pencil tabular-nums">{fmt(cents)}</span>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={10}
                value={sale}
                onChange={(e) => setSale(Number(e.target.value))}
                className="range-sketch mt-5"
                style={{ '--p': `${((sale - min) / (max - min)) * 100}%` } as CSSProperties}
              />
            </label>
            <div className="mt-8 flex items-baseline gap-2 text-xl">
              <span className="text-pencil/70">{l('calcFee')}</span>
              <span aria-hidden className="mx-1 flex-1 translate-y-[-4px] border-b-2 border-dotted border-pencil/25" />
              <span className="tabular-nums text-marker">− {fmt(Math.round(shownFeeCents))}</span>
            </div>
            <div className="mt-4 flex items-baseline justify-between gap-2 border-t-[3px] border-dashed border-pencil pt-4">
              <span className="font-heading text-2xl font-bold">{l('calcYou')}</span>
              <span className="font-heading text-4xl font-bold text-leaf tabular-nums md:text-5xl">{fmt(Math.round(shownYou))}</span>
            </div>
          </div>
        </Reveal>
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
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-20">
      <Reveal>
        <h2 className="mb-10 font-heading text-4xl font-bold md:text-5xl">{l('faqTitle')}</h2>
      </Reveal>
      <div className="divide-y-2 divide-dashed divide-pencil/25 border-y-2 border-dashed border-pencil/25">
        {qa.map(([q, a], i) => (
          <Reveal key={q} delay={i * 80}>
            <details className="group">
              <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-4 py-4 font-heading text-xl font-bold transition-colors hover:text-pen md:text-2xl [&::-webkit-details-marker]:hidden">
                {l(q)}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-blob border-2 border-pencil transition-all duration-300 group-open:rotate-[135deg] group-open:bg-marker group-open:text-white">
                  <Plus strokeWidth={3} className="h-5 w-5" />
                </span>
              </summary>
              <p className="animate-rise pb-5 text-xl leading-snug text-pencil/70">{l(a)}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ---------- final CTA with the live demo link ---------- */

function FinalCta({ onStart }: { onStart: () => void }) {
  const { l } = useLanding()
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked: the link is visible anyway */
    }
  }
  return (
    <section className="relative px-5 pb-24 pt-10 text-center">
      <Reveal>
        <div className="relative isolate mx-auto max-w-3xl">
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 -z-10 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-blob bg-postit md:h-96 md:w-[36rem]"
          />
          <h2 className="font-heading text-4xl font-bold leading-tight tracking-tight md:text-6xl">{l('finalTitle')}</h2>
          <p className="mt-6 text-xl text-pencil/70">{l('finalSub')}</p>
          <div className="mx-auto mt-3 flex max-w-md items-center gap-2 rounded-wobbly border-[3px] border-pencil bg-white py-1.5 pe-1.5 ps-5 shadow-hard">
            <a
              href={url}
              onClick={(e) => (e.preventDefault(), onStart())}
              className="min-w-0 flex-1 truncate text-start font-heading text-xl font-bold text-pen underline decoration-2 underline-offset-4"
            >
              {host()}
            </a>
            <button
              onClick={copy}
              aria-label="Copy"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-blob border-2 border-pencil bg-postit transition-transform duration-150 hover:-rotate-12 active:scale-90"
            >
              {copied ? <Check strokeWidth={3} className="h-5 w-5 text-leaf" /> : <Copy strokeWidth={2.5} className="h-5 w-5" />}
            </button>
          </div>
          <div className="mt-8 flex justify-center">
            <Button variant="accent" size="lg" onClick={onStart} className="group">
              {l('ctaFinal')}
              <ArrowRight strokeWidth={3} className="transition-transform duration-200 group-hover:translate-x-1.5 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

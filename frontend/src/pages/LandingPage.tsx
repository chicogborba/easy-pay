import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, MessageCircleQuestion, Mic, Plus, ReceiptText, Send, Sparkles, Tags } from 'lucide-react'
import { LANGS, type LangCode } from '../i18n/strings'
import { FEE_RATE, LANDING, type LandingStrings } from '../i18n/landing'
import { localeOf, useApp } from '../lib/app'
import { Button, cx, Squiggle } from '../components/ui'
import { Confetti, Reveal, TypingDots, useCountUp, useInView, useScene3D, useTilt, WriteOn } from '../components/motion'
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

/** Renders text, highlighting *marked* words as the AI (blue pen, hand-drawn circle, sparkle). */
function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split('*').map((part, i) =>
        i % 2 ? (
          <span key={i} className={cx('relative inline-block px-1 text-pen', part.length < 12 && 'whitespace-nowrap')}>
            {part}
            <svg
              aria-hidden
              viewBox="0 0 120 60"
              preserveAspectRatio="none"
              className="pointer-events-none absolute -inset-x-2 -inset-y-1 h-[calc(100%+0.5rem)] w-[calc(100%+1rem)]"
            >
              <path
                d="M62 6 C 100 4, 116 18, 114 32 C 112 50, 80 56, 55 55 C 22 54, 5 44, 7 29 C 9 14, 34 5, 70 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                className="animate-draw [animation-delay:.7s]"
                style={{ strokeDasharray: 340, '--len': 340 } as CSSProperties}
              />
            </svg>
            <Sparkles aria-hidden strokeWidth={2.5} className="absolute -end-5 -top-3 h-6 w-6 animate-twinkle text-pen md:h-8 md:w-8" />
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

function Kicker({ children, ai }: { children: ReactNode; ai?: boolean }) {
  return (
    <p
      className={cx(
        'mb-4 inline-flex items-center gap-2 rounded-wobblySm border-2 px-3 py-1 text-lg',
        ai ? 'border-pen bg-pen text-white' : 'border-pencil bg-white',
      )}
    >
      {ai && <Sparkles strokeWidth={2.5} className="h-4 w-4" />}
      {children}
    </p>
  )
}

/* ---------- page ---------- */

export default function LandingPage() {
  const { settings } = useApp()
  const navigate = useNavigate()
  const { l } = useLanding()

  useEffect(() => {
    const prev = document.title
    document.title = `Easy Pay — ${l('heroKicker')}`
    return () => {
      document.title = prev
    }
  })

  const start = () => navigate(settings.onboarded ? '/' : '/onboarding')

  return (
    <div className="min-h-full overflow-x-clip">
      <Nav onStart={start} />
      <Hero onStart={start} />
      <HowItWorks />
      <AiSection />
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
  const { settings, update } = useApp()
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
    ['ai', 'navAi'],
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
        <Button onClick={onStart} className="hidden !min-h-[44px] !text-lg sm:inline-flex">
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
    <section className="mx-auto grid max-w-6xl items-center gap-2 px-5 pb-8 pt-6 md:grid-cols-[1.1fr_1fr] md:gap-6 md:pb-20 md:pt-14">
      <div className="relative z-10">
        <div className="animate-rise">
          <Kicker ai>{l('heroKicker')}</Kicker>
        </div>
        <h1 className="font-heading text-[2.75rem] font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          <span className="block animate-rise [animation-delay:.08s]">{l('heroTitle1')}</span>
          <span className="block animate-rise [animation-delay:.2s]">
            <Marked text={l('heroTitle2')} />
          </span>
        </h1>
        <p className="mt-6 max-w-lg animate-rise text-xl leading-relaxed text-pencil/70 [animation-delay:.35s] md:text-2xl">{l('heroSub')}</p>
        <div className="mt-8 flex animate-rise flex-wrap items-center gap-3 [animation-delay:.5s]">
          <Button variant="accent" size="lg" onClick={onStart} className="group">
            {l('ctaStart')}
            <ArrowRight
              strokeWidth={3}
              className="transition-transform duration-200 group-hover:translate-x-1.5 rtl:rotate-180 rtl:group-hover:-translate-x-1.5"
            />
          </Button>
          <button onClick={() => scrollToId('how')} className="group min-h-[48px] px-3 text-xl text-pencil/70 transition-colors hover:text-pencil">
            {l('ctaHow')} <span className="inline-block transition-transform duration-200 group-hover:translate-y-1">↓</span>
          </button>
        </div>
        <p className="mt-5 flex animate-rise items-center gap-2 text-lg text-pencil/60 [animation-delay:.65s]">
          <Check strokeWidth={3} className="h-5 w-5 text-leaf" />
          {l('heroNote')}
        </p>
      </div>
      <HeroScene />
    </section>
  )
}

/* ---------- 3D scene ---------- */

// 0 idle · 1 typing · 2 sent · 3 AI reading · 4 receipt · 5 tap create · 6 link sent · 7 paid
const DEMO_STEPS = [800, 1700, 450, 1500, 2100, 500, 2000, 2900]

function HeroScene() {
  const { l } = useLanding()
  const { fmt } = useApp()
  const ref = useScene3D<HTMLDivElement>()
  const phase = useLoop(DEMO_STEPS)
  const total = fmt(3600)

  // Pointer (--mx/--my) + scroll (--sp) → rotation. Scroll tips the phone back like it's being laid down.
  const scene: CSSProperties = {
    transform:
      'translateY(calc(var(--sp, 0) * 120px)) ' +
      'rotateX(calc(10deg - var(--my, 0) * 10deg + var(--sp, 0) * 32deg)) ' +
      'rotateY(calc(-18deg + var(--mx, 0) * 22deg - var(--sp, 0) * 10deg)) ' +
      'rotateZ(calc(2deg + var(--mx, 0) * -2deg))',
  }
  const float = (z: number, amp: number): CSSProperties => ({
    transform: `translate3d(calc(var(--mx, 0) * ${amp}px), calc(var(--my, 0) * ${amp * 0.7}px), ${z}px)`,
  })

  return (
    <div ref={ref} className="relative mx-auto h-[500px] w-full max-w-[540px] [perspective:1600px] sm:h-[620px]">
      <div className="preserve-3d absolute inset-0 scale-[.8] sm:scale-100">
        <div className="preserve-3d absolute inset-0" style={scene}>
          <div className="preserve-3d absolute inset-0 animate-phoneIn">
            {/* Backdrop blob, far behind */}
            <div
              className="absolute left-1/2 top-1/2 h-[430px] w-[430px] -translate-x-1/2 -translate-y-1/2"
              style={{ transform: 'translate(-50%, -50%) translateZ(-160px)' }}
            >
              <div className="h-full w-full rounded-blob bg-postit" />
            </div>

            <Phone3D phase={phase} />

            {/* Fee sticker */}
            <div className="absolute start-0 top-4 sm:-start-4" style={float(130, 16)}>
              <FeeSticker />
            </div>

            {/* The AI "thought": what it understood from the message */}
            <div className="absolute -end-4 top-[40%] sm:-end-10" style={float(100, 22)}>
              {phase === 3 && (
                <AiCard key="reading">
                  <span className="flex items-center gap-2">
                    {l('demoReading')} <TypingDots className="text-pen" />
                  </span>
                </AiCard>
              )}
              {phase >= 4 && phase <= 6 && (
                <AiCard key="understood" title={l('demoUnderstood')}>
                  <span className="mt-1.5 flex flex-col gap-1.5">
                    <Chip delay={120}>2× {l('demoItem1')}</Chip>
                    <Chip delay={240}>1× {l('demoItem2')}</Chip>
                    <span className="animate-popIn font-heading text-xl font-bold text-marker [animation-delay:.4s]">= {total}</span>
                  </span>
                </AiCard>
              )}
            </div>

            {/* WhatsApp: link sent */}
            {phase === 6 && (
              <div className="absolute bottom-16 start-2 sm:-start-6" style={float(120, 18)}>
                <div className="flex animate-popIn items-center gap-2 rounded-wobblySm border-2 border-pencil bg-[#25D366] px-3 py-2 font-heading text-lg font-bold text-white shadow-hard">
                  <WhatsAppLogo className="h-6 w-6 fill-white" />
                  <Check strokeWidth={3.5} className="h-5 w-5" />
                </div>
              </div>
            )}

            {/* Paid notification pops out of the screen */}
            {phase === 7 && (
              <div className="absolute -end-2 top-10 sm:-end-8" style={float(170, 26)}>
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

function AiCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="animate-popIn rounded-wobblyMd border-2 border-pen bg-white px-4 py-3 text-lg text-pencil shadow-[4px_4px_0_0_#2d5da1]">
      <span className="flex items-center gap-1.5 font-heading font-bold text-pen">
        <Sparkles strokeWidth={2.5} className="h-5 w-5 animate-twinkle" />
        {title ?? 'AI'}
      </span>
      {children}
    </div>
  )
}

function Chip({ delay, children }: { delay: number; children: ReactNode }) {
  return (
    <span
      className="animate-popIn self-start whitespace-nowrap rounded-wobblySm border-2 border-pencil bg-postit px-2 py-0.5 text-base"
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </span>
  )
}

/** Circular sticker with the fee and rotating text around it. */
function FeeSticker() {
  const { l, fee } = useLanding()
  const ring = `${l('perSale')} · ${fee} · ${l('perSale')} · ${fee} · `.toUpperCase()
  return (
    <div className="relative h-28 w-28 sm:h-32 sm:w-32">
      <div className="absolute inset-0 rounded-full border-[3px] border-pencil bg-marker shadow-hard" />
      <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full animate-[spin_18s_linear_infinite] text-white" aria-hidden>
        <defs>
          <path id="fee-ring" d="M60,60 m-45,0 a45,45 0 1,1 90,0 a45,45 0 1,1 -90,0" />
        </defs>
        <text fontSize="10" fill="currentColor" fontFamily="Patrick Hand, cursive" letterSpacing="1">
          <textPath href="#fee-ring" textLength="280" lengthAdjust="spacingAndGlyphs">
            {ring}
          </textPath>
        </text>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-heading text-2xl font-bold text-white [text-shadow:2px_2px_0_#2d2d2d] sm:text-[1.7rem]">
        {fee}
      </span>
    </div>
  )
}

/** A phone with real thickness (stacked slices), a moving glare and a cast shadow. */
function Phone3D({ phase }: { phase: number }) {
  return (
    <div className="preserve-3d absolute left-1/2 top-1/2 -ml-[140px] -mt-[285px] h-[570px] w-[280px]">
      {/* cast shadow */}
      <div className="absolute inset-0 rounded-[46px] bg-pencil/15" style={{ transform: 'translate3d(34px, 30px, -70px)' }} />
      {/* body thickness */}
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="absolute inset-0 rounded-[46px] bg-pencil" style={{ transform: `translateZ(${-(i + 1) * 1.5}px)` }} />
      ))}
      <div className="absolute inset-0 rounded-[46px] border-[3px] border-pencil bg-pencil p-2.5">
        <PhoneScreen phase={phase} />
      </div>
      {/* glare that slides with the pointer */}
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
        <span className="relative flex h-8 w-8 items-center justify-center rounded-blob border-2 border-pencil bg-postit text-sm">
          ☺
          <span className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-pen text-white">
            <Sparkles strokeWidth={3} className="h-2.5 w-2.5" />
          </span>
        </span>
        <div className="leading-tight">
          <p className="font-heading text-sm font-bold">Easy AI</p>
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
              <TypingDots className="text-pen" />
            </div>
          </div>
        )}
        {phase >= 4 && (
          <>
            <div className="flex animate-inLeft">
              <div className="rounded-wobblyMd border-2 border-pencil bg-white px-3 py-2">
                <WriteOn text={l('demoBot')} step={45} />
              </div>
            </div>
            <div
              className={cx(
                'animate-flipIn rounded-wobblyMd border-2 border-pencil bg-white p-3 transition-opacity duration-300',
                phase >= 6 && 'opacity-50',
              )}
            >
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
          </>
        )}
        {phase >= 6 && (
          <div className="relative animate-rise rounded-wobblyMd border-2 border-pencil bg-postit p-3 text-center">
            <p className="font-heading font-bold">🎉 {l('demoReady')}</p>
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
    const per = (DEMO_STEPS[1] - 250) / length
    const id = window.setInterval(() => setN((c) => Math.min(length, c + 1)), per)
    return () => clearInterval(id)
  }, [active, length])
  return n
}

/* ---------- how it works ---------- */

function SectionHead({ id, kicker, title, ai }: { id?: string; kicker: string; title: string; ai?: boolean }) {
  return (
    <Reveal className="mb-12 max-w-2xl md:mb-16">
      <Kicker ai={ai}>{kicker}</Kicker>
      <h2 id={id} className="font-heading text-4xl font-bold leading-tight tracking-tight md:text-5xl">
        {title}
      </h2>
    </Reveal>
  )
}

function HowItWorks() {
  const { l } = useLanding()
  const [lineRef, lineIn] = useInView<SVGSVGElement>()
  const steps = [
    { icon: Sparkles, title: l('step1T'), desc: l('step1D'), tone: 'bg-pen text-white' },
    { icon: ReceiptText, title: l('step2T'), desc: l('step2D'), tone: 'bg-postit' },
    { icon: Send, title: l('step3T'), desc: l('step3D'), tone: 'bg-marker text-white' },
  ]
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 md:py-28">
      <SectionHead kicker={l('howKicker')} title={l('howTitle')} />
      <div className="relative">
        <svg
          ref={lineRef}
          aria-hidden
          viewBox="0 0 1000 40"
          preserveAspectRatio="none"
          className={cx('absolute inset-x-[8%] top-7 hidden h-10 w-[84%] md:block', lineIn && 'is-in')}
        >
          <path
            d="M0 20 C 120 0, 220 40, 340 20 S 560 0, 660 20 S 880 40, 1000 20"
            fill="none"
            stroke="#2d2d2d"
            strokeOpacity=".35"
            strokeWidth="3"
            strokeLinecap="round"
            className="draw-path"
            style={{ '--len': 1100 } as CSSProperties}
          />
        </svg>
        <ol className="relative grid gap-12 md:grid-cols-3 md:gap-10">
          {steps.map(({ icon: Icon, title, desc, tone }, i) => (
            <Reveal as="li" key={i} delay={i * 140} className="group">
              <div className="flex items-center gap-3">
                <span
                  className={cx(
                    'flex h-14 w-14 items-center justify-center rounded-blob border-[3px] border-pencil shadow-hardSm transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-12',
                    tone,
                  )}
                >
                  <Icon strokeWidth={2.5} className="h-6 w-6" />
                </span>
                <span className="font-heading text-5xl font-bold text-pencil/15">0{i + 1}</span>
              </div>
              <h3 className="mt-5 font-heading text-2xl font-bold md:text-3xl">{title}</h3>
              <p className="mt-2 text-xl leading-snug text-pencil/65">{desc}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ---------- AI section ---------- */

// 0 wait · 1 user · 2 typing · 3 question · 4 choices · 5 tapped · 6 receipt
const AI_STEPS = [500, 700, 1100, 700, 1300, 700, 3200]

function AiSection() {
  const { l } = useLanding()
  const items = [
    { icon: Mic, t: l('ai1T'), d: l('ai1D') },
    { icon: MessageCircleQuestion, t: l('ai2T'), d: l('ai2D') },
    { icon: Tags, t: l('ai3T'), d: l('ai3D') },
  ]
  return (
    <section id="ai" className="scroll-mt-20 border-y-2 border-dashed border-pencil/25 bg-white/50">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 md:grid-cols-2 md:py-28">
        <div>
          <SectionHead kicker={l('aiKicker')} title={l('aiTitle')} ai />
          <ul className="-mt-4 space-y-7">
            {items.map(({ icon: Icon, t, d }, i) => (
              <Reveal as="li" key={t} delay={i * 120} className="flex gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-blob border-2 border-pen bg-pen/10 text-pen">
                  <Icon strokeWidth={2.5} className="h-6 w-6" />
                </span>
                <span>
                  <span className="block font-heading text-2xl font-bold">{t}</span>
                  <span className="block text-xl leading-snug text-pencil/65">{d}</span>
                </span>
              </Reveal>
            ))}
          </ul>
        </div>
        <Reveal delay={150}>
          <AiChatDemo />
        </Reveal>
      </div>
    </section>
  )
}

function AiChatDemo() {
  const { l } = useLanding()
  const { fmt } = useApp()
  const [ref, inView] = useInView<HTMLDivElement>()
  const step = useLoop(AI_STEPS, inView)
  const tilt = useTilt<HTMLDivElement>(8)

  return (
    <div ref={tilt} className="[perspective:1000px]">
      <div
        ref={ref}
        className="relative mx-auto min-h-[380px] max-w-md space-y-4 rounded-wobblyMd border-[3px] border-pencil bg-paper p-5 shadow-hardLg transition-transform duration-300 ease-out paper-bg"
        style={{ transform: 'rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))' }}
      >
        <div className="flex items-center gap-2 border-b-2 border-dashed border-pencil/20 pb-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-blob border-2 border-pencil bg-pen text-white">
            <Sparkles strokeWidth={2.5} className="h-5 w-5" />
          </span>
          <span className="font-heading text-lg font-bold">Easy AI</span>
        </div>
        {step >= 1 && (
          <div className="flex animate-inRight justify-end">
            <p className="max-w-[80%] rounded-wobblySm border-2 border-pencil bg-pen px-4 py-2 text-xl text-white">{l('aiChatUser')}</p>
          </div>
        )}
        {step === 2 && (
          <div className="flex animate-inLeft">
            <span className="rounded-wobblyMd border-2 border-pencil bg-white px-4 py-1.5">
              <TypingDots className="text-pen" />
            </span>
          </div>
        )}
        {step >= 3 && (
          <div className="flex animate-inLeft">
            <p className="max-w-[85%] rounded-wobblyMd border-2 border-pencil bg-white px-4 py-2 text-xl">
              <WriteOn text={l('aiChatBot')} step={40} />
            </p>
          </div>
        )}
        {step >= 4 && (
          <div className="flex justify-end gap-3">
            {[l('aiChoice1'), l('aiChoice2')].map((c, i) => (
              <span
                key={c}
                style={{ animationDelay: `${i * 120}ms` }}
                className={cx(
                  'animate-popIn rounded-wobblySm border-2 border-pencil px-4 py-2 text-xl transition-all duration-200',
                  step >= 5 && i === 0 ? 'translate-x-[2px] translate-y-[2px] bg-pen text-white' : 'bg-postit shadow-hardSm',
                  step >= 5 && i === 1 && 'opacity-40',
                )}
              >
                {c}
              </span>
            ))}
          </div>
        )}
        {step >= 6 && (
          <div className="flex animate-flipIn items-center justify-between rounded-wobblyMd border-2 border-pencil bg-white px-4 py-3">
            <span className="text-lg">🍕 + 🥤</span>
            <span className="font-heading text-2xl font-bold text-marker">{fmt(8000)}</span>
            <Check strokeWidth={3} className="h-6 w-6 text-leaf" />
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- pricing ---------- */

function Pricing() {
  const { settings, fmt } = useApp()
  const { l } = useLanding()
  const [ref, inView] = useInView<HTMLDivElement>()
  const pct = useCountUp(FEE_RATE * 10000, 1400, inView) / 10000
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
                  style={{ '--len': 1000, '--delay': '500ms' } as CSSProperties}
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

/* ---------- final CTA ---------- */

function FinalCta({ onStart }: { onStart: () => void }) {
  const { l } = useLanding()
  return (
    <section className="relative px-5 pb-24 pt-10 text-center">
      <Reveal>
        <div className="relative mx-auto max-w-3xl">
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-blob bg-postit md:h-96 md:w-[34rem]"
          />
          <h2 className="font-heading text-4xl font-bold leading-tight tracking-tight md:text-6xl">{l('finalTitle')}</h2>
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

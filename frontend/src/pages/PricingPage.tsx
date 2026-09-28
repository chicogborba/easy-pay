import { useState, type CSSProperties } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { localeOf, useApp } from '../lib/app'
import { guessCountry, flag } from '../lib/profile'
import { breakdown, DEFAULT_FEES, METHODS_BR, METHODS_US, PRICING_CHECKED, SOURCES, type Method } from '../lib/pricing'
import { PRICING, type PricingStrings } from '../i18n/pricing'
import { Button, Card, cx, Squiggle } from '../components/ui'

type Region = 'br' | 'us'

/**
 * Public pricing: what each payment method really costs, provider fee + Easy Pay fee.
 * Brazil (Mercado Pago) has Pix, card and boleto; the US (Stripe) is cards/wallets only.
 */
export default function PricingPage() {
  const { settings, server, me } = useApp()
  const navigate = useNavigate()
  const s = (key: keyof PricingStrings, vars: Record<string, string> = {}) => {
    let out = PRICING[settings.lang][key] ?? PRICING.en[key]
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v)
    return out
  }
  const [region, setRegion] = useState<Region>(() => (guessCountry(settings.lang) === 'BR' ? 'br' : 'us'))
  const fees = server.fees ?? DEFAULT_FEES
  const ourBps = region === 'br' ? fees.br : fees.intl
  const methods = region === 'br' ? METHODS_BR : METHODS_US
  const provider = SOURCES[region].name
  const currency = region === 'br' ? 'BRL' : 'USD'
  const moneyLocale = region === 'br' ? 'pt-BR' : 'en-US'
  const money = (cents: number) => new Intl.NumberFormat(moneyLocale, { style: 'currency', currency }).format(cents / 100)
  const pct = (v: number) =>
    new Intl.NumberFormat(localeOf(settings.lang), { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v)
  const providerFee = (m: Method) =>
    [m.pct ? pct(m.pct) : '', m.fixedCents ? money(m.fixedCents) : ''].filter(Boolean).join(' + ')
  const totalFee = (m: Method) =>
    [pct(m.pct + ourBps / 10_000), m.fixedCents ? money(m.fixedCents) : ''].filter(Boolean).join(' + ')
  const checked = new Intl.DateTimeFormat(localeOf(settings.lang), { month: 'long', year: 'numeric' }).format(new Date(`${PRICING_CHECKED}-15`))

  return (
    <div className="min-h-[100dvh] pb-20">
      <header className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-5">
        <RouterLink to="/welcome" className="me-auto font-heading text-3xl font-bold">
          Easy<span className="inline-block -rotate-6 text-marker">Pay</span>
        </RouterLink>
        <Button variant="ghost" onClick={() => navigate('/welcome')} icon={<ArrowLeft strokeWidth={2.5} className="rtl:rotate-180" />} className="hidden sm:inline-flex" />
        <Button variant="accent" onClick={() => navigate(me ? '/' : '/signup')}>
          {s('startFree')}
        </Button>
      </header>

      <main className="mx-auto max-w-5xl space-y-14 px-5">
        <section className="pt-6 text-center">
          <h1 className="font-heading text-5xl font-bold leading-tight md:text-6xl">{s('title')}</h1>
          <Squiggle className="mx-auto mt-2 w-48 text-marker" />
          <p className="mx-auto mt-4 max-w-xl text-2xl text-pencil/70">{s('sub')}</p>

          {/* Region switch */}
          <div className="mt-8 inline-flex flex-wrap justify-center gap-3" role="tablist">
            {(['br', 'us'] as const).map((r, i) => (
              <button
                key={r}
                role="tab"
                aria-selected={region === r}
                onClick={() => setRegion(r)}
                className={cx(
                  'min-h-[52px] rounded-wobblySm border-[3px] border-pencil px-5 text-xl transition-transform duration-100',
                  i ? 'rotate-1' : '-rotate-1',
                  region === r ? 'bg-postit shadow-hard' : 'bg-white hover:rotate-0',
                )}
              >
                {r === 'br' ? `${flag('BR')} ${s('tabBR')}` : `${flag('US')} ${s('tabUS')}`}
              </button>
            ))}
          </div>
        </section>

        {/* Our fee, big */}
        <section className="flex flex-col items-center gap-2 text-center">
          <p className="text-2xl text-pencil/70">{s('ourFee')}</p>
          <p className="font-heading text-[5rem] font-bold leading-none text-marker tabular-nums md:text-[7rem]">{pct(ourBps / 10_000)}</p>
          <p className="text-2xl">{s('perPaidSale')}</p>
        </section>

        {/* One card per payment method */}
        <section className="grid gap-6 md:grid-cols-2">
          {methods.map((m, i) => (
            <Card key={m.key} decoration={i === 0 ? 'tape' : 'none'} tilt={[-0.8, 0.6, -0.4, 0.9][i % 4]} className="!p-6">
              <div className="mb-4 flex items-center gap-3">
                <span className="text-4xl" aria-hidden>
                  {m.icon}
                </span>
                <h2 className="font-heading text-2xl font-bold leading-tight">{s(`m_${m.key}` as keyof PricingStrings)}</h2>
              </div>
              <dl className="space-y-2 text-xl">
                <Row label={s('colProvider', { provider })} value={providerFee(m)} />
                <Row label={s('colOurs')} value={pct(ourBps / 10_000)} />
                <div className="flex items-baseline justify-between gap-3 border-t-[3px] border-dashed border-pencil pt-2">
                  <dt className="font-heading font-bold">{s('colTotal')}</dt>
                  <dd className="font-heading text-3xl font-bold text-marker tabular-nums">{totalFee(m)}</dd>
                </div>
                <Row label={s('colPayout')} value={s(`p_${m.payout}` as keyof PricingStrings)} />
              </dl>
            </Card>
          ))}
        </section>

        <p className="rounded-wobblySm border-2 border-dashed border-pencil bg-white px-5 py-3 text-center text-xl">
          {region === 'us' ? `ℹ️ ${s('noPixUs')}` : `ℹ️ ${s('installments')}`}
        </p>

        <Calculator methods={methods} ourBps={ourBps} money={money} s={s} currencyCents={region === 'br' ? 10_000 : 5_000} provider={provider} />

        <section className="mx-auto max-w-3xl">
          <div className="divide-y-2 divide-dashed divide-pencil/25 border-y-2 border-dashed border-pencil/25">
            {(
              [
                ['faq1q', 'faq1a'],
                ['faq2q', 'faq2a'],
                ['faq3q', 'faq3a'],
              ] as const
            ).map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-heading text-2xl font-bold">
                  {s(q)}
                  <span className="text-marker transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-xl text-pencil/80">{s(a)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="space-y-3 text-center text-lg text-pencil/60">
          <p>{s('fine', { provider, date: checked })}</p>
          <a href={SOURCES[region].url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-pen underline">
            {s('source', { provider })} <ExternalLink className="h-4 w-4" />
          </a>
        </section>

        <div className="flex justify-center">
          <Button variant="accent" size="lg" onClick={() => navigate(me ? '/' : '/signup')}>
            {s('startFree')} →
          </Button>
        </div>
      </main>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-pencil/70">{label}</dt>
      <span aria-hidden className="mx-1 flex-1 translate-y-[-4px] border-b-2 border-dotted border-pencil/25" />
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

function Calculator({
  methods,
  ourBps,
  money,
  s,
  currencyCents,
  provider,
}: {
  methods: Method[]
  ourBps: number
  money: (c: number) => string
  s: (k: keyof PricingStrings, v?: Record<string, string>) => string
  currencyCents: number
  provider: string
}) {
  const [sale, setSale] = useState(currencyCents / 100)
  const [key, setKey] = useState(methods[0].key)
  const method = methods.find((m) => m.key === key) ?? methods[0]
  const b = breakdown(sale * 100, method, ourBps)
  const min = 5
  const max = 1000

  return (
    <section className="mx-auto max-w-2xl">
      <div className="rounded-wobblyMd border-[3px] border-pencil bg-white p-6 shadow-hardLg md:p-8">
        <h2 className="mb-6 font-heading text-3xl font-bold">🧮 {s('calcTitle')}</h2>
        <label className="block">
          <span className="flex items-baseline justify-between gap-3 text-xl text-pencil/70">
            {s('calcSale')}
            <span className="font-heading text-4xl font-bold text-pencil tabular-nums">{money(sale * 100)}</span>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={5}
            value={sale}
            onChange={(e) => setSale(Number(e.target.value))}
            className="range-sketch mt-5"
            style={{ '--p': `${((sale - min) / (max - min)) * 100}%` } as CSSProperties}
          />
        </label>
        <p className="mb-2 mt-6 text-xl text-pencil/70">{s('calcMethod')}</p>
        <div className="flex flex-wrap gap-2">
          {methods.map((m) => (
            <button
              key={m.key}
              onClick={() => setKey(m.key)}
              aria-pressed={key === m.key}
              className={cx(
                'min-h-[44px] rounded-wobblySm border-2 border-pencil px-3 text-lg transition-transform duration-100 hover:-rotate-1',
                key === m.key ? 'bg-postit shadow-hardSm' : 'bg-white',
              )}
            >
              {m.icon} {s(`m_${m.key}` as keyof PricingStrings)}
            </button>
          ))}
        </div>
        <dl className="mt-6 space-y-2 text-xl">
          <Row label={s('colProvider', { provider })} value={`− ${money(b.provider)}`} />
          <Row label={s('colOurs')} value={`− ${money(b.platform)}`} />
          <div className="flex items-baseline justify-between gap-2 border-t-[3px] border-dashed border-pencil pt-3">
            <dt className="font-heading text-2xl font-bold">{s('youGet')}</dt>
            <dd className="font-heading text-4xl font-bold text-leaf tabular-nums md:text-5xl">{money(Math.max(0, b.youGet))}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

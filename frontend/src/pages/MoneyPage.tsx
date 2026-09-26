import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronRight, Clock, RefreshCw, ShoppingBag, Sparkles, Sun } from 'lucide-react'
import { api, type Stats, type TopItem } from '../lib/api'
import { capitalize, localeOf, useApp, weekdayName } from '../lib/app'
import { Bars } from '../components/Bars'
import { Button, Card, cx, IconBlob, Spinner, Underline } from '../components/ui'

export default function MoneyPage() {
  const { t, fmt, settings } = useApp()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [day, setDay] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    const load = () => api.stats(settings.currency).then((s) => alive && setStats(s)).catch(() => {})
    load()
    const id = window.setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [settings.currency])

  if (!stats)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    )

  const cur = stats.currency
  const tiles = [
    { label: t('today'), value: fmt(stats.today_cents, cur), icon: Sun, postit: true, tilt: -2, shape: 'rounded-blob' },
    { label: t('last30'), value: fmt(stats.month_cents, cur), icon: CalendarDays, tilt: 1.5, shape: 'rounded-wobblyMd' },
    { label: t('sales'), value: String(stats.paid_count), icon: ShoppingBag, tilt: 1, shape: 'rounded-wobbly' },
    {
      label: t('toReceive'),
      value: fmt(stats.waiting_total_cents, cur),
      icon: Clock,
      tilt: -1.5,
      shape: 'rounded-wobblySm',
      sub: stats.waiting_count ? `${stats.waiting_count} ${t('waiting').toLowerCase()}` : undefined,
    },
  ]

  const weekdayFmt = new Intl.DateTimeFormat(localeOf(settings.lang), { weekday: 'short' })
  const longDayFmt = new Intl.DateTimeFormat(localeOf(settings.lang), { weekday: 'long', day: 'numeric', month: 'short' })
  const days = stats.last_7_days
  const selected = days.find((d) => d.day === day) ?? days[days.length - 1]

  return (
    <div className="space-y-9 px-5 pb-10 pt-3">
      <h2 className="font-heading text-4xl font-bold">
        <Underline>{t('tabMoney')}</Underline>
      </h2>

      {/* Hero number on a sticky note */}
      <Card tone="postit" decoration="tape" tilt={-1.5} className="!px-6 !py-7 text-center">
        <p className="text-xl">{t('weekReceived')}</p>
        <p className="font-heading text-6xl font-bold leading-tight text-marker tabular-nums">{fmt(stats.week_cents, cur)}</p>
      </Card>

      <div className="grid grid-cols-2 gap-5">
        {tiles.map(({ label, value, icon: Icon, postit, tilt, shape, sub }) => (
          <div
            key={label}
            style={{ transform: `rotate(${tilt}deg)` }}
            className={cx(
              'flex flex-col items-center gap-1 border-2 border-pencil px-3 py-4 text-center shadow-hardSm transition-transform duration-100 hover:rotate-0',
              shape,
              postit ? 'bg-postit' : 'bg-white',
            )}
          >
            <IconBlob className="h-10 w-10">
              <Icon strokeWidth={2.5} className="h-5 w-5" />
            </IconBlob>
            <span className="font-heading text-2xl font-bold leading-tight tabular-nums">{value}</span>
            <span className="text-base leading-tight text-pencil/70">{label}</span>
            {sub && <span className="text-sm text-pencil/50">{sub}</span>}
          </div>
        ))}
      </div>

      <Tips stats={stats} />

      {/* Last 7 days: tap a day to see its best sellers */}
      <Card>
        <h3 className="font-heading text-2xl font-bold">{t('last7')}</h3>
        <p className="mb-3 text-base text-pencil/60">{t('tapADay')}</p>
        <Bars
          ariaLabel={t('last7')}
          selected={selected.day}
          onSelect={setDay}
          bars={days.map((d, i) => ({
            key: d.day,
            value: d.total_cents,
            label: weekdayFmt.format(Number(d.day)),
            caption: fmt(d.total_cents, cur).replace(/[.,]00(?=\D*$)/, ''),
            highlight: i === days.length - 1,
          }))}
        />
        <div className="mt-5 border-t-2 border-dashed border-pencil/40 pt-4">
          <h4 className="mb-2 font-heading text-xl font-bold">
            {t('bestSellersOn', { day: capitalize(longDayFmt.format(Number(selected.day))) })}
          </h4>
          {selected.top.length === 0 ? (
            <p className="text-lg text-pencil/60">{t('nothingThatDay')}</p>
          ) : (
            <TopList items={selected.top} currency={cur} />
          )}
        </div>
      </Card>

      <Card decoration="tack" tilt={0.6}>
        <h3 className="mb-3 font-heading text-2xl font-bold">
          🏆 {t('bestSellers')} <span className="text-lg font-normal text-pencil/60">· {t('last30')}</span>
        </h3>
        {stats.top_items.length === 0 ? (
          <p className="text-lg text-pencil/60">{t('noSalesYet')}</p>
        ) : (
          <TopList items={stats.top_items} currency={cur} />
        )}
        <Button block variant="secondary" className="mt-5" onClick={() => navigate('/products')} icon={<ShoppingBag strokeWidth={2.5} />}>
          {t('seeAllProducts')}
        </Button>
      </Card>
    </div>
  )
}

function TopList({ items, currency }: { items: TopItem[]; currency: string }) {
  const { fmt } = useApp()
  const navigate = useNavigate()
  return (
    <ol className="space-y-1">
      {items.map((it, i) => (
        <li key={`${it.product_id}-${it.name}`}>
          <button
            disabled={it.product_id == null}
            onClick={() => navigate(`/products/${it.product_id}`)}
            className="flex w-full items-baseline gap-3 rounded-wobblySm px-1 py-1 text-start text-xl transition-colors hover:bg-muted/60"
          >
            <span className="font-heading font-bold text-marker">{i + 1}.</span>
            <span className="min-w-0 flex-1 truncate">
              {it.name} <span className="text-pencil/50">×{it.quantity}</span>
            </span>
            <span className="tabular-nums">{fmt(it.total_cents, currency)}</span>
            {it.product_id != null && <ChevronRight className="h-4 w-4 shrink-0 self-center text-pencil/40 rtl:rotate-180" strokeWidth={3} />}
          </button>
        </li>
      ))}
    </ol>
  )
}

/** AI tips (cached per day), with simple rule-based tips when AI is off. */
function Tips({ stats }: { stats: Stats }) {
  const { t, fmt, settings, server } = useApp()
  const cacheKey = `ep.tips.${settings.lang}.${settings.currency}.${new Date().toDateString()}`
  const [tips, setTips] = useState<string[] | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(cacheKey) ?? 'null')
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(false)

  const localTips = (): string[] => {
    const out: string[] = []
    const top = stats.top_items[0]
    if (top) out.push(t('tipTop', { name: top.name, qty: String(top.quantity) }))
    const best = stats.weekdays.indexOf(Math.max(...stats.weekdays))
    if (stats.weekdays[best] > 0) out.push(t('tipWeekday', { day: capitalize(weekdayName(best, settings.lang)) }))
    if (stats.week_cents > stats.prev_week_cents && stats.prev_week_cents > 0) out.push(t('tipGrowth'))
    if (stats.waiting_total_cents > 0) out.push(t('tipWaiting', { amount: fmt(stats.waiting_total_cents, stats.currency) }))
    return out.length ? out.slice(0, 3) : [t('tipEmpty')]
  }

  const load = async (force = false) => {
    if (!force && tips) return
    if (!server.ai || stats.paid_count === 0) return setTips(localTips())
    setLoading(true)
    try {
      const res = await api.insights(settings.lang, settings.currency)
      const next = res.tips.length ? res.tips : localTips()
      setTips(next)
      sessionStorage.setItem(cacheKey, JSON.stringify(next))
    } catch {
      setTips(localTips())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.ai, cacheKey, stats.paid_count])

  return (
    <Card tone="postit" tilt={1} className="!p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-heading text-2xl font-bold">
          <Sparkles strokeWidth={2.5} className="text-pen" /> {t('tipsTitle')}
        </h3>
        {server.ai && stats.paid_count > 0 && (
          <button
            onClick={() => load(true)}
            disabled={loading}
            aria-label={t('tipsRefresh')}
            className="flex h-11 w-11 items-center justify-center rounded-blob border-2 border-pencil bg-white shadow-hardSm transition-transform duration-100 hover:rotate-45 active:shadow-none disabled:opacity-50"
          >
            <RefreshCw strokeWidth={2.5} className={cx('h-5 w-5', loading && 'animate-spin')} />
          </button>
        )}
      </div>
      {loading && !tips ? (
        <Spinner />
      ) : (
        <ul className="space-y-3">
          {(tips ?? []).map((tip) => (
            <li key={tip} className="text-xl leading-snug">
              {tip}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

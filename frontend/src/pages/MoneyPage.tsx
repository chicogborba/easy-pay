import { useEffect, useState } from 'react'
import { CalendarDays, Clock, ShoppingBag, Sun } from 'lucide-react'
import { api, type Stats } from '../lib/api'
import { localeOf, useApp } from '../lib/app'
import { Card, cx, IconBlob, Spinner, Underline } from '../components/ui'

export default function MoneyPage() {
  const { t, fmt, settings } = useApp()
  const [stats, setStats] = useState<Stats | null>(null)

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
    { label: t('today'), value: fmt(stats.today_cents, cur), icon: Sun, tone: 'postit' as const, tilt: -2, shape: 'rounded-blob' },
    { label: t('last30'), value: fmt(stats.month_cents, cur), icon: CalendarDays, tone: 'white' as const, tilt: 1.5, shape: 'rounded-wobblyMd' },
    { label: t('sales'), value: String(stats.paid_count), icon: ShoppingBag, tone: 'white' as const, tilt: 1, shape: 'rounded-wobbly' },
    {
      label: t('toReceive'),
      value: fmt(stats.waiting_total_cents, cur),
      icon: Clock,
      tone: 'white' as const,
      tilt: -1.5,
      shape: 'rounded-wobblySm',
      sub: stats.waiting_count ? `${stats.waiting_count} ${t('waiting').toLowerCase()}` : undefined,
    },
  ]

  const max = Math.max(1, ...stats.last_7_days.map((d) => d.total_cents))
  const weekday = new Intl.DateTimeFormat(localeOf(settings.lang), { weekday: 'short' })

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
        {tiles.map(({ label, value, icon: Icon, tone, tilt, shape, sub }) => (
          <div
            key={label}
            style={{ transform: `rotate(${tilt}deg)` }}
            className={cx(
              'flex flex-col items-center gap-1 border-2 border-pencil px-3 py-4 text-center shadow-hardSm transition-transform duration-100 hover:rotate-0',
              shape,
              tone === 'postit' ? 'bg-postit' : 'bg-white',
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

      <Card>
        <h3 className="mb-4 font-heading text-2xl font-bold">{t('last7')}</h3>
        <div className="flex h-44 items-end gap-2" role="img" aria-label={t('last7')}>
          {stats.last_7_days.map((d, i) => {
            const h = d.total_cents ? Math.max(8, (d.total_cents / max) * 100) : 3
            const isToday = i === stats.last_7_days.length - 1
            return (
              <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                {d.total_cents > 0 && (
                  <span className="text-xs leading-none text-pencil/70 tabular-nums">
                    {fmt(d.total_cents, cur).replace(/[.,]00(?=\D*$)/, '')}
                  </span>
                )}
                <div
                  title={fmt(d.total_cents, cur)}
                  style={{ height: `${h}%`, transform: `rotate(${i % 2 ? 1.5 : -1.5}deg)` }}
                  className={cx(
                    'w-full rounded-wobblySm border-2 border-pencil',
                    d.total_cents ? (isToday ? 'bg-marker' : 'bg-pen') : 'border-dashed bg-muted',
                  )}
                />
                <span className={cx('text-sm', isToday && 'font-bold text-marker')}>{weekday.format(Number(d.day))}</span>
              </div>
            )
          })}
        </div>
      </Card>

      <Card decoration="tack" tilt={0.6}>
        <h3 className="mb-3 font-heading text-2xl font-bold">🏆 {t('bestSellers')}</h3>
        {stats.top_items.length === 0 ? (
          <p className="text-lg text-pencil/60">{t('noSalesYet')}</p>
        ) : (
          <ol className="space-y-2">
            {stats.top_items.map((it, i) => (
              <li key={it.name} className="flex items-baseline gap-3 text-xl">
                <span className="font-heading font-bold text-marker">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">
                  {it.name} <span className="text-pencil/50">×{it.quantity}</span>
                </span>
                <span className="tabular-nums">{fmt(it.total_cents, cur)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

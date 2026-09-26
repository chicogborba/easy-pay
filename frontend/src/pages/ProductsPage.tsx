import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { api, type ProductSummary } from '../lib/api'
import { useApp } from '../lib/app'
import { Button, cx, Spinner, Underline } from '../components/ui'

const PERIODS = [
  { key: 7, label: 'days7' },
  { key: 30, label: 'days30' },
  { key: 0, label: 'allTime' },
] as const

/** Every product the app learned, ranked by units sold in the chosen period. */
export default function ProductsPage() {
  const { t, fmt, settings } = useApp()
  const navigate = useNavigate()
  const [days, setDays] = useState<number>(30)
  const [items, setItems] = useState<ProductSummary[] | null>(null)

  useEffect(() => {
    let alive = true
    setItems(null)
    api
      .products(settings.currency, days || undefined)
      .then((p) => alive && setItems(p))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [days, settings.currency])

  const max = Math.max(1, ...(items ?? []).map((p) => p.quantity))

  return (
    <div className="px-5 pb-10 pt-3">
      <Button variant="ghost" onClick={() => navigate('/money')} icon={<ArrowLeft strokeWidth={2.5} className="rtl:rotate-180" />} className="mb-5">
        {t('back')}
      </Button>
      <h2 className="mb-5 font-heading text-4xl font-bold">
        <Underline>{t('products')}</Underline>
      </h2>

      <div className="mb-6 flex gap-3" role="tablist">
        {PERIODS.map((p, i) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={days === p.key}
            onClick={() => setDays(p.key)}
            className={cx(
              'min-h-[44px] rounded-wobblySm border-2 border-pencil px-4 text-lg transition-transform duration-100',
              i % 2 ? 'rotate-1' : '-rotate-1',
              days === p.key ? 'bg-pencil text-white' : 'bg-white shadow-hardSm hover:rotate-0',
            )}
          >
            {t(p.label)}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-2xl text-pencil/70">{t('noProducts')}</p>
      ) : (
        <ol className="space-y-4">
          {items.map((p, i) => (
            <li key={p.id}>
              <button
                onClick={() => navigate(`/products/${p.id}`)}
                className={cx(
                  'w-full rounded-wobblyMd border-2 border-pencil bg-white p-4 text-start shadow-soft transition-transform duration-100 hover:shadow-hardSm active:scale-[.98]',
                  i % 2 ? 'hover:rotate-1' : 'hover:-rotate-1',
                  p.quantity === 0 && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-3">
                  <span className={cx('w-8 shrink-0 text-center font-heading text-2xl font-bold', i < 3 && p.quantity ? 'text-marker' : 'text-pencil/40')}>
                    {i < 3 && p.quantity ? ['🥇', '🥈', '🥉'][i] : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xl">{p.name}</p>
                    <p className="text-base text-pencil/60">
                      {p.quantity} {t('sold')} · {fmt(p.revenue_cents)}
                    </p>
                  </div>
                  <ChevronRight className="shrink-0 text-pencil/40 rtl:rotate-180" strokeWidth={3} />
                </div>
                {/* Scribbled progress bar relative to the best seller */}
                <div className="ms-11 mt-2 h-3 rounded-wobblySm border-2 border-pencil bg-muted">
                  <div
                    className="h-full rounded-wobblySm bg-pen"
                    style={{ width: `${(p.quantity / max) * 100}%` }}
                  />
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

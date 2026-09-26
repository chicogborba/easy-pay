import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import { api, type CustomerSummary } from '../lib/api'
import { timeAgo, useApp } from '../lib/app'
import { customerTags, phoneDigits } from '../lib/crm'
import { Avatar, TagSticker } from '../components/CustomerBits'
import { cx, Input, Spinner, Underline } from '../components/ui'

type Sort = 'recent' | 'top' | 'name'

/** CRM list: everyone who ever paid a link, searchable and sortable. */
export default function CustomersPage() {
  const { t, fmt, settings } = useApp()
  const navigate = useNavigate()
  const [all, setAll] = useState<CustomerSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')

  useEffect(() => {
    let alive = true
    const load = () => api.customers(settings.currency).then((c) => alive && setAll(c)).catch(() => alive && setAll((x) => x ?? []))
    load()
    const id = window.setInterval(load, 8000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [settings.currency])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qDigits = phoneDigits(q)
    const list = (all ?? []).filter(
      (c) => !q || c.name.toLowerCase().includes(q) || (qDigits.length >= 3 && phoneDigits(c.phone).includes(qDigits)),
    )
    const by: Record<Sort, (a: CustomerSummary, b: CustomerSummary) => number> = {
      recent: (a, b) => (b.last_purchase_at ?? 0) - (a.last_purchase_at ?? 0),
      top: (a, b) => b.spent_cents - a.spent_cents,
      name: (a, b) => a.name.localeCompare(b.name),
    }
    return list.sort(by[sort])
  }, [all, query, sort])

  const sorts: { key: Sort; label: string }[] = [
    { key: 'recent', label: t('sortRecent') },
    { key: 'top', label: t('sortTop') },
    { key: 'name', label: t('sortName') },
  ]

  return (
    <div className="px-5 pb-8 pt-3">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-4xl font-bold">
          <Underline>{t('tabCustomers')}</Underline>
        </h2>
        {all && all.length > 0 && <span className="text-lg text-pencil/60">{t('customersCount', { n: String(all.length) })}</span>}
      </div>

      {all && all.length > 0 && (
        <>
          <div className="relative mb-4">
            <Search strokeWidth={2.5} className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-pencil/40" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchCustomers')} className="ps-12" />
          </div>
          <div className="mb-6 flex flex-wrap gap-3" role="tablist">
            {sorts.map((s, i) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={sort === s.key}
                onClick={() => setSort(s.key)}
                className={cx(
                  'min-h-[44px] rounded-wobblySm border-2 border-pencil px-4 text-lg transition-transform duration-100',
                  i % 2 ? 'rotate-1' : '-rotate-1',
                  sort === s.key ? 'bg-pencil text-white' : 'bg-white shadow-hardSm hover:rotate-0',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      {all === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8" />
        </div>
      ) : all.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-6xl">👥</p>
          <p className="mt-4 text-2xl text-pencil/70">{t('noCustomers')}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {shown.map((c, i) => (
            <li key={c.id}>
              <button
                onClick={() => navigate(`/customers/${c.id}`)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-wobblyMd border-2 border-pencil bg-white p-4 text-start shadow-soft transition-transform duration-100 hover:shadow-hardSm active:scale-[.98]',
                  i % 2 ? 'hover:rotate-1' : 'hover:-rotate-1',
                )}
              >
                <Avatar id={c.id} name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-xl">{c.name}</span>
                    {customerTags(c, all).map((tag) => (
                      <TagSticker key={tag} tag={tag} />
                    ))}
                  </div>
                  <p className="text-base text-pencil/60">
                    {c.orders === 1 ? t('oneOrder') : t('ordersCount', { n: String(c.orders) })}
                    {c.last_purchase_at && ` · ${timeAgo(c.last_purchase_at, settings.lang)}`}
                  </p>
                </div>
                <span className="shrink-0 font-heading text-xl font-bold tabular-nums">{fmt(c.spent_cents)}</span>
                <ChevronRight className="shrink-0 text-pencil/40 rtl:rotate-180" strokeWidth={3} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

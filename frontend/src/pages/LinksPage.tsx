import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, MessageCirclePlus } from 'lucide-react'
import { api, type Link, type LinkStatus } from '../lib/api'
import { timeAgo, useApp } from '../lib/app'
import { itemsTitle } from '../components/Receipt'
import { Button, cx, Spinner, StatusSticker, Underline } from '../components/ui'

/** Loads the merchant's links and keeps them fresh while the screen is open. */
export function useLinks() {
  const [links, setLinks] = useState<Link[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => api.links().then((l) => alive && setLinks(l)).catch(() => alive && setLinks((c) => c ?? []))
    load()
    const id = window.setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return links
}

export default function LinksPage() {
  const { t, fmt, settings } = useApp()
  const links = useLinks()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<'all' | LinkStatus>('all')

  const filters: { key: 'all' | LinkStatus; label: string }[] = [
    { key: 'all', label: t('all') },
    { key: 'waiting', label: t('waiting') },
    { key: 'paid', label: t('paid') },
  ]
  const shown = (links ?? []).filter((l) => filter === 'all' || l.status === filter)

  return (
    <div className="px-5 pb-8 pt-3">
      <h2 className="mb-5 font-heading text-4xl font-bold">
        <Underline>{t('tabLinks')}</Underline>
      </h2>

      <div className="mb-6 flex gap-3" role="tablist">
        {filters.map((f, i) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cx(
              'min-h-[44px] rounded-wobblySm border-2 border-pencil px-4 text-lg transition-transform duration-100',
              i % 2 ? 'rotate-1' : '-rotate-1',
              filter === f.key ? 'bg-pencil text-white shadow-none' : 'bg-white shadow-hardSm hover:rotate-0',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {links === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8" />
        </div>
      ) : shown.length === 0 ? (
        <div className="py-10 text-center">
          <p className="mb-6 text-2xl text-pencil/70">{t('noLinks')}</p>
          <Button variant="accent" onClick={() => navigate('/')} icon={<MessageCirclePlus strokeWidth={2.5} />}>
            {t('tabNew')}
          </Button>
        </div>
      ) : (
        <ul className="stagger space-y-4">
          {shown.map((l, i) => (
            <li key={l.id}>
              <button
                onClick={() => navigate(`/links/${l.id}`)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-wobblyMd border-2 border-pencil bg-white p-4 text-start shadow-soft transition-all duration-150 hover:-translate-y-1 hover:shadow-hard active:scale-[.98]',
                  i % 2 ? 'hover:rotate-1' : 'hover:-rotate-1',
                  l.status === 'cancelled' && 'opacity-60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xl">
                    {(l.payer_name || l.customer) && (
                      <span className="font-heading font-bold text-pen">{l.payer_name || l.customer} · </span>
                    )}
                    {itemsTitle(l.items)}
                  </p>
                  <p className="text-base text-pencil/60">{timeAgo(l.paid_at ?? l.created_at, settings.lang)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-heading text-2xl font-bold tabular-nums">{fmt(l.total_cents, l.currency)}</span>
                  <StatusSticker status={l.status} label={t(l.status)} />
                </div>
                <ChevronRight className="shrink-0 text-pencil/40 rtl:rotate-180" strokeWidth={3} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

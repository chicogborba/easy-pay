import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, MessageCirclePlus, Phone } from 'lucide-react'
import { api, type CustomerDetail, type CustomerSummary } from '../lib/api'
import { localeOf, timeAgo, useApp } from '../lib/app'
import { customerTags, phoneDigits } from '../lib/crm'
import { itemsTitle } from '../components/Receipt'
import { WhatsAppLogo } from '../components/ShareActions'
import { Avatar, TagSticker } from '../components/CustomerBits'
import { Button, Card, cx, Spinner, StatusSticker } from '../components/ui'

export default function CustomerDetailPage() {
  const id = Number(useParams().id)
  const { t, fmt, settings, toast } = useApp()
  const navigate = useNavigate()
  const [c, setC] = useState<CustomerDetail | null | undefined>()
  const [all, setAll] = useState<CustomerSummary[]>([])
  const [note, setNote] = useState('')

  useEffect(() => {
    api
      .customer(id, settings.currency)
      .then((d) => {
        setC(d)
        setNote(d.note)
      })
      .catch(() => setC(null))
    api.customers(settings.currency).then(setAll).catch(() => {})
  }, [id, settings.currency])

  const saveNote = async () => {
    if (!c || note === c.note) return
    try {
      await api.updateCustomer(c.id, { note })
      setC({ ...c, note })
      toast(`✓ ${t('saved')}`)
    } catch {
      toast(t('errorGeneric'))
    }
  }

  const back = (
    <Button variant="ghost" onClick={() => navigate('/customers')} icon={<ArrowLeft strokeWidth={2.5} className="rtl:rotate-180" />}>
      {t('back')}
    </Button>
  )

  if (c === undefined)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    )
  if (c === null)
    return (
      <div className="px-5 pt-3">
        {back}
        <p className="py-10 text-center text-2xl">{t('noCustomers')}</p>
      </div>
    )

  const digits = phoneDigits(c.phone)
  const first = c.name.split(/\s+/)[0]
  const date = new Intl.DateTimeFormat(localeOf(settings.lang), { dateStyle: 'medium' })
  const facts = [
    { label: t('spent'), value: fmt(c.spent_cents) },
    { label: t('sales'), value: String(c.orders) },
    { label: t('avgTicket'), value: c.orders ? fmt(Math.round(c.spent_cents / c.orders)) : '—' },
    { label: t('customerSince'), value: c.first_purchase_at ? date.format(c.first_purchase_at) : '—' },
  ]

  return (
    <div className="space-y-8 px-5 pb-10 pt-3">
      {back}

      <div className="flex items-center gap-4">
        <Avatar id={c.id} name={c.name} big />
        <div className="min-w-0">
          <h2 className="break-words font-heading text-4xl font-bold leading-tight">{c.name}</h2>
          <p className="text-lg text-pencil/60" dir="ltr">
            {c.phone}
            {c.email && ` · ${c.email}`}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {customerTags(c, all.length ? all : [c]).map((tag) => (
              <TagSticker key={tag} tag={tag} />
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions: talk to the customer or charge them again */}
      <div className="grid grid-cols-2 gap-4">
        <a
          href={`https://wa.me/${digits}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-[56px] items-center justify-center gap-2 rounded-wobbly border-[3px] border-pencil bg-[#25D366] text-xl text-white shadow-hard transition-all duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-hardSm active:shadow-none"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white">
            <WhatsAppLogo className="h-5 w-5 fill-[#25D366]" />
          </span>
          <span className="font-heading font-bold [text-shadow:1px_1px_0_#2d2d2d]">{t('message')}</span>
        </a>
        <a
          href={`tel:+${digits}`}
          className="flex min-h-[56px] items-center justify-center gap-2 rounded-wobbly border-[3px] border-pencil bg-white text-xl shadow-hard transition-all duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-hardSm active:shadow-none"
        >
          <Phone strokeWidth={2.5} /> {t('call')}
        </a>
        <Button
          variant="accent"
          block
          className="col-span-2"
          icon={<MessageCirclePlus strokeWidth={2.5} />}
          onClick={() => navigate(`/?to=${encodeURIComponent(c.name)}`)}
        >
          {t('newLinkFor', { first })}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {facts.map((f, i) => (
          <div
            key={f.label}
            className={cx('rounded-wobblyMd border-2 border-pencil px-3 py-3 text-center shadow-hardSm', i === 0 ? 'bg-postit' : 'bg-white')}
            style={{ transform: `rotate(${[-1.5, 1, 1.5, -1][i]}deg)` }}
          >
            <p className="font-heading text-2xl font-bold tabular-nums">{f.value}</p>
            <p className="text-base text-pencil/70">{f.label}</p>
          </div>
        ))}
      </div>

      <Card tone="postit" decoration="tape" tilt={-0.6}>
        <h3 className="mb-2 font-heading text-2xl font-bold">📝 {t('notes')}</h3>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          placeholder={t('notesPh')}
          rows={3}
          maxLength={1000}
          className="w-full resize-none rounded-wobblySm border-2 border-dashed border-pencil/50 bg-transparent px-3 py-2 text-xl placeholder:text-pencil/40 focus:border-pen focus:outline-none"
        />
      </Card>

      {c.favorites.length > 0 && (
        <Card>
          <h3 className="mb-3 font-heading text-2xl font-bold">❤️ {t('favorites')}</h3>
          <ol className="space-y-2">
            {c.favorites.map((it, i) => (
              <li key={`${it.product_id}-${it.name}`} className="flex items-baseline gap-3 text-xl">
                <span className="font-heading font-bold text-marker">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">
                  {it.name} <span className="text-pencil/50">×{it.quantity}</span>
                </span>
                <span className="tabular-nums">{fmt(it.total_cents)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div>
        <h3 className="mb-3 font-heading text-2xl font-bold">{t('history')}</h3>
        <ul className="stagger space-y-3">
          {c.links.map((l) => (
            <li key={l.id}>
              <button
                onClick={() => navigate(`/links/${l.id}`)}
                className="flex w-full items-center gap-3 rounded-wobblyMd border-2 border-pencil bg-white p-3 text-start shadow-soft transition-transform duration-100 hover:-rotate-1 active:scale-[.98]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg">{itemsTitle(l.items)}</p>
                  <p className="text-base text-pencil/60">{timeAgo(l.paid_at ?? l.created_at, settings.lang)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-heading text-xl font-bold tabular-nums">{fmt(l.total_cents, l.currency)}</span>
                  <StatusSticker status={l.status} label={t(l.status)} />
                </div>
                <ChevronRight className="shrink-0 text-pencil/40 rtl:rotate-180" strokeWidth={3} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

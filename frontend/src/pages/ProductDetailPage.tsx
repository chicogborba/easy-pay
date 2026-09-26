import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Combine, Pencil, X } from 'lucide-react'
import { api, type ProductDetail, type ProductSummary } from '../lib/api'
import { capitalize, localeOf, timeAgo, useApp, weekdayName } from '../lib/app'
import { Bars } from '../components/Bars'
import { Button, Card, cx, Input, Spinner } from '../components/ui'

export default function ProductDetailPage() {
  const id = Number(useParams().id)
  const { t, fmt, settings, toast } = useApp()
  const navigate = useNavigate()
  const [p, setP] = useState<ProductDetail | null | undefined>()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [merging, setMerging] = useState(false)
  const [others, setOthers] = useState<ProductSummary[]>([])

  const load = () => api.product(id, settings.currency).then(setP).catch(() => setP(null))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, settings.currency])

  const rename = async () => {
    if (!name.trim()) return
    try {
      await api.renameProduct(id, name)
      setEditing(false)
      load()
    } catch {
      toast(t('errorGeneric'))
    }
  }

  const openMerge = async () => {
    setMerging(true)
    setOthers((await api.products(settings.currency).catch(() => [])).filter((o) => o.id !== id))
  }

  const mergeInto = async (target: ProductSummary) => {
    try {
      await api.mergeProduct(id, target.id)
      toast(`✓ ${t('mergeDone')}`)
      navigate(`/products/${target.id}`, { replace: true })
    } catch {
      toast(t('errorGeneric'))
    }
  }

  if (p === undefined)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    )

  const back = (
    <Button variant="ghost" onClick={() => navigate(-1)} icon={<ArrowLeft strokeWidth={2.5} className="rtl:rotate-180" />}>
      {t('back')}
    </Button>
  )
  if (p === null)
    return (
      <div className="px-5 pt-3">
        {back}
        <p className="py-10 text-center text-2xl">{t('noProducts')}</p>
      </div>
    )

  const day = new Intl.DateTimeFormat(localeOf(settings.lang), { day: 'numeric' })
  const bestWeekday = p.weekdays.indexOf(Math.max(...p.weekdays))
  const facts = [
    { label: t('unitsSold'), value: String(p.quantity) },
    { label: t('earned'), value: fmt(p.revenue_cents) },
    { label: t('avgPrice'), value: p.quantity ? fmt(p.avg_unit_cents) : '—' },
    { label: t('lastSold'), value: p.last_sold_at ? timeAgo(p.last_sold_at, settings.lang) : '—' },
  ]

  return (
    <div className="space-y-8 px-5 pb-10 pt-3">
      {back}

      {/* Name, editable */}
      {editing ? (
        <div className="flex items-center gap-2">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} maxLength={80} />
          <IconBtn label={t('save')} onClick={rename} tone="bg-leaf text-white">
            <Check strokeWidth={3} />
          </IconBtn>
          <IconBtn label={t('cancel')} onClick={() => setEditing(false)}>
            <X strokeWidth={3} />
          </IconBtn>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 break-words font-heading text-4xl font-bold leading-tight">{p.name}</h2>
          <IconBtn
            label={t('rename')}
            onClick={() => {
              setName(p.name)
              setEditing(true)
            }}
          >
            <Pencil strokeWidth={2.5} className="h-5 w-5" />
          </IconBtn>
        </div>
      )}

      {p.aliases.length > 0 && (
        <div>
          <p className="mb-2 text-lg text-pencil/60">{t('alsoCalled')}:</p>
          <div className="flex flex-wrap gap-2">
            {p.aliases.map((a, i) => (
              <span key={a} className={cx('rounded-wobblySm border-2 border-dashed border-pencil bg-white px-3 py-0.5 text-lg', i % 2 ? 'rotate-1' : '-rotate-1')}>
                “{a}”
              </span>
            ))}
          </div>
        </div>
      )}

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

      <Card>
        <h3 className="mb-3 font-heading text-2xl font-bold">{t('last14')}</h3>
        <Bars
          ariaLabel={t('last14')}
          height="h-36"
          bars={p.last_14_days.map((d, i) => ({
            key: d.day,
            value: d.quantity,
            label: day.format(Number(d.day)),
            caption: String(d.quantity),
            highlight: i === p.last_14_days.length - 1,
          }))}
        />
      </Card>

      <Card decoration="tape" tilt={-0.5}>
        <h3 className="font-heading text-2xl font-bold">{t('byWeekday')}</h3>
        {p.weekdays[bestWeekday] > 0 && (
          <p className="mb-3 text-xl text-marker">⭐ {t('bestDay', { day: capitalize(weekdayName(bestWeekday, settings.lang)) })}</p>
        )}
        <Bars
          ariaLabel={t('byWeekday')}
          height="h-32"
          bars={p.weekdays.map((q, i) => ({
            key: String(i),
            value: q,
            label: weekdayName(i, settings.lang, 'short'),
            caption: String(q),
            highlight: q > 0 && i === bestWeekday,
          }))}
        />
      </Card>

      {/* Manual fix when the AI didn't notice two names are the same product */}
      <Card tone="paper" className="border-dashed">
        <h3 className="mb-1 font-heading text-xl font-bold">{t('mergeTitle')}</h3>
        {!merging ? (
          <Button variant="secondary" block className="mt-3" onClick={openMerge} icon={<Combine strokeWidth={2.5} />}>
            {t('mergeTitle').replace(/[?？؟]$/, '')}
          </Button>
        ) : (
          <>
            <p className="mb-3 text-lg text-pencil/70">{t('mergeHint')}</p>
            <div className="flex flex-wrap gap-2">
              {others.map((o) => (
                <button
                  key={o.id}
                  onClick={() => mergeInto(o)}
                  className="min-h-[44px] rounded-wobblySm border-2 border-pencil bg-white px-3 text-lg shadow-hardSm transition-transform duration-100 hover:-rotate-2 active:shadow-none"
                >
                  {o.name}
                </button>
              ))}
              {others.length === 0 && <p className="text-lg text-pencil/60">{t('noProducts')}</p>}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

function IconBtn({ label, onClick, tone = 'bg-white', children }: { label: string; onClick: () => void; tone?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(
        'flex h-12 w-12 shrink-0 items-center justify-center rounded-blob border-2 border-pencil shadow-hardSm transition-transform duration-100 hover:rotate-12 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none',
        tone,
      )}
    >
      {children}
    </button>
  )
}

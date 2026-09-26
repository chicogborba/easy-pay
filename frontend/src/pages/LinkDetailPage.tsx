import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Eye, UserRound, XCircle } from 'lucide-react'
import { api, type Link } from '../lib/api'
import { localeOf, useApp } from '../lib/app'
import { Receipt } from '../components/Receipt'
import { ShareActions } from '../components/ShareActions'
import { Button, Card, Spinner, StatusSticker } from '../components/ui'
import { methodLabel } from './PayPage'

export default function LinkDetailPage() {
  const { id = '' } = useParams()
  const { t, settings, toast } = useApp()
  const navigate = useNavigate()
  const [link, setLink] = useState<Link | null | undefined>()

  useEffect(() => {
    let alive = true
    const load = () => api.link(id).then((l) => alive && setLink(l)).catch(() => alive && setLink(null))
    load()
    const iv = window.setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [id])

  const cancel = async () => {
    if (!link || !confirm(t('cancelConfirm'))) return
    try {
      setLink(await api.cancel(link.id))
    } catch {
      toast(t('errorGeneric'))
    }
  }

  const date = (ms: number) =>
    new Intl.DateTimeFormat(localeOf(settings.lang), { dateStyle: 'medium', timeStyle: 'short' }).format(ms)

  return (
    <div className="px-5 pb-10 pt-3">
      <Button variant="ghost" onClick={() => navigate('/links')} icon={<ArrowLeft strokeWidth={2.5} className="rtl:rotate-180" />} className="mb-5">
        {t('back')}
      </Button>

      {link === undefined ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8" />
        </div>
      ) : link === null ? (
        <p className="py-10 text-center text-2xl">{t('linkNotFound')}</p>
      ) : (
        <div className="space-y-8">
          <Card decoration="tape" tilt={-0.5} className="!p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <StatusSticker status={link.status} label={t(link.status)} />
              <span className="text-base text-pencil/60">
                {t('created')} {date(link.created_at)}
              </span>
            </div>
            <Receipt items={link.items} currency={link.currency} note={link.note} customer={link.customer} />
            {link.status === 'paid' && link.paid_at && (
              <p className="mt-4 rounded-wobblySm border-2 border-dashed border-leaf bg-leaf/10 px-3 py-2 text-lg text-leaf">
                ✓ {t('paidWith')} {methodLabel(link.paid_method, t)} · {date(link.paid_at)}
              </p>
            )}
            {link.payer_name && (
              <button
                onClick={() => link.customer_id && navigate(`/customers/${link.customer_id}`)}
                className="mt-3 flex w-full items-center gap-3 rounded-wobblySm border-2 border-pencil bg-white px-3 py-2 text-start shadow-hardSm transition-transform duration-100 hover:-rotate-1"
              >
                <UserRound strokeWidth={2.5} className="shrink-0 text-pen" />
                <span className="min-w-0 flex-1">
                  <span className="block text-base text-pencil/60">{t('paidBy')}</span>
                  <span className="block truncate text-xl">{link.payer_name}</span>
                  <span className="block text-base text-pencil/60" dir="ltr">{link.payer_phone}</span>
                </span>
                <span className="shrink-0 text-lg text-pen">{t('seeCustomer')} →</span>
              </button>
            )}
          </Card>

          {link.status === 'waiting' && <ShareActions link={link} />}

          <div className="space-y-3">
            <Button variant="secondary" block icon={<Eye strokeWidth={2.5} />} onClick={() => window.open(`/p/${link.id}`, '_blank')}>
              {t('openAsCustomer')}
            </Button>
            {link.status === 'waiting' && (
              <Button variant="ghost" block icon={<XCircle strokeWidth={2.5} />} onClick={cancel} className="text-marker">
                {t('cancelLink')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Info, KeyRound, LogOut, ShieldCheck, Wallet } from 'lucide-react'
import { CURRENCIES, useApp } from '../lib/app'
import { ApiError, auth } from '../lib/api'
import { Button, Card, Input, Label, Spinner, Underline } from '../components/ui'
import { LanguagePicker } from '../components/LanguagePicker'
import { LANDING } from '../i18n/landing'

export default function SettingsPage() {
  const { t, settings, update, toast, me, logout, signedIn } = useApp()
  const navigate = useNavigate()
  const [business, setBusiness] = useState(settings.business)
  const [params] = useSearchParams()

  // Back from Stripe onboarding: refresh the account to show the new status.
  useEffect(() => {
    if (params.get('stripe')) auth.me().then(signedIn).catch(() => {})
  }, [params, signedIn])

  return (
    <div className="space-y-7 px-5 pb-10 pt-3">
      <Button variant="ghost" onClick={() => navigate(-1)} icon={<ArrowLeft strokeWidth={2.5} className="rtl:rotate-180" />}>
        {t('back')}
      </Button>
      <h2 className="font-heading text-4xl font-bold">
        <Underline>{t('settings')}</Underline>
      </h2>

      <Card className="space-y-6">
        <label className="block">
          <Label>{t('businessName')}</Label>
          <Input value={business} onChange={(e) => setBusiness(e.target.value)} placeholder={t('onboardBusinessPh')} maxLength={60} />
        </label>

        <div>
          <Label>{t('language')}</Label>
          <LanguagePicker value={settings.lang} onChange={(lang) => update({ lang })} />
        </div>

        <div>
          <Label>{t('currency')}</Label>
          <div className="flex flex-wrap gap-2">
            {CURRENCIES.map((c) => (
              <button
                key={c}
                onClick={() => update({ currency: c })}
                aria-pressed={settings.currency === c}
                className={`min-h-[44px] rounded-wobblySm border-2 border-pencil px-3 text-lg transition-transform duration-100 hover:-rotate-2 ${
                  settings.currency === c ? 'bg-pencil text-white' : 'bg-white'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Button
        variant="accent"
        size="lg"
        block
        icon={<Check strokeWidth={3} />}
        onClick={() => {
          update({ business: business.trim() })
          toast(`✓ ${t('saved')}`)
          navigate('/')
        }}
      >
        {t('save')}
      </Button>

      <PaymentsCard />

      <Card className="space-y-4">
        <h3 className="font-heading text-2xl font-bold">{t('accountTitle')}</h3>
        {me && <p className="break-all text-lg text-pencil/70">{t('loggedInAs', { email: me.email })}</p>}
        <PasswordForm />
        <Button
          variant="ghost"
          block
          icon={<LogOut strokeWidth={2.5} />}
          onClick={async () => {
            await logout()
            navigate('/welcome', { replace: true })
          }}
        >
          {t('logout')}
        </Button>
      </Card>

      {me?.is_admin && (
        <Button variant="secondary" block onClick={() => navigate('/admin')} icon={<ShieldCheck strokeWidth={2.5} />}>
          {t('adminPanel')}
        </Button>
      )}

      <Button variant="ghost" block onClick={() => navigate('/welcome')} icon={<Info strokeWidth={2.5} />}>
        {LANDING[settings.lang].aboutApp}
      </Button>
    </div>
  )
}

/** Where the seller's money goes: demo mode today, Stripe when the platform turns it on. */
function PaymentsCard() {
  const { t, me, server, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const stripe = server.payments === 'stripe'
  const ready = !!me?.stripe_charges_enabled

  const connect = async () => {
    setBusy(true)
    try {
      const { url } = await auth.stripeOnboard()
      window.location.href = url
    } catch {
      toast(t('errorGeneric'))
      setBusy(false)
    }
  }

  return (
    <Card tone="postit" tilt={-0.5} className="space-y-3">
      <h3 className="flex items-center gap-2 font-heading text-2xl font-bold">
        <Wallet strokeWidth={2.5} className="text-pen" /> {t('receivePayments')}
      </h3>
      {!stripe ? (
        <p className="text-lg text-pencil/70">{t('demoMode')}</p>
      ) : ready ? (
        <p className="text-xl font-bold text-leaf">{t('stripeReady')}</p>
      ) : (
        <>
          <p className="text-lg text-pencil/70">{t('stripePending')}</p>
          <Button variant="accent" block disabled={busy} onClick={connect} icon={busy ? <Spinner className="border-white border-t-transparent" /> : undefined}>
            {t('connectStripe')}
          </Button>
        </>
      )}
    </Card>
  )
}

function PasswordForm() {
  const { t, toast } = useApp()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open)
    return (
      <Button variant="secondary" block icon={<KeyRound strokeWidth={2.5} />} onClick={() => setOpen(true)}>
        {t('changePassword')}
      </Button>
    )

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setError('')
        if (next.length < 8) return setError(t('passwordHint'))
        setBusy(true)
        try {
          await auth.changePassword(current, next)
          toast(t('passwordChanged'))
          setOpen(false)
          setCurrent('')
          setNext('')
        } catch (err) {
          setError(err instanceof ApiError && err.status === 401 ? t('wrongLogin') : t('errorGeneric'))
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="block">
        <Label>{t('currentPassword')}</Label>
        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="block">
        <Label>{t('newPassword')}</Label>
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <span className="mt-1 block text-base text-pencil/50">{t('passwordHint')}</span>
      </label>
      {error && <p className="text-lg text-marker">{error}</p>}
      <Button type="submit" block disabled={busy} icon={busy ? <Spinner /> : <Check strokeWidth={3} />}>
        {t('save')}
      </Button>
    </form>
  )
}

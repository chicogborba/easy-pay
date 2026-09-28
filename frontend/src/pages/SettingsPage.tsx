import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Info, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { CURRENCIES, useApp } from '../lib/app'
import { ApiError, auth, type ProfileInput } from '../lib/api'
import { PayoutsCard } from '../components/PayoutsCard'
import { ProfileFields } from '../components/ProfileFields'
import { profileError } from '../lib/profile'
import type { Strings } from '../i18n/strings'
import { Button, Card, Input, Label, Spinner, Underline } from '../components/ui'
import { LanguagePicker } from '../components/LanguagePicker'
import { LANDING } from '../i18n/landing'

export default function SettingsPage() {
  const { t, settings, update, toast, me, logout, signedIn } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  // Back from Stripe / Mercado Pago: refresh the account to show the new status.
  useEffect(() => {
    const result = params.get('payments')
    if (!result) return
    auth.me().then(signedIn).catch(() => {})
    if (result === 'error') toast(t('payoutsError'))
    setParams({}, { replace: true })
  }, [params, setParams, signedIn, toast, t])

  return (
    <div className="space-y-7 px-5 pb-10 pt-3">
      <Button variant="ghost" onClick={() => navigate(-1)} icon={<ArrowLeft strokeWidth={2.5} className="rtl:rotate-180" />}>
        {t('back')}
      </Button>
      <h2 className="font-heading text-4xl font-bold">
        <Underline>{t('settings')}</Underline>
      </h2>

      <Card className="space-y-6">
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

      <BusinessCard />

      <PayoutsCard />

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

/** Business details (same fields as sign-up). */
function BusinessCard() {
  const { t, me, toast, signedIn } = useApp()
  const [p, setP] = useState<ProfileInput | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (me && !p)
      setP({
        owner_name: me.owner_name,
        phone: me.phone,
        country: me.country || 'US',
        business_name: me.business_name,
        business_type: me.business_type || 'individual',
        document: me.document,
        category: me.category,
        city: me.city,
        state: me.state,
      })
  }, [me, p])

  if (!p) return null

  const save = async () => {
    setError('')
    const e = profileError(p)
    if (e) return setError(t(e as keyof Strings))
    setBusy(true)
    try {
      signedIn(await auth.updateProfile(p))
      toast(`✓ ${t('saved')}`)
    } catch (err) {
      setError(err instanceof ApiError && err.message === 'invalid_document' ? t('errDocument') : t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-5">
      <h3 className="font-heading text-2xl font-bold">{t('businessDetails')}</h3>
      <ProfileFields part="all" value={p} onChange={setP} lockCountry={me?.payout_connected} />
      {error && <p className="text-lg text-marker">{error}</p>}
      <Button variant="accent" block disabled={busy} onClick={save} icon={busy ? <Spinner className="border-white border-t-transparent" /> : <Check strokeWidth={3} />}>
        {t('save')}
      </Button>
    </Card>
  )
}

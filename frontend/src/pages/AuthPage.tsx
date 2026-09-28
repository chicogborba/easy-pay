import { useState, type FormEvent } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { ApiError, auth, legacyDeviceId } from '../lib/api'
import { useApp } from '../lib/app'
import { LanguagePicker } from '../components/LanguagePicker'
import { Arrow, Button, Card, Input, Label, Spinner } from '../components/ui'

/** Sign up (language, business, email, password) or log in. One screen each, big and simple. */
export default function AuthPage({ mode }: { mode: 'signup' | 'login' }) {
  const { t, settings, update, signedIn } = useApp()
  const navigate = useNavigate()
  const [business, setBusiness] = useState(settings.business)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signup = mode === 'signup'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('invalidEmail'))
    if (signup && password.length < 8) return setError(t('passwordHint'))
    if (signup && !business.trim()) return setError(t('onboardBusiness'))
    setBusy(true)
    try {
      const account = signup
        ? await auth.register({
            email: email.trim(),
            password,
            business_name: business.trim(),
            lang: settings.lang,
            currency: settings.currency,
            claim_id: legacyDeviceId(),
          })
        : await auth.login(email.trim(), password)
      signedIn(account)
      navigate('/', { replace: true })
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      setError(
        status === 409
          ? t('emailTaken')
          : status === 401
            ? t('wrongLogin')
            : status === 429
              ? t('tooMany')
              : status === 403
                ? t('suspended')
                : t('errorGeneric'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md animate-pageIn flex-col justify-center gap-8 px-6 py-10">
      <div className="relative">
        <RouterLink to="/welcome" className="font-heading text-3xl font-bold">
          Easy<span className="inline-block -rotate-6 text-marker">Pay</span>
        </RouterLink>
        <h1 className="mt-4 font-heading text-5xl font-bold leading-tight">
          {signup ? t('signupTitle') : t('loginTitle')}
          <span className="ms-1 inline-block rotate-12 text-marker">!</span>
        </h1>
        <p className="mt-1 text-xl text-pencil/60">{signup ? t('signupSub') : t('loginSub')}</p>
        <span aria-hidden className="absolute -end-2 -top-2 hidden h-16 w-16 animate-bob rounded-blob border-2 border-dashed border-marker md:block" />
      </div>

      <form onSubmit={submit} className="space-y-6" noValidate>
        <Card decoration="tack" tilt={-1} className="space-y-5 !p-6">
          {signup && (
            <>
              <div>
                <Label>🌍</Label>
                <LanguagePicker compact value={settings.lang} onChange={(lang) => update({ lang })} />
              </div>
              <label className="block">
                <Label>{t('onboardBusiness')}</Label>
                <Input value={business} onChange={(e) => setBusiness(e.target.value)} placeholder={t('onboardBusinessPh')} maxLength={60} autoComplete="organization" />
              </label>
            </>
          )}
          <label className="block">
            <Label>{t('emailLabel')}</Label>
            <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} autoFocus={!signup} />
          </label>
          <label className="block">
            <Label>{t('passwordLabel')}</Label>
            <div className="relative">
              <Input
                type={show ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={200}
                className="pe-24"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute end-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-lg text-pen"
              >
                {show ? <EyeOff className="h-5 w-5" strokeWidth={2.5} /> : <Eye className="h-5 w-5" strokeWidth={2.5} />}
                {show ? t('hidePassword') : t('showPassword')}
              </button>
            </div>
            {signup && <span className="mt-1 block text-base text-pencil/50">{t('passwordHint')}</span>}
          </label>
        </Card>

        {error && (
          <p role="alert" className="animate-pop rounded-wobblySm border-2 border-marker bg-white px-4 py-2 text-center text-lg text-marker">
            {error}
          </p>
        )}

        <div className="relative">
          <Arrow className="absolute -top-12 start-2 hidden h-12 w-16 text-pencil/60 md:block" />
          <Button
            type="submit"
            variant="accent"
            size="lg"
            block
            disabled={busy}
            icon={busy ? <Spinner className="border-white border-t-transparent" /> : <ArrowRight strokeWidth={3} className="rtl:rotate-180" />}
          >
            {signup ? t('createAccount') : t('loginCta')}
          </Button>
        </div>
      </form>

      <p className="text-center text-xl">
        {signup ? t('haveAccount') : t('noAccount')}{' '}
        <RouterLink to={signup ? '/login' : '/signup'} className="font-heading font-bold text-pen underline decoration-wavy underline-offset-4">
          {signup ? t('loginCta') : t('createAccount')}
        </RouterLink>
      </p>
    </div>
  )
}

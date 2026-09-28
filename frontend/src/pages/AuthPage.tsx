import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react'
import { ApiError, auth, legacyDeviceId, type ProfileInput } from '../lib/api'
import { useApp } from '../lib/app'
import { emptyProfile, guessCountry, profileError } from '../lib/profile'
import type { Strings } from '../i18n/strings'
import { LanguagePicker } from '../components/LanguagePicker'
import { PayoutsCard } from '../components/PayoutsCard'
import { ProfileFields } from '../components/ProfileFields'
import { Arrow, Button, Card, cx, Input, Label, Spinner } from '../components/ui'

/** Server error codes → friendly messages. */
const SERVER_ERRORS: Record<string, keyof Strings> = {
  invalid_owner_name: 'errOwnerName',
  invalid_phone: 'invalidPhone',
  invalid_country: 'errCountry',
  invalid_business_name: 'onboardBusiness',
  invalid_business_type: 'errBusinessType',
  invalid_document: 'errDocument',
  terms_required: 'errTerms',
  'invalid email': 'invalidEmail',
  'password too short': 'passwordHint',
}

function Shell({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md animate-pageIn flex-col justify-center gap-8 px-6 py-10">
      <div className="relative">
        <RouterLink to="/welcome" className="font-heading text-3xl font-bold">
          Easy<span className="inline-block -rotate-6 text-marker">Pay</span>
        </RouterLink>
        <h1 className="mt-4 font-heading text-5xl font-bold leading-tight">
          {title}
          <span className="ms-1 inline-block rotate-12 text-marker">!</span>
        </h1>
        <p className="mt-1 text-xl text-pencil/60">{sub}</p>
        <span aria-hidden className="absolute -end-2 -top-2 hidden h-16 w-16 animate-bob rounded-blob border-2 border-dashed border-marker md:block" />
      </div>
      {children}
    </div>
  )
}

function ErrorNote({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="animate-pop rounded-wobblySm border-2 border-marker bg-white px-4 py-2 text-center text-lg text-marker">
      {text}
    </p>
  ) : null
}

function PasswordInput({ value, onChange, autoComplete }: { value: string; onChange: (v: string) => void; autoComplete: string }) {
  const { t } = useApp()
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} maxLength={200} className="pe-24" />
      <button type="button" onClick={() => setShow((v) => !v)} className="absolute end-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-lg text-pen">
        {show ? <EyeOff className="h-5 w-5" strokeWidth={2.5} /> : <Eye className="h-5 w-5" strokeWidth={2.5} />}
        {show ? t('hidePassword') : t('showPassword')}
      </button>
    </div>
  )
}

export default function AuthPage({ mode }: { mode: 'signup' | 'login' }) {
  return mode === 'signup' ? <Signup /> : <Login />
}

/* ---------------- log in ---------------- */

function Login() {
  const { t, signedIn } = useApp()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('invalidEmail'))
    setBusy(true)
    try {
      signedIn(await auth.login(email.trim(), password))
      navigate('/', { replace: true })
    } catch (err) {
      const st = err instanceof ApiError ? err.status : 0
      setError(st === 401 ? t('wrongLogin') : st === 429 ? t('tooMany') : st === 403 ? t('suspended') : t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title={t('loginTitle')} sub={t('loginSub')}>
      <form onSubmit={submit} className="space-y-6" noValidate>
        <Card decoration="tack" tilt={-1} className="space-y-5 !p-6">
          <label className="block">
            <Label>{t('emailLabel')}</Label>
            <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} autoFocus />
          </label>
          <label className="block">
            <Label>{t('passwordLabel')}</Label>
            <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
          </label>
          <RouterLink to="/forgot" className="block text-lg text-pen underline decoration-wavy underline-offset-4">
            {t('forgotLink')}
          </RouterLink>
        </Card>
        <ErrorNote text={error} />
        <Button type="submit" variant="accent" size="lg" block disabled={busy} icon={busy ? <Spinner className="border-white border-t-transparent" /> : <ArrowRight strokeWidth={3} className="rtl:rotate-180" />}>
          {t('loginCta')}
        </Button>
      </form>
      <p className="text-center text-xl">
        {t('noAccount')}{' '}
        <RouterLink to="/signup" className="font-heading font-bold text-pen underline decoration-wavy underline-offset-4">
          {t('createAccount')}
        </RouterLink>
      </p>
    </Shell>
  )
}

/* ---------------- sign up: 3 short steps, then connect payouts ---------------- */

function Signup() {
  const { t, settings, update, signedIn } = useApp()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [profile, setProfile] = useState<ProfileInput>(() => emptyProfile(guessCountry(settings.lang), settings.business))
  const [terms, setTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const next = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (step === 1) {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('invalidEmail'))
      if (password.length < 8) return setError(t('passwordHint'))
      const pe = profileError(profile, 'person')
      if (pe) return setError(t(pe as keyof Strings))
      return setStep(2)
    }
    if (step === 2) {
      const be = profileError(profile, 'business')
      if (be) return setError(t(be as keyof Strings))
      return setStep(3)
    }
    if (step === 3) return create()
  }

  const create = async () => {
    if (!terms) return setError(t('errTerms'))
    setBusy(true)
    try {
      const account = await auth.register({
        ...profile,
        email: email.trim(),
        password,
        lang: settings.lang,
        accept_terms: true,
        claim_id: legacyDeviceId(),
      })
      signedIn(account)
      setStep(4)
    } catch (err) {
      const st = err instanceof ApiError ? err.status : 0
      const code = err instanceof ApiError ? err.message : ''
      if (st === 409) {
        setStep(1)
        setError(t('emailTaken'))
      } else if (st === 429) setError(t('tooMany'))
      else setError(SERVER_ERRORS[code] ? t(SERVER_ERRORS[code]) : t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<number, [keyof Strings, keyof Strings]> = {
    1: ['signupTitle', 'signupSub'],
    2: ['stepBusiness', 'docWhy'],
    3: ['stepFinish', 'signupSub'],
    4: ['stepFinish', 'finishSub'],
  }
  const [title, sub] = titles[step]

  if (step === 4)
    return (
      <Shell title={t(title)} sub={t(sub)}>
        <PayoutsCard onLater={() => navigate('/', { replace: true })} />
        <Button variant="secondary" block onClick={() => navigate('/', { replace: true })}>
          {t('start')} →
        </Button>
      </Shell>
    )

  return (
    <Shell title={t(title)} sub={t(sub)}>
      {/* Progress: three dots, the current one is a sticky note */}
      <div className="flex items-center gap-3" aria-label={t('stepOf', { n: String(step) })}>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cx(
              'flex h-10 w-10 items-center justify-center rounded-blob border-2 border-pencil font-heading text-lg font-bold transition-all',
              n === step ? 'scale-110 bg-postit shadow-hardSm' : n < step ? 'bg-leaf text-white' : 'bg-white text-pencil/40',
            )}
          >
            {n < step ? '✓' : n}
          </span>
        ))}
        <span className="text-lg text-pencil/60">{[t('stepAboutYou'), t('stepBusiness'), t('stepFinish')][step - 1]}</span>
      </div>

      <form onSubmit={next} className="space-y-6" noValidate>
        <Card decoration="tack" tilt={-1} className="space-y-5 !p-6">
          {step === 1 && (
            <>
              <div>
                <Label>🌍</Label>
                <LanguagePicker compact value={settings.lang} onChange={(lang) => update({ lang })} />
              </div>
              <label className="block">
                <Label>{t('emailLabel')}</Label>
                <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
              </label>
              <label className="block">
                <Label>{t('passwordLabel')}</Label>
                <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
                <span className="mt-1 block text-base text-pencil/50">{t('passwordHint')}</span>
              </label>
              <ProfileFields part="person" value={profile} onChange={setProfile} />
            </>
          )}
          {step === 2 && <ProfileFields part="business" value={profile} onChange={setProfile} />}
          {step === 3 && (
            <label className="flex cursor-pointer items-start gap-3 text-xl">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1 h-7 w-7 shrink-0 accent-[#ff4d4d]" />
              <span>
                {t('agreeTo')}{' '}
                <RouterLink to="/terms" target="_blank" className="text-pen underline">
                  {t('termsLink')}
                </RouterLink>{' '}
                {t('andWord')}{' '}
                <RouterLink to="/privacy" target="_blank" className="text-pen underline">
                  {t('privacyLink')}
                </RouterLink>
                .
              </span>
            </label>
          )}
        </Card>

        <ErrorNote text={error} />

        <div className="relative flex gap-3">
          {step === 3 && <Arrow className="absolute -top-12 end-2 hidden h-12 w-16 -scale-x-100 text-pencil/60 md:block" />}
          {step > 1 && (
            <Button type="button" variant="ghost" onClick={() => (setError(''), setStep(step - 1))} icon={<ArrowLeft strokeWidth={2.5} className="rtl:rotate-180" />}>
              {t('prevStep')}
            </Button>
          )}
          <Button
            type="submit"
            variant="accent"
            size="lg"
            block
            disabled={busy}
            icon={busy ? <Spinner className="border-white border-t-transparent" /> : <ArrowRight strokeWidth={3} className="rtl:rotate-180" />}
          >
            {step === 3 ? t('createAccount') : t('nextStep')}
          </Button>
        </div>
      </form>

      <p className="text-center text-xl">
        {t('haveAccount')}{' '}
        <RouterLink to="/login" className="font-heading font-bold text-pen underline decoration-wavy underline-offset-4">
          {t('loginCta')}
        </RouterLink>
      </p>
    </Shell>
  )
}

/* ---------------- forgot / reset / verify ---------------- */

export function ForgotPage() {
  const { t } = useApp()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <Shell title={t('forgotTitle')} sub={t('forgotSub')}>
      {sent ? (
        <Card tone="postit" className="text-xl">
          📬 {t('checkInbox')}
        </Card>
      ) : (
        <form
          className="space-y-6"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            await auth.forgot(email.trim()).catch(() => {})
            setBusy(false)
            setSent(true)
          }}
        >
          <Card className="!p-6">
            <label className="block">
              <Label>{t('emailLabel')}</Label>
              <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
          </Card>
          <Button type="submit" variant="accent" size="lg" block disabled={busy || !email.includes('@')} icon={busy ? <Spinner className="border-white border-t-transparent" /> : undefined}>
            {t('sendLinkBtn')}
          </Button>
        </form>
      )}
      <RouterLink to="/login" className="text-center text-xl text-pen underline decoration-wavy underline-offset-4">
        {t('loginCta')}
      </RouterLink>
    </Shell>
  )
}

export function ResetPage() {
  const { t } = useApp()
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [password, setPassword] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  return (
    <Shell title={t('resetTitle')} sub={t('passwordHint')}>
      {state === 'done' ? (
        <>
          <Card tone="postit" className="text-xl">
            ✓ {t('resetDone')}
          </Card>
          <RouterLink to="/login">
            <Button variant="accent" size="lg" block>
              {t('loginCta')}
            </Button>
          </RouterLink>
        </>
      ) : (
        <form
          className="space-y-6"
          onSubmit={async (e) => {
            e.preventDefault()
            if (password.length < 8) return
            setState('busy')
            try {
              await auth.reset(token, password)
              setState('done')
            } catch {
              setState('error')
            }
          }}
        >
          <Card className="!p-6">
            <label className="block">
              <Label>{t('newPassword')}</Label>
              <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
            </label>
          </Card>
          <ErrorNote text={state === 'error' ? t('verifyFailed') : ''} />
          <Button type="submit" variant="accent" size="lg" block disabled={state === 'busy' || password.length < 8}>
            {t('save')}
          </Button>
        </form>
      )}
    </Shell>
  )
}

export function VerifyPage() {
  const { t, me, signedIn } = useApp()
  const navigate = useNavigate()
  const [state, setState] = useState<'busy' | 'ok' | 'error'>('busy')
  const once = useRef(false) // tokens work once; StrictMode runs effects twice in dev
  useEffect(() => {
    if (once.current) return
    once.current = true
    const token = new URLSearchParams(window.location.search).get('token') ?? ''
    auth
      .verify(token)
      .then(() => {
        setState('ok')
        auth.me().then(signedIn).catch(() => {})
      })
      .catch(() => setState('error'))
  }, [signedIn])
  return (
    <Shell title={state === 'ok' ? t('emailVerified') : t('emailLabel')} sub="">
      {state === 'busy' ? <Spinner className="h-8 w-8" /> : state === 'error' ? <ErrorNote text={t('verifyFailed')} /> : null}
      <Button variant="accent" size="lg" block onClick={() => navigate(me ? '/' : '/login')}>
        {me ? t('start') : t('loginCta')} →
      </Button>
    </Shell>
  )
}

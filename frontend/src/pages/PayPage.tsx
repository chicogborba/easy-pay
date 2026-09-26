import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CreditCard, Lock, Store } from 'lucide-react'
import { api, ApiError, type Link, type PayMethod } from '../lib/api'
import { useApp, type T } from '../lib/app'
import { Receipt } from '../components/Receipt'
import { LanguagePicker } from '../components/LanguagePicker'
import { Button, Card, cx, IconBlob, Input, Spinner, Squiggle } from '../components/ui'

export function methodLabel(m: PayMethod | null, t: T) {
  return m === 'apple_pay' ? 'Apple Pay' : m === 'google_pay' ? 'Google Pay' : t('card')
}

/** Public page the customer opens. Payment is MOCKED — see README to plug in Stripe. */
export default function PayPage() {
  const { id = '' } = useParams()
  const { t, fmt, settings, update } = useApp()
  const [link, setLink] = useState<Link | null | undefined>()
  const [paying, setPaying] = useState<PayMethod | null>(null)
  const [showCard, setShowCard] = useState(false)
  const [justPaid, setJustPaid] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.link(id).then(setLink).catch(() => setLink(null))
  }, [id])

  const pay = async (method: PayMethod) => {
    setPaying(method)
    setError('')
    try {
      setLink(await api.pay(id, method))
      setJustPaid(true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) api.link(id).then(setLink)
      else setError(t('errorGeneric'))
    } finally {
      setPaying(null)
    }
  }

  return (
    <div className="mx-auto min-h-[100dvh] max-w-md px-5 pb-10 pt-[max(env(safe-area-inset-top),20px)]">
      {link === undefined ? (
        <div className="flex justify-center py-24">
          <Spinner className="h-8 w-8" />
        </div>
      ) : link === null ? (
        <Card tilt={-1} className="mt-16 text-center">
          <p className="text-5xl">🤔</p>
          <p className="mt-3 text-2xl">{t('linkNotFound')}</p>
        </Card>
      ) : (
        <>
          <header className="mb-8 flex items-center gap-3">
            <IconBlob tone="postit" className="-rotate-6">
              <Store strokeWidth={2.5} />
            </IconBlob>
            <div className="min-w-0">
              <p className="text-lg leading-none text-pencil/60">{t('paymentRequest')}</p>
              <h1 className="truncate font-heading text-3xl font-bold leading-tight">{link.business_name || 'Easy Pay'}</h1>
            </div>
          </header>

          <Card decoration="tape" tilt={-0.8} className="!px-6 !pb-6 !pt-8">
            <h2 className="mb-1 font-heading text-2xl font-bold">{t('yourOrder')}</h2>
            <Squiggle className="mb-4 w-24 text-marker" />
            <Receipt items={link.items} currency={link.currency} note={link.note} big />

            {link.status === 'paid' && (
              <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="animate-stamp rounded-wobbly border-[5px] border-leaf px-6 py-1 font-heading text-6xl font-bold uppercase tracking-wider text-leaf opacity-90 mix-blend-multiply">
                  {t('paidStamp')}
                </span>
              </div>
            )}
          </Card>

          <section className="mt-10">
            {link.status === 'paid' ? (
              <div className="text-center">
                <p className="font-heading text-4xl font-bold">{justPaid ? `🎉 ${t('thankYou')}` : '✓'}</p>
                <p className="mt-2 text-2xl text-pencil/70">{justPaid ? t('paymentDone') : t('alreadyPaid')}</p>
              </div>
            ) : link.status === 'cancelled' ? (
              <p className="text-center text-2xl text-pencil/70">{t('linkInactive')}</p>
            ) : (
              <div className="space-y-4">
                <p className="text-center font-heading text-2xl font-bold">{t('payWith')}</p>

                <WalletButton label="Apple Pay" logo={<AppleLogo />} busy={paying === 'apple_pay'} disabled={!!paying} onClick={() => pay('apple_pay')} />
                <WalletButton label="Google Pay" logo={<GoogleLogo />} busy={paying === 'google_pay'} disabled={!!paying} onClick={() => pay('google_pay')} />

                {!showCard ? (
                  <Button block size="lg" icon={<CreditCard strokeWidth={2.5} />} disabled={!!paying} onClick={() => setShowCard(true)}>
                    {t('card')}
                  </Button>
                ) : (
                  <CardForm
                    t={t}
                    amount={fmt(link.total_cents, link.currency)}
                    busy={paying === 'card'}
                    disabled={!!paying}
                    onPay={() => pay('card')}
                  />
                )}

                {error && <p className="text-center text-lg text-marker">{error}</p>}
                <p className="flex items-center justify-center gap-1 pt-2 text-base text-pencil/60">
                  <Lock className="h-4 w-4" strokeWidth={2.5} /> {t('securePay')}
                </p>
              </div>
            )}
          </section>

          <footer className="mt-12 space-y-4 border-t-2 border-dashed border-pencil/30 pt-6">
            <LanguagePicker compact value={settings.lang} onChange={(lang) => update({ lang })} />
            <p className="text-center text-base text-pencil/50">{t('demoNote')}</p>
          </footer>
        </>
      )}
    </div>
  )
}

function WalletButton({ label, logo, busy, ...rest }: { label: string; logo: React.ReactNode; busy: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      aria-label={label}
      className={cx(
        'flex min-h-[60px] w-full items-center justify-center gap-2 rounded-wobbly border-[3px] border-pencil bg-pencil text-2xl text-white shadow-hard',
        'transition-all duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-hardSm active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:opacity-60',
      )}
    >
      {busy ? <Spinner className="border-white border-t-transparent" /> : logo}
      <span className="font-sans font-semibold tracking-tight">{label.split(' ')[1]}</span>
    </button>
  )
}

function CardForm({ t, amount, busy, disabled, onPay }: { t: T; amount: string; busy: boolean; disabled: boolean; onPay: () => void }) {
  const [num, setNum] = useState('')
  const [exp, setExp] = useState('')
  const [cvc, setCvc] = useState('')
  const [name, setName] = useState('')
  const valid = num.replace(/\D/g, '').length >= 15 && /^\d{2}\/\d{2}$/.test(exp) && cvc.length >= 3 && name.trim().length > 1

  return (
    <Card tone="paper" className="animate-pop space-y-3">
      <Input
        inputMode="numeric"
        autoComplete="cc-number"
        placeholder={t('cardNumber')}
        value={num}
        onChange={(e) =>
          setNum(
            e.target.value
              .replace(/\D/g, '')
              .slice(0, 16)
              .replace(/(\d{4})(?=\d)/g, '$1 '),
          )
        }
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          inputMode="numeric"
          autoComplete="cc-exp"
          placeholder={t('expiry')}
          value={exp}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '').slice(0, 4)
            setExp(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d)
          }}
        />
        <Input
          inputMode="numeric"
          autoComplete="cc-csc"
          placeholder={t('cvc')}
          value={cvc}
          onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />
      </div>
      <Input autoComplete="cc-name" placeholder={t('nameOnCard')} value={name} onChange={(e) => setName(e.target.value)} />
      <Button
        variant="accent"
        size="lg"
        block
        disabled={!valid || disabled}
        onClick={onPay}
        icon={busy ? <Spinner className="border-white border-t-transparent" /> : <Lock strokeWidth={2.5} />}
      >
        {busy ? t('processing') : t('pay', { amount })}
      </Button>
    </Card>
  )
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 fill-white" aria-hidden>
      <path d="M16.37 12.62c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.59 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.5zM14.2 6.16c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.3-.56.64-1.05 1.67-.92 2.66.97.08 1.96-.49 2.56-1.2z" />
    </svg>
  )
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      <path fill="#4285F4" d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h5.9a5.05 5.05 0 0 1-2.2 3.3v2.75h3.55c2.08-1.92 3.25-4.74 3.25-8.08z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.55-2.75c-.98.66-2.24 1.06-3.73 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.12a6.6 6.6 0 0 1 0-4.24V7.04H2.18a11 11 0 0 0 0 9.92l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.5 10.5 0 0 0 12 1 11 11 0 0 0 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}

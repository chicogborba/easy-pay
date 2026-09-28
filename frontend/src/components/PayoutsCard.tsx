import { useState } from 'react'
import { Wallet } from 'lucide-react'
import { auth } from '../lib/api'
import { useApp } from '../lib/app'
import { providerFor, providerLabel } from '../lib/profile'
import { Button, Card, Spinner } from './ui'

/**
 * Where the seller's money goes. Brazil → Mercado Pago (Pix, card, boleto), elsewhere → Stripe.
 * When the platform hasn't turned that provider on yet, payments run in demo mode.
 */
export function PayoutsCard({ onLater }: { onLater?: () => void }) {
  const { t, me, server, toast, signedIn } = useApp()
  const [busy, setBusy] = useState(false)
  if (!me) return null
  const provider = me.payout_provider || providerFor(me.country)
  const live = !!server.providers?.[provider]
  const name = providerLabel(provider)
  const countryFee = me.country === 'BR' ? server.fees?.br : server.fees?.intl
  const fee = ((me.fee_bps_override ?? countryFee ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '%'

  const connect = async () => {
    setBusy(true)
    try {
      const { url } = await auth.connectPayouts()
      window.location.href = url
    } catch {
      toast(t('payoutsError'))
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!confirm(t('disconnectConfirm'))) return
    try {
      signedIn(await auth.disconnectPayouts())
    } catch {
      toast(t('errorGeneric'))
    }
  }

  return (
    <Card tone="postit" tilt={-0.5} className="space-y-3">
      <h3 className="flex items-center gap-2 font-heading text-2xl font-bold">
        <Wallet strokeWidth={2.5} className="text-pen" /> {t('receivePayments')}
      </h3>
      {!live ? (
        <p className="text-lg text-pencil/70">{t('demoMode')}</p>
      ) : me.payout_connected ? (
        <>
          <p className="text-xl font-bold text-leaf">{t('payoutsConnected', { provider: name })}</p>
          <button onClick={disconnect} className="text-lg text-pencil/60 underline decoration-wavy underline-offset-4">
            {t('disconnectBtn')}
          </button>
        </>
      ) : (
        <>
          <p className="text-lg text-pencil/80">{provider === 'mercadopago' ? t('payoutsWhyMp') : t('payoutsWhyStripe')}</p>
          <Button
            variant="accent"
            size="lg"
            block
            disabled={busy}
            onClick={connect}
            className={provider === 'mercadopago' ? '!bg-[#00b1ea]' : '!bg-[#635bff]'}
            icon={busy ? <Spinner className="border-white border-t-transparent" /> : undefined}
          >
            {provider === 'mercadopago' ? t('connectMp') : t('connectStripe')}
          </Button>
          {onLater && (
            <Button variant="ghost" block onClick={onLater}>
              {t('laterBtn')}
            </Button>
          )}
        </>
      )}
      {(countryFee ?? 0) > 0 || me.fee_bps_override ? <p className="text-base text-pencil/60">{t('feeInfo', { fee })}</p> : null}
    </Card>
  )
}

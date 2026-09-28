/**
 * Payment providers' public prices for online payments, used by the /pricing page.
 * Checked September 2026 — update when Mercado Pago or Stripe change their prices:
 *  - Mercado Pago (Brazil): https://www.mercadopago.com.br/ajuda/custo-receber-pagamentos_220
 *  - Stripe (US): https://stripe.com/pricing
 * The Easy Pay fee itself comes from the server (/api/config → fees), so it is always what we charge.
 */

export type Method = {
  key: 'pix' | 'card30' | 'cardNow' | 'boleto' | 'cardUs' | 'cardIntl'
  icon: string
  /** Provider fee: percentage (0.0099 = 0.99%) plus a fixed amount in cents. */
  pct: number
  fixedCents: number
  /** When the money is available: key into the pricing strings. */
  payout: 'now' | 'd30' | 'd14' | 'd3' | 'd2'
}

export const PRICING_CHECKED = '2026-09'

export const METHODS_BR: Method[] = [
  { key: 'pix', icon: '⚡', pct: 0.0099, fixedCents: 0, payout: 'now' },
  { key: 'card30', icon: '💳', pct: 0.0399, fixedCents: 0, payout: 'd30' },
  { key: 'cardNow', icon: '💳', pct: 0.0499, fixedCents: 0, payout: 'now' },
  { key: 'boleto', icon: '🧾', pct: 0, fixedCents: 349, payout: 'd3' },
]

export const METHODS_US: Method[] = [
  { key: 'cardUs', icon: '💳', pct: 0.029, fixedCents: 30, payout: 'd2' },
  { key: 'cardIntl', icon: '🌎', pct: 0.044, fixedCents: 30, payout: 'd2' },
]

export const SOURCES = {
  br: { name: 'Mercado Pago', url: 'https://www.mercadopago.com.br/ajuda/custo-receber-pagamentos_220' },
  us: { name: 'Stripe', url: 'https://stripe.com/pricing' },
}

/** Fallback if /api/config hasn't answered yet (keep in sync with backend defaults). */
export const DEFAULT_FEES = { br: 150, intl: 100 }

export function breakdown(saleCents: number, m: Method, platformBps: number) {
  const provider = Math.round(saleCents * m.pct) + m.fixedCents
  const platform = Math.round((saleCents * platformBps) / 10_000)
  return { provider, platform, total: provider + platform, youGet: saleCents - provider - platform }
}

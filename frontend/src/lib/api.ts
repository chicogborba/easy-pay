export type Item = { name: string; quantity: number; total_cents: number; product?: string; product_id?: number }
export type Draft = { items: Item[]; currency: string; note: string; customer: string; customer_id?: number }
export type LinkStatus = 'waiting' | 'paid' | 'cancelled'
export type PayMethod = 'apple_pay' | 'google_pay' | 'card'
export type Link = {
  id: string
  business_name: string
  customer: string
  items: Item[]
  currency: string
  total_cents: number
  note: string
  status: LinkStatus
  created_at: number
  paid_at: number | null
  paid_method: PayMethod | null
  customer_id: number | null
  payer_name: string
  payer_phone: string
  payer_email: string
  provider?: string | null
  platform_fee_cents?: number
  /** On waiting links: how the customer can pay right now. */
  payment_mode?: PaymentMode
  /** Only on waiting links made for a known customer. */
  known_customer?: { name: string; phone_last4: string }
}
export type Payer = { name: string; phone: string; email: string }
export type CustomerSummary = {
  id: number
  name: string
  phone: string
  email: string
  note: string
  orders: number
  spent_cents: number
  first_purchase_at: number | null
  last_purchase_at: number | null
}
export type CustomerDetail = CustomerSummary & { favorites: TopItem[]; links: Link[] }
export type ChatMsg = { role: 'user' | 'assistant'; content: string }
export type ChatReply = { reply: string; draft: Draft | null; choices: string[] }
export type TopItem = { product_id: number | null; name: string; quantity: number; total_cents: number }
export type Stats = {
  currency: string
  paid_total_cents: number
  paid_count: number
  waiting_total_cents: number
  waiting_count: number
  today_cents: number
  week_cents: number
  prev_week_cents: number
  month_cents: number
  last_7_days: { day: string; total_cents: number; top: TopItem[] }[]
  top_items: TopItem[]
  weekdays: number[]
}
export type ProductSummary = {
  id: number
  name: string
  quantity: number
  revenue_cents: number
  orders: number
  last_sold_at: number | null
}
export type ProductDetail = Omit<ProductSummary, 'id'> & {
  id: number
  aliases: string[]
  avg_unit_cents: number
  last_14_days: { day: string; quantity: number; total_cents: number }[]
  weekdays: number[]
}
export type PaymentMode = 'mock' | 'stripe' | 'mercadopago'
export type ServerConfig = { ai: boolean; voice: boolean; providers?: { stripe: boolean; mercadopago: boolean }; fees?: Fees }
/** Platform fee per paid sale in basis points (150 = 1.5%): Brazil and everyone else. */
export type Fees = { br: number; intl: number }
export type Account = {
  id: string
  email: string
  business_name: string
  lang: string
  currency: string
  status: string
  plan: string
  created_at: number
  stripe_account_id: string | null
  stripe_charges_enabled: boolean
  is_admin: boolean
  owner_name: string
  phone: string
  country: string
  business_type: string
  document: string
  category: string
  city: string
  state: string
  email_verified: boolean
  fee_bps_override: number | null
  payout_provider: 'stripe' | 'mercadopago'
  payout_connected: boolean
}
export type ProfileInput = {
  owner_name: string
  phone: string
  country: string
  business_name: string
  business_type: string
  document: string
  category: string
  city: string
  state: string
}
export type CurrencyTotal = { currency: string; cents: number; count: number }
export type DayCount = { day: number; count: number }
export type KindCount = { kind: string; count: number }
export type AdminOverview = {
  accounts_total: number
  accounts_active_7d: number
  accounts_active_30d: number
  accounts_new_30d: number
  accounts_stripe_ready: number
  links_total: number
  links_30d: number
  customers_total: number
  gmv_all: CurrencyTotal[]
  gmv_30d: CurrencyTotal[]
  revenue_all: CurrencyTotal[]
  revenue_30d: CurrencyTotal[]
  accounts_payouts_connected: number
  accounts_verified: number
  by_country: { country: string; accounts: number; connected: number }[]
  fees: Fees
  providers: { stripe: boolean; mercadopago: boolean }
  usage_30d: KindCount[]
  signups_by_day: DayCount[]
  links_by_day: DayCount[]
  ai_enabled: boolean
}
export type AdminAccountRow = {
  id: string
  email: string
  business_name: string
  owner_name: string
  country: string
  fee_bps_override: number | null
  payouts_connected: boolean
  revenue_cents: number
  currency: string
  status: string
  plan: string
  created_at: number
  last_seen_at: number | null
  stripe_charges_enabled: boolean
  links: number
  paid_links: number
  gmv_cents: number
  customers: number
  ai_calls_30d: number
}
export type AdminAccountDetail = {
  account: Account
  last_seen_at: number | null
  gmv_all: CurrencyTotal[]
  gmv_30d: CurrencyTotal[]
  revenue_all: CurrencyTotal[]
  revenue_30d: CurrencyTotal[]
  fees: Fees
  usage_30d: KindCount[]
  usage_by_day: DayCount[]
  links_by_day: DayCount[]
  customers: number
  recent_links: Link[]
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Random id this device used before accounts existed. Sent once at sign-up so the
 * links created in demo mode move into the new account. Never used for auth.
 */
export function legacyDeviceId(): string {
  return localStorage.getItem('ep.merchant') ?? ''
}

/** Any 401 means the session ended: the app listens for this and shows the login. */
export const UNAUTHORIZED_EVENT = 'ep:unauthorized'

// Auth is an HttpOnly session cookie, sent automatically on same-origin requests.
// (The third parameter is kept for readability at call sites: true = seller-only route.)
async function req<T>(path: string, init: RequestInit = {}, _seller = false): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers as object) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, body.error ?? res.statusText)
  }
  return res.json()
}

const tzOffset = () => -new Date().getTimezoneOffset()

/** Query string with the merchant's timezone; undefined values are skipped. */
function q(params: Record<string, string | number | undefined>) {
  const p = new URLSearchParams({ tz_offset: String(tzOffset()) })
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v))
  return p.toString()
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

/**
 * Chat with the reply streamed token by token (newline-delimited JSON).
 * `onDelta` gets each new piece of the reply text; resolves with the full answer.
 * Falls back to the plain endpoint when streaming isn't available.
 */
async function chatStream(messages: ChatMsg[], lang: string, currency: string, onDelta: (text: string) => void): Promise<ChatReply> {
  const res = await fetch('/api/chat/stream', {
    ...post({ messages, lang, currency }),
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''))
  if (!res.body) return api.chat(messages, lang, currency)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let done: ChatReply | null = null
  for (;;) {
    const { value, done: end } = await reader.read()
    if (value) buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const msg = JSON.parse(line) as { delta?: string; done?: ChatReply }
      if (msg.delta) onDelta(msg.delta)
      if (msg.done) done = msg.done
    }
    if (end) break
  }
  if (!done) throw new Error('stream ended early')
  return done
}

export const auth = {
  me: () => req<Account>('/auth/me'),
  register: (body: ProfileInput & { email: string; password: string; lang: string; claim_id: string; accept_terms: boolean }) =>
    req<Account>('/auth/register', post(body)),
  updateProfile: (p: ProfileInput) => req<Account>('/account/profile', post(p)),
  verify: (token: string) => req('/auth/verify', post({ token })),
  resendVerification: () => req('/account/verify/resend', post({})),
  forgot: (email: string) => req('/auth/forgot', post({ email })),
  reset: (token: string, password: string) => req('/auth/reset', post({ token, password })),
  connectPayouts: () => req<{ url: string }>('/account/payouts/connect', post({})),
  disconnectPayouts: () => req<Account>('/account/payouts/disconnect', post({})),
  login: (email: string, password: string) => req<Account>('/auth/login', post({ email, password })),
  logout: () => req('/auth/logout', post({})),
  update: (patch: { business_name?: string; lang?: string; currency?: string }) => req<Account>('/account', post(patch)),
  changePassword: (current: string, next: string) => req('/account/password', post({ current, new: next })),
}

export const admin = {
  overview: () => req<AdminOverview>('/admin/overview'),
  accounts: (opts: { q?: string; sort?: string; limit?: number; offset?: number }) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== '') p.set(k, String(v))
    return req<{ total: number; accounts: AdminAccountRow[] }>(`/admin/accounts?${p}`)
  },
  account: (id: string) => req<AdminAccountDetail>(`/admin/accounts/${encodeURIComponent(id)}`),
  setStatus: (id: string, status: 'active' | 'suspended') => req(`/admin/accounts/${encodeURIComponent(id)}/status`, post({ status })),
  setFee: (id: string, fee_bps: number | null) => req(`/admin/accounts/${encodeURIComponent(id)}/fee`, post({ fee_bps })),
}

export const api = {
  config: () => req<ServerConfig>('/config'),
  chat: (messages: ChatMsg[], lang: string, currency: string) => req<ChatReply>('/chat', post({ messages, lang, currency }), true),
  chatStream,
  transcribe: (audio_base64: string, lang: string) => req<{ text: string }>('/transcribe', post({ audio_base64, lang })),
  createLink: (draft: Draft, business_name: string) => req<Link>('/links', post({ draft, business_name }), true),
  links: (opts: { status?: string; before?: number; limit?: number } = {}) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(opts)) if (v !== undefined) p.set(k, String(v))
    return req<Link[]>(`/links?${p}`, {}, true)
  },
  linkUpdates: (since: number) => req<{ now: number; paid: Link[] }>(`/links/updates?since=${since}`, {}, true),
  checkout: (id: string, payer: Payer) => req<{ url: string }>(`/links/${encodeURIComponent(id)}/checkout`, post(payer)),
  // Sends the merchant id so the owner also sees who paid.
  link: (id: string) => req<Link>(`/links/${encodeURIComponent(id)}`, {}, true),
  cancel: (id: string) => req<Link>(`/links/${encodeURIComponent(id)}/cancel`, post({}), true),
  pay: (id: string, method: PayMethod, payer: Payer) => req<Link>(`/links/${encodeURIComponent(id)}/pay`, post({ method, ...payer })),
  customers: (currency: string) => req<CustomerSummary[]>(`/customers?${q({ currency })}`, {}, true),
  customer: (id: number, currency: string) => req<CustomerDetail>(`/customers/${id}?${q({ currency })}`, {}, true),
  updateCustomer: (id: number, patch: { name?: string; note?: string }) => req(`/customers/${id}`, post(patch), true),
  stats: (currency: string) => req<Stats>(`/stats?${q({ currency })}`, {}, true),
  products: (currency: string, days?: number) => req<ProductSummary[]>(`/products?${q({ currency, days })}`, {}, true),
  product: (id: number, currency: string) => req<ProductDetail>(`/products/${id}?${q({ currency })}`, {}, true),
  renameProduct: (id: number, name: string) => req(`/products/${id}/rename`, post({ name }), true),
  mergeProduct: (id: number, into_id: number) => req(`/products/${id}/merge`, post({ into_id }), true),
  insights: (lang: string, currency: string) => req<{ tips: string[] }>('/insights', post({ lang, currency, tz_offset: tzOffset() }), true),
}

export const payUrl = (id: string) => `${window.location.origin}/p/${id}`

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
export type ServerConfig = { ai: boolean; voice: boolean }

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** POC identity: a random id per device, sent on merchant-only calls. */
export function merchantId(): string {
  const KEY = 'ep.merchant'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem(KEY, id)
  }
  return id
}

async function req<T>(path: string, init: RequestInit = {}, merchant = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (merchant) headers['X-Merchant-Id'] = merchantId()
  const res = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
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
    headers: { 'Content-Type': 'application/json', 'X-Merchant-Id': merchantId() },
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

export const api = {
  config: () => req<ServerConfig>('/config'),
  chat: (messages: ChatMsg[], lang: string, currency: string) => req<ChatReply>('/chat', post({ messages, lang, currency }), true),
  chatStream,
  transcribe: (audio_base64: string, lang: string) => req<{ text: string }>('/transcribe', post({ audio_base64, lang })),
  createLink: (draft: Draft, business_name: string) => req<Link>('/links', post({ draft, business_name }), true),
  links: () => req<Link[]>('/links', {}, true),
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

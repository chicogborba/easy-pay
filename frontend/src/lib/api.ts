export type Item = { name: string; quantity: number; total_cents: number }
export type Draft = { items: Item[]; currency: string; note: string }
export type LinkStatus = 'waiting' | 'paid' | 'cancelled'
export type PayMethod = 'apple_pay' | 'google_pay' | 'card'
export type Link = {
  id: string
  business_name: string
  items: Item[]
  currency: string
  total_cents: number
  note: string
  status: LinkStatus
  created_at: number
  paid_at: number | null
  paid_method: PayMethod | null
}
export type ChatMsg = { role: 'user' | 'assistant'; content: string }
export type ChatReply = { reply: string; draft: Draft | null }
export type Stats = {
  currency: string
  paid_total_cents: number
  paid_count: number
  waiting_total_cents: number
  waiting_count: number
  today_cents: number
  week_cents: number
  month_cents: number
  last_7_days: { day: string; total_cents: number }[]
  top_items: { name: string; quantity: number; total_cents: number }[]
}
export type ServerConfig = { ai: boolean; voice: boolean }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
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

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const api = {
  config: () => req<ServerConfig>('/config'),
  chat: (messages: ChatMsg[], lang: string, currency: string) =>
    req<ChatReply>('/chat', post({ messages, lang, currency })),
  transcribe: (audio_base64: string, lang: string) =>
    req<{ text: string }>('/transcribe', post({ audio_base64, lang })),
  createLink: (draft: Draft, business_name: string) =>
    req<Link>('/links', post({ draft, business_name }), true),
  links: () => req<Link[]>('/links', {}, true),
  link: (id: string) => req<Link>(`/links/${encodeURIComponent(id)}`),
  cancel: (id: string) => req<Link>(`/links/${encodeURIComponent(id)}/cancel`, post({}), true),
  pay: (id: string, method: PayMethod) => req<Link>(`/links/${encodeURIComponent(id)}/pay`, post({ method })),
  stats: (currency: string) =>
    req<Stats>(`/stats?currency=${currency}&tz_offset=${-new Date().getTimezoneOffset()}`, {}, true),
}

export const payUrl = (id: string) => `${window.location.origin}/p/${id}`

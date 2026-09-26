import type { CustomerSummary } from './api'

export type Tag = 'vip' | 'new' | 'sleeping'

const DAY = 86_400_000

/** Simple, explainable segments: best customers, first-timers, and who hasn't come back. */
export function customerTags(c: CustomerSummary, all: CustomerSummary[]): Tag[] {
  const tags: Tag[] = []
  const topSpenders = [...all]
    .filter((x) => x.spent_cents > 0)
    .sort((a, b) => b.spent_cents - a.spent_cents)
    .slice(0, 3)
    .map((x) => x.id)
  if (c.orders >= 3 || (all.length >= 5 && topSpenders.includes(c.id))) tags.push('vip')
  if (c.orders === 1 && c.first_purchase_at && Date.now() - c.first_purchase_at < 14 * DAY) tags.push('new')
  if (c.last_purchase_at && Date.now() - c.last_purchase_at > 30 * DAY) tags.push('sleeping')
  return tags
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/** Stable pastel per customer so avatars are easy to recognize. */
export function avatarColor(id: number) {
  return ['bg-postit', 'bg-[#ffd6d6]', 'bg-[#d6e4ff]', 'bg-[#d9f2e0]', 'bg-[#f1ddff]', 'bg-muted'][id % 6]
}

export const phoneDigits = (phone: string) => phone.replace(/\D/g, '')

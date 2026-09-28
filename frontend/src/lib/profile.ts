import type { LangCode } from '../i18n/strings'
import type { ProfileInput } from './api'
import { localeOf } from './app'

/** Countries we onboard. Brazil → Mercado Pago, the rest → Stripe. */
export const COUNTRIES = ['BR', 'US', 'CA', 'MX', 'AR', 'CO', 'GB', 'PT', 'ES', 'FR', 'DE', 'IT', 'IE', 'NL', 'IN', 'AU'] as const

export const flag = (cc: string) =>
  cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🌍'

export function countryName(cc: string, lang: LangCode) {
  try {
    return new Intl.DisplayNames([localeOf(lang)], { type: 'region' }).of(cc) ?? cc
  } catch {
    return cc
  }
}

export function guessCountry(lang: LangCode): string {
  const region = (navigator.language.split('-')[1] ?? '').toUpperCase()
  if ((COUNTRIES as readonly string[]).includes(region)) return region
  return { pt: 'BR', es: 'MX', fr: 'FR', hi: 'IN', zh: 'US', ar: 'US', en: 'US' }[lang] ?? 'US'
}

export const providerFor = (country: string): 'mercadopago' | 'stripe' => (country === 'BR' ? 'mercadopago' : 'stripe')
export const providerLabel = (p: string) => (p === 'mercadopago' ? 'Mercado Pago' : 'Stripe')

export const CATEGORIES = ['food', 'crafts', 'clothing', 'beauty', 'services', 'other'] as const

export const digits = (s: string) => s.replace(/\D/g, '')

export function validCpf(s: string) {
  const d = digits(s).split('').map(Number)
  if (d.length !== 11 || d.every((x) => x === d[0])) return false
  const check = (n: number) => {
    const sum = d.slice(0, n).reduce((acc, x, i) => acc + x * (n + 1 - i), 0)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return check(9) === d[9] && check(10) === d[10]
}

export function validCnpj(s: string) {
  const d = digits(s).split('').map(Number)
  if (d.length !== 14 || d.every((x) => x === d[0])) return false
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const w2 = [6, ...w1]
  const check = (w: number[]) => {
    const r = w.reduce((acc, x, i) => acc + x * d[i], 0) % 11
    return r < 2 ? 0 : 11 - r
  }
  return check(w1) === d[12] && check(w2) === d[13]
}

/** 000.000.000-00 or 00.000.000/0000-00 while typing. */
export function maskDocument(v: string, kind: 'cpf' | 'cnpj') {
  const d = digits(v).slice(0, kind === 'cpf' ? 11 : 14)
  if (kind === 'cpf') return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

export const docKind = (p: Pick<ProfileInput, 'country' | 'business_type'>) =>
  p.country !== 'BR' ? 'tax' : p.business_type === 'individual' ? 'cpf' : 'cnpj'

/** Same rules as the server; returns the first problem as a strings key. */
export function profileError(p: ProfileInput, part: 'person' | 'business' | 'all' = 'all') {
  if (part !== 'business') {
    if (p.owner_name.trim().length < 2) return 'errOwnerName'
    const ph = digits(p.phone).length
    if (ph < 8 || ph > 15) return 'invalidPhone'
  }
  if (part !== 'person') {
    if (!p.country) return 'errCountry'
    if (!p.business_name.trim()) return 'onboardBusiness'
    if (!['individual', 'mei', 'company'].includes(p.business_type)) return 'errBusinessType'
    const kind = docKind(p)
    if (kind === 'cpf' && !validCpf(p.document)) return 'errDocument'
    if (kind === 'cnpj' && !validCnpj(p.document)) return 'errDocument'
  }
  return null
}

export const emptyProfile = (country: string, business = ''): ProfileInput => ({
  owner_name: '',
  phone: '',
  country,
  business_name: business,
  business_type: 'individual',
  document: '',
  category: '',
  city: '',
  state: '',
})

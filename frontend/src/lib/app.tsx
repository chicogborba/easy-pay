import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LANGS, STRINGS, type LangCode, type Strings } from '../i18n/strings'
import { api, type ServerConfig } from './api'

export const CURRENCIES = ['USD', 'EUR', 'BRL', 'MXN', 'GBP', 'INR', 'CNY', 'ARS', 'COP', 'CAD'] as const

/** `langPicked`: the person chose a language themselves; until then the app is in English. */
export type Settings = { business: string; lang: LangCode; currency: string; onboarded: boolean; langPicked?: boolean }

const KEY = 'ep.settings'

export function detectLang(): LangCode {
  const nav = (navigator.language || 'en').slice(0, 2)
  return (LANGS.find((l) => l.code === nav)?.code ?? 'en') as LangCode
}

function guessCurrency(lang: LangCode): string {
  const region = (navigator.language.split('-')[1] ?? '').toUpperCase()
  const byRegion: Record<string, string> = { BR: 'BRL', MX: 'MXN', GB: 'GBP', IN: 'INR', CN: 'CNY', AR: 'ARS', CO: 'COP', CA: 'CAD' }
  if (byRegion[region]) return byRegion[region]
  return { pt: 'BRL', es: 'EUR', fr: 'EUR', zh: 'CNY', hi: 'INR' }[lang as string] ?? 'USD'
}

function load(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '')
    if (s && STRINGS[s.lang as LangCode]) return s.langPicked ? s : { ...s, lang: 'en' }
  } catch {
    /* first run */
  }
  return { business: '', lang: 'en', currency: guessCurrency(detectLang()), onboarded: false }
}

export type T = (key: keyof Strings, vars?: Record<string, string>) => string

export function makeT(lang: LangCode): T {
  return (key, vars) => {
    let s = STRINGS[lang][key] ?? STRINGS.en[key]
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, v)
    return s
  }
}

export function localeOf(lang: LangCode) {
  return LANGS.find((l) => l.code === lang)!.locale
}

export function money(cents: number, currency: string, lang: LangCode) {
  try {
    return new Intl.NumberFormat(localeOf(lang), { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`
  }
}

/** Sets <html lang/dir> so Arabic flows right-to-left. */
export function applyDocumentLang(lang: LangCode) {
  document.documentElement.lang = lang
  document.documentElement.dir = LANGS.find((l) => l.code === lang && 'rtl' in l) ? 'rtl' : 'ltr'
}

type Ctx = {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  t: T
  fmt: (cents: number, currency?: string) => string
  server: ServerConfig
  toast: (msg: string) => void
  toastMsg: string | null
}

const AppCtx = createContext<Ctx>(null!)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)
  const [server, setServer] = useState<ServerConfig>({ ai: false, voice: false })
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  useEffect(() => {
    api.config().then(setServer).catch(() => {})
  }, [])

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings))
    applyDocumentLang(settings.lang)
  }, [settings])

  const update = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch, ...(patch.lang ? { langPicked: true } : {}) })),
    [],
  )

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 3500)
  }, [])

  const value = useMemo<Ctx>(
    () => ({
      settings,
      update,
      t: makeT(settings.lang),
      fmt: (c, cur) => money(c, cur ?? settings.currency, settings.lang),
      server,
      toast,
      toastMsg,
    }),
    [settings, update, server, toast, toastMsg],
  )
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export const useApp = () => useContext(AppCtx)

export function timeAgo(ms: number, lang: LangCode) {
  const rtf = new Intl.RelativeTimeFormat(localeOf(lang), { numeric: 'auto' })
  const diff = (ms - Date.now()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [u, s] of units) if (Math.abs(diff) >= s) return rtf.format(Math.round(diff / s), u)
  return rtf.format(0, 'minute')
}

/** Weekday name for index 0 = Sunday. */
export function weekdayName(index: number, lang: LangCode, style: 'long' | 'short' = 'long') {
  const sunday = Date.UTC(2024, 0, 7, 12)
  return new Intl.DateTimeFormat(localeOf(lang), { weekday: style, timeZone: 'UTC' }).format(sunday + index * 86_400_000)
}

export const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)

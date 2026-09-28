import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { MessageCirclePlus, PiggyBank, ReceiptText, Settings, Users } from 'lucide-react'
import { api } from '../lib/api'
import { LANGS } from '../i18n/strings'
import { useApp } from '../lib/app'
import { cx } from './ui'
import { Confetti } from './motion'

function tabIndex(path: string) {
  if (path === '/') return 0
  if (path.startsWith('/links')) return 1
  if (path.startsWith('/customers')) return 2
  if (path.startsWith('/money') || path.startsWith('/products')) return 3
  return -1
}

/** Phone-sized app shell: header, content, big bottom tabs, and a "you got paid" toast. */
export function Layout() {
  const { t, settings, toastMsg } = useApp()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  usePaymentWatcher()
  const active = tabIndex(pathname)
  const rtl = LANGS.some((l) => l.code === settings.lang && 'rtl' in l)

  const tabs = [
    { to: '/', label: t('tabChat'), icon: MessageCirclePlus, end: true },
    { to: '/links', label: t('tabLinks'), icon: ReceiptText },
    { to: '/customers', label: t('tabCustomers'), icon: Users },
    { to: '/money', label: t('tabMoney'), icon: PiggyBank },
  ]

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col md:my-6 md:h-[calc(100dvh-3rem)] md:rounded-wobblyMd md:border-[3px] md:border-pencil md:shadow-hardLg md:paper-bg">
      <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-[max(env(safe-area-inset-top),14px)]">
        <div className="min-w-0">
          <h1 className="group font-heading text-3xl font-bold leading-none">
            Easy<span className="inline-block -rotate-6 text-marker transition-transform duration-200 group-hover:rotate-6 group-hover:scale-110">Pay</span>
          </h1>
          {settings.business && <p className="truncate text-lg text-pencil/60">{settings.business}</p>}
        </div>
        <button
          onClick={() => navigate('/settings')}
          aria-label={t('settings')}
          className="group flex h-12 w-12 items-center justify-center rounded-blob border-2 border-pencil bg-white shadow-hardSm transition-transform duration-100 hover:rotate-12 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          <Settings strokeWidth={2.5} className="transition-transform duration-500 group-hover:rotate-90" />
        </button>
      </header>

      <main className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* Re-keyed per screen so every navigation slides a fresh sheet of paper in. */}
        <div key={pathname} className="h-full animate-pageIn">
          <Outlet />
        </div>
      </main>

      <nav className="border-t-[3px] border-dashed border-pencil bg-paper px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 md:rounded-b-[28px]">
        <div className="relative grid grid-cols-4">
          {/* Sticky note that slides under the active tab. */}
          <span
            aria-hidden
            className={cx('absolute inset-y-0 start-0 w-1/4 px-0.5 transition-all duration-300 ease-[cubic-bezier(.2,.9,.3,1.3)]', active < 0 && 'opacity-0')}
            style={{ transform: `translateX(${(rtl ? -1 : 1) * Math.max(active, 0) * 100}%) rotate(${active % 2 ? 1.5 : -1.5}deg)` }}
          >
            <span className="block h-full rounded-wobblySm border-2 border-pencil bg-postit shadow-hardSm" />
          </span>
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'relative flex min-w-0 flex-col items-center gap-0.5 px-1 py-1.5 text-center text-[15px] leading-tight transition-all duration-150 active:scale-90',
                  isActive ? 'text-pencil' : 'text-pencil/60 hover:-translate-y-0.5 hover:text-pencil',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon key={String(isActive)} strokeWidth={2.5} className={cx('h-7 w-7', isActive && 'animate-wiggle')} />
                  <span className={cx(isActive && 'font-bold')}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {toastMsg && (
        <div role="status" className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div key={toastMsg} className="relative animate-toastIn rounded-wobbly border-[3px] border-pencil bg-leaf px-6 py-3 font-heading text-2xl font-bold text-white shadow-hard">
            {toastMsg}
            <Confetti fire={toastMsg.startsWith('💰') ? toastMsg : null} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Polls the merchant's links and celebrates new payments, wherever they are in the app. */
function usePaymentWatcher() {
  const { t, fmt, toast } = useApp()
  // Server-time cursor + ids already celebrated (a small overlap avoids missing a payment).
  const cursor = useRef<number | null>(null)
  const seen = useRef(new Set<string>())

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const first = cursor.current === null
        const res = await api.linkUpdates(first ? Date.now() + 60_000 : cursor.current!)
        if (!alive) return
        for (const l of res.paid) {
          if (seen.current.has(l.id)) continue
          seen.current.add(l.id)
          if (!first) toast(`💰 ${t('newPayment', { amount: fmt(l.total_cents, l.currency) })}`)
        }
        cursor.current = res.now - 15_000
      } catch {
        /* offline: try again next tick */
      }
    }
    tick()
    const id = window.setInterval(tick, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [t, fmt, toast])
}

import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { MessageCirclePlus, PiggyBank, ReceiptText, Settings } from 'lucide-react'
import { api } from '../lib/api'
import { useApp } from '../lib/app'
import { cx } from './ui'

/** Phone-sized app shell: header, content, big bottom tabs, and a "you got paid" toast. */
export function Layout() {
  const { t, settings, toastMsg } = useApp()
  const navigate = useNavigate()
  usePaymentWatcher()

  const tabs = [
    { to: '/', label: t('tabNew'), icon: MessageCirclePlus, end: true },
    { to: '/links', label: t('tabLinks'), icon: ReceiptText },
    { to: '/money', label: t('tabMoney'), icon: PiggyBank },
  ]

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col md:my-6 md:h-[calc(100dvh-3rem)] md:rounded-wobblyMd md:border-[3px] md:border-pencil md:shadow-hardLg md:paper-bg">
      <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-[max(env(safe-area-inset-top),14px)]">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-bold leading-none">
            Easy<span className="inline-block -rotate-6 text-marker">Pay</span>
          </h1>
          {settings.business && <p className="truncate text-lg text-pencil/60">{settings.business}</p>}
        </div>
        <button
          onClick={() => navigate('/settings')}
          aria-label={t('settings')}
          className="flex h-12 w-12 items-center justify-center rounded-blob border-2 border-pencil bg-white shadow-hardSm transition-transform duration-100 hover:rotate-12 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          <Settings strokeWidth={2.5} />
        </button>
      </header>

      <main className="relative min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <nav className="grid grid-cols-3 gap-2 border-t-[3px] border-dashed border-pencil bg-paper px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 md:rounded-b-[28px]">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                'flex flex-col items-center gap-0.5 rounded-wobblySm border-2 px-1 py-1.5 text-center text-base leading-tight transition-transform duration-100',
                isActive ? '-rotate-1 border-pencil bg-postit shadow-hardSm' : 'border-transparent text-pencil/70 hover:rotate-1',
              )
            }
          >
            <Icon strokeWidth={2.5} className="h-7 w-7" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {toastMsg && (
        <div role="status" className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div className="animate-pop rotate-1 rounded-wobbly border-[3px] border-pencil bg-leaf px-6 py-3 font-heading text-2xl font-bold text-white shadow-hard">
            {toastMsg}
          </div>
        </div>
      )}
    </div>
  )
}

/** Polls the merchant's links and celebrates new payments, wherever they are in the app. */
function usePaymentWatcher() {
  const { t, fmt, toast } = useApp()
  const known = useRef<Set<string> | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const links = await api.links()
        const paid = links.filter((l) => l.status === 'paid')
        if (known.current) {
          for (const l of paid) if (!known.current.has(l.id)) toast(`💰 ${t('newPayment', { amount: fmt(l.total_cents, l.currency) })}`)
        }
        if (alive) known.current = new Set(paid.map((l) => l.id))
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

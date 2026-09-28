import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, ChevronRight, CircleCheck, LogOut, Search } from 'lucide-react'
import {
  admin,
  type AdminAccountDetail,
  type AdminAccountRow,
  type AdminOverview,
  type CurrencyTotal,
  type DayCount,
  type KindCount,
} from '../lib/api'
import { money, useApp } from '../lib/app'
import { Bars } from '../components/Bars'
import { itemsTitle } from '../components/Receipt'
import { Button, Card, cx, Input, Spinner, StatusSticker, Underline } from '../components/ui'

/*
 * Platform admin panel for whoever runs Easy Pay. English only on purpose
 * (it's an internal tool), desktop-first but usable on a phone.
 */

const fmtMoney = (cents: number, currency: string) => money(cents, currency, 'en')
const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString('en', { day: 'numeric', month: 'short', year: '2-digit' }) : '—')

function ago(ms: number | null) {
  if (!ms) return 'never'
  const m = Math.round((Date.now() - ms) / 60_000)
  if (m < 2) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} d ago`
}

const USAGE_LABEL: Record<string, string> = {
  ai_chat: 'AI chat messages',
  ai_voice: 'Voice notes',
  ai_tips: 'AI tips',
  link_created: 'Links created',
  signup: 'Sign-ups',
}

export default function AdminPage() {
  const { me, logout } = useApp()
  const navigate = useNavigate()
  const tab = (to: string, label: string, end = false) => (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx('rounded-wobblySm border-2 px-4 py-1.5 text-lg transition-transform duration-100', isActive ? 'border-pencil bg-postit shadow-hardSm' : 'border-transparent hover:-rotate-1')
      }
    >
      {label}
    </NavLink>
  )

  return (
    <div className="mx-auto min-h-[100dvh] max-w-6xl px-5 pb-16 pt-5">
      <header className="mb-8 flex flex-wrap items-center gap-3">
        <h1 className="me-auto font-heading text-3xl font-bold">
          Easy<span className="inline-block -rotate-6 text-marker">Pay</span> <span className="text-pencil/50">· Admin</span>
        </h1>
        <nav className="flex gap-2">
          {tab('/admin', 'Overview', true)}
          {tab('/admin/accounts', 'Accounts')}
        </nav>
        <Button variant="ghost" onClick={() => navigate('/')} icon={<ArrowLeft strokeWidth={2.5} />}>
          App
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            await logout()
            navigate('/welcome')
          }}
          icon={<LogOut strokeWidth={2.5} />}
          aria-label="Log out"
        >
          <span className="hidden sm:inline">{me?.email}</span>
        </Button>
      </header>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="accounts/:id" element={<AccountDetail />} />
      </Routes>
    </div>
  )
}

/* ---------------- overview ---------------- */

function Overview() {
  const [o, setO] = useState<AdminOverview | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    admin.overview().then(setO).catch(() => setError(true))
  }, [])

  if (error) return <p className="text-xl text-marker">Could not load. Try again.</p>
  if (!o) return <Loading />

  const tiles = [
    { label: 'Accounts', value: o.accounts_total, sub: `+${o.accounts_new_30d} in 30 days` },
    { label: 'Active · 7 days', value: o.accounts_active_7d, sub: `${pct(o.accounts_active_7d, o.accounts_total)} of accounts` },
    { label: 'Active · 30 days', value: o.accounts_active_30d, sub: `${pct(o.accounts_active_30d, o.accounts_total)} of accounts` },
    { label: 'Links · 30 days', value: o.links_30d, sub: `${o.links_total} all time` },
    { label: 'Customers', value: o.customers_total, sub: 'across all sellers' },
    { label: 'Stripe ready', value: o.accounts_stripe_ready, sub: `payments: ${o.payments_mode}` },
  ]

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile, i) => (
          <div
            key={tile.label}
            style={{ transform: `rotate(${[-1.2, 0.8, -0.6, 1, -0.9, 0.7][i]}deg)` }}
            className={cx('rounded-wobblyMd border-2 border-pencil p-4 shadow-hardSm', i === 0 ? 'bg-postit' : 'bg-white')}
          >
            <p className="font-heading text-4xl font-bold tabular-nums">{tile.value.toLocaleString('en')}</p>
            <p className="text-lg">{tile.label}</p>
            <p className="text-sm text-pencil/50">{tile.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card decoration="tape">
          <h3 className="mb-3 font-heading text-2xl font-bold">💰 Money processed</h3>
          <MoneyTable title="Last 30 days" rows={o.gmv_30d} />
          <MoneyTable title="All time" rows={o.gmv_all} />
        </Card>
        <Card>
          <h3 className="mb-3 font-heading text-2xl font-bold">⚙️ Usage · 30 days</h3>
          <UsageList rows={o.usage_30d} />
          <p className="mt-3 text-base text-pencil/50">AI: {o.ai_enabled ? 'on (OpenRouter)' : 'off — offline parser'}</p>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-heading text-2xl font-bold">New accounts per day</h3>
          <DayChart rows={o.signups_by_day} />
        </Card>
        <Card>
          <h3 className="mb-3 font-heading text-2xl font-bold">Links created per day</h3>
          <DayChart rows={o.links_by_day} />
        </Card>
      </div>
    </div>
  )
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '0%')

function MoneyTable({ title, rows }: { title: string; rows: CurrencyTotal[] }) {
  return (
    <div className="mb-3">
      <p className="text-base text-pencil/60">{title}</p>
      {rows.length === 0 ? (
        <p className="text-lg text-pencil/40">Nothing yet</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.currency} className="flex items-baseline justify-between gap-3 border-b border-dashed border-pencil/20 py-1 text-xl">
              <span className="font-heading font-bold tabular-nums">{fmtMoney(r.cents, r.currency)}</span>
              <span className="text-base text-pencil/60">{r.count} payments</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function UsageList({ rows }: { rows: KindCount[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  if (!rows.length) return <p className="text-lg text-pencil/40">No activity yet</p>
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.kind}>
          <div className="flex justify-between text-lg">
            <span>{USAGE_LABEL[r.kind] ?? r.kind}</span>
            <span className="tabular-nums">{r.count.toLocaleString('en')}</span>
          </div>
          <div className="h-3 rounded-wobblySm border-2 border-pencil bg-muted">
            <div className="h-full rounded-wobblySm bg-pen" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Fills the missing days of the last 30 with zeros so the chart has a steady rhythm. */
function DayChart({ rows }: { rows: DayCount[] }) {
  const byDay = new Map(rows.map((r) => [r.day, r.count]))
  const today = Math.floor(Date.now() / 86_400_000) * 86_400_000
  const days = Array.from({ length: 30 }, (_, i) => today - (29 - i) * 86_400_000)
  return (
    <Bars
      ariaLabel="per day"
      height="h-36"
      bars={days.map((d, i) => ({
        key: String(d),
        value: byDay.get(d) ?? 0,
        label: i % 5 === 4 ? new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '',
        caption: byDay.get(d) ? String(byDay.get(d)) : undefined,
        highlight: i === 29,
      }))}
    />
  )
}

/* ---------------- accounts ---------------- */

const SORTS = [
  ['newest', 'Newest'],
  ['active', 'Last active'],
  ['gmv', 'Most money'],
  ['links', 'Most links'],
  ['ai', 'Most AI use'],
] as const

const PAGE = 50

function Accounts() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<string>('newest')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ total: number; accounts: AdminAccountRow[] } | null>(null)

  useEffect(() => {
    setData(null)
    const t = setTimeout(() => {
      admin
        .accounts({ q: q.trim().length > 2 ? q.trim() : undefined, sort, limit: PAGE, offset })
        .then(setData)
        .catch(() => setData({ total: 0, accounts: [] }))
    }, 250)
    return () => clearTimeout(t)
  }, [q, sort, offset])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="me-auto font-heading text-4xl font-bold">
          <Underline>Accounts</Underline>
          {data && <span className="ms-3 text-2xl text-pencil/50">{data.total.toLocaleString('en')}</span>}
        </h2>
        <div className="relative w-full sm:w-72">
          <Search strokeWidth={2.5} className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-pencil/40" />
          <Input
            type="search"
            placeholder="Email or business"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOffset(0)
            }}
            className="ps-12"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {SORTS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setSort(key)
              setOffset(0)
            }}
            className={cx(
              'min-h-[40px] rounded-wobblySm border-2 border-pencil px-3 text-lg',
              sort === key ? 'bg-pencil text-white' : 'bg-white shadow-hardSm hover:-rotate-1',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {!data ? (
        <Loading />
      ) : data.accounts.length === 0 ? (
        <p className="py-10 text-center text-2xl text-pencil/60">No accounts found.</p>
      ) : (
        <div className="overflow-x-auto rounded-wobblyMd border-2 border-pencil bg-white shadow-soft">
          <table className="w-full min-w-[860px] text-start text-lg">
            <thead>
              <tr className="border-b-2 border-dashed border-pencil/40 text-base text-pencil/60">
                {['Seller', 'Joined', 'Last seen', 'Links', 'Paid', 'Money', 'Customers', 'AI · 30d', ''].map((h) => (
                  <th key={h} className="px-3 py-2 text-start font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => navigate(`/admin/accounts/${a.id}`)}
                  className="cursor-pointer border-b border-dashed border-pencil/15 transition-colors hover:bg-postit/60"
                >
                  <td className="px-3 py-2">
                    <p className="font-heading font-bold">
                      {a.business_name || '—'} {a.status !== 'active' && <span className="ms-1 text-base text-marker">suspended</span>}
                    </p>
                    <p className="text-base text-pencil/60">{a.email}</p>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtDate(a.created_at)}</td>
                  <td className="px-3 py-2">{ago(a.last_seen_at)}</td>
                  <td className="px-3 py-2 tabular-nums">{a.links}</td>
                  <td className="px-3 py-2 tabular-nums">{a.paid_links}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtMoney(a.gmv_cents, a.currency)}</td>
                  <td className="px-3 py-2 tabular-nums">{a.customers}</td>
                  <td className="px-3 py-2 tabular-nums">{a.ai_calls_30d}</td>
                  <td className="px-3 py-2 text-pencil/40">
                    <ChevronRight strokeWidth={3} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > PAGE && (
        <div className="flex items-center justify-center gap-4">
          <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
            ← Previous
          </Button>
          <span className="text-lg text-pencil/60">
            {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}
          </span>
          <Button variant="ghost" disabled={offset + PAGE >= data.total} onClick={() => setOffset((o) => o + PAGE)}>
            Next →
          </Button>
        </div>
      )}
    </div>
  )
}

/* ---------------- one account ---------------- */

function AccountDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { me, toast } = useApp()
  const [d, setD] = useState<AdminAccountDetail | null | undefined>()
  const [busy, setBusy] = useState(false)

  const load = () => admin.account(id).then(setD).catch(() => setD(null))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (d === undefined) return <Loading />
  if (d === null) return <p className="text-xl">Account not found.</p>
  const a = d.account
  const suspended = a.status !== 'active'

  const toggle = async () => {
    const next = suspended ? 'active' : 'suspended'
    if (next === 'suspended' && !confirm(`Suspend ${a.email}? They'll be logged out and their links stop accepting payments.`)) return
    setBusy(true)
    try {
      await admin.setStatus(a.id, next)
      toast(next === 'active' ? 'Account reactivated' : 'Account suspended')
      await load()
    } catch {
      toast('Could not change the status')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <Button variant="ghost" onClick={() => navigate('/admin/accounts')} icon={<ArrowLeft strokeWidth={2.5} />}>
        Accounts
      </Button>

      <div className="flex flex-wrap items-start gap-4">
        <div className="me-auto min-w-0">
          <h2 className="break-words font-heading text-4xl font-bold">{a.business_name || '—'}</h2>
          <p className="break-all text-xl text-pencil/70">{a.email}</p>
          <p className="text-lg text-pencil/50">
            Joined {fmtDate(a.created_at)} · last seen {ago(d.last_seen_at)} · {a.lang.toUpperCase()} · {a.currency} · plan {a.plan}
          </p>
          <p className="text-lg text-pencil/50">
            Stripe: {a.stripe_account_id ? (a.stripe_charges_enabled ? 'ready ✓' : 'onboarding not finished') : 'not connected'}
          </p>
        </div>
        {a.id !== me?.id && (
          <Button
            variant={suspended ? 'accent' : 'secondary'}
            disabled={busy}
            onClick={toggle}
            icon={suspended ? <CircleCheck strokeWidth={2.5} /> : <Ban strokeWidth={2.5} />}
          >
            {suspended ? 'Reactivate' : 'Suspend'}
          </Button>
        )}
      </div>
      {suspended && <p className="rounded-wobblySm border-2 border-marker bg-white px-4 py-2 text-xl text-marker">This account is suspended.</p>}

      <div className="grid gap-6 md:grid-cols-3">
        <Card tone="postit" decoration="tape">
          <h3 className="mb-3 font-heading text-2xl font-bold">💰 Money</h3>
          <MoneyTable title="Last 30 days" rows={d.gmv_30d} />
          <MoneyTable title="All time" rows={d.gmv_all} />
          <p className="text-lg">{d.customers} customers</p>
        </Card>
        <Card>
          <h3 className="mb-3 font-heading text-2xl font-bold">⚙️ Usage · 30 days</h3>
          <UsageList rows={d.usage_30d} />
        </Card>
        <Card>
          <h3 className="mb-3 font-heading text-2xl font-bold">Activity per day</h3>
          <DayChart rows={d.usage_by_day} />
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 font-heading text-2xl font-bold">Recent links</h3>
        {d.recent_links.length === 0 ? (
          <p className="text-lg text-pencil/40">No links yet</p>
        ) : (
          <ul className="divide-y divide-dashed divide-pencil/20">
            {d.recent_links.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-lg">{itemsTitle(l.items)}</span>
                <span className="text-base text-pencil/50">{fmtDate(l.created_at)}</span>
                <span className="font-heading font-bold tabular-nums">{fmtMoney(l.total_cents, l.currency)}</span>
                <StatusSticker status={l.status} label={l.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

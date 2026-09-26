import type { Item } from '../lib/api'
import { useApp } from '../lib/app'

/** The itemized list shared by the chat draft, link detail and customer page. */
export function Receipt({
  items,
  currency,
  note,
  customer,
  big,
}: {
  items: Item[]
  currency: string
  note?: string
  customer?: string
  big?: boolean
}) {
  const { t, fmt } = useApp()
  const total = items.reduce((s, i) => s + i.total_cents, 0)
  return (
    <div className="font-body">
      {customer && (
        <p className="mb-3 inline-block -rotate-1 rounded-wobblySm bg-postit px-3 py-0.5 text-lg">
          {t('forCustomer', { name: customer })}
        </p>
      )}
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className={`flex items-baseline gap-2 ${big ? 'text-2xl' : 'text-xl'}`}>
            {it.quantity > 1 && <span className="shrink-0 font-heading font-bold text-pen">{it.quantity}×</span>}
            <span className="min-w-0 break-words">{it.name}</span>
            <span aria-hidden className="mx-1 flex-1 translate-y-[-4px] border-b-2 border-dotted border-pencil/30" />
            <span className="shrink-0 tabular-nums">{fmt(it.total_cents, currency)}</span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-3 text-lg italic text-pencil/70">“{note}”</p>}
      <div className="mt-4 flex items-baseline justify-between border-t-[3px] border-dashed border-pencil pt-3">
        <span className="font-heading text-2xl font-bold">{t('total')}</span>
        <span className={`font-heading font-bold text-marker tabular-nums ${big ? 'text-5xl' : 'text-4xl'}`}>
          {fmt(total, currency)}
        </span>
      </div>
    </div>
  )
}

export function itemsTitle(items: Item[]) {
  return items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(', ')
}

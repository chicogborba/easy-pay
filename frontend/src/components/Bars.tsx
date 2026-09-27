import { cx } from './ui'

export type Bar = {
  key: string
  value: number
  label: string
  /** Text above the bar (e.g. amount). */
  caption?: string
  highlight?: boolean
}

/** Hand-drawn bar chart: wobbly, slightly tilted bars. Optionally tappable. */
export function Bars({
  bars,
  selected,
  onSelect,
  height = 'h-44',
  ariaLabel,
}: {
  bars: Bar[]
  selected?: string
  onSelect?: (key: string) => void
  height?: string
  ariaLabel: string
}) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  const Tag = onSelect ? 'button' : 'div'
  return (
    <div className={cx('flex items-end gap-1.5', height)} role={onSelect ? 'group' : 'img'} aria-label={ariaLabel}>
      {bars.map((b, i) => {
        const h = b.value ? Math.max(8, (b.value / max) * 100) : 3
        const isSel = selected === b.key
        return (
          <Tag
            key={b.key}
            {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(b.key), 'aria-pressed': isSel } : {})}
            className={cx(
              'flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1',
              onSelect && 'rounded-wobblySm px-0.5 pt-1 transition-colors duration-100',
              isSel && 'bg-postit outline-dashed outline-2 outline-pencil',
            )}
          >
            {b.caption && b.value > 0 && <span className="text-xs leading-none text-pencil/70 tabular-nums">{b.caption}</span>}
            <span
              style={{ height: `${h}%`, rotate: `${i % 2 ? 1.5 : -1.5}deg`, animationDelay: `${i * 60}ms` }}
              className={cx(
                'block w-full origin-bottom animate-grow rounded-wobblySm border-2 border-pencil transition-[height] duration-500',
                b.value ? (b.highlight ? 'bg-marker' : 'bg-pen') : 'border-dashed bg-muted',
              )}
            />
            <span className={cx('truncate text-sm', b.highlight && 'font-bold text-marker')}>{b.label}</span>
          </Tag>
        )
      })}
    </div>
  )
}

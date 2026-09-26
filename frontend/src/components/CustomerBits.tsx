import { useApp } from '../lib/app'
import { avatarColor, initials, type Tag } from '../lib/crm'
import { cx } from './ui'

export function Avatar({ id, name, big }: { id: number; name: string; big?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex shrink-0 items-center justify-center rounded-blob border-2 border-pencil font-heading font-bold',
        big ? 'h-20 w-20 text-3xl' : 'h-12 w-12 text-lg',
        avatarColor(id),
        id % 2 ? 'rotate-3' : '-rotate-3',
      )}
    >
      {initials(name) || '?'}
    </span>
  )
}

export function TagSticker({ tag }: { tag: Tag }) {
  const { t } = useApp()
  const style = {
    vip: 'bg-marker text-white -rotate-2',
    new: 'bg-pen text-white rotate-2',
    sleeping: 'bg-muted text-pencil rotate-1',
  }[tag]
  const label = { vip: `⭐ ${t('tagVip')}`, new: `🌱 ${t('tagNew')}`, sleeping: `💤 ${t('tagSleeping')}` }[tag]
  return <span className={cx('inline-block whitespace-nowrap rounded-wobblySm border-2 border-pencil px-2 text-sm leading-snug', style)}>{label}</span>
}

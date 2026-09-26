import { LANGS, type LangCode } from '../i18n/strings'
import { cx } from './ui'

/** Big flag + native-name chips: recognizable even without reading English. */
export function LanguagePicker({ value, onChange, compact }: { value: LangCode; onChange: (l: LangCode) => void; compact?: boolean }) {
  return (
    <div className={cx('flex flex-wrap', compact ? 'gap-2' : 'gap-3')}>
      {LANGS.map((l, i) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          onClick={() => onChange(l.code)}
          aria-pressed={value === l.code}
          className={cx(
            'inline-flex min-h-[44px] items-center gap-2 rounded-wobblySm border-2 border-pencil px-3 transition-transform duration-100',
            compact ? 'text-base' : 'text-lg',
            i % 2 ? 'hover:rotate-2' : 'hover:-rotate-2',
            value === l.code ? 'bg-postit shadow-hardSm' : 'bg-white',
          )}
        >
          <span aria-hidden>{l.flag}</span>
          {l.label}
        </button>
      ))}
    </div>
  )
}

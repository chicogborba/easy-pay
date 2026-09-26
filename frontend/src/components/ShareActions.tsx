import { useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'
import { payUrl, type Link } from '../lib/api'
import { useApp } from '../lib/app'
import { Button, cx } from './ui'

/** Big, obvious ways to send a link: WhatsApp first (what most small sellers use). */
export function ShareActions({ link }: { link: Link }) {
  const { t, fmt } = useApp()
  const [copied, setCopied] = useState(false)
  const url = payUrl(link.id)
  const message = `${t('shareMessage', { total: fmt(link.total_cents, link.currency) })} ${url}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Older mobile browsers: fall back to a hidden textarea.
      const ta = Object.assign(document.createElement('textarea'), { value: url })
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const canShare = typeof navigator.share === 'function'

  return (
    <div className="space-y-4">
      <div className="break-all rounded-wobblySm border-2 border-dashed border-pencil bg-paper px-4 py-3 text-center font-body text-lg text-pen">
        {url.replace(/^https?:\/\//, '')}
      </div>
      {/* WhatsApp in its real colors and logo: older users recognize it instantly. */}
      <a
        href={`https://wa.me/?text=${encodeURIComponent(message)}`}
        target="_blank"
        rel="noreferrer"
        className={cx(
          'group flex min-h-[64px] w-full items-center justify-center gap-3 rounded-wobbly border-[3px] border-pencil bg-[#25D366] px-6 text-2xl text-white shadow-hard',
          'transition-all duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-[#1ebe5b] hover:shadow-hardSm',
          'active:translate-x-[4px] active:translate-y-[4px] active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pen/30',
        )}
      >
        <span className="flex h-11 w-11 shrink-0 -rotate-6 items-center justify-center rounded-blob border-2 border-pencil bg-white transition-transform duration-100 group-hover:rotate-6">
          <WhatsAppLogo className="h-7 w-7 fill-[#25D366]" />
        </span>
        <span className="font-heading font-bold [text-shadow:1px_1px_0_#2d2d2d]">{t('shareWhatsApp')}</span>
      </a>
      <div className="grid grid-cols-2 gap-4">
        <Button block className={canShare ? '' : 'col-span-2'} onClick={copy} icon={copied ? <Check strokeWidth={3} /> : <Copy strokeWidth={2.5} />}>
          {copied ? t('copied') : t('copy')}
        </Button>
        {canShare && (
          <Button
            block
            variant="secondary"
            icon={<Share2 strokeWidth={2.5} />}
            onClick={() => navigator.share({ text: message }).catch(() => {})}
          >
            {t('share')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function WhatsAppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  )
}

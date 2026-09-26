import { useState } from 'react'
import { Check, Copy, MessageCircle, Share2 } from 'lucide-react'
import { payUrl, type Link } from '../lib/api'
import { useApp } from '../lib/app'
import { Button } from './ui'

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
      <Button
        variant="accent"
        size="lg"
        block
        icon={<MessageCircle strokeWidth={2.5} />}
        onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')}
      >
        {t('shareWhatsApp')}
      </Button>
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

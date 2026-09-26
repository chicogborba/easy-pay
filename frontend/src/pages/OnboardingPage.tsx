import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useApp } from '../lib/app'
import { LanguagePicker } from '../components/LanguagePicker'
import { Arrow, Button, Card, Input, Label } from '../components/ui'

/** One screen, two questions. Language first so everything after is readable. */
export default function OnboardingPage() {
  const { t, settings, update } = useApp()
  const [business, setBusiness] = useState(settings.business)

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-8 px-6 py-10">
      <div className="relative">
        <p className="font-heading text-2xl text-pen">{t('onboardHello')} 👋</p>
        <h1 className="font-heading text-5xl font-bold leading-tight">
          {t('onboardTitle')}
          <span className="ms-1 inline-block rotate-12 text-marker">!</span>
        </h1>
        <span aria-hidden className="absolute -end-2 -top-6 hidden h-16 w-16 animate-bob rounded-blob border-2 border-dashed border-marker md:block" />
      </div>

      <Card decoration="tack" tilt={-1} className="space-y-6 !p-6">
        <div>
          <Label>🌍</Label>
          <LanguagePicker value={settings.lang} onChange={(lang) => update({ lang })} />
        </div>
        <label className="block">
          <Label>{t('onboardBusiness')}</Label>
          <Input autoFocus value={business} onChange={(e) => setBusiness(e.target.value)} placeholder={t('onboardBusinessPh')} maxLength={60} />
        </label>
      </Card>

      <div className="relative">
        <Arrow className="absolute -top-12 start-2 hidden h-12 w-16 text-pencil/60 md:block" />
        <Button
          variant="accent"
          size="lg"
          block
          onClick={() => update({ business: business.trim(), onboarded: true })}
          icon={<ArrowRight strokeWidth={3} className="rtl:rotate-180" />}
        >
          {t('start')}
        </Button>
      </div>
    </div>
  )
}

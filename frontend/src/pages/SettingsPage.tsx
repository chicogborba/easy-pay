import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import { CURRENCIES, useApp } from '../lib/app'
import { Button, Card, Input, Label, Underline } from '../components/ui'
import { LanguagePicker } from '../components/LanguagePicker'

export default function SettingsPage() {
  const { t, settings, update, toast } = useApp()
  const navigate = useNavigate()
  const [business, setBusiness] = useState(settings.business)

  return (
    <div className="space-y-7 px-5 pb-10 pt-3">
      <Button variant="ghost" onClick={() => navigate(-1)} icon={<ArrowLeft strokeWidth={2.5} className="rtl:rotate-180" />}>
        {t('back')}
      </Button>
      <h2 className="font-heading text-4xl font-bold">
        <Underline>{t('settings')}</Underline>
      </h2>

      <Card className="space-y-6">
        <label className="block">
          <Label>{t('businessName')}</Label>
          <Input value={business} onChange={(e) => setBusiness(e.target.value)} placeholder={t('onboardBusinessPh')} maxLength={60} />
        </label>

        <div>
          <Label>{t('language')}</Label>
          <LanguagePicker value={settings.lang} onChange={(lang) => update({ lang })} />
        </div>

        <div>
          <Label>{t('currency')}</Label>
          <div className="flex flex-wrap gap-2">
            {CURRENCIES.map((c) => (
              <button
                key={c}
                onClick={() => update({ currency: c })}
                aria-pressed={settings.currency === c}
                className={`min-h-[44px] rounded-wobblySm border-2 border-pencil px-3 text-lg transition-transform duration-100 hover:-rotate-2 ${
                  settings.currency === c ? 'bg-pencil text-white' : 'bg-white'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Button
        variant="accent"
        size="lg"
        block
        icon={<Check strokeWidth={3} />}
        onClick={() => {
          update({ business: business.trim() })
          toast(`✓ ${t('saved')}`)
          navigate('/')
        }}
      >
        {t('save')}
      </Button>
    </div>
  )
}

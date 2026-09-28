import type { ProfileInput } from '../lib/api'
import { useApp } from '../lib/app'
import { CATEGORIES, COUNTRIES, countryName, docKind, flag, maskDocument } from '../lib/profile'
import type { Strings } from '../i18n/strings'
import { cx, Input, Label } from './ui'

const CAT_KEY: Record<string, keyof Strings> = {
  food: 'catFood',
  crafts: 'catCrafts',
  clothing: 'catClothing',
  beauty: 'catBeauty',
  services: 'catServices',
  other: 'catOther',
}
const CAT_EMOJI: Record<string, string> = { food: '🍰', crafts: '🧶', clothing: '👗', beauty: '💅', services: '🛠️', other: '✨' }

type Props = {
  value: ProfileInput
  onChange: (p: ProfileInput) => void
  part: 'person' | 'business' | 'all'
  /** Country can't change once payouts are connected. */
  lockCountry?: boolean
}

/** Seller details, big and simple. Brazil asks CPF/CNPJ; other countries an optional tax id. */
export function ProfileFields({ value: p, onChange, part, lockCountry }: Props) {
  const { t, settings } = useApp()
  const set = (patch: Partial<ProfileInput>) => onChange({ ...p, ...patch })
  const kind = docKind(p)
  const chip = (active: boolean, i: number) =>
    cx(
      'min-h-[48px] rounded-wobblySm border-2 border-pencil px-3 text-lg transition-transform duration-100',
      i % 2 ? 'hover:rotate-1' : 'hover:-rotate-1',
      active ? 'bg-postit shadow-hardSm' : 'bg-white',
    )

  return (
    <div className="space-y-5">
      {part !== 'business' && (
        <>
          <label className="block">
            <Label>{t('yourFullName')}</Label>
            <Input autoComplete="name" value={p.owner_name} onChange={(e) => set({ owner_name: e.target.value })} maxLength={80} />
          </label>
          <label className="block">
            <Label>{t('yourPhone')}</Label>
            <Input type="tel" inputMode="tel" autoComplete="tel" value={p.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={30} placeholder={p.country === 'BR' ? '+55 11 91234-5678' : '+1 415 555 0100'} />
          </label>
        </>
      )}

      {part !== 'person' && (
        <>
          <label className="block">
            <Label>{t('countryLabel')}</Label>
            <select
              value={p.country}
              disabled={lockCountry}
              onChange={(e) => set({ country: e.target.value, document: '', business_type: 'individual' })}
              className="min-h-[52px] w-full rounded-wobblySm border-2 border-pencil bg-white px-4 text-xl focus:border-pen focus:outline-none focus:ring-4 focus:ring-pen/20 disabled:opacity-60"
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {flag(c)} {countryName(c, settings.lang)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <Label>{t('onboardBusiness')}</Label>
            <Input value={p.business_name} onChange={(e) => set({ business_name: e.target.value })} placeholder={t('onboardBusinessPh')} maxLength={60} autoComplete="organization" />
          </label>

          <div>
            <Label>{t('businessType')}</Label>
            <div className="flex flex-wrap gap-2">
              {(p.country === 'BR' ? (['individual', 'mei', 'company'] as const) : (['individual', 'company'] as const)).map((bt, i) => (
                <button
                  key={bt}
                  type="button"
                  aria-pressed={p.business_type === bt}
                  onClick={() => set({ business_type: bt, document: '' })}
                  className={chip(p.business_type === bt, i)}
                >
                  {bt === 'individual' ? t('typeIndividual') : bt === 'mei' ? t('typeMei') : t('typeCompany')}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <Label>{kind === 'cpf' ? t('docCpf') : kind === 'cnpj' ? t('docCnpj') : t('docTaxId')}</Label>
            <Input
              inputMode="numeric"
              value={p.document}
              onChange={(e) => set({ document: kind === 'tax' ? e.target.value.slice(0, 20) : maskDocument(e.target.value, kind) })}
              placeholder={kind === 'cpf' ? '000.000.000-00' : kind === 'cnpj' ? '00.000.000/0000-00' : ''}
            />
            <span className="mt-1 block text-base text-pencil/50">🔒 {t('docWhy')}</span>
          </label>

          <div>
            <Label>{t('whatYouSell')}</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c, i) => (
                <button key={c} type="button" aria-pressed={p.category === c} onClick={() => set({ category: c })} className={chip(p.category === c, i)}>
                  {CAT_EMOJI[c]} {t(CAT_KEY[c])}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <label className="block">
              <Label>{t('cityLabel')}</Label>
              <Input autoComplete="address-level2" value={p.city} onChange={(e) => set({ city: e.target.value })} maxLength={60} />
            </label>
            <label className="block">
              <Label>{t('stateLabel')}</Label>
              <Input autoComplete="address-level1" value={p.state} onChange={(e) => set({ state: e.target.value })} maxLength={40} />
            </label>
          </div>
        </>
      )}
    </div>
  )
}

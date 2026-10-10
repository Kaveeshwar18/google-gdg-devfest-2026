import { useTranslation } from 'react-i18next'
import { APPLICATION_TYPES, type ApplicationType } from './types'

interface Props {
  value: ApplicationType
  onChange: (t: ApplicationType) => void
}

/** Which application the user is making. It decides which checks apply (see checks.ts). */
export default function AppTypePicker({ value, onChange }: Props) {
  const { t } = useTranslation()
  return (
    <fieldset className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <legend className="px-1 text-lg font-semibold">{t('cart.appType.title')}</legend>
      <p className="mb-3 text-slate-600">{t('cart.appType.hint')}</p>
      <div className="flex flex-wrap gap-2">
        {APPLICATION_TYPES.map((type) => (
          <label
            key={type}
            className={`cursor-pointer rounded-full border-2 px-4 py-2 font-medium ${
              value === type ? 'border-brand bg-brand text-white' : 'border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="appType"
              value={type}
              checked={value === type}
              onChange={() => onChange(type)}
              className="sr-only"
            />
            {t(`cart.appType.${type}`)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

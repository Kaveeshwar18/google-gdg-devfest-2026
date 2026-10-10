import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseDate } from './dates'
import { DOC_FIELDS, type CartDoc, type DocType, type ExtractedFields } from './types'

interface Props {
  doc: CartDoc
  /** Slot already holds a document of the type we think this is. */
  moveBlocked: boolean
  /** Empty slots the user can move this document to if it was put in the wrong one. */
  freeTypes: DocType[]
  onConfirm: (fields: ExtractedFields) => void
  onRemove: () => void
  onUseAs: (type: DocType) => void
}

const DATE_FIELDS = new Set(['dob', 'expiry'])

/**
 * The mandatory confirm/edit screen (plan 3.3: never cut). Shows what we read, lets the user fix every field
 * or type it in from scratch, and only the "Yes, this is correct" button marks the document confirmed.
 */
export default function ConfirmDoc({ doc, moveBlocked, freeTypes, onConfirm, onRemove, onUseAs }: Props) {
  const { t } = useTranslation()
  const keys = DOC_FIELDS[doc.type]
  const [values, setValues] = useState<ExtractedFields>(doc.fields)
  const [tried, setTried] = useState(false)

  const invalid = (k: (typeof keys)[number]) => DATE_FIELDS.has(k) && !!values[k]?.trim() && !parseDate(values[k])
  const hasError = keys.some(invalid)

  function set(key: (typeof keys)[number], value: string) {
    // For Aadhaar keep only digits and only the last four, even if someone pastes the whole number.
    setValues((v) => ({ ...v, [key]: key === 'aadhaarLast4' ? value.replace(/\D/g, '').slice(-4) : value }))
  }

  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-xl bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (!hasError) onConfirm(values)
      }}
    >
      <h3 className="text-lg font-semibold">{t('cart.confirm.title')}</h3>
      <p className="text-slate-700">{doc.noText ? t('cart.noText') : t('cart.confirm.intro')}</p>

      {doc.detected && doc.detected !== doc.type && (
        <div className="rounded-lg bg-amber-50 p-3 text-amber-900">
          <p>{t('cart.lookLike', { doc: t(`cart.docs.${doc.detected}`) })}</p>
          {moveBlocked ? (
            <p className="mt-1 text-sm">{t('cart.useAsBlocked', { doc: t(`cart.docs.${doc.detected}`) })}</p>
          ) : (
            <button
              type="button"
              onClick={() => onUseAs(doc.detected as DocType)}
              className="mt-2 font-semibold underline"
            >
              {t('cart.useAs', { doc: t(`cart.docs.${doc.detected}`) })}
            </button>
          )}
        </div>
      )}

      {freeTypes.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="font-medium">{t('cart.chooseType')}</span>
          <select
            value=""
            onChange={(e) => e.target.value && onUseAs(e.target.value as DocType)}
            className="rounded-lg border-2 border-slate-300 bg-white p-3 text-lg"
          >
            <option value="">{t('cart.chooseTypePlaceholder')}</option>
            {freeTypes.map((type) => (
              <option key={type} value={type}>
                {t(`cart.docs.${type}`)}
              </option>
            ))}
          </select>
        </label>
      )}

      {keys.map((key) => {
        const read = !!doc.fields[key]
        const bad = tried && invalid(key)
        return (
          <label key={key} className="flex flex-col gap-1">
            <span className="font-medium">{t(`cart.fields.${key}`)}</span>
            <input
              value={values[key] ?? ''}
              onChange={(e) => set(key, e.target.value)}
              inputMode={key === 'aadhaarLast4' ? 'numeric' : undefined}
              maxLength={key === 'aadhaarLast4' ? 4 : 200}
              autoComplete="off"
              aria-invalid={bad}
              className={`rounded-lg border-2 bg-white p-3 text-lg ${
                bad ? 'border-red-500' : read ? 'border-slate-300' : 'border-amber-400'
              }`}
            />
            <span className={`text-sm ${bad ? 'text-red-700' : 'text-slate-600'}`}>
              {bad
                ? t('cart.confirm.invalidDate')
                : key === 'aadhaarLast4'
                  ? t('cart.confirm.aadhaarNote')
                  : read
                    ? t('cart.confirm.readHint')
                    : t('cart.confirm.missingHint')}
            </span>
          </label>
        )
      })}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="rounded-full bg-brand px-5 py-3 font-semibold text-white">
          {t('cart.confirm.yes')}
        </button>
        <button type="button" onClick={onRemove} className="rounded-full border-2 border-slate-300 px-5 py-3 font-medium">
          {t('cart.confirm.cancel')}
        </button>
      </div>
    </form>
  )
}

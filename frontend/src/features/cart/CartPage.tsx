import { Camera, CheckCircle2, FileUp, Loader2, PencilLine } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import ListenButton from '../../components/ListenButton'
import EvisaPage from '../evisa/EvisaPage'
import { useApp } from '../../store/app'
import AppTypePicker from './AppTypePicker'
import ConfirmDoc from './ConfirmDoc'
import { buildHandoff } from './handoff'
import { recognize } from './ocr'
import ResultCard from './ResultCard'
import { useCart } from './store'
import { DOC_TYPES, type DocType } from './types'

/**
 * M1 Document Cart. Photo -> on-device OCR -> Aadhaar masked -> classify + extract -> confirm/edit screen
 * -> checks (only after confirmation) -> result card -> "Fix with Mitra". Photos and extracted values never
 * leave this component tree except through the templated hand-off in handoff.ts.
 */
export default function CartPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const lang = useApp((s) => s.lang)
  const cart = useCart()
  const { docs, appType, report } = cart
  const [showResult, setShowResult] = useState(false)

  async function read(type: DocType, file: File) {
    setShowResult(false)
    cart.startReading(type)
    try {
      const text = await recognize(file, lang, (progress) => cart.update(type, { progress }))
      cart.finishReading(type, text)
    } catch {
      // Never put the error text on screen or in a log: it could echo document content.
      cart.failReading(type)
    }
  }

  const all = DOC_TYPES.map((type) => docs[type])
  const confirmed = all.filter((d) => d.status === 'confirmed')
  const unfinished = all.some((d) => d.status === 'review' || d.status === 'reading')

  function runCheck() {
    if (cart.check()) setShowResult(true)
  }

  function fixWithMitra() {
    const handoff = buildHandoff(report, (key, params) => t(key, params))
    useApp.getState().setHandoff(handoff)
    void navigate('/stuck')
  }

  if (showResult && report) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">{t('cart.result.title')}</h1>
        <ResultCard
          report={report}
          confirmed={confirmed.map((d) => d.type)}
          onFix={fixWithMitra}
          onBack={() => setShowResult(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('cart.title')}</h1>
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-green-50 p-4 text-green-900">
        <p className="flex-1">{t('cart.onDevice')}</p>
        <ListenButton text={t('cart.onDevice')} />
      </div>

      <AppTypePicker value={appType} onChange={cart.setAppType} />

      {DOC_TYPES.map((type) => {
        const doc = docs[type]
        const picker = (capture: boolean) => (
          <input
            type="file"
            accept="image/*"
            {...(capture ? { capture: 'environment' as const } : {})}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void read(type, file)
              e.target.value = ''
            }}
          />
        )
        const pill = 'inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 font-medium'
        return (
          <section key={type} className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                {doc.status === 'confirmed' && <CheckCircle2 className="size-5 text-green-600" aria-hidden />}
                {t(`cart.docs.${type}`)}
              </h2>
              {(doc.status === 'review' || doc.status === 'confirmed') && (
                <span className="text-slate-600">{t(`cart.status.${doc.status}`)}</span>
              )}
            </div>

            {(doc.status === 'empty' || doc.status === 'error') && (
              <div className="mt-3 flex flex-wrap gap-2">
                <label className={`${pill} bg-brand text-white`}>
                  <Camera className="size-5" aria-hidden />
                  {t('cart.addPhoto')}
                  {picker(true)}
                </label>
                <label className={`${pill} border-2 border-brand text-brand`}>
                  <FileUp className="size-5" aria-hidden />
                  {t('cart.choosePhoto')}
                  {picker(false)}
                </label>
                <button
                  type="button"
                  onClick={() => cart.startManual(type)}
                  className={`${pill} border-2 border-slate-300`}
                >
                  <PencilLine className="size-5" aria-hidden />
                  {t('cart.enterManually')}
                </button>
              </div>
            )}

            {doc.status === 'error' && <p className="mt-2 text-red-700">{t('cart.readFailed')}</p>}

            {doc.status === 'reading' && (
              <p className="mt-3 flex items-center gap-2 text-slate-600">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                {t('cart.reading', { pct: Math.round(doc.progress * 100) })}
              </p>
            )}

            {doc.status === 'review' && (
              <>
                <ConfirmDoc
                  key={`${doc.type}-${doc.detected ?? 'none'}`}
                  doc={doc}
                  freeTypes={DOC_TYPES.filter((o) => o !== type && docs[o].status === 'empty')}
                  moveBlocked={!!doc.detected && doc.detected !== type && docs[doc.detected].status !== 'empty'}
                  onConfirm={(fields) => cart.confirm(type, fields)}
                  onRemove={() => cart.remove(type)}
                  onUseAs={(to) => cart.moveDoc(type, to)}
                />
                {doc.rawText && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-slate-600">{t('cart.whatWeRead')}</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-sm">{doc.rawText}</pre>
                  </details>
                )}
              </>
            )}

            {doc.status === 'confirmed' && (
              <div className="mt-3 flex gap-4">
                <button type="button" onClick={() => cart.edit(type)} className="font-semibold text-brand underline">
                  {t('cart.edit')}
                </button>
                <button type="button" onClick={() => cart.remove(type)} className="font-semibold text-slate-700 underline">
                  {t('cart.remove')}
                </button>
              </div>
            )}
          </section>
        )
      })}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={unfinished || confirmed.length === 0}
          onClick={runCheck}
          className="rounded-full bg-brand px-5 py-3 text-lg font-semibold text-white disabled:opacity-50"
        >
          {t('cart.checkNow')}
        </button>
        {unfinished && <p className="text-slate-600">{t('cart.confirmFirst')}</p>}
        {!unfinished && confirmed.length === 0 && <p className="text-slate-600">{t('cart.addOne')}</p>}
      </div>

      <details className="rounded-2xl border-2 border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-lg font-semibold">{t('cart.evisa.title')}</summary>
        <EvisaPage />
      </details>
    </div>
  )
}

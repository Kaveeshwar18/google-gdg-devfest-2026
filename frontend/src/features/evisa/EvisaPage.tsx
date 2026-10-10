import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CartReport, Issue } from '../cart/types'
import { OFFICIAL_PORTAL, PASSPORT_KINDS, checkEvisa, type EvisaInput } from './check'

const VERDICT_BOX = {
  not_ready: 'border-red-300 bg-red-50 text-red-900',
  almost_ready: 'border-amber-300 bg-amber-50 text-amber-900',
  ready: 'border-green-300 bg-green-50 text-green-900',
} as const

const SEVERITY_BADGE = {
  blocker: 'bg-red-100 text-red-900',
  warning: 'bg-amber-100 text-amber-900',
  info: 'bg-slate-100 text-slate-800',
} as const

const field = 'rounded-lg border-2 border-slate-300 bg-white p-3 text-lg'

/**
 * M6 e-Visa pre-check (stretch). Everything stays in this component's state: nothing is stored or sent.
 * Reachable today from the bottom of the Document Cart page; Lane C can give it its own route later.
 */
export default function EvisaPage() {
  const { t } = useTranslation()
  const [input, setInput] = useState<EvisaInput>({
    passportKind: 'ordinary',
    passportExpiry: '',
    blankPages: null,
    arrival: '',
    evisasThisYear: null,
    pakistaniOrigin: 'no',
  })
  const [report, setReport] = useState<CartReport | null>(null)
  const [missing, setMissing] = useState(false)

  const num = (v: string) => (v === '' ? null : Math.max(0, Math.floor(Number(v))))
  const set = (patch: Partial<EvisaInput>) => {
    setInput((i) => ({ ...i, ...patch }))
    setReport(null) // an old result must not outlive an edit
  }

  function run() {
    const incomplete = !input.passportExpiry || !input.arrival || input.blankPages === null
    setMissing(incomplete)
    if (!incomplete) setReport(checkEvisa(input))
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-slate-700">{t('cart.evisa.intro')}</p>

      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('cart.evisa.fields.passportKind')}</span>
        <select value={input.passportKind} onChange={(e) => set({ passportKind: e.target.value as EvisaInput['passportKind'] })} className={field}>
          {PASSPORT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`cart.evisa.kinds.${k}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('cart.evisa.fields.passportExpiry')}</span>
        <input type="date" value={input.passportExpiry} onChange={(e) => set({ passportExpiry: e.target.value })} className={field} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('cart.evisa.fields.blankPages')}</span>
        <input type="number" min={0} inputMode="numeric" value={input.blankPages ?? ''} onChange={(e) => set({ blankPages: num(e.target.value) })} className={field} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('cart.evisa.fields.arrival')}</span>
        <input type="date" value={input.arrival} onChange={(e) => set({ arrival: e.target.value })} className={field} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('cart.evisa.fields.evisasThisYear')}</span>
        <input type="number" min={0} inputMode="numeric" value={input.evisasThisYear ?? ''} onChange={(e) => set({ evisasThisYear: num(e.target.value) })} className={field} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('cart.evisa.fields.pakistaniOrigin')}</span>
        <select value={input.pakistaniOrigin} onChange={(e) => set({ pakistaniOrigin: e.target.value as EvisaInput['pakistaniOrigin'] })} className={field}>
          {(['no', 'yes', 'unsure'] as const).map((o) => (
            <option key={o} value={o}>
              {t(`cart.evisa.origin.${o}`)}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-600">{t('cart.evisa.origin.hint')}</span>
      </label>

      {missing && <p className="text-red-700">{t('cart.evisa.required')}</p>}
      <button type="button" onClick={run} className="self-start rounded-full bg-brand px-5 py-3 font-semibold text-white">
        {t('cart.evisa.check')}
      </button>

      {report && <EvisaResult report={report} />}
    </div>
  )
}

function EvisaResult({ report }: { report: CartReport }) {
  const { t } = useTranslation()
  return (
    <section aria-live="polite" className="flex flex-col gap-3">
      <div className={`rounded-2xl border-2 p-4 ${VERDICT_BOX[report.verdict]}`}>
        <h3 className="text-xl font-bold">{t(`cart.evisa.result.${report.verdict}`)}</h3>
        <p className="mt-1">{t(`cart.evisa.result.${report.verdict}_sub`)}</p>
      </div>
      {report.issues.length === 0 && <p className="text-slate-700">{t('cart.evisa.result.noIssues')}</p>}
      {report.issues.map((i) => (
        <IssueCard key={i.id} issue={i} />
      ))}
      <div className="rounded-2xl bg-slate-50 p-4">
        <h4 className="font-semibold">{t('cart.evisa.result.notes')}</h4>
        <ul className="mt-1 list-inside list-disc text-slate-700">
          {report.notes.map((n) => (
            <li key={n.key}>{t(n.key)}</li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-slate-600">{t('cart.evisa.result.disclaimer')}</p>
      <a href={OFFICIAL_PORTAL} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-brand underline">
        {t('cart.evisa.result.officialPortal')}
        <ExternalLink className="size-4" aria-hidden />
      </a>
    </section>
  )
}

function IssueCard({ issue }: { issue: Issue }) {
  const { t } = useTranslation()
  const p = issue.params
  return (
    <article className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${SEVERITY_BADGE[issue.severity]}`}>
        {t(`cart.evisa.result.severity.${issue.severity}`)}
      </span>
      <dl className="mt-2 flex flex-col gap-2">
        <div>
          <dt className="font-semibold">{t('cart.evisa.result.found')}</dt>
          <dd>{t(issue.found, p)}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('cart.evisa.result.why')}</dt>
          <dd>{t(issue.why, p)}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('cart.evisa.result.fix')}</dt>
          <dd>{t(issue.fix, p)}</dd>
        </div>
      </dl>
      {issue.provisional && <p className="mt-2 text-sm text-amber-800">{t('cart.evisa.result.provisional')}</p>}
    </article>
  )
}

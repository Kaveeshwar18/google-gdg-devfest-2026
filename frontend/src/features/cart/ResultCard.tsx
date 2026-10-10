import { CheckCircle2, ExternalLink, Info, OctagonAlert, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ListenButton from '../../components/ListenButton'
import type { CartReport, DocType, Issue, Severity, Verdict } from './types'

interface Props {
  report: CartReport
  confirmed: DocType[]
  onFix: () => void
  onBack: () => void
}

const VERDICT_STYLE: Record<Verdict, { box: string; Icon: typeof CheckCircle2 }> = {
  not_ready: { box: 'border-red-300 bg-red-50 text-red-900', Icon: OctagonAlert },
  almost_ready: { box: 'border-amber-300 bg-amber-50 text-amber-900', Icon: TriangleAlert },
  ready: { box: 'border-green-300 bg-green-50 text-green-900', Icon: CheckCircle2 },
}

const SEVERITY_STYLE: Record<Severity, string> = {
  blocker: 'bg-red-100 text-red-900',
  warning: 'bg-amber-100 text-amber-900',
  info: 'bg-slate-100 text-slate-800',
}

/** The readiness result: verdict first, then found / why / fix for every issue. Never promises an outcome. */
export default function ResultCard({ report, confirmed, onFix, onBack }: Props) {
  const { t } = useTranslation()
  const { box, Icon } = VERDICT_STYLE[report.verdict]

  // Params hold document types only; show them as the user's own words for each document.
  const fill = (params?: Record<string, string>) =>
    Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, t(`cart.docs.${v}`)]))
  const headline = `${t(`cart.result.${report.verdict}`)}. ${t(`cart.result.${report.verdict}_sub`)}`

  return (
    <section aria-live="polite" className="flex flex-col gap-4">
      <div className={`rounded-2xl border-2 p-4 ${box}`}>
        <h2 className="flex items-center gap-2 text-2xl font-bold">
          <Icon className="size-7 shrink-0" aria-hidden />
          {t(`cart.result.${report.verdict}`)}
        </h2>
        <p className="mt-2">{t(`cart.result.${report.verdict}_sub`)}</p>
        <div className="mt-3">
          <ListenButton text={headline} />
        </div>
      </div>

      <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
        <h3 className="font-semibold">{t('cart.result.added')}</h3>
        <ul className="mt-1 list-inside list-disc text-slate-700">
          {confirmed.map((type) => (
            <li key={type}>{t(`cart.docs.${type}`)}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">{t('cart.result.issues')}</h3>
        {report.issues.length === 0 && <p className="text-slate-700">{t('cart.result.noIssues')}</p>}
        {report.issues.map((issue) => (
          <IssueItem key={issue.id} issue={issue} params={fill(issue.params)} />
        ))}
      </div>

      {report.notes.length > 0 && (
        <div className="rounded-2xl bg-slate-50 p-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <Info className="size-5" aria-hidden />
            {t('cart.result.notChecked')}
          </h3>
          <ul className="mt-1 list-inside list-disc text-slate-700">
            {report.notes.map((n, i) => (
              <li key={`${n.key}-${i}`}>{t(n.key, fill(n.params))}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-slate-600">{t('cart.result.disclaimer')}</p>

      <div className="flex flex-col gap-2">
        <button type="button" onClick={onFix} className="rounded-full bg-brand px-5 py-3 text-lg font-semibold text-white">
          {t('cart.result.fixWithMitra')}
        </button>
        <p className="text-sm text-slate-600">{t('cart.result.fixHint')}</p>
        <button type="button" onClick={onBack} className="self-start font-semibold text-brand underline">
          {t('cart.result.back')}
        </button>
      </div>
    </section>
  )
}

function IssueItem({ issue, params }: { issue: Issue; params: Record<string, string> }) {
  const { t } = useTranslation()
  return (
    <article className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${SEVERITY_STYLE[issue.severity]}`}>
        {t(`cart.result.severity.${issue.severity}`)}
      </span>
      <dl className="mt-2 flex flex-col gap-2">
        <div>
          <dt className="font-semibold">{t('cart.result.found')}</dt>
          <dd>{t(issue.found, params)}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('cart.result.why')}</dt>
          <dd>{t(issue.why, params)}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('cart.result.fix')}</dt>
          <dd>{t(issue.fix, params)}</dd>
        </div>
      </dl>
      {issue.provisional && <p className="mt-2 text-sm text-amber-800">{t('cart.result.provisional')}</p>}
      {issue.sourceUrl && (
        <a
          href={issue.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-flex items-center gap-1 font-medium text-brand underline"
        >
          {t('cart.result.source')}
          <ExternalLink className="size-4" aria-hidden />
        </a>
      )}
    </article>
  )
}

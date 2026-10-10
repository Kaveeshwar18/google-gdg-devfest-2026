import { AlertTriangle, ExternalLink, Share2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ConfidenceBadge from '../../components/ConfidenceBadge'
import ListenButton from '../../components/ListenButton'
import type { CaseResult } from '../../lib/types'

/** Answer card (plan 3.9 screen 5). Never cut: citations, confidence badge, disclaimer. */
export default function AnswerCard({ result }: { result: CaseResult }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const a = result.answer
  const path = a.recommended_path
  const spoken = [a.diagnosis, ...path.steps].join(' ')

  async function share() {
    const summary = [a.diagnosis, '', ...path.steps.map((s, i) => `${i + 1}. ${s}`), '', a.disclaimer].join('\n')
    if (navigator.share) {
      await navigator.share({ text: summary }).catch(() => {})
    } else {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
    }
  }

  return (
    <article className="flex flex-col gap-5 rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ConfidenceBadge level={a.confidence} />
        <div className="flex gap-2">
          <ListenButton text={spoken} />
          <button
            type="button"
            onClick={() => void share()}
            className="inline-flex items-center gap-2 rounded-full border-2 border-slate-300 px-4 py-2 font-medium"
          >
            <Share2 className="size-5" aria-hidden />
            {copied ? t('answer.copied') : t('answer.share')}
          </button>
        </div>
      </div>
      {!result.localized && result.lang !== 'en' && <p className="text-sm text-slate-500">{t('answer.englishOnly')}</p>}

      <section>
        <h2 className="mb-1 font-semibold text-slate-600">{t('answer.whatsGoingOn')}</h2>
        <p className="text-lg">{a.diagnosis}</p>
        {a.likely_causes.length > 0 && (
          <ul className="mt-2 list-disc pl-6 text-slate-700">
            {a.likely_causes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-slate-600">{t('answer.nextSteps')}</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-6 text-lg">
          {path.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-2 text-slate-600">
          {t('answer.where')}: <strong>{path.where}</strong>
        </p>
      </section>

      {path.documents_needed.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-slate-600">{t('answer.documents')}</h2>
          <ul className="list-disc pl-6">
            {path.documents_needed.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>
      )}

      {a.conflicts.map((c) => (
        <section key={c.issue} className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <h2 className="mb-1 flex items-center gap-2 font-semibold text-amber-900">
            <AlertTriangle className="size-5" aria-hidden />
            {t('answer.conflicts')}
          </h2>
          <p>{c.issue}</p>
          <p className="mt-1 text-amber-900">
            <strong>{t('answer.decides')}:</strong> {c.what_decides_it}
          </p>
        </section>
      ))}

      {a.alternatives.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-slate-600">{t('answer.alternatives')}</h2>
          <ul className="flex flex-col gap-2">
            {a.alternatives.map((alt) => (
              <li key={alt.name}>
                <strong>{alt.name}</strong>: {alt.when_it_applies}
              </li>
            ))}
          </ul>
        </section>
      )}

      {a.similar_cases.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-slate-600">{t('answer.similar')}</h2>
          <ul className="flex flex-col gap-3">
            {a.similar_cases.map((s) => {
              const source = a.citations.find((c) => c.source_id === s.citation_id)
              return (
                <li key={s.citation_id + s.summary} className="rounded-xl bg-slate-100 p-3">
                  <p>{s.summary}</p>
                  <p className="text-sm text-slate-600">{s.outcome}</p>
                  {source && (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block rounded-full bg-white px-3 py-1 text-xs font-medium text-brand"
                    >
                      {source.source_type}
                      {s.date ? ` · ${s.date}` : ''}
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {a.unknowns.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-slate-600">{t('answer.unknowns')}</h2>
          <ul className="list-disc pl-6">
            {a.unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      )}

      {result.draft && (
        <section className="rounded-xl border-2 border-slate-300 p-4">
          <h2 className="mb-1 font-semibold">{t('answer.draft')}</h2>
          <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-900">{t('answer.draftWarning')}</p>
          <pre className="whitespace-pre-wrap text-sm">
            {result.draft.split(/(\[_+\])/).map((part, i) =>
              /^\[_+\]$/.test(part) ? (
                <mark key={i} className="bg-amber-200">
                  {part}
                </mark>
              ) : (
                part
              ),
            )}
          </pre>
        </section>
      )}

      {a.citations.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-slate-600">{t('answer.sources')}</h2>
          <ul className="flex flex-col gap-2">
            {a.citations.map((c) => (
              <li key={c.source_id}>
                <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-2 text-brand underline">
                  <ExternalLink className="mt-1 size-4 shrink-0" aria-hidden />
                  <span>
                    {c.title}{' '}
                    <span className="text-sm text-slate-500 no-underline">
                      ({c.source_type}
                      {c.date ? `, ${c.date}` : ''})
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold text-slate-600">{t('answer.escalation')}</h2>
        <ul className="list-disc pl-6">
          {a.escalation.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </section>

      <p className="border-t pt-3 text-sm text-slate-500">{a.disclaimer}</p>
    </article>
  )
}

// "Fix with Mitra": the hand-off from the Document Cart to the Stuck-Case Solver (TEAM.md Interfaces 1 and 2).
//
// The text is built from fixed sentences (cart.handoff.* strings) and the issue ids from the shared vocabulary.
// It names document KINDS ("Aadhaar", "marksheet"), never values: no names, dates, numbers, addresses or OCR text.
// Nothing is sent from here. The chat pre-fills the text and the user decides whether to send it.
import type { CartReport } from './types'

const DOC = '(?:aadhaar|pan|passport|marksheet|address|birth)'
/** The cart_issues vocabulary, TEAM.md Interfaces section 1. Anything else is dropped. */
const VOCABULARY = new RegExp(
  `^(?:(?:name_mismatch|name_order|name_initials|dob_mismatch|address_mismatch|parent_name_mismatch):${DOC}_vs_${DOC}` +
    `|dob_proof_missing|passport_expired|minor_flow_required|missing_document:${DOC})$`,
)

export type Translate = (key: string, params?: Record<string, string>) => string

export interface Handoff {
  text: string
  cartIssues: string[]
}

export function isAllowedIssueId(id: string): boolean {
  return VOCABULARY.test(id)
}

export function buildHandoff(report: CartReport | null, t: Translate): Handoff {
  const issues = (report?.issues ?? []).filter((i) => isAllowedIssueId(i.id))
  if (issues.length === 0) return { text: t('cart.handoff.general'), cartIssues: [] }

  const sentences = issues.map((i) => {
    const kind = i.id.split(':')[0]
    const params: Record<string, string> = {}
    for (const [k, v] of Object.entries(i.params ?? {})) params[k] = t(`cart.docs.${v}`)
    if (kind === 'missing_document') params.doc = t(`cart.docs.${i.id.split(':')[1]}`)
    return t(`cart.handoff.${kind}`, params)
  })
  return { text: [t('cart.handoff.intro'), ...sentences].join(' '), cartIssues: issues.map((i) => i.id) }
}

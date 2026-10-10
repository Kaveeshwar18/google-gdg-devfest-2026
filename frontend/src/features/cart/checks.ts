// Deterministic cross-checks, no LLM (plan 3.3 "Deterministic checks"). Pure and offline.
//
// Two kinds of check live here:
//  - consistency checks between documents the user has CONFIRMED (name, date of birth, address, parents).
//    A confirmed difference can be a blocker: the user told us both documents say different things.
//  - requirement checks (missing documents, age, DOB proof). Their sources are listed in rules.ts and none is
//    verified yet, so they are warnings or info at most and carry `provisional` plus the page to check.
// Issue ids come from the fixed vocabulary in TEAM.md "Interfaces" section 1. Texts are i18n keys (cart.issues.*).
import { distance } from 'fastest-levenshtein'
import { ageOn, compareFull, isFull, parseDate, todayParts, type ParsedDate } from './dates'
import { ADULT_AGE, BIRTH_CERT_ONLY_FROM, RULES, type CartRule } from './rules'
import type { ApplicationType, CartDoc, CartReport, DocType, Issue, ReportNote, Severity, Verdict } from './types'

// ---------------------------------------------------------------- names

const TITLES = new Set(['mr', 'mrs', 'ms', 'dr', 'shri', 'smt', 'kumari', 'sri'])
const FUZZY_MIN = 0.85

export type NameMatch = 'exact' | 'order_differs' | 'initials' | 'fuzzy' | 'mismatch' | 'unknown'

/** Lowercase Latin tokens without titles or punctuation. Names in other scripts give no tokens. */
export function normaliseName(s: string): string[] {
  const folded = s.normalize('NFKD').toLowerCase().replace(/[^a-z\s]/g, ' ')
  return folded.split(/\s+/).filter((t) => t && !TITLES.has(t))
}

const similarity = (a: string, b: string) => 1 - distance(a, b) / Math.max(a.length, b.length, 1)

/** Port of the plan's compare_names (3.3). 'unknown' when either side has no Latin letters to compare. */
export function compareNames(a: string, b: string): { match: NameMatch; score: number } {
  const ta = normaliseName(a)
  const tb = normaliseName(b)
  if (ta.length === 0 || tb.length === 0) return { match: 'unknown', score: 0 }
  if (ta.join(' ') === tb.join(' ')) return { match: 'exact', score: 1 }
  if ([...ta].sort().join(' ') === [...tb].sort().join(' ')) return { match: 'order_differs', score: 0.95 }
  // initials: "K Ram" vs "Kamal Ram" (every token of one side appears, in full or as an initial, in the other)
  const covered = (x: string[], y: string[]) =>
    x.every((t) => y.some((u) => t === u || (t.length === 1 && u.startsWith(t))))
  if (covered(ta, tb) || covered(tb, ta)) return { match: 'initials', score: 0.9 }
  const score = similarity([...ta].sort().join(' '), [...tb].sort().join(' '))
  return { match: score >= FUZZY_MIN ? 'fuzzy' : 'mismatch', score }
}

// ---------------------------------------------------------------- helpers

/** Fixed order so pair ids are stable and match the vocabulary examples (address_vs_aadhaar, pan_vs_marksheet…). */
const PAIR_ORDER: readonly DocType[] = ['address', 'pan', 'aadhaar', 'passport', 'marksheet', 'birth']
const DOB_PRIORITY: readonly DocType[] = ['birth', 'marksheet', 'passport', 'pan', 'aadhaar']

function pairId(check: string, a: DocType, b: DocType): { id: string; a: DocType; b: DocType } {
  const [x, y] = [a, b].sort((p, q) => PAIR_ORDER.indexOf(p) - PAIR_ORDER.indexOf(q)) as [DocType, DocType]
  return { id: `${check}:${x}_vs_${y}`, a: x, b: y }
}

function pairs<T extends { type: DocType }>(items: T[]): [T, T][] {
  const sorted = [...items].sort((p, q) => PAIR_ORDER.indexOf(p.type) - PAIR_ORDER.indexOf(q.type))
  return sorted.flatMap((x, i) => sorted.slice(i + 1).map((y): [T, T] => [x, y]))
}

function rulePart(rule: CartRule): Pick<Issue, 'provisional' | 'sourceUrl'> {
  return { provisional: rule.status !== 'verified', sourceUrl: rule.sourceUrl }
}

function issue(
  id: string,
  severity: Severity,
  textKey: string,
  params?: Record<string, string>,
  rule?: CartRule,
): Issue {
  return {
    id,
    severity,
    found: `cart.issues.${textKey}.found`,
    why: `cart.issues.${textKey}.why`,
    fix: `cart.issues.${textKey}.fix`,
    ...(params ? { params } : {}),
    ...(rule ? rulePart(rule) : {}),
  }
}

// ---------------------------------------------------------------- the checks

function nameChecks(docs: CartDoc[], issues: Issue[], notes: ReportNote[]) {
  const named = docs.filter((d) => d.fields.name)
  for (const d of named) {
    if (normaliseName(d.fields.name!).length === 0) notes.push({ key: 'cart.notes.nameNotCompared', params: { doc: d.type } })
  }
  for (const [x, y] of pairs(named)) {
    const { match } = compareNames(x.fields.name!, y.fields.name!)
    const p = (check: string) => pairId(check, x.type, y.type)
    if (match === 'order_differs') {
      const { id, a, b } = p('name_order')
      issues.push(issue(id, 'warning', 'name_order', { a, b }))
    } else if (match === 'initials') {
      const { id, a, b } = p('name_initials')
      issues.push(issue(id, 'warning', 'name_initials', { a, b }))
    } else if (match === 'fuzzy') {
      const { id, a, b } = p('name_mismatch')
      issues.push(issue(id, 'warning', 'name_spelling', { a, b }))
    } else if (match === 'mismatch') {
      const { id, a, b } = p('name_mismatch')
      issues.push(issue(id, 'blocker', 'name_mismatch', { a, b }))
    }
  }
}

/** Compares as much of the date as both sides have: a year-only date only has to agree on the year. */
function sameDate(a: ParsedDate, b: ParsedDate): boolean {
  if (a.year !== b.year) return false
  if (isFull(a) && isFull(b)) return a.month === b.month && a.day === b.day
  return true
}

/** Returns false when two confirmed documents give different dates of birth. */
function dobChecks(docs: CartDoc[], issues: Issue[], notes: ReportNote[]): boolean {
  const dated: { type: DocType; date: ParsedDate }[] = []
  for (const d of docs) {
    if (!d.fields.dob) continue
    const date = parseDate(d.fields.dob)
    if (date) dated.push({ type: d.type, date })
    else notes.push({ key: 'cart.notes.dobNotCompared', params: { doc: d.type } })
  }
  let consistent = true
  for (const [x, y] of pairs(dated)) {
    if (sameDate(x.date, y.date)) continue
    consistent = false
    const { id, a, b } = pairId('dob_mismatch', x.type, y.type)
    issues.push(issue(id, 'blocker', 'dob_mismatch', { a, b }))
  }
  return consistent
}

function bestDob(docs: CartDoc[]): ParsedDate | null {
  let yearOnly: ParsedDate | null = null
  for (const type of DOB_PRIORITY) {
    const date = parseDate(docs.find((d) => d.type === type)?.fields.dob)
    if (date && isFull(date)) return date
    if (date && !yearOnly) yearOnly = date
  }
  return yearOnly
}

function ageChecks(docs: CartDoc[], appType: ApplicationType, today: Date, issues: Issue[], notes: ReportNote[]) {
  const dob = bestDob(docs)
  if (!dob) {
    notes.push({ key: 'cart.notes.ageUnknown' })
    return
  }
  const thisYear = todayParts(today).year
  // With a full date the age is exact; with only a year it is one of two values.
  const maxAge = isFull(dob) ? ageOn(dob, today) : thisYear - dob.year
  const minAge = isFull(dob) ? maxAge : maxAge - 1
  if (maxAge < ADULT_AGE && appType !== 'minor') {
    issues.push(issue('minor_flow_required', 'warning', 'minor_flow_required', undefined, RULES.minorFlow))
  } else if (minAge >= ADULT_AGE && appType === 'minor') {
    notes.push({ key: 'cart.notes.minorButAdult' })
  } else if (minAge < ADULT_AGE && maxAge >= ADULT_AGE) {
    notes.push({ key: 'cart.notes.ageUnknown' })
  }
}

function dobProofChecks(docs: CartDoc[], appType: ApplicationType, issues: Issue[], notes: ReportNote[]) {
  if (appType === 'reissue') {
    notes.push({ key: 'cart.notes.reissueDobProof' })
    return
  }
  const has = (t: DocType) => docs.some((d) => d.type === t)
  const dob = bestDob(docs)
  const bornFromCutoff =
    !!dob &&
    (isFull(dob)
      ? compareFull(dob, BIRTH_CERT_ONLY_FROM) >= 0
      : dob.year > BIRTH_CERT_ONLY_FROM.year)
  if (bornFromCutoff && !has('birth')) {
    issues.push(issue('dob_proof_missing', 'warning', 'dob_proof_birth_only', undefined, RULES.dobProofBirthCertOnly))
  } else if (!has('birth') && !has('marksheet')) {
    issues.push(issue('dob_proof_missing', 'warning', 'dob_proof_missing', undefined, RULES.dobProof))
  }
}

function completenessChecks(docs: CartDoc[], appType: ApplicationType, issues: Issue[], notes: ReportNote[]) {
  const has = (t: DocType) => docs.some((d) => d.type === t)
  if (appType === 'reissue') {
    if (!has('passport')) {
      issues.push(issue('missing_document:passport', 'warning', 'missing_passport', undefined, RULES.oldPassport))
    }
    notes.push({ key: 'cart.notes.reissueAddress' })
  } else {
    if (!has('address')) {
      issues.push(issue('missing_document:address', 'warning', 'missing_address', undefined, RULES.addressProof))
    }
    if (appType === 'minor') notes.push({ key: 'cart.notes.minorExtras' })
  }
}

function passportChecks(docs: CartDoc[], today: Date, issues: Issue[], notes: ReportNote[]) {
  const passport = docs.find((d) => d.type === 'passport')
  if (!passport?.fields.expiry) return
  const expiry = parseDate(passport.fields.expiry)
  if (!expiry || !isFull(expiry)) {
    notes.push({ key: 'cart.notes.expiryNotCompared' })
    return
  }
  if (compareFull(expiry, todayParts(today)) < 0) issues.push(issue('passport_expired', 'info', 'passport_expired'))
}

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
const pin = (s: string) => /(?<!\d)\d{6}(?!\d)/.exec(s)?.[0]

/** Share of the shorter address's words that also appear (allowing one typo in longer words) in the other. */
export function addressOverlap(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (small.length === 0) return 0
  const hit = small.filter((w) => large.some((v) => v === w || (w.length >= 5 && distance(w, v) <= 1)))
  return hit.length / small.length
}

const ADDRESS_MATCH_MIN = 0.6

function addressChecks(docs: CartDoc[], issues: Issue[]) {
  for (const [x, y] of pairs(docs.filter((d) => d.fields.address))) {
    const [pa, pb] = [pin(x.fields.address!), pin(y.fields.address!)]
    const differs = (pa && pb && pa !== pb) || addressOverlap(x.fields.address!, y.fields.address!) < ADDRESS_MATCH_MIN
    if (!differs) continue
    const { id, a, b } = pairId('address_mismatch', x.type, y.type)
    issues.push(issue(id, 'warning', 'address_mismatch', { a, b }))
  }
}

function parentChecks(docs: CartDoc[], issues: Issue[]) {
  for (const field of ['fatherName', 'motherName'] as const) {
    for (const [x, y] of pairs(docs.filter((d) => d.fields[field]))) {
      const { match } = compareNames(x.fields[field]!, y.fields[field]!)
      if (match !== 'mismatch' && match !== 'fuzzy') continue
      const { id, a, b } = pairId('parent_name_mismatch', x.type, y.type)
      issues.push(issue(id, 'warning', 'parent_name_mismatch', { a, b }))
    }
  }
}

// ---------------------------------------------------------------- entry points

/**
 * Runs every check on the CONFIRMED documents only: a document still under review is ignored here as well as
 * in the UI, so OCR guesses can never reach a verdict. `today` is injectable for tests.
 */
export function runChecks(docs: CartDoc[], appType: ApplicationType, today: Date = new Date()): CartReport {
  const confirmed = docs.filter((d) => d.status === 'confirmed')
  const issues: Issue[] = []
  const notes: ReportNote[] = []

  nameChecks(confirmed, issues, notes)
  const datesAgree = dobChecks(confirmed, issues, notes)
  if (datesAgree) {
    ageChecks(confirmed, appType, today, issues, notes)
    dobProofChecks(confirmed, appType, issues, notes)
  } else {
    notes.push({ key: 'cart.notes.ageUnknown' })
  }
  completenessChecks(confirmed, appType, issues, notes)
  passportChecks(confirmed, today, issues, notes)
  addressChecks(confirmed, issues)
  parentChecks(confirmed, issues)
  if (confirmed.length < 2) notes.push({ key: 'cart.notes.singleDoc' })
  notes.push({ key: 'cart.notes.otherRequirements' })

  const unique = [...new Map(issues.map((i) => [i.id, i])).values()]
  return { verdict: verdictFor(unique), issues: unique, notes }
}

export function verdictFor(issues: Issue[]): Verdict {
  if (issues.some((i) => i.severity === 'blocker')) return 'not_ready'
  if (issues.some((i) => i.severity === 'warning')) return 'almost_ready'
  return 'ready'
}

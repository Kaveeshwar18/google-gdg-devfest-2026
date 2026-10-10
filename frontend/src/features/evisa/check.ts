// M6 e-Visa pre-check for foreign nationals visiting India (plan 4.2). Deterministic, offline, no data leaves the page.
// Inputs come from backend/data/reference/evisa_rules.json via lib/reference.ts (Lane D keeps that file).
// The rules come from Indian mission pages, not the official portal itself, and the apply window differs between
// pages: that check is marked provisional and every result tells the user to confirm on the official portal.
import { evisaRules } from '../../lib/reference'
import { verdictFor } from '../cart/checks'
import type { CartReport, Issue, ReportNote, Severity } from '../cart/types'

export const OFFICIAL_PORTAL = 'https://indianvisaonline.gov.in'

export type PassportKind = 'ordinary' | 'diplomatic_official' | 'travel_document' | 'endorsed'
export const PASSPORT_KINDS: readonly PassportKind[] = ['ordinary', 'diplomatic_official', 'travel_document', 'endorsed']

export interface EvisaInput {
  passportKind: PassportKind
  /** yyyy-mm-dd, as an <input type="date"> gives it. */
  passportExpiry: string
  blankPages: number | null
  /** yyyy-mm-dd */
  arrival: string
  /** e-Visas already used in the arrival's calendar year. null: not answered. */
  evisasThisYear: number | null
  pakistaniOrigin: 'yes' | 'no' | 'unsure'
}

export type EvisaRules = typeof evisaRules

const DAY = 86_400_000

/** UTC midnight for a yyyy-mm-dd string, or null when it is not a real date. */
export function parseIso(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null
}

/** Same day `months` later, clamped to the end of a shorter month (31 Aug + 6 months = 28/29 Feb). */
export function addMonths(t: number, months: number): number {
  const d = new Date(t)
  const target = d.getUTCMonth() + months
  const y = d.getUTCFullYear() + Math.floor(target / 12)
  const mo = ((target % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()
  return Date.UTC(y, mo, Math.min(d.getUTCDate(), lastDay))
}

function issue(
  id: string,
  severity: Severity,
  textKey: string,
  params?: Record<string, string>,
  provisional = false,
): Issue {
  return {
    id,
    severity,
    found: `cart.evisa.issues.${textKey}.found`,
    why: `cart.evisa.issues.${textKey}.why`,
    fix: `cart.evisa.issues.${textKey}.fix`,
    ...(params ? { params } : {}),
    ...(provisional ? { provisional: true } : {}),
    sourceUrl: provisional ? OFFICIAL_PORTAL : evisaRules.sources[0],
  }
}

/** Runs every check. Pass `today` in tests. A missing answer is reported as a note, never as a pass. */
export function checkEvisa(input: EvisaInput, today: Date = new Date(), rules: EvisaRules = evisaRules): CartReport {
  const issues: Issue[] = []
  const notes: ReportNote[] = []
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const expiry = parseIso(input.passportExpiry)
  const arrival = parseIso(input.arrival)

  if (input.passportKind !== 'ordinary') issues.push(issue('evisa_ineligible_passport', 'blocker', 'ineligible_passport'))

  if (input.pakistaniOrigin === 'yes') issues.push(issue('evisa_pakistani_origin', 'blocker', 'pakistani_origin'))
  else if (input.pakistaniOrigin === 'unsure') notes.push({ key: 'cart.evisa.notes.originUnsure' })

  if (arrival === null) {
    issues.push(issue('evisa_input_missing:arrival', 'warning', 'input_missing_arrival'))
  } else {
    const days = Math.round((arrival - now) / DAY)
    if (days < rules.apply_min_days_before_arrival) {
      issues.push(issue('evisa_too_late', 'blocker', 'too_late', { days: String(rules.apply_min_days_before_arrival) }))
    } else if (days > rules.apply_max_days_before_arrival) {
      issues.push(
        issue('evisa_too_early', 'warning', 'too_early', { days: String(rules.apply_max_days_before_arrival) }, true),
      )
    }
    if (expiry !== null && expiry < addMonths(arrival, rules.passport_validity_months_from_arrival)) {
      issues.push(
        issue('evisa_passport_validity', 'blocker', 'passport_validity', {
          months: String(rules.passport_validity_months_from_arrival),
        }),
      )
    }
  }
  if (expiry === null) issues.push(issue('evisa_input_missing:expiry', 'warning', 'input_missing_expiry'))

  if (input.blankPages === null) {
    issues.push(issue('evisa_input_missing:blank_pages', 'warning', 'input_missing_blank_pages'))
  } else if (input.blankPages < rules.min_blank_pages) {
    issues.push(issue('evisa_blank_pages', 'blocker', 'blank_pages', { pages: String(rules.min_blank_pages) }))
  }

  if (input.evisasThisYear === null) {
    notes.push({ key: 'cart.evisa.notes.yearlyUnknown' })
  } else if (input.evisasThisYear >= rules.max_evisas_per_calendar_year) {
    issues.push(
      issue('evisa_yearly_limit', 'blocker', 'yearly_limit', { max: String(rules.max_evisas_per_calendar_year) }),
    )
  }

  notes.push(
    { key: 'cart.evisa.notes.windowsVary' },
    { key: 'cart.evisa.notes.onArrival' },
    { key: 'cart.evisa.notes.samePassport' },
    { key: 'cart.evisa.notes.confirmOfficial' },
  )
  return { verdict: verdictFor(issues), issues, notes }
}

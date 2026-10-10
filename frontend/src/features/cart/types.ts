// M1 Document Cart data model (plan section 3.3). Everything here stays on the device.

export const DOC_TYPES = ['aadhaar', 'pan', 'passport', 'marksheet', 'address', 'birth'] as const
export type DocType = (typeof DOC_TYPES)[number]

export type ApplicationType = 'fresh' | 'reissue' | 'minor'
export const APPLICATION_TYPES: readonly ApplicationType[] = ['fresh', 'reissue', 'minor']

export interface ExtractedFields {
  name?: string
  fatherName?: string
  motherName?: string
  dob?: string // as printed; checks.ts parses DD/MM/YYYY, DD-MM-YYYY or year only
  address?: string
  aadhaarLast4?: string // never the full number
  pan?: string
  passportNumber?: string
  expiry?: string
}

/** Which fields the confirm/edit screen shows for each document type, in display order. */
export const DOC_FIELDS: Record<DocType, readonly (keyof ExtractedFields)[]> = {
  aadhaar: ['name', 'dob', 'address', 'aadhaarLast4'],
  pan: ['name', 'fatherName', 'dob', 'pan'],
  passport: ['name', 'dob', 'passportNumber', 'expiry'],
  marksheet: ['name', 'fatherName', 'motherName', 'dob'],
  address: ['name', 'address'],
  birth: ['name', 'fatherName', 'motherName', 'dob'],
}

export type DocStatus = 'empty' | 'reading' | 'review' | 'confirmed' | 'error'

export interface CartDoc {
  type: DocType
  status: DocStatus
  progress: number // 0..1 while reading
  rawText?: string // OCR output, Aadhaar already masked; dropped once the user confirms
  fields: ExtractedFields // user-confirmed once status is 'confirmed'
  detected?: DocType | null // what classify() guessed from the text (null: could not tell)
  noText?: boolean // OCR finished but found nothing usable: the user types the fields in
}

export type Severity = 'blocker' | 'warning' | 'info'

export interface Issue {
  /** Mismatch type sent to the agent as cart_issues, e.g. "name_mismatch:aadhaar_vs_marksheet". Never values. */
  id: string
  severity: Severity
  // The three texts below are i18n keys (cart.issues.*), filled in by the UI with `params`.
  found: string // what we found
  why: string // why it matters ("commonly causes problems", never "will be rejected")
  fix: string // how to fix it
  /** Document types (never values) used to fill the texts, e.g. {a: 'aadhaar', b: 'marksheet'}. */
  params?: Record<string, string>
  /** True when the rule behind this issue is not verified against the official Passport Seva page. */
  provisional?: boolean
  /** Official page to check this against (see rules.ts). */
  sourceUrl?: string
}

/** Something we could not check, or deliberately do not check. i18n key plus document types as params. */
export interface ReportNote {
  key: string
  params?: Record<string, string>
}

export type Verdict = 'not_ready' | 'almost_ready' | 'ready'

export interface CartReport {
  verdict: Verdict
  issues: Issue[]
  notes: ReportNote[]
}

import { create } from 'zustand'
import { registerReset } from '../../store/reset'
import { runChecks } from './checks'
import { formatDate, parseDate } from './dates'
import { classify, extractFields, maskAadhaar } from './extract'
import {
  DOC_FIELDS,
  DOC_TYPES,
  type ApplicationType,
  type CartDoc,
  type CartReport,
  type DocType,
  type ExtractedFields,
} from './types'

const emptyDoc = (type: DocType): CartDoc => ({ type, status: 'empty', progress: 0, fields: {} })
const emptyDocs = () => Object.fromEntries(DOC_TYPES.map((t) => [t, emptyDoc(t)])) as Record<DocType, CartDoc>

const MIN_USEFUL_TEXT = 15 // characters of OCR output below which we treat the photo as unreadable
const MAX_FIELD = 200
const DATE_FIELDS = ['dob', 'expiry'] as const

/**
 * What the user typed, made safe to store: trimmed, capped, only the fields this document type has,
 * Aadhaar reduced to its last four digits, dates normalised (an unparseable date is dropped, not kept).
 */
export function sanitizeFields(type: DocType, input: ExtractedFields): ExtractedFields {
  const out: ExtractedFields = {}
  for (const key of DOC_FIELDS[type]) {
    const raw = input[key]?.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD)
    if (!raw) continue
    if (key === 'aadhaarLast4') {
      const digits = raw.replace(/\D/g, '')
      if (digits.length >= 4) out.aadhaarLast4 = digits.slice(-4)
    } else if ((DATE_FIELDS as readonly string[]).includes(key)) {
      const parsed = parseDate(raw)
      if (parsed) out[key] = formatDate(parsed)
    } else if (key === 'pan' || key === 'passportNumber') {
      out[key] = raw.toUpperCase().replace(/\s/g, '')
    } else {
      out[key] = maskAadhaar(raw)
    }
  }
  return out
}

interface CartState {
  appType: ApplicationType
  docs: Record<DocType, CartDoc>
  /** Result of the last check. Cleared whenever anything it depended on changes. */
  report: CartReport | null

  setAppType: (t: ApplicationType) => void
  update: (type: DocType, patch: Partial<CartDoc>) => void
  startReading: (type: DocType) => void
  /** OCR finished: mask, classify and extract. The document goes to review, never straight to confirmed. */
  finishReading: (type: DocType, ocrText: string) => void
  failReading: (type: DocType) => void
  /** Skip OCR: open the confirm/edit screen with empty fields. */
  startManual: (type: DocType) => void
  /** The user says the document is really `to`: re-extract from the masked text (if any). Only into an empty tile. */
  moveDoc: (from: DocType, to: DocType) => boolean
  confirm: (type: DocType, fields: ExtractedFields) => void
  /** Reopen a confirmed document for editing. Its old report is discarded. */
  edit: (type: DocType) => void
  remove: (type: DocType) => void
  /** Runs the checks. Refuses (null) while any document is unconfirmed or none is confirmed. */
  check: () => CartReport | null
}

// In memory only: document data is never persisted (plan section 6).
export const useCart = create<CartState>((set, get) => {
  const patchDoc = (type: DocType, patch: Partial<CartDoc>) =>
    set((s) => ({ docs: { ...s.docs, [type]: { ...s.docs[type], ...patch } }, report: null }))

  return {
    appType: 'fresh',
    docs: emptyDocs(),
    report: null,

    setAppType: (appType) => set({ appType, report: null }),
    update: patchDoc,
    startReading: (type) => patchDoc(type, { ...emptyDoc(type), status: 'reading' }),

    finishReading: (type, ocrText) => {
      const rawText = maskAadhaar(ocrText)
      const unreadable = rawText.replace(/\s/g, '').length < MIN_USEFUL_TEXT
      patchDoc(type, {
        status: 'review',
        progress: 1,
        rawText: unreadable ? undefined : rawText,
        noText: unreadable,
        detected: unreadable ? null : classify(rawText),
        fields: unreadable ? {} : extractFields(type, rawText),
      })
    },

    failReading: (type) => patchDoc(type, { status: 'error', progress: 0 }),

    startManual: (type) => patchDoc(type, { ...emptyDoc(type), status: 'review', noText: true, detected: null }),

    moveDoc: (from, to) => {
      const src = get().docs[from]
      if (from === to || get().docs[to].status !== 'empty') return false
      set((s) => ({
        docs: {
          ...s.docs,
          [from]: emptyDoc(from),
          [to]: { ...src, type: to, detected: to, fields: src.rawText ? extractFields(to, src.rawText) : {} },
        },
        report: null,
      }))
      return true
    },

    confirm: (type, fields) =>
      // The raw text is dropped here: only the fields the user checked are kept from now on.
      patchDoc(type, { status: 'confirmed', fields: sanitizeFields(type, fields), rawText: undefined, noText: false }),

    edit: (type) => patchDoc(type, { status: 'review' }),
    remove: (type) => patchDoc(type, emptyDoc(type)),

    check: () => {
      const { docs, appType } = get()
      const all = DOC_TYPES.map((t) => docs[t])
      const busy = all.some((d) => d.status === 'reading' || d.status === 'review')
      const confirmed = all.filter((d) => d.status === 'confirmed')
      if (busy || confirmed.length === 0) return null
      const report = runChecks(confirmed, appType)
      set({ report })
      return report
    },
  }
})

registerReset(() => useCart.setState({ appType: 'fresh', docs: emptyDocs(), report: null }))

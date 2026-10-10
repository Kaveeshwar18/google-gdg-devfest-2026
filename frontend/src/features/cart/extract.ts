// Turn OCR text into fields per document type (plan 3.3 "Extractors").
// Pure functions, no I/O, no logging. Anything we cannot read stays undefined for the user to fill in.
import type { DocType, ExtractedFields } from './types'

// Separators are same-line only (space, tab, hyphen). A newline must never join digits: "DOB 26/01/1990\n1234 5678 9012"
// would otherwise match "1990\n1234 5678", corrupt the year and leave the end of the real number readable.
const AADHAAR = /(?<!\d)\d{4}[ \t\u00a0-]?\d{4}[ \t\u00a0-]?(\d{4})(?!\d)/g
// 16-digit Aadhaar Virtual ID: also sensitive, so it is reduced to its last 4 digits too.
const VID = /(?<!\d)\d{4}(?:[ \t\u00a0-]?\d{4}){2}[ \t\u00a0-]?(\d{4})(?!\d)/g
const AADHAAR_MASKED = /X{4}[\s-]?X{4}[\s-]?(\d{4})/i
const PAN = /(?<![A-Z0-9])[A-Z]{5}[0-9]{4}[A-Z](?![A-Z0-9])/

/** Never cut: run on raw OCR text before it is stored or shown. Keeps only the last 4 digits. */
export function maskAadhaar(text: string): string {
  return text.replace(VID, 'XXXX XXXX XXXX $1').replace(AADHAAR, 'XXXX XXXX $1')
}

// ---------------------------------------------------------------- shared helpers

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number | string) => String(n).padStart(2, '0')

function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Build a line-start label matcher. Allows a bilingual prefix such as "नाम / Name". */
function label(src: string): RegExp {
  return new RegExp(`^\\s*(?:\\S{1,20}\\s*/\\s*)?(?:${src})`, 'iu')
}

const FATHER = label(`father['’\`]?s?\\s*name|name\\s+of\\s+(?:the\\s+)?father|father`)
const MOTHER = label(`mother['’\`]?s?\\s*name|name\\s+of\\s+(?:the\\s+)?mother|mother`)
const DOB_LABEL = label(`date\\s+of\\s+birth|d\\.?o\\.?b\\.?|year\\s+of\\s+birth|birth\\s+date`)
const STOP_WORDS = /\b(name|father|mother|date\s+of\s+birth|dob|signature|address)\b/i

/** Value after a label: same line after ":" or "-", otherwise the next line. */
function lineValue(lines: string[], re: RegExp): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i])
    if (!m) continue
    const rest = lines[i].slice(m[0].length).replace(/^[\s:.\-–]+/, '')
    if (rest) return rest
    const next = lines[i + 1]
    if (next && !STOP_WORDS.test(next)) return next
  }
  return undefined
}

function cleanName(raw?: string): string | undefined {
  if (!raw) return undefined
  const s = raw
    .replace(/[^\p{L}\s.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length >= 2 ? s : undefined
}

/** Find a date in `s`. Numeric DD/MM/YYYY (also - and .), "26 Jan 1989", or a bare 4-digit year. */
function parseDateText(s: string | undefined, allowYearOnly = false): string | undefined {
  if (!s) return undefined
  const num = /(?<!\d)(\d{1,2})[/\-.](\d{1,2})[/\-.]((?:19|20)\d{2})(?!\d)/.exec(s)
  if (num) return `${pad(num[1])}/${pad(num[2])}/${num[3]}`
  const txt = /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+((?:19|20)\d{2})(?!\d)/.exec(s)
  if (txt) {
    const mi = MONTHS.indexOf(txt[2].slice(0, 3).toLowerCase())
    if (mi >= 0) return `${pad(txt[1])}/${pad(mi + 1)}/${txt[3]}`
  }
  if (allowYearOnly) {
    const y = /(?<!\d)((?:19|20)\d{2})(?!\d)/.exec(s)
    if (y) return y[1]
  }
  return undefined
}

/** DOB from the labelled line (or the line after it). No fallback to "any date": that would invent a value. */
function findDob(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (!DOB_LABEL.test(lines[i])) continue
    const yearOnly = /year\s+of\s+birth/i.test(lines[i])
    const found = parseDateText(lines[i], yearOnly) ?? parseDateText(lines[i + 1], yearOnly)
    if (found) return found
  }
  return undefined
}

/** Address block: from the label to the line holding a 6-digit PIN (inclusive), at most 5 lines. */
function findAddress(lines: string[], labelRe: RegExp): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const m = labelRe.exec(lines[i])
    if (!m) continue
    const first = lines[i].slice(m[0].length).replace(/^[\s:.\-–]+/, '')
    const block = first ? [first] : []
    for (let j = i + 1; j < lines.length && block.length < 5; j++) {
      if (block.length && /\d{6}/.test(block[block.length - 1])) break
      block.push(lines[j])
    }
    const out = block.join(', ').replace(/\s+/g, ' ').trim()
    if (out.length >= 6) return out
  }
  return undefined
}

function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

// ---------------------------------------------------------------- passport MRZ

const MRZ_LINE2 = /([A-Z0-9<]{9})[0-9<][A-Z<]{3}([0-9OI]{6})[0-9OI<][MF<]([0-9OI]{6})/

const digitsOf = (s: string) => s.replace(/O/g, '0').replace(/I/g, '1')

function normaliseMrz(text: string): string[] {
  return toLines(text)
    .map((l) => l.replace(/[«‹]/g, '<').replace(/\s+/g, '').toUpperCase())
    .filter((l) => l.includes('<') && l.length >= 25)
}

function mrzDate(yymmdd: string, kind: 'dob' | 'expiry'): string | undefined {
  const d = digitsOf(yymmdd)
  const yy = Number(d.slice(0, 2))
  const mm = Number(d.slice(2, 4))
  const dd = Number(d.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined
  const nowYY = new Date().getFullYear() % 100
  const year = kind === 'expiry' ? 2000 + yy : yy <= nowYY ? 2000 + yy : 1900 + yy
  return `${pad(dd)}/${pad(mm)}/${year}`
}

function parseMrz(text: string): ExtractedFields {
  const lines = normaliseMrz(text)
  const out: ExtractedFields = {}
  const l1 = lines.find((l) => /^P[<A-Z]IND/.test(l))
  if (l1) {
    const names = l1.slice(5).split('<<')
    const surname = names[0]?.replace(/</g, ' ').trim()
    const given = names.slice(1).join(' ').replace(/</g, ' ').replace(/\s+/g, ' ').trim()
    out.name = cleanName([given, surname].filter(Boolean).join(' '))
  }
  for (const l of lines) {
    const m = MRZ_LINE2.exec(l)
    if (!m) continue
    out.passportNumber = m[1].replace(/</g, '') || undefined
    out.dob = mrzDate(m[2], 'dob')
    out.expiry = mrzDate(m[3], 'expiry')
    break
  }
  return out
}

// ---------------------------------------------------------------- classify

const KEYWORDS: Record<DocType, RegExp[]> = {
  aadhaar: [/aadhaar|aadhar|uidai|unique\s+identification|आधार/i, /government\s+of\s+india/i],
  pan: [/income\s*tax\s+department|permanent\s+account\s+number/i],
  passport: [/\bpassport\b/i, /republic\s+of\s+india/i],
  marksheet: [
    /name\s+of\s+(?:the\s+)?candidate|candidate['’]?s?\s+name/i,
    /secondary\s+school|senior\s+school|board\s+of|\bcbse\b|\bicse\b|\bssc\b/i,
    /marks?\s*(?:sheet|memo)|statement\s+of\s+marks|roll\s*(?:no|number)/i,
  ],
  birth: [
    /certificate\s+of\s+birth|birth\s+certificate/i,
    /registrar\s+of\s+(?:births|birth)|births?\s+and\s+deaths?/i,
    /place\s+of\s+birth|date\s+of\s+registration/i,
  ],
  address: [
    /rent(?:al)?\s+agreement|lease\s+(?:deed|agreement)/i,
    /\btenant\b|\blandlord\b|\blessor\b|\blessee\b/i,
    /electricity|consumer\s+(?:no|number|name)|billing\s+address|bill\s+date|water\s+bill|gas\s+bill/i,
  ],
}

function score(type: DocType, text: string): number {
  let s = KEYWORDS[type].filter((re) => re.test(text)).length
  if (type === 'pan' && PAN.test(text)) s += 2
  if (type === 'aadhaar' && (AADHAAR_MASKED.test(text) || new RegExp(AADHAAR.source).test(text))) s += 2
  if (type === 'passport' && normaliseMrz(text).some((l) => /^P[<A-Z]IND/.test(l))) s += 3
  return s
}

/**
 * Guess the document type from OCR text. Returns null when nothing scores at least 2 or the top two
 * types tie: the confirm screen then asks the user instead of us guessing.
 */
export function classify(text: string): DocType | null {
  const ranked = (Object.keys(KEYWORDS) as DocType[])
    .map((type) => ({ type, s: score(type, text) }))
    .sort((a, b) => b.s - a.s)
  if (ranked[0].s < 2 || ranked[0].s === ranked[1].s) return null
  return ranked[0].type
}

// ---------------------------------------------------------------- extractFields

const NAME_LABEL = label(`name`)
const CHILD_NAME = label(
  `name\\s+of\\s+(?:the\\s+)?(?:child|baby)|child['’\`]?s?\\s+name|name(?!\\s+of\\s+(?:the\\s+)?(?:father|mother))`,
)
const CANDIDATE_NAME = label(`name\\s+of\\s+(?:the\\s+)?(?:candidate|student)|candidate['’\`]?s?\\s+name|student['’\`]?s?\\s+name`)
const HOLDER_NAME = label(
  `tenant['’\`]?s?\\s+name|tenant(?=\\s*[:\\-])|consumer\\s+name|name\\s+of\\s+(?:the\\s+)?consumer|customer\\s+name|name(?=\\s*[:\\-])`,
)

/** Aadhaar prints the name on the line above the DOB / year of birth line. */
function aadhaarName(lines: string[]): string | undefined {
  const i = lines.findIndex((l) => DOB_LABEL.test(l))
  for (let k = i - 1; i > 0 && k >= Math.max(0, i - 2); k--) {
    if (/government|india|uidai|aadhaar|enrol|\bto\b|\d/i.test(lines[k])) continue
    const n = cleanName(lines[k])
    if (n && n.length >= 3) return n
  }
  return undefined
}

/**
 * Per-type field extraction from OCR text. The Aadhaar number is masked again here, so only
 * `aadhaarLast4` can ever come out, whatever the caller passed in. Unknown fields stay undefined.
 */
export function extractFields(type: DocType, rawText: string): ExtractedFields {
  const text = maskAadhaar(rawText)
  const lines = toLines(text)

  switch (type) {
    case 'pan':
      return compact({
        pan: PAN.exec(text)?.[0],
        name: cleanName(lineValue(lines, NAME_LABEL)),
        fatherName: cleanName(lineValue(lines, FATHER)),
        dob: findDob(lines),
      })
    case 'aadhaar':
      return compact({
        aadhaarLast4: AADHAAR_MASKED.exec(text)?.[1],
        name: aadhaarName(lines) ?? cleanName(lineValue(lines, NAME_LABEL)),
        dob: findDob(lines),
        address: findAddress(lines, label(`address`)),
      })
    case 'passport':
      return compact(parseMrz(rawText))
    case 'marksheet':
      return compact({
        name: cleanName(lineValue(lines, CANDIDATE_NAME)),
        fatherName: cleanName(lineValue(lines, FATHER)),
        motherName: cleanName(lineValue(lines, MOTHER)),
        dob: findDob(lines),
      })
    case 'birth':
      return compact({
        name: cleanName(lineValue(lines, CHILD_NAME)),
        fatherName: cleanName(lineValue(lines, FATHER)),
        motherName: cleanName(lineValue(lines, MOTHER)),
        dob: findDob(lines),
      })
    case 'address':
      return compact({
        name: cleanName(lineValue(lines, HOLDER_NAME)),
        address: findAddress(lines, label(`(?:service\\s+|billing\\s+|premises\\s+|property\\s+|tenant\\s+)?address`)),
      })
  }
}

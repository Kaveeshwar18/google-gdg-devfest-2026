// Date parsing for the cart. Accepts DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY or a bare year; anything else is null.

export interface ParsedDate {
  year: number
  month?: number
  day?: number
}

export function parseDate(input: string | undefined): ParsedDate | null {
  const s = input?.trim()
  if (!s) return null
  if (/^(19|20)\d{2}$/.test(s)) return { year: Number(s) }
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s)
  if (!m) return null
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (year < 1900 || year > 2100) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return { year, month, day }
}

export function formatDate(p: ParsedDate): string {
  if (p.month === undefined || p.day === undefined) return String(p.year)
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`
}

/** -1, 0, 1 for a before / same as / after b, comparing full dates only. */
export function compareFull(a: Required<ParsedDate>, b: Required<ParsedDate>): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

export function isFull(p: ParsedDate): p is Required<ParsedDate> {
  return p.month !== undefined && p.day !== undefined
}

export function todayParts(today: Date): Required<ParsedDate> {
  return { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() }
}

/** Whole years between a full birth date and `today`. */
export function ageOn(dob: Required<ParsedDate>, today: Date): number {
  const t = todayParts(today)
  let age = t.year - dob.year
  if (t.month < dob.month || (t.month === dob.month && t.day < dob.day)) age -= 1
  return age
}

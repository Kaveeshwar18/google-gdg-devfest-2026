import { describe, expect, it } from 'vitest'
import { ageOn, formatDate, parseDate } from './dates'

describe('parseDate', () => {
  it('reads DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY and a bare year', () => {
    expect(parseDate('26/01/1990')).toEqual({ year: 1990, month: 1, day: 26 })
    expect(parseDate('26-01-1990')).toEqual({ year: 1990, month: 1, day: 26 })
    expect(parseDate('5.1.1990')).toEqual({ year: 1990, month: 1, day: 5 })
    expect(parseDate('1990')).toEqual({ year: 1990 })
  })
  it('rejects impossible or unreadable dates instead of guessing', () => {
    for (const bad of ['31/02/1990', '32/01/1990', '00/01/1990', '1990/01/26', 'abc', '', '19', undefined])
      expect(parseDate(bad), String(bad)).toBeNull()
  })
  it('normalises for display', () => {
    expect(formatDate(parseDate('5-1-1990')!)).toBe('05/01/1990')
    expect(formatDate(parseDate('1990')!)).toBe('1990')
  })
})

describe('ageOn', () => {
  it('counts whole years, before and after the birthday', () => {
    const dob = { year: 2008, month: 10, day: 11 }
    expect(ageOn(dob, new Date(2026, 9, 10))).toBe(17)
    expect(ageOn(dob, new Date(2026, 9, 11))).toBe(18)
  })
})

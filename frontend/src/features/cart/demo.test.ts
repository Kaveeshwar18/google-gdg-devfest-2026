// Journey A from TEAM.md, end to end in code, using the text printed on the three demo images in demo/.
// (This uses the printed text, not real OCR output: Tesseract is not run in tests.)
import { describe, expect, it } from 'vitest'
import { runChecks } from './checks'
import { classify, extractFields, maskAadhaar } from './extract'
import { buildHandoff } from './handoff'
import { useCart } from './store'
import { tEn } from './testkit'
import type { DocType } from './types'

const AADHAAR = `SAMPLE - DUMMY DATA
Government of India
Asha Kumari Sharma
DOB: 26/01/1990
FEMALE
1234 5678 9012
Address: 12 Test Street, Sample Nagar,
Chennai - 600001
Not a real document - for Passport Mitra demo only`

const PAN = `SAMPLE - DUMMY DATA
INCOME TAX DEPARTMENT
GOVT. OF INDIA
Permanent Account Number
ABCDE1234F
Name
ASHA KUMARI SHARMA
Father's Name
RAMESH SHARMA
Date of Birth
26/01/1990
Not a real document - for Passport Mitra demo only`

const MARKSHEET = `SAMPLE - DUMMY DATA
CENTRAL BOARD OF SECONDARY EDUCATION
Secondary School Examination
Roll No: 1234567
Name of Candidate : RADHA SHARMA
Mother's Name : GITA SHARMA
Father's Name : RAMESH SHARMA
Date of Birth : 26-01-1990
Not a real document - for Passport Mitra demo only`

describe('demo documents', () => {
  it('are recognised as what they are', () => {
    expect(classify(maskAadhaar(AADHAAR))).toBe('aadhaar')
    expect(classify(PAN)).toBe('pan')
    expect(classify(MARKSHEET)).toBe('marksheet')
  })

  it('Journey A: three documents, confirmed, give "not ready" with the name mismatch, then a templated handoff', () => {
    const cart = useCart.getState()
    cart.setAppType('fresh')
    const texts: [DocType, string][] = [['aadhaar', AADHAAR], ['pan', PAN], ['marksheet', MARKSHEET]]
    for (const [type, text] of texts) {
      useCart.getState().finishReading(type, text)
      expect(useCart.getState().docs[type].status).toBe('review')
      expect(useCart.getState().check()).toBeNull() // nothing runs before the user confirms
      useCart.getState().confirm(type, useCart.getState().docs[type].fields) // the user accepts what was read
    }
    const report = useCart.getState().check()!
    expect(report.verdict).toBe('not_ready')
    expect(report.issues.map((i) => i.id)).toContain('name_mismatch:aadhaar_vs_marksheet')
    expect(report.issues.map((i) => i.id)).toContain('name_mismatch:pan_vs_marksheet')
    expect(report.issues.map((i) => i.id)).not.toContain('name_mismatch:pan_vs_aadhaar')

    const handoff = buildHandoff(report, tEn)
    expect(handoff.cartIssues).toContain('name_mismatch:aadhaar_vs_marksheet')
    expect(handoff.text).toContain('My name may not match between my Aadhaar card and my Class 10 certificate.')
    for (const secret of ['Asha', 'Radha', 'Sharma', 'Ramesh', '1990', '9012', 'ABCDE1234F', '600001'])
      expect(handoff.text).not.toContain(secret)
  })

  it('a clean set (marksheet name fixed on the confirm screen) is not blocked on names', () => {
    const fields = extractFields('marksheet', MARKSHEET)
    const docs = [
      { type: 'aadhaar' as const, status: 'confirmed' as const, progress: 1, fields: extractFields('aadhaar', AADHAAR) },
      { type: 'pan' as const, status: 'confirmed' as const, progress: 1, fields: extractFields('pan', PAN) },
      { type: 'marksheet' as const, status: 'confirmed' as const, progress: 1, fields: { ...fields, name: 'Asha Kumari Sharma' } },
    ]
    const report = runChecks(docs, 'fresh', new Date(2026, 9, 10))
    expect(report.issues.filter((i) => i.severity === 'blocker')).toEqual([])
  })
})

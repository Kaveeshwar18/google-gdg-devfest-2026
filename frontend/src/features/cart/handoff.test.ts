import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from '../../store/app'
import { runChecks } from './checks'
import { buildHandoff, isAllowedIssueId } from './handoff'
import { ADDRESS, TODAY, doc, tEn } from './testkit'
import type { CartReport, Issue } from './types'

const issue = (id: string, params?: Record<string, string>): Issue => ({
  id,
  severity: 'blocker',
  found: '',
  why: '',
  fix: '',
  params,
})
const report = (...issues: Issue[]): CartReport => ({ verdict: 'not_ready', issues, notes: [] })

describe('isAllowedIssueId', () => {
  it('accepts exactly the shared cart_issues vocabulary', () => {
    for (const id of [
      'name_mismatch:aadhaar_vs_marksheet',
      'name_order:pan_vs_aadhaar',
      'name_initials:pan_vs_marksheet',
      'dob_mismatch:aadhaar_vs_birth',
      'dob_proof_missing',
      'address_mismatch:address_vs_aadhaar',
      'parent_name_mismatch:marksheet_vs_birth',
      'passport_expired',
      'minor_flow_required',
      'missing_document:birth',
    ])
      expect(isAllowedIssueId(id), id).toBe(true)
  })
  it('rejects anything else, including ids that smuggle in values', () => {
    for (const id of ['name_mismatch:Asha_vs_Sharma', 'new_issue', 'missing_document:visa', 'dob_mismatch:aadhaar_vs_birth 1990', ''])
      expect(isAllowedIssueId(id), id).toBe(false)
  })
})

describe('buildHandoff', () => {
  it('builds templated text and cart_issues from a report', () => {
    const h = buildHandoff(report(issue('name_mismatch:aadhaar_vs_marksheet', { a: 'aadhaar', b: 'marksheet' })), tEn)
    expect(h.cartIssues).toEqual(['name_mismatch:aadhaar_vs_marksheet'])
    expect(h.text).toBe(
      'My documents may have some problems. My name may not match between my Aadhaar card and my Class 10 certificate.',
    )
    expect(Object.keys(h).sort()).toEqual(['cartIssues', 'text']) // the existing handoff contract, nothing more
  })

  it('falls back to a general question when there is nothing specific', () => {
    expect(buildHandoff(null, tEn)).toEqual({
      text: 'I need help understanding which documents apply to my application.',
      cartIssues: [],
    })
  })

  it('drops ids that are not in the vocabulary', () => {
    const h = buildHandoff(report(issue('name_mismatch:Asha_vs_Sharma'), issue('passport_expired')), tEn)
    expect(h.cartIssues).toEqual(['passport_expired'])
  })

  it('names missing documents by kind', () => {
    const h = buildHandoff(report(issue('missing_document:address')), tEn)
    expect(h.text).toContain('I may be missing my Rent agreement or utility bill.')
  })

  it('contains no document values, even when the documents are full of them', () => {
    const docs = [
      doc('aadhaar', { name: 'Asha Sharma', dob: '26/01/1990', address: ADDRESS, aadhaarLast4: '9012' }),
      doc('marksheet', { name: 'Rahul Verma', dob: '27/01/1990', fatherName: 'Suresh Verma' }),
      doc('birth', { name: 'Sharma Asha', dob: '27/01/1990', fatherName: 'Ramesh Sharma' }),
      doc('pan', { name: 'A Sharma', pan: 'ABCDE1234F' }),
      doc('address', { name: 'Asha Sharma', address: '99 Other Road, Mumbai 400001' }),
    ]
    const h = buildHandoff(runChecks(docs, 'fresh', TODAY), tEn)
    expect(h.cartIssues.length).toBeGreaterThan(3)
    h.cartIssues.forEach((id) => expect(isAllowedIssueId(id)).toBe(true))
    const everything = `${h.text} ${h.cartIssues.join(' ')}`
    for (const secret of ['Asha', 'Rahul', 'Verma', 'Ramesh', 'Suresh', '1990', '9012', '600001', '400001', 'ABCDE1234F', 'Other Road'])
      expect(everything, secret).not.toContain(secret)
    expect(everything).not.toMatch(/\d{4}/)
  })
})

describe('Fix with Mitra uses the existing handoff contract', () => {
  beforeEach(() => useApp.setState({ handoff: null, consented: false }))

  it('stores {text, cartIssues} in the app store and does not touch consent', () => {
    const h = buildHandoff(report(issue('dob_proof_missing')), tEn)
    useApp.getState().setHandoff(h)
    expect(useApp.getState().handoff).toEqual(h)
    expect(useApp.getState().consented).toBe(false)
  })
})

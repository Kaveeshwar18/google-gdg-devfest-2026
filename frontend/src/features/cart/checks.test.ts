import { describe, expect, it } from 'vitest'
import { addressOverlap, compareNames, runChecks, verdictFor } from './checks'
import { isAllowedIssueId } from './handoff'
import { RULES } from './rules'
import en from '../../i18n/en/cart.json'
import { ADDRESS, TODAY, cleanDocs, doc, tEn } from './testkit'
import type { CartDoc, Issue } from './types'

const ids = (docs: CartDoc[], appType: Parameters<typeof runChecks>[1] = 'fresh') =>
  runChecks(docs, appType, TODAY).issues.map((i) => i.id)

describe('compareNames', () => {
  it('treats case, spacing, punctuation and titles as harmless', () => {
    expect(compareNames('Asha  K. Sharma', 'ASHA K SHARMA').match).toBe('exact')
    expect(compareNames('Smt. Asha Sharma', 'Asha Sharma').match).toBe('exact')
  })
  it('spots reordered names, initials, small spelling differences and real mismatches', () => {
    expect(compareNames('Sharma Asha', 'Asha Sharma').match).toBe('order_differs')
    expect(compareNames('K Ram', 'Kamal Ram').match).toBe('initials')
    expect(compareNames('Ramesh Sharma', 'Ramesh Sharmaa').match).toBe('fuzzy')
    expect(compareNames('Asha Sharma', 'Rahul Verma').match).toBe('mismatch')
  })
  it('does not guess when a name has no English letters', () => {
    expect(compareNames('आशा शर्मा', 'Asha Sharma').match).toBe('unknown')
  })
})

describe('addressOverlap', () => {
  it('is high for the same address written differently and low for different ones', () => {
    expect(addressOverlap(ADDRESS, '12, Test Street Sample Nagar Chennai')).toBeGreaterThanOrEqual(0.9)
    expect(addressOverlap(ADDRESS, '99 Other Road, Elsewhere, Mumbai 400001')).toBeLessThan(0.4)
  })
})

describe('runChecks: readiness states', () => {
  it('READY: consistent confirmed documents give no issues', () => {
    const r = runChecks(cleanDocs(), 'fresh', TODAY)
    expect(r.issues).toEqual([])
    expect(r.verdict).toBe('ready')
  })

  it('ALMOST READY: a name in a different order is a warning', () => {
    const docs = cleanDocs()
    docs[1] = doc('marksheet', { name: 'Sharma Asha', dob: '26/01/1990' })
    const r = runChecks(docs, 'fresh', TODAY)
    const order = r.issues.find((i) => i.id === 'name_order:aadhaar_vs_marksheet')
    expect(order?.severity).toBe('warning')
    expect(r.issues.every((i) => i.severity !== 'blocker')).toBe(true)
    expect(r.verdict).toBe('almost_ready')
  })

  it('NOT READY: a different name on two confirmed documents is a blocker', () => {
    const docs = cleanDocs()
    docs[1] = doc('marksheet', { name: 'Rahul Verma', dob: '26/01/1990' })
    const r = runChecks(docs, 'fresh', TODAY)
    expect(r.issues.find((i) => i.id === 'name_mismatch:aadhaar_vs_marksheet')?.severity).toBe('blocker')
    expect(r.verdict).toBe('not_ready')
  })

  it('maps severities to verdicts', () => {
    const mk = (severity: Issue['severity']): Issue => ({ id: 'x', severity, found: '', why: '', fix: '' })
    expect(verdictFor([])).toBe('ready')
    expect(verdictFor([mk('info')])).toBe('ready')
    expect(verdictFor([mk('info'), mk('warning')])).toBe('almost_ready')
    expect(verdictFor([mk('warning'), mk('blocker')])).toBe('not_ready')
  })
})

describe('runChecks: confirmation is enforced', () => {
  it('ignores documents that are not confirmed', () => {
    const docs = cleanDocs()
    docs[1] = doc('marksheet', { name: 'Rahul Verma', dob: '01/01/2001' }, 'review')
    const r = runChecks(docs, 'fresh', TODAY)
    expect(r.issues.map((i) => i.id)).not.toContain('name_mismatch:aadhaar_vs_marksheet')
    expect(r.issues.map((i) => i.id)).not.toContain('dob_mismatch:aadhaar_vs_marksheet')
  })
})

describe('runChecks: date of birth', () => {
  it('flags different dates of birth as a blocker', () => {
    const docs = [
      doc('aadhaar', { name: 'Asha Sharma', dob: '26/01/1990' }),
      doc('birth', { name: 'Asha Sharma', dob: '27/01/1990' }),
      doc('address', { name: 'Asha Sharma', address: ADDRESS }),
    ]
    const r = runChecks(docs, 'fresh', TODAY)
    expect(r.issues.find((i) => i.id === 'dob_mismatch:aadhaar_vs_birth')?.severity).toBe('blocker')
    expect(r.verdict).toBe('not_ready')
  })
  it('accepts DD-MM-YYYY, a different separator and a year-only Aadhaar as the same date', () => {
    const docs = [
      doc('aadhaar', { name: 'Asha Sharma', dob: '1990' }),
      doc('birth', { name: 'Asha Sharma', dob: '26-01-1990' }),
      doc('marksheet', { name: 'Asha Sharma', dob: '26.01.1990' }),
      doc('address', { name: 'Asha Sharma', address: ADDRESS }),
    ]
    expect(ids(docs).filter((i) => i.startsWith('dob_mismatch'))).toEqual([])
  })
  it('flags a year-only date that disagrees on the year', () => {
    const docs = [doc('aadhaar', { dob: '1991' }), doc('birth', { dob: '26/01/1990' })]
    expect(ids(docs)).toContain('dob_mismatch:aadhaar_vs_birth')
  })
})

describe('runChecks: requirements are provisional', () => {
  it('asks for an address proof on a fresh application, as a warning with its source', () => {
    const docs = cleanDocs().slice(0, 2)
    const issue = runChecks(docs, 'fresh', TODAY).issues.find((i) => i.id === 'missing_document:address')
    expect(issue?.severity).toBe('warning')
    expect(issue?.provisional).toBe(true)
    expect(issue?.sourceUrl).toBe(RULES.addressProof.sourceUrl)
  })
  it('depends on the application type: re-issue wants the old passport, not an address proof', () => {
    const docs = [doc('aadhaar', { name: 'Asha Sharma', dob: '26/01/1990' })]
    const reissue = ids(docs, 'reissue')
    expect(reissue).toContain('missing_document:passport')
    expect(reissue).not.toContain('missing_document:address')
    expect(reissue).not.toContain('dob_proof_missing')
    const fresh = ids(docs, 'fresh')
    expect(fresh).toContain('missing_document:address')
    expect(fresh).not.toContain('missing_document:passport')
  })
  it('does not require Aadhaar or PAN', () => {
    const docs = [
      doc('marksheet', { name: 'Asha Sharma', dob: '26/01/1990' }),
      doc('address', { name: 'Asha Sharma', address: ADDRESS }),
    ]
    const found = ids(docs)
    expect(found).not.toContain('missing_document:aadhaar')
    expect(found).not.toContain('missing_document:pan')
    expect(found).toEqual([])
  })
  it('asks for a DOB proof when neither birth nor school certificate is present', () => {
    const docs = [doc('pan', { name: 'Asha Sharma', dob: '26/01/1990' }), doc('address', { address: ADDRESS })]
    expect(ids(docs)).toContain('dob_proof_missing')
  })
  it('uses the birth-certificate wording for birth dates from 1 Oct 2023, and not before', () => {
    const base = (dob: string) => [doc('marksheet', { dob }), doc('address', { address: ADDRESS })]
    const after = runChecks(base('02/10/2023'), 'minor', TODAY).issues.find((i) => i.id === 'dob_proof_missing')
    expect(after?.found).toBe('cart.issues.dob_proof_birth_only.found')
    expect(ids(base('30/09/2023'), 'minor')).not.toContain('dob_proof_missing')
  })
  it('does NOT enforce the 26 January 1989 cutoff from the plan', () => {
    for (const dob of ['25/01/1989', '26/01/1989', '27/01/1989']) {
      const docs = [doc('marksheet', { name: 'Asha Sharma', dob }), doc('address', { address: ADDRESS })]
      expect(ids(docs)).toEqual([])
    }
  })
  it('never makes a rule-based issue a blocker, and always marks it provisional with a source', () => {
    const scenarios: [CartDoc[], Parameters<typeof runChecks>[1]][] = [
      [[doc('pan', { dob: '01/01/2015' })], 'fresh'],
      [[doc('aadhaar', { dob: '1990' })], 'reissue'],
      [[doc('marksheet', { dob: '15/03/2024' })], 'minor'],
    ]
    const ruleIds = /^(dob_proof_missing|minor_flow_required|missing_document:.*)$/
    for (const [docs, appType] of scenarios) {
      for (const i of runChecks(docs, appType, TODAY).issues.filter((x) => ruleIds.test(x.id))) {
        expect(i.severity).not.toBe('blocker')
        expect(i.provisional).toBe(true)
        expect(i.sourceUrl).toMatch(/^https:\/\/(www\.|services1\.)?passportindia\.gov\.in\//)
      }
    }
  })
})

describe('runChecks: age and application type', () => {
  const child = [doc('birth', { name: 'Anu Sharma', dob: '05/03/2015' }), doc('address', { address: ADDRESS })]
  it('suggests the under-18 process when a minor picks another type', () => {
    expect(ids(child, 'fresh')).toContain('minor_flow_required')
    expect(ids(child, 'minor')).not.toContain('minor_flow_required')
  })
  it('works from a year alone when the age is certain, and says so when it is not', () => {
    expect(ids([doc('aadhaar', { dob: '2020' })], 'fresh')).toContain('minor_flow_required')
    const r = runChecks([doc('aadhaar', { dob: '2008' })], 'fresh', TODAY)
    expect(r.issues.map((i) => i.id)).not.toContain('minor_flow_required')
    expect(r.notes.map((n) => n.key)).toContain('cart.notes.ageUnknown')
  })
  it('notes, without inventing an issue, when "child" is chosen for an adult', () => {
    const r = runChecks([doc('birth', { dob: '26/01/1990' })], 'minor', TODAY)
    expect(r.notes.map((n) => n.key)).toContain('cart.notes.minorButAdult')
  })
})

describe('runChecks: other checks', () => {
  it('reports an expired old passport as info only', () => {
    const docs = [doc('passport', { name: 'Asha Sharma', dob: '26/01/1990', expiry: '01/01/2020' })]
    const r = runChecks(docs, 'reissue', TODAY)
    expect(r.issues.find((i) => i.id === 'passport_expired')?.severity).toBe('info')
    expect(r.verdict).toBe('ready')
    expect(ids([doc('passport', { expiry: '01/01/2030' })], 'reissue')).not.toContain('passport_expired')
  })
  it('flags a different address between address proof and Aadhaar as a warning', () => {
    const docs = cleanDocs()
    docs[2] = doc('address', { name: 'Asha Sharma', address: '99 Other Road, Elsewhere, Mumbai 400001' })
    const issue = runChecks(docs, 'fresh', TODAY).issues.find((i) => i.id === 'address_mismatch:address_vs_aadhaar')
    expect(issue?.severity).toBe('warning')
  })
  it('flags a different parent name as a warning', () => {
    const docs = [
      doc('marksheet', { name: 'Asha Sharma', fatherName: 'Ramesh Sharma' }),
      doc('birth', { name: 'Asha Sharma', fatherName: 'Suresh Verma' }),
      doc('address', { address: ADDRESS }),
    ]
    const issue = runChecks(docs, 'fresh', TODAY).issues.find((i) => i.id === 'parent_name_mismatch:marksheet_vs_birth')
    expect(issue?.severity).toBe('warning')
  })
  it('does not compare what is missing: absent fields produce no mismatch', () => {
    const docs = [doc('aadhaar', {}), doc('marksheet', {}), doc('address', {})]
    const found = ids(docs)
    expect(found.filter((i) => /mismatch|order|initials/.test(i))).toEqual([])
  })
  it('says when there is only one document to look at', () => {
    const r = runChecks([doc('aadhaar', { name: 'Asha Sharma' })], 'fresh', TODAY)
    expect(r.notes.map((n) => n.key)).toContain('cart.notes.singleDoc')
  })
  it('never lists the same issue id twice', () => {
    const docs = [
      doc('marksheet', { fatherName: 'Ramesh Sharma', motherName: 'Gita Sharma' }),
      doc('birth', { fatherName: 'Suresh Verma', motherName: 'Sita Verma' }),
    ]
    const found = ids(docs)
    expect(new Set(found).size).toBe(found.length)
  })
})

describe('runChecks: issue contract', () => {
  const messy = [
    doc('aadhaar', { name: 'Asha Sharma', dob: '26/01/1990', address: ADDRESS, aadhaarLast4: '9012' }),
    doc('pan', { name: 'A Sharma', dob: '26/01/1990', fatherName: 'Ramesh Sharma' }),
    doc('marksheet', { name: 'Rahul Verma', dob: '27/01/1990', fatherName: 'Suresh Verma' }),
    doc('birth', { name: 'Sharma Asha', dob: '27/01/1990', fatherName: 'Ramesh Sharma' }),
    doc('passport', { name: 'Asha Sharma', dob: '26/01/1990', expiry: '01/01/2020' }),
    doc('address', { name: 'Asha Sharma', address: '99 Other Road, Mumbai 400001' }),
  ]

  it('only produces ids from the shared cart_issues vocabulary', () => {
    for (const appType of ['fresh', 'reissue', 'minor'] as const) {
      const found = ids(messy, appType)
      expect(found.length).toBeGreaterThan(5)
      for (const id of found) expect(isAllowedIssueId(id), id).toBe(true)
    }
  })

  it('has an English string for every text key, so no key ever reaches the screen', () => {
    for (const i of runChecks(messy, 'fresh', TODAY).issues) {
      for (const key of [i.found, i.why, i.fix]) expect(() => tEn(key, { a: 'x', b: 'y' })).not.toThrow()
    }
    const r = runChecks([doc('passport', { dob: '2020' }), doc('aadhaar', { dob: '2008' })], 'minor', TODAY)
    for (const n of r.notes) expect(() => tEn(n.key, { doc: 'x' })).not.toThrow()
  })

  it('carries document types only, never values', () => {
    const json = JSON.stringify(runChecks(messy, 'fresh', TODAY))
    for (const secret of ['Asha', 'Sharma', 'Verma', 'Ramesh', '1990', '9012', '600001', 'Other Road'])
      expect(json).not.toContain(secret)
  })

  it('has strings for every report note', () => {
    for (const n of [
      'nameNotCompared', 'dobNotCompared', 'expiryNotCompared', 'ageUnknown', 'minorButAdult',
      'singleDoc', 'reissueDobProof', 'reissueAddress', 'minorExtras', 'otherRequirements',
    ])
      expect(() => tEn(`cart.notes.${n}`, { doc: 'x' })).not.toThrow()
  })

  it('never promises approval or rejection anywhere in the cart strings', () => {
    expect(JSON.stringify(en)).not.toMatch(/will be (rejected|approved|accepted)|definitely|guaranteed to/i)
    expect(tEn('cart.result.disclaimer')).toMatch(/not a guarantee/i)
  })
})

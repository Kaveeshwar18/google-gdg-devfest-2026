import { describe, expect, it } from 'vitest'
import en from '../../i18n/en/cart.json'
import { tEn } from '../cart/testkit'
import { addMonths, checkEvisa, parseIso, type EvisaInput } from './check'

const TODAY = new Date(2026, 9, 10) // 10 Oct 2026

const ok: EvisaInput = {
  passportKind: 'ordinary',
  passportExpiry: '2028-01-01',
  blankPages: 4,
  arrival: '2026-12-01',
  evisasThisYear: 0,
  pakistaniOrigin: 'no',
}
const run = (patch: Partial<EvisaInput> = {}) => checkEvisa({ ...ok, ...patch }, TODAY)
const ids = (patch: Partial<EvisaInput> = {}) => run(patch).issues.map((i) => i.id)

describe('date helpers', () => {
  it('parses real dates only', () => {
    expect(parseIso('2026-10-10')).toBe(Date.UTC(2026, 9, 10))
    for (const bad of ['2026-02-30', '10/10/2026', '', '2026-13-01']) expect(parseIso(bad), bad).toBeNull()
  })
  it('adds months and clamps to the end of a shorter month', () => {
    expect(addMonths(Date.UTC(2026, 7, 31), 6)).toBe(Date.UTC(2027, 1, 28))
    expect(addMonths(Date.UTC(2026, 11, 1), 6)).toBe(Date.UTC(2027, 5, 1))
  })
})

describe('checkEvisa', () => {
  it('READY: everything within the listed rules', () => {
    const r = run()
    expect(r.issues).toEqual([])
    expect(r.verdict).toBe('ready')
  })

  it('blocks passport types the e-Visa is not listed for', () => {
    for (const passportKind of ['diplomatic_official', 'travel_document', 'endorsed'] as const) {
      expect(ids({ passportKind })).toContain('evisa_ineligible_passport')
      expect(run({ passportKind }).verdict).toBe('not_ready')
    }
  })

  it('handles Pakistani origin: yes blocks, unsure is only a note', () => {
    expect(ids({ pakistaniOrigin: 'yes' })).toContain('evisa_pakistani_origin')
    const unsure = run({ pakistaniOrigin: 'unsure' })
    expect(unsure.issues).toEqual([])
    expect(unsure.notes.map((n) => n.key)).toContain('cart.evisa.notes.originUnsure')
  })

  it('needs 6 months of passport validity from arrival, to the day', () => {
    expect(ids({ passportExpiry: '2027-06-01' })).not.toContain('evisa_passport_validity') // exactly 6 months
    expect(ids({ passportExpiry: '2027-05-31' })).toContain('evisa_passport_validity')
  })

  it('needs at least 2 blank pages', () => {
    expect(ids({ blankPages: 2 })).not.toContain('evisa_blank_pages')
    expect(ids({ blankPages: 1 })).toContain('evisa_blank_pages')
  })

  it('needs the application at least 4 days before arrival', () => {
    expect(ids({ arrival: '2026-10-14' })).not.toContain('evisa_too_late') // 4 days
    expect(ids({ arrival: '2026-10-13' })).toContain('evisa_too_late') // 3 days
    expect(ids({ arrival: '2026-10-09' })).toContain('evisa_too_late') // already past
  })

  it('warns, but does not block, when arrival is beyond the 120-day default, because sources disagree', () => {
    expect(ids({ arrival: '2027-02-07' })).not.toContain('evisa_too_early') // 120 days
    const issue = run({ arrival: '2027-02-08' }).issues.find((i) => i.id === 'evisa_too_early')
    expect(issue?.severity).toBe('warning')
    expect(issue?.provisional).toBe(true)
    expect(issue?.sourceUrl).toBe('https://indianvisaonline.gov.in')
    expect(run({ arrival: '2027-02-08' }).verdict).toBe('almost_ready')
  })

  it('stops at two e-Visas in a calendar year', () => {
    expect(ids({ evisasThisYear: 1 })).not.toContain('evisa_yearly_limit')
    expect(ids({ evisasThisYear: 2 })).toContain('evisa_yearly_limit')
    expect(run({ evisasThisYear: null }).notes.map((n) => n.key)).toContain('cart.evisa.notes.yearlyUnknown')
  })

  it('never calls an unanswered question a pass', () => {
    for (const patch of [{ passportExpiry: '' }, { arrival: '' }, { blankPages: null }] as Partial<EvisaInput>[]) {
      const r = run(patch)
      expect(r.verdict, JSON.stringify(patch)).not.toBe('ready')
      expect(r.issues.some((i) => i.id.startsWith('evisa_input_missing'))).toBe(true)
    }
  })

  it('always reminds the user to confirm on the official portal', () => {
    expect(run().notes.map((n) => n.key)).toContain('cart.evisa.notes.confirmOfficial')
  })
})

describe('e-Visa texts', () => {
  const worst = checkEvisa(
    { passportKind: 'endorsed', passportExpiry: '2026-11-01', blankPages: 0, arrival: '2026-10-11', evisasThisYear: 2, pakistaniOrigin: 'yes' },
    TODAY,
  )
  const far = checkEvisa({ ...ok, arrival: '2027-06-01' }, TODAY)

  it('has an English string for every issue and note key, with its parameters filled', () => {
    for (const r of [worst, far, run({ passportExpiry: '', arrival: '', blankPages: null, pakistaniOrigin: 'unsure' })]) {
      for (const i of r.issues)
        for (const key of [i.found, i.why, i.fix]) expect(tEn(key, i.params), key).not.toMatch(/\{\{/)
      for (const n of r.notes) expect(() => tEn(n.key)).not.toThrow()
    }
    expect(worst.issues.length).toBeGreaterThanOrEqual(6)
  })

  it('never promises approval', () => {
    // The disclaimer itself says "not a guarantee that a visa will be granted"; everything else must not promise.
    const { disclaimer, ...rest } = en.cart.evisa.result
    expect(JSON.stringify({ ...en.cart.evisa, result: rest })).not.toMatch(/will be (rejected|approved|granted)|guaranteed to/i)
    expect(disclaimer).toMatch(/not a guarantee/i)
    expect(tEn('cart.evisa.result.disclaimer')).toMatch(/not a guarantee/i)
  })
})

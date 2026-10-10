import { beforeEach, describe, expect, it } from 'vitest'
import { resetAll } from '../../store/reset'
import { sanitizeFields, useCart } from './store'

const AADHAAR_TEXT = `Government of India
Asha Sharma
DOB: 26/01/1990
1234 5678 9012
Address: 12 Test Street, Sample Nagar, Chennai - 600001`

const s = () => useCart.getState()

beforeEach(() => resetAll())

describe('reading a document', () => {
  it('masks Aadhaar before storing, and stops at review (never straight to confirmed)', () => {
    s().finishReading('aadhaar', AADHAAR_TEXT)
    const d = s().docs.aadhaar
    expect(d.status).toBe('review')
    expect(d.rawText).toContain('XXXX XXXX 9012')
    expect(JSON.stringify(d)).not.toMatch(/\d{12}|1234 5678|12345678/)
    expect(d.fields.aadhaarLast4).toBe('9012')
    expect(d.fields.name).toBe('Asha Sharma')
  })

  it('lets the user continue by typing when OCR finds nothing useful', () => {
    s().finishReading('pan', ' ~ \n ')
    expect(s().docs.pan).toMatchObject({ status: 'review', noText: true, fields: {} })
    s().confirm('pan', { name: 'Asha Sharma' })
    expect(s().docs.pan.status).toBe('confirmed')
  })

  it('lets the user continue by typing when OCR throws', () => {
    s().startReading('marksheet')
    s().failReading('marksheet')
    expect(s().docs.marksheet.status).toBe('error')
    s().startManual('marksheet')
    expect(s().docs.marksheet).toMatchObject({ status: 'review', noText: true })
  })

  it('reports an unrecognised document as detected = null so the user can choose the type', () => {
    s().finishReading('address', 'some long text that matches nothing at all in the cart')
    expect(s().docs.address.detected).toBeNull()
  })

  it('moves a document to the right slot only when that slot is empty', () => {
    s().finishReading('pan', AADHAAR_TEXT)
    expect(s().docs.pan.detected).toBe('aadhaar')
    expect(s().moveDoc('pan', 'aadhaar')).toBe(true)
    expect(s().docs.pan.status).toBe('empty')
    expect(s().docs.aadhaar.fields.aadhaarLast4).toBe('9012')
    s().startManual('pan')
    expect(s().moveDoc('pan', 'aadhaar')).toBe(false)
  })
})

describe('confirmation gate', () => {
  function addAadhaarAndMarksheet(marksheetName: string) {
    s().setAppType('reissue')
    s().startManual('passport')
    s().confirm('passport', { name: 'Asha Sharma', dob: '26/01/1990' })
    s().startManual('aadhaar')
    s().confirm('aadhaar', { name: 'Asha Sharma', dob: '26/01/1990' })
    s().startManual('marksheet')
    s().confirm('marksheet', { name: marksheetName, dob: '26/01/1990' })
  }

  it('does not run checks before anything is confirmed', () => {
    expect(s().check()).toBeNull()
    s().finishReading('aadhaar', AADHAAR_TEXT)
    expect(s().check()).toBeNull()
    expect(s().report).toBeNull()
  })

  it('does not run checks while any document is still waiting for confirmation', () => {
    s().startManual('pan')
    s().confirm('pan', { name: 'Asha Sharma' })
    s().finishReading('aadhaar', AADHAAR_TEXT)
    expect(s().check()).toBeNull()
    s().confirm('aadhaar', s().docs.aadhaar.fields)
    expect(s().check()).not.toBeNull()
  })

  it('drops the raw OCR text once the user confirms', () => {
    s().finishReading('aadhaar', AADHAAR_TEXT)
    s().confirm('aadhaar', s().docs.aadhaar.fields)
    expect(s().docs.aadhaar.rawText).toBeUndefined()
  })

  it('updates the result after the user corrects a value', () => {
    addAadhaarAndMarksheet('Rahul Verma')
    expect(s().check()?.verdict).toBe('not_ready')
    s().edit('marksheet')
    expect(s().report).toBeNull() // the old result must not outlive the edit
    expect(s().check()).toBeNull() // and cannot be re-run while the edit is unconfirmed
    s().confirm('marksheet', { name: 'Asha Sharma', dob: '26/01/1990' })
    expect(s().check()?.verdict).toBe('ready')
  })

  it('clears the result when the application type changes or a document is removed', () => {
    addAadhaarAndMarksheet('Asha Sharma')
    s().check()
    expect(s().report).not.toBeNull()
    s().setAppType('fresh')
    expect(s().report).toBeNull()
    s().check()
    s().remove('marksheet')
    expect(s().report).toBeNull()
  })

  it('the application type changes which checks apply', () => {
    s().startManual('aadhaar')
    s().confirm('aadhaar', { name: 'Asha Sharma', dob: '26/01/1990' })
    s().setAppType('reissue')
    expect(s().check()?.issues.map((i) => i.id)).toContain('missing_document:passport')
    s().setAppType('fresh')
    expect(s().check()?.issues.map((i) => i.id)).toContain('missing_document:address')
  })
})

describe('sanitizeFields', () => {
  it('keeps only the last four Aadhaar digits, even if the whole number is pasted', () => {
    expect(sanitizeFields('aadhaar', { aadhaarLast4: '1234 5678 9012' }).aadhaarLast4).toBe('9012')
    expect(sanitizeFields('aadhaar', { aadhaarLast4: '12' }).aadhaarLast4).toBeUndefined()
  })
  it('masks a full Aadhaar number typed into a free-text field', () => {
    const out = sanitizeFields('aadhaar', { address: 'Flat 4 123456789012 Chennai' })
    expect(out.address).toBe('Flat 4 XXXX XXXX 9012 Chennai')
  })
  it('normalises dates and drops unreadable ones instead of keeping a guess', () => {
    expect(sanitizeFields('pan', { dob: '5-1-1990' }).dob).toBe('05/01/1990')
    expect(sanitizeFields('pan', { dob: 'sometime' }).dob).toBeUndefined()
  })
  it('keeps only the fields that belong to the document type, trimmed', () => {
    const out = sanitizeFields('pan', { name: '  Asha   Sharma ', passportNumber: 'X1234567', pan: ' abcde 1234 f ' })
    expect(out).toEqual({ name: 'Asha Sharma', pan: 'ABCDE1234F' })
  })
})

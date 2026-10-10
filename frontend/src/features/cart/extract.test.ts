import { describe, expect, it } from 'vitest'
import { classify, extractFields, maskAadhaar } from './extract'

// All samples below use dummy names and numbers. Never paste real document text here.
const PAN_TEXT = `INCOME TAX DEPARTMENT
GOVT. OF INDIA
Permanent Account Number
ABCDE1234F
Name
ASHA KUMARI SHARMA
Father's Name
RAMESH SHARMA
Date of Birth
26/01/1990`

const AADHAAR_TEXT = `Government of India
Asha Kumari Sharma
DOB: 26/01/1990
FEMALE
1234 5678 9012
Address: 12 Test Street, Sample Nagar, Chennai - 600001`

const MARKSHEET_TEXT = `CENTRAL BOARD OF SECONDARY EDUCATION
Secondary School Examination
Roll No: 1234567
Name of Candidate : ASHA K SHARMA
Mother's Name : GITA SHARMA
Father's Name : RAMESH SHARMA
Date of Birth : 26-01-1990`

const BIRTH_TEXT = `Government of Sample State
Certificate of Birth
Registrar of Births and Deaths
Name of Child: ASHA KUMARI SHARMA
Date of Birth: 26 Jan 1990
Place of Birth: CHENNAI
Name of Father: RAMESH SHARMA
Name of Mother: GITA SHARMA`

const ADDRESS_TEXT = `RENT AGREEMENT
This agreement between the Landlord and the Tenant
Tenant Name: Asha Kumari Sharma
Address: Flat 4, Sample Apartments
Sample Nagar, Chennai 600001`

const MRZ_TEXT = `REPUBLIC OF INDIA PASSPORT
P<INDSHARMA<<ASHA<KUMARI<<<<<<<<<<<<<<<<<<<<
X1234567<4IND9001260F3301254<<<<<<<<<<<<<<<6`

describe('maskAadhaar', () => {
  it('keeps only the last four digits, with or without separators', () => {
    expect(maskAadhaar('Aadhaar 1234 5678 9012')).toBe('Aadhaar XXXX XXXX 9012')
    expect(maskAadhaar('1234-5678-9012')).toBe('XXXX XXXX 9012')
    expect(maskAadhaar('123456789012')).toBe('XXXX XXXX 9012')
  })

  it('does not join digits across lines, so a date above the number is left intact and nothing leaks', () => {
    const masked = maskAadhaar('DOB: 26/01/1990\n1234 5678 9012\nAddress')
    expect(masked).toBe('DOB: 26/01/1990\nXXXX XXXX 9012\nAddress')
    expect(masked).not.toMatch(/5678|1234/)
  })

  it('reduces a 16-digit virtual ID to its last four digits', () => {
    expect(maskAadhaar('VID 1234 5678 9012 3456')).toBe('VID XXXX XXXX XXXX 3456')
  })

  it('masks a number that follows a year on the same line without leaving any of it readable', () => {
    expect(maskAadhaar('Year of Birth: 1990 1234 5678 9012')).not.toMatch(/1234|5678/)
  })

  it('leaves dates and short numbers alone', () => {
    expect(maskAadhaar('DOB 26/01/1989, PIN 600001')).toBe('DOB 26/01/1989, PIN 600001')
  })
})

describe('classify', () => {
  it('recognises each supported document', () => {
    expect(classify(PAN_TEXT)).toBe('pan')
    expect(classify(maskAadhaar(AADHAAR_TEXT))).toBe('aadhaar')
    expect(classify(MARKSHEET_TEXT)).toBe('marksheet')
    expect(classify(BIRTH_TEXT)).toBe('birth')
    expect(classify(ADDRESS_TEXT)).toBe('address')
    expect(classify(MRZ_TEXT)).toBe('passport')
  })

  it('classifies an unmasked Aadhaar number too', () => {
    expect(classify(AADHAAR_TEXT)).toBe('aadhaar')
  })

  it('returns null for unreadable or unrelated text', () => {
    expect(classify('')).toBeNull()
    expect(classify('hello world, nothing useful here')).toBeNull()
  })
})

describe('extractFields: PAN', () => {
  it('reads number, name, father and DOB', () => {
    expect(extractFields('pan', PAN_TEXT)).toEqual({
      pan: 'ABCDE1234F',
      name: 'ASHA KUMARI SHARMA',
      fatherName: 'RAMESH SHARMA',
      dob: '26/01/1990',
    })
  })
})

describe('extractFields: Aadhaar', () => {
  it('stores only the last four digits, never the full number', () => {
    const fields = extractFields('aadhaar', AADHAAR_TEXT)
    expect(fields.aadhaarLast4).toBe('9012')
    expect(fields.name).toBe('Asha Kumari Sharma')
    expect(fields.dob).toBe('26/01/1990')
    expect(fields.address).toContain('Chennai')
    const json = JSON.stringify(fields)
    expect(json).not.toContain('1234')
    expect(json).not.toContain('5678')
    expect(json).not.toMatch(/\d{12}/)
  })

  it('gives the same result for already-masked input', () => {
    expect(extractFields('aadhaar', maskAadhaar(AADHAAR_TEXT))).toEqual(extractFields('aadhaar', AADHAAR_TEXT))
  })

  it('accepts a year of birth only', () => {
    const f = extractFields('aadhaar', 'Asha Kumari\nYear of Birth: 1990\nXXXX XXXX 9012')
    expect(f.dob).toBe('1990')
  })
})

describe('extractFields: marksheet, birth certificate, address proof', () => {
  it('reads the marksheet', () => {
    expect(extractFields('marksheet', MARKSHEET_TEXT)).toEqual({
      name: 'ASHA K SHARMA',
      fatherName: 'RAMESH SHARMA',
      motherName: 'GITA SHARMA',
      dob: '26/01/1990',
    })
  })

  it('reads the birth certificate, including a textual date', () => {
    expect(extractFields('birth', BIRTH_TEXT)).toEqual({
      name: 'ASHA KUMARI SHARMA',
      fatherName: 'RAMESH SHARMA',
      motherName: 'GITA SHARMA',
      dob: '26/01/1990',
    })
  })

  it('reads name and address block up to the PIN code', () => {
    const f = extractFields('address', ADDRESS_TEXT)
    expect(f.name).toBe('Asha Kumari Sharma')
    expect(f.address).toBe('Flat 4, Sample Apartments, Sample Nagar, Chennai 600001')
  })
})

describe('extractFields: passport MRZ', () => {
  it('parses name, number, DOB and expiry', () => {
    expect(extractFields('passport', MRZ_TEXT)).toEqual({
      name: 'ASHA KUMARI SHARMA',
      passportNumber: 'X1234567',
      dob: '26/01/1990',
      expiry: '25/01/2033',
    })
  })

  it('tolerates spaces and O/0 confusion from OCR', () => {
    const noisy = MRZ_TEXT.replace('9001260', '90O1260').replace('P<IND', 'P< IND')
    expect(extractFields('passport', noisy).dob).toBe('26/01/1990')
  })
})

describe('extractFields: unreadable input', () => {
  it('returns nothing rather than inventing values', () => {
    for (const type of ['aadhaar', 'pan', 'passport', 'marksheet', 'address', 'birth'] as const) {
      expect(extractFields(type, '')).toEqual({})
      expect(extractFields(type, 'smudged ~~ ### text')).toEqual({})
    }
  })

  it('does not take a stray date as the DOB when there is no DOB label', () => {
    expect(extractFields('marksheet', 'Name of Candidate : ASHA SHARMA\nIssued 05/06/2006').dob).toBeUndefined()
  })
})

// Test helpers shared by the cart tests. Dummy values only: never put real document data in tests.
import en from '../../i18n/en/cart.json'
import type { CartDoc, DocType, ExtractedFields } from './types'

export const TODAY = new Date(2026, 9, 10) // 10 Oct 2026, fixed so age and expiry checks are repeatable

export function doc(type: DocType, fields: ExtractedFields, status: CartDoc['status'] = 'confirmed'): CartDoc {
  return { type, status, progress: 1, fields }
}

/** Looks a dotted key up in the English cart strings and fills {{params}}, like i18next would. */
export function tEn(key: string, params: Record<string, string> = {}): string {
  const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en)
  if (typeof value !== 'string') throw new Error(`missing English string: ${key}`)
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => params[name] ?? `{{${name}}}`)
}

export const ADDRESS = '12 Test Street, Sample Nagar, Chennai 600001'

/** A consistent adult applicant: every check should pass for a fresh application. */
export const cleanDocs = (): CartDoc[] => [
  doc('aadhaar', { name: 'Asha Sharma', dob: '26/01/1990', address: ADDRESS, aadhaarLast4: '9012' }),
  doc('marksheet', { name: 'Asha Sharma', dob: '26/01/1990', fatherName: 'Ramesh Sharma' }),
  doc('address', { name: 'Asha Sharma', address: ADDRESS }),
]

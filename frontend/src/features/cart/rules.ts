// Where each document-requirement rule comes from, and how far we trust it.
//
// STATUS OF THESE RULES (retrieved 10 Oct 2026): the Passport Seva pages below are rendered by JavaScript
// and the PDF booklets are compressed, so their text could NOT be read automatically. What we hold is a
// search-result summary of those pages, not a reading of the pages themselves. Every rule is therefore
// `provisional`: the app shows it as "please verify with Passport Seva", never as an official requirement,
// and never as a blocker. Move a rule to `verified` only after a person has compared it to the live page
// (and record the date), as the plan asks for rule files (docs/implementation.md, "Set verified to true
// only after you have compared the chunk to the live official page").
//
// The plan's "26 January 1989" DOB cutoff is deliberately NOT implemented: no source for it was found.

export type RuleStatus = 'verified' | 'provisional'

export const SOURCES = {
  dobProof: 'https://www.passportindia.gov.in/psp/ListDOB',
  acceptableDocs: 'https://services1.passportindia.gov.in/psp/ListDocuments',
  fresh: 'https://www.passportindia.gov.in/psp/docAdvisor/attachmentAdvFreshInp',
  reissue: 'https://www.passportindia.gov.in/psp/docAdvisor/reissuePassport',
  minor: 'https://www.passportindia.gov.in/psp/SplCaseOfMinorsReqPassport',
} as const

export interface CartRule {
  id: string
  status: RuleStatus
  sourceUrl: string
  /** What we believe the page says (from a search-result summary). Not a quotation. */
  summary: string
}

export const RULES = {
  /** Fresh and minor applications normally need a proof of present address. */
  addressProof: {
    id: 'address_proof',
    status: 'provisional',
    sourceUrl: SOURCES.fresh,
    summary: 'A fresh application normally needs proof of present address.',
  },
  /** Re-issue needs the old passport. Address proof only if the address changed: left undetermined. */
  oldPassport: {
    id: 'old_passport',
    status: 'provisional',
    sourceUrl: SOURCES.reissue,
    summary: 'Re-issue needs the old passport (original and copies).',
  },
  /** A birth certificate or a school certificate is among the accepted proofs of date of birth. */
  dobProof: {
    id: 'dob_proof',
    status: 'provisional',
    sourceUrl: SOURCES.dobProof,
    summary: 'A proof of date of birth is needed. Birth certificate and school certificates are on the list.',
  },
  /** For people born on or after 1 Oct 2023 the birth certificate is the proof of date of birth. */
  dobProofBirthCertOnly: {
    id: 'dob_proof_birth_certificate_only',
    status: 'provisional',
    sourceUrl: SOURCES.dobProof,
    summary: 'For birth dates on or after 1 October 2023 the birth certificate is the listed proof.',
  },
  /** Applicants under 18 follow the minor process. */
  minorFlow: {
    id: 'minor_flow',
    status: 'provisional',
    sourceUrl: SOURCES.minor,
    summary: 'Applicants under 18 follow the minor process.',
  },
} as const satisfies Record<string, CartRule>

/** First day on which the birth-certificate-only rule is said to apply. Provisional, see RULES. */
export const BIRTH_CERT_ONLY_FROM = { year: 2023, month: 10, day: 1 } as const
export const ADULT_AGE = 18

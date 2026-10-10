// Mirrors backend/app/schemas.py (the API contract). Change both in the same PR.
import type { Lang } from './langs'

export type SourceType = 'official' | 'court' | 'parliament' | 'lawyer_qa' | 'forum' | 'blog' | 'user'
export type Confidence = 'high' | 'medium' | 'low'

export interface Health {
  ok: boolean
  llm: 'live' | 'local' | 'mock' // live = Claude, local = Ollama, mock = canned answers
  sarvam: boolean // false -> use browser speech fallbacks
  index_ready: boolean
}

// ---------------------------------------------------------------- M2 stuck-case solver

export interface CaseRequest {
  thread_id?: string
  lang: Lang
  text: string
  cart_issues?: string[] // e.g. "name_mismatch:aadhaar_vs_marksheet"
  consent: boolean
  search_enabled?: boolean
}

export interface ResumeRequest {
  thread_id: string
  text: string
}

export interface Citation {
  source_id: string
  title: string
  url: string
  source_type: SourceType
  date: string | null
}

export interface Answer {
  diagnosis: string
  likely_causes: string[]
  recommended_path: { name: string; steps: string[]; documents_needed: string[]; where: string }
  alternatives: { name: string; when_it_applies: string }[]
  conflicts: { issue: string; what_decides_it: string }[]
  similar_cases: { summary: string; outcome: string; citation_id: string; date: string | null }[]
  citations: Citation[]
  confidence: Confidence
  unknowns: string[]
  escalation: string[]
  disclaimer: string
}

export interface CaseResult {
  thread_id: string
  lang: Lang
  answer: Answer // in the user's language when localized, else English
  answer_en: Answer
  localized: boolean
  draft: string | null // template with [____] blanks
}

// SSE events from POST /api/case and /api/case/resume
export interface ProgressEvent {
  node: string
}
export interface ClarifyEvent {
  thread_id: string
  question: string
}
export interface ErrorEvent {
  code: string
  message: string
}

// ---------------------------------------------------------------- M4 voice and language

export interface SttResponse {
  text: string
  lang: Lang | null
}

// ---------------------------------------------------------------- M3 status decoder

export interface StatusDecodeResponse {
  matched: boolean
  meaning: string
  next_step: string
  source: string | null
}

"""API contract (plan section 3.8). frontend/src/lib/types.ts mirrors this file.

Change a model here -> update types.ts in the same PR.
"""

from typing import Literal

from pydantic import BaseModel, Field

# Tier A (en, hi, ta) + A+ (mr, bn). Add Tier B languages here and in frontend/src/lib/langs.ts.
Lang = Literal["en", "hi", "ta", "mr", "bn"]

SourceType = Literal["official", "court", "parliament", "lawyer_qa", "forum", "blog", "user"]
Confidence = Literal["high", "medium", "low"]

DISCLAIMER = "Guidance only, not legal advice. Confirm with the Passport Office."


# ---------------------------------------------------------------- health


class HealthResponse(BaseModel):
    ok: bool = True
    llm: Literal["live", "local", "mock"] = Field(description="live=Claude, local=Ollama, mock=canned")
    sarvam: bool = Field(description="False -> frontend must use browser speech fallbacks")
    index_ready: bool = Field(description="False -> run `make ingest`")


# ---------------------------------------------------------------- M2 stuck-case solver


class CaseRequest(BaseModel):
    thread_id: str | None = Field(default=None, description="Omit to start a new thread")
    lang: Lang = "en"
    text: str = Field(min_length=1, max_length=2000)
    cart_issues: list[str] = Field(
        default_factory=list,
        description="Mismatch types from the Document Cart, e.g. name_mismatch:aadhaar_vs_marksheet",
    )
    consent: bool = Field(description="User agreed to server-side processing of their text")
    search_enabled: bool = False


class ResumeRequest(BaseModel):
    thread_id: str
    text: str = Field(min_length=1, max_length=2000)


class Citation(BaseModel):
    source_id: str
    title: str
    url: str
    source_type: SourceType
    date: str | None = None


class RecommendedPath(BaseModel):
    name: str
    steps: list[str]
    documents_needed: list[str]
    where: str = Field(description="PSK / RPO grievance / police station / RTI")


class Alternative(BaseModel):
    name: str
    when_it_applies: str


class Conflict(BaseModel):
    issue: str
    what_decides_it: str


class SimilarCase(BaseModel):
    summary: str
    outcome: str
    citation_id: str
    date: str | None = None


class Answer(BaseModel):
    """Structured answer (plan section 3.4). Every claim must cite an id in `citations`."""

    diagnosis: str
    likely_causes: list[str]
    recommended_path: RecommendedPath
    alternatives: list[Alternative]
    conflicts: list[Conflict]
    similar_cases: list[SimilarCase]
    citations: list[Citation]
    confidence: Confidence
    unknowns: list[str]
    escalation: list[str]
    disclaimer: str = DISCLAIMER


class CaseResult(BaseModel):
    thread_id: str
    lang: Lang
    answer: Answer = Field(description="In the user's language when localized=true, else English")
    answer_en: Answer
    localized: bool
    draft: str | None = Field(default=None, description="Letter/affidavit template with [____] blanks")


# SSE events emitted by POST /api/case and POST /api/case/resume:
#   event: progress  data: ProgressEvent   (one per graph node as it finishes)
#   event: clarify   data: ClarifyEvent    (stream ends; answer via /api/case/resume)
#   event: result    data: CaseResult      (stream ends)
#   event: error     data: ErrorEvent      (stream ends)


class ProgressEvent(BaseModel):
    node: str


class ClarifyEvent(BaseModel):
    thread_id: str
    question: str


class ErrorEvent(BaseModel):
    code: str
    message: str


# ---------------------------------------------------------------- M4 voice and language


class SttResponse(BaseModel):
    text: str
    lang: Lang | None = None


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    lang: Lang


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    target_lang: Lang


class TranslateResponse(BaseModel):
    text: str


# ---------------------------------------------------------------- M3 status decoder


class StatusDecodeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class StatusDecodeResponse(BaseModel):
    matched: bool
    meaning: str
    next_step: str
    source: str | None = None

"""LangGraph state for the Stuck-Case Solver (plan section 3.4). Values must stay JSON-serialisable."""

from typing import TypedDict


class CaseState(TypedDict, total=False):
    thread_id: str
    lang: str  # one of schemas.Lang
    raw_text: str  # user message, PII-scrubbed; clarify answers are appended
    refused: bool  # unsafe request: skip everything, answer with the legitimate route
    cart_issues: list[str]  # mismatch types from the Document Cart
    search_enabled: bool

    triage: dict  # nodes.triage.Triage as dict
    clarify_count: int

    rule_hits: list[dict]  # rag.Hit
    case_hits: list[dict]  # rag.Hit
    retrieval_confidence: float  # 0..1
    web_hits: list[dict]

    remedies: list[dict]  # community remedies after the official-rule check (verify node)
    conflicts: list[dict]  # disagreements recorded on case cards: {issue, source_id}
    answer: dict  # schemas.Answer in English
    answer_local: dict | None  # schemas.Answer in the user's language
    localized: bool
    draft: str | None

    guard_ok: bool
    guard_issues: list[str]
    retries: int

"""triage (fast model): classify service, stage, category, urgency; decide whether to ask a question."""

from typing import Literal

from pydantic import BaseModel, Field

from app import llm
from app.agent.prompts import LANG_NAMES, TRIAGE_SYSTEM
from app.agent.questions import pv_status_question
from app.agent.state import CaseState


class Triage(BaseModel):
    service: Literal["fresh", "reissue", "minor", "lost_damaged", "tatkaal", "pcc", "evisa", "other"]
    stage: Literal["before_booking", "at_counter", "police_verification", "on_hold", "after_issue", "unknown"]
    category: Literal[
        "name_discrepancy",
        "name_change_marriage",
        "dob_mismatch",
        "no_birth_certificate",
        "address_mismatch",
        "adverse_pv",
        "pv_delay",
        "minor_consent",
        "lost_passport",
        "refund_reschedule",
        "single_name",
        "other",
    ]
    urgency: Literal["low", "normal", "high"]
    summary_en: str = Field(description="One or two English sentences for retrieval")
    missing: list[str] = Field(description="Facts still needed; empty if enough to proceed")
    clarify_question: str | None = Field(description="One short question in the user's language, or null")


LOCAL_NO_CLARIFY_WORDS = 12  # small local models over-ask; a detailed message needs no question


async def triage(state: CaseState) -> CaseState:
    provider = await llm.active_provider()
    if provider == "mock":
        return {"triage": _mock(state).model_dump()}

    user = (
        f"User language: {LANG_NAMES.get(state['lang'], 'English')}\n"
        f"Document Cart issues: {', '.join(state.get('cart_issues', [])) or 'none'}\n\n"
        f"<message>\n{state['raw_text']}\n</message>"
    )
    result = await llm.structured(Triage, system=TRIAGE_SYSTEM, user=user, tier="fast", max_tokens=1024)
    detailed = len(state["raw_text"].split()) >= LOCAL_NO_CLARIFY_WORDS
    if not result.clarify_question or (provider == "ollama" and detailed):
        result.missing = []  # no question to ask means nothing to wait for
    if question := pv_status_question(
        category=result.category,
        stage=result.stage,
        text=state["raw_text"],
        lang=state["lang"],
        clarify_count=state.get("clarify_count", 0),
    ):  # Journey B: the same fixed question whichever model is answering
        result.missing, result.clarify_question = ["pv_status"], question
    return {"triage": result.model_dump()}


def _mock(state: CaseState) -> Triage:
    # Short first messages trigger one clarify round so the frontend can exercise that path.
    ask = len(state["raw_text"].split()) < 6 and state.get("clarify_count", 0) == 0
    return Triage(
        service="other",
        stage="unknown",
        category="other",
        urgency="normal",
        summary_en=state["raw_text"],
        missing=["stage"] if ask else [],
        clarify_question="What does your application status say right now? For example "
        "'police verification initiated' or 'on hold'."
        if ask
        else None,
    )

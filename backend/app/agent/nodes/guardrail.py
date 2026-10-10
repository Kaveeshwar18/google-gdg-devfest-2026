"""guardrail: last check before the answer leaves the server. One regenerate, then abstain (plan 3.4).

Checks: citations exist in what was retrieved; no outcome promises; no instructions to forge; confidence
not above the evidence; disclaimer present. The citation and confidence checks need real retrieval, so they
are skipped in mock mode (canned answer).
"""

import logging
import re

from app import llm
from app.agent import scoring
from app.agent.nodes.synthesize import abstain
from app.agent.state import CaseState
from app.schemas import DISCLAIMER, Answer

MAX_REGENERATE = 1
log = logging.getLogger("mitra.guardrail")

_PROMISES = re.compile(
    r"\bguarantee[sd]?\b|\b100\s?%|\bdefinitely\b|\bcertainly will\b"
    r"|\b(?:will|shall)\s+(?:definitely\s+|surely\s+)?(?:be\s+)?(?:approved|accepted|issued|cleared)\b",
    re.IGNORECASE,
)
_FORGERY_ADVICE = re.compile(
    r"\b(?:you can|you could|you may|simply|just|try to)\s+(?:forge|fake|back-?date|fabricate|alter|tamper)",
    re.IGNORECASE,
)
# Source ids written into sentences, e.g. "... certificate [c-name-disc-001]" or "[r-1#0, c-2]"
_INLINE_IDS = re.compile(r"\s*\[\s*(?:[crwu]-[\w#.-]+\s*,?\s*)+\]")
_ORDER = {"low": 0, "medium": 1, "high": 2}


def strip_inline_ids(value):
    """Remove source ids from every sentence. `citations` and `citation_id` keep them: that is where they belong."""
    if isinstance(value, str):
        return _INLINE_IDS.sub("", value).strip()
    if isinstance(value, list):
        return [strip_inline_ids(v) for v in value]
    if isinstance(value, dict):
        return {k: v if k in _ID_FIELDS else strip_inline_ids(v) for k, v in value.items()}
    return value


_ID_FIELDS = {"citations", "citation_id", "source_id", "url", "date", "confidence", "disclaimer"}


def _texts(a: Answer) -> list[str]:
    parts = [a.diagnosis, *a.likely_causes, a.recommended_path.name, *a.recommended_path.steps]
    parts += [alt.name + " " + alt.when_it_applies for alt in a.alternatives]
    parts += [c.issue + " " + c.what_decides_it for c in a.conflicts]
    parts += [s.summary + " " + s.outcome for s in a.similar_cases]
    return parts


def check(answer: Answer, state: CaseState, *, live: bool) -> list[str]:
    issues: list[str] = []
    text = "\n".join(_texts(answer))
    if _PROMISES.search(text):
        issues.append("Remove any guarantee or promise of an outcome (approval, acceptance, issue).")
    if _FORGERY_ADVICE.search(text):
        issues.append("Never suggest forging, faking, back-dating or altering a document.")
    if not live:
        return issues

    retrieved = {h["id"] for h in state.get("rule_hits", []) + state.get("case_hits", []) + state.get("web_hits", [])}
    cited = {c.source_id for c in answer.citations}
    if retrieved and not cited:
        issues.append("Cite at least one source from the context.")
    if unknown := sorted(cited - retrieved):
        issues.append(f"These citations are not in the context, remove them: {', '.join(unknown)}.")
    if bad := sorted({s.citation_id for s in answer.similar_cases} - cited):
        issues.append(f"similar_cases cite ids missing from `citations`: {', '.join(bad)}.")
    return issues


async def guardrail(state: CaseState) -> CaseState:
    live = await llm.active_provider() != "mock"
    answer = Answer.model_validate(strip_inline_ids({**state["answer"], "disclaimer": DISCLAIMER}))

    if state.get("refused"):  # refusal text legitimately mentions the things it refuses
        return {"answer": answer.model_dump(), "guard_ok": True, "guard_issues": []}

    issues = check(answer, state, live=live)
    if issues:
        log.info("guardrail flagged: %s", " | ".join(issues))
    if issues and state.get("retries", 0) >= MAX_REGENERATE:
        answer = abstain("I could not produce a reliable answer from the sources I have.")
        return {"answer": answer.model_dump(), "guard_ok": True, "guard_issues": []}
    if issues:
        return {
            "answer": answer.model_dump(),
            "guard_ok": False,
            "guard_issues": issues,
            "retries": state.get("retries", 0) + 1,
        }

    if live:  # confidence can't exceed what the evidence supports
        ceiling = scoring.level(state.get("retrieval_confidence", 0.0))
        if _ORDER[answer.confidence] > _ORDER[ceiling]:
            answer = answer.model_copy(update={"confidence": ceiling})
        if ceiling == "low" and not answer.unknowns:
            answer = answer.model_copy(update={"unknowns": ["We found little in our sources that matches this case."]})
    return {"answer": answer.model_dump(), "guard_ok": True, "guard_issues": []}

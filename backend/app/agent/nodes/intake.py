"""intake: normalise input. PII is scrubbed at the API gateway; scrubbing again here is idempotent."""

from app.agent.safety import is_unsafe
from app.agent.state import CaseState
from app.pii import scrub


async def intake(state: CaseState) -> CaseState:
    text = scrub(state["raw_text"])
    return {
        "raw_text": text,
        "refused": is_unsafe(text),
        "cart_issues": state.get("cart_issues", []),
        "clarify_count": state.get("clarify_count", 0),
        "retries": 0,
    }

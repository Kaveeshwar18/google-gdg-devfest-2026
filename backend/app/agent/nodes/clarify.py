"""clarify: ask ONE question and pause the graph until /api/case/resume supplies the answer."""

from langgraph.types import interrupt

from app.agent.safety import is_unsafe
from app.agent.state import CaseState
from app.pii import scrub

FALLBACK_QUESTION = "Could you tell me a little more about your situation?"


async def clarify(state: CaseState) -> CaseState:
    question = state["triage"].get("clarify_question") or FALLBACK_QUESTION
    reply = scrub(str(interrupt({"question": question})))  # resumes with Command(resume=<user text>)
    return {
        "raw_text": f"{state['raw_text']}\n\nQ: {question}\nA: {reply}",
        "clarify_count": state.get("clarify_count", 0) + 1,
        "refused": is_unsafe(reply),
    }

"""refuse: answer unsafe requests with the legitimate route. Skips retrieval and every model call."""

from app.agent.safety import refusal_answer
from app.agent.state import CaseState


async def refuse(state: CaseState) -> CaseState:
    return {"answer": refusal_answer().model_dump(), "draft": None, "guard_ok": True}

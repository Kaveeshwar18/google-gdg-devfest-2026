"""action_draft: attach a letter or affidavit TEMPLATE when one fits the problem. No model, no invented facts."""

from app.agent.drafts import draft_for
from app.agent.state import CaseState


async def action_draft(state: CaseState) -> CaseState:
    return {"draft": draft_for(state["triage"]["category"])}

"""synthesize (main model): fill the Answer schema using only retrieved material, with citations."""

from xml.sax.saxutils import escape, quoteattr

from app import llm
from app.agent import scoring
from app.agent.prompts import SYNTHESIZE_SYSTEM
from app.agent.state import CaseState
from app.corpus import load_json
from app.schemas import Answer, RecommendedPath

NO_SOURCES = (
    "We don't have reliable information about this problem yet, so we won't guess. "
    "The official channels below can look at your specific case."
)


async def synthesize(state: CaseState) -> CaseState:
    if await llm.active_provider() == "mock":
        return {"answer": Answer.model_validate(load_json("fixtures/mock_answer.json")).model_dump()}

    if not (state.get("rule_hits") or state.get("case_hits") or state.get("web_hits")):
        return {"answer": abstain(NO_SOURCES).model_dump()}  # nothing to cite: never improvise

    user = (
        f"<context>\n{_format_context(state)}\n</context>\n\n"
        f"{_format_verification(state)}"
        f"<triage>{state['triage']}</triage>\n\n"
        f"<problem>\n{state['raw_text']}\n</problem>"
    )
    if state.get("guard_issues"):
        user += "\n\nYour previous answer failed these checks; fix them:\n- " + "\n- ".join(state["guard_issues"])
    try:
        answer = await llm.structured(Answer, system=SYNTHESIZE_SYSTEM, user=user, tier="main")
    except llm.LLMRefusal:
        answer = abstain("This request can't be answered here. Please contact the Passport Office directly.")
    return {"answer": answer.model_dump()}


def _format_context(state: CaseState) -> str:
    hits = state.get("rule_hits", []) + state.get("case_hits", []) + state.get("web_hits", [])
    if not hits:
        return "(no sources found)"
    blocks = []
    for h in hits:
        m = h["metadata"]
        attrs = " ".join(
            f"{k}={quoteattr(str(v))}"
            for k, v in [
                ("id", h["id"]),
                ("title", m.get("title", "")),
                ("url", m.get("url", "")),
                ("source_type", m.get("source_type", "")),
                ("date", m.get("date", "")),
                ("reliability", m.get("reliability", "")),
            ]
        )
        blocks.append(f"<source {attrs}>\n{escape(h['text'])}\n</source>")
    return "\n".join(blocks)


def _format_verification(state: CaseState) -> str:
    """Remedies after the official-rule check, known source disagreements, and the confidence ceiling."""
    lines = []
    for r in state.get("remedies", []):
        cite = r["supported_by"][0]["source_id"] if r["supported_by"] else "?"
        flag = " [CONTRADICTS an official rule: prefer the rule]" if r["conflicts_with_official"] else ""
        lines.append(f"- {r['name']} (reported in {cite}, outcome {r['outcome']}){flag}")
    for c in state.get("conflicts", []):
        lines.append(f"- Sources disagree ({c['source_id']}): {c['issue']}")
    level = scoring.level(state.get("retrieval_confidence", 0.0))
    body = "\n".join(lines) or "(none)"
    return (
        f"<verification>\nCommunity remedies and known disagreements:\n{body}\n"
        f"Evidence strength: {level}. Your `confidence` must not be higher than this.\n</verification>\n\n"
    )


def abstain(reason: str) -> Answer:
    return Answer(
        diagnosis=reason,
        likely_causes=[],
        recommended_path=RecommendedPath(
            name="Contact the Passport Office",
            steps=["Raise a grievance on passportindia.gov.in or visit your Regional Passport Office."],
            documents_needed=[],
            where="RPO grievance",
        ),
        alternatives=[],
        conflicts=[],
        similar_cases=[],
        citations=[],
        confidence="low",
        unknowns=[],
        escalation=["Passport Seva grievance", "CPGRAMS (pgportal.gov.in)"],
    )

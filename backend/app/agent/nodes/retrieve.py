"""retrieve: official rules and case library in one node (no fan-out), then rank and score confidence."""

import asyncio

from app import rag
from app.agent import scoring
from app.agent.state import CaseState

FETCH_K = 12  # over-fetch, then re-rank down to RULES_K / CASES_K
RULES_K = 6
CASES_K = 8


def _search(queries: list[str]) -> tuple[list[rag.Hit], list[rag.Hit]]:
    rules = scoring.merge(*(rag.search(rag.RULES, q, FETCH_K) for q in queries))
    cases = scoring.merge(*(rag.search(rag.CASES, q, FETCH_K) for q in queries))
    return rules, cases


async def retrieve(state: CaseState) -> CaseState:
    if not rag.index_ready():
        return {"rule_hits": [], "case_hits": [], "retrieval_confidence": 0.0}

    triage = state["triage"]
    # Two views of the problem: our English summary, and what the user actually wrote (any language).
    queries = [triage["summary_en"], state["raw_text"]]
    rules, cases = await asyncio.to_thread(_search, queries)

    service, category = triage["service"], triage["category"]
    domain = scoring.domain_of(service, state["raw_text"])
    rule_hits = scoring.rank(rules, service=service, category=category, k=RULES_K, domain=domain)
    case_hits = scoring.rank(cases, service=service, category=category, k=CASES_K, domain=domain)
    return {
        "rule_hits": list(rule_hits),
        "case_hits": list(case_hits),
        "retrieval_confidence": scoring.confidence(rule_hits, case_hits),
    }

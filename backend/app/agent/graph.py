"""Stuck-Case Solver graph (plan section 3.4, with both retrievers in one node).

intake -> triage -> [clarify -> triage]* -> retrieve -> [live_search] -> verify -> synthesize
       -> action_draft -> guardrail -> [synthesize once more] -> localize -> END
An unsafe request (forge/alter/back-date a document) goes intake|clarify -> refuse -> localize -> END.
"""

from functools import lru_cache

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.agent import nodes
from app.agent.state import CaseState

MAX_CLARIFY = 2
MAX_REGENERATE = 1
LOW_CONFIDENCE = 0.45  # = scoring.MEDIUM: below this, live search (if enabled) is worth the delay


def after_intake(state: CaseState) -> str:
    return "refuse" if state.get("refused") else "triage"


def after_triage(state: CaseState) -> str:
    if state["triage"]["missing"] and state.get("clarify_count", 0) < MAX_CLARIFY:
        return "clarify"
    return "retrieve"


def after_retrieve(state: CaseState) -> str:
    if state.get("search_enabled") and state.get("retrieval_confidence", 0.0) < LOW_CONFIDENCE:
        return "live_search"
    return "verify"


def after_guardrail(state: CaseState) -> str:
    if not state["guard_ok"] and state.get("retries", 0) <= MAX_REGENERATE:
        return "synthesize"
    return "localize"


def build_graph() -> StateGraph:
    g = StateGraph(CaseState)
    for name in nodes.__all__:
        g.add_node(name, getattr(nodes, name))

    g.add_edge(START, "intake")
    g.add_conditional_edges("intake", after_intake, ["refuse", "triage"])
    g.add_conditional_edges("triage", after_triage, ["clarify", "retrieve"])
    g.add_conditional_edges("clarify", after_intake, ["refuse", "triage"])
    g.add_edge("refuse", "localize")
    g.add_conditional_edges("retrieve", after_retrieve, ["live_search", "verify"])
    g.add_edge("live_search", "verify")
    g.add_edge("verify", "synthesize")
    g.add_edge("synthesize", "action_draft")
    g.add_edge("action_draft", "guardrail")
    g.add_conditional_edges("guardrail", after_guardrail, ["synthesize", "localize"])
    g.add_edge("localize", END)
    return g


@lru_cache
def get_graph() -> CompiledStateGraph:
    # In-memory checkpointer: threads are lost on restart, which is what we want (nothing persisted).
    return build_graph().compile(checkpointer=InMemorySaver())

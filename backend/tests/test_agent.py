"""Whole-graph tests with a scripted model and fake retrieval: no network, no embeddings."""

import json

import pytest

from app import llm, rag
from app.agent.nodes.triage import Triage
from app.agent.nodes.verify import RemedyCheck, Verification
from app.schemas import Answer, Citation, RecommendedPath
from tests.test_api import client, sse_events

REMEDIES = [
    {"name": "Same-person affidavit attested by an executive magistrate", "outcome": "unknown"},
    {"name": "Notarised name affidavit plus newspaper notice", "outcome": "unknown"},
]


def _hit(id, cos, *, source, reliability, text, **extra):
    meta = {
        "title": f"title {id}",
        "url": f"https://example.org/{id}",
        "source_type": source,
        "reliability": reliability,
        "date": "2026-10",
        "service": "reissue",
        **extra,
    }
    return {"id": id, "text": text, "metadata": meta, "score": cos}


RULE = _hit("r-name-001#0", 0.89, source="official", reliability=5, text="Name differences need an affidavit.")
CASE = _hit(
    "c-name-disc-001",
    0.90,
    source="lawyer_qa",
    reliability=3,
    text="Aadhaar vs Class 10 name.",
    category="name_discrepancy",
    conflict_note="Sources disagree on the attestation route.",
    remedies=json.dumps(REMEDIES),
)


def answer(*, cites=("c-name-disc-001",), confidence="high", diagnosis="Your two documents show different names."):
    citations = [
        Citation(source_id=c, title=c, url=f"https://example.org/{c}", source_type="lawyer_qa", date=None)
        for c in cites
    ]
    return Answer(
        diagnosis=diagnosis,
        likely_causes=["Name differs"],
        recommended_path=RecommendedPath(
            name="Affidavit", steps=["Prepare an affidavit"], documents_needed=[], where="PSK"
        ),
        alternatives=[],
        conflicts=[],
        similar_cases=[],
        citations=citations,
        confidence=confidence,
        unknowns=[],
        escalation=["Passport Seva grievance"],
    )


class ScriptedModel:
    """Stands in for llm.structured. `answers` are returned in order, the last one repeats."""

    def __init__(self, answers, verification=None):
        self.answers, self.verification, self.calls = list(answers), verification, []

    async def __call__(self, schema, **kwargs):
        self.calls.append(schema.__name__)
        if schema is Triage:
            return Triage(
                service="reissue",
                stage="on_hold",
                category="name_discrepancy",
                urgency="normal",
                summary_en="Name differs between Aadhaar and Class 10",
                missing=[],
                clarify_question=None,
            )
        if schema is Verification:
            if isinstance(self.verification, Exception):
                raise self.verification
            return self.verification or Verification(checks=[])
        assert schema is Answer
        return self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]


@pytest.fixture
def live(monkeypatch):
    async def provider():
        return "anthropic"

    monkeypatch.setattr(llm, "active_provider", provider)
    monkeypatch.setattr(rag, "index_ready", lambda: True)
    monkeypatch.setattr(rag, "search", lambda name, q, k, where=None: [RULE] if name == rag.RULES else [CASE])

    def install(model):
        monkeypatch.setattr(llm, "structured", model)
        return model

    return install


def run(text="The name on my Aadhaar differs from my Class 10 certificate"):
    events = sse_events(client.post("/api/case", json={"text": text, "consent": True}))
    return [d["node"] for n, d in events if n == "progress"], events[-1]


def test_full_live_path_cites_flags_conflicts_and_drafts(live):
    model = live(
        ScriptedModel(
            [answer()],
            Verification(checks=[RemedyCheck(index=0, conflicts_with_official=True, note="rule says notary")]),
        )
    )
    nodes, (name, result) = run()
    assert nodes == ["intake", "triage", "retrieve", "verify", "synthesize", "action_draft", "guardrail", "localize"]
    assert name == "result" and model.calls == ["Triage", "Verification", "Answer"]
    assert [c["source_id"] for c in result["answer"]["citations"]] == ["c-name-disc-001"]
    assert "[____]" in result["draft"] and "AFFIDAVIT" in result["draft"]
    assert result["answer"]["disclaimer"]


def test_hallucinated_citation_triggers_one_regenerate(live):
    model = live(ScriptedModel([answer(cites=("made-up-99",)), answer()]))
    nodes, (_, result) = run()
    assert nodes.count("synthesize") == 2 and model.calls.count("Answer") == 2
    assert [c["source_id"] for c in result["answer"]["citations"]] == ["c-name-disc-001"]


def test_persistent_failure_abstains_instead_of_shipping_a_bad_answer(live):
    live(ScriptedModel([answer(cites=("made-up-99",))]))
    nodes, (_, result) = run()
    assert nodes.count("synthesize") == 2
    assert "could not produce a reliable answer" in result["answer"]["diagnosis"]
    assert result["answer"]["confidence"] == "low" and result["answer"]["escalation"]


def test_outcome_promise_is_caught(live):
    live(ScriptedModel([answer(diagnosis="Your passport will be approved within a week, guaranteed."), answer()]))
    nodes, (_, result) = run()
    assert nodes.count("synthesize") == 2 and "guaranteed" not in result["answer"]["diagnosis"]


def test_confidence_is_capped_by_the_evidence(live, monkeypatch):
    live(ScriptedModel([answer(confidence="high")]))
    monkeypatch.setattr(
        rag, "search", lambda name, q, k, where=None: [{**CASE, "score": 0.84}] if name == rag.CASES else []
    )
    _, (_, result) = run()
    assert result["answer"]["confidence"] == "medium"  # asked for high, but one mid-strength community source


def test_failing_verify_call_does_not_fail_the_case(live):
    live(ScriptedModel([answer()], RuntimeError("model down")))
    _, (name, result) = run()
    assert name == "result" and result["answer"]["citations"]


def test_empty_index_still_answers_with_low_confidence(live, monkeypatch):
    live(ScriptedModel([answer(cites=(), confidence="high")]))
    monkeypatch.setattr(rag, "index_ready", lambda: False)
    _, (name, result) = run()
    assert name == "result" and result["answer"]["confidence"] == "low"


def test_no_relevant_sources_means_an_honest_abstain_with_no_model_answer_call(live, monkeypatch):
    model = live(ScriptedModel([answer()]))
    monkeypatch.setattr(rag, "search", lambda name, q, k, where=None: [])
    _, (name, result) = run()
    assert name == "result" and "won't guess" in result["answer"]["diagnosis"]
    assert "Answer" not in model.calls and result["answer"]["confidence"] == "low" and result["answer"]["escalation"]


def test_pv_problem_without_a_status_asks_the_fixed_question_in_the_users_language(live):
    class PvModel(ScriptedModel):
        async def __call__(self, schema, **kwargs):
            if schema is Triage:
                return Triage(
                    service="reissue",
                    stage="police_verification",
                    category="pv_delay",
                    urgency="normal",
                    summary_en="PV pending six weeks",
                    missing=[],
                    clarify_question=None,
                )
            return await super().__call__(schema, **kwargs)

    live(PvModel([answer()]))
    r = client.post("/api/case", json={"lang": "hi", "text": "पुलिस वेरिफिकेशन छह हफ़्ते से बाकी है", "consent": True})
    name, clarify = sse_events(r)[-1]
    assert name == "clarify" and "प्रतिकूल" in clarify["question"]

    resumed = sse_events(client.post("/api/case/resume", json={"thread_id": clarify["thread_id"], "text": "initiated"}))
    assert resumed[-1][0] == "result"  # asked once, never twice


def test_source_ids_never_appear_inside_sentences(live):
    messy = answer(
        diagnosis="Your names differ [c-name-disc-001]. Prepare an affidavit [r-name-001#0, c-name-disc-001]."
    )
    messy.recommended_path.steps = ["Prepare an affidavit [r-name-001#0]", "Visit your office."]
    live(ScriptedModel([messy]))
    _, (_, result) = run()
    a = result["answer"]
    assert "[" not in a["diagnosis"] and a["diagnosis"] == "Your names differ. Prepare an affidavit."
    assert a["recommended_path"]["steps"][0] == "Prepare an affidavit"
    assert [c["source_id"] for c in a["citations"]] == ["c-name-disc-001"]  # the list keeps them

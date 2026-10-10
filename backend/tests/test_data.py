"""Every data file must load and validate; this is what `make ingest` relies on."""

from app.corpus import load_case_chunks, load_json, load_rule_chunks
from app.glossary import load_glossary
from app.schemas import Answer


def test_corpus_validates():
    assert load_rule_chunks()
    assert load_case_chunks()


def test_mock_answer_matches_contract():
    Answer.model_validate(load_json("fixtures/mock_answer.json"))


def test_glossary_and_status_map_load():
    assert load_glossary()
    assert all({"match", "meaning", "next"} <= set(e) for e in load_json("status_map.json"))


def test_pv_reference_totals_add_up():
    pv = load_json("reference/pv_pending_2025.json")
    assert sum(pv["by_state"].values()) == pv["total"] == 277929


def test_draft_templates_are_clean_blanks_only():
    from app.agent.drafts import TEMPLATES

    for category, text in TEMPLATES.items():
        assert "\\" not in text, f"stray backslash in the {category} template"
        assert text.count("[____]") >= 5 and text.startswith("DRAFT TEMPLATE")

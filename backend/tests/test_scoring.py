from datetime import date

from app.agent import scoring


def hit(id, cos, *, source="official", reliability=5, service="fresh", url=None, d="2026-10-10", category=None):
    meta = {
        "source_type": source,
        "reliability": reliability,
        "service": service,
        "date": d,
        "url": url or f"https://x/{id}",
    }
    if category:
        meta["category"] = category
    return {"id": id, "text": "", "metadata": meta, "score": cos}


def test_similarity_band_is_stretched():
    assert scoring.sim_norm(0.70) == 0 and scoring.sim_norm(0.95) == 1
    assert 0.4 < scoring.sim_norm(0.83) < 0.6


def test_recency_decays_and_unknown_is_middling():
    today = date(2026, 10, 10)
    assert scoring.recency("2026-03", today) == 1.0
    assert scoring.recency("2020", today) == 0.5
    assert scoring.recency("unknown", today) == 0.6 == scoring.recency(None, today)


def test_official_outranks_equally_similar_community_post():
    ranked = scoring.rank(
        [hit("blog", 0.86, source="blog", reliability=2), hit("rule", 0.86)], service="fresh", category="other", k=2
    )
    assert [h["id"] for h in ranked] == ["rule", "blog"]


def test_wrong_service_is_demoted():
    ranked = scoring.rank(
        [hit("evisa", 0.90, service="evisa"), hit("fresh", 0.86)], service="fresh", category="other", k=2
    )
    assert ranked[0]["id"] == "fresh"


def test_matching_category_gets_a_boost():
    ranked = scoring.rank(
        [
            hit("a", 0.86, source="lawyer_qa", category="adverse_pv"),
            hit("b", 0.86, source="lawyer_qa", category="dob_mismatch"),
        ],
        service="fresh",
        category="dob_mismatch",
        k=2,
    )
    assert ranked[0]["id"] == "b"


def test_community_posts_dedupe_by_url_but_official_chunks_do_not():
    posts = [hit("c1", 0.9, source="forum", url="https://f/1"), hit("c2", 0.88, source="forum", url="https://f/1")]
    assert len(scoring.rank(posts, service="fresh", category="other", k=5)) == 1
    chunks = [hit("r#0", 0.9, url="https://o/1"), hit("r#1", 0.88, url="https://o/1")]
    assert len(scoring.rank(chunks, service="fresh", category="other", k=5)) == 2


def test_merge_keeps_best_score():
    merged = scoring.merge([hit("a", 0.80)], [hit("a", 0.88), hit("b", 0.7)])
    assert {h["id"]: h["score"] for h in merged} == {"a": 0.88, "b": 0.7}


def test_confidence_levels():
    strong = scoring.confidence(
        [hit("r1", 0.91), hit("r2", 0.88)], [hit("c1", 0.89, source="lawyer_qa", reliability=3)]
    )
    assert scoring.level(strong) == "high"
    assert scoring.level(scoring.confidence([], [])) == "low"
    assert scoring.level(scoring.confidence([hit("r", 0.74)], [hit("c", 0.74, source="forum", reliability=2)])) == "low"


def test_community_only_evidence_never_reports_high():
    value = scoring.confidence([], [hit("c1", 0.95, source="lawyer_qa"), hit("c2", 0.93, source="lawyer_qa")])
    assert value <= scoring.COMMUNITY_ONLY_CAP and scoring.level(value) != "high"


def test_unrelated_chunks_are_dropped_even_if_few_sources_exist():
    ranked = scoring.rank([hit("noise", 0.75), hit("match", 0.88)], service="fresh", category="other", k=5)
    assert [h["id"] for h in ranked] == ["match"]
    assert scoring.rank([hit("noise", 0.75)], service="fresh", category="other", k=5) == []


def test_visa_evidence_is_excluded_from_passport_problems_and_vice_versa():
    hits = [hit("evisa-rule", 0.90, service="evisa"), hit("passport-rule", 0.88, service="fresh,reissue")]
    assert [h["id"] for h in scoring.rank(hits, service="other", category="other", k=5, domain="passport")] == [
        "passport-rule"
    ]
    assert [h["id"] for h in scoring.rank(hits, service="evisa", category="other", k=5, domain="evisa")] == [
        "evisa-rule"
    ]


def test_domain_detection():
    assert scoring.domain_of("evisa", "anything") == "evisa"
    assert scoring.domain_of("other", "How long does my e-Visa take?") == "evisa"
    assert scoring.domain_of("reissue", "Aadhaar name differs") == "passport"

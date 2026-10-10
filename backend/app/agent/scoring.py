"""Ranking and confidence for retrieved chunks (plan section 3.4, Retrieval design).

multilingual-e5-small cosine scores bunch high: measured on the seed corpus, relevant queries score
0.85-0.92 and unrelated ones 0.70-0.76. SIM_FLOOR/SIM_CEIL stretch that band to 0..1.
Re-measure with `make query` whenever the corpus grows a lot or the embedding model changes.
"""

import re
from datetime import date

from app.rag import Hit

SIM_FLOOR = 0.76
SIM_CEIL = 0.90

# Normalised similarity below this is noise: better no source than an unrelated one. Measured on the seed corpus:
# true matches 0.76-0.96, a topically near but wrong case 0.27-0.34. Re-measure when the corpus grows.
MIN_RELEVANCE = 0.45
OFFICIAL_TYPES = {"official", "court", "parliament"}

# confidence() weights: how well it matched, how many sources agree, how reliable they are
_W_TOP, _W_AGREE, _W_RELIABILITY = 0.6, 0.2, 0.2
COMMUNITY_ONLY_CAP = 0.6  # no official rule matched: never report high confidence

HIGH, MEDIUM = 0.75, 0.45


_VISA_WORDS = re.compile(r"e-?visa|\bvisa\b|वीज़ा|वीजा|விசா|ভিসা|व्हिसा", re.IGNORECASE)


def domain_of(service: str, text: str) -> str:
    """Indian e-Visa for foreigners and passport problems never share evidence."""
    return "evisa" if service == "evisa" or _VISA_WORDS.search(text) else "passport"


def _hit_domain(hit: Hit) -> str:
    return "evisa" if "evisa" in _services(hit) else "passport"


def sim_norm(cosine: float) -> float:
    return min(1.0, max(0.0, (cosine - SIM_FLOOR) / (SIM_CEIL - SIM_FLOOR)))


def recency(date_text: str | None, today: date | None = None) -> float:
    """1.0 for the last year, easing to 0.5 at five years. Unknown dates get a middling 0.6."""
    match = re.match(r"^(\d{4})(?:-(\d{2}))?", date_text or "")
    if not match:
        return 0.6
    today = today or date.today()
    age = today.year - int(match.group(1)) + (today.month - int(match.group(2) or 6)) / 12
    return 1.0 if age <= 1 else max(0.5, 1.0 - (age - 1) * 0.125)


def _services(hit: Hit) -> set[str]:
    return set(str(hit["metadata"].get("service", "")).split(","))


def score(hit: Hit, *, service: str, category: str) -> float:
    m = hit["metadata"]
    value = 0.65 * sim_norm(hit["score"])
    value += 0.15 * (int(m.get("reliability", 3)) - 1) / 4
    value += 0.10 * recency(m.get("date"))
    if m.get("source_type") in OFFICIAL_TYPES:
        value += 0.10  # official sources outrank community ones
    if service != "other" and service not in _services(hit):
        value -= 0.20  # a rule or case for a different service
    if category != "other" and m.get("category") == category:
        value += 0.08
    return value


def merge(*result_lists: list[Hit]) -> list[Hit]:
    """Same chunk found by several queries: keep its best similarity."""
    best: dict[str, Hit] = {}
    for hits in result_lists:
        for hit in hits:
            if hit["id"] not in best or hit["score"] > best[hit["id"]]["score"]:
                best[hit["id"]] = hit
    return list(best.values())


def rank(hits: list[Hit], *, service: str, category: str, k: int, domain: str | None = None) -> list[Hit]:
    relevant = [
        h for h in hits if sim_norm(h["score"]) >= MIN_RELEVANCE and (domain is None or _hit_domain(h) == domain)
    ]
    ordered = sorted(relevant, key=lambda h: score(h, service=service, category=category), reverse=True)
    seen: set[str] = set()
    out: list[Hit] = []
    for hit in ordered:
        m = hit["metadata"]
        # Community posts: one chunk per URL. Official pages legitimately contribute several chunks.
        key = hit["id"] if m.get("source_type") in OFFICIAL_TYPES else str(m.get("url") or hit["id"])
        if key in seen:
            continue
        seen.add(key)
        out.append(hit)
        if len(out) == k:
            break
    return out


def confidence(rule_hits: list[Hit], case_hits: list[Hit]) -> float:
    """0..1 from match quality, agreement between sources and source reliability."""
    hits = rule_hits + case_hits
    if not hits:
        return 0.0
    sims = sorted((sim_norm(h["score"]) for h in hits), reverse=True)
    top = sims[0]
    agreement = min(3, sum(1 for s in sims if s >= 0.5)) / 3
    top3 = sorted(hits, key=lambda h: h["score"], reverse=True)[:3]
    reliability = sum((int(h["metadata"].get("reliability", 3)) - 1) / 4 for h in top3) / len(top3)
    value = _W_TOP * top + _W_AGREE * agreement + _W_RELIABILITY * reliability
    if not any(sim_norm(h["score"]) >= 0.4 for h in rule_hits):
        value = min(value, COMMUNITY_ONLY_CAP)
    return round(value, 3)


def level(value: float) -> str:
    return "high" if value >= HIGH else "medium" if value >= MEDIUM else "low"

"""Load and validate the knowledge corpus (plan section 4.3). Used by scripts/ingest.py and tests.

Files whose name starts with "_" (templates) are skipped.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from app.config import DATA_DIR

RULES_DIR = DATA_DIR / "rules"
CASES_DIR = DATA_DIR / "cases"

RULE_REQUIRED = ("id", "title", "url", "source_type", "date_retrieved", "reliability", "verified", "service")
CASE_REQUIRED = ("id", "category", "service", "situation", "remedies_reported", "source", "reliability", "your_summary")
SOURCE_REQUIRED = ("title", "url", "type", "date")


class CorpusError(ValueError):
    pass


@dataclass
class Chunk:
    id: str
    text: str
    metadata: dict[str, str | int | float | bool] = field(default_factory=dict)


def _files(directory: Path, suffix: str) -> list[Path]:
    return sorted(p for p in directory.glob(f"*{suffix}") if not p.name.startswith("_"))


def _check_reliability(value: object, where: str, errors: list[str]) -> None:
    if not isinstance(value, int) or not 1 <= value <= 5:
        errors.append(f"{where}: reliability must be an integer 1-5, got {value!r}")


def load_rule_chunks() -> list[Chunk]:
    """rules/*.md: YAML front matter + markdown body, split into one chunk per '## ' heading."""
    chunks: list[Chunk] = []
    errors: list[str] = []
    for path in _files(RULES_DIR, ".md"):
        raw = path.read_text(encoding="utf-8")
        match = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.DOTALL)
        if not match:
            errors.append(f"{path.name}: missing YAML front matter")
            continue
        meta = yaml.safe_load(match.group(1)) or {}
        missing = [k for k in RULE_REQUIRED if meta.get(k) in (None, "", [])]
        if missing:
            errors.append(f"{path.name}: missing {', '.join(missing)}")
            continue
        _check_reliability(meta["reliability"], path.name, errors)

        sections = [s.strip() for s in re.split(r"^(?=## )", match.group(2), flags=re.MULTILINE) if s.strip()]
        for i, section in enumerate(sections):
            chunks.append(
                Chunk(
                    id=f"{meta['id']}#{i}",
                    text=f"{meta['title']}\n\n{section}",
                    metadata={
                        "doc_id": meta["id"],
                        "title": meta["title"],
                        "url": meta["url"],
                        "source_type": meta["source_type"],
                        "date": str(meta["date_retrieved"]),
                        "reliability": meta["reliability"],
                        "verified": bool(meta["verified"]),
                        "service": ",".join(meta["service"]),
                    },
                )
            )
    if errors:
        raise CorpusError("Invalid rule files:\n  " + "\n  ".join(errors))
    return chunks


def load_case_chunks() -> list[Chunk]:
    """cases/*.json: one case card (or a list of cards) per file, one chunk per card."""
    chunks: list[Chunk] = []
    errors: list[str] = []
    seen: set[str] = set()
    for path in _files(CASES_DIR, ".json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        for card in data if isinstance(data, list) else [data]:
            where = f"{path.name}:{card.get('id', '?')}"
            missing = [k for k in CASE_REQUIRED if card.get(k) in (None, "", [])]
            missing += [f"source.{k}" for k in SOURCE_REQUIRED if not (card.get("source") or {}).get(k)]
            if missing:
                errors.append(f"{where}: missing {', '.join(missing)}")
                continue
            if card["id"] in seen:
                errors.append(f"{where}: duplicate id")
                continue
            seen.add(card["id"])
            _check_reliability(card["reliability"], where, errors)

            remedies = "; ".join(r["name"] for r in card["remedies_reported"])
            chunks.append(
                Chunk(
                    id=card["id"],
                    text=f"{card['situation']}\n\n{card['your_summary']}\n\nRemedies reported: {remedies}",
                    metadata={
                        "category": card["category"],
                        "service": card["service"],
                        "title": card["source"]["title"],
                        "url": card["source"]["url"],
                        "source_type": card["source"]["type"],
                        "date": str(card["source"]["date"]),
                        "reliability": card["reliability"],
                        "conflict_note": card.get("conflict_note", ""),
                        "remedies": json.dumps(card["remedies_reported"], ensure_ascii=False),
                    },
                )
            )
    if errors:
        raise CorpusError("Invalid case files:\n  " + "\n  ".join(errors))
    return chunks


def load_json(name: str) -> object:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))

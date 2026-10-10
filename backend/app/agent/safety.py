"""Deterministic refusal of requests to forge, alter or back-date documents (plan section 6).

Runs in `intake` before any model is called, so it holds with Claude, a small local model, or mock.
The model prompt (rule 6) and the guardrail node are additional layers, not substitutes.
"""

import re

from app.schemas import Answer, RecommendedPath

_DOC = "|".join(
    ["document", "certificate", "agreement", "affidavit", "aadhaar", "aadhar", "passport", "bill", "stamp"]
    + ["signature", "seal", "marksheet", "receipt", "proof", "letter", "notice"]
)
_FORGE = r"fake|forg(?:e|ed|ery)|fabricat(?:e|ed)|counterfeit|fictitious|bogus|dummy"
_ALTER = r"change|alter|edit|modify|tamper|manipulate"
_FIELD = r"date of birth|dob|birth date|age"
_AFTER = r"[^.?!]{0,40}"

_PATTERNS = [
    re.compile(rf"\b(?:{_FORGE})\b{_AFTER}\b(?:{_DOC})", re.IGNORECASE),
    re.compile(r"\bback[\s-]?dat(?:e|ed|ing)\b", re.IGNORECASE),
    # "change my date of birth on my documents so they match": altering a fact to fit the papers
    re.compile(
        rf"\b(?:{_ALTER})\b[^.?!]{{0,30}}\b(?:{_FIELD})\b{_AFTER}\b(?:{_DOC})s?\b.*\b(?:match|same|agree)",
        re.IGNORECASE,
    ),
    # Hindi / Tamil / Bengali: fake, forged
    re.compile(r"(नकली|फर्जी|फ़र्ज़ी|जाली|बनावटी|போலி|জাল|নকল)"),
]


def is_unsafe(text: str) -> bool:
    return any(p.search(text) for p in _PATTERNS)


def refusal_answer() -> Answer:
    return Answer(
        diagnosis=(
            "I can't help create, change or back-date a document, or alter a fact so that papers match. "
            "That can lead to a rejected application and legal trouble. There is a proper way to fix a real mistake."
        ),
        likely_causes=[],
        recommended_path=RecommendedPath(
            name="Get the mistake corrected by the authority that issued the document",
            steps=[
                "Find which document has the wrong detail.",
                "Ask the authority that issued it to correct it: the school board, the birth registrar, "
                "or UIDAI for Aadhaar.",
                "Submit the supporting proof that authority asks for.",
                "Once it is corrected, apply with the corrected document.",
            ],
            documents_needed=["The document with the mistake", "Any proof of the correct detail"],
            where="The issuing authority",
        ),
        alternatives=[],
        conflicts=[],
        similar_cases=[],
        citations=[],
        confidence="high",
        unknowns=[],
        escalation=["Passport Seva grievance", "CPGRAMS (pgportal.gov.in)", "A lawyer, if the case is complicated"],
    )

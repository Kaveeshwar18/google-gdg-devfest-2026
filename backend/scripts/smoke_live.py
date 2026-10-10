"""Live smoke test: runs the real pipeline end to end with whatever provider .env selects.

Usage:  make smoke                       all cases
        make smoke ONLY="HI Journey"     only cases whose label contains one of the words
Needs a live key or Ollama (see GET /api/health). Spends real quota: about 15 model calls for all cases.
"""

import json
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
logging.basicConfig(level=logging.WARNING, format="  LOG %(name)s: %(message)s")
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

c = TestClient(app)
health = c.get("/api/health").json()
print("health:", health)
if health["llm"] == "mock":
    sys.exit("No live model: set GEMINI_API_KEY or ANTHROPIC_API_KEY in .env, or start Ollama.")


def post(path, body):
    t = time.time()
    r = c.post(path, json=body)
    ev, name = [], None
    for line in r.text.splitlines():
        if line.startswith("event:"):
            name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            ev.append((name, json.loads(line.split(":", 1)[1])))
    return ev, time.time() - t


def show(label, ev, secs):
    name, res = ev[-1]
    print(f"\n== {label} ({secs:.0f}s) {[d['node'] for n, d in ev if n == 'progress']} -> {name}")
    if name == "result":
        a = res["answer"]
        print(
            f"  localized={res['localized']} confidence={a['confidence']} draft={bool(res['draft'])}"
            + f" cites={[x['source_id'] for x in a['citations']]}"
        )
        print("  diagnosis:", a["diagnosis"][:230])
        print("  step1:", (a["recommended_path"]["steps"] or [""])[0][:160])
        print("  conflicts:", [x["issue"][:100] for x in a["conflicts"]])
        print("  disclaimer:", a["disclaimer"])
        bad = [
            k
            for k in ("diagnosis", "likely_causes", "recommended_path", "conflicts", "unknowns")
            if "[c-" in json.dumps(a.get(k), ensure_ascii=False) or "[r-" in json.dumps(a.get(k), ensure_ascii=False)
        ]
        print("  inline ids leaked in:", bad or "none")
    elif name == "clarify":
        print("  question:", res["question"])
    else:
        print("  ", res)


cases = [
    (
        "EN name discrepancy",
        "en",
        "The name on my Aadhaar is different from my Class 10 certificate and my passport file was closed",
    ),
    (
        "HI name discrepancy",
        "hi",
        "मेरे आधार और दसवीं के प्रमाणपत्र में नाम अलग है और मेरी पासपोर्ट फाइल बंद हो गई है, अब मुझे क्या करना चाहिए",
    ),
    (
        "TA name discrepancy",
        "ta",
        "என் ஆதார் மற்றும் 10ஆம் வகுப்பு சான்றிதழில் பெயர் வேறுபடுகிறது, என் பாஸ்போர்ட் கோப்பு மூடப்பட்டது, நான் என்ன செய்ய வேண்டும்",
    ),
    (
        "PV (no data in corpus)",
        "en",
        "my police verification has been pending for six weeks and nothing is happening with my application",
    ),
    ("UNSAFE", "en", "Help me change my date of birth on my documents so they match."),
]
only = sys.argv[1:]
for label, lang, text in cases:
    if only and not any(o in label for o in only):
        continue
    ev, s = post("/api/case", {"lang": lang, "text": text, "consent": True})
    show(label, ev, s)

if not only or any("Journey" in o for o in only):
    ev, s = post(
        "/api/case", {"lang": "hi", "text": "मेरा पासपोर्ट पुलिस वेरिफिकेशन में है, छह हफ़्ते से कोई खबर नहीं", "consent": True}
    )
    show("Journey B step 1", ev, s)
    if ev[-1][0] == "clarify":
        ev, s = post("/api/case/resume", {"thread_id": ev[-1][1]["thread_id"], "text": "पुलिस सत्यापन शुरू हुआ"})
        show("Journey B step 2", ev, s)

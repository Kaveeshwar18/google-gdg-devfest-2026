# Handoff: Lane A (Agent) state

Written at the end of the Lane A build session. Read this, `TEAM.md` and `README.md`, and you can continue.

## Where things stand

**Lane A is built and tested.** `make check` passes: 59 backend tests, 4 frontend tests, lint, typecheck, build.
**Nothing from this session is committed** (two sessions of work now). `git status` shows the changes; commit and open a PR when ready:

```bash
git add -A && git commit -m "Lane A: provider switch, retrieval scoring, verify, guardrail, drafts, safety, rate limiting"
```

```bash
git push && gh pr create --repo Kaveeshwar18/google-gdg-devfest-2026 --base main --head Beni-18:main --fill
```

## Model decision

| Provider | When | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` set | Main = `claude-sonnet-5-5`, fast = `claude-haiku-4-5` (the plan's `claude-haiku-5-5` does not exist) |
| `gemini` | `GEMINI_API_KEY` set (and no Claude key) | Free tier, `gemini-2.5-flash` (answers) and `-flash-lite` (triage); ids and limits unverified, confirm in AI Studio. Client-side limiter `GEMINI_RPM=8`. Structured output uses `response_json_schema`; if Gemini rejects the schema we retry with it in the prompt. **Verified live 2026-10-10** (key in `.env`, git-ignored). Model *chains* in `.env` (`GEMINI_MODELS_MAIN/FAST`): `gemini-3.8-flash` first (thinking LOW), then `3.5-flash`, `3-flash-preview`, lite models. **Free quota is per model per day (3.8-flash = 20/day, already used up today)**: a spent model is skipped instantly, 5xx/timeouts move to the next model, identical calls are cached in memory, and if all are spent it falls back to local Qwen. `gemini-2.5-flash` 404s. |
| `ollama` | no key, Ollama running with the model pulled | **`qwen2.5:3b`**, already on this Mac. Chosen over Llama: Llama 3.2 3B is a 2 GB download and the disk has about 2 GB free; Qwen is also better at Hindi/Tamil and JSON schemas |
| `mock` | neither | Canned answer from `data/fixtures/mock_answer.json` |

`LLM_PROVIDER=auto` (default) picks the first available: Claude, then Gemini, then local, then mock. Force one with `LLM_PROVIDER=ollama|anthropic|mock`.
Code: `backend/app/llm.py`. The UI shows a banner for `local` and `mock` (`GET /api/health` returns `llm`).

## Hardware limits (this Mac)

Apple M2, **8 GB RAM, about 2 GB free disk**. A 3B local model takes 15 to 60 s per answer. Do not pull large models. Claude will be much faster.

## What was built (all in `backend/app/`)

- `llm.py`: provider switch; Ollama structured output via JSON schema with one retry.
- `agent/safety.py` + `nodes/refuse.py`: forge/alter/back-date requests refused before any model call (graph: `intake|clarify -> refuse -> localize`).
- `agent/scoring.py` + `nodes/retrieve.py`: merged queries, `MIN_RELEVANCE`, official/reliability/recency weighting, e-Visa vs passport domain exclusion, confidence formula.
- `nodes/verify.py`: remedies from case cards checked against official rules; recorded conflicts surfaced.
- `nodes/synthesize.py`: gets verified remedies and an evidence ceiling; no sources means an honest abstain with no model call.
- `nodes/guardrail.py`: citations must be in the retrieved set, no outcome promises or forgery advice, confidence capped by evidence, one regenerate then abstain.
- `agent/drafts.py` + `nodes/action_draft.py`: name-affidavit and RPO-letter templates, blanks only, no model.
- `agent/questions.py`: fixed Journey B question in en/hi/ta/mr/bn. **The hi/ta/mr/bn wording is unreviewed by a native speaker (Lane D to check).**
- `ratelimit.py`: per IP and per thread (60/min default), plus `case_timeout_s`.
- Contract change: `Health.llm` is now `live | local | mock` (`schemas.py` and `frontend/src/lib/types.ts`).
- Small Lane C touches: local-mode banner (`Layout.tsx`, `i18n/en/app.json`) and the empty "Sources" heading hidden in `AnswerCard.tsx`.

## Verified live (local Qwen, real index, real ingest)

English and Hindi name-discrepancy cases cite only the right card and show the attestation conflict; a PV-delay case with no data abstains honestly and attaches the RPO letter; unsafe prompts are refused instantly; Journey B asks the Hindi question in the UI and answers after.

## Operations notes

- Gemini quota resets daily (Pacific time). `make smoke` costs about 15 calls: do not run it casually. Watch `mitra.llm` log lines ("daily free quota used up", "overloaded", "switching models").
- Before the demo: run the scripted scenarios once so the in-memory cache holds them (cleared on server restart, never written to disk by design), and consider enabling billing on the Google project if the demo must not depend on free quota.
- The UI section headings on the answer card are still English; hi/ta/mr/bn UI strings are Lane D's.

## Not done / next steps (in order)

0. **Gemini is verified live** (`make smoke` re-runs EN/HI/TA/unsafe/Journey B). The Gemini key was pasted into a chat, so **rotate it in AI Studio after the hackathon**. Privacy: free-tier prompts may be used by Google; see the README note.
1. **First run with a real Claude key.** Put `ANTHROPIC_API_KEY` in `.env`, run `make dev`, test Journeys A and B, tune `SYNTHESIZE_SYSTEM` and `TRIAGE_SYSTEM` in `agent/prompts.py`. Untested with Claude: the `fallbacks="default"` beta call in `llm.py` (request building was checked with a dummy key, which returned the expected 401).
2. ~~Recalibrate scoring~~ **Done after pulling Lane D's data** (47 rule chunks, 16 case cards): `SIM_FLOOR/CEIL/MIN_RELEVANCE` hold. 12/12 relevant probes answered, cake/cricket/car-loan return nothing, a US-visa question still matches an e-Visa chunk but ends at low confidence. Known weak spot: for a name-difference query the top *rule* is an address-proof chunk (the case cards carry the answer); consider a `topic` field on rules.
3. `live_search` is still a stub (stretch, cut first).
4. `translation.localize_answer` is implemented (Gemini-verified in Hindi and Tamil; mr/bn untested). Lane D must have native speakers review the glossary, `DISCLAIMER_LOCAL`, `questions.py` wording and UI strings.
5. Document corrections are in `TEAM.md` ("Where the data comes from") and the README corrections list: the date-of-birth rule is outdated (1 Oct 2023 cutoff, unverified), A/B/C counters unverified, name tolerance is our judgment.

## Gotchas

- Port 8000 is used by another project on this Mac: use `make dev API_PORT=8010`.
- `make` fails inside the Claude preview runner (macOS `getcwd` permission); `.claude/launch.json` calls `uv` and `npm` directly.
- Pushing `.github/workflows/*` needs the `workflow` scope: `gh auth refresh -h github.com -s workflow`.
- macOS `sed -i` needs `sed -i ''`. Do not chain commands with `&&` after one that can fail.
- Tests are offline and mock-by-default (`tests/conftest.py`); agent tests script the model in `tests/test_agent.py`.
- The Ollama server is not started automatically: `ollama serve` (the backend probes it every 30 s).

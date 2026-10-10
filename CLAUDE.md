# Passport Mitra

Hackathon app (5-hour build, team of four). Plan: `docs/implementation.md`. Run and layout: `README.md`.

**Ownership: `TEAM.md`.** Edit only files owned by the lane you're working for. Shared files (the contract, lockfiles) need a heads-up first.

## Commands

- `make dev`: API on :8000 + web on :5173 (Vite proxies `/api`)
- `make check`: ruff, pytest, oxlint, tsc, vitest. Must pass before pushing.
- `make ingest`: rebuild the Chroma index after editing `backend/data/rules` or `backend/data/cases`
- Backend only: `cd backend && uv run pytest -q`. Frontend only: `cd frontend && npm test`

## Conventions

- `backend/app/schemas.py` is the API contract; `frontend/src/lib/types.ts` mirrors it. Change both together.
- All model calls go through `app/llm.py` `structured()` (Claude, local Ollama, or mock; check `await llm.active_provider()`). Model IDs come from settings, never hardcoded.
- One file per graph node in `backend/app/agent/nodes/`. Routing lives only in `agent/graph.py`.
- Stubs are marked `TODO(agent|cart|frontend|voice)` by owning lane.
- UI strings go in `frontend/src/i18n/en/<area>.json` first (one area file per lane); never hardcode user-facing text in components.
- Tests run in mock mode with an empty index (`backend/tests/conftest.py`); keep them offline.

## Never

- Log or persist user text, document images or document values. Log node names, latency, error types.
- Send document photos to the server, or anything about Aadhaar beyond the last 4 digits.
- Ship an answer without citations, a confidence level and the disclaimer.
- Say "will be rejected" or promise outcomes/timelines. Drafts are templates with `[____]` blanks.

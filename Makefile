.PHONY: help setup dev backend frontend ingest query smoke test lint check

# Port busy? make dev API_PORT=8010
API_PORT ?= 8000

help: ## List commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-10s %s\n", $$1, $$2}'

setup: ## Install backend + frontend deps, create .env
	cd backend && uv sync
	cd frontend && npm ci
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example. Add your keys."; fi

dev: ## Run API (:8000) and web app (:5173) together
	$(MAKE) -j2 backend frontend

backend: ## API only, with reload
	cd backend && uv run uvicorn app.main:app --reload --reload-dir app --port $(API_PORT)

frontend: ## Web app only
	cd frontend && API_PORT=$(API_PORT) npm run dev

ingest: ## Rebuild the Chroma index from backend/data
	cd backend && uv run python scripts/ingest.py

query: ## Try retrieval: make query q="name differs on aadhaar"
	cd backend && uv run python scripts/query.py "$(q)"

smoke: ## Live end-to-end run on the configured model: make smoke ONLY="HI Journey"
	cd backend && uv run python scripts/smoke_live.py $(ONLY)

test: ## Backend + frontend tests
	cd backend && uv run pytest -q
	cd frontend && npm test

lint: ## Ruff, oxlint, TypeScript
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && npm run lint && npm run typecheck

check: lint test ## Everything CI runs. Do this before you push.

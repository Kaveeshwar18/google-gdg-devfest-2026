import os
import tempfile

import pytest

# Must run before app modules read settings: force offline, deterministic behaviour.
os.environ.update(
    MOCK_LLM="true",
    ANTHROPIC_API_KEY="",
    GEMINI_API_KEY="",
    SARVAM_API_KEY="",
    LLM_PROVIDER="auto",
    GEMINI_MODELS_MAIN="main-a,main-b,main-c",
    GEMINI_MODELS_FAST="fast-a,fast-b",
    LLM_CACHE="false",
    GEMINI_RPM="1000",
    OLLAMA_MODEL="ollama-test",
    CHROMA_DIR=tempfile.mkdtemp(prefix="mitra-test-chroma-"),
)


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    from app import llm, ratelimit

    ratelimit.reset()
    llm.reset_quota_state()
    llm.clear_cache()
    yield
    ratelimit.reset()

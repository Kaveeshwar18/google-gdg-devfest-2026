import json

import httpx
import pytest
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel

from app import llm
from app.config import get_settings

REAL_CLIENT = httpx.AsyncClient  # llm.httpx IS the httpx module: capture before any patching


class Pet(BaseModel):
    name: str
    legs: int


class _Settings:
    """Proxy so `settings.x = v` in a test is undone afterwards (the real settings object is cached)."""

    def __init__(self, real, monkeypatch):
        object.__setattr__(self, "_real", real)
        object.__setattr__(self, "_mp", monkeypatch)

    def __getattr__(self, name):
        return getattr(self._real, name)

    def __setattr__(self, name, value):
        self._mp.setattr(self._real, name, value)


@pytest.fixture
def settings(monkeypatch):
    """Settings with all provider env cleared; assignments are reverted after each test."""
    s = get_settings()
    for field, value in {
        "mock_llm": False,
        "llm_provider": "auto",
        "anthropic_api_key": "",
        "gemini_api_key": "",
    }.items():
        monkeypatch.setattr(s, field, value)
    monkeypatch.setattr(llm, "_ollama_probe", (0.0, False))
    return _Settings(s, monkeypatch)


def _ollama(monkeypatch, *, up: bool, model_present=True):
    async def probe():
        return up and model_present

    monkeypatch.setattr(llm, "_ollama_up", probe)


async def test_auto_prefers_claude_then_local_then_mock(settings, monkeypatch):
    _ollama(monkeypatch, up=True)
    assert await llm.active_provider() == "ollama"
    settings.anthropic_api_key = "sk-test"
    assert await llm.active_provider() == "anthropic"
    settings.anthropic_api_key = ""
    _ollama(monkeypatch, up=False)
    assert await llm.active_provider() == "mock"


async def test_explicit_provider_and_mock_flag_win(settings, monkeypatch):
    _ollama(monkeypatch, up=True)
    settings.anthropic_api_key = "sk-test"
    settings.llm_provider = "ollama"
    assert await llm.active_provider() == "ollama"
    settings.mock_llm = True
    assert await llm.active_provider() == "mock"


async def test_anthropic_without_a_key_falls_back_to_mock(settings):
    settings.llm_provider = "anthropic"
    assert await llm.active_provider() == "mock"


def _fake_ollama(monkeypatch, replies: list[str], seen: list[dict]):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"message": {"content": replies.pop(0)}})

    monkeypatch.setattr(
        llm.httpx, "AsyncClient", lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(handler), **kw)
    )


async def test_ollama_sends_schema_and_validates(settings, monkeypatch):
    _ollama(monkeypatch, up=True)
    settings.llm_provider = "ollama"
    seen: list[dict] = []
    _fake_ollama(monkeypatch, ['{"name": "cat", "legs": 4}'], seen)

    pet = await llm.structured(Pet, system="s", user="u", tier="fast")

    assert pet == Pet(name="cat", legs=4)
    assert seen[0]["format"] == Pet.model_json_schema() and seen[0]["stream"] is False
    assert seen[0]["model"] == settings.ollama_model


async def test_ollama_retries_once_on_invalid_json_then_gives_up(settings, monkeypatch):
    _ollama(monkeypatch, up=True)
    settings.llm_provider = "ollama"
    seen: list[dict] = []
    _fake_ollama(monkeypatch, ['{"name": "cat"}', '{"name": "dog", "legs": 4}'], seen)
    assert (await llm.structured(Pet, system="s", user="u")).name == "dog" and len(seen) == 2

    seen = []
    _fake_ollama(monkeypatch, ["nope", "still nope"], seen)
    with pytest.raises(ValueError, match="did not produce a valid Pet"):
        await llm.structured(Pet, system="s", user="u")
    assert len(seen) == 2


# ---------------------------------------------------------------- Gemini


def _gemini_ok(text: str):
    return genai_types.GenerateContentResponse(
        candidates=[genai_types.Candidate(content=genai_types.Content(parts=[genai_types.Part(text=text)]))]
    )


CAT = '{"name": "cat", "legs": 4}'


def _err(code: int, message: str = "x", cls=genai_errors.ClientError):
    return cls(code, {"error": {"code": code, "message": message}})


DAILY = (
    "You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20. "
    "Please retry in 14h20m57.2s. quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier retryDelay: '51657s'"
)


class FakeGemini:
    """Stands in for genai.Client. `script` items are responses to return or exceptions to raise, in order."""

    def __init__(self, script):
        self.script, self.calls = list(script), []
        self.aio = self
        self.models = self

    async def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture
def gemini(settings, monkeypatch):
    settings.gemini_api_key = "test-key"
    settings.llm_provider = "gemini"
    monkeypatch.setattr(settings, "gemini_rpm", 1000)
    llm._gemini_calls.clear()
    slept: list[float] = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(llm.asyncio, "sleep", fake_sleep)

    def install(script, *, chain=None):
        if chain:
            monkeypatch.setattr(settings, "gemini_models_main", chain)
        fake = FakeGemini(script)
        monkeypatch.setattr(llm, "_gemini_client", lambda: fake)
        fake.slept = slept
        return fake

    return install


def models_called(fake):
    return [c["model"] for c in fake.calls]


async def test_provider_order_is_claude_then_gemini_then_local(settings, monkeypatch):
    _ollama(monkeypatch, up=True)
    settings.gemini_api_key = "g"
    assert await llm.active_provider() == "gemini"  # a Gemini key beats a running local model
    settings.anthropic_api_key = "sk"
    assert await llm.active_provider() == "anthropic"
    settings.anthropic_api_key = ""
    settings.gemini_api_key = ""
    assert await llm.active_provider() == "ollama"


async def test_gemini_without_a_key_falls_back_to_mock(settings):
    settings.llm_provider = "gemini"
    assert await llm.active_provider() == "mock"


async def test_gemini_sends_json_schema_and_picks_the_chain_by_tier(gemini):
    fake = gemini([_gemini_ok(CAT), _gemini_ok('{"name": "dog", "legs": 4}')])
    assert await llm.structured(Pet, system="sys", user="usr", tier="main") == Pet(name="cat", legs=4)
    await llm.structured(Pet, system="sys", user="usr", tier="fast")

    assert models_called(fake) == ["main-a", "fast-a"]
    main = fake.calls[0]["config"]
    assert main.response_json_schema == Pet.model_json_schema() and main.response_mime_type == "application/json"
    assert fake.calls[0]["contents"] == "usr"
    assert main.thinking_config.thinking_level == genai_types.ThinkingLevel.LOW


async def test_gemini_schema_rejection_retries_with_schema_in_the_prompt(gemini):
    fake = gemini([_err(400, "schema too complex"), _gemini_ok(CAT)])
    assert (await llm.structured(Pet, system="sys", user="u")).name == "cat"
    retry = fake.calls[1]["config"]
    assert retry.response_json_schema is None and '"legs"' in retry.system_instruction


async def test_gemini_unsupported_thinking_level_is_dropped(gemini):
    fake = gemini([_err(400, "Thinking level LOW is not supported"), _gemini_ok(CAT)])
    assert (await llm.structured(Pet, system="s", user="u")).name == "cat"
    assert fake.calls[0]["config"].thinking_config is not None and fake.calls[1]["config"].thinking_config is None


async def test_gemini_safety_block_is_a_refusal_not_a_crash(gemini):
    blocked = genai_types.GenerateContentResponse(
        prompt_feedback=genai_types.GenerateContentResponsePromptFeedback(block_reason=genai_types.BlockedReason.SAFETY)
    )
    gemini([blocked])
    with pytest.raises(llm.LLMRefusal):
        await llm.structured(Pet, system="s", user="u")


async def test_gemini_invalid_json_retries_then_raises(gemini):
    fake = gemini([_gemini_ok("{}"), _gemini_ok("nope"), _gemini_ok("{}"), _gemini_ok("x")], chain="only")
    with pytest.raises(ValueError, match="did not produce a valid Pet"):
        await llm.structured(Pet, system="s", user="u")
    assert len(fake.calls) == 4


async def test_model_removed_moves_to_the_next_model(gemini):
    fake = gemini([_err(404, "no longer available to new users"), _gemini_ok(CAT)])
    assert (await llm.structured(Pet, system="s", user="u")).name == "cat"
    assert models_called(fake) == ["main-a", "main-b"]


async def test_overload_switches_models_without_retrying_the_busy_one(gemini):
    fake = gemini([_err(503, "high demand", genai_errors.ServerError), _gemini_ok(CAT)])
    assert (await llm.structured(Pet, system="s", user="u")).name == "cat"
    assert models_called(fake) == ["main-a", "main-b"] and fake.slept == []


async def test_last_model_overloaded_is_retried_a_couple_of_times(gemini):
    busy = _err(503, "high demand", genai_errors.ServerError)
    fake = gemini([busy, busy, _gemini_ok(CAT)], chain="only")
    assert (await llm.structured(Pet, system="s", user="u")).name == "cat" and len(fake.calls) == 3


async def test_slow_model_times_out_to_the_next_one(gemini):
    fake = gemini([TimeoutError("30s"), _gemini_ok(CAT)])
    assert (await llm.structured(Pet, system="s", user="u")).name == "cat"
    assert models_called(fake) == ["main-a", "main-b"]


async def test_per_minute_429_moves_on_but_waits_when_it_is_the_only_model(gemini):
    fake = gemini([_err(429, "slow down. retryDelay: '12s'"), _gemini_ok(CAT)])
    assert (await llm.structured(Pet, system="s", user="u")).name == "cat"
    assert models_called(fake) == ["main-a", "main-b"] and fake.slept == []

    fake = gemini([_err(429, "slow down. retryDelay: '12s'"), _gemini_ok(CAT)], chain="only")
    assert (await llm.structured(Pet, system="s", user="u")).name == "cat"
    assert fake.slept == [12.0] and models_called(fake) == ["only", "only"]


async def test_daily_quota_is_remembered_and_the_model_skipped_without_waiting(gemini):
    fake = gemini([_err(429, DAILY), _gemini_ok(CAT), _gemini_ok(CAT)])
    await llm.structured(Pet, system="s", user="one")
    await llm.structured(Pet, system="s", user="two")

    assert models_called(fake) == ["main-a", "main-b", "main-b"]  # main-a is never tried again
    assert fake.slept == []  # no 20 s waits on a quota that won't return for hours
    assert llm._exhausted["main-a"] > 0


async def test_every_model_out_of_quota_raises_unavailable(gemini, monkeypatch):
    _ollama(monkeypatch, up=False)
    gemini([_err(429, DAILY)] * 3)
    with pytest.raises(llm.LLMUnavailable):
        await llm.structured(Pet, system="s", user="u")
    with pytest.raises(llm.LLMUnavailable, match="out of free quota"):  # and now it doesn't even call out
        await llm.structured(Pet, system="s", user="u")


async def test_out_of_quota_uses_the_local_model(gemini, monkeypatch):
    gemini([_err(429, DAILY)] * 3)
    _ollama(monkeypatch, up=True)
    seen: list[dict] = []
    _fake_ollama(monkeypatch, ['{"name": "local", "legs": 3}'], seen)
    assert (await llm.structured(Pet, system="s", user="u")).name == "local" and seen


async def test_network_failure_falls_back_to_the_local_model(gemini, monkeypatch):
    gemini([OSError("dns")] * 4)  # three chain models, then the last one's retry
    _ollama(monkeypatch, up=True)
    seen: list[dict] = []
    _fake_ollama(monkeypatch, ['{"name": "local", "legs": 3}'], seen)
    assert (await llm.structured(Pet, system="s", user="u")).name == "local" and seen


async def test_network_failure_with_no_local_model_raises_unavailable(gemini, monkeypatch):
    gemini([OSError("dns")] * 4)
    _ollama(monkeypatch, up=False)
    with pytest.raises(llm.LLMUnavailable):
        await llm.structured(Pet, system="s", user="u")


def test_retry_delay_parsing():
    assert llm._retry_seconds(_err(429, "retryDelay: '51657s'")) == 51657.0
    assert llm._retry_seconds(_err(429, "Please retry in 1h2m3.5s.")) == 3723.5
    assert llm._retry_seconds(_err(429, "no hint")) == 20.0


async def test_identical_calls_are_answered_from_the_cache(gemini, settings, monkeypatch):
    monkeypatch.setattr(settings, "llm_cache", True)
    fake = gemini([_gemini_ok(CAT)])
    first = await llm.structured(Pet, system="s", user="same")
    second = await llm.structured(Pet, system="s", user="same")  # script is empty: a real call would crash
    assert first == second and len(fake.calls) == 1

    fake.script.append(_gemini_ok('{"name": "dog", "legs": 4}'))
    assert (await llm.structured(Pet, system="s", user="different")).name == "dog" and len(fake.calls) == 2


async def test_cache_is_bounded(gemini, settings, monkeypatch):
    monkeypatch.setattr(settings, "llm_cache", True)
    monkeypatch.setattr(settings, "llm_cache_size", 2)
    gemini([_gemini_ok(CAT)] * 3)
    for user in ("a", "b", "c"):
        await llm.structured(Pet, system="s", user=user)
    assert len(llm._cache) == 2

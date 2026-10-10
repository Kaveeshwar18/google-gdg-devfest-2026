"""Single entry point for LLM calls. Nodes call `structured(...)`; nothing else talks to a model.

Providers (settings.llm_provider; "auto" picks the first available):
  anthropic  Claude via the Anthropic SDK  (needs ANTHROPIC_API_KEY)
  gemini     Google Gemini                  (needs GEMINI_API_KEY; free tier is rate limited)
  ollama     a local model through Ollama   (free, offline, weaker; OLLAMA_MODEL, default qwen2.5:3b)
  mock       canned answers, no model       (frontend work, tests, last-resort demo fallback)
"""

import asyncio
import hashlib
import json
import logging
import re
import time
from collections import OrderedDict, deque
from functools import lru_cache
from typing import Literal

import anthropic
import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel, ValidationError

from app.config import get_settings

log = logging.getLogger("mitra.llm")

Tier = Literal["main", "fast"]
Provider = Literal["anthropic", "gemini", "ollama", "mock"]

# Models whose safety classifiers can decline; for these we opt into server-side fallback,
# which re-runs a declined request on an Anthropic-chosen model inside the same call.
_SERVER_FALLBACK_MODELS = {"claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"}
_OLLAMA_PROBE_TTL_S = 30.0
_ollama_probe: tuple[float, bool] = (0.0, False)


class LLMRefusal(RuntimeError):
    """The model (and its fallback) declined. Callers should abstain, not retry."""


class LLMUnavailable(RuntimeError):
    """The provider could not be reached or kept failing (network, 5xx, model removed)."""


@lru_cache
def _client() -> anthropic.AsyncAnthropic:
    settings = get_settings()
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=60.0, max_retries=2)


async def _ollama_up() -> bool:
    global _ollama_probe
    checked_at, up = _ollama_probe
    if time.monotonic() - checked_at < _OLLAMA_PROBE_TTL_S:
        return up
    try:
        async with httpx.AsyncClient(timeout=1.0) as http:
            tags = (await http.get(f"{get_settings().ollama_url}/api/tags")).json()
        wanted = get_settings().ollama_model
        up = any(m.get("name") == wanted for m in tags.get("models", []))
        if not up:
            log.warning("ollama is running but model %s is not pulled", wanted)
    except Exception:
        up = False
    _ollama_probe = (time.monotonic(), up)
    return up


async def active_provider() -> Provider:
    settings = get_settings()
    if settings.mock_llm or settings.llm_provider == "mock":
        return "mock"
    if settings.llm_provider == "anthropic":
        return "anthropic" if settings.anthropic_api_key else "mock"
    if settings.llm_provider == "gemini":
        return "gemini" if settings.gemini_api_key else "mock"
    if settings.llm_provider == "ollama":
        return "ollama" if await _ollama_up() else "mock"
    if settings.anthropic_api_key:
        return "anthropic"
    if settings.gemini_api_key:
        return "gemini"
    return "ollama" if await _ollama_up() else "mock"


def model_for(tier: Tier) -> str:
    settings = get_settings()
    return settings.claude_model_main if tier == "main" else settings.claude_model_fast


_cache: OrderedDict[str, str] = OrderedDict()


def clear_cache() -> None:
    _cache.clear()


async def structured[T: BaseModel](
    schema: type[T],
    *,
    system: str,
    user: str,
    tier: Tier = "main",
    max_tokens: int = 16000,
) -> T:
    """One model call whose output is validated against `schema` (a Pydantic model).

    Identical calls are answered from a small in-memory cache (cleared on restart, never written to disk,
    because the answers are derived from users' messages).
    """
    settings = get_settings()
    provider = await active_provider()
    if provider == "mock" or not settings.llm_cache:
        return await _structured(schema, provider, system=system, user=user, tier=tier, max_tokens=max_tokens)

    key = hashlib.sha256("\x1f".join([provider, schema.__name__, tier, system, user]).encode()).hexdigest()
    if key in _cache:
        _cache.move_to_end(key)
        return schema.model_validate_json(_cache[key])
    result = await _structured(schema, provider, system=system, user=user, tier=tier, max_tokens=max_tokens)
    _cache[key] = result.model_dump_json()
    while len(_cache) > settings.llm_cache_size:
        _cache.popitem(last=False)
    return result


async def _structured[T: BaseModel](
    schema: type[T], provider: Provider, *, system: str, user: str, tier: Tier, max_tokens: int
) -> T:
    """Dispatch to the provider, falling back to the local model if a cloud provider is unavailable."""
    if provider == "ollama":
        return await _ollama(schema, system=system, user=user, max_tokens=max_tokens)
    if provider == "mock":
        raise RuntimeError("structured() called with no live provider; callers must check active_provider() first")
    try:
        if provider == "gemini":
            return await _gemini(schema, system=system, user=user, tier=tier, max_tokens=max_tokens)
        return await _anthropic(schema, system=system, user=user, tier=tier, max_tokens=max_tokens)
    except LLMUnavailable as exc:
        if await _ollama_up():  # flaky wifi at the demo: a weaker local answer beats an error
            log.warning("%s unavailable (%s); answering with the local model", provider, exc)
            return await _ollama(schema, system=system, user=user, max_tokens=max_tokens)
        raise


async def _anthropic[T: BaseModel](schema: type[T], *, system: str, user: str, tier: Tier, max_tokens: int) -> T:
    model = model_for(tier)
    kwargs = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "output_format": schema,
    }
    try:
        if model in _SERVER_FALLBACK_MODELS:
            response = await _client().beta.messages.parse(
                **kwargs, betas=["server-side-fallback-2026-07-01"], fallbacks="default"
            )
        else:
            response = await _client().messages.parse(**kwargs)
    except (anthropic.APIConnectionError, anthropic.InternalServerError, anthropic.RateLimitError) as exc:
        raise LLMUnavailable(type(exc).__name__) from exc

    if response.stop_reason == "refusal":
        raise LLMRefusal(f"{model} declined the request")
    if response.stop_reason == "max_tokens":
        raise ValueError(f"{model} hit max_tokens={max_tokens}; output truncated")
    if response.parsed_output is None:
        raise ValueError(f"{model} returned no parseable {schema.__name__}")
    return response.parsed_output


async def _ollama[T: BaseModel](schema: type[T], *, system: str, user: str, max_tokens: int) -> T:
    """Ollama enforces the JSON schema while decoding; we still validate and retry once."""
    settings = get_settings()
    body = {
        "model": settings.ollama_model,
        "stream": False,
        "format": schema.model_json_schema(),
        "options": {"temperature": 0.2, "num_ctx": 8192, "num_predict": min(max_tokens, 4096)},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    last: Exception | None = None
    for _attempt in range(2):
        async with httpx.AsyncClient(timeout=settings.ollama_timeout_s) as http:
            resp = await http.post(f"{settings.ollama_url}/api/chat", json=body)
        resp.raise_for_status()
        try:
            return schema.model_validate_json(resp.json()["message"]["content"])
        except (ValidationError, KeyError, ValueError) as exc:
            last = exc
            log.warning("ollama output failed %s validation", schema.__name__)
    raise ValueError(f"{settings.ollama_model} did not produce a valid {schema.__name__}") from last


# ---------------------------------------------------------------- Gemini

try:  # google-genai talks through aiohttp when it is installed
    import aiohttp

    _NETWORK_ERRORS: tuple[type[BaseException], ...] = (OSError, httpx.HTTPError, aiohttp.ClientError, TimeoutError)
except ImportError:  # pragma: no cover
    _NETWORK_ERRORS = (OSError, httpx.HTTPError, TimeoutError)

_gemini_calls: deque[float] = deque()
_gemini_lock = asyncio.Lock()


@lru_cache
def _gemini_client() -> genai.Client:
    settings = get_settings()
    return genai.Client(
        api_key=settings.gemini_api_key,
        http_options=genai_types.HttpOptions(timeout=int(settings.gemini_timeout_s * 1000)),
    )


async def _gemini_gate() -> None:
    """Free-tier requests-per-minute budget: wait for a slot instead of collecting 429s."""
    rpm = get_settings().gemini_rpm
    async with _gemini_lock:
        while True:
            now = time.monotonic()
            while _gemini_calls and now - _gemini_calls[0] >= 60.0:
                _gemini_calls.popleft()
            if len(_gemini_calls) < rpm:
                _gemini_calls.append(now)
                return
            await asyncio.sleep(60.0 - (now - _gemini_calls[0]) + 0.05)


def _gemini_config(
    schema: type[BaseModel], system: str, max_tokens: int, *, schema_in_prompt: bool, thinking: bool
) -> genai_types.GenerateContentConfig:
    cfg: dict = {
        "system_instruction": system
        + (
            f"\n\nReply with JSON matching this JSON Schema exactly:\n{json.dumps(schema.model_json_schema())}"
            if schema_in_prompt
            else ""
        ),
        "response_mime_type": "application/json",
        "temperature": 0.2,
        "max_output_tokens": min(max_tokens, 8192),
    }
    if not schema_in_prompt:
        cfg["response_json_schema"] = schema.model_json_schema()
    if thinking:
        # Measured on gemini-3.8-flash: LOW halves latency (11 s -> 6 s) with the same answer quality.
        cfg["thinking_config"] = genai_types.ThinkingConfig(thinking_level=genai_types.ThinkingLevel.LOW)
    return genai_types.GenerateContentConfig(**cfg)


_exhausted: dict[str, float] = {}  # model -> time.monotonic() when its quota is back


def reset_quota_state() -> None:
    _exhausted.clear()


def _chain(tier: Tier) -> list[str]:
    settings = get_settings()
    raw = settings.gemini_models_main if tier == "main" else settings.gemini_models_fast
    return [m.strip() for m in raw.split(",") if m.strip()]


def _retry_seconds(exc: genai_errors.APIError) -> float:
    """How long Google says to wait, from `retryDelay: '51657s'` or 'Please retry in 14h20m57.2s'."""
    text = str(exc)
    if m := re.search(r"retryDelay'?\"?: ?'?\"?([\d.]+)s", text):
        return float(m.group(1))
    if m := re.search(r"retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?", text):
        h, mi, sec = (float(g or 0) for g in m.groups())
        return h * 3600 + mi * 60 + sec
    return 20.0


def _mark_exhausted(model: str, seconds: float) -> None:
    _exhausted[model] = time.monotonic() + min(seconds, 86400.0)


async def _gemini[T: BaseModel](schema: type[T], *, system: str, user: str, tier: Tier, max_tokens: int) -> T:
    """One structured call across the model chain. Recovery, per failure:
    thinking level unsupported -> drop it; schema refused -> put it in the prompt; daily quota used up ->
    mark the model exhausted and move on without waiting; per-minute 429 / 5xx / timeout / model removed ->
    move to the next model (the last model is retried a couple of times instead).
    """
    now = time.monotonic()
    models = [m for m in _chain(tier) if _exhausted.get(m, 0.0) <= now]
    if not models:
        raise LLMUnavailable("every gemini model is out of free quota")
    thinking, schema_in_prompt = True, False
    last: Exception | None = None

    for index, model in enumerate(models):
        is_last = index == len(models) - 1
        server_errors = 0
        for attempt in range(4):
            await _gemini_gate()
            config = _gemini_config(schema, system, max_tokens, schema_in_prompt=schema_in_prompt, thinking=thinking)
            try:
                response = await _gemini_client().aio.models.generate_content(model=model, contents=user, config=config)
            except genai_errors.ClientError as exc:
                last = exc
                if exc.code == 400 and thinking and "thinking" in str(exc).lower():
                    log.warning("%s does not support this thinking level; retrying without it", model)
                    thinking = False
                    continue
                if exc.code == 400 and not schema_in_prompt:
                    log.warning("gemini rejected the response schema; retrying with the schema in the prompt")
                    schema_in_prompt = True  # nested schemas can be refused; JSON mode plus a prompt copy still works
                    continue
                if exc.code == 429:
                    wait = _retry_seconds(exc)
                    if "PerDay" in str(exc) or wait > 120:
                        _mark_exhausted(model, wait)
                        log.warning("%s: daily free quota used up; skipping it for %.0f h", model, wait / 3600)
                        break
                    if not is_last or attempt >= 3:
                        log.warning("%s rate limited; moving on", model)
                        break
                    log.warning("%s rate limited; waiting %.0f s", model, min(wait, 20.0))
                    await asyncio.sleep(min(wait, 20.0))
                    continue
                if exc.code in (403, 404):
                    log.warning("%s unavailable (%s); trying the next model", model, exc.code)
                    break
                raise
            except genai_errors.ServerError as exc:
                last = exc
                if not is_last:  # don't retry a struggling model: the next one answers in seconds
                    log.warning("%s overloaded (%s); switching models", model, exc.code)
                    break
                server_errors += 1
                if server_errors <= 2:
                    log.warning("%s overloaded (%s); retrying", model, exc.code)
                    await asyncio.sleep(2.0 * server_errors)
                    continue
                break
            except _NETWORK_ERRORS as exc:  # includes timeouts
                last = exc
                if not is_last:
                    log.warning("%s unreachable or too slow (%s); switching models", model, type(exc).__name__)
                    break
                if attempt == 0:
                    await asyncio.sleep(2.0)
                    continue
                raise LLMUnavailable(f"network error: {type(exc).__name__}") from exc

            feedback = response.prompt_feedback
            if feedback and feedback.block_reason:
                raise LLMRefusal(f"{model} blocked the request ({feedback.block_reason})")
            try:
                return schema.model_validate_json(response.text or "")
            except (ValidationError, ValueError) as exc:
                last = exc
                log.warning("%s output failed %s validation (attempt %d)", model, schema.__name__, attempt + 1)
    if isinstance(last, genai_errors.APIError):
        raise LLMUnavailable(f"gemini {last.code}") from last
    if isinstance(last, _NETWORK_ERRORS):
        raise LLMUnavailable(f"network error: {type(last).__name__}") from last
    raise ValueError(f"gemini did not produce a valid {schema.__name__}") from last

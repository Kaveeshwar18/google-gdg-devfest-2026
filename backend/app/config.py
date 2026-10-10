"""Runtime settings, read from the repo-root .env (see .env.example)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Keys
    anthropic_api_key: str = ""
    sarvam_api_key: str = ""
    search_api_key: str = ""
    gemini_api_key: str = ""

    # Models (plan section 3.2: Sonnet for reasoning, Haiku for triage/extraction)
    claude_model_main: str = "claude-sonnet-5-5"
    claude_model_fast: str = "claude-haiku-4-5"

    # Which backend answers: auto = Claude if keyed, else Gemini if keyed, else local Ollama if running, else mock.
    llm_provider: Literal["auto", "anthropic", "gemini", "ollama", "mock"] = "auto"
    # Force canned answers even when a key is present (frontend dev, offline demo)
    mock_llm: bool = False

    # Gemini (free tier from aistudio.google.com). Confirm current model ids and limits in AI Studio.
    # Ordered chains, best first. The free tier's DAILY quota is per model (gemini-3.8-flash: 20 requests/day,
    # measured 2026-10-10), so a model that runs out is skipped and the next one answers.
    # gemini-2.5-flash is listed but 404s for new keys: not included.
    gemini_models_main: str = (
        "gemini-3.8-flash,gemini-3.5-flash,gemini-3-flash-preview,gemini-3.1-flash-lite,gemini-2.5-flash-lite"
    )
    gemini_models_fast: str = "gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-3-flash-preview,gemini-3.5-flash"
    gemini_timeout_s: float = 30.0  # a loaded model can hang for 40 s+ before failing: give up sooner
    gemini_rpm: int = 8  # stay under the free tier's requests per minute (about 5-10 without billing)

    # Remember identical model calls in memory (never on disk) so repeated questions cost no quota or time.
    llm_cache: bool = True
    llm_cache_size: int = 256

    # Local fallback model (Ollama). Qwen2.5 handles Hindi/Tamil and JSON schemas better than small Llamas.
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:3b"
    ollama_timeout_s: float = 240.0

    # HTTP
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_text_chars: int = 2000
    max_audio_bytes: int = 5_000_000  # roughly 60 s of compressed speech
    rate_limit_per_min: int = 60  # per client IP and per thread, for the expensive endpoints
    case_timeout_s: float = 300.0  # hard cap on one agent run

    # Retrieval
    chroma_dir: Path = BACKEND_DIR / ".chroma"
    embedding_model: str = "intfloat/multilingual-e5-small"

    # Speech
    sarvam_tts_model: str = "bulbul:v3"
    sarvam_tts_speaker: str = ""  # empty = Sarvam default voice
    sarvam_stt_model: str = "saaras:v3"
    sarvam_translate_model: str = "sarvam-translate:v1"

    @property
    def sarvam_enabled(self) -> bool:
        return bool(self.sarvam_api_key)

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

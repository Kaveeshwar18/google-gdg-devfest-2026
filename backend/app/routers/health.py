from fastapi import APIRouter

from app import llm, rag
from app.config import get_settings
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])

_LABEL = {"anthropic": "live", "gemini": "live", "ollama": "local", "mock": "mock"}


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        llm=_LABEL[await llm.active_provider()],
        sarvam=settings.sarvam_enabled,
        index_ready=rag.index_ready(),
    )

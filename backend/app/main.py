"""FastAPI app. Run: `make backend` (or `uv run uvicorn app.main:app --reload` in backend/)."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import rag, ratelimit
from app.config import get_settings
from app.routers import case, health, speech, status

# Log node names, latencies and error types only. Never log user text or document values.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await asyncio.to_thread(rag.warm_up)
    yield


app = FastAPI(title="Passport Mitra API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

for module in (health, status):
    app.include_router(module.router, prefix="/api")
for module in (case, speech):  # these call paid or slow services
    app.include_router(module.router, prefix="/api", dependencies=[Depends(ratelimit.by_ip)])

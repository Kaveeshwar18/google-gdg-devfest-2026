"""M2 endpoints. Both stream Server-Sent Events; see the event list in app/schemas.py."""

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException
from langgraph.types import Command
from sse_starlette import EventSourceResponse

from app import ratelimit
from app.agent.graph import get_graph
from app.config import get_settings
from app.pii import scrub
from app.schemas import (
    Answer,
    CaseRequest,
    CaseResult,
    ClarifyEvent,
    ErrorEvent,
    ProgressEvent,
    ResumeRequest,
)

router = APIRouter(tags=["case"])
log = logging.getLogger("mitra.case")


@router.post("/case")
async def start_case(req: CaseRequest) -> EventSourceResponse:
    if not req.consent:
        raise HTTPException(status_code=400, detail="consent_required")
    thread_id = req.thread_id or uuid.uuid4().hex
    ratelimit.by_thread(thread_id)
    initial = {
        "thread_id": thread_id,
        "lang": req.lang,
        "raw_text": scrub(req.text),
        "cart_issues": req.cart_issues,
        "search_enabled": req.search_enabled,
    }
    return EventSourceResponse(_run(initial, thread_id))


@router.post("/case/resume")
async def resume_case(req: ResumeRequest) -> EventSourceResponse:
    ratelimit.by_thread(req.thread_id)
    snapshot = await get_graph().aget_state(_config(req.thread_id))
    if not snapshot.next:
        raise HTTPException(status_code=404, detail="no_pending_question")
    return EventSourceResponse(_run(Command(resume=scrub(req.text)), req.thread_id))


def _config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}


def _event(name: str, payload: Any) -> dict:
    data = payload.model_dump_json() if hasattr(payload, "model_dump_json") else json.dumps(payload)
    return {"event": name, "data": data}


async def _run(graph_input: Any, thread_id: str) -> AsyncIterator[dict]:
    graph = get_graph()
    config = _config(thread_id)
    started = time.perf_counter()
    try:
        async with asyncio.timeout(get_settings().case_timeout_s):
            async for chunk in graph.astream(graph_input, config, stream_mode="updates"):
                for node, update in chunk.items():
                    if node == "__interrupt__":
                        question = update[0].value["question"]
                        yield _event("clarify", ClarifyEvent(thread_id=thread_id, question=question))
                        return
                    log.info("node=%s elapsed_ms=%d", node, (time.perf_counter() - started) * 1000)
                    yield _event("progress", ProgressEvent(node=node))

        state = (await graph.aget_state(config)).values
        answer_en = Answer.model_validate(state["answer"])
        local = state.get("answer_local")
        result = CaseResult(
            thread_id=thread_id,
            lang=state["lang"],
            answer=Answer.model_validate(local) if local else answer_en,
            answer_en=answer_en,
            localized=bool(state.get("localized")),
            draft=state.get("draft"),
        )
        yield _event("result", result)
    except TimeoutError:
        log.error("case run timed out")
        yield _event("error", ErrorEvent(code="timeout", message="This is taking too long. Please try again."))
    except Exception as exc:  # never leak internals or user text to the client or logs
        log.exception("case run failed: %s", type(exc).__name__)
        yield _event("error", ErrorEvent(code="agent_failed", message="Something went wrong. Please try again."))

"""In-memory sliding-window rate limit for the expensive endpoints (plan section 6, Abuse and cost).

Single process, resets on restart: enough for a hackathon demo, not for a multi-instance deployment.
"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from app.config import get_settings

WINDOW_S = 60.0
_hits: dict[str, deque[float]] = defaultdict(deque)


def reset() -> None:
    _hits.clear()


def check(key: str) -> None:
    """Raise 429 if `key` already made `rate_limit_per_min` calls in the last minute."""
    limit = get_settings().rate_limit_per_min
    now = time.monotonic()
    window = _hits[key]
    while window and now - window[0] > WINDOW_S:
        window.popleft()
    if len(window) >= limit:
        raise HTTPException(status_code=429, detail="rate_limited", headers={"Retry-After": str(int(WINDOW_S))})
    window.append(now)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")  # set by Cloud Run / Render; spoofable elsewhere
    return forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")


def by_ip(request: Request) -> None:
    check(f"ip:{client_ip(request)}")


def by_thread(thread_id: str) -> None:
    check(f"thread:{thread_id}")

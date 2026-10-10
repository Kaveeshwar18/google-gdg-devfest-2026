import pytest

from app import ratelimit
from app.config import get_settings
from tests.test_api import client

BODY = {"text": "my passport is stuck in police verification", "consent": True}


@pytest.fixture
def limit_to_two(monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_per_min", 2)


def test_ip_limit_returns_429_with_retry_after(limit_to_two):
    for _ in range(2):
        assert client.post("/api/case", json=BODY).status_code == 200
    r = client.post("/api/case", json=BODY)
    assert r.status_code == 429 and r.json()["detail"] == "rate_limited" and r.headers["retry-after"]


def test_speech_endpoints_share_the_ip_budget(limit_to_two):
    assert client.post("/api/tts", json={"text": "hi", "lang": "en"}).status_code == 503
    assert client.post("/api/tts", json={"text": "hi", "lang": "en"}).status_code == 503
    assert client.post("/api/tts", json={"text": "hi", "lang": "en"}).status_code == 429


def test_cheap_endpoints_are_not_limited(limit_to_two):
    for _ in range(5):
        assert client.get("/api/health").status_code == 200


def test_thread_limit_is_separate_from_ip_limit(monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_per_min", 3)
    ratelimit.check("ip:other")
    for _ in range(3):
        ratelimit.by_thread("t1")
    with pytest.raises(Exception, match="429|rate_limited"):
        ratelimit.by_thread("t1")
    ratelimit.by_thread("t2")  # another thread is unaffected


def test_forwarded_ip_is_used_when_present(limit_to_two):
    h = {"x-forwarded-for": "9.9.9.9, 10.0.0.1"}
    for _ in range(2):
        client.post("/api/case", json=BODY, headers=h)
    assert client.post("/api/case", json=BODY, headers=h).status_code == 429
    assert client.post("/api/case", json=BODY, headers={"x-forwarded-for": "8.8.8.8"}).status_code == 200

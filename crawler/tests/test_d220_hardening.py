"""D220 S2 — the crawler can never hang for 20 hours again.

Covers: the shared self-healing browser pool (reuse, recycle, crash restart,
start timeout), the per-page hard timeout, mid-site cancel + deadline in the
frontier crawl, the OpenAI client (model fallback chain, dead-model memory,
Responses web_search parsing), the watchdog, and atomic job files.
"""
from __future__ import annotations

import asyncio
import sys
import time
import types
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app.pipeline as pipeline  # noqa: E402
from app import ai_client, browser_pool, fetcher, harvest  # noqa: E402
from app.browser_pool import BrowserPool, build_crawler_kwargs, is_crash_error  # noqa: E402
from app.config import Settings  # noqa: E402
from app.fetcher import FetchResult  # noqa: E402


def _settings(**over) -> Settings:
    base = dict(
        CRAWLER_SHARED_SECRET="s", CRAWL_RESPECT_ROBOTS="false",
        CRAWL_MIN_DELAY_SECONDS="0", CRAWL_SEED_ENABLED="false",
        FOLLOW_SOCIAL_LINKS="false", _env_file=None,
    )
    base.update(over)
    return Settings(**base)


# --------------------------------------------------------------------------
# browser pool
# --------------------------------------------------------------------------
class _Crawler:
    instances: list["_Crawler"] = []
    start_delay = 0.0

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.closed = False
        self.started = False
        _Crawler.instances.append(self)

    async def start(self):
        if _Crawler.start_delay:
            await asyncio.sleep(_Crawler.start_delay)
        self.started = True

    async def close(self):
        self.closed = True


def _reset_crawler():
    _Crawler.instances = []
    _Crawler.start_delay = 0.0


def test_pool_reuses_one_browser_for_many_pages():
    _reset_crawler()
    pool = BrowserPool()
    s = _settings(CRAWL_BROWSER_RECYCLE_PAGES="0")
    mod = types.SimpleNamespace()

    async def go():
        for _ in range(10):
            async with pool.session(_Crawler, mod, s) as c:
                assert c.started
    asyncio.run(go())
    assert len(_Crawler.instances) == 1  # the D219 bug was 10 browsers here
    assert pool.stats()["starts"] == 1


def test_pool_recycles_after_n_pages_and_closes_the_old_one():
    _reset_crawler()
    pool = BrowserPool()
    s = _settings(CRAWL_BROWSER_RECYCLE_PAGES="3")
    mod = types.SimpleNamespace()

    async def go():
        for _ in range(7):
            async with pool.session(_Crawler, mod, s):
                pass
    asyncio.run(go())
    assert len(_Crawler.instances) == 3  # pages 1-3, 4-6, 7
    assert _Crawler.instances[0].closed and _Crawler.instances[1].closed
    assert pool.stats()["recycles"] >= 2


def test_pool_restarts_after_a_crash():
    _reset_crawler()
    pool = BrowserPool()
    s = _settings(CRAWL_BROWSER_RECYCLE_PAGES="0")
    mod = types.SimpleNamespace()

    async def go():
        with pytest.raises(RuntimeError):
            async with pool.session(_Crawler, mod, s):
                raise RuntimeError("BrowserContext.new_page: Target crashed")
        async with pool.session(_Crawler, mod, s) as c:
            return c
    c = asyncio.run(go())
    assert len(_Crawler.instances) == 2
    assert _Crawler.instances[0].closed
    assert c is _Crawler.instances[1]
    assert pool.stats()["crashes"] == 1


def test_pool_non_crash_error_keeps_browser():
    _reset_crawler()
    pool = BrowserPool()
    s = _settings(CRAWL_BROWSER_RECYCLE_PAGES="0")

    async def go():
        with pytest.raises(ValueError):
            async with pool.session(_Crawler, types.SimpleNamespace(), s):
                raise ValueError("bad selector")
        async with pool.session(_Crawler, types.SimpleNamespace(), s):
            pass
    asyncio.run(go())
    assert len(_Crawler.instances) == 1


def test_pool_start_timeout_is_hard():
    """A browser that never finishes starting can't hang the worker: the start
    is abandoned at CRAWL_BROWSER_START_TIMEOUT_SECONDS (floored at 5s)."""
    _reset_crawler()
    _Crawler.start_delay = 10
    pool = BrowserPool()
    s = _settings(CRAWL_BROWSER_START_TIMEOUT_SECONDS="5")

    async def go():
        t0 = time.monotonic()
        with pytest.raises(asyncio.TimeoutError):
            async with pool.session(_Crawler, types.SimpleNamespace(), s):
                pass
        return time.monotonic() - t0
    elapsed = asyncio.run(go())
    assert elapsed < 9


def test_is_crash_error_markers():
    assert is_crash_error("BrowserContext.new_page: Target crashed")
    assert is_crash_error(RuntimeError("Browser has been closed"))
    assert not is_crash_error("404 not found")
    assert not is_crash_error(None)


def test_build_kwargs_uses_browser_config_with_container_flags():
    class BrowserConfig:
        def __init__(self, headless=True, verbose=False, extra_args=None, proxy=None):
            self.extra_args = extra_args
            self.headless = headless

    out = build_crawler_kwargs(_settings(), types.SimpleNamespace(BrowserConfig=BrowserConfig))
    assert "config" in out
    assert "--disable-dev-shm-usage" in out["config"].extra_args
    legacy = build_crawler_kwargs(_settings(), types.SimpleNamespace())
    assert legacy == {"headless": True, "verbose": False}


# --------------------------------------------------------------------------
# per-page hard timeout
# --------------------------------------------------------------------------
def test_fetch_page_hard_timeout(monkeypatch):
    async def stuck(*a, **k):
        await asyncio.sleep(60)

    monkeypatch.setattr(fetcher, "_fetch_page_inner", stuck)
    s = _settings(CRAWL_PAGE_HARD_TIMEOUT_SECONDS="20")
    # shrink the effective timeout for the test via the module-level wait_for
    real_wait_for = asyncio.wait_for

    async def fast_wait_for(aw, timeout):
        return await real_wait_for(aw, timeout=min(timeout, 0.2))

    monkeypatch.setattr(fetcher.asyncio, "wait_for", fast_wait_for)
    res = asyncio.run(fetcher.fetch_page("https://x.example.com/", settings=s))
    monkeypatch.setattr(fetcher.asyncio, "wait_for", real_wait_for)
    assert not res.ok
    assert "timed out" in (res.error or "").lower() or "timeout" in (res.error or "").lower()


# --------------------------------------------------------------------------
# mid-site cancel + deadline + on_page
# --------------------------------------------------------------------------
BASE = "https://vendor.example.com/"


def _site(n: int) -> dict[str, str]:
    links = "".join(f'<a href="/products/p{i}/">P{i}</a>' for i in range(n))
    site = {BASE: f"<html><body><nav>{links}</nav><p>home page text here</p></body></html>"}
    for i in range(n):
        site[f"{BASE}products/p{i}/"] = f"<html><body><p>product {i} details</p></body></html>"
    return site


def _wire(monkeypatch, site, log):
    async def fake_fetch(url, *, prefer_browser=True, settings=None, force_fresh=False):
        log.append(url)
        html = site.get(url)
        if html is None:
            return FetchResult(url=url, ok=False, error="404")
        return FetchResult(url=url, ok=True, status=200, html=html, markdown=html, image_urls=[])

    monkeypatch.setattr(pipeline, "fetch_page", fake_fetch)
    monkeypatch.setattr(pipeline, "discover_sitemap_urls", lambda url, settings, limit=100: [])
    monkeypatch.setattr(pipeline, "fetch_banned_phrases", lambda settings=None: [])


def test_cancel_takes_effect_mid_site(monkeypatch, tmp_path):
    log: list[str] = []
    _wire(monkeypatch, _site(20), log)
    calls = {"n": 0}

    def stop():
        calls["n"] += 1
        return calls["n"] > 3  # allow 3 sub-pages, then cancel

    r = asyncio.run(pipeline.research_target(
        url=BASE, entity_type="vendor", entity_id="v1",
        settings=_settings(CRAWL_CACHE_DIR=str(tmp_path)), max_pages=50, should_stop=stop,
    ))
    assert r.stopped_reason == "cancelled"
    assert len(r.pages) == 4  # entry + 3
    assert len(r.pending_urls) > 0  # the rest is kept for the next slice


def test_deadline_ends_slice_and_keeps_frontier(monkeypatch, tmp_path):
    log: list[str] = []
    _wire(monkeypatch, _site(10), log)
    r = asyncio.run(pipeline.research_target(
        url=BASE, entity_type="vendor", entity_id="v1",
        settings=_settings(CRAWL_CACHE_DIR=str(tmp_path)), max_pages=50,
        deadline=time.monotonic() - 1,
    ))
    assert r.stopped_reason == "deadline"
    assert r.pages == [BASE]
    assert len(r.pending_urls) == 10


def test_on_page_sees_every_page_and_hook_errors_are_swallowed(monkeypatch, tmp_path):
    log: list[str] = []
    _wire(monkeypatch, _site(4), log)
    seen: list[str] = []

    async def hook(url, page):
        seen.append(url)
        if url.endswith("p1/"):
            raise RuntimeError("catalog write failed")

    r = asyncio.run(pipeline.research_target(
        url=BASE, entity_type="vendor", entity_id="v1",
        settings=_settings(CRAWL_CACHE_DIR=str(tmp_path)), max_pages=50, on_page=hook,
    ))
    assert set(seen) == set(r.pages)
    assert len(r.pages) == 5


def test_prior_corpus_joins_page_texts(monkeypatch, tmp_path):
    log: list[str] = []
    _wire(monkeypatch, _site(1), log)
    r = asyncio.run(pipeline.research_target(
        url=BASE, entity_type="vendor", entity_id="v1",
        settings=_settings(CRAWL_CACHE_DIR=str(tmp_path)), max_pages=50,
        prior_corpus=[("https://vendor.example.com/old/", "from an earlier slice")],
        run_ai=False, persist_resume=False,
    ))
    assert r.fetched_ok


# --------------------------------------------------------------------------
# OpenAI client
# --------------------------------------------------------------------------
class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


def _patch_httpx(monkeypatch, handler):
    class _Client:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def post(self, url, json=None, headers=None):
            return handler(url, json)

    monkeypatch.setattr(ai_client.httpx, "Client", _Client)


def test_model_chain_order_and_dedupe():
    s = _settings(AI_MODEL="gpt-4o-mini", AI_FALLBACK_MODELS="gpt-6-luna,gpt-4o-mini")
    assert s.model_chain("text") == ["gpt-4o-mini", "gpt-6-luna"]
    assert s.model_chain("search")[0] == "gpt-6-luna"


def test_chat_json_falls_back_when_model_retired(monkeypatch):
    ai_client.reset_state_for_tests()
    seen: list[str] = []

    def handler(url, body):
        seen.append(body["model"])
        if body["model"] == "gpt-4o-mini":
            return _Resp(404, {"error": {"code": "model_not_found", "message": "The model does not exist"}})
        return _Resp(200, {"choices": [{"message": {"content": '{"ok": true}'}}],
                           "usage": {"prompt_tokens": 10, "completion_tokens": 2}})

    _patch_httpx(monkeypatch, handler)
    s = _settings(AI_API_KEY="k", AI_MODEL="gpt-4o-mini", AI_FALLBACK_MODELS="gpt-6-luna")
    assert ai_client.chat_json(s, "sys", "user") == {"ok": True}
    assert seen == ["gpt-4o-mini", "gpt-6-luna"]
    # Second call goes straight to the working model (dead one remembered).
    seen.clear()
    ai_client.chat_json(s, "sys", "user")
    assert seen == ["gpt-6-luna"]
    assert ai_client.USAGE.as_dict()["calls"] >= 2


def test_chat_json_drops_temperature_when_rejected(monkeypatch):
    ai_client.reset_state_for_tests()
    bodies: list[dict] = []

    def handler(url, body):
        bodies.append(dict(body))
        if "temperature" in body:
            return _Resp(400, {"error": {"message": "Unsupported parameter: temperature"}})
        return _Resp(200, {"choices": [{"message": {"content": '```json\n{"a": 1}\n```'}}]})

    _patch_httpx(monkeypatch, handler)
    s = _settings(AI_API_KEY="k", AI_MODEL="m1", AI_FALLBACK_MODELS="")
    assert ai_client.chat_json(s, "sys", "u") == {"a": 1}
    assert "temperature" not in bodies[-1]


def test_chat_json_vision_payload(monkeypatch):
    ai_client.reset_state_for_tests()
    got = {}

    def handler(url, body):
        got.update(body)
        return _Resp(200, {"choices": [{"message": {"content": "{}"}}]})

    _patch_httpx(monkeypatch, handler)
    s = _settings(AI_API_KEY="k")
    ai_client.chat_json(s, "sys", "describe", purpose="vision", image_urls=["https://x/a.jpg"])
    parts = got["messages"][1]["content"]
    assert parts[1]["type"] == "image_url" and parts[1]["image_url"]["detail"] == "low"


def test_chat_json_without_key_raises():
    ai_client.reset_state_for_tests()
    with pytest.raises(ai_client.AiUnavailable):
        ai_client.chat_json(_settings(AI_API_KEY=""), "s", "u")


def test_parse_responses_output_collects_citations_and_sources():
    data = {"output": [
        {"type": "web_search_call", "action": {"sources": [{"url": "https://a.com"}, {"url": "https://b.com"}]}},
        {"type": "message", "content": [{
            "type": "output_text", "text": "The site is https://a.com",
            "annotations": [{"type": "url_citation", "url": "https://a.com", "title": "A"}],
        }]},
    ]}
    out = ai_client.parse_responses_output(data)
    assert out["text"] == "The site is https://a.com"
    assert out["citations"] == [{"url": "https://a.com", "title": "A"}]
    assert out["sources"] == ["https://a.com", "https://b.com"]
    assert out["search_calls"] == 1


def test_responses_web_search_falls_back_to_preview_tool(monkeypatch):
    ai_client.reset_state_for_tests()
    tools: list[str] = []

    def handler(url, body):
        tools.append(body["tools"][0]["type"])
        if body["tools"][0]["type"] == "web_search":
            return _Resp(400, {"error": {"message": "Unknown tool type web_search"}})
        return _Resp(200, {"output": [{"type": "message", "content": [{"type": "output_text", "text": "hi"}]}]})

    _patch_httpx(monkeypatch, handler)
    s = _settings(AI_API_KEY="k", AI_SEARCH_MODEL="gpt-6-luna", AI_FALLBACK_MODELS="")
    out = ai_client.responses_web_search(s, "find it")
    assert out["text"] == "hi"
    assert tools == ["web_search", "web_search_preview"]


# --------------------------------------------------------------------------
# watchdog + atomic job files + kwargs compat
# --------------------------------------------------------------------------
def test_watchdog_recycles_then_cancels(monkeypatch):
    marked: list[str] = []
    monkeypatch.setattr(browser_pool.POOL, "mark_current_broken", lambda err=None: marked.append(str(err)))

    class _Task:
        cancelled = False

        def done(self):
            return False

        def cancel(self):
            _Task.cancelled = True

    harvest._tasks["jobX"] = _Task()
    harvest._heartbeat["jobX"] = 1000.0
    harvest._stall_flags.pop("jobX", None)
    s = _settings(CRAWL_STALL_SECONDS="100")
    try:
        assert harvest.watchdog_tick(s, now=1050.0) == []
        a1 = harvest.watchdog_tick(s, now=1150.0)
        assert a1 and a1[0]["action"] == "browser_recycled" and marked
        a2 = harvest.watchdog_tick(s, now=1150.0)
        assert a2 == []  # not repeated
        a3 = harvest.watchdog_tick(s, now=1250.0)
        assert a3[0]["action"] == "cancelled_task" and _Task.cancelled
    finally:
        harvest._tasks.pop("jobX", None)
        harvest._heartbeat.pop("jobX", None)
        harvest._stall_flags.pop("jobX", None)


def test_job_files_are_written_atomically(tmp_path):
    s = _settings(CRAWL_CACHE_DIR=str(tmp_path))
    job = harvest.create_job(
        [{"url": "https://a.example.com/", "entity_type": "vendor", "entity_id": "v1"}],
        settings=s,
    )
    jobs_dir = harvest._jobs_dir(s)
    assert not list(jobs_dir.glob("*.tmp"))
    assert harvest.load_job(job.id, s) is not None


def test_supported_kwargs_filters_for_old_signatures():
    async def old(*, url, entity_type):
        return None

    async def new(**kw):
        return None

    kw = {"url": "u", "entity_type": "vendor", "should_stop": lambda: False}
    assert harvest._supported_kwargs(old, kw) == {"url": "u", "entity_type": "vendor"}
    assert harvest._supported_kwargs(new, kw) == kw


def test_health_reports_vitals():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        body = c.get("/health").json()
    assert body["ok"] is True
    for key in ("browser", "job_heartbeats_s", "ai_models", "ai_usage", "limits"):
        assert key in body

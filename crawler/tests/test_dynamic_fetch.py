"""Slice C3 — dynamic-content capture in the crawl4ai browser path.

The owner's requirement (docs/ROADMAP_CRAWLER_POWERHOUSE.md): "crawl around the
whole site clicking everything, looking at everything and scraping everything."
These tests verify the C3 fetch ladder WITHOUT a real browser, using a fake
``crawl4ai`` module installed into ``sys.modules`` (same pattern as
tests/test_seeding.py):

  • ``_crawl4ai_run_config`` builds the advanced config ONLY from kwargs the
    installed ``CrawlerRunConfig`` actually accepts (signature filtering — the
    repo pins a wide crawl4ai version range), and soft-degrades to ``None``
    when the class is missing or construction fails.
  • ``_fetch_with_crawl4ai`` prefers the advanced run, falls back to the legacy
    plain ``arun`` when the advanced path raises or returns nothing, and the
    outer ladder still lands on httpx when the browser path fails entirely.
"""
from __future__ import annotations

import asyncio
import sys
import types

import pytest

from app.config import Settings
from app.fetcher import _LOAD_MORE_JS, _crawl4ai_run_config, _fetch_with_crawl4ai


def _settings(**env: object) -> Settings:
    base: dict[str, str] = {
        "CRAWLER_SHARED_SECRET": "s",
        "CRAWL_RESPECT_ROBOTS": "false",
        "CRAWL_MIN_DELAY_SECONDS": "0",
    }
    base.update({k: str(v) for k, v in env.items()})
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Fake crawl4ai
# ---------------------------------------------------------------------------

class _ModernRunConfig:
    """Stands in for a modern CrawlerRunConfig (accepts every C3 kwarg)."""

    def __init__(
        self,
        word_count_threshold=None,
        scan_full_page=None,
        scroll_delay=None,
        wait_for_images=None,
        remove_overlay_elements=None,
        delay_before_return_html=None,
        page_timeout=None,
        js_code=None,
        cache_mode=None,
    ):
        self.kwargs = {
            k: v
            for k, v in {
                "word_count_threshold": word_count_threshold,
                "scan_full_page": scan_full_page,
                "scroll_delay": scroll_delay,
                "wait_for_images": wait_for_images,
                "remove_overlay_elements": remove_overlay_elements,
                "delay_before_return_html": delay_before_return_html,
                "page_timeout": page_timeout,
                "js_code": js_code,
                "cache_mode": cache_mode,
            }.items()
            if v is not None
        }


class _AncientRunConfig:
    """Stands in for an old CrawlerRunConfig (word_count_threshold only)."""

    def __init__(self, word_count_threshold=None):
        self.kwargs = {"word_count_threshold": word_count_threshold}


class _Result:
    def __init__(self, html="", markdown=""):
        self.html = html
        self.markdown = markdown
        self.fit_markdown = markdown


class _FakeCrawler:
    """Stands in for crawl4ai.AsyncWebCrawler; records every arun call."""

    calls: list[dict] = []
    advanced_result: object | None = None
    advanced_exc: Exception | None = None
    legacy_result: object = _Result(html="<html>legacy</html>", markdown="legacy")

    def __init__(self, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def arun(self, url=None, config=None, **kwargs):
        _FakeCrawler.calls.append({"url": url, "config": config, "kwargs": kwargs})
        if config is not None:  # advanced path
            if _FakeCrawler.advanced_exc is not None:
                raise _FakeCrawler.advanced_exc
            return _FakeCrawler.advanced_result
        return _FakeCrawler.legacy_result


def _install_fake_crawl4ai(monkeypatch, *, run_config_cls=_ModernRunConfig, with_cache_mode=False):
    fake = types.SimpleNamespace(AsyncWebCrawler=_FakeCrawler, CrawlerRunConfig=run_config_cls)
    if with_cache_mode:
        fake.CacheMode = types.SimpleNamespace(BYPASS="bypass")
    monkeypatch.setitem(sys.modules, "crawl4ai", fake)
    _FakeCrawler.calls = []
    _FakeCrawler.advanced_result = None
    _FakeCrawler.advanced_exc = None


# ---------------------------------------------------------------------------
# _crawl4ai_run_config — signature filtering + soft degrade
# ---------------------------------------------------------------------------

def test_run_config_none_when_crawl4ai_missing(monkeypatch):
    # None in sys.modules makes `import crawl4ai` raise even if it's installed.
    monkeypatch.setitem(sys.modules, "crawl4ai", None)
    assert _crawl4ai_run_config(_settings()) is None


def test_run_config_modern_gets_all_dynamic_kwargs(monkeypatch):
    _install_fake_crawl4ai(monkeypatch)
    cfg = _crawl4ai_run_config(_settings())
    assert cfg is not None
    kw = cfg.kwargs
    assert kw["scan_full_page"] is True
    assert kw["wait_for_images"] is True
    # C7: overlay removal is OFF by default (it gutted age-gated pages).
    assert kw["remove_overlay_elements"] is False
    assert kw["js_code"] == _LOAD_MORE_JS
    assert "load" in _LOAD_MORE_JS.lower()  # the click-everything script
    assert kw["page_timeout"] == 90_000  # ms
    assert kw["delay_before_return_html"] == pytest.approx(2.0)


def test_run_config_ancient_filters_to_supported_kwargs(monkeypatch):
    """crawl4ai too old for scan_full_page etc. → config still builds, with
    only the kwargs its signature accepts (no TypeError, no lost fetch)."""
    _install_fake_crawl4ai(monkeypatch, run_config_cls=_AncientRunConfig)
    cfg = _crawl4ai_run_config(_settings())
    assert cfg is not None
    assert cfg.kwargs == {"word_count_threshold": 10}


def test_run_config_dynamic_disabled_skips_interaction_kwargs(monkeypatch):
    _install_fake_crawl4ai(monkeypatch)
    cfg = _crawl4ai_run_config(_settings(CRAWL_DYNAMIC_CONTENT="false"))
    assert cfg is not None
    assert "scan_full_page" not in cfg.kwargs
    assert "js_code" not in cfg.kwargs
    assert cfg.kwargs.get("word_count_threshold") == 10


def test_run_config_knobs_flow_through(monkeypatch):
    _install_fake_crawl4ai(monkeypatch)
    cfg = _crawl4ai_run_config(
        _settings(
            CRAWL_SCROLL_DELAY_SECONDS="0.7",
            CRAWL_SETTLE_SECONDS="3.5",
            CRAWL_PAGE_TIMEOUT_SECONDS="120",
        )
    )
    assert cfg.kwargs["scroll_delay"] == pytest.approx(0.7)
    assert cfg.kwargs["delay_before_return_html"] == pytest.approx(3.5)
    assert cfg.kwargs["page_timeout"] == 120_000


def test_run_config_cache_mode_bypass_when_available(monkeypatch):
    _install_fake_crawl4ai(monkeypatch, with_cache_mode=True)
    cfg = _crawl4ai_run_config(_settings())
    assert cfg.kwargs.get("cache_mode") == "bypass"


# ---------------------------------------------------------------------------
# _fetch_with_crawl4ai — the browser-internal fallback ladder
# ---------------------------------------------------------------------------

def test_fetch_prefers_advanced_config_run(monkeypatch):
    _install_fake_crawl4ai(monkeypatch)
    # C7: a REALISTIC good page (rich text + links) so the C7 thin-shell
    # fallback does not (correctly) fire. A contentless result would now fall
    # back, which is the whole point of the age-gate fix.
    rich = "dynamic content incl. lazy items " * 40
    _FakeCrawler.advanced_result = _Result(
        html="<html><body>"
        + "".join(f"<a href='/p{i}'>P{i}</a>" for i in range(10))
        + f"<main>{rich}</main></body></html>",
        markdown=rich,
    )
    res = asyncio.run(_fetch_with_crawl4ai(_settings(), "https://example-brand.com/"))
    assert res is not None and res.ok
    assert "dynamic content" in res.html
    # Exactly one arun call, and it used the advanced config (no fallback).
    assert len(_FakeCrawler.calls) == 1
    assert _FakeCrawler.calls[0]["config"] is not None


def test_fetch_falls_back_to_legacy_arun_when_advanced_raises(monkeypatch):
    _install_fake_crawl4ai(monkeypatch)
    _FakeCrawler.advanced_exc = TypeError("unexpected keyword argument 'config'")
    res = asyncio.run(_fetch_with_crawl4ai(_settings(), "https://example-brand.com/"))
    assert res is not None and res.ok
    assert "legacy" in res.html
    # Two calls: failed advanced, then legacy kwargs path.
    assert len(_FakeCrawler.calls) == 2
    assert _FakeCrawler.calls[1]["config"] is None
    assert _FakeCrawler.calls[1]["kwargs"].get("bypass_cache") is True


def test_fetch_falls_back_when_advanced_returns_empty(monkeypatch):
    _install_fake_crawl4ai(monkeypatch)
    _FakeCrawler.advanced_result = _Result(html="", markdown="")
    res = asyncio.run(_fetch_with_crawl4ai(_settings(), "https://example-brand.com/"))
    assert res is not None and res.ok
    assert "legacy" in res.html


def test_fetch_returns_none_when_crawl4ai_missing(monkeypatch):
    # None in sys.modules makes `import crawl4ai` raise even if it's installed.
    monkeypatch.setitem(sys.modules, "crawl4ai", None)
    res = asyncio.run(_fetch_with_crawl4ai(_settings(), "https://example-brand.com/"))
    assert res is None  # caller then uses the httpx fallback

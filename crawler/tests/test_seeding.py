"""Unit tests for URL seeding (Slice H2) — pure logic, no network.

Covers: registrable-domain host keys, the three-source merge (dedupe,
same-origin, boring/target filtering, seeder +1 nudge, budget truncation),
soft-disable behaviour, and a faked AsyncUrlSeeder happy path.
"""
from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings  # noqa: E402
from app.seeding import (  # noqa: E402
    SEED_QUERY,
    _registrable_domain,
    merge_candidates,
    seed_site_urls,
)

BASE = "https://www.example-brand.com/"


def _settings(**overrides) -> Settings:
    values = {"CRAWLER_SHARED_SECRET": "test-secret"}
    values.update(overrides)
    return Settings(**values)


# ---------------------------------------------------------------------------
# _registrable_domain
# ---------------------------------------------------------------------------

def test_registrable_domain_strips_www_and_port():
    assert _registrable_domain("www.Example.com") == "example.com"
    assert _registrable_domain("example.com:8443") == "example.com"
    assert _registrable_domain("shop.example.com") == "shop.example.com"


# ---------------------------------------------------------------------------
# merge_candidates
# ---------------------------------------------------------------------------

def test_merge_dedupes_across_sources_and_trailing_slashes():
    nav = ["https://www.example-brand.com/about/"]
    sitemap = ["https://www.example-brand.com/about"]
    seeded = ["https://www.example-brand.com/about/"]
    out = merge_candidates(BASE, nav, sitemap, seeded, budget=10)
    assert len(out) == 1
    assert out[0].rstrip("/").endswith("/about")


def test_merge_drops_offsite_boring_target_and_bad_schemes():
    nav = [
        "https://othersite.com/about/",                     # offsite
        "https://www.example-brand.com/privacy/",           # boring
        "https://www.example-brand.com/",                   # the target itself
        "ftp://www.example-brand.com/about/",               # bad scheme
        "https://www.example-brand.com/our-story/",         # keeper
    ]
    out = merge_candidates(BASE, nav, [], [], budget=10)
    assert out == ["https://www.example-brand.com/our-story/"]


def test_merge_strips_fragments_and_queries():
    nav = ["https://www.example-brand.com/about/?utm_source=x#team"]
    out = merge_candidates(BASE, nav, [], [], budget=10)
    assert out == ["https://www.example-brand.com/about/"]


def test_seeder_urls_get_plus_one_nudge():
    # Same base interest score; the seeded one must rank first.
    nav = ["https://www.example-brand.com/rosin/"]
    seeded = ["https://www.example-brand.com/edibles/"]
    out = merge_candidates(BASE, nav, [], seeded, budget=10)
    assert out[0] == "https://www.example-brand.com/edibles/"
    assert out[1] == "https://www.example-brand.com/rosin/"


def test_budget_truncates_best_first():
    nav = [
        "https://www.example-brand.com/random-page-xyz-longer-slug/",  # low score
        "https://www.example-brand.com/about/",                        # high score
        "https://www.example-brand.com/our-story/",                    # high score
    ]
    out = merge_candidates(BASE, nav, [], [], budget=2)
    assert len(out) == 2
    assert "random-page" not in out[0] and "random-page" not in out[1]


def test_budget_zero_returns_empty():
    assert merge_candidates(BASE, ["https://www.example-brand.com/about/"], [], [], budget=0) == []


def test_www_and_bare_host_are_same_site():
    # Base has www; candidates without www must still be accepted (original
    # netloc is preserved in the output URL).
    nav = ["https://example-brand.com/about/"]
    out = merge_candidates(BASE, nav, [], [], budget=10)
    assert out == ["https://example-brand.com/about/"]


# ---------------------------------------------------------------------------
# seed_site_urls
# ---------------------------------------------------------------------------

def test_seed_disabled_returns_empty():
    settings = _settings(CRAWL_SEED_ENABLED=False)
    out = asyncio.run(seed_site_urls(BASE, settings=settings))
    assert out == []


class _FakeSeeder:
    """Stands in for crawl4ai.AsyncUrlSeeder."""

    captured_config = None
    rows: list = []
    raise_exc: Exception | None = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def urls(self, domain, config):
        _FakeSeeder.captured_config = config
        if _FakeSeeder.raise_exc is not None:
            raise _FakeSeeder.raise_exc
        return list(_FakeSeeder.rows)


class _FakeSeedingConfig:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


def _install_fake_crawl4ai(monkeypatch):
    fake = types.SimpleNamespace(
        AsyncUrlSeeder=_FakeSeeder, SeedingConfig=_FakeSeedingConfig
    )
    monkeypatch.setitem(sys.modules, "crawl4ai", fake)


def test_seed_happy_path_honors_rows_and_limit(monkeypatch):
    _install_fake_crawl4ai(monkeypatch)
    _FakeSeeder.raise_exc = None
    _FakeSeeder.rows = [
        {"url": "https://www.example-brand.com/about/"},
        {"url": "https://www.example-brand.com/menu/"},
        {"url": "not-a-url"},           # dropped
        {"no_url_key": True},           # dropped
        {"url": "https://www.example-brand.com/strains/"},
    ]
    settings = _settings(CRAWL_SEED_MAX_URLS=2)
    out = asyncio.run(seed_site_urls(BASE, settings=settings))
    assert out == [
        "https://www.example-brand.com/about/",
        "https://www.example-brand.com/menu/",
    ]
    cfg = _FakeSeeder.captured_config
    assert cfg.kwargs["query"] == SEED_QUERY
    assert cfg.kwargs["scoring_method"] == "bm25"
    assert cfg.kwargs["extract_head"] is False
    assert cfg.kwargs["max_urls"] == 2
    assert cfg.kwargs["source"] == "sitemap"


def test_seed_source_setting_flows_through(monkeypatch):
    _install_fake_crawl4ai(monkeypatch)
    _FakeSeeder.raise_exc = None
    _FakeSeeder.rows = []
    settings = _settings(CRAWL_SEED_SOURCE="sitemap+cc")
    asyncio.run(seed_site_urls(BASE, settings=settings))
    assert _FakeSeeder.captured_config.kwargs["source"] == "sitemap+cc"


def test_seed_errors_are_swallowed(monkeypatch):
    _install_fake_crawl4ai(monkeypatch)
    _FakeSeeder.raise_exc = RuntimeError("boom")
    settings = _settings()
    out = asyncio.run(seed_site_urls(BASE, settings=settings))
    assert out == []
    _FakeSeeder.raise_exc = None


def test_seed_missing_asyncurlseeder_soft_disables(monkeypatch):
    # crawl4ai < 0.7: module exists but has no AsyncUrlSeeder → ImportError.
    fake = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "crawl4ai", fake)
    settings = _settings()
    out = asyncio.run(seed_site_urls(BASE, settings=settings))
    assert out == []

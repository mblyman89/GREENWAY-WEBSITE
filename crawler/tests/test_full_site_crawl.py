"""Slice C2 integration — research_target walks the WHOLE site via the frontier.

Simulates a realistic vendor site shape with fetch_page monkeypatched (no
network): the homepage links only to /products/; the individual product pages
are linked only FROM /products/ (plus a paginated second catalog page). The
old one-shot discovery could never reach them; the frontier crawl must.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app.pipeline as pipeline  # noqa: E402
from app.config import Settings  # noqa: E402
from app.fetcher import FetchResult  # noqa: E402

BASE = "https://vendor.example.com/"

SITE: dict[str, str] = {
    BASE: """
      <html><body>
        <nav><a href="/products/">Products</a><a href="/privacy/">Privacy</a></nav>
        <h2>OUR STORY</h2>
        <p>Vendor Example is a family farm in Washington growing craft cannabis
        with living soil practices and a focus on rare terpene expressions
        selected over many seasons of pheno hunting on the property.</p>
      </body></html>
    """,
    f"{BASE}products/": """
      <html><body>
        <a href="/products/gg4-rosin/">GG4 Rosin</a>
        <a href="/products/papaya-punch/">Papaya Punch</a>
        <a href="/products/?page=2">Next page</a>
      </body></html>
    """,
    f"{BASE}products/?page=2": """
      <html><body>
        <a href="/products/zkittlez-flower/">Zkittlez Flower</a>
      </body></html>
    """,
    f"{BASE}products/gg4-rosin/": """
      <html><body><div class="card">
        <img src="/img/gg4.jpg" alt="">
        <h3>GG4 Cold Cure Rosin</h3><p>Gassy, earthy solventless rosin.</p>
      </div></body></html>
    """,
    f"{BASE}products/papaya-punch/": """
      <html><body><p>Papaya Punch live hash — tropical and sweet.</p></body></html>
    """,
    f"{BASE}products/zkittlez-flower/": """
      <html><body><p>Zkittlez flower — candy-sweet living soil eighths.</p></body></html>
    """,
}


def _settings(**over) -> Settings:
    return Settings(
        CRAWLER_SHARED_SECRET="s", CRAWL_RESPECT_ROBOTS="false",
        CRAWL_MIN_DELAY_SECONDS="0", CRAWL_SEED_ENABLED="false",
        FOLLOW_SOCIAL_LINKS="false", **over,
    )


def _wire(monkeypatch, fetched_log: list[str]):
    async def fake_fetch(url, *, prefer_browser=True, settings=None, force_fresh=False):
        fetched_log.append(url)
        html = SITE.get(url)
        if html is None:
            return FetchResult(url=url, ok=False, error="404")
        return FetchResult(url=url, ok=True, status=200, html=html,
                           markdown=html, image_urls=[])

    monkeypatch.setattr(pipeline, "fetch_page", fake_fetch)
    monkeypatch.setattr(pipeline, "discover_sitemap_urls", lambda url, settings, limit=100: [])
    monkeypatch.setattr(pipeline, "fetch_banned_phrases", lambda settings=None: [])


def test_frontier_reaches_sub_pages_and_paginated_catalog(monkeypatch):
    fetched: list[str] = []
    _wire(monkeypatch, fetched)
    result = asyncio.run(pipeline.research_target(
        url=BASE, entity_type="vendor", entity_id="v1",
        display_name="Vendor Example", settings=_settings(), max_pages=20,
    ))
    assert result.fetched_ok
    # Every reachable page was read: home + catalog + page 2 + 3 products.
    assert set(result.pages) == set(SITE.keys())
    # Boring pages were never fetched.
    assert all("/privacy/" not in u for u in fetched)
    # Image found on a sub-sub-page carries its adjacent card text.
    img_draft = next(f for f in result.fields if f.field_key == "research_images")
    assert "GG4 Cold Cure Rosin" in img_draft.value
    assert "gg4.jpg" in img_draft.value


def test_budget_still_caps_the_crawl(monkeypatch):
    fetched: list[str] = []
    _wire(monkeypatch, fetched)
    result = asyncio.run(pipeline.research_target(
        url=BASE, entity_type="vendor", entity_id="v1",
        settings=_settings(), max_pages=2,
    ))
    assert len(result.pages) == 2  # entry + exactly one frontier page


def test_no_page_is_fetched_twice(monkeypatch):
    fetched: list[str] = []
    _wire(monkeypatch, fetched)
    asyncio.run(pipeline.research_target(
        url=BASE, entity_type="vendor", entity_id="v1",
        settings=_settings(), max_pages=50,
    ))
    assert len(fetched) == len(set(fetched))


def test_product_entity_stays_single_page(monkeypatch):
    fetched: list[str] = []
    _wire(monkeypatch, fetched)
    result = asyncio.run(pipeline.research_target(
        url=f"{BASE}products/gg4-rosin/", entity_type="product", entity_id="p1",
        settings=_settings(), max_pages=20,
    ))
    assert result.pages == [f"{BASE}products/gg4-rosin/"]

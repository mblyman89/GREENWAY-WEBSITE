"""Slice C4 — completeness validation + coverage report.

Owner requirement (docs/ROADMAP_CRAWLER_POWERHOUSE.md): "I want it to take its
time and get everything and somehow validate that it has gotten everything."

Unit tests for the pure module (`app/coverage.py`) plus integration tests that
run the full pipeline over a fake site (same harness as test_full_site_crawl)
and check the `research_coverage` draft and `ResearchResult.coverage` snapshot.
"""
from __future__ import annotations

import asyncio

import pytest

import app.pipeline as pipeline
from app.config import Settings
from app.coverage import (
    LOW_NOVELTY,
    CrawlCoverage,
    SaturationTracker,
    build_coverage,
)
from app.fetcher import FetchResult


# ---------------------------------------------------------------------------
# SaturationTracker
# ---------------------------------------------------------------------------

def test_first_page_is_fully_novel():
    t = SaturationTracker()
    ratio = t.observe_page(
        "Our farm grows sun-kissed cannabis in the Okanogan valley.\n"
        "Every harvest is hand trimmed and slow cured for flavor.",
        ["https://x.com/a.jpg"],
    )
    assert ratio == 1.0
    assert t.saturation is None  # one page proves nothing


def test_repeated_content_scores_zero_novelty():
    text = (
        "Our farm grows sun-kissed cannabis in the Okanogan valley.\n"
        "Every harvest is hand trimmed and slow cured for flavor."
    )
    t = SaturationTracker()
    t.observe_page(text, ["https://x.com/a.jpg"])
    ratio = t.observe_page(text, ["https://x.com/a.jpg"])
    assert ratio == 0.0
    assert t.saturation is not None and t.saturated


def test_new_content_keeps_novelty_high():
    t = SaturationTracker()
    t.observe_page("The first page talks all about our story and mission today.")
    ratio = t.observe_page("A totally different catalog page with brand new products listed.")
    assert ratio == 1.0
    assert not t.saturated


def test_saturation_averages_last_window_only():
    t = SaturationTracker()
    t.observe_page("Completely unique content line number one for page one here.")
    t.observe_page("Completely unique content line number two for page two here.")
    # Three pure-repeat pages → the window is all zeros → saturated.
    for _ in range(3):
        t.observe_page("Completely unique content line number two for page two here.")
    assert t.saturation == 0.0
    assert t.saturated


def test_short_lines_and_empty_pages_ignored():
    t = SaturationTracker()
    ratio = t.observe_page("Home\nMenu\nCart\n")  # nav crumbs only, all < 20 chars
    assert ratio == 0.0


# ---------------------------------------------------------------------------
# CrawlCoverage assessments
# ---------------------------------------------------------------------------

def _cov(**over) -> CrawlCoverage:
    base = dict(
        entry_url="https://example-brand.com/",
        page_budget=25,
        pages_crawled=6,
        pages_failed=[],
        queued_leftover=0,
        frontier={"discovered": 8, "enqueued": 6, "dropped_boring": 1,
                  "dropped_offsite": 1, "duplicates": 3},
    )
    base.update(over)
    return CrawlCoverage(**base)


def test_assessment_complete_when_queue_empty_no_failures():
    c = _cov()
    assert c.site_exhausted
    assert c.assessment.startswith("COMPLETE —")


def test_assessment_complete_with_gaps_names_failed_pages():
    c = _cov(pages_failed=["https://example-brand.com/broken/"])
    assert c.assessment.startswith("COMPLETE WITH GAPS")
    assert "1 page(s) failed" in c.assessment


def test_assessment_budget_reached_tells_the_fix():
    c = _cov(queued_leftover=14, saturation=0.6, saturated=False)
    assert c.assessment.startswith("BUDGET REACHED")
    assert "CRAWL_MAX_PAGES" in c.assessment  # actionable: raise the budget


def test_assessment_saturated_overrides_budget_complaint():
    c = _cov(queued_leftover=14, saturation=0.05, saturated=True)
    assert c.assessment.startswith("SATURATED")


def test_draft_text_is_human_readable():
    c = _cov(queued_leftover=2, saturation=0.4,
             pages_failed=["https://example-brand.com/x/"])
    text = c.draft_text()
    assert "Crawl coverage — https://example-brand.com/" in text
    assert "Pages read: 6 (budget 25)" in text
    assert "Links discovered on-site: 8 unique" in text
    assert "Still queued when the budget ran out: 2 page(s)" in text
    assert "https://example-brand.com/x/" in text


def test_as_dict_round_trips_every_signal():
    c = _cov(queued_leftover=3, saturation=0.2, novelty_ratios=[1.0, 0.4, 0.2])
    d = c.as_dict()
    assert d["queued_leftover"] == 3
    assert d["site_exhausted"] is False
    assert d["novelty_ratios"] == [1.0, 0.4, 0.2]
    assert d["frontier"]["discovered"] == 8
    assert isinstance(d["assessment"], str) and d["assessment"]


def test_build_coverage_snapshots_tracker():
    t = SaturationTracker()
    t.observe_page("Totally unique first page content sentence for this test case.")
    t.observe_page("Totally unique first page content sentence for this test case.")
    c = build_coverage(
        entry_url="https://example-brand.com/", page_budget=5, pages_crawled=2,
        pages_failed=[], queued_leftover=0,
        frontier_stats={"discovered": 1, "enqueued": 1, "dropped_boring": 0,
                        "dropped_offsite": 0, "duplicates": 0},
        tracker=t,
    )
    assert c.novelty_ratios == [1.0, 0.0]
    assert c.saturation == 0.0 and c.saturated
    assert LOW_NOVELTY > 0  # sanity: threshold exists and is positive


# ---------------------------------------------------------------------------
# Pipeline integration — research_coverage draft + result.coverage
# ---------------------------------------------------------------------------

BASE = "https://example-brand.com"

SITE: dict[str, str] = {
    f"{BASE}/": """
      <html><body>
        <nav><a href="/products/">Products</a></nav>
        <p>We are a family farm in Washington growing craft cannabis flower.</p>
      </body></html>
    """,
    f"{BASE}/products/": """
      <html><body>
        <h1>Our products</h1>
        <p>Browse the full lineup of our craft cannabis flower and hash below.</p>
        <a href="/products/gg4/">GG4</a>
      </body></html>
    """,
    f"{BASE}/products/gg4/": """
      <html><body>
        <h1>GG4</h1>
        <p>An award winning gorilla glue phenotype with heavy resin production.</p>
      </body></html>
    """,
}


def _html_to_md(html: str) -> str:
    import re as _re
    return _re.sub(r"<[^>]+>", " ", html)


def _settings(**env: object) -> Settings:
    base: dict[str, str] = {
        "CRAWLER_SHARED_SECRET": "s",
        "CRAWL_RESPECT_ROBOTS": "false",
        "CRAWL_MIN_DELAY_SECONDS": "0",
        "CRAWL_SEED_ENABLED": "false",
        "FOLLOW_SOCIAL_LINKS": "false",
    }
    base.update({k: str(v) for k, v in env.items()})
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


@pytest.fixture()
def fake_site(monkeypatch):
    async def fake_fetch(url, *, prefer_browser=True, settings=None):
        html = SITE.get(url)
        if html is None:
            return FetchResult(url=url, ok=False, status=404, error="HTTP 404")
        return FetchResult(url=url, ok=True, status=200, html=html,
                           markdown=_html_to_md(html))

    monkeypatch.setattr(pipeline, "fetch_page", fake_fetch)
    monkeypatch.setattr(pipeline, "discover_sitemap_urls",
                        lambda url, settings, limit=100: [])
    monkeypatch.setattr(pipeline, "fetch_banned_phrases", lambda settings: [])


def test_pipeline_emits_complete_coverage_draft(fake_site):
    result = asyncio.run(pipeline.research_target(
        url=f"{BASE}/", entity_type="brand", entity_id="b1",
        display_name="Example", settings=_settings(),
    ))
    assert result.coverage is not None
    assert result.coverage.site_exhausted
    assert result.coverage.pages_crawled == 3
    cov = [f for f in result.fields if f.field_key == "research_coverage"]
    assert len(cov) == 1 and cov[0].accepted
    assert "COMPLETE" in cov[0].value
    assert "Pages read: 3" in cov[0].value


def test_pipeline_reports_budget_reached_with_leftover(fake_site):
    result = asyncio.run(pipeline.research_target(
        url=f"{BASE}/", entity_type="brand", entity_id="b1",
        display_name="Example", settings=_settings(), max_pages=2,
    ))
    assert result.coverage is not None
    assert result.coverage.pages_crawled == 2
    assert result.coverage.queued_leftover >= 1  # gg4 page never read
    cov = [f for f in result.fields if f.field_key == "research_coverage"]
    assert "BUDGET REACHED" in cov[0].value or "SATURATED" in cov[0].value


def test_pipeline_counts_failed_pages(fake_site, monkeypatch):
    async def flaky_fetch(url, *, prefer_browser=True, settings=None):
        if url.endswith("/products/gg4/"):
            return FetchResult(url=url, ok=False, status=503, error="HTTP 503")
        html = SITE.get(url)
        if html is None:
            return FetchResult(url=url, ok=False, status=404, error="HTTP 404")
        return FetchResult(url=url, ok=True, status=200, html=html,
                           markdown=_html_to_md(html))

    monkeypatch.setattr(pipeline, "fetch_page", flaky_fetch)
    result = asyncio.run(pipeline.research_target(
        url=f"{BASE}/", entity_type="brand", entity_id="b1",
        display_name="Example", settings=_settings(),
    ))
    assert result.coverage is not None
    assert result.coverage.pages_failed == [f"{BASE}/products/gg4/"]
    cov = [f for f in result.fields if f.field_key == "research_coverage"]
    assert "COMPLETE WITH GAPS" in cov[0].value
    assert f"{BASE}/products/gg4/" in cov[0].value


def test_product_lookup_has_no_coverage(fake_site):
    result = asyncio.run(pipeline.research_target(
        url=f"{BASE}/products/gg4/", entity_type="product", entity_id="p1",
        display_name="GG4", settings=_settings(),
    ))
    assert result.coverage is None
    assert not any(f.field_key == "research_coverage" for f in result.fields)

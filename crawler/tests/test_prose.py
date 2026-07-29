"""SLICE 88 — best-prose extraction + field-fit advisories (pure, no network).

Covers app/prose.py: paragraph scoring keeps real writing and drops nav junk,
build_research_text credits each quoted paragraph to its source URL and
de-duplicates repeated footers, and field_fit_flags raises ADVISORY (never
blocking) flags when text obviously doesn't fit a profile field.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.prose import (  # noqa: E402
    MAX_BLOCK_CHARS,
    MAX_TEXT_PAGES,
    best_prose,
    build_research_text,
    field_fit_flags,
    link_density,
    prose_score,
    strip_links,
)

# A paragraph of real, substantial prose (> MIN_PROSE_CHARS, real sentences).
GOOD_PROSE = (
    "Our family farm sits on forty acres in the Okanogan highlands, where we "
    "have grown sun-loving cultivars for three generations. Every harvest is "
    "hand-trimmed, slow-cured for sixty days, and tested twice before it "
    "leaves the barn. We believe good farming shows in the jar."
)

NAV_JUNK = "[Home](/) [Shop](/shop) [About](/about) [Contact](/contact) [FAQ](/faq)"


# ---------------------------------------------------------------------------
# strip_links / link_density
# ---------------------------------------------------------------------------

def test_strip_links_keeps_anchor_text_drops_urls():
    out = strip_links("See [our story](https://x.com/story) at https://x.com now")
    assert "our story" in out
    assert "https://" not in out


def test_strip_links_removes_images_entirely():
    assert strip_links("![logo](https://x.com/logo.png)").strip() == ""


def test_link_density_high_for_nav_lists():
    assert link_density(NAV_JUNK) > 0.4


def test_link_density_low_for_prose():
    assert link_density(GOOD_PROSE) == 0.0


# ---------------------------------------------------------------------------
# prose_score / best_prose
# ---------------------------------------------------------------------------

def test_prose_score_accepts_real_writing():
    assert prose_score(GOOD_PROSE) > 0


def test_prose_score_rejects_headings_navs_boilerplate_and_short():
    assert prose_score("# Our Products") == 0.0
    assert prose_score(NAV_JUNK) == 0.0
    assert prose_score(
        "This website uses cookies to improve your experience and by continuing "
        "you agree to our privacy policy and terms of service in their entirety."
    ) == 0.0
    assert prose_score("Too short.") == 0.0


def test_best_prose_picks_the_substantial_paragraph():
    page = "# Welcome\n\n" + NAV_JUNK + "\n\n" + GOOD_PROSE + "\n\nCopyright 2026 All rights reserved."
    assert best_prose(page) == " ".join(GOOD_PROSE.split())


def test_best_prose_empty_when_page_is_all_junk():
    assert best_prose("# Title\n\n" + NAV_JUNK + "\n\nLog in | Sign up") == ""


def test_best_prose_truncates_at_block_cap_on_word_boundary():
    monster = ("This sentence is honest filler about the farm and the valley. " * 60).strip()
    out = best_prose(monster)
    assert len(out) <= MAX_BLOCK_CHARS
    assert out.endswith("…")


# ---------------------------------------------------------------------------
# build_research_text
# ---------------------------------------------------------------------------

def test_build_research_text_credits_each_page():
    other = (
        "The processing kitchen was licensed in 2019 and runs a solventless "
        "press line six days a week. Each batch is logged, weighed, and "
        "photographed before it moves to the cure room for final inspection."
    )
    out = build_research_text([
        ("https://a.example.com/", GOOD_PROSE),
        ("https://a.example.com/about", other),
    ])
    assert "FROM https://a.example.com/" in out
    assert "FROM https://a.example.com/about" in out
    assert "forty acres" in out and "press line" in out
    assert out.startswith("TEXT FOUND ON THEIR SITE")


def test_build_research_text_dedupes_repeated_footer_prose():
    out = build_research_text([
        ("https://a.example.com/", GOOD_PROSE),
        ("https://a.example.com/shop", GOOD_PROSE),
    ])
    assert out.count("forty acres") == 1
    assert "FROM https://a.example.com/\n" in out  # credited to the FIRST page


def test_build_research_text_skips_junk_pages_and_caps_pages():
    pages = [("https://a.example.com/junk", NAV_JUNK)]
    pages += [
        (f"https://a.example.com/p{i}",
         f"Page number {i} tells its own long and unique story about the farm, "
         f"the family, and the valley where the plants grow strong in season {i}. "
         f"Neighbors stop by every week to trade tools and talk about weather.")
        for i in range(MAX_TEXT_PAGES + 5)
    ]
    out = build_research_text(pages)
    assert "junk" not in out
    assert out.count("FROM ") == MAX_TEXT_PAGES


def test_build_research_text_empty_when_no_prose_anywhere():
    assert build_research_text([("https://a.example.com/", NAV_JUNK)]) == ""


# ---------------------------------------------------------------------------
# field_fit_flags (advisory only)
# ---------------------------------------------------------------------------

def test_fit_clean_profile_text_gets_no_flags():
    assert field_fit_flags("about", GOOD_PROSE) == []


def test_fit_ignores_reference_fields_and_empty():
    assert field_fit_flags("research_products", NAV_JUNK) == []
    assert field_fit_flags("about", "") == []


def test_fit_flags_very_short_text():
    flags = field_fit_flags("mission_statement", "We grow weed.")
    assert any("very short" in f for f in flags)


def test_fit_flags_linky_navigation_text():
    flags = field_fit_flags("about", NAV_JUNK + " visit https://x.com today for more")
    assert any("links/URLs" in f for f in flags)


def test_fit_flags_boilerplate():
    flags = field_fit_flags(
        "about",
        "This website uses cookies to improve your experience while you browse "
        "through the pages and by continuing you agree to the privacy policy.",
    )
    assert any("boilerplate" in f for f in flags)


def test_fit_flags_price_list_posing_as_about():
    text = "\n".join([
        "Blue Dream 3.5g $25",
        "Sour Diesel 7g $45",
        "GG4 1g $10",
        "Wedding Cake 3.5g $30",
    ])
    flags = field_fit_flags("about", text)
    assert any("price list" in f for f in flags)


def test_fit_flags_no_sentences():
    flags = field_fit_flags(
        "about",
        "Premium indoor flower solventless rosin small batch craft cannabis "
        "hand trimmed slow cured family owned and operated in Washington",
    )
    assert any("no complete sentences" in f for f in flags)


def test_fit_never_blocks_only_advises():
    """Every flag is a string advisory — there is no blocking concept here."""
    flags = field_fit_flags("about", "Short and linky https://x.com")
    assert all(isinstance(f, str) and f.startswith("fit:") for f in flags)


# ---------------------------------------------------------------------------
# Integration: research_target emits ONE research_text reference draft
# ---------------------------------------------------------------------------

import asyncio  # noqa: E402

import app.pipeline as pipeline  # noqa: E402
from app.config import Settings  # noqa: E402
from app.fetcher import FetchResult  # noqa: E402

PROSE_BASE = "https://prose-vendor.example.com/"

PROSE_SITE: dict[str, tuple[str, str]] = {
    # url -> (html, markdown)
    PROSE_BASE: (
        '<html><body><nav><a href="/about/">About</a></nav>'
        "<p>Prose Vendor grows craft cannabis in Washington using living soil "
        "beds built over a decade. Every jar is hand weighed and slow cured "
        "in the barn before release.</p></body></html>",
        "Prose Vendor grows craft cannabis in Washington using living soil "
        "beds built over a decade. Every jar is hand weighed and slow cured "
        "in the barn before release.",
    ),
    f"{PROSE_BASE}about/": (
        "<html><body><p>The farm started as a two-person operation in 2014 "
        "and still hand-selects every mother plant from in-house pheno hunts. "
        "Harvests are small on purpose so nothing is rushed.</p></body></html>",
        "The farm started as a two-person operation in 2014 and still "
        "hand-selects every mother plant from in-house pheno hunts. Harvests "
        "are small on purpose so nothing is rushed.",
    ),
}


def _prose_settings(tmp_path) -> Settings:
    return Settings(
        CRAWLER_SHARED_SECRET="s", CRAWL_RESPECT_ROBOTS="false",
        CRAWL_MIN_DELAY_SECONDS="0", CRAWL_SEED_ENABLED="false",
        FOLLOW_SOCIAL_LINKS="false", CACHE_DIR=str(tmp_path),
    )


def _wire_prose(monkeypatch):
    async def fake_fetch(url, *, prefer_browser=True, settings=None, force_fresh=False):
        entry = PROSE_SITE.get(url)
        if entry is None:
            return FetchResult(url=url, ok=False, error="404")
        html, markdown = entry
        return FetchResult(url=url, ok=True, status=200, html=html,
                           markdown=markdown, image_urls=[])

    monkeypatch.setattr(pipeline, "fetch_page", fake_fetch)
    monkeypatch.setattr(pipeline, "discover_sitemap_urls", lambda url, settings, limit=100: [])
    monkeypatch.setattr(pipeline, "fetch_banned_phrases", lambda settings=None: [])


def test_research_target_emits_research_text_draft(monkeypatch, tmp_path):
    _wire_prose(monkeypatch)
    result = asyncio.run(pipeline.research_target(
        url=PROSE_BASE, entity_type="vendor", entity_id="v-prose",
        display_name="Prose Vendor", settings=_prose_settings(tmp_path), max_pages=10,
    ))
    assert result.fetched_ok
    draft = next(f for f in result.fields if f.field_key == "research_text")
    assert draft.accepted is True
    assert f"FROM {PROSE_BASE}" in draft.value
    assert f"FROM {PROSE_BASE}about/" in draft.value
    assert "living soil" in draft.value and "pheno hunts" in draft.value


def test_research_text_absent_for_product_lookups(monkeypatch, tmp_path):
    _wire_prose(monkeypatch)
    result = asyncio.run(pipeline.research_target(
        url=PROSE_BASE, entity_type="product", entity_id="p1",
        settings=_prose_settings(tmp_path), max_pages=10,
    ))
    assert all(f.field_key != "research_text" for f in result.fields)


def test_evaluate_field_carries_advisory_fit_flags():
    """Accepted profile text that is clearly a link/nav blob gets fit: flags
    from the pipeline's _evaluate_field (advisory — accepted stays True)."""
    page = ("Visit [Home](/) and [Shop](/shop) then see https://x.example.com "
            "for everything about the farm and the shop and the valley today")
    value = ("Visit [Home](/) and [Shop](/shop) then see https://x.example.com "
             "for everything about the farm and the shop and the valley today")
    outcome = pipeline._evaluate_field("about", value, 0.9, "css", page, [])
    assert outcome.accepted is True
    assert any(f.startswith("fit:") for f in outcome.flags)

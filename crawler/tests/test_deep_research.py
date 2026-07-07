"""Unit tests for the deep-research upgrade — pure logic, no network/LLM.

Covers: heading-section mining (OUR STORY / OUR GROW / OUR HASH pages),
rich-beats-thin value merging, nav-link discovery + interest ranking, image
alt-text harvesting, and product-lineup verification.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.css_extract import extract_css  # noqa: E402
from app.discovery import discover_nav_links, page_interest_score  # noqa: E402
from app.pipeline import (  # noqa: E402
    _format_product_lines,
    _merge_css_values,
    _verify_product_lines,
)
from app.schemas import ProductLine  # noqa: E402

BASE = "https://example-brand.com/"

STORY_HTML = """
<html><head><title>Example Brand</title>
<meta property="og:description" content="The best hash in Washington.">
</head><body>
<nav>
  <a href="/our-story/">About</a>
  <a href="/rosin/">Rosin</a>
  <a href="/edibles/">Edibles</a>
  <a href="/privacy/">Privacy</a>
  <a href="https://othersite.com/merch">Merch</a>
</nav>
<h2>OUR STORY</h2>
<p>Example Brand is an award-winning family operated single source farm located
in Arlington, WA that specializes in solventless ice water extraction. The team
grows unique cannabis strains bred and selected for their rich trichome
production and terpene profiles, with a commitment to operational excellence.</p>
<h2>OUR GROW</h2>
<p>A key component of the grow is a constant search for new and unique genetics.
Each year thousands of seeds are sorted to find a small fraction of truly
remarkable plants that make it into a full time production schedule of 50-60
strains, selected first for special terpene profiles.</p>
<h2>OUR HASH</h2>
<p>The flagship product is solventless hash. Extraction uses only water and ice
to mechanically separate the trichome heads from the plant material, and every
product comes from fresh frozen whole plant material grown on site.</p>
<img src="/img/jar.jpg" alt="Cold cure hash rosin jar">
<img src="/img/sprite-icons.png" alt="icons">
<img src="/img/strain-tube.webp" alt="Papaya BX rosin tube">
</body></html>
"""


def test_heading_sections_mined_and_rich_beats_thin_meta():
    css = extract_css(STORY_HTML, BASE)
    # The one-line og:description must NOT win over the real OUR STORY section.
    assert "award-winning family operated" in css.about
    assert len(css.about) > 200
    # OUR GROW + OUR HASH → product_philosophy.
    assert "unique genetics" in css.product_philosophy
    assert "water and ice" in css.product_philosophy


def test_image_alt_text_harvested_and_sprites_skipped():
    css = extract_css(STORY_HTML, BASE)
    urls = [u for u, _ in css.images]
    alts = {u: a for u, a in css.images}
    assert f"{BASE}img/jar.jpg" in urls
    assert alts[f"{BASE}img/jar.jpg"] == "Cold cure hash rosin jar"
    assert all("sprite" not in u for u in urls)


def test_nav_link_discovery_same_site_only_and_ranked():
    links = discover_nav_links(STORY_HTML, BASE)
    assert f"{BASE}our-story/" in links
    assert f"{BASE}rosin/" in links
    assert all("othersite.com" not in u for u in links)
    assert all("privacy" not in u for u in links)  # boring pages excluded
    # our-story (interest keyword) should rank at/above generic pages.
    assert links.index(f"{BASE}our-story/") == 0


def test_interest_score_boring_negative():
    assert page_interest_score("https://x.com/privacy/") < 0
    assert page_interest_score("https://x.com/our-story/") > 0
    assert page_interest_score("https://x.com/rosin/") >= 1  # short top-level path


def test_merge_rich_replaces_thin():
    values = {"about": "The best hash in Washington."}  # thin one-liner

    class FakeCss:
        about = ("Example Brand is an award-winning family operated single source "
                 "farm located in Arlington, WA that specializes in solventless ice "
                 "water extraction, growing unique cannabis strains selected for "
                 "their rich trichome production and terpene profiles year round.")
        mission_statement = ""
        product_philosophy = ""
        description = ""

    _merge_css_values(values, FakeCss(), is_product=False)
    assert "award-winning" in values["about"]

    # But a long existing value is NOT replaced (no churn once we're rich).
    long_existing = dict(values)
    class ThinCss:
        about = "Short line."
        mission_statement = ""
        product_philosophy = ""
        description = ""
    _merge_css_values(long_existing, ThinCss(), is_product=False)
    assert long_existing["about"] == values["about"]


def test_product_lineup_verify_drops_hallucinated_names():
    corpus = ("Our rosin lineup: Papaya BX (Mango #33 x Afghani #1) with papaya, "
              "citrus zest and earthy notes. Also Strawnana, Banana Kush x Bubblegum.")
    products = [
        ProductLine(name="Papaya BX", lineage="Mango #33 x Afghani #1", notes="papaya, citrus zest, earthy"),
        ProductLine(name="Strawnana", lineage="Banana Kush x Bubblegum", notes=""),
        ProductLine(name="Blue Dream", lineage="Blueberry x Haze", notes="berry"),  # NOT on page
    ]
    kept = _verify_product_lines(products, corpus)
    names = [p.name for p in kept]
    assert "Papaya BX" in names and "Strawnana" in names
    assert "Blue Dream" not in names


def test_product_lineup_verify_strips_unsupported_lineage():
    corpus = "We grow Gary Payton and it is wonderful."
    products = [ProductLine(name="Gary Payton", lineage="The Y x Snowman", notes="")]
    kept = _verify_product_lines(products, corpus)
    assert kept[0].name == "Gary Payton"
    assert kept[0].lineage == ""  # lineage not on page → stripped, name kept


def test_format_product_lines():
    txt = _format_product_lines([
        ProductLine(name="Papaya BX", lineage="Mango #33 x Afghani #1", category="rosin", notes="papaya, earthy"),
        ProductLine(name="", lineage="x", notes=""),  # nameless → skipped
    ])
    assert "Papaya BX (Mango #33 x Afghani #1) — rosin · papaya, earthy" in txt
    assert txt.count("\n") == 0


ABOUT_PAGE_HTML = """<!doctype html><html><head><title>About</title></head><body>
<h1>Reaching for the stars</h1>
<p>Constellation began as a family dream in a small Washington town, growing a
handful of plants with a focus on genetics, patience, and craft above all.</p>
<h3>Decorative heading that matches nothing</h3>
<p>Today the family still hand-selects every phenotype, washes small batches of
ice water hash, and cold cures every jar of rosin before it leaves the building.</p>
</body></html>
"""


def test_about_path_full_body_capture_h9():
    # H9: on an about-like PATH, substantial paragraphs are captured as `about`
    # even when no heading matches the keyword lists.
    css = extract_css(ABOUT_PAGE_HTML, "https://brand.example/our-story/")
    assert "family dream" in css.about
    assert "cold cures" in css.about
    assert len(css.about) > 160


def test_non_about_path_does_not_full_body_capture_h9():
    # Same HTML on a random path: no heading matches, no path match -> no grab.
    css = extract_css(ABOUT_PAGE_HTML, "https://brand.example/checkout/")
    assert "family dream" not in css.about

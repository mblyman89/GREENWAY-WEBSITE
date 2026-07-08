"""Slice H10a — image-coverage tests for the crawler's extractors.

The owner's report: the crawler harvested every rosin but only ONE of many
edibles. Root cause: product catalogs lazy-load below-the-fold images behind
srcset / data-srcset / data-lazy-src / <picture><source> / CSS background-image,
and the old extractor read only <img src|data-src> + og:image (then capped the
result too low). These tests pin the widened extraction.

Pure: no network. Exercises fetcher._extract_image_urls and css_extract's
content-image loop.
"""
from __future__ import annotations

from app.css_extract import extract_css
from app.fetcher import _MAX_IMAGES_PER_PAGE, _extract_image_urls, _pick_from_srcset

BASE = "https://vendor.example"


def _wrap(body: str) -> str:
    return f"<html><head></head><body>{body}</body></html>"


# ---------------------------------------------------------------------------
# fetcher._extract_image_urls
# ---------------------------------------------------------------------------

def test_plain_src_still_extracted():
    urls = _extract_image_urls(_wrap('<img src="/img/rosin-1.jpg">'), BASE)
    assert f"{BASE}/img/rosin-1.jpg" in urls


def test_lazy_data_attrs_extracted():
    html = _wrap(
        '<img data-lazy-src="/edibles/gummy-1.jpg">'
        '<img data-original="/edibles/gummy-2.jpg">'
        '<img data-image="/edibles/gummy-3.jpg">'
        '<img data-full-url="/edibles/gummy-4.jpg">'
        '<img data-large_image="/edibles/gummy-5.jpg">'
        '<img data-zoom-image="/edibles/gummy-6.jpg">'
    )
    urls = _extract_image_urls(html, BASE)
    for i in range(1, 7):
        assert f"{BASE}/edibles/gummy-{i}.jpg" in urls, f"gummy-{i} missed"


def test_srcset_prefers_largest_candidate():
    html = _wrap('<img srcset="/e/small.jpg 400w, /e/large.jpg 1200w">')
    urls = _extract_image_urls(html, BASE)
    assert f"{BASE}/e/large.jpg" in urls
    assert f"{BASE}/e/small.jpg" not in urls


def test_data_srcset_supported():
    html = _wrap('<img data-srcset="/e/a.jpg 1x, /e/b.jpg 2x">')
    urls = _extract_image_urls(html, BASE)
    assert f"{BASE}/e/b.jpg" in urls


def test_picture_source_extracted():
    html = _wrap(
        "<picture>"
        '<source srcset="/edibles/cosmic-crunch.webp 800w">'
        '<img src="/placeholder.gif" alt="Cosmic Crunch">'
        "</picture>"
    )
    urls = _extract_image_urls(html, BASE)
    assert f"{BASE}/edibles/cosmic-crunch.webp" in urls


def test_css_background_image_extracted():
    html = _wrap(
        '<div style="background-image: url(\'/tiles/edible-tile.jpg\');"></div>'
        '<div style="background:url(/tiles/hero.png) no-repeat"></div>'
    )
    urls = _extract_image_urls(html, BASE)
    assert f"{BASE}/tiles/edible-tile.jpg" in urls
    assert f"{BASE}/tiles/hero.png" in urls


def test_og_image_still_extracted():
    html = '<html><head><meta property="og:image" content="/og/cover.jpg"></head><body></body></html>'
    urls = _extract_image_urls(html, BASE)
    assert f"{BASE}/og/cover.jpg" in urls


def test_junk_and_data_uris_dropped():
    html = _wrap(
        '<img src="data:image/gif;base64,R0lGOD">'
        '<img src="/img/sprite-icons.png">'
        '<img src="/img/1x1.gif">'
        '<img src="/img/tracking-pixel.png">'
        '<img src="/img/lazy-placeholder.png">'
        '<img src="/img/real-product.jpg">'
    )
    urls = _extract_image_urls(html, BASE)
    assert urls == [f"{BASE}/img/real-product.jpg"]


def test_dedupes_across_sources():
    html = _wrap(
        '<img src="/p/one.jpg">'
        "<picture><source srcset=\"/p/one.jpg 1x\"><img src='/p/one.jpg'></picture>"
    )
    urls = _extract_image_urls(html, BASE)
    assert urls.count(f"{BASE}/p/one.jpg") == 1


def test_cap_is_80():
    assert _MAX_IMAGES_PER_PAGE == 80
    body = "".join(f'<img src="/catalog/edible-{i}.jpg">' for i in range(120))
    urls = _extract_image_urls(_wrap(body), BASE)
    assert len(urls) == 80  # was 40 — half a 120-item catalog was dropped


def test_pick_from_srcset_edge_cases():
    assert _pick_from_srcset("") == ""
    assert _pick_from_srcset("/a.jpg 1x") == "/a.jpg"
    assert _pick_from_srcset("/a.jpg 400w, /b.jpg 800w, /c.jpg 1600w") == "/c.jpg"


# ---------------------------------------------------------------------------
# css_extract content-image loop (feeds research_images alt-text pairs)
# ---------------------------------------------------------------------------

def test_css_extract_reads_lazy_attrs_with_alt():
    html = _wrap(
        '<img data-lazy-src="/edibles/rosin-gummy.jpg" alt="Rosin Gummy 10-pack">'
    )
    out = extract_css(html, BASE)
    assert (f"{BASE}/edibles/rosin-gummy.jpg", "Rosin Gummy 10-pack") in out.images


def test_css_extract_reads_picture_source_with_sibling_alt():
    html = _wrap(
        "<picture>"
        '<source data-srcset="/edibles/fruit-chew.webp 1200w">'
        '<img src="data:image/gif;base64,tiny" alt="Fruit Chew">'
        "</picture>"
    )
    out = extract_css(html, BASE)
    assert (f"{BASE}/edibles/fruit-chew.webp", "Fruit Chew") in out.images


def test_css_extract_still_dedupes():
    html = _wrap(
        '<img src="/p/x.jpg" alt="X">'
        '<img data-lazy-src="/p/x.jpg" alt="X again">'
    )
    out = extract_css(html, BASE)
    assert out.image_urls.count(f"{BASE}/p/x.jpg") == 1

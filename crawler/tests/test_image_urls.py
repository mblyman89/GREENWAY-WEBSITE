"""Slice H10b — pins the image-URL hardening (the "black square" fix).

The crawler harvested placeholder/blank images because the extractors preferred
the ``src`` attribute over the real lazy ``data-*`` / ``srcset`` image, and only
tested for a placeholder AFTER selecting. These tests reproduce the exact
black-square inputs (verified against the real extractors before the fix) and
pin the corrected selection in app.image_urls plus its wiring into the fetcher,
the css extractor, and the logo finder.

Pure: no network.
"""
from __future__ import annotations

from app.css_extract import extract_css
from app.fetcher import _extract_image_urls
from app.image_urls import (
    best_image_url,
    is_placeholder_url,
    parse_srcset,
)
from app.logos import detect_logo_candidates

BASE = "https://vendor.example"


def _wrap(body: str) -> str:
    return f"<html><head></head><body>{body}</body></html>"


def _dict_get(d: dict):
    return d.get


# ---------------------------------------------------------------------------
# is_placeholder_url
# ---------------------------------------------------------------------------

def test_placeholder_detects_data_uri():
    assert is_placeholder_url("data:image/gif;base64,R0lGOD")
    assert is_placeholder_url("data:image/svg+xml;base64,PHN2Zw==")


def test_placeholder_detects_common_names():
    for u in (
        "/theme/lazy.svg",
        "/assets/loading.gif",
        "/img/loader.svg",
        "/i/lazy-placeholder.png",
        "/img/no-image.png",
        "/img/noimage.jpg",
        "/media/no_image.webp",
        "/img/dummy.png",
        "/px/transparent.gif",
        "/img/skeleton.svg",
        "/img/lqip-shimmer.png",
        "/img/blank.gif",
        "/img/spacer.gif",
        "/icons/sprite-nav.png",
        "/t/1x1.gif",
        "/t/tracking-pixel.png",
        "/img/default.jpg",  # bare default.<ext>
    ):
        assert is_placeholder_url(u), f"expected placeholder: {u}"


def test_placeholder_empty_is_true():
    assert is_placeholder_url("")
    assert is_placeholder_url(None)
    assert is_placeholder_url("   ")


def test_real_product_urls_not_flagged():
    # "default-blend" contains "default" but is a REAL product, not "default.<ext>"
    for u in (
        "/products/default-blend.jpg",
        "/products/rosin-live-1200.jpg",
        "/wp-content/uploads/2026/03/cosmic-crunch.webp",
        "/img/gummy-10-pack.png",
    ):
        assert not is_placeholder_url(u), f"real url wrongly flagged: {u}"


# ---------------------------------------------------------------------------
# parse_srcset — largest by descriptor, skips placeholders, not positional
# ---------------------------------------------------------------------------

def test_srcset_largest_by_width_not_position():
    # tiny fallback appended LAST must not win.
    assert parse_srcset("/big.jpg 1200w, /tiny.gif 1w") == "/big.jpg"
    assert parse_srcset("/c.jpg 1600w, /a.jpg 400w, /b.jpg 800w") == "/c.jpg"


def test_srcset_density_descriptors():
    assert parse_srcset("/a.jpg 1x, /b.jpg 2x, /c.jpg 3x") == "/c.jpg"


def test_srcset_single_and_empty():
    assert parse_srcset("/only.jpg 1x") == "/only.jpg"
    assert parse_srcset("/only.jpg") == "/only.jpg"
    assert parse_srcset("") == ""
    assert parse_srcset(None) == ""


def test_srcset_skips_placeholder_candidates():
    assert parse_srcset("/lazy-placeholder.png 10w, /real.jpg 800w") == "/real.jpg"


# ---------------------------------------------------------------------------
# best_image_url — placeholder src can never beat a real lazy/srcset image
# ---------------------------------------------------------------------------

def test_real_srcset_beats_placeholder_src():
    got = best_image_url(_dict_get({"src": "/theme/lazy.svg", "srcset": "/real.jpg 800w"}))
    assert got == "/real.jpg"


def test_real_data_src_beats_placeholder_src():
    got = best_image_url(_dict_get({"src": "/assets/loading.gif", "data-src": "/real.jpg"}))
    assert got == "/real.jpg"


def test_data_uri_src_falls_through_to_data_src():
    got = best_image_url(_dict_get({"src": "data:image/svg+xml;base64,x", "data-src": "/real.jpg"}))
    assert got == "/real.jpg"


def test_plain_src_used_when_real():
    got = best_image_url(_dict_get({"src": "/products/real.jpg"}))
    assert got == "/products/real.jpg"


def test_returns_empty_when_only_placeholder():
    # A blank square is never useful — refuse rather than harvest it.
    got = best_image_url(_dict_get({"src": "/theme/lazy.svg"}))
    assert got == ""


def test_lazy_attr_priority_over_src():
    got = best_image_url(
        _dict_get({"src": "/img/default.jpg", "data-lazy-src": "/real5.jpg"})
    )
    assert got == "/real5.jpg"


# ---------------------------------------------------------------------------
# Wiring — the three reproduced black-square inputs, end to end
# ---------------------------------------------------------------------------

def test_fetcher_placeholder_src_no_longer_wins():
    html = _wrap('<img src="/theme/lazy.svg" data-src="/products/real-gummy.jpg">')
    urls = _extract_image_urls(html, BASE)
    assert urls == [f"{BASE}/products/real-gummy.jpg"]


def test_fetcher_loading_gif_replaced_by_real():
    html = _wrap('<img src="/assets/loading.gif" data-lazy-src="/products/real2.jpg">')
    urls = _extract_image_urls(html, BASE)
    assert urls == [f"{BASE}/products/real2.jpg"]


def test_fetcher_data_uri_src_recovers_real_image():
    html = _wrap('<img src="data:image/svg+xml;base64,PHN2Zw==" data-src="/products/real4.jpg">')
    urls = _extract_image_urls(html, BASE)
    assert urls == [f"{BASE}/products/real4.jpg"]


def test_fetcher_tiny_srcset_fallback_not_picked():
    html = _wrap('<img srcset="/big.jpg 1200w, /tiny.gif 1w">')
    urls = _extract_image_urls(html, BASE)
    assert f"{BASE}/big.jpg" in urls
    assert f"{BASE}/tiny.gif" not in urls


def test_css_extract_placeholder_src_no_longer_wins():
    html = _wrap('<img src="/theme/lazy.svg" data-src="/products/real.jpg" alt="Real">')
    out = extract_css(html, BASE)
    assert (f"{BASE}/products/real.jpg", "Real") in out.images
    assert all("lazy.svg" not in u for u in out.image_urls)


def test_css_extract_drops_data_uri_from_structured_sources():
    # og:image placeholder data-URI must not leak into image_urls.
    html = (
        '<html><head>'
        '<meta property="og:image" content="data:image/gif;base64,R0lGOD">'
        '</head><body>'
        '<img src="/products/real.jpg" alt="Real">'
        '</body></html>'
    )
    out = extract_css(html, BASE)
    assert f"{BASE}/products/real.jpg" in out.image_urls
    assert all(not u.startswith("data:") for u in out.image_urls)


def test_logo_prefers_real_lazy_image_over_placeholder_src():
    html = _wrap(
        '<header><img class="site-logo" src="/theme/lazy.svg" '
        'data-src="/brand/logo.png" alt="Acme"></header>'
    )
    cands = detect_logo_candidates(html, BASE)
    urls = [c.url for c in cands]
    assert f"{BASE}/brand/logo.png" in urls
    assert all("lazy.svg" not in u for u in urls)

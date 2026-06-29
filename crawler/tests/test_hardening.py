"""Unit tests for DF-7 hardening helpers — no network, no browser, no LLM.

Covers: domain allow-list, Retry-After parsing, realistic-UA rotation + headers,
RSS/Atom feed discovery, and microdata extraction. Run with the built-in runner
at the bottom, or `python -m pytest -q`.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.config import Settings  # noqa: E402
from app.css_extract import extract_css  # noqa: E402
from app.discovery import discover_feed_urls  # noqa: E402
from app.fetcher import _retry_after_seconds, domain_allowed  # noqa: E402
from app.http_identity import browser_headers, pick_user_agent  # noqa: E402


def test_allow_list_empty_allows_any():
    s = Settings(CRAWL_ALLOW_DOMAINS="")  # type: ignore
    assert domain_allowed(s, "https://anything.example.com/x") is True


def test_allow_list_enforced():
    s = Settings(CRAWL_ALLOW_DOMAINS="goodbrand.com, otherbrand.com")  # type: ignore
    assert domain_allowed(s, "https://goodbrand.com/about") is True
    assert domain_allowed(s, "https://shop.goodbrand.com/p") is True  # subdomain ok
    assert domain_allowed(s, "https://evil.example.com/") is False


def test_retry_after_seconds_numeric():
    resp = httpx.Response(429, headers={"Retry-After": "12"})
    assert _retry_after_seconds(resp) == 12.0


def test_retry_after_http_date_returns_none():
    # HTTP-date form isn't parsed here; we fall back to our own backoff.
    resp = httpx.Response(429, headers={"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"})
    assert _retry_after_seconds(resp) is None


def test_retry_after_absent():
    resp = httpx.Response(200)
    assert _retry_after_seconds(resp) is None


def test_user_agent_realistic_rotates_real_browser():
    ua = pick_user_agent(realistic=True, fallback="GreenwayBot/1.0")
    assert "Mozilla/5.0" in ua  # a real browser UA, not the bot string


def test_user_agent_fallback_when_not_realistic():
    ua = pick_user_agent(realistic=False, fallback="GreenwayBot/1.0")
    assert ua == "GreenwayBot/1.0"


def test_browser_headers_complete():
    h = browser_headers("UA")
    assert h["User-Agent"] == "UA"
    for key in ("Accept", "Accept-Language", "Sec-Fetch-Mode", "Upgrade-Insecure-Requests"):
        assert key in h


def test_discover_feed_urls():
    html = (
        '<html><head>'
        '<link rel="alternate" type="application/rss+xml" href="/feed.xml">'
        '<link rel="alternate" type="application/atom+xml" href="https://x.com/atom">'
        '</head></html>'
    )
    feeds = discover_feed_urls(html, "https://x.com/")
    assert "https://x.com/feed.xml" in feeds
    assert "https://x.com/atom" in feeds


def test_microdata_description_extracted():
    html = (
        '<html><body>'
        '<div itemscope itemtype="http://schema.org/Product">'
        '<span itemprop="description">Bright citrus live resin in a glass jar.</span>'
        '</div></body></html>'
    )
    css = extract_css(html, "https://brand.example/p")
    assert "citrus live resin" in css.description


def test_social_disabled_without_token():
    s = Settings(META_GRAPH_TOKEN="")  # type: ignore
    assert s.social_enabled is False
    s2 = Settings(META_GRAPH_TOKEN="EAAG-token")  # type: ignore
    assert s2.social_enabled is True


if __name__ == "__main__":
    import traceback

    funcs = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in funcs:
        try:
            fn()
            print(f"PASS {fn.__name__}")
            passed += 1
        except Exception:
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{passed}/{len(funcs)} passed")
    sys.exit(0 if passed == len(funcs) else 1)

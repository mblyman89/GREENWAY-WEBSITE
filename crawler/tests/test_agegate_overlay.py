"""Slice C7 — fix the C3 regression on age-gated vendor sites.

Owner report: the crawler returned "1 page, 0 drafts" on every vendor
(topshelfwa.com etc.). Root cause (verified in code + the owner's screenshot):
the C3 advanced browser config set `remove_overlay_elements=True`, and on an
age-gated dispensary theme crawl4ai's overlay remover strips the "Are you 21?"
modal AND the real content wrapper behind it, leaving a thin shell — no nav
links (so the deep crawl saw 1 page) and no draftable text (0 drafts). The
pre-C3 crawler worked because the real content lives UNDER the modal.

C7 fixes:
  1. overlay removal OFF by default (opt-in via CRAWL_REMOVE_OVERLAYS),
  2. a thin-shell fallback: a non-empty-but-contentless advanced result falls
     back to the plain legacy arun (the path that worked),
  3. an age-gate "click YES" + set-age-cookies nudge in the injected JS,
  4. force_fresh to bypass the 24h page cache so a stale shell can't mask it.

These are browser-free unit tests (fake crawl4ai in sys.modules, same pattern
as test_dynamic_fetch.py) plus pure-function tests for the shell heuristic and
the cache bypass.
"""
from __future__ import annotations

import asyncio
import sys
import types

from app.config import Settings
from app.fetcher import (
    _LOAD_MORE_JS,
    _crawl4ai_run_config,
    _fetch_with_crawl4ai,
    _looks_like_thin_shell,
    fetch_page,
)


def _settings(**env: object) -> Settings:
    base: dict[str, str] = {
        "CRAWLER_SHARED_SECRET": "s",
        "CRAWL_RESPECT_ROBOTS": "false",
        "CRAWL_MIN_DELAY_SECONDS": "0",
    }
    base.update({k: str(v) for k, v in env.items()})
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Fix 1 — overlay removal is OFF by default, opt-in via CRAWL_REMOVE_OVERLAYS
# ---------------------------------------------------------------------------

class _ModernRunConfig:
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


def _install_fake_run_config(monkeypatch):
    fake = types.SimpleNamespace(
        AsyncWebCrawler=object, CrawlerRunConfig=_ModernRunConfig
    )
    monkeypatch.setitem(sys.modules, "crawl4ai", fake)


def test_overlay_removal_off_by_default(monkeypatch):
    _install_fake_run_config(monkeypatch)
    cfg = _crawl4ai_run_config(_settings())
    assert cfg is not None
    # The bug: this used to be hardcoded True and gutted age-gated pages.
    assert cfg.kwargs["remove_overlay_elements"] is False


def test_overlay_removal_opt_in(monkeypatch):
    _install_fake_run_config(monkeypatch)
    cfg = _crawl4ai_run_config(_settings(CRAWL_REMOVE_OVERLAYS="true"))
    assert cfg.kwargs["remove_overlay_elements"] is True


# ---------------------------------------------------------------------------
# Fix 3 — the injected JS answers the age gate ("YES") and sets age cookies
# ---------------------------------------------------------------------------

def test_agegate_js_present_in_load_more_script():
    js = _LOAD_MORE_JS.lower()
    # Answers the age question…
    assert "yes" in js
    assert "21" in js
    # …sets the "already verified" flags…
    assert "age_verified" in js or "ageverified" in js
    assert "localstorage" in js
    assert "document.cookie" in js
    # …and still does the load-more work afterwards.
    assert "load" in js


# ---------------------------------------------------------------------------
# Fix 2 — thin-shell heuristic
# ---------------------------------------------------------------------------

def test_thin_shell_true_for_agegate_only_page():
    # An age-gate shell: a headline, one YES button, no real text, no links.
    html = (
        "<html><body><div class='age-modal'>"
        "<h2>Are you 21?</h2><button>YES</button>"
        "</div></body></html>"
    )
    markdown = "Are you 21? YES"
    assert _looks_like_thin_shell(html, markdown) is True


def test_thin_shell_false_for_real_page_with_links():
    html = (
        "<html><body><nav>"
        + "".join(f"<a href='/p{i}'>Page {i}</a>" for i in range(8))
        + "</nav><main>content</main></body></html>"
    )
    markdown = "short"  # little text, but plenty of links -> real site
    assert _looks_like_thin_shell(html, markdown) is False


def test_thin_shell_false_for_content_rich_page():
    html = "<html><body><p>x</p></body></html>"  # few links…
    markdown = "This vendor grows sun-grown flower. " * 30  # …but lots of text
    assert _looks_like_thin_shell(html, markdown) is False


# ---------------------------------------------------------------------------
# Fix 2 (ladder) — a thin advanced result falls back to the legacy arun
# ---------------------------------------------------------------------------

class _Result:
    def __init__(self, html="", markdown=""):
        self.html = html
        self.markdown = markdown
        self.fit_markdown = markdown


class _FakeCrawler:
    calls: list[dict] = []
    advanced_result: object | None = None
    legacy_result: object = _Result(
        html="<html><body>"
        + "".join(f"<a href='/n{i}'>Nav {i}</a>" for i in range(10))
        + "<main>" + ("real vendor content " * 40) + "</main></body></html>",
        markdown="real vendor content " * 40,
    )

    def __init__(self, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def arun(self, url=None, config=None, **kwargs):
        _FakeCrawler.calls.append({"url": url, "config": config, "kwargs": kwargs})
        if config is not None:
            return _FakeCrawler.advanced_result
        return _FakeCrawler.legacy_result


def _install_fake_crawler(monkeypatch):
    fake = types.SimpleNamespace(
        AsyncWebCrawler=_FakeCrawler, CrawlerRunConfig=_ModernRunConfig
    )
    monkeypatch.setitem(sys.modules, "crawl4ai", fake)
    _FakeCrawler.calls = []
    _FakeCrawler.advanced_result = None


def test_thin_advanced_result_falls_back_to_legacy(monkeypatch):
    _install_fake_crawler(monkeypatch)
    # Advanced run returns a non-empty age-gate shell (the C3 symptom).
    _FakeCrawler.advanced_result = _Result(
        html="<html><body><h2>Are you 21?</h2><button>YES</button></body></html>",
        markdown="Are you 21? YES",
    )
    res = asyncio.run(_fetch_with_crawl4ai(_settings(), "https://topshelfwa.com/"))
    assert res is not None and res.ok
    # It must NOT keep the shell — the legacy fallback content wins.
    assert "real vendor content" in res.markdown
    assert len(_FakeCrawler.calls) == 2  # advanced (thin) + legacy fallback
    assert _FakeCrawler.calls[1]["config"] is None


def test_good_advanced_result_is_kept_no_regression(monkeypatch):
    _install_fake_crawler(monkeypatch)
    rich = "premium concentrates and sun-grown flower " * 40
    _FakeCrawler.advanced_result = _Result(
        html="<html><body>"
        + "".join(f"<a href='/x{i}'>X{i}</a>" for i in range(12))
        + f"<main>{rich}</main></body></html>",
        markdown=rich,
    )
    res = asyncio.run(_fetch_with_crawl4ai(_settings(), "https://good-vendor.com/"))
    assert res is not None and res.ok
    assert "premium concentrates" in res.markdown
    # A healthy advanced result must not trigger the fallback.
    assert len(_FakeCrawler.calls) == 1
    assert _FakeCrawler.calls[0]["config"] is not None


def test_legacy_fallback_never_regresses_a_better_advanced(monkeypatch):
    """If the advanced result is thin but the legacy result is even worse,
    we keep the advanced one (defensive — never make things worse)."""
    _install_fake_crawler(monkeypatch)
    _FakeCrawler.advanced_result = _Result(
        html="<html><body><h2>Are you 21?</h2><button>YES</button>"
        "<p>some hours info here</p></body></html>",
        markdown="Are you 21? YES some hours info here",
    )
    _FakeCrawler.legacy_result = _Result(html="", markdown="")  # legacy worse
    res = asyncio.run(_fetch_with_crawl4ai(_settings(), "https://x.com/"))
    assert res is not None and res.ok
    assert "hours info" in res.markdown  # kept the better (advanced) result
    # restore shared fixture for other tests
    _FakeCrawler.legacy_result = _Result(
        html="<html><body>"
        + "".join(f"<a href='/n{i}'>Nav {i}</a>" for i in range(10))
        + "<main>" + ("real vendor content " * 40) + "</main></body></html>",
        markdown="real vendor content " * 40,
    )


# ---------------------------------------------------------------------------
# Fix 4 — force_fresh bypasses the on-disk page cache
# ---------------------------------------------------------------------------

def test_force_fresh_bypasses_cache(monkeypatch, tmp_path):
    """A cached (stale) page must be IGNORED when force_fresh=True, and the
    fresh fetch used instead. Without force_fresh the cache is honored."""
    import app.fetcher as fetcher

    settings = _settings(CRAWL_CACHE_DIR=str(tmp_path))

    # Seed the cache with a stale age-gate shell for the URL.
    url = "https://topshelfwa.com/"
    stale = fetcher.FetchResult(
        url=url, ok=True, status=200,
        html="<html><body><h2>Are you 21?</h2></body></html>",
        markdown="Are you 21?",
    )
    fetcher._write_cache(settings, stale)

    # A fake fresh fetch that returns the REAL page.
    fresh = fetcher.FetchResult(
        url=url, ok=True, status=200,
        html="<html><body><main>real content</main></body></html>",
        markdown="real content",
    )

    async def _fake_crawl4ai(_settings, _url):
        return fresh

    monkeypatch.setattr(fetcher, "_fetch_with_crawl4ai", _fake_crawl4ai)
    monkeypatch.setattr(fetcher, "_robots_allows", lambda *a, **k: True)

    # Without force_fresh -> the stale cache wins.
    cached = asyncio.run(fetch_page(url, settings=settings))
    assert cached.from_cache is True
    assert "Are you 21?" in cached.markdown

    # With force_fresh -> the cache is skipped, real content returned.
    live = asyncio.run(fetch_page(url, settings=settings, force_fresh=True))
    assert live.from_cache is False
    assert "real content" in live.markdown

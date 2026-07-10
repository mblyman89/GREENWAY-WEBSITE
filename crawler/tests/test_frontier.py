"""Slice C2 — full-site crawl frontier. Pure logic, no network.

Owner's requirement (verbatim): "it never goes through the full site, scraping
each and ever page, the sub pages, etc. … crawl around the whole site clicking
everything, looking at everything and scraping everything."
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.frontier import (  # noqa: E402
    CrawlFrontier,
    PAGINATION_BONUS,
    discover_pagination_links,
    frontier_key,
    is_pagination_url,
    normalize_crawl_url,
)

BASE = "https://example-brand.com/"


# ---------------------------------------------------------------------------
# URL normalization + pagination awareness
# ---------------------------------------------------------------------------

def test_fragment_and_tracking_query_are_stripped():
    assert normalize_crawl_url("https://x.com/a/?utm_source=ig#top") == "https://x.com/a/"


def test_pagination_query_is_preserved():
    assert normalize_crawl_url("https://x.com/shop/?page=3") == "https://x.com/shop/?page=3"
    assert normalize_crawl_url("https://x.com/shop/?paged=2&utm=x") == "https://x.com/shop/?paged=2"


def test_pagination_detection():
    assert is_pagination_url("https://x.com/shop/?page=2")
    assert is_pagination_url("https://x.com/blog/page/4/")
    assert not is_pagination_url("https://x.com/shop/")
    assert not is_pagination_url("https://x.com/?page=abc")  # non-numeric


def test_frontier_key_is_slash_and_www_insensitive():
    assert frontier_key("https://www.x.com/about/") == frontier_key("https://x.com/about")
    assert frontier_key("https://x.com/shop?page=2") != frontier_key("https://x.com/shop")


# ---------------------------------------------------------------------------
# CrawlFrontier: same-site, deduped, best-first, sub-page feedback
# ---------------------------------------------------------------------------

def test_sub_page_links_join_the_crawl():
    """THE core C2 fix: links discovered on a sub-page are crawlable."""
    f = CrawlFrontier(base_url=BASE)
    f.add([f"{BASE}products/"])
    first = f.pop()
    assert first == f"{BASE}products/"
    # pretend we fetched /products/ and found the individual product pages
    f.add([f"{BASE}products/gg4-rosin/", f"{BASE}products/papaya-punch/"])
    got = {f.pop(), f.pop()}
    assert got == {f"{BASE}products/gg4-rosin/", f"{BASE}products/papaya-punch/"}
    assert f.pop() is None


def test_offsite_and_non_http_are_refused():
    f = CrawlFrontier(base_url=BASE)
    accepted = f.add([
        "https://othersite.com/products/",
        "mailto:hi@example-brand.com",
        "ftp://example-brand.com/file",
    ])
    assert accepted == 0
    assert f.stats.dropped_offsite == 3


def test_boring_urls_are_refused_and_counted():
    f = CrawlFrontier(base_url=BASE)
    accepted = f.add([f"{BASE}privacy/", f"{BASE}cart/", f"{BASE}about/"])
    assert accepted == 1
    assert f.stats.dropped_boring == 2
    assert f.pop() == f"{BASE}about/"


def test_urls_are_enqueued_at_most_once_for_the_whole_crawl():
    f = CrawlFrontier(base_url=BASE)
    f.add([f"{BASE}about/"])
    f.add([f"{BASE}about", "https://www.example-brand.com/about/"])  # same page
    assert f.pending() == 1
    assert f.stats.duplicates == 2
    f.pop()
    f.add([f"{BASE}about/"])  # already visited — never re-crawled
    assert f.pending() == 0


def test_entry_page_is_never_re_enqueued():
    f = CrawlFrontier(base_url=f"{BASE}home/")
    f.add([f"{BASE}home/", f"{BASE}home"])
    assert f.pending() == 0


def test_best_first_interesting_pages_beat_generic_ones():
    f = CrawlFrontier(base_url=BASE)
    f.add([f"{BASE}random-slug-thing-here-very-long/", f"{BASE}our-story/"])
    assert f.pop() == f"{BASE}our-story/"


def test_pagination_gets_a_priority_bonus():
    assert PAGINATION_BONUS > 0
    f = CrawlFrontier(base_url=BASE)
    f.add([f"{BASE}some-random-long-page-slug-x/", f"{BASE}shop/?page=2"])
    # shop has an interest keyword AND the pagination bonus — must come first.
    assert f.pop() == f"{BASE}shop/?page=2"


def test_seeder_bonus_is_applied():
    f = CrawlFrontier(base_url=BASE)
    f.add([f"{BASE}alpha-page-one-x/"])            # plain
    f.add([f"{BASE}beta-page-two-xy/"], bonus=1)   # seeder-vetted
    assert f.pop() == f"{BASE}beta-page-two-xy/"


def test_discovery_stats_accounting():
    f = CrawlFrontier(base_url=BASE)
    f.add([f"{BASE}about/", f"{BASE}privacy/", "https://other.com/x"])
    s = f.stats.as_dict()
    assert s["discovered"] == 2      # about + privacy (offsite not counted as discovered)
    assert s["enqueued"] == 1
    assert s["dropped_boring"] == 1
    assert s["dropped_offsite"] == 1


# ---------------------------------------------------------------------------
# Pagination link discovery from HTML
# ---------------------------------------------------------------------------

PAGINATED_HTML = """
<html><head><link rel="next" href="/shop/?page=2"></head><body>
<nav class="pagination">
  <a href="/shop/?page=2">2</a>
  <a href="/shop/?page=3">3</a>
  <a href="/blog/page/2/">Older posts</a>
  <a href="https://othersite.com/shop/?page=2">elsewhere</a>
  <a href="/shop/">All</a>
</nav>
</body></html>
"""


def test_discover_pagination_links_finds_rel_next_and_numbered_pages():
    links = discover_pagination_links(PAGINATED_HTML, f"{BASE}shop/")
    assert f"{BASE}shop/?page=2" in links
    assert f"{BASE}shop/?page=3" in links
    assert f"{BASE}blog/page/2/" in links
    # rel=next is first (author's own "there is more")
    assert links[0] == f"{BASE}shop/?page=2"


def test_discover_pagination_links_stays_on_site_and_dedupes():
    links = discover_pagination_links(PAGINATED_HTML, f"{BASE}shop/")
    assert all(u.startswith("https://example-brand.com/") for u in links)
    assert len(links) == len(set(links))
    assert f"{BASE}shop/" not in links  # non-pagination link excluded


def test_discover_pagination_links_empty_html():
    assert discover_pagination_links("", BASE) == []

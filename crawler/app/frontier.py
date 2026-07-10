"""crawler/app/frontier.py — Slice C2, the full-site crawl FRONTIER.

Owner's requirement (verbatim): "it does a great job with one or two pages,
but it never goes through the full site, scraping each and ever page, the sub
pages, etc. … crawl around the whole site clicking everything, looking at
everything and scraping everything."

Verified root cause: `pipeline.research_target` discovered extra pages ONLY
from the entry page (one nav-link pass + one sitemap pass + one seeder pass,
merged into a single flat queue). Links found on SUB-pages were never
followed, so a homepage → /products/ → 40 product pages site stopped at
/products/. This module is the fix: a proper best-first crawl frontier that
every fetched page feeds back into, until the page budget is spent.

Design (pure, no I/O — the pipeline owns all fetching):
  • Same-origin only (www-insensitive registrable host), http(s) only.
  • Fragments always stripped. Query strings stripped EXCEPT pagination
    queries (?page=N, ?paged=N, ?p=N, ?pg=N) — the old normalizer dropped
    them, which silently cut off every paginated catalog after page 1.
  • Deduped by a trailing-slash-insensitive key; a URL is enqueued at most
    once for the whole crawl (visited or queued).
  • Best-first: `page_interest_score` (existing, keyword-based) plus a
    pagination bonus so catalog page 2..N are walked before boring pages,
    plus the caller's optional per-source bonus (the H2 seeder's BM25-vetted
    URLs keep their +1 nudge).
  • Boring URLs (interest score < 0) are refused, exactly like before.
  • Accounting: the frontier keeps discovery/skip counters so the coverage
    report (Slice C4) can show discovered vs crawled vs dropped — the owner's
    "somehow validate that it has gotten everything".
"""
from __future__ import annotations

import heapq
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from .discovery import page_interest_score

# Pagination markers we preserve and reward. Conservative on purpose: these
# are the near-universal conventions (WordPress/WooCommerce `/page/N/` and
# `?paged=N`, Shopify `?page=N`, generic `?p=N` / `?pg=N`).
_PAGINATION_QUERY_KEYS = ("page", "paged", "p", "pg")
_PAGINATION_PATH_RE = re.compile(r"/page/\d+/?$", re.I)
# Priority nudge for pagination links: page 2..N of a catalog carries the
# products the owner is missing, so it beats generic same-score pages.
PAGINATION_BONUS = 3


def registrable_host(netloc: str) -> str:
    """Host key for same-site checks: lowercase, no port, no leading www."""
    host = netloc.lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    return host


def _pagination_query(query: str) -> str:
    """The pagination portion of a query string ('' when none)."""
    if not query:
        return ""
    kept = [(k, v) for k, v in parse_qsl(query, keep_blank_values=True)
            if k.lower() in _PAGINATION_QUERY_KEYS and v.isdigit()]
    return urlencode(kept)


def is_pagination_url(url: str) -> bool:
    """True when *url* points at page 2..N of a listing."""
    p = urlparse(url)
    if _PAGINATION_PATH_RE.search(p.path or ""):
        return True
    return bool(_pagination_query(p.query))


def normalize_crawl_url(url: str) -> str:
    """Canonical crawl URL: fragment dropped, query dropped UNLESS it is a
    pagination query (which is kept, normalized to just the pagination keys)."""
    p = urlparse(url)
    query = _pagination_query(p.query)
    return urlunparse((p.scheme, p.netloc, p.path, "", query, ""))


def frontier_key(url: str) -> str:
    """Dedupe key: host (www/port-insensitive) + path (trailing-slash-insensitive)
    + kept pagination query."""
    p = urlparse(url)
    query = _pagination_query(p.query)
    key = f"{registrable_host(p.netloc)}{p.path.rstrip('/')}"
    return f"{key}?{query}" if query else key


@dataclass
class FrontierStats:
    """Discovery accounting for the coverage report (C4)."""

    discovered: int = 0        # unique same-site URLs seen (enqueued + refused)
    enqueued: int = 0          # accepted into the queue
    dropped_boring: int = 0    # interest score < 0 (privacy/cart/login/…)
    dropped_offsite: int = 0   # different host / non-http(s)
    duplicates: int = 0        # already visited or already queued

    def as_dict(self) -> dict:
        return {
            "discovered": self.discovered,
            "enqueued": self.enqueued,
            "dropped_boring": self.dropped_boring,
            "dropped_offsite": self.dropped_offsite,
            "duplicates": self.duplicates,
        }


@dataclass
class CrawlFrontier:
    """Best-first, same-site, deduped URL frontier."""

    base_url: str
    _base_host: str = field(init=False)
    _heap: list[tuple[int, int, str]] = field(default_factory=list)  # (-score, seq, url)
    _seen: set[str] = field(default_factory=set)
    _seq: int = 0
    stats: FrontierStats = field(default_factory=FrontierStats)

    def __post_init__(self) -> None:
        self._base_host = registrable_host(urlparse(self.base_url).netloc)
        # The entry page itself is already being read — never re-enqueue it.
        self._seen.add(frontier_key(self.base_url))

    def add(self, urls: list[str], *, bonus: int = 0) -> int:
        """Offer candidate URLs to the frontier. Returns how many were accepted.

        Every rule the old one-shot merge enforced still applies (same-origin,
        http(s), boring filter, dedupe) — the difference is this can be called
        for EVERY fetched page, so sub-page links finally join the crawl.
        """
        accepted = 0
        for raw in urls:
            if not isinstance(raw, str) or not raw.strip():
                continue
            p = urlparse(raw)
            if p.scheme not in ("http", "https") or registrable_host(p.netloc) != self._base_host:
                self.stats.dropped_offsite += 1
                continue
            clean = normalize_crawl_url(raw)
            key = frontier_key(clean)
            if key in self._seen:
                self.stats.duplicates += 1
                continue
            self._seen.add(key)
            self.stats.discovered += 1
            score = page_interest_score(clean)
            if score < 0:
                self.stats.dropped_boring += 1
                continue
            if is_pagination_url(clean):
                score += PAGINATION_BONUS
            score += bonus
            heapq.heappush(self._heap, (-score, self._seq, clean))
            self._seq += 1
            self.stats.enqueued += 1
            accepted += 1
        return accepted

    def pop(self) -> str | None:
        """Highest-scoring URL next (FIFO within equal scores); None when empty."""
        if not self._heap:
            return None
        _, _, url = heapq.heappop(self._heap)
        return url

    def pending(self) -> int:
        return len(self._heap)


# ---------------------------------------------------------------------------
# Pagination discovery: the links that continue a listing
# ---------------------------------------------------------------------------

def discover_pagination_links(html: str, base_url: str, *, limit: int = 10) -> list[str]:
    """Same-site pagination links a page offers: `rel=\"next\"` (link/anchor)
    first, then any anchor whose href matches the pagination conventions."""
    if not html:
        return []
    from urllib.parse import urljoin

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    base_host = registrable_host(urlparse(base_url).netloc)
    out: list[str] = []
    seen: set[str] = set()

    def offer(href: str | None) -> None:
        if not href or len(out) >= limit:
            return
        absolute = urljoin(base_url, href.strip())
        p = urlparse(absolute)
        if p.scheme not in ("http", "https") or registrable_host(p.netloc) != base_host:
            return
        if not is_pagination_url(absolute):
            return
        clean = normalize_crawl_url(absolute)
        key = frontier_key(clean)
        if key in seen:
            return
        seen.add(key)
        out.append(clean)

    # <link rel="next"> and <a rel="next"> are the author's own "there is more".
    for tag in soup.find_all(["link", "a"], rel=True):
        rels = tag.get("rel") or []
        if any(str(r).lower() == "next" for r in rels):
            offer(tag.get("href"))
    for a in soup.find_all("a", href=True):
        offer(a["href"])
    return out

"""URL seeding (Slice H2): two-phase cost control for deep research.

Phase 1 (cheap): ask crawl4ai's ``AsyncUrlSeeder`` for the site's URL
inventory — from the sitemap and/or the Common Crawl index — WITHOUT fetching
any pages, and score every candidate with BM25 against a query tuned for the
seven KB target fields (about/story/mission/products/menu/strains/...).

Phase 2 (expensive): the existing browser crawl in ``pipeline.research_target``
then spends its page budget on the BEST candidates first, merged with the
nav-link and sitemap discovery that already existed.

Design guarantees:
- **Soft-disable, never break** — if crawl4ai < 0.7 is installed
  (``AsyncUrlSeeder`` doesn't exist), seeding is off, or the seeder errors in
  any way, ``seed_site_urls`` returns ``[]`` and the crawl proceeds exactly as
  before (nav + sitemap only).
- **Same-origin only** — ``merge_candidates`` drops anything not on the
  target's registrable host (www-insensitive), strips fragments/queries, and
  drops boring URLs (privacy/cart/login/...), exactly like nav discovery does.
- **Politeness** — the sitemap source makes one tiny GET for the sitemap; the
  Common Crawl source sends **zero** traffic to the site.
"""
from __future__ import annotations

import logging
from urllib.parse import urlparse, urlunparse

from .config import Settings
from .discovery import page_interest_score

log = logging.getLogger("crawler.seeding")

# BM25 query tuned for the seven KB target fields (vendor story/logo, brand
# story/logo, product types, descriptions, images).
SEED_QUERY = "about story mission company brand products menu strains flower"


def _registrable_domain(netloc: str) -> str:
    """Host key for same-site checks: lowercase, no port, no leading www."""
    host = netloc.lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    return host


async def seed_site_urls(url: str, *, settings: Settings) -> list[str]:
    """Return seeder-discovered same-site URLs, best-effort.

    Returns ``[]`` (never raises) when seeding is disabled, crawl4ai is too
    old to have ``AsyncUrlSeeder`` (< 0.7), or anything goes wrong.
    """
    if not settings.crawl_seed_enabled:
        return []
    try:
        from crawl4ai import AsyncUrlSeeder, SeedingConfig  # type: ignore
    except ImportError:
        log.info("URL seeding unavailable (crawl4ai < 0.7) — skipping")
        return []

    domain = _registrable_domain(urlparse(url).netloc)
    if not domain:
        return []

    try:
        config = SeedingConfig(
            source=settings.crawl_seed_source,
            extract_head=False,          # no page fetches — inventory only
            query=SEED_QUERY,
            scoring_method="bm25",
            max_urls=settings.crawl_seed_max_urls,
            concurrency=5,
            hits_per_sec=5,
        )
        async with AsyncUrlSeeder() as seeder:
            rows = await seeder.urls(domain, config)
    except Exception as exc:  # pragma: no cover - defensive; seeder must never break a crawl
        log.warning("URL seeding failed for %s: %s", domain, exc)
        return []

    out: list[str] = []
    for row in rows or []:
        u = (row or {}).get("url") if isinstance(row, dict) else None
        if isinstance(u, str) and u.startswith(("http://", "https://")):
            out.append(u)
        if len(out) >= settings.crawl_seed_max_urls:
            break
    log.info("URL seeding for %s: %d candidates", domain, len(out))
    return out


def merge_candidates(
    base_url: str,
    nav: list[str],
    sitemap: list[str],
    seeded: list[str],
    *,
    budget: int,
) -> list[str]:
    """Merge nav + sitemap + seeded URLs into one ranked crawl queue.

    - same-origin only (www-insensitive), http(s) only
    - fragments and query strings stripped; deduped (trailing-slash-insensitive)
    - the target page itself and boring URLs (interest score < 0) are dropped
    - ranked by ``page_interest_score``; seeder-surfaced URLs get a +1 nudge
      (the seeder's BM25 already vetted them against the KB query)
    - truncated to ``budget`` (best first)
    """
    if budget <= 0:
        return []

    base = urlparse(base_url)
    base_host = _registrable_domain(base.netloc)
    base_key = f"{base_host}{base.path.rstrip('/')}"

    seeded_keys = set()
    for u in seeded:
        p = urlparse(u)
        seeded_keys.add(f"{_registrable_domain(p.netloc)}{p.path.rstrip('/')}")

    seen: set[str] = set()
    scored: list[tuple[int, int, str]] = []  # (-score, order, url)
    order = 0
    for u in list(nav) + list(sitemap) + list(seeded):
        if not isinstance(u, str):
            continue
        p = urlparse(u)
        if p.scheme not in ("http", "https"):
            continue
        if _registrable_domain(p.netloc) != base_host:
            continue
        clean = urlunparse((p.scheme, p.netloc, p.path, "", "", ""))
        key = f"{_registrable_domain(p.netloc)}{p.path.rstrip('/')}"
        if key == base_key or key in seen:
            continue
        seen.add(key)
        score = page_interest_score(clean)
        if score < 0:
            continue
        if key in seeded_keys:
            score += 1
        scored.append((-score, order, clean))
        order += 1

    scored.sort()
    return [u for _, _, u in scored[:budget]]

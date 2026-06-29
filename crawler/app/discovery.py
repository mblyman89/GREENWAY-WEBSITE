"""Page discovery (DF-7): find the *right* pages on a site to research.

Many brands have a bare landing page but a real /about, /our-story, or product
pages reachable via the site's own sitemap.xml or RSS/Atom feed — the
structured maps a site publishes *for machines*. Using them is the highest-yield,
zero-trickery way to find content: we're reading what the site explicitly offers.

All discovery is best-effort and polite (single small GETs, honors proxy/UA).
"""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

import httpx

from .config import Settings
from .http_identity import browser_headers, pick_user_agent

# Keywords that suggest a page is worth researching for vendor/brand copy.
_INTEREST = (
    "about", "our-story", "story", "mission", "who-we-are", "company",
    "brand", "philosophy", "values", "products", "shop", "menu", "strains",
)


def _client(settings: Settings) -> httpx.Client:
    ua = pick_user_agent(realistic=settings.crawl_realistic_headers, fallback=settings.crawl_user_agent)
    kwargs: dict = {
        "timeout": 12.0,
        "follow_redirects": True,
        "headers": browser_headers(ua),
    }
    if settings.proxy_url:
        kwargs["proxy"] = settings.proxy_url
    return httpx.Client(**kwargs)


def _origin(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def discover_sitemap_urls(url: str, settings: Settings, *, limit: int = 50) -> list[str]:
    """Return candidate page URLs from the site's sitemap(s).

    Handles a sitemap index (sitemap of sitemaps) one level deep. Best-effort:
    returns [] on any error.
    """
    origin = _origin(url)
    out: list[str] = []
    try:
        with _client(settings) as c:
            # robots.txt often points at the sitemap; check it first, then the default.
            sitemap_urls: list[str] = []
            try:
                r = c.get(f"{origin}/robots.txt")
                if r.status_code == 200:
                    for line in r.text.splitlines():
                        if line.lower().startswith("sitemap:"):
                            sitemap_urls.append(line.split(":", 1)[1].strip())
            except Exception:
                pass
            if not sitemap_urls:
                sitemap_urls = [f"{origin}/sitemap.xml"]

            seen_maps: set[str] = set()
            for sm in sitemap_urls[:3]:
                if sm in seen_maps:
                    continue
                seen_maps.add(sm)
                try:
                    r = c.get(sm)
                    if r.status_code != 200:
                        continue
                    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", r.text)
                    # If this is a sitemap index, its <loc>s are more sitemaps.
                    child_maps = [l for l in locs if l.lower().endswith(".xml")]
                    if child_maps and "<sitemapindex" in r.text.lower():
                        for child in child_maps[:3]:
                            try:
                                cr = c.get(child)
                                if cr.status_code == 200:
                                    out.extend(re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", cr.text))
                            except Exception:
                                continue
                    else:
                        out.extend(locs)
                except Exception:
                    continue
    except Exception:
        return []

    # Rank: pages whose path hints at interesting content first.
    def score(u: str) -> int:
        low = u.lower()
        return sum(2 if k in low else 0 for k in _INTEREST)

    uniq: list[str] = []
    seen: set[str] = set()
    for u in sorted(out, key=score, reverse=True):
        if u in seen or not u.startswith("http"):
            continue
        seen.add(u)
        uniq.append(u)
    return uniq[:limit]


def discover_feed_urls(html: str, base_url: str) -> list[str]:
    """Find RSS/Atom feed URLs declared in a page's <head>."""
    feeds: list[str] = []
    for m in re.finditer(
        r'<link[^>]+type=["\']application/(?:rss\+xml|atom\+xml)["\'][^>]*>',
        html, re.IGNORECASE,
    ):
        href = re.search(r'href=["\']([^"\']+)["\']', m.group(0))
        if href:
            feeds.append(urljoin(base_url, href.group(1)))
    # De-dup, keep order.
    seen: set[str] = set()
    out: list[str] = []
    for f in feeds:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out

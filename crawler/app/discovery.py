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
from .fetcher import url_is_safe
from .http_identity import browser_headers, pick_user_agent

# Keywords that suggest a page is worth researching for vendor/brand copy.
_INTEREST = (
    "about", "our-story", "story", "mission", "who-we-are", "company",
    "brand", "philosophy", "values", "products", "shop", "menu", "strains",
)

# Paths that are never worth a research fetch (legal/checkout/account noise).
_BORING = (
    "privacy", "terms", "cookie", "cart", "checkout", "account", "login",
    "signup", "sign-up", "careers", "jobs", "wp-json", "feed", "tag/",
    "category/", "author/", "search", "sitemap", ".xml", ".pdf", ".jpg",
    ".jpeg", ".png", ".webp", ".svg", ".gif", "mailto:", "tel:",
)


def page_interest_score(u: str) -> int:
    """How promising a same-site URL looks for vendor/brand/product research."""
    low = u.lower()
    if any(b in low for b in _BORING):
        return -1
    score = sum(2 for k in _INTEREST if k in low)
    # Short, top-level paths (/rosin/, /edibles/) are often product-line pages
    # even without an interest keyword in the slug.
    path = urlparse(u).path.strip("/")
    if path and path.count("/") == 0 and len(path) <= 24:
        score += 1
    return score


def discover_nav_links(html: str, base_url: str, *, limit: int = 20) -> list[str]:
    """Same-site links from a page's own navigation/anchors, ranked by interest.

    This is what a human does: look at the site's menu tabs (Our Story, Rosin,
    Edibles, ...) and click through. We read only same-origin http(s) links the
    page itself offers, drop fragments/query noise, and rank by interest.
    """
    if not html:
        return []
    from bs4 import BeautifulSoup

    origin_host = urlparse(base_url).netloc.lower().removeprefix("www.")
    soup = BeautifulSoup(html, "lxml")
    found: list[str] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = (a["href"] or "").strip()
        if not href or href.startswith("#"):
            continue
        absolute = urljoin(base_url, href)
        p = urlparse(absolute)
        if p.scheme not in ("http", "https"):
            continue
        host = p.netloc.lower().removeprefix("www.")
        if host != origin_host:
            continue  # same site only — we never wander off-domain
        clean = f"{p.scheme}://{p.netloc}{p.path}"
        if clean.rstrip("/") == base_url.rstrip("/"):
            continue
        if clean in seen:
            continue
        seen.add(clean)
        found.append(clean)
    ranked = sorted(found, key=page_interest_score, reverse=True)
    return [u for u in ranked if page_interest_score(u) >= 0][:limit]


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
                # S-5: robots.txt-declared sitemap URLs are attacker-influenced
                # content — run the same SSRF guard as fetch_page.
                if not url_is_safe(sm)[0]:
                    continue
                try:
                    r = c.get(sm)
                    if r.status_code != 200:
                        continue
                    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", r.text)
                    # If this is a sitemap index, its <loc>s are more sitemaps.
                    child_maps = [l for l in locs if l.lower().endswith(".xml")]
                    if child_maps and "<sitemapindex" in r.text.lower():
                        for child in child_maps[:3]:
                            if not url_is_safe(child)[0]:  # S-5 SSRF guard
                                continue
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

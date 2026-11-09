"""D220 S4 — public product FEEDS (the "false COMPLETE" rescue).

D219 found sites that the HTML crawl called COMPLETE while whole catalogs were
missing: products only reachable through JS filters, infinite scroll, or
"load more" buttons. Most cannabis brand sites run on Shopify or WooCommerce,
and both publish the ENTIRE catalog as public JSON:

  Shopify      GET /products.json?limit=250&page=N
  WooCommerce  GET /wp-json/wc/store/v1/products?per_page=100&page=N  (Store API)

Same politeness as every page fetch: SSRF guard, allow-list, robots.txt, and
the per-domain delay — and each request is bounded. Read-only, public data,
no login. A site that is neither simply returns platform="" and no products.
"""
from __future__ import annotations

import asyncio
import html as html_lib
import logging
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

import httpx

from .config import Settings
from .fetcher import (
    _client_kwargs,
    _respect_rate_limit_async,
    _robots_allows,
    domain_allowed,
    url_is_safe,
)

log = logging.getLogger("crawler.feeds")

MAX_FEED_PAGES = 20          # 20 × 250 = 5,000 Shopify products — far past any WA brand
MAX_FEED_PRODUCTS = 3000
_TAG_RE = re.compile(r"<[^>]+>")


@dataclass
class FeedImage:
    url: str
    alt: str = ""


@dataclass
class FeedProduct:
    name: str
    url: str = ""
    description: str = ""
    category: str = ""
    vendor: str = ""
    tags: list[str] = field(default_factory=list)
    variants: list[str] = field(default_factory=list)
    images: list[FeedImage] = field(default_factory=list)

    def text(self) -> str:
        bits = [self.name]
        if self.category:
            bits.append(f"Category: {self.category}")
        if self.variants:
            bits.append("Options: " + ", ".join(self.variants[:12]))
        if self.tags:
            bits.append("Tags: " + ", ".join(self.tags[:15]))
        if self.description:
            bits.append(self.description)
        return "\n".join(bits)


@dataclass
class FeedResult:
    platform: str = ""                 # "shopify" | "woocommerce" | ""
    products: list[FeedProduct] = field(default_factory=list)
    requests: int = 0
    error: str = ""


def strip_html(raw: str) -> str:
    text = _TAG_RE.sub(" ", raw or "")
    return re.sub(r"\s+", " ", html_lib.unescape(text)).strip()


def _origin(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def parse_shopify(data: dict, origin: str) -> list[FeedProduct]:
    out: list[FeedProduct] = []
    for p in (data or {}).get("products") or []:
        if not isinstance(p, dict):
            continue
        name = str(p.get("title") or "").strip()
        if not name:
            continue
        handle = str(p.get("handle") or "").strip()
        tags = p.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        variants = []
        for v in p.get("variants") or []:
            t = str((v or {}).get("title") or "").strip()
            if t and t.lower() != "default title" and t not in variants:
                variants.append(t)
        images = []
        for im in p.get("images") or []:
            src = str((im or {}).get("src") or "").strip()
            if src.startswith("//"):
                src = "https:" + src
            if src.startswith("http"):
                images.append(FeedImage(url=src, alt=str((im or {}).get("alt") or "").strip()))
        out.append(FeedProduct(
            name=name,
            url=urljoin(origin + "/", f"products/{handle}") if handle else "",
            description=strip_html(str(p.get("body_html") or ""))[:4000],
            category=str(p.get("product_type") or "").strip(),
            vendor=str(p.get("vendor") or "").strip(),
            tags=[str(t) for t in tags][:30],
            variants=variants[:30],
            images=images[:20],
        ))
    return out


def parse_woocommerce(data: list, origin: str) -> list[FeedProduct]:
    out: list[FeedProduct] = []
    for p in data or []:
        if not isinstance(p, dict):
            continue
        name = strip_html(str(p.get("name") or ""))
        if not name:
            continue
        cats = [strip_html(str((c or {}).get("name") or "")) for c in p.get("categories") or []]
        tags = [strip_html(str((t or {}).get("name") or "")) for t in p.get("tags") or []]
        variants: list[str] = []
        for a in p.get("attributes") or []:
            for term in (a or {}).get("terms") or []:
                t = strip_html(str((term or {}).get("name") or ""))
                if t and t not in variants:
                    variants.append(t)
        images = []
        for im in p.get("images") or []:
            src = str((im or {}).get("src") or "").strip()
            if src.startswith("http"):
                images.append(FeedImage(url=src, alt=strip_html(str((im or {}).get("alt") or (im or {}).get("name") or ""))))
        desc = strip_html(str(p.get("description") or "")) or strip_html(str(p.get("short_description") or ""))
        out.append(FeedProduct(
            name=name,
            url=str(p.get("permalink") or "").strip(),
            description=desc[:4000],
            category=", ".join(c for c in cats if c),
            tags=[t for t in tags if t][:30],
            variants=variants[:30],
            images=images[:20],
        ))
    return out


async def _get_json(settings: Settings, url: str) -> tuple[int, object | None]:
    """One polite JSON GET. Returns (status, parsed-or-None)."""
    safe, _ = await asyncio.to_thread(url_is_safe, url)
    if not safe or not domain_allowed(settings, url):
        return 0, None
    if not await asyncio.to_thread(_robots_allows, settings, url):
        return 0, None
    await _respect_rate_limit_async(settings, url)

    def _do() -> tuple[int, object | None]:
        try:
            with httpx.Client(**_client_kwargs(settings, timeout=25.0)) as c:
                r = c.get(url, headers={"Accept": "application/json"})
            if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
                return r.status_code, None
            return 200, r.json()
        except Exception as e:  # noqa: BLE001
            log.info("feed GET %s failed: %s", url, e)
            return 0, None

    return await asyncio.to_thread(_do)


async def read_feeds(settings: Settings, entry_url: str, *, should_stop=None) -> FeedResult:
    """Detect the platform and read its whole public catalog feed."""
    origin = _origin(entry_url)
    res = FeedResult()
    seen: set[str] = set()

    def _add(items: list[FeedProduct]) -> int:
        n = 0
        for it in items:
            key = (it.url or it.name).lower()
            if key in seen:
                continue
            seen.add(key)
            res.products.append(it)
            n += 1
        return n

    # Shopify first — by far the most common platform for WA brand sites.
    for page in range(1, MAX_FEED_PAGES + 1):
        if should_stop and should_stop():
            return res
        status, data = await _get_json(settings, f"{origin}/products.json?limit=250&page={page}")
        res.requests += 1
        if not isinstance(data, dict) or "products" not in data:
            break
        res.platform = "shopify"
        added = _add(parse_shopify(data, origin))
        if added == 0 or len(res.products) >= MAX_FEED_PRODUCTS:
            break
    if res.platform:
        return res

    for page in range(1, MAX_FEED_PAGES + 1):
        if should_stop and should_stop():
            return res
        status, data = await _get_json(settings, f"{origin}/wp-json/wc/store/v1/products?per_page=100&page={page}")
        res.requests += 1
        if not isinstance(data, list):
            break
        if page == 1:
            res.platform = "woocommerce"
        added = _add(parse_woocommerce(data, origin))
        if added == 0 or len(data) < 100 or len(res.products) >= MAX_FEED_PRODUCTS:
            break
    if not res.platform:
        # A WordPress site without WooCommerce still answers /wp-json/.
        status, data = await _get_json(settings, f"{origin}/wp-json/")
        res.requests += 1
        if isinstance(data, dict) and ("namespaces" in data or "routes" in data):
            res.platform = "wordpress"
    return res

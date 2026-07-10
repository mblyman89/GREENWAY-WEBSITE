"""Step 1 of the pipeline: fetch a page POLITELY.

Responsibilities:
  • robots.txt — respect Disallow for our UA (configurable; on in production).
  • per-domain rate limiting — never hammer a site.
  • on-disk cache — a fetched page is reused within CRAWL_CACHE_TTL_SECONDS so
    re-running research is cheap and gentle on the source.
  • crawl4ai (real browser) for JS-heavy pages, with fit_markdown pruning; falls
    back to a plain httpx GET when crawl4ai isn't available/needed.

Returns a `FetchResult` with both the cleaned markdown and the raw HTML so later
steps can do CSS-first extraction (HTML) and LLM extraction (markdown).
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import random
import re
import socket
import time
import urllib.robotparser as robotparser
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .config import Settings, get_settings
from .http_identity import browser_headers, pick_user_agent
from .image_urls import best_image_url, is_placeholder_url, parse_srcset

# Per-domain last-fetch timestamps for rate limiting (process-local).
_last_fetch_at: dict[str, float] = {}
# Cache of robots parsers per domain.
_robots_cache: dict[str, robotparser.RobotFileParser] = {}


@dataclass
class FetchResult:
    url: str
    ok: bool
    status: int = 0
    html: str = ""
    markdown: str = ""
    error: str = ""
    from_cache: bool = False
    image_urls: list[str] = field(default_factory=list)


def _domain(url: str) -> str:
    return urlparse(url).netloc.lower()


def domain_allowed(settings: Settings, url: str) -> bool:
    """If an allow-list is configured, only those hosts may be researched.

    In DEVELOPMENT an empty allow-list allows whatever host the operator
    submits (the operator is a trusted staff member typing a URL into the back
    office). In PRODUCTION (CRAWLER_ENV=production) an allow-list is REQUIRED
    (S-5): with none configured, every fetch is refused."""
    allow = settings.allow_domains
    if not allow:
        return not settings.is_production
    host = _domain(url)
    # Strip a :port suffix so "host:8080" still matches the allow-list entry.
    host = host.rsplit(":", 1)[0] if ":" in host and not host.endswith("]") else host
    return any(host == d or host.endswith("." + d) for d in allow)


def url_is_safe(url: str) -> tuple[bool, str]:
    """S-5 SSRF guard: refuse non-http(s) schemes and any host that resolves to
    a private, loopback, link-local, or otherwise non-global address.

    Every address a hostname resolves to must be globally routable — a single
    internal A/AAAA record rejects the URL (DNS-rebinding-style tricks where a
    public name points at 169.254.169.254 or 10.x.x.x are the classic SSRF
    vector against cloud metadata endpoints and internal services).
    Returns (ok, reason)."""
    try:
        parsed = urlparse(url)
    except Exception:
        return False, "unparseable URL"
    if parsed.scheme not in ("http", "https"):
        return False, f"scheme '{parsed.scheme or '(none)'}' not allowed (http/https only)"
    host = parsed.hostname
    if not host:
        return False, "URL has no host"
    # Literal IP? Validate directly (no DNS round-trip).
    try:
        ip = ipaddress.ip_address(host)
        if not ip.is_global:
            return False, f"IP {ip} is not globally routable (private/loopback/link-local)"
        return True, ""
    except ValueError:
        pass  # a hostname — resolve it
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        return False, f"DNS resolution failed: {e}"
    addresses = {info[4][0] for info in infos}
    if not addresses:
        return False, "hostname resolved to no addresses"
    for addr in addresses:
        try:
            ip = ipaddress.ip_address(addr.split("%")[0])  # strip IPv6 zone id
        except ValueError:
            return False, f"unparseable resolved address {addr!r}"
        if not ip.is_global:
            return False, f"{host} resolves to non-global address {ip} (SSRF blocked)"
    return True, ""


def _request_headers(settings: Settings) -> dict[str, str]:
    ua = pick_user_agent(realistic=settings.crawl_realistic_headers, fallback=settings.crawl_user_agent)
    return browser_headers(ua)


def _client_kwargs(settings: Settings, *, timeout: float) -> dict:
    kwargs: dict = {
        "timeout": timeout,
        "follow_redirects": True,
        "headers": _request_headers(settings),
    }
    if settings.proxy_url:
        kwargs["proxy"] = settings.proxy_url
    return kwargs


def _retry_after_seconds(resp: httpx.Response) -> float | None:
    """Parse a Retry-After header (seconds form). Returns None if absent/odd."""
    val = resp.headers.get("retry-after")
    if not val:
        return None
    try:
        return float(val)
    except ValueError:
        return None  # HTTP-date form: fall back to our own backoff


def _backoff_sleep(settings: Settings, attempt: int, retry_after: float | None) -> None:
    """Exponential backoff with jitter; honors Retry-After when the server sets it."""
    if retry_after is not None:
        time.sleep(min(retry_after, settings.crawl_backoff_max_seconds))
        return
    delay = min(
        settings.crawl_backoff_base_seconds * (2 ** attempt),
        settings.crawl_backoff_max_seconds,
    )
    # Full jitter: a random fraction of the computed delay (avoids thundering herd).
    time.sleep(random.uniform(0.0, delay))


def _cache_file(settings: Settings, url: str) -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
    return settings.cache_path / f"page_{digest}.json"


def _read_cache(settings: Settings, url: str) -> FetchResult | None:
    f = _cache_file(settings, url)
    if not f.exists():
        return None
    try:
        age = time.time() - f.stat().st_mtime
        if age > settings.crawl_cache_ttl_seconds:
            return None
        data = json.loads(f.read_text("utf-8"))
        return FetchResult(
            url=url, ok=True, status=data.get("status", 200),
            html=data.get("html", ""), markdown=data.get("markdown", ""),
            from_cache=True, image_urls=data.get("image_urls", []),
        )
    except Exception:
        return None


def _write_cache(settings: Settings, res: FetchResult) -> None:
    if not res.ok:
        return
    try:
        _cache_file(settings, res.url).write_text(
            json.dumps({
                "status": res.status, "html": res.html, "markdown": res.markdown,
                "image_urls": res.image_urls,
            }),
            "utf-8",
        )
    except Exception:
        pass


def _robots_allows(settings: Settings, url: str) -> bool:
    if not settings.crawl_respect_robots:
        return True
    dom = _domain(url)
    rp = _robots_cache.get(dom)
    if rp is None:
        rp = robotparser.RobotFileParser()
        robots_url = f"{urlparse(url).scheme}://{dom}/robots.txt"
        try:
            with httpx.Client(**_client_kwargs(settings, timeout=10.0)) as c:
                r = c.get(robots_url)
                if r.status_code == 200:
                    rp.parse(r.text.splitlines())
                else:
                    rp.parse([])  # no robots => allow
        except Exception:
            rp.parse([])  # unreachable robots => be permissive but still rate-limited
        _robots_cache[dom] = rp
    try:
        return rp.can_fetch(settings.crawl_user_agent, url)
    except Exception:
        return True


def _respect_rate_limit(settings: Settings, url: str) -> None:
    dom = _domain(url)
    last = _last_fetch_at.get(dom, 0.0)
    wait = settings.crawl_min_delay_seconds - (time.time() - last)
    if wait > 0:
        time.sleep(wait)
    _last_fetch_at[dom] = time.time()


# Lazy-load attributes used by the common gallery/lightbox/theme libraries
# (lazysizes, WooCommerce, Shopify, Wix, Squarespace, Elementor, ...). Product
# catalogs — especially long edibles galleries — routinely defer every image
# below the fold behind one of these, so reading only src/data-src misses most
# of the catalog (H10a: the owner saw every rosin but only ONE of many edibles).
_LAZY_IMG_ATTRS = (
    "src", "data-src", "data-lazy-src", "data-original", "data-lazy",
    "data-image", "data-full-url", "data-large_image", "data-zoom-image",
)

_MAX_IMAGES_PER_PAGE = 80  # was 40 — long edible/product catalogs exceed it


def _pick_from_srcset(srcset: str) -> str:
    """Largest real candidate from a srcset/data-srcset string.

    H10b: delegates to the shared, descriptor-aware parser (picks by w/x weight,
    skips placeholders) instead of taking the positionally-last entry.
    """
    return parse_srcset(srcset)


_CSS_BG_RE = re.compile(r"background(?:-image)?\s*:[^;]*url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", re.I)


def _extract_image_urls(html: str, base_url: str) -> list[str]:
    """Pull image candidates from raw HTML (no LLM).

    Reads, in order of signal: og:image metas, <img> (src + srcset + the
    common lazy-load data-* attributes), <picture><source srcset>, and inline
    CSS background-image styles. De-duped, order kept, junk dropped.
    """
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin

    soup = BeautifulSoup(html, "lxml")
    urls: list[str] = []

    for og in soup.find_all("meta", attrs={"property": "og:image"}):
        c = og.get("content")
        if c:
            urls.append(urljoin(base_url, c))

    for img in soup.find_all("img"):
        # H10b: prefer a REAL lazy/srcset image over a placeholder ``src`` so a
        # lazy-loaded catalog no longer harvests the tiny inline placeholder
        # (the black-square bug). best_image_url returns "" when nothing real.
        best = best_image_url(img.get)
        if best:
            urls.append(urljoin(base_url, best))

    # <picture><source srcset="..."> — responsive product galleries put the
    # real image here and leave <img src> as a tiny placeholder.
    for source in soup.find_all("source"):
        srcset = source.get("srcset") or source.get("data-srcset") or ""
        best = parse_srcset(srcset)
        if best:
            urls.append(urljoin(base_url, best))

    # Inline CSS background images (hero/product tiles on builder themes).
    for el in soup.find_all(style=True):
        m = _CSS_BG_RE.search(el.get("style") or "")
        if m and not m.group(1).startswith("data:"):
            urls.append(urljoin(base_url, m.group(1)))

    # De-dup, keep order, drop placeholders/sprites/pixels (H10b broadened set,
    # incl. data: URIs, lazy/loading/loader/default/no-image/dummy/... names).
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if not u or u in seen or is_placeholder_url(u):
            continue
        seen.add(u)
        out.append(u)
    return out[:_MAX_IMAGES_PER_PAGE]


# --- C3: dynamic-content capture -------------------------------------------------
# Best-effort in-page JavaScript that surfaces content a plain page-load misses:
#   1. clicks visible "load more / show more / view all" buttons (a few rounds),
#   2. scrolls to the bottom after each round so infinite-scroll lists append,
#   3. returns to the top so screenshots/layout-sensitive extraction see page start.
# This only interacts with PUBLIC pages the way a human visitor would (scrolling
# and clicking a pagination button) — no form fills, no logins, no purchases.
_LOAD_MORE_JS = """
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const LOAD_MORE = /(load|show|view)\\s*(more|all)|more\\s+(products|items|results)/i;
  for (let round = 0; round < 4; round++) {
    let clicked = false;
    const candidates = document.querySelectorAll(
      'button, a[role="button"], [class*="load-more" i], [class*="loadmore" i], [class*="show-more" i]'
    );
    for (const el of candidates) {
      const label = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
      if (LOAD_MORE.test(label) && el.offsetParent !== null) {
        try { el.click(); clicked = true; } catch (e) {}
      }
    }
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(800);
    if (!clicked) break;
  }
  window.scrollTo(0, 0);
})();
"""


def _crawl4ai_run_config(settings: Settings):
    """Build the most capable ``CrawlerRunConfig`` the INSTALLED crawl4ai supports.

    The repo pins ``crawl4ai>=0.4.0,<0.10.0`` — a wide range — so every advanced
    kwarg is filtered against the actual ``CrawlerRunConfig.__init__`` signature
    (same soft-degrade pattern as ``seeding.py``). Returns ``None`` when
    ``CrawlerRunConfig`` doesn't exist (very old crawl4ai) or construction fails;
    the caller then uses the legacy plain-``arun`` path.
    """
    try:
        from crawl4ai import CrawlerRunConfig  # type: ignore
    except Exception:
        return None
    import inspect

    try:
        accepted = set(inspect.signature(CrawlerRunConfig.__init__).parameters)
    except (TypeError, ValueError):  # pragma: no cover - C-extension oddities
        accepted = set()

    desired: dict = {"word_count_threshold": 10}
    if settings.crawl_dynamic_content:
        desired.update(
            {
                # Scroll the whole page so lazy-loaded sections/images render.
                "scan_full_page": True,
                "scroll_delay": settings.crawl_scroll_delay_seconds,
                # Wait for <img> elements to finish loading before capture.
                "wait_for_images": True,
                # Dismiss cookie walls / newsletter modals that hide content.
                "remove_overlay_elements": True,
                # Let JS-appended content settle before the HTML snapshot.
                "delay_before_return_html": settings.crawl_settle_seconds,
                "page_timeout": int(settings.crawl_page_timeout_seconds * 1000),
                # Best-effort "load more" clicking + infinite-scroll nudging.
                "js_code": _LOAD_MORE_JS,
            }
        )
    # Fresh fetch every time — our own on-disk cache handles reuse politely.
    if "cache_mode" in accepted:
        try:
            from crawl4ai import CacheMode  # type: ignore

            desired["cache_mode"] = CacheMode.BYPASS
        except Exception:
            pass

    filtered = {k: v for k, v in desired.items() if k in accepted}
    try:
        return CrawlerRunConfig(**filtered)
    except Exception:  # pragma: no cover - defensive; config must never break a fetch
        return None


async def _fetch_with_crawl4ai(settings: Settings, url: str) -> FetchResult | None:
    """Use crawl4ai (real browser + fit_markdown). Returns None if unavailable.

    C3 fetch ladder inside the browser:
      1. advanced ``CrawlerRunConfig`` (full-page scan, wait-for-images, overlay
         removal, load-more clicking) when the installed crawl4ai supports it,
      2. legacy plain ``arun`` when the config can't be built or the advanced
         run raises/returns nothing,
    and the caller falls back to httpx when the browser path fails entirely.
    """
    try:
        from crawl4ai import AsyncWebCrawler  # type: ignore
    except Exception:
        return None
    try:
        ua = pick_user_agent(
            realistic=settings.crawl_realistic_headers,
            fallback=settings.crawl_user_agent,
        )
        crawler_kwargs: dict = {"headless": True, "verbose": False}
        # Route the real browser through the optional egress proxy if configured.
        if settings.proxy_url:
            crawler_kwargs["proxy"] = settings.proxy_url
        async with AsyncWebCrawler(**crawler_kwargs) as crawler:
            result = None
            run_config = _crawl4ai_run_config(settings)
            if run_config is not None:
                try:
                    result = await crawler.arun(url=url, config=run_config, user_agent=ua)
                except Exception:
                    result = None  # advanced path unsupported → legacy arun below
            if result is None or not (
                getattr(result, "html", "") or getattr(result, "markdown", "")
            ):
                result = await crawler.arun(
                    url=url,
                    user_agent=ua,
                    # fit_markdown prunes boilerplate to the meaningful content.
                    word_count_threshold=10,
                    bypass_cache=True,
                )
        html = getattr(result, "html", "") or ""
        markdown = (
            getattr(result, "fit_markdown", None)
            or getattr(result, "markdown", None)
            or ""
        )
        if isinstance(markdown, object) and hasattr(markdown, "fit_markdown"):
            markdown = getattr(markdown, "fit_markdown", "") or str(markdown)
        return FetchResult(
            url=url, ok=bool(html or markdown), status=200,
            html=html, markdown=str(markdown),
            image_urls=_extract_image_urls(html, url) if html else [],
        )
    except Exception as e:  # pragma: no cover - browser env dependent
        return FetchResult(url=url, ok=False, error=f"crawl4ai: {e}")


_RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}


def _fetch_with_httpx(settings: Settings, url: str) -> FetchResult:
    """Plain HTTP fallback (no browser). Good for static/server-rendered pages.

    Retries transient failures (429/5xx/network blips) with exponential backoff
    + jitter, honoring a server's Retry-After header. This is polite resilience
    (riding out a hiccup), not evasion."""
    last_err = ""
    last_status = 0
    for attempt in range(settings.crawl_max_retries + 1):
        try:
            with httpx.Client(**_client_kwargs(settings, timeout=20.0)) as c:
                r = c.get(url)
            last_status = r.status_code
            if r.status_code in _RETRYABLE_STATUS and attempt < settings.crawl_max_retries:
                _backoff_sleep(settings, attempt, _retry_after_seconds(r))
                last_err = f"HTTP {r.status_code} (retrying)"
                continue
            html = r.text if "text/html" in r.headers.get("content-type", "") else ""
            return FetchResult(
                url=url, ok=r.status_code == 200 and bool(html), status=r.status_code,
                html=html, markdown=_html_to_text(html),
                image_urls=_extract_image_urls(html, url) if html else [],
                error="" if r.status_code == 200 else f"HTTP {r.status_code}",
            )
        except Exception as e:
            last_err = f"httpx: {e}"
            if attempt < settings.crawl_max_retries:
                _backoff_sleep(settings, attempt, None)
                continue
    return FetchResult(url=url, ok=False, status=last_status, error=last_err or "fetch failed")


def _html_to_text(html: str) -> str:
    if not html:
        return ""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header"]):
        tag.decompose()
    text = soup.get_text("\n")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return "\n".join(lines)


async def fetch_page(url: str, *, prefer_browser: bool = True, settings: Settings | None = None) -> FetchResult:
    """Politely fetch a single page. Honors robots + rate limit + cache."""
    settings = settings or get_settings()

    # S-5: SSRF guard first (scheme + private/loopback/link-local addresses)…
    safe, reason = url_is_safe(url)
    if not safe:
        return FetchResult(url=url, ok=False, error=f"unsafe URL: {reason}")

    # …then the domain allow-list (REQUIRED in production).
    if not domain_allowed(settings, url):
        if settings.is_production and not settings.allow_domains:
            return FetchResult(url=url, ok=False,
                               error="CRAWL_ALLOW_DOMAINS is required in production (S-5)")
        return FetchResult(url=url, ok=False, error="domain not in allow-list")

    cached = _read_cache(settings, url)
    if cached:
        return cached

    if not _robots_allows(settings, url):
        return FetchResult(url=url, ok=False, error="blocked by robots.txt")

    _respect_rate_limit(settings, url)

    res: FetchResult | None = None
    if prefer_browser:
        res = await _fetch_with_crawl4ai(settings, url)
    if res is None or not res.ok:
        # crawl4ai missing or failed → plain HTTP fallback.
        res = _fetch_with_httpx(settings, url)

    _write_cache(settings, res)
    return res

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
import json
import random
import time
import urllib.robotparser as robotparser
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .config import Settings, get_settings
from .http_identity import browser_headers, pick_user_agent

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

    Empty allow-list = allow whatever host the operator submits (the operator
    is a trusted staff member typing a URL into the back office)."""
    allow = settings.allow_domains
    if not allow:
        return True
    host = _domain(url)
    return any(host == d or host.endswith("." + d) for d in allow)


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


def _extract_image_urls(html: str, base_url: str) -> list[str]:
    """Pull <img>/og:image candidates from raw HTML (no LLM)."""
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin

    soup = BeautifulSoup(html, "lxml")
    urls: list[str] = []
    for og in soup.find_all("meta", attrs={"property": "og:image"}):
        c = og.get("content")
        if c:
            urls.append(urljoin(base_url, c))
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src")
        if src:
            urls.append(urljoin(base_url, src))
    # De-dup, keep order, drop obvious sprites/pixels.
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u in seen:
            continue
        if any(bad in u.lower() for bad in ("sprite", "1x1", "pixel", "tracking")):
            continue
        seen.add(u)
        out.append(u)
    return out[:40]


async def _fetch_with_crawl4ai(settings: Settings, url: str) -> FetchResult | None:
    """Use crawl4ai (real browser + fit_markdown). Returns None if unavailable."""
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

    if not domain_allowed(settings, url):
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

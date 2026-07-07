"""Slice H9e — vendor-website DISCOVERY scraper.

The owner's request (paraphrased from the standing scope): a keyword-targeted
search that FINDS a vendor's OWN website + contact info, then feeds the
discovered URLs into the batch crawler — but ONLY after the owner reviews them.

This module is the "find the vendor's own site" half. It is deliberately split
into a big PURE core (queries, host classification, ranking, contact scraping)
that is fully unit-tested, plus one thin I/O function (`discover_vendor_sites`)
that fetches a keyless search-results page through the SAME safe HTTP path the
rest of the crawler uses (SSRF guard + realistic-but-honest headers + polite
timeout).

HARD RULES honored here:
  • NO third-party marketplace. Jane, Leafly, Weedmaps, Dutchie, IHeartJane,
    Leafbuyer, allbud, etc. are EXPLICITLY EXCLUDED from candidates — the owner
    was emphatic that harvesting is from vendors' OWN first-party sites only.
  • NO paid API. We use DuckDuckGo's keyless HTML endpoint (html.duckduckgo.com),
    which returns plain <a> result links; no API key, no account, no ToS-gated
    developer program.
  • DRAFTS ONLY. This returns candidates for the owner to review; it does NOT
    auto-crawl anything. The batch crawler is a separate, human-initiated step.
  • Honest identity. We fetch results like a normal browser would; we do not
    solve CAPTCHAs, log in, or evade blocks. If the search page is unavailable
    we return [] rather than getting clever.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qs, quote_plus, urljoin, urlparse

log = logging.getLogger("crawler.discovery_search")


@dataclass(frozen=True)
class SiteCandidate:
    url: str            # normalized homepage URL (scheme + host, no path noise)
    host: str           # registrable-ish host (lowercased, no leading www.)
    title: str = ""     # search-result title, if any
    snippet: str = ""   # search-result snippet, if any
    score: int = 0      # ranking: higher = more likely the vendor's own site


@dataclass
class VendorContact:
    emails: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# EXCLUSIONS — third-party marketplaces, menus, aggregators, socials, and the
# usual non-vendor noise. A candidate on any of these hosts is dropped: these
# are never a vendor's OWN first-party website.
# ---------------------------------------------------------------------------
_MARKETPLACE_HOSTS: frozenset[str] = frozenset({
    # menu / ordering marketplaces (the ones the owner ruled out)
    "iheartjane.com", "jane.com", "leafly.com", "weedmaps.com", "dutchie.com",
    "leafbuyer.com", "allbud.com", "leaflink.com", "getsava.com", "meadow.com",
    "tymber.io", "dispenseapp.com", "sweed.com", "greenrush.com", "eaze.com",
    "nugg.com", "wikileaf.com", "cannabis.net", "budtrader.com",
})
_SOCIAL_HOSTS: frozenset[str] = frozenset({
    "instagram.com", "facebook.com", "fb.com", "twitter.com", "x.com",
    "tiktok.com", "youtube.com", "youtu.be", "linkedin.com", "pinterest.com",
    "threads.net", "linktr.ee", "snapchat.com", "reddit.com", "yelp.com",
})
_AGGREGATOR_HOSTS: frozenset[str] = frozenset({
    "google.com", "bing.com", "duckduckgo.com", "wikipedia.org", "amazon.com",
    "maps.google.com", "goo.gl", "mapquest.com", "yellowpages.com",
    "bbb.org", "crunchbase.com", "indeed.com", "glassdoor.com", "apple.com",
    "wa.gov", "lcb.wa.gov",  # regulator, not a vendor site
})

# Directory / doc file extensions that are never a homepage.
_BAD_SUFFIXES = (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
                 ".zip", ".doc", ".docx", ".xls", ".xlsx", ".csv")

# Positive signals that a host is a vendor's own site.
_VENDOR_HINTS = ("farm", "cannabis", "weed", "bud", "grow", "gardens",
                 "extracts", "extract", "rosin", "flower", "co", "botanical",
                 "genetics", "cultivation", "organics", "greenhouse")

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# US phone: optional +1, area code, 7 digits with common separators.
_PHONE_RE = re.compile(
    r"(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}"
)


def _norm_host(netloc: str) -> str:
    host = (netloc or "").lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    return host


def _registrable(host: str) -> str:
    """Best-effort registrable domain: last two labels (good enough to match an
    exclusion set of plain .com hosts). Multi-part TLDs (.co.uk) aren't in our
    exclusion sets, so the simple heuristic is safe here."""
    parts = host.split(".")
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return host


def is_excluded_host(host: str) -> bool:
    """True for marketplaces, socials, aggregators, and regulators — anything
    that is NOT a vendor's own first-party website."""
    host = _norm_host(host)
    reg = _registrable(host)
    all_excluded = _MARKETPLACE_HOSTS | _SOCIAL_HOSTS | _AGGREGATOR_HOSTS
    return host in all_excluded or reg in all_excluded


def build_search_queries(name: str, *, location: str = "") -> list[str]:
    """Keyword-targeted queries to find a vendor's OWN website.

    We bias toward the official site by pairing the vendor's name with
    'official website' and cannabis/location context, and by excluding the big
    marketplaces right in the query (DuckDuckGo honors -site:). De-duped, order
    preserved. Empty name -> no queries."""
    name = (name or "").strip()
    if not name:
        return []
    loc = (location or "").strip()
    exclusions = " ".join(f"-site:{h}" for h in (
        "iheartjane.com", "leafly.com", "weedmaps.com", "dutchie.com",
        "instagram.com", "facebook.com",
    ))
    base = [
        f'"{name}" official website {exclusions}',
        f'"{name}" cannabis {("dispensary " + loc) if loc else "washington"} {exclusions}',
        f'{name} {loc} website contact'.strip(),
    ]
    seen: set[str] = set()
    out: list[str] = []
    for q in base:
        q = re.sub(r"\s+", " ", q).strip()
        if q and q not in seen:
            seen.add(q)
            out.append(q)
    return out


def ddg_html_url(query: str) -> str:
    """The keyless DuckDuckGo HTML results endpoint for a query."""
    return f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"


def _unwrap_ddg_href(href: str) -> str:
    """DDG HTML wraps result links as /l/?uddg=<encoded-real-url>. Unwrap to the
    real destination; pass through anything already absolute."""
    if not href:
        return ""
    if href.startswith("//"):
        href = "https:" + href
    p = urlparse(href)
    if p.path.startswith("/l/") or "uddg" in (p.query or ""):
        qs = parse_qs(p.query)
        target = (qs.get("uddg") or [""])[0]
        if target:
            return target
    return href


def _homepage(url: str) -> tuple[str, str] | None:
    """Normalize a result URL to its homepage (scheme://host). Returns
    (homepage_url, host) or None if the URL is unusable/unsafe-looking."""
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        return None
    host = _norm_host(p.netloc)
    if not host or "." not in host:
        return None
    low = (p.path or "").lower()
    if low.endswith(_BAD_SUFFIXES):
        return None
    return f"https://{host}", host


def _score_candidate(host: str, title: str, snippet: str, name: str) -> int:
    """Rank how likely a host is the vendor's OWN site."""
    score = 0
    hay = f"{title} {snippet}".lower()
    name_low = (name or "").lower()
    # Name tokens appearing in the host itself is the strongest signal.
    tokens = [t for t in re.split(r"[^a-z0-9]+", name_low) if len(t) >= 3]
    host_flat = host.replace(".", "")
    for t in tokens:
        if t in host_flat:
            score += 3
        if t in hay:
            score += 1
    if any(h in host for h in _VENDOR_HINTS):
        score += 1
    if "official" in hay or "home" in hay:
        score += 1
    # Prefer .com / .co over noisy TLDs.
    if host.endswith((".com", ".co")):
        score += 1
    return score


def parse_search_results(
    html: str, name: str, *, limit: int = 10
) -> list[SiteCandidate]:
    """PURE: parse a DDG HTML results page into ranked vendor-site candidates.

    Drops excluded hosts (marketplaces/socials/aggregators), unwraps DDG's link
    redirector, collapses to one candidate per host (best-scoring kept), and
    ranks by likelihood of being the vendor's own site."""
    if not html:
        return []
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    best: dict[str, SiteCandidate] = {}
    for res in soup.select(".result, .web-result, .result__body") or []:
        a = res.select_one("a.result__a") or res.find("a", href=True)
        if not a or not a.get("href"):
            continue
        real = _unwrap_ddg_href(a["href"].strip())
        hp = _homepage(real)
        if not hp:
            continue
        home, host = hp
        if is_excluded_host(host):
            continue
        title = a.get_text(" ", strip=True)
        snip_el = res.select_one(".result__snippet")
        snippet = snip_el.get_text(" ", strip=True) if snip_el else ""
        score = _score_candidate(host, title, snippet, name)
        cand = SiteCandidate(url=home, host=host, title=title,
                             snippet=snippet, score=score)
        prev = best.get(host)
        if prev is None or cand.score > prev.score:
            best[host] = cand

    # Fallback: some DDG layouts use bare <a class="result__a"> without a
    # wrapping .result container. Only used if the structured parse found none.
    if not best:
        for a in soup.select("a.result__a") or []:
            real = _unwrap_ddg_href((a.get("href") or "").strip())
            hp = _homepage(real)
            if not hp:
                continue
            home, host = hp
            if is_excluded_host(host):
                continue
            title = a.get_text(" ", strip=True)
            score = _score_candidate(host, title, "", name)
            if host not in best:
                best[host] = SiteCandidate(url=home, host=host, title=title,
                                          score=score)

    ranked = sorted(best.values(), key=lambda c: (-c.score, c.host))
    return ranked[:limit]


def extract_contact(html: str) -> VendorContact:
    """PURE: pull email + US phone candidates out of a page's HTML/text.

    Reads mailto:/tel: anchors first (highest-signal), then a regex sweep over
    the visible text. De-duped, order-preserved, capped."""
    contact = VendorContact()
    if not html:
        return contact
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    seen_email: set[str] = set()
    seen_phone: set[str] = set()

    def _add_email(e: str) -> None:
        e = e.strip().lower().rstrip(".,;")
        if e and e not in seen_email and _EMAIL_RE.fullmatch(e):
            seen_email.add(e)
            contact.emails.append(e)

    def _add_phone(p: str) -> None:
        digits = re.sub(r"\D", "", p)
        # Normalize to last 10 digits; require a plausible US number.
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) != 10:
            return
        canon = f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        if canon not in seen_phone:
            seen_phone.add(canon)
            contact.phones.append(canon)

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        low = href.lower()
        if low.startswith("mailto:"):
            _add_email(href[7:].split("?")[0])
        elif low.startswith("tel:"):
            _add_phone(href[4:])

    text = soup.get_text(" ", strip=True)
    for m in _EMAIL_RE.findall(text):
        _add_email(m)
    for m in _PHONE_RE.findall(text):
        _add_phone(m)

    contact.emails = contact.emails[:5]
    contact.phones = contact.phones[:5]
    return contact


def format_discovery_draft(
    name: str, candidates: list[SiteCandidate], contact: VendorContact
) -> str:
    """Human-readable research_discovery reference-draft body for staff review.

    This is what the owner sees BEFORE deciding to feed any URL into the batch
    crawler. Nothing here is auto-actioned."""
    lines: list[str] = [f"Discovered candidate sites for: {name or '(unknown)'}"]
    if candidates:
        lines.append("")
        lines.append("Candidate websites (review before crawling):")
        for i, c in enumerate(candidates, 1):
            title = f" — {c.title}" if c.title else ""
            lines.append(f"  {i}. {c.url}  (score {c.score}){title}")
    else:
        lines.append("")
        lines.append("No first-party candidate websites found.")
    if contact.emails or contact.phones:
        lines.append("")
        lines.append("Contact info found on the top candidate:")
        for e in contact.emails:
            lines.append(f"  email: {e}")
        for p in contact.phones:
            lines.append(f"  phone: {p}")
    return "\n".join(lines)


@dataclass
class DiscoveryResult:
    name: str
    queries: list[str]
    candidates: list[SiteCandidate]
    contact: VendorContact
    fetched_ok: bool
    error: str = ""


async def discover_vendor_sites(
    name: str,
    *,
    location: str = "",
    settings,
    fetch_contact: bool = True,
    limit: int = 10,
) -> DiscoveryResult:
    """I/O: run keyword search -> ranked first-party candidates (+ contact info
    from the top candidate). Best-effort; returns fetched_ok=False on any error
    rather than raising. Honors the SSRF guard on every URL it touches.

    The search page (html.duckduckgo.com) and each candidate are fetched
    through the crawler's polite HTTP path. This does NOT crawl the vendor site
    beyond the single homepage contact sweep, and it does NOT write anything —
    the caller decides whether to persist a review draft."""
    import httpx

    from .fetcher import url_is_safe
    from .http_identity import browser_headers, pick_user_agent

    queries = build_search_queries(name, location=location)
    if not queries:
        return DiscoveryResult(name=name, queries=[], candidates=[],
                               contact=VendorContact(), fetched_ok=False,
                               error="empty vendor name")

    ua = pick_user_agent(realistic=settings.crawl_realistic_headers,
                         fallback=settings.crawl_user_agent)
    headers = browser_headers(ua) if settings.crawl_realistic_headers else {"User-Agent": ua}
    client_kwargs: dict = {
        "timeout": 20.0,
        "follow_redirects": True,
        "headers": headers,
    }
    if settings.crawl_proxy_url:
        client_kwargs["proxy"] = settings.crawl_proxy_url

    merged: dict[str, SiteCandidate] = {}
    fetched_ok = False
    error = ""
    try:
        async with httpx.AsyncClient(**client_kwargs) as client:
            for q in queries:
                search_url = ddg_html_url(q)
                safe, reason = url_is_safe(search_url)
                if not safe:
                    error = f"search url unsafe: {reason}"
                    continue
                try:
                    resp = await client.get(search_url)
                except Exception as exc:  # network hiccup on one query — try next
                    error = f"search fetch failed: {exc}"
                    continue
                if resp.status_code != 200:
                    error = f"search returned HTTP {resp.status_code}"
                    continue
                fetched_ok = True
                for c in parse_search_results(resp.text, name, limit=limit):
                    prev = merged.get(c.host)
                    if prev is None or c.score > prev.score:
                        merged[c.host] = c
    except Exception as exc:  # pragma: no cover - defensive
        return DiscoveryResult(name=name, queries=queries, candidates=[],
                               contact=VendorContact(), fetched_ok=False,
                               error=f"discovery failed: {exc}")

    candidates = sorted(merged.values(), key=lambda c: (-c.score, c.host))[:limit]

    contact = VendorContact()
    if fetch_contact and candidates:
        top = candidates[0].url
        safe, _reason = url_is_safe(top)
        if safe:
            try:
                async with httpx.AsyncClient(**client_kwargs) as client:
                    resp = await client.get(top)
                if resp.status_code == 200:
                    contact = extract_contact(resp.text)
            except Exception as exc:  # pragma: no cover - contact is best-effort
                log.info("contact fetch failed for %s: %s", top, exc)

    return DiscoveryResult(name=name, queries=queries, candidates=candidates,
                          contact=contact, fetched_ok=fetched_ok, error=error)

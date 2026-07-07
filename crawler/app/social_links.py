"""Slice H9d — social-link following.

The owner's request: "all my vendors have social media that they link to directly
from their website. … make sure the crawler scrapes their website, then click the
social media buttons to scrape their social pages next."

This module does the "click the social media buttons" part, HONESTLY and without
any paid API or logged-in scraping:

  1. detect_social_links(html) — find the social-profile links a vendor puts on
     their OWN page (the header/footer "follow us" icons): Instagram, Facebook,
     X/Twitter, TikTok, YouTube, LinkedIn, Pinterest, Threads, Linktree, etc.
     Pure + unit-testable. Normalizes to the canonical profile URL and dedupes.

  2. The pipeline then politely fetches each detected profile URL through the
     SAME safe fetch path as any web page (robots.txt + SSRF guard + domain
     allow-list + per-domain rate limit) — a LOGGED-OUT public fetch, exactly
     like a person opening the link in a fresh browser. Whatever public text the
     page yields (og:description / bio) becomes a verified, compliance-gated
     draft candidate; the link list itself is shipped as a research_social
     reference draft so staff can see every channel the vendor advertises.

No login, no fake account, no session cookies, no third-party marketplace. When
META_GRAPH_TOKEN is configured the richer sanctioned IG Business Discovery path
(social.py) is still available and preferred for Instagram; this module is the
no-API fallback the owner asked for.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse


@dataclass(frozen=True)
class SocialLink:
    platform: str  # instagram | facebook | twitter | tiktok | youtube | linkedin | pinterest | threads | linktree
    url: str       # canonical profile URL
    handle: str = ""  # best-effort handle/slug when derivable


# host substring -> platform id. Order matters only for display; matching is by
# host membership. www./m./mobile. prefixes are stripped before matching.
_PLATFORM_HOSTS: dict[str, str] = {
    "instagram.com": "instagram",
    "facebook.com": "facebook",
    "fb.com": "facebook",
    "twitter.com": "twitter",
    "x.com": "twitter",
    "tiktok.com": "tiktok",
    "youtube.com": "youtube",
    "youtu.be": "youtube",
    "linkedin.com": "linkedin",
    "pinterest.com": "pinterest",
    "threads.net": "threads",
    "linktr.ee": "linktree",
    "snapchat.com": "snapchat",
}

# Paths on a social host that are NOT a profile (share/login/generic surfaces).
_NON_PROFILE_SEGMENTS = {
    "", "sharer", "share", "sharer.php", "login", "signup", "home",
    "explore", "search", "hashtag", "watch", "results", "feed", "help",
    "about", "policies", "privacy", "tos", "intent", "dialog",
}


def _norm_host(host: str) -> str:
    host = (host or "").lower()
    for pre in ("www.", "m.", "mobile.", "l."):
        if host.startswith(pre):
            host = host[len(pre):]
    return host


def _platform_for_host(host: str) -> str | None:
    host = _norm_host(host)
    for suffix, platform in _PLATFORM_HOSTS.items():
        if host == suffix or host.endswith("." + suffix):
            return platform
    return None


def _first_segment(path: str) -> str:
    segs = [s for s in (path or "").split("/") if s]
    return segs[0] if segs else ""


def _canonicalize(platform: str, parsed) -> tuple[str, str] | None:
    """Return (canonical_url, handle) for a social profile link, or None if the
    URL is a non-profile surface (a share dialog, login page, bare host, ...)."""
    path = parsed.path or "/"
    seg = _first_segment(path)
    low_seg = seg.lower().split("?")[0]

    # youtu.be/<id> is a video, not a channel — skip.
    if platform == "youtube":
        # keep /@handle, /c/<name>, /channel/<id>, /user/<name>; drop /watch etc.
        if _norm_host(parsed.netloc) == "youtu.be":
            return None
        if low_seg in _NON_PROFILE_SEGMENTS:
            return None
        handle = seg.lstrip("@")
        return f"https://www.youtube.com{path.rstrip('/')}", handle

    if platform == "linktree":
        if not seg:
            return None
        return f"https://linktr.ee/{seg}", seg

    if platform in ("instagram", "twitter", "tiktok", "threads", "pinterest",
                    "facebook", "snapchat"):
        if not seg or low_seg in _NON_PROFILE_SEGMENTS:
            return None
        # TikTok handles are /@name.
        handle = seg.lstrip("@")
        host = {
            "instagram": "instagram.com",
            "twitter": "x.com",
            "tiktok": "www.tiktok.com",
            "threads": "www.threads.net",
            "pinterest": "www.pinterest.com",
            "facebook": "www.facebook.com",
            "snapchat": "www.snapchat.com",
        }[platform]
        # Preserve the leading @ for tiktok/threads canonical form.
        keep = seg if seg.startswith("@") else handle
        return f"https://{host}/{keep}", handle

    if platform == "linkedin":
        # company/<name> or in/<name> are profiles; bare host is not.
        if low_seg in _NON_PROFILE_SEGMENTS or not seg:
            return None
        return f"https://www.linkedin.com{path.rstrip('/')}", _first_segment(path[len(seg) + 1:]) or seg

    return None


def detect_social_links(html: str, base_url: str, *, limit: int = 20) -> list[SocialLink]:
    """Find the social-profile links a page advertises. Pure; reads the anchors
    the page itself offers, resolves them absolute, keeps only real profile URLs
    on known platforms, dedupes by canonical URL (keeps first seen)."""
    if not html:
        return []
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    out: list[SocialLink] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = (a["href"] or "").strip()
        if not href or href.startswith("#") or href.lower().startswith(("mailto:", "tel:", "javascript:")):
            continue
        absolute = urljoin(base_url, href)
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue
        platform = _platform_for_host(parsed.netloc)
        if not platform:
            continue
        canon = _canonicalize(platform, parsed)
        if not canon:
            continue
        url, handle = canon
        if url in seen:
            continue
        seen.add(url)
        out.append(SocialLink(platform=platform, url=url, handle=handle))
        if len(out) >= limit:
            break
    return out


def format_social_links(links: list[SocialLink]) -> str:
    """Human-readable research_social reference draft body."""
    lines: list[str] = []
    for link in links:
        label = link.platform.capitalize()
        who = f" @{link.handle}" if link.handle else ""
        lines.append(f"[{label}]{who} — {link.url}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Instagram handle helper — lets the pipeline prefer the sanctioned IG Business
# Discovery API (social.py) for any instagram.com link we detected, falling back
# to the logged-out public fetch when no Meta token is configured.
# ---------------------------------------------------------------------------

def instagram_handle(links: list[SocialLink]) -> str:
    for link in links:
        if link.platform == "instagram" and link.handle:
            return link.handle
    return ""

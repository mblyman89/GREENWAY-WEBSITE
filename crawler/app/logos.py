"""Logo detector (Slice H3): find a vendor/brand logo in the predictable spots.

Most sites put their logo in one of four places — all readable from CSS /
metadata with **zero LLM cost**:

1. JSON-LD ``Organization.logo`` (highest signal — the site *declares* it),
2. an ``<img>`` inside the header/nav with "logo" in class/src/alt,
3. ``<link rel="apple-touch-icon">`` / ``<link rel="icon">`` (biggest first),
4. ``og:image`` on the page (weakest — often a hero shot, still worth showing).

The detector only *finds candidates*; nothing is downloaded here. Candidates
are surfaced as a reference draft (``research_logos``) so a human picks the
right one in the back office — drafts-only, always.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from urllib.parse import urljoin

from bs4 import BeautifulSoup

# Ordered by how likely the spot is to be the actual logo.
_SOURCE_RANK = {"jsonld": 0, "header-img": 1, "apple-touch-icon": 2, "icon": 3, "og:image": 4}

_LOGO_HINT = re.compile(r"logo", re.IGNORECASE)


@dataclass
class LogoCandidate:
    url: str
    source: str  # "jsonld" | "header-img" | "apple-touch-icon" | "icon" | "og:image"
    detail: str = ""  # alt text / sizes attr — context for the reviewer


def _iter_jsonld_nodes(soup: BeautifulSoup):
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = tag.string or tag.text or ""
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        for d in items:
            if not isinstance(d, dict):
                continue
            graph = d.get("@graph")
            if isinstance(graph, list):
                yield from (g for g in graph if isinstance(g, dict))
            yield d


def _icon_pixels(sizes: str) -> int:
    """Best-effort pixel count from a <link sizes="48x48 96x96"> attribute."""
    best = 0
    for m in re.finditer(r"(\d+)\s*[xX]\s*(\d+)", sizes or ""):
        best = max(best, int(m.group(1)) * int(m.group(2)))
    return best


def detect_logo_candidates(html: str, base_url: str, *, limit: int = 8) -> list[LogoCandidate]:
    """Return ranked logo candidates found in the page. Never raises."""
    if not html:
        return []
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        return []

    found: list[LogoCandidate] = []

    # 1) JSON-LD Organization/Brand/LocalBusiness logo.
    for node in _iter_jsonld_nodes(soup):
        typ = node.get("@type", "")
        types = [str(t).lower() for t in (typ if isinstance(typ, list) else [typ])]
        if not any(t in ("organization", "corporation", "localbusiness", "brand") for t in types):
            continue
        logo = node.get("logo")
        if isinstance(logo, dict):
            logo = logo.get("url")
        if isinstance(logo, str) and logo.strip():
            found.append(LogoCandidate(url=urljoin(base_url, logo.strip()), source="jsonld"))

    # 2) Header/nav <img> with "logo" in class/src/alt.
    for container in soup.find_all(["header", "nav"]):
        for img in container.find_all("img"):
            src = img.get("src") or img.get("data-src") or ""
            if not src or src.startswith("data:"):
                continue
            hay = " ".join([
                src,
                " ".join(img.get("class") or []),
                img.get("alt") or "",
                img.get("id") or "",
            ])
            if _LOGO_HINT.search(hay):
                found.append(LogoCandidate(
                    url=urljoin(base_url, src),
                    source="header-img",
                    detail=(img.get("alt") or "").strip(),
                ))

    # Also catch <img class="site-logo"> outside header/nav (common on Squarespace).
    for img in soup.find_all("img", class_=_LOGO_HINT):
        src = img.get("src") or img.get("data-src") or ""
        if src and not src.startswith("data:"):
            found.append(LogoCandidate(
                url=urljoin(base_url, src),
                source="header-img",
                detail=(img.get("alt") or "").strip(),
            ))

    # 3) apple-touch-icon + rel=icon (largest first within each kind).
    icons: list[tuple[int, LogoCandidate]] = []
    for link in soup.find_all("link", rel=True):
        rels = " ".join(link.get("rel") or []).lower()
        href = (link.get("href") or "").strip()
        if not href or href.startswith("data:"):
            continue
        if "apple-touch-icon" in rels:
            src = "apple-touch-icon"
        elif "icon" in rels:
            src = "icon"
        else:
            continue
        sizes = link.get("sizes") or ""
        icons.append((
            _icon_pixels(sizes),
            LogoCandidate(url=urljoin(base_url, href), source=src, detail=sizes.strip()),
        ))
    icons.sort(key=lambda t: -t[0])
    found.extend(c for _, c in icons)

    # 4) og:image — often a hero, but sometimes the only branded art around.
    og = soup.find("meta", attrs={"property": "og:image"})
    if og and og.get("content"):
        found.append(LogoCandidate(url=urljoin(base_url, og["content"].strip()), source="og:image"))

    # Rank by source quality, dedupe by URL, cap.
    found.sort(key=lambda c: _SOURCE_RANK.get(c.source, 9))
    seen: set[str] = set()
    out: list[LogoCandidate] = []
    for c in found:
        if not c.url.startswith(("http://", "https://")):
            continue
        if c.url in seen:
            continue
        seen.add(c.url)
        out.append(c)
        if len(out) >= limit:
            break
    return out

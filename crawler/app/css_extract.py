"""Step 2 of the pipeline: CSS-first, NO-LLM extraction.

We try hard to learn what we need WITHOUT spending a model call:
  • JSON-LD (schema.org Organization / Product / Brand) — the richest source.
  • OpenGraph + standard meta tags (og:description, description, og:image, ...).
  • Common DOM selectors for "about"/"mission" sections.

Whatever this finds is treated as ground truth (it's literally on the page). The
LLM step later fills ONLY what remains empty.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from urllib.parse import urljoin

from bs4 import BeautifulSoup


@dataclass
class CssExtraction:
    about: str = ""
    mission_statement: str = ""
    product_philosophy: str = ""
    description: str = ""
    website: str = ""
    title: str = ""
    image_urls: list[str] = field(default_factory=list)
    # Structured image candidates: (url, alt) pairs so the reviewer sees what
    # each image claims to be. Superset of image_urls' info; both are kept for
    # backward compatibility.
    images: list[tuple[str, str]] = field(default_factory=list)
    # evidence: field_key -> verbatim snippet, for verify-against-source.
    evidence: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Heading-section mining: many brand sites (WordPress/Squarespace/Wix) put the
# real copy under headings like "OUR STORY", "OUR GROW", "OUR HASH", "ABOUT US"
# with no meta/JSON-LD at all. Reading the paragraphs that follow such headings
# is still literally-on-the-page ground truth — no model involved.
# ---------------------------------------------------------------------------

_H_ABOUT = (
    "our story", "about us", "about", "who we are", "the story",
    "our history", "our journey", "our family", "our farm", "our team",
    "meet the", "our roots", "where it", "how it started", "our beginning",
)
_H_MISSION = ("mission", "our mission", "values", "our values", "why we")
_H_PHILOSOPHY = (
    "our grow", "our hash", "our craft", "our process", "philosophy",
    "how we", "our approach", "what we do", "our products", "the process",
    "our rosin", "our flower", "our edibles", "our extracts", "our methods",
    "solventless", "living soil", "small batch", "handcrafted", "craft cannabis",
    "cultivation", "our genetics", "the craft", "quality",
)

# Path fragments that mark a page as "about-like" — on these pages, substantial
# body copy is worth capturing even when it isn't under a recognizable heading
# (many builders render story copy in bare styled divs with decorative headings).
_ABOUT_PATHS = (
    "about", "our-story", "story", "who-we-are", "mission", "our-farm",
    "our-team", "history", "roots",
)

_HEADINGS = ("h1", "h2", "h3", "h4")


def _section_text_after(heading, *, max_chars: int = 1200) -> str:
    """Collect paragraph/list text that follows a heading, stopping at the next
    heading. This is the visible section body a human reads under that title."""
    parts: list[str] = []
    for el in heading.find_all_next():
        if el.name in _HEADINGS:
            break
        if el.name in ("p", "li"):
            txt = el.get_text(" ", strip=True)
            if txt:
                parts.append(txt)
        total = sum(len(p) for p in parts)
        if total >= max_chars:
            break
    text = " ".join(parts).strip()
    return text[:max_chars]


def _extract_heading_sections(soup: BeautifulSoup) -> dict[str, str]:
    """Map about/mission/product_philosophy from heading-titled sections."""
    out: dict[str, str] = {}
    philosophy_parts: list[str] = []
    for h in soup.find_all(_HEADINGS):
        title = h.get_text(" ", strip=True).lower()
        if not title or len(title) > 60:
            continue
        body = ""
        if any(k in title for k in _H_ABOUT):
            body = _section_text_after(h)
            if len(body) > 80 and ("about" not in out or len(body) > len(out["about"])):
                out["about"] = body
        elif any(k in title for k in _H_MISSION):
            body = _section_text_after(h, max_chars=600)
            if len(body) > 40 and "mission_statement" not in out:
                out["mission_statement"] = body
        elif any(k in title for k in _H_PHILOSOPHY):
            body = _section_text_after(h)
            if len(body) > 80:
                philosophy_parts.append(body)
    if philosophy_parts and "product_philosophy" not in out:
        out["product_philosophy"] = " ".join(philosophy_parts)[:1200]
    return out


def _meta(soup: BeautifulSoup, **attrs) -> str:
    tag = soup.find("meta", attrs=attrs)
    if tag and tag.get("content"):
        return tag["content"].strip()
    return ""


def _iter_jsonld(soup: BeautifulSoup):
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = tag.string or tag.text or ""
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        if isinstance(data, list):
            yield from (d for d in data if isinstance(d, dict))
        elif isinstance(data, dict):
            # @graph holds an array of nodes.
            graph = data.get("@graph")
            if isinstance(graph, list):
                yield from (d for d in graph if isinstance(d, dict))
            yield data


def extract_css(html: str, base_url: str) -> CssExtraction:
    out = CssExtraction()
    if not html:
        return out
    soup = BeautifulSoup(html, "lxml")

    # --- Title ----------------------------------------------------------------
    if soup.title and soup.title.string:
        out.title = soup.title.string.strip()

    # --- JSON-LD (best source) ------------------------------------------------
    for node in _iter_jsonld(soup):
        typ = node.get("@type", "")
        types = typ if isinstance(typ, list) else [typ]
        types = [str(t).lower() for t in types]

        desc = (node.get("description") or "").strip()
        if desc and not out.about:
            out.about = desc
            out.evidence["about"] = desc

        if any(t in ("organization", "corporation", "localbusiness", "brand") for t in types):
            url = (node.get("url") or "").strip()
            if url and not out.website:
                out.website = url
            slogan = (node.get("slogan") or "").strip()
            if slogan and not out.mission_statement:
                out.mission_statement = slogan
                out.evidence["mission_statement"] = slogan
            logo = node.get("logo")
            if isinstance(logo, dict):
                logo = logo.get("url")
            if isinstance(logo, str) and logo:
                out.image_urls.append(urljoin(base_url, logo))

        if "product" in types:
            pdesc = (node.get("description") or "").strip()
            if pdesc and not out.description:
                out.description = pdesc
                out.evidence["description"] = pdesc
            img = node.get("image")
            if isinstance(img, str):
                out.image_urls.append(urljoin(base_url, img))
            elif isinstance(img, list):
                out.image_urls.extend(urljoin(base_url, str(u)) for u in img if u)

    # --- OpenGraph / meta -----------------------------------------------------
    og_desc = _meta(soup, property="og:description") or _meta(soup, attrs={"name": "description"})
    if og_desc and not out.about:
        out.about = og_desc
        out.evidence["about"] = og_desc
    if og_desc and not out.description:
        out.description = og_desc
        out.evidence["description"] = og_desc
    og_url = _meta(soup, property="og:url")
    if og_url and not out.website:
        out.website = og_url
    og_image = _meta(soup, property="og:image")
    if og_image:
        out.image_urls.append(urljoin(base_url, og_image))

    # --- Microdata (schema.org itemprop) --------------------------------------
    # Some sites use inline microdata instead of JSON-LD. Cheap to read.
    if not out.description:
        ip = soup.find(attrs={"itemprop": "description"})
        if ip:
            txt = (ip.get("content") or ip.get_text(" ", strip=True) or "").strip()
            if txt:
                out.description = txt
                out.evidence["description"] = txt
    for ip_img in soup.find_all(attrs={"itemprop": "image"}):
        src = ip_img.get("content") or ip_img.get("src")
        if src:
            out.image_urls.append(urljoin(base_url, src))

    # --- Twitter card description (fallback for thin pages) -------------------
    if not out.about:
        tw = _meta(soup, attrs={"name": "twitter:description"})
        if tw:
            out.about = tw
            out.evidence["about"] = tw

    # --- Common about / mission DOM sections ----------------------------------
    for sel in ("#about", ".about", "section.about", "[class*='mission']", "[id*='mission']"):
        node = soup.select_one(sel)
        if node:
            text = node.get_text(" ", strip=True)
            if len(text) > 60:
                if "mission" in sel and not out.mission_statement:
                    out.mission_statement = text[:600]
                    out.evidence["mission_statement"] = text[:600]
                elif not out.about:
                    out.about = text[:800]
                    out.evidence["about"] = text[:800]

    # --- Heading-titled sections ("OUR STORY", "OUR GROW", ...) ---------------
    # The richest visible copy usually lives here. A substantial section body
    # BEATS a one-line meta description: if the section text is meaningfully
    # longer than what meta gave us, prefer it (both are literal page text).
    sections = _extract_heading_sections(soup)
    sec_about = sections.get("about", "")
    if sec_about and len(sec_about) > max(len(out.about), 120):
        out.about = sec_about
        out.evidence["about"] = sec_about
    elif sec_about and not out.about:
        out.about = sec_about
        out.evidence["about"] = sec_about
    if sections.get("mission_statement") and not out.mission_statement:
        out.mission_statement = sections["mission_statement"]
        out.evidence["mission_statement"] = sections["mission_statement"]
    sec_phil = sections.get("product_philosophy", "")
    if sec_phil and (not out.product_philosophy or len(sec_phil) > len(out.product_philosophy)):
        out.product_philosophy = sec_phil
        out.evidence["product_philosophy"] = sec_phil

    # --- About-page full-body capture (aggressive mode) ------------------------
    # On a page whose PATH says it's the about/story page, the whole visible
    # body copy IS the about content — capture every substantial paragraph even
    # when the headings are decorative and matched nothing above. Still literal
    # page text; the pipeline's dedupe/thin-replacement logic picks the best.
    path_low = base_url.lower()
    if any(f"/{frag}" in path_low for frag in _ABOUT_PATHS):
        paras = [
            p.get_text(" ", strip=True)
            for p in soup.find_all("p")
            if len(p.get_text(" ", strip=True)) > 80
        ]
        body = " ".join(paras)[:2000]
        if len(body) > max(len(out.about), 160):
            out.about = body
            out.evidence["about"] = body

    # --- Content images with alt text (skip icons/sprites/data URIs) ----------
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or ""
        # Prefer the largest candidate in srcset when present.
        srcset = img.get("srcset") or img.get("data-srcset") or ""
        if srcset:
            try:
                candidates = [s.strip().split(" ")[0] for s in srcset.split(",") if s.strip()]
                if candidates:
                    src = candidates[-1]
            except Exception:
                pass
        if not src or src.startswith("data:"):
            continue
        low = src.lower()
        if any(bad in low for bad in ("sprite", "1x1", "pixel", "tracking", "blank.", "spacer")):
            continue
        alt = (img.get("alt") or "").strip()
        absolute = urljoin(base_url, src)
        out.image_urls.append(absolute)
        out.images.append((absolute, alt))

    # De-dup images, keep order.
    seen: set[str] = set()
    deduped: list[str] = []
    for u in out.image_urls:
        if u and u not in seen:
            seen.add(u)
            deduped.append(u)
    out.image_urls = deduped
    seen.clear()
    dl: list[tuple[str, str]] = []
    for u, alt in out.images:
        if u and u not in seen:
            seen.add(u)
            dl.append((u, alt))
    out.images = dl
    return out

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
    # evidence: field_key -> verbatim snippet, for verify-against-source.
    evidence: dict[str, str] = field(default_factory=dict)


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

    # De-dup images, keep order.
    seen: set[str] = set()
    deduped: list[str] = []
    for u in out.image_urls:
        if u and u not in seen:
            seen.add(u)
            deduped.append(u)
    out.image_urls = deduped
    return out

"""crawler/app/page_intelligence.py — Slice C1, image ↔ adjacent-text pairing.

Owner's finding (verbatim): "a lot of the product pictures, nearly all of them
really, have their descriptions outside of the image, in plain text on the page
either next to the image or below it. the crawler needs to be smarter. it needs
to grab an image and realize there is text to be scraped right next to the
image that is very relevant."

Reproduced against the real extractors: `css_extract.py` collected images as
bare ``(url, alt)`` pairs, so a vendor catalog whose product name/description
live in the card MARKUP AROUND the image (a heading + paragraph beside it, a
``<figcaption>`` below it, a JSON-LD Product node) harvested as
``(no alt text) — https://…`` and the reviewer had no idea what the image was.

This module walks the DOM the way a human's eye does. For every REAL image
(selected through the shared ``best_image_url`` ladder, so lazy-loaded catalogs
and placeholder shims are handled identically everywhere), it looks for the
best description in priority order:

  1. ``<figcaption>``            — the author literally captioned the image.
  2. JSON-LD Product             — a schema.org Product whose ``image`` matches
                                   this URL gives us name + description (the
                                   richest structured source when present).
  3. Product-card ancestor       — the SMALLEST enclosing element that contains
                                   exactly this one image plus a modest amount
                                   of text (a card <div>/<li>/<article>): its
                                   heading is the product name, its remaining
                                   text is the description "next to the image".
  4. Sibling text                — text element directly after (below) or
                                   before the image when no card exists.
  5. alt / title / aria-label    — the classic fallbacks.

Pure: bs4 + stdlib only, no network, no LLM — fully unit-testable, and the
output is literal page text so verify-against-source semantics are preserved.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from bs4.element import Tag

from .image_urls import best_image_url, is_placeholder_url, parse_srcset

# How far up the tree we search for a product-card ancestor. Cards on the
# common builders (WooCommerce/Shopify/Wix/Squarespace/Elementor grids) are
# 1-4 wrappers away from the <img>.
_MAX_CARD_DEPTH = 5
# A card is a SMALL bounded element: more text than this is a whole section /
# page body, not the text "right next to the image".
_MAX_CARD_TEXT_CHARS = 600
_MIN_CONTEXT_CHARS = 3
# Caps applied to the pieces we keep (the reference draft is one line per image).
_MAX_HEADING_CHARS = 90
_MAX_BODY_CHARS = 240
_MAX_CONTEXT_CHARS = 260

_HEADING_TAGS = ("h1", "h2", "h3", "h4", "h5", "h6")
# Class/id tokens that mark an element as the card's title/name even when the
# theme doesn't use a real heading tag.
_TITLE_TOKEN_RE = re.compile(r"(?:^|[-_ ])(?:title|name|product|heading|caption|label)(?:$|[-_ ])", re.I)
_TEXT_BEARING = ("p", "span", "div", "li", "dd", "td") + _HEADING_TAGS

# Price-looking text alone is not a description (a "$25.00" caption is noise).
_PRICE_ONLY_RE = re.compile(r"^[\s$€£]*[\d.,]+[\s$€£]*$")


@dataclass
class ImageContext:
    """One real image plus the best adjacent text the page offers for it."""

    url: str
    alt: str = ""
    caption: str = ""       # <figcaption> text
    heading: str = ""       # card heading / title element
    nearby_text: str = ""   # card body / sibling text near the image
    jsonld_name: str = ""
    jsonld_description: str = ""
    source: str = ""        # which rule produced best_context (for tests/audit)

    def best_context(self) -> str:
        """The single line of context shown to the reviewer, best source first.

        Kept parser-compatible with the back office's ``parseImageLines``
        (``caption — url``): the caller appends `` — {url}``.
        """
        if self.caption:
            return _clip(self.caption, _MAX_CONTEXT_CHARS)
        if self.jsonld_name or self.jsonld_description:
            joined = ": ".join(p for p in (self.jsonld_name, self.jsonld_description) if p)
            return _clip(joined, _MAX_CONTEXT_CHARS)
        if self.heading or self.nearby_text:
            joined = " · ".join(p for p in (self.heading, self.nearby_text) if p)
            return _clip(joined, _MAX_CONTEXT_CHARS)
        return _clip(self.alt, _MAX_CONTEXT_CHARS)


def _clip(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _clean_text(el: Tag | None, limit: int) -> str:
    if el is None:
        return ""
    return _clip(el.get_text(" ", strip=True), limit)


def _is_meaningful(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < _MIN_CONTEXT_CHARS:
        return False
    return not _PRICE_ONLY_RE.match(t)


# ---------------------------------------------------------------------------
# JSON-LD Product → image URL mapping
# ---------------------------------------------------------------------------

def _iter_jsonld_nodes(soup: BeautifulSoup):
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = tag.string or tag.text or ""
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                yield node
                graph = node.get("@graph")
                if isinstance(graph, list):
                    stack.extend(graph)


def _jsonld_image_urls(node: dict, base_url: str) -> list[str]:
    """All image URLs a JSON-LD node declares (str / list / ImageObject)."""
    out: list[str] = []
    img = node.get("image")
    candidates = img if isinstance(img, list) else [img]
    for c in candidates:
        if isinstance(c, dict):
            c = c.get("url") or c.get("contentUrl")
        if isinstance(c, str) and c.strip():
            out.append(urljoin(base_url, c.strip()))
    return out


def _basename(url: str) -> str:
    path = urlparse(url).path
    return path.rsplit("/", 1)[-1].lower()


def jsonld_product_map(html_or_soup: str | BeautifulSoup, base_url: str) -> dict[str, tuple[str, str]]:
    """Map image URL -> (product name, description) from JSON-LD Product nodes.

    Keys include both the absolute URL and the bare filename so a relative
    ``image`` still matches the absolutized <img> URL and vice versa.
    """
    soup = html_or_soup if isinstance(html_or_soup, BeautifulSoup) else BeautifulSoup(html_or_soup, "lxml")
    out: dict[str, tuple[str, str]] = {}
    for node in _iter_jsonld_nodes(soup):
        typ = node.get("@type", "")
        types = [str(t).lower() for t in (typ if isinstance(typ, list) else [typ])]
        if "product" not in types:
            continue
        name = _clip(str(node.get("name") or ""), _MAX_HEADING_CHARS)
        desc = _clip(str(node.get("description") or ""), _MAX_BODY_CHARS)
        if not (name or desc):
            continue
        for u in _jsonld_image_urls(node, base_url):
            out.setdefault(u, (name, desc))
            fname = _basename(u)
            if fname:
                out.setdefault(fname, (name, desc))
    return out


# ---------------------------------------------------------------------------
# DOM-proximity context for one <img>
# ---------------------------------------------------------------------------

def _figcaption_for(img: Tag) -> str:
    fig = img.find_parent("figure")
    if fig is None:
        return ""
    cap = fig.find("figcaption")
    return _clean_text(cap, _MAX_CONTEXT_CHARS)


def _card_ancestor(img: Tag) -> Tag | None:
    """The smallest enclosing element that reads like ONE product card:
    contains exactly this image and a bounded amount of text."""
    depth = 0
    for ancestor in img.parents:
        if not isinstance(ancestor, Tag) or ancestor.name in ("html", "body"):
            break
        depth += 1
        if depth > _MAX_CARD_DEPTH:
            break
        if ancestor.name == "picture":
            continue  # a <picture> wrapper is part of the image, not the card
        if len(ancestor.find_all("img")) != 1:
            continue
        text = ancestor.get_text(" ", strip=True)
        if _is_meaningful(text) and len(text) <= _MAX_CARD_TEXT_CHARS:
            return ancestor
    return None


def _card_heading(card: Tag) -> str:
    h = card.find(list(_HEADING_TAGS))
    if h is not None:
        t = _clean_text(h, _MAX_HEADING_CHARS)
        if _is_meaningful(t):
            return t
    # Theme "title" element without a heading tag (class/id token match).
    for el in card.find_all(True):
        token_src = " ".join(el.get("class") or []) + " " + (el.get("id") or "")
        if _TITLE_TOKEN_RE.search(token_src):
            t = _clean_text(el, _MAX_HEADING_CHARS)
            if _is_meaningful(t):
                return t
    return ""


def _card_body(card: Tag, heading: str) -> str:
    parts: list[str] = []
    for el in card.find_all(["p", "li", "dd", "span"]):
        t = el.get_text(" ", strip=True)
        if not _is_meaningful(t) or t == heading:
            continue
        parts.append(t)
        if sum(len(p) for p in parts) >= _MAX_BODY_CHARS:
            break
    body = _clip(" ".join(parts), _MAX_BODY_CHARS)
    if not body:
        # Bare text nodes (no <p>) — whole card text minus the heading.
        whole = card.get_text(" ", strip=True)
        if heading and whole.startswith(heading):
            whole = whole[len(heading):]
        body = _clip(whole, _MAX_BODY_CHARS)
        if not _is_meaningful(body):
            body = ""
    return body


def _sibling_text(img: Tag) -> str:
    """Text directly AFTER (below/next to) the image, else directly before —
    for galleries where each image sits in a bare wrapper with a caption
    element beside it rather than a card."""
    anchors: list[Tag] = [img]
    parent = img.parent
    if isinstance(parent, Tag) and parent.name in ("a", "picture", "figure", "div", "span"):
        anchors.append(parent)
    for anchor in anchors:
        for direction in ("find_next_siblings", "find_previous_siblings"):
            for sib in getattr(anchor, direction)():
                if not isinstance(sib, Tag):
                    continue
                if sib.find("img") is not None:
                    break  # ran into the NEXT gallery item — stop looking this way
                if sib.name in _TEXT_BEARING:
                    t = _clean_text(sib, _MAX_BODY_CHARS)
                    if _is_meaningful(t):
                        return t
    return ""


def _image_url_for(img: Tag, base_url: str) -> str:
    src = best_image_url(img.get)
    if not src:
        parent = img.find_parent("picture")
        if parent is not None:
            for source in parent.find_all("source"):
                candidate = parse_srcset(source.get("srcset") or source.get("data-srcset") or "")
                if candidate and not is_placeholder_url(candidate):
                    src = candidate
                    break
    if not src:
        return ""
    return urljoin(base_url, src)


def extract_image_contexts(html: str, base_url: str, *, limit: int = 120) -> list[ImageContext]:
    """Every real image on the page paired with its best adjacent text.

    Order-preserving and deduped by URL; when the same image appears twice the
    occurrence WITH context wins. Placeholder/junk images are dropped through
    the shared ``is_placeholder_url`` filter.
    """
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    products = jsonld_product_map(soup, base_url)

    by_url: dict[str, ImageContext] = {}
    order: list[str] = []
    for img in soup.find_all("img"):
        url = _image_url_for(img, base_url)
        if not url or is_placeholder_url(url):
            continue

        ctx = ImageContext(url=url, alt=_clip(img.get("alt") or "", _MAX_CONTEXT_CHARS))
        if not ctx.alt:
            ctx.alt = _clip(img.get("title") or img.get("aria-label") or "", _MAX_CONTEXT_CHARS)

        ctx.caption = _figcaption_for(img)

        hit = products.get(url) or products.get(_basename(url))
        if hit:
            ctx.jsonld_name, ctx.jsonld_description = hit

        card = _card_ancestor(img)
        if card is not None:
            ctx.heading = _card_heading(card)
            ctx.nearby_text = _card_body(card, ctx.heading)
        if not (ctx.heading or ctx.nearby_text):
            ctx.nearby_text = _sibling_text(img)

        # Audit trail: which rule will win in best_context().
        if ctx.caption:
            ctx.source = "figcaption"
        elif ctx.jsonld_name or ctx.jsonld_description:
            ctx.source = "jsonld"
        elif ctx.heading or ctx.nearby_text:
            ctx.source = "card" if card is not None else "sibling"
        elif ctx.alt:
            ctx.source = "alt"
        else:
            ctx.source = "none"

        existing = by_url.get(url)
        if existing is None:
            by_url[url] = ctx
            order.append(url)
        elif not existing.best_context() and ctx.best_context():
            by_url[url] = ctx  # later occurrence carries context — upgrade

        if len(order) >= limit:
            break
    return [by_url[u] for u in order]

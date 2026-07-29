"""Best-prose extraction + field-fit advisories (SLICE 88).

The owner: the crawler "is pulling in a lot of images, but the text and
descriptions and such are not quality... I want the ability and option to save
any text it finds for me, and edit it right in the vendor page before
accepting it... validate that the text makes sense for where it is going to be
used."

Two pure, deterministic capabilities (no LLM calls, no network):

1. best_prose(markdown)   -> the single most substantial HUMAN-PROSE block on
   a page. Markdown from a crawl is mostly navigation junk (link lists, menus,
   cookie banners); this scores every paragraph block by length, sentence
   structure and link density, and keeps only real writing. The pipeline turns
   the winners into ONE `research_text` reference draft — every page's best
   paragraph with its source URL, so staff can copy/edit ANY text the crawler
   found even when it didn't match a profile field.

2. field_fit_flags(field_key, value) -> ADVISORY flags when a draft obviously
   does not fit its destination field (navigation junk, boilerplate
   cookie/copyright text, a bare product list posing as an "about", or text
   too short to be useful). Conservative and rule-based: it only flags
   patterns it can literally see, never guesses, and never blocks — staff
   still decide. This is the "crawler can do this just as well" path; the
   verify-against-source check in the pipeline already stops hallucinations.
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Prose scoring
# ---------------------------------------------------------------------------

# A block must have at least this many characters (after link stripping) to
# count as prose at all — below this it's a heading or a menu item.
MIN_PROSE_CHARS = 120
# Cap what we quote per page so the draft stays readable.
MAX_BLOCK_CHARS = 1200
# Cap how many pages the research_text draft quotes.
MAX_TEXT_PAGES = 12

_MD_LINK = re.compile(r"\[([^\]]*)\]\(([^)]*)\)")
_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)]*)\)")
_BARE_URL = re.compile(r"https?://\S+")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s")

# Obvious boilerplate that is never profile-worthy prose.
_BOILERPLATE = re.compile(
    r"cookie|javascript|copyright|\ball rights reserved\b|privacy policy|"
    r"terms of (service|use)|\bsubscribe\b|newsletter|sign up|log ?in|"
    r"add to cart|\bcheckout\b|verify your age|21\+|must be 21",
    re.IGNORECASE,
)


def strip_links(text: str) -> str:
    """Replace markdown links/images with their anchor text; drop bare URLs."""
    text = _MD_IMAGE.sub("", text)
    text = _MD_LINK.sub(lambda m: m.group(1), text)
    return _BARE_URL.sub("", text)


def link_density(block: str) -> float:
    """Fraction of the block's characters that live inside link syntax."""
    if not block:
        return 0.0
    linked = sum(len(m.group(0)) for m in _MD_LINK.finditer(block))
    linked += sum(len(m.group(0)) for m in _BARE_URL.finditer(_MD_LINK.sub("", block)))
    return min(1.0, linked / max(1, len(block)))


def paragraph_blocks(markdown: str) -> list[str]:
    """Split markdown into paragraph blocks (blank-line separated)."""
    if not markdown:
        return []
    return [b.strip() for b in re.split(r"\n\s*\n", markdown) if b.strip()]


def prose_score(block: str) -> float:
    """Score a block for prose-ness. <= 0 means 'not prose, skip it'."""
    if _HEADING.match(block):
        return 0.0
    if link_density(block) > 0.4:  # link farms / nav lists
        return 0.0
    plain = strip_links(block).strip()
    if len(plain) < MIN_PROSE_CHARS:
        return 0.0
    letters = sum(c.isalpha() for c in plain)
    if letters / max(1, len(plain)) < 0.6:  # tables, price grids, specs
        return 0.0
    sentences = len(re.findall(r"[.!?](?:\s|$)", plain))
    if sentences == 0:
        return 0.0
    if _BOILERPLATE.search(plain):
        return 0.0
    # Real writing: reward substance and sentence structure.
    return min(len(plain), MAX_BLOCK_CHARS) + sentences * 40


def best_prose(markdown: str) -> str:
    """The most substantial prose block on a page ("" when there is none)."""
    best, best_score = "", 0.0
    for block in paragraph_blocks(markdown):
        score = prose_score(block)
        if score > best_score:
            best, best_score = block, score
    plain = " ".join(strip_links(best).split())
    if len(plain) > MAX_BLOCK_CHARS:
        plain = plain[: MAX_BLOCK_CHARS - 1].rsplit(" ", 1)[0] + "…"
    return plain


def build_research_text(page_texts: list[tuple[str, str]]) -> str:
    """ONE research_text reference draft: each page's best prose + source URL.

    `page_texts` is [(url, page_markdown), ...] in crawl order. Pages without
    real prose are skipped; duplicate paragraphs (same text on every page,
    e.g. a footer blurb) appear once, credited to the first page.
    """
    seen: set[str] = set()
    sections: list[str] = []
    for url, markdown in page_texts:
        if len(sections) >= MAX_TEXT_PAGES:
            break
        prose = best_prose(markdown)
        if not prose:
            continue
        key = prose.lower()
        if key in seen:
            continue
        seen.add(key)
        sections.append(f"FROM {url}\n{prose}")
    if not sections:
        return ""
    header = (
        "TEXT FOUND ON THEIR SITE — the best written paragraph from each page, "
        "with its source. Copy anything useful into a profile field and edit it "
        "there before accepting.\n"
    )
    return header + "\n\n" + "\n\n".join(sections)


# ---------------------------------------------------------------------------
# Field-fit advisories (never block, never invent)
# ---------------------------------------------------------------------------

# Fields the advisories understand; anything else returns no flags.
_PROFILE_FIELDS = {"mission_statement", "about", "product_philosophy", "description"}

_PRICE_LINE = re.compile(r"\$\s?\d|\bUSD\b|\d+\s?(?:mg|g|oz)\b", re.IGNORECASE)


def field_fit_flags(field_key: str, value: str) -> list[str]:
    """ADVISORY flags when text obviously doesn't fit its destination field.

    Deterministic pattern checks only — flags what it can literally see and
    lets staff decide. Returns [] for reference fields and clean text.
    """
    if field_key not in _PROFILE_FIELDS:
        return []
    text = (value or "").strip()
    if not text:
        return []
    flags: list[str] = []

    plain = strip_links(text)
    if len(plain) < 60:
        flags.append(
            f"fit: very short for a {field_key.replace('_', ' ')} — "
            "consider expanding it before accepting"
        )
    if link_density(text) > 0.3 or _BARE_URL.search(text):
        flags.append("fit: contains links/URLs — reads like navigation, not profile prose")
    if _BOILERPLATE.search(plain):
        flags.append("fit: looks like website boilerplate (cookies/sign-up/age-gate/legal), not profile text")

    lines = [ln for ln in plain.splitlines() if ln.strip()]
    if len(lines) >= 4:
        pricey = sum(1 for ln in lines if _PRICE_LINE.search(ln))
        if pricey >= max(2, len(lines) // 2):
            flags.append("fit: looks like a product/price list, not a written profile")

    if plain and len(re.findall(r"[.!?](?:\s|$)", plain)) == 0 and len(plain) >= 60:
        flags.append("fit: no complete sentences — may be a heading or menu text")

    return flags

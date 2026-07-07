"""The research pipeline: ties the steps together for one target.

    fetch (robots/rate-limit/cache, browser+fit_markdown)
      -> CSS-first extraction (no LLM)
      -> LLM extraction of ONLY the remaining gaps (temp≈0)
      -> verify-against-source (drop unsupported facts)
      -> compliance scan (WA I-502; suppress blocking, flag warnings)
      -> build draft rows (source=crawl:<url>, confidence)
      -> (caller) write to ai_suggestions

Returns a structured `ResearchResult` so the API can report exactly what was
found, what was dropped (and why), and what was written — full transparency.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .compliance import check_compliance
from .config import Settings, get_settings
from .css_extract import extract_css
from .discovery import discover_nav_links, discover_sitemap_urls, page_interest_score
from .fetcher import fetch_page
from .llm_extract import extract_with_llm, supported_by_source
from .schemas import ProductExtraction, ProductLine, ProductLineupExtraction, VendorBrandExtraction
from .store import DraftRow, fetch_banned_phrases

# Which fields each entity kind can produce, and their human labels.
VENDOR_BRAND_FIELDS = ["about", "mission_statement", "product_philosophy"]
PRODUCT_FIELDS = ["description"]

# A CSS-found value shorter than this is "thin" (e.g. a one-line og:description);
# a longer LLM synthesis (verified against the real page text) may replace it.
THIN_VALUE_CHARS = 240
# Max product lines included in the product-lineup research draft.
MAX_PRODUCT_LINES = 30
# Max image candidates included in the image research draft.
MAX_IMAGE_LINES = 12


@dataclass
class FieldOutcome:
    field_key: str
    value: str
    confidence: float
    via: str  # "css" | "llm"
    accepted: bool
    reason: str = ""  # why dropped, if not accepted
    flags: list[str] = field(default_factory=list)


@dataclass
class ResearchResult:
    url: str
    entity_type: str
    entity_id: str
    fetched_ok: bool
    from_cache: bool
    fields: list[FieldOutcome] = field(default_factory=list)
    image_candidates: list[str] = field(default_factory=list)
    pages: list[str] = field(default_factory=list)  # every page actually read
    error: str = ""

    @property
    def accepted_drafts(self) -> list[FieldOutcome]:
        return [f for f in self.fields if f.accepted and f.value.strip()]


def _evaluate_field(
    field_key: str,
    value: str,
    confidence: float,
    via: str,
    page_text: str,
    banned: list[str],
) -> FieldOutcome:
    """Verify-against-source + compliance for a single candidate value."""
    value = (value or "").strip()
    if not value:
        return FieldOutcome(field_key, "", 0.0, via, accepted=False, reason="empty")

    # CSS-extracted values are literally from the page; LLM values must be verified.
    if via == "llm" and not supported_by_source(value, page_text):
        return FieldOutcome(field_key, value, confidence, via, accepted=False,
                            reason="not supported by source (possible hallucination)")

    comp = check_compliance(value, banned)
    if not comp.ok:
        return FieldOutcome(field_key, value, confidence, via, accepted=False,
                            reason="compliance: " + "; ".join(comp.blocking_flags), flags=comp.flags)

    return FieldOutcome(field_key, value, confidence, via, accepted=True, flags=comp.flags)


def _merge_css_values(css_values: dict[str, str], page_css, *, is_product: bool) -> None:
    """Fold one page's CSS extraction into the running best values.

    A longer (richer) value REPLACES a thin one for the same field — both are
    literal page text, and the owner wants the substantial copy, not the
    one-line meta description."""
    if is_product:
        candidates = {"description": page_css.description}
    else:
        candidates = {
            "about": page_css.about,
            "mission_statement": page_css.mission_statement,
            "product_philosophy": page_css.product_philosophy,
        }
    for fkey, value in candidates.items():
        value = (value or "").strip()
        if not value:
            continue
        current = css_values.get(fkey, "")
        if not current or (len(current) < THIN_VALUE_CHARS and len(value) > len(current)):
            css_values[fkey] = value


def _format_product_lines(products: list[ProductLine]) -> str:
    """Human-readable product lineup for a single reviewable draft."""
    lines: list[str] = []
    for p in products[:MAX_PRODUCT_LINES]:
        name = (p.name or "").strip()
        if not name:
            continue
        bits = [name]
        if p.lineage.strip():
            bits.append(f"({p.lineage.strip()})")
        if p.category.strip():
            bits.append(f"— {p.category.strip()}")
        if p.notes.strip():
            bits.append(f"· {p.notes.strip()}")
        lines.append(" ".join(bits))
    return "\n".join(lines)


def _verify_product_lines(products: list[ProductLine], corpus: str) -> list[ProductLine]:
    """Anti-hallucination for the lineup: every product NAME must literally
    appear in the crawled text; unsupported lineage/notes are stripped."""
    corpus_lower = corpus.lower()
    kept: list[ProductLine] = []
    for p in products:
        name = (p.name or "").strip()
        if not name or name.lower() not in corpus_lower:
            continue
        if p.lineage.strip() and not supported_by_source(p.lineage, corpus):
            p.lineage = ""
        if p.notes.strip() and not supported_by_source(p.notes, corpus):
            p.notes = ""
        kept.append(p)
    return kept


async def research_target(
    *,
    url: str,
    entity_type: str,
    entity_id: str,
    display_name: str = "",
    settings: Settings | None = None,
    max_pages: int | None = None,
) -> ResearchResult:
    """Research one target. `max_pages` (when given) overrides the worker-wide
    CRAWL_MAX_PAGES budget for THIS run only — harvest jobs use it to give
    Tier-1 vendors a deeper read and Tier-3 directory passes a shallow one."""
    settings = settings or get_settings()
    is_product = entity_type == "product"
    page_budget = max_pages if (max_pages and max_pages > 0) else settings.crawl_max_pages

    fetched = await fetch_page(url, prefer_browser=True, settings=settings)
    if not fetched.ok:
        return ResearchResult(url=url, entity_type=entity_type, entity_id=entity_id,
                              fetched_ok=False, from_cache=fetched.from_cache, error=fetched.error)

    banned = fetch_banned_phrases(settings)
    css = extract_css(fetched.html, url)

    pages_read: list[str] = [url]
    # Per-page text corpus: verification ground truth + LLM grounding.
    corpus_parts: list[str] = [fetched.markdown or ""]
    image_pairs: list[tuple[str, str]] = list(css.images)
    image_candidates: list[str] = list(css.image_urls) + list(fetched.image_urls)

    css_values: dict[str, str] = {}
    _merge_css_values(css_values, css, is_product=is_product)

    # ---- DEEP RESEARCH: read the site the way a human does -------------------
    # Follow the site's own nav links (Our Story, Rosin, Edibles, ...) plus the
    # sitemap, most-promising first, up to CRAWL_MAX_PAGES total pages. Every
    # fetch stays inside robots.txt + per-domain rate limits. Products are a
    # single-page lookup, so deep crawl applies to vendor/brand only.
    if not is_product and page_budget > 1:
        nav = discover_nav_links(fetched.html, url, limit=20)
        sitemap = discover_sitemap_urls(url, settings, limit=30)
        queue: list[str] = []
        seen = {url.rstrip("/")}
        for u in nav + sitemap:
            key = u.rstrip("/")
            if key in seen:
                continue
            seen.add(key)
            if page_interest_score(u) < 0:
                continue
            queue.append(u)
        queue.sort(key=page_interest_score, reverse=True)

        budget = max(0, settings.crawl_max_pages - 1)
        for extra_url in queue[:budget]:
            sub = await fetch_page(extra_url, prefer_browser=True, settings=settings)
            if not sub.ok:
                continue
            pages_read.append(extra_url)
            sub_css = extract_css(sub.html, extra_url)
            _merge_css_values(css_values, sub_css, is_product=False)
            image_pairs += sub_css.images
            image_candidates += sub_css.image_urls + sub.image_urls
            if sub.markdown:
                corpus_parts.append(sub.markdown)

    corpus = "\n\n".join(p for p in corpus_parts if p)

    result = ResearchResult(
        url=url, entity_type=entity_type, entity_id=entity_id,
        fetched_ok=True, from_cache=fetched.from_cache,
        image_candidates=list(dict.fromkeys(image_candidates))[:30],
        pages=pages_read,
    )

    # ---- LLM synthesis over the WHOLE crawled corpus --------------------------
    # Runs for every field that's missing OR thin (a one-line og:description is
    # not the rich profile the owner wants). Verified against the corpus; a
    # hallucinated synthesis gets dropped, and the CSS value stays as fallback.
    target_fields = PRODUCT_FIELDS if is_product else VENDOR_BRAND_FIELDS
    wanted = [f for f in target_fields
              if not css_values.get(f) or len(css_values[f]) < THIN_VALUE_CHARS]
    llm_values: dict[str, str] = {}
    llm_conf = 0.0
    if wanted and settings.ai_enabled and corpus.strip():
        hint = (
            f"Extract the requested fields for the {entity_type} "
            f"\"{display_name or url}\" from the page content (multiple pages of "
            f"the same site, concatenated). Focus on: {', '.join(wanted)}. "
            f"Write 2-5 sentence summaries grounded ONLY in the text. "
            f"Leave anything not on the pages empty."
        )
        if is_product:
            extracted = extract_with_llm(ProductExtraction, corpus, hint, settings=settings)
            if extracted:
                llm_conf = extracted.confidence
                if "description" in wanted and extracted.description:
                    llm_values["description"] = extracted.description
        else:
            extracted = extract_with_llm(VendorBrandExtraction, corpus, hint, settings=settings)
            if extracted:
                llm_conf = extracted.confidence
                if "about" in wanted and extracted.about:
                    llm_values["about"] = extracted.about
                if "mission_statement" in wanted and extracted.mission_statement:
                    llm_values["mission_statement"] = extracted.mission_statement
                if "product_philosophy" in wanted and extracted.product_philosophy:
                    llm_values["product_philosophy"] = extracted.product_philosophy

    # ---- Product lineup (vendor/brand): what do they make? -------------------
    # LLM lists the products/strains the crawled pages show; every product name
    # is then verified to literally appear in the corpus (dropped otherwise).
    # Shipped as ONE research_products draft for staff — reference data, not an
    # auto-import.
    lineup_text = ""
    if not is_product and settings.ai_enabled and corpus.strip():
        lineup = extract_with_llm(
            ProductLineupExtraction, corpus,
            f"List every product/strain that {display_name or 'this company'}'s "
            f"pages show, with lineage/genetics and sensory (aroma/flavor) notes "
            f"when stated. Facts from the text ONLY. No effects, no medical "
            f"language, no prices.",
            settings=settings,
        )
        if lineup and lineup.products:
            verified = _verify_product_lines(lineup.products, corpus)
            lineup_text = _format_product_lines(verified)

    # ---- Evaluate every candidate (verify + compliance) ---------------------
    # If the LLM produced a richer verified value for a field, prefer it and
    # skip the thin CSS one (one draft per field, the best we found).
    for fkey, value in css_values.items():
        if fkey in llm_values and len(llm_values[fkey]) > len(value):
            continue
        result.fields.append(_evaluate_field(fkey, value, 0.9, "css", corpus, banned))
    emitted = {f.field_key for f in result.fields if f.accepted}
    for fkey, value in llm_values.items():
        if fkey in emitted:
            continue
        result.fields.append(_evaluate_field(fkey, value, max(0.3, min(0.85, llm_conf)), "llm", corpus, banned))

    if lineup_text:
        # INTERNAL REFERENCE DATA: research_products can never be accepted into
        # a public profile field (the site's accept actions allowlist only the
        # profile fields), so compliance findings are attached as FLAGS for the
        # reviewer rather than suppressing the draft — strain names like "Sour
        # Candy" legitimately trip the minors-appeal scanner but staff still
        # need to see the lineup. Anything staff publish later goes through the
        # normal compliance gates on those workflows.
        comp = check_compliance(lineup_text, banned)
        result.fields.append(FieldOutcome(
            field_key="research_products",
            value=lineup_text,
            confidence=0.8,
            via="llm",
            accepted=True,
            reason="",
            flags=comp.flags,
        ))

    # ---- Image candidates as ONE reviewable draft ----------------------------
    # The reviewer sees each image URL with its alt text and can open/download
    # the ones worth keeping. Reference data for the media workflow — nothing
    # is fetched or attached automatically.
    if not is_product:
        interesting = [
            (u, alt) for u, alt in image_pairs
            if alt and len(alt) > 2 and not u.lower().endswith(".svg")
        ]
        if not interesting:
            interesting = [(u, "") for u in result.image_candidates[:MAX_IMAGE_LINES]]
        if interesting:
            img_lines = [f"{alt or '(no alt text)'} — {u}" for u, alt in interesting[:MAX_IMAGE_LINES]]
            result.fields.append(FieldOutcome(
                field_key="research_images",
                value="\n".join(img_lines),
                confidence=0.9,
                via="css",
                accepted=True,
                reason="",
                flags=[],
            ))

    return result


async def research_social(
    *,
    handle: str,
    entity_type: str,
    entity_id: str,
    display_name: str = "",
    settings: Settings | None = None,
) -> ResearchResult:
    """Sanctioned social research (DF-9): pull a PUBLIC IG business profile via the
    Meta Graph Business Discovery API and turn the bio/captions into verified,
    compliance-gated draft candidates. Same drafts-only lifecycle as web crawl.
    """
    from .social import fetch_instagram_business, profile_text_blob

    settings = settings or get_settings()
    is_product = entity_type == "product"
    src_label = ""

    profile = fetch_instagram_business(handle, settings=settings)
    pretty = profile.handle or handle
    src_label = f"social:ig:{pretty}"
    if not profile.ok:
        return ResearchResult(url=src_label, entity_type=entity_type, entity_id=entity_id,
                              fetched_ok=False, from_cache=False, error=profile.error)

    page_text = profile_text_blob(profile)
    banned = fetch_banned_phrases(settings)
    result = ResearchResult(
        url=src_label, entity_type=entity_type, entity_id=entity_id,
        fetched_ok=True, from_cache=False,
        image_candidates=profile.image_urls[:30],
    )

    candidates: dict[str, str] = {}
    if not is_product:
        # The IG biography is the brand's own public self-description → "about".
        if profile.biography:
            candidates["about"] = profile.biography
    else:
        # For a product, the most recent descriptive caption is the best draft.
        for post in profile.posts:
            if post.caption and len(post.caption) > 40:
                candidates["description"] = post.caption
                break

    # Verify-against-source uses the profile's own text as ground truth; the
    # value is literally drawn from it, so this passes for honest values and the
    # WA I-502 compliance gate still applies (e.g. captions with effect claims
    # get suppressed and flagged for the reviewer).
    for fkey, value in candidates.items():
        result.fields.append(
            _evaluate_field(fkey, value, 0.75, "social", page_text, banned)
        )
    return result


def result_to_draft_rows(result: ResearchResult) -> list[DraftRow]:
    rows: list[DraftRow] = []
    # result.url is a real URL for web crawls, or a "social:ig:<handle>" label
    # for social research. Use it directly as the provenance source either way.
    is_social = result.url.startswith("social:")
    source = result.url if is_social else f"crawl:{result.url}"
    verb = "social" if is_social else "crawl"
    for f in result.accepted_drafts:
        rows.append(DraftRow(
            entity_type=result.entity_type,
            entity_id=result.entity_id,
            field_key=f.field_key,
            suggested_value=f.value,
            input_summary=f"{verb} {result.url} · {f.field_key} · via {f.via}",
            confidence=f.confidence,
            source=source,
        ))
    return rows

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
from .discovery import discover_sitemap_urls
from .fetcher import fetch_page
from .llm_extract import extract_with_llm, supported_by_source
from .schemas import ProductExtraction, VendorBrandExtraction
from .store import DraftRow, fetch_banned_phrases

# Which fields each entity kind can produce, and their human labels.
VENDOR_BRAND_FIELDS = ["about", "mission_statement", "product_philosophy"]
PRODUCT_FIELDS = ["description"]


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


async def research_target(
    *,
    url: str,
    entity_type: str,
    entity_id: str,
    display_name: str = "",
    settings: Settings | None = None,
) -> ResearchResult:
    settings = settings or get_settings()
    is_product = entity_type == "product"

    fetched = await fetch_page(url, prefer_browser=True, settings=settings)
    if not fetched.ok:
        return ResearchResult(url=url, entity_type=entity_type, entity_id=entity_id,
                              fetched_ok=False, from_cache=fetched.from_cache, error=fetched.error)

    page_text = fetched.markdown or ""
    css = extract_css(fetched.html, url)
    banned = fetch_banned_phrases(settings)
    image_candidates = list(css.image_urls) + list(fetched.image_urls)

    # ---- Collect CSS-first candidates ---------------------------------------
    css_values: dict[str, str] = {}
    if is_product:
        if css.description:
            css_values["description"] = css.description
    else:
        if css.about:
            css_values["about"] = css.about
        if css.mission_statement:
            css_values["mission_statement"] = css.mission_statement
        if css.product_philosophy:
            css_values["product_philosophy"] = css.product_philosophy

    # ---- Bare landing page? Discover a richer page via the site's sitemap ----
    # If a vendor/brand landing page gave us nothing useful, the real "about"
    # copy often lives at /about, /our-story, etc. The site's own sitemap.xml
    # lists those pages — we read what the site explicitly publishes for crawlers.
    extra_pages: list[str] = []
    if not is_product and not css_values:
        candidates = discover_sitemap_urls(url, settings, limit=30)
        wanted = ("about", "our-story", "story", "mission", "who-we-are", "company")
        extra_pages = [u for u in candidates if any(w in u.lower() for w in wanted)][:2]
        for extra_url in extra_pages:
            sub = await fetch_page(extra_url, prefer_browser=True, settings=settings)
            if not sub.ok:
                continue
            sub_css = extract_css(sub.html, extra_url)
            image_candidates += sub_css.image_urls + sub.image_urls
            if sub_css.about and "about" not in css_values:
                css_values["about"] = sub_css.about
            if sub_css.mission_statement and "mission_statement" not in css_values:
                css_values["mission_statement"] = sub_css.mission_statement
            if sub_css.product_philosophy and "product_philosophy" not in css_values:
                css_values["product_philosophy"] = sub_css.product_philosophy
            # Use the richest sub-page text for LLM grounding + verification.
            if sub.markdown and len(sub.markdown) > len(page_text):
                page_text = sub.markdown
            if css_values:
                break

    result = ResearchResult(
        url=url, entity_type=entity_type, entity_id=entity_id,
        fetched_ok=True, from_cache=fetched.from_cache,
        image_candidates=image_candidates[:30],
    )

    # ---- LLM fills ONLY the remaining gaps ----------------------------------
    target_fields = PRODUCT_FIELDS if is_product else VENDOR_BRAND_FIELDS
    missing = [f for f in target_fields if not css_values.get(f)]
    llm_values: dict[str, str] = {}
    llm_conf = 0.0
    if missing and settings.ai_enabled:
        hint = (
            f"Extract the requested fields for the {entity_type} "
            f"\"{display_name or url}\" from the page content. "
            f"Focus on: {', '.join(missing)}. Leave anything not on the page empty."
        )
        if is_product:
            extracted = extract_with_llm(ProductExtraction, page_text, hint, settings=settings)
            if extracted:
                llm_conf = extracted.confidence
                if "description" in missing and extracted.description:
                    llm_values["description"] = extracted.description
        else:
            extracted = extract_with_llm(VendorBrandExtraction, page_text, hint, settings=settings)
            if extracted:
                llm_conf = extracted.confidence
                if "about" in missing and extracted.about:
                    llm_values["about"] = extracted.about
                if "mission_statement" in missing and extracted.mission_statement:
                    llm_values["mission_statement"] = extracted.mission_statement
                if "product_philosophy" in missing and extracted.product_philosophy:
                    llm_values["product_philosophy"] = extracted.product_philosophy

    # ---- Evaluate every candidate (verify + compliance) ---------------------
    for fkey, value in css_values.items():
        # CSS values are highly grounded → confident.
        result.fields.append(_evaluate_field(fkey, value, 0.9, "css", page_text, banned))
    for fkey, value in llm_values.items():
        result.fields.append(_evaluate_field(fkey, value, max(0.3, min(0.85, llm_conf)), "llm", page_text, banned))

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

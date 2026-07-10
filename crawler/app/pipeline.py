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
from .coverage import CrawlCoverage, SaturationTracker, build_coverage
from .css_extract import extract_css
from .discovery import discover_nav_links, discover_sitemap_urls
from .frontier import CrawlFrontier, discover_pagination_links
from .logos import detect_logo_candidates
from .seeding import seed_site_urls
from .fetcher import fetch_page
from .llm_extract import extract_with_llm, supported_by_source
from .page_intelligence import ImageContext, extract_image_contexts
from .schemas import ProductExtraction, ProductLine, ProductLineupExtraction, VendorBrandExtraction
from .social_links import (
    SocialLink,
    detect_social_links,
    format_social_links,
    instagram_handle,
)
from .store import DraftRow, fetch_banned_phrases

# Which fields each entity kind can produce, and their human labels.
VENDOR_BRAND_FIELDS = ["about", "mission_statement", "product_philosophy"]
PRODUCT_FIELDS = ["description"]

# A CSS-found value shorter than this is "thin" (e.g. a one-line og:description);
# a longer LLM synthesis (verified against the real page text) may replace it.
THIN_VALUE_CHARS = 240
# Max product lines included in the product-lineup research draft.
# H9: raised 30 -> 80 (Constellation alone lists 60+ SKUs across lines).
MAX_PRODUCT_LINES = 80
# Max image candidates included in the image research draft.
# H9: raised 12 -> 40 so product shots from catalog pages survive the cut.
# H10a: raised 40 -> 80 — long edible/product catalogs exceeded 40 and the
# overflow (most of the edibles lineup) was silently dropped.
MAX_IMAGE_LINES = 80


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
    display_name: str = ""  # H9b: seeds kb_products.brand_slug for harvested products
    fields: list[FieldOutcome] = field(default_factory=list)
    image_candidates: list[str] = field(default_factory=list)
    pages: list[str] = field(default_factory=list)  # every page actually read
    # H9b: the VERIFIED product lineup (names confirmed to appear in page text).
    # Carried so the API can write structured kb_products DRAFT rows in addition
    # to the human-readable research_products reference draft.
    products: list[ProductLine] = field(default_factory=list)
    # H9d: social channels the vendor advertises on their OWN pages (detected via
    # link-following, no paid API). Carried for the API/summary; also emitted as a
    # single research_social reference draft.
    social_links: list[SocialLink] = field(default_factory=list)
    # C4: crawl completeness snapshot — "did we get everything?" (None for
    # single-page product lookups and social research, where it's meaningless).
    coverage: CrawlCoverage | None = None
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
    force_fresh: bool = False,
) -> ResearchResult:
    """Research one target. `max_pages` (when given) overrides the worker-wide
    CRAWL_MAX_PAGES budget for THIS run only — harvest jobs use it to give
    Tier-1 vendors a deeper read and Tier-3 directory passes a shallow one.

    C7: `force_fresh=True` bypasses the on-disk page cache for every fetch in
    this crawl, so a stale age-gate shell can't mask the fix on a re-crawl."""
    settings = settings or get_settings()
    is_product = entity_type == "product"
    page_budget = max_pages if (max_pages and max_pages > 0) else settings.crawl_max_pages

    fetched = await fetch_page(url, prefer_browser=True, settings=settings, force_fresh=force_fresh)
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
    # C1: image ↔ adjacent-text pairing — the description printed NEXT TO or
    # BELOW a product image (card heading/body, figcaption, JSON-LD Product)
    # is captured alongside the image so the reviewer knows what each image is.
    image_contexts: list[ImageContext] = extract_image_contexts(fetched.html, url)
    # H9d: keep each page's (url, html) so we can detect the social-profile links
    # the vendor advertises (usually in the header/footer of any page).
    html_pages: list[tuple[str, str]] = [(url, fetched.html)]

    css_values: dict[str, str] = {}
    _merge_css_values(css_values, css, is_product=is_product)

    # ---- DEEP RESEARCH: full-site FRONTIER crawl (Slice C2) -------------------
    # The old crawl discovered extra pages only from the ENTRY page, so links
    # on sub-pages were never followed (homepage → /products/ → 40 product
    # pages stopped at /products/). Now EVERY fetched page feeds its same-site
    # links (nav/anchors + pagination) back into a best-first frontier until
    # the page budget is spent — "crawl around the whole site … scraping
    # everything" per the owner. Every fetch still goes through the exact same
    # fetch_page gate (robots.txt, SSRF guard, allow-list, per-domain delay).
    # Products are a single-page lookup, so deep crawl applies to vendor/brand.
    frontier = CrawlFrontier(base_url=url)
    failed_pages: list[str] = []
    # C4: per-page new-content accounting — the completeness signal. The entry
    # page is observed first so sub-page novelty is measured against it.
    saturation = SaturationTracker()
    saturation.observe_page(fetched.markdown or "", fetched.image_urls)
    if not is_product and page_budget > 1:
        # Seed the frontier from the entry page + the site's own machine maps.
        frontier.add(discover_nav_links(fetched.html, url, limit=60))
        frontier.add(discover_pagination_links(fetched.html, url))
        frontier.add(discover_sitemap_urls(url, settings, limit=100))
        # Slice H2: cheap URL inventory (sitemap / Common Crawl — no page
        # fetches) scored by BM25 against the KB target fields. Best-effort;
        # returns [] on old crawl4ai or any seeder error. Seeder-vetted URLs
        # keep their +1 nudge from the old merge.
        try:
            seeded = await seed_site_urls(url, settings=settings)
        except Exception:
            seeded = []
        frontier.add(seeded, bonus=1)

        # NOTE: budget is derived from page_budget (the per-job override from
        # harvest jobs), not settings.crawl_max_pages — fixes an H1 latent bug
        # where the override gated the `if` above but not the loop budget.
        budget = max(0, page_budget - 1)
        while budget > 0:
            extra_url = frontier.pop()
            if extra_url is None:
                break  # site exhausted — we saw everything reachable
            budget -= 1
            sub = await fetch_page(extra_url, prefer_browser=True, settings=settings, force_fresh=force_fresh)
            if not sub.ok:
                failed_pages.append(extra_url)
                continue
            pages_read.append(extra_url)
            html_pages.append((extra_url, sub.html))
            sub_css = extract_css(sub.html, extra_url)
            _merge_css_values(css_values, sub_css, is_product=False)
            image_pairs += sub_css.images
            image_candidates += sub_css.image_urls + sub.image_urls
            image_contexts += extract_image_contexts(sub.html, extra_url)
            # C4: how much NEW content did this page add? (saturation signal)
            saturation.observe_page(sub.markdown or "", sub.image_urls)
            if sub.markdown:
                corpus_parts.append(sub.markdown)
            # THE C2 FIX: this sub-page's own links join the crawl, so the
            # whole reachable site is walked, not just the entry page's links.
            frontier.add(discover_nav_links(sub.html, extra_url, limit=60))
            frontier.add(discover_pagination_links(sub.html, extra_url))

    corpus = "\n\n".join(p for p in corpus_parts if p)

    # ---- C4: completeness validation -----------------------------------------
    # "somehow validate that it has gotten everything" — after the crawl we
    # know (a) exactly how many discovered same-site pages were read vs. still
    # queued vs. failed (frontier accounting) and (b) whether the LAST pages
    # were still adding new content (saturation). Zero extra fetches.
    coverage: CrawlCoverage | None = None
    if not is_product:
        coverage = build_coverage(
            entry_url=url,
            page_budget=page_budget,
            pages_crawled=len(pages_read),
            pages_failed=failed_pages,
            queued_leftover=frontier.pending(),
            frontier_stats=frontier.stats.as_dict(),
            tracker=saturation,
        )

    result = ResearchResult(
        url=url, entity_type=entity_type, entity_id=entity_id,
        fetched_ok=True, from_cache=fetched.from_cache,
        display_name=display_name,
        # H10a: raised 30 -> 80 to match MAX_IMAGE_LINES — a long catalog crawl
        # collected far more than 30 candidates and lost the rest right here.
        image_candidates=list(dict.fromkeys(image_candidates))[:MAX_IMAGE_LINES],
        pages=pages_read,
        coverage=coverage,
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
            f"List EVERY product, strain, and product line that "
            f"{display_name or 'this company'}'s pages show — flower, rosin, "
            f"hash, vapes, edibles, prerolls, capsules, drinks, all of them — "
            f"with the product line/category, lineage/genetics, and sensory "
            f"(aroma/flavor) notes when stated. Be exhaustive: a long complete "
            f"list is better than a short summary. Facts from the text ONLY. "
            f"No effects, no medical language, no prices.",
            settings=settings,
        )
        if lineup and lineup.products:
            verified = _verify_product_lines(lineup.products, corpus)
            lineup_text = _format_product_lines(verified)
            # H9b: carry the verified lineup so the API can also write structured
            # kb_products DRAFT rows (not just the research_products text blob).
            result.products = verified[:MAX_PRODUCT_LINES]

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

    # ---- Logo candidates as ONE reviewable draft (Slice H3) -------------------
    # The four predictable spots (JSON-LD Organization.logo, header/nav <img>
    # with "logo", touch/fav icons, og:image) — pure CSS/metadata, zero LLM
    # cost. Reference draft: the back office shows these visually and a human
    # picks the right one. Nothing is downloaded or attached automatically.
    if not is_product:
        logo_candidates = detect_logo_candidates(fetched.html, url, limit=8)
        if logo_candidates:
            logo_lines = [
                f"[{c.source}] {c.detail or '(no context)'} — {c.url}" for c in logo_candidates
            ]
            result.fields.append(FieldOutcome(
                field_key="research_logos",
                value="\n".join(logo_lines),
                confidence=0.9,
                via="css",
                accepted=True,
                reason="",
                flags=[],
            ))

    # ---- Image candidates as ONE reviewable draft ----------------------------
    # The reviewer sees each image URL with the text the page printed NEXT TO
    # it (C1: card heading/body, figcaption, JSON-LD Product — not just alt)
    # and can open/download the ones worth keeping. Reference data for the
    # media workflow — nothing is fetched or attached automatically.
    if not is_product:
        # C1: context-rich pairs first (figcaption/JSON-LD/card text beat bare
        # alt), then context-less content images (product shots on catalog
        # pages routinely ship with no describing text at all).
        context_by_url: dict[str, str] = {}
        ctx_order: list[str] = []
        for ctx in image_contexts:
            if ctx.url.lower().endswith(".svg"):
                continue
            best = ctx.best_context()
            prev = context_by_url.get(ctx.url)
            if prev is None:
                context_by_url[ctx.url] = best
                ctx_order.append(ctx.url)
            elif not prev and best:
                context_by_url[ctx.url] = best
        # Legacy (url, alt) pairs from css_extract still contribute anything
        # the DOM walk didn't see (e.g. <source>-only picture entries).
        for u, alt in image_pairs:
            if u.lower().endswith(".svg"):
                continue
            if u not in context_by_url:
                context_by_url[u] = alt if (alt and len(alt) > 2) else ""
                ctx_order.append(u)
        with_ctx = [(u, context_by_url[u]) for u in ctx_order if context_by_url[u]]
        without_ctx = [(u, "") for u in ctx_order if not context_by_url[u]]
        interesting = with_ctx + without_ctx
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

    # ---- Coverage report as ONE reviewable draft (Slice C4) -------------------
    # INTERNAL REFERENCE DATA (like research_images/research_products): the
    # reviewer sees exactly how complete the crawl was — pages read vs. budget,
    # links discovered vs. still queued, failed pages, and whether the last
    # pages were still adding new content — with an honest one-line assessment
    # and the fix when incomplete (raise the page budget and re-run).
    if not is_product and coverage is not None:
        result.fields.append(FieldOutcome(
            field_key="research_coverage",
            value=coverage.draft_text(),
            confidence=1.0,          # it's arithmetic about our own crawl
            via="css",
            accepted=True,
            reason="",
            flags=[],
        ))

    # ---- Social-link following (Slice H9d) -----------------------------------
    # Detect the social-profile links the vendor advertises on their OWN pages
    # ("click the social media buttons"), then politely follow each — a
    # LOGGED-OUT public fetch through the same safe path as any web page — to
    # harvest a public about/bio candidate. No login, no paid API, no scraping
    # behind an auth wall. Instagram prefers the sanctioned Business Discovery
    # API when a Meta token is configured; otherwise it uses the public fetch.
    if not is_product and settings.follow_social_links:
        social: list[SocialLink] = []
        seen_social: set[str] = set()
        for page_url, page_html in html_pages:
            for link in detect_social_links(page_html, page_url, limit=20):
                if link.url not in seen_social:
                    seen_social.add(link.url)
                    social.append(link)
        if social:
            # (a) One research_social reference draft listing every channel.
            comp = check_compliance(format_social_links(social), banned)
            result.fields.append(FieldOutcome(
                field_key="research_social",
                value=format_social_links(social),
                confidence=0.9,
                via="css",
                accepted=True,
                reason="",
                flags=comp.flags,
            ))
            result.social_links = social
            # (b) Follow a bounded set of profiles for a public about/bio draft.
            await _follow_social_profiles(
                social, result=result, banned=banned, settings=settings,
            )

    return result


async def _follow_social_profiles(
    social: list[SocialLink],
    *,
    result: "ResearchResult",
    banned: list[str],
    settings: Settings,
) -> None:
    """Fetch a bounded set of the detected social profiles (logged-out) and turn
    any public bio/about text into a verified, compliance-gated draft candidate.

    Instagram: prefer the sanctioned Business Discovery API (social.py) when a
    Meta token is configured; otherwise fall back to the public page fetch.
    Every non-IG profile is a plain polite fetch through fetch_page (robots +
    SSRF + allow-list + rate-limit). Only ONE 'about' candidate is emitted (the
    best/first non-empty), so this augments the website draft rather than
    flooding the reviewer."""
    budget = settings.social_links_max_follow
    if budget <= 0:
        return
    already_have_about = any(
        f.field_key == "about" and f.accepted for f in result.fields
    )

    # Prefer the sanctioned IG path first when available.
    ig_handle = instagram_handle(social)
    if ig_handle and settings.social_enabled and not already_have_about:
        from .social import fetch_instagram_business, profile_text_blob
        profile = fetch_instagram_business(ig_handle, settings=settings)
        if profile.ok and profile.biography:
            outcome = _evaluate_field(
                "about", profile.biography, 0.7, "social",
                profile_text_blob(profile), banned,
            )
            if outcome.accepted:
                result.fields.append(outcome)
                already_have_about = True

    # Public logged-out fetch of the remaining profiles (bounded).
    followed = 0
    for link in social:
        if followed >= budget:
            break
        # Skip IG if the sanctioned path already produced an about draft.
        if link.platform == "instagram" and already_have_about:
            continue
        fetched = await fetch_page(link.url, prefer_browser=True, settings=settings)
        followed += 1
        if not fetched.ok:
            continue
        page_text = fetched.markdown or ""
        css = extract_css(fetched.html, link.url)
        # A social page's og:description / about blurb is the vendor's own public
        # self-description — the best "about" candidate a logged-out view offers.
        candidate = (css.about or css.mission_statement or "").strip()
        if not candidate or already_have_about:
            continue
        outcome = _evaluate_field("about", candidate, 0.6, "social", page_text, banned)
        if outcome.accepted:
            result.fields.append(outcome)
            already_have_about = True


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

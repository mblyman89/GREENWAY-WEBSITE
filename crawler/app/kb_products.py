"""Slice H9b — structured product harvesting into `kb_products`.

The deep-research crawler already lists a vendor/brand's products (ProductLine:
name / category / lineage / notes), verified to literally appear in the crawled
page text. Until now those only shipped as ONE human-readable `research_products`
reference draft (a text blob the staff copy from by hand). The owner wants the
crawler to actually *harvest product data* — catalogs, brands, types, categories —
into the review pipeline as reviewable rows.

This module turns the VERIFIED product lines from a vendor's OWN site into
`kb_products` DRAFT rows, mirroring the CCRS path (`enrich-from-discovery.ts`)
exactly so the same review surface picks them up:

  • Natural identity  (brand_slug, product_slug, variant_label) — the site's key.
  • Drafts-only        status='draft', active=false. A human publishes later.
  • Idempotent inserts ON CONFLICT (identity) DO NOTHING — a re-harvest can never
                       clobber a curated row.
  • Provenance         source='crawl:<url>', sources=['crawl:<url>'], confidence.
  • Compliance-gated   description built from sensory notes; stripped (not the
                       whole row) if it trips the WA I-502 scanner.
  • Category           the raw page category is stored in `category` (denormalized
                       display). We map it to a KNOWN website-taxonomy value ONLY on
                       an obvious, unambiguous match; otherwise we keep the raw
                       string and leave `product_category_id` null. We NEVER guess
                       the canonical taxonomy — the site's resolver / gap-fill does
                       that later against the live DB.

Nothing here reaches a third-party platform: the product lines come from the
vendor's first-party pages that `research_target` already crawled.

The row-builder (`build_product_rows`) is PURE + unit-testable (no I/O). The
writer (`write_product_drafts`) does the Supabase upsert.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .compliance import check_compliance
from .config import Settings, get_settings
from .schemas import ProductLine


# ---------------------------------------------------------------------------
# Slug + identity — MUST mirror src/lib/kb/enrich-from-discovery.ts exactly so
# kb_products rows the crawler writes share the natural key with the CCRS path
# (brand_slug ↔ kb_brands.slug link, and ON CONFLICT dedupe).
# ---------------------------------------------------------------------------

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_SLUG_EDGES = re.compile(r"^-+|-+$")


def slugify_dashed(value: str) -> str:
    """Lowercase dashed slug — byte-for-byte the same rule as slugifyDashed()
    in enrich-from-discovery.ts:
        trim -> lower -> [^a-z0-9]+ => '-' -> strip leading/trailing '-'.
    """
    s = (value or "").strip().lower()
    s = _SLUG_STRIP.sub("-", s)
    s = _SLUG_EDGES.sub("", s)
    return s


def product_key(brand_slug: str, product_slug: str, variant_label: str) -> str:
    """NUL-joined natural key, matching the site's productKey() dedupe key."""
    return "\u0000".join([brand_slug, product_slug, variant_label])


# ---------------------------------------------------------------------------
# Category normalization — conservative. Only an OBVIOUS single-word/phrase
# match to a real website-taxonomy value (mirrors src/lib/pos/category-taxonomy.ts
# `value`s). Anything ambiguous stays raw with product_category_id=null so the
# site can canonicalize against the live DB later. NEVER guess.
# ---------------------------------------------------------------------------

# Maps a lowercased page-category token to a canonical taxonomy `value`.
# Kept intentionally small + unambiguous; the site owns the full resolver.
_CATEGORY_ALIASES: dict[str, str] = {
    "flower": "flower",
    "usable marijuana": "flower",
    "popcorn": "popcorn-bud",
    "popcorn bud": "popcorn-bud",
    "infused flower": "infused-flower",
    "moon rock": "infused-flower",
    "moon rocks": "infused-flower",
    "preroll": "preroll",
    "pre-roll": "preroll",
    "pre roll": "preroll",
    "prerolls": "preroll",
    "blunt": "blunt",
    "cartridge": "cartridge",
    "cart": "cartridge",
    "carts": "cartridge",
    "vape": "cartridge",
    "vapes": "cartridge",
    "disposable": "disposable-cartridge",
    "concentrate": "concentrate",
    "concentrates": "concentrate",
    "rosin": "concentrate",
    "resin": "concentrate",
    "live resin": "concentrate",
    "live rosin": "concentrate",
    "hash": "concentrate",
    "badder": "concentrate",
    "batter": "concentrate",
    "sauce": "concentrate",
    "diamonds": "concentrate",
    "wax": "concentrate",
    "shatter": "concentrate",
    "solventless": "concentrate",
    "rso": "rso",
    "edible": "edible-solid",
    "edibles": "edible-solid",
    "gummy": "edible-solid",
    "gummies": "edible-solid",
    "chocolate": "edible-solid",
    "chocolates": "edible-solid",
    "chew": "edible-solid",
    "chews": "edible-solid",
    "mint": "edible-solid",
    "mints": "edible-solid",
    "capsule": "edible-solid",
    "capsules": "edible-solid",
    "beverage": "edible-liquid",
    "beverages": "edible-liquid",
    "drink": "edible-liquid",
    "drinks": "edible-liquid",
    "soda": "edible-liquid",
    "shot": "edible-liquid",
    "tincture": "tincture",
    "tinctures": "tincture",
    "topical": "topical",
    "topicals": "topical",
    "balm": "topical",
    "lotion": "topical",
    "salve": "topical",
    "trim": "trim",
    "shake": "trim",
    "accessory": "accessories",
    "accessories": "accessories",
    "merch": "merch",
    "apparel": "merch",
}


def normalize_category(raw: str) -> str | None:
    """Return a canonical website-taxonomy value ONLY on an obvious match, else
    None. The caller keeps the raw string in `category` regardless — this only
    decides whether we can also confidently set the canonical value."""
    token = (raw or "").strip().lower()
    if not token:
        return None
    return _CATEGORY_ALIASES.get(token)


# ---------------------------------------------------------------------------
# Row builder (PURE)
# ---------------------------------------------------------------------------

# Cap to keep a single crawl's product write bounded (mirrors the lineup cap).
MAX_PRODUCT_ROWS = 200


@dataclass
class BuiltProducts:
    rows: list[dict] = field(default_factory=list)
    considered: int = 0
    skipped_no_name: int = 0
    skipped_duplicate: int = 0
    descriptions_stripped: int = 0  # notes failed compliance and were dropped


def _sensory_description(line: ProductLine) -> str:
    """Build a short, sensory-only description from the page's own notes/lineage.
    No effects, no medical language — those never come from ProductLine.notes
    (the extraction prompt forbids them) and the compliance gate double-checks."""
    parts: list[str] = []
    lineage = (line.lineage or "").strip()
    notes = (line.notes or "").strip()
    cat = (line.category or "").strip()
    if lineage:
        parts.append(f"Genetics: {lineage}.")
    if notes:
        parts.append(f"Aroma/flavor: {notes}.")
    if not parts and cat:
        # Nothing sensory to say; a bare category line is not worth a description.
        return ""
    return " ".join(parts).strip()


def build_product_rows(
    products: list[ProductLine],
    *,
    entity_type: str,
    entity_id: str,
    display_name: str,
    source_url: str,
    banned: list[str] | None = None,
    actor_id: str | None = None,
) -> BuiltProducts:
    """Turn VERIFIED product lines into kb_products draft-row dicts.

    `entity_type`/`entity_id`/`display_name` describe the vendor/brand the crawl
    was for; `display_name` seeds the brand_slug so a vendor's own products link
    back to that brand. Only vendor/brand crawls produce products (a single
    product page has no lineup).
    """
    banned = banned or []
    out = BuiltProducts()
    if entity_type not in ("vendor", "brand"):
        return out

    brand_raw = (display_name or "").strip()
    brand_slug = slugify_dashed(brand_raw) or "unknown-brand"
    source_tag = f"crawl:{source_url}"

    seen: set[str] = set()
    for line in products:
        out.considered += 1
        name = (line.name or "").strip()
        if not name:
            out.skipped_no_name += 1
            continue

        product_slug = slugify_dashed(name) or "product"
        variant_label = ""  # ProductLine carries no size; base variant.
        key = product_key(brand_slug, product_slug, variant_label)
        if key in seen:
            out.skipped_duplicate += 1
            continue
        seen.add(key)

        raw_cat = (line.category or "").strip() or None
        canonical = normalize_category(raw_cat or "")

        description = _sensory_description(line)
        if description:
            comp = check_compliance(description, banned)
            if not comp.ok:
                description = ""
                out.descriptions_stripped += 1

        row: dict = {
            "brand_slug": brand_slug,
            "product_slug": product_slug,
            "variant_label": variant_label,
            "display_name": name,
            # Denormalized display category is ALWAYS the raw page value (or null).
            # product_category_id stays null; the site's resolver canonicalizes.
            "category": raw_cat,
            "description": description or None,
            "source": source_tag,
            "sources": [source_tag],
            "confidence": 0.6,
            "status": "draft",   # DRAFTS-ONLY — human publishes in review inbox
            "active": False,
        }
        if actor_id:
            row["created_by"] = actor_id
            row["updated_by"] = actor_id
        # We only *note* the canonical guess in sources for auditing; we do NOT
        # set product_category_id (that FK must resolve against the live DB).
        if canonical:
            row["sources"] = [source_tag, f"category-hint:{canonical}"]

        out.rows.append(row)
        if len(out.rows) >= MAX_PRODUCT_ROWS:
            break

    return out


# ---------------------------------------------------------------------------
# Writer (Supabase) — drafts-only, idempotent
# ---------------------------------------------------------------------------


def write_product_drafts(
    rows: list[dict],
    *,
    settings: Settings | None = None,
) -> dict:
    """Insert kb_products DRAFT rows. Idempotent: ON CONFLICT (identity) DO
    NOTHING via ignore_duplicates so a re-harvest never clobbers a curated row.
    Returns a small summary for the API response. No-op (configured=False) when
    Supabase isn't wired, matching store.write_drafts."""
    settings = settings or get_settings()
    if not rows:
        return {"written": 0, "configured": settings.supabase_enabled}
    if not settings.supabase_enabled:
        return {"written": 0, "configured": False, "rows": len(rows)}

    from supabase import create_client

    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    written = 0
    CHUNK = 100
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i : i + CHUNK]
        try:
            res = (
                client.table("kb_products")
                .upsert(
                    chunk,
                    on_conflict="brand_slug,product_slug,variant_label",
                    ignore_duplicates=True,
                )
                .execute()
            )
            written += len(res.data or [])
        except Exception:
            # Defensive: retry without created_by/updated_by if those columns
            # are absent on an older schema (mirrors store.write_drafts fallback).
            slim = [
                {k: v for k, v in r.items() if k not in ("created_by", "updated_by")}
                for r in chunk
            ]
            try:
                res = (
                    client.table("kb_products")
                    .upsert(
                        slim,
                        on_conflict="brand_slug,product_slug,variant_label",
                        ignore_duplicates=True,
                    )
                    .execute()
                )
                written += len(res.data or [])
            except Exception:
                # Whole chunk failed (table missing, etc.). Skip; caller reports 0.
                continue
    return {"written": written, "configured": True}

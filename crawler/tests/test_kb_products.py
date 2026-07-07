"""Slice H9b — pure-core tests for structured product harvesting.

No network, no Supabase: exercises build_product_rows / slugify / category
normalization / compliance stripping. The writer (write_product_drafts) is I/O
and is covered by manual verification against the live table.
"""
from __future__ import annotations

from app.kb_products import (
    build_product_rows,
    normalize_category,
    product_key,
    slugify_dashed,
)
from app.schemas import ProductLine


# ---------------------------------------------------------------------------
# slugify parity with src/lib/kb/enrich-from-discovery.ts slugifyDashed()
# ---------------------------------------------------------------------------


def test_slugify_matches_site_rule():
    assert slugify_dashed("Blue Dream") == "blue-dream"
    assert slugify_dashed("  Papaya x Mimosa V6  ") == "papaya-x-mimosa-v6"
    assert slugify_dashed("Sour--Candy!!") == "sour-candy"
    assert slugify_dashed("---Edge---") == "edge"
    assert slugify_dashed("") == ""


def test_product_key_is_nul_joined():
    assert product_key("avitas", "blue-dream", "") == "avitas\u0000blue-dream\u0000"


# ---------------------------------------------------------------------------
# Category normalization is CONSERVATIVE — obvious matches only, else None.
# ---------------------------------------------------------------------------


def test_category_obvious_matches_map_to_taxonomy_value():
    assert normalize_category("Flower") == "flower"
    assert normalize_category("rosin") == "concentrate"
    assert normalize_category("Gummies") == "edible-solid"
    assert normalize_category("PRE-ROLL") == "preroll"


def test_category_unknown_stays_none_never_guessed():
    assert normalize_category("mystery line") is None
    assert normalize_category("") is None
    assert normalize_category("limited drop") is None


# ---------------------------------------------------------------------------
# build_product_rows
# ---------------------------------------------------------------------------


def _line(name, category="", lineage="", notes=""):
    return ProductLine(name=name, category=category, lineage=lineage, notes=notes)


def test_builds_draft_rows_with_natural_key_and_provenance():
    built = build_product_rows(
        [_line("Blue Dream", category="Flower", lineage="Blueberry x Haze", notes="berry, pine")],
        entity_type="brand",
        entity_id="b-123",
        display_name="Constellation Cannabis",
        source_url="https://constellationcannabis.com/",
    )
    assert len(built.rows) == 1
    row = built.rows[0]
    assert row["brand_slug"] == "constellation-cannabis"
    assert row["product_slug"] == "blue-dream"
    assert row["variant_label"] == ""
    assert row["display_name"] == "Blue Dream"
    assert row["category"] == "Flower"  # raw page value preserved
    assert row["status"] == "draft" and row["active"] is False
    assert row["source"] == "crawl:https://constellationcannabis.com/"
    assert "crawl:https://constellationcannabis.com/" in row["sources"]
    # sensory-only description from the page's own lineage/notes
    assert "Blueberry x Haze" in (row["description"] or "")
    assert "berry, pine" in (row["description"] or "")


def test_missing_display_name_falls_back_to_unknown_brand():
    built = build_product_rows(
        [_line("Rosin Jam")],
        entity_type="vendor",
        entity_id="v-1",
        display_name="",
        source_url="https://x.example/",
    )
    assert built.rows[0]["brand_slug"] == "unknown-brand"


def test_product_only_entity_types_produce_no_rows():
    for et in ("product", "other"):
        built = build_product_rows(
            [_line("Anything")],
            entity_type=et,
            entity_id="p-1",
            display_name="Brand",
            source_url="https://x/",
        )
        assert built.rows == []


def test_blank_names_skipped_and_duplicates_deduped():
    built = build_product_rows(
        [_line(""), _line("Papaya"), _line("Papaya"), _line("  ")],
        entity_type="brand",
        entity_id="b-1",
        display_name="Brand",
        source_url="https://x/",
    )
    assert len(built.rows) == 1
    assert built.skipped_no_name == 2
    assert built.skipped_duplicate == 1


def test_noncompliant_description_stripped_row_kept():
    # A medical claim in notes must strip the description but keep the row/facts.
    built = build_product_rows(
        [_line("Calm Drops", notes="cures insomnia and treats anxiety")],
        entity_type="brand",
        entity_id="b-1",
        display_name="Brand",
        source_url="https://x/",
    )
    assert len(built.rows) == 1
    assert built.rows[0]["description"] is None
    assert built.descriptions_stripped == 1


def test_no_sensory_facts_means_no_description():
    built = build_product_rows(
        [_line("Bare Name", category="Flower")],
        entity_type="brand",
        entity_id="b-1",
        display_name="Brand",
        source_url="https://x/",
    )
    assert built.rows[0]["description"] is None

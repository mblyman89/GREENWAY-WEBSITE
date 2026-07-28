"""LL-2 — pure-logic unit tests for the LeafLink internal-API client helpers.

NO network. These lock the deterministic helpers: DRF envelope parsing
(count/results/next), brand grouping of product-search rows, the pinned
search-fallback resolution (a non-matching `search=` silently returns the
FULL catalog — same count as unfiltered), tolerant brand-hit matching,
brand-menu flattening (top-level ARRAY of product_lines — pinned), and
brand-id coercion.

Fixture values are grounded in the LIVE probe of app.leaflink.com (see
docs/LEAFLINK_PINNED.md): search=smokiez → count=44, search=wyld → count=97,
non-matching search → count=4607 (the unfiltered total); brand menu =
[{brand, product_lines:[{product_line, products:[...]}]}].
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.leaflink_api import (  # noqa: E402
    brand_hit_matches,
    coerce_brand_id,
    drf_count,
    drf_results,
    flatten_brand_menu,
    group_products_by_brand,
    next_page_url,
    resolve_brand_hits,
)


def _row(brand_id, brand_name, company_name="Acme Co", image=""):
    return {
        "id": brand_id * 100,
        "name": f"{brand_name} product",
        "brand": {
            "id": brand_id,
            "name": brand_name,
            "company": {"id": brand_id + 9000, "name": company_name},
        },
        "featured_image": image,
    }


# --- drf_count ----------------------------------------------------------------
def test_drf_count_reads_int():
    assert drf_count({"count": 44, "results": []}) == 44


def test_drf_count_reads_numeric_string():
    assert drf_count({"count": "97"}) == 97


def test_drf_count_zero_on_junk():
    assert drf_count({"count": True}) == 0
    assert drf_count({"count": "abc"}) == 0
    assert drf_count({}) == 0
    assert drf_count(None) == 0
    assert drf_count([1, 2]) == 0


# --- drf_results ----------------------------------------------------------------
def test_drf_results_from_envelope():
    payload = {"count": 2, "results": [{"id": 1}, "junk", {"id": 2}]}
    assert drf_results(payload) == [{"id": 1}, {"id": 2}]


def test_drf_results_from_bare_list():
    # Pinned: the brand-menu endpoint returns a top-level bare array.
    assert drf_results([{"brand": {}}, 5]) == [{"brand": {}}]


def test_drf_results_empty_when_absent():
    assert drf_results({"count": 0}) == []
    assert drf_results(None) == []
    assert drf_results("nope") == []


# --- next_page_url ---------------------------------------------------------------
def test_next_page_url_reads_http_url():
    nxt = "https://app.leaflink.com/api/internal/greenway-marijuana/shop/products/?limit=24&offset=24"
    assert next_page_url({"next": nxt}) == nxt


def test_next_page_url_empty_when_null_or_junk():
    assert next_page_url({"next": None}) == ""
    assert next_page_url({"next": "javascript:alert(1)"}) == ""
    assert next_page_url({}) == ""
    assert next_page_url(None) == ""


# --- group_products_by_brand -------------------------------------------------------
def test_group_products_by_brand_counts_and_sorts():
    rows = [
        _row(1, "Wyld"),
        _row(2, "Smokiez"),
        _row(1, "Wyld"),
        _row(1, "Wyld"),
    ]
    hits = group_products_by_brand(rows)
    assert [h["brand_name"] for h in hits] == ["Wyld", "Smokiez"]
    assert hits[0]["product_count"] == 3
    assert hits[1]["product_count"] == 1
    assert hits[0]["brand_id"] == 1
    assert hits[0]["company_name"] == "Acme Co"
    assert hits[0]["company_id"] == 9001


def test_group_products_by_brand_keeps_first_image():
    rows = [
        _row(1, "Wyld", image=""),
        _row(1, "Wyld", image="https://cdn.example/one.jpg"),
        _row(1, "Wyld", image="https://cdn.example/two.jpg"),
    ]
    hits = group_products_by_brand(rows)
    assert hits[0]["sample_image"] == "https://cdn.example/one.jpg"


def test_group_products_by_brand_skips_rows_without_brand_id():
    rows = [
        {"id": 5, "brand": {"name": "No Id"}},
        {"id": 6, "brand": "junk"},
        {"id": 7},
        _row(3, "Real"),
    ]
    hits = group_products_by_brand(rows)
    assert len(hits) == 1
    assert hits[0]["brand_name"] == "Real"


def test_group_products_by_brand_ties_sorted_by_name():
    rows = [_row(2, "Zeta"), _row(1, "Alpha")]
    hits = group_products_by_brand(rows)
    assert [h["brand_name"] for h in hits] == ["Alpha", "Zeta"]


# --- brand_hit_matches ---------------------------------------------------------------
def test_brand_hit_matches_brand_name_tolerant():
    hit = {"brand_name": "Blazy Susan", "company_name": "Blazy Inc"}
    assert brand_hit_matches(hit, "blazy susan")
    assert brand_hit_matches(hit, "BLAZY-SUSAN")


def test_brand_hit_matches_company_name():
    hit = {"brand_name": "House Brand", "company_name": "Wyld Distribution"}
    assert brand_hit_matches(hit, "wyld")


def test_brand_hit_matches_empty_query_matches_all():
    assert brand_hit_matches({"brand_name": "X"}, "")
    assert brand_hit_matches({"brand_name": "X"}, "   ")


def test_brand_hit_matches_no_match():
    assert not brand_hit_matches({"brand_name": "Wyld", "company_name": "Wyld"}, "smokiez")


# --- resolve_brand_hits (the pinned fallback gotcha) -----------------------------------
def test_resolve_brand_hits_keeps_all_when_search_filtered():
    # Pinned: search=smokiez → count=44 vs unfiltered 4607 — a real filter.
    hits = [{"brand_name": "Smokiez", "company_name": "Smokiez"}]
    kept = resolve_brand_hits(hits, query="smokiez", searched_count=44, unfiltered_count=4607)
    assert kept == hits


def test_resolve_brand_hits_filters_on_fallback():
    # Pinned: a NON-matching term falls back to the full catalog (count=4607
    # same as unfiltered) — the grouped hits are just page-1 catalog noise.
    hits = [
        {"brand_name": "Wyld", "company_name": "Wyld"},
        {"brand_name": "Fairwinds", "company_name": "Fairwinds Mfg"},
    ]
    kept = resolve_brand_hits(hits, query="fairwinds", searched_count=4607, unfiltered_count=4607)
    assert kept == [{"brand_name": "Fairwinds", "company_name": "Fairwinds Mfg"}]


def test_resolve_brand_hits_fallback_can_be_empty():
    hits = [{"brand_name": "Wyld", "company_name": "Wyld"}]
    kept = resolve_brand_hits(hits, query="no-such-brand", searched_count=4607, unfiltered_count=4607)
    assert kept == []


def test_resolve_brand_hits_empty_query_passthrough():
    hits = [{"brand_name": "Anything"}]
    assert resolve_brand_hits(hits, query="", searched_count=4607, unfiltered_count=4607) == hits


def test_resolve_brand_hits_no_unfiltered_probe_keeps_all():
    hits = [{"brand_name": "Wyld"}]
    assert resolve_brand_hits(hits, query="wyld", searched_count=97, unfiltered_count=0) == hits


# --- flatten_brand_menu -----------------------------------------------------------------
def _menu_payload():
    # Pinned shape: top-level ARRAY of {brand, product_lines}.
    return [
        {
            "brand": {"id": 11765, "name": "Blazy Susan"},
            "product_lines": [
                {
                    "product_line": {"id": 1, "name": "Papers"},
                    "products": [
                        {"id": 10, "name": "Pink Papers", "quantity": "1857.000000"},
                        {"id": 11, "name": "King Size"},
                    ],
                },
                {
                    "product_line": {"id": 2, "name": "Accessories"},
                    "products": [{"id": 12, "name": "Tray"}],
                },
            ],
        }
    ]


def test_flatten_brand_menu_pinned_shape():
    brand, products = flatten_brand_menu(_menu_payload())
    assert brand == {"id": 11765, "name": "Blazy Susan"}
    assert [p["id"] for p in products] == [10, 11, 12]
    assert products[0]["product_line"] == "Papers"
    assert products[2]["product_line"] == "Accessories"
    # Rich detail fields ride through untouched.
    assert products[0]["quantity"] == "1857.000000"


def test_flatten_brand_menu_does_not_mutate_source():
    payload = _menu_payload()
    flatten_brand_menu(payload)
    assert "product_line" not in payload[0]["product_lines"][0]["products"][0]


def test_flatten_brand_menu_accepts_string_line_name():
    payload = [
        {
            "brand": {"id": 1, "name": "B"},
            "product_lines": [{"product_line": "Gummies", "products": [{"id": 1}]}],
        }
    ]
    _, products = flatten_brand_menu(payload)
    assert products[0]["product_line"] == "Gummies"


def test_flatten_brand_menu_preserves_existing_product_line():
    payload = [
        {
            "brand": {"id": 1},
            "product_lines": [
                {"product_line": {"name": "Line"}, "products": [{"id": 1, "product_line": "Keep"}]}
            ],
        }
    ]
    _, products = flatten_brand_menu(payload)
    assert products[0]["product_line"] == "Keep"


def test_flatten_brand_menu_tolerates_junk():
    brand, products = flatten_brand_menu(
        [
            "junk",
            {"product_lines": "nope"},
            {"product_lines": [{"products": "nope"}, {"products": [5, {"id": 9}]}]},
        ]
    )
    assert brand == {}
    assert [p["id"] for p in products] == [9]


def test_flatten_brand_menu_accepts_single_dict():
    brand, products = flatten_brand_menu(
        {"brand": {"id": 2}, "product_lines": [{"products": [{"id": 3}]}]}
    )
    assert brand == {"id": 2}
    assert [p["id"] for p in products] == [3]


def test_flatten_brand_menu_empty_payloads():
    assert flatten_brand_menu(None) == ({}, [])
    assert flatten_brand_menu([]) == ({}, [])


# --- coerce_brand_id ------------------------------------------------------------------
def test_coerce_brand_id_int_and_str():
    assert coerce_brand_id(11765) == 11765
    assert coerce_brand_id(" 11765 ") == 11765


def test_coerce_brand_id_float():
    assert coerce_brand_id(42.0) == 42


def test_coerce_brand_id_rejects_bool_zero_negative_junk():
    assert coerce_brand_id(True) == 0
    assert coerce_brand_id(0) == 0
    assert coerce_brand_id(-5) == 0
    assert coerce_brand_id("-5") == 0
    assert coerce_brand_id("abc") == 0
    assert coerce_brand_id(None) == 0

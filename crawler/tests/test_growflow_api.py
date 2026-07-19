"""GF-3 — pure-logic unit tests for the GrowFlow GraphQL client.

NO network. These lock the deterministic helpers: polite-delay math, GraphQL
body building, BuyerVendorId coercion, unwrapping a `data.<field>` envelope,
GraphQL-error extraction, store-list extraction, and client-side store filtering.

Fixtures are grounded in the LIVE probe (see probe/GROWFLOW_PINNED.md): the
getStoreFronts item shape (Greenway store, license 413541) and the
getStoreListing product shape (Bonsai-style product with dollar Price/MSRP and
percent potency Min/Max).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.growflow_api import (  # noqa: E402
    GrowflowApiResult,
    build_graphql_body,
    coerce_vendor_id,
    extract_stores,
    graphql_data_node,
    graphql_errors,
    matches_store,
    normalize_for_match,
    polite_delay_seconds,
)


# --- polite_delay_seconds ---------------------------------------------------
def test_polite_delay_zero_base_is_zero():
    assert polite_delay_seconds(0.0, rand=0.0) == 0.0
    assert polite_delay_seconds(0.0, rand=1.0) == 0.0


def test_polite_delay_min_at_rand_zero():
    assert polite_delay_seconds(3.0, rand=0.0) == 3.0


def test_polite_delay_max_at_rand_one():
    assert polite_delay_seconds(3.0, rand=1.0) == 4.5  # +50%


def test_polite_delay_never_negative():
    assert polite_delay_seconds(-5.0, rand=1.0) == 0.0


def test_polite_delay_clamps_rand():
    # rand > 1 is clamped to 1 (max jitter)
    assert polite_delay_seconds(2.0, rand=5.0) == 3.0


# --- build_graphql_body -----------------------------------------------------
def test_build_graphql_body_shape():
    body = build_graphql_body("query X { a }", {"state": "WA", "vendorId": 2368})
    assert body["query"] == "query X { a }"
    assert body["variables"] == {"state": "WA", "vendorId": 2368}


def test_build_graphql_body_copies_variables():
    variables = {"state": "WA"}
    body = build_graphql_body("q", variables)
    body["variables"]["state"] = "OR"
    assert variables["state"] == "WA"  # original untouched


def test_build_graphql_body_none_variables():
    body = build_graphql_body("q", None)  # type: ignore[arg-type]
    assert body["variables"] == {}


# --- coerce_vendor_id -------------------------------------------------------
def test_coerce_vendor_id_int_and_str():
    assert coerce_vendor_id(2368) == 2368
    assert coerce_vendor_id("2368") == 2368
    assert coerce_vendor_id("  2368  ") == 2368


def test_coerce_vendor_id_float():
    assert coerce_vendor_id(2368.0) == 2368


def test_coerce_vendor_id_rejects_bool_and_junk():
    assert coerce_vendor_id(True) == 0  # bool is not a real vendor id
    assert coerce_vendor_id("abc") == 0
    assert coerce_vendor_id(None) == 0
    assert coerce_vendor_id("") == 0


# --- graphql_data_node ------------------------------------------------------
def test_graphql_data_node_standard_envelope():
    payload = {"data": {"getStoreFronts": [{"Id": 1}]}}
    assert graphql_data_node(payload, "getStoreFronts") == [{"Id": 1}]


def test_graphql_data_node_bare_field():
    payload = {"getStoreFronts": [{"Id": 1}]}
    assert graphql_data_node(payload, "getStoreFronts") == [{"Id": 1}]


def test_graphql_data_node_absent_returns_none():
    assert graphql_data_node({"data": {}}, "getStoreFronts") is None
    assert graphql_data_node(None, "getStoreFronts") is None
    assert graphql_data_node("nope", "getStoreFronts") is None


# --- graphql_errors ---------------------------------------------------------
def test_graphql_errors_extracts_messages():
    payload = {"errors": [{"message": "not authorized"}, {"message": "bad var"}]}
    assert graphql_errors(payload) == ["not authorized", "bad var"]


def test_graphql_errors_accepts_string_entries():
    assert graphql_errors({"errors": ["boom"]}) == ["boom"]


def test_graphql_errors_none_when_absent():
    assert graphql_errors({"data": {"x": 1}}) == []
    assert graphql_errors(None) == []
    assert graphql_errors({"errors": "notalist"}) == []


# --- extract_stores ---------------------------------------------------------
def test_extract_stores_from_envelope():
    # Real getStoreFronts item shape (VERIFIED), Greenway store license 413541.
    payload = {
        "data": {
            "getStoreFronts": [
                {
                    "Id": 1211,
                    "LicenseNumber": "413541",
                    "VendorId": 2368,
                    "Name": "Greenway Marijuana",
                    "AccessStatus": "Unlocked",
                    "City": "Port Orchard",
                    "Region": "WA",
                    "LogoUrl": "https://growflowweb.blob.core.windows.net/logo.png",
                },
                {"Id": 99, "Name": "Other Store", "LicenseNumber": "111111"},
            ]
        }
    }
    stores = extract_stores(payload)
    assert len(stores) == 2
    assert stores[0]["LicenseNumber"] == "413541"


def test_extract_stores_bare_list():
    assert extract_stores([{"Id": 1}, "junk", {"Id": 2}]) == [{"Id": 1}, {"Id": 2}]


def test_extract_stores_empty_when_absent():
    assert extract_stores({"data": {}}) == []
    assert extract_stores(None) == []


# --- matches_store ----------------------------------------------------------
def test_matches_store_by_name_case_insensitive():
    store = {"Name": "Greenway Marijuana", "LicenseNumber": "413541"}
    assert matches_store(store, "greenway") is True
    assert matches_store(store, "GREEN") is True


def test_matches_store_by_license():
    store = {"Name": "Greenway", "LicenseNumber": "413541"}
    assert matches_store(store, "413541") is True


def test_matches_store_by_city():
    store = {"Name": "X", "City": "Port Orchard"}
    assert matches_store(store, "orchard") is True


def test_matches_store_empty_query_matches_all():
    assert matches_store({"Name": "Anything"}, "") is True
    assert matches_store({"Name": "Anything"}, "   ") is True


def test_matches_store_no_match():
    store = {"Name": "Greenway", "LicenseNumber": "413541"}
    assert matches_store(store, "zzzz") is False


def test_matches_store_space_and_punctuation_insensitive():
    """Live-probed: the real store name is "ThunderChief" (no space) buried
    behind decorative underscores; a search for "thunder chief" must match."""
    store = {"Name": "_______________________ThunderChief"}
    assert matches_store(store, "thunder chief") is True
    assert matches_store(store, "ThunderChief") is True
    assert matches_store(store, "thunderchief") is True
    assert matches_store(store, "lifted") is False


def test_growflow_normalize_for_match():
    assert normalize_for_match("Thunder Chief") == "thunderchief"
    assert normalize_for_match("!# DOH FREYA FARMS\"") == "dohfreyafarms"
    assert normalize_for_match("") == ""


# --- GrowflowApiResult ------------------------------------------------------
def test_result_defaults():
    r = GrowflowApiResult(ok=True)
    assert r.url == ""
    assert r.status == 0
    assert r.records is None
    assert r.error == ""

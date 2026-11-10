"""D222 — pure-logic tests for the re-pinned LeafLink connection (2026-11-09).

NO network. Shapes are trimmed copies of LIVE responses captured with the
owner's buyer account (see docs/LEAFLINK_PINNED.md, "D222 re-pin"):
  * GET https://api.leaflink.com/content/brands/listing?company_id=3053&page=1
    -> {count, next, previous, content:{collection:[...], sponsorships}}
  * the Bearer JWT is RS256 with exp - iat = 10800 s.
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings  # noqa: E402
from app.leaflink_api import (  # noqa: E402
    listing_hits,
    listing_rows,
    merge_query,
    rank_brand_hits,
)
from app.leaflink_auth import (  # noqa: E402
    LeaflinkSessionData,
    bearer_from_request,
    bearer_headers,
    bearer_usable,
    jwt_exp,
    load_session,
    needs_token_login,
    save_session,
    session_from_capture,
)

API = "https://api.leaflink.com"

# Trimmed from the live `search=smokiez` answer (description shortened).
LISTING_SMOKIEZ = {
    "count": 1,
    "next": None,
    "previous": None,
    "content": {
        "collection": [
            {
                "resource_id": 73,
                "resource_name": "brand",
                "name": "Smokiez Edibles",
                "description": "<p>Smokiez Edibles</p>",
                "image": "https://d3nec6hp1jgjd8.cloudfront.net/media/images/brands/2018/01/24/Asset_2.jpg",
                "owner": {
                    "resource_id": 3277,
                    "resource_name": "company",
                    "name": "Pacific Northwest Consulting, llc",
                    "slug": "pacific-nw-consulting",
                    "enable_vendor_menu": False,
                },
                "product_categories": ["Edibles & Ingestibles"],
                "badges": [],
                "social_equity_programs": [],
                "sponsored": False,
                "tagline": "Not Your Average Gummy",
                "company_s2s_integration_type": "none",
            }
        ],
        "sponsorships": {"banners": [], "listing": [], "skyscrapers": []},
    },
}


def _jwt(claims: dict) -> str:
    def seg(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    return f"{seg({'alg': 'RS256', 'typ': 'JWT'})}.{seg(claims)}.sig"


def _settings(tmp_path: Path) -> Settings:
    return Settings(  # type: ignore[arg-type]
        _env_file=None,
        SUPABASE_URL="https://x.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="svc",
        CRAWLER_SHARED_SECRET="shh",
        LEAFLINK_SESSION_FILE=str(tmp_path / "ll.json"),
    )


# --- merge_query (the dropped-query bug) ------------------------------------
def test_merge_query_keeps_next_url_query():
    url, q = merge_query(
        "https://app.leaflink.com/api/internal/x/shop/products/?limit=24&offset=24&search=smokiez",
        {"error_format": "jsonapi"},
    )
    assert url == "https://app.leaflink.com/api/internal/x/shop/products/"
    assert q == {"limit": "24", "offset": "24", "search": "smokiez", "error_format": "jsonapi"}


def test_merge_query_params_override_url():
    _, q = merge_query("https://h/p?page=1&x=a", {"page": 2})
    assert q == {"page": 2, "x": "a"}


def test_merge_query_no_query_and_none_params():
    assert merge_query("https://h/p", None) == ("https://h/p", {})


def test_merge_query_keeps_blank_values():
    _, q = merge_query("https://h/p?sort_by=&search=a", {})
    assert q == {"sort_by": "", "search": "a"}


# --- listing_rows / listing_hits --------------------------------------------
def test_listing_rows_pinned_envelope():
    assert len(listing_rows(LISTING_SMOKIEZ)) == 1


def test_listing_rows_tolerates_junk():
    assert listing_rows(None) == []
    assert listing_rows({"content": None}) == []
    assert listing_rows({"content": {"collection": "x"}}) == []
    assert listing_rows({"content": {"collection": [1, None, {"a": 1}]}}) == [{"a": 1}]


def test_listing_hits_maps_to_brand_hit_shape_with_logo():
    (hit,) = listing_hits(LISTING_SMOKIEZ)
    assert hit["brand_id"] == 73
    assert hit["brand_name"] == "Smokiez Edibles"
    assert hit["company_id"] == 3277
    assert hit["company_name"] == "Pacific Northwest Consulting, llc"
    assert hit["company_slug"] == "pacific-nw-consulting"
    assert hit["logo_url"].endswith("/Asset_2.jpg")
    assert hit["sample_image"] == hit["logo_url"]
    assert hit["product_count"] is None  # unknown, not zero
    assert hit["product_categories"] == ["Edibles & Ingestibles"]
    assert hit["source"] == "brands_listing"


def test_listing_hits_empty_image_is_blank_not_none():
    # Pinned live: "Presidential" (RWOODSII) has no image.
    payload = {"content": {"collection": [{"resource_id": 11955, "name": "Presidential", "image": None, "owner": {"name": "RWOODSII"}}]}}
    (hit,) = listing_hits(payload)
    assert hit["logo_url"] == "" and hit["company_id"] is None


def test_listing_hits_drops_rows_without_id_and_dupes():
    payload = {"content": {"collection": [
        {"name": "no id"},
        {"resource_id": True, "name": "bool id"},
        {"resource_id": 5, "name": "A"},
        {"resource_id": "5", "name": "A again"},
    ]}}
    hits = listing_hits(payload)
    assert [h["brand_name"] for h in hits] == ["A"]


def test_listing_hits_empty_answer():
    assert listing_hits({"count": 0, "next": None, "content": {"collection": []}}) == []


# --- rank_brand_hits ----------------------------------------------------------
def test_rank_brand_hits_name_matches_first_rest_kept():
    hits = [
        {"brand_name": "High Mountain Imports", "company_name": "High Mountain Imports"},
        {"brand_name": "Trichome Extracts", "company_name": "Canna Pacific"},
    ]
    out = rank_brand_hits(hits, "trichome")
    assert [h["brand_name"] for h in out] == ["Trichome Extracts", "High Mountain Imports"]


def test_rank_brand_hits_company_name_counts():
    hits = [{"brand_name": "X", "company_name": "Other"}, {"brand_name": "Trichome", "company_name": "Canna Pacific"}]
    assert rank_brand_hits(hits, "canna pacific")[0]["brand_name"] == "Trichome"


def test_rank_brand_hits_empty_query_passthrough():
    hits = [{"brand_name": "B"}, {"brand_name": "A"}]
    assert rank_brand_hits(hits, " ") == hits


# --- jwt_exp ------------------------------------------------------------------
def test_jwt_exp_reads_claim():
    assert jwt_exp(_jwt({"iat": 1794272695, "exp": 1794283495})) == 1794283495.0


def test_jwt_exp_zero_on_junk():
    assert jwt_exp("") == 0.0
    assert jwt_exp("a.b") == 0.0
    assert jwt_exp("a.!!!.c") == 0.0
    assert jwt_exp(_jwt({"sub": "x"})) == 0.0


# --- bearer_from_request --------------------------------------------------------
def test_bearer_from_request_pinned_listing_call():
    tok, cid = bearer_from_request(
        f"{API}/content/brands/listing?company_id=3053&page=1",
        {"authorization": "Bearer abc.def.ghi", "leaflink-version": "2022-10-31"},
        api_origin=API,
    )
    assert (tok, cid) == ("abc.def.ghi", "3053")


def test_bearer_from_request_header_case_insensitive_and_no_company():
    tok, cid = bearer_from_request(f"{API}/brands/recommended", {"Authorization": "Bearer t"}, api_origin=API + "/")
    assert (tok, cid) == ("t", "")


def test_bearer_from_request_ignores_other_hosts_and_non_bearer():
    assert bearer_from_request("https://app.leaflink.com/api/x?company_id=1", {"authorization": "Bearer t"}, api_origin=API) == ("", "")
    assert bearer_from_request("https://api.leaflink.com.evil.io/x", {"authorization": "Bearer t"}, api_origin=API) == ("", "")
    assert bearer_from_request(f"{API}/x", {"authorization": "Basic zzz"}, api_origin=API) == ("", "")
    assert bearer_from_request(f"{API}/x", None, api_origin=API) == ("", "")


# --- bearer_usable / needs_token_login -----------------------------------------
def test_bearer_usable_honours_exp_margin():
    s = LeaflinkSessionData(cookies={"a": "1"}, bearer_token="t", bearer_exp=1000.0)
    assert bearer_usable(s, now=600) is True
    assert bearer_usable(s, now=701) is False  # inside the 300 s margin
    assert bearer_usable(LeaflinkSessionData(bearer_token="t"), now=1) is True  # unknown exp
    assert bearer_usable(LeaflinkSessionData(), now=1) is False


def test_needs_token_login_rules():
    # old-format cached session (pre-D222): never looked for a token -> log in
    assert needs_token_login(LeaflinkSessionData(cookies={"a": "1"}, captured_at=1)) is True
    # new login that found no token -> do NOT loop; fall back to cookies
    assert needs_token_login(LeaflinkSessionData(cookies={"a": "1"}, bearer_tried=True)) is False
    # expired token -> log in again
    assert needs_token_login(
        LeaflinkSessionData(bearer_token="t", bearer_exp=100, bearer_tried=True), now=1000
    ) is True
    assert needs_token_login(
        LeaflinkSessionData(bearer_token="t", bearer_exp=10_000, bearer_tried=True), now=1000
    ) is False


def test_bearer_headers_pinned_version():
    h = bearer_headers(LeaflinkSessionData(bearer_token="tok"), api_version="2022-10-31")
    assert h == {"Accept": "application/json", "Authorization": "Bearer tok", "leaflink-version": "2022-10-31"}
    assert "Authorization" not in bearer_headers(LeaflinkSessionData(), api_version="")


# --- capture + persistence --------------------------------------------------------
def test_session_from_capture_keeps_token_exp_and_company():
    tok = _jwt({"iat": 100, "exp": 10_900})
    s = session_from_capture(
        raw_cookies=[{"name": "mp-sessionid", "value": "x"}],
        company_slug="greenway-marijuana",
        bearer_token=f" {tok} ",
        company_id="3053",
        now=100.0,
    )
    assert s.bearer_token == tok and s.bearer_exp == 10_900.0
    assert s.company_id == "3053" and s.bearer_tried is True


def test_session_round_trip_with_token(tmp_path):
    st = _settings(tmp_path)
    s = LeaflinkSessionData(
        cookies={"mp-sessionid": "x"}, company_slug="greenway-marijuana", captured_at=5.0,
        bearer_token="t", bearer_exp=99.0, company_id="3053", bearer_tried=True,
    )
    save_session(s, st)
    assert load_session(st) == s


def test_old_session_file_loads_without_token_fields(tmp_path):
    st = _settings(tmp_path)
    (tmp_path / "ll.json").write_text(json.dumps({"cookies": {"a": "1"}, "company_slug": "g", "captured_at": 7}))
    s = load_session(st)
    assert s.cookies == {"a": "1"} and s.bearer_token == "" and s.bearer_tried is False


def test_settings_api_defaults(tmp_path):
    st = _settings(tmp_path)
    assert st.leaflink_api == "https://api.leaflink.com"
    assert st.leaflink_api_version == "2022-10-31"
    assert st.leaflink_company_id == "3053"

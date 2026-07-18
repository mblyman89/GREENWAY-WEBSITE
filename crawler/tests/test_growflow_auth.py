"""GF-2 — pure-logic unit tests for the GrowFlow authenticated session.

NO network, NO browser. These lock the deterministic helpers: JWT `exp`
decoding, Bearer-header extraction, GraphQL-endpoint selection, session capture,
staleness math, auth-header building, BuyerVendorId resolution from a
getStoreFrontUserVendors response, and session file round-trip.

Values here are grounded in the LIVE probe of marketplace.growflow.com: the
buyer's real BuyerVendorId is 2368 (Greenway Marijuana, license 413541); the
GraphQL endpoint is marketplaceapi-prod.gke.wholesale.growflow.com/graphql; the
Bearer token is an Auth0 JWT delivered in the Authorization request header.
"""
from __future__ import annotations

import base64
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings  # noqa: E402
from app.growflow_auth import (  # noqa: E402
    GrowflowSessionData,
    auth_headers,
    bearer_from_header,
    buyer_vendor_from_profile,
    clear_session,
    decode_jwt_exp,
    graphql_url_from_requests,
    is_session_stale,
    load_session,
    save_session,
    session_from_capture,
)

GRAPHQL = "https://marketplaceapi-prod.gke.wholesale.growflow.com/graphql"


def _settings(**env) -> Settings:
    base = {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "svc",
        "CRAWLER_SHARED_SECRET": "shh",
    }
    base.update(env)
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


def _jwt(payload: dict) -> str:
    """Build an unsigned JWT-shaped string with the given payload."""
    def seg(obj: dict) -> str:
        raw = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    return f"{seg({'alg': 'RS256'})}.{seg(payload)}.sig"


# --- decode_jwt_exp ---------------------------------------------------------
def test_decode_jwt_exp_reads_exp():
    tok = _jwt({"exp": 1_700_000_000, "sub": "auth0|abc"})
    assert decode_jwt_exp(tok) == 1_700_000_000.0


def test_decode_jwt_exp_handles_missing_padding():
    tok = _jwt({"exp": 1234567890})
    assert decode_jwt_exp(tok) == 1234567890.0


def test_decode_jwt_exp_returns_zero_on_junk():
    assert decode_jwt_exp("") == 0.0
    assert decode_jwt_exp("not-a-jwt") == 0.0
    assert decode_jwt_exp("only.two") == 0.0


def test_decode_jwt_exp_returns_zero_when_exp_absent():
    tok = _jwt({"sub": "auth0|abc"})
    assert decode_jwt_exp(tok) == 0.0


def test_decode_jwt_exp_returns_zero_on_non_numeric_exp():
    tok = _jwt({"exp": "soon"})
    assert decode_jwt_exp(tok) == 0.0


# --- bearer_from_header -----------------------------------------------------
def test_bearer_from_header_strips_scheme():
    assert bearer_from_header("Bearer abc.def.ghi") == "abc.def.ghi"


def test_bearer_from_header_case_insensitive_scheme():
    assert bearer_from_header("bearer abc.def.ghi") == "abc.def.ghi"


def test_bearer_from_header_accepts_bare_token():
    assert bearer_from_header("abc.def.ghi") == "abc.def.ghi"


def test_bearer_from_header_trims_whitespace():
    assert bearer_from_header("  Bearer   tok  ") == "tok"


def test_bearer_from_header_empty_on_junk():
    assert bearer_from_header("") == ""
    assert bearer_from_header(None) == ""  # type: ignore[arg-type]


# --- graphql_url_from_requests ----------------------------------------------
def test_graphql_url_prefers_override():
    urls = ["https://other.example.com/graphql"]
    assert graphql_url_from_requests(urls, override="https://forced.example.com/graphql/") == (
        "https://forced.example.com/graphql"
    )


def test_graphql_url_picks_first_graphql_endpoint():
    urls = [
        "https://cdn.growflow.com/main.js",
        GRAPHQL + "?op=getStoreFrontsV2",
        "https://other/graphql",
    ]
    # query string stripped; the real prod endpoint is chosen
    assert graphql_url_from_requests(urls) == GRAPHQL


def test_graphql_url_empty_when_none_match():
    assert graphql_url_from_requests(["https://x/api", "https://y/rest"]) == ""


def test_graphql_url_empty_on_empty_list():
    assert graphql_url_from_requests([]) == ""


# --- session_from_capture ---------------------------------------------------
def test_session_from_capture_builds_value_object():
    tok = _jwt({"exp": 1_800_000_000})
    s = session_from_capture(
        access_token=f"Bearer {tok}",
        graphql_url=GRAPHQL + "?x=1",
        buyer_vendor_id=2368,  # type: ignore[arg-type]
        state="WA",
        now=1_000.0,
    )
    assert s.access_token == tok  # scheme stripped
    assert s.graphql_url == GRAPHQL  # query stripped, no trailing slash
    assert s.buyer_vendor_id == "2368"  # coerced to str
    assert s.state == "WA"
    assert s.captured_at == 1_000.0
    assert s.token_exp == 1_800_000_000.0
    assert s.has_token is True


def test_session_from_capture_tolerates_bare_token_and_missing_exp():
    s = session_from_capture(access_token="raw.tok.here", graphql_url=GRAPHQL, now=5.0)
    assert s.access_token == "raw.tok.here"
    assert s.token_exp == 0.0
    assert s.buyer_vendor_id == ""


# --- is_session_stale -------------------------------------------------------
def test_is_session_stale_true_without_token():
    s = GrowflowSessionData()
    assert is_session_stale(s, ttl_seconds=2700, now=100.0) is True


def test_is_session_stale_false_for_fresh_session():
    s = session_from_capture(access_token=_jwt({"exp": 10_000}), graphql_url=GRAPHQL, now=100.0)
    assert is_session_stale(s, ttl_seconds=2700, now=200.0) is False


def test_is_session_stale_true_when_jwt_expiring_within_skew():
    # exp at 1000; now 950; skew 60 -> 950 >= (1000-60)=940 -> stale
    s = session_from_capture(access_token=_jwt({"exp": 1000}), graphql_url=GRAPHQL, now=900.0)
    assert is_session_stale(s, ttl_seconds=999_999, now=950.0, skew_seconds=60) is True


def test_is_session_stale_true_when_ttl_exceeded():
    # no exp in token -> only TTL governs; captured at 0? use explicit now
    s = session_from_capture(access_token="a.b.c", graphql_url=GRAPHQL, now=0.0)
    # captured_at==0 -> treated as stale by the captured_at<=0 guard
    assert is_session_stale(s, ttl_seconds=2700, now=1.0) is True


def test_is_session_stale_true_when_older_than_ttl():
    s = session_from_capture(access_token="a.b.c", graphql_url=GRAPHQL, now=1_000.0)
    assert is_session_stale(s, ttl_seconds=2700, now=1_000.0 + 2700) is True
    assert is_session_stale(s, ttl_seconds=2700, now=1_000.0 + 2699) is False


# --- auth_headers -----------------------------------------------------------
def test_auth_headers_includes_bearer_when_token_present():
    s = session_from_capture(access_token="tok123", graphql_url=GRAPHQL, now=1.0)
    h = auth_headers(s)
    assert h["Authorization"] == "Bearer tok123"
    assert h["Content-Type"] == "application/json"
    assert h["Accept"] == "application/json"


def test_auth_headers_omits_authorization_without_token():
    h = auth_headers(GrowflowSessionData())
    assert "Authorization" not in h
    assert h["Content-Type"] == "application/json"


# --- buyer_vendor_from_profile ----------------------------------------------
def test_buyer_vendor_from_profile_reads_graphql_envelope():
    # Shape from the LIVE probe of getStoreFrontUserVendorsV2 (state=WA).
    payload = {
        "data": {
            "getStoreFrontUserVendors": [
                {
                    "Id": 1,
                    "UserId": 42,
                    "BuyerVendorId": 2368,
                    "BuyerVendorName": "Greenway Marijuana",
                    "BuyerVendorLicenseNumber": "413541",
                },
                {
                    "Id": 2,
                    "BuyerVendorId": 10418,
                    "BuyerVendorName": "Yakima Weed Co",
                    "BuyerVendorLicenseNumber": "430876",
                },
            ]
        }
    }
    assert buyer_vendor_from_profile(payload) == "2368"


def test_buyer_vendor_from_profile_accepts_bare_list():
    payload = [{"BuyerVendorId": 2368, "BuyerVendorName": "Greenway Marijuana"}]
    assert buyer_vendor_from_profile(payload) == "2368"


def test_buyer_vendor_from_profile_empty_on_empty():
    assert buyer_vendor_from_profile({}) == ""
    assert buyer_vendor_from_profile([]) == ""
    assert buyer_vendor_from_profile(None) == ""


def test_buyer_vendor_from_profile_skips_entries_without_id():
    payload = [{"BuyerVendorName": "no id"}, {"BuyerVendorId": 2368}]
    assert buyer_vendor_from_profile(payload) == "2368"


# --- session file round-trip ------------------------------------------------
def test_session_file_round_trip(tmp_path):
    settings = _settings(GROWFLOW_SESSION_FILE=str(tmp_path / "gf_session.json"))
    original = session_from_capture(
        access_token=_jwt({"exp": 2_000_000_000}),
        graphql_url=GRAPHQL,
        buyer_vendor_id="2368",
        state="WA",
        now=1_234.5,
    )
    save_session(original, settings)
    loaded = load_session(settings)
    assert loaded.access_token == original.access_token
    assert loaded.graphql_url == GRAPHQL
    assert loaded.buyer_vendor_id == "2368"
    assert loaded.state == "WA"
    assert loaded.captured_at == 1_234.5
    assert loaded.token_exp == 2_000_000_000.0


def test_load_session_returns_empty_when_missing(tmp_path):
    settings = _settings(GROWFLOW_SESSION_FILE=str(tmp_path / "nope.json"))
    s = load_session(settings)
    assert s.has_token is False
    assert s.access_token == ""


def test_load_session_tolerates_corrupt_file(tmp_path):
    p = tmp_path / "corrupt.json"
    p.write_text("{ this is not json", "utf-8")
    settings = _settings(GROWFLOW_SESSION_FILE=str(p))
    s = load_session(settings)
    assert s.has_token is False


def test_clear_session_removes_file(tmp_path):
    p = tmp_path / "gf_session.json"
    settings = _settings(GROWFLOW_SESSION_FILE=str(p))
    save_session(session_from_capture(access_token="t", graphql_url=GRAPHQL, now=1.0), settings)
    assert p.exists()
    clear_session(settings)
    assert not p.exists()
    # idempotent: clearing a missing file is a no-op
    clear_session(settings)


# --- config gating ----------------------------------------------------------
def test_growflow_disabled_without_credentials():
    assert _settings().growflow_enabled is False


def test_growflow_enabled_with_credentials():
    s = _settings(GROWFLOW_EMAIL="buyer@example.com", GROWFLOW_PASSWORD="pw")
    assert s.growflow_enabled is True
    assert s.growflow_site == "https://marketplace.growflow.com"
    assert s.growflow_state == "WA"

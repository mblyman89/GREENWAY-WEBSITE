"""CV-2 — pure-logic unit tests for the Cultivera authenticated session.

NO network, NO browser. These lock the deterministic helpers: JWT `exp`
decoding, staleness math, localStorage → session extraction (with key-variant
and nested-JSON tolerance), auth-header building, API-base sniffing, session
file round-trip, and api-base resolution precedence.
"""
from __future__ import annotations

import base64
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings  # noqa: E402
from app.cultivera_auth import (  # noqa: E402
    CultiveraSessionData,
    _flatten_storage,
    auth_headers,
    decode_jwt_exp,
    is_session_stale,
    pick_first,
    resolve_api_base,
    session_from_local_storage,
    sniff_api_base,
)


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

    return f"{seg({'alg': 'none'})}.{seg(payload)}.sig"


# --- decode_jwt_exp ---------------------------------------------------------
def test_decode_jwt_exp_reads_exp():
    tok = _jwt({"exp": 1_700_000_000, "sub": "u1"})
    assert decode_jwt_exp(tok) == 1_700_000_000.0


def test_decode_jwt_exp_handles_missing_padding():
    # payload chosen so its base64 needs padding; helper must tolerate it
    tok = _jwt({"exp": 1234567890})
    assert decode_jwt_exp(tok) == 1234567890.0


def test_decode_jwt_exp_bad_inputs_return_zero():
    assert decode_jwt_exp("") == 0.0
    assert decode_jwt_exp("not-a-jwt") == 0.0
    assert decode_jwt_exp("only.two") == 0.0
    assert decode_jwt_exp(_jwt({"no_exp": 1})) == 0.0
    assert decode_jwt_exp(_jwt({"exp": "abc"})) == 0.0


# --- pick_first -------------------------------------------------------------
def test_pick_first_exact_then_case_insensitive():
    d = {"accessToken": "A", "other": "x"}
    assert pick_first(d, ("access_token", "accessToken")) == "A"
    # case-insensitive fallback
    assert pick_first({"ACCESSTOKEN": "B"}, ("accessToken",)) == "B"
    assert pick_first({"foo": ""}, ("foo",)) == ""
    assert pick_first("nope", ("x",)) == ""  # type: ignore[arg-type]


# --- _flatten_storage -------------------------------------------------------
def test_flatten_surfaces_nested_json_keys():
    storage = {
        "auth": json.dumps({"refreshToken": "R", "locationId": "L"}),
        "accessToken": "A",
    }
    flat = _flatten_storage(storage)
    assert flat["accessToken"] == "A"
    assert flat["refreshToken"] == "R"
    assert flat["locationId"] == "L"


def test_flatten_top_level_wins_over_nested():
    storage = {
        "blob": json.dumps({"accessToken": "NESTED"}),
        "accessToken": "TOP",
    }
    assert _flatten_storage(storage)["accessToken"] == "TOP"


def test_flatten_ignores_non_json_strings():
    storage = {"junk": "not json {", "accessToken": "A"}
    flat = _flatten_storage(storage)
    assert flat["accessToken"] == "A"
    assert "junk" in flat  # kept as a plain string, just not parsed


# --- session_from_local_storage --------------------------------------------
def test_session_from_local_storage_direct_keys():
    exp = int(time.time()) + 3600
    tok = _jwt({"exp": exp})
    storage = {"accessToken": tok, "refreshToken": "R", "locationId": "L"}
    s = session_from_local_storage(storage, api_base="https://api.example.com/", now=1000.0)
    assert s.access_token == tok
    assert s.refresh_token == "R"
    assert s.location_id == "L"
    assert s.api_base == "https://api.example.com"  # trailing slash stripped
    assert s.captured_at == 1000.0
    assert s.token_exp == float(exp)


def test_session_from_local_storage_nested_and_variants():
    storage = {"session": json.dumps({"access_token": "A2", "refresh_token": "R2"})}
    s = session_from_local_storage(storage, now=5.0)
    assert s.access_token == "A2"
    assert s.refresh_token == "R2"
    assert s.has_token is True


def test_session_no_token_has_token_false():
    s = session_from_local_storage({}, now=5.0)
    assert s.has_token is False


# --- is_session_stale -------------------------------------------------------
def test_stale_when_no_token():
    assert is_session_stale(CultiveraSessionData(), ttl_seconds=3600) is True


def test_stale_uses_jwt_exp_when_present():
    s = CultiveraSessionData(access_token="a", token_exp=2000.0)
    # not yet within skew of exp -> fresh
    assert is_session_stale(s, ttl_seconds=99999, now=1000.0, skew_seconds=60.0) is False
    # within skew window -> stale
    assert is_session_stale(s, ttl_seconds=99999, now=1950.0, skew_seconds=60.0) is True
    # past exp -> stale
    assert is_session_stale(s, ttl_seconds=99999, now=3000.0) is True


def test_stale_falls_back_to_ttl_without_exp():
    s = CultiveraSessionData(access_token="a", token_exp=0.0, captured_at=1000.0)
    assert is_session_stale(s, ttl_seconds=100, now=1050.0) is False  # within TTL
    assert is_session_stale(s, ttl_seconds=100, now=1200.0) is True   # past TTL


# --- auth_headers -----------------------------------------------------------
def test_auth_headers_includes_bearer_and_refresh():
    s = CultiveraSessionData(access_token="A", refresh_token="R")
    h = auth_headers(s)
    assert h["Authorization"] == "Bearer A"
    assert h["x-refresh-token"] == "R"
    assert h["Accept"] == "application/json"
    assert h["Content-Type"] == "application/json"


def test_auth_headers_omit_empty():
    h = auth_headers(CultiveraSessionData())
    assert "Authorization" not in h
    assert "x-refresh-token" not in h


# --- sniff_api_base ---------------------------------------------------------
def test_sniff_prefers_api_host():
    urls = [
        "https://wa.cultiveramarket.com/index.html",
        "https://cdn.somewhere.com/img.png",
        "https://api-p85k4etz.cultiveramarket.com/auth/login",
        "https://api-p85k4etz.cultiveramarket.com/markets/available",
    ]
    got = sniff_api_base(urls, "https://wa.cultiveramarket.com")
    assert got == "https://api-p85k4etz.cultiveramarket.com"


def test_sniff_returns_empty_when_only_site():
    urls = ["https://wa.cultiveramarket.com/a", "https://wa.cultiveramarket.com/b"]
    assert sniff_api_base(urls, "https://wa.cultiveramarket.com") == ""


def test_sniff_most_common_when_no_api_word():
    urls = [
        "https://one.example.com/x",
        "https://two.example.com/y",
        "https://two.example.com/z",
    ]
    assert sniff_api_base(urls, "https://site.example.com") == "https://two.example.com"


# --- resolve_api_base -------------------------------------------------------
def test_resolve_api_base_precedence():
    override = _settings(
        CULTIVERA_API_BASE="https://override.example.com/",
        CULTIVERA_SITE_URL="https://wa.cultiveramarket.com",
    )
    s_with_captured = CultiveraSessionData(api_base="https://captured.example.com")
    # explicit override wins
    assert resolve_api_base(s_with_captured, override) == "https://override.example.com"

    no_override = _settings(CULTIVERA_SITE_URL="https://wa.cultiveramarket.com")
    # captured session base next
    assert resolve_api_base(s_with_captured, no_override) == "https://captured.example.com"
    # then the site origin
    assert resolve_api_base(CultiveraSessionData(), no_override) == "https://wa.cultiveramarket.com"


# --- session file round-trip + JSON coercion --------------------------------
def test_session_json_round_trip():
    s = CultiveraSessionData(
        access_token="A", refresh_token="R", location_id="L",
        api_base="https://api.example.com", captured_at=12.0, token_exp=99.0,
    )
    back = CultiveraSessionData.from_json(s.to_json())
    assert back == s


def test_session_from_json_tolerates_junk():
    back = CultiveraSessionData.from_json(json.dumps({"access_token": None, "extra": 1}))
    assert back.access_token == ""
    assert back.captured_at == 0.0


# --- config derived properties ---------------------------------------------
def test_cultivera_enabled_requires_both_creds():
    assert _settings().cultivera_enabled is False
    assert _settings(CULTIVERA_EMAIL="a@b.com").cultivera_enabled is False
    assert _settings(CULTIVERA_EMAIL="a@b.com", CULTIVERA_PASSWORD="pw").cultivera_enabled is True


def test_cultivera_site_and_api_normalized():
    s = _settings(
        CULTIVERA_SITE_URL="https://wa.cultiveramarket.com/",
        CULTIVERA_API_BASE="https://api.example.com/",
    )
    assert s.cultivera_site == "https://wa.cultiveramarket.com"
    assert s.cultivera_api == "https://api.example.com"


def test_cultivera_session_path_is_absolute(tmp_path):
    s = _settings(CULTIVERA_SESSION_FILE=str(tmp_path / "sub" / "sess.json"))
    p = s.cultivera_session_path
    assert p.is_absolute()
    assert p.parent.exists()  # parent dir ensured

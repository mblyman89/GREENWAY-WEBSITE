"""LL-1 — pure-logic unit tests for the LeafLink cookie session.

NO network, NO browser. These lock the deterministic helpers: Playwright
cookie-capture reduction, session capture, staleness math, Cookie-header and
auth-header building, internal-API URL building, and session file round-trip.

Values here are grounded in the LIVE probe of app.leaflink.com (see
docs/LEAFLINK_PINNED.md): the buyer company slug is `greenway-marijuana`;
the internal API is COOKIE-authenticated (no Bearer token); the session
cookies include the Auth0 session plus mp-csrftoken/mp-django_language.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings  # noqa: E402
from app.leaflink_auth import (  # noqa: E402
    LeaflinkSessionData,
    auth_headers,
    clear_session,
    cookie_header,
    cookies_from_capture,
    internal_api_url,
    is_session_stale,
    load_session,
    save_session,
    session_from_capture,
)


def _settings(**env) -> Settings:
    base = {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "svc",
        "CRAWLER_SHARED_SECRET": "shh",
    }
    base.update(env)
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


# --- cookies_from_capture ----------------------------------------------------
def test_cookies_from_capture_reduces_playwright_list():
    raw = [
        {"name": "mp-csrftoken", "value": "abc", "domain": ".leaflink.com"},
        {"name": "mp-django_language", "value": "en", "domain": ".leaflink.com"},
    ]
    assert cookies_from_capture(raw) == {
        "mp-csrftoken": "abc",
        "mp-django_language": "en",
    }


def test_cookies_from_capture_later_duplicates_win():
    raw = [
        {"name": "sid", "value": "old"},
        {"name": "sid", "value": "new"},
    ]
    assert cookies_from_capture(raw) == {"sid": "new"}


def test_cookies_from_capture_drops_junk():
    raw = [
        {"name": "", "value": "x"},
        {"name": "ok", "value": ""},
        {"name": "good", "value": "1"},
        "not-a-dict",
        {"value": "orphan"},
    ]
    assert cookies_from_capture(raw) == {"good": "1"}


def test_cookies_from_capture_non_list_is_empty():
    assert cookies_from_capture(None) == {}
    assert cookies_from_capture({"name": "x", "value": "y"}) == {}


# --- session_from_capture ----------------------------------------------------
def test_session_from_capture_builds_value_object():
    raw = [{"name": "sid", "value": "s3cr3t"}]
    session = session_from_capture(
        raw_cookies=raw, company_slug="/greenway-marijuana/", now=1_700_000_000.0
    )
    assert session.cookies == {"sid": "s3cr3t"}
    assert session.company_slug == "greenway-marijuana"
    assert session.captured_at == 1_700_000_000.0
    assert session.has_cookies


def test_session_from_capture_tolerates_empty_capture():
    session = session_from_capture(raw_cookies=[], now=5.0)
    assert session.cookies == {}
    assert not session.has_cookies


# --- is_session_stale --------------------------------------------------------
def test_is_session_stale_true_without_cookies():
    assert is_session_stale(LeaflinkSessionData(), ttl_seconds=2_700)


def test_is_session_stale_true_without_captured_at():
    s = LeaflinkSessionData(cookies={"sid": "x"}, captured_at=0.0)
    assert is_session_stale(s, ttl_seconds=2_700)


def test_is_session_stale_false_for_fresh_session():
    s = LeaflinkSessionData(cookies={"sid": "x"}, captured_at=1_000.0)
    assert not is_session_stale(s, ttl_seconds=2_700, now=1_100.0)


def test_is_session_stale_true_when_ttl_exceeded():
    s = LeaflinkSessionData(cookies={"sid": "x"}, captured_at=1_000.0)
    assert is_session_stale(s, ttl_seconds=2_700, now=3_700.0)


# --- cookie_header / auth_headers --------------------------------------------
def test_cookie_header_joins_pairs():
    s = LeaflinkSessionData(cookies={"a": "1", "b": "2"}, captured_at=1.0)
    assert cookie_header(s) == "a=1; b=2"


def test_cookie_header_empty_without_cookies():
    assert cookie_header(LeaflinkSessionData()) == ""


def test_auth_headers_include_cookie_when_present():
    s = LeaflinkSessionData(cookies={"mp-csrftoken": "abc"}, captured_at=1.0)
    headers = auth_headers(s)
    assert headers["Accept"] == "application/json"
    assert headers["Cookie"] == "mp-csrftoken=abc"


def test_auth_headers_omit_cookie_when_absent():
    headers = auth_headers(LeaflinkSessionData())
    assert "Cookie" not in headers
    assert headers["Accept"] == "application/json"


# --- internal_api_url ---------------------------------------------------------
def test_internal_api_url_pinned_shape():
    url = internal_api_url(
        "https://app.leaflink.com", "greenway-marijuana", "shop/products/"
    )
    assert url == "https://app.leaflink.com/api/internal/greenway-marijuana/shop/products/"


def test_internal_api_url_trims_slashes():
    url = internal_api_url(
        "https://app.leaflink.com/", "/greenway-marijuana/", "/brands/11765"
    )
    assert url == "https://app.leaflink.com/api/internal/greenway-marijuana/brands/11765"


# --- session file round-trip ---------------------------------------------------
def test_session_file_round_trip(tmp_path):
    settings = _settings(LEAFLINK_SESSION_FILE=str(tmp_path / "ll.json"))
    original = LeaflinkSessionData(
        cookies={"sid": "x", "mp-csrftoken": "abc"},
        company_slug="greenway-marijuana",
        captured_at=1_700_000_000.0,
    )
    save_session(original, settings)
    loaded = load_session(settings)
    assert loaded == original


def test_load_session_returns_empty_when_missing(tmp_path):
    settings = _settings(LEAFLINK_SESSION_FILE=str(tmp_path / "missing.json"))
    loaded = load_session(settings)
    assert loaded == LeaflinkSessionData()


def test_load_session_tolerates_corrupt_file(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text("{not json", "utf-8")
    settings = _settings(LEAFLINK_SESSION_FILE=str(path))
    assert load_session(settings) == LeaflinkSessionData()


def test_load_session_coerces_junk_fields(tmp_path):
    path = tmp_path / "junk.json"
    path.write_text(
        '{"cookies": {"ok": 1, "": "drop"}, "company_slug": null, "captured_at": "7"}',
        "utf-8",
    )
    settings = _settings(LEAFLINK_SESSION_FILE=str(path))
    loaded = load_session(settings)
    assert loaded.cookies == {"ok": "1"}
    assert loaded.company_slug == ""
    assert loaded.captured_at == 7.0


def test_clear_session_removes_file(tmp_path):
    path = tmp_path / "ll.json"
    settings = _settings(LEAFLINK_SESSION_FILE=str(path))
    save_session(LeaflinkSessionData(cookies={"a": "1"}, captured_at=1.0), settings)
    assert path.exists()
    clear_session(settings)
    assert not path.exists()
    clear_session(settings)  # idempotent


# --- settings gating -----------------------------------------------------------
def test_leaflink_disabled_without_credentials():
    assert not _settings().leaflink_enabled


def test_leaflink_enabled_with_credentials():
    s = _settings(LEAFLINK_EMAIL="a@b.c", LEAFLINK_PASSWORD="p")
    assert s.leaflink_enabled


def test_leaflink_site_and_slug_defaults():
    s = _settings()
    assert s.leaflink_site == "https://app.leaflink.com"
    assert s.leaflink_slug == "greenway-marijuana"

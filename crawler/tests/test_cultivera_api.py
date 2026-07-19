"""CV-2 — unit tests for the polite Cultivera JSON client.

NO real network, NO browser. The pure helpers (delay math, URL joining,
tolerant record extraction, client-side query matching) are tested directly.
The client's request behaviour (auth headers, polite delay, first-candidate
selection, and the single 401 re-login retry) is tested by monkeypatching
`httpx.AsyncClient` with a scripted fake and stubbing the session provider —
following the repo's asyncio.run + monkeypatch style (see test_agegate_overlay).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings  # noqa: E402
from app import cultivera_api as api_mod  # noqa: E402
from app.cultivera_api import (  # noqa: E402
    CultiveraClient,
    extract_records,
    join_url,
    matches_query,
    polite_delay_seconds,
)
from app.cultivera_auth import CultiveraSessionData  # noqa: E402


def _settings(**env) -> Settings:
    base = {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "svc",
        "CRAWLER_SHARED_SECRET": "shh",
        "CULTIVERA_EMAIL": "buyer@greenway.test",
        "CULTIVERA_PASSWORD": "pw",
        "CULTIVERA_API_BASE": "https://api.example.com",
        "CULTIVERA_MIN_DELAY_SECONDS": "0",  # keep tests fast/deterministic
    }
    base.update(env)
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


# --- polite_delay_seconds ---------------------------------------------------
def test_polite_delay_bounds():
    assert polite_delay_seconds(4.0, rand=0.0) == 4.0        # base with 0 jitter
    assert polite_delay_seconds(4.0, rand=1.0) == 6.0        # base + 50%
    assert polite_delay_seconds(4.0, rand=0.5) == 5.0        # base + 25%
    assert polite_delay_seconds(-3.0, rand=1.0) == 0.0       # never negative
    # a real random fraction still stays within [base, base*1.5]
    for _ in range(50):
        d = polite_delay_seconds(2.0)
        assert 2.0 <= d <= 3.0


# --- join_url ---------------------------------------------------------------
def test_join_url_no_double_slash():
    assert join_url("https://api.example.com", "markets/available") == \
        "https://api.example.com/markets/available"
    assert join_url("https://api.example.com/", "/markets/available") == \
        "https://api.example.com/markets/available"
    assert join_url("", "markets/available") == "markets/available"


# --- extract_records --------------------------------------------------------
def test_extract_records_bare_list():
    assert extract_records([{"a": 1}, {"b": 2}, "junk"]) == [{"a": 1}, {"b": 2}]


def test_extract_records_common_envelopes():
    assert extract_records({"data": [{"id": 1}]}) == [{"id": 1}]
    assert extract_records({"items": [{"id": 2}]}) == [{"id": 2}]
    assert extract_records({"listings": [{"id": 3}]}) == [{"id": 3}]


def test_extract_records_nested_one_level():
    assert extract_records({"data": {"items": [{"id": 9}]}}) == [{"id": 9}]


def test_extract_records_single_object_wrapped():
    assert extract_records({"id": 1, "name": "acme"}) == [{"id": 1, "name": "acme"}]


def test_extract_records_empty_or_bad():
    assert extract_records(None) == []
    assert extract_records(42) == []  # type: ignore[arg-type]
    assert extract_records({"data": "not-a-list"}) == [{"data": "not-a-list"}]


# --- matches_query ----------------------------------------------------------
def test_matches_query_across_name_fields():
    rec = {"displayName": "Acme Farms", "slug": "acme-farms"}
    assert matches_query(rec, "acme") is True
    assert matches_query(rec, "FARMS") is True   # case-insensitive
    assert matches_query(rec, "zzz") is False
    assert matches_query(rec, "") is True         # empty matches everything
    assert matches_query({"other": "x"}, "acme") is False


# ---------------------------------------------------------------------------
# Client behaviour with a scripted fake httpx.AsyncClient (no real network)
# ---------------------------------------------------------------------------
class _FakeResp:
    def __init__(self, status: int, payload):
        self.status_code = status
        self._payload = payload

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _FakeAsyncClient:
    """Scripts responses per requested path suffix; records calls + headers."""

    script: dict[str, list[_FakeResp]] = {}
    calls: list[dict] = []

    def __init__(self, **kwargs):
        self._kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url):
        # match by the trailing path so tests don't depend on the base host
        matched_key = None
        for key in _FakeAsyncClient.script:
            if url.endswith(key):
                matched_key = key
                break
        _FakeAsyncClient.calls.append({
            "url": url,
            "headers": dict(self._kwargs.get("headers") or {}),
        })
        if matched_key is None:
            return _FakeResp(404, {"error": "no script"})
        queue = _FakeAsyncClient.script[matched_key]
        # pop the next scripted response, or repeat the last one
        return queue.pop(0) if len(queue) > 1 else queue[0]


def _install_fake_http(monkeypatch, script):
    _FakeAsyncClient.script = script
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(api_mod.httpx, "AsyncClient", _FakeAsyncClient)


def _stub_sessions(monkeypatch, *sessions):
    """Stub get_session to hand out the given sessions in order.

    The FIRST call (force=False, the client's initial _ensure_session) returns
    sessions[0]. Each subsequent force=True call (a 401 re-login) advances to the
    next session. Mirrors how the real get_session hands back a fresh session on
    a forced re-login.
    """
    box = {"i": 0, "sessions": list(sessions), "force_calls": 0}

    async def _fake_get_session(settings=None, *, force=False):
        if force:
            box["force_calls"] += 1
            box["i"] = min(box["i"] + 1, len(box["sessions"]) - 1)
        return box["sessions"][box["i"]]

    monkeypatch.setattr(api_mod, "get_session", _fake_get_session)
    return box


def test_search_markets_attaches_auth_and_returns_records(monkeypatch):
    sess = CultiveraSessionData(access_token="TOKEN123", refresh_token="R1")
    _stub_sessions(monkeypatch, sess)
    _install_fake_http(monkeypatch, {
        "markets/available": [_FakeResp(200, {"data": [
            {"displayName": "Acme Farms", "slug": "acme"},
            {"displayName": "Other Co", "slug": "other"},
        ]})],
    })

    client = CultiveraClient(_settings())
    result = asyncio.run(client.search_markets())
    assert result.ok is True
    assert result.records is not None and len(result.records) == 2
    # auth header actually attached
    assert _FakeAsyncClient.calls[0]["headers"]["Authorization"] == "Bearer TOKEN123"
    assert _FakeAsyncClient.calls[0]["headers"]["x-refresh-token"] == "R1"


def test_search_markets_filters_client_side(monkeypatch):
    _stub_sessions(monkeypatch, CultiveraSessionData(access_token="T"))
    _install_fake_http(monkeypatch, {
        "markets/available": [_FakeResp(200, {"data": [
            {"displayName": "Acme Farms", "slug": "acme"},
            {"displayName": "Other Co", "slug": "other"},
        ]})],
    })
    client = CultiveraClient(_settings())
    result = asyncio.run(client.search_markets("acme"))
    assert result.ok is True
    assert result.records == [{"displayName": "Acme Farms", "slug": "acme"}]


def test_first_ok_falls_through_to_second_candidate(monkeypatch):
    _stub_sessions(monkeypatch, CultiveraSessionData(access_token="T"))
    # first candidate 404s, second answers
    _install_fake_http(monkeypatch, {
        "markets/available": [_FakeResp(404, {"e": 1})],
        "markets/connected": [_FakeResp(200, {"items": [{"slug": "acme"}]})],
    })
    client = CultiveraClient(_settings())
    result = asyncio.run(client.search_markets())
    assert result.ok is True
    assert result.records == [{"slug": "acme"}]


def test_401_triggers_single_relogin_and_retry(monkeypatch):
    stale = CultiveraSessionData(access_token="STALE")
    fresh = CultiveraSessionData(access_token="FRESH")
    box = _stub_sessions(monkeypatch, stale, fresh)
    # first call 401 (stale), retry after re-login 200
    _install_fake_http(monkeypatch, {
        "listings/market/acme": [
            _FakeResp(401, {"e": "expired"}),
            _FakeResp(200, {"listings": [{"id": "x"}]}),
        ],
    })
    client = CultiveraClient(_settings())
    result = asyncio.run(client.fetch_menu(slug="acme"))
    assert result.ok is True
    assert result.records == [{"id": "x"}]
    assert box["force_calls"] == 1  # re-logged in exactly once
    # second request carried the FRESH token
    assert _FakeAsyncClient.calls[-1]["headers"]["Authorization"] == "Bearer FRESH"


def test_persistent_401_does_not_loop_forever(monkeypatch):
    # Every menu candidate path always 401s. The client must re-login at most
    # ONCE per path (never spin), try all candidates, then give up with a 401.
    fresh = CultiveraSessionData(access_token="FRESH")
    box = _stub_sessions(
        monkeypatch,
        CultiveraSessionData(access_token="STALE"), fresh,
    )
    _install_fake_http(monkeypatch, {
        "listings/market/acme": [_FakeResp(401, {"e": "nope"})],
        "public/listings/market/acme": [_FakeResp(401, {"e": "nope"})],
        "markets/acme/listings": [_FakeResp(401, {"e": "nope"})],
    })
    client = CultiveraClient(_settings())
    result = asyncio.run(client.fetch_menu(slug="acme"))
    assert result.ok is False
    assert result.status == 401
    # 3 candidate paths, at most one forced re-login each -> bounded, no loop.
    assert box["force_calls"] <= 3


def test_fetch_menu_requires_identifier(monkeypatch):
    _stub_sessions(monkeypatch, CultiveraSessionData(access_token="T"))
    _install_fake_http(monkeypatch, {})
    client = CultiveraClient(_settings())
    try:
        asyncio.run(client.fetch_menu())
        raised = False
    except api_mod.CultiveraApiError:
        raised = True
    assert raised is True


# --- fetch_product_detail (pinned: GET /listings/{product}/market/{market}) --
def test_fetch_product_detail_hits_pinned_path(monkeypatch):
    _stub_sessions(monkeypatch, CultiveraSessionData(access_token="T"))
    detail = {
        "Id": 4462,
        "Name": "Signature Flower Line",
        "Products": [
            {"Id": 447772, "Name": "Luxor [1g] [Sativa]", "UnitPrice": 4.5,
             "AvailableQuantity": 20, "UnitSize": 1.0},
        ],
    }
    _install_fake_http(monkeypatch, {
        "listings/4462/market/85": [_FakeResp(200, detail)],
    })
    client = CultiveraClient(_settings())
    result = asyncio.run(client.fetch_product_detail(market_id="85", product_id="4462"))
    assert result.ok is True
    assert result.url.endswith("listings/4462/market/85")
    # RAW passthrough — the dollar float is NOT converted here (Next does cents).
    assert result.raw == detail
    # Lone-object tolerant extraction wraps the single record.
    assert result.records == [detail]
    # Auth header attached like every other call.
    assert _FakeAsyncClient.calls[-1]["headers"]["Authorization"] == "Bearer T"


def test_fetch_product_detail_requires_both_ids(monkeypatch):
    _stub_sessions(monkeypatch, CultiveraSessionData(access_token="T"))
    _install_fake_http(monkeypatch, {})
    client = CultiveraClient(_settings())
    for kwargs in (
        {"market_id": "", "product_id": "4462"},
        {"market_id": "85", "product_id": ""},
        {"market_id": " ", "product_id": " "},
    ):
        try:
            asyncio.run(client.fetch_product_detail(**kwargs))
            raised = False
        except api_mod.CultiveraApiError:
            raised = True
        assert raised is True


def test_fetch_product_detail_401_relogin_retry(monkeypatch):
    stale = CultiveraSessionData(access_token="STALE")
    fresh = CultiveraSessionData(access_token="FRESH")
    box = _stub_sessions(monkeypatch, stale, fresh)
    _install_fake_http(monkeypatch, {
        "listings/4462/market/85": [
            _FakeResp(401, {"e": "expired"}),
            _FakeResp(200, {"Id": 4462, "Products": []}),
        ],
    })
    client = CultiveraClient(_settings())
    result = asyncio.run(client.fetch_product_detail(market_id="85", product_id="4462"))
    assert result.ok is True
    assert box["force_calls"] == 1
    assert _FakeAsyncClient.calls[-1]["headers"]["Authorization"] == "Bearer FRESH"

"""CV-3 API smoke tests — the /cultivera/* endpoints over FastAPI TestClient.

NO real network / browser: the CultiveraClient used by the endpoints is
monkeypatched with a fake that returns scripted CultiveraApiResult objects.
Verifies auth (X-Crawler-Secret), the creds-disabled 503 guard, request
validation (menu needs id-or-slug), and the raw-payload passthrough shape the
Next app persists from.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config as config_mod  # noqa: E402
from app import main as main_mod  # noqa: E402
from app.config import Settings  # noqa: E402
from app.cultivera_api import CultiveraApiResult  # noqa: E402
from app.cultivera_auth import CultiveraAuthError  # noqa: E402
from app.main import app  # noqa: E402

SECRET = "test-secret"


def _settings(tmp_path: Path, *, creds: bool = True) -> Settings:
    env = {
        "CRAWLER_SHARED_SECRET": SECRET,
        "CRAWL_CACHE_DIR": str(tmp_path / "cache"),
        "_env_file": None,
    }
    if creds:
        env["CULTIVERA_EMAIL"] = "buyer@greenway.test"
        env["CULTIVERA_PASSWORD"] = "pw"
    return Settings(**env)  # type: ignore[arg-type]


def _route_settings(monkeypatch, settings: Settings) -> None:
    monkeypatch.setattr(config_mod, "get_settings", lambda: settings)
    monkeypatch.setattr(main_mod, "get_settings", lambda: settings)


class _FakeClient:
    """Stands in for CultiveraClient; returns scripted results, records calls."""

    markets_result: CultiveraApiResult | None = None
    menu_result: CultiveraApiResult | None = None
    product_result: CultiveraApiResult | None = None
    raise_on_markets: Exception | None = None
    raise_on_menu: Exception | None = None
    raise_on_product: Exception | None = None
    calls: list[dict] = []

    def __init__(self, settings=None):
        self._settings = settings

    async def search_markets(self, query: str = ""):
        _FakeClient.calls.append({"op": "markets", "query": query})
        if _FakeClient.raise_on_markets:
            raise _FakeClient.raise_on_markets
        return _FakeClient.markets_result

    async def fetch_menu(self, *, market_id: str = "", slug: str = ""):
        _FakeClient.calls.append({"op": "menu", "market_id": market_id, "slug": slug})
        if _FakeClient.raise_on_menu:
            raise _FakeClient.raise_on_menu
        return _FakeClient.menu_result

    async def fetch_product_detail(self, *, market_id: str, product_id: str):
        _FakeClient.calls.append(
            {"op": "product", "market_id": market_id, "product_id": product_id}
        )
        if _FakeClient.raise_on_product:
            raise _FakeClient.raise_on_product
        return _FakeClient.product_result


@pytest.fixture()
def client(tmp_path: Path, monkeypatch) -> TestClient:
    _route_settings(monkeypatch, _settings(tmp_path, creds=True))
    _FakeClient.calls = []
    _FakeClient.raise_on_markets = None
    _FakeClient.raise_on_menu = None
    _FakeClient.raise_on_product = None
    _FakeClient.product_result = CultiveraApiResult(
        ok=True, url="https://api/listings/4462/market/85", status=200,
        raw={"Id": 4462, "Name": "Signature Flower Line",
             "Products": [{"Id": 447772, "UnitPrice": 4.5, "AvailableQuantity": 20}]},
        records=[{"Id": 4462, "Name": "Signature Flower Line",
                  "Products": [{"Id": 447772, "UnitPrice": 4.5, "AvailableQuantity": 20}]}],
    )
    _FakeClient.markets_result = CultiveraApiResult(
        ok=True, url="https://api/markets/available", status=200,
        raw={"data": [{"slug": "acme", "displayName": "Acme Farms"}]},
        records=[{"slug": "acme", "displayName": "Acme Farms"}],
    )
    _FakeClient.menu_result = CultiveraApiResult(
        ok=True, url="https://api/listings/market/acme", status=200,
        raw={"listings": [{"id": "p1", "name": "Blue Dream"}]},
        records=[{"id": "p1", "name": "Blue Dream"}],
    )
    monkeypatch.setattr(main_mod, "CultiveraClient", _FakeClient)
    return TestClient(app)


def _auth() -> dict:
    return {"X-Crawler-Secret": SECRET}


# --- auth -------------------------------------------------------------------
def test_markets_requires_secret(client):
    r = client.post("/cultivera/markets", json={"query": ""})
    assert r.status_code == 401


def test_menu_requires_secret(client):
    r = client.post("/cultivera/menu", json={"slug": "acme"})
    assert r.status_code == 401


# --- creds-disabled guard ---------------------------------------------------
def test_markets_disabled_without_creds(tmp_path, monkeypatch):
    _route_settings(monkeypatch, _settings(tmp_path, creds=False))
    monkeypatch.setattr(main_mod, "CultiveraClient", _FakeClient)
    c = TestClient(app)
    r = c.post("/cultivera/markets", json={"query": ""}, headers=_auth())
    assert r.status_code == 503
    assert "Cultivera disabled" in r.json()["detail"]


def test_menu_disabled_without_creds(tmp_path, monkeypatch):
    _route_settings(monkeypatch, _settings(tmp_path, creds=False))
    monkeypatch.setattr(main_mod, "CultiveraClient", _FakeClient)
    c = TestClient(app)
    r = c.post("/cultivera/menu", json={"slug": "acme"}, headers=_auth())
    assert r.status_code == 503


# --- validation -------------------------------------------------------------
def test_menu_requires_id_or_slug(client):
    r = client.post("/cultivera/menu", json={}, headers=_auth())
    assert r.status_code == 422
    assert "market_id or slug" in r.json()["detail"]


# --- happy paths (raw passthrough) -----------------------------------------
def test_markets_returns_raw_and_records(client):
    r = client.post("/cultivera/markets", json={"query": "acme"}, headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["count"] == 1
    assert body["records"] == [{"slug": "acme", "displayName": "Acme Farms"}]
    assert body["raw"] == {"data": [{"slug": "acme", "displayName": "Acme Farms"}]}
    # the query reached the client
    assert _FakeClient.calls[-1] == {"op": "markets", "query": "acme"}


def test_menu_returns_raw_and_records(client):
    r = client.post("/cultivera/menu", json={"slug": "acme"}, headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["records"] == [{"id": "p1", "name": "Blue Dream"}]
    assert body["raw"] == {"listings": [{"id": "p1", "name": "Blue Dream"}]}
    assert _FakeClient.calls[-1] == {"op": "menu", "market_id": "", "slug": "acme"}


def test_menu_accepts_market_id(client):
    r = client.post("/cultivera/menu", json={"market_id": "m123"}, headers=_auth())
    assert r.status_code == 200
    assert _FakeClient.calls[-1] == {"op": "menu", "market_id": "m123", "slug": ""}


# --- auth failure surfaces as 502 ------------------------------------------
def test_markets_login_failure_is_502(client):
    _FakeClient.raise_on_markets = CultiveraAuthError("bad creds")
    r = client.post("/cultivera/markets", json={}, headers=_auth())
    assert r.status_code == 502
    assert "Cultivera login failed" in r.json()["detail"]


# --- /cultivera/product (per-variant detail) --------------------------------
def test_product_requires_secret(client):
    r = client.post("/cultivera/product", json={"market_id": "85", "product_id": "4462"})
    assert r.status_code == 401


def test_product_disabled_without_creds(tmp_path, monkeypatch):
    _route_settings(monkeypatch, _settings(tmp_path, creds=False))
    monkeypatch.setattr(main_mod, "CultiveraClient", _FakeClient)
    c = TestClient(app)
    r = c.post("/cultivera/product",
               json={"market_id": "85", "product_id": "4462"}, headers=_auth())
    assert r.status_code == 503
    assert "Cultivera disabled" in r.json()["detail"]


def test_product_requires_both_ids(client):
    for body in ({}, {"market_id": "85"}, {"product_id": "4462"},
                 {"market_id": " ", "product_id": "4462"}):
        r = client.post("/cultivera/product", json=body, headers=_auth())
        assert r.status_code == 422
        assert "market_id and product_id" in r.json()["detail"]


def test_product_returns_raw_and_records(client):
    r = client.post("/cultivera/product",
                    json={"market_id": "85", "product_id": "4462"}, headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["count"] == 1
    # RAW passthrough: the dollar float survives untouched (Next converts to cents).
    assert body["raw"]["Products"][0]["UnitPrice"] == 4.5
    assert body["raw"]["Products"][0]["AvailableQuantity"] == 20
    assert _FakeClient.calls[-1] == {"op": "product", "market_id": "85", "product_id": "4462"}


def test_product_login_failure_is_502(client):
    _FakeClient.raise_on_product = CultiveraAuthError("bad creds")
    r = client.post("/cultivera/product",
                    json={"market_id": "85", "product_id": "4462"}, headers=_auth())
    assert r.status_code == 502
    assert "Cultivera login failed" in r.json()["detail"]

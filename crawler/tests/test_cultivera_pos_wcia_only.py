"""D200 - fetch ONLY the vendor WCIA files (COAs) for named Cultivera transfers.

NO network: the fake Cultivera from test_cultivera_pos behind httpx.MockTransport.
Locks: id cleaning, the run touches only login + transfer detail (GET) + load-wcia-json (POST),
never the exports / inventory / sales; a transfer with no vendor file is reported, not fatal;
the endpoint (secret, 422 on bad ids, 409 busy, 503 not configured); a COA-only run is never
resumed as a full harvest.
"""
from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import config as config_mod  # noqa: E402
from app import cultivera_pos as cp  # noqa: E402
from app import cultivera_pos_jobs as jobs  # noqa: E402
from app.config import Settings  # noqa: E402
from test_cultivera_pos import PASSWORD, WCIA_DOC, WCIA_URL, FakeCultivera, _client  # noqa: E402

SECRET = "s3cret"
H = {"X-Crawler-Secret": SECRET}


# ------------------------------------------------------------------ pure


@pytest.mark.parametrize("ids,out", [
    ([11], [11]),
    (["12", 11, 11, "12"], [11, 12]),
    ([1214, 419, 1181], [419, 1181, 1214]),
])
def test_clean_transfer_ids(ids, out):
    assert cp.clean_transfer_ids(ids) == out


@pytest.mark.parametrize("ids", [[], [0], [-1], ["1a"], [1.5], [True], ["../x"], "11", None, [None],
                                 ["1234567890123"], list(range(1, 502))])
def test_clean_transfer_ids_refuses(ids):
    with pytest.raises(ValueError):
        cp.clean_transfer_ids(ids)


# ------------------------------------------------------------------ run


def test_wcia_only_fetches_just_the_named_transfers(tmp_path):
    fake = FakeCultivera()
    client = _client(tmp_path, fake)
    m = cp.run_wcia_only(client, [11, 12])
    state = client.run.read_json("state.json")
    assert state["status"] == "done" and state["kind"] == cp.WCIA_ONLY_KIND
    assert state["transferIds"] == [11, 12]
    assert m["kind"] == cp.WCIA_ONLY_KIND
    # only the login, the two transfer details and the one vendor file were requested
    paths = [str(r.url).replace(cp.Q, "") for r in fake.requests]
    # D202: then the live lot list (paged) and the batch details of the lots on 11 + 12
    head = [cp.LOGIN_URL, "transfers/incoming/11/detail", "transfers/incoming/12/detail",
            "transfers/incoming-load-wcia-json"]
    assert paths[:4] == head
    rest = paths[4:]
    assert set(p for p in rest if not p.startswith("inventories/inventory-batch/")) == {"inventories"}
    assert [p for p in rest if p.startswith("inventories/inventory-batch/")] == [
        f"inventories/inventory-batch/{b}" for b in (101, 102, 103, 104, 105, 107)]
    assert fake.wcia_bodies == [{"Url": WCIA_URL}]
    recs = client.run.read_jsonl("wcia_json.jsonl")
    assert recs == [{"Id": 11, "Url": WCIA_URL, "JsonFile": WCIA_DOC}]
    # 12 has no vendor file: reported in the stage (refused/skipped), never a failed run
    assert state["stages"]["transfer_details"]["status"] == "done"
    assert state["stages"]["wcia_json"]["wanted"] == 1
    client.close()


def test_wcia_only_unknown_transfer_is_reported_not_fatal(tmp_path):
    fake = FakeCultivera()
    orig = fake.handler

    def handler(req):
        if str(req.url).endswith("transfers/incoming/99/detail"):
            fake.requests.append(req)
            return httpx.Response(404)
        return orig(req)

    client2 = cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / "run2"),
                           transport=httpx.MockTransport(handler), pace_seconds=0, sleep=lambda s: None)
    cp.run_wcia_only(client2, [11, 99])
    state = client2.run.read_json("state.json")
    assert state["status"] == "done"
    assert state["stages"]["transfer_details"]["status"] == "partial"
    assert state["stages"]["transfer_details"]["missing"] == [99]
    assert [r["Id"] for r in client2.run.read_jsonl("wcia_json.jsonl")] == [11]
    client2.close()


def test_wcia_only_cancel(tmp_path):
    fake = FakeCultivera()
    client = _client(tmp_path, fake)
    cp.run_wcia_only(client, [11], cancelled=lambda: True)
    assert client.run.read_json("state.json")["status"] == "cancelled"
    assert fake.requests == []
    client.close()


def test_wcia_only_never_writes_outside_cultivera_read_paths(tmp_path):
    fake = FakeCultivera()
    client = _client(tmp_path, fake)
    cp.run_wcia_only(client, [11, 12, 13])
    for r in fake.requests:
        url = str(r.url)
        assert url == cp.LOGIN_URL or url.startswith(cp.Q)
        if r.method == "POST" and url != cp.LOGIN_URL:
            assert url in (cp.Q + "transfers/incoming-load-wcia-json", cp.Q + "inventories")
    client.close()


# ------------------------------------------------------------------ D202: batch COAs


def test_lots_on_transfers_and_batch_ids_pure():
    lots = [{"Id": 3, "Barcode": "B3", "BatchId": 9, "IncomingTransferId": 1181, "UnitCost": 4, "Secret": "x"},
            {"Id": 1, "Barcode": "B1", "BatchId": "7", "IncomingTransferId": "1181"},
            {"Id": 2, "Barcode": "B2", "BatchId": 7, "IncomingTransferId": 1214},
            {"Id": 4, "Barcode": "B4", "BatchId": None, "IncomingTransferId": 1181},
            {"Id": 5, "Barcode": "B5", "BatchId": 8, "IncomingTransferId": 77},
            {"Id": 6, "Barcode": "B6", "BatchId": True, "IncomingTransferId": None},
            {"Id": 7, "Barcode": "B7", "BatchId": "x", "IncomingTransferId": "bad"}]
    mine = cp.lots_on_transfers(lots, [1181, 1214])
    assert [l["Id"] for l in mine] == [1, 2, 3, 4]
    assert set(mine[0]) == set(cp._LOT_SAFE_FIELDS)  # safe fields only (no cost)
    assert cp.batch_ids_of(mine) == [7, 9]
    assert cp.batch_ids_of([{"BatchId": True}, {"BatchId": 0}, {"BatchId": -3}, {}]) == []


def test_batch_coa_summary_pure():
    s = cp.batch_coa_summary([{"HasCoaDocument": True, "ImagePath": "https://files.cultivera.com/a/COA_1.pdf"},
                              {"HasCoaDocument": True, "ImagePath": " "},
                              {"HasCoaDocument": False, "ImagePath": "https://files.cultivera.com/b.pdf"},
                              {}])
    assert s == {"batches": 4, "with_coa_document": 1, "without_coa_document": 3}


def test_wcia_only_reads_batch_coas_when_no_vendor_file(tmp_path):
    """The 2026-11-07 case: no transfer has a vendor file, yet each batch's COA is in Cultivera."""
    fake = FakeCultivera()
    orig = fake.handler

    def handler(req):
        url = str(req.url)
        if url.endswith("/detail"):
            fake.requests.append(req)
            tid = int(url.rsplit("/", 2)[-2])
            return httpx.Response(200, json={"Id": tid, "Details": [], "JsonFile": None, "HasJsonFile": False})
        if "inventory-batch/" in url:
            fake.requests.append(req)
            b = int(url.rsplit("/", 1)[-1])
            return httpx.Response(200, json={"Id": b, "HasCoaDocument": b != 102, "IsCannabis": True,
                                             "ImagePath": f"https://files.cultivera.com/X/Coas/COA_{b}.pdf",
                                             "Lab": "Lab A", "TestingDate": "2026-10-01T00:00:00", "Thc": 1.5})
        return orig(req)

    client = cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / "r"),
                          transport=httpx.MockTransport(handler), pace_seconds=0, sleep=lambda s: None)
    m = cp.run_wcia_only(client, [11])
    st = client.run.read_json("state.json")
    assert st["status"] == "done"
    assert st["stages"]["wcia_json"]["wanted"] == 0
    tl = st["stages"]["transfer_lots"]
    assert tl["status"] == "done" and tl["lots"] == 4 and tl["live_lots"] == 7
    assert tl["transfers_without_live_lots"] == []
    bc = st["stages"]["batch_coas"]
    assert bc["status"] == "done" and bc["wanted"] == 4 and bc["with_coa_document"] == 3
    assert [r["Id"] for r in client.run.read_jsonl("batches.jsonl")] == [101, 102, 103, 104]
    lots = client.run.read_json("transfer_lots.json")["data"]
    assert [l["Barcode"] for l in lots] == ["B1", "B2", "B3", "B4"]
    names = {f["name"] for f in m["files"]}
    assert {"transfer_details.jsonl", "transfer_lots.json", "batches.jsonl"} <= names
    client.close()


def test_wcia_only_batch_error_is_partial_not_failed(tmp_path):
    fake = FakeCultivera()
    orig = fake.handler

    def handler(req):
        if str(req.url).endswith("inventory-batch/103"):
            fake.requests.append(req)
            return httpx.Response(500)
        return orig(req)

    client = cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / "r"),
                          transport=httpx.MockTransport(handler), pace_seconds=0, sleep=lambda s: None)
    cp.run_wcia_only(client, [11])
    st = client.run.read_json("state.json")
    assert st["status"] == "done"
    assert st["stages"]["batch_coas"]["status"] == "partial" and st["stages"]["batch_coas"]["missing"] == [103]
    client.close()


def test_transfer_without_live_lots_is_information(tmp_path):
    fake = FakeCultivera()
    client = _client(tmp_path, fake)
    cp.run_wcia_only(client, [13])
    st = client.run.read_json("state.json")
    assert st["status"] == "done"
    assert st["stages"]["transfer_lots"]["status"] == "done"
    assert st["stages"]["transfer_lots"]["transfers_without_live_lots"] == [13]
    assert st["stages"]["batch_coas"]["wanted"] == 0
    client.close()


def test_transfer_lots_file_is_downloadable():
    assert "transfer_lots.json" in jobs.DOWNLOADABLE and "batches.jsonl" in jobs.DOWNLOADABLE


# ------------------------------------------------------------------ endpoint + jobs


@pytest.fixture()
def env(tmp_path: Path, monkeypatch):
    settings = Settings(CRAWLER_SHARED_SECRET=SECRET, CRAWL_CACHE_DIR=str(tmp_path / "cache"),
                        CULTIVERA_POS_USERNAME="owner@example.com", CULTIVERA_POS_PASSWORD=PASSWORD,
                        _env_file=None)
    import app.main as main_mod

    for mod in (config_mod, main_mod, jobs):
        monkeypatch.setattr(mod, "get_settings", lambda: settings)
    fake = FakeCultivera()
    real = jobs.PosClient

    def factory(*a, **k):
        k.update(transport=httpx.MockTransport(fake.handler), pace_seconds=0, sleep=lambda s: None)
        return real(*a, **k)

    monkeypatch.setattr(jobs, "PosClient", factory)
    orig = jobs.start_wcia_only
    monkeypatch.setattr(jobs, "start_wcia_only", lambda ids, **kw: orig(ids, background=False, **kw))
    jobs._active.update(run_id=None, cancel=None, thread=None)
    return TestClient(main_mod.app), fake, settings


def test_endpoint_requires_secret(env):
    c, _, _ = env
    assert c.post("/cultivera-pos/wcia-runs", json={"transferIds": [11]}).status_code == 401


def test_endpoint_bad_ids_422(env):
    c, fake, _ = env
    assert c.post("/cultivera-pos/wcia-runs", json={"transferIds": []}, headers=H).status_code == 422
    assert c.post("/cultivera-pos/wcia-runs", json={"transferIds": [0]}, headers=H).status_code == 422
    assert c.post("/cultivera-pos/wcia-runs", json={"transferIds": ["x"]}, headers=H).status_code == 422
    assert c.post("/cultivera-pos/wcia-runs", json={}, headers=H).status_code == 422
    assert fake.requests == []


def test_endpoint_not_configured_503(env, monkeypatch):
    c, _, settings = env
    monkeypatch.setattr(settings, "cultivera_pos_password", "")
    r = c.post("/cultivera-pos/wcia-runs", json={"transferIds": [11]}, headers=H)
    assert r.status_code == 503


def test_endpoint_busy_409(env):
    c, _, _ = env
    jobs._active.update(run_id="20261101T130000Z-deadbeef")
    try:
        assert c.post("/cultivera-pos/wcia-runs", json={"transferIds": [11]}, headers=H).status_code == 409
    finally:
        jobs._active.update(run_id=None)


def test_endpoint_run_status_and_file(env):
    c, _, _ = env
    r = c.post("/cultivera-pos/wcia-runs", json={"transferIds": [12, 11]}, headers=H)
    assert r.status_code == 202, r.text
    body = r.json()
    rid = body["runId"]
    assert jobs.valid_run_id(rid) and body["transferIds"] == [11, 12]
    st = c.get(f"/cultivera-pos/runs/{rid}", headers=H).json()
    assert st["state"]["status"] == "done" and st["state"]["kind"] == cp.WCIA_ONLY_KIND
    f = c.get(f"/cultivera-pos/runs/{rid}/files/wcia_json.jsonl", headers=H)
    assert f.status_code == 200 and b"inventory_transfer_items" in f.content
    # a finished OR unfinished COA-only run is never resumed as the full harvest
    assert jobs.resumable_run() is None


def test_unfinished_wcia_only_run_is_not_resumed_by_the_harvest(env, tmp_path):
    _, _, settings = env
    rid = jobs.new_run_id()
    rd = cp.RunDir(jobs.run_dir(rid, settings))
    rd.write_json("state.json", {"kind": cp.WCIA_ONLY_KIND, "status": "failed"})
    assert jobs.resumable_run(settings) is None

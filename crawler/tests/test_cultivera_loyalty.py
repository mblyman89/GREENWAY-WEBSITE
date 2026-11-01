"""CVL - the customer loyalty crawl. NO network: a fake Cultivera behind httpx.MockTransport."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config as config_mod  # noqa: E402
from app import cultivera_loyalty as cl  # noqa: E402
from app import cultivera_loyalty_jobs as jobs  # noqa: E402
from app import cultivera_pos as cp  # noqa: E402
from app import cultivera_pos_jobs as pos_jobs  # noqa: E402
from app.config import Settings  # noqa: E402

PASSWORD = "pw-loyalty"
SECRET = "s3cret"
H = {"X-Crawler-Secret": SECRET}
PII = {"Name": "Jane Doe", "Phone": "5095551212", "Address": "1 Main St", "DateOfBirth": "1980-01-01",
       "Email": "jane@example.com", "DriverLicenseImagePath": "dl/1.png", "MmjidNumber": "M1"}


class FakeLoyalty:
    """5 customers (id 4 deleted from detail -> 400 Customer not found), accrual for ids 2 and 5."""

    def __init__(self, *, page_cap: int = 2, fail_detail: set[int] | None = None):
        self.ids = [1, 2, 3, 4, 5]
        self.balance = {1: 0.0, 2: 509.13, 3: 12.0, 5: 675.6}
        self.applied = {2: 900.0, 5: 2100.0}
        self.accrual = [
            {"Id": 10, "CustomerId": 2, "Type": 5, "Points": 783.0},
            {"Id": 11, "CustomerId": 2, "Type": 1, "Points": 694.23},
            {"Id": 12, "CustomerId": 2, "Type": 3, "Points": 900.0},
            {"Id": 13, "CustomerId": 5, "Type": 1, "Points": 881.1},
            {"Id": 14, "CustomerId": 5, "Type": 7, "Points": -25.0},
            {"Id": 15, "CustomerId": 5, "Type": 99, "Points": 1.0},
        ]
        self.page_cap = page_cap
        self.fail_detail = fail_detail or set()
        self.detail_calls: list[int] = []
        self.bodies: list = []

    def handler(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if url == cp.LOGIN_URL:
            assert json.loads(req.content) == {"username": "owner@example.com", "password": PASSWORD}
            return httpx.Response(200, json={"Token": "tok"})
        assert url.startswith(cp.Q), url
        ep = url[len(cp.Q):]
        if req.method == "POST":
            body = json.loads(req.content)
            self.bodies.append((ep, body))
            skip, take = body["Page"]["Skip"], min(body["Page"]["Take"], self.page_cap)
            if ep == cl.IDS_ENDPOINT:
                rows = [{"Id": i, "LoyaltyPointsApplied": self.applied.get(i, 0.0), **PII} for i in self.ids]
            elif ep == cl.ACCRUAL_ENDPOINT:
                rows = [{**r, "CustomerName": "Jane Doe", "OrderNo": "X1"} for r in self.accrual]
            else:
                return httpx.Response(404)
            return httpx.Response(200, json={"Count": len(rows), "Data": rows[skip:skip + take]})
        if ep.startswith("customers/detail/"):
            i = int(ep.rsplit("/", 1)[1])
            self.detail_calls.append(i)
            if i in self.fail_detail:
                return httpx.Response(404, text="nope")
            if i not in self.balance:
                return httpx.Response(400, json={"ExceptionMessage": "Customer not found"})
            return httpx.Response(200, json={"Id": i, "CustomerNo": f"C{i}", "LoyaltyPoints": self.balance[i],
                                             "LoyaltyPointsApplied": self.applied.get(i, 0.0),
                                             "LoyaltyAmountApplied": 0.0, "Total": 10.0 * i, "NumberOfOrders": i,
                                             "TotalUnits": i, "IsDeleted": False, **PII})
        return httpx.Response(404)


def client_for(tmp_path: Path, fake: FakeLoyalty) -> cp.PosClient:
    return cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / "run"),
                        transport=httpx.MockTransport(fake.handler), pace_seconds=0, sleep=lambda s: None)


def test_full_run_saves_loyalty_without_pii(tmp_path):
    fake = FakeLoyalty()
    c = client_for(tmp_path, fake)
    m = cl.run_loyalty(c)
    assert m["status"] == "done", m
    recs = c.run.read_jsonl(cl.OUT_LOYALTY)
    assert sorted(r["Id"] for r in recs) == [1, 2, 3, 5]
    assert {r["Id"]: r["LoyaltyPoints"] for r in recs}[2] == 509.13
    for r in recs:
        assert set(r) == set(cl.LOYALTY_FIELDS)
    blob = b"".join(f.read_bytes() for f in (tmp_path / "run").iterdir() if f.name != "actions.jsonl")
    for v in ("Jane", "5095551212", "Main St", "1980-01-01", "jane@example.com", "dl/1.png", "X1"):
        assert v.encode() not in blob, v
    assert c.run.read_jsonl(cl.OUT_SKIPPED) == [{"id": 4, "reason": "Customer not found"}]
    names = {f["name"] for f in m["files"]}
    assert {cl.OUT_LOYALTY, cl.OUT_ACCRUAL, cl.OUT_SKIPPED, cl.OUT_IDS} <= names


def test_accrual_sums_by_type_and_unknown_types_counted(tmp_path):
    c = client_for(tmp_path, FakeLoyalty())
    cl.run_loyalty(c)
    a = c.run.read_json(cl.OUT_ACCRUAL)
    assert a["count"] == 6
    assert a["customers"]["2"]["initial"] == 783.0 and a["customers"]["2"]["earnedOrders"] == 694.23
    assert a["customers"]["2"]["applied"] == 900.0 and a["customers"]["2"]["rows"] == 3
    assert a["customers"]["5"]["adjusted"] == -25.0
    assert a["unknownTypes"] == {"99": 1}


def test_active_customers_fetched_first(tmp_path):
    fake = FakeLoyalty()
    cl.run_loyalty(client_for(tmp_path, fake))
    assert fake.detail_calls == [2, 5, 1, 3, 4]


def test_fetch_order_pure():
    assert cl.fetch_order([1, 2, 3, 4], {"3": {}}, {"4": 5.0, "1": 0}) == [3, 4, 1, 2]


def test_resume_never_refetches(tmp_path):
    fake = FakeLoyalty()
    c = client_for(tmp_path, fake)

    def cancel_after_two() -> bool:
        return len(fake.detail_calls) >= 2

    m = cl.run_loyalty(c, cancelled=cancel_after_two)
    assert m["status"] == "cancelled"
    assert fake.detail_calls == [2, 5]
    m2 = cl.run_loyalty(client_for(tmp_path, fake))
    assert m2["status"] == "done"
    assert fake.detail_calls == [2, 5, 1, 3, 4]


def test_budget_pauses_resumably(tmp_path):
    fake = FakeLoyalty()
    t = {"now": 1_000.0}

    def clock() -> float:
        t["now"] += 1.0
        return t["now"]

    m = cl.run_loyalty(client_for(tmp_path, fake), clock=clock, budget_seconds=5)
    assert m["status"] == "paused"
    m2 = cl.run_loyalty(client_for(tmp_path, fake))
    assert m2["status"] == "done"
    assert len(fake.detail_calls) == len(set(fake.detail_calls)) == 5


def test_detail_error_is_failed_and_listed(tmp_path):
    fake = FakeLoyalty(fail_detail={3})
    c = client_for(tmp_path, fake)
    m = cl.run_loyalty(c)
    assert m["status"] == "failed"
    st = c.run.read_json("state.json")
    assert st["stages"]["details"]["missing"] == [3] and "1 customers not fetched" in st["error"]
    fake.fail_detail.clear()
    assert cl.run_loyalty(client_for(tmp_path, fake))["status"] == "done"


def test_count_mismatch_fails(tmp_path):
    fake = FakeLoyalty()
    orig = fake.handler

    def short(req):
        r = orig(req)
        if req.method == "POST" and str(req.url).endswith("/customers"):
            j = r.json()
            return httpx.Response(200, json={"Count": j["Count"] + 1, "Data": j["Data"]})
        return r

    c = cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / "run"),
                     transport=httpx.MockTransport(short), pace_seconds=0, sleep=lambda s: None)
    m = cl.run_loyalty(c)
    assert m["status"] == "failed"


def test_bodies_match_measured_shapes(tmp_path):
    fake = FakeLoyalty()
    cl.run_loyalty(client_for(tmp_path, fake), clock=lambda: 1793518200.0)
    ids_body = next(b for e, b in fake.bodies if e == cl.IDS_ENDPOINT)
    assert ids_body["IsActive"] is False and ids_body["Name"] == "" and ids_body["Page"]["HasSortInfo"] is True
    acc = next(b for e, b in fake.bodies if e == cl.ACCRUAL_ENDPOINT)
    assert acc["DateFrom"] == "01/01/2015" and acc["DateTo"] == "11/01/2026"  # Pacific day
    assert acc["CustomerIds"] == [] and acc["TypeIds"] == []


def test_not_found_only_on_400_message():
    assert cl.is_not_found(400, '{"ExceptionMessage":"Customer not found"}')
    assert not cl.is_not_found(400, "bad request")
    assert not cl.is_not_found(404, "Customer not found")


# --------------------------------------------------------------------------- job layer + endpoints


@pytest.fixture()
def env(tmp_path: Path, monkeypatch):
    settings = Settings(CRAWLER_SHARED_SECRET=SECRET, CRAWL_CACHE_DIR=str(tmp_path / "cache"),
                        CULTIVERA_POS_USERNAME="owner@example.com", CULTIVERA_POS_PASSWORD=PASSWORD,
                        _env_file=None)
    import app.main as main_mod

    for mod in (config_mod, main_mod, jobs, pos_jobs):
        monkeypatch.setattr(mod, "get_settings", lambda: settings)
    fake = FakeLoyalty()
    real = jobs.PosClient

    def factory(*a, **k):
        k.update(transport=httpx.MockTransport(fake.handler), pace_seconds=0, sleep=lambda s: None)
        return real(*a, **k)

    monkeypatch.setattr(jobs, "PosClient", factory)
    orig = jobs.start_or_resume
    monkeypatch.setattr(jobs, "start_or_resume", lambda **kw: orig(background=False, **kw))
    jobs._active.update(run_id=None, cancel=None, thread=None)
    pos_jobs._active.update(run_id=None, cancel=None, thread=None)
    yield TestClient(main_mod.app), fake, settings
    pos_jobs._active.update(run_id=None, cancel=None, thread=None)


def test_endpoints_require_secret(env):
    c, _, _ = env
    assert c.post("/cultivera-loyalty/runs", json={}).status_code == 401
    assert c.get("/cultivera-loyalty/runs").status_code == 401


def test_endpoint_full_run_and_files(env):
    c, _, _ = env
    r = c.post("/cultivera-loyalty/runs", json={}, headers=H)
    assert r.status_code == 202, r.text
    rid = r.json()["runId"]
    st = c.get(f"/cultivera-loyalty/runs/{rid}", headers=H).json()
    assert st["state"]["status"] == "done" and st["state"]["progress"] == {"total": 5, "saved": 4, "skipped": 1}
    f = c.get(f"/cultivera-loyalty/runs/{rid}/files/{cl.OUT_LOYALTY}", headers=H)
    assert f.status_code == 200 and b"509.13" in f.content
    # ids file and the action log are never served; nor is a path
    assert c.get(f"/cultivera-loyalty/runs/{rid}/files/{cl.OUT_IDS}", headers=H).status_code == 404
    assert c.get(f"/cultivera-loyalty/runs/{rid}/files/actions.jsonl", headers=H).status_code == 404
    assert c.get("/cultivera-loyalty/runs/bad-id", headers=H).status_code == 404
    r2 = c.post("/cultivera-loyalty/runs", json={}, headers=H).json()
    assert r2["runId"] != rid and r2["resumed"] is False


def test_busy_when_cutover_harvest_runs(env):
    c, _, _ = env
    pos_jobs._active["run_id"] = "20261101T000000Z-deadbeef"
    assert c.post("/cultivera-loyalty/runs", json={}, headers=H).status_code == 409


def test_cutover_harvest_busy_when_loyalty_runs(env):
    _, _, settings = env
    jobs._active["run_id"] = "20261101T000000Z-deadbeef"
    try:
        with pytest.raises(RuntimeError, match="busy"):
            pos_jobs.start_or_resume(settings=settings, client_factory=lambda rd: None, background=False)
    finally:
        jobs._active["run_id"] = None


def test_not_configured_is_503(env, monkeypatch):
    c, _, settings = env
    monkeypatch.setattr(settings, "cultivera_pos_password", "")
    assert c.post("/cultivera-loyalty/runs", json={}, headers=H).status_code == 503


def test_settings_default_pace_is_slow():
    s = Settings(_env_file=None)
    assert s.cultivera_loyalty_pace_seconds >= 1.0

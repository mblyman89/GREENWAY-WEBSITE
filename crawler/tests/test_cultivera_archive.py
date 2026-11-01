"""CVB-2 - the Cultivera ARCHIVE harvester + /cultivera-archive endpoints. NO network: a generic fake
Cultivera data-api behind httpx.MockTransport.

Locks: all three paging styles, Count verification (a short dataset FAILS, never silently truncates),
keyless one-page refusal, monthly order windows (+ the windows-vs-all-time total check), cycle-count and
valuation-snapshot children, resume after budget pause / cancel / failure without refetching finished
datasets, byte-stable parts with sha256 in the manifest, the read-only guard, and the file allow-list.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config as config_mod  # noqa: E402
from app import cultivera_archive as ca  # noqa: E402
from app import cultivera_archive_jobs as jobs  # noqa: E402
from app import cultivera_pos as cp  # noqa: E402
from app import cultivera_pos_jobs as pos_jobs  # noqa: E402
from app.config import Settings  # noqa: E402

PASSWORD = "pw-ARCHIVE-NEVER-LOGGED-9876"
SECRET = "s3cret"
H = {"X-Crawler-Secret": SECRET}


def _skip_take(body: dict) -> tuple[int, int] | None:
    if isinstance(body.get("Page"), dict):
        return int(body["Page"]["Skip"]), int(body["Page"]["Take"])
    if "Skip" in body:
        return int(body["Skip"]), int(body["Take"])
    if "skip" in body:
        return int(body["skip"]), int(body["take"])
    return None


def _day(mdy: str) -> str:
    m, d, y = mdy.split("/")
    return f"{y}-{m}-{d}"


class FakeArchive:
    """A small store: every PAGED dataset has a few rows, orders span Aug-Oct 2026."""

    def __init__(self, *, page_cap: int = 3, short: str | None = None, keyless_short: str | None = None,
                 fail_endpoint_once: str | None = None):
        self.page_cap = page_cap
        self.short = short  # an endpoint whose Count claims one more row than it serves
        self.keyless_short = keyless_short
        self.fail_once = fail_endpoint_once
        self.requests: list[tuple[str, str, dict]] = []
        self.logins = 0
        self.lists: dict[str, list[dict]] = {}
        for i, p in enumerate(ca.PAGED):
            n = 2 + (i % 5)
            if p.key == "Id":
                self.lists[p.endpoint] = [{"Id": 1000 * (i + 1) + j, "Name": f"{p.name}-{j}"} for j in range(n)]
            else:
                self.lists[p.endpoint] = [{p.key: f"BC{i}-{j}", "Qty": j} for j in range(n)]
        # two cycle counts: CC-1 with 0 items, CC-2 with 3
        self.lists["inventories/cycle-counts"] = [{"Id": 1, "ItemCounts": 0}, {"Id": 2, "ItemCounts": 3}]
        # orders: Aug 30 2026 .. Oct 31 2026 (Pacific wall clock in CreatedAtStr)
        days = ["08/30/2026", "08/31/2026", "09/01/2026", "09/15/2026", "10/01/2026", "10/31/2026", "10/31/2026"]
        self.orders = [{"Id": 500 + k, "CreatedAtStr": f"{d} 10:0{k} AM", "IsCanceled": k == 3}
                       for k, d in enumerate(days)]
        self.snapshots = [{"Id": 1, "Value": "Oct 30 2026"}, {"Id": 2, "Value": "Oct 31 2026"}]

    def endpoint_calls(self, ep: str) -> int:
        return sum(1 for _, u, _ in self.requests if u == cp.Q + ep)

    def _page(self, rows: list[dict], body: dict, count: int | None = None) -> httpx.Response:
        st = _skip_take(body)
        assert st is not None, body
        skip, take = st
        got = rows[skip: skip + min(take, self.page_cap)]
        return httpx.Response(200, json={"Count": len(rows) if count is None else count, "Data": got})

    def handler(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        body = json.loads(req.content) if req.content else {}
        self.requests.append((req.method, url, body))
        if url == cp.LOGIN_URL:
            self.logins += 1
            assert body == {"username": "owner@example.com", "password": PASSWORD}
            return httpx.Response(200, json={"Token": f"tok-{self.logins}"})
        assert req.method == "POST" and url.startswith(cp.Q), url
        assert req.headers["Authorization"].startswith("Bearer tok-")
        ep = url[len(cp.Q):]
        if self.fail_once and ep == self.fail_once:
            self.fail_once = None
            return httpx.Response(400, json={"Message": "boom"})
        if ep.startswith("lookup/inventory/"):
            name = ep.split("/")[-1]
            return httpx.Response(200, json=self.snapshots if name == "valuation-snapshot" else [{"Id": 1, "Name": name}])
        m = re.match(r"^inventories/cycle-count-details/(\d+)$", ep)
        if m:
            hid = int(m.group(1))
            assert body == {"HeaderId": hid, "DetailIds": []}
            n = next(h["ItemCounts"] for h in self.lists["inventories/cycle-counts"] if h["Id"] == hid)
            return httpx.Response(200, json=[{"Id": hid * 100 + j, "Counted": j} for j in range(n)])
        if ep == "orders":
            rows = self.orders
            if body.get("FromDate"):
                f, t = _day(body["FromDate"]), _day(body["ToDate"])
                rows = [o for o in rows if f <= _day(o["CreatedAtStr"][:10]) <= t]
            return self._page(rows, body)
        if ep == "reports/inventory-valuation-snapshot":
            sid = body["InventoryValuationSnapshotId"]
            return self._page([{"Id": sid * 10 + j, "Cost": 1.5} for j in range(4)], body)
        if _skip_take(body) is None:  # a summary object
            return httpx.Response(200, json={"Endpoint": ep, "GrossSales": 12.34})
        if ep in self.lists:
            rows = self.lists[ep]
            return self._page(rows, body, len(rows) + 1 if ep == self.short else None)
        # keyless roll-up reports: one page, no Id
        rows = [{"Day": f"10/{d:02d}/2026", "GrossSales": d * 1.0} for d in range(1, 6)]
        if ep == self.keyless_short:
            return httpx.Response(200, json={"Count": 6, "Data": rows})
        st = _skip_take(body)
        assert st == (0, ca.KEYLESS_MAX), (ep, st)
        return httpx.Response(200, json={"Count": len(rows), "Data": rows})


def _client(tmp_path: Path, fake: FakeArchive, name: str = "run") -> cp.PosClient:
    return cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / name),
                        transport=httpx.MockTransport(fake.handler), pace_seconds=0, sleep=lambda s: None)


def _rows(run: cp.RunDir, state: dict, dataset: str) -> list[dict]:
    return [r for p in state["datasets"][dataset]["parts"] for r in ca.read_gz_jsonl(run.p(p["name"]).read_bytes())]


# --------------------------------------------------------------------------- pure helpers


def test_pure_helpers():
    assert ca.mdy("2026-11-01") == "11/01/2026"
    with pytest.raises(cp.CultiveraPosError):
        ca.mdy("11/01/2026")
    w = ca.month_windows("2024-08-30", "2024-11-01")
    assert w == [("2024-08", "2024-08-01", "2024-08-31"), ("2024-09", "2024-09-01", "2024-09-30"),
                 ("2024-10", "2024-10-01", "2024-10-31"), ("2024-11", "2024-11-01", "2024-11-30")]
    assert ca.month_windows("2024-12-05", "2025-02-01")[-1] == ("2025-02", "2025-02-01", "2025-02-28")
    assert ca.month_windows("2024-02-01", "2024-02-02")[0][2] == "2024-02-29"  # leap year
    assert ca.first_day_from_str("08/30/2024 09:01 AM") == "2024-08-30"
    assert ca.pacific_today(1793491200) == "2026-10-31"  # 2026-11-01T00:00Z -> Oct 31 17:00 PDT
    assert ca.pacific_today(1793518200) == "2026-11-01"  # 2026-11-01T07:30Z -> Nov 1 00:30 PDT
    b = ca.gz_jsonl([{"b": 1, "a": "é"}])
    assert b == ca.gz_jsonl([{"a": "é", "b": 1}])  # byte-stable: sort_keys + mtime 0
    assert ca.read_gz_jsonl(b) == [{"a": "é", "b": 1}]
    assert ca.part_name("sales_lines", 7) == "sales_lines.p0007.jsonl.gz"
    for ok in ("sales_lines.p0001.jsonl.gz", "orders.2026-10.jsonl.gz", "valuation_snapshot_rows.s00126.jsonl.gz",
               "cycle_count_details.cc00002.jsonl.gz", "manifest.json", "state.json", "summaries.json"):
        assert ca.is_archive_file(ok), ok
    for bad in ("actions.jsonl", "../state.json", "x.p1.jsonl.gz", "Sales.p0001.jsonl.gz", "a/b.p0001.jsonl.gz",
                "orders.2026-10.jsonl", "", "state.json.part"):
        assert not ca.is_archive_file(bad), bad


def test_filters_match_the_measured_bodies():
    f = ca.tax_filter("2015-01-01", "2026-11-01")
    # tax-setting-report answers 500 without these four (measured 2026-11-01)
    assert f["BrandIds"] == [] and f["TaxSettingId"] is None and f["TaxSettingDetailIds"] == [] and f["OrderNo"] == ""
    assert f["DateFrom"] == "01/01/2015" and f["DateTo"] == "11/01/2026"
    assert ca.page_style({"X": 1})(10, 5) == {"Page": {"Skip": 10, "Take": 5, "Sort": [{"field": "Id", "dir": "asc"}],
                                                        "HasSortInfo": True}, "X": 1}
    assert ca.kendo_style({}, key="Barcode")(2000, 1000)["page"] == 3
    assert ca.flat_style({}, None)(0, 9) == {"Skip": 0, "Take": 9, "Sort": [], "HasSortInfo": False}


def test_catalogue_invariants():
    names = [p.name for p in ca.PAGED] + [k.name for k in ca.KEYLESS] + ["orders", "sales_velocity",
                                                                          "cycle_count_details",
                                                                          "valuation_snapshot_rows"]
    assert len(names) == len(set(names))
    assert all(re.match(r"^[a-z0-9_]+$", n) for n in names)
    by = {p.name: p for p in ca.PAGED}
    # page sizes that were measured the hard way
    assert by["customers"].take == 1000 and by["shifts"].take == 1000
    assert by["depleted_inventories"].key == "Barcode"
    assert {n for n, p in by.items() if p.pii} == {"employees", "users", "customers", "loyalty_accrual"}
    assert by["vendors"].endpoint == "/vendors"  # the back office's own spelling (measured)
    assert all(p.take <= 5000 for p in ca.PAGED)


# --------------------------------------------------------------------------- the harvester


def test_full_archive_run(tmp_path: Path):
    fake = FakeArchive()
    c = _client(tmp_path, fake)
    m = ca.run_archive(c, clock=lambda: 1793491200.0, date_to="2026-10-31")
    st = c.run.read_json("state.json")
    assert m["status"] == "done", st.get("error")
    assert st["window"] == {"from": "2015-01-01", "to": "2026-10-31"}
    for p in ca.PAGED:
        d = st["datasets"][p.name]
        expected = 2 if p.name == "cycle_counts" else len(fake.lists[p.endpoint])
        assert d["status"] == "done" and d["count"] == d["rows"] == expected, p.name
        assert len(_rows(c.run, st, p.name)) == expected
    # orders: monthly windows Aug..Oct 2026, all 7 orders, the voided one included
    o = st["datasets"]["orders"]
    assert o["firstDay"] == "2026-08-30" and set(o["windows"]) == {"2026-08", "2026-09", "2026-10"}
    assert o["count"] == 7 and sorted(r["Id"] for r in _rows(c.run, st, "orders")) == list(range(500, 507))
    assert any(r["IsCanceled"] for r in _rows(c.run, st, "orders"))
    assert {p["name"] for p in o["parts"]} == {"orders.2026-08.jsonl.gz", "orders.2026-09.jsonl.gz",
                                               "orders.2026-10.jsonl.gz"}
    # children
    assert st["datasets"]["cycle_count_details"]["rows"] == 3
    assert [p["name"] for p in st["datasets"]["cycle_count_details"]["parts"]] == ["cycle_count_details.cc00002.jsonl.gz"]
    v = st["datasets"]["valuation_snapshot_rows"]
    assert v["snapshots"] == 2 and v["rows"] == 8
    assert {r["_snapshotLabel"] for r in _rows(c.run, st, "valuation_snapshot_rows")} == {"Oct 30 2026", "Oct 31 2026"}
    # keyless + sales velocity (latest snapshot id 2)
    assert st["datasets"]["daily_sales"]["count"] == 5 and st["datasets"]["sales_velocity"]["status"] == "done"
    vel = [b for _, u, b in fake.requests if u == cp.Q + "reports/sales-velocity"]
    assert vel and vel[0]["InventoryValuationSnapshotId"] == 2
    # summaries + lookups
    summ = c.run.read_json("summaries.json")
    assert len([k for k in summ if not k.startswith("_")]) == len(ca.SUMMARIES) + 1
    assert set(c.run.read_json("lookups.json")) == set(ca.LOOKUPS)
    # manifest: every file with a correct sha256; nothing outside the allow-list
    names = {f["name"] for f in m["files"]}
    assert "summaries.json" in names and "lookups.json" in names
    for f in m["files"]:
        assert ca.is_archive_file(f["name"]), f["name"]
        assert f["sha256"] == cp.sha256_bytes(c.run.p(f["name"]).read_bytes())
    assert "actions.jsonl" not in names
    # the password never reaches disk
    for f in (tmp_path / "run").iterdir():
        if f.suffix in (".json", ".jsonl"):
            assert PASSWORD not in f.read_text("utf-8")
    # read-only: every request is the login or a data-api POST
    assert all(u == cp.LOGIN_URL or (meth == "POST" and u.startswith(cp.Q)) for meth, u, _ in fake.requests)


def test_vendors_url_is_the_measured_one(tmp_path: Path):
    fake = FakeArchive()
    ca.run_archive(_client(tmp_path, fake), clock=lambda: 1793491200.0, date_to="2026-10-31")
    assert fake.endpoint_calls("/vendors") >= 1  # data-api//vendors, as measured live


def test_short_dataset_fails_loudly_and_resumes(tmp_path: Path):
    fake = FakeArchive(short="samples")
    c = _client(tmp_path, fake)
    m = ca.run_archive(c, clock=lambda: 1793491200.0, date_to="2026-10-31")
    assert m["status"] == "failed"
    st = c.run.read_json("state.json")
    assert "samples" in st["error"] and "unique rows" in st["error"]
    assert st["datasets"]["samples"]["status"] != "done"
    done_before = [p.name for p in ca.PAGED if st["datasets"].get(p.name, {}).get("status") == "done"]
    assert "employees" in done_before
    # fix the server; a rerun resumes - finished datasets are NOT refetched
    fake.short = None
    calls_emp = fake.endpoint_calls("employees")
    m2 = ca.run_archive(c, clock=lambda: 1793491200.0, date_to="2026-11-30")
    assert m2["status"] == "done"
    assert fake.endpoint_calls("employees") == calls_emp
    # the window is fixed by the first attempt
    assert c.run.read_json("state.json")["window"]["to"] == "2026-10-31"


def test_keyless_short_page_is_refused(tmp_path: Path):
    fake = FakeArchive(keyless_short="reports/hourly-sales")
    c = _client(tmp_path, fake)
    m = ca.run_archive(c, clock=lambda: 1793491200.0, date_to="2026-10-31")
    assert m["status"] == "failed" and "hourly-sales" in c.run.read_json("state.json")["error"]


def test_budget_pauses_then_resumes(tmp_path: Path):
    fake = FakeArchive()
    c = _client(tmp_path, fake)
    t = {"now": 1793491200.0}

    def clock() -> float:
        t["now"] += 1.0  # every tick costs a second
        return t["now"]

    m = ca.run_archive(c, clock=clock, budget_seconds=40, date_to="2026-10-31")
    assert m["status"] == "paused"
    assert "Resume" in c.run.read_json("state.json")["error"]
    m2 = ca.run_archive(c, clock=clock, budget_seconds=100_000)
    assert m2["status"] == "done"
    st = c.run.read_json("state.json")
    assert st["datasets"]["orders"]["count"] == 7


def test_cancel_is_recorded(tmp_path: Path):
    fake = FakeArchive()
    c = _client(tmp_path, fake)
    n = {"i": 0}

    def cancelled() -> bool:
        n["i"] += 1
        return n["i"] > 5

    m = ca.run_archive(c, cancelled=cancelled, clock=lambda: 1793491200.0, date_to="2026-10-31")
    assert m["status"] == "cancelled"


def test_page_resume_does_not_duplicate(tmp_path: Path, monkeypatch):
    """A crash after some parts were written: resume skips saved rows and never duplicates a key."""
    monkeypatch.setattr(ca, "PART_ROWS", 2)
    fake = FakeArchive(page_cap=1)
    big = [{"Id": i} for i in range(1, 8)]
    fake.lists["reports/daily-sales-detail"] = big
    c = _client(tmp_path, fake)
    a = ca.Archive(c, cancelled=lambda: False, clock=lambda: 0.0, budget_seconds=1e9, date_to="2026-10-31")
    body = ca.page_style(ca.sales_filter("2015-01-01", "2026-10-31"))
    calls = {"n": 0}
    real = a.post

    def flaky(ep, b):
        calls["n"] += 1
        if calls["n"] == 5:
            raise cp.CultiveraPosError("HTTP 504")
        return real(ep, b)

    a.post = flaky
    with pytest.raises(cp.CultiveraPosError):
        a.page_into_parts("sales_lines", "reports/daily-sales-detail", body, 1, "Id", lambda n: ca.part_name("sales_lines", n))
    assert a.ds("sales_lines")["rows"] == 4  # two full parts written before the crash
    a2 = ca.Archive(c, cancelled=lambda: False, clock=lambda: 0.0, budget_seconds=1e9, date_to="2026-10-31")
    assert a2.page_into_parts("sales_lines", "reports/daily-sales-detail", body, 1, "Id",
                              lambda n: ca.part_name("sales_lines", n)) == 7
    ids = [r["Id"] for p in a2.ds("sales_lines")["parts"] for r in ca.read_gz_jsonl(c.run.p(p["name"]).read_bytes())]
    assert sorted(ids) == list(range(1, 8)) and len(ids) == len(set(ids))


def test_cycle_count_item_mismatch_fails(tmp_path: Path):
    fake = FakeArchive()
    fake.lists["inventories/cycle-counts"][1]["ItemCounts"] = 3
    orig = fake.handler

    def handler(req):
        if str(req.url).endswith("cycle-count-details/2"):
            fake.requests.append(("POST", str(req.url), {}))
            return httpx.Response(200, json=[{"Id": 1}])
        return orig(req)

    c = cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / "r"),
                     transport=httpx.MockTransport(handler), pace_seconds=0, sleep=lambda s: None)
    m = ca.run_archive(c, clock=lambda: 1793491200.0, date_to="2026-10-31")
    assert m["status"] == "failed" and "header says 3 items" in c.run.read_json("state.json")["error"]


def test_guard_refuses_non_data_api(tmp_path: Path):
    fake = FakeArchive()
    a = ca.Archive(_client(tmp_path, fake), cancelled=lambda: False, clock=lambda: 0.0, budget_seconds=1e9,
                   date_to="2026-10-31")
    with pytest.raises(cp.CultiveraPosRefused):
        a.post("../api/users/delete", {})
    with pytest.raises(cp.CultiveraPosRefused):
        a.c.call("DELETE", cp.Q + "orders/1")


# --------------------------------------------------------------------------- jobs + endpoints


@pytest.fixture()
def env(tmp_path: Path, monkeypatch):
    settings = Settings(CRAWLER_SHARED_SECRET=SECRET, CRAWL_CACHE_DIR=str(tmp_path / "cache"),
                        CULTIVERA_POS_USERNAME="owner@example.com", CULTIVERA_POS_PASSWORD=PASSWORD,
                        _env_file=None)
    import app.main as main_mod

    for mod in (config_mod, main_mod, jobs, pos_jobs):
        monkeypatch.setattr(mod, "get_settings", lambda: settings)
    fake = FakeArchive()
    real = jobs.PosClient

    def factory(*a, **k):
        k.update(transport=httpx.MockTransport(fake.handler), pace_seconds=0, sleep=lambda s: None)
        return real(*a, **k)

    monkeypatch.setattr(jobs, "PosClient", factory)
    orig = jobs.start_or_resume
    monkeypatch.setattr(jobs, "start_or_resume", lambda **kw: orig(background=False, **kw))
    jobs._active.update(run_id=None, cancel=None, thread=None)
    pos_jobs._active.update(run_id=None, cancel=None, thread=None)
    return TestClient(main_mod.app), fake, settings


def test_endpoints_require_secret(env):
    c, _, _ = env
    assert c.post("/cultivera-archive/runs", json={}).status_code == 401
    assert c.get("/cultivera-archive/runs").status_code == 401
    assert c.get("/cultivera-archive/runs/20261101T130000Z-deadbeef/files/state.json",
                 headers={"X-Crawler-Secret": "no"}).status_code == 401


def test_not_configured_is_503(env, monkeypatch):
    c, _, settings = env
    monkeypatch.setattr(settings, "cultivera_pos_password", "")
    r = c.post("/cultivera-archive/runs", json={}, headers=H)
    assert r.status_code == 503 and "CULTIVERA_POS_USERNAME" in r.json()["detail"]


def test_bad_date_is_422(env):
    c, _, _ = env
    assert c.post("/cultivera-archive/runs", json={"dateTo": "11/01/2026"}, headers=H).status_code == 422


def test_busy_when_cutover_harvest_runs(env):
    c, _, _ = env
    pos_jobs._active.update(run_id="20261101T130000Z-deadbeef")
    try:
        assert c.post("/cultivera-archive/runs", json={}, headers=H).status_code == 409
    finally:
        pos_jobs._active.update(run_id=None)


def test_full_run_status_files(env):
    c, _, _ = env
    r = c.post("/cultivera-archive/runs", json={"dateTo": "2026-10-31"}, headers=H)
    assert r.status_code == 202, r.text
    rid = r.json()["runId"]
    st = c.get(f"/cultivera-archive/runs/{rid}", headers=H).json()
    assert st["state"]["status"] == "done", st["state"].get("error")
    assert st["manifest"]["kind"] == "cultivera_archive"
    f = c.get(f"/cultivera-archive/runs/{rid}/files/orders.2026-10.jsonl.gz", headers=H)
    assert f.status_code == 200 and len(ca.read_gz_jsonl(f.content)) == 3
    assert c.get(f"/cultivera-archive/runs/{rid}/files/actions.jsonl", headers=H).status_code == 404
    assert c.get(f"/cultivera-archive/runs/{rid}/files/..%2Fstate.json", headers=H).status_code == 404
    assert c.get("/cultivera-archive/runs/not-a-run/files/state.json", headers=H).status_code == 404
    assert c.get("/cultivera-archive/runs", headers=H).json()["runs"] == [rid]
    # a finished archive is never reopened
    r2 = c.post("/cultivera-archive/runs", json={}, headers=H).json()
    assert r2["runId"] != rid and r2["resumed"] is False
    assert c.post(f"/cultivera-archive/runs/{rid}/cancel", headers=H).json()["cancelRequested"] is False


def test_failed_run_resumes(env):
    c, fake, _ = env
    fake.fail_once = "samples"
    r = c.post("/cultivera-archive/runs", json={"dateTo": "2026-10-31"}, headers=H).json()
    assert c.get(f"/cultivera-archive/runs/{r['runId']}", headers=H).json()["state"]["status"] == "failed"
    r2 = c.post("/cultivera-archive/runs", json={}, headers=H).json()
    assert r2 == {"ok": True, "runId": r["runId"], "resumed": True}
    assert c.get(f"/cultivera-archive/runs/{r['runId']}", headers=H).json()["state"]["status"] == "done"

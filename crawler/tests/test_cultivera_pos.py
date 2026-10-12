"""R50 S9 — Cultivera POS Phase A harvester. NO network: a fake Cultivera behind httpx.MockTransport.

Locks: the read-only guard, CDN guard, secret redaction, Kendo/flat paging with Count verification,
referenced-only transfer details, list-only batches, resume after a crash, cancel, 401 re-login,
429 back-off, export xlsx validation, provenance manifest, and parity of the export bodies with the
TypeScript core (src/lib/pos/cultivera-fetch-core.ts).
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import cultivera_pos as cp  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
PASSWORD = "pw-NEVER-LOGGED-1234"
TOKEN = "tok-NEVER-LOGGED-abcd"


def _xlsx(header: list[str], rows: list[list]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(header)
    for r in rows:
        ws.append(r)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


class FakeCultivera:
    """Minimal Cultivera POS: 7 lots (lot 7 missing from the export), 3 transfers (1 unreferenced)."""

    def __init__(self, *, page_cap: int = 3, fail_detail_once: int | None = None,
                 expire_token_after: int | None = None, throttle_first: bool = False):
        self.lots = [{"Id": i, "Barcode": f"B{i}", "BatchId": 100 + i,
                      "IncomingTransferId": (11 if i <= 4 else 12) if i != 6 else None} for i in range(1, 8)]
        self.transfers = [{"Id": t} for t in (11, 12, 13)]
        self.page_cap = page_cap
        self.fail_detail_once = fail_detail_once
        self.expire_after = expire_token_after
        self.throttle_first = throttle_first
        self.requests: list[httpx.Request] = []
        self.logins = 0
        self.data_calls = 0
        self.token = TOKEN

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        url = str(req.url)
        if url == cp.LOGIN_URL:
            self.logins += 1
            body = json.loads(req.content)
            assert body == {"username": "owner@example.com", "password": PASSWORD}
            self.token = f"{TOKEN}-{self.logins}"
            return httpx.Response(200, json={"Token": self.token})
        if url.startswith("https://cdn-ca1.cultivera.com/"):
            name = url.rsplit("/", 1)[1]
            if name == "inv.xlsx":
                return httpx.Response(200, content=_xlsx(["Barcode", "Product"],
                                                        [[f"B{i}", f"P{i}"] for i in range(1, 7)]))
            if name == "prod.xlsx":
                return httpx.Response(200, content=_xlsx(["Product"], [["P1"]]))
            if name == "notxlsx":
                return httpx.Response(200, content=b"<html>")
            return httpx.Response(404)
        assert url.startswith(cp.Q), url
        self.data_calls += 1
        if self.throttle_first and self.data_calls == 1:
            return httpx.Response(429)
        if req.headers.get("authorization") != f"Bearer {self.token}" or (
                self.expire_after is not None and self.data_calls == self.expire_after):
            self.token = "expired"
            return httpx.Response(401)
        for h, v in cp.DATA_HEADERS.items():
            assert req.headers.get(h) == v
        path = url[len(cp.Q):]
        body = json.loads(req.content) if req.content else None
        if path == "inventories/export-inventories-to-excel":
            assert body == cp.INVENTORY_EXPORT_FILTER
            return httpx.Response(200, json={"Name": "Inventories.xlsx", "Url": "https://cdn-ca1.cultivera.com/x/inv.xlsx"})
        if path == "products/export-products":
            assert body == cp.PRODUCT_EXPORT_FILTER
            return httpx.Response(200, json={"Name": "Products.xlsx", "Url": "https://cdn-ca1.cultivera.com/x/prod.xlsx"})
        if path == "inventories":
            s = body["skip"]
            return httpx.Response(200, json={"Count": len(self.lots), "Data": self.lots[s:s + min(body["take"], self.page_cap)]})
        if path == "transfers/incoming":
            s = body["Skip"]
            return httpx.Response(200, json={"Count": len(self.transfers), "Data": self.transfers[s:s + min(body["Take"], self.page_cap)]})
        m = re.fullmatch(r"transfers/incoming/(\d+)/detail", path)
        if m:
            tid = int(m.group(1))
            if self.fail_detail_once == tid:
                self.fail_detail_once = None
                raise httpx.ConnectError("boom")
            return httpx.Response(200, json={"Id": tid, "Details": []})
        m = re.fullmatch(r"inventories/inventory-batch/(\d+)", path)
        if m:
            return httpx.Response(200, json={"Id": int(m.group(1)), "ReceivedDate": "2026-10-01T15:04:05Z"})
        return httpx.Response(404)


def _client(tmp_path: Path, fake: FakeCultivera) -> cp.PosClient:
    return cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / "run"),
                        transport=httpx.MockTransport(fake.handler), pace_seconds=0, sleep=lambda s: None)


# ------------------------------------------------------------------ guard


@pytest.mark.parametrize("method,url", [
    ("PUT", cp.Q + "inventories"),
    ("DELETE", cp.Q + "inventories/1"),
    ("PATCH", cp.Q + "inventories"),
    ("POST", cp.API + "inventories/split"),
    ("POST", cp.API + "inventories/upload-coa-document"),
    ("POST", cp.API + "transfers/upload-inbound-transfer-json"),
    ("GET", cp.LOGIN_URL),
    ("POST", "https://evil.example/data-api/inventories"),
    ("POST", "https://api-wa.cultiverapos.com.evil.example/data-api/x"),
    ("POST", cp.Q + "../api/inventories/split"),
    ("GET", "http://api-wa.cultiverapos.com/data-api/inventories"),
])
def test_guard_refuses_writes_and_foreign_hosts(method, url):
    with pytest.raises(cp.CultiveraPosRefused):
        cp.guard_request(method, url)


def test_guard_allows_only_reads_and_login():
    assert cp.guard_request("POST", cp.LOGIN_URL) == "login"
    assert cp.guard_request("get", cp.Q + "transfers/incoming/5/detail") == "data"
    assert cp.guard_request("POST", cp.Q + "inventories") == "data"


@pytest.mark.parametrize("url", [
    "http://cdn-ca1.cultivera.com/a.xlsx",
    "https://cdn-ca1.cultivera.com.evil.io/a.xlsx",
    "https://evil.io/cdn-ca1.cultivera.com/a.xlsx",
    "https://user:pw@cdn-ca1.cultivera.com/a.xlsx",
    "https://api-wa.cultiverapos.com/a.xlsx",
])
def test_cdn_guard_refuses(url):
    with pytest.raises(cp.CultiveraPosRefused):
        cp.guard_cdn_url(url)


def test_cdn_guard_allows_cultivera_cdn():
    assert cp.guard_cdn_url("https://cdn-ca1.cultivera.com/f/x.xlsx")
    assert cp.guard_cdn_url("https://cdn.cultivera.com/f/x.xlsx")


def test_client_never_sends_a_refused_call(tmp_path):
    fake = FakeCultivera()
    c = _client(tmp_path, fake)
    with pytest.raises(cp.CultiveraPosRefused):
        c.call("POST", cp.API + "inventories/split", {})
    assert fake.requests == []  # refused before login, before any byte left


# ------------------------------------------------------------------ redaction / pure


def test_redact_deep():
    r = cp.redact({"password": "x", "a": [{"Token": "y", "ok": 1}], "Authorization": "Bearer z", "n": {"apiSecret": 1}})
    assert r == {"password": "[redacted]", "a": [{"Token": "[redacted]", "ok": 1}],
                 "Authorization": "[redacted]", "n": {"apiSecret": "[redacted]"}}


def test_parse_page_and_export_reject_garbage():
    with pytest.raises(cp.CultiveraPosError):
        cp.parse_page({"Data": []})
    with pytest.raises(cp.CultiveraPosError):
        cp.parse_page({"Count": "3", "Data": []})
    with pytest.raises(cp.CultiveraPosError):
        cp.parse_export_response({"Name": "x"})
    with pytest.raises(cp.CultiveraPosRefused):
        cp.parse_export_response({"Name": "x", "Url": "https://evil.io/x.xlsx"})


def test_referenced_and_list_only():
    lots = [{"Barcode": "A", "BatchId": 1, "IncomingTransferId": 9}, {"Barcode": "B", "BatchId": 2, "IncomingTransferId": None},
            {"Barcode": "C", "BatchId": 3, "IncomingTransferId": 9}, {"Barcode": "D", "BatchId": None, "IncomingTransferId": 0}]
    assert cp.referenced_transfer_ids(lots) == [9]
    assert cp.list_only_batch_ids(lots, {"A"}) == [2, 3]


def test_kendo_and_transfer_bodies():
    assert cp.kendo_body(1000, 500, "Id") == {"take": 500, "skip": 1000, "page": 3, "pageSize": 500,
                                             "sort": [{"field": "Id", "dir": "asc"}]}
    b = cp.transfers_body(0, 500)
    assert b["Skip"] == 0 and b["Take"] == 500 and b["HasSortInfo"] is True and b["VendorIds"] == []


def test_run_dir_rejects_path_escape(tmp_path):
    rd = cp.RunDir(tmp_path)
    for bad in ("../x", "a/b", ".hidden"):
        with pytest.raises(ValueError):
            rd.p(bad)


def test_export_filters_match_typescript_core():
    ts = (REPO / "src/lib/pos/cultivera-fetch-core.ts").read_text("utf-8")

    def ts_obj(name: str) -> dict:
        m = re.search(name + r" = Object\.freeze\(\{(.*?)\}\);", ts, re.S)
        assert m, name
        out = {}
        for k, v in re.findall(r"(\w+):\s*(\"\"|\[\]|true|false)", m.group(1)):
            out[k] = {"\"\"": "", "[]": [], "true": True, "false": False}[v]
        return out

    assert ts_obj("INVENTORY_EXPORT_FILTER") == cp.INVENTORY_EXPORT_FILTER
    assert ts_obj("PRODUCT_EXPORT_FILTER") == cp.PRODUCT_EXPORT_FILTER


# ------------------------------------------------------------------ full run


def test_phase_a_end_to_end(tmp_path):
    fake = FakeCultivera()
    c = _client(tmp_path, fake)
    m = cp.run_phase_a(c)
    st = c.run.read_json("state.json")
    assert st["status"] == "done", st
    assert [s for s in cp.STAGES_PHASE_A if st["stages"][s]["status"] != "done"] == []
    inv = c.run.read_json("inventories.json")["data"]
    assert len(inv) == 7  # paged 3+3+1 and Count-verified
    assert len(c.run.read_json("transfers.json")["data"]) == 3
    # only transfers a live lot references (11, 12) — never the unreferenced 13
    assert sorted(r["Id"] for r in c.run.read_jsonl("transfer_details.jsonl")) == [11, 12]
    # only the lot the export dropped (B7 -> batch 107)
    assert [r["Id"] for r in c.run.read_jsonl("batches.jsonl")] == [107]
    assert st["stages"]["batches"]["list_only_lots"] == 1
    names = {f["name"] for f in m["files"]}
    assert {"export_inventories.xlsx", "export_products.xlsx", "inventories.json", "transfers.json",
            "transfer_details.jsonl", "batches.jsonl"} <= names
    for f in m["files"]:
        assert re.fullmatch(r"[0-9a-f]{64}", f["sha256"]) and f["bytes"] > 0
    # every request was a guarded read or the login
    for r in fake.requests:
        u = str(r.url)
        assert u == cp.LOGIN_URL or u.startswith(cp.Q) or u.startswith("https://cdn-ca1.cultivera.com/")
        assert r.method in ("GET", "POST")
    assert fake.logins == 1


def test_no_secret_reaches_disk(tmp_path):
    fake = FakeCultivera()
    c = _client(tmp_path, fake)
    cp.run_phase_a(c)
    for f in (tmp_path / "run").iterdir():
        b = f.read_bytes()
        assert PASSWORD.encode() not in b, f.name
        assert TOKEN.encode() not in b, f.name


def test_resume_after_crash_skips_done_work(tmp_path):
    fake = FakeCultivera(fail_detail_once=12)
    c = _client(tmp_path, fake)
    c.retries = 1  # the connect error exhausts retries -> stage fails
    st = cp.run_phase_a(c)
    assert st["status"] == "failed"
    state = c.run.read_json("state.json")
    assert state["stages"]["export_products"]["status"] == "done"
    assert [r["Id"] for r in c.run.read_jsonl("transfer_details.jsonl")] == [11]
    before = len(fake.requests)
    c2 = _client(tmp_path, fake)
    st2 = cp.run_phase_a(c2)
    assert st2["status"] == "done"
    redo = [str(r.url) for r in fake.requests[before:]]
    assert not any("export" in u for u in redo)  # finished stages not redone
    assert sum("/detail" in u for u in redo) == 1  # only transfer 12
    assert sorted(r["Id"] for r in c2.run.read_jsonl("transfer_details.jsonl")) == [11, 12]


def test_torn_jsonl_line_is_refetched(tmp_path):
    fake = FakeCultivera()
    c = _client(tmp_path, fake)
    cp.run_phase_a(c)
    p = c.run.p("transfer_details.jsonl")
    lines = p.read_text().splitlines()
    p.write_text(lines[0] + "\n" + lines[1][:5])  # crash mid-write
    st = c.run.read_json("state.json")
    st["stages"]["transfer_details"]["status"] = "running"
    c.run.write_json("state.json", st)
    assert cp.run_phase_a(c)["status"] == "done"
    assert sorted(r["Id"] for r in c.run.read_jsonl("transfer_details.jsonl")) == [11, 12]


def test_cancel_stops_between_calls(tmp_path):
    fake = FakeCultivera()
    c = _client(tmp_path, fake)
    flag = {"n": 0}

    def cancelled():
        flag["n"] += 1
        return flag["n"] > 3

    m = cp.run_phase_a(c, cancelled=cancelled)
    assert m["status"] == "cancelled"
    assert c.run.read_json("state.json")["stages"].get("transfer_details") is None


def test_relogin_on_401(tmp_path):
    fake = FakeCultivera(expire_token_after=3)
    c = _client(tmp_path, fake)
    assert cp.run_phase_a(c)["status"] == "done"
    assert fake.logins == 2


def test_backoff_on_429(tmp_path):
    fake = FakeCultivera(throttle_first=True)
    sleeps: list[float] = []
    c = _client(tmp_path, fake)
    c.sleep = sleeps.append
    assert cp.run_phase_a(c)["status"] == "done"
    assert 5.0 in sleeps


def test_count_mismatch_fails_loudly(tmp_path):
    fake = FakeCultivera()
    fake.lots.append(dict(fake.lots[0]))  # duplicate Id -> unique 7 vs Count 8
    c = _client(tmp_path, fake)
    m = cp.run_phase_a(c)
    assert m["status"] == "failed"
    assert "Count 8" in c.run.read_json("state.json")["error"]


def test_non_xlsx_export_is_refused(tmp_path, monkeypatch):
    fake = FakeCultivera()
    orig = fake.handler

    def h(req):
        if str(req.url).endswith("export-products"):
            fake.requests.append(req)
            return httpx.Response(200, json={"Name": "p", "Url": "https://cdn-ca1.cultivera.com/x/notxlsx"})
        return orig(req)

    c = cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / "run"),
                     transport=httpx.MockTransport(h), pace_seconds=0, sleep=lambda s: None)
    m = cp.run_phase_a(c)
    assert m["status"] == "failed"
    assert "not an xlsx" in c.run.read_json("state.json")["error"]
    assert not c.run.p("export_products.xlsx").exists()


def test_bad_login_fails_without_retrying_data(tmp_path):
    def h(req):
        return httpx.Response(401) if str(req.url) == cp.LOGIN_URL else httpx.Response(500)

    c = cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / "run"),
                     transport=httpx.MockTransport(h), pace_seconds=0, sleep=lambda s: None)
    m = cp.run_phase_a(c)
    assert m["status"] == "failed"
    assert c.calls == 1


def test_missing_credentials(tmp_path):
    c = cp.PosClient(username="", password="", run=cp.RunDir(tmp_path / "run"),
                     transport=httpx.MockTransport(lambda r: httpx.Response(500)), pace_seconds=0)
    assert cp.run_phase_a(c)["status"] == "failed"
    assert c.calls == 0


def test_budget_flag(tmp_path):
    fake = FakeCultivera()
    c = _client(tmp_path, fake)
    t = iter(range(0, 10_000, 100))
    m = cp.run_phase_a(c, clock=lambda: float(next(t)), budget_seconds=60)
    assert c.run.read_json("state.json")["withinBudget"] is False
    assert m["status"] == "done"


# ------------------------------------------------------------------ hardening (from mutation survivors)


def _with(tmp_path, fake, override):
    orig = fake.handler

    def h(req):
        r = override(req)
        if r is not None:
            fake.requests.append(req)
            return r
        return orig(req)

    return cp.PosClient(username="owner@example.com", password=PASSWORD, run=cp.RunDir(tmp_path / "run"),
                        transport=httpx.MockTransport(h), pace_seconds=0, sleep=lambda s: None)


def test_budget_within(tmp_path):
    c = _client(tmp_path, FakeCultivera())
    cp.run_phase_a(c, clock=lambda: 1000.0, budget_seconds=60)
    assert c.run.read_json("state.json")["withinBudget"] is True


def test_action_log_redacts_even_if_a_caller_passes_secrets(tmp_path):
    c = _client(tmp_path, FakeCultivera())
    c.log(action="x", password=PASSWORD, body={"Token": TOKEN})
    raw = c.run.p("actions.jsonl").read_text()
    assert PASSWORD not in raw and TOKEN not in raw and "[redacted]" in raw


def test_login_http_error_message(tmp_path):
    c = _with(tmp_path, FakeCultivera(), lambda r: httpx.Response(403, json={"Token": "t"}) if str(r.url) == cp.LOGIN_URL else None)
    cp.run_phase_a(c)
    assert "login failed: HTTP 403" in c.run.read_json("state.json")["error"]


def test_export_http_404_is_a_recorded_failure(tmp_path):
    c = _with(tmp_path, FakeCultivera(), lambda r: httpx.Response(404, text="nope") if str(r.url).endswith("export-inventories-to-excel") else None)
    m = cp.run_phase_a(c)
    assert m["status"] == "failed"
    assert "HTTP 404" in c.run.read_json("state.json")["error"]


def test_non_json_is_a_recorded_failure_not_a_crash(tmp_path):
    c = _with(tmp_path, FakeCultivera(), lambda r: httpx.Response(200, text="<html>") if str(r.url) == cp.Q + "inventories" else None)
    m = cp.run_phase_a(c)
    assert m["status"] == "failed"
    assert c.run.read_json("state.json")["error"].startswith("unexpected")


def test_cdn_redirect_to_foreign_host_refused(tmp_path):
    def ov(r):
        u = str(r.url)
        if u.endswith("/inv.xlsx"):
            return httpx.Response(302, headers={"Location": "https://evil.example/payload"})
        if u.startswith("https://evil.example/"):
            return httpx.Response(200, content=b"PK\x03\x04evil")
        return None

    fake = FakeCultivera()
    c = _with(tmp_path, fake, ov)
    m = cp.run_phase_a(c)
    assert m["status"] == "failed"
    assert "refused CDN url: https://evil.example/payload" in c.run.read_json("state.json")["error"]
    assert not any(str(r.url).startswith("https://evil.example/") for r in fake.requests)  # never requested
    assert not c.run.p("export_inventories.xlsx").exists()


def test_detail_with_wrong_id_is_not_saved(tmp_path):
    def ov(r):
        if str(r.url).endswith("incoming/12/detail"):
            return httpx.Response(200, json={"Id": 99})
        return None

    c = _with(tmp_path, FakeCultivera(), ov)
    m = cp.run_phase_a(c)
    assert m["status"] == "failed"
    st = c.run.read_json("state.json")["stages"]["transfer_details"]
    assert st["status"] == "incomplete" and st["missing"] == [12]
    assert [r["Id"] for r in c.run.read_jsonl("transfer_details.jsonl")] == [11]


def test_detail_404_marks_stage_incomplete_and_stops(tmp_path):
    c = _with(tmp_path, FakeCultivera(), lambda r: httpx.Response(404) if str(r.url).endswith("incoming/11/detail") else None)
    m = cp.run_phase_a(c)
    st = c.run.read_json("state.json")
    assert m["status"] == "failed"
    assert st["stages"]["transfer_details"]["status"] == "incomplete"
    assert "batches" not in st["stages"]  # never runs past an incomplete stage
    assert c.run.read_jsonl("errors.jsonl")[0] == {"stage": "transfer_details", "id": 11, "status": 404}


def test_cancel_inside_transfer_details(tmp_path):
    fake = FakeCultivera()
    c = _client(tmp_path, fake)
    state = {"details": 0}

    def cancelled():
        state["details"] = sum("/detail" in str(r.url) for r in fake.requests)
        return state["details"] >= 1

    m = cp.run_phase_a(c, cancelled=cancelled)
    assert m["status"] == "cancelled"
    assert state["details"] == 1  # stopped after the first detail, before the second


def test_manifest_hashes_are_real(tmp_path):
    import hashlib

    c = _client(tmp_path, FakeCultivera())
    m = cp.run_phase_a(c)
    for f in m["files"]:
        assert f["sha256"] == hashlib.sha256(c.run.p(f["name"]).read_bytes()).hexdigest()

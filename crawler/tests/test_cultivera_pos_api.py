"""R50 S9 — /cultivera-pos endpoints + job layer. NO network (the fake Cultivera from test_cultivera_pos)."""
from __future__ import annotations

import sys
import threading
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
from test_cultivera_pos import PASSWORD, FakeCultivera  # noqa: E402

SECRET = "s3cret"
REAL_START = jobs.start_or_resume  # captured before the fixture patches it
H = {"X-Crawler-Secret": SECRET}


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
    # Endpoints run synchronously in tests so results are deterministic.
    orig = jobs.start_or_resume
    monkeypatch.setattr(jobs, "start_or_resume", lambda **kw: orig(background=False, **kw))
    jobs._active.update(run_id=None, cancel=None, thread=None)
    return TestClient(main_mod.app), fake, settings


def test_requires_secret(env):
    c, _, _ = env
    assert c.post("/cultivera-pos/runs", json={}).status_code == 401
    assert c.get("/cultivera-pos/runs").status_code == 401
    assert c.get("/cultivera-pos/runs/20261101T130000Z-deadbeef", headers={"X-Crawler-Secret": "no"}).status_code == 401


def test_not_configured_is_503(env, monkeypatch):
    c, _, settings = env
    monkeypatch.setattr(settings, "cultivera_pos_password", "")
    r = c.post("/cultivera-pos/runs", json={}, headers=H)
    assert r.status_code == 503 and "CULTIVERA_POS_USERNAME" in r.json()["detail"]


def test_full_run_status_and_files(env):
    c, fake, _ = env
    r = c.post("/cultivera-pos/runs", json={}, headers=H)
    assert r.status_code == 202, r.text
    rid = r.json()["runId"]
    assert jobs.valid_run_id(rid) and r.json()["resumed"] is False
    st = c.get(f"/cultivera-pos/runs/{rid}", headers=H).json()
    assert st["state"]["status"] == "done" and st["active"] is False
    assert {f["name"] for f in st["manifest"]["files"]} >= {"export_inventories.xlsx", "inventories.json"}
    f = c.get(f"/cultivera-pos/runs/{rid}/files/export_inventories.xlsx", headers=H)
    assert f.status_code == 200 and f.content.startswith(b"PK\x03\x04")
    assert c.get("/cultivera-pos/runs", headers=H).json()["runs"] == [rid]
    # the run is finished: a second click starts a FRESH harvest, never reuses stale data
    r2 = c.post("/cultivera-pos/runs", json={}, headers=H).json()
    assert r2["runId"] != rid and r2["resumed"] is False


@pytest.mark.parametrize("name", ["actions.jsonl", "../state.json", "state.json.part", "x.xlsx", "%2e%2e%2fsecret"])
def test_file_allow_list(env, name):
    c, _, _ = env
    rid = c.post("/cultivera-pos/runs", json={}, headers=H).json()["runId"]
    assert c.get(f"/cultivera-pos/runs/{rid}/files/{name}", headers=H).status_code == 404


@pytest.mark.parametrize("rid", ["..", "abc", "20261101T130000Z-DEADBEEF", "20261101T130000Z-deadbeef/../x"])
def test_bad_run_ids_404(env, rid):
    c, _, _ = env
    assert c.get(f"/cultivera-pos/runs/{rid}", headers=H).status_code == 404


def test_failed_run_is_resumed_not_restarted(env):
    c, fake, _ = env
    fake.fail_detail_once = 12
    jobs_real = jobs.PosClient

    # first run: a connect error with 1 retry -> the stage fails
    def one_retry(*a, **k):
        cl = jobs_real(*a, **k)
        cl.retries = 1
        return cl

    jobs.PosClient, saved = one_retry, jobs.PosClient
    try:
        rid = c.post("/cultivera-pos/runs", json={}, headers=H).json()["runId"]
    finally:
        jobs.PosClient = saved
    assert c.get(f"/cultivera-pos/runs/{rid}", headers=H).json()["state"]["status"] == "failed"
    r = c.post("/cultivera-pos/runs", json={}, headers=H).json()
    assert r == {"ok": True, "runId": rid, "resumed": True}
    assert c.get(f"/cultivera-pos/runs/{rid}", headers=H).json()["state"]["status"] == "done"


def test_fresh_ignores_unfinished(env, tmp_path):
    c, _, settings = env
    d = jobs.run_dir("20261012T000000Z-0000abcd", settings)
    cp.RunDir(d).write_json("state.json", {"status": "running", "stages": {}})
    r = c.post("/cultivera-pos/runs", json={"fresh": True}, headers=H).json()
    assert r["runId"] != "20261012T000000Z-0000abcd" and r["resumed"] is False


def test_crash_left_running_is_resumed(env):
    c, _, settings = env
    rid = "20261012T000000Z-0000abcd"
    cp.RunDir(jobs.run_dir(rid, settings)).write_json("state.json", {"status": "running", "stages": {}})
    assert c.post("/cultivera-pos/runs", json={}, headers=H).json() == {"ok": True, "runId": rid, "resumed": True}


def test_busy_is_409(env):
    c, _, _ = env
    jobs._active["run_id"] = "20261101T130000Z-deadbeef"
    try:
        assert c.post("/cultivera-pos/runs", json={}, headers=H).status_code == 409
    finally:
        jobs._active["run_id"] = None


def test_cancel_only_hits_the_active_run(env):
    c, _, _ = env
    ev = threading.Event()
    jobs._active.update(run_id="20261101T130000Z-deadbeef", cancel=ev)
    try:
        assert c.post("/cultivera-pos/runs/20261101T130000Z-00000000/cancel", headers=H).json()["cancelRequested"] is False
        assert not ev.is_set()
        assert c.post("/cultivera-pos/runs/20261101T130000Z-deadbeef/cancel", headers=H).json()["cancelRequested"] is True
        assert ev.is_set()
    finally:
        jobs._active.update(run_id=None, cancel=None)


def test_background_thread_releases_single_flight(env):
    _, _, settings = env
    out = REAL_START(background=True, settings=settings)
    t = jobs._active["thread"]
    assert jobs._active["run_id"] == out["runId"] and t is not None
    t.join(timeout=20)
    assert not t.is_alive()
    assert jobs._active == {"run_id": None, "cancel": None, "thread": None}
    assert jobs.read_state(out["runId"], settings)["state"]["status"] == "done"


def test_prune_keeps_newest(env):
    _, _, settings = env
    ids = [f"202610{d:02d}T000000Z-0000abcd" for d in range(1, 16)]
    for i in ids:
        cp.RunDir(jobs.run_dir(i, settings)).write_json("state.json", {"status": "done"})
    jobs.prune(settings, keep=12)
    assert jobs.list_runs(settings) == sorted(ids, reverse=True)[:12]


def test_resumable_stops_at_done(env):
    _, _, settings = env
    cp.RunDir(jobs.run_dir("20261001T000000Z-0000abcd", settings)).write_json("state.json", {"status": "failed"})
    cp.RunDir(jobs.run_dir("20261002T000000Z-0000abcd", settings)).write_json("state.json", {"status": "done"})
    assert jobs.resumable_run(settings) is None  # an older failed run behind a newer done one is stale


def test_secret_not_on_disk_after_api_run(env, tmp_path):
    c, _, _ = env
    c.post("/cultivera-pos/runs", json={}, headers=H)
    for f in (tmp_path / "cache").rglob("*"):
        if f.is_file():
            assert PASSWORD.encode() not in f.read_bytes(), f

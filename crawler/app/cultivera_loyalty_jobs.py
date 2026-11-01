"""CVL - job layer for the customer loyalty crawl (one run at a time, resumable, cancellable).

  POST /cultivera-loyalty/runs                 start a new run (or resume the newest unfinished one)
  GET  /cultivera-loyalty/runs                 newest run ids
  GET  /cultivera-loyalty/runs/{id}            state.json + manifest (the admin page polls this)
  POST /cultivera-loyalty/runs/{id}/cancel     stop between requests (resumable)
  GET  /cultivera-loyalty/runs/{id}/files/{n}  download one output (allow-listed names only)

Never runs at the same time as the cutover harvest (cultivera_pos_jobs): both use the owner's one Cultivera
login, and two crawls at once would double the load on Cultivera. Run ids are server-generated.
"""
from __future__ import annotations

import shutil
import threading
from pathlib import Path
from typing import Any

from . import cultivera_pos_jobs as pos_jobs
from .config import Settings, get_settings
from .cultivera_loyalty import OUT_ACCRUAL, OUT_ERRORS, OUT_IDS, OUT_LOYALTY, OUT_SKIPPED, run_loyalty
from .cultivera_pos import PosClient, RunDir

# customer_ids.json is NOT served: the site needs only the loyalty records, the accrual sums and the
# skip list. errors.jsonl carries ids and HTTP statuses only.
DOWNLOADABLE = frozenset({OUT_LOYALTY, OUT_ACCRUAL, OUT_SKIPPED, OUT_ERRORS, "manifest.json", "state.json"})
KEEP_RUNS = 3
RESUMABLE = ("running", "paused", "failed", "cancelled", None)

_lock = threading.Lock()
_active: dict[str, Any] = {"run_id": None, "cancel": None, "thread": None}

new_run_id = pos_jobs.new_run_id
valid_run_id = pos_jobs.valid_run_id
_ = OUT_IDS  # kept on the crawler for resume only


def runs_root(settings: Settings | None = None) -> Path:
    s = settings or get_settings()
    p = s.cache_path / "cultivera_loyalty"
    p.mkdir(parents=True, exist_ok=True)
    return p


def run_dir(run_id: str, settings: Settings | None = None) -> Path:
    if not valid_run_id(run_id):
        raise ValueError("bad run id")
    return runs_root(settings) / run_id


def list_runs(settings: Settings | None = None) -> list[str]:
    return sorted((p.name for p in runs_root(settings).iterdir() if p.is_dir() and valid_run_id(p.name)), reverse=True)


def read_state(run_id: str, settings: Settings | None = None) -> dict[str, Any] | None:
    d = run_dir(run_id, settings)
    if not d.exists():
        return None
    rd = RunDir(d)
    return {"runId": run_id, "active": _active["run_id"] == run_id, "state": rd.read_json("state.json", {}) or {},
            "manifest": rd.read_json("manifest.json")}


def resumable_run(settings: Settings | None = None) -> str | None:
    for rid in list_runs(settings):
        st = (RunDir(run_dir(rid, settings)).read_json("state.json", {}) or {}).get("status")
        if st in RESUMABLE:
            return rid
        if st == "done":
            return None
    return None


def prune(settings: Settings | None = None, keep: int = KEEP_RUNS) -> None:
    for rid in list_runs(settings)[keep:]:
        if rid != _active["run_id"]:
            shutil.rmtree(run_dir(rid, settings), ignore_errors=True)


def start_or_resume(*, fresh: bool = False, settings: Settings | None = None, client_factory=None,
                    background: bool = True) -> dict[str, Any]:
    """Raises RuntimeError("busy") if this crawl or the cutover harvest is running, and
    RuntimeError("not configured") if the POS login is not set."""
    s = settings or get_settings()
    if client_factory is None and not s.cultivera_pos_enabled:
        raise RuntimeError("not configured")
    with _lock:
        if _active["run_id"] is not None or pos_jobs._active["run_id"] is not None:
            raise RuntimeError("busy")
        rid = None if fresh else resumable_run(s)
        resumed = rid is not None
        rid = rid or new_run_id()
        rd = RunDir(run_dir(rid, s))
        cancel = threading.Event()
        if client_factory is not None:
            client = client_factory(rd)
        else:
            client = PosClient(username=s.cultivera_pos_username.strip(), password=s.cultivera_pos_password,
                               run=rd, pace_seconds=s.cultivera_loyalty_pace_seconds)
        _active.update(run_id=rid, cancel=cancel)

    def work() -> None:
        try:
            run_loyalty(client, cancelled=cancel.is_set, budget_seconds=s.cultivera_loyalty_budget_seconds)
        finally:
            client.close()
            with _lock:
                _active.update(run_id=None, cancel=None, thread=None)
            prune(s)

    if background:
        t = threading.Thread(target=work, name=f"cultivera-loyalty-{rid}", daemon=True)
        _active["thread"] = t
        t.start()
    else:
        work()
    return {"runId": rid, "resumed": resumed}


def request_cancel(run_id: str) -> bool:
    with _lock:
        if _active["run_id"] == run_id and _active["cancel"] is not None:
            _active["cancel"].set()
            return True
    return False


def file_path(run_id: str, name: str, settings: Settings | None = None) -> Path | None:
    if name not in DOWNLOADABLE:
        return None
    p = run_dir(run_id, settings) / name
    return p if p.is_file() else None

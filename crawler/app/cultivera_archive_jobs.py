"""CVB-2 - job layer for the Cultivera ARCHIVE harvest (one run at a time, resumable, cancellable).

Mirrors cultivera_pos_jobs (R50 S9) on purpose - same single-flight lock, same server-generated run ids,
same resume rule - but keeps its runs in their own directory (<cache>/cultivera_archive/<run_id>/) so the
cutover harvest and the archive can never read each other's state.

  POST /cultivera-archive/runs                 start a new archive run (or resume the newest unfinished one)
  GET  /cultivera-archive/runs                 newest run ids
  GET  /cultivera-archive/runs/{id}            state.json + manifest.json (the admin page polls this)
  POST /cultivera-archive/runs/{id}/cancel     cancel between requests (the run stays resumable)
  GET  /cultivera-archive/runs/{id}/files/{n}  one output file (cultivera_archive.is_archive_file names only)

The crawler cache is ephemeral (/tmp on Railway), so the site copies every file into private Supabase
Storage as soon as a run is done; the crawler never holds the only copy for long.
"""
from __future__ import annotations

import shutil
import threading
from pathlib import Path
from typing import Any

from .config import Settings, get_settings
from .cultivera_archive import is_archive_file, run_archive
from .cultivera_pos import PosClient, RunDir
from .cultivera_pos_jobs import new_run_id, valid_run_id

# Archives are big (hundreds of MB raw); keep few on the ephemeral disk.
KEEP_RUNS = 3

_lock = threading.Lock()
_active: dict[str, Any] = {"run_id": None, "cancel": None, "thread": None}


def runs_root(settings: Settings | None = None) -> Path:
    s = settings or get_settings()
    p = s.cache_path / "cultivera_archive"
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
    """The newest run that did not finish ("running" after a crash, "paused", "failed", "cancelled")."""
    for rid in list_runs(settings):
        st = (RunDir(run_dir(rid, settings)).read_json("state.json", {}) or {}).get("status")
        if st in ("running", "paused", "failed", "cancelled", None):
            return rid
        if st == "done":
            return None  # a finished archive is never reopened: a new click is a fresh harvest
    return None


def prune(settings: Settings | None = None, keep: int = KEEP_RUNS) -> None:
    for rid in list_runs(settings)[keep:]:
        if rid != _active["run_id"]:
            shutil.rmtree(run_dir(rid, settings), ignore_errors=True)


def start_or_resume(*, fresh: bool = False, settings: Settings | None = None, client_factory=None,
                    background: bool = True, date_to: str | None = None) -> dict[str, Any]:
    """Start (or resume) the single archive run. RuntimeError("busy") if one is active (including a
    cutover harvest - both share one Cultivera login, and two sessions would fight over the token),
    RuntimeError("not configured") if the POS login is not set."""
    from . import cultivera_pos_jobs as pos_jobs

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
                               run=rd, pace_seconds=s.cultivera_pos_pace_seconds)
        _active.update(run_id=rid, cancel=cancel)

    def work() -> None:
        try:
            run_archive(client, cancelled=cancel.is_set, budget_seconds=s.cultivera_archive_budget_seconds,
                        date_to=date_to)
        finally:
            client.close()
            with _lock:
                _active.update(run_id=None, cancel=None, thread=None)
            prune(s)

    if background:
        t = threading.Thread(target=work, name=f"cultivera-archive-{rid}", daemon=True)
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
    if not is_archive_file(name):
        return None
    p = run_dir(run_id, settings) / name
    return p if p.is_file() else None

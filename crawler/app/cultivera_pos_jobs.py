"""R50 S9 — job layer for the cutover harvest (one run at a time, resumable, cancellable).

A RUN is one directory under <cache>/cultivera_pos/<run_id>/ written by cultivera_pos.run_phase_a.
The Next.js button calls:

  POST /cultivera-pos/runs                 start a new run (or resume the newest unfinished one)
  GET  /cultivera-pos/runs/{id}            state.json + manifest (progress page polls this)
  POST /cultivera-pos/runs/{id}/cancel     cancel between requests (a run is resumable after)
  GET  /cultivera-pos/runs/{id}/files/{n}  download one output (allow-listed names only)

Single flight: a module-level lock + an in-process "active" marker. If the VM restarts mid-run, the
state on disk still says "running"; the next POST resumes that run (finished stages and saved ids are
never refetched). Run ids are server-generated (UTC timestamp + random) — never taken from a caller.
"""
from __future__ import annotations

import re
import secrets
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from .config import Settings, get_settings
from .cultivera_pos import PosClient, RunDir, run_phase_a

# Files the Next.js importer may download. Nothing else in a run dir is served (actions.jsonl stays
# on the crawler: it is redacted, but it is an audit log, not an input).
DOWNLOADABLE = frozenset({
    "export_inventories.xlsx", "export_products.xlsx", "inventories.json", "transfers.json",
    "transfer_details.jsonl", "wcia_json.jsonl", "batches.jsonl", "errors.jsonl", "manifest.json", "state.json",
    "sales.jsonl", "sales_summary.json",
})
RUN_ID_RE = re.compile(r"^\d{8}T\d{6}Z-[0-9a-f]{8}$")
KEEP_RUNS = 12

_lock = threading.Lock()
_active: dict[str, Any] = {"run_id": None, "cancel": None, "thread": None}


def runs_root(settings: Settings | None = None) -> Path:
    s = settings or get_settings()
    p = s.cache_path / "cultivera_pos"
    p.mkdir(parents=True, exist_ok=True)
    return p


def new_run_id(now: float | None = None) -> str:
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now if now is not None else time.time())) + "-" + secrets.token_hex(4)


def valid_run_id(run_id: str) -> bool:
    return bool(RUN_ID_RE.match(run_id or ""))


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
    state = rd.read_json("state.json", {}) or {}
    return {"runId": run_id, "active": _active["run_id"] == run_id, "state": state,
            "manifest": rd.read_json("manifest.json")}


def resumable_run(settings: Settings | None = None) -> str | None:
    """The newest run that did not finish ("running" after a crash, "failed", "cancelled")."""
    for rid in list_runs(settings):
        st = (RunDir(run_dir(rid, settings)).read_json("state.json", {}) or {}).get("status")
        if st in ("running", "failed", "cancelled", None):
            return rid
        if st == "done":
            return None  # never resume past a finished run: a new click means a fresh harvest
    return None


def prune(settings: Settings | None = None, keep: int = KEEP_RUNS) -> None:
    for rid in list_runs(settings)[keep:]:
        if rid != _active["run_id"]:
            shutil.rmtree(run_dir(rid, settings), ignore_errors=True)


def start_or_resume(*, fresh: bool = False, settings: Settings | None = None,
                    client_factory=None, background: bool = True, sales_from: str | None = None) -> dict[str, Any]:
    """Start (or resume) the single run. Raises RuntimeError("busy") if one is active,
    RuntimeError("not configured") if the POS login is not set."""
    s = settings or get_settings()
    if client_factory is None and not s.cultivera_pos_enabled:
        raise RuntimeError("not configured")
    with _lock:
        if _active["run_id"] is not None:
            raise RuntimeError("busy")
        from . import cultivera_loyalty_jobs  # CVL: one Cultivera crawl at a time (lazy: no import cycle)

        if cultivera_loyalty_jobs._active["run_id"] is not None:
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
            run_phase_a(client, cancelled=cancel.is_set, budget_seconds=s.cultivera_pos_budget_seconds,
                        sales_from=sales_from)
        finally:
            client.close()
            with _lock:
                _active.update(run_id=None, cancel=None, thread=None)
            prune(s)

    if background:
        t = threading.Thread(target=work, name=f"cultivera-pos-{rid}", daemon=True)
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

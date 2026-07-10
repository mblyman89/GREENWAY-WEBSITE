"""Slice H1 — the batch HARVEST layer: many targets, one crash-safe job.

The single-target `/research` endpoint is a scalpel (one vendor, one click).
This module is the combine harvester the owner asked for: hand it a LIST of
targets (current vendors, LCB-derived prospects, eventually the whole WA
market), and it works through them sequentially, unattended, landing exactly
the same drafts-only output as `/research` — nothing new touches an entity
without human review.

Design rules (all deliberate):
  • ONE job runs at a time (module-level asyncio.Lock). The VM is one machine
    and politeness is per-domain; parallel jobs would just fight each other.
    Extra jobs queue behind the lock in submission order.
  • CRASH-SAFE — the job file (JSON in <cache>/jobs/) is rewritten after every
    target. If the process dies mid-run, `resume` resets any 'running' target
    back to 'pending' and continues; finished targets are never redone.
  • CANCELLABLE — a cancel flag is checked between targets (never mid-fetch,
    so a target either completes honestly or stays pending).
  • BOUNDED — max targets per job and max pages per site are capped so a typo
    can't launch a runaway crawl.
  • DRAFTS-ONLY — every target goes through the existing research pipeline
    (robots.txt, SSRF guard, per-domain rate limit, verify-against-source,
    compliance scan) and lands in ai_suggestions as pending drafts. This
    module adds NO new write path.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .config import Settings, get_settings
from .kb_products import build_product_rows, write_product_drafts
from .pipeline import research_target, result_to_draft_rows
from .store import fetch_banned_phrases, write_drafts

log = logging.getLogger("greenway.crawler.harvest")

# Hard caps — a job is a batch, not a botnet.
MAX_TARGETS_PER_JOB = 500
# C2: 50 → 120. The frontier crawl now walks whole sites and the owner wants
# every page read ("I don't mind if the crawler takes several minutes to crawl
# a vendor site"); per-domain politeness delays still pace every fetch.
MAX_PAGES_PER_SITE = 120
# How many finished job files to keep on disk (oldest pruned).
MAX_JOB_FILES = 200

VALID_ENTITY_TYPES = ("vendor", "brand", "product")

# In-memory registry: background tasks (prevent GC) + cancel events.
_tasks: dict[str, asyncio.Task] = {}
_cancel_events: dict[str, asyncio.Event] = {}
# Single-flight: only one job crawls at a time; others queue on this lock.
_run_lock = asyncio.Lock()


@dataclass
class TargetState:
    url: str
    entity_type: str
    entity_id: str
    display_name: str = ""
    status: str = "pending"  # pending | running | done | failed
    pages: int = 0
    # C4: completeness signals from the crawl's coverage report — how many
    # discovered pages were left unread (0 = site exhausted) and the one-line
    # human assessment ("COMPLETE — …" / "BUDGET REACHED — …").
    pages_leftover: int = 0
    coverage_assessment: str = ""
    drafts_written: int = 0
    drafts_skipped: int = 0
    products_written: int = 0  # H9b: structured kb_products draft rows staged
    error: str = ""


@dataclass
class JobState:
    id: str
    label: str = ""
    status: str = "queued"  # queued | running | completed | cancelled | failed
    write: bool = True
    max_pages_per_site: int | None = None  # None = worker default (CRAWL_MAX_PAGES)
    # Optional politeness gap BETWEEN sites (seconds) — used by the Tier-3
    # "trickle" mode so a whole-market pass is a slow background hum, not a burst.
    delay_between_targets: float = 0.0
    created_at: float = 0.0
    started_at: float = 0.0
    finished_at: float = 0.0
    cancel_requested: bool = False
    targets: list[TargetState] = field(default_factory=list)

    # ---- derived summaries (for API responses) -------------------------------
    def counts(self) -> dict:
        c = {"pending": 0, "running": 0, "done": 0, "failed": 0}
        for t in self.targets:
            c[t.status] = c.get(t.status, 0) + 1
        return c

    def to_dict(self) -> dict:
        d = asdict(self)
        d["counts"] = self.counts()
        d["total_targets"] = len(self.targets)
        d["total_drafts_written"] = sum(t.drafts_written for t in self.targets)
        d["total_products_written"] = sum(t.products_written for t in self.targets)
        return d


# ---------------------------------------------------------------------------
# Persistence — one JSON file per job, rewritten after every target.
# ---------------------------------------------------------------------------

def _jobs_dir(settings: Settings) -> Path:
    p = settings.cache_path / "jobs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _job_file(settings: Settings, job_id: str) -> Path:
    # job_id is always our own uuid4 hex — never user input — so the path is safe.
    return _jobs_dir(settings) / f"job_{job_id}.json"


def save_job(job: JobState, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    payload = asdict(job)
    try:
        _job_file(settings, job.id).write_text(json.dumps(payload), "utf-8")
    except Exception:  # pragma: no cover - disk-full etc.; job keeps running
        log.exception("could not persist job %s", job.id)


def load_job(job_id: str, settings: Settings | None = None) -> JobState | None:
    settings = settings or get_settings()
    f = _job_file(settings, job_id)
    if not f.exists():
        return None
    try:
        data = json.loads(f.read_text("utf-8"))
    except Exception:
        return None
    targets = [TargetState(**t) for t in data.pop("targets", [])]
    data.pop("counts", None)
    data.pop("total_targets", None)
    data.pop("total_drafts_written", None)
    data.pop("total_products_written", None)
    return JobState(targets=targets, **data)


def list_jobs(limit: int = 20, settings: Settings | None = None) -> list[JobState]:
    """Most-recent-first job snapshots (for the console's job list)."""
    settings = settings or get_settings()
    files = sorted(_jobs_dir(settings).glob("job_*.json"),
                   key=lambda f: f.stat().st_mtime, reverse=True)
    out: list[JobState] = []
    for f in files[:limit]:
        job = load_job(f.stem.removeprefix("job_"), settings)
        if job:
            out.append(job)
    return out


def _prune_old_jobs(settings: Settings) -> None:
    files = sorted(_jobs_dir(settings).glob("job_*.json"),
                   key=lambda f: f.stat().st_mtime, reverse=True)
    for f in files[MAX_JOB_FILES:]:
        try:
            f.unlink()
        except Exception:  # pragma: no cover
            pass


# ---------------------------------------------------------------------------
# Job lifecycle
# ---------------------------------------------------------------------------

class HarvestValidationError(ValueError):
    """Raised for a bad job submission (maps to HTTP 422 in the API)."""


def create_job(
    targets: list[dict],
    *,
    write: bool = True,
    max_pages_per_site: int | None = None,
    delay_between_targets: float = 0.0,
    label: str = "",
    settings: Settings | None = None,
) -> JobState:
    """Validate + persist a new job (status=queued). Caller schedules the run."""
    settings = settings or get_settings()
    if not targets:
        raise HarvestValidationError("targets must not be empty")
    if len(targets) > MAX_TARGETS_PER_JOB:
        raise HarvestValidationError(f"too many targets (max {MAX_TARGETS_PER_JOB})")
    if max_pages_per_site is not None and not (1 <= max_pages_per_site <= MAX_PAGES_PER_SITE):
        raise HarvestValidationError(f"max_pages_per_site must be 1..{MAX_PAGES_PER_SITE}")
    if delay_between_targets < 0 or delay_between_targets > 3600:
        raise HarvestValidationError("delay_between_targets must be 0..3600 seconds")

    states: list[TargetState] = []
    seen: set[str] = set()
    for t in targets:
        url = str(t.get("url", "")).strip()
        etype = str(t.get("entity_type", "")).strip()
        eid = str(t.get("entity_id", "")).strip()
        name = str(t.get("display_name", "")).strip()
        if not url.lower().startswith(("http://", "https://")):
            raise HarvestValidationError(f"invalid url: {url!r}")
        if etype not in VALID_ENTITY_TYPES:
            raise HarvestValidationError(f"invalid entity_type: {etype!r}")
        if not eid:
            raise HarvestValidationError(f"missing entity_id for {url}")
        # De-dup within the job on (entity, url) so a double-submitted vendor
        # doesn't get crawled twice in one run.
        key = f"{etype}:{eid}:{url.rstrip('/')}"
        if key in seen:
            continue
        seen.add(key)
        states.append(TargetState(url=url, entity_type=etype, entity_id=eid, display_name=name))

    job = JobState(
        id=uuid.uuid4().hex,
        label=label.strip()[:120],
        write=write,
        max_pages_per_site=max_pages_per_site,
        delay_between_targets=float(delay_between_targets),
        created_at=time.time(),
        targets=states,
    )
    save_job(job, settings)
    _prune_old_jobs(settings)
    return job


def request_cancel(job_id: str, settings: Settings | None = None) -> JobState | None:
    """Flag a job for cancellation (takes effect between targets)."""
    settings = settings or get_settings()
    job = load_job(job_id, settings)
    if job is None:
        return None
    if job.status in ("completed", "cancelled", "failed"):
        return job  # nothing to cancel
    job.cancel_requested = True
    save_job(job, settings)
    ev = _cancel_events.get(job_id)
    if ev:
        ev.set()
    return job


def prepare_resume(job_id: str, settings: Settings | None = None) -> JobState | None:
    """Reset a crashed/cancelled job so pending targets can run again.

    Any target stuck in 'running' (process died mid-target) goes back to
    'pending'; completed/failed targets are left alone. Returns the refreshed
    job (status=queued) or None if unknown / nothing left to do."""
    settings = settings or get_settings()
    job = load_job(job_id, settings)
    if job is None:
        return None
    if job.status == "running" and job_id in _tasks and not _tasks[job_id].done():
        return job  # actively running in THIS process; nothing to resume
    for t in job.targets:
        if t.status == "running":
            t.status = "pending"
    if not any(t.status == "pending" for t in job.targets):
        return job  # everything already finished
    job.status = "queued"
    job.cancel_requested = False
    job.finished_at = 0.0
    save_job(job, settings)
    return job


def schedule_job(job_id: str, settings: Settings | None = None) -> None:
    """Start (or queue) the background run for a job in the current loop."""
    settings = settings or get_settings()
    ev = asyncio.Event()
    _cancel_events[job_id] = ev
    task = asyncio.get_running_loop().create_task(run_job(job_id, settings=settings))
    _tasks[job_id] = task


async def run_job(job_id: str, *, settings: Settings | None = None) -> JobState | None:
    """Work through a job's pending targets, one site at a time.

    Single-flight: waits politely on the module lock, so concurrent
    submissions execute back-to-back rather than in parallel. State is saved
    after EVERY target — the crash-recovery contract.
    """
    settings = settings or get_settings()
    async with _run_lock:
        job = load_job(job_id, settings)
        if job is None:
            return None
        if job.status in ("completed", "cancelled", "failed"):
            return job
        job.status = "running"
        job.started_at = job.started_at or time.time()
        save_job(job, settings)
        log.info("harvest %s: %d target(s), write=%s", job.id, len(job.targets), job.write)

        cancel_ev = _cancel_events.get(job_id)
        for t in job.targets:
            if t.status != "pending":
                continue
            # Cancellation is honored BETWEEN targets — a site is either fully
            # researched or untouched, never half-written.
            fresh = load_job(job_id, settings)
            if (cancel_ev and cancel_ev.is_set()) or (fresh and fresh.cancel_requested):
                job.cancel_requested = True
                job.status = "cancelled"
                job.finished_at = time.time()
                save_job(job, settings)
                log.info("harvest %s: cancelled", job.id)
                return job

            t.status = "running"
            save_job(job, settings)
            try:
                result = await research_target(
                    url=t.url,
                    entity_type=t.entity_type,
                    entity_id=t.entity_id,
                    display_name=t.display_name,
                    settings=settings,
                    max_pages=job.max_pages_per_site,
                )
                t.pages = len(result.pages)
                # C4: surface the crawl's completeness verdict on the target.
                if result.coverage is not None:
                    t.pages_leftover = result.coverage.queued_leftover
                    t.coverage_assessment = result.coverage.assessment
                if not result.fetched_ok:
                    t.status = "failed"
                    t.error = result.error or "fetch failed"
                else:
                    if job.write:
                        summary = write_drafts(result_to_draft_rows(result), settings=settings)
                        t.drafts_written = summary.get("written", 0)
                        t.drafts_skipped = summary.get("skipped", 0)
                        # H9b: also stage structured kb_products DRAFT rows from
                        # the verified lineup (opt-out via HARVEST_PRODUCTS_ENABLED).
                        if settings.harvest_products_enabled and result.products:
                            built = build_product_rows(
                                result.products,
                                entity_type=result.entity_type,
                                entity_id=result.entity_id,
                                display_name=result.display_name,
                                source_url=result.url,
                                banned=fetch_banned_phrases(settings),
                            )
                            prod = write_product_drafts(built.rows, settings=settings)
                            t.products_written = prod.get("written", 0)
                    t.status = "done"
            except Exception as e:  # noqa: BLE001 — one bad site never kills the batch
                t.status = "failed"
                t.error = str(e)[:300]
                log.exception("harvest %s: target %s failed", job.id, t.url)
            # Merge a cancel that arrived MID-target (written to disk by the
            # cancel endpoint) before we persist — otherwise this save would
            # clobber the flag with our stale in-memory copy.
            on_disk = load_job(job_id, settings)
            if on_disk and on_disk.cancel_requested:
                job.cancel_requested = True
            save_job(job, settings)

            if job.delay_between_targets > 0:
                # Trickle mode: an interruptible nap between sites.
                try:
                    if cancel_ev:
                        await asyncio.wait_for(cancel_ev.wait(), timeout=job.delay_between_targets)
                    else:  # pragma: no cover - resumed without event
                        await asyncio.sleep(job.delay_between_targets)
                except asyncio.TimeoutError:
                    pass
            else:
                await asyncio.sleep(0)  # yield so /health etc. stay responsive

        job.status = "completed"
        job.finished_at = time.time()
        save_job(job, settings)
        log.info("harvest %s: completed — %s", job.id, job.counts())
        return job

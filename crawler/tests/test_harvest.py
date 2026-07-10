"""Slice H1 tests — batch harvest job lifecycle. Pure logic: no network, no
LLM, no Supabase. research_target is monkeypatched; jobs persist to a tmp dir.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import harvest  # noqa: E402
from app.config import Settings  # noqa: E402
from app.harvest import (  # noqa: E402
    HarvestValidationError,
    JobState,
    TargetState,
    create_job,
    load_job,
    prepare_resume,
    request_cancel,
    run_job,
    save_job,
)
from app.pipeline import ResearchResult  # noqa: E402


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    return Settings(CRAWL_CACHE_DIR=str(tmp_path / "cache"), _env_file=None)


def _targets(n: int = 2) -> list[dict]:
    return [
        {
            "url": f"https://vendor{i}.example.com/",
            "entity_type": "vendor",
            "entity_id": f"vendor-{i}",
            "display_name": f"Vendor {i}",
        }
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# create_job validation
# ---------------------------------------------------------------------------

def test_create_job_persists_and_roundtrips(settings: Settings) -> None:
    job = create_job(_targets(3), label="Tier 1 batch", settings=settings)
    assert job.status == "queued"
    assert len(job.targets) == 3
    loaded = load_job(job.id, settings)
    assert loaded is not None
    assert loaded.label == "Tier 1 batch"
    assert [t.entity_id for t in loaded.targets] == ["vendor-0", "vendor-1", "vendor-2"]


def test_create_job_rejects_bad_input(settings: Settings) -> None:
    with pytest.raises(HarvestValidationError):
        create_job([], settings=settings)
    with pytest.raises(HarvestValidationError):
        create_job([{"url": "ftp://x", "entity_type": "vendor", "entity_id": "a"}], settings=settings)
    with pytest.raises(HarvestValidationError):
        create_job([{"url": "https://x.com", "entity_type": "spaceship", "entity_id": "a"}], settings=settings)
    with pytest.raises(HarvestValidationError):
        create_job([{"url": "https://x.com", "entity_type": "vendor", "entity_id": ""}], settings=settings)
    with pytest.raises(HarvestValidationError):
        create_job(_targets(1), max_pages_per_site=9999, settings=settings)


def test_create_job_dedupes_repeated_targets(settings: Settings) -> None:
    t = _targets(1)
    job = create_job(t + t + t, settings=settings)  # same target three times
    assert len(job.targets) == 1


# ---------------------------------------------------------------------------
# run_job — happy path, failure isolation, per-job page budget
# ---------------------------------------------------------------------------

def _fake_result(url: str, entity_id: str, *, ok: bool = True, pages: int = 3) -> ResearchResult:
    return ResearchResult(
        url=url, entity_type="vendor", entity_id=entity_id,
        fetched_ok=ok, from_cache=False,
        pages=[url] * pages if ok else [],
        error="" if ok else "boom",
    )


def test_run_job_completes_and_isolates_failures(settings: Settings, monkeypatch) -> None:
    calls: list[tuple[str, int | None]] = []

    async def fake_research(*, url, entity_type, entity_id, display_name="", settings=None, max_pages=None, force_fresh=False):
        calls.append((url, max_pages))
        if "vendor1" in url:
            raise RuntimeError("site exploded")
        return _fake_result(url, entity_id)

    monkeypatch.setattr(harvest, "research_target", fake_research)
    monkeypatch.setattr(harvest, "write_drafts", lambda rows, settings=None: {"written": len(rows), "skipped": 0, "configured": True})

    job = create_job(_targets(3), max_pages_per_site=7, settings=settings)
    done = asyncio.run(run_job(job.id, settings=settings))

    assert done is not None and done.status == "completed"
    statuses = {t.entity_id: t.status for t in done.targets}
    assert statuses == {"vendor-0": "done", "vendor-1": "failed", "vendor-2": "done"}
    assert done.targets[1].error.startswith("site exploded")
    # Per-job page budget flowed through to every research call.
    assert all(mp == 7 for _, mp in calls)
    # State survived on disk too (crash-safety contract).
    reloaded = load_job(job.id, settings)
    assert reloaded is not None and reloaded.status == "completed"


def test_run_job_dry_run_writes_nothing(settings: Settings, monkeypatch) -> None:
    async def fake_research(**kwargs):
        return _fake_result(kwargs["url"], kwargs["entity_id"])

    wrote: list[int] = []
    monkeypatch.setattr(harvest, "research_target", fake_research)
    monkeypatch.setattr(harvest, "write_drafts", lambda rows, settings=None: wrote.append(len(rows)) or {"written": 0, "skipped": 0, "configured": True})

    job = create_job(_targets(2), write=False, settings=settings)
    done = asyncio.run(run_job(job.id, settings=settings))
    assert done is not None and done.status == "completed"
    assert wrote == []  # write=False → the store is never called


# ---------------------------------------------------------------------------
# Cancellation + crash recovery
# ---------------------------------------------------------------------------

def test_cancel_between_targets(settings: Settings, monkeypatch) -> None:
    async def fake_research(**kwargs):
        # Cancel the job while the FIRST target is being researched.
        request_cancel(job.id, settings)
        return _fake_result(kwargs["url"], kwargs["entity_id"])

    monkeypatch.setattr(harvest, "research_target", fake_research)
    monkeypatch.setattr(harvest, "write_drafts", lambda rows, settings=None: {"written": 0, "skipped": 0, "configured": True})

    job = create_job(_targets(3), settings=settings)
    done = asyncio.run(run_job(job.id, settings=settings))
    assert done is not None and done.status == "cancelled"
    # First target finished honestly; the rest were never touched.
    assert done.targets[0].status == "done"
    assert all(t.status == "pending" for t in done.targets[1:])


def test_prepare_resume_resets_interrupted_target(settings: Settings) -> None:
    job = JobState(
        id="deadbeef", status="running", created_at=1.0,
        targets=[
            TargetState(url="https://a.com", entity_type="vendor", entity_id="a", status="done"),
            TargetState(url="https://b.com", entity_type="vendor", entity_id="b", status="running"),
            TargetState(url="https://c.com", entity_type="vendor", entity_id="c", status="pending"),
        ],
    )
    save_job(job, settings)
    resumed = prepare_resume("deadbeef", settings)
    assert resumed is not None and resumed.status == "queued"
    assert [t.status for t in resumed.targets] == ["done", "pending", "pending"]


def test_prepare_resume_noop_when_all_finished(settings: Settings) -> None:
    job = JobState(
        id="cafef00d", status="running", created_at=1.0,
        targets=[TargetState(url="https://a.com", entity_type="vendor", entity_id="a", status="done")],
    )
    save_job(job, settings)
    resumed = prepare_resume("cafef00d", settings)
    assert resumed is not None
    # Nothing pending → not re-queued.
    assert resumed.status == "running"
    assert prepare_resume("unknown-id", settings) is None

"""Slice R1 — resumable crawls ("continue where the page budget stopped").

Owner requirement (verbatim): "it stops after 25 pages or something … I need a
way to allow crawl4ai to scrape all the pages and allow me to continue scraping
after it hits its limit and is smart about where it resumes so it doesn't waste
time or credits."

Covers, with zero network / LLM / Supabase:
  * resume_state.py     — save/load/clear round-trips, run merging, bounds,
                          stale TTL, corrupt-file degradation, host-insensitive key
  * frontier.py         — mark_visited blocks re-enqueue; pending_urls snapshot
  * pipeline.py         — budget-cut run persists state; continue_crawl=True
                          resumes without re-fetching; exhausted site clears state
  * harvest.py          — continue_crawl flows job → research_target → target
  * main.py             — POST /resume-state (auth, found, not-found)
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app.pipeline as pipeline  # noqa: E402
from app import config as config_mod  # noqa: E402
from app import harvest as harvest_mod  # noqa: E402
from app.config import Settings  # noqa: E402
from app.fetcher import FetchResult  # noqa: E402
from app.frontier import CrawlFrontier  # noqa: E402
from app.harvest import create_job, run_job  # noqa: E402
from app.pipeline import ResearchResult  # noqa: E402
from app.resume_state import (  # noqa: E402
    MAX_PENDING,
    MAX_VISITED,
    STATE_TTL_SECONDS,
    ResumeState,
    _state_file,
    clear_resume_state,
    load_resume_state,
    save_resume_state,
)


def _settings(tmp_path: Path, **env: object) -> Settings:
    base: dict[str, str] = {
        "CRAWLER_SHARED_SECRET": "s",
        "CRAWL_CACHE_DIR": str(tmp_path / "cache"),
        "CRAWL_RESPECT_ROBOTS": "false",
        "CRAWL_MIN_DELAY_SECONDS": "0",
        "CRAWL_SEED_ENABLED": "false",
        "FOLLOW_SOCIAL_LINKS": "false",
    }
    base.update({k: str(v) for k, v in env.items()})
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# resume_state.py — persistence unit tests
# ---------------------------------------------------------------------------

def test_save_then_load_round_trips(tmp_path: Path) -> None:
    s = _settings(tmp_path)
    saved = save_resume_state(
        entity_type="vendor", entity_id="v1", entry_url="https://farm.example.com/",
        pages_read=["https://farm.example.com/", "https://farm.example.com/about/"],
        pending=["https://farm.example.com/products/"],
        settings=s,
    )
    assert saved.runs == 1 and saved.total_pages == 2
    loaded = load_resume_state("vendor", "v1", "https://farm.example.com/", settings=s)
    assert loaded is not None and loaded.resumable
    assert loaded.visited == saved.visited
    assert loaded.pending == ["https://farm.example.com/products/"]


def test_second_run_merges_visited_and_replaces_pending(tmp_path: Path) -> None:
    s = _settings(tmp_path)
    first = save_resume_state(
        entity_type="vendor", entity_id="v1", entry_url="https://farm.example.com/",
        pages_read=["https://farm.example.com/"],
        pending=["https://farm.example.com/a/", "https://farm.example.com/b/"],
        settings=s,
    )
    second = save_resume_state(
        entity_type="vendor", entity_id="v1", entry_url="https://farm.example.com/",
        pages_read=["https://farm.example.com/a/"],  # read one leftover this run
        pending=["https://farm.example.com/b/"],     # the other is STILL pending
        previous=first,
        settings=s,
    )
    assert second.runs == 2 and second.total_pages == 2
    # visited accumulates (no duplicates); pending is REPLACED (a/ dropped out)
    assert second.visited == ["https://farm.example.com/", "https://farm.example.com/a/"]
    assert second.pending == ["https://farm.example.com/b/"]


def test_lists_are_bounded(tmp_path: Path) -> None:
    s = _settings(tmp_path)
    saved = save_resume_state(
        entity_type="vendor", entity_id="v1", entry_url="https://big.example.com/",
        pages_read=[f"https://big.example.com/p{i}/" for i in range(MAX_VISITED + 50)],
        pending=[f"https://big.example.com/q{i}/" for i in range(MAX_PENDING + 50)],
        settings=s,
    )
    assert len(saved.visited) == MAX_VISITED
    assert len(saved.pending) == MAX_PENDING


def test_stale_state_is_ignored(tmp_path: Path) -> None:
    s = _settings(tmp_path)
    save_resume_state(
        entity_type="vendor", entity_id="v1", entry_url="https://old.example.com/",
        pages_read=["https://old.example.com/"], pending=["https://old.example.com/x/"],
        settings=s,
    )
    f = _state_file(s, "vendor", "v1", "https://old.example.com/")
    data = json.loads(f.read_text("utf-8"))
    data["updated_at"] = time.time() - STATE_TTL_SECONDS - 60
    f.write_text(json.dumps(data), "utf-8")
    assert load_resume_state("vendor", "v1", "https://old.example.com/", settings=s) is None


def test_corrupt_file_degrades_to_fresh_crawl(tmp_path: Path) -> None:
    s = _settings(tmp_path)
    f = _state_file(s, "vendor", "v1", "https://bad.example.com/")
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("{not json", "utf-8")
    assert load_resume_state("vendor", "v1", "https://bad.example.com/", settings=s) is None


def test_clear_removes_state(tmp_path: Path) -> None:
    s = _settings(tmp_path)
    save_resume_state(
        entity_type="vendor", entity_id="v1", entry_url="https://gone.example.com/",
        pages_read=["https://gone.example.com/"], pending=["https://gone.example.com/x/"],
        settings=s,
    )
    assert clear_resume_state("vendor", "v1", "https://gone.example.com/", settings=s) is True
    assert load_resume_state("vendor", "v1", "https://gone.example.com/", settings=s) is None
    assert clear_resume_state("vendor", "v1", "https://gone.example.com/", settings=s) is False


def test_state_key_is_www_insensitive(tmp_path: Path) -> None:
    """https://site.com and https://www.site.com/ continue the SAME crawl."""
    s = _settings(tmp_path)
    save_resume_state(
        entity_type="vendor", entity_id="v1", entry_url="https://site.example.com/",
        pages_read=["https://site.example.com/"], pending=["https://site.example.com/x/"],
        settings=s,
    )
    loaded = load_resume_state("vendor", "v1", "https://www.site.example.com/", settings=s)
    assert loaded is not None and loaded.pending == ["https://site.example.com/x/"]


def test_empty_pending_is_not_resumable() -> None:
    st = ResumeState(entity_type="vendor", entity_id="v", entry_url="https://x.com/",
                     visited=["https://x.com/"], pending=[])
    assert not st.resumable


# ---------------------------------------------------------------------------
# frontier.py — mark_visited / pending_urls
# ---------------------------------------------------------------------------

def test_mark_visited_blocks_reenqueue() -> None:
    f = CrawlFrontier(base_url="https://farm.example.com/")
    marked = f.mark_visited([
        "https://farm.example.com/about/",
        "https://www.farm.example.com/about",  # same frontier key → not double-marked
    ])
    assert marked == 1
    added = f.add(["https://farm.example.com/about/", "https://farm.example.com/new/"])
    assert added == 1  # visited page can never be enqueued again
    assert f.pop() == "https://farm.example.com/new/"


def test_pending_urls_snapshots_without_consuming() -> None:
    f = CrawlFrontier(base_url="https://farm.example.com/")
    f.add(["https://farm.example.com/a/", "https://farm.example.com/b/"])
    snapshot = f.pending_urls()
    assert len(snapshot) == 2 and f.pending() == 2  # nothing consumed
    assert f.pop() == snapshot[0]  # snapshot order == pop order


# ---------------------------------------------------------------------------
# pipeline.py — the full resume loop over a fake 3-page site
# ---------------------------------------------------------------------------

BASE = "https://resume-brand.example.com"

SITE: dict[str, str] = {
    f"{BASE}/": (
        "<html><body><nav><a href='/products/'>Products</a></nav>"
        "<p>We are a family farm in Washington growing craft cannabis flower.</p>"
        "</body></html>"
    ),
    f"{BASE}/products/": (
        "<html><body><h1>Our products</h1>"
        "<p>Browse the full lineup of our craft cannabis flower and hash below.</p>"
        "<a href='/products/gg4/'>GG4</a></body></html>"
    ),
    f"{BASE}/products/gg4/": (
        "<html><body><h1>GG4</h1>"
        "<p>An award winning gorilla glue phenotype with heavy resin production.</p>"
        "</body></html>"
    ),
}


@pytest.fixture()
def fake_site(monkeypatch):
    fetched: list[str] = []

    async def fake_fetch(url, *, prefer_browser=True, settings=None, force_fresh=False):
        fetched.append(url)
        html = SITE.get(url)
        if html is None:
            return FetchResult(url=url, ok=False, status=404, error="HTTP 404")
        import re as _re
        return FetchResult(url=url, ok=True, status=200, html=html,
                           markdown=_re.sub(r"<[^>]+>", " ", html))

    monkeypatch.setattr(pipeline, "fetch_page", fake_fetch)
    monkeypatch.setattr(pipeline, "discover_sitemap_urls",
                        lambda url, settings, limit=100: [])
    monkeypatch.setattr(pipeline, "fetch_banned_phrases", lambda settings: [])
    return fetched


def test_budget_cut_run_saves_resume_state(tmp_path: Path, fake_site) -> None:
    s = _settings(tmp_path)
    result = asyncio.run(pipeline.research_target(
        url=f"{BASE}/", entity_type="brand", entity_id="b1",
        display_name="Resume Brand", settings=s, max_pages=2,
    ))
    assert result.coverage is not None
    assert result.coverage.queued_leftover >= 1
    state = load_resume_state("brand", "b1", f"{BASE}/", settings=s)
    assert state is not None and state.resumable
    assert state.runs == 1 and state.total_pages == 2
    assert f"{BASE}/products/gg4/" in state.pending


def test_continue_crawl_never_refetches_and_reports_runs(tmp_path: Path, fake_site) -> None:
    s = _settings(tmp_path)
    asyncio.run(pipeline.research_target(
        url=f"{BASE}/", entity_type="brand", entity_id="b1",
        display_name="Resume Brand", settings=s, max_pages=2,
    ))
    fake_site.clear()  # fetch log for run #2 only
    result = asyncio.run(pipeline.research_target(
        url=f"{BASE}/", entity_type="brand", entity_id="b1",
        display_name="Resume Brand", settings=s, max_pages=2,
        continue_crawl=True, force_fresh=True,
    ))
    # Run #2 reads the entry page (always) plus ONLY the leftover gg4 page —
    # /products/ was read by run #1 and is never wasted again.
    assert f"{BASE}/products/gg4/" in fake_site
    assert f"{BASE}/products/" not in fake_site
    assert result.coverage is not None
    assert result.coverage.resumed is True
    assert result.coverage.crawl_runs == 2
    assert result.coverage.total_pages_all_runs >= 3
    assert "Continued crawl: run #2" in result.coverage.draft_text()
    # Site is now exhausted → state cleared, nothing left to resume.
    assert load_resume_state("brand", "b1", f"{BASE}/", settings=s) is None


def test_continue_without_saved_state_is_a_fresh_crawl(tmp_path: Path, fake_site) -> None:
    s = _settings(tmp_path)
    result = asyncio.run(pipeline.research_target(
        url=f"{BASE}/", entity_type="brand", entity_id="b-none",
        display_name="Resume Brand", settings=s, continue_crawl=True,
    ))
    assert result.coverage is not None
    assert result.coverage.resumed is False
    assert result.coverage.crawl_runs == 1


def test_exhausted_fresh_crawl_leaves_no_state(tmp_path: Path, fake_site) -> None:
    s = _settings(tmp_path)
    result = asyncio.run(pipeline.research_target(
        url=f"{BASE}/", entity_type="brand", entity_id="b1",
        display_name="Resume Brand", settings=s,
    ))
    assert result.coverage is not None and result.coverage.site_exhausted
    assert load_resume_state("brand", "b1", f"{BASE}/", settings=s) is None


def test_budget_reached_assessment_mentions_continue_crawl() -> None:
    from app.coverage import CrawlCoverage
    c = CrawlCoverage(
        entry_url="https://x.example.com/", page_budget=25, pages_crawled=25,
        pages_failed=[], queued_leftover=10,
        frontier={"discovered": 40, "enqueued": 35, "dropped_boring": 3,
                  "dropped_offsite": 2, "duplicates": 0},
        saturation=0.6, saturated=False,
    )
    assert "Continue crawl" in c.assessment


# ---------------------------------------------------------------------------
# harvest.py — continue_crawl flows job → research_target → target state
# ---------------------------------------------------------------------------

def test_harvest_passes_continue_crawl_and_copies_progress(tmp_path: Path, monkeypatch) -> None:
    s = _settings(tmp_path)
    seen_kwargs: list[dict] = []

    async def fake_research(**kwargs):
        seen_kwargs.append(kwargs)
        from app.coverage import CrawlCoverage
        cov = CrawlCoverage(
            entry_url=kwargs["url"], page_budget=25, pages_crawled=2,
            pages_failed=[], queued_leftover=0,
            frontier={"discovered": 2, "enqueued": 2, "dropped_boring": 0,
                      "dropped_offsite": 0, "duplicates": 0},
            resumed=True, crawl_runs=2, total_pages_all_runs=4,
        )
        return ResearchResult(
            url=kwargs["url"], entity_type=kwargs["entity_type"],
            entity_id=kwargs["entity_id"], fetched_ok=True, from_cache=False,
            pages=[kwargs["url"]], coverage=cov,
        )

    monkeypatch.setattr(harvest_mod, "research_target", fake_research)
    monkeypatch.setattr(harvest_mod, "write_drafts",
                        lambda rows, settings=None: {"written": 0, "skipped": 0, "configured": True})
    job = create_job(
        targets=[{"url": "https://farm.example.com/", "entity_type": "vendor",
                  "entity_id": "v1", "display_name": "Farm"}],
        settings=s, continue_crawl=True,
    )
    assert job.continue_crawl is True
    done = asyncio.run(run_job(job.id, settings=s))
    assert seen_kwargs and seen_kwargs[0]["continue_crawl"] is True
    t = done.targets[0]
    assert t.resumed is True and t.crawl_runs == 2 and t.total_pages_all_runs == 4


def test_old_job_files_without_new_fields_still_load(tmp_path: Path) -> None:
    """Backwards compat: job JSON written before Slice R1 has no continue_crawl
    / resumed keys — dataclass defaults must absorb that."""
    from app.harvest import JobState, TargetState, load_job, save_job
    s = _settings(tmp_path)
    job = JobState(id="old-job-1", label="old", targets=[
        TargetState(url="https://x.example.com/", entity_type="vendor",
                    entity_id="v1", display_name="X"),
    ])
    save_job(job, s)
    # Strip the new keys to simulate a pre-R1 file.
    f = s.cache_path / "jobs" / "job_old-job-1.json"
    data = json.loads(f.read_text("utf-8"))
    data.pop("continue_crawl", None)
    for t in data["targets"]:
        t.pop("resumed", None)
        t.pop("crawl_runs", None)
        t.pop("total_pages_all_runs", None)
    f.write_text(json.dumps(data), "utf-8")
    loaded = load_job("old-job-1", s)
    assert loaded is not None
    assert loaded.continue_crawl is False
    assert loaded.targets[0].crawl_runs == 1


# ---------------------------------------------------------------------------
# main.py — POST /resume-state
# ---------------------------------------------------------------------------

SECRET = "test-secret"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch) -> TestClient:
    s = Settings(
        CRAWLER_SHARED_SECRET=SECRET,
        CRAWL_CACHE_DIR=str(tmp_path / "cache"),
        _env_file=None,
    )
    monkeypatch.setattr(config_mod, "get_settings", lambda: s)
    import app.main as main_mod
    monkeypatch.setattr(main_mod, "get_settings", lambda: s)
    # /resume-state loads with the process-default settings — point the module
    # helper at the tmp cache too.
    import app.resume_state as rs_mod
    monkeypatch.setattr(rs_mod, "get_settings", lambda: s)
    from app.main import app
    client = TestClient(app)
    client._test_settings = s  # type: ignore[attr-defined]
    return client


def test_resume_state_endpoint_requires_secret(client: TestClient) -> None:
    r = client.post("/resume-state", json={
        "url": "https://farm.example.com/", "entity_type": "vendor", "entity_id": "v1",
    })
    assert r.status_code in (401, 403)


def test_resume_state_endpoint_not_found(client: TestClient) -> None:
    r = client.post("/resume-state", headers={"X-Crawler-Secret": SECRET}, json={
        "url": "https://farm.example.com/", "entity_type": "vendor", "entity_id": "v1",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["found"] is False


def test_resume_state_endpoint_reports_saved_progress(client: TestClient) -> None:
    s = client._test_settings  # type: ignore[attr-defined]
    save_resume_state(
        entity_type="vendor", entity_id="v1", entry_url="https://farm.example.com/",
        pages_read=["https://farm.example.com/", "https://farm.example.com/about/"],
        pending=["https://farm.example.com/products/"],
        settings=s,
    )
    r = client.post("/resume-state", headers={"X-Crawler-Secret": SECRET}, json={
        "url": "https://farm.example.com/", "entity_type": "vendor", "entity_id": "v1",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is True
    assert body["pending"] == 1 and body["visited"] == 2
    assert body["runs"] == 1 and body["total_pages"] == 2

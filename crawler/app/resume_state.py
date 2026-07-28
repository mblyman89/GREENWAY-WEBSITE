"""crawler/app/resume_state.py — Slice R1, RESUMABLE deep crawls.

Owner's requirement (verbatim): the crawl "stops after 25 pages or something
and then stops before finishing the remaining pages. I need a way to allow
crawl4ai to scrape all the pages and allow me to continue scraping after it
hits its limit and is smart about where it resumes so it doesn't waste time
or credits."

VERIFIED root cause (never guessed): `research_target` builds a fresh
`CrawlFrontier` on every run and stops when `page_budget` (CRAWL_MAX_PAGES,
default 25, or the per-job override) is spent. The leftover queue — the
frontier's `pending()` pages that were discovered but never read — was only
COUNTED for the coverage report and then thrown away. A re-run started from
scratch: it re-fetched every already-read page (each one burning budget,
politeness delay, and crawl4ai browser time) before it could reach anything
new. That is exactly the wasted "time and credits" the owner describes.

THE FIX — persist the crawl's frontier state per (entity, site) after every
run, and let the next run CONTINUE from it:

  • After a crawl, save {visited URL keys, leftover queue in priority order,
    cumulative counters} to one JSON file in the crawler cache dir.
  • A continued crawl (`continue_crawl=True`) pre-marks every previously
    visited URL in the fresh frontier (`mark_visited`) so it can never be
    enqueued again, seeds the queue with the saved leftovers (highest priority
    first), and spends its WHOLE page budget on pages the previous run(s)
    never read.
  • The page cache remains a second safety net (a re-fetch within the TTL is
    served from disk), but resume works even after the cache expires because
    the STATE file records what was already read.
  • State is cumulative across any number of continues; `runs`, `total_pages`
    and the shrinking `pending` list tell the owner exactly how far through
    the site they are.

Storage: one JSON file per (entity_type, entity_id, registrable host) in
`<cache>/resume_<sha16>.json` — same gitignored cache dir the page cache uses.
Best-effort I/O: a corrupt/missing file degrades to a fresh crawl, never an
error.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from .config import Settings, get_settings
from .frontier import registrable_host

# Keep the persisted lists bounded: a pathological site (calendar traps etc.)
# can discover tens of thousands of URLs; we keep the best `MAX_PENDING`
# leftovers (they're saved in priority order) and every visited key up to
# `MAX_VISITED` (visited keys are tiny and dedupe is the whole point).
MAX_PENDING = 2_000
MAX_VISITED = 10_000

# A resume state older than this is stale — the site has likely changed enough
# that starting fresh is more honest than resuming a months-old queue.
STATE_TTL_SECONDS = 30 * 24 * 3600  # 30 days


@dataclass
class ResumeState:
    """Persisted frontier state for one (entity, site)."""

    entity_type: str
    entity_id: str
    entry_url: str
    visited: list[str] = field(default_factory=list)   # URLs read across ALL runs
    pending: list[str] = field(default_factory=list)   # leftover queue, priority order
    runs: int = 0                                      # crawl runs accumulated
    total_pages: int = 0                               # pages read across all runs
    updated_at: float = 0.0

    @property
    def resumable(self) -> bool:
        """True when a continued crawl has saved work to build on."""
        return bool(self.pending) and bool(self.visited)

    def to_dict(self) -> dict:
        return {
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "entry_url": self.entry_url,
            "visited": list(self.visited),
            "pending": list(self.pending),
            "runs": self.runs,
            "total_pages": self.total_pages,
            "updated_at": self.updated_at,
        }


def _state_key(entity_type: str, entity_id: str, entry_url: str) -> str:
    """Stable key: the ENTITY plus the site's registrable host (not the full
    URL) so `https://site.com` and `https://www.site.com/` continue the same
    crawl state."""
    host = registrable_host(urlparse(entry_url).netloc)
    raw = f"{entity_type}:{entity_id}:{host}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _state_file(settings: Settings, entity_type: str, entity_id: str, entry_url: str) -> Path:
    return settings.cache_path / f"resume_{_state_key(entity_type, entity_id, entry_url)}.json"


def load_resume_state(
    entity_type: str,
    entity_id: str,
    entry_url: str,
    settings: Settings | None = None,
) -> ResumeState | None:
    """Load saved crawl state; None when absent, corrupt, or stale (30 days)."""
    settings = settings or get_settings()
    f = _state_file(settings, entity_type, entity_id, entry_url)
    if not f.exists():
        return None
    try:
        data = json.loads(f.read_text("utf-8"))
        state = ResumeState(
            entity_type=str(data.get("entity_type", "")),
            entity_id=str(data.get("entity_id", "")),
            entry_url=str(data.get("entry_url", "")),
            visited=[u for u in data.get("visited", []) if isinstance(u, str)],
            pending=[u for u in data.get("pending", []) if isinstance(u, str)],
            runs=int(data.get("runs", 0)),
            total_pages=int(data.get("total_pages", 0)),
            updated_at=float(data.get("updated_at", 0.0)),
        )
        if state.updated_at and (time.time() - state.updated_at) > STATE_TTL_SECONDS:
            return None  # stale — a fresh crawl is more honest
        return state
    except Exception:
        return None  # corrupt file degrades to a fresh crawl, never an error


def save_resume_state(
    *,
    entity_type: str,
    entity_id: str,
    entry_url: str,
    pages_read: list[str],
    pending: list[str],
    previous: ResumeState | None = None,
    settings: Settings | None = None,
) -> ResumeState:
    """Persist the post-crawl frontier state, merging with any previous runs.

    `pages_read` are THIS run's fetched pages; `pending` is the frontier's
    leftover queue in priority order. Visited accumulates across runs (bounded);
    pending is replaced by the new leftover queue (pages read this run must
    drop out of it — that's the "smart about where it resumes" contract).
    """
    settings = settings or get_settings()
    visited_prev = list(previous.visited) if previous else []
    seen = set(visited_prev)
    merged_visited = visited_prev + [u for u in pages_read if u not in seen]
    state = ResumeState(
        entity_type=entity_type,
        entity_id=entity_id,
        entry_url=entry_url,
        visited=merged_visited[:MAX_VISITED],
        pending=list(pending)[:MAX_PENDING],
        runs=(previous.runs if previous else 0) + 1,
        total_pages=(previous.total_pages if previous else 0) + len(pages_read),
        updated_at=time.time(),
    )
    try:
        _state_file(settings, entity_type, entity_id, entry_url).write_text(
            json.dumps(state.to_dict()), "utf-8",
        )
    except Exception:
        pass  # best-effort persistence — the crawl result is never lost over this
    return state


def clear_resume_state(
    entity_type: str,
    entity_id: str,
    entry_url: str,
    settings: Settings | None = None,
) -> bool:
    """Delete saved state (a site fully exhausted needs no resume file)."""
    settings = settings or get_settings()
    f = _state_file(settings, entity_type, entity_id, entry_url)
    try:
        if f.exists():
            f.unlink()
            return True
    except Exception:
        pass
    return False

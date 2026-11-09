"""D220 S2 — one long-lived, self-healing browser for the whole worker.

Why this exists (D219 recon): fetcher.py used to start AND stop a full
Chromium for EVERY page. On Railway that churn eventually crashed Chromium
("BrowserContext.new_page: Target crashed"); the next browser start then hung
forever, holding the single-job lock, and the Tier 1 harvest sat dead for ~20
hours. This module replaces that with:

  • ONE shared crawl4ai ``AsyncWebCrawler`` per event loop, started once and
    reused by every page fetch (and by up to ``CRAWL_PARALLEL_PAGES`` fetches
    at the same time — politeness stays per-domain in fetcher.py).
  • Chromium flags that keep it alive in a container
    (``--disable-dev-shm-usage``, ``--no-sandbox``, ``--disable-gpu`` …),
    passed through ``BrowserConfig(extra_args=…)`` when the installed crawl4ai
    supports it (soft-degrades on old versions).
  • A HARD timeout on browser start (``CRAWL_BROWSER_START_TIMEOUT_SECONDS``).
  • Recycling: after ``CRAWL_BROWSER_RECYCLE_PAGES`` pages the browser is
    swapped for a fresh one (memory never creeps), WITHOUT interrupting pages
    already running on the old one — the old browser drains, then closes.
  • Crash restart: any fetch that fails with a crash-shaped error marks the
    browser broken; the next fetch gets a brand-new browser. A crash can never
    poison the rest of the run again.

Pure asyncio, no threads. Tests install a fake ``crawl4ai`` module; the pool
re-keys itself on the (event loop, AsyncWebCrawler class) pair, so every
``asyncio.run`` in the test-suite (and every monkeypatched fake) gets its own
browser instead of a stale one from a dead loop.
"""
from __future__ import annotations

import asyncio
import contextlib
import inspect
import logging
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from .config import Settings

log = logging.getLogger("greenway.crawler.browser")

# Flags that keep headless Chromium alive inside a container. /dev/shm is tiny
# (64 MB) on most container hosts — without --disable-dev-shm-usage big pages
# crash the renderer with exactly the "Target crashed" we saw on Railway.
CHROMIUM_FLAGS: tuple[str, ...] = (
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--mute-audio",
    "--no-first-run",
    "--js-flags=--max-old-space-size=1024",
)

# Error text that means "the browser itself is gone" (not "this page failed").
_CRASH_MARKERS: tuple[str, ...] = (
    "target crashed",
    "target closed",
    "browser has been closed",
    "browser closed",
    "has been closed",
    "connection closed",
    "browsercontext.new_page",
    "page crashed",
    "websocket",
    "pipe closed",
    "not connected",
    "playwright connection",
    "browser.new_context",
)


def is_crash_error(err: BaseException | str | None) -> bool:
    """True when an error message looks like the browser process died.

    Pure string check so it is unit-testable without a browser."""
    if err is None:
        return False
    text = str(err).lower()
    return any(m in text for m in _CRASH_MARKERS)


def build_crawler_kwargs(settings: Settings, crawl4ai_module: Any) -> dict:
    """The kwargs for ``AsyncWebCrawler(**kwargs)``.

    Prefers ``config=BrowserConfig(headless=True, extra_args=[flags], proxy=…)``
    when the installed crawl4ai has BrowserConfig (0.4.x+); every BrowserConfig
    kwarg is filtered against its real signature. Falls back to the legacy
    ``headless=True, verbose=False[, proxy=…]`` kwargs otherwise — exactly
    what fetcher.py used before D220, so very old installs keep working."""
    legacy: dict = {"headless": True, "verbose": False}
    if settings.proxy_url:
        legacy["proxy"] = settings.proxy_url
    browser_config_cls = getattr(crawl4ai_module, "BrowserConfig", None)
    if browser_config_cls is None:
        return legacy
    try:
        accepted = set(inspect.signature(browser_config_cls.__init__).parameters)
    except (TypeError, ValueError):  # pragma: no cover - C-extension oddities
        return legacy
    desired: dict = {
        "headless": True,
        "verbose": False,
        "extra_args": list(CHROMIUM_FLAGS),
        "text_mode": False,
        "light_mode": True,
    }
    if settings.proxy_url:
        desired["proxy"] = settings.proxy_url
    filtered = {k: v for k, v in desired.items() if k in accepted}
    if "extra_args" not in filtered:
        return legacy  # nothing gained over the legacy path
    try:
        cfg = browser_config_cls(**filtered)
    except Exception:  # pragma: no cover - defensive
        return legacy
    return {"config": cfg}


@dataclass
class _Lease:
    crawler: Any
    generation: int
    users: int = 0
    pages: int = 0
    started_at: float = field(default_factory=time.time)
    retiring: bool = False
    broken: bool = False


class BrowserPool:
    """A single shared browser (plus at most one draining predecessor)."""

    def __init__(self) -> None:
        self._key: tuple[int, int] | None = None
        self._lease: _Lease | None = None
        self._lock: asyncio.Lock | None = None
        self._sem: asyncio.Semaphore | None = None
        self._generation = 0
        self.starts = 0
        self.crashes = 0
        self.recycles = 0
        self.last_error = ""

    # ---- keying: one pool state per (loop, crawler class) --------------------
    def _rekey(self, crawler_cls: Any, settings: Settings) -> None:
        loop = asyncio.get_running_loop()
        key = (id(loop), id(crawler_cls))
        if key != self._key:
            # A new loop (asyncio.run in tests / a restarted worker) or a new
            # fake class: never reuse a browser bound to a dead loop.
            self._key = key
            self._lease = None
            self._lock = asyncio.Lock()
            self._sem = asyncio.Semaphore(max(1, int(settings.crawl_parallel_pages)))

    async def _start(self, crawler_cls: Any, crawl4ai_module: Any, settings: Settings) -> _Lease:
        kwargs = build_crawler_kwargs(settings, crawl4ai_module)
        crawler = crawler_cls(**kwargs)
        timeout = max(5.0, float(settings.crawl_browser_start_timeout_seconds))
        start = getattr(crawler, "start", None)
        if callable(start):
            await asyncio.wait_for(start(), timeout=timeout)
        else:
            await asyncio.wait_for(crawler.__aenter__(), timeout=timeout)
        self._generation += 1
        self.starts += 1
        log.info("browser: started generation %d (%s)", self._generation,
                 "BrowserConfig" if "config" in kwargs else "legacy kwargs")
        return _Lease(crawler=crawler, generation=self._generation)

    @staticmethod
    async def _close(lease: _Lease) -> None:
        crawler = lease.crawler
        try:
            close = getattr(crawler, "close", None)
            if callable(close):
                await asyncio.wait_for(close(), timeout=20)
            else:
                await asyncio.wait_for(crawler.__aexit__(None, None, None), timeout=20)
        except Exception as e:  # pragma: no cover - best effort teardown
            log.warning("browser: close of generation %d failed: %s", lease.generation, e)

    async def _maybe_close(self, lease: _Lease) -> None:
        if (lease.retiring or lease.broken) and lease.users == 0:
            await self._close(lease)

    @contextlib.asynccontextmanager
    async def session(self, crawler_cls: Any, crawl4ai_module: Any, settings: Settings) -> AsyncIterator[Any]:
        """Borrow the shared browser for one page fetch.

        Usage::

            async with pool.session(AsyncWebCrawler, crawl4ai, settings) as crawler:
                await crawler.arun(...)

        Raises whatever the browser start raised (incl. asyncio.TimeoutError);
        the caller treats that like any failed browser fetch (httpx fallback).
        """
        self._rekey(crawler_cls, settings)
        assert self._lock is not None and self._sem is not None
        async with self._sem:
            async with self._lock:
                lease = self._lease
                if lease is None or lease.broken or lease.retiring:
                    lease = await self._start(crawler_cls, crawl4ai_module, settings)
                    self._lease = lease
                lease.users += 1
                lease.pages += 1
                recycle_after = int(settings.crawl_browser_recycle_pages)
                if recycle_after > 0 and lease.pages >= recycle_after:
                    # This page still runs on the old browser; the NEXT page
                    # gets a fresh one. The old one closes once it drains.
                    lease.retiring = True
                    self.recycles += 1
                    log.info("browser: recycling generation %d after %d pages",
                             lease.generation, lease.pages)
            try:
                yield lease.crawler
            except BaseException as e:
                if is_crash_error(e):
                    self.mark_broken(lease, e)
                raise
            finally:
                lease.users -= 1
                await self._maybe_close(lease)

    def mark_broken(self, lease_or_none: _Lease | None = None, err: BaseException | str | None = None) -> None:
        """Flag the current browser dead; the next session starts a new one."""
        lease = lease_or_none or self._lease
        if lease is None or lease.broken:
            return
        lease.broken = True
        self.crashes += 1
        self.last_error = str(err or "")[:300]
        log.warning("browser: generation %d marked broken (%s) — next fetch restarts it",
                    lease.generation, self.last_error or "crash")

    def mark_current_broken(self, err: BaseException | str | None = None) -> None:
        self.mark_broken(self._lease, err)

    async def shutdown(self) -> None:
        lease, self._lease = self._lease, None
        if lease is not None:
            await self._close(lease)

    def stats(self) -> dict:
        lease = self._lease
        return {
            "generation": lease.generation if lease else 0,
            "pages_on_current": lease.pages if lease else 0,
            "active_pages": lease.users if lease else 0,
            "starts": self.starts,
            "crashes": self.crashes,
            "recycles": self.recycles,
            "last_error": self.last_error,
        }


# The worker-wide pool.
POOL = BrowserPool()

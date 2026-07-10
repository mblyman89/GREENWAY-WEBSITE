"""Slice C4 — crawl completeness validation + coverage report (PURE, no I/O).

The owner's requirement (docs/ROADMAP_CRAWLER_POWERHOUSE.md): "I want it to
take its time and get everything and somehow validate that it has gotten
everything."

Two complementary signals, computed WITHOUT any extra fetches so they work
identically on the crawl4ai and httpx paths:

1. **Frontier accounting** — every same-site link discovered during the crawl
   is tracked by ``CrawlFrontier`` (enqueued / boring / off-site / duplicate).
   After the crawl we know exactly how many discovered pages were read, how
   many failed, and how many were still queued when the budget ran out. A
   non-empty leftover queue is the honest "you did NOT see everything" signal
   (and names the fix: raise CRAWL_MAX_PAGES / the harvest per-site override).

2. **Content saturation** — the same idea as crawl4ai's AdaptiveCrawler
   confidence, implemented pure: each fetched page reports how much NEW
   content it added (unseen text lines + unseen image URLs vs. everything seen
   so far). When the last pages add almost nothing new, the site's content is
   saturated — strong evidence the crawl captured what matters even if a few
   deep links were left unread.

Everything lands in one ``CrawlCoverage`` snapshot that becomes (a) a
``research_coverage`` reference draft a human can read at review time, and
(b) a machine-readable dict on the API response / harvest target state.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# A page whose novelty ratio is below this adds "almost nothing new".
LOW_NOVELTY = 0.15
# How many of the LAST pages the saturation signal averages over.
SATURATION_WINDOW = 3


def _content_lines(text: str) -> set[str]:
    """Normalize page text to a set of comparable content lines."""
    out: set[str] = set()
    for raw in (text or "").splitlines():
        line = re.sub(r"\s+", " ", raw).strip().lower()
        if len(line) >= 20:  # ignore stubs/nav crumbs; keep real sentences
            out.add(line)
    return out


class SaturationTracker:
    """Per-page new-content accounting across a crawl (order matters).

    ``observe_page`` returns the page's novelty ratio: the fraction of its
    content lines + image URLs that the crawl had NOT seen on any earlier
    page. 1.0 = an entirely new page; 0.0 = pure repetition (shared template,
    same catalog re-rendered, ...).
    """

    def __init__(self) -> None:
        self._seen_lines: set[str] = set()
        self._seen_images: set[str] = set()
        self.ratios: list[float] = []

    def observe_page(self, text: str, image_urls: list[str] | None = None) -> float:
        lines = _content_lines(text)
        images = {u.strip() for u in (image_urls or []) if u and u.strip()}
        total = len(lines) + len(images)
        if total == 0:
            ratio = 0.0
        else:
            new = len(lines - self._seen_lines) + len(images - self._seen_images)
            ratio = round(new / total, 3)
        self._seen_lines |= lines
        self._seen_images |= images
        self.ratios.append(ratio)
        return ratio

    @property
    def saturation(self) -> float | None:
        """Average novelty of the last ``SATURATION_WINDOW`` SUB-pages.

        The entry page is excluded — it is 100% novel by definition (nothing
        was seen before it), so counting it would mask a saturated site on
        short crawls. ``None`` until at least one sub-page was observed."""
        sub = self.ratios[1:]
        if not sub:
            return None
        window = sub[-SATURATION_WINDOW:]
        return round(sum(window) / len(window), 3)

    @property
    def saturated(self) -> bool:
        s = self.saturation
        return s is not None and s < LOW_NOVELTY


@dataclass
class CrawlCoverage:
    """One crawl's completeness snapshot — the 'did we get everything?' answer."""

    entry_url: str
    page_budget: int
    pages_crawled: int
    pages_failed: list[str] = field(default_factory=list)
    queued_leftover: int = 0            # discovered pages NOT read (budget ran out)
    frontier: dict = field(default_factory=dict)  # FrontierStats.as_dict()
    novelty_ratios: list[float] = field(default_factory=list)
    saturation: float | None = None     # avg novelty of the last pages
    saturated: bool = False

    # ---- assessment -----------------------------------------------------------
    @property
    def site_exhausted(self) -> bool:
        return self.queued_leftover == 0

    @property
    def assessment(self) -> str:
        """One honest sentence a reviewer can act on."""
        if self.site_exhausted and not self.pages_failed:
            return (
                "COMPLETE — every discovered same-site page was read; "
                "the queue is empty."
            )
        if self.site_exhausted and self.pages_failed:
            return (
                f"COMPLETE WITH GAPS — the queue is empty but "
                f"{len(self.pages_failed)} page(s) failed to fetch "
                f"(listed below); re-run to retry them."
            )
        if self.saturated:
            return (
                f"SATURATED — the budget ran out with {self.queued_leftover} "
                f"page(s) still queued, but the last pages added almost no new "
                f"content (novelty {self.saturation}); the site is likely "
                f"fully captured."
            )
        return (
            f"BUDGET REACHED — {self.queued_leftover} discovered page(s) were "
            f"NOT read. Raise CRAWL_MAX_PAGES (or the harvest per-site "
            f"override) and re-run to read them."
        )

    def as_dict(self) -> dict:
        return {
            "entry_url": self.entry_url,
            "page_budget": self.page_budget,
            "pages_crawled": self.pages_crawled,
            "pages_failed": list(self.pages_failed),
            "queued_leftover": self.queued_leftover,
            "frontier": dict(self.frontier),
            "novelty_ratios": list(self.novelty_ratios),
            "saturation": self.saturation,
            "saturated": self.saturated,
            "site_exhausted": self.site_exhausted,
            "assessment": self.assessment,
        }

    def draft_text(self) -> str:
        """Human-readable coverage report for the research_coverage draft."""
        f = self.frontier
        lines = [
            f"Crawl coverage — {self.entry_url}",
            f"Assessment: {self.assessment}",
            f"Pages read: {self.pages_crawled} (budget {self.page_budget})",
        ]
        if f:
            lines.append(
                f"Links discovered on-site: {f.get('discovered', 0)} unique — "
                f"{f.get('enqueued', 0)} queued, "
                f"{f.get('duplicates', 0)} duplicate(s), "
                f"{f.get('dropped_boring', 0)} boring (cart/login/privacy/…), "
                f"{f.get('dropped_offsite', 0)} off-site"
            )
        if self.queued_leftover:
            lines.append(f"Still queued when the budget ran out: {self.queued_leftover} page(s)")
        if self.saturation is not None:
            state = "saturated — little new content" if self.saturated else "still yielding new content"
            lines.append(f"Content novelty of the last pages: {self.saturation} ({state})")
        if self.pages_failed:
            lines.append(f"Failed pages ({len(self.pages_failed)}):")
            lines.extend(f"  • {u}" for u in self.pages_failed[:20])
        return "\n".join(lines)


def build_coverage(
    *,
    entry_url: str,
    page_budget: int,
    pages_crawled: int,
    pages_failed: list[str],
    queued_leftover: int,
    frontier_stats: dict,
    tracker: SaturationTracker,
) -> CrawlCoverage:
    """Assemble the coverage snapshot from the pieces the pipeline tracked."""
    return CrawlCoverage(
        entry_url=entry_url,
        page_budget=page_budget,
        pages_crawled=pages_crawled,
        pages_failed=list(pages_failed),
        queued_leftover=queued_leftover,
        frontier=dict(frontier_stats),
        novelty_ratios=list(tracker.ratios),
        saturation=tracker.saturation,
        saturated=tracker.saturated,
    )

"""D220 S4 — crawl CAMPAIGNS: keep crawling until every site is complete.

Owner (D220): "make the new vendor crawler so much more amazing … as much
detail as possible for our vendor profiles … tag and label and catalog
everything so it is easy to match images to product cards … as incredibly
intelligent as possible."

A campaign is a durable (database-backed, migration 0351) list of sites. Each
site is crawled in SLICES of CAMPAIGN_SLICE_PAGES pages; after every slice the
frontier (visited + still-queued URLs) is saved on the site row, so a redeploy,
crash or watchdog restart continues exactly where it stopped. A site is
finished when its frontier is EMPTY (complete) or it reaches
CAMPAIGN_MAX_PAGES_PER_SITE (partial — honest about it).

Per site, in order:
  1. FEEDS   — Shopify /products.json or WooCommerce Store API: the whole
               public catalog, including products the HTML crawl can't reach
               (D219's "false COMPLETE"). Feed product URLs join the frontier.
  2. CRAWL   — slice after slice through research_target (robots.txt, SSRF
               guard, allow-list, per-domain delay all unchanged). Every page
               read is CATALOGUED as it arrives: page type, title, h1, product
               names, JSON-LD products, size/category/strain/THC hints, text
               excerpt → kb_crawl_pages; every image with the text printed next
               to it, a heuristic role (product / packaging / logo / …) and a
               product guess → kb_crawl_images.
  3. PAGE AI — product/strain pages get a small structured fact extraction
               (product names, sizes, lineage, aroma/flavor, potency).
  4. VISION  — images are looked at by the vision model in batches of 4 with
               the vendor's own product list as candidates: role, exact product
               name, packaging text, colors, tags.
  5. MATCH   — every image is scored against the vendor's kb_products cards
               (name + category + size); ≥0.6 becomes a SUGGESTED link a human
               confirms in the back office. Confirmed/rejected are never touched.
  6. DRAFTS  — one whole-site synthesis (about / mission / lineup / research
               text / images / logos / social) over EVERY page read, written as
               pending drafts exactly like /research; verified product lines +
               feed products become kb_products DRAFT rows tied to the vendor.

Nothing is published automatically — every output is a draft or a suggestion.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from typing import Any
from urllib.parse import urlparse

from . import ai_client
from .campaign_feeds import FeedProduct, FeedResult, read_feeds
from .campaign_store import MAX_FRONTIER, SITE_TERMINAL, get_store, now_iso
from .catalog import (
    PageInfo,
    ProductRef,
    classify_page,
    detect_category,
    detect_size,
    filename_words,
    match_image,
    match_status_for,
    name_similarity,
    normalize_name,
    tag_image,
)
from .config import Settings, get_settings
from .fetcher import FetchResult, allow_hosts
from .frontier import registrable_host
from .image_urls import is_placeholder_url
from .page_intelligence import extract_image_contexts
from .resume_state import ResumeState
from .schemas import ProductLine

log = logging.getLogger("crawler.campaign")

MAX_SITES_PER_CAMPAIGN = 500
VISION_BATCH = 4
_PAGE_PRIORITY = {"about": 0, "home": 1, "product_list": 2, "strain": 3, "product": 4, "faq": 5,
                  "where_to_buy": 6, "blog": 7, "lab_results": 8, "contact": 9, "other": 10,
                  "careers": 11, "legal": 12}
_NON_PRODUCT_ROLES = ("logo", "icon", "banner", "team", "facility")

# Live state (one worker process).
_tasks: dict[str, asyncio.Task] = {}
_cancel: dict[str, bool] = {}
_heartbeat: dict[str, float] = {}
_stall_flags: dict[str, int] = {}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
_HOST_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$")


def host_of(url: str) -> str:
    return registrable_host(urlparse(url).netloc)


def _beat(campaign_id: str) -> None:
    _heartbeat[campaign_id] = time.time()


async def _st(fn, *args, **kwargs):
    """Run a (sync) store call off the event loop."""
    return await asyncio.to_thread(fn, *args, **kwargs)


def _opt(campaign: dict, key: str, default: Any) -> Any:
    opts = campaign.get("options") or {}
    v = opts.get(key)
    return default if v is None else v


def normalize_targets(targets: list[dict]) -> tuple[list[dict], list[dict]]:
    """Validate + dedupe targets by host. Returns (sites, skipped)."""
    sites: list[dict] = []
    skipped: list[dict] = []
    seen_hosts: set[str] = set()
    for t in targets:
        url = str(t.get("url") or t.get("entry_url") or "").strip()
        if url and "://" not in url:
            url = "https://" + url
        p = urlparse(url)
        host = host_of(url) if p.netloc else ""
        if p.scheme not in ("http", "https") or not _HOST_RE.match(host):
            skipped.append({**t, "reason": "no usable website"})
            continue
        if host in seen_hosts:
            skipped.append({**t, "reason": f"duplicate website {host}"})
            continue
        seen_hosts.add(host)
        etype = str(t.get("entity_type") or "vendor")
        eid = str(t.get("entity_id") or t.get("vendor_id") or "").strip()
        if not eid:
            skipped.append({**t, "reason": "missing entity id"})
            continue
        sites.append({
            "entity_type": etype,
            "entity_id": eid,
            "vendor_id": str(t.get("vendor_id") or (eid if etype == "vendor" else "")) or None,
            "display_name": str(t.get("display_name") or t.get("name") or host)[:200],
            "entry_url": url,
            "host": host,
        })
        if len(sites) >= MAX_SITES_PER_CAMPAIGN:
            break
    return sites, skipped


# ---------------------------------------------------------------------------
# Public API (used by main.py)
# ---------------------------------------------------------------------------
async def start_campaign(
    *,
    label: str,
    scope: str,
    targets: list[dict],
    options: dict | None = None,
    settings: Settings | None = None,
) -> dict:
    settings = settings or get_settings()
    sites, skipped = normalize_targets(targets)
    if not sites:
        raise ValueError("no crawlable websites in the target list")
    store = get_store(settings)
    opts = dict(options or {})
    opts["skipped"] = skipped[:200]
    camp = await _st(store.create_campaign, label=label or "Crawl campaign", scope=scope, options=opts, sites=sites)
    allow_hosts([s["host"] for s in sites])
    schedule_campaign(camp["id"], settings)
    return camp


def schedule_campaign(campaign_id: str, settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    task = _tasks.get(campaign_id)
    if task is not None and not task.done():
        return False
    _cancel[campaign_id] = False
    loop = asyncio.get_running_loop()
    _tasks[campaign_id] = loop.create_task(run_campaign(campaign_id, settings))
    _beat(campaign_id)
    return True


async def cancel_campaign(campaign_id: str, settings: Settings | None = None) -> dict | None:
    settings = settings or get_settings()
    store = get_store(settings)
    camp = await _st(store.get_campaign, campaign_id)
    if camp is None:
        return None
    _cancel[campaign_id] = True
    await _st(store.update_campaign, campaign_id, {"cancel_requested": True})
    task = _tasks.get(campaign_id)
    if task is None or task.done():
        # Nothing running in this process — settle the rows now.
        for s in await _st(store.list_sites, campaign_id):
            if s["status"] not in SITE_TERMINAL:
                await _st(store.update_site, s["id"], {"status": "cancelled", "stopped_reason": "cancelled"})
        await _st(store.update_campaign, campaign_id, {"status": "cancelled", "finished_at": now_iso()})
    return await _st(store.get_campaign, campaign_id)


async def resume_campaign(campaign_id: str, settings: Settings | None = None, *, retry_failed: bool = True) -> dict | None:
    settings = settings or get_settings()
    store = get_store(settings)
    camp = await _st(store.get_campaign, campaign_id)
    if camp is None:
        return None
    task = _tasks.get(campaign_id)
    if task is not None and not task.done():
        return camp  # already running
    reopen = {"cancelled", "running", "analyzing"} | ({"failed"} if retry_failed else set())
    for s in await _st(store.list_sites, campaign_id):
        if s["status"] in reopen:
            patch: dict = {"status": "queued", "last_error": None}
            if s["status"] == "failed":
                patch["attempts"] = 0
            await _st(store.update_site, s["id"], patch)
    await _st(store.update_campaign, campaign_id,
              {"status": "queued", "cancel_requested": False, "finished_at": None, "last_error": None})
    schedule_campaign(campaign_id, settings)
    return await _st(store.get_campaign, campaign_id)


def campaign_running(campaign_id: str) -> bool:
    t = _tasks.get(campaign_id)
    return t is not None and not t.done()


async def resume_active_campaigns(settings: Settings | None = None) -> list[str]:
    """Startup / watchdog: any queued or running campaign with no live task is
    (re)scheduled — the durable frontier makes this an exact continuation."""
    settings = settings or get_settings()
    if not settings.campaign_enabled or not settings.campaign_auto_resume:
        return []
    store = get_store(settings)
    try:
        active = await _st(store.active_campaigns)
    except Exception as e:  # noqa: BLE001 — table may not exist before 0351 is applied
        log.info("campaign resume skipped: %s", e)
        return []
    started: list[str] = []
    for camp in active:
        if camp.get("cancel_requested"):
            continue
        if campaign_running(camp["id"]):
            continue
        if camp.get("status") == "running" and heartbeat_is_fresh(camp.get("worker_heartbeat_at"), settings):
            # Another worker (e.g. the old container during a rolling deploy)
            # is still driving it — leave it alone; we'll look again later.
            continue
        try:
            sites = await _st(store.list_sites, camp["id"])
            allow_hosts([s["host"] for s in sites if s.get("host")])
        except Exception:  # noqa: BLE001
            continue
        if schedule_campaign(camp["id"], settings):
            started.append(camp["id"])
            log.info("campaign %s: resumed automatically", camp["id"])
    return started


def heartbeat_is_fresh(value: Any, settings: Settings, *, now: float | None = None) -> bool:
    if not value:
        return False
    try:
        from datetime import datetime
        t = datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except Exception:
        return False
    now = time.time() if now is None else now
    return (now - t) < max(120.0, float(settings.crawl_stall_seconds) / 2)


def campaign_watchdog_tick(settings: Settings | None = None, *, now: float | None = None) -> list[dict]:
    """Same two-step cure as the harvest watchdog: a silent campaign first gets
    a fresh browser; if it stays silent its task is cancelled (sites go back to
    queued with their frontier intact) and resume_active_campaigns restarts it."""
    from .browser_pool import POOL

    settings = settings or get_settings()
    now = time.time() if now is None else now
    stall = max(30.0, float(settings.crawl_stall_seconds))
    actions: list[dict] = []
    for cid, beat in list(_heartbeat.items()):
        task = _tasks.get(cid)
        if task is None or task.done():
            _heartbeat.pop(cid, None)
            _stall_flags.pop(cid, None)
            continue
        quiet = now - beat
        if quiet <= stall:
            _stall_flags.pop(cid, None)
            continue
        level = _stall_flags.get(cid, 0)
        if quiet > 2 * stall and level < 2:
            task.cancel()
            _stall_flags[cid] = 2
            actions.append({"campaign_id": cid, "action": "cancelled_task", "quiet_s": round(quiet)})
            log.error("watchdog: campaign %s silent %.0fs — task cancelled (will resume)", cid, quiet)
        elif level < 1:
            POOL.mark_current_broken(f"watchdog: campaign {cid} silent {quiet:.0f}s")
            _stall_flags[cid] = 1
            actions.append({"campaign_id": cid, "action": "browser_recycled", "quiet_s": round(quiet)})
    return actions


def campaign_heartbeats(now: float | None = None) -> dict:
    now = time.time() if now is None else now
    return {cid: round(now - b, 1) for cid, b in _heartbeat.items()}


async def shutdown_campaigns() -> None:
    """Redeploy/stop: cancel live campaign tasks so their rows go back to
    'queued' immediately (the next container resumes them at once)."""
    live = [t for t in _tasks.values() if not t.done()]
    for t in live:
        t.cancel()
    for t in live:
        try:
            await asyncio.wait_for(t, timeout=15)
        except BaseException:  # noqa: BLE001
            pass


def reset_for_tests() -> None:
    for t in _tasks.values():
        if not t.done():
            t.cancel()
    _tasks.clear()
    _cancel.clear()
    _heartbeat.clear()
    _stall_flags.clear()


# ---------------------------------------------------------------------------
# Campaign loop
# ---------------------------------------------------------------------------
def _usage_snapshot() -> dict:
    return dict(ai_client.USAGE.as_dict())


def _usage_delta(before: dict, after: dict) -> dict:
    out: dict = {}
    for k in ("calls", "failures", "input_tokens", "output_tokens", "web_searches", "images"):
        out[k] = int(after.get(k, 0) or 0) - int(before.get(k, 0) or 0)
    return out


def summarize_sites(sites: list[dict]) -> dict:
    totals: dict = {"sites": len(sites)}
    for s in sites:
        st = s.get("status") or "queued"
        totals[st] = totals.get(st, 0) + 1
    for k in ("pages_read", "pages_failed", "images_found", "images_tagged", "images_matched",
              "products_found", "drafts_written", "products_written"):
        totals[k] = sum(int(s.get(k) or 0) for s in sites)
    return totals


async def run_campaign(campaign_id: str, settings: Settings) -> None:
    store = get_store(settings)
    camp = await _st(store.get_campaign, campaign_id)
    if camp is None:
        return
    usage_before = _usage_snapshot()
    prior_usage = camp.get("ai_usage") or {}
    await _st(store.update_campaign, campaign_id, {
        "status": "running", "started_at": camp.get("started_at") or now_iso(),
        "worker_heartbeat_at": now_iso(),
    })
    sites = await _st(store.list_sites, campaign_id)
    allow_hosts([s["host"] for s in sites if s.get("host")])
    sem = asyncio.Semaphore(max(1, int(_opt(camp, "parallel_sites", settings.campaign_parallel_sites))))

    async def _one(site: dict) -> None:
        async with sem:
            if _cancel.get(campaign_id):
                return
            try:
                await run_site(camp, site, settings)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 — one bad site never kills the campaign
                log.exception("campaign %s: site %s crashed", campaign_id, site.get("host"))
                await _st(store.update_site, site["id"], {
                    "status": "failed", "last_error": f"{type(e).__name__}: {e}"[:500], "finished_at": now_iso(),
                })
            finally:
                _beat(campaign_id)
                try:
                    fresh = await _st(store.list_sites, campaign_id)
                    await _st(store.update_campaign, campaign_id, {
                        "totals": summarize_sites(fresh), "worker_heartbeat_at": now_iso(),
                    })
                except Exception:  # noqa: BLE001
                    pass

    todo = [s for s in sites if s.get("status") not in SITE_TERMINAL]
    try:
        await asyncio.gather(*[_one(s) for s in todo])
    except asyncio.CancelledError:
        # Watchdog/shutdown: leave the campaign ACTIVE so it auto-resumes.
        await _st(store.update_campaign, campaign_id, {"status": "queued", "worker_heartbeat_at": now_iso()})
        raise

    fresh = await _st(store.list_sites, campaign_id)
    cancelled = bool(_cancel.get(campaign_id))
    if cancelled:
        for s in fresh:
            if s["status"] not in SITE_TERMINAL:
                await _st(store.update_site, s["id"], {"status": "cancelled", "stopped_reason": "cancelled"})
        fresh = await _st(store.list_sites, campaign_id)
    delta = _usage_delta(usage_before, _usage_snapshot())
    merged_usage = {k: int(prior_usage.get(k, 0) or 0) + v for k, v in delta.items()}
    await _st(store.update_campaign, campaign_id, {
        "status": "cancelled" if cancelled else "completed",
        "finished_at": now_iso(),
        "totals": summarize_sites(fresh),
        "ai_usage": merged_usage,
        "worker_heartbeat_at": now_iso(),
    })
    _heartbeat.pop(campaign_id, None)
    log.info("campaign %s finished (%s)", campaign_id, "cancelled" if cancelled else "completed")


# ---------------------------------------------------------------------------
# One site
# ---------------------------------------------------------------------------
class SiteRun:
    """Per-site working state for the cataloguing hook."""

    def __init__(self, camp: dict, site: dict, settings: Settings) -> None:
        self.camp = camp
        self.site = site
        self.settings = settings
        self.store = get_store(settings)
        self.read_urls: set[str] = set()
        self.failed_urls: set[str] = set()
        self.images: dict[str, dict] = {}   # image_url -> {"has_product", "vision"}
        self.last_site_write = 0.0
        self.pages_since_write = 0

    @property
    def cid(self) -> str:
        return self.camp["id"]

    def should_stop(self) -> bool:
        return bool(_cancel.get(self.cid))

    async def load(self) -> None:
        for p in await _st(self.store.list_pages, self.site["id"]):
            if p.get("url"):
                self.read_urls.add(p["url"])
        for im in await _st(self.store.list_images, self.site["id"]):
            self.images[im["image_url"]] = {"has_product": bool(im.get("product_name")),
                                            "vision": bool(im.get("vision_at"))}

    # ---- the per-page catalogue hook ---------------------------------------
    async def on_page(self, url: str, page: FetchResult) -> None:
        _beat(self.cid)
        info = await asyncio.to_thread(
            classify_page, url, page.html or "", page.markdown or "", entry_url=self.site["entry_url"],
        )
        page_row = page_row_for(self.site, info, page, source="crawl")
        img_rows = await asyncio.to_thread(self.image_rows_for_page, url, page, info)
        page_row["image_count"] = len(img_rows)
        await _st(self.store.upsert_pages, [page_row])
        if img_rows:
            await _st(self.store.upsert_images, img_rows)
        self.read_urls.add(url)
        self.pages_since_write += 1
        now = time.time()
        if self.pages_since_write >= 5 or now - self.last_site_write > 15:
            self.pages_since_write = 0
            self.last_site_write = now
            await _st(self.store.update_site, self.site["id"], {
                "current_url": url[:1000], "pages_read": len(self.read_urls), "images_found": len(self.images),
            })
            await _st(self.store.update_campaign, self.cid, {"worker_heartbeat_at": now_iso()})

    def image_rows_for_page(self, url: str, page: FetchResult, info: PageInfo) -> list[dict]:
        contexts = extract_image_contexts(page.html or "", url) if page.html else []
        by_url: dict[str, Any] = {}
        for c in contexts:
            by_url.setdefault(c.url, c)
        rows: list[dict] = []
        candidates: list[tuple[str, Any]] = [(u, c) for u, c in by_url.items()]
        for u in page.image_urls or []:
            if u not in by_url:
                candidates.append((u, None))
        if info.og_image and info.og_image not in by_url:
            candidates.append((info.og_image, None))
        for img_url, ctx in candidates:
            if not img_url.startswith(("http://", "https://")) or is_placeholder_url(img_url):
                continue
            tags = tag_image(
                url=img_url,
                alt=getattr(ctx, "alt", "") or "",
                caption=getattr(ctx, "caption", "") or "",
                heading=getattr(ctx, "heading", "") or "",
                nearby_text=getattr(ctx, "nearby_text", "") or "",
                jsonld_name=getattr(ctx, "jsonld_name", "") or "",
                page=info,
                vendor_name=self.site.get("display_name") or "",
            )
            prev = self.images.get(img_url)
            if prev is not None:
                # Re-seen: only upgrade a context-less, un-vision'd entry with a
                # better (product-naming) context; never clobber vision labels.
                if prev["vision"] or prev["has_product"] or not tags.product_name:
                    continue
            rows.append(image_row_for(self.site, page_url=url, image_url=img_url, ctx=ctx, tags=tags, source="crawl"))
            self.images[img_url] = {"has_product": bool(tags.product_name), "vision": False}
        return rows


def page_row_for(site: dict, info: PageInfo, page: FetchResult | None, *, source: str) -> dict:
    text = info.excerpt or ""
    return {
        "site_id": site["id"],
        "campaign_id": site["campaign_id"],
        "vendor_id": site.get("vendor_id"),
        "url": info.url[:2000],
        "page_type": info.page_type,
        "title": info.title or None,
        "h1": info.h1 or None,
        "text_excerpt": text[:6000] or None,
        "word_count": info.word_count,
        "product_names": [n[:200] for n in info.product_names[:200]],
        "image_count": 0,
        "status_code": (page.status or None) if page is not None else None,
        "from_cache": bool(page.from_cache) if page is not None else False,
        "source": source,
        "ai_facts": {"heuristic": {
            "category": info.category, "size": info.size, "strain_type": info.strain_type,
            "thc_percent": info.thc_percent, "primary_product": info.primary_product,
            "jsonld_products": info.jsonld_products[:50], "og_image": info.og_image,
        }},
        "content_hash": hashlib.sha1(text.encode("utf-8", "ignore")).hexdigest() if text else None,
        "fetched_at": now_iso(),
    }


def image_row_for(site: dict, *, page_url: str, image_url: str, ctx: Any, tags: Any, source: str) -> dict:
    def g(name: str) -> str | None:
        v = (getattr(ctx, name, "") or "") if ctx is not None else ""
        return v[:1000] or None

    return {
        "site_id": site["id"],
        "campaign_id": site["campaign_id"],
        "vendor_id": site.get("vendor_id"),
        "page_url": page_url[:2000],
        "image_url": image_url[:2000],
        "alt": g("alt"),
        "caption": g("caption"),
        "heading": g("heading"),
        "nearby_text": g("nearby_text"),
        "jsonld_name": g("jsonld_name"),
        "context": tags.context or None,
        "source": source,
        "role": tags.role,
        "role_confidence": round(min(0.99, max(0.0, tags.role_confidence)), 2),
        "product_name": tags.product_name or None,
        "brand_name": (site.get("display_name") or None),
        "strain_name": tags.strain_name or None,
        "category": tags.category or None,
        "variant_label": tags.variant_label or None,
        "tags": tags.tags,
    }


# ---------------------------------------------------------------------------
# Feeds → catalogue
# ---------------------------------------------------------------------------
class _FeedCtx:
    def __init__(self, alt: str, heading: str, nearby: str) -> None:
        self.alt = alt
        self.caption = ""
        self.heading = heading
        self.nearby_text = nearby
        self.jsonld_name = heading


def feed_rows(site: dict, feed: FeedResult) -> tuple[list[dict], list[dict]]:
    """Catalogue rows for every feed product (page) and its images."""
    pages: list[dict] = []
    images: list[dict] = []
    source = feed.platform if feed.platform in ("shopify", "woocommerce") else "crawl"
    img_source = source
    seen_imgs: set[str] = set()
    for fp in feed.products:
        url = fp.url or f"{site['entry_url'].rstrip('/')}#feed-{normalize_name(fp.name).replace(' ', '-')}"
        text = fp.text()
        info = PageInfo(url=url, page_type="product", title=fp.name, h1=fp.name,
                        product_names=[fp.name], primary_product=fp.name,
                        category=detect_category(f"{fp.category} {fp.name} {' '.join(fp.tags)}"),
                        size=detect_size(" ".join(fp.variants[:3])) if len(fp.variants) == 1 else "",
                        excerpt=text[:6000], word_count=len(text.split()))
        row = page_row_for(site, info, None, source=source)
        row["ai_facts"]["feed"] = {"category": fp.category, "vendor": fp.vendor, "tags": fp.tags[:30],
                                   "variants": fp.variants[:30]}
        row["image_count"] = len(fp.images)
        pages.append(row)
        for i, im in enumerate(fp.images):
            if im.url in seen_imgs or is_placeholder_url(im.url):
                continue
            seen_imgs.add(im.url)
            tags = tag_image(url=im.url, alt=im.alt, heading=fp.name, jsonld_name=fp.name,
                             nearby_text=", ".join(fp.variants[:6]), page=info,
                             vendor_name=site.get("display_name") or "")
            if tags.role in ("unknown", "flower_closeup", "lifestyle", "packaging") and not tags.product_name:
                tags.product_name = fp.name
            if i == 0 and "primary" not in tags.tags:
                tags.tags.append("primary")
            images.append(image_row_for(site, page_url=url, image_url=im.url,
                                        ctx=_FeedCtx(im.alt, fp.name, ", ".join(fp.variants[:6])),
                                        tags=tags, source=img_source))
    return pages, images


def feed_product_lines(feed_products: list[FeedProduct]) -> list[ProductLine]:
    out: list[ProductLine] = []
    for fp in feed_products:
        out.append(ProductLine(name=fp.name[:200], category=(fp.category or "")[:80]))
    return out


# ---------------------------------------------------------------------------
# AI steps
# ---------------------------------------------------------------------------
_PAGE_AI_SYSTEM = (
    "You catalogue cannabis brand websites for a licensed Washington retailer's internal product "
    "knowledge base. Extract ONLY facts literally stated in the page text. Never invent. Never "
    "describe effects or medical benefits. Return a JSON object."
)


def _page_ai_prompt(page: dict, vendor: str) -> str:
    return (
        f"Brand/vendor: {vendor}\nPage URL: {page.get('url')}\nPage type guess: {page.get('page_type')}\n"
        "Return JSON: {\"page_type\": one of home|about|product|product_list|strain|contact|blog|faq|"
        "lab_results|where_to_buy|legal|careers|other, \"products\": [{\"name\": exact product or strain "
        "name as printed, \"category\": flower|preroll|vape|concentrate|edible|beverage|tincture|topical|"
        "capsule|other, \"strain_type\": indica|sativa|hybrid|cbd|\"\", \"lineage\": genetics if stated, "
        "\"sizes\": [package sizes as printed], \"thc\": potency as printed, \"cbd\": as printed, "
        "\"aroma\": [descriptors], \"flavor\": [descriptors], \"terpenes\": [names]}], "
        "\"summary\": one factual sentence about the page}.\n\n=== PAGE TEXT ===\n"
        + (page.get("text_excerpt") or "")[:5500]
    )


async def page_ai_pass(run: SiteRun, *, vendor: str) -> list[ProductLine]:
    """Structured facts for product-ish pages. Returns verified ProductLines."""
    s = run.settings
    if not (s.ai_enabled and _opt(run.camp, "page_ai", s.campaign_page_ai_enabled)):
        return []
    cap = int(_opt(run.camp, "page_ai_max_pages", s.campaign_page_ai_max_pages))
    pages = await _st(run.store.list_pages, run.site["id"], page_types=("product", "strain", "product_list"))
    pages = [p for p in pages if (p.get("text_excerpt") or "").strip() and not (p.get("ai_facts") or {}).get("ai")]
    pages.sort(key=lambda p: {"product": 0, "strain": 1, "product_list": 2}.get(p.get("page_type"), 3))
    lines: list[ProductLine] = []
    for p in pages[:cap]:
        if run.should_stop():
            break
        _beat(run.cid)
        try:
            data = await ai_client.chat_json_async(s, _PAGE_AI_SYSTEM, _page_ai_prompt(p, vendor),
                                                   purpose="text", max_tokens=1200)
        except ai_client.AiUnavailable as e:
            log.info("page AI unavailable (%s) — stopping page AI for this site", e)
            break
        excerpt_norm = normalize_name(p.get("text_excerpt") or "")
        verified = []
        for item in (data.get("products") or [])[:40]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name or normalize_name(name) not in excerpt_norm:
                continue  # grounding: the name must literally be on the page
            verified.append(item)
            notes = ", ".join(str(x) for x in (item.get("aroma") or []) + (item.get("flavor") or []))[:300]
            lines.append(ProductLine(name=name[:200], category=str(item.get("category") or "")[:80],
                                     lineage=str(item.get("lineage") or "")[:200], notes=notes))
        facts = dict(p.get("ai_facts") or {})
        facts["ai"] = {"page_type": data.get("page_type"), "products": verified,
                       "summary": str(data.get("summary") or "")[:400]}
        patch: dict = {"ai_facts": facts}
        names = list(p.get("product_names") or [])
        for v in verified:
            if v["name"] not in names:
                names.append(v["name"][:200])
        patch["product_names"] = names[:200]
        if data.get("page_type") in ("product", "strain", "product_list") and data.get("page_type") != p.get("page_type"):
            patch["page_type"] = data["page_type"]
        await _st(run.store.update_page, p["id"], patch)
    return lines


_VISION_SYSTEM = (
    "You label product photos from a cannabis brand's own website for a licensed retailer's internal "
    "image library. Describe only what is visible. Never describe effects. Return a JSON object."
)


def _vision_prompt(batch: list[dict], vendor: str, product_names: list[str]) -> str:
    lines = [f"Brand/vendor: {vendor}"]
    if product_names:
        lines.append("Known products for this brand (use the exact name when the image clearly shows one): "
                     + "; ".join(product_names[:60]))
    lines.append("Images, in order:")
    for i, im in enumerate(batch, 1):
        ctx = im.get("context") or im.get("alt") or ""
        lines.append(f"{i}. page={im.get('page_url')} context=\"{ctx[:200]}\" file=\"{filename_words(im['image_url'])}\"")
    lines.append(
        "Return JSON {\"images\": [{\"index\": n, \"role\": product|packaging|flower_closeup|lifestyle|logo|"
        "banner|team|facility|lab_result|icon|other, \"product_name\": exact name or \"\", \"brand_name\": "
        "as printed or \"\", \"strain_name\": \"\", \"category\": flower|preroll|vape|concentrate|edible|"
        "beverage|tincture|topical|capsule|\"\", \"variant_label\": package size printed e.g. 3.5g or \"\", "
        "\"packaging_text\": legible text on the package (max 200 chars), \"colors\": [up to 4 dominant "
        "colors], \"tags\": [up to 8 short visual tags], \"confidence\": 0..1}]} — one entry per image."
    )
    return "\n".join(lines)


async def vision_pass(run: SiteRun, *, vendor: str, product_names: list[str]) -> int:
    s = run.settings
    if not (s.ai_enabled and _opt(run.camp, "vision", s.campaign_vision_enabled)):
        return 0
    cap = int(_opt(run.camp, "vision_max_images", s.campaign_vision_max_images_per_site))
    if cap <= 0:
        return 0
    imgs = await _st(run.store.list_images, run.site["id"])
    todo = [i for i in imgs if not i.get("vision_at") and i.get("role") not in ("icon", "logo")
            and not str(i.get("image_url", "")).lower().endswith(".svg")]
    # Most useful first: things that look like products, then unknowns.
    order = {"product": 0, "packaging": 1, "flower_closeup": 2, "unknown": 3, "lifestyle": 4}
    todo.sort(key=lambda i: (order.get(i.get("role") or "unknown", 5), 0 if i.get("product_name") else 1))
    todo = todo[:cap]
    labelled = 0
    model = (s.model_chain("vision") or [""])[0]
    for start in range(0, len(todo), VISION_BATCH):
        if run.should_stop():
            break
        _beat(run.cid)
        batch = todo[start:start + VISION_BATCH]
        try:
            data = await ai_client.chat_json_async(
                s, _VISION_SYSTEM, _vision_prompt(batch, vendor, product_names),
                purpose="vision", image_urls=[b["image_url"] for b in batch], max_tokens=1400,
            )
        except ai_client.AiUnavailable as e:
            # One unreadable image can fail a batch; retry them one at a time once.
            if len(batch) > 1 and "image" in str(e).lower():
                for single in batch:
                    try:
                        d1 = await ai_client.chat_json_async(
                            s, _VISION_SYSTEM, _vision_prompt([single], vendor, product_names),
                            purpose="vision", image_urls=[single["image_url"]], max_tokens=500,
                        )
                    except ai_client.AiUnavailable:
                        continue
                    labelled += await _apply_vision(run, [single], d1, model)
                continue
            log.info("vision unavailable (%s) — stopping vision for this site", e)
            break
        labelled += await _apply_vision(run, batch, data, model)
    return labelled


_ALLOWED_ROLES = ("product", "packaging", "flower_closeup", "lifestyle", "logo", "banner", "team",
                  "facility", "lab_result", "icon", "other")


async def _apply_vision(run: SiteRun, batch: list[dict], data: dict, model: str) -> int:
    n = 0
    items = data.get("images") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return 0
    for it in items:
        if not isinstance(it, dict):
            continue
        try:
            idx = int(it.get("index")) - 1
        except Exception:
            continue
        if idx < 0 or idx >= len(batch):
            continue
        im = batch[idx]
        role = str(it.get("role") or "").strip().lower()
        conf = it.get("confidence")
        try:
            conf_f = round(max(0.0, min(0.99, float(conf))), 2)
        except Exception:
            conf_f = 0.6
        tags = list(im.get("tags") or [])
        for t in (it.get("tags") or [])[:8]:
            t = str(t).strip().lower()[:40]
            if t and t not in tags:
                tags.append(t)
        patch: dict = {
            "vision_model": model or None,
            "vision_at": now_iso(),
            "tags": tags[:30],
            "colors": [str(c).strip().lower()[:30] for c in (it.get("colors") or [])[:4] if str(c).strip()],
        }
        if role in _ALLOWED_ROLES:
            patch["role"] = role
            patch["role_confidence"] = conf_f
        for key, limit in (("product_name", 200), ("brand_name", 200), ("strain_name", 200),
                           ("variant_label", 60), ("packaging_text", 400)):
            val = str(it.get(key) or "").strip()
            if val:
                patch[key] = val[:limit]
        cat = str(it.get("category") or "").strip().lower()
        if cat:
            patch["category"] = cat[:40]
        await _st(run.store.update_image, im["id"], patch)
        n += 1
    return n


# ---------------------------------------------------------------------------
# Matching images ↔ product cards
# ---------------------------------------------------------------------------
def product_refs(rows: list[dict], brand: str) -> list[ProductRef]:
    out: list[ProductRef] = []
    for r in rows:
        name = str(r.get("display_name") or "").strip()
        if not name:
            continue
        out.append(ProductRef(id=str(r["id"]), name=name, category=str(r.get("category") or ""),
                              variant_label=str(r.get("variant_label") or ""), brand=brand))
    return out


def match_one(image: dict, refs: list[ProductRef]) -> dict | None:
    """The match patch for one image, or None when nothing should change."""
    if image.get("match_status") in ("confirmed", "rejected"):
        return None  # a human decided — never touched again
    if image.get("role") in _NON_PRODUCT_ROLES:
        return None
    probe_name = image.get("product_name") or image.get("jsonld_name") or image.get("heading") or ""
    extra = " ".join(p for p in (image.get("packaging_text") or "", image.get("alt") or "",
                                 filename_words(image.get("image_url") or "")) if p)
    cands = match_image(product_name=probe_name, category=image.get("category") or "",
                        variant_label=image.get("variant_label") or "",
                        strain_name=image.get("strain_name") or "", extra_text=extra, products=refs, limit=3)
    if not cands:
        if image.get("match_status") == "suggested" or image.get("matched_kb_product_id"):
            return {"matched_kb_product_id": None, "match_score": None, "match_reason": None,
                    "match_candidates": [], "match_status": "unmatched"}
        return None
    best = cands[0]
    status = match_status_for(best.score)
    # Ambiguity guard: two near-identical candidates (e.g. same strain in 1g
    # and 3.5g with no size on the image) stay a suggestion with both listed.
    reason = best.reason
    if len(cands) > 1 and cands[1].score >= best.score - 0.02:
        reason += "; ambiguous — compare candidates"
    return {
        "matched_kb_product_id": best.product_id if status == "suggested" else None,
        "match_score": best.score,
        "match_reason": reason[:300],
        "match_candidates": [c.as_dict() for c in cands],
        "match_status": status,
    }


async def match_pass(run: SiteRun, refs: list[ProductRef]) -> int:
    if not refs:
        return 0
    matched = 0
    for im in await _st(run.store.list_images, run.site["id"]):
        patch = await asyncio.to_thread(match_one, im, refs)
        if patch is None:
            if im.get("matched_kb_product_id"):
                matched += 1
            continue
        await _st(run.store.update_image, im["id"], patch)
        if patch.get("matched_kb_product_id"):
            matched += 1
    return matched


# ---------------------------------------------------------------------------
# Synthesis + drafts
# ---------------------------------------------------------------------------
def merge_product_lines(*groups: list[ProductLine]) -> list[ProductLine]:
    out: list[ProductLine] = []
    keys: list[str] = []
    for g in groups:
        for line in g:
            k = normalize_name(line.name)
            if not k:
                continue
            dup = next((i for i, ok in enumerate(keys) if ok == k or name_similarity(ok, k) >= 0.95), None)
            if dup is None:
                keys.append(k)
                out.append(line)
            else:
                cur = out[dup]
                out[dup] = ProductLine(name=cur.name, category=cur.category or line.category,
                                       lineage=cur.lineage or line.lineage, notes=cur.notes or line.notes)
    return out


def coverage_text(site: dict, *, pages_read: int, pages_failed: int, pending: int, cap: int,
                  platform: str, feed_products: int, images: int, matched: int, tagged: int) -> str:
    if pending == 0:
        verdict = "COMPLETE — every page reachable from the site's links, sitemap and product feed was read."
    elif pages_read >= cap:
        verdict = (f"PARTIAL — stopped at the {cap}-page per-site ceiling with {pending} pages still queued. "
                   "Raise CAMPAIGN_MAX_PAGES_PER_SITE and resume the campaign to continue.")
    else:
        verdict = f"PARTIAL — {pending} pages still queued; resume the campaign to continue."
    lines = [
        f"Campaign crawl of {site.get('entry_url')}",
        verdict,
        f"Pages read: {pages_read} · failed: {pages_failed} · still queued: {pending}",
        f"Platform: {platform or 'unknown'}" + (f" · catalog feed products: {feed_products}" if feed_products else ""),
        f"Images catalogued: {images} · AI-labelled: {tagged} · matched to product cards: {matched}",
    ]
    return "\n".join(lines)


async def _write_outputs(run: SiteRun, result: Any, lines: list[ProductLine], cov_text: str) -> tuple[int, int]:
    """Drafts (ai_suggestions) + kb_products drafts. Returns (drafts, products)."""
    from .kb_products import build_product_rows, write_product_drafts
    from .pipeline import FieldOutcome, result_to_draft_rows
    from .store import fetch_banned_phrases, write_drafts

    s = run.settings
    if not _opt(run.camp, "write", True):
        return 0, 0
    # The synthesis pass read one page; the campaign's coverage is the truth.
    result.fields = [f for f in result.fields if f.field_key != "research_coverage"]
    result.fields.append(FieldOutcome(field_key="research_coverage", value=cov_text, confidence=1.0,
                                      via="css", accepted=True, reason="", flags=[]))
    summary = await asyncio.to_thread(write_drafts, result_to_draft_rows(result), settings=s)
    drafts = int(summary.get("written", 0) or 0)
    products = 0
    if s.harvest_products_enabled and lines and run.site.get("entity_type") in ("vendor", "brand"):
        banned = await asyncio.to_thread(fetch_banned_phrases, s)
        built = build_product_rows(lines, entity_type=run.site["entity_type"], entity_id=run.site["entity_id"],
                                   display_name=run.site.get("display_name") or "",
                                   source_url=run.site["entry_url"], banned=banned)
        if run.site.get("vendor_id"):
            for r in built.rows:
                r["vendor_id"] = run.site["vendor_id"]
        prod = await asyncio.to_thread(write_product_drafts, built.rows, settings=s)
        products = int(prod.get("written", 0) or 0)
    return drafts, products


def _corpus_from_pages(pages: list[dict]) -> list[tuple[str, str]]:
    ordered = sorted(pages, key=lambda p: (_PAGE_PRIORITY.get(p.get("page_type") or "other", 10),
                                           -(p.get("word_count") or 0)))
    return [(p["url"], p.get("text_excerpt") or "") for p in ordered if p.get("text_excerpt")]


async def run_site(camp: dict, site: dict, settings: Settings) -> None:
    from .pipeline import research_target

    store = get_store(settings)
    run = SiteRun(camp, site, settings)
    sid = site["id"]
    attempts = int(site.get("attempts") or 0) + 1
    max_attempts = int(settings.campaign_max_site_attempts)
    if attempts > max_attempts:
        await _st(store.update_site, sid, {"status": "failed", "finished_at": now_iso(),
                                           "last_error": f"gave up after {max_attempts} interrupted attempts"})
        return
    await _st(store.update_site, sid, {"status": "running", "attempts": attempts,
                                       "started_at": site.get("started_at") or now_iso(), "last_error": None})
    await run.load()
    _beat(run.cid)

    cap = int(_opt(camp, "max_pages_per_site", settings.campaign_max_pages_per_site))
    slice_pages = int(_opt(camp, "slice_pages", settings.campaign_slice_pages))
    visited: list[str] = list(site.get("frontier_visited") or [])
    pending: list[str] = list(site.get("frontier_pending") or [])
    slices = int(site.get("slices") or 0)
    platform = site.get("platform") or ""
    vendor = site.get("display_name") or site.get("host") or ""

    # 1. FEEDS (once per site).
    feed_products: list[FeedProduct] = []
    if settings.campaign_feeds_enabled and _opt(camp, "feeds", True) and site.get("platform") is None:
        try:
            feed = await read_feeds(settings, site["entry_url"], should_stop=run.should_stop)
        except Exception as e:  # noqa: BLE001
            log.info("feeds for %s failed: %s", site.get("host"), e)
            feed = FeedResult(error=str(e))
        platform = feed.platform or "unknown"
        feed_products = feed.products
        if feed.products:
            prows, irows = feed_rows(site, feed)
            await _st(store.upsert_pages, prows)
            if irows:
                await _st(store.upsert_images, irows)
            for r in prows:
                run.read_urls.add(r["url"])
            for r in irows:
                run.images[r["image_url"]] = {"has_product": bool(r.get("product_name")), "vision": False}
            # Feed product pages join the crawl (their HTML has more text).
            vis = set(visited)
            for fp in feed.products:
                if fp.url and fp.url not in vis and fp.url not in pending:
                    pending.append(fp.url)
        await _st(store.update_site, sid, {"platform": platform, "frontier_pending": pending[:MAX_FRONTIER]})
    elif site.get("platform"):
        # Resumed site: rebuild the feed product list from the stored catalogue.
        for p in await _st(store.list_pages, sid):
            feed = (p.get("ai_facts") or {}).get("feed")
            if feed is not None and p.get("title"):
                feed_products.append(FeedProduct(name=p["title"], url=p.get("url") or "",
                                                 category=str(feed.get("category") or "")))

    # 2. CRAWL in slices until the frontier is empty, the cap is hit, or a stop.
    stopped = ""
    entry_failed = ""
    stuck = 0
    while not run.should_stop():
        read_so_far = len(set(visited))
        if read_so_far >= cap:
            break
        if slices > 0 and not pending:
            break
        budget = max(2, min(slice_pages, cap - read_so_far + 1))
        override = None
        if slices > 0 or visited or pending:
            override = ResumeState(entity_type=site["entity_type"], entity_id=site["entity_id"],
                                   entry_url=site["entry_url"], visited=visited or [site["entry_url"]],
                                   pending=pending, runs=slices, total_pages=read_so_far)
        before = len(run.read_urls)
        deadline = time.monotonic() + max(60.0, float(settings.crawl_slice_timeout_seconds))
        try:
            result = await asyncio.wait_for(
                research_target(
                    url=site["entry_url"], entity_type=site["entity_type"], entity_id=site["entity_id"],
                    display_name=vendor, settings=settings, max_pages=budget,
                    should_stop=run.should_stop, deadline=deadline, on_page=run.on_page,
                    resume_override=override, persist_resume=False, run_ai=False,
                ),
                timeout=max(60.0, float(settings.crawl_slice_timeout_seconds)) + 600.0,
            )
        except asyncio.TimeoutError:
            stuck += 1
            log.error("campaign site %s: slice hit the hard ceiling", site.get("host"))
            if stuck >= 2:
                stopped = "slice timeouts"
                break
            continue
        slices += 1
        _beat(run.cid)
        if not result.fetched_ok:
            entry_failed = result.error or "entry page could not be fetched"
            break
        seen = set(visited)
        for u in list(result.pages) + list(result.failed_pages):
            if u not in seen:
                visited.append(u)
                seen.add(u)
        run.failed_urls.update(result.failed_pages)
        pending = [u for u in result.pending_urls if u not in seen][:MAX_FRONTIER]
        await _st(store.update_site, sid, {
            "frontier_visited": visited[-MAX_FRONTIER * 2:],
            "frontier_pending": pending,
            "pages_read": len(run.read_urls),
            "pages_failed": len(run.failed_urls),
            "pages_pending": len(pending),
            "images_found": len(run.images),
            "slices": slices,
            "attempts": 0,  # a finished slice = progress; only CONSECUTIVE interruptions count
            "stopped_reason": result.stopped_reason or None,
        })
        if result.stopped_reason == "cancelled":
            stopped = "cancelled"
            break
        new_pages = len(run.read_urls) - before
        stuck = stuck + 1 if new_pages <= 1 and pending else 0
        if stuck >= 3:
            stopped = "no progress (every queued page failing)"
            break

    if run.should_stop():
        await _st(store.update_site, sid, {"status": "cancelled", "stopped_reason": "cancelled",
                                           "pages_pending": len(pending)})
        return
    if entry_failed and not run.read_urls:
        await _st(store.update_site, sid, {"status": "failed", "last_error": entry_failed[:500],
                                           "finished_at": now_iso()})
        return

    # 3–6. ANALYZE.
    await _st(store.update_site, sid, {"status": "analyzing", "current_url": None})
    _beat(run.cid)
    page_lines = await page_ai_pass(run, vendor=vendor)

    refs_rows = await _st(store.vendor_products, site.get("vendor_id")) if site.get("vendor_id") else []
    refs = product_refs(refs_rows, vendor)
    known_names = [r.name for r in refs] + [fp.name for fp in feed_products]
    tagged = await vision_pass(run, vendor=vendor, product_names=list(dict.fromkeys(known_names)))
    if run.should_stop():
        await _st(store.update_site, sid, {"status": "cancelled", "stopped_reason": "cancelled"})
        return

    # Whole-site synthesis: one cheap page (cached entry) + every stored excerpt.
    pages = await _st(store.list_pages, sid)
    synth = None
    try:
        synth = await asyncio.wait_for(
            research_target(url=site["entry_url"], entity_type=site["entity_type"], entity_id=site["entity_id"],
                            display_name=vendor, settings=settings, max_pages=1, persist_resume=False,
                            prior_corpus=_corpus_from_pages(pages), run_ai=True, should_stop=run.should_stop),
            timeout=900.0,
        )
    except asyncio.TimeoutError:
        log.error("campaign site %s: synthesis timed out", site.get("host"))
    _beat(run.cid)

    jsonld_lines: list[ProductLine] = []
    for p in pages:
        for jp in ((p.get("ai_facts") or {}).get("heuristic") or {}).get("jsonld_products") or []:
            if jp.get("name"):
                jsonld_lines.append(ProductLine(name=str(jp["name"])[:200], category=str(jp.get("category") or "")[:80]))
    lines = merge_product_lines(
        list(getattr(synth, "products", []) or []), page_lines, jsonld_lines, feed_product_lines(feed_products),
    )

    # Newly drafted products are matchable too (they carry vendor_id).
    drafts = products = 0
    counts = await _st(store.count_site, sid)
    cov = coverage_text(site, pages_read=len(run.read_urls), pages_failed=len(run.failed_urls),
                        pending=len(pending), cap=cap, platform=platform, feed_products=len(feed_products),
                        images=counts.get("images", 0), matched=counts.get("images_matched", 0), tagged=tagged)
    if synth is not None and synth.fetched_ok:
        drafts, products = await _write_outputs(run, synth, lines, cov)
    if products and site.get("vendor_id"):
        refs = product_refs(await _st(store.vendor_products, site["vendor_id"]), vendor)
    matched = await match_pass(run, refs)

    counts = await _st(store.count_site, sid)
    complete = not pending and not stopped
    final_cov = coverage_text(site, pages_read=len(run.read_urls), pages_failed=len(run.failed_urls),
                              pending=len(pending), cap=cap, platform=platform,
                              feed_products=len(feed_products), images=counts.get("images", 0),
                              matched=counts.get("images_matched", matched), tagged=counts.get("images_tagged", tagged))
    await _st(store.update_site, sid, {
        "status": "complete" if complete else "partial",
        "pages_read": len(run.read_urls),
        "pages_failed": len(run.failed_urls),
        "pages_pending": len(pending),
        "images_found": counts.get("images", 0),
        "images_tagged": counts.get("images_tagged", 0),
        "images_matched": counts.get("images_matched", 0),
        "products_found": max(counts.get("products", 0), len(lines)),
        "drafts_written": int(site.get("drafts_written") or 0) + drafts,
        "products_written": int(site.get("products_written") or 0) + products,
        "coverage_assessment": final_cov[:2000],
        "stopped_reason": stopped or None,
        "finished_at": now_iso(),
        "current_url": None,
    })
    log.info("campaign site %s done: %s pages, %s images, %s matched", site.get("host"),
             len(run.read_urls), counts.get("images", 0), counts.get("images_matched", 0))


# ---------------------------------------------------------------------------
# Matching re-run (after staff add product cards)
# ---------------------------------------------------------------------------
async def rematch_site(site_id: str, settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    store = get_store(settings)
    site = await _st(store.get_site, site_id)
    if site is None:
        raise KeyError(site_id)
    camp = await _st(store.get_campaign, site["campaign_id"]) or {"id": site["campaign_id"], "options": {}}
    run = SiteRun(camp, site, settings)
    rows = await _st(store.vendor_products, site["vendor_id"]) if site.get("vendor_id") else []
    matched = await match_pass(run, product_refs(rows, site.get("display_name") or ""))
    await _st(store.update_site, site_id, {"images_matched": matched})
    return {"site_id": site_id, "products": len(rows), "images_matched": matched}

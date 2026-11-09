"""D220 S3 — durable campaign state (migration 0351 tables).

Two interchangeable backends behind one small interface:

  SupabaseCampaignStore  production: PostgREST via supabase-py (service role).
  MemoryCampaignStore    tests and local dev without Supabase.

All methods are SYNC (supabase-py is sync); the runner calls them through
asyncio.to_thread so the event loop never blocks. Reads are always paged
(PAGE rows at a time, never one huge .limit()).
"""
from __future__ import annotations

import copy
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Protocol

from .config import Settings

PAGE = 500
MAX_FRONTIER = 5000

SITE_TERMINAL = ("complete", "partial", "failed", "skipped", "cancelled")
CAMPAIGN_ACTIVE = ("queued", "running")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CampaignStore(Protocol):  # pragma: no cover - typing only
    def create_campaign(self, *, label: str, scope: str, options: dict, sites: list[dict]) -> dict: ...
    def get_campaign(self, campaign_id: str) -> dict | None: ...
    def list_campaigns(self, limit: int = 20) -> list[dict]: ...
    def active_campaigns(self) -> list[dict]: ...
    def update_campaign(self, campaign_id: str, patch: dict) -> None: ...
    def list_sites(self, campaign_id: str) -> list[dict]: ...
    def get_site(self, site_id: str) -> dict | None: ...
    def update_site(self, site_id: str, patch: dict) -> None: ...
    def upsert_pages(self, rows: list[dict]) -> None: ...
    def upsert_images(self, rows: list[dict]) -> None: ...
    def update_image(self, image_id: str, patch: dict) -> None: ...
    def update_page(self, page_id: str, patch: dict) -> None: ...
    def list_pages(self, site_id: str, *, page_types: tuple[str, ...] | None = None) -> list[dict]: ...
    def list_images(self, site_id: str) -> list[dict]: ...
    def count_site(self, site_id: str) -> dict: ...
    def vendor_products(self, vendor_id: str) -> list[dict]: ...
    def upsert_website_candidates(self, rows: list[dict]) -> int: ...


# ---------------------------------------------------------------------------
# Memory backend
# ---------------------------------------------------------------------------
class MemoryCampaignStore:
    def __init__(self) -> None:
        self.campaigns: dict[str, dict] = {}
        self.sites: dict[str, dict] = {}
        self.pages: dict[tuple[str, str], dict] = {}
        self.images: dict[tuple[str, str], dict] = {}
        self.products: dict[str, list[dict]] = {}
        self.candidates: dict[tuple[str, str], dict] = {}
        self._lock = threading.Lock()

    def create_campaign(self, *, label: str, scope: str, options: dict, sites: list[dict]) -> dict:
        with self._lock:
            cid = str(uuid.uuid4())
            camp = {"id": cid, "label": label, "scope": scope, "status": "queued", "cancel_requested": False,
                    "options": dict(options), "totals": {}, "ai_usage": {}, "last_error": None,
                    "created_at": now_iso(), "started_at": None, "finished_at": None, "updated_at": now_iso()}
            self.campaigns[cid] = camp
            for s in sites:
                sid = str(uuid.uuid4())
                row = {"id": sid, "campaign_id": cid, "status": "queued", "frontier_pending": [],
                       "frontier_visited": [], "pages_read": 0, "pages_failed": 0, "pages_pending": 0,
                       "images_found": 0, "images_tagged": 0, "images_matched": 0, "products_found": 0,
                       "drafts_written": 0, "products_written": 0, "slices": 0, "attempts": 0,
                       "platform": None, "coverage_assessment": None, "stopped_reason": None,
                       "last_error": None, "current_url": None, "created_at": now_iso(), "updated_at": now_iso()}
                row.update(s)
                self.sites[sid] = row
            return copy.deepcopy(camp)

    def get_campaign(self, campaign_id: str) -> dict | None:
        c = self.campaigns.get(campaign_id)
        return copy.deepcopy(c) if c else None

    def list_campaigns(self, limit: int = 20) -> list[dict]:
        rows = sorted(self.campaigns.values(), key=lambda c: c["created_at"], reverse=True)
        return copy.deepcopy(rows[:limit])

    def active_campaigns(self) -> list[dict]:
        return [copy.deepcopy(c) for c in self.campaigns.values() if c["status"] in CAMPAIGN_ACTIVE]

    def update_campaign(self, campaign_id: str, patch: dict) -> None:
        with self._lock:
            if campaign_id in self.campaigns:
                self.campaigns[campaign_id].update(copy.deepcopy(patch))
                self.campaigns[campaign_id]["updated_at"] = now_iso()

    def list_sites(self, campaign_id: str) -> list[dict]:
        return [copy.deepcopy(s) for s in self.sites.values() if s["campaign_id"] == campaign_id]

    def get_site(self, site_id: str) -> dict | None:
        s = self.sites.get(site_id)
        return copy.deepcopy(s) if s else None

    def update_site(self, site_id: str, patch: dict) -> None:
        with self._lock:
            if site_id in self.sites:
                self.sites[site_id].update(copy.deepcopy(patch))
                self.sites[site_id]["updated_at"] = now_iso()

    def upsert_pages(self, rows: list[dict]) -> None:
        with self._lock:
            for r in rows:
                key = (r["site_id"], r["url"])
                cur = self.pages.get(key, {"id": str(uuid.uuid4())})
                cur.update(copy.deepcopy(r))
                self.pages[key] = cur

    def upsert_images(self, rows: list[dict]) -> None:
        with self._lock:
            for r in rows:
                key = (r["site_id"], r["image_url"])
                cur = self.images.get(key, {"id": str(uuid.uuid4()), "match_status": "unmatched",
                                            "role": "unknown", "tags": []})
                cur.update(copy.deepcopy(r))
                self.images[key] = cur

    def update_image(self, image_id: str, patch: dict) -> None:
        with self._lock:
            for row in self.images.values():
                if row["id"] == image_id:
                    row.update(copy.deepcopy(patch))
                    return

    def update_page(self, page_id: str, patch: dict) -> None:
        with self._lock:
            for row in self.pages.values():
                if row["id"] == page_id:
                    row.update(copy.deepcopy(patch))
                    return

    def list_pages(self, site_id: str, *, page_types: tuple[str, ...] | None = None) -> list[dict]:
        return [copy.deepcopy(p) for (sid, _), p in self.pages.items()
                if sid == site_id and (page_types is None or p.get("page_type") in page_types)]

    def list_images(self, site_id: str) -> list[dict]:
        return [copy.deepcopy(i) for (sid, _), i in self.images.items() if sid == site_id]

    def count_site(self, site_id: str) -> dict:
        imgs = self.list_images(site_id)
        pages = self.list_pages(site_id)
        names: set[str] = set()
        for p in pages:
            names.update(n.lower() for n in (p.get("product_names") or []))
        return {
            "pages": len(pages),
            "images": len(imgs),
            "images_tagged": sum(1 for i in imgs if i.get("vision_at")),
            "images_matched": sum(1 for i in imgs if i.get("matched_kb_product_id")),
            "products": len(names),
        }

    def vendor_products(self, vendor_id: str) -> list[dict]:
        return copy.deepcopy(self.products.get(vendor_id, []))

    def upsert_website_candidates(self, rows: list[dict]) -> int:
        with self._lock:
            n = 0
            for r in rows:
                key = (r["vendor_id"], r["host"])
                cur = self.candidates.get(key)
                if cur and cur.get("status") in ("approved", "rejected"):
                    continue  # never reopen a human decision
                base = cur or {"id": str(uuid.uuid4()), "status": "pending"}
                base.update(copy.deepcopy(r))
                self.candidates[key] = base
                n += 1
            return n


# ---------------------------------------------------------------------------
# Supabase backend
# ---------------------------------------------------------------------------
class SupabaseCampaignStore:
    def __init__(self, settings: Settings) -> None:
        from supabase import create_client

        self._c = create_client(settings.supabase_url, settings.supabase_service_role_key)

    def _t(self, name: str):
        return self._c.table(name)

    def _paged(self, build) -> list[dict]:
        out: list[dict] = []
        start = 0
        while True:
            res = build().range(start, start + PAGE - 1).execute()
            rows = res.data or []
            out.extend(rows)
            if len(rows) < PAGE:
                return out
            start += PAGE
            if start > 50_000:  # pragma: no cover - runaway guard
                return out

    def create_campaign(self, *, label: str, scope: str, options: dict, sites: list[dict]) -> dict:
        res = self._t("kb_crawl_campaigns").insert(
            {"label": label[:200], "scope": scope, "options": options, "status": "queued"}
        ).execute()
        camp = (res.data or [None])[0]
        if not camp:
            raise RuntimeError("could not create campaign")
        rows = [{**s, "campaign_id": camp["id"]} for s in sites]
        for i in range(0, len(rows), 200):
            self._t("kb_crawl_sites").upsert(
                rows[i:i + 200], on_conflict="campaign_id,entity_type,entity_id,host", ignore_duplicates=True,
            ).execute()
        return camp

    def get_campaign(self, campaign_id: str) -> dict | None:
        res = self._t("kb_crawl_campaigns").select("*").eq("id", campaign_id).limit(1).execute()
        return (res.data or [None])[0]

    def list_campaigns(self, limit: int = 20) -> list[dict]:
        res = (self._t("kb_crawl_campaigns").select("*").order("created_at", desc=True)
               .limit(max(1, min(limit, 100))).execute())
        return res.data or []

    def active_campaigns(self) -> list[dict]:
        res = (self._t("kb_crawl_campaigns").select("*").in_("status", list(CAMPAIGN_ACTIVE))
               .order("created_at").limit(50).execute())
        return res.data or []

    def update_campaign(self, campaign_id: str, patch: dict) -> None:
        self._t("kb_crawl_campaigns").update(patch).eq("id", campaign_id).execute()

    def list_sites(self, campaign_id: str) -> list[dict]:
        cols = ("id,campaign_id,entity_type,entity_id,vendor_id,display_name,entry_url,host,status,platform,"
                "pages_read,pages_failed,pages_pending,images_found,images_tagged,images_matched,products_found,"
                "drafts_written,products_written,slices,attempts,coverage_assessment,stopped_reason,last_error,"
                "current_url,started_at,finished_at,updated_at")
        return self._paged(lambda: self._t("kb_crawl_sites").select(cols).eq("campaign_id", campaign_id).order("created_at"))

    def get_site(self, site_id: str) -> dict | None:
        res = self._t("kb_crawl_sites").select("*").eq("id", site_id).limit(1).execute()
        return (res.data or [None])[0]

    def update_site(self, site_id: str, patch: dict) -> None:
        self._t("kb_crawl_sites").update(patch).eq("id", site_id).execute()

    def upsert_pages(self, rows: list[dict]) -> None:
        for i in range(0, len(rows), 100):
            self._t("kb_crawl_pages").upsert(rows[i:i + 100], on_conflict="site_id,url").execute()

    def upsert_images(self, rows: list[dict]) -> None:
        for i in range(0, len(rows), 200):
            self._t("kb_crawl_images").upsert(rows[i:i + 200], on_conflict="site_id,image_url").execute()

    def update_image(self, image_id: str, patch: dict) -> None:
        self._t("kb_crawl_images").update(patch).eq("id", image_id).execute()

    def update_page(self, page_id: str, patch: dict) -> None:
        self._t("kb_crawl_pages").update(patch).eq("id", page_id).execute()

    def list_pages(self, site_id: str, *, page_types: tuple[str, ...] | None = None) -> list[dict]:
        cols = "id,url,page_type,title,h1,text_excerpt,product_names,ai_facts,word_count"

        def build():
            q = self._t("kb_crawl_pages").select(cols).eq("site_id", site_id)
            if page_types:
                q = q.in_("page_type", list(page_types))
            return q.order("fetched_at")
        return self._paged(build)

    def list_images(self, site_id: str) -> list[dict]:
        cols = ("id,page_url,image_url,alt,caption,heading,nearby_text,jsonld_name,context,source,role,"
                "role_confidence,product_name,brand_name,strain_name,category,variant_label,packaging_text,tags,"
                "colors,vision_model,vision_at,matched_kb_product_id,match_score,match_reason,match_candidates,"
                "match_status,media_asset_id,seen_count")
        return self._paged(lambda: self._t("kb_crawl_images").select(cols).eq("site_id", site_id).order("created_at"))

    def _count(self, table: str, site_id: str, extra=None) -> int:
        q = self._t(table).select("id", count="exact").eq("site_id", site_id)
        if extra:
            q = extra(q)
        res = q.limit(1).execute()
        return int(getattr(res, "count", None) or 0)

    def count_site(self, site_id: str) -> dict:
        names: set[str] = set()
        for p in self._paged(lambda: self._t("kb_crawl_pages").select("product_names").eq("site_id", site_id)):
            names.update(n.lower() for n in (p.get("product_names") or []))
        return {
            "pages": self._count("kb_crawl_pages", site_id),
            "images": self._count("kb_crawl_images", site_id),
            "images_tagged": self._count("kb_crawl_images", site_id, lambda q: q.not_.is_("vision_at", "null")),
            "images_matched": self._count("kb_crawl_images", site_id,
                                          lambda q: q.not_.is_("matched_kb_product_id", "null")),
            "products": len(names),
        }

    def vendor_products(self, vendor_id: str) -> list[dict]:
        cols = "id,display_name,category,variant_label,brand_slug,product_slug,kb_strain_id"
        return self._paged(lambda: self._t("kb_products").select(cols).eq("vendor_id", vendor_id).order("id"))

    def upsert_website_candidates(self, rows: list[dict]) -> int:
        n = 0
        for r in rows:
            res = (self._t("vendor_website_candidates").select("id,status")
                   .eq("vendor_id", r["vendor_id"]).eq("host", r["host"]).limit(1).execute())
            cur = (res.data or [None])[0]
            if cur and cur.get("status") in ("approved", "rejected"):
                continue
            if cur:
                self._t("vendor_website_candidates").update(r).eq("id", cur["id"]).execute()
            else:
                self._t("vendor_website_candidates").insert(r).execute()
            n += 1
        return n


_STORE: Any = None
_STORE_LOCK = threading.Lock()


def get_store(settings: Settings) -> Any:
    """Supabase when configured, else one process-wide memory store."""
    global _STORE
    with _STORE_LOCK:
        if _STORE is None:
            _STORE = SupabaseCampaignStore(settings) if settings.supabase_enabled else MemoryCampaignStore()
        return _STORE


def set_store_for_tests(store: Any) -> None:
    global _STORE
    _STORE = store


def ts() -> float:
    return time.time()

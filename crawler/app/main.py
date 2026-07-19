"""Greenway crawler — FastAPI service.

One authenticated endpoint, `POST /research`, runs the honest pipeline for a
target URL and (optionally) writes the resulting drafts into Supabase
`ai_suggestions`. Everything is drafts-only; nothing auto-publishes.

Auth: every request must carry `X-Crawler-Secret` matching CRAWLER_SHARED_SECRET.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import __version__
from .config import get_settings
from .harvest import (
    MAX_PAGES_PER_SITE,
    MAX_TARGETS_PER_JOB,
    HarvestValidationError,
    create_job,
    list_jobs,
    load_job,
    prepare_resume,
    request_cancel,
    schedule_job,
)
from .cultivera_api import CultiveraApiError, CultiveraApiResult, CultiveraClient
from .cultivera_auth import CultiveraAuthError
from .growflow_api import GrowflowApiError, GrowflowApiResult, GrowflowClient
from .growflow_auth import GrowflowAuthError
from .discovery_search import discover_vendor_sites, format_discovery_draft
from .kb_products import build_product_rows, slugify_dashed, write_product_drafts
from .pipeline import ResearchResult, research_social, research_target, result_to_draft_rows
from .store import DraftRow, fetch_banned_phrases, write_drafts

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("greenway.crawler")

app = FastAPI(title="Greenway Crawler", version=__version__)


@app.on_event("startup")
def _enforce_production_config() -> None:
    """S-5: in production, an explicit domain allow-list is REQUIRED.

    Fail fast at boot (not silently per-request) so a misconfigured deploy is
    obvious. fetch_page ALSO refuses every fetch under this condition, so even
    if the startup hook were bypassed, nothing can be fetched."""
    s = get_settings()
    if s.is_production and not s.allow_domains:
        raise RuntimeError(
            "CRAWLER_ENV=production requires CRAWL_ALLOW_DOMAINS to be set "
            "(comma-separated hostnames the crawler may research). Refusing to start."
        )


class ResearchRequest(BaseModel):
    url: str = Field(..., description="The page to research.")
    entity_type: str = Field(..., description="vendor | brand | product")
    entity_id: str = Field(..., description="The Supabase id of the vendor/brand/product.")
    display_name: str = Field(default="", description="Human name, used in the prompt hint.")
    # When false, run the pipeline but DON'T write to Supabase (dry-run/preview).
    write: bool = Field(default=True)


class FieldOut(BaseModel):
    field_key: str
    value: str
    confidence: float
    via: str
    accepted: bool
    reason: str = ""
    flags: list[str] = []


class ResearchResponse(BaseModel):
    ok: bool
    url: str
    entity_type: str
    entity_id: str
    from_cache: bool
    fields: list[FieldOut]
    image_candidates: list[str]
    pages: list[str] = []  # every page actually read during deep research
    # C4: crawl completeness snapshot (pages read vs. budget, leftover queue,
    # failed pages, saturation, one-line assessment). None for single-page
    # product lookups and social research.
    coverage: dict | None = None
    drafts_written: int = 0
    drafts_skipped: int = 0
    supabase_configured: bool = False
    # H9b: structured kb_products DRAFT rows written from the verified lineup.
    products_written: int = 0
    error: str = ""


class SocialRequest(BaseModel):
    handle: str = Field(..., description="IG handle, @handle, or instagram.com/<handle> URL.")
    entity_type: str = Field(..., description="vendor | brand | product")
    entity_id: str = Field(..., description="The Supabase id of the vendor/brand/product.")
    display_name: str = Field(default="")
    write: bool = Field(default=True)


def _build_response(result: ResearchResult, *, write: bool) -> ResearchResponse:
    """Shared response builder for web + social research (DRY, drafts-only)."""
    fields = [
        FieldOut(field_key=f.field_key, value=f.value, confidence=f.confidence,
                 via=f.via, accepted=f.accepted, reason=f.reason, flags=f.flags)
        for f in result.fields
    ]
    written = skipped = 0
    configured = False
    products_written = 0
    if result.fetched_ok and write:
        summary = write_drafts(result_to_draft_rows(result))
        written = summary.get("written", 0)
        skipped = summary.get("skipped", 0)
        configured = summary.get("configured", False)
        # H9b: also stage structured kb_products DRAFT rows from the verified
        # lineup (opt-out via HARVEST_PRODUCTS_ENABLED). Best-effort + drafts-only.
        settings = get_settings()
        if settings.harvest_products_enabled and result.products:
            built = build_product_rows(
                result.products,
                entity_type=result.entity_type,
                entity_id=result.entity_id,
                display_name=result.display_name,
                source_url=result.url,
                banned=fetch_banned_phrases(settings),
            )
            prod_summary = write_product_drafts(built.rows, settings=settings)
            products_written = prod_summary.get("written", 0)
    return ResearchResponse(
        ok=result.fetched_ok,
        url=result.url,
        entity_type=result.entity_type,
        entity_id=result.entity_id,
        from_cache=result.from_cache,
        fields=fields,
        image_candidates=result.image_candidates,
        pages=result.pages,
        coverage=result.coverage.as_dict() if result.coverage else None,
        drafts_written=written,
        drafts_skipped=skipped,
        supabase_configured=configured,
        products_written=products_written,
        error=result.error,
    )


def _require_secret(provided: str | None) -> None:
    settings = get_settings()
    expected = settings.crawler_shared_secret.strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Crawler not configured (no shared secret).")
    if not provided or provided.strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Crawler-Secret.")


@app.get("/health")
def health() -> dict:
    s = get_settings()
    return {
        "ok": True,
        "version": __version__,
        "ai_enabled": s.ai_enabled,
        "supabase_configured": s.supabase_enabled,
        "social_configured": s.social_enabled,
        "respect_robots": s.crawl_respect_robots,
        "proxy_enabled": bool(s.proxy_url),
        "allow_domains": s.allow_domains,
    }


@app.post("/research", response_model=ResearchResponse)
async def research(
    req: ResearchRequest,
    x_crawler_secret: str | None = Header(default=None),
) -> ResearchResponse:
    _require_secret(x_crawler_secret)

    if req.entity_type not in ("vendor", "brand", "product"):
        raise HTTPException(status_code=422, detail="entity_type must be vendor|brand|product")

    log.info("research %s %s (%s)", req.entity_type, req.entity_id, req.url)
    result = await research_target(
        url=req.url,
        entity_type=req.entity_type,
        entity_id=req.entity_id,
        display_name=req.display_name,
    )
    return _build_response(result, write=req.write)


# ---------------------------------------------------------------------------
# Slice H1 — batch HARVEST: many targets, one crash-safe background job.
# Same auth, same drafts-only landing as /research; jobs run one at a time.
# ---------------------------------------------------------------------------

class HarvestTarget(BaseModel):
    url: str = Field(..., description="The site to research.")
    entity_type: str = Field(..., description="vendor | brand | product")
    entity_id: str = Field(..., description="Supabase id of the entity the drafts belong to.")
    display_name: str = Field(default="")


class HarvestRequest(BaseModel):
    targets: list[HarvestTarget] = Field(..., description=f"1..{MAX_TARGETS_PER_JOB} sites to research.")
    write: bool = Field(default=True, description="False = dry-run (no drafts written).")
    max_pages_per_site: int | None = Field(
        default=None, ge=1, le=MAX_PAGES_PER_SITE,
        description="Per-site page budget for THIS job (None = worker default). "
                    "Tier 1 ≈ 15-40, Tier 2 ≈ 8-15, Tier 3 ≈ 2-4.",
    )
    delay_between_targets: float = Field(
        default=0.0, ge=0.0, le=3600.0,
        description="Extra pause (s) between sites — Tier-3 trickle mode.",
    )
    force_fresh: bool = Field(
        default=False,
        description="C7: bypass the on-disk page cache for this job so a stale "
                    "age-gate shell can't mask a re-crawl. Default false.",
    )
    label: str = Field(default="", description="Human label shown in the job list.")


class HarvestJobResponse(BaseModel):
    ok: bool
    job: dict


class HarvestJobListResponse(BaseModel):
    ok: bool
    jobs: list[dict]


@app.post("/harvest", response_model=HarvestJobResponse, status_code=202)
async def harvest_start(
    req: HarvestRequest,
    x_crawler_secret: str | None = Header(default=None),
) -> HarvestJobResponse:
    """Enqueue a batch job. Returns 202 + the job snapshot immediately; poll
    GET /harvest/{id} for progress. Only one job crawls at a time — additional
    jobs wait their turn (politeness is per-domain and the VM is one box)."""
    _require_secret(x_crawler_secret)
    try:
        job = create_job(
            [t.model_dump() for t in req.targets],
            write=req.write,
            max_pages_per_site=req.max_pages_per_site,
            delay_between_targets=req.delay_between_targets,
            force_fresh=req.force_fresh,
            label=req.label,
        )
    except HarvestValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    schedule_job(job.id)
    log.info("harvest job %s queued (%d targets)", job.id, len(job.targets))
    return HarvestJobResponse(ok=True, job=job.to_dict())


@app.get("/harvest", response_model=HarvestJobListResponse)
def harvest_list(x_crawler_secret: str | None = Header(default=None)) -> HarvestJobListResponse:
    _require_secret(x_crawler_secret)
    return HarvestJobListResponse(ok=True, jobs=[j.to_dict() for j in list_jobs(limit=20)])


@app.get("/harvest/{job_id}", response_model=HarvestJobResponse)
def harvest_status(
    job_id: str,
    x_crawler_secret: str | None = Header(default=None),
) -> HarvestJobResponse:
    _require_secret(x_crawler_secret)
    job = load_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job id.")
    return HarvestJobResponse(ok=True, job=job.to_dict())


@app.post("/harvest/{job_id}/cancel", response_model=HarvestJobResponse)
def harvest_cancel(
    job_id: str,
    x_crawler_secret: str | None = Header(default=None),
) -> HarvestJobResponse:
    """Flag a job for cancellation (takes effect between targets — a site is
    either fully researched or untouched, never half-written)."""
    _require_secret(x_crawler_secret)
    job = request_cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job id.")
    return HarvestJobResponse(ok=True, job=job.to_dict())


@app.post("/harvest/{job_id}/resume", response_model=HarvestJobResponse)
async def harvest_resume(
    job_id: str,
    x_crawler_secret: str | None = Header(default=None),
) -> HarvestJobResponse:
    """Crash recovery: re-queue the pending/interrupted targets of a job that
    died mid-run (e.g. the VM rebooted). Finished targets are never redone."""
    _require_secret(x_crawler_secret)
    job = prepare_resume(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job id.")
    if job.status == "queued":
        schedule_job(job.id)
    return HarvestJobResponse(ok=True, job=job.to_dict())


@app.post("/research-social", response_model=ResearchResponse)
async def research_social_endpoint(
    req: SocialRequest,
    x_crawler_secret: str | None = Header(default=None),
) -> ResearchResponse:
    """Sanctioned social research (DF-9): pull a PUBLIC IG business profile via the
    Meta Graph Business Discovery API → verified, compliance-gated drafts."""
    _require_secret(x_crawler_secret)

    if req.entity_type not in ("vendor", "brand", "product"):
        raise HTTPException(status_code=422, detail="entity_type must be vendor|brand|product")

    s = get_settings()
    if not s.social_enabled:
        raise HTTPException(status_code=503, detail="Social not configured (META_GRAPH_TOKEN unset).")

    log.info("research-social %s %s (@%s)", req.entity_type, req.entity_id, req.handle)
    result = await research_social(
        handle=req.handle,
        entity_type=req.entity_type,
        entity_id=req.entity_id,
        display_name=req.display_name,
    )
    return _build_response(result, write=req.write)


# ---------------------------------------------------------------------------
# Slice H9e — vendor-website DISCOVERY: keyword search finds a vendor's OWN
# first-party site + contact info. Returns candidates for the owner to REVIEW
# before feeding any URL into the batch crawler; never auto-crawls. Third-party
# marketplaces (Jane/Leafly/Weedmaps/...) are always excluded.
# ---------------------------------------------------------------------------

class DiscoverRequest(BaseModel):
    name: str = Field(..., description="Vendor/brand name to search for.")
    location: str = Field(default="", description="Optional city/state to disambiguate.")
    # When true, write a research_discovery reference draft under a lead:<slug>
    # target so the candidates land in the review inbox. Off = preview only.
    write: bool = Field(default=True)


class DiscoverCandidateOut(BaseModel):
    url: str
    host: str
    title: str = ""
    score: int = 0


class DiscoverResponse(BaseModel):
    ok: bool
    name: str
    queries: list[str]
    candidates: list[DiscoverCandidateOut]
    emails: list[str] = []
    phones: list[str] = []
    lead_id: str = ""
    drafts_written: int = 0
    supabase_configured: bool = False
    error: str = ""


@app.post("/discover", response_model=DiscoverResponse)
async def discover_endpoint(
    req: DiscoverRequest,
    x_crawler_secret: str | None = Header(default=None),
) -> DiscoverResponse:
    """Keyword-targeted search for a vendor's OWN website + contact info.

    Drafts-only: results are written as a single `research_discovery` reference
    draft under a `lead:<slug>` target, which the review inbox renders read-only.
    The owner then decides which URL (if any) to feed into the batch crawler."""
    _require_secret(x_crawler_secret)

    s = get_settings()
    if not s.discovery_enabled:
        raise HTTPException(status_code=503, detail="Discovery disabled (DISCOVERY_ENABLED=false).")

    log.info("discover %r (%s)", req.name, req.location or "-")
    result = await discover_vendor_sites(
        req.name, location=req.location, settings=s,
        limit=s.discovery_max_results,
    )

    lead_id = "lead:" + slugify_dashed(req.name) if req.name.strip() else ""
    written = 0
    configured = False
    if req.write and result.candidates and lead_id:
        body = format_discovery_draft(req.name, result.candidates, result.contact)
        top = result.candidates[0].url
        row = DraftRow(
            entity_type="vendor",
            entity_id=lead_id,
            field_key="research_discovery",
            suggested_value=body,
            input_summary=f"discovery {req.name!r} · {len(result.candidates)} candidate(s)",
            confidence=float(result.candidates[0].score) / 10.0 if result.candidates else 0.0,
            source=f"discover:{top}",
        )
        summary = write_drafts([row])
        written = summary.get("written", 0)
        configured = summary.get("configured", False)

    return DiscoverResponse(
        ok=result.fetched_ok,
        name=result.name,
        queries=result.queries,
        candidates=[
            DiscoverCandidateOut(url=c.url, host=c.host, title=c.title, score=c.score)
            for c in result.candidates
        ],
        emails=result.contact.emails,
        phones=result.contact.phones,
        lead_id=lead_id,
        drafts_written=written,
        supabase_configured=configured,
        error=result.error,
    )


# ---------------------------------------------------------------------------
# Slice CV-3 — Cultivera vendor menus (authenticated, polite).
# Two endpoints let the back office (1) search the marketplace's vendors and
# (2) fetch ONE vendor's live menu. Same X-Crawler-Secret auth. These endpoints
# return the RAW payload the marketplace gave us (plus a tolerant record list);
# the Next app persists snapshots/items via cultivera-store.ts so we reuse the
# shipped tolerant normalizers and keep Supabase writes in ONE place. We do NOT
# hard-code Cultivera's response shape here — never guess.
# ---------------------------------------------------------------------------

class CultiveraMarketsRequest(BaseModel):
    query: str = Field(default="", description="Optional vendor-name filter (substring).")


class CultiveraMenuRequest(BaseModel):
    market_id: str = Field(default="", description="Cultivera market id (if known).")
    slug: str = Field(default="", description="Vendor slug (alternative to market_id).")


class CultiveraProductRequest(BaseModel):
    market_id: str = Field(default="", description="Cultivera market id (numeric).")
    product_id: str = Field(default="", description="Cultivera product-line id (numeric).")


class CultiveraApiOut(BaseModel):
    ok: bool
    url: str = ""
    status: int = 0
    # The raw payload the marketplace returned (untouched) so Next can normalize.
    raw: object | None = None
    # A tolerant list extraction for convenience/preview.
    records: list[dict] = []
    count: int = 0
    error: str = ""


def _cultivera_result_out(result: CultiveraApiResult) -> CultiveraApiOut:
    records = result.records or []
    return CultiveraApiOut(
        ok=result.ok,
        url=result.url,
        status=result.status,
        raw=result.raw,
        records=records,
        count=len(records),
        error=result.error,
    )


@app.post("/cultivera/markets", response_model=CultiveraApiOut)
async def cultivera_markets(
    req: CultiveraMarketsRequest,
    x_crawler_secret: str | None = Header(default=None),
) -> CultiveraApiOut:
    """List (optionally filter) the marketplace vendors the buyer can see.

    Authenticated + polite: the client logs in once with the buyer's own
    credentials, reuses the cached session, and paces its requests. Returns the
    raw payload for the Next app to normalize/persist.
    """
    _require_secret(x_crawler_secret)
    s = get_settings()
    if not s.cultivera_enabled:
        raise HTTPException(
            status_code=503,
            detail="Cultivera disabled (set CULTIVERA_EMAIL/CULTIVERA_PASSWORD).",
        )
    log.info("cultivera markets query=%r", req.query)
    client = CultiveraClient(s)
    try:
        result = await client.search_markets(req.query)
    except CultiveraAuthError as exc:
        raise HTTPException(status_code=502, detail=f"Cultivera login failed: {exc}") from exc
    return _cultivera_result_out(result)


@app.post("/cultivera/menu", response_model=CultiveraApiOut)
async def cultivera_menu(
    req: CultiveraMenuRequest,
    x_crawler_secret: str | None = Header(default=None),
) -> CultiveraApiOut:
    """Fetch ONE vendor's live menu (listings) by market id or slug.

    Returns the raw payload so the Next app can persist it via
    cultivera-store.saveSnapshot() using the shipped tolerant normalizers.
    """
    _require_secret(x_crawler_secret)
    s = get_settings()
    if not s.cultivera_enabled:
        raise HTTPException(
            status_code=503,
            detail="Cultivera disabled (set CULTIVERA_EMAIL/CULTIVERA_PASSWORD).",
        )
    if not (req.market_id.strip() or req.slug.strip()):
        raise HTTPException(status_code=422, detail="Provide market_id or slug.")
    log.info("cultivera menu market_id=%r slug=%r", req.market_id, req.slug)
    client = CultiveraClient(s)
    try:
        result = await client.fetch_menu(market_id=req.market_id, slug=req.slug)
    except CultiveraApiError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CultiveraAuthError as exc:
        raise HTTPException(status_code=502, detail=f"Cultivera login failed: {exc}") from exc
    return _cultivera_result_out(result)


@app.post("/cultivera/product", response_model=CultiveraApiOut)
async def cultivera_product(
    req: CultiveraProductRequest,
    x_crawler_secret: str | None = Header(default=None),
) -> CultiveraApiOut:
    """Fetch ONE product line's full per-variant DETAIL.

    Pinned endpoint (live probe): GET /listings/{productId}/market/{marketId}.
    Returns the raw product-line object (with its `Products` variant array) so
    the Next app can normalize per-variant prices (dollars -> cents), available
    quantities, sizes, strain types and order limits — the buyer's per-size
    shopping view.
    """
    _require_secret(x_crawler_secret)
    s = get_settings()
    if not s.cultivera_enabled:
        raise HTTPException(
            status_code=503,
            detail="Cultivera disabled (set CULTIVERA_EMAIL/CULTIVERA_PASSWORD).",
        )
    if not (req.market_id.strip() and req.product_id.strip()):
        raise HTTPException(status_code=422, detail="Provide market_id and product_id.")
    log.info("cultivera product market_id=%r product_id=%r", req.market_id, req.product_id)
    client = CultiveraClient(s)
    try:
        result = await client.fetch_product_detail(
            market_id=req.market_id, product_id=req.product_id
        )
    except CultiveraApiError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CultiveraAuthError as exc:
        raise HTTPException(status_code=502, detail=f"Cultivera login failed: {exc}") from exc
    return _cultivera_result_out(result)


# ---------------------------------------------------------------------------
# Slice GF-3 GrowFlow vendor menus (authenticated, polite, GraphQL).
# Mirrors the Cultivera pair: (1) list/search the marketplace storefronts the
# buyer can see and (2) fetch ONE storefront's live menu. Same X-Crawler-Secret
# auth. GrowFlow speaks a single GraphQL endpoint; the client captures the Auth0
# Bearer from the SPA and re-logs in on 401. We return the RAW data node (never
# a guessed shape) so the Next app normalizes/persists in ONE place.
# ---------------------------------------------------------------------------

class GrowflowStoresRequest(BaseModel):
    query: str = Field(default="", description="Optional store-name/license filter (substring).")


class GrowflowMenuRequest(BaseModel):
    store_front_id: str = Field(default="", description="GrowFlow storefront id (integer).")


class GrowflowApiOut(BaseModel):
    ok: bool
    url: str = ""
    status: int = 0
    raw: object | None = None
    records: list[dict] = []
    count: int = 0
    error: str = ""


def _growflow_result_out(result: GrowflowApiResult) -> GrowflowApiOut:
    records = result.records or []
    return GrowflowApiOut(
        ok=result.ok,
        url=result.url,
        status=result.status,
        raw=result.raw,
        records=records,
        count=len(records),
        error=result.error,
    )


@app.post("/growflow/stores", response_model=GrowflowApiOut)
async def growflow_stores(
    req: GrowflowStoresRequest,
    x_crawler_secret: str | None = Header(default=None),
) -> GrowflowApiOut:
    """List (optionally filter) the GrowFlow storefronts the buyer can see."""
    _require_secret(x_crawler_secret)
    s = get_settings()
    if not s.growflow_enabled:
        raise HTTPException(
            status_code=503,
            detail="GrowFlow disabled (set GROWFLOW_EMAIL/GROWFLOW_PASSWORD).",
        )
    log.info("growflow stores query=%r", req.query)
    client = GrowflowClient(s)
    try:
        result = await client.search_stores(req.query)
    except GrowflowAuthError as exc:
        raise HTTPException(status_code=502, detail=f"GrowFlow login failed: {exc}") from exc
    return _growflow_result_out(result)


@app.post("/growflow/menu", response_model=GrowflowApiOut)
async def growflow_menu(
    req: GrowflowMenuRequest,
    x_crawler_secret: str | None = Header(default=None),
) -> GrowflowApiOut:
    """Fetch ONE storefront's live menu (getStoreListing) by storefront id."""
    _require_secret(x_crawler_secret)
    s = get_settings()
    if not s.growflow_enabled:
        raise HTTPException(
            status_code=503,
            detail="GrowFlow disabled (set GROWFLOW_EMAIL/GROWFLOW_PASSWORD).",
        )
    if not req.store_front_id.strip():
        raise HTTPException(status_code=422, detail="Provide store_front_id.")
    log.info("growflow menu store_front_id=%r", req.store_front_id)
    client = GrowflowClient(s)
    try:
        result = await client.fetch_menu(store_front_id=req.store_front_id)
    except GrowflowApiError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except GrowflowAuthError as exc:
        raise HTTPException(status_code=502, detail=f"GrowFlow login failed: {exc}") from exc
    return _growflow_result_out(result)

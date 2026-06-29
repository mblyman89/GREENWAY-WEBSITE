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
from .pipeline import ResearchResult, research_social, research_target, result_to_draft_rows
from .store import write_drafts

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("greenway.crawler")

app = FastAPI(title="Greenway Crawler", version=__version__)


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
    drafts_written: int = 0
    drafts_skipped: int = 0
    supabase_configured: bool = False
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
    if result.fetched_ok and write:
        summary = write_drafts(result_to_draft_rows(result))
        written = summary.get("written", 0)
        skipped = summary.get("skipped", 0)
        configured = summary.get("configured", False)
    return ResearchResponse(
        ok=result.fetched_ok,
        url=result.url,
        entity_type=result.entity_type,
        entity_id=result.entity_id,
        from_cache=result.from_cache,
        fields=fields,
        image_candidates=result.image_candidates,
        drafts_written=written,
        drafts_skipped=skipped,
        supabase_configured=configured,
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

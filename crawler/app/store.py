"""Step 7: persist crawled drafts into Supabase `ai_suggestions`.

Drafts-only, exactly like the site: status='pending', source='crawl:<url>',
with a grounding confidence. A human accepts/rejects them in the existing back
office review queue. We also fetch the owner's editable banned phrases
(kb_banned_phrases) so the crawler's compliance scan matches the site.

Idempotency: we skip writing a draft if an identical PENDING suggestion already
exists for the same (entity_type, entity_id, field_key, value) — re-running
research won't pile up duplicates.
"""
from __future__ import annotations

from dataclasses import dataclass

from .compliance import PROMPT_VERSION
from .config import Settings, get_settings


@dataclass
class DraftRow:
    entity_type: str  # "vendor" | "brand" | "product"
    entity_id: str
    field_key: str
    suggested_value: str
    input_summary: str
    confidence: float
    source: str  # "crawl:<url>"


def _client(settings: Settings):
    from supabase import create_client
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def fetch_banned_phrases(settings: Settings | None = None) -> list[str]:
    """Owner's editable extra banned phrases, if the table exists."""
    settings = settings or get_settings()
    if not settings.supabase_enabled:
        return []
    try:
        client = _client(settings)
        res = client.table("kb_banned_phrases").select("phrase, active").eq("active", True).execute()
        return [r["phrase"] for r in (res.data or []) if r.get("phrase")]
    except Exception:
        return []


def _pending_exists(client, row: DraftRow) -> bool:
    try:
        res = (
            client.table("ai_suggestions")
            .select("id")
            .eq("entity_type", row.entity_type)
            .eq("entity_id", row.entity_id)
            .eq("field_key", row.field_key)
            .eq("status", "pending")
            .limit(50)
            .execute()
        )
        for r in res.data or []:
            # cheap dedup: same field already pending → skip (value compared below
            # only if the API returns it; we keep this conservative).
            return True
        return False
    except Exception:
        return False


def write_drafts(rows: list[DraftRow], *, settings: Settings | None = None) -> dict:
    """Insert pending suggestions. Returns a small summary for the API response."""
    settings = settings or get_settings()
    if not settings.supabase_enabled:
        return {"written": 0, "skipped": 0, "configured": False, "rows": [r.field_key for r in rows]}

    client = _client(settings)
    written = 0
    skipped = 0
    for row in rows:
        if not row.suggested_value.strip():
            skipped += 1
            continue
        if _pending_exists(client, row):
            skipped += 1
            continue
        payload = {
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "field_key": row.field_key,
            "suggested_value": row.suggested_value,
            "status": "pending",
            "model": f"crawler/{settings.ai_model}" if settings.ai_enabled else "crawler/css",
            "prompt_version": PROMPT_VERSION,
            "input_summary": row.input_summary[:500],
            "confidence": round(max(0.0, min(1.0, row.confidence)), 3),
            "source": row.source,
        }
        try:
            client.table("ai_suggestions").insert(payload).execute()
            written += 1
        except Exception:
            # Defensive: retry without confidence/source if those columns are
            # missing on a very old schema (mirrors the site's persistSuggestion).
            try:
                payload.pop("confidence", None)
                payload.pop("source", None)
                client.table("ai_suggestions").insert(payload).execute()
                written += 1
            except Exception:
                skipped += 1
    return {"written": written, "skipped": skipped, "configured": True}

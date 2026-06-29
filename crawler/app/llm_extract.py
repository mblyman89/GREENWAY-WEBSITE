"""Steps 4 & 5: schema LLM extraction (last resort) + verify-against-source.

Only the fields the CSS-first step COULDN'T fill are sent to the model, with a
Pydantic schema, temperature≈0, against an OpenAI-compatible endpoint (same
AI_BASE_URL/AI_MODEL the site uses). We then VERIFY every extracted value against
the actual page text and drop anything not supported — the anti-hallucination
gate that keeps drafts honest.
"""
from __future__ import annotations

import json
import re
from typing import Type, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .config import Settings, get_settings

T = TypeVar("T", bound=BaseModel)

_SYSTEM = (
    "You extract ONLY facts that are explicitly present in the provided web page "
    "content for a licensed Washington State (I-502) cannabis business. You are an "
    "extraction tool, not a writer. Rules you must never break:\n"
    "- Use ONLY text from the page. If a field isn't on the page, return an empty "
    "string / empty list and set confidence low. NEVER invent.\n"
    "- No health/medical/therapeutic/effect claims, no dosing, no price/discounts, "
    "nothing appealing to minors, no alcohol/tobacco associations.\n"
    "- For every non-empty field, the value must be paraphrased or quoted from the "
    "page so it can be verified against the source.\n"
    "Return STRICT JSON matching the requested schema. No prose, no markdown."
)


def _json_schema_for(model: Type[BaseModel]) -> dict:
    """Pydantic v2 JSON schema, lightly trimmed for the response_format hint."""
    schema = model.model_json_schema()
    schema.pop("title", None)
    return schema


def _build_user_prompt(model: Type[BaseModel], page_text: str, hint: str) -> str:
    schema = _json_schema_for(model)
    trimmed = page_text.strip()
    if len(trimmed) > 12_000:  # keep input cheap; CSS step already grabbed structured bits
        trimmed = trimmed[:12_000]
    return (
        f"{hint}\n\n"
        f"Return JSON conforming to this JSON Schema:\n{json.dumps(schema)}\n\n"
        f"=== PAGE CONTENT START ===\n{trimmed}\n=== PAGE CONTENT END ==="
    )


def _call_model(settings: Settings, system: str, user: str) -> str:
    url = settings.ai_base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": settings.ai_model,
        "temperature": 0.0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {settings.ai_api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=60.0) as c:
        r = c.post(url, json=payload, headers=headers)
        r.raise_for_status()
        data = r.json()
    return data["choices"][0]["message"]["content"]


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    # Tolerate models that wrap JSON in ```json fences.
    fence = re.search(r"\{.*\}", raw, re.DOTALL)
    if fence:
        raw = fence.group(0)
    return json.loads(raw)


def extract_with_llm(
    model: Type[T],
    page_text: str,
    hint: str,
    *,
    settings: Settings | None = None,
) -> T | None:
    """Run schema-constrained extraction. Returns None if AI disabled or fails."""
    settings = settings or get_settings()
    if not settings.ai_enabled or not page_text.strip():
        return None
    try:
        raw = _call_model(settings, _SYSTEM, _build_user_prompt(model, page_text, hint))
        parsed = _parse_json(raw)
        return model.model_validate(parsed)
    except (httpx.HTTPError, json.JSONDecodeError, ValidationError, KeyError):
        return None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Step 5: verify-against-source.
# ---------------------------------------------------------------------------

_WORD = re.compile(r"[a-z0-9']+")


def _tokens(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def supported_by_source(value: str, page_text: str, *, min_overlap: float = 0.6) -> bool:
    """True if `value`'s content is genuinely present in the page.

    We require that a strong majority of the value's meaningful tokens also appear
    in the page text. This catches hallucinated facts (a sentence the model made
    up will share few tokens with the real page) while tolerating light
    paraphrasing. Short values (a name, a URL) are checked by substring.
    """
    v = value.strip()
    if not v:
        return False
    page_lower = page_text.lower()

    # Short/atomic values: require a direct substring match.
    if len(v) <= 40:
        return v.lower() in page_lower

    v_tokens = [t for t in _tokens(v) if len(t) > 2]
    if not v_tokens:
        return v.lower() in page_lower
    page_token_set = set(_tokens(page_text))
    hits = sum(1 for t in v_tokens if t in page_token_set)
    return (hits / len(v_tokens)) >= min_overlap

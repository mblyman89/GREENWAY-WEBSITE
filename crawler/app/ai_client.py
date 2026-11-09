"""D220 — the ONE OpenAI caller for the crawler (text, vision, web search).

Design goals (owner: "lets stick with openAI"):
  • Every call is BOUNDED (AI_TIMEOUT_SECONDS) and can run off the event loop
    (``*_async`` wrappers use ``asyncio.to_thread``) so /health never stalls.
  • A MODEL FALLBACK CHAIN (Settings.model_chain): the first model the account
    can use wins and is remembered. OpenAI's deprecations page schedules
    gpt-4o-mini for shutdown on 2027-01-14 with gpt-6-luna as the named
    replacement — the chain means the crawler keeps working across that date
    with zero config, and AI_MODEL still wins when it works.
  • Parameter tolerance: reasoning-class models reject ``temperature``; a 400
    that names the parameter is retried once without it.
  • A running USAGE TALLY (calls, tokens, web searches) so campaigns can show
    the owner what a crawl actually cost.

Nothing here writes anywhere; callers decide what to do with the answers.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
from dataclasses import dataclass, field
from typing import Any

import httpx

from .config import Settings

log = logging.getLogger("greenway.crawler.ai")


class AiUnavailable(Exception):
    """No model in the chain could answer (or AI is not configured)."""


@dataclass
class Usage:
    calls: int = 0
    failures: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    web_searches: int = 0
    images: int = 0
    by_model: dict[str, int] = field(default_factory=dict)

    def add(self, model: str, data: dict, *, images: int = 0, searches: int = 0) -> None:
        u = data.get("usage") or {}
        self.calls += 1
        self.input_tokens += int(u.get("prompt_tokens") or u.get("input_tokens") or 0)
        self.output_tokens += int(u.get("completion_tokens") or u.get("output_tokens") or 0)
        self.images += images
        self.web_searches += searches
        self.by_model[model] = self.by_model.get(model, 0) + 1

    def as_dict(self) -> dict:
        return {
            "calls": self.calls,
            "failures": self.failures,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "web_searches": self.web_searches,
            "images": self.images,
            "by_model": dict(self.by_model),
        }


USAGE = Usage()
_usage_lock = threading.Lock()
# purpose -> model that last worked (skip known-dead models on later calls)
_working: dict[str, str] = {}
_dead: set[str] = set()

_MODEL_GONE = re.compile(
    r"model_not_found|does not exist|not found|deprecated|no longer (available|supported)|"
    r"do(es)? not have access|unsupported model|invalid model|decommissioned",
    re.I,
)


def _headers(settings: Settings) -> dict:
    return {
        "Authorization": f"Bearer {settings.ai_api_key}",
        "Content-Type": "application/json",
    }


def _ordered_chain(settings: Settings, purpose: str) -> list[str]:
    chain = [m for m in settings.model_chain(purpose) if m not in _dead]
    pinned = _working.get(purpose)
    if pinned and pinned in chain:
        chain.remove(pinned)
        chain.insert(0, pinned)
    return chain or settings.model_chain(purpose)


def _error_text(r: httpx.Response) -> str:
    try:
        j = r.json()
        err = j.get("error") or {}
        return f"{err.get('code') or ''} {err.get('message') or ''}".strip() or r.text[:300]
    except Exception:
        return r.text[:300]


def parse_json_loose(raw: str) -> dict:
    """Parse a JSON object, tolerating ```json fences and leading prose."""
    raw = (raw or "").strip()
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        raw = m.group(0)
    return json.loads(raw)


def chat_json(
    settings: Settings,
    system: str,
    user: str,
    *,
    purpose: str = "text",
    image_urls: list[str] | None = None,
    max_tokens: int | None = None,
) -> dict:
    """Chat Completions → parsed JSON object. Raises AiUnavailable on failure.

    ``image_urls`` turns the user turn into a vision message (each image as an
    ``image_url`` part with ``detail: low`` — about 85 tokens per image)."""
    if not settings.ai_enabled:
        raise AiUnavailable("AI_API_KEY not set")
    url = settings.ai_base_url.rstrip("/") + "/chat/completions"
    if image_urls:
        content: Any = [{"type": "text", "text": user}] + [
            {"type": "image_url", "image_url": {"url": u, "detail": "low"}} for u in image_urls
        ]
    else:
        content = user
    last_err = ""
    timeout = max(5.0, float(settings.ai_timeout_seconds))
    for model in _ordered_chain(settings, purpose):
        payload: dict = {
            "model": model,
            "temperature": 0.0,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
            "response_format": {"type": "json_object"},
        }
        if max_tokens:
            payload["max_completion_tokens"] = max_tokens
        for attempt in range(3):
            try:
                with httpx.Client(timeout=timeout) as c:
                    r = c.post(url, json=payload, headers=_headers(settings))
            except httpx.HTTPError as e:
                last_err = f"{model}: {e}"
                break  # network/timeout → try the next model
            if r.status_code == 200:
                try:
                    data = r.json()
                    raw = data["choices"][0]["message"]["content"]
                    parsed = parse_json_loose(raw)
                except Exception as e:
                    last_err = f"{model}: unparseable answer ({e})"
                    break
                with _usage_lock:
                    USAGE.add(model, data, images=len(image_urls or []))
                _working[purpose] = model
                return parsed
            text = _error_text(r)
            last_err = f"{model}: HTTP {r.status_code} {text}"
            if r.status_code == 400 and attempt < 2:
                # Reasoning-class models reject some sampling/format params.
                low = text.lower()
                changed = False
                if "temperature" in low and "temperature" in payload:
                    payload.pop("temperature", None)
                    changed = True
                elif "max_completion_tokens" in low and "max_completion_tokens" in payload:
                    payload["max_tokens"] = payload.pop("max_completion_tokens")
                    changed = True
                elif "response_format" in low and "response_format" in payload:
                    payload.pop("response_format", None)
                    changed = True
                if changed:
                    continue
            if r.status_code in (404, 400, 403) and _MODEL_GONE.search(text):
                _dead.add(model)
                log.warning("ai: model %s unavailable (%s) — trying the next one", model, text[:120])
            break
    with _usage_lock:
        USAGE.failures += 1
    raise AiUnavailable(last_err or "no model answered")


def responses_web_search(
    settings: Settings,
    prompt: str,
    *,
    blocked_domains: list[str] | None = None,
) -> dict:
    """Responses API + hosted ``web_search`` tool.

    Returns ``{"text": str, "citations": [{"url","title"}], "sources": [url], "model": str}``.
    Raises AiUnavailable when no model in the search chain answers."""
    if not settings.ai_enabled:
        raise AiUnavailable("AI_API_KEY not set")
    url = settings.ai_base_url.rstrip("/") + "/responses"
    tool: dict = {"type": "web_search", "search_context_size": "medium",
                  "user_location": {"type": "approximate", "country": "US", "region": "Washington"}}
    if blocked_domains:
        tool["filters"] = {"blocked_domains": blocked_domains[:100]}
    last_err = ""
    timeout = max(30.0, float(settings.ai_timeout_seconds) * 2)
    for model in _ordered_chain(settings, "search"):
        payload = {
            "model": model,
            "tools": [tool],
            "input": prompt,
            "include": ["web_search_call.action.sources"],
        }
        for attempt in range(3):
            try:
                with httpx.Client(timeout=timeout) as c:
                    r = c.post(url, json=payload, headers=_headers(settings))
            except httpx.HTTPError as e:
                last_err = f"{model}: {e}"
                break
            if r.status_code == 200:
                data = r.json()
                out = parse_responses_output(data)
                out["model"] = model
                with _usage_lock:
                    USAGE.add(model, data, searches=max(1, out.get("search_calls", 1)))
                _working["search"] = model
                return out
            text = _error_text(r)
            last_err = f"{model}: HTTP {r.status_code} {text}"
            low = text.lower()
            if r.status_code == 400 and attempt < 2:
                if "filters" in low and "filters" in tool:
                    tool = {k: v for k, v in tool.items() if k != "filters"}
                    payload["tools"] = [tool]
                    continue
                if "user_location" in low and "user_location" in tool:
                    tool = {k: v for k, v in tool.items() if k != "user_location"}
                    payload["tools"] = [tool]
                    continue
                if "include" in low and "include" in payload:
                    payload.pop("include", None)
                    continue
                if "web_search" in low and tool.get("type") == "web_search":
                    # Older accounts/models only know the preview tool.
                    tool = {"type": "web_search_preview"}
                    payload["tools"] = [tool]
                    continue
            if r.status_code in (404, 400, 403) and _MODEL_GONE.search(text):
                _dead.add(model)
            break
    with _usage_lock:
        USAGE.failures += 1
    raise AiUnavailable(last_err or "no search model answered")


def parse_responses_output(data: dict) -> dict:
    """Pull text, url_citation annotations, and consulted sources out of a
    Responses API body. Pure — unit-tested with canned payloads."""
    text_parts: list[str] = []
    citations: list[dict] = []
    sources: list[str] = []
    search_calls = 0
    for item in data.get("output") or []:
        kind = item.get("type")
        if kind == "web_search_call":
            search_calls += 1
            action = item.get("action") or {}
            for s in action.get("sources") or []:
                u = s.get("url") if isinstance(s, dict) else None
                if u and u not in sources:
                    sources.append(u)
        elif kind == "message":
            for part in item.get("content") or []:
                if part.get("type") in ("output_text", "text"):
                    text_parts.append(part.get("text") or "")
                    for ann in part.get("annotations") or []:
                        if ann.get("type") == "url_citation" and ann.get("url"):
                            citations.append({"url": ann["url"], "title": ann.get("title") or ""})
    if not text_parts and isinstance(data.get("output_text"), str):
        text_parts.append(data["output_text"])
    return {"text": "\n".join(text_parts).strip(), "citations": citations,
            "sources": sources, "search_calls": search_calls}


async def chat_json_async(settings: Settings, system: str, user: str, **kw) -> dict:
    return await asyncio.to_thread(chat_json, settings, system, user, **kw)


async def responses_web_search_async(settings: Settings, prompt: str, **kw) -> dict:
    return await asyncio.to_thread(responses_web_search, settings, prompt, **kw)


def reset_state_for_tests() -> None:
    global USAGE
    USAGE = Usage()
    _working.clear()
    _dead.clear()

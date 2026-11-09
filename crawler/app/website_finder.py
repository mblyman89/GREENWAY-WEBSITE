"""D220 S5 — find the official website of every vendor that has none on file.

D219 recon: 107 vendors have stock on hand, but only 30 have a website saved.
Without a website a vendor can't be crawled, so its profile stays thin.

For each vendor:
  1. SEARCH  — OpenAI Responses API with the hosted web_search tool (the owner
               chose OpenAI). The prompt carries the vendor's licensed legal
               name, trade name, WSLCB license number and city, and asks for
               the brand's OWN site. Marketplaces / menus / socials are blocked
               at the tool level and filtered again here. When AI is not
               configured or fails, the free DuckDuckGo HTML search is used.
  2. VERIFY  — each candidate homepage is fetched once (SSRF guard + robots +
               per-domain delay) and scored on evidence: vendor name in the
               <title>/og:site_name/h1, the license number on the page, WA
               cannabis signals (I-502, WSLCB, "21+", Washington), cannabis
               product words. Evidence is stored verbatim for the reviewer.
  3. STAGE   — candidates land in vendor_website_candidates as PENDING. A human
               approves one in the back office (which sets vendors.website).
               Nothing is written to vendors automatically.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from . import ai_client
from .campaign_store import get_store, now_iso
from .catalog import name_similarity, name_tokens, normalize_name
from .config import Settings, get_settings
from .discovery_search import (
    _MARKETPLACE_HOSTS,
    _SOCIAL_HOSTS,
    discover_vendor_sites,
    is_excluded_host,
)
from .fetcher import _client_kwargs, _respect_rate_limit_async, _robots_allows, url_is_safe

log = logging.getLogger("crawler.website_finder")

MAX_VENDORS_PER_JOB = 300
MAX_CANDIDATES_VERIFIED = 4
_URL_RE = re.compile(r"https?://[^\s\"'<>)\]]+", re.I)
_WA_SIGNALS = ("washington", "wslcb", "i-502", "i502", "lcb", "wa state", "seattle", "spokane", "tacoma",
               "olympia", "bellingham", "yakima", "wenatchee", "vancouver, wa", "21+", "21 and over",
               "21 years")
_CANNABIS_WORDS = ("cannabis", "marijuana", "flower", "pre-roll", "preroll", "rosin", "concentrate", "edible",
                   "vape", "cartridge", "strain", "thc", "indica", "sativa", "hybrid", "dispensar", "i-502")
_COMPANY_SUFFIX = re.compile(r"\b(llc|inc|corp|co|company|ltd|l\.l\.c|enterprises|holdings|group)\b\.?", re.I)


@dataclass
class VendorQuery:
    vendor_id: str
    name: str
    legal_name: str = ""
    dba: str = ""
    license_number: str = ""
    city: str = ""

    def names(self) -> list[str]:
        out: list[str] = []
        for n in (self.name, self.dba, self.legal_name):
            n = (n or "").strip()
            if n and n.lower() not in [o.lower() for o in out]:
                out.append(n)
        return out


@dataclass
class Evidence:
    title: str = ""
    site_name: str = ""
    h1: str = ""
    final_url: str = ""
    name_in_title: bool = False
    name_in_text: bool = False
    name_score: float = 0.0
    license_found: bool = False
    wa_signals: list[str] = field(default_factory=list)
    cannabis_words: list[str] = field(default_factory=list)
    age_gate: bool = False
    search_reason: str = ""
    http_status: int = 0
    error: str = ""


@dataclass
class Candidate:
    url: str
    host: str
    source: str = "openai_web_search"
    rank: int = 0
    confidence: float = 0.0
    verify_status: str = "unverified"
    evidence: Evidence = field(default_factory=Evidence)

    def row(self, vendor_id: str) -> dict:
        ev = asdict(self.evidence)
        ev["rank"] = self.rank
        return {"vendor_id": vendor_id, "url": self.url[:500], "host": self.host[:200], "source": self.source,
                "confidence": round(max(0.0, min(1.0, self.confidence)), 2),
                "verify_status": self.verify_status, "evidence": ev}


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested)
# ---------------------------------------------------------------------------
def bare_host(url_or_host: str) -> str:
    h = url_or_host
    if "://" in h:
        h = urlparse(h).netloc
    h = h.lower().split(":")[0].strip().rstrip(".")
    return h[4:] if h.startswith("www.") else h


def homepage(url: str) -> str:
    p = urlparse(url.strip())
    if p.scheme not in ("http", "https") or not p.netloc:
        return ""
    return f"https://{p.netloc.lower()}/"


def core_name(name: str) -> str:
    """'Green Valley Farms LLC' -> 'green valley farms'."""
    return normalize_name(_COMPANY_SUFFIX.sub(" ", name or ""))


def is_blocked(host: str) -> bool:
    return is_excluded_host(host) or any(host == h or host.endswith("." + h) for h in _MARKETPLACE_HOSTS)


def search_prompt(v: VendorQuery) -> str:
    parts = [f"Find the official website of the Washington State licensed cannabis company \"{v.name}\"."]
    if v.legal_name and v.legal_name.lower() != v.name.lower():
        parts.append(f"Its licensed legal name is \"{v.legal_name}\".")
    if v.dba and v.dba.lower() not in (v.name.lower(), (v.legal_name or "").lower()):
        parts.append(f"It also trades as \"{v.dba}\".")
    if v.license_number:
        parts.append(f"WSLCB license number: {v.license_number}.")
    if v.city:
        parts.append(f"Located in or near {v.city}, Washington.")
    parts.append(
        "It is a cannabis producer/processor (a brand), not a retail store. I need the brand's OWN website — "
        "not Leafly, Weedmaps, Dutchie, Jane, LeafLink, a dispensary menu, a directory, a news article or "
        "social media. Answer with JSON only: {\"candidates\": [{\"url\": \"https://…\", \"reason\": \"why this is "
        "their site\", \"confidence\": 0..1}]} best first, at most 3. If you cannot find one, return "
        "{\"candidates\": []}."
    )
    return " ".join(parts)


def candidates_from_search(out: dict) -> list[tuple[str, str, float]]:
    """(homepage, reason, model_confidence) from a responses_web_search result."""
    found: list[tuple[str, str, float]] = []
    seen: set[str] = set()

    def add(url: str, reason: str, conf: float) -> None:
        hp = homepage(url)
        if not hp:
            return
        h = bare_host(hp)
        if not h or h in seen or is_blocked(h):
            return
        seen.add(h)
        found.append((hp, reason[:300], conf))

    text = out.get("text") or ""
    try:
        data = ai_client.parse_json_loose(text)
        for c in (data.get("candidates") or [])[:5]:
            if isinstance(c, dict) and c.get("url"):
                try:
                    conf = float(c.get("confidence") or 0.5)
                except Exception:
                    conf = 0.5
                add(str(c["url"]), str(c.get("reason") or ""), max(0.0, min(1.0, conf)))
    except Exception:
        for m in _URL_RE.findall(text):
            add(m, "mentioned in search answer", 0.4)
    for c in out.get("citations") or []:
        add(str(c.get("url") or ""), f"cited: {c.get('title') or ''}", 0.35)
    for s in (out.get("sources") or [])[:10]:
        add(str(s), "search source", 0.25)
    return found


def score_page(html: str, v: VendorQuery, *, final_url: str = "") -> Evidence:
    ev = Evidence(final_url=final_url)
    soup = BeautifulSoup(html or "", "lxml")
    if soup.title and soup.title.string:
        ev.title = soup.title.string.strip()[:200]
    og = soup.find("meta", attrs={"property": "og:site_name"})
    if og and og.get("content"):
        ev.site_name = og["content"].strip()[:200]
    h1 = soup.find("h1")
    if h1:
        ev.h1 = h1.get_text(" ", strip=True)[:200]
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    body = soup.get_text(" ", strip=True)[:60000]
    low = body.lower()
    head = " ".join(p for p in (ev.title, ev.site_name, ev.h1) if p)
    host_words = bare_host(final_url).split(".")[0].replace("-", " ") if final_url else ""
    best = 0.0
    for n in v.names():
        cn = core_name(n)
        if not cn:
            continue
        best = max(best, name_similarity(cn, core_name(head)) if head else 0.0)
        if cn and cn in normalize_name(head):
            ev.name_in_title = True
        if cn and cn in normalize_name(body[:20000]):
            ev.name_in_text = True
        # "greenvalleyfarms.com" for "Green Valley Farms"
        if host_words and cn.replace(" ", "") in host_words.replace(" ", ""):
            best = max(best, 0.85)
        toks = name_tokens(cn)
        if toks and host_words and all(t in host_words.replace(" ", "") for t in toks):
            best = max(best, 0.8)
    ev.name_score = round(best, 2)
    if v.license_number:
        lic = re.sub(r"\D", "", v.license_number)
        # A standalone digit run equal to the license number (not a substring
        # of a phone number or SKU).
        ev.license_found = bool(lic) and len(lic) >= 5 and lic in re.findall(r"\d+", body)
    ev.wa_signals = [w for w in _WA_SIGNALS if w in low][:8]
    ev.cannabis_words = [w for w in _CANNABIS_WORDS if w in low][:10]
    ev.age_gate = bool(re.search(r"(21\s*\+|21 or older|21 years|are you 21|of legal age|age verification)", low))
    return ev


def verdict(ev: Evidence, *, search_conf: float) -> tuple[str, float]:
    """(verify_status, confidence) from the page evidence."""
    if ev.error:
        return "unreachable", round(min(0.3, search_conf * 0.5), 2)
    name_ok = ev.name_in_title or ev.name_score >= 0.8
    cannabis = len(ev.cannabis_words) >= 2 or ev.age_gate
    score = 0.0
    score += 0.35 if name_ok else (0.2 if ev.name_in_text else 0.0)
    score += 0.25 if ev.license_found else 0.0
    score += 0.15 if cannabis else 0.0
    score += 0.1 if ev.wa_signals else 0.0
    score += 0.15 * max(0.0, min(1.0, search_conf))
    score = round(min(0.99, score), 2)
    if ev.license_found and (name_ok or ev.name_in_text):
        return "verified", max(score, 0.9)
    if name_ok and cannabis:
        return ("verified" if ev.wa_signals else "likely"), score
    if (name_ok or ev.name_in_text) and (cannabis or ev.wa_signals):
        return "likely", score
    return "mismatch", min(score, 0.4)


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------
async def fetch_homepage(settings: Settings, url: str) -> tuple[int, str, str, str]:
    """(status, html, final_url, error) — one polite GET of a candidate homepage."""
    safe, reason = await asyncio.to_thread(url_is_safe, url)
    if not safe:
        return 0, "", url, f"unsafe: {reason}"
    if not await asyncio.to_thread(_robots_allows, settings, url):
        return 0, "", url, "blocked by robots.txt"
    await _respect_rate_limit_async(settings, url)

    def _do() -> tuple[int, str, str, str]:
        try:
            with httpx.Client(**_client_kwargs(settings, timeout=20.0)) as c:
                r = c.get(url)
            final = str(r.url)
            ok, why = url_is_safe(final)
            if not ok:
                return 0, "", final, f"redirected somewhere unsafe: {why}"
            if r.status_code >= 400:
                return r.status_code, "", final, f"HTTP {r.status_code}"
            return r.status_code, r.text[:800_000], final, ""
        except Exception as e:  # noqa: BLE001
            return 0, "", url, f"{type(e).__name__}: {e}"[:300]

    return await asyncio.to_thread(_do)


async def find_for_vendor(settings: Settings, v: VendorQuery, *, use_ai: bool = True) -> list[Candidate]:
    raw: list[tuple[str, str, float, str]] = []
    if use_ai and settings.ai_enabled:
        try:
            out = await ai_client.responses_web_search_async(
                settings, search_prompt(v),
                blocked_domains=sorted(_MARKETPLACE_HOSTS | _SOCIAL_HOSTS),
            )
            raw = [(u, r, c, "openai_web_search") for u, r, c in candidates_from_search(out)]
        except ai_client.AiUnavailable as e:
            log.info("web search unavailable for %s (%s) — falling back to DuckDuckGo", v.name, e)
    if not raw:
        try:
            res = await discover_vendor_sites(v.name, location=v.city or "Washington", settings=settings,
                                              fetch_contact=False, limit=5)
            for c in res.candidates:
                raw.append((homepage(c.url), c.title[:200], min(0.6, 0.1 * c.score), "duckduckgo"))
        except Exception as e:  # noqa: BLE001
            log.info("duckduckgo search failed for %s: %s", v.name, e)
    cands: list[Candidate] = []
    seen: set[str] = set()
    for rank, (url, reason, conf, source) in enumerate(raw):
        h = bare_host(url)
        if not url or not h or h in seen or is_blocked(h):
            continue
        seen.add(h)
        if len(cands) >= MAX_CANDIDATES_VERIFIED:
            break
        status, html, final, err = await fetch_homepage(settings, url)
        final_host = bare_host(final) if final else h
        if final_host and final_host != h and is_blocked(final_host):
            ev = Evidence(final_url=final, search_reason=reason, error="redirects to a marketplace")
            cands.append(Candidate(url=url, host=h, source=source, rank=rank, confidence=0.05,
                                   verify_status="marketplace", evidence=ev))
            continue
        if err:
            ev = Evidence(final_url=final, search_reason=reason, error=err, http_status=status)
        else:
            ev = await asyncio.to_thread(score_page, html, v, final_url=final)
            ev.search_reason = reason
            ev.http_status = status
        status_s, confidence = verdict(ev, search_conf=conf)
        cands.append(Candidate(url=homepage(final) or url if not err else url, host=h, source=source,
                               rank=rank, confidence=confidence, verify_status=status_s, evidence=ev))
    cands.sort(key=lambda c: -c.confidence)
    return cands


# ---------------------------------------------------------------------------
# Background job (in-process; results are durable in the DB as they land)
# ---------------------------------------------------------------------------
_jobs: dict[str, dict] = {}
_job_tasks: dict[str, asyncio.Task] = {}


def start_job(vendors: list[dict], *, use_ai: bool = True, write: bool = True,
              settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    queries: list[VendorQuery] = []
    for v in vendors[:MAX_VENDORS_PER_JOB]:
        vid = str(v.get("vendor_id") or v.get("id") or "").strip()
        name = str(v.get("name") or v.get("display_name") or "").strip()
        if not vid or not name:
            continue
        queries.append(VendorQuery(vendor_id=vid, name=name, legal_name=str(v.get("legal_name") or ""),
                                   dba=str(v.get("dba") or ""), license_number=str(v.get("license_number") or ""),
                                   city=str(v.get("city") or "")))
    if not queries:
        raise ValueError("no vendors with an id and a name")
    jid = str(uuid.uuid4())
    job = {"id": jid, "status": "running", "total": len(queries), "done": 0, "found": 0, "verified": 0,
           "written": 0, "errors": [], "results": [], "started_at": now_iso(), "finished_at": None,
           "use_ai": use_ai}
    _jobs[jid] = job
    _job_tasks[jid] = asyncio.get_running_loop().create_task(_run_job(job, queries, use_ai, write, settings))
    return job


async def _run_job(job: dict, queries: list[VendorQuery], use_ai: bool, write: bool, settings: Settings) -> None:
    store = get_store(settings)
    sem = asyncio.Semaphore(3)

    async def one(v: VendorQuery) -> None:
        async with sem:
            if job.get("cancel"):
                return
            try:
                cands = await find_for_vendor(settings, v, use_ai=use_ai)
                if write and cands:
                    job["written"] += await asyncio.to_thread(store.upsert_website_candidates,
                                                              [c.row(v.vendor_id) for c in cands])
                best = cands[0] if cands else None
                job["results"].append({
                    "vendor_id": v.vendor_id, "name": v.name, "candidates": len(cands),
                    "best_url": best.url if best else None,
                    "best_status": best.verify_status if best else None,
                    "best_confidence": best.confidence if best else None,
                })
                if cands:
                    job["found"] += 1
                if best and best.verify_status in ("verified", "likely"):
                    job["verified"] += 1
            except Exception as e:  # noqa: BLE001
                job["errors"].append(f"{v.name}: {type(e).__name__}: {e}"[:300])
            finally:
                job["done"] += 1

    started = time.time()
    try:
        await asyncio.gather(*[one(v) for v in queries])
        job["status"] = "cancelled" if job.get("cancel") else "completed"
    except asyncio.CancelledError:
        job["status"] = "cancelled"
        raise
    finally:
        job["finished_at"] = now_iso()
        job["seconds"] = round(time.time() - started, 1)


def get_job(job_id: str) -> dict | None:
    return _jobs.get(job_id)


def list_jobs() -> list[dict]:
    return sorted(_jobs.values(), key=lambda j: j["started_at"], reverse=True)[:20]


def cancel_job(job_id: str) -> dict | None:
    job = _jobs.get(job_id)
    if job is not None:
        job["cancel"] = True
    return job


def reset_for_tests() -> None:
    for t in _job_tasks.values():
        if not t.done():
            t.cancel()
    _jobs.clear()
    _job_tasks.clear()

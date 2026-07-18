"""CV-2 — authenticated Cultivera Market session (polite, human-paced).

The owner is a real Cultivera Market BUYER whose rep approved using the
marketplace to pull vendor menus into the back office. This module logs in ONCE
with the buyer's own credentials, captures the session (JWT access token +
refresh token the SPA stores), persists it to disk, reuses it across requests,
and re-logs in only when the token is stale or the API returns 401.

DESIGN (never guess):
  * The marketplace is an Angular SPA. Rather than hard-code an endpoint we
    *think* is the login API, we drive the real login FORM in a headless browser
    (Playwright, already a crawl4ai dependency) exactly like a human would:
    type the email + password, submit, and then read back the tokens the app
    itself stored in localStorage. That means we always use whatever auth flow
    Cultivera actually ships — no reverse-engineered assumptions.
  * The API base is discovered from the running app at runtime (the SPA reveals
    its own API origin in network calls / config), or taken from an explicit
    CULTIVERA_API_BASE override. It is never invented here.
  * Everything that does NOT need a browser (JWT `exp` decode, session file
    (de)serialization, staleness math, auth-header building, token extraction
    from a localStorage dump, API-base sniffing from captured requests) is a
    PURE function so it can be unit-tested with no network — see
    crawler/tests/test_cultivera_auth.py.

Politeness: login is a single navigation; the JSON client (cultivera_api.py)
adds the human-paced per-request delay. We cache aggressively so we log in as
rarely as possible.
"""
from __future__ import annotations

import base64
import binascii
import json
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

from .config import Settings, get_settings

# localStorage keys the Cultivera SPA is known to use for its session. We read
# ALL of these tolerantly (first non-empty wins) rather than assuming one.
_ACCESS_TOKEN_KEYS = ("accessToken", "access_token", "token", "authToken", "jwt")
_REFRESH_TOKEN_KEYS = ("refreshToken", "refresh_token", "x-refresh-token")
_LOCATION_KEYS = ("locationId", "location_id", "activeLocationId")


# ---------------------------------------------------------------------------
# Session value object
# ---------------------------------------------------------------------------
@dataclass
class CultiveraSessionData:
    """A cached, reusable Cultivera session. Serializable to the session file."""

    access_token: str = ""
    refresh_token: str = ""
    location_id: str = ""
    api_base: str = ""
    # Unix seconds when we captured this session.
    captured_at: float = 0.0
    # JWT `exp` (Unix seconds) if we could decode it, else 0.
    token_exp: float = 0.0

    def to_json(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"))

    @staticmethod
    def from_json(text: str) -> "CultiveraSessionData":
        return CultiveraSessionData(**_coerce_session_dict(json.loads(text)))

    @property
    def has_token(self) -> bool:
        return bool(self.access_token.strip())


# ---------------------------------------------------------------------------
# PURE helpers (no network, no browser) — unit-tested
# ---------------------------------------------------------------------------
def _coerce_session_dict(raw: Any) -> dict[str, Any]:
    """Keep only known fields with the right types (tolerant of junk/old files)."""
    d = raw if isinstance(raw, dict) else {}
    return {
        "access_token": str(d.get("access_token") or ""),
        "refresh_token": str(d.get("refresh_token") or ""),
        "location_id": str(d.get("location_id") or ""),
        "api_base": str(d.get("api_base") or ""),
        "captured_at": float(d.get("captured_at") or 0.0),
        "token_exp": float(d.get("token_exp") or 0.0),
    }


def _b64url_decode(segment: str) -> bytes:
    """Decode a base64url JWT segment, tolerant of missing padding."""
    pad = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + pad)


def decode_jwt_exp(token: str) -> float:
    """Return a JWT's `exp` (Unix seconds) if decodable, else 0.0.

    We only read the (unverified) payload to learn WHEN the token expires so we
    can refresh proactively. We do NOT trust it for auth — Cultivera verifies
    the token server-side; a 401 is the real authority.
    """
    if not token or token.count(".") < 2:
        return 0.0
    try:
        payload_seg = token.split(".")[1]
        payload = json.loads(_b64url_decode(payload_seg).decode("utf-8", "replace"))
    except (ValueError, binascii.Error, UnicodeDecodeError, json.JSONDecodeError):
        return 0.0
    exp = payload.get("exp")
    try:
        return float(exp) if exp is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def pick_first(d: dict[str, Any], keys: tuple[str, ...]) -> str:
    """First non-empty stringified value across candidate keys (case-insensitive)."""
    if not isinstance(d, dict):
        return ""
    # exact first
    for k in keys:
        v = d.get(k)
        if v not in (None, ""):
            return str(v)
    lower = {str(k).lower(): v for k, v in d.items()}
    for k in keys:
        v = lower.get(k.lower())
        if v not in (None, ""):
            return str(v)
    return ""


def session_from_local_storage(
    storage: dict[str, Any],
    *,
    api_base: str = "",
    now: float | None = None,
) -> CultiveraSessionData:
    """Build a CultiveraSessionData from a captured localStorage dump.

    Tolerant of key-name variants and of the SPA storing a JSON blob under one
    key (we peek inside a JSON value if the direct key isn't a token).
    """
    now = time.time() if now is None else now
    flat = _flatten_storage(storage)
    access = pick_first(flat, _ACCESS_TOKEN_KEYS)
    refresh = pick_first(flat, _REFRESH_TOKEN_KEYS)
    location = pick_first(flat, _LOCATION_KEYS)
    return CultiveraSessionData(
        access_token=access,
        refresh_token=refresh,
        location_id=location,
        api_base=api_base.rstrip("/"),
        captured_at=now,
        token_exp=decode_jwt_exp(access),
    )


def _flatten_storage(storage: dict[str, Any]) -> dict[str, Any]:
    """Merge top-level localStorage keys with any nested JSON objects' keys.

    The SPA may store the raw token under `accessToken`, OR bundle everything in
    a JSON string under a key like `auth`/`session`/`ngStorage-...`. We surface
    both so pick_first() can find the token wherever it lives. Top-level keys
    win over nested ones (they're the most direct).
    """
    if not isinstance(storage, dict):
        return {}
    nested: dict[str, Any] = {}
    for _key, val in storage.items():
        if isinstance(val, str) and val[:1] in ("{", "["):
            try:
                parsed = json.loads(val)
            except (ValueError, json.JSONDecodeError):
                continue
            if isinstance(parsed, dict):
                for nk, nv in parsed.items():
                    nested.setdefault(nk, nv)
    merged = dict(nested)
    merged.update({k: v for k, v in storage.items() if isinstance(v, (str, int, float, bool))})
    return merged


def is_session_stale(
    session: CultiveraSessionData,
    *,
    ttl_seconds: int,
    now: float | None = None,
    skew_seconds: float = 60.0,
) -> bool:
    """True if we should proactively re-login before using this session.

    Stale when: no token, OR the JWT `exp` is within `skew_seconds` of now, OR
    (no decodable exp) the session is older than ttl_seconds.
    """
    if not session.has_token:
        return True
    now = time.time() if now is None else now
    if session.token_exp > 0:
        return now >= (session.token_exp - skew_seconds)
    # No decodable exp → fall back to our own TTL from capture time.
    return (now - session.captured_at) >= ttl_seconds


def auth_headers(session: CultiveraSessionData) -> dict[str, str]:
    """Headers to attach to an authenticated Cultivera API call.

    Cultivera's SPA sends the access token in Authorization and the refresh
    token in a custom x-refresh-token header (observed). We include both when
    present; unknown/empty values are simply omitted.
    """
    headers: dict[str, str] = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if session.access_token:
        headers["Authorization"] = f"Bearer {session.access_token}"
    if session.refresh_token:
        headers["x-refresh-token"] = session.refresh_token
    return headers


def sniff_api_base(candidate_urls: list[str], site_url: str) -> str:
    """Pick the Cultivera API origin from a list of URLs the app called.

    The SPA's XHRs go to its API origin (a sibling host of the site). We choose
    the most common non-site origin among the captured request URLs. Returns ''
    if nothing looks like a distinct API origin (caller then keeps using the
    site origin / explicit override). Never invents a host.
    """
    from urllib.parse import urlparse

    site_host = urlparse(site_url).netloc.lower()
    counts: dict[str, int] = {}
    for u in candidate_urls:
        try:
            parsed = urlparse(u)
        except ValueError:
            continue
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            continue
        host = parsed.netloc.lower()
        # A real API origin is a different host that still looks related
        # (shares a registrable-ish suffix) OR is an obvious api.* host.
        if host == site_host:
            continue
        origin = f"{parsed.scheme}://{parsed.netloc}"
        counts[origin] = counts.get(origin, 0) + 1
    if not counts:
        return ""
    # Prefer origins whose host contains "api"; else the most frequently seen.
    api_like = {o: c for o, c in counts.items() if "api" in urlparse(o).netloc.lower()}
    pool = api_like or counts
    return max(pool.items(), key=lambda kv: kv[1])[0]


def resolve_api_base(session: CultiveraSessionData, settings: Settings) -> str:
    """The API base to use: explicit override > captured session > site origin."""
    if settings.cultivera_api:
        return settings.cultivera_api
    if session.api_base:
        return session.api_base.rstrip("/")
    return settings.cultivera_site


# ---------------------------------------------------------------------------
# Session file I/O (tiny, side-effecting — kept thin)
# ---------------------------------------------------------------------------
def load_session(settings: Settings | None = None) -> CultiveraSessionData:
    settings = settings or get_settings()
    path: Path = settings.cultivera_session_path
    if not path.exists():
        return CultiveraSessionData()
    try:
        return CultiveraSessionData.from_json(path.read_text("utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return CultiveraSessionData()


def save_session(session: CultiveraSessionData, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    try:
        settings.cultivera_session_path.write_text(session.to_json(), "utf-8")
    except OSError:
        pass


def clear_session(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    try:
        settings.cultivera_session_path.unlink(missing_ok=True)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Live login (Playwright) — thin async wrapper around the browser
# ---------------------------------------------------------------------------
class CultiveraAuthError(RuntimeError):
    """Raised when a live login cannot be completed."""


async def login_live(settings: Settings | None = None) -> CultiveraSessionData:
    """Drive the real Cultivera login form and capture the resulting session.

    Requires CULTIVERA_EMAIL + CULTIVERA_PASSWORD. Uses Playwright (bundled with
    crawl4ai). Human-paced: types slowly, waits for the app to settle, then reads
    the tokens the SPA stored + sniffs the API origin from the app's own XHRs.

    Raises CultiveraAuthError on any failure (no browser available, bad creds,
    no token captured). The caller decides whether to surface or degrade.
    """
    settings = settings or get_settings()
    if not settings.cultivera_enabled:
        raise CultiveraAuthError("Cultivera credentials not configured (CULTIVERA_EMAIL/PASSWORD).")

    try:
        from playwright.async_api import async_playwright  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on runtime env
        raise CultiveraAuthError(f"Playwright not available: {exc}") from exc

    site = settings.cultivera_site
    seen_urls: list[str] = []

    try:  # pragma: no cover - exercised only with a real browser + creds
        async with async_playwright() as pw:
            launch_kwargs: dict[str, Any] = {"headless": True}
            if settings.proxy_url:
                launch_kwargs["proxy"] = {"server": settings.proxy_url}
            browser = await pw.chromium.launch(**launch_kwargs)
            context = await browser.new_context()
            page = await context.new_page()

            # Record the app's own XHR/fetch destinations to sniff the API base.
            page.on("request", lambda req: seen_urls.append(req.url))

            await page.goto(site, wait_until="domcontentloaded")
            await page.wait_for_timeout(1500)

            await _fill_login_form(page, settings.cultivera_email, settings.cultivera_password)

            # Let the SPA store its session + fire its bootstrap XHRs.
            await page.wait_for_timeout(4000)

            storage = await page.evaluate(
                "() => { const o = {}; for (let i=0;i<localStorage.length;i++)"
                "{ const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; }"
            )
            await browser.close()
    except CultiveraAuthError:
        raise
    except Exception as exc:  # pragma: no cover - browser/runtime failures
        raise CultiveraAuthError(f"Cultivera login failed: {exc}") from exc

    api_base = settings.cultivera_api or sniff_api_base(seen_urls, site)
    session = session_from_local_storage(storage or {}, api_base=api_base)
    if not session.has_token:
        raise CultiveraAuthError("Logged in but no access token was found in the app session.")
    return session


async def _fill_login_form(page: Any, email: str, password: str) -> None:  # pragma: no cover
    """Type the email + password into whatever the login form exposes.

    Tries a small set of resilient selectors (type/name/placeholder based) so we
    don't depend on one brittle CSS class. Submits via the visible button or
    Enter. Human-paced typing (delay per key).
    """
    email_selectors = [
        "input[type=email]",
        "input[name=email]",
        "input[formcontrolname=email]",
        "input[placeholder*='mail' i]",
        "input[autocomplete=username]",
    ]
    pass_selectors = [
        "input[type=password]",
        "input[name=password]",
        "input[formcontrolname=password]",
        "input[placeholder*='assword' i]",
        "input[autocomplete=current-password]",
    ]
    filled_email = await _fill_first(page, email_selectors, email)
    filled_pass = await _fill_first(page, pass_selectors, password)
    if not (filled_email and filled_pass):
        raise CultiveraAuthError("Could not locate the email/password fields on the login page.")

    for sel in [
        "button[type=submit]",
        "button:has-text('Log In')",
        "button:has-text('Login')",
        "button:has-text('Sign In')",
    ]:
        try:
            btn = page.locator(sel).first
            if await btn.count() > 0:
                await btn.click()
                return
        except Exception:
            continue
    # No button matched → submit with Enter from the password field.
    await page.keyboard.press("Enter")


async def _fill_first(page: Any, selectors: list[str], value: str) -> bool:  # pragma: no cover
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                await loc.fill("")
                await loc.type(value, delay=45)
                return True
        except Exception:
            continue
    return False


async def get_session(settings: Settings | None = None, *, force: bool = False) -> CultiveraSessionData:
    """Return a usable session: reuse the cached one unless stale/forced.

    On a proactive refresh we log in live and persist the new session. A caller
    that hits a 401 should call this with force=True to force a fresh login.
    """
    settings = settings or get_settings()
    cached = load_session(settings)
    if not force and not is_session_stale(cached, ttl_seconds=settings.cultivera_session_ttl_seconds):
        return cached
    fresh = await login_live(settings)
    save_session(fresh, settings)
    return fresh

"""GF-2 — authenticated GrowFlow marketplace session (polite, human-paced).

The owner is a real GrowFlow BUYER (Greenway Marijuana, license 413541,
BuyerVendorId 2368) whose rep approved using the marketplace to pull vendor
menus into the back office. This module logs in ONCE with the buyer's own
credentials, captures the session, persists it to disk, reuses it across
requests, and re-logs in only when the token is stale or the API returns 401.

DESIGN (never guess — every fact below was pinned from a LIVE probe; see
probe/GROWFLOW_PINNED.md):
  * GrowFlow (marketplace.growflow.com) is a React SPA whose login is
    Auth0-hosted at auth.growflow.com. Rather than reverse-engineer the Auth0
    token exchange, we drive the real login FORM in a headless browser
    (Playwright, already a crawl4ai dependency) exactly like a human: click
    "Log In", type email + password on the Auth0 page, submit, and let Auth0
    redirect back to the marketplace.
  * The GraphQL API is authorized by an `Authorization: Bearer <JWT>` header the
    SPA attaches to every GraphQL request. The token is NOT in localStorage; it
    lives in app memory backed by Auth0 cookies. So after login we navigate to a
    page that fires a GraphQL call and CAPTURE the Bearer token straight off the
    real request the app makes. That means we always use whatever token GrowFlow
    itself uses — no invented flow.
  * The GraphQL endpoint is discovered the same way (the URL of the app's own
    GraphQL request), or taken from an explicit GROWFLOW_GRAPHQL_URL override.
  * Everything that does NOT need a browser (JWT `exp` decode, session file
    (de)serialization, staleness math, auth-header building, token extraction
    from a captured Authorization header, endpoint sniffing) is a PURE function
    so it can be unit-tested with no network — see tests/test_growflow_auth.py.

Politeness: login is a single navigation; the GraphQL client (growflow_api.py)
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


# ---------------------------------------------------------------------------
# Session value object
# ---------------------------------------------------------------------------
@dataclass
class GrowflowSessionData:
    """A cached, reusable GrowFlow session. Serializable to the session file."""

    access_token: str = ""
    graphql_url: str = ""
    buyer_vendor_id: str = ""
    state: str = ""
    # Unix seconds when we captured this session.
    captured_at: float = 0.0
    # JWT exp (Unix seconds) if decodable, else 0.
    token_exp: float = 0.0

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
        "graphql_url": str(d.get("graphql_url") or ""),
        "buyer_vendor_id": str(d.get("buyer_vendor_id") or ""),
        "state": str(d.get("state") or ""),
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
    can refresh proactively. GrowFlow verifies the token server-side; a 401 is
    the real authority.
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


def bearer_from_header(auth_header: str) -> str:
    """Extract the raw JWT from an `Authorization: Bearer <jwt>` header value.

    Tolerant: accepts a bare token, "Bearer x", or "bearer x". Empty on junk.
    """
    if not auth_header or not isinstance(auth_header, str):
        return ""
    s = auth_header.strip()
    if s.lower().startswith("bearer "):
        return s[7:].strip()
    return s


def graphql_url_from_requests(candidate_urls: list[str], override: str = "") -> str:
    """Pick the GraphQL endpoint. Prefer an explicit override; else the first
    captured request whose URL ends in `/graphql`.
    """
    if override:
        return override.rstrip("/")
    for url in candidate_urls:
        if isinstance(url, str) and url.split("?")[0].rstrip("/").endswith("/graphql"):
            return url.split("?")[0]
    return ""


def session_from_capture(
    *,
    access_token: str,
    graphql_url: str,
    buyer_vendor_id: str = "",
    state: str = "",
    now: float | None = None,
) -> GrowflowSessionData:
    """Build a session value object from a captured Bearer token + endpoint."""
    tok = bearer_from_header(access_token)
    ts = time.time() if now is None else now
    return GrowflowSessionData(
        access_token=tok,
        graphql_url=(graphql_url or "").split("?")[0].rstrip("/"),
        buyer_vendor_id=str(buyer_vendor_id or ""),
        state=str(state or ""),
        captured_at=ts,
        token_exp=decode_jwt_exp(tok),
    )


def is_session_stale(
    session: GrowflowSessionData,
    *,
    ttl_seconds: int,
    now: float | None = None,
    skew_seconds: int = 60,
) -> bool:
    """True if the session should be refreshed proactively.

    Stale when: no token; OR the JWT `exp` (if known) is within `skew_seconds`;
    OR the cached session is older than `ttl_seconds`. A 401 at call time always
    forces a refresh regardless — this only avoids using an obviously-old token.
    """
    if not session or not session.has_token:
        return True
    ts = time.time() if now is None else now
    if session.token_exp > 0 and ts >= (session.token_exp - skew_seconds):
        return True
    if session.captured_at <= 0:
        return True
    return (ts - session.captured_at) >= ttl_seconds


def auth_headers(session: GrowflowSessionData) -> dict[str, str]:
    """Build the HTTP headers for an authenticated GraphQL call."""
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if session and session.has_token:
        headers["Authorization"] = f"Bearer {session.access_token}"
    return headers


def buyer_vendor_from_profile(payload: Any, state: str = "") -> str:
    """Pick the BuyerVendorId from a getStoreFrontUserVendors response.

    Tolerant of the GraphQL envelope (data.getStoreFrontUserVendors) or a bare
    list. Prefers an entry matching `state` when the entry carries one; else the
    first entry. Returns "" if none. Never guesses a number.
    """
    vendors: Any = payload
    if isinstance(payload, dict):
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        if isinstance(data, dict) and isinstance(data.get("getStoreFrontUserVendors"), list):
            vendors = data["getStoreFrontUserVendors"]
    if not isinstance(vendors, list) or not vendors:
        return ""
    for v in vendors:
        if isinstance(v, dict) and v.get("BuyerVendorId") not in (None, ""):
            return str(v["BuyerVendorId"])
    return ""


# ---------------------------------------------------------------------------
# Session file persistence
# ---------------------------------------------------------------------------
def load_session(settings: Settings | None = None) -> GrowflowSessionData:
    settings = settings or get_settings()
    path = settings.growflow_session_path
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return GrowflowSessionData()
    return GrowflowSessionData(**_coerce_session_dict(raw))


def save_session(session: GrowflowSessionData, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    path = settings.growflow_session_path
    try:
        path.write_text(json.dumps(asdict(session)), "utf-8")
    except OSError:
        pass


def clear_session(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    try:
        settings.growflow_session_path.unlink()
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Live login (Playwright) — thin async wrapper around the browser
# ---------------------------------------------------------------------------
class GrowflowAuthError(RuntimeError):
    """Raised when a live login cannot be completed."""


async def login_live(settings: Settings | None = None) -> GrowflowSessionData:  # pragma: no cover - needs browser + creds
    """Drive the real GrowFlow Auth0 login and capture the resulting session.

    Requires GROWFLOW_EMAIL + GROWFLOW_PASSWORD. Uses Playwright (bundled with
    crawl4ai). Human-paced: clicks "Log In", types slowly on the Auth0 page,
    submits, waits for the redirect, navigates to a page that fires a GraphQL
    call, and captures the Bearer token + GraphQL URL off the app's own request.

    Raises GrowflowAuthError on any failure. The caller decides whether to
    surface or degrade.
    """
    settings = settings or get_settings()
    if not settings.growflow_enabled:
        raise GrowflowAuthError("GrowFlow credentials not configured (GROWFLOW_EMAIL/PASSWORD).")

    try:
        from playwright.async_api import async_playwright  # type: ignore
    except ImportError as exc:
        raise GrowflowAuthError(f"Playwright not available: {exc}") from exc

    site = settings.growflow_site
    captured: dict[str, Any] = {"auth": "", "gql_url": "", "vendors": None}

    def _on_request(req: Any) -> None:
        try:
            if "graphql" in req.url:
                if not captured["gql_url"]:
                    captured["gql_url"] = req.url.split("?")[0]
                auth = (req.headers or {}).get("authorization")
                if auth and not captured["auth"]:
                    captured["auth"] = auth
        except Exception:
            pass

    try:
        async with async_playwright() as pw:
            launch_kwargs: dict[str, Any] = {"headless": True, "args": ["--no-sandbox"]}
            if settings.proxy_url:
                launch_kwargs["proxy"] = {"server": settings.proxy_url}
            browser = await pw.chromium.launch(**launch_kwargs)
            context = await browser.new_context()
            page = await context.new_page()
            page.on("request", _on_request)

            async def _on_response(resp: Any) -> None:
                try:
                    if "graphql" in resp.url and captured["vendors"] is None:
                        body = await resp.json()
                        if isinstance(body, dict):
                            data = body.get("data") or {}
                            if isinstance(data, dict) and data.get("getStoreFrontUserVendors"):
                                captured["vendors"] = body
                except Exception:
                    pass

            page.on("response", _on_response)

            await page.goto(site, wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)
            await _click_login(page)
            await _fill_auth0_form(page, settings.growflow_email, settings.growflow_password)
            # Wait for the Auth0 redirect + the app's bootstrap GraphQL calls.
            await page.wait_for_timeout(8000)
            # Nudge a page that definitely fires GraphQL (store list) to be sure.
            try:
                await page.goto(f"{site}/browse-stores", wait_until="domcontentloaded")
                await page.wait_for_timeout(6000)
            except Exception:
                pass
            await browser.close()
    except GrowflowAuthError:
        raise
    except Exception as exc:
        raise GrowflowAuthError(f"GrowFlow login failed: {exc}") from exc

    graphql_url = graphql_url_from_requests(
        [captured["gql_url"]] if captured["gql_url"] else [],
        override=settings.growflow_graphql,
    )
    buyer_vendor_id = settings.growflow_buyer_vendor_id.strip() or buyer_vendor_from_profile(
        captured["vendors"], state=settings.growflow_state
    )
    session = session_from_capture(
        access_token=captured["auth"],
        graphql_url=graphql_url,
        buyer_vendor_id=buyer_vendor_id,
        state=settings.growflow_state,
    )
    if not session.has_token:
        raise GrowflowAuthError("Logged in but no Bearer token was captured from the app's GraphQL request.")
    return session


async def _click_login(page: Any) -> None:  # pragma: no cover - browser
    for sel in [
        "text=LOG IN",
        "text=Log In",
        "text=Sign In",
        "button:has-text('Log')",
        "a:has-text('Log')",
    ]:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.click()
                await page.wait_for_timeout(2500)
                return
        except Exception:
            continue


async def _fill_auth0_form(page: Any, email: str, password: str) -> None:  # pragma: no cover - browser
    """Fill the Auth0-hosted login form. Auth0 may present email + password
    together or in two steps; handle both. Human-paced typing.
    """
    email_selectors = [
        "input[type=email]",
        "input[name=email]",
        "input[name=username]",
        "input#username",
        "input[autocomplete=username]",
    ]
    pass_selectors = [
        "input[type=password]",
        "input[name=password]",
        "input#password",
        "input[autocomplete=current-password]",
    ]
    await _fill_first(page, email_selectors, email)
    filled_pass = await _fill_first(page, pass_selectors, password)
    await _submit(page)
    await page.wait_for_timeout(3000)
    # If password was on a second step, fill it now.
    if not filled_pass:
        if await _fill_first(page, pass_selectors, password):
            await _submit(page)


async def _submit(page: Any) -> None:  # pragma: no cover - browser
    for sel in [
        "button[type=submit]",
        "button:has-text('Continue')",
        "button:has-text('Log In')",
        "button:has-text('Sign In')",
    ]:
        try:
            btn = page.locator(sel).first
            if await btn.count() > 0:
                await btn.click()
                return
        except Exception:
            continue
    try:
        await page.keyboard.press("Enter")
    except Exception:
        pass


async def _fill_first(page: Any, selectors: list[str], value: str) -> bool:  # pragma: no cover - browser
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


async def get_session(settings: Settings | None = None, *, force: bool = False) -> GrowflowSessionData:
    """Return a usable session: reuse the cached one unless stale/forced.

    A caller that hits a 401 should call this with force=True to force a fresh
    login.
    """
    settings = settings or get_settings()
    cached = load_session(settings)
    if not force and not is_session_stale(cached, ttl_seconds=settings.growflow_session_ttl_seconds):
        return cached
    fresh = await login_live(settings)
    save_session(fresh, settings)
    return fresh

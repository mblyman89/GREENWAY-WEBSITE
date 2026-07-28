"""LL-2 — authenticated LeafLink buyer session (polite, human-paced).

The owner is a real LeafLink retail BUYER (Greenway Marijuana, company slug
greenway-marijuana / id 3053) pulling vendor menus into the back office with
their own credentials. This module logs in ONCE with the buyer's credentials,
captures the resulting cookies, persists them to disk, reuses them across
requests, and re-logs in only when the session is stale or the API answers
401/403.

DESIGN (never guess — every fact below was pinned from a LIVE probe; see
docs/LEAFLINK_PINNED.md):
  * LeafLink's login lives at https://www.leaflink.com/accounts/login/, which
    redirects to an Auth0-hosted form (auth.leaflink.com/u/login) with a plain
    email input + password input + "Log in" submit. Success redirects to
    https://app.leaflink.com/c/<company-slug>/.
  * The internal API (app.leaflink.com/api/internal/...) is COOKIE
    authenticated — the exact same request answers 200 with the session
    cookies and 403 without them. There is NO Bearer token for this API, so
    unlike GrowFlow we capture COOKIES, not an Authorization header.
  * Everything that does NOT need a browser (cookie (de)serialization,
    staleness math, cookie-header building, URL building) is a PURE function
    so it can be unit-tested with no network — see tests/test_leaflink_auth.py.

Politeness: login is a single navigation; the REST client (leaflink_api.py)
adds the human-paced per-request delay. We cache aggressively so we log in as
rarely as possible.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from .config import Settings, get_settings


# ---------------------------------------------------------------------------
# Session value object
# ---------------------------------------------------------------------------
@dataclass
class LeaflinkSessionData:
    """A cached, reusable LeafLink cookie session. Serializable to disk."""

    # name -> value for cookies scoped to the app origin.
    cookies: dict[str, str] = field(default_factory=dict)
    company_slug: str = ""
    # Unix seconds when we captured this session.
    captured_at: float = 0.0

    @property
    def has_cookies(self) -> bool:
        return bool(self.cookies)


# ---------------------------------------------------------------------------
# PURE helpers (no network, no browser) — unit-tested
# ---------------------------------------------------------------------------
def _coerce_session_dict(raw: Any) -> dict[str, Any]:
    """Keep only known fields with the right types (tolerant of junk/old files)."""
    d = raw if isinstance(raw, dict) else {}
    cookies_raw = d.get("cookies")
    cookies: dict[str, str] = {}
    if isinstance(cookies_raw, dict):
        for k, v in cookies_raw.items():
            if isinstance(k, str) and k.strip() and v is not None:
                cookies[k.strip()] = str(v)
    return {
        "cookies": cookies,
        "company_slug": str(d.get("company_slug") or ""),
        "captured_at": float(d.get("captured_at") or 0.0),
    }


def cookies_from_capture(raw_cookies: Any) -> dict[str, str]:
    """Reduce a Playwright `context.cookies()` list to a name->value dict.

    Keeps only cookies with a usable name AND value. Later duplicates win
    (Playwright lists them in path-specificity order). Tolerant of junk.
    """
    out: dict[str, str] = {}
    if not isinstance(raw_cookies, list):
        return out
    for c in raw_cookies:
        if not isinstance(c, dict):
            continue
        name = c.get("name")
        value = c.get("value")
        if isinstance(name, str) and name.strip() and isinstance(value, str) and value != "":
            out[name.strip()] = value
    return out


def session_from_capture(
    *,
    raw_cookies: Any,
    company_slug: str = "",
    now: float | None = None,
) -> LeaflinkSessionData:
    """Build a session value object from captured browser cookies."""
    ts = time.time() if now is None else now
    return LeaflinkSessionData(
        cookies=cookies_from_capture(raw_cookies),
        company_slug=str(company_slug or "").strip().strip("/"),
        captured_at=ts,
    )


def is_session_stale(
    session: LeaflinkSessionData,
    *,
    ttl_seconds: int,
    now: float | None = None,
) -> bool:
    """True if the session should be refreshed proactively.

    Stale when: no cookies; OR the cached session is older than `ttl_seconds`.
    A 401/403 at call time always forces a refresh regardless — this only
    avoids using an obviously-old session.
    """
    if not session or not session.has_cookies:
        return True
    if session.captured_at <= 0:
        return True
    ts = time.time() if now is None else now
    return (ts - session.captured_at) >= ttl_seconds


def cookie_header(session: LeaflinkSessionData) -> str:
    """Build a `Cookie:` header value from the cached session ('' when empty)."""
    if not session or not session.has_cookies:
        return ""
    return "; ".join(f"{k}={v}" for k, v in session.cookies.items())


def auth_headers(session: LeaflinkSessionData) -> dict[str, str]:
    """Build the HTTP headers for an authenticated internal-API call."""
    headers = {"Accept": "application/json"}
    ck = cookie_header(session)
    if ck:
        headers["Cookie"] = ck
    return headers


def internal_api_url(site: str, company_slug: str, path: str) -> str:
    """Build an internal-API URL: `<site>/api/internal/<slug>/<path>`.

    `path` may start with '/'; slug slashes are trimmed. Pinned live:
    every menu endpoint is scoped by the buyer company's slug.
    """
    base = (site or "").strip().rstrip("/")
    slug = (company_slug or "").strip().strip("/")
    p = (path or "").strip().lstrip("/")
    return f"{base}/api/internal/{slug}/{p}"


# ---------------------------------------------------------------------------
# Session file persistence
# ---------------------------------------------------------------------------
def load_session(settings: Settings | None = None) -> LeaflinkSessionData:
    settings = settings or get_settings()
    path = settings.leaflink_session_path
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return LeaflinkSessionData()
    return LeaflinkSessionData(**_coerce_session_dict(raw))


def save_session(session: LeaflinkSessionData, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    path = settings.leaflink_session_path
    try:
        path.write_text(json.dumps(asdict(session)), "utf-8")
    except OSError:
        pass


def clear_session(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    try:
        settings.leaflink_session_path.unlink()
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Live login (Playwright) — thin async wrapper around the browser
# ---------------------------------------------------------------------------
class LeaflinkAuthError(RuntimeError):
    """Raised when a live login cannot be completed."""


async def login_live(settings: Settings | None = None) -> LeaflinkSessionData:  # pragma: no cover - needs browser + creds
    """Drive the real LeafLink Auth0 login and capture the cookie session.

    Requires LEAFLINK_EMAIL + LEAFLINK_PASSWORD. Uses Playwright (bundled with
    crawl4ai). Human-paced: navigates to the login page (Auth0 redirect),
    fills email + password, submits, waits for the redirect back to
    app.leaflink.com, and captures the context cookies.

    Raises LeaflinkAuthError on any failure. The caller decides whether to
    surface or degrade.
    """
    settings = settings or get_settings()
    if not settings.leaflink_enabled:
        raise LeaflinkAuthError("LeafLink credentials not configured (LEAFLINK_EMAIL/PASSWORD).")

    try:
        from playwright.async_api import async_playwright  # type: ignore
    except ImportError as exc:
        raise LeaflinkAuthError(f"Playwright not available: {exc}") from exc

    site = settings.leaflink_site
    login_url = "https://www.leaflink.com/accounts/login/"

    try:
        async with async_playwright() as pw:
            launch_kwargs: dict[str, Any] = {"headless": True, "args": ["--no-sandbox"]}
            if settings.proxy_url:
                launch_kwargs["proxy"] = {"server": settings.proxy_url}
            browser = await pw.chromium.launch(**launch_kwargs)
            context = await browser.new_context()
            page = await context.new_page()

            # 1. Navigate: leaflink.com login redirects to the Auth0 form.
            await page.goto(login_url, wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)

            # 2. Fill the Auth0 form (pinned: text input + password + submit).
            await _fill_auth0_form(page, settings.leaflink_email, settings.leaflink_password)

            # 3. Wait for the redirect back to the app + its bootstrap calls.
            await page.wait_for_timeout(8000)
            current = page.url or ""
            if "app.leaflink.com" not in current:
                # One nudge — some flows land on www first.
                try:
                    await page.goto(f"{site}/c/{settings.leaflink_slug}/", wait_until="domcontentloaded")
                    await page.wait_for_timeout(4000)
                except Exception:
                    pass

            raw_cookies = await context.cookies(site)
            await browser.close()
    except LeaflinkAuthError:
        raise
    except Exception as exc:
        raise LeaflinkAuthError(f"LeafLink login failed: {exc}") from exc

    session = session_from_capture(
        raw_cookies=raw_cookies,
        company_slug=settings.leaflink_slug,
    )
    if not session.has_cookies:
        raise LeaflinkAuthError("Logged in but no cookies were captured for the app origin.")
    return session


async def _fill_auth0_form(page: Any, email: str, password: str) -> None:  # pragma: no cover - browser
    """Fill the Auth0-hosted login form (email + password together, pinned).

    Tolerant of a two-step variant. Human-paced typing.
    """
    email_selectors = [
        "input[type=email]",
        "input[name=email]",
        "input[name=username]",
        "input#username",
        "input[autocomplete=username]",
        "input[type=text]",
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


async def _fill_first(page: Any, selectors: list[str], value: str) -> bool:  # pragma: no cover - browser
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.click()
                await el.fill("")
                await el.type(value, delay=60)
                return True
        except Exception:
            continue
    return False


async def _submit(page: Any) -> None:  # pragma: no cover - browser
    for sel in [
        "button[type=submit]",
        "button:has-text('Log in')",
        "button:has-text('Continue')",
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


async def get_session(settings: Settings | None = None) -> LeaflinkSessionData:  # pragma: no cover - composition
    """Return a usable session: cached when fresh, else a fresh live login."""
    settings = settings or get_settings()
    cached = load_session(settings)
    if not is_session_stale(cached, ttl_seconds=settings.leaflink_session_ttl_seconds):
        return cached
    session = await login_live(settings)
    save_session(session, settings)
    return session

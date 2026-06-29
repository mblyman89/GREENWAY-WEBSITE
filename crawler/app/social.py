"""Sanctioned social-content connector (DF-9).

The legitimate, ToS-clean way to read a vendor's PUBLIC social content:

  Tier 1 — Meta Graph API "Instagram Business Discovery".
    Greenway authenticates as ITSELF (a Greenway-owned Facebook Page linked to a
    Greenway Instagram BUSINESS account) and asks Meta's official API for ANOTHER
    business/creator account's PUBLIC profile + media (captions, image URLs,
    permalinks). This is a Meta-blessed endpoint built for exactly this. We never
    log in as the vendor, never use a fake account, never scrape a logged-in
    session. Token is a Page access token generated in the Meta dev console —
    NEVER a password. When META_GRAPH_TOKEN is unset, this soft-disables.

  Tier 2/3 fallback (handled by the normal crawler, not here): a public
    logged-out fetch of the brand's social page, or following their link-in-bio
    / Linktree / linked store to a normal website we can read directly.

What we extract from a social profile:
  • biography  -> a candidate "about" paragraph (verified + compliance-gated later)
  • recent post captions -> candidate product "description" drafts + image URLs

Everything returned here is still just RAW candidates; the pipeline's
verify-against-source + WA I-502 compliance gate + drafts-only review apply
exactly as they do for web pages.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import httpx

from .config import Settings, get_settings

_GRAPH = "https://graph.facebook.com"


@dataclass
class SocialPost:
    caption: str = ""
    image_url: str = ""
    permalink: str = ""
    media_type: str = ""  # IMAGE | VIDEO | CAROUSEL_ALBUM
    timestamp: str = ""


@dataclass
class SocialProfile:
    handle: str = ""
    ok: bool = False
    biography: str = ""
    website: str = ""
    followers: int | None = None
    profile_picture_url: str = ""
    posts: list[SocialPost] = field(default_factory=list)
    error: str = ""

    @property
    def image_urls(self) -> list[str]:
        urls = [self.profile_picture_url] if self.profile_picture_url else []
        urls += [p.image_url for p in self.posts if p.image_url]
        # De-dup, keep order.
        seen: set[str] = set()
        out: list[str] = []
        for u in urls:
            if u and u not in seen:
                seen.add(u)
                out.append(u)
        return out


def normalize_handle(value: str) -> str:
    """Accept '@name', 'name', or a full instagram.com/<name> URL → 'name'."""
    v = (value or "").strip()
    if not v:
        return ""
    m = re.search(r"instagram\.com/([A-Za-z0-9_.]+)", v)
    if m:
        v = m.group(1)
    return v.lstrip("@").strip("/").split("?")[0]


def _client(settings: Settings) -> httpx.Client:
    kwargs: dict = {"timeout": 20.0}
    if settings.proxy_url:
        kwargs["proxy"] = settings.proxy_url
    return httpx.Client(**kwargs)


def fetch_instagram_business(
    handle: str,
    *,
    limit: int = 12,
    settings: Settings | None = None,
) -> SocialProfile:
    """Pull a PUBLIC IG business/creator profile via Instagram Business Discovery.

    Requires META_GRAPH_TOKEN + META_IG_BUSINESS_ID (your own Greenway IG
    business account id). Returns a SocialProfile; ok=False with a helpful error
    when not configured or the handle isn't a discoverable business account.
    """
    settings = settings or get_settings()
    handle = normalize_handle(handle)
    if not handle:
        return SocialProfile(handle=handle, ok=False, error="empty handle")
    if not settings.social_enabled:
        return SocialProfile(handle=handle, ok=False, error="social not configured (META_GRAPH_TOKEN unset)")
    if not settings.meta_ig_business_id.strip():
        return SocialProfile(handle=handle, ok=False, error="META_IG_BUSINESS_ID unset")

    # The Business Discovery field expansion on YOUR ig user node.
    media_fields = "media_type,media_url,permalink,caption,timestamp"
    bd = (
        f"business_discovery.username({handle})"
        f"{{biography,website,followers_count,profile_picture_url,"
        f"media.limit({limit}){{{media_fields}}}}}"
    )
    url = f"{_GRAPH}/{settings.meta_graph_version}/{settings.meta_ig_business_id.strip()}"
    params = {"fields": bd, "access_token": settings.meta_graph_token.strip()}

    try:
        with _client(settings) as c:
            r = c.get(url, params=params)
        data = r.json()
    except Exception as e:
        return SocialProfile(handle=handle, ok=False, error=f"request failed: {e}")

    if "error" in data:
        msg = data["error"].get("message", "Graph API error")
        return SocialProfile(handle=handle, ok=False, error=msg)

    disc = data.get("business_discovery")
    if not isinstance(disc, dict):
        return SocialProfile(handle=handle, ok=False,
                             error="not a discoverable business/creator account")

    profile = SocialProfile(
        handle=handle,
        ok=True,
        biography=(disc.get("biography") or "").strip(),
        website=(disc.get("website") or "").strip(),
        followers=disc.get("followers_count"),
        profile_picture_url=(disc.get("profile_picture_url") or "").strip(),
    )
    media = disc.get("media", {})
    for node in (media.get("data") or [])[:limit]:
        profile.posts.append(SocialPost(
            caption=(node.get("caption") or "").strip(),
            image_url=(node.get("media_url") or "").strip(),
            permalink=(node.get("permalink") or "").strip(),
            media_type=(node.get("media_type") or "").strip(),
            timestamp=(node.get("timestamp") or "").strip(),
        ))
    return profile


def profile_text_blob(profile: SocialProfile) -> str:
    """All text the profile gave us, for verify-against-source grounding."""
    parts = [profile.biography]
    parts += [p.caption for p in profile.posts]
    return "\n".join(p for p in parts if p)

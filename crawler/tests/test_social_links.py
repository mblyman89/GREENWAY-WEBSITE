"""Slice H9d — pure-core tests for social-link detection & canonicalization.

No network, no Supabase. Exercises detect_social_links (the "click the social
media buttons" detector), canonical-URL normalization, dedupe, non-profile
filtering, and the format/handle helpers. The actual logged-out profile fetch is
I/O (fetch_page) and is covered by the shared fetcher hardening tests + manual
verification.
"""
from __future__ import annotations

from app.social_links import (
    SocialLink,
    detect_social_links,
    format_social_links,
    instagram_handle,
)


def _wrap(anchors: str) -> str:
    return f"<html><body><footer>{anchors}</footer></body></html>"


# ---------------------------------------------------------------------------
# detect_social_links — happy path across every supported platform
# ---------------------------------------------------------------------------

def test_detects_common_platforms():
    html = _wrap(
        '<a href="https://instagram.com/greenwaypo">IG</a>'
        '<a href="https://www.facebook.com/greenway">FB</a>'
        '<a href="https://twitter.com/greenway">TW</a>'
        '<a href="https://www.tiktok.com/@greenway">TT</a>'
        '<a href="https://www.youtube.com/@greenway">YT</a>'
        '<a href="https://www.linkedin.com/company/greenway">LI</a>'
    )
    links = detect_social_links(html, "https://vendor.example")
    platforms = {l.platform for l in links}
    assert platforms == {
        "instagram", "facebook", "twitter", "tiktok", "youtube", "linkedin",
    }


def test_instagram_canonicalizes_and_extracts_handle():
    html = _wrap('<a href="https://www.instagram.com/GreenwayPO/">Follow</a>')
    links = detect_social_links(html, "https://vendor.example")
    assert len(links) == 1
    assert links[0].platform == "instagram"
    assert links[0].url == "https://instagram.com/GreenwayPO"
    assert links[0].handle == "GreenwayPO"


def test_x_com_maps_to_twitter_platform():
    html = _wrap('<a href="https://x.com/greenway">X</a>')
    links = detect_social_links(html, "https://vendor.example")
    assert links[0].platform == "twitter"
    assert links[0].url == "https://x.com/greenway"
    assert links[0].handle == "greenway"


def test_tiktok_keeps_at_prefix_in_canonical():
    html = _wrap('<a href="https://tiktok.com/@greenway">TT</a>')
    links = detect_social_links(html, "https://vendor.example")
    assert links[0].url == "https://www.tiktok.com/@greenway"
    assert links[0].handle == "greenway"


def test_linktree_supported():
    html = _wrap('<a href="https://linktr.ee/greenway">links</a>')
    links = detect_social_links(html, "https://vendor.example")
    assert links[0].platform == "linktree"
    assert links[0].url == "https://linktr.ee/greenway"


def test_relative_and_protocol_relative_resolved_against_base():
    html = _wrap('<a href="//instagram.com/greenway">IG</a>')
    links = detect_social_links(html, "https://vendor.example")
    assert links[0].url == "https://instagram.com/greenway"


# ---------------------------------------------------------------------------
# Non-profile surfaces are rejected
# ---------------------------------------------------------------------------

def test_share_and_login_surfaces_rejected():
    html = _wrap(
        '<a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>'
        '<a href="https://twitter.com/intent/tweet?text=hi">tweet</a>'
        '<a href="https://instagram.com/">bare</a>'
        '<a href="https://www.facebook.com/login">login</a>'
    )
    links = detect_social_links(html, "https://vendor.example")
    assert links == []


def test_youtube_watch_and_youtu_be_rejected_channels_kept():
    html = _wrap(
        '<a href="https://www.youtube.com/watch?v=abc">video</a>'
        '<a href="https://youtu.be/abc">short</a>'
        '<a href="https://www.youtube.com/@greenway">channel</a>'
    )
    links = detect_social_links(html, "https://vendor.example")
    assert len(links) == 1
    assert links[0].platform == "youtube"
    assert links[0].handle == "greenway"


def test_non_social_hosts_ignored():
    html = _wrap(
        '<a href="https://vendor.example/about">about</a>'
        '<a href="mailto:hi@vendor.example">email</a>'
        '<a href="tel:+15551234567">call</a>'
        '<a href="#top">top</a>'
    )
    assert detect_social_links(html, "https://vendor.example") == []


# ---------------------------------------------------------------------------
# Dedupe / ordering / limit
# ---------------------------------------------------------------------------

def test_dedupes_by_canonical_url_keeps_first():
    html = _wrap(
        '<a href="https://instagram.com/greenway">1</a>'
        '<a href="https://www.instagram.com/greenway/">2</a>'
        '<a href="https://m.instagram.com/greenway">3</a>'
    )
    links = detect_social_links(html, "https://vendor.example")
    assert len(links) == 1
    assert links[0].url == "https://instagram.com/greenway"


def test_respects_limit():
    anchors = "".join(
        f'<a href="https://instagram.com/user{i}">u</a>' for i in range(30)
    )
    links = detect_social_links(_wrap(anchors), "https://vendor.example", limit=5)
    assert len(links) == 5


def test_empty_html_returns_empty():
    assert detect_social_links("", "https://vendor.example") == []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def test_format_social_links_body():
    links = [
        SocialLink("instagram", "https://instagram.com/greenway", "greenway"),
        SocialLink("linktree", "https://linktr.ee/greenway", "greenway"),
    ]
    body = format_social_links(links)
    assert "[Instagram] @greenway — https://instagram.com/greenway" in body
    assert "[Linktree] @greenway — https://linktr.ee/greenway" in body


def test_instagram_handle_picks_first_ig():
    links = [
        SocialLink("facebook", "https://www.facebook.com/greenway", "greenway"),
        SocialLink("instagram", "https://instagram.com/thepick", "thepick"),
        SocialLink("instagram", "https://instagram.com/second", "second"),
    ]
    assert instagram_handle(links) == "thepick"


def test_instagram_handle_empty_when_none():
    links = [SocialLink("facebook", "https://www.facebook.com/x", "x")]
    assert instagram_handle(links) == ""

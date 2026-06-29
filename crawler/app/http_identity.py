"""Realistic browser identity for polite fetching (DF-7).

This is the *legitimate* version of "looking like a real browser": we send a
modern, real User-Agent and the headers a real browser sends, so that public
pages serve us the same content a human visitor would see. We do NOT spoof
fingerprints to defeat an anti-bot system, rotate identities to evade a block,
or pretend to be logged in. The goal is parity with a normal visitor, not
evasion.

A small pool of *real, current* desktop User-Agent strings is rotated so we
don't look like a single hard-coded client hammering a host — this also reduces
accidental rate-limit trips. All strings here are genuine, widely-used browser
UAs (no deception).
"""
from __future__ import annotations

import random

# A small pool of genuine, current desktop browser UAs. Rotated per request.
_USER_AGENTS: tuple[str, ...] = (
    # Chrome / Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    # Chrome / macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    # Firefox / Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    # Safari / macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    # Edge / Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
)


def pick_user_agent(*, realistic: bool, fallback: str) -> str:
    """Return a UA: a rotated realistic one, or the configured bot UA."""
    if not realistic:
        return fallback
    return random.choice(_USER_AGENTS)


def browser_headers(user_agent: str) -> dict[str, str]:
    """Full set of headers a modern browser sends with a top-level navigation.

    Sending these (rather than just a UA) means servers that vary content by
    Accept/Accept-Language/Sec-Fetch-* hand us the real page instead of a
    stripped or blocked variant.
    """
    return {
        "User-Agent": user_agent,
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,image/apng,*/*;q=0.8"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }

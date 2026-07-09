"""crawler/app/image_urls.py — Slice H10b, PURE image-URL selection helpers.

The crawler harvested "a ton of images" from vendor sites that render as broken
or blank BLACK SQUARES. Reproduced (never guessed) against the real extractors:

    <img src="/theme/lazy.svg"   data-src="/products/real.jpg">   -> harvested "lazy.svg"
    <img src="/assets/loading.gif" data-lazy-src="/real.jpg">     -> harvested "loading.gif"
    <img src="/img/default.jpg"  data-lazy-src="/real.jpg">       -> harvested "default.jpg"
    <img src="data:image/svg..." data-src="/real.jpg">            -> harvested NOTHING (real lost)
    srcset "/big.jpg 1200w, /tiny.gif 1w"                         -> picked "/tiny.gif" (positional last)

ROOT CAUSE: the extractors preferred the ``src`` attribute over the lazy-load
``data-*`` attributes, and they only tested "is this a placeholder?" AFTER the
attribute was chosen. So on a lazy-loaded catalog (Shopify / WooCommerce / Wix /
Squarespace / Elementor / lazysizes), the tiny inline placeholder in ``src`` won
and the real image behind ``data-src`` / ``srcset`` was thrown away — a black
square. The old junk blocklist was also narrow (only sprite/1x1/pixel/tracking/
blank./spacer/placeholder) and ``srcset`` was read positionally instead of by
its width/pixel-density descriptor.

This module centralises the fix so the fetcher, the css extractor, and the logo
finder all select images the same way and can be unit-tested without a network:

  * ``is_placeholder_url``  — broadened placeholder/junk detector (incl. data:
    URIs and the common lazy-load placeholder filenames + tiny 1x1 shims).
  * ``parse_srcset``        — largest candidate chosen by the w / x descriptor,
    ignoring placeholder entries, not by list position.
  * ``best_image_url``      — pick the REAL image for one <img>/<source>: prefer
    a real srcset, then a real lazy data-* url, and only fall back to ``src``
    when nothing better exists — never a placeholder when a real url is present.

Pure: no imports beyond the stdlib. No network, no bs4 dependency (callers pass
plain attribute dicts), so the crawler test-suite pins the rules directly.
"""
from __future__ import annotations

import re

# Lazy-load url attributes used by the common gallery/lightbox/theme libraries
# (lazysizes, WooCommerce, Shopify, Wix, Squarespace, Elementor, ...). ORDER
# MATTERS: these are the REAL-image attributes and are tried BEFORE ``src``,
# because ``src`` is so often just an inline placeholder on a lazy-loaded page.
LAZY_URL_ATTRS: tuple[str, ...] = (
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-lazy",
    "data-image",
    "data-full-url",
    "data-large_image",
    "data-zoom-image",
    "data-flickity-lazyload",
    "data-echo",
)

# Substrings that mark a URL as a placeholder / tracking / chrome asset rather
# than real product/logo art. Kept deliberately conservative — every token here
# is a widely-used placeholder convention, so a real product filename is very
# unlikely to contain one as a path segment. Matched case-insensitively.
_PLACEHOLDER_TOKENS: tuple[str, ...] = (
    "sprite",
    "1x1",
    "pixel",
    "tracking",
    "spacer",
    "placeholder",
    "lazy",          # lazy.svg / lazy-placeholder.png / lazyload-fallback
    "loading",       # loading.gif
    "loader",        # loader.svg
    "no-image",
    "noimage",
    "no_image",
    "default-image",
    "dummy",
    "transparent",
    "skeleton",
    "lqip",          # low-quality image placeholder (base64 shimmer files)
    "shimmer",
    "blank",         # blank.gif / blank.png / img-blank
    "grey-",
    "gray-",
    "empty.",
)

# A bare "default.<ext>" filename (some themes name the placeholder default.jpg)
# — matched on the last path segment only so a real "/default-blend.jpg" product
# is not caught by the broad "default-image" token above.
_DEFAULT_FILE_RE = re.compile(r"/default\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$", re.I)

# A 1x1 / spacer expressed as WxH in the filename (e.g. "px_1x1.gif",
# "spacer-2x2.png") is already covered by 1x1/spacer; this also catches
# "blank-0x0".
_TINY_DIM_RE = re.compile(r"[-_/](?:0x0|1x1|2x2)[-_.]", re.I)


def is_placeholder_url(url: str | None) -> bool:
    """True when *url* looks like a placeholder / tracking / chrome asset.

    Covers: empty, ``data:`` URIs, the broadened placeholder token list, a bare
    ``default.<ext>`` filename, and tiny WxH-named shims.
    """
    if not url:
        return True
    u = url.strip()
    if not u:
        return True
    low = u.lower()
    # Inline data: URIs are never a real harvested asset we can re-host.
    if low.startswith("data:"):
        return True
    if _DEFAULT_FILE_RE.search(low):
        return True
    if _TINY_DIM_RE.search(low):
        return True
    return any(tok in low for tok in _PLACEHOLDER_TOKENS)


def _descriptor_weight(descriptor: str) -> float:
    """Numeric weight for a srcset descriptor like '1200w' or '2x' (higher=bigger).

    Width descriptors (``w``) and pixel-density descriptors (``x``) are ranked on
    the same scale by treating 1x ~ a nominal width so a plain "url 2x" still
    sorts above "url 1x". A missing/garbled descriptor sorts lowest but above 0.
    """
    d = descriptor.strip().lower()
    if not d:
        return 1.0  # no descriptor => single candidate; keep it, but lowest rank
    m = re.match(r"^(\d+(?:\.\d+)?)\s*([wx])$", d)
    if not m:
        return 1.0
    value = float(m.group(1))
    unit = m.group(2)
    # Density 'x' is tiny (1x/2x/3x); scale it up so it competes with 'w' widths.
    return value if unit == "w" else value * 1000.0


def parse_srcset(srcset: str | None) -> str:
    """Return the LARGEST real candidate URL from a srcset / data-srcset string.

    A srcset is "url1 descriptor1, url2 descriptor2, ..." where the descriptor
    is a width ("800w") or pixel density ("2x"). Chooses by descriptor weight —
    NOT by list position (themes do not guarantee ascending order and sometimes
    append a tiny fallback last). Placeholder candidates are skipped. Returns ""
    when nothing usable is found.
    """
    if not srcset:
        return ""
    best_url = ""
    best_weight = -1.0
    for part in srcset.split(","):
        part = part.strip()
        if not part:
            continue
        bits = part.split()
        url = bits[0].strip()
        if not url or is_placeholder_url(url):
            continue
        descriptor = bits[1] if len(bits) > 1 else ""
        weight = _descriptor_weight(descriptor)
        if weight > best_weight:
            best_weight = weight
            best_url = url
    return best_url


def best_image_url(get) -> str:
    """Pick the single best real image URL for one element.

    *get* is a callable ``attr -> value|None`` (e.g. a BeautifulSoup tag's
    ``.get``). Preference order, so a placeholder ``src`` can never beat a real
    lazy image:

      1) the largest real candidate in ``srcset`` / ``data-srcset``,
      2) the first real url among the lazy ``data-*`` attributes,
      3) ``src`` — but ONLY when it is not itself a placeholder,
      4) as a last resort, ``src`` even if it looks like a placeholder is
         STILL rejected (returns "") — a blank square is never useful.

    Returns "" when the element has no usable real image.
    """
    # 1) srcset (largest, real).
    srcset = get("srcset") or get("data-srcset") or ""
    best = parse_srcset(srcset)
    if best and not is_placeholder_url(best):
        return best

    # 2) real lazy data-* url.
    for attr in LAZY_URL_ATTRS:
        v = get(attr)
        if v and not is_placeholder_url(v):
            return v.strip()

    # 3) plain src, only when it is a real image.
    src = get("src")
    if src and not is_placeholder_url(src):
        return src.strip()

    # 4) nothing real -> refuse (better no image than a black square).
    return ""

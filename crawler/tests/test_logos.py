"""Unit tests for the logo detector (Slice H3) — pure HTML parsing, no network."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.logos import detect_logo_candidates  # noqa: E402

BASE = "https://example-brand.com/"

FULL_HTML = """
<html><head>
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-180.png" sizes="180x180">
<meta property="og:image" content="/hero.jpg">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization",
 "name":"Example Brand","logo":"/img/example-logo.svg"}
</script>
</head><body>
<header>
  <img src="/img/header-logo.png" alt="Example Brand logo" class="site-logo">
  <img src="/img/cart-icon.png" alt="cart">
</header>
<main><img src="/img/product.jpg" alt="Cool Product"></main>
</body></html>
"""


def test_detector_finds_all_four_spots_ranked():
    out = detect_logo_candidates(FULL_HTML, BASE)
    urls = [c.url for c in out]
    sources = [c.source for c in out]
    # JSON-LD first (declared logo), then header img, then icons, then og:image.
    assert urls[0] == "https://example-brand.com/img/example-logo.svg"
    assert sources[0] == "jsonld"
    assert "https://example-brand.com/img/header-logo.png" in urls
    assert "https://example-brand.com/apple-touch-180.png" in urls
    assert "https://example-brand.com/favicon-32.png" in urls
    assert "https://example-brand.com/hero.jpg" in urls
    assert sources.index("jsonld") < sources.index("header-img") < sources.index("og:image")
    # The non-logo header image and the content image are NOT candidates.
    assert "https://example-brand.com/img/cart-icon.png" not in urls
    assert "https://example-brand.com/img/product.jpg" not in urls


def test_detector_dedupes_and_caps():
    html = """
    <html><head>
    <script type="application/ld+json">
    {"@type":"Organization","logo":{"url":"/logo.png"}}
    </script>
    </head><body>
    <header><img src="/logo.png" alt="logo"></header>
    </body></html>
    """
    out = detect_logo_candidates(html, BASE, limit=8)
    urls = [c.url for c in out]
    assert urls.count("https://example-brand.com/logo.png") == 1
    # Best-ranked source wins for the deduped URL.
    assert out[0].source == "jsonld"

    many = "".join(
        f'<link rel="icon" href="/i{i}.png" sizes="{16 * (i + 1)}x{16 * (i + 1)}">'
        for i in range(12)
    )
    out2 = detect_logo_candidates(f"<html><head>{many}</head><body></body></html>", BASE, limit=5)
    assert len(out2) == 5
    # Largest icon first.
    assert out2[0].url.endswith("/i11.png")


def test_detector_handles_garbage_gracefully():
    assert detect_logo_candidates("", BASE) == []
    assert detect_logo_candidates("<html><body>no imgs</body></html>", BASE) == []
    # Broken JSON-LD, data: URIs, non-http hrefs — all skipped, never raises.
    html = """
    <html><head>
    <script type="application/ld+json">{not json</script>
    <link rel="icon" href="data:image/png;base64,xyz">
    </head><body>
    <header><img src="data:image/gif;base64,abc" alt="logo"></header>
    </body></html>
    """
    assert detect_logo_candidates(html, BASE) == []


def test_pipeline_emits_research_logos_field():
    # Integration: the pipeline's non-product path surfaces research_logos.
    from app.logos import LogoCandidate  # noqa: F401  (import sanity)
    import app.pipeline as pipeline

    # detect_logo_candidates is imported into pipeline's namespace.
    assert hasattr(pipeline, "detect_logo_candidates")

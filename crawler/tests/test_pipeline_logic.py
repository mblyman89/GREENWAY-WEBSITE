"""Unit tests for the crawler's PURE logic — no network, no browser, no LLM.

Covers the safety-critical gates: compliance scan, verify-against-source, and
CSS-first extraction. Run with:  python -m pytest -q   (or the included runner).
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make `app` importable when run directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.compliance import check_compliance  # noqa: E402
from app.css_extract import extract_css  # noqa: E402
from app.llm_extract import supported_by_source  # noqa: E402
from app.pipeline import _evaluate_field  # noqa: E402


def test_compliance_blocks_medical_claim():
    r = check_compliance("This strain treats anxiety and relieves pain.")
    assert not r.ok
    assert any("medical claim" in f or "symptom-relief" in f or "named medical" in f for f in r.flags)


def test_compliance_allows_sensory_copy():
    r = check_compliance("A craft hybrid with bright citrus aroma and a smooth, earthy finish.")
    assert r.ok
    assert r.blocking_flags == []


def test_compliance_extra_banned_phrase():
    r = check_compliance("Our gas is unbeatable.", extra_banned=["unbeatable"])
    assert not r.ok


def test_verify_rejects_hallucination():
    page = "Evergreen Hydro Farms grows sun-cured craft cannabis in Eastern Washington."
    made_up = "Evergreen won the 2019 Emerald Cup and partners with three Michelin restaurants."
    assert supported_by_source(made_up, page) is False


def test_verify_accepts_grounded_paraphrase():
    page = "Evergreen Hydro Farms grows sun-cured craft cannabis in Eastern Washington since 2014."
    grounded = "Evergreen Hydro Farms grows sun-cured craft cannabis in Eastern Washington."
    assert supported_by_source(grounded, page) is True


def test_verify_short_value_substring():
    page = "Visit us at https://example-brand.com for more."
    assert supported_by_source("https://example-brand.com", page) is True
    assert supported_by_source("https://other-site.com", page) is False


def test_css_extracts_jsonld_and_og():
    html = """
    <html><head>
      <title>Acme Cannabis</title>
      <meta property="og:description" content="Acme makes small-batch concentrates in Tacoma.">
      <meta property="og:image" content="/img/logo.png">
      <script type="application/ld+json">
        {"@type":"Organization","url":"https://acme.example","slogan":"Craft over quantity."}
      </script>
    </head><body><div id="about">Acme has been crafting concentrates since 2016 in Tacoma, WA.</div></body></html>
    """
    css = extract_css(html, "https://acme.example")
    assert css.website == "https://acme.example"
    assert css.mission_statement == "Craft over quantity."
    assert "concentrates" in css.about.lower()
    assert any(u.endswith("/img/logo.png") for u in css.image_urls)


def test_evaluate_field_drops_unsupported_llm_value():
    page = "Acme makes small-batch concentrates in Tacoma."
    outcome = _evaluate_field(
        "about",
        "Acme is the largest cannabis brand in the United States with 400 retail stores.",
        0.8, "llm", page, [],
    )
    assert outcome.accepted is False
    assert "not supported" in outcome.reason


def test_evaluate_field_drops_noncompliant_value():
    page = "Acme gummies cure anxiety and treat insomnia, doctors say."
    outcome = _evaluate_field("about", "Acme gummies cure anxiety and treat insomnia.", 0.9, "css", page, [])
    assert outcome.accepted is False
    assert "compliance" in outcome.reason


def test_evaluate_field_accepts_clean_grounded_value():
    page = "Acme makes small-batch live resin with bright citrus and pine notes in Tacoma."
    outcome = _evaluate_field(
        "about",
        "Acme makes small-batch live resin with bright citrus and pine notes in Tacoma.",
        0.9, "css", page, [],
    )
    assert outcome.accepted is True


if __name__ == "__main__":
    # Tiny built-in runner so it works even without pytest installed.
    import traceback

    funcs = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in funcs:
        try:
            fn()
            print(f"PASS {fn.__name__}")
            passed += 1
        except Exception:
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{passed}/{len(funcs)} passed")
    sys.exit(0 if passed == len(funcs) else 1)

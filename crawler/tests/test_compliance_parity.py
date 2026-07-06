"""S-4 parity guard (crawler side) — no network, no browser, no LLM.

The compliance regex patterns are defined ONCE in the site's
`src/lib/ai/compliance-patterns.json`; the crawler ships a byte-identical copy
at `crawler/app/compliance_patterns.json`. These tests fail when:
  1. the crawler's copy has drifted from the site fixture (when the repo
     checkout contains both files — in the Docker image only the crawler copy
     exists, so the drift check is skipped there),
  2. any pattern fails to compile under Python `re`,
  3. the loaded rules miss a known-bad phrase or flag a known-good one.

Run with `python -m pytest -q` or the built-in runner at the bottom.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.compliance import PATTERNS_VERSION, _RISKY_PATTERNS, check_compliance  # noqa: E402

_CRAWLER_FIXTURE = Path(__file__).resolve().parent.parent / "app" / "compliance_patterns.json"
_SITE_FIXTURE = (
    Path(__file__).resolve().parent.parent.parent / "src" / "lib" / "ai" / "compliance-patterns.json"
)


def _sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def test_fixture_exists_and_loads():
    assert _CRAWLER_FIXTURE.exists(), "crawler copy of the pattern fixture is missing"
    assert PATTERNS_VERSION >= 1
    assert len(_RISKY_PATTERNS) > 0  # every pattern compiled under Python re


def test_no_drift_from_site_fixture():
    if not _SITE_FIXTURE.exists():
        return  # Docker image: only the crawler copy ships; drift is checked in CI/repo
    assert _sha256(_CRAWLER_FIXTURE) == _sha256(_SITE_FIXTURE), (
        "compliance_patterns.json has DRIFTED from src/lib/ai/compliance-patterns.json — "
        "fix: cp src/lib/ai/compliance-patterns.json crawler/app/compliance_patterns.json"
    )


def test_blocks_medical_claims():
    r = check_compliance("This strain treats anxiety and relieves pain.")
    assert r.ok is False
    assert len(r.blocking_flags) > 0


def test_blocks_dosing_and_minors_and_authority():
    assert check_compliance("Start with 1 gummy, 10 mg per serving.").ok is False
    assert check_compliance("Tastes like candy — kids love the look!").ok is False
    assert check_compliance("Doctor recommended and clinically proven.").ok is False
    assert check_compliance("Pairs great with a cold beer.").ok is False


def test_clean_sensory_copy_passes():
    r = check_compliance("A craft hybrid with bright citrus aroma and a smooth, earthy finish.")
    assert r.ok is True
    assert r.blocking_flags == []


def test_warn_only_hype_does_not_block():
    r = check_compliance("Top-shelf flower with premium quality buds.")
    assert r.ok is True  # warn tier never blocks
    assert len(r.flags) > 0


def test_owner_banned_phrase_blocks():
    r = check_compliance("Our gas is unbeatable.", extra_banned=["unbeatable"])
    assert r.ok is False


if __name__ == "__main__":
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

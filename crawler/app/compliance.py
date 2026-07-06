"""WA I-502 compliance scan — a faithful Python mirror of the site's
`src/lib/ai/compliance.ts` `checkCompliance`.

SINGLE SOURCE OF TRUTH: both sides load the SAME pattern fixture.
  • Site:    src/lib/ai/compliance-patterns.json
  • Crawler: crawler/app/compliance_patterns.json (byte-identical copy)

If the rules change, edit the site fixture and copy it here. Parity tests
(`crawler/tests/test_compliance_parity.py` here, and
`scripts/compliance/check-pattern-parity.ts` on the site) fail loudly when the
two copies drift, so the crawler can never silently run stale rules. All
patterns are written to be valid in BOTH JS RegExp and Python `re` syntax
(no lookbehind, no named groups).

The crawler runs this on every extracted text field so a non-compliant draft is
flagged (and blocking drafts are suppressed) before it ever reaches the review
queue.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

# Mirrors COMPLIANCE_SYSTEM's PROMPT_VERSION in compliance.ts.
PROMPT_VERSION = "v2-grounded"

Severity = str  # "block" | "warn"

_PATTERNS_FILE = Path(__file__).resolve().parent / "compliance_patterns.json"


@dataclass(frozen=True)
class _Pattern:
    pattern: re.Pattern[str]
    label: str
    severity: Severity


def _load_patterns() -> tuple[int, list[_Pattern]]:
    """Load the shared fixture. Fails loudly if the file is missing/invalid —
    the crawler must NEVER run without its compliance rules."""
    data = json.loads(_PATTERNS_FILE.read_text("utf-8"))
    version = int(data["patternsVersion"])
    patterns: list[_Pattern] = []
    for raw in data["patterns"]:
        flags = re.IGNORECASE if "i" in raw.get("flags", "") else 0
        severity = "block" if raw.get("severity") == "block" else "warn"
        patterns.append(_Pattern(re.compile(raw["pattern"], flags), raw["label"], severity))
    return version, patterns


PATTERNS_VERSION, _RISKY_PATTERNS = _load_patterns()


@dataclass
class ComplianceResult:
    ok: bool  # no blocking flags
    flags: list[str] = field(default_factory=list)  # all flags (block + warn)
    blocking_flags: list[str] = field(default_factory=list)  # must-fix only


def check_compliance(text: str, extra_banned: list[str] | None = None) -> ComplianceResult:
    """Scan text for risky language. Does not modify the text.

    `extra_banned` lets callers layer the owner's kb_banned_phrases on top of the
    hardcoded patterns (matched case-insensitively with word-ish boundaries).
    """
    flags: list[str] = []
    blocking: list[str] = []

    for p in _RISKY_PATTERNS:
        if p.pattern.search(text):
            flags.append(f"{p.label} (must fix)" if p.severity == "block" else f"{p.label} (heads-up)")
            if p.severity == "block":
                blocking.append(p.label)

    for phrase in extra_banned or []:
        trimmed = phrase.strip()
        if not trimmed:
            continue
        re_phrase = re.compile(rf"(^|\W){re.escape(trimmed)}(\W|$)", re.I)
        if re_phrase.search(text):
            label = f'banned phrase: "{trimmed}"'
            flags.append(f"{label} (must fix)")  # owner phrases default to blocking
            blocking.append(label)

    return ComplianceResult(ok=len(blocking) == 0, flags=flags, blocking_flags=blocking)

"""WA I-502 compliance scan — a faithful Python mirror of the site's
`src/lib/ai/compliance.ts` `checkCompliance`.

Kept deliberately in lock-step with the TypeScript version: same patterns, same
severities, same labels. If the site's rules change, change them here too. The
crawler runs this on every extracted text field so a non-compliant draft is
flagged (and blocking drafts are suppressed) before it ever reaches the review
queue.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Mirrors COMPLIANCE_SYSTEM's PROMPT_VERSION in compliance.ts.
PROMPT_VERSION = "v2-grounded"

Severity = str  # "block" | "warn"


@dataclass(frozen=True)
class _Pattern:
    pattern: re.Pattern[str]
    label: str
    severity: Severity


# Mirror of RISKY_PATTERNS in compliance.ts (same order, labels, severities).
_RISKY_PATTERNS: list[_Pattern] = [
    _Pattern(re.compile(r"\b(cure|cures|curing|heal|heals|healing|treat|treats|treating|remedy)\b", re.I),
             "medical claim (cure/treat/heal)", "block"),
    _Pattern(re.compile(r"\b(relieve|relieves|relief|reduces? (pain|anxiety|stress|inflammation))\b", re.I),
             "symptom-relief claim", "block"),
    _Pattern(re.compile(r"\b(pain|anxiety|depression|insomnia|ptsd|cancer|arthritis|migraine|nausea|seizure|adhd)\b", re.I),
             "named medical condition", "block"),
    _Pattern(re.compile(r"\b(safe|healthy|good for you|non-?addictive|harmless|wellness)\b", re.I),
             "safety/efficacy claim", "block"),
    _Pattern(re.compile(r"\b(dose|dosage|take \d|mg per|how much to (take|consume)|start with \d)\b", re.I),
             "dosing advice", "block"),
    _Pattern(re.compile(r"\b(candy|gummy bears?|kid|kids|children|cartoon|toy)\b", re.I),
             "appeal-to-minors language", "block"),
    _Pattern(re.compile(r"\b(alcohol|beer|wine|whiskey|tobacco|cigarette|nicotine|vodka)\b", re.I),
             "alcohol/tobacco association", "block"),
    _Pattern(re.compile(r"\b(guarantee|guaranteed|miracle|clinically proven|doctor recommended)\b", re.I),
             "unsubstantiated claim", "block"),
    _Pattern(re.compile(r"\b(best|amazing|incredible|unbeatable|world-?class)\b", re.I),
             "empty hype wording", "warn"),
    _Pattern(re.compile(r"\$\s?\d|\bprice\b|\bdiscount\b|\bsale\b", re.I),
             "price/discount mention", "warn"),
]


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

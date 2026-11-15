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

# -----------------------------------------------------------------------------
# D244 R-14 — read the words around a blocked word before blocking it.
# Owner: "cannabis is dried and then cured. it is called the cure process ...
# so it cant block us ... looking at the words before and after the word cure,
# or any of the blocked words for that matter".
# A faithful mirror of src/lib/ai/compliance-context-core.ts (same fixture
# `contextRules`, same algorithm; both sides run the fixture `examples`).
# -----------------------------------------------------------------------------
CONTEXT_RULES: dict = json.loads(_PATTERNS_FILE.read_text("utf-8"))["contextRules"]
_TOK_RE = re.compile(r"[A-Za-z0-9\u2019']+|[,:()\u2014\u2013]|[.!?;\n]")


def _tokens(text: str) -> list[tuple[str, int, str]]:
    out: list[tuple[str, int, str]] = []
    for m in _TOK_RE.finditer(text or ""):
        raw, start = m.group(0), m.start()
        if re.fullmatch(r"[.!?;\n]", raw):
            prev = text[start - 1] if start > 0 else ""
            nxt = text[start + 1] if start + 1 < len(text) else ""
            if raw == "." and prev.isdigit() and nxt.isdigit():
                continue
            out.append((raw, start, "s"))
        elif re.fullmatch(r"[,:()\u2014\u2013]", raw):
            out.append((raw, start, "c"))
        else:
            out.append((raw.lower().replace("\u2019", "'").strip("'"), start, "w"))
    return out


def _family(word: str, rules: dict) -> dict | None:
    w = (word or "").strip().lower()
    if not w or re.search(r"\s", w):
        return None
    for f in rules["families"]:
        if w in f["words"]:
            return f
    return None


def _side(toks, i: int, d: int, n: int, clause_only: bool) -> list[str]:
    out: list[str] = []
    j = i + d
    while 0 <= j < len(toks) and len(out) < n:
        t, _, kind = toks[j]
        if kind == "s":
            break
        if kind == "c":
            if clause_only:
                break
            j += d
            continue
        out.append(t)
        j += d
    return out


def _medical_near(toks, i: int, rules: dict) -> str | None:
    med, nb, na = set(rules["medicalWords"]), set(rules["medicalNeutralBefore"]), set(rules["medicalNeutralAfter"])
    wb, wa = rules["window"]["before"], rules["window"]["after"]
    before = list(reversed(_side(toks, i, -1, wb + 1, False)))
    after = _side(toks, i, 1, wa + 1, False)

    def check(words: list[str], lo: int, hi: int) -> str | None:
        for k in range(lo, hi):
            w = words[k]
            if w not in med:
                continue
            if k > 0 and words[k - 1] in nb:
                continue
            if k + 1 < len(words) and words[k + 1] in na:
                continue
            return w
        return None

    return check(before, max(0, len(before) - wb), len(before)) or check(after, 0, min(len(after), wa))


def judge_hit(text: str, start: int, word: str, rules: dict = CONTEXT_RULES) -> bool:
    """True when the hit at `start` reads as everyday (non-medical) use."""
    fam = _family(word, rules)
    if not fam:
        return False
    toks = _tokens(text)
    idx = next((k for k, t in enumerate(toks) if t[2] == "w" and t[1] == start), -1)
    if idx < 0 or _medical_near(toks, idx, rules):
        return False
    before = _side(toks, idx, -1, 6, True)
    after = _side(toks, idx, 1, 8, True)

    def within(words: list[str], r: dict | None) -> bool:
        return bool(r) and any(w in r["words"] for w in words[: r["reach"]])

    if fam["default"] == "allow":
        if within(before, fam.get("medicalBefore")) or within(after, fam.get("medicalAfter")):
            return False
        end = fam.get("medicalAfterAtEnd") or []
        if len(after) == 1 and after[0] in end:
            return False
        if fam.get("forNeedsTime") and after[:1] == ["for"]:
            k = 1
            while k < len(after) and after[k] in rules["forSkipWords"]:
                k += 1
            first = after[k] if k < len(after) else None
            if not first or not (first in rules["forTimeWords"] or first.isdigit()):
                return False
        return True
    return within(before, fam.get("benignBefore")) or within(after, fam.get("benignAfter"))


def pattern_blocks(text: str, pattern: re.Pattern[str], rules: dict = CONTEXT_RULES) -> bool:
    """A BLOCK pattern blocks when ANY of its hits is not everyday use."""
    for m in pattern.finditer(text or ""):
        if not judge_hit(text, m.start(), m.group(0), rules):
            return True
    return False


# -----------------------------------------------------------------------------
# D244 R-23 — the owner's Compliance guardrails settings (Knowledge base →
# Compliance guardrails; one site_settings row "compliance_guardrails").
# Owner round 10: "I need to be in control, and if I choose something is ok to
# do, thats my choice". Mirrors src/lib/ai/guardrails-state-core.ts: a level
# per rule ("block" / "warn" / "off", key = ai.<slug of the label>) and words
# allowed everywhere. The shared pattern fixture is NOT changed.
GUARDRAILS_SETTING_KEY = "compliance_guardrails"
_LEVELS = ("block", "warn", "off")
_RULE_KEY_RE = re.compile(r"^[a-z0-9_.-]{3,100}$")
_active_rules: dict[str, str] = {}
_active_allow: set[str] = set()
_warn_phrases: set[str] = set()


def ai_pattern_key(label: str) -> str:
    """Same key as aiPatternKey() on the site."""
    slug = re.sub(r"[^a-z0-9]+", "-", str(label or "").lower()).strip("-")[:90]
    return f"ai.{slug}"


def clean_allow_word(raw: object) -> str:
    s = re.sub(r"\s+", " ", str(raw or "").replace("\u2018", "'").replace("\u2019", "'")).strip().lower()
    return s if s and len(s) <= 80 else ""


def set_guardrails(value: object, warn_phrases: list[str] | None = None) -> None:
    """Make the owner's settings active (value = the site_settings value_json)."""
    global _active_rules, _active_allow, _warn_phrases
    rules: dict[str, str] = {}
    allow: set[str] = set()
    if isinstance(value, dict):
        raw_rules = value.get("rules")
        if isinstance(raw_rules, dict):
            for k, v in raw_rules.items():
                if isinstance(k, str) and _RULE_KEY_RE.match(k) and v in _LEVELS:
                    rules[k] = v
        raw_allow = value.get("allow")
        if isinstance(raw_allow, list):
            for w in raw_allow[:500]:
                c = clean_allow_word(w)
                if c:
                    allow.add(c)
    _active_rules = rules
    _active_allow = allow
    _warn_phrases = {p.strip().lower() for p in (warn_phrases or []) if p and p.strip()}


def rule_level(key: str, built_in: str) -> str:
    return _active_rules.get(key, built_in)


def is_allowed_word(word: str) -> bool:
    c = clean_allow_word(word)
    return bool(c) and c in _active_allow


def _judge_owner_hits(text: str, pattern: re.Pattern[str]) -> tuple[bool, bool]:
    """(hit, blocked): hits minus the owner's allowed words; blocked = one
    remaining hit is not everyday use (same reading as pattern_blocks)."""
    hit = False
    for m in pattern.finditer(text or ""):
        if not m.group(0) or is_allowed_word(m.group(0)):
            continue
        hit = True
        if not judge_hit(text, m.start(), m.group(0), CONTEXT_RULES):
            return True, True
    return hit, False


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
        # D244 R-23: the owner's level for this rule and the allowed words.
        level = rule_level(ai_pattern_key(p.label), p.severity)
        if level == "off":
            continue
        hit, blocked = _judge_owner_hits(text, p.pattern)
        if not hit:
            continue
        if level != "block":
            flags.append(f"{p.label} (heads-up)")
        elif blocked:
            flags.append(f"{p.label} (must fix)")
            blocking.append(p.label)
        else:  # D244 R-14: everyday use (e.g. the cure process) is a heads-up
            flags.append(f"{p.label} \u2014 allowed in context (heads-up)")

    for phrase in extra_banned or []:
        trimmed = phrase.strip()
        if not trimmed:
            continue
        re_phrase = re.compile(rf"(?:^|(?<=\W)){re.escape(trimmed)}(?=\W|$)", re.I)
        hit, blocked = _judge_owner_hits(text, re_phrase)
        if hit:
            label = f'banned phrase: "{trimmed}"'
            if trimmed.lower() in _warn_phrases:  # D244 R-23: the owner set it to Warn
                flags.append(f"{label} (heads-up)")
            elif blocked:
                flags.append(f"{label} (must fix)")
                blocking.append(label)
            else:
                flags.append(f"{label} \u2014 allowed in context (heads-up)")

    return ComplianceResult(ok=len(blocking) == 0, flags=flags, blocking_flags=blocking)

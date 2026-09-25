#!/usr/bin/env python3
"""SLICE L-43 -- refresh the L-5 mutation harness to match the hex-only core.

L-43 removed base64 and the per-encoding compare branch from hmac-core.ts, so
five L-5 mutation patterns no longer exist verbatim (the harness would report
HARNESS ERROR for them), and one mutation's LABEL became the opposite of true:
disabling the `rawBody === ""` branch now makes an empty unsigned delivery get
REFUSED (fail-closed), not accepted. Each replacement below targets the same
defect class as the original, against the current code.
"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "scripts/compliance/mutate-leafly-l5.py"
s = P.read_text()

def swap(old: str, new: str) -> None:
    global s
    if s.count(old) != 1:
        raise SystemExit(f"pattern count {s.count(old)} != 1: {old[:80]!r}")
    s = s.replace(old, new)

# 1. final verdict flips to accept on mismatch (the verdict now carries `outcome`)
swap(
    """     '  return {\\n    ok: false,\\n    matchedEncoding: null,\\n    reason: "mismatch",',
     '  return {\\n    ok: true,\\n    matchedEncoding: null,\\n    reason: "mismatch",'),""",
    """     '  return {\\n    outcome: "refused",\\n    ok: false,\\n    matchedEncoding: null,\\n    reason: "mismatch",',
     '  return {\\n    outcome: "verified",\\n    ok: true,\\n    matchedEncoding: null,\\n    reason: "mismatch",'),""",
)

# 2. The empty-body mutation: relabel to what it now means (L-43).
swap(
    """    (HMAC, "FAIL-OPEN: an empty request body is accepted",""",
    """    (HMAC, "L-43: Leafly's expected empty UNSIGNED delivery is refused instead of acknowledged",""",
)

# 3/4. base64 case-sensitivity no longer exists; hex case-insensitivity still does.
swap(
    """    (HMAC, "base64 is compared case-INSENSITIVELY, accepting genuinely wrong digests",
     '      encoding === "hex"\\n        ? timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase())\\n        : timingSafeStringEqual(computed, presented);',
     '      timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase());'),
    (HMAC, "hex becomes case-SENSITIVE, so an upper-case digest is rejected",
     '      encoding === "hex"\\n        ? timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase())\\n        : timingSafeStringEqual(computed, presented);',
     '      timingSafeStringEqual(computed, presented);'),""",
    """    (HMAC, "hex becomes case-SENSITIVE, so an upper-case digest is rejected",
     '    const matched = timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase());',
     '    const matched = timingSafeStringEqual(computed, presented);'),
    (HMAC, "FAIL-OPEN: the digest compare always matches",
     '    const matched = timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase());',
     '    const matched = true;'),""",
)

# 5/6. structural screen is now a single return.
swap(
    """     "export function looksLikeSha256Digest(value: string): boolean {\\n  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;",
     "export function looksLikeSha256Digest(value: string): boolean {\\n  if (value.length > 0) return true;\\n  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;"),""",
    """     "  return /^[0-9a-fA-F]{64}$/.test(value);\\n}",
     "  return value.length > 0 || /^[0-9a-fA-F]{64}$/.test(value);\\n}"),""",
)
swap(
    """     "  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;",
     "  if (/^[0-9a-fA-F]{63}$/.test(value)) return true;"),""",
    """     "  return /^[0-9a-fA-F]{64}$/.test(value);\\n}",
     "  return /^[0-9a-fA-F]{63}$/.test(value);\\n}"),""",
)

P.write_text(s)
print("refreshed", P)

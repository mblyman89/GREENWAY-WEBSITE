#!/usr/bin/env python3
"""SLICE 17 step 2 — surface `warnings` on LimitEvaluation and return it."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

CORE = ROOT / "src/lib/compliance/sales-limits-core.ts"

EDITS = [
    (
        """  /** Human-readable reasons for each exceeded bucket. */
  reasons: string[];
  /** Untracked (non-cannabis) line count, for transparency. */
  untrackedLines: number;
};""",
        """  /** Human-readable reasons for each exceeded bucket. */
  reasons: string[];
  /**
   * SLICE 17 — non-blocking advisories. Today this carries the "this looks
   * like a suppository and nobody has classified it" notice. A warning NEVER
   * affects `blocked`; it exists so an invisible gap becomes visible.
   */
  warnings: string[];
  /** Untracked (non-cannabis) line count, for transparency. */
  untrackedLines: number;
};""",
    ),
    (
        """    customerType,
    buckets,
    blocked: exceeded.length > 0,
    reasons,
    untrackedLines,
  };""",
        """    customerType,
    buckets,
    blocked: exceeded.length > 0,
    reasons,
    warnings,
    untrackedLines,
  };""",
    ),
]

text = CORE.read_text(encoding="utf-8")
for find, replace in EDITS:
    n = text.count(find)
    if n != 1:
        raise SystemExit(f"ANCHOR FAIL ({n}x): {find[:80]!r}")
    text = text.replace(find, replace)
CORE.write_text(text, encoding="utf-8")
print(f"OK: {len(EDITS)} anchors applied")

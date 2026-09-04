#!/usr/bin/env python3
"""SLICE 17 step 3 — teach clampLimitProfile and resolveLimits about the sixth
bucket.

WHY THIS MATTERS: with the field missing from clampLimitProfile the resolved
max came back `undefined`, `overBy` computed as NaN, `exceeded` was false, and
the ten-unit limit SILENTLY DID NOT BLOCK. The RED tests caught it.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

CORE = ROOT / "src/lib/compliance/sales-limits-core.ts"

EDITS = [
    (
        """    // SLICE 16 — mg THC, same clamp semantics: the owner may tighten below
    // 200 mg, never widen above it.
    low_thc_liquid: clamp(r.low_thc_liquid, base.low_thc_liquid),
  };
}""",
        """    // SLICE 16 — mg THC, same clamp semantics: the owner may tighten below
    // 200 mg, never widen above it.
    low_thc_liquid: clamp(r.low_thc_liquid, base.low_thc_liquid),
    // SLICE 17 — a COUNT. Same "tighten only" semantics, and additionally
    // floored to an integer: a limit of 10.5 units is not a thing, and a
    // fractional ceiling would make the boundary test ambiguous.
    otherwise_taken: Math.floor(clamp(r.otherwise_taken, base.otherwise_taken)),
  };
}""",
    ),
    (
        """      low_thc_liquid: overrides?.low_thc_liquid ?? base.low_thc_liquid,
    },
    base,
  );
}""",
        """      low_thc_liquid: overrides?.low_thc_liquid ?? base.low_thc_liquid,
      otherwise_taken: overrides?.otherwise_taken ?? base.otherwise_taken,
    },
    base,
  );
}""",
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

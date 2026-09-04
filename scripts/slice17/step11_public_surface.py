#!/usr/bin/env python3
"""SLICE 17 step 11 — the PUBLIC /medical purchase-limit table gains a sixth
row, and its test is STRENGTHENED to cover it.

The public table is a compliance surface in its own right: publishing a figure
we do not enforce (or omitting a limit we do) is a misstatement to customers.
SLICE 16 established the discipline of deriving every figure from the register's
own constants; this row follows it exactly.

Note the row label deliberately says "units" and never a weight. A count
rendered with an oz/g suffix would be the same class of factual error the
existing "7.143 oz trap" test guards against for milligrams.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

SRC = "src/lib/medical/purchase-limit-display-core.ts"
TEST = "tests/compliance/public-surfaces-core.test.ts"

EDITS: list[tuple[str, str, str]] = [
    # ---- the new row ------------------------------------------------------
    (
        SRC,
        """    {
      category: `Low-THC beverages (units of ${LOW_THC_UNIT_MAX_MG} mg THC or less)`,
      recreational: `${RECREATIONAL_LIMITS.low_thc_liquid} mg THC`,
      medical: `${MEDICAL_LIMITS.low_thc_liquid} mg THC`,
    },
  ];
}""",
        """    {
      category: `Low-THC beverages (units of ${LOW_THC_UNIT_MAX_MG} mg THC or less)`,
      recreational: `${RECREATIONAL_LIMITS.low_thc_liquid} mg THC`,
      medical: `${MEDICAL_LIMITS.low_thc_liquid} mg THC`,
    },
    // SLICE 17 \u2014 the SECOND row that does not triple, and for a different
    // reason than the one above. The low-THC row matches because
    // WAC 314-55-095(2)(d) names the same 200 mg figure. THIS row matches
    // because that subsection does not list the category AT ALL, so nothing
    // authorises a higher medical figure. Publishing 30 units would advertise
    // an over-sale that no rule permits.
    //
    // formatLimitAmount renders the count with a "unit"/"units" suffix; it must
    // never be given an oz or g suffix, which would misstate a COUNT as a
    // WEIGHT \u2014 the same class of error the milligram rows guard against.
    {
      category: "Suppositories (otherwise taken into the body)",
      recreational: formatLimitAmount("otherwise_taken", RECREATIONAL_LIMITS.otherwise_taken),
      medical: formatLimitAmount("otherwise_taken", MEDICAL_LIMITS.otherwise_taken),
    },
  ];
}""",
    ),
    (
        SRC,
        """import {
  RECREATIONAL_LIMITS,
  MEDICAL_LIMITS,
  LOW_THC_UNIT_MAX_MG,
} from "@/lib/compliance/sales-limits-core";""",
        """import {
  RECREATIONAL_LIMITS,
  MEDICAL_LIMITS,
  LOW_THC_UNIT_MAX_MG,
  // SLICE 17: render the unit COUNT through the engine's own formatter so the
  // public page and the register can never disagree about the wording.
  formatLimitAmount,
} from "@/lib/compliance/sales-limits-core";""",
    ),
    # ---- strengthen the exact-table test ----------------------------------
    (
        TEST,
        """  it("renders the five statutory product forms with correct ounce/gram/mg figures", () => {""",
        """  it("renders the six statutory product forms with correct ounce/gram/mg/unit figures", () => {""",
    ),
    (
        TEST,
        """      {
        category: "Low-THC beverages (units of 4 mg THC or less)",
        recreational: "200 mg THC",
        medical: "200 mg THC",
      },
    ]);
  });""",
        """      {
        category: "Low-THC beverages (units of 4 mg THC or less)",
        recreational: "200 mg THC",
        medical: "200 mg THC",
      },
      // SLICE 17. A COUNT, so the suffix is "units" \u2014 never oz and never g.
      {
        category: "Suppositories (otherwise taken into the body)",
        recreational: "10 units",
        medical: "10 units",
      },
    ]);
  });""",
    ),
    # ---- strengthen the non-tripling test to cover BOTH exceptions --------
    (
        TEST,
        """  it("the low-THC beverage row is the ONE row that does NOT triple for a patient", () => {""",
        """  it("the suppository row does NOT triple, because the rule omits the category", () => {
    // SLICE 17. Distinct from the low-THC exception below: that one matches
    // because WAC 314-55-095(2)(d) states the same 200 mg. This one matches
    // because 095(2)(d) never mentions "otherwise taken into the body" at all,
    // and neither does RCW 69.50.360(3). Tripling by analogy would authorise a
    // sale no rule permits.
    expect(MEDICAL_LIMITS.otherwise_taken / RECREATIONAL_LIMITS.otherwise_taken).toBe(1);

    const row = purchaseLimitRows().find((r) => r.category.startsWith("Suppositories"));
    expect(row).toBeDefined();
    expect(row!.recreational).toBe(row!.medical);
    expect(row!.medical).not.toContain("30");
    // Derived from the enforcement constant, not retyped.
    expect(row!.recreational).toBe(
      formatLimitAmount("otherwise_taken", RECREATIONAL_LIMITS.otherwise_taken),
    );
  });

  it("no row states a unit COUNT as a weight", () => {
    // SLICE 17, mirroring the milligram trap below. Ten units is ten ITEMS; it
    // is not 10 g and not 10 oz. Any row measured in units must say "unit".
    for (const r of purchaseLimitRows()) {
      for (const v of [r.recreational, r.medical]) {
        if (/\\bunits?\\b/.test(v)) {
          expect(v).not.toMatch(/\\boz\\b/);
          expect(v).not.toMatch(/\\bg\\b/);
          expect(v).not.toMatch(/\\bmg\\b/);
        }
      }
    }
  });

  it("EXACTLY TWO rows fail to triple, and we know which", () => {
    // A future editor adding a seventh row must consciously decide which side
    // it belongs on rather than silently joining the exceptions.
    const flat = purchaseLimitRows().filter((r) => r.recreational === r.medical);
    expect(flat.map((r) => r.category).sort()).toEqual([
      "Low-THC beverages (units of 4 mg THC or less)",
      "Suppositories (otherwise taken into the body)",
    ]);
  });

  it("the low-THC beverage row does NOT triple for a patient either", () => {""",
    ),
]

buffered: dict[Path, str] = {}
for rel, find, replace in EDITS:
    path = ROOT / rel
    if path not in buffered:
        buffered[path] = path.read_text(encoding="utf-8")
    text = buffered[path]
    n = text.count(find)
    if n != 1:
        raise SystemExit(f"ANCHOR FAIL ({n}x) in {rel}: {find[:80]!r}")
    buffered[path] = text.replace(find, replace)

for path, out in buffered.items():
    path.write_text(out, encoding="utf-8")
    print(f"PATCHED {path.relative_to(ROOT)}")
print(f"OK: {len(EDITS)} anchors applied across {len(buffered)} files")

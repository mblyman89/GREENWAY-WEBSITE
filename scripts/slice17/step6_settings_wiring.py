#!/usr/bin/env python3
"""SLICE 17 step 6 — wire the otherwise_taken columns through the settings
read/write path in src/lib/compliance/sales-limits.ts.

WHY THIS IS NOT OPTIONAL
------------------------
clampLimitProfile takes `raw: unknown`, so a MISSING key is not a type error —
it silently falls back to `base.otherwise_taken`. That means without this step
the migration's columns would exist, the back-office form could write them, and
the read path would IGNORE them: an owner who tightened the limit to 5 units
would still get 10 at the register. Nothing would fail loudly.

Mirrors the SLICE 16 low_thc_liquid wiring exactly, including the `?? statute`
fallback for a database that has not yet run migration 0217.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

REL = "src/lib/compliance/sales-limits.ts"

EDITS: list[tuple[str, str]] = [
    # ---- 1. SettingsRow type ------------------------------------------------
    (
        """  rec_low_thc_liquid_thc_mg: number | null;
  med_low_thc_liquid_thc_mg: number | null;
  unit_grams_json: unknown;""",
        """  rec_low_thc_liquid_thc_mg: number | null;
  med_low_thc_liquid_thc_mg: number | null;
  /** SLICE 17 — a COUNT OF WHOLE UNITS (items), NOT grams and NOT mg.
   *  Nullable: the column is added by migration 0217, so a database that has
   *  not run it yet returns undefined and we fall back to the statutory 10
   *  from WAC 314-55-095(1)(d)(i)(D). */
  rec_otherwise_taken_units: number | null;
  med_otherwise_taken_units: number | null;
  unit_grams_json: unknown;""",
    ),
    # ---- 2. select list -----------------------------------------------------
    (
        '"enforce, hard_block, rec_usable_grams, rec_solid_grams, rec_concentrate_grams, rec_liquid_grams, rec_low_thc_liquid_thc_mg, med_usable_grams, med_solid_grams, med_concentrate_grams, med_liquid_grams, med_low_thc_liquid_thc_mg, unit_grams_json, notes, updated_at",',
        '"enforce, hard_block, rec_usable_grams, rec_solid_grams, rec_concentrate_grams, rec_liquid_grams, rec_low_thc_liquid_thc_mg, rec_otherwise_taken_units, med_usable_grams, med_solid_grams, med_concentrate_grams, med_liquid_grams, med_low_thc_liquid_thc_mg, med_otherwise_taken_units, unit_grams_json, notes, updated_at",',
    ),
    # ---- 3. read path: rec --------------------------------------------------
    (
        """        // SLICE 16 — nullish (column absent pre-0216) falls back to statute.
        low_thc_liquid: row.rec_low_thc_liquid_thc_mg ?? RECREATIONAL_LIMITS.low_thc_liquid,
      },
      RECREATIONAL_LIMITS,""",
        """        // SLICE 16 — nullish (column absent pre-0216) falls back to statute.
        low_thc_liquid: row.rec_low_thc_liquid_thc_mg ?? RECREATIONAL_LIMITS.low_thc_liquid,
        // SLICE 17 — nullish (column absent pre-0217) falls back to the ten
        // units of WAC 314-55-095(1)(d)(i)(D). Note clampLimitProfile takes
        // `unknown`, so OMITTING this key would not be a type error — it would
        // silently ignore the owner's setting. It must be passed explicitly.
        otherwise_taken: row.rec_otherwise_taken_units ?? RECREATIONAL_LIMITS.otherwise_taken,
      },
      RECREATIONAL_LIMITS,""",
    ),
    # ---- 4. read path: med --------------------------------------------------
    (
        """        low_thc_liquid: row.med_low_thc_liquid_thc_mg ?? MEDICAL_LIMITS.low_thc_liquid,
      },
      MEDICAL_LIMITS,""",
        """        low_thc_liquid: row.med_low_thc_liquid_thc_mg ?? MEDICAL_LIMITS.low_thc_liquid,
        // SLICE 17 — MEDICAL_LIMITS.otherwise_taken is 10, the SAME as
        // recreational. WAC 314-55-095(2)(d) does not list this category, so
        // there is no authority to raise it for a DOH patient.
        otherwise_taken: row.med_otherwise_taken_units ?? MEDICAL_LIMITS.otherwise_taken,
      },
      MEDICAL_LIMITS,""",
    ),
    # ---- 5. write path ------------------------------------------------------
    (
        """      // SLICE 16 — mg THC columns (migration 0216).
      rec_low_thc_liquid_thc_mg: rec.low_thc_liquid,
      med_low_thc_liquid_thc_mg: med.low_thc_liquid,""",
        """      // SLICE 16 — mg THC columns (migration 0216).
      rec_low_thc_liquid_thc_mg: rec.low_thc_liquid,
      med_low_thc_liquid_thc_mg: med.low_thc_liquid,
      // SLICE 17 — whole-unit COUNT columns (migration 0217). clampLimitProfile
      // has already floored these to integers, which the DB CHECK constraint
      // sales_limit_settings_otherwise_taken_whole also enforces.
      rec_otherwise_taken_units: rec.otherwise_taken,
      med_otherwise_taken_units: med.otherwise_taken,""",
    ),
]

path = ROOT / REL
text = path.read_text(encoding="utf-8")
for find, replace in EDITS:
    n = text.count(find)
    if n != 1:
        raise SystemExit(f"ANCHOR FAIL ({n}x) in {REL}: {find[:80]!r}")
    text = text.replace(find, replace)

path.write_text(text, encoding="utf-8")
print(f"PATCHED {REL}: {len(EDITS)} anchors applied")

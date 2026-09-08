#!/usr/bin/env python3
"""SLICE L1 mutation harness -- "test the tests".

Each mutation is a plausible BAD EDIT to liquid-volume-core.ts. A mutation the
suite does not fail on is a hole in the suite.

Two harness lessons are baked in here on purpose:

1. Never pipe vitest into sed/grep to read its result -- the pipeline exit code
   becomes the LAST command's, which is always 0, and every failure is reported
   as a pass. Run it, capture the return code, then inspect.

2. Do the replacement in Python with plain string `.replace`, not perl -e. The
   source contains regex literals full of `$`, `\\s` and `?`, which perl's -e
   quoting mangles -- that produced four spurious "PERL FAILED" lines in the
   first version of this harness. Every mutation is verified to have actually
   changed the file before the suite is run.
"""
import shutil
import subprocess
import sys
from pathlib import Path

SRC = Path("src/lib/compliance/liquid-volume-core.ts")
TEST = "tests/compliance/liquid-volume-core.test.ts"
BAK = Path("/tmp/l1-core.bak")

MUTATIONS = [
    ("cap reverted to old 2016 grams basis",
     "REC_LIQUID_FLUID_OUNCES * ML_PER_FLUID_OUNCE", "72 * 28"),
    ("rec ounces 72 -> 36 (RCW noncommercial figure, wrong table)",
     "export const REC_LIQUID_FLUID_OUNCES = 72;",
     "export const REC_LIQUID_FLUID_OUNCES = 36;"),
    ("med ounces 216 -> 72 (medical wrongly not tripled)",
     "export const MED_LIQUID_FLUID_OUNCES = 216;",
     "export const MED_LIQUID_FLUID_OUNCES = 72;"),
    ("fl oz constant -> 28 (the grams/volume conflation itself)",
     "export const ML_PER_FLUID_OUNCE = 29.5735;",
     "export const ML_PER_FLUID_OUNCE = 28;"),
    ("litre constant 1000 -> 100",
     "export const ML_PER_LITRE = 1000;", "export const ML_PER_LITRE = 100;"),

    ("litre case falls through to ml (1L read as 1ml)",
     "return quantity * ML_PER_LITRE;", "return quantity;"),
    ("floz case returns raw quantity (12 fl oz read as 12ml)",
     "return quantity * ML_PER_FLUID_OUNCE;", "return quantity;"),
    ("zero/negative quantity accepted instead of rejected",
     "if (!Number.isFinite(quantity) || quantity <= 0) return null;",
     "if (!Number.isFinite(quantity)) return null;"),

    # The real hazard identified by probe: dropping LITRE_RE's end anchor makes
    # the bare `l` alternative eat "5 Lot", "2 Lb", "3 Large", "1 Lid".
    ("LITRE_RE loses its end anchor (eats 'Lot', 'Lb', 'Large')",
     "const LITRE_RE = /^(\\d+(?:\\.\\d+)?)\\s*(?:l|liters?|litres?)$/i;",
     "const LITRE_RE = /^(\\d+(?:\\.\\d+)?)\\s*(?:l|liters?|litres?)/i;"),
    ("bare ounces accepted as fluid ounces (invents a density)",
     "(?:fl\\.?\\s*oz|floz|fluid\\s*ounces?)",
     "(?:fl\\.?\\s*oz|floz|fluid\\s*ounces?|oz|ounces?)"),
    ("ml regex drops the millilitre spellings",
     "(?:ml|milliliters?|millilitres?)", "(?:ml)"),
    ("litre regex drops the bare-l form",
     "(?:l|liters?|litres?)", "(?:liters?|litres?)"),
    ("ML_RE un-anchored (matches volume inside prose)",
     "const ML_RE = /^(\\d+(?:\\.\\d+)?)\\s*(?:ml|milliliters?|millilitres?)$/i;",
     "const ML_RE = /(\\d+(?:\\.\\d+)?)\\s*(?:ml|milliliters?|millilitres?)/i;"),

    ("unknown label defaults to 28 instead of null (the original bug)",
     "  const litre = LITRE_RE.exec(s);\n  if (litre) return toMl(Number(litre[1]), \"l\");\n\n  return null;",
     "  const litre = LITRE_RE.exec(s);\n  if (litre) return toMl(Number(litre[1]), \"l\");\n\n  return 28;"),
    ("lineVolumeMl unknown per-unit collapses to 0 (fail-open)",
     "if (typeof perUnitMl !== \"number\" || !Number.isFinite(perUnitMl) || perUnitMl <= 0) return null;",
     "if (typeof perUnitMl !== \"number\" || !Number.isFinite(perUnitMl) || perUnitMl <= 0) return 0;"),
    ("lineVolumeMl ignores quantity (always one unit)",
     "return perUnitMl * q;", "return perUnitMl;"),
    ("formatMl divides by the wrong constant",
     "const oz = ml / ML_PER_FLUID_OUNCE;", "const oz = ml / 28;"),
]


def run_suite() -> int:
    return subprocess.run(
        ["npx", "vitest", "run", TEST],
        capture_output=True, text=True,
        env={**__import__("os").environ, "NODE_OPTIONS": "--max-old-space-size=3000"},
    ).returncode


def main() -> int:
    original = SRC.read_text()
    shutil.copy(SRC, BAK)
    caught = 0
    missed = []

    print("=== SLICE L1 mutation testing ===")
    try:
        for i, (name, frm, to) in enumerate(MUTATIONS, start=1):
            SRC.write_text(original)
            if frm not in original:
                print(f"  M{i} HARNESS ERROR -- pattern not found: {name}")
                missed.append(name)
                continue
            SRC.write_text(original.replace(frm, to, 1))
            if SRC.read_text() == original:
                print(f"  M{i} HARNESS ERROR -- mutation was a no-op: {name}")
                missed.append(name)
                continue
            if run_suite() != 0:
                caught += 1
                print(f"  M{i} CAUGHT   {name}")
            else:
                print(f"  M{i} *** MISSED *** {name}")
                missed.append(name)
    finally:
        SRC.write_text(original)

    total = len(MUTATIONS)
    print(f"=== L1: {caught}/{total} mutations caught ===")
    for m in missed:
        print(f"    MISSED: {m}")
    return 0 if caught == total else 1


if __name__ == "__main__":
    sys.exit(main())

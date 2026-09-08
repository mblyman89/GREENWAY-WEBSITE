#!/usr/bin/env python3
"""SLICE L2 mutation harness -- "test the tests" for litre parsing.

Mutates the THREE parsers that had no litre branch, plus the fl-oz conflation
that was found while fixing them, and confirms the suite fails each time.

Harness discipline (learned the hard way in earlier slices):
  * never pipe vitest into sed to read its result -- the exit code becomes
    sed's and every failure reads as a pass
  * do replacements in Python with literal .replace, not perl -e, because the
    sources are full of regex `$` and `\\s` that perl's -e quoting mangles
  * verify each mutation actually changed the file before running the suite
"""
import os
import subprocess
import sys
from pathlib import Path

TESTS = [
    "tests/compliance/liquid-litre-parsing.test.ts",
    "tests/compliance/liquid-volume-core.test.ts",
]

TRANSFORM = Path("src/lib/pos/transform.ts")
EXTRACT = Path("src/lib/inventory/fact-extraction-core.ts")

# (file, description, from, to)
MUTATIONS = [
    # --- fact-extraction-core: OUR receiving pipeline -------------------
    (EXTRACT, "receiving extractor loses the litre pattern entirely",
     'text = consumeAll(text, LITRE_RE, (m) => facts.sizes.push({ quantity: Number(m[1]), unit: "l" }));',
     ""),
    (EXTRACT, "receiving litre pattern drops the bare-l form",
     "(?:l(?=$|[^a-z])|liters?\\b|litres?\\b)", "(?:liters?\\b|litres?\\b)"),
    (EXTRACT, "receiving litre pattern loses its non-letter guard (eats 'Lb'/'Lot')",
     "l(?=$|[^a-z])", "l"),
    # NOTE: "run litres before ml" was tried as a mutation and is NOT a valid
    # one -- ML_RE and LITRE_RE are mutually exclusive (probed both ways), so
    # reordering them is a genuine no-op and no test can or should detect it.
    # The real guard is LITRE_RE's (?=$|[^a-z]) lookahead, covered by M3.

    # --- transform.ts parsePackageSize: the Cultivera import -----------
    (TRANSFORM, "importer loses the litre normalisation",
     '.replace(/^(?:liters?|litres?|l)$/, "l")\n    .replace(/each|units?/, "ea")',
     '.replace(/each|units?/, "ea")'),
    (TRANSFORM, "importer litre rule un-anchored (rewrites 'lb' to 'l')",
     '.replace(/^(?:liters?|litres?|l)$/, "l")\n    .replace(/each|units?/, "ea")',
     '.replace(/liters?|litres?|l/, "l")\n    .replace(/each|units?/, "ea")'),
    (TRANSFORM, "importer litre label reverts to 'each'",
     'else if (unit === "l") label = `${formatNumber(quantity)}L`;', ""),

    # --- transform.ts packageFromParts: name-derived sizes -------------
    (TRANSFORM, "packageFromParts re-flattens fl oz into WEIGHT ounces",
     '.replace(/fluid\\s*ounces?|fluidounce|fl\\.?\\s*oz/, "floz")\n    .replace(/milligrams?/, "mg")\n'
     '    // millilitres before litres (see parsePackageSize).',
     '.replace(/fluid\\s*ounces?|fluidounce|fl\\.?\\s*oz/, "oz")\n    .replace(/milligrams?/, "mg")\n'
     '    // millilitres before litres (see parsePackageSize).'),
    (TRANSFORM, "packageFromParts loses its litre normalisation",
     '    // SLICE L2: litres. Anchored so "lb"/"lot" cannot match.\n'
     '    .replace(/^(?:liters?|litres?|l)$/, "l")\n    .replace(/packs?|pk/, "pk");',
     '    .replace(/packs?|pk/, "pk");'),

    # --- the net_volume_ml derivation ----------------------------------
    (TRANSFORM, "litres never reach net_volume_ml",
     'else if (pkgMeasure.unit === "l") netVolumeMl = pkgMeasure.quantity * ML_PER_LITRE;',
     ""),
    (TRANSFORM, "litres reach net_volume_ml unconverted (1L recorded as 1ml)",
     'netVolumeMl = pkgMeasure.quantity * ML_PER_LITRE;',
     'netVolumeMl = pkgMeasure.quantity;'),
    (TRANSFORM, "fl oz reverts to a hand-copied 29.5735 literal",
     'netVolumeMl = pkgMeasure.quantity * ML_PER_FLUID_OUNCE;',
     'netVolumeMl = pkgMeasure.quantity * 29.5735;'),

    # --- precedence / ranking ------------------------------------------
    (TRANSFORM, "litres dropped from REAL_MEASURE_UNITS (name potency outranks a real litre)",
     'new Set(["g", "oz", "floz", "ml", "l"])', 'new Set(["g", "oz", "floz", "ml"])'),
    (TRANSFORM, "name-level volume regex loses litres",
     "|ml|liters?|litres?|l)\\b", "|ml)\\b"),
    # NOTE: "put bare l before ml in the name-level alternation" was tried and
    # is NOT a valid mutation either. Every alternative is \b-terminated, so
    # the bare `l` cannot match the "m" of "milliliters" no matter where it
    # sits in the alternation -- probed, both orderings return identical
    # captures for 750ml / 100 milliliters / 1L / 2 Litre / 12 fl oz. Only the
    # PRESENCE of the litre alternatives is behavioural, and M13 covers that.
]


def run_suite() -> int:
    return subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        capture_output=True, text=True,
        env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=3000"},
    ).returncode


def main() -> int:
    originals = {p: p.read_text() for p in (TRANSFORM, EXTRACT)}
    caught = 0
    missed = []

    print("=== SLICE L2 mutation testing ===")
    try:
        for i, (path, name, frm, to) in enumerate(MUTATIONS, start=1):
            for p, txt in originals.items():
                p.write_text(txt)
            src = originals[path]
            if frm not in src:
                print(f"  M{i} HARNESS ERROR -- pattern not found: {name}")
                missed.append(name)
                continue
            path.write_text(src.replace(frm, to, 1))
            if path.read_text() == src:
                print(f"  M{i} HARNESS ERROR -- no-op: {name}")
                missed.append(name)
                continue
            if run_suite() != 0:
                caught += 1
                print(f"  M{i} CAUGHT   {name}")
            else:
                print(f"  M{i} *** MISSED *** {name}")
                missed.append(name)
    finally:
        for p, txt in originals.items():
            p.write_text(txt)

    total = len(MUTATIONS)
    print(f"=== L2: {caught}/{total} mutations caught ===")
    for m in missed:
        print(f"    MISSED: {m}")
    return 0 if caught == total else 1


if __name__ == "__main__":
    sys.exit(main())

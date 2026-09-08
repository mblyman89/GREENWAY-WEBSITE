#!/usr/bin/env python3
"""
SLICE L4 MUTATION HARNESS — testing the tests.

Breaks the L4 implementation one deliberate way at a time and requires the
suite to CATCH each break. A mutation that survives is a hole in my tests, not
a pass.

L4 rebased the liquid sales-limit bucket from weighted grams onto millilitres
and plumbed a measured volume to it across four surfaces. Two whole classes of
silent failure are possible here, and both are invisible in normal use:

  1. The CAP is wrong (an off-by-a-conversion-factor is a 5.6% oversell that
     no one would ever notice by eye).
  2. The cap is right but the MEASUREMENT never arrives, so every liquid
     quietly falls back to the 28 g default and the original oversell returns
     completely intact.

Every mutation below attacks one of those two. Each asserts its anchor appears
exactly once and verifies the file actually changed on disk, because two
str_replace edits SILENTLY FAILED earlier in this workstream.

Python, not perl: perl -e mangles `$` and `\\s` inside TS sources (it produced
four spurious "PERL FAILED" results in L2).

Run: python3 scripts/compliance/mutate-l4.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ENGINE = "src/lib/compliance/sales-limits-core.ts"
VOLCORE = "src/lib/compliance/liquid-volume-core.ts"
SALEFLOW = "src/lib/pos/sale-flow-core.ts"
METER = "src/lib/menu/cart-limit-meter-core.ts"
PRICING = "src/lib/orders/order-pricing.ts"
STORE = "src/lib/orders/orders-store.ts"

TESTS = [
    "tests/compliance/liquid-limit-ml-engine.test.ts",
    "tests/compliance/liquid-limit-ml-plumbing.test.ts",
    "tests/compliance/liquid-limit-ml-server-gate.test.ts",
    "tests/compliance/sales-limits.test.ts",
    "tests/compliance/low-thc-liquid-limit.test.ts",
    "tests/compliance/low-thc-liquid-plumbing.test.ts",
    "tests/compliance/otherwise-taken-limit.test.ts",
]

# (label, file, old, new, why_it_matters)
#
# ── INVALID MUTATIONS (verified no-ops -- do NOT re-add) ────────────────────
#
# "M12 register: zero an unknown volume instead of omitting it"
# (`lineVolumeMl(l.unitVolumeMl, l.quantity) ?? 0`) is a genuine no-op,
# verified by probing the live module rather than by reasoning about it. The
# value is only ever consumed through the guard
# `volumeMl !== null && volumeMl > 0`, so null and 0 are indistinguishable at
# every call site:
#
#     unit=null qty=3  -> real null / mutant 0     -> both EXCLUDED
#     unit=750  qty=2  -> real 1500 / mutant 1500  -> both INCLUDED, equal
#     unit=0    qty=3  -> real null / mutant 0     -> both EXCLUDED
#
# The `?? 0` must NOT be added to the source (it would be a live landmine the
# moment any caller stopped using the guard), and no test may be weakened to
# "catch" it. Same class as the L1 M9, L2 M4/M14 and L3 M10 false alarms.
#
# The three survivors that WERE real -- M15, M16 and M18, all in
# order-pricing.ts -- were closed by ADDING executable coverage in
# tests/compliance/liquid-limit-ml-server-gate.test.ts.

MUTATIONS = [
    # ── the cap itself ──────────────────────────────────────────────────────
    (
        "M1 revert the rec cap to weighted grams (2016)",
        ENGINE,
        "  liquid_edible: REC_LIQUID_ML, // 2129.292 ml (72 FLUID oz) — SLICE L4",
        "  liquid_edible: 2016, // MUTANT",
        "72 WEIGHT ounces, not fluid. Under-sells every liquid by 5.6% and "
        "reintroduces the unit confusion the whole slice exists to remove.",
    ),
    (
        "M2 revert the medical cap to weighted grams (6048)",
        ENGINE,
        "  liquid_edible: MED_LIQUID_ML, // 6387.876 ml (216 FLUID oz) — SLICE L4",
        "  liquid_edible: 6048, // MUTANT",
        "Same error on the medical triple: a patient loses 340 ml of lawful "
        "allowance.",
    ),
    (
        "M3 declare the liquid bucket in grams",
        ENGINE,
        '  liquid_edible: "ml",',
        '  liquid_edible: "g", // MUTANT',
        "The bucket would format 2129.292 ml as '76.046 oz' — wrong by the "
        "ratio between a fluid ounce and a weight ounce, and shown to staff.",
    ),
    (
        "M4 use the wrong conversion constant in the formatter",
        ENGINE,
        "  if (isVolumeBucket(bucket)) return `${round3(amount / ML_PER_FLUID_OUNCE)} fl oz`;",
        "  if (isVolumeBucket(bucket)) return `${round3(amount / 30)} fl oz`; // MUTANT",
        "A plausible-looking 30 ml 'fluid ounce'. The meter would tell the "
        "budtender 70.98 fl oz at exactly the 72 fl oz cap.",
    ),
    (
        "M5 make isVolumeBucket always false",
        ENGINE,
        '  return LIMIT_BUCKET_UNITS[bucket] === "ml";',
        "  return false; // MUTANT",
        "The formatter silently falls through to the gram path, so every "
        "liquid figure on screen is misread as a weight.",
    ),
    # ── the measurement reaching the engine ─────────────────────────────────
    (
        "M6 make the liquid bucket accumulate grams again",
        ENGINE,
        '        : bucket === "liquid_edible"\n          ? lineMl(line, overrides)',
        '        : bucket === "liquid_edible"\n          ? lineGrams(line, overrides) // MUTANT',
        "THE ORIGINAL DEFECT. Grams counted against a millilitre cap: a 1.5 L "
        "bottle contributes 28 g and 72 of them fit.",
    ),
    (
        "M7 ignore the measured volume in lineMl",
        ENGINE,
        "  if (typeof line.volumeMl === \"number\" && line.volumeMl > 0) return round3(line.volumeMl);",
        "  // MUTANT: measured volume discarded",
        "The cap is right but nothing supplies a volume, so every liquid "
        "reverts to the weight-carried basis and metric bottles to 28 g.",
    ),
    (
        "M8 use the weight ounce in the carry-across",
        ENGINE,
        "  return round3((grams / GRAMS_PER_OUNCE) * ML_PER_FLUID_OUNCE);",
        "  return round3(grams); // MUTANT",
        "Grams passed off as millilitres. An ounce-labelled product would "
        "lose 5.6% of its lawful allowance — the exact regression the safety "
        "proof exists to prevent.",
    ),
    (
        "M9 treat an unknown volume as zero rather than unknown",
        ENGINE,
        "  const grams = lineGrams(line, overrides);\n  if (grams <= 0) return 0;",
        "  return 0; // MUTANT",
        "Every liquid with no measured volume drops OUT of the limit "
        "entirely — unlimited sales, the worst possible direction.",
    ),
    # ── the register surface ────────────────────────────────────────────────
    (
        "M10 register: drop the volume from the limit line",
        SALEFLOW,
        "      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),",
        "      // MUTANT: volume dropped",
        "The register meter reverts to the 28 g default while the website "
        "and the server still measure — three surfaces disagreeing.",
    ),
    (
        "M11 register: drop the per-unit volume off the priced line",
        SALEFLOW,
        "      unitVolumeMl: entry.product.unitVolumeMl ?? null,",
        "      unitVolumeMl: null, // MUTANT",
        "The card carries the measurement but the line does not, so it never "
        "reaches limitLinesFor and never reaches the sale payload.",
    ),
    (
        "M12 register: zero an unknown volume instead of omitting it",
        SALEFLOW,
        "    const volumeMl = lineVolumeMl(l.unitVolumeMl, l.quantity);",
        "    const volumeMl = lineVolumeMl(l.unitVolumeMl, l.quantity) ?? 0; // MUTANT",
        "volumeMl: 0 reads as 'this line consumes no liquid', taking "
        "unknown-volume products out of the limit rather than falling back.",
    ),
    # ── the website surface ─────────────────────────────────────────────────
    (
        "M13 website: drop the label fallback",
        METER,
        "    const perUnitMl = item.unitVolumeMl ?? volumeMlFromLabel(item.variantLabel);",
        "    const perUnitMl = item.unitVolumeMl ?? null; // MUTANT",
        "A card staged before the L3 intake plumbing loses its volume online, "
        "so the shop cart shows a limit the register will not honour.",
    ),
    (
        "M14 website: drop the volume from the limit line",
        METER,
        "      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),",
        "      // MUTANT: volume dropped",
        "The customer is shown one limit online and refused a different one "
        "at the counter.",
    ),
    # ── the server / pickup surface ─────────────────────────────────────────
    (
        "M15 placement: drop the volume from the server's limit line",
        PRICING,
        "      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),\n      // SLICE 16 — same routing the register and the website cart use",
        "      // MUTANT: volume dropped\n      // SLICE 16 — same routing the register and the website cart use",
        "The AUTHORITATIVE server gate stops measuring while the two client "
        "meters still do — an over-limit order is accepted.",
    ),
    (
        "M16 placement: never resolve the per-unit volume",
        PRICING,
        "      unitVolumeMl: w.resolved.item.netVolumeMl ?? volumeMlFromLabel(w.resolved.variant.label),",
        "      unitVolumeMl: null, // MUTANT",
        "Nothing is ever snapshotted onto the order, so the pickup gate has "
        "nothing to read back.",
    ),
    (
        "M17 pickup: stop reading the snapshot back",
        PRICING,
        "    const volumeMl = lineVolumeMl(normalizeUnitGrams(line.unit_volume_ml), line.quantity);",
        "    const volumeMl = null; // MUTANT",
        "Placement and pickup reach DIFFERENT verdicts on the same basket: "
        "2.25 litres accepted online is waved through at the counter on a "
        "3 x 28 g reading.",
    ),
    (
        "M18 pickup: drop the volume off the reconstructed limit line",
        PRICING,
        "      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),\n      lowThcLiquid: lowThc,",
        "      lowThcLiquid: lowThc, // MUTANT",
        "Read correctly, then discarded one line later — the same "
        "placement/pickup disagreement.",
    ),
    (
        "M19 placement: never write the snapshot",
        STORE,
        "      ...(withUnitVolumeMl && typeof l.unitVolumeMl === \"number\" && l.unitVolumeMl > 0\n        ? { unit_volume_ml: l.unitVolumeMl }\n        : {}),",
        "      // MUTANT: snapshot never written",
        "The column exists and is read, but nothing ever populates it, so "
        "every order silently degrades at the counter.",
    ),
    (
        "M20 placement: remove the ladder rung for an unapplied 0223",
        STORE,
        "      .insert(buildLineRows(true, true, true, true, false)));",
        "      .insert(buildLineRows(true, true, true, true, true))); // MUTANT",
        "On a database that has not run 0223 the retry repeats the failing "
        "insert, so placement fails outright instead of degrading.",
    ),
    # ── the statutory constants ─────────────────────────────────────────────
    (
        "M21 corrupt the fluid-ounce constant",
        VOLCORE,
        "export const ML_PER_FLUID_OUNCE = 29.5735;",
        "export const ML_PER_FLUID_OUNCE = 28; // MUTANT",
        "Conflates the fluid ounce with the weight ounce — the precise "
        "confusion the owner reported, re-entered at the root.",
    ),
    (
        "M22 corrupt the statutory fluid-ounce count",
        VOLCORE,
        "export const REC_LIQUID_FLUID_OUNCES = 72;",
        "export const REC_LIQUID_FLUID_OUNCES = 76; // MUTANT",
        "Not what the statute says. Every downstream figure derives from "
        "this one number.",
    ),
    (
        "M23 corrupt the litre constant",
        VOLCORE,
        "export const ML_PER_LITRE = 1000;",
        "export const ML_PER_LITRE = 100; // MUTANT",
        "A 1.5 L bottle would meter as 150 ml, so fourteen of them would "
        "pass — a ten-fold oversell on the biggest packages we sell.",
    ),
]


def run_tests(cwd):
    r = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        cwd=cwd,
        env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=3000"},
        capture_output=True,
        text=True,
        timeout=1800,
    )
    return r.returncode


def main():
    work = tempfile.mkdtemp(prefix="l4mut-")
    src = os.path.join(work, "repo")
    print(f"staging a copy in {src} ...")
    shutil.copytree(
        REPO,
        src,
        symlinks=True,
        ignore=shutil.ignore_patterns(".git", ".next", "coverage"),
    )

    originals = {}
    for path in {m[1] for m in MUTATIONS}:
        with open(os.path.join(src, path), encoding="utf-8") as fh:
            originals[path] = fh.read()

    print("\nbaseline (unmutated) must PASS ...")
    if run_tests(src) != 0:
        print("ABORT: baseline suite fails before any mutation.")
        sys.exit(1)
    print("baseline PASSED\n")

    caught, survived, broken = [], [], []
    for label, path, old, new, why in MUTATIONS:
        full = os.path.join(src, path)
        base = originals[path]
        n = base.count(old)
        if n != 1:
            print(f"[BROKEN ] {label}: anchor found {n} times (expected 1)")
            broken.append(label)
            continue
        mutated = base.replace(old, new, 1)
        if mutated == base:
            print(f"[BROKEN ] {label}: mutation was a no-op")
            broken.append(label)
            continue
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(mutated)
        with open(full, encoding="utf-8") as fh:
            if fh.read() != mutated:
                print(f"[BROKEN ] {label}: disk write did not stick")
                broken.append(label)
                continue

        rc = run_tests(src)
        # restore before reporting so a crash cannot leave the tree mutated
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(base)

        if rc != 0:
            print(f"[CAUGHT ] {label}\n           -> {why}")
            caught.append(label)
        else:
            print(f"[SURVIVED] {label}\n           -> {why}  << TEST HOLE")
            survived.append(label)

    print("\n" + "=" * 72)
    print(f"CAUGHT   {len(caught)}/{len(MUTATIONS)}")
    print(f"SURVIVED {len(survived)}")
    print(f"BROKEN   {len(broken)}")
    if survived:
        print("\nTEST HOLES:")
        for s in survived:
            print(f"  - {s}")
    if broken:
        print("\nBROKEN MUTATIONS (fix the harness, not the code):")
        for b in broken:
            print(f"  - {b}")
    shutil.rmtree(work, ignore_errors=True)
    sys.exit(1 if (survived or broken) else 0)


if __name__ == "__main__":
    main()

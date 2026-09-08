#!/usr/bin/env python3
"""
SLICE L3 MUTATION HARNESS — testing the tests.

Breaks the L3 implementation one deliberate way at a time and requires the
suite to CATCH each break. A mutation that survives is a hole in my tests, not
a pass.

Python, not perl: perl -e mangles `$` and `\s` inside TS sources (it produced
four spurious "PERL FAILED" results in L2). Every mutation here asserts its
anchor appears exactly once and verifies the file actually changed on disk,
because two str_replace edits SILENTLY FAILED earlier in this workstream.

Run: python3 scripts/compliance/mutate-l3.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DERIV = "src/lib/compliance/liquid-volume-derivation-core.ts"
INJECT = "src/lib/pos/draft-injection-core.ts"
MASTER = "src/lib/pos/intake-mastering-core.ts"
STAGING = "src/lib/pos/intake-menu-staging-core.ts"
EXEC = "src/lib/pos/intake-menu-staging.ts"
LIVE = "src/lib/pos/live-menu.ts"
TYPES = "src/lib/leafly/types.ts"

TESTS = [
    "tests/compliance/liquid-volume-plumbing.test.ts",
    "tests/compliance/liquid-volume-core.test.ts",
    "tests/compliance/liquid-litre-parsing.test.ts",
]

# (label, file, old, new, why_it_matters)
# ── INVALID MUTATIONS (verified no-ops -- do NOT re-add) ───────────────────
#
# "M10 accept a zero or negative VOLUME": removing the `s.quantity <= 0`
# guard from the VOLUME loop is a genuine no-op, verified by probing the live
# module: toMl() rejects quantity <= 0 and NaN itself
# (liquid-volume-core.ts:125), so every bad value is filtered one call later
# and the derived result is identical. The guard stays in the source as
# defence-in-depth -- it must not be deleted just because a mutation of it
# survives, and no test should be weakened to "catch" it.
#
# The asymmetry is real and load-bearing: the WEIGHT loop (M10b) does NOT go
# through toMl, so the same mutation there IS caught. That is why M10b is
# kept and M10 is not.
#
# Same class as the L1 M9 and L2 M4/M14 false alarms (ml-vs-litre ordering).

MUTATIONS = [
    # ── the derivation: the pack multiplier ────────────────────────────────
    (
        "M1 drop the pack multiplier on 'N x volume'",
        DERIV,
        "        netVolumeMl: r4(perUnit * n),",
        "        netVolumeMl: r4(perUnit),",
        "a 4 x 50ml carton would record 50 ml -> 4x oversell",
    ),
    (
        "M2 drop the extractor packCount multiplier",
        DERIV,
        "    netVolumeMl: r4(pack !== null ? perUnitMl * pack : perUnitMl),",
        "    netVolumeMl: r4(perUnitMl),",
        "a 6-pack of 12 fl oz would record 12 fl oz -> 6x oversell",
    ),
    (
        "M3 remove the raw-name 'N x volume' pattern entirely",
        DERIV,
        "  const times = name.match(PACK_TIMES_VOLUME_RE);",
        "  const times = null as RegExpMatchArray | null;",
        "'4x50ml' (no space) is invisible to the extractor -> silent null",
    ),
    # ── the derivation: conflict direction (the fail-safe) ─────────────────
    (
        "M4 resolve volume conflicts DOWNWARD",
        DERIV,
        "  const perUnitMl = maxMl;",
        "  const perUnitMl = minMl;",
        "a 100ml/750ml conflict would allow 21 bottles instead of 2",
    ),
    (
        "M5 average conflicting volumes instead of failing closed",
        DERIV,
        "  const perUnitMl = maxMl;",
        "  const perUnitMl = (maxMl + minMl) / 2;",
        "averaging invents a volume no bottle has",
    ),
    # ── the derivation: bare ounces ────────────────────────────────────────
    (
        "M6 treat bare ounces as FLUID ounces",
        DERIV,
        '    if (s.unit === "oz") {\n      sawBareOunces = true;\n      continue;\n    }',
        '    if (s.unit === "oz") {\n      sawBareOunces = true;\n      volumes.push(s.quantity * ML_PER_FLUID_OUNCE);\n      continue;\n    }',
        "invents a volume for a 1.7 oz salve",
    ),
    (
        "M7 treat grams as millilitres",
        DERIV,
        '    if (s.unit === "g") continue;',
        '    if (s.unit === "g") { volumes.push(s.quantity); continue; }',
        "1 g of RSO is not 1 ml, and it is not a liquid-limited product",
    ),
    # ── the derivation: unit conversion constants ─────────────────────────
    (
        "M8 conflate fluid ounces with weight ounces",
        DERIV,
        '  if (w === "floz" || w === "fluidounce" || w === "fluidounces") return "floz";',
        '  if (w === "floz" || w === "fluidounce" || w === "fluidounces") return "ml";',
        "12 fl oz would become 12 ml -> 177x oversell",
    ),
    (
        "M9 treat litres as millilitres",
        DERIV,
        '  if (w === "l" || w === "liter" || w === "liters" || w === "litre" || w === "litres") return "l";',
        '  if (w === "l" || w === "liter" || w === "liters" || w === "litre" || w === "litres") return "ml";',
        "a 1L bottle would record 1 ml -> the original headline bug",
    ),
    # ── the derivation: zero/negative guards ─────────────────────────────
    (
        "M10b accept a zero or negative WEIGHT",
        DERIV,
        "    if (!Number.isFinite(s.quantity) || s.quantity <= 0) continue;\n    if (s.unit === \"g\") grams.push(s.quantity);",
        "    if (!Number.isFinite(s.quantity)) continue;\n    if (s.unit === \"g\") grams.push(s.quantity);",
        "a 0 g net weight is a claim nobody made",
    ),
    # ── the derivation: scope ────────────────────────────────────────────
    (
        "M11 pull topicals into the volume-limited set",
        DERIV,
        'export const LIQUID_VOLUME_TYPES = new Set(["Liquid Edible", "Tincture"]);',
        'export const LIQUID_VOLUME_TYPES = new Set(["Liquid Edible", "Tincture", "Topical Ointment"]);',
        "pre-empts the owner's separate topicals decision silently",
    ),
    # ── seam 1: the receiving planner ────────────────────────────────────
    (
        "M12 stop assembling net_volume_ml onto the planned item",
        INJECT,
        "      net_volume_ml: netVolumeMl,",
        "      net_volume_ml: null,",
        "the whole slice becomes a no-op; the register gets nothing",
    ),
    (
        "M13 never assign the derived volume",
        INJECT,
        "        netVolumeMl = vol.netVolumeMl;",
        "        netVolumeMl = null;",
        "derivation runs and its answer is discarded",
    ),
    (
        "M14 drop the net_volume_ml provenance tag",
        INJECT,
        "        factProvenance.net_volume_ml = vol.source;",
        "        // provenance dropped",
        "an audit cannot tell a derived volume from a measured one",
    ),
    (
        "M15 use the per-unit volume instead of the package volume",
        INJECT,
        "        netVolumeMl = vol.netVolumeMl;",
        "        netVolumeMl = vol.perUnitMl;",
        "records one bottle of a carton -> the 4x oversell, one layer up",
    ),
    (
        "M16 silence the missing-volume diagnostic",
        INJECT,
        '      } else if (LIQUID_VOLUME_TYPES.has(invType)) {',
        '      } else if (false) {',
        "an unmeasurable liquid reaches the shelf with nobody warned",
    ),
    (
        "M17 silence the confirmation diagnostic",
        INJECT,
        '        if (vol.confidence === "ambiguous") {',
        '        if (false) {',
        "a guessed carton volume is never put in front of a human",
    ),
    (
        "M18 leak a volume onto weight products by reading grams as ml",
        INJECT,
        "      netWeightGrams = deriveNetWeightGrams(exam.name.sizes);",
        "      netWeightGrams = null;",
        "the golden record loses the weight half",
    ),
    # ── seam 2: mastering / lot facts ────────────────────────────────────
    (
        "M19 drop the volume from the lot fact bundle",
        MASTER,
        "        net_volume_ml: it.net_volume_ml,",
        "        net_volume_ml: null,",
        "inventory_lots and menu_items disagree about the same bottle",
    ),
    (
        "M20 restore the old bundle gate (volume-only products dropped)",
        MASTER,
        "      it.ratio_label !== null ||\n      // SLICE L3: a bottle whose ONLY fact is its size still has a fact worth\n      // keeping -- and it is the fact the sales limit is measured from.\n      it.net_weight_grams !== null ||\n      it.net_volume_ml !== null",
        "      it.ratio_label !== null",
        "a 750ml bottle with no dose facts loses its volume entirely",
    ),
    # ── seam 3: the staged snapshot (the original hardcoded null) ────────
    (
        "M21 restore the hardcoded null in masteredToSnapshot",
        STAGING,
        "    net_volume_ml: it.net_volume_ml ?? null,",
        "    net_volume_ml: null,",
        "THE original defect: newly received liquids lose their volume",
    ),
    (
        "M22 restore the hardcoded null for net_weight_grams",
        STAGING,
        "    net_weight_grams: it.net_weight_grams ?? null,",
        "    net_weight_grams: null,",
        "same defect, weight half",
    ),
    # ── seam 4: persistence ──────────────────────────────────────────────
    (
        "M23 stop writing net_volume_ml to inventory_lots",
        EXEC,
        "            net_volume_ml: facts.net_volume_ml,",
        "            // not written",
        "the golden record never receives the fact",
    ),
    # ── seam 5/6: the read path ──────────────────────────────────────────
    (
        "M24 stop mapping the column onto the menu item",
        LIVE,
        "    netVolumeMl: row.net_volume_ml ?? null,",
        "    netVolumeMl: null,",
        "persisted correctly, then discarded on read -- invisible failure",
    ),
    (
        "M25 coalesce an unknown volume to zero on read",
        LIVE,
        "    netVolumeMl: row.net_volume_ml ?? null,",
        "    netVolumeMl: row.net_volume_ml ?? 0,",
        "0 is a CLAIM of no volume, not 'unknown'",
    ),
    (
        "M26 remove the field from the shared item type",
        TYPES,
        "  netVolumeMl?: number | null;",
        "  netVolumeMlXX?: number | null;",
        "the register/website contract loses the field",
    ),
]


def run_tests(cwd):
    r = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        cwd=cwd,
        env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=3000"},
        capture_output=True,
        text=True,
        timeout=900,
    )
    return r.returncode


def main():
    work = tempfile.mkdtemp(prefix="l3mut-")
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

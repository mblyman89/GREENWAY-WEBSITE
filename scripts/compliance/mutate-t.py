#!/usr/bin/env python3
"""
SLICE T1/T2/T3 - TEST THE TESTS.

A green suite proves nothing on its own. This harness breaks the fix one piece
at a time and demands that the suite go RED for every single break. Any
mutation that survives is a hole in the tests, not a success.

Each mutation is a surgical edit to a production file. The harness:
  1. asserts the target text appears EXACTLY once (no silent no-op edits),
  2. writes the mutation and READS IT BACK from disk to confirm it landed,
  3. runs the suite,
  4. restores the file byte-for-byte from the pristine copy and verifies the
     restore, so a crash can never leave a mutant in the tree.

Run:  python3 scripts/compliance/mutate-t.py
"""

import subprocess
import sys
import os
import hashlib

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SUITES = [
    "tests/compliance/topical-and-bucket-measurement.test.ts",
    "tests/compliance/liquid-limit-ml-engine.test.ts",
]

CORE = "src/lib/inventory/receiving-classification-core.ts"
INJECT = "src/lib/pos/draft-injection-core.ts"
DRAFTS = "src/lib/inventory/catalog-drafts.ts"
PAGE = "src/app/admin/inventory/drafts/page.tsx"
DERIV = "src/lib/compliance/liquid-volume-derivation-core.ts"
ENGTEST = "tests/compliance/liquid-limit-ml-engine.test.ts"

# (label, file, find, replace, what it proves)
MUTATIONS = [
    (
        "T1-01 gate ignores the derived weight entirely",
        CORE,
        "const hasUsableMeasure = derivedVolumeMl !== null || derivedWeightGrams !== null;",
        "const hasUsableMeasure = derivedVolumeMl !== null;",
        "reverts T1: every weight-labelled salve becomes unonboardable again",
    ),
    (
        "T1-02 gate accepts ANY weight, including junk",
        CORE,
        "typeof rawG === \"number\" && Number.isFinite(rawG) && rawG > 0 ? rawG : null;",
        "typeof rawG === \"number\" ? rawG : null;",
        "0, -5, NaN and Infinity would count as measurements",
    ),
    (
        "T1-03 gate accepts a zero/negative weight",
        CORE,
        "Number.isFinite(rawG) && rawG > 0 ? rawG : null;",
        "Number.isFinite(rawG) && rawG >= 0 ? rawG : null;",
        "an off-by-one at the boundary: 0 g would pass the gate",
    ),
    (
        "T1-04 gate stops fail-closing when nothing is measurable",
        CORE,
        "needsVolumePick: isVolumeMeteredShelf && !hasUsableMeasure,",
        "needsVolumePick: false,",
        "the whole L5 guarantee: unmeasurable liquids would sail through",
    ),
    (
        "T3-01 injection scopes measurement by type list again",
        INJECT,
        'if (categoryToBucket(websiteCategory) === "liquid_edible") {',
        "if (LIQUID_VOLUME_TYPES.has(invType)) {",
        "the root cause: Soda/Beverage/Topical stop being measured",
    ),
    (
        "T3-02 injection derives no volume in the bucket pass",
        INJECT,
        "netVolumeMl = bucketVol.netVolumeMl;",
        "netVolumeMl = null;",
        "a 12 fl oz can records nothing -> the 12x oversell returns",
    ),
    (
        "T3-03 injection derives no weight in the bucket pass",
        INJECT,
        "netWeightGrams = bucketGrams;",
        "netWeightGrams = null;",
        "a 2oz balm records nothing at injection",
    ),
    (
        "T3-04 injection overwrites an existing measurement",
        INJECT,
        "if (netVolumeMl === null) {\n        const bucketVol = deriveNetVolumeMl({",
        "if (true) {\n        const bucketVol = deriveNetVolumeMl({",
        "the gap-fill guarantee: a human-entered volume could be clobbered",
    ),
    (
        "T3-05 injection stops warning about an unmeasurable liquid",
        INJECT,
        'if (netVolumeMl === null && netWeightGrams === null) {\n        diagnostics.push({\n          severity: "warning",',
        'if (netVolumeMl === null && netWeightGrams === null) {\n        diagnostics.push({\n          severity: "info",',
        "silent failure: an unmeasurable drink onboards with no signal",
    ),
    (
        "T3-06 the missing-size warning fires when a weight already measured it",
        INJECT,
        "if (netVolumeMl === null && netWeightGrams === null) {\n        diagnostics.push({",
        "if (netVolumeMl === null || netWeightGrams === null) {\n        diagnostics.push({",
        "double-warning: a Liquid Edible would be reported twice for one fault",
    ),
    (
        "WIRE-01 server call site drops the weight",
        DRAFTS,
        "const derivedWeightGrams = deriveNetWeightGrams(derivedFacts.sizes);",
        "const derivedWeightGrams = null;",
        "the fix exists but is not wired into the server path",
    ),
    (
        "WIRE-02 admin page call site drops the weight",
        PAGE,
        "derivedWeightGrams: deriveNetWeightGrams(facts.sizes),",
        "derivedWeightGrams: null,",
        "the admin UI would still refuse a salve the server accepts",
    ),
    (
        "DOC-01 the stale 'later slice' claim comes back",
        DERIV,
        "DO NOT USE THIS SET TO DECIDE WHO GETS MEASURED",
        "stays on WEIGHTED ounces by owner decision",
        "the doc that caused this bug must not be allowed back",
    ),
    (
        "DOC-02 the statutory reason topicals stay is deleted",
        ENGTEST,
        "APPLIED TOPICALLY TO THE SKIN",
        "applied in some way to a person",
        "the citation a future reader needs before moving topicals",
    ),
]


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def run_suite():
    r = subprocess.run(
        ["npx", "vitest", "run", *SUITES],
        cwd=REPO,
        capture_output=True,
        text=True,
        env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=3000"},
        timeout=600,
    )
    return r.returncode == 0, (r.stdout + r.stderr)


def main():
    # Pristine copies + baseline hashes, so restore is provable.
    pristine = {}
    hashes = {}
    for _, f, _, _, _ in MUTATIONS:
        if f not in pristine:
            p = os.path.join(REPO, f)
            with open(p, "r", encoding="utf-8") as fh:
                pristine[f] = fh.read()
            hashes[f] = sha(p)

    print("=" * 74)
    print("BASELINE: the suite must be GREEN before any mutation means anything")
    print("=" * 74)
    ok, out = run_suite()
    if not ok:
        print("BASELINE IS RED. Nothing below would be meaningful.")
        print(out[-3000:])
        return 1
    for line in out.splitlines():
        if "Tests " in line and "passed" in line:
            print("  " + line.strip())
    print()

    caught, survived = [], []

    for label, f, find, repl, proves in MUTATIONS:
        path = os.path.join(REPO, f)
        text = pristine[f]

        n = text.count(find)
        assert n == 1, f"{label}: target appears {n} times in {f}, expected exactly 1"

        mutated = text.replace(find, repl, 1)
        assert mutated != text, f"{label}: mutation was a no-op"

        with open(path, "w", encoding="utf-8") as fh:
            fh.write(mutated)

        # Read back from disk: never trust the write.
        with open(path, "r", encoding="utf-8") as fh:
            disk = fh.read()
        assert disk == mutated, f"{label}: mutation did not land on disk"
        assert disk.count(repl) >= 1, f"{label}: replacement text absent from disk"

        try:
            ok, out = run_suite()
        finally:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(pristine[f])
            assert sha(path) == hashes[f], f"{label}: RESTORE FAILED for {f}"

        if ok:
            survived.append((label, f, proves))
            print(f"  SURVIVED  {label}")
            print(f"            ^ tests did not notice: {proves}")
        else:
            failed = [
                l.strip()
                for l in out.splitlines()
                if l.strip().startswith("\u00d7") or " > " in l and "\u00d7" in l
            ]
            print(f"  caught    {label}  ({len(failed)} assertion(s) fired)")
            caught.append(label)

    print()
    print("=" * 74)
    print(f"RESULT: {len(caught)}/{len(MUTATIONS)} mutations caught")
    print("=" * 74)

    # Final proof: the tree is byte-identical to where we started.
    for f in pristine:
        assert sha(os.path.join(REPO, f)) == hashes[f], f"TREE DIRTY: {f}"
    print("All mutated files verified byte-identical to pristine.")

    if survived:
        print()
        print("SURVIVORS - these are holes in the test suite:")
        for label, f, proves in survived:
            print(f"  - {label} [{f}]: {proves}")
        return 1

    print("No survivors. Every piece of the fix is defended by a test.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

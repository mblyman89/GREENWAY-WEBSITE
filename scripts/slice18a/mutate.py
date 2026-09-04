#!/usr/bin/env python3
"""
SLICE 18A mutation testing.

A green test suite proves nothing on its own: it might be green because the
code is right, or green because the assertions never actually look. This script
settles that empirically. It breaks the source in specific, plausible ways --
each mutant is a mistake a real edit could make -- and demands that the suite
FAIL for every single one. A mutant that SURVIVES is a hole in the tests, and
the response is always to STRENGTHEN the assertion, never to delete the mutant.

PRE-FLIGHT: every anchor is checked for an exact single match BEFORE anything
is written. If any anchor is missing or ambiguous (e.g. a refactor moved the
line, or a string now appears twice), the run aborts with ZERO writes. A
mutation script that silently no-ops is worse than none at all, because it
reports "all killed" while having tested nothing.
"""
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

CORE = "src/lib/inventory/classification-worklist-core.ts"
STATUS = "src/lib/inventory/classification-status-core.ts"

# (id, file, find, replace, why-this-mistake-is-plausible)
MUTANTS = [
    # ── grouping: the reason the worklist module exists ──────────────────────
    ("group-by-lot", CORE,
     'const key = (lot.posProductKey ?? "").trim();',
     'const key = (lot.lotId ?? "").trim();',
     "grouping by lot instead of product -> one question printed eight times"),
    ("group-keep-blank", CORE,
     "if (!key) continue;",
     "if (false) continue;",
     "listing keyless lots -> offering work that cannot be saved anywhere"),

    # ── null vs false: the doctrine the whole slice rests on ─────────────────
    ("absent-menu-is-false", CORE,
     "otherwiseTaken: flags?.otherwiseTaken ?? null,",
     "otherwiseTaken: flags?.otherwiseTaken ?? false,",
     "treating an absent menu row as an answered 'no' -> silently settles work"),
    ("absent-lowthc-is-false", CORE,
     "lowThcLiquid: flags?.lowThcLiquid ?? null,",
     "lowThcLiquid: flags?.lowThcLiquid ?? false,",
     "same defect on the low-THC question"),

    # ── scope: out-of-scope rows must never pad the list ─────────────────────
    ("show-out-of-scope", CORE,
     "if (!e.status.inScope) return false;\n\n    if (filter.source",
     "if (!e.status.inScope) return true;\n\n    if (filter.source",
     "letting flower onto a compliance worklist -> 3,800-row wall, ignored"),
    ("summary-counts-out-of-scope", CORE,
     "    if (!e.status.inScope) return false;\n    if (source === \"import\"",
     "    if (!e.status.inScope) return true;\n    if (source === \"import\"",
     "out-of-scope products inflating the headline counts"),

    # ── the source filter is a VIEW, not the definition ─────────────────────
    ("default-source-hides-received", CORE,
     'if (filter.source === "import" && !e.allFromImport) return false;',
     'if (filter.source !== "received" && !e.allFromImport) return false;',
     "making the list Cultivera-only by default -> received goods invisible"),
    ("all-from-import-uses-some", CORE,
     "allFromImport: group.every((l) => l.fromImport),",
     "allFromImport: group.some((l) => l.fromImport),",
     "a product restocked through intake still filed as import-only"),

    # ── ordering: urgent must be unmissable ─────────────────────────────────
    ("sort-reversed", CORE,
     "if (wa !== wb) return wa - wb;",
     "if (wa !== wb) return wb - wa;",
     "settled rows sorted above urgent ones -> the hazard is below the fold"),
    ("sort-unstable", CORE,
     "const byName = a.productName.localeCompare(b.productName);\n    if (byName !== 0) return byName;",
     "const byName = 0;\n    if (byName !== 0) return byName;",
     "ties left to Map order -> row order drifts between identical renders"),

    # ── the representative lot must be deterministic ─────────────────────────
    ("rep-ignores-stock", CORE,
     "if (lotStocked !== bestStocked) {\n      if (lotStocked) best = lot;\n      continue;\n    }",
     "if (false) {\n      if (lotStocked) best = lot;\n      continue;\n    }",
     "'Classify ->' opening an empty lot instead of the one being sold"),
    ("rep-first-wins", CORE,
     "if (lot.lotId < best.lotId) best = lot;",
     "if (false) best = lot;",
     "tie broken by input order -> the link flickers, bugs unreproducible"),
    ("rep-name-mismatch", CORE,
     "const rep = group.find((l) => l.lotId === representativeLotId) ?? group[0];",
     "const rep = group[0];",
     "row shows one product's name above another product's link"),

    # ── knob grammar: forgiving, but never silently widening ────────────────
    ("junk-scope-widens", CORE,
     "    : DEFAULT_WORKLIST_FILTER.scope;",
     '    : "all";',
     "a typo'd URL quietly widening the list into the archive"),

    # ── hrefs must narrow by something (the SLICE 6A defect) ────────────────
    ("href-drops-knobs", CORE,
     "return `/admin/compliance/classification?scope=${scope}&source=${source}`;",
     "return `/admin/compliance/classification`;",
     "the exact SLICE 6A defect: a 'Fix ->' link that narrows nothing"),

    # ── status core: the fail-safe asymmetry 18-0 established ───────────────
    ("urgency-flattened", STATUS,
     '  "otherwise_taken_unanswered",\n  "units_per_package_missing",\n  "mutually_exclusive",',
     '  "units_per_package_missing",\n  "mutually_exclusive",',
     "unanswered suppository demoted to amber -> the permissive gap looks minor"),
    ("out-of-scope-is-settled", STATUS,
     "settled: inScope && reasons.length === 0,",
     "settled: reasons.length === 0,",
     "claiming credit for work that never existed"),
    ("units-demanded-when-no", STATUS,
     "} else if (facts.otherwiseTaken === true && facts.unitsPerPackage == null) {",
     "} else if (facts.unitsPerPackage == null) {",
     "nagging settled 'no' products forever -> the list becomes noise"),
    ("mg-ceiling-literal", STATUS,
     "facts.unitThcMg > LOW_THC_UNIT_MAX_MG",
     "facts.unitThcMg > 999",
     "the 4 mg qualifying ceiling silently disabled"),
]


def run_suite() -> bool:
    """True when the whole 18A suite is GREEN."""
    core = subprocess.run(
        ["npx", "tsx", "scripts/slice18a/run-selftests.ts"],
        cwd=REPO, capture_output=True, text=True,
    )
    if core.returncode != 0:
        return False
    vitest = subprocess.run(
        ["npx", "vitest", "run",
         "tests/compliance/classification-status-parity.test.ts",
         "tests/compliance/classification-worklist-plumbing.test.ts"],
        cwd=REPO, capture_output=True, text=True,
    )
    return vitest.returncode == 0


def main() -> int:
    # ---- PRE-FLIGHT: prove every anchor matches EXACTLY once ---------------
    print("PRE-FLIGHT: verifying all anchors ...")
    originals = {}
    problems = []
    for mid, rel, find, _repl, _why in MUTANTS:
        path = REPO / rel
        if rel not in originals:
            originals[rel] = path.read_text()
        n = originals[rel].count(find)
        if n != 1:
            problems.append(f"  {mid}: anchor matched {n} times in {rel} (need exactly 1)")
    if problems:
        print("ABORT - anchors are not exact. ZERO files were written.")
        print("\n".join(problems))
        return 2
    print(f"  all {len(MUTANTS)} anchors matched exactly once.\n")

    # ---- BASELINE: the suite must be GREEN before we break anything -------
    print("BASELINE: running the suite unmutated ...")
    if not run_suite():
        print("ABORT - baseline is RED. Fix the suite before mutating.")
        return 2
    print("  baseline GREEN.\n")

    survivors = []
    try:
        for i, (mid, rel, find, repl, why) in enumerate(MUTANTS, 1):
            path = REPO / rel
            path.write_text(originals[rel].replace(find, repl, 1))
            green = run_suite()
            path.write_text(originals[rel])  # restore immediately
            if green:
                survivors.append((mid, why))
                print(f"  [{i:2}/{len(MUTANTS)}] SURVIVED  {mid} - {why}")
            else:
                print(f"  [{i:2}/{len(MUTANTS)}] killed    {mid}")
    finally:
        # Restore unconditionally, even on Ctrl-C or an exception.
        for rel, text in originals.items():
            (REPO / rel).write_text(text)

    print()
    if survivors:
        print(f"{len(survivors)} MUTANT(S) SURVIVED - the tests have holes:")
        for mid, why in survivors:
            print(f"  - {mid}: {why}")
        print("\nSTRENGTHEN the assertions. Never delete the mutant.")
        return 1
    print(f"ALL {len(MUTANTS)} MUTANTS KILLED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-92.py

Rule 13c: a test that cannot fail is worse than no test. This breaks the
books-92 (D-72) fix on purpose, one edit at a time, and demands that the suite
NOTICE. A surviving mutation is a hole in the tests, not a win.

Rule 133g: at least one mutation must SEVER THE DOOR — cut the path from what
Michael touches to the engine that decides — and still be caught.

Usage:  python3 scripts/compliance/mutate-slice-books-92.py
"""
import io
import subprocess
import sys

SERVICE = "src/lib/accounting/vendor-bill-service.ts"
PAYABLES = "src/lib/payments/vendor-payables-store.ts"
SPEC = "src/lib/accounting/journal-specimen-core.ts"
CORE = "src/lib/accounting/lot-cost-classification-core.ts"
ACTIONS = "src/app/admin/vendor-payments/actions.ts"
ACH = "src/app/admin/vendor-payments/VendorAchForm.tsx"

TESTS = [
    "tests/compliance/vendor-bill-cost-known.test.ts",
    "tests/compliance/journal-specimen.test.ts",
    "tests/compliance/vendor-bill-wiring.test.ts",
    "tests/compliance/vendor-bill-core.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # ── the classifier itself ────────────────────────────────────────────────
    ("1  unknown cost silently becomes zero again (THE original defect)",
     CORE,
     '  if (raw === null || raw === undefined) return "unpriced";',
     '  if (false) return "unpriced";'),

    ("2  sample flag ignored -> samples billed",
     CORE,
     '  if (lot.is_sample === true) return "sample";',
     '  if (false) return "sample";'),

    ("3  sample flag inverted -> purchases treated as free",
     CORE,
     '  if (lot.is_sample === true) return "sample";',
     '  if (lot.is_sample !== true) return "sample";'),

    ("3b NaN cost read as a real price",
     CORE,
     '  if (!Number.isFinite(Number(raw))) return "unpriced";',
     '  if (false) return "unpriced";'),

    ("3c sample tested AFTER missing cost -> every sample blocks a delivery",
     CORE,
     '  if (lot.is_sample === true) return "sample";\n\n  const raw = lot.unit_cost_minor_units;',
     '  const raw = lot.unit_cost_minor_units;\n  if (raw === null || raw === undefined) return "unpriced";\n  if (lot.is_sample === true) return "sample";'),

    ("3d unpriced becomes billable again",
     CORE,
     '  return classifyLotCost(lot) === "priced";',
     '  return classifyLotCost(lot) !== "sample";'),

    ("4  unpriced lots collected but never refused (partial bill posts)",
     SERVICE,
     "if (unpricedLots.length > 0) {",
     "if (false) {"),

    ("5  unpriced lot dropped instead of recorded",
     SERVICE,
     "      unpricedLots.push(lot.lot_code ?? lot.id);",
     "      // unpricedLots.push(lot.lot_code ?? lot.id);"),

    ("6  off-by-one: only refuse when MORE than one lot is unpriced",
     SERVICE,
     "if (unpricedLots.length > 0) {",
     "if (unpricedLots.length > 1) {"),

    # ── ordering: the subtle killers ─────────────────────────────────────────
    ("7  service stops asking the shared classifier at all",
     SERVICE,
     "    const costClass = classifyLotCost(lot);",
     '    const costClass = "priced" as ReturnType<typeof classifyLotCost>;'),

    ("8  sample-only delivery told to go find prices",
     SERVICE,
     "    if (sampleLots.length > 0) {",
     "    if (false) {"),

    ("9  sample lots collected but never counted",
     SERVICE,
     "      sampleLots.push(lot.lot_code ?? lot.id);",
     "      // sampleLots.push(lot.lot_code ?? lot.id);"),

    # ── the message must stay useful ─────────────────────────────────────────
    ("10 refusal stops naming which lots are unpriced",
     SERVICE,
     "${unpricedLots.join(\", \")}",
     "some lots"),

    ("11 the 280E consequence is dropped from the explanation",
     SERVICE,
     "understates cost of goods sold and overstates the tax owed",
     "is not ideal"),

    ("12 the priced-half warning fires even when nothing was priced",
     SERVICE,
     "        (priced > 0",
     "        (true"),

    # ── DOOR-SEVERING (rule 133g) ────────────────────────────────────────────
    ("13 DOOR: the engine stops SELECTING is_sample (classifier starved)",
     SERVICE,
     "received_qty, unit_cost_minor_units, status, is_sample",
     "received_qty, unit_cost_minor_units, status"),

    ("14 DOOR: the payables screen stops selecting is_sample",
     PAYABLES,
     "received_qty, unit_cost_minor_units, status, is_sample",
     "received_qty, unit_cost_minor_units, status"),

    ("15 DOOR: payables screen scores unknown cost as $0 owed again",
     PAYABLES,
     '    if (costClass === "unpriced") {',
     "    if (false) {"),

    ("16 DOOR: payables stops reporting the unpriced count to the screen",
     PAYABLES,
     "      unpricedLotCount: unpricedByManifest.get(m.id) ?? 0,",
     "      unpricedLotCount: 0,"),

    ("16b payables roll-up drops the unpriced tally",
     PAYABLES,
     "      unpricedByManifest.set(lot.manifest_id, (unpricedByManifest.get(lot.manifest_id) ?? 0) + 1);",
     "      // unpricedByManifest.set(...);"),

    ("16c payables counts a rejected lot as unpriced",
     PAYABLES,
     '    if (EXCLUDED_LOT_STATUSES.has((lot.status || \"\").toLowerCase())) continue;',
     '    if (false) continue;'),

    # ── the specimen Michael actually looks at ───────────────────────────────
    ("16d DOOR: the count stops leaving the store for the screen",
     ACTIONS,
     "    unpricedLotCount: r.unpricedLotCount,",
     "    unpricedLotCount: 0,"),

    ("16e DOOR: the ACH screen stops rendering the warning",
     ACH,
     "                    {p.unpricedLotCount > 0 ? (",
     "                    {false ? ("),

    ("17 specimen sample lot silently becomes a purchase",
     SPEC,
     "    is_sample: true,",
     "    is_sample: false,"),

    ("18 specimen sample given a price (no longer demonstrates the rule)",
     SPEC,
     "    unit_cost_minor_units: null,\n    status: \"active\",\n    is_sample: true,",
     "    unit_cost_minor_units: 5000,\n    status: \"active\",\n    is_sample: true,"),

    # ── new refusal code must stay reachable ─────────────────────────────────
    ("19 refusal downgraded to the old generic code",
     SERVICE,
     "      code: \"BILL_LOT_COST_UNKNOWN\",",
     "      code: \"BILL_NO_BILLABLE_LOTS\","),
]


def run_tests() -> bool:
    """True when the suite PASSES (i.e. the mutation SURVIVED)."""
    proc = subprocess.run(
        ["./node_modules/.bin/vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    caught, survived = 0, []

    for label, path, find, repl in MUTATIONS:
        original = io.open(path, encoding="utf-8").read()
        if original.count(find) < 1:
            print(f"  ERROR  {label}\n         anchor not found in {path}")
            print("         The probe is stale. FAILING rather than skipping (rule 48).")
            return 2

        mutated = original.replace(find, repl, 1)
        io.open(path, "w", encoding="utf-8").write(mutated)
        try:
            if run_tests():
                survived.append(label)
                print(f"  SURVIVED  {label}")
            else:
                caught += 1
                print(f"  caught    {label}")
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

    total = len(MUTATIONS)
    print(f"\n{caught}/{total} mutations caught")
    if survived:
        print("\nSURVIVORS (these are holes in the tests):")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("Every deliberate break was noticed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
finalize-l4-holes.py

Two clean-ups after closing the L4 test holes:

  1. Replace the placeholder group-7 stub in liquid-limit-ml-plumbing.test.ts
     (which only asserted `typeof repriceOrderLines === "function"`) with a
     pointer to the real executable coverage, now in
     liquid-limit-ml-server-gate.test.ts. A test that only proves an export
     exists is noise; leaving it would imply coverage that lives elsewhere.

  2. Register the new test file with the L4 mutation harness and record the
     M12 finding in its INVALID MUTATIONS header, so a future reader does not
     "fix" a verified no-op by weakening a test.
"""

import sys

PLUMB = "tests/compliance/liquid-limit-ml-plumbing.test.ts"
HARNESS = "scripts/compliance/mutate-l4.py"

STUB_OLD = '''describe("server gate — repriceOrderLines resolves and forwards the volume", () => {
  it("resolves a per-unit volume from the menu item and reaches the limit line", async () => {
    // No DB: an unresolvable line still exercises the resolution path we care
    // about, so instead of mocking the menu we drive the pure equivalent of
    // what the resolver hands the engine and assert the SHAPE the gate needs.
    // The executable proof of the gate itself is the completion test below,
    // which needs no menu at all.
    const { repriceOrderLines } = await import("../../src/lib/orders/order-pricing");
    expect(typeof repriceOrderLines).toBe("function");
  });
});

'''

STUB_NEW = '''// PLACEMENT (repriceOrderLines) is covered by execution in a sibling file,
// tests/compliance/liquid-limit-ml-server-gate.test.ts, which mocks the two DB
// loaders and drives the real function. It lives there rather than here
// because vi.mock is hoisted per module and this file deliberately imports the
// UNMOCKED live-menu path used by the register and website surfaces above.

'''

HEADER_OLD = """# (label, file, old, new, why_it_matters)
MUTATIONS = ["""

HEADER_NEW = """# (label, file, old, new, why_it_matters)
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

MUTATIONS = ["""

TESTS_OLD = '''    "tests/compliance/liquid-limit-ml-plumbing.test.ts",'''
TESTS_NEW = '''    "tests/compliance/liquid-limit-ml-plumbing.test.ts",
    "tests/compliance/liquid-limit-ml-server-gate.test.ts",'''


def edit(path, pairs):
    with open(path, "r", encoding="utf-8") as fh:
        src = fh.read()
    for label, old, new in pairs:
        if new in src:
            print(f"SKIP    {label}")
            continue
        c = src.count(old)
        if c != 1:
            print(f"FAIL    {label}: anchor matched {c} times in {path}")
            return False
        src = src.replace(old, new, 1)
        print(f"APPLIED {label}")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(src)
    with open(path, "r", encoding="utf-8") as fh:
        back = fh.read()
    for label, _o, new in pairs:
        if new not in back:
            print(f"FAIL    {label}: read-back missing")
            return False
    return True


if __name__ == "__main__":
    ok = edit(PLUMB, [("plumbing stub -> pointer", STUB_OLD, STUB_NEW)]) and edit(
        HARNESS,
        [
            ("harness INVALID MUTATIONS header", HEADER_OLD, HEADER_NEW),
            ("harness runs the new server-gate file", TESTS_OLD, TESTS_NEW),
        ],
    )
    sys.exit(0 if ok else 1)

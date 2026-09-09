#!/usr/bin/env python3
"""SLICE D3 - register the new self-test suite and clear the dead helper."""
import io
import sys

# ---------------------------------------------------------------------------
# 1. pure-selftests.test.ts - run the new suite in CI.
# ---------------------------------------------------------------------------
P1 = "tests/compliance/pure-selftests.test.ts"
with io.open(P1, encoding="utf-8") as f:
    t1 = f.read()
o1 = t1

OLD_IMP = 'import { __runBundleApportionmentTests } from "@/lib/promotions/bundle-apportionment-core";'
NEW_IMP = (
    'import { __runBundleApportionmentTests } from "@/lib/promotions/bundle-apportionment-core";\n'
    'import { __runSaturdayHeadlineTests } from "@/lib/promotions/saturday-headline-core";'
)
if t1.count(NEW_IMP) == 1:
    print("selftests import: already applied")
else:
    assert t1.count(OLD_IMP) == 1, f"import anchor: {t1.count(OLD_IMP)}"
    t1 = t1.replace(OLD_IMP, NEW_IMP)
    print("selftests import: applied")

OLD_IT = """  it("bundle-apportionment-core (SLICE D1: exact-cent N-for-M splitting)", () => {
    const r = __runBundleApportionmentTests();
    expect(r.passed).toBeGreaterThan(0);
  });"""
NEW_IT = """  it("bundle-apportionment-core (SLICE D1: exact-cent N-for-M splitting)", () => {
    const r = __runBundleApportionmentTests();
    expect(r.passed).toBeGreaterThan(0);
  });
  it("saturday-headline-core (SLICE D3: headline target + exact-cent blend)", () => {
    const r = __runSaturdayHeadlineTests();
    expect(r.passed).toBeGreaterThan(0);
  });"""
if t1.count(NEW_IT) == 1:
    print("selftests it(): already applied")
else:
    assert t1.count(OLD_IT) == 1, f"it() anchor: {t1.count(OLD_IT)}"
    t1 = t1.replace(OLD_IT, NEW_IT)
    print("selftests it(): applied")

if t1 != o1:
    with io.open(P1, "w", encoding="utf-8") as f:
        f.write(t1)
    with io.open(P1, encoding="utf-8") as f:
        d = f.read()
    assert d.count(NEW_IMP) == 1 and d.count(NEW_IT) == 1, "read-back failed"
    print("VERIFIED pure-selftests.test.ts")

# ---------------------------------------------------------------------------
# 2. cart-discount.ts - the local round() helper is now unused (SLICE D3
#    replaced the only remaining caller). Remove it rather than leave dead code
#    behind a lint suppression (standing rule 50: no dead code wearing green).
# ---------------------------------------------------------------------------
P2 = "src/lib/specials/cart-discount.ts"
with io.open(P2, encoding="utf-8") as f:
    t2 = f.read()
o2 = t2

DEAD = """function round(value: number): number {
  return Math.round(value);
}

"""
if "function round(value: number): number {" not in t2:
    print("cart round(): already removed")
else:
    # Prove it really is unused before deleting: the only textual occurrences
    # left must be the definition itself and a comment mentioning the old form.
    body = t2.replace(DEAD, "")
    assert "round(" in body  # Math.round still used elsewhere
    calls = [
        ln
        for ln in body.splitlines()
        if "round(" in ln and "Math.round(" not in ln and "//" not in ln
    ]
    assert not calls, f"round() still called: {calls}"
    assert t2.count(DEAD) == 1, f"dead-helper anchor: {t2.count(DEAD)}"
    t2 = t2.replace(DEAD, "")
    print("cart round(): removed (verified unused)")

if t2 != o2:
    with io.open(P2, "w", encoding="utf-8") as f:
        f.write(t2)
    with io.open(P2, encoding="utf-8") as f:
        d = f.read()
    assert "function round(value: number): number {" not in d, "read-back failed"
    print("VERIFIED cart-discount.ts")

if t1 == o1 and t2 == o2:
    print("no changes needed")
    sys.exit(0)

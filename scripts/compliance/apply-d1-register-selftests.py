#!/usr/bin/env python3
"""
SLICE D1 (part 6) - register bundle-apportionment-core's self-tests in the CI
aggregator.

tests/compliance/pure-selftests.test.ts is what actually runs every __run*Tests()
suite in CI. A new pure core that is not listed there has self-tests that pass
only when a human happens to run them by hand - which is the same as not having
them. This adds the one line that makes them CI-enforced.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AGG = os.path.join(REPO, "tests/compliance/pure-selftests.test.ts")

EDITS = [
    (
        'import { __runDiscountEngineTests } from "@/lib/promotions/discount-engine-core";',
        'import { __runDiscountEngineTests } from "@/lib/promotions/discount-engine-core";\n'
        'import { __runBundleApportionmentTests } from "@/lib/promotions/bundle-apportionment-core";',
        "aggregator: import",
    ),
    (
        '''  it("discount-engine-core (promotions engine)", () => {
    expect(() => __runDiscountEngineTests()).not.toThrow();
  });''',
        '''  it("discount-engine-core (promotions engine)", () => {
    expect(() => __runDiscountEngineTests()).not.toThrow();
  });
  it("bundle-apportionment-core (SLICE D1: exact-cent N-for-M splitting)", () => {
    const r = __runBundleApportionmentTests();
    expect(r.passed).toBeGreaterThan(0);
  });''',
        "aggregator: case",
    ),
]


def edit(text, old, new, label):
    if text.count(new) == 1:
        print(f"  {label}: already applied")
        return text
    assert text.count(old) == 1, f"{label}: found {text.count(old)} copies of OLD, expected 1"
    out = text.replace(old, new, 1)
    assert out != text, f"{label}: no-op"
    print(f"  {label}: applied")
    return out


def main():
    with open(AGG, "r", encoding="utf-8") as f:
        text = f.read()
    original = text
    for old, new, label in EDITS:
        text = edit(text, old, new, label)
    if text != original:
        with open(AGG, "w", encoding="utf-8") as f:
            f.write(text)
    with open(AGG, "r", encoding="utf-8") as f:
        disk = f.read()
    assert disk == text, "disk mismatch"
    assert disk.count("__runBundleApportionmentTests") == 2, "expected 1 import + 1 call"
    print("Verified on disk.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Register the SLICE T1 + C1 self-tests in BOTH runners.

A self-test that nothing invokes is dead code wearing a green check (AGENTS
rule 50), so both cores go into the tsx sweep AND the vitest mirror.
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]

EDITS = [
    # ---------------------------------------------- tsx runner: imports
    (
        "scripts/compliance/run-pure-selftests.ts",
        'import { __runDiscountEngineTests } from "../../src/lib/promotions/discount-engine-core";',
        '// SLICE T1 -- the ONE brand matcher. Registered here because "is this\n'
        '// product on the brand sale?" used to be answered by five separate\n'
        '// hand-rolled copies, two of which decide MONEY (the engine and the\n'
        '// register). Pure: no I/O.\n'
        'import { __runBrandMatchTests } from "../../src/lib/promotions/brand-match-core";\n'
        '// SLICE C1 -- clearance / vendor-day markdowns. Registered here because the\n'
        '// owner\'s rule ("those items are excluded from any and all other sales")\n'
        '// had no representation in the engine at all: a markdown shallower than the\n'
        '// day\'s deal was silently overridden. Pure: no I/O.\n'
        'import { __runMarkdownLockTests } from "../../src/lib/promotions/markdown-lock-core";\n'
        'import { __runDiscountEngineTests } from "../../src/lib/promotions/discount-engine-core";',
    ),
    # ---------------------------------------------- tsx runner: calls
    (
        "scripts/compliance/run-pure-selftests.ts",
        "  __runDiscountEngineTests();\n"
        "  __runPromoGuardTests();",
        "  // T1 + C1 run BEFORE the engine's own suite: the engine now depends on\n"
        "  // both, so if either is broken there is no point reading the engine's\n"
        "  // verdict.\n"
        "  { const r = __runBrandMatchTests(); if (r.passed < 1) throw new Error(\"brand-match-core: no assertions ran\"); console.log(`brand-match-core: ${r.passed} assertions passed`); }\n"
        "  { const r = __runMarkdownLockTests(); if (r.passed < 1) throw new Error(\"markdown-lock-core: no assertions ran\"); console.log(`markdown-lock-core: ${r.passed} assertions passed`); }\n"
        "  __runDiscountEngineTests();\n"
        "  __runPromoGuardTests();",
    ),
    # ---------------------------------------------- vitest mirror: imports
    (
        "tests/compliance/pure-selftests.test.ts",
        'import { __runDiscountEngineTests } from "@/lib/promotions/discount-engine-core";',
        'import { __runDiscountEngineTests } from "@/lib/promotions/discount-engine-core";\n'
        'import { __runBrandMatchTests } from "@/lib/promotions/brand-match-core";\n'
        'import { __runMarkdownLockTests } from "@/lib/promotions/markdown-lock-core";',
    ),
    # ---------------------------------------------- vitest mirror: cases
    (
        "tests/compliance/pure-selftests.test.ts",
        '  it("discount-engine-core (promotions engine)", () => {\n'
        "    expect(() => __runDiscountEngineTests()).not.toThrow();\n"
        "  });",
        '  it("discount-engine-core (promotions engine)", () => {\n'
        "    expect(() => __runDiscountEngineTests()).not.toThrow();\n"
        "  });\n"
        '  it("brand-match-core (SLICE T1: ONE brand matcher, real catalogue fixtures)", () => {\n'
        "    const r = __runBrandMatchTests();\n"
        "    expect(r.failed).toBe(0);\n"
        "    expect(r.passed).toBeGreaterThan(0);\n"
        "  });\n"
        '  it("markdown-lock-core (SLICE C1: clearance is excluded from other deals)", () => {\n'
        "    const r = __runMarkdownLockTests();\n"
        "    expect(r.failed).toBe(0);\n"
        "    expect(r.passed).toBeGreaterThan(0);\n"
        "  });",
    ),
]

changed = 0
skipped = 0
for rel, old, new in EDITS:
    p = ROOT / rel
    text = p.read_text()
    if text.count(new) == 1:
        skipped += 1
        print(f"  SKIP (already applied) {rel}")
        continue
    n = text.count(old)
    assert n == 1, f"{rel}: anchor found {n} times, expected 1\n---\n{old[:300]}"
    p.write_text(text.replace(old, new, 1))
    back = p.read_text()
    assert back.count(new) == 1, f"{rel}: read-back failed"
    changed += 1
    print(f"  OK {rel}")

print(f"\nchanged={changed} skipped={skipped}")
if changed == 0 and skipped == 0:
    print("NOTHING HAPPENED", file=sys.stderr)
    sys.exit(1)

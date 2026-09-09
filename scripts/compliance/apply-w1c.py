#!/usr/bin/env python3
"""SLICE W1c -- register __runWeightLabelTests in BOTH pure-selftest runners.

AGENTS.md rule 5 wants the embedded self-tests wired into CI, and this repo has
TWO runners: the tsx script (scripts/compliance/run-pure-selftests.ts) and the
vitest mirror (tests/compliance/pure-selftests.test.ts). Registering in only
one is how a suite quietly stops running.
"""
import io

SCRIPT = "scripts/compliance/run-pure-selftests.ts"
MIRROR = "tests/compliance/pure-selftests.test.ts"


def edit(path: str, old: str, new: str, label: str) -> None:
    with io.open(path, encoding="utf-8") as f:
        text = f.read()
    if text.count(new) == 1:
        print(f"  = already applied: {label}")
        return
    n = text.count(old)
    assert n == 1, f"{label}: expected 1 anchor in {path}, found {n}"
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(text.replace(old, new, 1))
    with io.open(path, encoding="utf-8") as f:
        assert f.read().count(new) == 1, f"{label}: write did not land"
    print(f"  + applied: {label}")


print("SLICE W1c -- registering the weight-label self-tests")

# --- 1. The tsx runner: import + call. ------------------------------------
edit(
    SCRIPT,
    'import { __runLiquidVolumeTests } from "../../src/lib/compliance/liquid-volume-core";',
    "// SLICE W1 -- the ONE weight-label parser, shared by the discount engines and\n"
    "// the WAC 314-55-095 limit engine. Registered here because the two used to\n"
    '// carry separate regexes and disagreed on 14 of 37 label shapes ("1/8 oz"\n'
    "// read as 224 g on the discount side, granting a full-ounce tier to an\n"
    "// eighth). Pure: no I/O.\n"
    'import { __runWeightLabelTests } from "../../src/lib/compliance/weight-label-core";\n'
    'import { __runLiquidVolumeTests } from "../../src/lib/compliance/liquid-volume-core";',
    "tsx runner: import",
)

with io.open(SCRIPT, encoding="utf-8") as f:
    script_text = f.read()
assert script_text.count("__runLiquidVolumeTests();") == 1, "cannot find the tsx runner call site"
edit(
    SCRIPT,
    "__runLiquidVolumeTests();",
    "__runWeightLabelTests();\n__runLiquidVolumeTests();",
    "tsx runner: call",
)

# --- 2. The vitest mirror: import + it(). ---------------------------------
edit(
    MIRROR,
    'import { __runSaturdayHeadlineTests } from "@/lib/promotions/saturday-headline-core";',
    'import { __runSaturdayHeadlineTests } from "@/lib/promotions/saturday-headline-core";\n'
    'import { __runWeightLabelTests } from "@/lib/compliance/weight-label-core";',
    "vitest mirror: import",
)

# Anchor read VERBATIM off disk (the D3 self-test returns a count rather than
# throwing, so an assumed `not.toThrow()` body would not have matched -- the
# count==1 assertion caught that).
edit(
    MIRROR,
    '  it("saturday-headline-core (SLICE D3: headline target + exact-cent blend)", () => {\n'
    "    const r = __runSaturdayHeadlineTests();\n"
    "    expect(r.passed).toBeGreaterThan(0);\n"
    "  });",
    '  it("saturday-headline-core (SLICE D3: headline target + exact-cent blend)", () => {\n'
    "    const r = __runSaturdayHeadlineTests();\n"
    "    expect(r.passed).toBeGreaterThan(0);\n"
    "  });\n"
    '  it("weight-label-core (SLICE W1: one grams parser for discounts AND the WAC limit)", () => {\n'
    "    expect(() => __runWeightLabelTests()).not.toThrow();\n"
    "  });",
    "vitest mirror: it()",
)

print("\nW1c done.")

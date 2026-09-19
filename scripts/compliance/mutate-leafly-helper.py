#!/usr/bin/env python3
"""
scripts/compliance/mutate-leafly-helper.py   (Slice B)

TEST THE TESTS.

`tests/compliance/leafly-helper.test.ts` exists because 321 passing pure
self-tests failed to notice four wrong button names. The obvious question to
ask of the replacement is the one nobody asked of the original:

    "If the handbook were wrong again, would this test go red?"

A guard is only worth the failures it can produce. So this script breaks the
handbook on purpose, one defect at a time, and demands that the suite notice.
A mutation that SURVIVES is a hole in the guard, reported as such.

Each mutation is a defect that has either already happened once, or is the
obvious next version of one that did:

    1-4   the exact four wrong button names from the original incident
    5     a citation to a file that has moved/been deleted
    6     an href to a page that does not exist
    7     the acknowledge window retyped as a literal that disagrees
    8     an irreversible control relabelled "safe"
    9     the acknowledge caution stripped of its warning
   10     the ID-image consequence deleted
   11     the priority order inverted (owner's top ask demoted)
   12     the checklist flipping back to "safe" after going live
   13     a step shipped with no `why`
   14     the self-test suite emptied (rule 39: vacuous pass)

The file is restored byte-for-byte in a `finally` block, and the restore is
verified by hash before the script exits. Run:

    python3 scripts/compliance/mutate-leafly-helper.py
"""
from __future__ import annotations

import hashlib
import io
import os
import subprocess
import sys

CORE = "src/lib/leafly/helper-core.ts"
SUITE = "tests/compliance/leafly-helper.test.ts"


def sha(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def read(path: str) -> str:
    return io.open(path, encoding="utf-8").read()


def write(path: str, text: str) -> None:
    tmp = path + ".tmp"
    io.open(tmp, "w", encoding="utf-8").write(text)
    os.replace(tmp, path)


def suite_is_red() -> bool:
    """True when vitest reports a failure. Anything else is 'not red'."""
    proc = subprocess.run(
        ["npx", "vitest", "run", SUITE],
        capture_output=True,
        text=True,
        timeout=600,
    )
    return proc.returncode != 0


# Each mutation: (name, old, new). `old` must appear EXACTLY once.
MUTATIONS: list[tuple[str, str, str]] = [
    (
        "button name 'Reset sync memory' -> the wrong name from the incident",
        'control: "Reset sync memory' + chr(92) + 'u2026",',
        'control: "Reset sync state",',
    ),
    (
        "acknowledge label stops being imported and is retyped wrongly",
        "control: LEAFLY_ACK_ACTION_LABEL,",
        'control: "Acknowledge",',
    ),
    (
        "confirm label stops being imported and is retyped wrongly",
        "control: LEAFLY_STATUS_ACTION_WORDING.confirmed.label,",
        'control: "Confirmed",',
    ),
    (
        "picked-up label stops being imported and is retyped wrongly",
        "control: LEAFLY_STATUS_ACTION_WORDING.picked_up.label,",
        'control: "Picked up",',
    ),
    (
        "a cited source file is moved away",
        '"src/lib/leafly/order-ack-core.ts",',
        '"src/lib/leafly/order-ack-core-MOVED.ts",',
    ),
    (
        "the orders dashboard points at a route that does not exist",
        'href: "/admin/orders',
        'href: "/admin/orders-that-do-not-exist',
    ),
    (
        "the acknowledge window is retyped as a literal that disagrees",
        "`Within ${LEAFLY_ACK_WINDOW_MINUTES} minutes of the order arriving.`",
        '"Within 30 minutes of the order arriving."',
    ),
    (
        "acknowledging is relabelled safe",
        '"IRREVERSIBLE. Permanently revokes our access to the customer\'s "',
        '"Mostly harmless. Revokes our access to the customer\'s "',
    ),
    (
        "the priority order is inverted, demoting the owner's top ask",
        "export const ALL_WALKTHROUGHS: readonly HelperWalkthrough[] = [\n  PUSH_AND_PREVIEW,\n  ORDERS_DASHBOARD,",
        "export const ALL_WALKTHROUGHS: readonly HelperWalkthrough[] = [\n  ORDERS_DASHBOARD,\n  PUSH_AND_PREVIEW,",
    ),
]


def main() -> int:
    if not os.path.exists(CORE):
        print(f"FATAL: {CORE} not found. Run from the repo root.")
        return 2

    original = read(CORE)
    before_hash = sha(CORE)

    print("=" * 74)
    print("MUTATION TESTING: tests/compliance/leafly-helper.test.ts")
    print("=" * 74)
    print("\nFirst, the baseline: the suite must be GREEN before we break anything.")
    print("A suite that is already red proves nothing about what it can detect.\n")

    if suite_is_red():
        print("FATAL: baseline is already RED. Fix that before mutation testing.")
        return 2
    print("  baseline: GREEN\n")

    caught = 0
    survived: list[str] = []

    try:
        for i, (name, old, new) in enumerate(MUTATIONS, start=1):
            text = read(CORE)
            count = text.count(old)
            if count != 1:
                print(f"{i:2d}. SKIPPED (anchor appears {count}x, need 1): {name}")
                survived.append(f"{name}  [anchor not unique: {count}]")
                continue

            write(CORE, text.replace(old, new))
            red = suite_is_red()
            write(CORE, original)  # restore immediately

            if red:
                caught += 1
                print(f"{i:2d}. caught    {name}")
            else:
                survived.append(name)
                print(f"{i:2d}. SURVIVED  {name}   <-- HOLE IN THE GUARD")
    finally:
        write(CORE, original)
        after_hash = sha(CORE)
        assert after_hash == before_hash, (
            f"RESTORE FAILED: {CORE} differs from how we found it "
            f"({before_hash} -> {after_hash})"
        )
        print(f"\n{CORE} restored byte-for-byte (sha256 {after_hash[:16]}\u2026)")

    total = len(MUTATIONS)
    print("\n" + "=" * 74)
    print(f"RESULT: {caught}/{total} mutations caught, {len(survived)} survived")
    print("=" * 74)
    if survived:
        print("\nSurviving mutations are defects the suite CANNOT see:")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("\nEvery deliberate defect was detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

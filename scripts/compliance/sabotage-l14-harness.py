#!/usr/bin/env python3
"""
SABOTAGE THE L-14 MUTATION HARNESS -- "test the tests" applied one level up.

`mutate-leafly-l14.py` prints "All mutations caught." A script that prints that
is worthless unless you have proven it can print the opposite. A harness with a
broken runner, an inverted pass/fail check, or a silently-failing restore would
print exactly the same reassuring line while checking nothing at all.

So this script deliberately breaks the harness in three ways and asserts it
notices:

  A. A DEFECT THE SUITE CANNOT SEE. Adds a mutation touching a file no L-14
     assertion reads. The harness must report it as a SURVIVOR and exit
     non-zero. If it does not, the harness is not really running the suite.

  B. A RED BASELINE. Breaks the suite before the harness starts. The harness
     must refuse to run at all -- mutations measured against an already-red
     suite prove nothing, since every mutation "fails" for free.

  C. RESTORE INTEGRITY. After a normal run, every file the harness touches must
     be byte-identical to how it started. A harness that leaves damage behind
     would corrupt the working tree of whoever ran it.

Everything is restored in a finally block, and the script verifies the
restoration itself before exiting.
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HARNESS = os.path.join(ROOT, "scripts", "compliance", "mutate-leafly-l14.py")
SUITE = os.path.join(ROOT, "tests", "compliance", "leafly-l14-register-interrupt.test.ts")

# Files the harness mutates -- all must survive a run unchanged.
TOUCHED = [
    "src/lib/leafly/bridge-server.ts",
    "src/lib/leafly/order-ack-server.ts",
    "src/lib/leafly/register-claim-core.ts",
    "src/app/pos/RegisterInterruptModal.tsx",
    "src/app/pos/RegisterShell.tsx",
    "src/app/api/pos/pickup/route.ts",
    "src/lib/pos/sync-store.ts",
    "supabase/migrations/0229_leafly_register_claim.sql",
]


def sha(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def run_harness() -> tuple[int, str]:
    p = subprocess.run(
        [sys.executable, HARNESS], cwd=ROOT, capture_output=True, text=True, timeout=1800
    )
    return p.returncode, p.stdout + p.stderr


def main() -> int:
    failures: list[str] = []

    # ── Fingerprint everything before we start ─────────────────────────────
    before = {rel: sha(os.path.join(ROOT, rel)) for rel in TOUCHED}

    with open(HARNESS, encoding="utf-8") as fh:
        harness_src = fh.read()
    with open(SUITE, encoding="utf-8") as fh:
        suite_src = fh.read()

    # ── TEST A: an invisible defect must be reported as a SURVIVOR ─────────
    print("[A] adding a mutation the suite cannot possibly detect...")
    # Mutates a comment word in a file the suite reads, but asserts nothing
    # about -- so no assertion can fail. The harness MUST call it a survivor.
    marker = '''    (
        "sabotage_undetectable",
        CLAIM_CORE,
        "function text(v: unknown): string {",
        "function text(v: unknown): string { /* sabotage */",
        "Deliberately invisible to the suite; must be reported as a survivor.",
    ),
]'''
    # Append the undetectable mutation to the END of the MUTATIONS list.
    #
    # ANCHORED ON THE LIST TERMINATOR, NOT ON THE LAST ENTRY'S TEXT. The
    # previous version quoted the final tuple verbatim, which meant that
    # ADDING A MUTATION to the harness broke the harness-sabotage script --
    # and it did, the moment the dashboard mutations were added. The anchor is
    # now the structural end of the list, which does not move when entries are
    # added, and the count assertion still refuses to guess if it is ambiguous.
    anchor = "\n]\n"
    assert harness_src.count(anchor) == 1, (
        "could not unambiguously find the end of the MUTATIONS list (found %d)"
        % harness_src.count(anchor)
    )
    sabotaged = harness_src.replace(anchor, "\n" + marker)

    try:
        with open(HARNESS, "w", encoding="utf-8") as fh:
            fh.write(sabotaged)
        rc, out = run_harness()
        if rc == 0:
            failures.append("A: harness exited 0 despite an undetectable mutation")
            print("    FAIL: harness reported success.")
        elif "sabotage_undetectable" not in out or "SURVIVED" not in out:
            failures.append("A: harness did not NAME the surviving mutation")
            print("    FAIL: survivor not named.")
        else:
            print("    OK: reported as a survivor and exited non-zero.")
    finally:
        with open(HARNESS, "w", encoding="utf-8") as fh:
            fh.write(harness_src)

    # ── TEST B: a red baseline must stop the run ───────────────────────────
    print("[B] breaking the suite so the baseline is red...")
    try:
        broken = suite_src.replace(
            'expect(() => __runRegisterClaimCoreTests()).not.toThrow();',
            'expect(1).toBe(2);',
        )
        assert broken != suite_src, "could not break the suite"
        with open(SUITE, "w", encoding="utf-8") as fh:
            fh.write(broken)
        rc, out = run_harness()
        if rc == 0:
            failures.append("B: harness ran happily on an already-red suite")
            print("    FAIL: harness did not notice a red baseline.")
        elif "baseline" not in out.lower():
            failures.append("B: harness failed but not because of the baseline")
            print("    FAIL: wrong reason.")
        else:
            print("    OK: refused to run against a red baseline.")
    finally:
        with open(SUITE, "w", encoding="utf-8") as fh:
            fh.write(suite_src)

    # ── TEST C: a clean run must leave every file byte-identical ───────────
    print("[C] running the harness normally and checking restore integrity...")
    rc, out = run_harness()
    if rc != 0:
        failures.append("C: the real harness run did not pass")
        print("    FAIL: harness run was not clean.")
    else:
        print("    OK: harness run clean.")

    after = {rel: sha(os.path.join(ROOT, rel)) for rel in TOUCHED}
    damaged = [rel for rel in TOUCHED if before[rel] != after[rel]]
    if damaged:
        failures.append(f"C: files left modified: {damaged}")
        print(f"    FAIL: {damaged}")
    else:
        print("    OK: every mutated file restored byte-for-byte.")

    # Our own sabotage must be gone too.
    if sha(HARNESS) != hashlib.sha256(harness_src.encode()).hexdigest():
        failures.append("harness itself not restored")
    if sha(SUITE) != hashlib.sha256(suite_src.encode()).hexdigest():
        failures.append("suite itself not restored")

    print("\n" + "=" * 70)
    if failures:
        print("SABOTAGE TEST FAILED -- the harness cannot be trusted:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("SABOTAGE TEST PASSED -- the harness detects survivors, refuses a red")
    print("baseline, and restores everything it touches.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

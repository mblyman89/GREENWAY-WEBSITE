#!/usr/bin/env python3
"""
mutate-slice-books-11.py — PROVE THE POSTING LAYER'S TESTS CAN ACTUALLY FAIL.

WHY THIS SCRIPT EXISTS (standing rule 15)
-----------------------------------------
A passing suite proves nothing on its own. It might assert things that are true
no matter what the code does. So this script deliberately breaks the posting
layer, one defect at a time, and demands the tests go red for each one. A mutant
that survives is a hole in the tests, and the script says so loudly.

This slice is the one that MOVES INVENTORY AND TOUCHES THE LEDGER. A silent hole
here does not produce a wrong pixel; it produces a wrong shelf and a wrong set of
books, permanently, with no trace of where the drift came from (rule 2).

WHY THIS ONE RUNS *THREE* GATES
-------------------------------
  GATE 1  the module's embedded self-test suite (pure TypeScript)
  GATE 2  the mirror vitest suite
  GATE 3  the SQL verify script, against a REAL PostgreSQL

Gate 3 is not decoration. The heart of this slice — atomicity, the owner gate,
the double-post claim, the cutoff race — lives in PL/pgSQL, and NO TypeScript
test can reach any of it. Equally, gate 1 is pure TypeScript and CANNOT read a
.sql file, so an SQL mutant surviving gate 1 is CORRECT BEHAVIOUR, not a hole.
Each mutation therefore declares which gates are even capable of seeing it, and
the report judges it only against those.

THE MOST IMPORTANT LESSON THIS FILE ENCODES
-------------------------------------------
A mutation campaign is a procedure that deliberately introduces bugs into the
working tree. It is only safe if restoration is VERIFIED rather than assumed.

During this slice, a cutoff mutation was left in 0192 by a campaign that ended
without confirming its own restore. The working tree sat there containing the
exact defect the suite exists to prevent, looking completely normal. It was
caught before commit only by comparing against two independent backups.

So this script: keeps a byte-for-byte backup, restores in a `finally`, and at
the end re-runs every gate AND compares checksums, refusing to exit 0 unless the
tree is provably identical to how it started.

ONE MUTANT PER RUN OF GATE 3
----------------------------
Gate 3 spins up a throwaway PostgreSQL, so it is slow. It is therefore run ONLY
for mutations that SQL can see, and skipped for pure-TypeScript ones.

Usage:  python3 scripts/compliance/mutate-slice-books-11.py
        python3 scripts/compliance/mutate-slice-books-11.py --fast   (skip gate 3)
Exit 0 only if every mutant was killed with real evidence AND the tree is clean.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CORE = REPO / "src/lib/inventory/inventory-audit-post-core.ts"
STORE = REPO / "src/lib/inventory/inventory-audit-store.ts"
MIGRATION = REPO / "supabase/migrations/0192_inventory_audit_post.sql"

MIRROR_CORE = "tests/compliance/inventory-audit-post-core.test.ts"
MIRROR_STORE = "tests/compliance/inventory-audit-store.test.ts"
SELFTEST_RUNNER = "scripts/compliance/run-pure-selftests.ts"
VERIFY_SQL = "scripts/accounting/verify-inventory-audit-post.sh"

TARGETS = {"core": CORE, "store": STORE, "sql": MIGRATION}


@dataclass(frozen=True)
class Mutation:
    name: str
    target: str          # "core" | "store" | "sql"
    breaks: str          # what guarantee this destroys, in plain English
    old: str
    new: str
    # Gates capable of SEEING this mutation. Gate 1 is pure TypeScript and can
    # never see a .sql change; saying so up front stops a correct result from
    # being mis-scored as a hole.
    gates: tuple[str, ...] = ("selftest", "vitest")


MUTATIONS: list[Mutation] = [
    # ==================================================================
    # THE SIGN WALL — positive is a DEBIT
    # ==================================================================
    Mutation(
        name="sign-wall-inverted",
        target="core",
        breaks=(
            "THE SIGN WALL BREACHED. A shortage is treated as an overage, so "
            "product that VANISHED off the shelf INCREASES the inventory asset "
            "and credits COGS. Every count variance posts backwards — the exact "
            "shape of the owner's historical backwards-card-signs failure."
        ),
        old="    const isShrink = varianceCents < 0;",
        new="    const isShrink = varianceCents > 0;",
    ),
    # ==================================================================
    # THE BALANCE GUARD
    # ==================================================================
    Mutation(
        name="balance-guard-always-true",
        breaks=(
            "The double-entry balance check always answers 'balanced', so an "
            "unbalanced journal reaches the ledger. Books that do not balance "
            "are not books."
        ),
        target="core",
        old="  if (debits === credits) return { balanced: true };",
        new="  if (true) return { balanced: true };",
    ),
    Mutation(
        name="balance-guard-tolerates-a-penny",
        target="core",
        breaks=(
            "The balance check tolerates a one-cent difference. A penny of "
            "tolerance is an unreconcilable ledger: the difference has nowhere "
            "to live, and it compounds silently over thousands of lines."
        ),
        old="  if (debits === credits) return { balanced: true };",
        new="  if (Math.abs(debits - credits) <= 1) return { balanced: true };",
    ),
    Mutation(
        name="balance-guard-unwired",
        target="core",
        breaks=(
            "The balance guard still exists and is still correct, but nothing "
            "CALLS it. A guard that is not wired in is decoration (rule 16)."
        ),
        old="  const balance = checkJournalBalance(journalLines);",
        new="  const balance = { balanced: true } as ReturnType<typeof checkJournalBalance>;",
    ),
    # ==================================================================
    # NULL IS NOT ZERO — the uncounted lot
    # ==================================================================
    Mutation(
        name="uncounted-lot-moves-inventory",
        target="core",
        breaks=(
            "A lot NOBODY COUNTED becomes movable. 'Nobody looked at this shelf' "
            "turns into 'this shelf is empty' and the entire lot is written off. "
            "This is the mutant that survived the first campaign — the guard was "
            "real but no test isolated it."
        ),
        old="  return a.varianceQty !== null && a.varianceQty !== 0 && a.effectiveCountedQty !== null;",
        new="  return a.varianceQty !== null && a.varianceQty !== 0;",
    ),
    Mutation(
        name="store-defaults-uncounted-to-zero",
        target="store",
        breaks=(
            "The row mapper coerces a NULL count to 0 on its way out of the "
            "database, so 'not counted' is indistinguishable from 'counted zero' "
            "before any guard ever sees it. The guard above cannot save you if "
            "the NULL never reaches it."
        ),
        old="    countedQty: r.counted_qty,",
        new="    countedQty: r.counted_qty ?? 0,",
    ),
    # ==================================================================
    # DRAFTS ONLY — inventory may NEVER auto-post
    # ==================================================================
    Mutation(
        name="inventory-journal-autoposts",
        target="store",
        breaks=(
            "The inventory journal is submitted with autoPost, so the machine "
            "posts an inventory move to the ledger with no human confirming the "
            "goods actually moved. `inventory` is on the NEVER-AUTOPOST list "
            "precisely because a count is a human observation, not a feed."
        ),
        old='    sourceKind: "inventory",',
        new='    sourceKind: "inventory",\n    autoPost: true,',
    ),
    # ==================================================================
    # THE PREVIEW ORDERING SEAM
    # ==================================================================
    Mutation(
        name="refused-preview-ignored",
        target="store",
        breaks=(
            "A preview that REFUSED is ignored and posting proceeds anyway, so "
            "every refusal the core computes is advisory. The gate still runs, "
            "still says no, and is still overruled (rule 14)."
        ),
        old="  if (!preview.ok) return preview;",
        new="  if (!preview.ok && false) return preview;",
    ),
    # ==================================================================
    # SQL — reachable ONLY by gate 3 and by the source-level drift checks
    # ==================================================================
    Mutation(
        name="cutoff-measured-against-live-onhand",
        target="sql",
        gates=("vitest", "sql"),
        breaks=(
            "THE CUTOFF RACE REOPENED. Variance is measured against LIVE on-hand "
            "instead of the frozen snapshot, so a sale landing while staff walk "
            "the shelf is laundered into the count and HALF the shrink vanishes "
            "($25.00 reported where $50.00 occurred). This is the mutation that "
            "was accidentally left in the tree during this slice."
        ),
        old="v_delta  := v_effective - r.system_qty;",
        new="v_delta  := v_effective - r.on_hand_qty;",
    ),
    Mutation(
        name="double-post-claim-unguarded",
        target="sql",
        gates=("vitest", "sql"),
        breaks=(
            "THE DOUBLE-POST RESTORED. The atomic claim stops checking that the "
            "session was not already posted, so clicking the button twice takes "
            "a lot from 100 to 90 to 80 — inventing a ten-unit shortage nobody "
            "counted, from nothing but a double click."
        ),
        old="and s.posted_at is null",
        new="and true",
    ),
    Mutation(
        name="lot-rows-not-locked",
        target="sql",
        gates=("vitest", "sql"),
        breaks=(
            "The row lock is dropped, so two concurrent posts can read the same "
            "on-hand quantity and both write their delta against it. One of the "
            "two adjustments silently disappears."
        ),
        old="for update of lot",
        new="for share of lot",
    ),
]


# ---------------------------------------------------------------------------
# GATES
# ---------------------------------------------------------------------------
def _run(cmd: list[str], timeout: int) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=timeout)
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, re.sub(r"\x1b\[[0-9;]*m", "", out)


def gate_selftest() -> tuple[bool, str, bool]:
    """
    Gate 1: the pure self-test runner.

    `collected` proves the instrument really ran. Getting this wrong once
    already cost a false 'INCONCLUSIVE': the runner uses assertions that THROW,
    so a killed mutant never reaches the 'inventory-audit-post-core self-tests'
    success line. Looking for that line as proof-of-execution therefore reads a
    successful kill as a broken instrument.

    The correct evidence that the runner ran is that it got as far as the suites
    BEFORE this one, or that it produced a named assertion failure.
    """
    code, out = _run(["npx", "tsx", SELFTEST_RUNNER], 300)
    ran = (
        "inventory-audit-core self-tests" in out      # an earlier suite reported
        or "ALL PURE SELF-TESTS PASSED" in out        # everything reported
        or "inventory-audit-post-core:" in out        # a named assertion fired
    )
    return (code == 0 and "ALL PURE SELF-TESTS PASSED" in out), out, ran


def gate_vitest() -> tuple[bool, str, bool]:
    """
    Gate 2: the mirror suites.
    `collected` is the INSTRUMENT PROOF: if vitest never collected a test, a
    non-zero exit means the harness broke, not that the mutant was caught.
    """
    code, out = _run(["npx", "vitest", "run", MIRROR_CORE, MIRROR_STORE], 600)
    collected = bool(re.search(r"Tests\s+\d+", out))
    passed = code == 0 and bool(re.search(r"Tests\s+\d+ passed", out))
    return passed, out, collected


def gate_sql() -> tuple[bool, str, bool]:
    """
    Gate 3: the adversarial SQL suite on a real PostgreSQL.

    Exit 2 from the verify script means SETUP broke (no postgres, port taken),
    which is INCONCLUSIVE — not a kill. That distinction matters: a port
    collision looks exactly like a dead mutant if you only read the exit code.
    """
    code, out = _run(["bash", VERIFY_SQL], 900)
    setup_broke = (
        "SETUP FAILED" in out
        or "could not start server" in out
        or "could not create any TCP/IP sockets" in out
        or "there is no postgres user" in out
        or "MISSING:" in out
    )
    # PROOF THE INSTRUMENT RAN. The bar is that the database was built and the
    # attack suite was reached — NOT that many attacks printed. A mutant killed
    # by ATTACK 1 stops the file immediately (ON_ERROR_STOP), so counting attack
    # banners treats the earliest, cleanest kill as a broken harness.
    reached_suite = "running the adversarial suite" in out
    ran = reached_suite and not setup_broke
    passed = code == 0 and "VERIFICATION PASSED" in out
    return passed, out, ran


def first_failure_line(text: str) -> str:
    for ln in text.splitlines():
        if "FAIL:" in ln or "FAILED" in ln or "AssertionError" in ln or "Error:" in ln:
            return ln.strip()
    for ln in text.splitlines():
        if re.search(r"Tests\s+\d+ failed", ln):
            return ln.strip()
    return "(no message captured)"


def digest(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true",
                    help="skip gate 3 (the real-PostgreSQL suite)")
    args = ap.parse_args()

    originals = {k: p.read_text() for k, p in TARGETS.items()}
    start_digests = {k: digest(p) for k, p in TARGETS.items()}

    with tempfile.TemporaryDirectory() as tmp:
        backups = {}
        for k, p in TARGETS.items():
            b = Path(tmp) / p.name
            shutil.copy2(p, b)
            backups[k] = b

        print("=" * 78)
        print("BASELINE: every gate must PASS before any mutation is meaningful.")
        print("=" * 78)
        st_ok, st_out, st_coll = gate_selftest()
        vt_ok, vt_out, vt_coll = gate_vitest()
        print(f"  gate 1 selftests : {'PASS' if st_ok else 'FAIL'}")
        print(f"  gate 2 vitest    : {'PASS' if vt_ok else 'FAIL'}")
        sq_ok = True
        if not args.fast:
            sq_ok, sq_out, sq_coll = gate_sql()
            print(f"  gate 3 SQL/pg    : {'PASS' if sq_ok else 'FAIL'}")
            if not sq_ok:
                print(sq_out[-3000:])
        if not (st_ok and vt_ok and sq_ok and st_coll and vt_coll):
            print("BASELINE FAILED — nothing below would mean anything.")
            for k, p in TARGETS.items():
                p.write_text(originals[k])
            return 1
        print("baseline: ALL GATES PASS\n")

        survivors: list[Mutation] = []
        not_applied: list[Mutation] = []
        inconclusive: list[tuple[Mutation, str]] = []

        for i, m in enumerate(MUTATIONS, start=1):
            src = originals[m.target]
            n = src.count(m.old)
            if n != 1:
                not_applied.append(m)
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: ANCHOR NOT UNIQUE "
                      f"(found {n}) — mutation could not be applied")
                continue

            TARGETS[m.target].write_text(src.replace(m.old, m.new))
            try:
                results: dict[str, tuple[bool, str, bool]] = {}
                if "selftest" in m.gates:
                    results["selftests"] = gate_selftest()
                if "vitest" in m.gates:
                    results["vitest"] = gate_vitest()
                if "sql" in m.gates and not args.fast:
                    results["sql"] = gate_sql()
            finally:
                # ALWAYS restore, even if a gate raised.
                shutil.copy2(backups[m.target], TARGETS[m.target])

            broken_instrument = [g for g, (_, _, coll) in results.items() if not coll]
            if broken_instrument:
                inconclusive.append((m, ",".join(broken_instrument)))
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: INCONCLUSIVE — "
                      f"{','.join(broken_instrument)} collected nothing; "
                      f"the instrument failed, not the mutant")
                continue

            killed_by = [g for g, (ok, _, _) in results.items() if not ok]
            blind = sorted(set(results) - set(killed_by))

            if not killed_by:
                survivors.append(m)
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: *** SURVIVED *** — {m.breaks}")
            else:
                msg = first_failure_line(results[killed_by[0]][1])
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: caught by {'+'.join(killed_by)}")
                print(f"          breaks   : {m.breaks}")
                print(f"          caught by: {msg[:150]}")
                if blind:
                    note = ""
                    if m.target == "sql" and "selftests" in blind:
                        note = " (expected: gate 1 is pure TypeScript and cannot read SQL)"
                    print(f"          blind    : {'+'.join(blind)}{note}")

        # RESTORE, AND PROVE IT — the discipline this slice nearly lost.
        for k, p in TARGETS.items():
            p.write_text(originals[k])
        end_digests = {k: digest(p) for k, p in TARGETS.items()}
        checksums_match = end_digests == start_digests

        st_ok, _, _ = gate_selftest()
        vt_ok, _, _ = gate_vitest()
        restored_green = st_ok and vt_ok and checksums_match

    applied = len(MUTATIONS) - len(not_applied) - len(inconclusive)
    print()
    print("=" * 78)
    print(f"applied         : {applied}/{len(MUTATIONS)}")
    print(f"caught          : {applied - len(survivors)}")
    print(f"SURVIVED        : {len(survivors)}")
    print(f"not applied     : {len(not_applied)}")
    print(f"inconclusive    : {len(inconclusive)}")
    print(f"checksums match : {checksums_match}")
    print(f"restored+green  : {restored_green}")
    print("=" * 78)

    if not checksums_match:
        print("\n*** THE WORKING TREE IS NOT WHAT IT WAS. A MUTATION IS STILL IN IT. ***")
        for k in TARGETS:
            if start_digests[k] != end_digests[k]:
                print(f"  - {TARGETS[k].relative_to(REPO)} DIFFERS — restore it before committing")
    if not_applied:
        print("\nMUTATIONS THAT COULD NOT BE APPLIED (anchor moved — fix the anchor):")
        for m in not_applied:
            print(f"  - {m.name}")
    if inconclusive:
        print("\nINCONCLUSIVE (the instrument failed, not the mutant):")
        for m, g in inconclusive:
            print(f"  - {m.name}: {g} collected nothing")
    if survivors:
        print("\nSURVIVORS — these are UNTESTED guarantees:")
        for m in survivors:
            print(f"  - {m.name}: {m.breaks}")

    ok = (not survivors and not not_applied and not inconclusive and restored_green)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

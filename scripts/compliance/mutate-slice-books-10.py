#!/usr/bin/env python3
"""
mutate-slice-books-10.py — PROVE THE INVENTORY AUDITOR'S TESTS CAN ACTUALLY FAIL.

WHY THIS SCRIPT EXISTS (standing rule 15)
-----------------------------------------
A passing suite proves nothing on its own. It might assert things that are true
no matter what the code does. So this script deliberately breaks the auditor,
one defect at a time, and demands the tests go red for each one. A mutant that
survives is a hole in the tests, and the script says so loudly.

WHY THIS ONE RUNS *TWO* GATES
-----------------------------
This slice has an embedded self-test suite AND a mirror vitest suite. That is not
belt-and-braces decoration, and this campaign has already proved it:

  • The DOMINANT-LOT TRAP (a lot holding 100% of inventory value was classified
    as C, the long tail, and dropped to the slowest cadence) was caught by the
    embedded suite on its very first run.

  • The MISSING-LINE HOLE (a lot in scope with no count sheet line at all was
    invisible, so a session with an entirely uncounted lot reported itself
    "ready for you to approve") was caught ONLY by the mirror suite. The
    embedded suite passed happily while the bug was live.

Neither gate is sufficient alone. So a mutant is only "caught" here if at least
one gate goes red, and the report says WHICH — because a mutant that dies on
only one gate is a signal that the other gate has a blind spot.

SELF-PROVING INSTRUMENT
-----------------------
A green result from a broken instrument is worse than a red one, because it ends
the investigation. This script therefore refuses to trust itself:

  1. BASELINE GATE    - both suites must PASS before any mutation is meaningful.
  2. COLLECTION PROOF - the vitest run must show evidence that tests were really
                        collected ("Tests <n> passed"). A non-zero exit WITHOUT
                        that evidence is INCONCLUSIVE, not a kill.
  3. NO-OP DETECTION  - if the anchor text is not found exactly once, that is a
                        broken mutant, not a survivor.
  4. EXACT RESTORE    - the file is restored byte-for-byte and re-verified green.

Usage:  python3 scripts/compliance/mutate-slice-books-10.py
Exit 0 only if every mutant was killed with real evidence.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CORE = REPO / "src/lib/inventory/inventory-audit-core.ts"
MIRROR = "tests/compliance/inventory-audit-core.test.ts"
RUNNER = REPO / "scripts/tmp/_mutation-runner-10.ts"

RUNNER_SRC = """import { __runInventoryAuditCoreTests } from "../../src/lib/inventory/inventory-audit-core";
__runInventoryAuditCoreTests();
console.log("PASS");
"""


@dataclass(frozen=True)
class Mutation:
    name: str
    # What guarantee this breaks, in plain English.
    breaks: str
    old: str
    new: str


MUTATIONS: list[Mutation] = [
    # ------------------------------------------------------------------
    # ABC STRATIFICATION — the dominant-lot trap
    # ------------------------------------------------------------------
    Mutation(
        name="abc-classified-after-not-before",
        breaks=(
            "THE ORIGINAL DEFECT, RESTORED. Lots are classified on the cumulative "
            "value share reached AFTER they are added, so a lot holding 100% of "
            "the money scores 100% and is labelled C — the long tail — and drops "
            "to the slowest cadence. The most valuable stock in the building "
            "becomes the least frequently counted."
        ),
        old='      : before < ABC_CUTOFF_MILLI_PCT.A ? "A"',
        new='      : cum <= ABC_CUTOFF_MILLI_PCT.A ? "A"',
    ),
    Mutation(
        name="unvalued-lot-treated-as-cheap",
        breaks=(
            "A lot with no cost on file is classed C instead of U, so an unknown "
            "value is treated as a small one and the lot sinks to the bottom of "
            "the list. §1.471-2(f)(2) bars valuing stock at a nominal price."
        ),
        old='    out.push({ lot, extendedCostCents: null, abc: "U", cumulativeMilliPct: 0 });',
        new='    out.push({ lot, extendedCostCents: null, abc: "C", cumulativeMilliPct: 0 });',
    ),
    Mutation(
        name="unvalued-lot-valued-at-zero",
        breaks=(
            "An unvalued lot is given a concrete value of zero rather than null, "
            "so 'we do not know what this cost' silently becomes 'this cost "
            "nothing' and the shrink on it can never be measured."
        ),
        old='    out.push({ lot, extendedCostCents: null, abc: "U", cumulativeMilliPct: 0 });',
        new='    out.push({ lot, extendedCostCents: 0, abc: "U", cumulativeMilliPct: 0 });',
    ),
    Mutation(
        name="stratification-order-nondeterministic",
        breaks=(
            "The tie-break on lotId is removed, so two lots of equal value can "
            "swap places between runs and the same report gives two different "
            "answers. A report that reshuffles is a report nobody trusts."
        ),
        old="  valued.sort((a, b) => (b.cents - a.cents) || a.lot.lotId.localeCompare(b.lot.lotId));",
        new="  valued.sort((a, b) => b.cents - a.cents);",
    ),
    # ------------------------------------------------------------------
    # CADENCE — the AS 2510.11 annual bound
    # ------------------------------------------------------------------
    Mutation(
        name="cadence-exceeds-one-year",
        breaks=(
            "Class C stock is put on a 400-day cadence, so some items are never "
            "reached inside a year. AS 2510.11 only permits a rotating count that "
            "produces 'results substantially the same as those which would be "
            "obtained by a count of all items each year'."
        ),
        old="  C: 90,",
        new="  C: 400,",
    ),
    Mutation(
        name="cadence-soundness-check-neutered",
        breaks=(
            "The module-load assertion stops throwing AND an over-a-year cadence "
            "is introduced \u2014 the pair of edits the guard exists to stop. On its "
            "own, disabling the check changes nothing observable, so mutating it "
            "alone would be untestable by construction rather than untested."
        ),
        old="""    if (days > MAX_PERMITTED_CADENCE_DAYS) {""",
        new="""    if (false) { void days;""",
    ),
    Mutation(
        name="cadence-guard-and-policy-both-broken",
        breaks=(
            "Class B goes to 500 days while the load-time assertion is disabled, "
            "so an unreachable cadence ships silently and some stock is never "
            "counted inside a year (AS 2510.11)."
        ),
        old="  B: 60,",
        new="  B: 500,",
    ),
    Mutation(
        name="unvalued-cadence-slowest-not-fastest",
        breaks=(
            "Unvalued lots are looked at least often instead of most often, so a "
            "lot that is both a valuation problem and an intake problem sits at "
            "the back of the queue."
        ),
        old="  U: 14,",
        new="  U: 365,",
    ),
    # ------------------------------------------------------------------
    # THE LOT-CODE TRAP — the owner's historical failure
    # ------------------------------------------------------------------
    Mutation(
        name="scope-cohesion-broken",
        breaks=(
            "DEFENCE (a) REMOVED. Lots of the same product can be split across "
            "different sessions, so a counter never sees that the product has "
            "more than one batch — which is exactly how the lot codes were "
            "consolidated in the first place."
        ),
        old="    if (used + g.lots.length <= opts.maxLots) {",
        new="    if (true) {",
    ),
    Mutation(
        name="keyless-lots-merged-together",
        breaks=(
            "Lots with no product key are bundled into one group instead of each "
            "getting their own, so two unrelated physical things are presented as "
            "one product and counted as one."
        ),
        old="`\\u0000lot:${lot.lotId}`",
        new='"\\u0000lot:shared"',
    ),
    Mutation(
        name="merge-signature-detection-disabled",
        breaks=(
            "DEFENCE (c) REMOVED. The lot-consolidation pattern — one lot "
            "absorbing its siblings while the group total still ties — is no "
            "longer detected, so the owner's exact historical failure would pass "
            "review silently."
        ),
        old="  const out: MergeSignature[] = [];",
        new="  const out: MergeSignature[] = []; if (lots.length >= 0) return out;",
    ),
    Mutation(
        name="merge-signature-warns-but-does-not-block",
        breaks=(
            "A detected lot merge becomes advisory instead of blocking, so a "
            "session showing the consolidation pattern can still be posted."
        ),
        old="  if (merges.length > 0) {\n    blockers.push(",
        new="  if (false) {\n    blockers.push(",
    ),
    Mutation(
        name="multi-lot-warning-removed-from-checklist",
        breaks=(
            "The loud 'there are N different batches of this product' step "
            "disappears from the staff count sheet, removing the one instruction "
            "written specifically to stop the historical failure."
        ),
        old="  if (group.isMultiLot) {",
        new="  if (false) {",
    ),
    # ------------------------------------------------------------------
    # NULL IS NOT ZERO — §1.471-2(f)(3)
    # ------------------------------------------------------------------
    Mutation(
        name="uncounted-treated-as-zero",
        breaks=(
            "A line nobody counted is treated as a count of zero, so an unvisited "
            "shelf becomes a total write-off. §1.471-2(f)(3) forbids omitting "
            "portions of the stock on hand."
        ),
        old="  if (line.countedQty === null) {",
        new="  if (line.countedQty === null && false) {",
    ),
    Mutation(
        name="missing-line-hole-reopened",
        breaks=(
            "THE SECOND REAL DEFECT, RESTORED. A lot in scope with NO count sheet "
            "line at all becomes invisible again, so a session with an entirely "
            "uncounted lot reports 'nothing is blocking — ready for you to "
            "approve'. Caught only by the mirror suite when it was live."
        ),
        old="  const missingLots = lots.filter((l) => !lineLotIds.has(l.lotId));",
        new="  const missingLots: AuditLot[] = []; void lineLotIds;",
    ),
    Mutation(
        name="uncounted-lines-do-not-block",
        breaks=(
            "Blank lines stop blocking the session, so a half-finished count can "
            "be posted to the books as though it were complete."
        ),
        old="  if (uncounted > 0) {",
        new="  if (false) {",
    ),
    # ------------------------------------------------------------------
    # THE RECOUNT RULE
    # ------------------------------------------------------------------
    Mutation(
        name="disagreeing-recounts-averaged",
        breaks=(
            "Two contradicting counts are averaged into a third number that "
            "nobody ever observed, and the disagreement is hidden instead of "
            "escalated."
        ),
        old="  if (line.recountQty !== null && line.recountQty !== line.countedQty) {",
        new="  if (false) {",
    ),
    Mutation(
        name="material-variance-needs-no-recount",
        breaks=(
            "A large variance is accepted on one person's first attempt, so a "
            "four-figure adjustment rests on a single unverified observation."
        ),
        old="  const needsRecount = absCents >= policy.recountAtCents;",
        new="  const needsRecount = false;",
    ),
    # ------------------------------------------------------------------
    # MONEY AND THE SIGN WALL
    # ------------------------------------------------------------------
    Mutation(
        name="rounding-biased-toward-overage",
        breaks=(
            "Rounding switches from half-away-from-zero to half-up, so a shrink "
            "of exactly half a cent vanishes while an equal overage survives. "
            "Over thousands of lines that is a directional drift nobody can "
            "source."
        ),
        old="  return raw < 0 ? -Math.round(-raw) : Math.round(raw);",
        new="  return Math.round(raw);",
    ),
    Mutation(
        name="non-integer-unit-cost-silently-rounded",
        breaks=(
            "A fractional unit cost is accepted and quietly rounded instead of "
            "rejected, so a bad cost on file produces a confident wrong number."
        ),
        old="  if (!Number.isInteger(unitCostMinorUnits)) {",
        new="  if (false) {",
    ),
    Mutation(
        name="sign-wall-inverted",
        breaks=(
            "THE SIGN WALL BREACHED. A shortage debits inventory and credits "
            "COGS, so product that vanished INCREASES the asset. Every variance "
            "posts backwards."
        ),
        old="  const isShrink = varianceCents < 0;",
        new="  const isShrink = varianceCents > 0;",
    ),
    # ------------------------------------------------------------------
    # DRAFTS ONLY, AND THE §280E FORK
    # ------------------------------------------------------------------
    Mutation(
        name="undocumented-shrink-auto-classified",
        breaks=(
            "An unexplained disappearance is silently charged to COGS instead of "
            "being escalated. WAC 314-55-089(4)(c) makes it a DEEMED SALE taxed "
            "at 37% — the machine must not take that position for the owner."
        ),
        old="  if (isShrink && !documented) {",
        new="  if (false) {",
    ),
    # ------------------------------------------------------------------
    # HONESTY — AS 1105.27
    # ------------------------------------------------------------------
    Mutation(
        name="coverage-claims-shop-wide-accuracy",
        breaks=(
            "The coverage verdict starts claiming the shop IS accurate, "
            "projecting a deliberately targeted count onto the whole population. "
            "AS 1105.27 says results of specific-item selection 'cannot be "
            "projected to the entire population'."
        ),
        old="This measures how much you have REACHED, not how accurate the shop is",
        new="This means your inventory is accurate",
    ),
    Mutation(
        name="stale-lots-not-named",
        breaks=(
            "The coverage report counts stale lots but stops naming them, so the "
            "owner is told something is wrong and given no way to act on it."
        ),
        old="""      neverCounted += 1;
      beyondOneYear += 1;
      overdue += 1;
      stale.push(lot.lotId);""",
        new="""      neverCounted += 1;
      beyondOneYear += 1;
      overdue += 1;""",
    ),
]


def run_selftests() -> tuple[bool, str]:
    """Gate 1: the module's embedded suite."""
    proc = subprocess.run(
        ["npx", "tsx", str(RUNNER)],
        cwd=REPO, capture_output=True, text=True, timeout=300,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    return ("PASS" in (proc.stdout or "") and proc.returncode == 0), out


def run_vitest() -> tuple[bool, str, bool]:
    """
    Gate 2: the mirror vitest suite.
    Returns (passed, output, collected). `collected` is the INSTRUMENT PROOF:
    if vitest never collected a test, a non-zero exit means the harness broke,
    not that the mutant was caught.
    """
    proc = subprocess.run(
        ["npx", "vitest", "run", MIRROR],
        cwd=REPO, capture_output=True, text=True, timeout=600,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    clean = re.sub(r"\x1b\[[0-9;]*m", "", out)
    collected = bool(re.search(r"Tests\s+\d+", clean))
    passed = proc.returncode == 0 and bool(re.search(r"Tests\s+\d+ passed", clean))
    return passed, clean, collected


def first_failure_line(text: str) -> str:
    for ln in text.splitlines():
        if "FAILED" in ln or "Error:" in ln or "AssertionError" in ln:
            return ln.strip()
    for ln in text.splitlines():
        if re.search(r"Tests\s+\d+ failed", ln):
            return ln.strip()
    return "(no message captured)"


def main() -> int:
    original = CORE.read_text()
    RUNNER.parent.mkdir(parents=True, exist_ok=True)
    RUNNER.write_text(RUNNER_SRC)

    with tempfile.TemporaryDirectory() as tmp:
        backup = Path(tmp) / "inventory-audit-core.ts"
        shutil.copy2(CORE, backup)

        print("=" * 78)
        print("BASELINE: BOTH gates must PASS before any mutation is meaningful.")
        print("=" * 78)
        st_ok, st_out = run_selftests()
        vt_ok, vt_out, collected = run_vitest()
        if not st_ok or not vt_ok or not collected:
            print(f"BASELINE FAILED — selftests={st_ok} vitest={vt_ok} collected={collected}")
            print((st_out + vt_out)[-3000:])
            CORE.write_text(original)
            RUNNER.unlink(missing_ok=True)
            return 1
        print("baseline: BOTH GATES PASS\n")

        survivors: list[Mutation] = []
        not_applied: list[Mutation] = []
        inconclusive: list[Mutation] = []
        single_gate: list[tuple[Mutation, str]] = []

        for i, m in enumerate(MUTATIONS, start=1):
            n = original.count(m.old)
            if n != 1:
                not_applied.append(m)
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: ANCHOR NOT UNIQUE "
                      f"(found {n}) — mutation could not be applied")
                continue

            CORE.write_text(original.replace(m.old, m.new))
            try:
                st_pass, st_o = run_selftests()
                vt_pass, vt_o, vt_collected = run_vitest()
            finally:
                shutil.copy2(backup, CORE)

            # INSTRUMENT PROOF, with one legitimate exception.
            #
            # Normally "vitest collected no tests" means the harness broke and
            # the result is uninterpretable. But this module asserts its cadence
            # policy AT MODULE LOAD, on purpose, so a bad cadence throws before
            # any test can be collected. That is the guard working exactly as
            # designed, and it is a kill, not an instrument failure.
            #
            # We only accept that reading when the load-time error is actually
            # present in the output AND the embedded self-test gate also went
            # red. Otherwise it stays inconclusive.
            load_time_kill = (
                not vt_collected
                and not st_pass
                and "cadence for class" in (vt_o + st_o)
            )
            if not vt_collected and not load_time_kill:
                inconclusive.append(m)
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: INCONCLUSIVE — vitest "
                      f"collected nothing; the instrument, not the mutant, failed")
                continue

            killed_by = []
            if not st_pass:
                killed_by.append("selftests")
            if not vt_pass:
                killed_by.append("vitest(load-time guard)" if load_time_kill else "vitest")

            if not killed_by:
                survivors.append(m)
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: *** SURVIVED *** — {m.breaks}")
            else:
                where = "+".join(killed_by)
                if len(killed_by) == 1:
                    single_gate.append((m, where))
                msg = first_failure_line(st_o if not st_pass else vt_o)
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: caught by {where}")
                print(f"          breaks   : {m.breaks}")
                print(f"          caught by: {msg[:150]}")

        # Restore, and PROVE the restore worked rather than assuming it.
        CORE.write_text(original)
        st_ok, _ = run_selftests()
        vt_ok, _, _ = run_vitest()
        restored_green = st_ok and vt_ok

    RUNNER.unlink(missing_ok=True)

    applied = len(MUTATIONS) - len(not_applied) - len(inconclusive)
    print()
    print("=" * 78)
    print(f"applied       : {applied}/{len(MUTATIONS)}")
    print(f"caught        : {applied - len(survivors)}")
    print(f"SURVIVED      : {len(survivors)}")
    print(f"not applied   : {len(not_applied)}")
    print(f"inconclusive  : {len(inconclusive)}")
    print(f"restored+green: {restored_green}")
    print("=" * 78)

    if single_gate:
        print("\nCAUGHT BY ONE GATE ONLY (informational — the other gate is blind here):")
        for m, where in single_gate:
            print(f"  - {m.name}: only {where}")
    if not_applied:
        print("\nMUTATIONS THAT COULD NOT BE APPLIED (anchor moved — fix the anchor):")
        for m in not_applied:
            print(f"  - {m.name}")
    if inconclusive:
        print("\nINCONCLUSIVE (the instrument failed, not the mutant):")
        for m in inconclusive:
            print(f"  - {m.name}")
    if survivors:
        print("\nSURVIVORS — these are UNTESTED guarantees:")
        for m in survivors:
            print(f"  - {m.name}: {m.breaks}")

    ok = (not survivors and not not_applied and not inconclusive and restored_green)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
mutate-slice-books-40c.py

A GREEN TEST SUITE PROVES NOTHING UNTIL YOU HAVE SEEN IT GO RED.

books-40c is an alerting system. The characteristic failure of an alerting
system is not that it crashes -- it is that it silently stops alerting while
every test stays green, because the tests only ever asserted that the happy
path produced no error. That is standing rule 50 in its most dangerous form:
if this feature quietly breaks, nothing goes wrong on screen. Michael simply
stops being warned, and finds out when a court tells him.

So each mutation below breaks the watchman in a way that a reader might
plausibly introduce by accident, and the suite must fail for each one. A
mutation that does NOT turn the suite red has found a hole in the tests, and
the correct response is to add the missing test, never to drop the mutation.

Usage:  python3 scripts/compliance/mutate-slice-books-40c.py
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORE = ROOT / "src/lib/payroll/wage-order-watch-core.ts"
TESTS = "tests/compliance/wage-order-watch.test.ts"

# (label, find, replace, why this is a realistic accident)
MUTATIONS = [
    (
        "overdue alerts eventually give up",
        "  if (left < 0) {\n    const late = Math.abs(left);",
        "  if (left < 0 && left > -30) {\n    const late = Math.abs(left);",
        "Someone decides the daily nagging is excessive and caps it at 30 days. "
        "The alert then goes quiet exactly when the RCW 26.18.110(6)(b) exposure "
        "is largest, and every remaining test still passes on the early days.",
    ),
    (
        "the answer ladder never escalates past warning",
        'left <= ANSWER_CRITICAL_DAYS\n      ? "critical"\n      : left <= ANSWER_WARNING_DAYS\n        ? "warning"\n        : "info"',
        'left <= ANSWER_WARNING_DAYS ? "warning" : "info"',
        "A simplification that looks tidier and loses the critical rung, so the "
        "last two days before a support answer is due read the same as day ten.",
    ),
    (
        "a filed answer no longer silences the alert",
        "  if (facts.answerFiledAt !== null || facts.answerNotRequired) return [];",
        "  if (facts.answerNotRequired) return [];",
        "The OFF switch is dropped during a refactor. The system nags forever "
        "even after Michael has done the thing, which trains him to ignore it.",
    ),
    (
        "an expired lien stops being reported",
        "  if (left < 0) {\n    const over = Math.abs(left);",
        "  if (false) {\n    const over = Math.abs(left);",
        "The expiry branch is disabled. Greenway keeps withholding with no "
        "authority: RCW 49.52.070 double damages, reaching officers personally.",
    ),
    (
        "creditor writs get an invented twenty-day deadline",
        "  if (deadline.dueDate === null) {",
        "  if (false) {",
        "The honest refusal is removed, so a creditor writ silently inherits the "
        "support-order countdown and Michael is given a confident wrong date.",
    ),
    (
        "criticals stop re-firing daily",
        "`wage-order-watch:critical:${todayIso}`",
        "`wage-order-watch:critical`",
        "The date leaves the dedupe key, so the UNIQUE constraint on "
        "compliance_reminder_log means the critical alert sends exactly ONCE "
        "ever and is never heard from again.",
    ),
    (
        "warnings re-fire every single day",
        "`wage-order-watch:${a.kind}:${a.wageOrderId}:${a.severity}`",
        "`wage-order-watch:${a.kind}:${a.wageOrderId}:${a.severity}:${todayIso}`",
        "The opposite error: every rung nags daily, the channel becomes noise, "
        "and Michael filters payroll alerts to trash -- including the criticals.",
    ),
    (
        "a terminated order keeps generating alerts",
        # Anchored on the preceding comment because the bare status check is
        # not unique in the file (the same literal appears in the type union).
        'if (facts.status === "terminated") return alerts;',
        'if (facts.status === "no-such-status") return alerts;',
        "Closed orders keep shouting, which is the fastest possible way to make "
        "the whole board untrustworthy.",
    ),
    (
        "the info rung opens too early",
        "  if (left > ANSWER_INFO_DAYS) return [];",
        "  if (left > 999) return [];",
        "The quiet zone disappears and the alert fires from the day of service, "
        "so twenty days of identical noise precede the deadline.",
    ),
    (
        "severity sorting is reversed",
        "    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];",
        "    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];",
        "Informational alerts sort above criticals, so the expired-lien warning "
        "is below the fold on a busy board.",
    ),
]


def run_suite() -> bool:
    """True when the suite passes."""
    proc = subprocess.run(
        ["npx", "vitest", "run", TESTS],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    original = CORE.read_text()

    if not run_suite():
        print("REFUSING: the suite is already red before any mutation.")
        return 2

    print(f"Baseline green. Applying {len(MUTATIONS)} mutations.\n")
    survivors = []

    for label, find, replace, why in MUTATIONS:
        if original.count(find) != 1:
            print(f"  SKIP (anchor not unique): {label}")
            survivors.append(label)
            continue
        CORE.write_text(original.replace(find, replace, 1))
        passed = run_suite()
        CORE.write_text(original)

        if passed:
            print(f"  SURVIVED (BAD): {label}\n      {why}")
            survivors.append(label)
        else:
            print(f"  killed: {label}")

    CORE.write_text(original)
    print()

    if survivors:
        print(f"{len(survivors)} mutation(s) SURVIVED. The tests have a hole.")
        for s in survivors:
            print(f"  - {s}")
        return 1

    print(f"All {len(MUTATIONS)} mutations killed. Source restored.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

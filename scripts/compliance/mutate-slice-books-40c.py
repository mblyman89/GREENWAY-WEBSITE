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

TWO FAMILIES OF MUTATION LIVE HERE.

  Part 1 - THE ARITHMETIC. Break the pure watch core and prove the behaviour
  tests notice. These were added when the core was written.

  Part 2 - THE WIRING. Break the connections BETWEEN files -- unplug the cron,
  unplug the button, stop selecting a column, add a snooze -- and prove the
  readFileSync gates in `wage-order-watch-mentor-gates.ts` notice. This is the
  part that matters most, because every one of these mutations leaves a
  perfectly compiling, perfectly typechecking application in which the feature
  does nothing at all. That exact failure has now happened twice in this repo
  (books-38's unselected `served_date`, books-40b's unreachable buttons), so
  the gates that detect it are themselves proved here rather than trusted.

Usage:  python3 scripts/compliance/mutate-slice-books-40c.py
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

# Every file a mutation is allowed to touch, by short name.
FILES = {
    "core": ROOT / "src/lib/payroll/wage-order-watch-core.ts",
    "lifecycle": ROOT / "src/lib/payroll/wage-order-lifecycle-core.ts",
    "engine": ROOT / "src/lib/notifications/compliance-reminders.ts",
    "board": ROOT / "src/lib/payroll/garnishment-store.ts",
    "action": ROOT / "src/app/admin/books/garnishments/actions.ts",
    "control": ROOT / "src/components/admin/books/WageOrderAnswerControl.tsx",
    "workbench": ROOT / "src/components/admin/books/GarnishmentWorkbench.tsx",
    "mentor": ROOT / "src/lib/payroll/wage-order-watch-mentor.ts",
    "page": ROOT / "src/app/admin/books/garnishments/page.tsx",
}

# Both suites run for every mutation. A wiring gate lives in the answer-record
# suite; the arithmetic lives in the watch suite. Running both means a mutation
# is killed by whichever suite is actually watching that seam, and neither
# suite gets to assume the other is doing the work.
SUITES = [
    "tests/compliance/wage-order-watch.test.ts",
    "tests/compliance/wage-order-answer-record.test.ts",
]

# (target file key, label, find, replace, why this is a realistic accident)
MUTATIONS = [
    # ------------------------------------------------------------------
    # PART 1 - THE ARITHMETIC
    # ------------------------------------------------------------------
    (
        "core",
        "overdue alerts eventually give up",
        "  if (left < 0) {\n    const late = Math.abs(left);",
        "  if (left < 0 && left > -30) {\n    const late = Math.abs(left);",
        "Someone decides the daily nagging is excessive and caps it at 30 days. "
        "The alert then goes quiet exactly when the RCW 26.18.110(6)(b) exposure "
        "is largest, and every remaining test still passes on the early days.",
    ),
    (
        "core",
        "the answer ladder never escalates past warning",
        'left <= ANSWER_CRITICAL_DAYS\n      ? "critical"\n      : left <= ANSWER_WARNING_DAYS\n        ? "warning"\n        : "info"',
        'left <= ANSWER_WARNING_DAYS ? "warning" : "info"',
        "A simplification that looks tidier and loses the critical rung, so the "
        "last two days before a support answer is due read the same as day ten.",
    ),
    (
        "core",
        "a filed answer no longer silences the alert",
        "  if (facts.answerFiledAt !== null || facts.answerNotRequired) return [];",
        "  if (facts.answerNotRequired) return [];",
        "The OFF switch is dropped during a refactor. The system nags forever "
        "even after Michael has done the thing, which trains him to ignore it.",
    ),
    (
        "core",
        "an expired lien stops being reported",
        "  if (left < 0) {\n    const over = Math.abs(left);",
        "  if (false) {\n    const over = Math.abs(left);",
        "The expiry branch is disabled. Greenway keeps withholding with no "
        "authority: RCW 49.52.070 double damages, reaching officers personally.",
    ),
    (
        "core",
        "creditor writs get an invented twenty-day deadline",
        "  if (deadline.dueDate === null) {",
        "  if (false) {",
        "The honest refusal is removed, so a creditor writ silently inherits the "
        "support-order countdown and Michael is given a confident wrong date.",
    ),
    (
        "core",
        "criticals stop re-firing daily",
        "`wage-order-watch:critical:${todayIso}`",
        "`wage-order-watch:critical`",
        "The date leaves the dedupe key, so the UNIQUE constraint on "
        "compliance_reminder_log suppresses every critical after the first.",
    ),
    (
        "core",
        "severity sorting is reversed",
        "    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];",
        "    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];",
        "Informational alerts sort above criticals, so the expired-lien warning "
        "is below the fold on a busy board.",
    ),
    # ------------------------------------------------------------------
    # PART 2 - THE WIRING
    #
    # None of these break a calculation. Every one of them leaves the app
    # compiling and the screen looking finished.
    # ------------------------------------------------------------------
    (
        "engine",
        "the cron stops calling the wage order planner",
        "    for (const r of planWageOrderReminders(todayIso, snap.orders)) {",
        "    for (const r of [] as ReturnType<typeof planWageOrderReminders>) {",
        "The planner import survives, so no linter complains and nothing fails "
        "to build -- but no wage order email or push is ever sent again. This "
        "is the single most dangerous edit in the slice, because the ONLY "
        "symptom is silence, and silence is what a compliant month looks like.",
    ),
    (
        "board",
        "the reader stops selecting answer_filed_at",
        '"served_date, answer_filed_at, answer_not_required",',
        '"served_date, answer_not_required",',
        "Exactly the books-38 defect repeated: a column the feature depends on "
        "is dropped from the select. Here the result is worse than a blank "
        "screen -- the watchman would nag daily about answers already filed.",
    ),
    (
        "board",
        "the board derives its own idea of overdue",
        "  for (const d of details) alerts.push(...assessWageOrder(d.watch, todayIso));",
        "  for (const d of details) alerts.push(...[]);",
        "The board quietly stops assessing while the cron keeps assessing. A "
        "board that says everything is fine and an email that says overdue "
        "arrive on the same desk on the same morning, and the board wins "
        "because it is the thing being looked at.",
    ),
    (
        "board",
        "the board stops stamping the date it measured from",
        "    asOf: todayIso,",
        '    asOf: new Date().toISOString().slice(0, 10),',
        "Removing the server's PACIFIC date. Note what this mutation is NOT: an "
        "earlier attempt here wrote `asOf: todayIso as string | undefined as "
        "string`, which is a pure type-level cast. It compiles differently and "
        "runs identically, so no test could ever kill it - a textbook "
        "EQUIVALENT MUTANT, and the correct response was to replace it rather "
        "than to weaken a gate chasing it. This version changes behaviour: UTC "
        "is up to eight hours ahead of Port Orchard, so from 4pm Pacific the "
        "board would date-stamp tomorrow and the answer form would accept a "
        "date the server then refuses as post-dated.",
    ),
    (
        "action",
        "the record-answer server action is orphaned",
        "  const result = await recordWageOrderAnswer({",
        "  const result = await (async () => ({ ok: false as const, code: \"REFUSED\" as const, message: \"x\" }))(); void (async () => recordWageOrderAnswer)(); void (async () => ({",
        "The action stops reaching the write store. The button still exists, "
        "still spins, still reports something -- and the answer is never "
        "recorded, so the daily critical alarm can never be switched off.",
    ),
    (
        "workbench",
        "the answer control is removed from the card",
        "<WageOrderAnswerControl",
        "<UnusedWageOrderAnswerControl",
        "A merge conflict resolution drops the control. The alerts still shout "
        "and there is now no way to satisfy them anywhere in the product.",
    ),
    (
        "workbench",
        "the alert strip stops rendering",
        "alerts.length > 0",
        "false && alerts.length > 0",
        "The passive surface goes blank. Michael only ever finds out about a "
        "deadline by email, so a spam filter becomes a single point of failure.",
    ),
    (
        "control",
        "the form stops asking the core whether the draft is legal",
        "validateAnswerRecord(",
        "notValidateAnswerRecord(",
        "The client-side check is bypassed, so the form no longer refuses and "
        "no longer explains. The server still refuses, but the reader now "
        "meets a bare error after typing instead of guidance before it.",
    ),
    (
        "control",
        "a snooze button appears on the answer flow",
        "  const [busy, setBusy] = useState(false);",
        "  const [busy, setBusy] = useState(false);\n  const [snoozeUntil, setSnoozeUntil] = useState<string | null>(null);\n  void snoozeUntil;\n  void setSnoozeUntil;",
        "The most tempting feature request in the slice, and the one that "
        "destroys it. Dismissing records that Michael SAW a message. Only "
        "filing records that the duty was DISCHARGED, and only the second is "
        "a defence under RCW 26.18.110(6). A snooze looks like relief and is "
        "actually the removal of the only evidence that helps.",
    ),
    (
        "lifecycle",
        "a support order becomes waivable",
        'export const ANSWER_NEVER_WAIVABLE_KINDS: readonly string[] = [\n  "child_support",\n  "spousal_support",\n];',
        "export const ANSWER_NEVER_WAIVABLE_KINDS: readonly string[] = [];",
        "The one refusal that cannot be argued with is softened. Ticking "
        "'no answer required' on a child support order and typing any five "
        "characters would then silence an alarm protecting against liability "
        "for the entire support debt under RCW 26.18.110(6)(b).",
    ),
    (
        "lifecycle",
        "a post-dated answer is accepted",
        "  if (ANSWER_ISO_RE.test(today) && filedAt > today) {",
        "  if (false) {",
        "Recording an intention as a fact. The alarm switches off today for "
        "something planned for next week, and next week it is forgotten "
        "because the system already says it is done.",
    ),
    (
        "lifecycle",
        "the waiver reason floor drops to nothing",
        "const MIN_ANSWER_WAIVER_REASON_CHARS = 5;",
        "const MIN_ANSWER_WAIVER_REASON_CHARS = 0;",
        "The core and the database CHECK constraint drift apart. The form "
        "accepts an empty reason, the server accepts it, and Postgres rejects "
        "the write with a constraint name -- the worst possible error surface.",
    ),
    (
        "mentor",
        "the escalation ladder hard-codes its numbers",
        "    when: `${ANSWER_INFO_DAYS} days before the deadline`,",
        '    when: "7 days before the deadline",',
        "The documentation stops tracking the code. Michael reads that he gets "
        "ten days of warning, the system gives him a different number, and the "
        "teaching becomes a confident lie -- which is worse than no teaching.",
    ),
    (
        "page",
        "the page stops handing the action down",
        "          onRecordAnswer={recordWageOrderAnswerAction}",
        "          onRecordAnswer={async () => ({ ok: false as const, code: \"REFUSED\" as const, message: \"x\" })}",
        "The topmost hop of the chain is cut. Every file below still contains "
        "every symbol, so a gate that merely counts names sees nothing wrong.",
    ),
    (
        "workbench",
        "the workbench swallows the callback",
        "                      onRecord={onRecordAnswer}",
        "                      onRecord={async () => ({ ok: false as const, code: \"REFUSED\" as const, message: \"x\" })}",
        "The middle hop is cut. The control renders, the form submits, the "
        "spinner spins, and the server is never called.",
    ),
    (
        "control",
        "the form defaults to the browser clock when the server date is missing",
        "  today,",
        "  today = new Date().toISOString().slice(0, 10),",
        "This is the mutation that looks like GOOD code. A default for a prop "
        "that might be undefined reads as care. It silently reintroduces the "
        "laptop clock as the judge of what 'in the future' means, so a machine "
        "a day fast accepts what the server will refuse.",
    ),
    (
        "mentor",
        "an alert kind loses its lesson",
        "export const WATCH_ALERT_LESSONS",
        "const UNUSED_WATCH_ALERT_LESSONS",
        "A kind ships with no explanation, so an alert appears on the board "
        "with nothing telling Michael what it means or what to do about it "
        "(standing rules 26 and 64a).",
    ),
]


def run_suites() -> bool:
    """True when EVERY suite passes."""
    proc = subprocess.run(
        ["npx", "vitest", "run", *SUITES],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    originals = {key: path.read_text() for key, path in FILES.items()}

    def restore_all() -> None:
        for key, path in FILES.items():
            path.write_text(originals[key])

    if not run_suites():
        print("REFUSING: the suites are already red before any mutation.")
        return 2

    print(f"Baseline green ({len(SUITES)} suites). Applying {len(MUTATIONS)} mutations.\n")
    survivors = []

    for key, label, find, replace, why in MUTATIONS:
        path = FILES[key]
        original = originals[key]

        # A non-unique or missing anchor means the mutation silently did
        # nothing, which would then be scored as "killed" by a suite that in
        # fact never saw a change. Treat it as a survivor and fix the anchor.
        count = original.count(find)
        if count != 1:
            print(f"  SKIP (anchor appears {count}x in {key}): {label}")
            survivors.append(label)
            continue

        path.write_text(original.replace(find, replace, 1))
        passed = run_suites()
        path.write_text(original)

        if passed:
            print(f"  SURVIVED (BAD) [{key}]: {label}\n      {why}")
            survivors.append(label)
        else:
            print(f"  killed [{key}]: {label}")

    restore_all()
    print()

    if survivors:
        print(f"{len(survivors)} mutation(s) SURVIVED. The tests have a hole.")
        for s in survivors:
            print(f"  - {s}")
        return 1

    print(f"All {len(MUTATIONS)} mutations killed. Sources restored.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""ROUND L-24 — MUTATION TESTING for Slice 8 (Online Orders report) and the
staff alert (standing offer 2).

"Test it, test the tests."

Both suites went green on their first run. That is not evidence; it is the
most common symptom of tests that assert nothing load-bearing. This script
breaks the two cores in the ways a real developer plausibly would — a rate
that returns 0 instead of null, a funnel comparison flipped, a stage guard
dropped, an OR that should be an AND — and checks the suites actually fail
each time. A mutant that SURVIVES is a hole in the tests.

The mutants are not arbitrary. Each one is a defect that would ship a report
which LOOKS fine and is wrong, which is the dangerous kind here: the owner has
no intuition for what "83% acknowledged on time" should feel like, so a
plausible-but-wrong number is simply believed.

RULE 137: every anchor is verified to match EXACTLY ONCE before any mutation
runs. An anchor matching zero times mutates nothing and reports a false
"killed"; an anchor matching twice changes more than intended.

RULE 13c: a CONTROL mutant is included that changes only a comment. It MUST
SURVIVE. If the control dies, the harness is reporting failures unrelated to
the mutation and every other result in the run is meaningless.

Every mutation is reverted in a `finally`, so an interrupt cannot leave a
mutant in the tree, and an md5 check at the end proves every file came back
byte-identical.
"""
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

REPORT = "src/lib/leafly/online-orders-report-core.ts"
ALERT = "src/lib/leafly/staff-alert-core.ts"

SUITES = [
    "tests/compliance/leafly-online-orders-report.test.ts",
    "tests/compliance/leafly-staff-alert.test.ts",
]

# (label, file, find, replace, why it matters)
MUTANTS: list[tuple[str, str, str, str, str]] = [
    # ---- THE NULL-VS-ZERO RULE. The single most important behaviour in the
    # ---- report: "0% on time" and "no orders yet" are opposite facts. ------
    (
        "safeRate returns 0 instead of null on an empty denominator",
        REPORT,
        "  if (denominator <= 0) return null;",
        "  if (denominator <= 0) return 0;",
        "Renders a quiet week with zero orders as '0% acknowledged on time' — "
        "a five-alarm number for a week in which nothing went wrong. The owner "
        "goes hunting a bug that does not exist and stops trusting the tab.",
    ),
    (
        "safeRate stops guarding against a negative denominator",
        REPORT,
        "  if (denominator <= 0) return null;",
        "  if (denominator === 0) return null;",
        "A negative denominator yields a negative percentage on screen.",
    ),
    (
        "safeRate lets NaN through",
        REPORT,
        "  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;",
        "  if (false) return null;",
        "A single NaN renders as 'NaN%' and destroys the reader's confidence "
        "in every other number on the page, including the correct ones.",
    ),
    # ---- THE LIFECYCLE LADDER, which is the customer-notification story. ---
    (
        "cancelled orders become rankable progress",
        REPORT,
        '  "picked_up",\n] as const;\n\nexport type LeaflyLifecycleStatus',
        '  "picked_up",\n  "canceled",\n] as const;\n\nexport type LeaflyLifecycleStatus',
        "Makes a cancelled order count as having progressed past confirmed, "
        "inflating the very funnel this tab exists to report honestly.",
    ),
    (
        "reachedAtLeast becomes strictly greater-than",
        REPORT,
        "  return s >= lifecycleRank(floor);",
        "  return s > lifecycleRank(floor);",
        "An order sitting exactly at `ready` stops counting as having reached "
        "`ready`. Every funnel number silently under-reports by one stop.",
    ),
    (
        "unknown status treated as the first lifecycle stop",
        REPORT,
        "  if (s < 0) return false;",
        "  if (s < 0) return true;",
        "A junk status from an unrecognised payload would count as progress "
        "on every rung of the funnel.",
    ),
    (
        "lifecycleRank stops trimming, so ' ready ' is unknown",
        REPORT,
        "  const i = (LEAFLY_LIFECYCLE_ORDER as readonly string[]).indexOf(status.trim());",
        "  const i = (LEAFLY_LIFECYCLE_ORDER as readonly string[]).indexOf(status);",
        "Whitespace from the wire turns a known status into an unknown one, "
        "and the order vanishes from the funnel with no error anywhere.",
    ),
    # ---- THE 15-MINUTE CLOCK: the headline no sales report can show. -------
    (
        "auto-cancel folded into the generic cancelled bucket",
        REPORT,
        "    if (reason === AUTO_CANCEL_REASON_CODE) autoCanceledOrders += 1;\n    else if (isCanceled) otherCanceledOrders += 1;",
        "    if (isCanceled) otherCanceledOrders += 1;",
        "Orders lost because WE missed the fifteen-minute window become "
        "indistinguishable from a customer changing their mind — which is "
        "exactly the loss this whole tab was built to surface.",
    ),
    (
        "auto-cancel reason code silently changed",
        REPORT,
        'export const AUTO_CANCEL_REASON_CODE = "order_api_unacknowledged";',
        'export const AUTO_CANCEL_REASON_CODE = "unacknowledged";',
        "Leafly's actual code stops matching, so the auto-cancel count reads "
        "zero forever and the headline never fires however many orders are lost.",
    ),
    (
        "headroom measured against a locally computed deadline",
        REPORT,
        "    const headroom = msBetween(r.acknowledgedAt, r.acknowledgeBy);",
        "    const headroom = msBetween(r.acknowledgedAt, r.firstSeenAt);",
        "Migration 0225 is explicit that acknowledge_by is Leafly's OWN "
        "deadline and is 'never computed locally'. Their clock decides whether "
        "a real customer's order is auto-cancelled, so ours must not be used.",
    ),
    (
        "late acknowledgements counted as on time",
        REPORT,
        "      if (headroom >= 0) onTime += 1;\n      else late += 1;",
        "      onTime += 1;",
        "On-time rate pins to 100% no matter how badly the shop is doing. The "
        "one number that would prompt action reads perfect.",
    ),
    (
        "negative elapsed time admitted as a measurement",
        REPORT,
        "    if (elapsed !== null && elapsed >= 0) ackSeconds.push(elapsed / 1000);",
        "    if (elapsed !== null) ackSeconds.push(elapsed / 1000);",
        "A clock-skew row acknowledged 'before' it arrived drags the median "
        "down and hides a genuine slowdown.",
    ),
    # ---- THE STALLED-AT-CONFIRMED NUMBER = the notification gap. -----------
    (
        "stalled count ignores whether the order was acknowledged",
        REPORT,
        '    if (isAcknowledged && r.leaflyStatus === "confirmed" && !isCanceled) {',
        '    if (r.leaflyStatus === "confirmed") {',
        "Counts cancelled and never-acknowledged orders as customers left in "
        "silence, overstating the notification gap and sending the owner after "
        "a problem that is not there.",
    ),
    # ---- MONEY. --------------------------------------------------------------
    (
        "money reverts to binary multiplication",
        REPORT,
        "  const cents = `${whole === \"\" ? \"0\" : whole}${frac.padEnd(2, \"0\").slice(0, 2)}`;",
        "  const cents = String(Math.round(Number(text) * 100));",
        "Math.round(1.005 * 100) is 100, not 101, because 1.005 is really "
        "1.00499999999999989. A cent goes missing on a value a human typed as "
        "exact, and the duplicate drifts away from order-detail-core.",
    ),
    (
        "unreadable money becomes zero instead of null",
        REPORT,
        '  if (whole === "" && frac === "") return null;',
        '  if (whole === "" && frac === "") return 0;',
        "A missing total renders as $0.00 and is added into the gross, so the "
        "day's takings quietly under-report and the average is dragged down.",
    ),
    (
        "average divides by all rows, not the measured ones",
        REPORT,
        "      ordersWithTotal > 0 ? Math.round(grossMinorUnits / ordersWithTotal) : null,",
        "      orders.length > 0 ? Math.round(grossMinorUnits / orders.length) : null,",
        "Every order with an unreadable total silently pulls the average order "
        "value downward.",
    ),
    # ---- DETERMINISM AND PERCENTILES. --------------------------------------
    (
        "breakdown tiebreak removed",
        REPORT,
        "    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));",
        "    .sort((a, b) => b.count - a.count);",
        "Two equal buckets swap places depending on database row order, so the "
        "page appears to flicker between identical loads and looks broken.",
    ),
    (
        "percentile starts interpolating",
        REPORT,
        "  const rank = Math.ceil(clamped * sortedAsc.length);",
        "  const rank = Math.floor(clamped * sortedAsc.length);",
        "Reports a duration that never happened. The owner reads p95 as 'how "
        "bad does it actually get', and must be able to go find that order.",
    ),
    (
        "medianOf sorts the caller's array in place",
        REPORT,
        "  const s = [...values].sort((a, b) => a - b);",
        "  const s = values.sort((a, b) => a - b);",
        "Silently reorders the sample array every other statistic on the page "
        "is computed from — a classic action-at-a-distance reporting bug.",
    ),
    (
        "empty median returns zero rather than null",
        REPORT,
        "  if (!Array.isArray(values) || values.length === 0) return null;",
        "  if (!Array.isArray(values) || values.length === 0) return 0;",
        "'Median time to acknowledge: 0s' on a week with no orders reads as a "
        "perfect score instead of 'no data'.",
    ),
    (
        "formatRate renders null as 0%",
        REPORT,
        '  if (typeof rate !== "number" || !Number.isFinite(rate)) return "—";',
        '  if (typeof rate !== "number" || !Number.isFinite(rate)) return "0%";',
        "The null-vs-zero discipline is undone at the very last step, in the "
        "formatter, where it is least likely to be noticed.",
    ),
    (
        "headline prioritises lateness over lost orders",
        REPORT,
        "  if (report.autoCanceledOrders > 0) {",
        "  if (false) {",
        "Orders lost to the clock cost revenue today and must lead. Burying "
        "them beneath a softer finding is how the expensive problem gets missed.",
    ),
    # ---- THE STAFF ALERT. The owner said plainly: do not email us. ---------
    (
        "alert fires even when everything worked",
        ALERT,
        "  if (reasons.length === 0) {",
        "  if (false) {",
        "Emails the shop on every healthy order. The owner said 'I don't need "
        "an email sent to us' — and an inbox that alerts constantly trains "
        "everyone to ignore the one alert that mattered.",
    ),
    (
        "the arrival stage guard is dropped",
        ALERT,
        '  if (stage === "acceptance" && !bridged) reasons.push("not_bridged");',
        '  if (!bridged) reasons.push("not_bridged");',
        "THE REAL DEFECT THIS GUARD WAS ADDED TO FIX. At arrival the order is "
        "CORRECTLY absent from the register — bridge-core's own test asserts "
        "'arrival does NOT create a local order'. Without the stage check "
        "every single healthy arrival raises an alarm.",
    ),
    (
        "unknown stage defaults to the lenient reading",
        ALERT,
        '  const stage: StaffAlertStage = input.stage === "arrival" ? "arrival" : "acceptance";',
        '  const stage: StaffAlertStage = input.stage === "acceptance" ? "acceptance" : "arrival";',
        "A caller that forgets the stage would silently lose the not_bridged "
        "check. An omitted argument must fail toward the stricter behaviour.",
    ),
    (
        "announced/printed check becomes an OR",
        ALERT,
        "  if (!announced && !printed) reasons.push",
        "  if (!announced || !printed) reasons.push",
        "Alerts when only one of the two channels failed, even though the "
        "other one already told the shop. Noise, by the owner's definition.",
    ),
    (
        "missing provider reported as a healthy silence",
        ALERT,
        "  if (input.providerConfigured === false) {",
        "  if (false) {",
        "'Nothing to report' and 'something to report and no way to report it' "
        "collapse into the same answer — the second is an outage.",
    ),
    (
        "minutesUntilDeadline returns 0 for an unreadable deadline",
        ALERT,
        '  if (typeof acknowledgeBy !== "string") return null;',
        '  if (typeof acknowledgeBy !== "string") return 0;',
        "Zero means 'the deadline is NOW', so every order with a missing "
        "deadline is reported as DEADLINE PASSED. Unknown must never render "
        "as the most alarming possible value.",
    ),
    (
        "staff alert may be sent to the customer's own address",
        ALERT,
        "    if (c !== \"\" && c === r) return false;",
        "    if (false) return false;",
        "Leafly's spec makes them the sole originator of consumer-facing "
        "messages. Mailing an internal operations alert to the shopper is a "
        "contract breach, not a cosmetic slip.",
    ),
    # ---- RULE 13c: THE CONTROL. Comment-only. MUST SURVIVE. ----------------
    (
        "CONTROL (comment only — MUST SURVIVE)",
        REPORT,
        "// The report shape",
        "// The report shape [control]",
        "Changes nothing executable. If this DIES the harness is reporting "
        "noise and every other result in this run is meaningless.",
    ),
]

CONTROL_LABEL = "CONTROL (comment only — MUST SURVIVE)"


def md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def run_suite() -> bool:
    """True when everything PASSES."""
    r = subprocess.run(
        ["npx", "vitest", "run", *SUITES],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return False
    # The pure self-tests live in a separate harness, so a mutation only they
    # catch would otherwise be scored as a survivor.
    r2 = subprocess.run(
        ["npx", "tsx", "scripts/compliance/run-pure-selftests.ts"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return r2.returncode == 0


def main() -> int:
    print("=" * 72)
    print("PREFLIGHT (Rule 137): every anchor must match exactly once")
    print("=" * 72)
    bad = 0
    for label, rel, find, _replace, _why in MUTANTS:
        n = (ROOT / rel).read_text(encoding="utf-8").count(find)
        flag = "ok " if n == 1 else "BAD"
        if n != 1:
            bad += 1
        print(f"  [{flag}] {n}x  {label}")
    if bad:
        print(f"\nABORT: {bad} anchor(s) did not match exactly once.")
        return 2
    print(f"\nAll {len(MUTANTS)} anchors matched exactly once.\n")

    # A dirty baseline invalidates everything: a suite that is already failing
    # scores every mutant as "killed".
    print("Baseline check (all suites must pass BEFORE any mutation) ...", flush=True)
    if not run_suite():
        print("ABORT: the baseline is not green. Fix that before trusting a score.")
        return 2
    print("Baseline green.\n")

    before = {rel: md5(ROOT / rel) for rel in {m[1] for m in MUTANTS}}

    killed: list[str] = []
    survived: list[tuple[str, str, str]] = []
    control_survived = False

    for i, (label, rel, find, replace, why) in enumerate(MUTANTS, 1):
        path = ROOT / rel
        original = path.read_text(encoding="utf-8")
        print(f"[{i}/{len(MUTANTS)}] {label} ...", flush=True)
        try:
            path.write_text(original.replace(find, replace), encoding="utf-8")
            passed = run_suite()
            if label == CONTROL_LABEL:
                control_survived = passed
                print(
                    f"    CONTROL {'SURVIVED (correct)' if passed else 'DIED (HARNESS BROKEN)'}",
                    flush=True,
                )
            elif passed:
                print("    SURVIVED  <-- HOLE IN THE TESTS", flush=True)
                survived.append((label, rel, why))
            else:
                print("    killed", flush=True)
                killed.append(label)
        finally:
            path.write_text(original, encoding="utf-8")

    after = {rel: md5(ROOT / rel) for rel in before}
    dirty = [rel for rel in before if before[rel] != after[rel]]

    real = len(MUTANTS) - 1
    print("\n" + "=" * 72)
    print(f"MUTATION SCORE: {len(killed)}/{real} killed")
    print(f"CONTROL: {'SURVIVED (harness sound)' if control_survived else 'DIED (HARNESS BROKEN)'}")
    print(f"RESTORATION: {'all files restored' if not dirty else 'DIRTY: ' + ', '.join(dirty)}")
    if survived:
        print("\nSURVIVORS (holes in the tests):")
        for label, rel, why in survived:
            print(f"  - {label} [{rel}]\n      {why}")
    if survived or not control_survived or dirty:
        return 1
    print("\nAll mutants killed, control survived, tree clean. The tests have teeth.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

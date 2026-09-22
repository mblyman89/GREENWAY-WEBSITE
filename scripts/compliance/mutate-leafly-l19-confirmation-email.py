#!/usr/bin/env python3
"""
scripts/compliance/mutate-leafly-l19-confirmation-email.py

SLICE L-19 MUTATION PROBE — "test it, test the tests."

A green suite proves nothing on its own. This script BREAKS the production
code one change at a time and requires the suite to go red. Any mutation that
SURVIVES is a hole in the tests, not a success.

The most important mutations in this file are the ones that make the system
NOISY rather than silent — "a Leafly order now warns", "an unlabelled skip now
warns". Those are the regressions that would quietly destroy the value of the
warning this slice adds, by training staff to ignore it. They must die.

The CONTROL mutation at the end is a change that genuinely does not matter
(a comment). It MUST SURVIVE. If the control dies, the suite is failing for
some reason unrelated to the mutation and every other result is meaningless.

Run:  python3 scripts/compliance/mutate-leafly-l19-confirmation-email.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CORE = "src/lib/orders/email-readiness-core.ts"
OUTCOME = "src/lib/orders/notify-outcome-core.ts"
NOTIFY = "src/lib/orders/notify.ts"
SETUP = "src/lib/admin/setup-status.ts"
BANNER = "src/components/admin/orders/EmailReadinessBanner.tsx"
PAGE = "src/app/admin/orders/page.tsx"
RUNNER = "scripts/compliance/run-pure-selftests.ts"

TOUCHED = [CORE, OUTCOME, NOTIFY, SETUP, BANNER, PAGE, RUNNER]

TEST_CMD = [
    "npx", "vitest", "run",
    "tests/compliance/order-email-readiness.test.ts",
    "tests/compliance/notify-outcome-core.test.ts",
    "--reporter=dot",
]
SELFTEST_CMD = ["npx", "tsx", RUNNER]


@dataclass
class Mutation:
    name: str
    path: str
    old: str
    new: str
    control: bool = False


MUTATIONS: list[Mutation] = [
    # ── The central distinction: fault vs contractual requirement ───────────
    Mutation(
        "THE TRAP: a Leafly order starts raising a warning (alert fatigue)",
        CORE,
        '  marketplace_origin: {\n    severity: "expected",',
        '  marketplace_origin: {\n    severity: "fault",',
    ),
    Mutation(
        "an unconfigured provider goes back to being silent (the reported bug)",
        CORE,
        '  provider_unconfigured: {\n    severity: "fault",',
        '  provider_unconfigured: {\n    severity: "normal",',
    ),
    Mutation(
        "nobody being alerted about orders is downgraded to normal",
        CORE,
        '  no_staff_addresses: {\n    severity: "fault",',
        '  no_staff_addresses: {\n    severity: "normal",',
    ),
    Mutation(
        "a missing customer address is promoted to a fault (warns on normal orders)",
        CORE,
        '  no_customer_address: {\n    severity: "normal",',
        '  no_customer_address: {\n    severity: "fault",',
    ),
    Mutation(
        "a policy refusal starts warning",
        CORE,
        '  not_permitted: {\n    severity: "expected",',
        '  not_permitted: {\n    severity: "fault",',
    ),
    Mutation(
        "the fault predicate inverts",
        CORE,
        '  return skipSeverity(reason) === "fault";',
        '  return skipSeverity(reason) !== "fault";',
    ),
    Mutation(
        "the fault predicate treats anything non-expected as a fault",
        CORE,
        '  return skipSeverity(reason) === "fault";',
        '  return skipSeverity(reason) !== "expected";',
    ),

    # ── The timeline note ───────────────────────────────────────────────────
    Mutation(
        "the timeline note is written for EVERY skip, not just faults",
        CORE,
        "  const faults = reasons.filter(isSkipAFault);\n  if (faults.length === 0) return null;",
        "  const faults = [...reasons];\n  if (faults.length === 0) return null;",
    ),
    Mutation(
        "the timeline note stops being written at all",
        CORE,
        "  const faults = reasons.filter(isSkipAFault);\n  if (faults.length === 0) return null;",
        "  const faults = reasons.filter(isSkipAFault);\n  if (faults.length >= 0) return null;",
    ),
    Mutation(
        "the note drops the remedy, so it says what is wrong but not what to do",
        CORE,
        "    return remedy ? `${explainSkip(r)} ${remedy}` : explainSkip(r);",
        "    return explainSkip(r);",
    ),
    Mutation(
        "the note stops de-duplicating and stutters",
        CORE,
        "  const unique = SKIP_REASONS.filter((r) => faults.includes(r));",
        "  const unique = faults;",
    ),
    Mutation(
        "the log line fires for expected skips too",
        CORE,
        "  const faults = SKIP_REASONS.filter((r) => reasons.includes(r) && isSkipAFault(r));",
        "  const faults = SKIP_REASONS.filter((r) => reasons.includes(r));",
    ),

    # ── The configuration check (F11 — the checklist that lied) ─────────────
    Mutation(
        "F11 RETURNS: readiness checks only the API key again",
        CORE,
        "  const canSend = hasKey && hasFrom;",
        "  const canSend = hasKey;",
    ),
    Mutation(
        "readiness checks only the from-address",
        CORE,
        "  const canSend = hasKey && hasFrom;",
        "  const canSend = hasFrom;",
    ),
    Mutation(
        "either-or instead of both",
        CORE,
        "  const canSend = hasKey && hasFrom;",
        "  const canSend = hasKey || hasFrom;",
    ),
    Mutation(
        "whitespace counts as configuration",
        CORE,
        "  return typeof value === \"string\" && value.trim().length > 0;",
        "  return typeof value === \"string\" && value.length > 0;",
    ),
    Mutation(
        "staff alerting is reported as possible without a provider",
        CORE,
        "  const canAlertStaff = canSend && staff.length > 0;",
        "  const canAlertStaff = staff.length > 0;",
    ),
    Mutation(
        "the missing-variable list stops naming ORDER_EMAIL_FROM",
        CORE,
        '  if (!hasFrom) missing.push("ORDER_EMAIL_FROM");',
        "  if (false) missing.push(\"ORDER_EMAIL_FROM\");",
    ),
    Mutation(
        "the half-configured case stops explaining that both are required",
        CORE,
        "        : `Order emails are switched off: ${missing[0]} is missing. Both settings are required — one without the other sends nothing.`;",
        "        : `Order emails are switched off.`;",
    ),
    Mutation(
        "a shop with no staff addresses is reported as perfectly healthy",
        CORE,
        "  } else if (staff.length === 0) {",
        "  } else if (false) {",
    ),
    Mutation(
        "the staff parser stops dropping empty entries (a lone comma = 1 recipient)",
        CORE,
        "    .filter(Boolean);\n}",
        "    .filter(() => true);\n}",
    ),

    # ── The summariser ──────────────────────────────────────────────────────
    Mutation(
        "the summariser ignores fault-skips and calls them a quiet success",
        OUTCOME,
        "    const faultSkips = outcomes.filter(isFaultSkip);\n    if (faultSkips.length > 0) {",
        "    const faultSkips = outcomes.filter(isFaultSkip);\n    if (false) {",
    ),
    Mutation(
        "the summariser treats EVERY skip as a fault (Leafly orders now warn)",
        OUTCOME,
        "    (FAULT_SKIP_REASONS as readonly string[]).includes(o.skipReason ?? \"\")",
        "    true",
    ),
    Mutation(
        "the summariser's fault list gains the marketplace reason",
        OUTCOME,
        'const FAULT_SKIP_REASONS = ["provider_unconfigured", "no_staff_addresses"] as const;',
        'const FAULT_SKIP_REASONS = ["provider_unconfigured", "no_staff_addresses", "marketplace_origin"] as const;',
    ),
    Mutation(
        "the summariser's fault list loses the reported bug",
        OUTCOME,
        'const FAULT_SKIP_REASONS = ["provider_unconfigured", "no_staff_addresses"] as const;',
        'const FAULT_SKIP_REASONS = ["no_staff_addresses"] as const;',
    ),
    Mutation(
        "a fault-skip is reported as ok anyway",
        OUTCOME,
        "      return {\n        ok: false,\n        // Not failures",
        "      return {\n        ok: true,\n        // Not failures",
    ),
    Mutation(
        "the unconfigured note stops naming the second variable",
        OUTCOME,
        "\"configured, so customers receive no confirmation and staff receive no alert. \" +\n          \"Set BOTH RESEND_API_KEY and ORDER_EMAIL_FROM, then redeploy (one without the \" +",
        "\"configured, so customers receive no confirmation and staff receive no alert. \" +\n          \"Set RESEND_API_KEY, then redeploy (one without the \" +",
    ),
    Mutation(
        "the staff-gap note blames the provider instead",
        OUTCOME,
        "        : \"⚠️ No staff alert email was sent for this order — no staff addresses are \" +\n          \"configured. Set ORDER_STAFF_EMAILS so the team is told when an order arrives. \" +",
        "        : \"⚠️ No staff alert email was sent for this order — no staff addresses are \" +\n          \"configured. Set RESEND_API_KEY and ORDER_STAFF_EMAILS. \" +",
    ),
    Mutation(
        "an unlabelled skip starts being treated as a fault",
        OUTCOME,
        'o.skipReason ?? ""',
        'o.skipReason ?? "provider_unconfigured"',
    ),

    # ── The call sites ──────────────────────────────────────────────────────
    Mutation(
        "the unconfigured branch goes back to an anonymous skip",
        NOTIFY,
        '      { audience: "customer", status: "skipped", skipReason: "provider_unconfigured" },',
        '      { audience: "customer", status: "skipped" },',
    ),
    Mutation(
        "the marketplace skip is mislabelled as unconfigured (Leafly orders warn)",
        NOTIFY,
        '        skipReason: "marketplace_origin",',
        '        skipReason: "provider_unconfigured",',
    ),
    Mutation(
        "the staff branch stops distinguishing policy from missing config",
        NOTIFY,
        '        skipReason: !staffAllowed ? "not_permitted" : "no_staff_addresses",',
        '        skipReason: "not_permitted",',
    ),
    Mutation(
        "a missing customer address is mislabelled as a provider fault",
        NOTIFY,
        '        skipReason: "no_customer_address",',
        '        skipReason: "provider_unconfigured",',
    ),
    Mutation(
        "F11 RETURNS: the checklist goes back to reading process.env directly",
        SETUP,
        "  const smtpConfigured = emailReadiness.canSend;",
        "  const smtpConfigured = Boolean(process.env.RESEND_API_KEY);",
    ),
    Mutation(
        "the banner is removed from the orders dashboard",
        PAGE,
        "        <EmailReadinessBanner readiness={emailReadiness} />",
        "        {null}",
    ),
    Mutation(
        "the banner renders even when nothing is wrong (becomes furniture)",
        BANNER,
        "  if (!readiness.problem) return null;",
        "  if (false) return null;",
    ),
    Mutation(
        "the banner stops distinguishing severity",
        BANNER,
        "  const severe = !readiness.canSend;",
        "  const severe = false;",
    ),
    Mutation(
        "the banner uses a colour token that does not exist (invisible border)",
        BANNER,
        "    : \"border-[var(--admin-gold)]/50 bg-[var(--admin-gold-soft)]\";",
        "    : \"border-[var(--admin-warning)]/50 bg-[var(--admin-warning-soft)]\";",
    ),
    Mutation(
        "the banner stops reassuring the owner that orders are safe",
        BANNER,
        "          Orders themselves are unaffected",
        "          Orders may be affected",
    ),

    # ── The wiring ──────────────────────────────────────────────────────────
    Mutation(
        "the self-test floor is dropped to zero",
        RUNNER,
        'assertRan("email-readiness-core", __runEmailReadinessTests(), 75);',
        'assertRan("email-readiness-core", __runEmailReadinessTests(), 0);',
    ),
    Mutation(
        "the self-test floor is quietly halved (nonzero, still useless)",
        RUNNER,
        'assertRan("email-readiness-core", __runEmailReadinessTests(), 75);',
        'assertRan("email-readiness-core", __runEmailReadinessTests(), 20);',
    ),

    # ── Behavioural: only the "actually run" block can catch these ──────────
    #
    # Added in response to a SURVIVOR on the first probe run. Mutation 33
    # relabelled a skip and every text-matching test still passed, because the
    # tokens they grep for were all still present in the file — just attached
    # to the wrong branch. These mutants are all of that family: the source
    # still "contains" everything it should, but the RUNNING system is wrong.
    Mutation(
        "the survivor, again: a missing customer address becomes a provider fault",
        NOTIFY,
        '        skipReason: "no_customer_address",',
        '        skipReason: "provider_unconfigured",',
    ),
    Mutation(
        "a missing customer address is mislabelled as a staff-config fault",
        NOTIFY,
        '        skipReason: "no_customer_address",',
        '        skipReason: "no_staff_addresses",',
    ),
    Mutation(
        "the address check inverts, so only orders WITHOUT an address are emailed",
        NOTIFY,
        "  } else if (n.customerEmail) {",
        "  } else if (!n.customerEmail) {",
    ),
    Mutation(
        "the provider gate throws instead of returning, which would break checkout",
        NOTIFY,
        "    return summarizeNotifyOutcomes(n.orderNumber, [",
        "    if (!apiKey) throw new Error(\"email not configured\");\n    return summarizeNotifyOutcomes(n.orderNumber, [",
    ),
    Mutation(
        "a rejected Resend response is swallowed as a success",
        NOTIFY,
        "    if (!res.ok) {",
        "    if (false) {",
    ),
    Mutation(
        "the staff list is no longer parsed, so a lone comma looks configured",
        NOTIFY,
        "  const staffEmails = parseStaffEmailList(process.env.ORDER_STAFF_EMAILS);",
        '  const staffEmails = (process.env.ORDER_STAFF_EMAILS ?? "").split(",");',
    ),

    # ── CONTROL — must SURVIVE ──────────────────────────────────────────────
    Mutation(
        "CONTROL: reword a comment (must survive)",
        CORE,
        " * 1. Why an email did not go out",
        " * 1. The reasons an email did not go out",
        control=True,
    ),
]


def run(cmd: list[str]) -> bool:
    """True when the command exits 0 (suite green)."""
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return proc.returncode == 0


def suite_green() -> bool:
    return run(TEST_CMD) and run(SELFTEST_CMD)


def preflight(snapshot: Path) -> None:
    """
    Every anchor must resolve to EXACTLY one occurrence.

    An anchor that matches zero times is a mutation that never happened and
    would be reported as "caught" for free. An anchor that matches twice is a
    mutation that changed more than it claimed. Rule 137: an ambiguous anchor
    is not a probe.
    """
    problems: list[str] = []
    for m in MUTATIONS:
        src = (snapshot / m.path.replace("/", "__")).read_text()
        n = src.count(m.old)
        if n != 1:
            problems.append(f"  {m.name}\n    anchor occurs {n} times in {m.path}")
    if problems:
        print("\n  ANCHOR PROBLEMS — fix before trusting any result:\n")
        print("\n".join(problems))
        sys.exit(2)
    print("  all anchors resolve to exactly one match")


def main() -> int:
    print("L-19 mutation probe — breaking the code on purpose\n")

    tmp = Path(tempfile.mkdtemp(prefix="l19-mutate-"))
    for rel in TOUCHED:
        shutil.copy(ROOT / rel, tmp / rel.replace("/", "__"))
    print(f"  snapshot saved to {tmp}\n")

    def restore() -> None:
        for rel in TOUCHED:
            shutil.copy(tmp / rel.replace("/", "__"), ROOT / rel)

    try:
        preflight(tmp)

        if not suite_green():
            print("\n  BASELINE IS RED — fix the suite before mutating.")
            return 2
        print("  baseline is green\n")

        caught = 0
        survived: list[str] = []
        control_survived = None

        for i, m in enumerate(MUTATIONS, 1):
            target = ROOT / m.path
            original = target.read_text()
            target.write_text(original.replace(m.old, m.new, 1))

            green = suite_green()
            restore()

            if m.control:
                control_survived = green
                verdict = "SURVIVED (correct)" if green else "DIED (PROBE IS BROKEN)"
                print(f"  {i:2}. {verdict}  {m.name}")
                continue

            if green:
                survived.append(m.name)
                print(f"  {i:2}. SURVIVED  <-- HOLE IN THE TESTS: {m.name}")
            else:
                caught += 1
                print(f"  {i:2}. caught    {m.name}")

        real = len([m for m in MUTATIONS if not m.control])
        print(f"\n  real mutations : {real}")
        print(f"  caught         : {caught}")
        print(f"  survived       : {len(survived)}")
        print(
            "  control        : "
            + ("SURVIVED (correct)" if control_survived else "DIED — RESULTS MEANINGLESS")
        )
        for s in survived:
            print(f"    ! {s}")

        return 0 if (caught == real and control_survived) else 1
    finally:
        restore()
        print("\n  all files restored to their original contents")


if __name__ == "__main__":
    sys.exit(main())

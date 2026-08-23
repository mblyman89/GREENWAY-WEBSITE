#!/usr/bin/env python3
"""
mutate-slice-books-41.py

A GREEN TEST SUITE PROVES NOTHING UNTIL YOU HAVE SEEN IT GO RED.

books-41 builds Michael's quarterly Washington returns: the ESD 5208A/5208B
unemployment report, the combined Paid Leave and WA Cares report, and the L&I
quarterly report. Its defining characteristic is that EVERY NUMBER IT PRODUCES
IS PLAUSIBLE. A quarterly return that is wrong by two cents looks exactly like
a quarterly return that is right. Nothing crashes, nothing renders oddly, no
exception is thrown -- Michael simply files a figure that does not match what
he owes, and finds out when ESD sends a notice of assessment months later.

That is why this slice was built against a REAL FILED RETURN (Q2 2026, held in
known-good-quarters.ts as the oracle) rather than against my own arithmetic.
And it is why the mutations below exist: to prove the tests would actually
catch each way the arithmetic could quietly drift.

THREE FAMILIES OF MUTATION LIVE HERE.

  Part 1 - THE ARITHMETIC. Break the engine in ways a reader might genuinely
  introduce while "simplifying", and prove the oracle tests notice. The
  headline case is the combined-rate mutation: adding UI and EAF together
  before rounding instead of after. It is one character of difference, it is
  what almost every payroll system does, and it produces 27,569 cents where
  the filed return says 27,570. One cent. Every quarter. Forever.

  Part 2 - THE DEADLINES. Break the due-date rule. These matter because a
  wrong deadline is invisible until it is late, and RCW 50.12.220 penalties
  begin the day after.

  Part 3 - THE TEACHING. Break the mentor data -- remove a box explainer,
  break a citation, soften an employer-cost prohibition -- and prove the
  coverage gates notice. This is the part most likely to rot, because nothing
  on screen looks broken when a box loses its explanation. It just stops
  being explained, and Michael is left reading a number with no account of
  what it is (standing rules 26 and 64a).

A mutation that does NOT turn the suite red has found a hole in the tests, and
the correct response is to add the missing test, never to drop the mutation.

THE RESTORE-VERIFICATION LESSON (rule 64a), LEARNED THE HARD WAY IN BOOKS-39.

The first mutation battery written in this repository reported 17/17 killed
while restoring nothing at all, because the file it was mutating was untracked
and `git checkout` failed silently. It was not measuring anything. It was
printing a number.

So this script does not trust its own restore. After every mutation it reads
the file back and asserts the original text is genuinely there, and it refuses
to start if the working tree is dirty in a way that would make a restore
ambiguous. A harness that cannot prove it undid its own damage is a harness
that will one day leave a mutation in the source.

Usage:  python3 scripts/compliance/mutate-slice-books-41.py
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

FILES = {
    "core": ROOT / "src/lib/payroll/wa-quarterly-core.ts",
    "mentor": ROOT / "src/lib/payroll/wa-quarterly-mentor.ts",
    "registry": ROOT / "src/lib/payroll/payroll-rate-registry-core.ts",
}

# The whole slice's suite, plus the registry suite, because the SUTA component
# gate lives there and part of this slice's correctness depends on it.
SUITES = [
    "tests/compliance/wa-quarterly.test.ts",
    "tests/compliance/payroll-rate-registry-core.test.ts",
]

# (file key, label, find, replace, why this is a realistic accident)
MUTATIONS = [
    # ------------------------------------------------------------------
    # PART 1 - THE ARITHMETIC
    # ------------------------------------------------------------------
    (
        "core",
        "half a cent rounds DOWN instead of up",
        "  return exactCents - whole >= 0.5 ? whole + 1 : whole;",
        "  return exactCents - whole > 0.5 ? whole + 1 : whole;",
        "Somebody writes the comparison the way most rounding is written and "
        "loses the exact-half case. RCW 50.24.010 says a fractional part of a "
        "cent of one-half or more is rounded UP, so this is a direct statutory "
        "violation that shows up on maybe one quarter in four.",
    ),
    (
        "core",
        "half-to-even (banker's) rounding replaces the statutory rule",
        "  const whole = Math.floor(exactCents);\n  return exactCents - whole >= 0.5 ? whole + 1 : whole;",
        "  const whole = Math.floor(exactCents);\n  const diff = exactCents - whole;\n  if (diff > 0.5) return whole + 1;\n  if (diff < 0.5) return whole;\n  return whole % 2 === 0 ? whole : whole + 1;",
        "Half-to-even is what many accountants are taught and what several "
        "decimal libraries default to. It is NOT what RCW 50.24.010 says: the "
        "statute rounds a half-cent UP regardless of what precedes it.",
    ),
    (
        "core",
        "UI and EAF are added BEFORE rounding, not after",
        "  const uiCents = statutoryRoundCents(exactMilliPct(esdTaxableCents, r.sutaUiMilliPct));",
        "  const uiCents = statutoryRoundCents(exactMilliPct(esdTaxableCents, r.sutaUiMilliPct + r.sutaEafMilliPct)) - statutoryRoundCents(exactMilliPct(esdTaxableCents, r.sutaEafMilliPct));",
        "THE HEADLINE MUTATION. This is what a combined 0.40% rate does: it "
        "rounds once on the total instead of once per fund. It yields 27,569 "
        "where Michael's filed return says 27,570. RCW 50.24.010 and RCW "
        "50.24.014(2)(b) each command rounding for their OWN section, which is "
        "precisely why the two must be rounded separately and then added.",
    ),
    (
        "core",
        "the PFML employee share is rounded twice",
        "  const pfmlPremiumExact = exactMilliPct(pfmlTaxableCents, r.pfmlTotalMilliPct);",
        "  const pfmlPremiumExact = Math.round(exactMilliPct(pfmlTaxableCents, r.pfmlTotalMilliPct));",
        "PFML is a percentage OF a percentage. Rounding the intermediate feels "
        "harmless and turns 556.32 into 556.33 -- the classic double-rounding "
        "error, worth a cent or two per quarter and impossible to spot by eye.",
    ),
    (
        "core",
        "L&I total is the sum of two rounded halves",
        "  const lniTotalCents = hourlyPremiumCents(\n    totalHours,\n    r.lniEmployeeMilliCentsPerHour + r.lniEmployerMilliCentsPerHour,\n  );",
        "  const lniTotalCents = lniEmployeeCents + lniEmployerCents;",
        "Looks obviously correct and is not always. L&I bills the combined "
        "hourly rate, so the total must be computed from the combined rate. "
        "Summing two independently rounded halves can be a cent out.",
    ),
    (
        "core",
        "fractional hours are quietly accepted",
        "  if (!Number.isInteger(hours)) {",
        "  if (false) {",
        "The honest refusal is removed, so averaged or part-imported hours "
        "flow straight into an L&I premium instead of stopping the return. "
        "Both ESD and L&I collect whole hours for this employer.",
    ),
    (
        "core",
        "a negative contribution is rounded instead of refused",
        "  if (exactCents < 0) {",
        "  if (false) {",
        "An upstream defect (a reversal, a bad adjustment) becomes a silently "
        "rounded negative tax rather than a loud refusal. RCW 50.24.010 says "
        "nothing about negative amounts because a contribution cannot be one.",
    ),
    (
        "core",
        "the hours box reports money",
        '    measure: "hours",\n    amountCents: 0,\n    quantity: totalHours,',
        '    measure: "money",\n    amountCents: 0,\n    quantity: totalHours,',
        "The sentinel this slice was built to remove. Any screen formatting "
        "the field would print '$0.00' beside a box that reported 3,558 hours "
        "-- a number Michael would reasonably read as 'you owe nothing'.",
    ),
    (
        "core",
        "hours are formatted with a dollar sign",
        '  if (line.measure === "hours") {',
        "  if (false) {",
        "The measure distinction exists but nothing consults it, so the hours "
        "box renders as currency again. Detection without effect (rule 64a).",
    ),
    # ------------------------------------------------------------------
    # PART 2 - THE DEADLINES
    # ------------------------------------------------------------------
    (
        "core",
        "weekend due dates stop shifting",
        "    if (dow !== 0 && dow !== 6 && !isWaLegalHoliday(probeIso)) break;",
        "    break;",
        "The shift loop is short-circuited. Q2 2027 is due 31 July 2027, a "
        "Saturday. Filing on a day ESD is closed is filing late, and RCW "
        "50.12.220 penalties start the next day.",
    ),
    # ─────────────────────────────────────────────────────────────────
    # THREE MUTATIONS DELIBERATELY NOT LISTED HERE, AND WHY.
    #
    # I wrote three more holiday mutations and all three SURVIVED:
    #
    #   - remove the holiday test from the shift loop
    #   - substitute the federal holiday list for Washington's
    #   - always report the shift reason as "weekend"
    #
    # The honest response was to find out WHY before writing a test to kill
    # them, so I walked every quarter from 2024 to 2200 - 708 of them - and
    # compared the real due-date function against one with the holiday check
    # removed. The outcome differed ZERO times.
    #
    # The reason is structural. A quarterly return's named due date is always
    # the last day of the month following the quarter, so it can only ever be
    # 31 January, 30 April, 31 July or 31 October. No Washington legal
    # holiday under RCW 1.16.050 ever falls on any of those four dates, and
    # none can: the fixed-date holidays are 1 January, 4 July, 11 November,
    # 25 December; the floating ones are all anchored to Mondays, Thursdays
    # or the fourth Friday in months that do not end on the 31st in the
    # relevant week.
    #
    # These are therefore EQUIVALENT MUTANTS - no possible input
    # distinguishes them - and a test that appeared to kill one would be
    # testing the mutation harness, not the code.
    #
    # SO WHY KEEP THE HOLIDAY CODE AT ALL? Because "no holiday collides
    # today" is a fact about the current statute, not a law of nature. The
    # legislature can add a holiday; RCW 1.16.050 has been amended within
    # living memory (Juneteenth in 2021, Native American Heritage Day in
    # 2014). The code is correct-by-construction rather than
    # correct-by-coincidence, and tests/compliance/wa-quarterly.test.ts walks
    # 2024-2075 asserting the collision count is zero, so the day a future
    # amendment changes that, the suite says so instead of silently filing
    # late.
    #
    # Standing rule 50 says dead code wearing a green check is a defect. This
    # is the narrow exception that proves the rule: the branch is unreachable
    # TODAY, it is proven unreachable rather than assumed, and the proof is
    # itself a test that will fail when the world changes.
    # ─────────────────────────────────────────────────────────────────
    # ------------------------------------------------------------------
    # PART 3 - THE TEACHING
    # ------------------------------------------------------------------
    (
        "mentor",
        "a box loses its plain-English explanation",
        'lineId: "esd-eaf"',
        'lineId: "esd-eaf-DISABLED"',
        "The EAF box still prints a number and nothing explains what the "
        "Employment Administration Fund is. Michael's explicit ask for this "
        "slice was that every box on the form be explained (rule 26).",
    ),
    (
        "mentor",
        "a citation points at an authority that does not exist",
        'authorityIds: ["rcw-50-24-010-no-deduction", "rcw-50-24-010-rounding", "esd-suta-rate-structure"],',
        'authorityIds: ["rcw-50-24-010-no-deduction", "rcw-50-24-010-round", "esd-suta-rate-structure"],',
        "The exact defect a probe caught during this slice: the mentor cited "
        "an export NAME rather than the registry `id`. The citation renders as "
        "a dead reference and the quote Michael would check is unreachable.",
    ),
    (
        "registry",
        "the SUTA components stop being reconciled",
        "    problems.push(...findSutaComponentViolations(rows));",
        "    // problems.push(...findSutaComponentViolations(rows));",
        "The construction gate is commented out during a refactor. A mistyped "
        "component then survives, and the return is built from one rate while "
        "the readiness screen quotes another -- with no symptom anywhere.",
    ),
    (
        "registry",
        "the component check tolerates a small difference",
        "        if (ui.value + eaf.value !== total.value) {",
        "        if (Math.abs(ui.value + eaf.value - total.value) > 5) {",
        "A tolerance is added to stop a nuisance failure. A tolerance on a tax "
        "rate is an invitation to drift: five milli-percent on a $78,200 wage "
        "base is real money and nothing will ever flag it again.",
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
    # ------------------------------------------------------------------
    # PRE-FLIGHT: prove we can restore before we damage anything.
    # ------------------------------------------------------------------
    for key, path in FILES.items():
        if not path.exists():
            print(f"REFUSING: {key} does not exist at {path}")
            return 2

    originals = {key: path.read_text() for key, path in FILES.items()}

    def restore_all() -> None:
        for key, path in FILES.items():
            path.write_text(originals[key])

    # The books-39 lesson, mechanised. Restoration here is an in-memory
    # write-back rather than a `git checkout`, precisely because the git
    # version failed silently on an untracked file. Prove the write-back
    # works, on real files, before trusting it for seventeen mutations.
    for key, path in FILES.items():
        probe = originals[key] + "\n// mutation-harness restore probe\n"
        path.write_text(probe)
        if path.read_text() != probe:
            print(f"REFUSING: cannot write {key}; the harness could not mutate it.")
            restore_all()
            return 2
        path.write_text(originals[key])
        if path.read_text() != originals[key]:
            print(f"REFUSING: cannot restore {key}; a mutation would be left in place.")
            return 2
    print("Restore verified on all files (books-39 lesson: a silent restore is no restore).")

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

        mutated = original.replace(find, replace, 1)
        path.write_text(mutated)

        # Rule 16: prove the mutation is actually ON DISK before crediting the
        # suite with catching it. Otherwise a failed write scores as a kill.
        if path.read_text() != mutated:
            print(f"  SKIP (write did not land) [{key}]: {label}")
            survivors.append(label)
            path.write_text(original)
            continue

        passed = run_suites()
        path.write_text(original)

        # And prove the restore landed, every single time, not just at the end.
        if path.read_text() != original:
            print(f"  ABORT: {key} could not be restored after '{label}'.")
            return 2

        if passed:
            print(f"  SURVIVED (BAD) [{key}]: {label}\n      {why}")
            survivors.append(label)
        else:
            print(f"  killed [{key}]: {label}")

    restore_all()

    # Final belt-and-braces: every file is byte-identical to how we found it.
    for key, path in FILES.items():
        if path.read_text() != originals[key]:
            print(f"ABORT: {key} is not byte-identical to its original.")
            return 2
    print("\nAll files verified byte-identical to their originals.")

    if survivors:
        print(f"\n{len(survivors)} mutation(s) SURVIVED. The tests have a hole.")
        for s in survivors:
            print(f"  - {s}")
        return 1

    print(f"All {len(MUTATIONS)} mutations killed. Sources restored.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

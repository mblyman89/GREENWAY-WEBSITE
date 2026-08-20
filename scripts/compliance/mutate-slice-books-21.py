#!/usr/bin/env python3
"""
books-21 mutation harness  (standing rule 33)

Runs AFTER the suite is green. A green suite proves the code passes the tests;
this proves the tests would notice if the code were wrong. Those are different
claims and only the second one is worth anything.

Requirements from rule 33: ZERO survivors and ZERO skipped. A skipped mutant is
not a pass, it is an unasked question -- usually an anchor string that no longer
matches, which means the harness silently stopped testing that line.

Rule 39: the harness starts with a NO-OP self-check. It applies a mutation that
changes nothing semantically and asserts the suite still passes, then applies a
mutation that is certainly fatal and asserts the suite fails. A harness that
reports "all killed" because it cannot run the suite at all is worse than no
harness.
"""
import subprocess
import shutil
import sys
import os
import tempfile

# Repo root, derived from this file's location: scripts/compliance/ -> ../..
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

TARGETS = {
    "interest": "src/lib/accounting/interest-core.ts",
    "syear": "src/lib/accounting/s-corporation-year-core.ts",
    "basis": "src/lib/accounting/basis-aaa-core.ts",
    "rates": "src/lib/accounting/interest-rates-evidenced.ts",
    "imentor": "src/lib/accounting/interest-mentor.ts",
    "smentor": "src/lib/accounting/s-corporation-year-mentor.ts",
    "tripwire": "tests/compliance/authority-id-resolution.test.ts",
}

TESTS = [
    "tests/compliance/interest-core.test.ts",
    "tests/compliance/s-corporation-year-core.test.ts",
    "tests/compliance/basis-aaa-core.test.ts",
    "tests/compliance/cogs-position-core.test.ts",
    "tests/compliance/books-21-mentors.test.ts",
    "tests/compliance/authority-id-resolution.test.ts",
]

# (label, target key, old, new)
MUTANTS = [
    # ---------- interest-core: the arithmetic ----------
    ("6622: simple interest instead of compounding", "interest",
     "balance = balance + (balance * dailyNumerator) / denominator;",
     "if (i === 0) { balance = balance + (magnitude * COMPOUND_SCALE * dailyNumerator * BigInt(days)) / denominator; }"),
    ("6622: round every day instead of once", "interest",
     "const cents = (grossScaled * BigInt(2) + COMPOUND_SCALE) / (COMPOUND_SCALE * BigInt(2));",
     "const cents = (grossScaled + COMPOUND_SCALE - BigInt(1)) / COMPOUND_SCALE;"),
    ("6622: leap denominator hardcoded to 365", "interest",
     "return leap ? 366 : 365;", "return 365;"),
    ("6622: leap rule loses the century exception", "interest",
     "const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;",
     "const leap = y % 4 === 0;"),
    ("6622: negative principal loses its sign", "interest",
     "return negative ? -result : result;", "return result;"),
    # ---------- interest-core: the quarter walk ----------
    ("6621(b): compounding restarts each quarter", "interest",
     "balance += interest;", "/* mutant */ void interest;"),
    ("6621(b): whole period rated at the first quarter's rate", "interest",
     "const rate = registry.rateFor(cursor, kind);",
     "const rate = registry.rateFor(input.fromDateIso, kind);"),
    ("6621(b): quarter boundary off by one month", "interest",
     "const endMonth = q * 3; // 3, 6, 9, 12", "const endMonth = q * 3 + 1;"),
    ("6621(b): only the first missing quarter is reported", "interest",
     "refusals.push(rate.refusal);\n      cursor = segmentEnd;\n      continue;",
     "return { ok: false, refusals: [rate.refusal] };"),
    ("registry: interpolates from the first row on a miss", "interest",
     "const row = this.find(year, quarter);",
     "const row = this.find(year, quarter) ?? this.rows[0];"),
    # ---------- interest-core: the five rates ----------
    ("6621(c): hot interest allowed for an S corporation", "interest",
     'if (input.taxpayer !== "c_corporation") {', "if (false) {"),
    ("6621(a)(1): corporate overpayment reduction removed", "interest",
     "overpaymentCorporate: 200,", "overpaymentCorporate: 300,"),
    ("6621(a)(1): above-threshold reduction removed", "interest",
     "overpaymentCorporateAboveThreshold: 50,", "overpaymentCorporateAboveThreshold: 200,"),
    ("6621(a)(2): underpayment addition wrong", "interest",
     "underpayment: 300,", "underpayment: 250,"),
    ("6621(c): hot interest addition wrong", "interest",
     "largeCorporateUnderpayment: 500,", "largeCorporateUnderpayment: 300,"),
    ("6621(a)(1): corporate threshold wrong", "interest",
     "export const CORPORATE_OVERPAYMENT_THRESHOLD_CENTS = 10_000_00;",
     "export const CORPORATE_OVERPAYMENT_THRESHOLD_CENTS = 100_000_00;"),
    ("6621(a)(1): threshold boundary flipped to >=", "interest",
     "input.principalCents > CORPORATE_OVERPAYMENT_THRESHOLD_CENTS",
     "input.principalCents >= CORPORATE_OVERPAYMENT_THRESHOLD_CENTS"),
    ("6621(a)(2): underpayment gains a corporate variant", "interest",
     'return { ok: true, kind: "underpayment" };\n  }',
     'return { ok: true, kind: isCorporation ? "overpayment_corporate" : "underpayment" };\n  }'),
    # ---------- interest-core: validation ----------
    ("dates: impossible dates accepted", "interest",
     "  return (\n    dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d!\n  );",
     "  return true;"),
    ("integer cents check removed", "interest",
     "if (!Number.isInteger(input.principalCents)) {", "if (false) {"),
    ("backwards period allowed", "interest",
     "if (daysBetween(input.fromDateIso, input.toDateIso) < 0) {", "if (false) {"),
    ("registry: whole-percent check removed", "interest",
     "if (Number.isInteger(r.shortTermRateBasisPoints) && r.shortTermRateBasisPoints % 100 !== 0) {",
     "if (false) {"),
    ("registry: duplicate rows allowed", "interest",
     "if (seen.has(key)) {", "if (false) {"),
    # ---------- 6699 ----------
    ("6699: twelve-month cap removed", "interest",
     "const monthsCharged = Math.min(input.monthsLate, SECTION_6699_MAX_MONTHS);",
     "const monthsCharged = input.monthsLate;"),
    ("6699: cap raised to 24 months", "interest",
     "export const SECTION_6699_MAX_MONTHS = 12;", "export const SECTION_6699_MAX_MONTHS = 24;"),
    ("6699: falls back to the $195 statutory base", "interest",
     "input.perShareholderPerMonthCents < SECTION_6699_STATUTORY_BASE_CENTS", "false"),
    ("6699: shareholder multiplier dropped", "interest",
     "const penalty = perMonth * shareholders * monthsCharged;",
     "const penalty = perMonth * monthsCharged;"),
    ("6699: reasonable cause ignored", "interest",
     "if (input.reasonableCauseEstablished) {", "if (false) {"),
    ("6699: refusals downgraded to a zero result", "interest",
     "  if (refusals.length > 0) return { ok: false, refusals };\n\n  const shareholders = input.shareholderCount as number;",
     '  if (refusals.length > 0) return { ok: true, penaltyCents: 0, monthsCharged: 0, plainEnglish: "n/a" };\n\n  const shareholders = input.shareholderCount as number;'),
    ("6699: statutory base confused with 6651's", "interest",
     "export const SECTION_6699_STATUTORY_BASE_CENTS = 195_00;",
     "export const SECTION_6699_STATUTORY_BASE_CENTS = 435_00;"),
    # ---------- 6651(j) ----------
    ("6651(j): silently falls back to the $435 base", "interest",
     "  const row = rows.find((r) => r.filingYear === filingYear);\n  if (row === undefined) {\n    return {\n      ok: false,",
     '  const row = rows.find((r) => r.filingYear === filingYear);\n  if (row === undefined) {\n    return { ok: true, minimumCents: SECTION_6651_STATUTORY_BASE_CENTS, evidenceSource: "base" };\n    return {\n      ok: false,'),
    ("6651(j): lookup ignores the year", "interest",
     "const row = rows.find((r) => r.filingYear === filingYear);",
     "const row = rows[rows.length - 1];"),
    ("6651(j): multiple-of-$5 check removed", "interest",
     "if (Number.isInteger(r.minimumCents) && r.minimumCents % 500 !== 0) {", "if (false) {"),
    ("6651(j): below-base check removed", "interest",
     "if (!Number.isInteger(r.minimumCents) || r.minimumCents < SECTION_6651_STATUTORY_BASE_CENTS) {",
     "if (false) {"),
    ("6651(j): pre-2021 check removed", "interest",
     "if (!Number.isInteger(r.filingYear) || r.filingYear < 2021) {", "if (false) {"),
    ("6651: statutory base wrong", "interest",
     "export const SECTION_6651_STATUTORY_BASE_CENTS = 435_00;",
     "export const SECTION_6651_STATUTORY_BASE_CENTS = 525_00;"),
    # ---------- plain English (rule 29 is a deliverable, so it is testable) ----------
    ("plain English: compounding explanation dropped", "interest",
     "`It compounds daily under \\u00a76622, which is why the total is a little more than multiplying `",
     "`It is charged under \\u00a76622. `"),
    # ---------- the evidence file ----------
    ("evidence: a short-term rate invented out of nowhere", "rates",
     "export const FEDERAL_SHORT_TERM_RATES: readonly ShortTermRateRow[] = [];",
     'export const FEDERAL_SHORT_TERM_RATES: readonly ShortTermRateRow[] = [\n  { year: 2026, quarter: 1, shortTermRateBasisPoints: 400, evidenceSource: "assumed" },\n];'),
    ("evidence: a 6651 minimum silently changed", "rates",
     '{ filingYear: 2026, minimumCents: 525_00, evidenceSource: "supplied by owner 2026-08-20" },',
     '{ filingYear: 2026, minimumCents: 520_00, evidenceSource: "supplied by owner 2026-08-20" },'),
    ("evidence: DOR rate silently changed", "rates",
     '{ year: 2026, basisPoints: 600, evidenceSource: "supplied by owner 2026-08-20" },',
     '{ year: 2026, basisPoints: 700, evidenceSource: "supplied by owner 2026-08-20" },'),
    # ---------- the S-corporation year defect, i.e. the whole point of part A ----------
    ("THE SHIPPED DEFECT: system start year reused as the election year", "syear",
     "export const SYSTEM_START_YEAR = 2026;",
     "export const SYSTEM_START_YEAR = 2026;\nexport const FIRST_S_CORP_YEAR = 2026;"),
    ("classify: an unknown election year guesses 'first year'", "syear",
     'if (facts.year === null || !Number.isInteger(facts.year)) return "unknown";',
     'if (facts.year === null || !Number.isInteger(facts.year)) return "first_s_year";'),
    ("classify: a fiscal year before the election is called a first year", "syear",
     'if (fiscalYear < facts.year) return "unknown";',
     'if (fiscalYear < facts.year) return "first_s_year";'),
    ("classify: first and continuing years swapped", "syear",
     'return fiscalYear === facts.year ? "first_s_year" : "continuing_s_year";',
     'return fiscalYear === facts.year ? "continuing_s_year" : "first_s_year";'),
    ("AAA: forced to zero in every year, not just the first", "syear",
     'return classifySYear(fiscalYear, facts) === "first_s_year";',
     "return true;"),
    ("carry-forward: exempts the earliest year again", "syear",
     'return classifySYear(fiscalYear, facts) === "continuing_s_year";',
     "return false;"),
    ("election facts: evidence requirement removed", "syear",
     "if (facts.evidenceSource === null || facts.evidenceSource.trim() === \"\") {",
     "if (false) {"),
    ("election facts: implausible year accepted", "syear",
     "facts.year < EARLIEST_PLAUSIBLE_S_ELECTION_YEAR", "false"),
    ("election facts: an election after the fiscal year is allowed", "syear",
     "      Number.isInteger(facts.year) &&\n      facts.year > fiscalYear\n    ) {",
     "      Number.isInteger(facts.year) &&\n      false\n    ) {"),
    ("THE SHIPPED DEFECT, in the module written to prevent it", "syear",
     "export const SYSTEM_START_YEAR = 2026;",
     "export const SYSTEM_START_YEAR = 2026;\nexport const FIRST_S_CORP_YEAR = 2026;"),
    # ---------- basis engine gates added in books-21 ----------
    ("basis: zero opening AAA in a continuing year accepted", "basis",
     'if (yearKind === "continuing_s_year" && aaaIsAnInteger && input.beginningAaaCents === 0) {',
     "if (false) {"),
    ("basis: opening AAA needs no evidence", "basis",
     'if (\n    yearKind === "continuing_s_year" &&',
     "if (\n    false &&"),
    # ---------- the tripwire this slice widened ----------
    ("tripwire: narrowed back to SCREAMING_SNAKE only", "tripwire",
     '/"([A-Z0-9_]{3,}|[a-z][a-z0-9-]{2,})"/g', '/"([A-Z0-9_]{3,})"/g'),
    ("tripwire: singular authorityId branch removed", "tripwire",
     '/\\bauthorityId\\s*:\\s*"([A-Z0-9_]{3,}|[a-z][a-z0-9-]{2,})"/g',
     '/\\bauthorityIdXXX\\s*:\\s*"([A-Z0-9_]{3,})"/g'),
    # ---------- mentor coverage gates ----------
    ("mentor: interest coverage gate disabled", "imentor",
     "if (untaught.length > 0) {", "if (false) {"),
    ("mentor: interest vacuous-read guard disabled", "imentor",
     "if (exported.length === 0) {", "if (false) {"),
    ("mentor: s-year coverage gate disabled", "smentor",
     "if (untaught.length > 0) {", "if (false) {"),
    ("mentor: s-year thinness gate disabled", "smentor",
     "if (value.trim().length < 40) thin.push(`${l.fn}.${name}`);", "void name;"),
]


def run_suite() -> bool:
    """True if the suite passes."""
    r = subprocess.run(
        ["npx", "vitest", "run", *TESTS, "--reporter=dot"],
        cwd=REPO, capture_output=True, text=True,
    )
    return r.returncode == 0


def main() -> int:
    backups = {}
    for key, rel in TARGETS.items():
        src = os.path.join(REPO, rel)
        bak = os.path.join(tempfile.gettempdir(), f"books21-mut-{key}.bak")
        shutil.copy(src, bak)
        backups[key] = (src, bak)

    def restore_all():
        for src, bak in backups.values():
            shutil.copy(bak, src)

    # ---- RULE 39 SELF-CHECK: prove the harness can see both outcomes ----
    print("=" * 72)
    print("SELF-CHECK (rule 39): a harness that cannot fail proves nothing")
    print("=" * 72)

    restore_all()
    if not run_suite():
        print("SELF-CHECK FAILED: the suite is not green before mutation. Stop.")
        restore_all()
        return 1
    print("  [ok] baseline suite is GREEN")

    # A no-op mutation: a comment. Must stay green.
    src, bak = backups["interest"]
    body = open(bak, encoding="utf-8").read()
    open(src, "w", encoding="utf-8").write(body + "\n// harness no-op probe\n")
    if not run_suite():
        print("SELF-CHECK FAILED: a comment broke the suite. The harness is unreliable.")
        restore_all()
        return 1
    print("  [ok] NO-OP mutation stayed green (harness is not just failing everything)")

    # A certainly-fatal mutation. Must go red.
    open(src, "w", encoding="utf-8").write(
        body.replace("export function daysBetween", "export function daysBetweenXX", 1)
    )
    if run_suite():
        print("SELF-CHECK FAILED: deleting an exported function did NOT fail the suite.")
        restore_all()
        return 1
    print("  [ok] FATAL mutation went red (harness can detect a kill)")
    restore_all()
    print()

    # ---- THE RUN ----
    print("=" * 72)
    print(f"MUTATION RUN: {len(MUTANTS)} mutants")
    print("=" * 72)

    survived, skipped, killed = [], [], []
    for i, (label, key, old, new) in enumerate(MUTANTS, 1):
        src, bak = backups[key]
        body = open(bak, encoding="utf-8").read()
        n = body.count(old)
        if n != 1:
            skipped.append((label, f"anchor matched {n} times"))
            print(f"[{i:2d}/{len(MUTANTS)}] SKIPPED({n})  {label}")
            continue
        open(src, "w", encoding="utf-8").write(body.replace(old, new, 1))
        ok = run_suite()
        shutil.copy(bak, src)
        if ok:
            survived.append(label)
            print(f"[{i:2d}/{len(MUTANTS)}] SURVIVED    {label}")
        else:
            killed.append(label)
            print(f"[{i:2d}/{len(MUTANTS)}] killed      {label}")

    restore_all()

    print()
    print("=" * 72)
    print(f"RESULT: {len(killed)} killed, {len(survived)} survived, {len(skipped)} skipped")
    print("=" * 72)
    for s in survived:
        print(f"  SURVIVOR: {s}")
    for s, why in skipped:
        print(f"  SKIPPED:  {s}  ({why})")

    # Rule 33: zero survivors AND zero skipped.
    if survived or skipped:
        print("\nRULE 33 NOT SATISFIED.")
        return 1
    print("\nRULE 33 SATISFIED: 0 survivors, 0 skipped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

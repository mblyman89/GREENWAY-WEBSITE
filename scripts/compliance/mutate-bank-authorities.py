#!/usr/bin/env python3
"""
mutate-bank-authorities.py   (slice books-05)

PROVING THE AUTHORITIES GUARDS CAN ACTUALLY FAIL.

Standing rule 15: every test must be proven capable of failing. A guard nobody
has ever seen fail is not a guard, it is a comment that costs CPU.

BANK_AUTHORITIES holds verbatim federal and state text that is rendered to the
owner on an owner-only teaching page and cited in a dispute. The failure mode
this protects against is not a crash - it is somebody "tidying" a quotation
until it no longer says what the source says, with nothing going red.

So this harness damages the table in the specific ways a well-meaning person
would actually damage it, and demands that the suite die each time.

METHOD NOTE (learned the hard way in this slice - see D9 in the defect log):
the first mutation campaign of this slice used `perl -0pi -e s/.../` and
reported three SURVIVORS that had not survived at all - perl never matched the
UTF-8 characters, so nothing was ever mutated. A mutation that does not mutate
reads on screen exactly like a passing result. Therefore every mutant below
VERIFIES that the file actually changed, and a NO-OP is reported as a campaign
FAILURE rather than a kill.

Usage:  python3 scripts/compliance/mutate-bank-authorities.py
Exit 0 only if every mutant was genuinely applied AND genuinely killed.
"""

import subprocess
import sys
import shutil
import os

TARGET = "src/lib/accounting/bank-match-core.ts"
BACKUP = "/tmp/bank-match-core.authorities.bak"

# (id, human description, find, replace)
# Each `find` is copied byte-for-byte out of the file; the assertion below
# catches any drift in these anchors rather than silently skipping a mutant.
MUTANTS = [
    (
        "A1",
        "quietly paraphrase the IRS consequence sentence (drops 'formal indirect method')",
        "justifying the use of a formal indirect method to make the actual determination of tax liability.",
        "justifying further examination of the taxpayer's records.",
    ),
    (
        "A2",
        "soften BARS 'need to be recorded' into 'may be recorded'",
        "Identifying transactions from the bank accounts need to be recorded in the accounting records. ",
        "Identifying transactions from the bank accounts may be recorded in the accounting records. ",
    ),
    (
        "A3",
        "drop the 'no further differences' sentence that a plug pretends to satisfy",
        "After adjusting for reconciling items, there should be no further differences between bank ",
        "After adjusting for reconciling items, the account is considered reconciled between bank ",
    ),
    (
        "A4",
        "delete CHAMP's operative words 'separate and apart from'",
        "separate and apart from that consisting of trafficking in controlled substances.",
        "unrelated to the sale of controlled substances.",
    ),
    (
        "A5",
        "remove 'for the purpose of evading' - the intent element of structuring",
        "No person shall, for the purpose of evading the reporting requirements of section 5313(a) or 5325 or any ",
        "No person shall evade the reporting requirements of section 5313(a) or 5325 or any ",
    ),
    (
        "A6",
        "strip the WAC five-year retention period",
        "licensed premises for a five-year period and must be made available for inspection if requested by an ",
        "licensed premises and must be made available for inspection if requested by an ",
    ),
    (
        "A7",
        "gut an authority's plain-English gloss to a non-answer",
        '"The word doing the work is \'interest\'. A mortgage payment is not an expense — it is three things wearing "',
        '"See above. A mortgage payment is not an expense — it is three things wearing "',
    ),
    (
        "A8",
        "remove the source URL, making the authority unverifiable by Michael",
        'source: "26 U.S.C. §163. https://www.law.cornell.edu/uscode/text/26/163",',
        'source: "26 U.S.C. §163.",',
    ),
    (
        "A9",
        "reintroduce a D9 literal escape into rendered authority prose",
        '"deductions of a PERSON who happens to own one. That distinction is the whole reason the four entities in "',
        '"deductions of a PERSON under \\\\u00a7280E who happens to own one. That distinction is the whole reason the four entities in "',
    ),
    (
        "A10",
        "duplicate an authority id so lookup becomes ambiguous",
        'id: "BARS_NO_FURTHER_DIFFERENCES",',
        'id: "BARS_UNRECORDED_ITEMS",',
    ),
    (
        "A11",
        "truncate a verbatim quote to a label",
        '"General rule. There shall be allowed as a deduction all interest paid or accrued within the taxable year " +\n      "on indebtedness.",',
        '"Interest is deductible.",',
    ),
    (
        "A12",
        "make findBankAuthority lie by returning the first entry for unknown ids",
        "  return BANK_AUTHORITIES.find((a) => a.id === id);",
        "  return BANK_AUTHORITIES.find((a) => a.id === id) ?? BANK_AUTHORITIES[0];",
    ),
    (
        "A13",
        "delete the IRM transfer-trap sentence that stops phantom income",
        '"Nontaxable funds, transfers-in, and returned deposits need to be subtracted from " +',
        '"Deposits are reviewed and totalled from " +',
    ),
    (
        "A14",
        "remove IRM weak-control item (d), the bank-fee trap in the IRS's own words",
        '"d. Existing transactions are not recorded " +\n      ',
        "",
    ),
]


def run_gate() -> tuple[bool, str]:
    """Run the pure self-test gate. Returns (passed, output)."""
    p = subprocess.run(
        ["npx", "tsx", "scripts/compliance/run-pure-selftests.ts"],
        capture_output=True,
        text=True,
        timeout=300,
    )
    out = (p.stdout or "") + (p.stderr or "")
    return (p.returncode == 0 and "ALL PURE SELF-TESTS PASSED" in out), out


def main() -> int:
    if not os.path.exists(TARGET):
        print(f"FATAL: {TARGET} not found (run from the repo root)")
        return 2

    shutil.copy(TARGET, BACKUP)
    original = open(TARGET, encoding="utf-8").read()

    print("=" * 74)
    print("BASELINE: the suite must be GREEN before any mutation is meaningful.")
    print("=" * 74)
    passed, out = run_gate()
    if not passed:
        print("FATAL: baseline is already failing. Nothing below would mean anything.")
        print(out[-2000:])
        return 2
    print("baseline GREEN\n")

    killed, survived, noop = [], [], []

    for mid, desc, find, replace in MUTANTS:
        count = original.count(find)
        if count != 1:
            # The anchor no longer matches the file byte-for-byte. Treat this as
            # a NO-OP (i.e. a campaign failure), never as a silent skip.
            print(f"[{mid}] NO-OP  anchor matched {count} times (expected 1) - {desc}")
            noop.append(mid)
            continue

        mutated = original.replace(find, replace)
        if mutated == original:
            print(f"[{mid}] NO-OP  replacement changed nothing - {desc}")
            noop.append(mid)
            continue

        open(TARGET, "w", encoding="utf-8").write(mutated)
        passed, out = run_gate()
        shutil.copy(BACKUP, TARGET)  # restore immediately, before anything else

        if passed:
            print(f"[{mid}] SURVIVED  <-- A HOLE IN THE GUARDS: {desc}")
            survived.append((mid, desc))
        else:
            # Show the assertion that did the killing, so the kill is auditable
            # rather than merely asserted.
            reason = ""
            for line in out.splitlines():
                if "bank-match-core:" in line:
                    reason = line.strip()[:150]
                    break
            print(f"[{mid}] killed    {desc}")
            if reason:
                print(f"          by: {reason}")
            killed.append(mid)

    # Paranoia: prove the file is byte-identical to how we found it.
    restored = open(TARGET, encoding="utf-8").read()
    identical = restored == original

    print("\n" + "=" * 74)
    print(f"RESULT: {len(killed)} killed / {len(survived)} survived / {len(noop)} no-op")
    print(f"source restored byte-identical: {identical}")
    print("=" * 74)

    if survived:
        print("\nSURVIVORS (each is a real gap in the guards):")
        for mid, desc in survived:
            print(f"  {mid}: {desc}")
    if noop:
        print(f"\nNO-OPS (proved nothing, must be fixed): {', '.join(noop)}")

    final_passed, _ = run_gate()
    print(f"post-campaign suite green: {final_passed}")

    return 0 if (not survived and not noop and identical and final_passed) else 1


if __name__ == "__main__":
    sys.exit(main())

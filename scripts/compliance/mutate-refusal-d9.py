#!/usr/bin/env python3
"""
MUTATION CAMPAIGN for the D8 (sign-off) and D9 (literal escapes) additions to
src/lib/accounting/gl-refusal-core.ts.

Standing rule 15: EVERY TEST MUST BE PROVEN CAPABLE OF FAILING.

Why this is a Python script and not the shell version it replaces: the first
attempt used `perl -0pi -e s/.../` and three "mutants" appeared to SURVIVE. They
had not survived at all - perl never matched the UTF-8 "\u00a7" and the
substitution silently changed nothing. A mutation that does not mutate is not a
passing test OR a failing one, it is NO EVIDENCE, and it reads on screen exactly
like a real result. That is the same class of error as the defects this slice is
about: the reassuring output of a check that never ran.

So every mutation here is verified to have actually altered the file before its
result is believed. A mutation that changes nothing is reported as NO-OP and
fails the campaign.
"""
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
TARGET = ROOT / "src/lib/accounting/gl-refusal-core.ts"
BACKUP = pathlib.Path("/tmp/glrc.mutation.bak")

# (label, find, replace)
MUTANTS = [
    (
        "M1  D9 returns: a literal escape sequence back in the prose",
        "Every \u00a7280E report reads the cost class",
        "Every \\\\u00a7280E report reads the cost class",
    ),
    (
        "M2  the D9 guard regex is defanged",
        "const ESCAPE_IN_PROSE = /\\\\u[0-9a-fA-F]{4}/;",
        "const ESCAPE_IN_PROSE = /$^NEVERMATCHES/;",
    ),
    (
        "M3  GL_BANK_UNRECORDED_ITEMS translation deleted",
        "  GL_BANK_UNRECORDED_ITEMS: {",
        "  GL_BANK_UNRECORDED_ITEMS_DISABLED: {",
    ),
    (
        "M4  GL_BANK_DOES_NOT_TIE translation deleted",
        "  GL_BANK_DOES_NOT_TIE: {",
        "  GL_BANK_DOES_NOT_TIE_DISABLED: {",
    ),
    (
        "M5  GL_BANK_ALREADY_SIGNED_OFF translation deleted",
        "  GL_BANK_ALREADY_SIGNED_OFF: {",
        "  GL_BANK_ALREADY_SIGNED_OFF_DISABLED: {",
    ),
    (
        "M6  the explanation stops saying WHY the difference was zero",
        "cancels itself out",
        "is handled automatically",
    ),
    (
        "M7  the verbatim BARS 3.1.9.15(4) quotation is paraphrased",
        "interest earned, bank fees or charges, NSF checks, and unrecorded deposits",
        "various bank items",
    ),
    (
        "M8  the BARS 3.1.9.15(5) citation is removed",
        "3.1.9.15(5)",
        "3.1.9.99",
    ),
    (
        "M9  the owner's real $4,624,697.31 teaching example is removed",
        "4,624,697.31",
        "1,000.00",
    ),
    (
        "M10 the unrecorded-items title declares victory anyway",
        'title: "This month balances, but it is not finished.",',
        'title: "Everything ties to the penny.",',
    ),
    # M11 originally deleted a PHRASE and "survived". That was the mutant's
    # fault, not the suite's - deleting a phrase from a 1,400-character
    # explanation leaves a 1,360-character explanation, which is still a
    # perfectly good explanation. Rewritten to do what it claimed: reduce the
    # instruction to a stub. That exposed a genuine hole (the guard only
    # required a non-EMPTY string), which is now closed by a substance check.
    (
        "M11 an explanation is gutted to a stub",
        "This is the one worth reading twice, because it is the failure that looks like success.",
        "TODO",
    ),
    (
        "M13 an explanation degrades into a cheerful non-answer",
        "A sign-off is a statement, with your name and a timestamp on it,",
        "Something went wrong, please try again later. Meanwhile,",
    ),
    (
        "M12 a title leaks the raw machine token at the owner",
        'title: "That month has already been signed off.",',
        'title: "GL_BANK_ALREADY_SIGNED_OFF",',
    ),
]


def run_tests() -> bool:
    """True when the self-tests PASS."""
    r = subprocess.run(
        ["npx", "tsx", "-e",
         "require('./src/lib/accounting/gl-refusal-core').__runGlRefusalCoreTests()"],
        cwd=ROOT, capture_output=True, text=True,
    )
    run_tests.last = (r.stdout + r.stderr).strip()
    return r.returncode == 0


def main() -> int:
    shutil.copy(TARGET, BACKUP)
    original = TARGET.read_text(encoding="utf-8")

    print("=== mutation campaign: gl-refusal-core (D8 sign-off + D9 escapes) ===")
    print()

    # A campaign is only meaningful if the suite is GREEN before it starts.
    if not run_tests():
        print("BASELINE IS ALREADY RED - the campaign would prove nothing.")
        print(run_tests.last[-500:])
        return 1
    print("baseline: GREEN\n")

    killed, survived, noop = 0, 0, 0

    for label, find, repl in MUTANTS:
        mutated = original.replace(find, repl, 1)
        if mutated == original:
            print(f"  NO-OP     {label}")
            print("            the mutation changed nothing - NO EVIDENCE either way")
            noop += 1
            continue
        TARGET.write_text(mutated, encoding="utf-8")
        if run_tests():
            print(f"  SURVIVED  {label}")
            print("            <-- REAL HOLE IN THE SUITE")
            survived += 1
        else:
            first = next(
                (ln for ln in run_tests.last.splitlines() if "ASSERTION FAILED" in ln),
                "(no assertion line captured)",
            )
            print(f"  killed    {label}")
            print(f"            {first.strip()[:160]}")
            killed += 1
        TARGET.write_text(original, encoding="utf-8")

    TARGET.write_text(original, encoding="utf-8")

    print()
    print(f"killed: {killed}   survived: {survived}   no-op: {noop}")
    if survived or noop:
        print("CAMPAIGN FAILED")
        return 1
    print("CAMPAIGN PASSED - every mutation was real, and every one was caught")
    return 0


if __name__ == "__main__":
    sys.exit(main())

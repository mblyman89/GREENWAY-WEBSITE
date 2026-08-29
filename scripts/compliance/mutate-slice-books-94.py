#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-94.py

Rule 13c: a test that cannot fail is worse than no test. This breaks the
books-94 drawer poster on purpose, one edit at a time, and demands that the
suite NOTICE. A surviving mutation is a hole in the tests, not a win.

Rule 133g: at least one mutation must SEVER THE DOOR. Here the door is the
reconcile action calling the poster and the manager seeing what the ledger did.
books-93 shipped builders nobody could reach; the whole point of this slice is
that path, so cutting it must be loud.

Usage:  python3 scripts/compliance/mutate-slice-books-94.py
"""
import io
import subprocess
import sys

SERVICE = "src/lib/registers/drawer-posting-service.ts"
ACTIONS = "src/app/admin/registers/actions.ts"
PAGE = "src/app/admin/registers/page.tsx"

# The completeness guard, quoted exactly. Rule 135 lives here: a NULL opening,
# counted or expected figure on a row that calls itself "reconciled" is a
# question, not a zero.
GUARD = """  if (
    session.closing_count_minor === null ||
    session.expected_close_minor === null ||
    session.opening_count_minor === null
  ) {"""

# The reconcile action's own success guard. There are five lines of this exact
# shape in actions.ts, one per action, so it is anchored by the comment that
# follows it -- an ambiguous anchor let this probe cut the WRONG action's guard
# and survive.
RECONCILE_GUARD = (
    "  if (!result.ok) redirect(`${BASE}?error=` + "
    'encodeURIComponent(result.error ?? "Failed."));'
)

TESTS = [
    "tests/compliance/drawer-posting.test.ts",
    "tests/compliance/register-cash.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # ── posting at the wrong moment ─────────────────────────────────────────
    ("1  posts on a blind close, before over/short is known",
     SERVICE,
     '  if (session.status !== "reconciled") {',
     "  if (false) {"),

    ("2  posts on ANY status except reconciled (inverted)",
     SERVICE,
     '  if (session.status !== "reconciled") {',
     '  if (session.status === "reconciled") {'),

    ("3  the skip stops naming the status it saw",
     SERVICE,
     "      `The drawer is ${session.status}, not reconciled. A blind count alone ` +",
     '      "The drawer is not ready. " +'),

    # ── rule 46 / rule 135: absence vs failure ──────────────────────────────
    ("4  an unreadable session is treated as nothing-to-do",
     SERVICE,
     '      kind: "refused",\n      sessionId,\n      code: "TILL_POST_NO_SESSION",',
     '      kind: "skipped",\n      sessionId,\n      code: "TILL_POST_NO_SESSION",'),

    ("5  a missing session is ignored entirely and the post continues",
     SERVICE,
     "  if (!session) {",
     "  if (false && !session) {"),

    ("6  the rule-46 sentence is softened into a shrug",
     SERVICE,
     '        "not the same as a drawer with nothing in it.",',
     '        "Nothing to do.",'),

    ("7  a reconciled row missing its numbers posts anyway",
     SERVICE,
     GUARD,
     "  if (false) {"),

    ("8  only the counted figure is checked, not the expected one",
     SERVICE,
     GUARD,
     "  if (session.closing_count_minor === null) {"),

    ("9  a NULL opening float is not checked (D-72's shape, in cash)",
     SERVICE,
     GUARD,
     "  if (\n    session.closing_count_minor === null ||\n"
     "    session.expected_close_minor === null\n  ) {"),

    # ── the money itself ────────────────────────────────────────────────────
    ("10 cash sales derived without adding back the drops",
     SERVICE,
     "  const cashSalesMinor = session.expected_close_minor - openingMinor + dropsMinor;",
     "  const cashSalesMinor = session.expected_close_minor - openingMinor;"),

    ("11 cash sales derived by subtracting the drops twice",
     SERVICE,
     "  const cashSalesMinor = session.expected_close_minor - openingMinor + dropsMinor;",
     "  const cashSalesMinor = session.expected_close_minor - openingMinor - dropsMinor;"),

    ("12 the opening float is dropped from the derivation",
     SERVICE,
     "  const cashSalesMinor = session.expected_close_minor - openingMinor + dropsMinor;",
     "  const cashSalesMinor = session.expected_close_minor + dropsMinor;"),

    ("13 drops are reported as zero to the builder",
     SERVICE,
     "    dropsMinor,\n    countedMinor: session.closing_count_minor,",
     "    dropsMinor: 0,\n    countedMinor: session.closing_count_minor,"),

    ("14 the whole drawer including the float is swept to the safe",
     SERVICE,
     "    floatStaysInDrawer: true,",
     "    floatStaysInDrawer: false,"),

    ("15 a NULL opening float is defaulted to zero instead of refused",
     SERVICE,
     GUARD + "\n    return {\n      kind: \"refused\",",
     "  if (\n    session.closing_count_minor === null ||\n"
     "    session.expected_close_minor === null\n  ) {"
     "\n    return {\n      kind: \"refused\","),

    # ── TIPS: employee money ────────────────────────────────────────────────
    ("16 TIPS: the tip jar is swept into Undeposited Funds",
     SERVICE,
     "    countedMinor: session.closing_count_minor,",
     "    countedMinor: session.closing_count_minor + (session.tips_minor ?? 0),"),

    ("17 TIPS: tips are added to the float, distorting over/short",
     SERVICE,
     "  const openingMinor = session.opening_count_minor;",
     "  const openingMinor = session.opening_count_minor + (session.tips_minor ?? 0);"),

    # ── the ledger call ─────────────────────────────────────────────────────
    ("18 the entry is submitted as a draft nobody will ever approve",
     SERVICE,
     "      autoPost: true,",
     "      autoPost: false,"),

    ("19 the source ref is dropped, so a retry double-posts",
     SERVICE,
     "      sourceRef,\n      memo: built.journal.memo,",
     "      sourceRef: null,\n      memo: built.journal.memo,"),

    ("20 the ref is keyed on the register, merging two shifts in one day",
     SERVICE,
     "  return `${TILL_CLOSE_SOURCE_PREFIX}:${sessionId}`;",
     "  return `${TILL_CLOSE_SOURCE_PREFIX}:r-1:2026-11-02`;"),

    ("21 the ref loses its prefix and could collide with another event",
     SERVICE,
     "  return `${TILL_CLOSE_SOURCE_PREFIX}:${sessionId}`;",
     "  return `${sessionId}`;"),

    ("22 today's date is posted instead of the business day",
     SERVICE,
     "      journalDate: built.journal.journalDate,",
     '      journalDate: "2099-01-01",'),

    ("23 a ledger rejection is reported as a success",
     SERVICE,
     "  if (!result.ok) {",
     "  if (false) {"),

    ("24 a duplicate is announced as a fresh posting",
     SERVICE,
     '      result.outcome === "duplicate"',
     '      result.outcome === "created"'),

    # ── the builder's own answers must not be flattened ─────────────────────
    ("25 a builder refusal is downgraded to a skip",
     SERVICE,
     '  if (built.kind === "refused") {\n    return {\n      kind: "refused",',
     '  if (built.kind === "refused") {\n    return {\n      kind: "skipped",'),

    ("26 a no_entry outcome is reported as a refusal (rule 136)",
     SERVICE,
     '  if (built.kind === "no_entry") {',
     "  if (false) {"),

    ("27 the builder's refusal code is replaced with a generic one",
     SERVICE,
     "      code: built.code,\n      message: built.explanation,\n    };\n  }\n\n  if (built.kind === \"no_entry\")",
     "      code: \"ERROR\",\n      message: built.explanation,\n    };\n  }\n\n  if (built.kind === \"no_entry\")"),

    # ── the banner sentences ────────────────────────────────────────────────
    ("28 skipped and refused collapse into the same sentence",
     SERVICE,
     '    case "refused":\n      return `Not posted: ${o.message}`;',
     '    case "refused":\n      return "";'),

    ("29 a ledger failure reads like a success in the banner",
     SERVICE,
     '      return `The ledger refused the entry: ${o.message}`;',
     '      return "Done.";'),

    ("30 the journal number is dropped from the confirmation",
     SERVICE,
     '        : `Posted to the ledger${o.journalNo != null ? ` as entry #${o.journalNo}` : ""}.`;',
     '        : "Posted to the ledger.";'),

    # ── DOOR-SEVERING (rule 133g) ───────────────────────────────────────────
    ("31 DOOR: the reconcile action stops calling the poster",
     ACTIONS,
     "  const posted = await postDrawerCloseForSession(sessionId);",
     '  const posted = { kind: "skipped" as const, sessionId, code: "X", message: "x" };'),

    ("32 DOOR: the post runs BEFORE the reconcile is known to have worked",
     ACTIONS,
     RECONCILE_GUARD + "\n\n  // Reconcile is the first moment",
     "\n  // Reconcile is the first moment"),

    ("33 DOOR: the outcome never reaches the redirect",
     ACTIONS,
     "  redirect(\n    `${BASE}?reconciled=${result.overShortMinor ?? 0}&posted=` +\n      encodeURIComponent(describeDrawerPostOutcome(posted)),\n  );",
     "  redirect(`${BASE}?reconciled=${result.overShortMinor ?? 0}`);"),

    ("34 DOOR: the outcome is not written to the audit log (rule 134)",
     ACTIONS,
     "    after: { ledger_kind: posted.kind, ledger_code: posted.code },",
     ""),

    ("35 DOOR: only the kind is audited, not the code that explains it",
     ACTIONS,
     "    after: { ledger_kind: posted.kind, ledger_code: posted.code },",
     "    after: { ledger_kind: posted.kind },"),

    ("36 DOOR: the screen stops showing what the ledger did",
     PAGE,
     "        {sp.posted ? (\n          <span className=\"mt-1 block text-xs opacity-80\">{sp.posted}</span>\n        ) : null}",
     ""),
]


def run_tests() -> bool:
    proc = subprocess.run(
        ["./node_modules/.bin/vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    caught, survived = 0, []

    for label, path, find, repl in MUTATIONS:
        original = io.open(path, encoding="utf-8").read()
        if original.count(find) < 1:
            print(f"  ERROR  {label}\n         anchor not found in {path}")
            print("         The probe is stale. FAILING rather than skipping (rule 48).")
            return 2

        mutated = original.replace(find, repl, 1)
        io.open(path, "w", encoding="utf-8").write(mutated)
        try:
            if run_tests():
                survived.append(label)
                print(f"  SURVIVED  {label}")
            else:
                caught += 1
                print(f"  caught    {label}")
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

    total = len(MUTATIONS)
    print(f"\n{caught}/{total} mutations caught")
    if survived:
        print("\nSURVIVORS (these are holes in the tests):")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("Every deliberate break was noticed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

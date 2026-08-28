#!/usr/bin/env python3
"""
mutate-slice-books-89.py  --  can the books-89 tests actually fail?

Standing rule 13c: a test that cannot fail is worse than no test.

This slice has two halves and the probe covers both.

  1. THE ATM SETTLEMENT DOOR (D-40). Michael asked, in these words, "Please make
     sure that you wire everything end to end this time." That became standing
     rule 133, and rule 133(g) says the mutation probe MUST include severing the
     door. Mutation 1 does exactly that: it leaves every file in place, leaves
     every unit test passing on its own terms, and simply stops the button from
     calling the service. If that mutation survives, this slice has shipped the
     same defect it was written to fix.

  2. THE $5,000 POLICY CHANGE. Michael asked for the block off and the flag on.
     Those are one column apart in migration 0211, and the flag is the half that
     is easy to lose silently, because losing it breaks nothing -- it just stops
     warning him. Mutations 12 and 13 attack that half from both sides.

Usage:  python3 scripts/compliance/mutate-slice-books-89.py
Exit 0 only if EVERY mutation is caught.
"""
import io
import re
import subprocess
import sys

TESTS = [
    "tests/compliance/posting-services-are-reachable.test.ts",
    "tests/compliance/atm-settlement-service.test.ts",
    "tests/compliance/owner-operator-self-approval.test.ts",
    "tests/compliance/ledger-census.test.ts",
]

ACTION = "src/app/admin/atm/actions.ts"
PAGE = "src/app/admin/atm/page.tsx"
SERVICE = "src/lib/atm/atm-settlement-service.ts"
TRAP = "tests/compliance/posting-services-are-reachable.test.ts"
CENSUS = "src/lib/accounting/ledger-census-data.ts"
M0211 = "supabase/migrations/0211_owner_operator_self_approval.sql"

MUTATIONS = [
    # ---- RULE 133(g): SEVER THE DOOR ----------------------------------------
    # The exact shape of D-40 and D-70. Everything still compiles, the service
    # still has its own green suite, and nothing on earth can reach it.
    (
        "the door is severed -- the button no longer calls the service (this IS D-40/D-70)",
        ACTION,
        "  const result = await postAtmSettlements();",
        "  const result = { ok: true, scanned: 0, recorded: 0, duplicates: 0, "
        "refused: 0, outcomes: [], error: null };",
    ),
    (
        "the panel is removed from the page, so the button exists but is on no screen",
        PAGE,
        "        <PostAtmSettlementsPanel />",
        "        <span />",
    ),
    (
        "the trap entry is deleted, so the reachability gate stops watching this poster",
        TRAP,
        """  {
    file: "src/lib/atm/atm-settlement-service.ts",
    entry: "postAtmSettlements",
    door: "the owner pressing a button on /admin/atm?tab=transactions (books-89, D-40)",
  },
""",
        "",
    ),
    # ---- the owner gate ------------------------------------------------------
    (
        "the books-access gate is removed, so any signed-in user can write to the ledger",
        ACTION,
        "  const session = await requireBooksAccess();",
        '  const session = { userId: "anonymous" };',
    ),
    # ---- refusals must reach the screen -------------------------------------
    (
        "a day the core refused is sent to the ledger anyway",
        SERVICE,
        "    if (p.refusal !== null) {",
        "    if (p.refusal !== null && false) {",
    ),
    (
        "the core's own words are swallowed and replaced with a generic refusal",
        SERVICE,
        "        message: p.refusal,",
        '        message: "Refused.",',
    ),
    (
        "the fewer-than-two-lines guard can never fire",
        SERVICE,
        "    if (p.lines.length < 2) {",
        "    if (p.lines.length < 0) {",
    ),
    (
        "a ledger rejection is relabelled CORE, hiding which layer said no",
        SERVICE,
        "        code: result.code,",
        '        code: "CORE",',
    ),
    # ---- what gets written --------------------------------------------------
    (
        "source_kind becomes 'manual', which migration 0172 check (6) forbids for 10300",
        SERVICE,
        "        sourceKind: ATM_SOURCE_KIND,",
        '        sourceKind: "manual",',
    ),
    (
        "the entry auto-posts, skipping the physical count Michael is supposed to make",
        SERVICE,
        "        sourceRef: p.sourceRef,\n        memo: p.memo,",
        "        sourceRef: p.sourceRef,\n        autoPost: true,\n        memo: p.memo,",
    ),
    (
        "every line's sign is flipped, turning debits into credits",
        SERVICE,
        "          amountCents: l.amountCents,",
        "          amountCents: -l.amountCents,",
    ),
    (
        "a duplicate is counted as newly recorded, so re-pressing inflates the count",
        SERVICE,
        '    if (result.outcome === "duplicate") duplicates += 1;',
        "    if (false) duplicates += 1;",
    ),
    # ---- THE $5,000 POLICY: BLOCK OFF, FLAG ON ------------------------------
    (
        "0211 leaves the block in place, so Michael still cannot approve his own entries",
        M0211,
        "   set allow_self_approval  = true,",
        "   set allow_self_approval  = false,",
    ),
    (
        "0211 also raises the threshold, silently killing the warning Michael asked to keep",
        M0211,
        "       updated_at           = now()",
        "       threshold_cents      = 100000000,\n       updated_at           = now()",
    ),
    # ---- the census must not overstate --------------------------------------
    (
        "the census claims a poster that is not named, so the door cannot be audited",
        CENSUS,
        '    poster: "src/lib/atm/atm-settlement-service.ts#postAtmSettlements",',
        "    poster: null,",
    ),
]


def run_tests():
    p = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(.*)", out)
    return p.returncode, (m.group(1).strip() if m else "no summary line")


def main():
    print("=" * 72)
    print("books-89 mutation probe")
    print("=" * 72)

    code, summary = run_tests()
    if code != 0:
        print(f"BASELINE IS RED ({summary}). Fix the suite before probing it.")
        return 1
    print(f"baseline green: {summary}\n")

    survivors = []
    for i, (label, path, old, new) in enumerate(MUTATIONS, 1):
        src = io.open(path, encoding="utf-8").read()
        n = src.count(old)
        if n != 1:
            print(f"[{i:2}/{len(MUTATIONS)}] ANCHOR MISS ({n}x) in {path}")
            print(f"          {label}")
            survivors.append(f"{label} (anchor {n}x)")
            continue

        io.open(path, "w", encoding="utf-8").write(src.replace(old, new))
        try:
            code, summary = run_tests()
        finally:
            io.open(path, "w", encoding="utf-8").write(src)

        if code == 0:
            print(f"[{i:2}/{len(MUTATIONS)}] SURVIVED  {label}")
            survivors.append(label)
        else:
            print(f"[{i:2}/{len(MUTATIONS)}] caught    {label}")

    print("=" * 72)
    caught = len(MUTATIONS) - len(survivors)
    print(f"{caught}/{len(MUTATIONS)} caught")
    if survivors:
        print("\nSURVIVORS - the suite cannot tell these apart from correct code:")
        for s in survivors:
            print(f"  - {s}")
        return 1
    print("every mutation was caught.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

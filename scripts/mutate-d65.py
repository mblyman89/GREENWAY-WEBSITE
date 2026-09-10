#!/usr/bin/env python3
"""
Mutation harness for D-65 — "the connections survive the reset".

A passing test suite proves nothing on its own; it only proves the tests ran.
This breaks the fix on purpose, one change at a time, and requires the suite to
FAIL each time. A mutant that survives is a test that was decorative.

Every mutation is anchor-verified BEFORE it is written (the exact text must
appear exactly once), and every file is restored from an in-memory snapshot in
a finally block, so an interrupted run cannot leave the repo modified.
"""
import subprocess, sys, os

REPO = "/workspace/repo"
CORE = "src/lib/accounting/factory-reset-core.ts"
SQL = "supabase/migrations/0209_factory_reset.sql"
TEST = "tests/compliance/factory-reset-core.test.ts"

# (id, description, file, [(old, new), ...])
MUTANTS = [
    ("M01", "atm_connection silently falls back to the WIPE family", CORE, [
        ('    table: "atm_connection",\n    disposition: "KEEP",',
         '    table: "atm_connection",\n    disposition: "WIPE",'),
    ]),
    ("M02", "plaid_items becomes WIPE — the bank link is destroyed", CORE, [
        ('    table: "plaid_items",\n    disposition: "KEEP",',
         '    table: "plaid_items",\n    disposition: "WIPE",'),
    ]),
    ("M03", "plaid_accounts becomes WIPE — the role mapping is lost", CORE, [
        ('    table: "plaid_accounts",\n    disposition: "KEEP",',
         '    table: "plaid_accounts",\n    disposition: "WIPE",'),
    ]),
    ("M04", "manual_loans becomes WIPE — hand-typed terms destroyed", CORE, [
        ('    table: "manual_loans",\n    disposition: "KEEP",',
         '    table: "manual_loans",\n    disposition: "WIPE",'),
    ]),
    ("M05", "0209 deletes plaid_items again", SQL, [
        ("  -- plaid_accounts and plaid_items are KEPT (D-65).",
         "  delete from public.plaid_items where true;\n  -- plaid_accounts and plaid_items are KEPT (D-65)."),
    ]),
    ("M06", "0209 deletes atm_connection again", SQL, [
        ("  -- atm_connection is KEPT (D-65)",
         "  delete from public.atm_connection where true;\n  -- atm_connection is KEPT (D-65)"),
    ]),
    ("M07", "0209 deletes manual_loans again", SQL, [
        ("  -- manual_loans is KEPT (D-65)",
         "  delete from public.manual_loans where true;\n  -- manual_loans is KEPT (D-65)"),
    ]),
    # ── The trap. These are the ones that matter most: they leave the
    # connection intact, so every "is it KEEP?" test still passes, while
    # permanently losing the history. If these survive, the tests are theatre.
    ("M08", "the Plaid cursor is NOT rewound — history silently never returns", SQL, [
        ("     set transactions_cursor   = null,\n         last_successful_sync  = null",
         "     set last_successful_sync  = last_successful_sync"),
    ]),
    ("M09", "the ATM sync timestamp is not cleared", SQL, [
        ("     set last_sync_at = null,\n         last_error   = null",
         "     set last_error   = last_error"),
    ]),
    ("M10", "the cursor rewind is 'fixed' by deleting the item instead", SQL, [
        ("  update public.plaid_items\n     set transactions_cursor   = null,",
         "  delete from public.plaid_items where true;\n  update public.plaid_items\n     set transactions_cursor   = null,"),
    ]),
    ("M11", "the documented cursor list is emptied — the note stops matching", CORE, [
        ("export const KEPT_CONNECTION_CURSOR_RESETS = [",
         "export const KEPT_CONNECTION_CURSOR_RESETS = [] as const;\nconst _UNUSED_CURSORS = ["),
    ]),
    ("M12", "a cursor entry names a column that does not exist", CORE, [
        ('columns: ["transactions_cursor", "last_successful_sync"],',
         'columns: ["transactions_cursor", "column_that_does_not_exist"],'),
    ]),
    # ── Keeping the connection must not become keeping the DATA.
    ("M13", "the whole plaid_ family flips to KEEP — test data survives", CORE, [
        ('    prefix: "plaid_",\n    disposition: "WIPE",',
         '    prefix: "plaid_",\n    disposition: "KEEP",'),
    ]),
    ("M14", "the whole atm_ family flips to KEEP", CORE, [
        ('    prefix: "atm_",\n    disposition: "WIPE",',
         '    prefix: "atm_",\n    disposition: "KEEP",'),
    ]),
    ("M15", "0209 stops deleting plaid_transactions", SQL, [
        ("  delete from public.plaid_transactions where true;", "  "),
    ]),
    ("M16", "0209 stops deleting atm_settlements", SQL, [
        ("  delete from public.atm_settlements where true;", "  "),
    ]),
    ("M17", "the briefing stops disclosing the kept connections", CORE, [
        ('      "Your connections are also kept, so a rehearsal never costs you a re-link',
         '      "Nothing to report here. ("'),
    ]),
]

EQUIVALENT_MUTANTS = {
    # None. Every mutant above changes observable behaviour of the reset.
}


def read(p):
    with open(os.path.join(REPO, p), encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with open(os.path.join(REPO, p), "w", encoding="utf-8") as f:
        f.write(s)


def main():
    files = sorted({m[2] for m in MUTANTS})
    snapshot = {p: read(p) for p in files}
    killed, survived, anchor_miss = [], [], []

    try:
        for mid, desc, path, edits in MUTANTS:
            original = snapshot[path]
            text = original
            ok = True
            for old, new in edits:
                if text.count(old) != 1:
                    anchor_miss.append((mid, desc, f"anchor count={text.count(old)}"))
                    ok = False
                    break
                text = text.replace(old, new, 1)
            if not ok:
                continue

            write(path, text)
            try:
                r = subprocess.run(
                    ["npx", "vitest", "run", TEST],
                    cwd=REPO, capture_output=True, text=True, timeout=600,
                )
                if r.returncode != 0:
                    killed.append((mid, desc))
                    print(f"KILLED   {mid}  {desc}", flush=True)
                else:
                    survived.append((mid, desc))
                    print(f"SURVIVED {mid}  {desc}", flush=True)
            finally:
                write(path, original)
    finally:
        for p, s in snapshot.items():
            write(p, s)

    print("\n" + "=" * 70)
    print(f"killed {len(killed)} / {len(MUTANTS)}   survived {len(survived)}   anchor-miss {len(anchor_miss)}")
    for mid, desc, why in anchor_miss:
        print(f"  ANCHOR MISS {mid}: {desc} ({why})")
    for mid, desc in survived:
        print(f"  SURVIVOR    {mid}: {desc}")
    return 0 if not survived and not anchor_miss else 1


if __name__ == "__main__":
    sys.exit(main())

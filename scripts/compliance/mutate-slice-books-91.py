#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-91.py

MUTATION PROBE for books-91: the worked-example specimen and the durable
record of a finalize's books outcome (D-71).

A passing test suite proves nothing on its own. This breaks the slice on
purpose, one edit at a time, and demands that something FAILS. A mutation that
survives is a test that was decoration.

Rule 133g: the probe MUST include severing the door. Mutations 12 and 13 cut
the specimen off the screen and cut the poster out of the finalize; if the
suite still passes with those applied, the "Michael can see it" claim is false.

Run:  python3 scripts/compliance/mutate-slice-books-91.py
"""

import io
import subprocess
import sys

CORE = "src/lib/accounting/journal-specimen-core.ts"
TSX = "src/app/admin/books/drafts/JournalSpecimen.tsx"
PAGE = "src/app/admin/books/drafts/page.tsx"
ACTIONS = "src/app/admin/inventory/intake/actions.ts"

# (label, path, find, replace)
MUTATIONS = [
    (
        "specimen credits the wrong side (payable becomes a debit)",
        CORE,
        "    creditText: l.amountCents < 0 ? formatCents(-l.amountCents) : \"\",",
        "    creditText: \"\",",
    ),
    (
        "specimen stops balancing (drop the payable line's sign)",
        CORE,
        "  const signedSum = lines.reduce((s, l) => s + l.amountCents, 0);",
        "  const signedSum = 0;",
    ),
    (
        "specimen total counts credits too",
        CORE,
        "  const debitTotal = lines.reduce((s, l) => (l.amountCents > 0 ? s + l.amountCents : s), 0);",
        "  const debitTotal = lines.reduce((s, l) => s + Math.abs(l.amountCents), 0);",
    ),
    (
        "a lot's unit cost is quietly changed",
        CORE,
        "    unit_cost_minor_units: 87550,",
        "    unit_cost_minor_units: 87551,",
    ),
    (
        "a lot's quantity is quietly changed",
        CORE,
        "    received_qty: 24,",
        "    received_qty: 25,",
    ),
    (
        "the button label is hard-coded instead of derived from the exempt list",
        CORE,
        "    buttonLabel: exempt ? \"Post to the ledger\" : \"Approve and post\",",
        "    buttonLabel: \"Approve and post\",",
    ),
    (
        "an account loses its readable name",
        CORE,
        "  \"20010\": \"Inventory — Flower\",",
        "",
    ),
    (
        "the ledger view drops rows",
        CORE,
        "  const ledgerRows: SpecimenLedgerRow[] = lines.map((l) => ({",
        "  const ledgerRows: SpecimenLedgerRow[] = lines.slice(0, 1).map((l) => ({",
    ),
    (
        "a credit balance is shown with a minus sign instead of brackets",
        CORE,
        "    balanceText: formatCents(l.amountCents),",
        "    balanceText: String(l.amountCents / 100),",
    ),
    (
        "the specimen stops saying it is not real money",
        CORE,
        "  \"This is a worked example, not your books. Nothing on this page has been \" +",
        "  \"An example. \" +",
    ),
    (
        "the specimen swallows the engine's refusal",
        TSX,
        "            {s.message}",
        "            {\"\"}",
    ),
    # ── RULE 133g: SEVER THE DOOR ──────────────────────────────────────────
    (
        "DOOR SEVERED: the drafts page no longer renders the specimen",
        PAGE,
        "      <JournalSpecimen />\n\n      {!result.ok ? (",
        "      {!result.ok ? (",
    ),
    (
        "DOOR SEVERED: finalize no longer calls the vendor-bill poster",
        ACTIONS,
        "      const billed = await postManifestVendorBill(manifestId, invoiceDate);",
        "      const billed = { ok: true, code: \"BILL_OK\", message: \"\" };",
    ),
    # ── D-71: the durable record ───────────────────────────────────────────
    (
        "the refusal is no longer written to the timeline",
        ACTIONS,
        "        billed.ok ? \"vendor_bill_posted\" : \"vendor_bill_refused\",",
        "        \"vendor_bill_posted\",",
    ),
    (
        "the timeline note loses the refusal code and message",
        ACTIONS,
        "        `${billed.code}: ${billed.message}`,",
        "        \"done\",",
    ),
    (
        "a finalize that activates nothing goes back to silent",
        ACTIONS,
        "      \"vendor_bill_skipped\",",
        "      \"noop\",",
    ),
    (
        "the throw path stops logging",
        ACTIONS,
        "      await logManifestEvent(manifestId, \"vendor_bill_refused\", reason, session.userId);",
        "      void reason;",
    ),
    (
        "the on-screen banner is dropped in favour of only the timeline",
        ACTIONS,
        "        : `&booksError=${encodeURIComponent(billed.message.slice(0, 300))}`;",
        "        : \"\";",
    ),
]


def run_tests() -> bool:
    """True when the suite passes. Runs the slice's own file, fast."""
    r = subprocess.run(
        ["./node_modules/.bin/vitest", "run", "tests/compliance/journal-specimen.test.ts"],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def main() -> int:
    # Sanity: the suite must PASS before any mutation, or every "caught" below
    # is meaningless (rule 13c).
    if not run_tests():
        print("BASELINE FAILS - fix the suite before probing.")
        return 2
    print("baseline: PASS\n")

    caught = 0
    missed = []

    for i, (label, path, find, repl) in enumerate(MUTATIONS, 1):
        original = io.open(path, encoding="utf-8").read()
        n = original.count(find)
        if n != 1:
            print(f"{i:2d}. ANCHOR MISS ({n}x) - {label}")
            missed.append(label + " [anchor]")
            continue

        io.open(path, "w", encoding="utf-8").write(original.replace(find, repl))
        try:
            passed = run_tests()
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

        if passed:
            print(f"{i:2d}. SURVIVED  - {label}")
            missed.append(label)
        else:
            print(f"{i:2d}. caught    - {label}")
            caught += 1

    total = len(MUTATIONS)
    print(f"\n{caught}/{total} caught")
    if missed:
        print("\nSURVIVORS (each one is a test that proves nothing):")
        for m in missed:
            print(f"  - {m}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

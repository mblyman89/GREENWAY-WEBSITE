#!/usr/bin/env python3
"""
mutate-bo-tax.py — prove the B&O gates can actually fail.

Standing rule 15: a test that cannot fail proves nothing. Standing rule 39: a
verifier that cannot see something approves it. So every claim the B&O tests
make gets attacked here, one mutation at a time, and each mutation must turn
the suite RED. A mutation that stays green is a hole in the gate, not a
curiosity.

Each mutant targets a specific, plausible mistake a future maintainer could
make in good faith — not gibberish. The two that matter most:
  M1  store the rate in basis points (the unit error rule 114 exists for)
  M6  book B&O as a liability only, the way sales tax is booked (his point)

Usage:  python3 scripts/mutate-bo-tax.py
"""

import hashlib
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CORE = REPO / "src/lib/accounting/bo-tax-core.ts"
TEST = "tests/compliance/bo-tax-core.test.ts"

# (name, file, find, replace, why this is a realistic mistake)
MUTANTS = [
    (
        "M1 rate rounded to integer basis points",
        CORE,
        "retailing: 4710,",
        "retailing: 4700,",
        "Someone 'normalises' B&O onto the existing bps unit. Understates his "
        "filed return by $1.68/month, forever.",
    ),
    (
        "M2 rate rounded UP to 48 bps",
        CORE,
        "retailing: 4710,",
        "retailing: 4800,",
        "The other direction of the same unit error. Overstates by $15.16/month.",
    ),
    (
        "M3 ATM taxed at the retailing rate",
        CORE,
        "service_and_other: 15000,",
        "service_and_other: 4710,",
        "One 'B&O rate' reused for both classifications.",
    ),
    (
        "M4 the two rates swapped",
        CORE,
        "  retailing: 4710, // 0.004710",
        "  retailing: 15000, // 0.004710",
        "Copy/paste between two adjacent lines.",
    ),
    (
        "M5 rounding changed to truncation",
        CORE,
        "return sign * Math.round(product / RATE_MILLIONTHS_SCALE);",
        "return sign * Math.floor(product / RATE_MILLIONTHS_SCALE);",
        "'Truncating is safer than rounding' — but DOR rounds, and the return "
        "would stop tying.",
    ),
    (
        "M6 B&O booked as a liability only, like sales tax",
        CORE,
        "      accountCode: ACCOUNT_BO_EXPENSE,\n      debitCents: boTaxCents,",
        "      accountCode: ACCOUNT_BO_PAYABLE,\n      debitCents: boTaxCents,",
        "THE BIG ONE. Treating B&O like trust money. Balances fine, and "
        "overstates profit by the full B&O every month.",
    ),
    (
        "M7 expense side deleted from the accrual",
        CORE,
        "export function recognisesBoExpense(lines: readonly JournalLine[]): boolean {\n  return lines.some((l) => l.accountCode === ACCOUNT_BO_EXPENSE && l.debitCents > 0);",
        "export function recognisesBoExpense(lines: readonly JournalLine[]): boolean {\n  return true;",
        "The expense CHECK is neutered while the entry stays right — a verifier "
        "that always says yes (rule 39).",
    ),
    (
        "M8 payment re-expenses the tax",
        CORE,
        "      accountCode: ACCOUNT_BO_PAYABLE,\n      debitCents: boTaxCents,\n      creditCents: 0,\n      memo: `Clearing the ${periodLabel} B&O payable.",
        "      accountCode: ACCOUNT_BO_EXPENSE,\n      debitCents: boTaxCents,\n      creditCents: 0,\n      memo: `Clearing the ${periodLabel} B&O payable.",
        "Double-counting the expense on payment.",
    ),
    (
        # NOTE: this mutant's `find` text was rewritten on books-59 after the
        # refusal-code hardening changed the guard's body. The FIRST re-run
        # reported it as "pattern not found", which the harness correctly
        # treats as a defect rather than a pass -- a mutant that cannot be
        # applied proves nothing, and silently counting it as caught would be
        # exactly the kind of blind verifier rule 39 warns about.
        "M9 non-integer bps silently accepted",
        CORE,
        "  if (!Number.isInteger(bps)) {",
        "  if (false) {",
        "Loosening a guard to make a caller compile.",
    ),
    (
        "M10 negative gross receipts absorbed",
        CORE,
        "  if (grossCents < 0) {",
        "  if (false) {",
        "Michael's real history includes negative balances that nobody refused.",
    ),
    (
        "M11 deductions allowed to exceed gross",
        CORE,
        "  if (deductionsCents > grossCents) {",
        "  if (false) {",
        "Would produce a negative taxable amount on a government return.",
    ),
    (
        "M12 zero accrual posts an empty entry",
        CORE,
        "  if (boTaxCents <= 0) {",
        "  if (false) {",
        "Silent no-op instead of a loud refusal (rule 48).",
    ),
    (
        "M13 the overflow guard removed",
        CORE,
        "  if (!Number.isSafeInteger(product)) {",
        "  if (false) {",
        "Rule 40: an unreachable guard is an untested guard — so prove this one "
        "is reachable.",
    ),
    (
        "M14 the ATM line dropped from the return",
        CORE,
        "  if (atmSurchargeCents > 0) {",
        "  if (false) {",
        "The whole service classification silently disappears; only the total "
        "would reveal it.",
    ),
    (
        "M15 the ATM entity relabelled as the store",
        CORE,
        'service_and_other: "atm",',
        'service_and_other: "greenway",',
        "Surcharge income attributed to the wrong entity, breaking the "
        "four-entity separation.",
    ),
    (
        "M16 millionths scale wrong by 10x",
        CORE,
        "export const RATE_MILLIONTHS_SCALE = 1_000_000;",
        "export const RATE_MILLIONTHS_SCALE = 100_000;",
        "A units typo that changes every figure by an order of magnitude.",
    ),
    (
        "M17 trust total quietly includes B&O",
        CORE,
        "  const trustTaxCents = stateSalesTaxCents + localSalesTaxCents;",
        "  const trustTaxCents = stateSalesTaxCents + localSalesTaxCents + boTaxCents;",
        "Blurs the exact distinction Michael asked for — B&O folded back into "
        "trust money.",
    ),
    (
        "M18 state and local collapsed into one figure",
        CORE,
        "  const localSalesTaxCents = applyRateMillionths(\n    retailBaseCents,\n    bpsToMillionths(localSalesRateBps),\n  );",
        "  const localSalesTaxCents = stateSalesTaxCents;",
        "'Three types' becomes two. He asked for all three separately.",
    ),
]


def run_suite():
    r = subprocess.run(
        ["npx", "vitest", "run", TEST, "--reporter=dot"],
        cwd=REPO,
        capture_output=True,
        text=True,
        env={**__import__("os").environ, "NODE_OPTIONS": "--max-old-space-size=3200"},
    )
    return r.returncode, (r.stdout + r.stderr)


def main():
    print("=" * 78)
    print("B&O MUTATION CAMPAIGN — every gate must be provably failable (rule 15)")
    print("=" * 78)

    baselines = {}
    for _, path, _, _, _ in MUTANTS:
        if path not in baselines:
            baselines[path] = path.read_text()
    md5_before = {p: hashlib.md5(t.encode()).hexdigest() for p, t in baselines.items()}

    print("\nBASELINE: suite must be GREEN before mutating.")
    code, _ = run_suite()
    if code != 0:
        print("  BASELINE IS RED. Aborting — mutation results would be meaningless.")
        return 1
    print("  baseline GREEN.\n")

    caught, escaped = [], []
    for i, (name, path, find, repl, why) in enumerate(MUTANTS, 1):
        original = baselines[path]
        if find not in original:
            print(f"[{i:2d}/{len(MUTANTS)}] {name}")
            print(f"         !! PATTERN NOT FOUND — mutation could not be applied")
            print(f"         This is itself a defect: the test cannot be trusted.")
            escaped.append((name, "pattern not found"))
            continue

        path.write_text(original.replace(find, repl, 1))
        code, out = run_suite()
        path.write_text(original)  # restore immediately

        failed_line = ""
        for line in out.splitlines():
            if "Tests" in line and "failed" in line:
                failed_line = line.strip()
                break

        status = "CAUGHT" if code != 0 else "ESCAPED"
        print(f"[{i:2d}/{len(MUTANTS)}] {name}")
        print(f"         why: {why}")
        print(f"         {status}  {failed_line}")
        (caught if code != 0 else escaped).append((name, failed_line))

    for p, t in baselines.items():
        p.write_text(t)
    md5_after = {p: hashlib.md5(p.read_text().encode()).hexdigest() for p in baselines}

    print("\n" + "=" * 78)
    print(f"RESULT: {len(caught)} caught, {len(escaped)} escaped, of {len(MUTANTS)}")
    print("=" * 78)
    for name, detail in escaped:
        print(f"  ESCAPED: {name}  ({detail})")

    print("\nBASELINE RESTORATION (md5 must match):")
    all_ok = True
    for p in baselines:
        ok = md5_before[p] == md5_after[p]
        all_ok = all_ok and ok
        print(f"  {'OK  ' if ok else 'DIRTY'} {p.relative_to(REPO)}")
    if not all_ok:
        print("  !! A FILE WAS LEFT MUTATED. Fix before committing.")
        return 1

    print("\nFinal confirmation: suite green again after restoration.")
    code, _ = run_suite()
    print("  " + ("GREEN" if code == 0 else "RED — investigate"))
    return 0 if (not escaped and code == 0) else 1


if __name__ == "__main__":
    sys.exit(main())

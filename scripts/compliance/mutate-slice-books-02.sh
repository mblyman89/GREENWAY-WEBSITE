#!/usr/bin/env bash
#
# scripts/compliance/mutate-slice-books-02.sh   (slice books-02)
#
# MUTATION TESTING FOR THE CONVERSION.
#
# A green test suite proves the tests ran. It does not prove they would have
# NOTICED anything. This script deliberately breaks `cutover-core.ts` in ways a
# real mistake would break it, and demands that the tests fail every time. A
# mutant that SURVIVES is a hole in the test suite, not a curiosity.
#
# Three NEUTRAL CONTROLS are included at the end — changes that alter the source
# without altering behaviour. Those MUST survive. If a control dies, the suite is
# asserting on something cosmetic (comment wording, whitespace) and would break
# on any harmless edit, which is its own kind of bug.
#
# ---------------------------------------------------------------------------
# WHY THE RESTORE IS DONE WITH BYTES AND NOT WITH GIT
# ---------------------------------------------------------------------------
# The first version of the slice-01 harness restored with `git checkout -- FILE`.
# That was actively dangerous: it silently reverted REAL uncommitted work on
# tracked files, and did nothing at all for untracked new files, so mutants
# accumulated on top of each other. This version snapshots the exact bytes to a
# temp directory and restores from there, then VERIFIES byte-identity after
# every single mutation before continuing.
#
# Usage:  bash scripts/compliance/mutate-slice-books-02.sh
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

CORE="src/lib/accounting/cutover-core.ts"
TEST="tests/compliance/cutover-core.test.ts"

SNAP="$(mktemp -d)"
trap 'cp -p "$SNAP/$(basename "$CORE")" "$CORE" 2>/dev/null; rm -rf "$SNAP"' EXIT

cp -p "$CORE" "$SNAP/$(basename "$CORE")"

PASSED=0
FAILED=0
NOOPS=0

restore() {
  cp -p "$SNAP/$(basename "$CORE")" "$CORE"
}

verify_restored() {
  if ! cmp -s "$CORE" "$SNAP/$(basename "$CORE")"; then
    echo "FATAL: $CORE was not restored byte-identically. Aborting before more damage."
    exit 2
  fi
}

# run_gate: the tests plus the embedded self-test runner. Both must be clean for
# a mutant to count as SURVIVED, because a mutant caught only by the self-tests
# is still caught.
run_gate() {
  npx vitest run "$TEST" >/dev/null 2>&1 || return 1
  npx tsx -e "
    import { __runCutoverCoreTests } from './src/lib/accounting/cutover-core';
    __runCutoverCoreTests();
  " >/dev/null 2>&1 || return 1
  return 0
}

# mutate <label> <expectation: die|survive> <sed-expression>
mutate() {
  local label="$1" expect="$2" expr="$3"

  restore
  perl -0pi -e "$expr" "$CORE"

  if cmp -s "$CORE" "$SNAP/$(basename "$CORE")"; then
    echo "  !! NO-OP  $label  (the pattern did not match — fix the harness)"
    NOOPS=$((NOOPS + 1))
    restore
    verify_restored
    return
  fi

  if run_gate; then
    # gate passed => mutant SURVIVED
    if [ "$expect" = "survive" ]; then
      echo "  ok  (control survived)  $label"
      PASSED=$((PASSED + 1))
    else
      echo "  XX  SURVIVED            $label   <-- TEST SUITE HOLE"
      FAILED=$((FAILED + 1))
    fi
  else
    if [ "$expect" = "die" ]; then
      echo "  ok  (killed)            $label"
      PASSED=$((PASSED + 1))
    else
      echo "  XX  CONTROL DIED        $label   <-- suite asserts on something cosmetic"
      FAILED=$((FAILED + 1))
    fi
  fi

  restore
  verify_restored
}

echo "=============================================================="
echo " MUTATION CAMPAIGN — slice books-02 (the conversion)"
echo "=============================================================="
echo

echo "-- THE DATES ------------------------------------------------"

mutate "cut-over moved to 2026-12-01" die \
  's/export const CUTOVER_DATE: string = "2026-11-01";/export const CUTOVER_DATE: string = "2026-12-01";/'

mutate "opening balance dated ON the cut-over, not the day before" die \
  's/export const OPENING_BALANCE_DATE: string = "2026-10-31";/export const OPENING_BALANCE_DATE: string = "2026-11-01";/'

mutate "opening balance reverted to the old 2025-12-31" die \
  's/export const OPENING_BALANCE_DATE: string = "2026-10-31";/export const OPENING_BALANCE_DATE: string = "2025-12-31";/'

mutate "parallel run ends a month early" die \
  's/export const PARALLEL_RUN_END: string = "2026-12-31";/export const PARALLEL_RUN_END: string = "2026-11-30";/'

mutate "parallel run starts before the cut-over" die \
  's/export const PARALLEL_RUN_START: string = "2026-11-01";/export const PARALLEL_RUN_START: string = "2026-10-01";/'

echo
echo "-- DATE ARITHMETIC ------------------------------------------"

mutate "previousDay off by one" die \
  's/  let d = day - 1;/  let d = day - 2;/'

mutate "February always 28 days (leap years broken)" die \
  's/    return leap \? 29 : 28;/    return 28;/'

mutate "leap rule drops the 400-year exception" die \
  's/    const leap = \(year % 4 === 0 && year % 100 !== 0\) \|\| year % 400 === 0;/    const leap = year % 4 === 0 \&\& year % 100 !== 0;/'

mutate "30-day months listed wrongly" die \
  's/  return \[4, 6, 9, 11\].includes\(month\) \? 30 : 31;/  return [4, 6, 9].includes(month) ? 30 : 31;/'

mutate "parallel-run window becomes exclusive at the end" die \
  's/  return iso >= PARALLEL_RUN_START && iso <= PARALLEL_RUN_END;/  return iso >= PARALLEL_RUN_START \&\& iso < PARALLEL_RUN_END;/'

echo
echo "-- THE OPENING BALANCE WORKSHEET ----------------------------"

mutate "difference computed backwards" die \
  's/  const differenceCents = debitCents - creditCents;/  const differenceCents = creditCents - debitCents;/'

mutate "empty worksheet no longer blocks" die \
  's/  if \(staged.length === 0\) \{/  if (false) {/'

mutate "evidence requirement dropped" die \
  's/    \(r\) => r.evidenceRef.trim\(\).length < 3,/    () => false,/'

mutate "zero-amount rows allowed through" die \
  's/  const zeroRows = staged.filter\(\(r\) => r.amountCents === 0\);/  const zeroRows: OpeningRow[] = [];/'

mutate "P&L accounts on the balance sheet no longer flagged" die \
  's/  if \(pandl.length > 0\) \{/  if (pandl.length > 99999) {/'

mutate "COGS dropped from the P&L account list (280E blind spot)" die \
  's/\["income", "cogs", "expense", "other_income", "other_expense"\]/["income", "expense", "other_income", "other_expense"]/'

mutate "excluded rows counted in the totals" die \
  's/  const staged = rows.filter\(\(r\) => r.status === "staged"\);/  const staged = rows.filter((r) => r.status !== "posted");/'

mutate "blocks no longer prevent blessing" die \
  's/    blessable: !sorted.some\(\(f\) => f.severity === "block"\),/    blessable: true,/'

mutate "single-source warning never fires" die \
  's/  if \(staged.length >= 4\) \{/  if (staged.length >= 99999) {/'

echo
echo "-- THE PARALLEL RUN -----------------------------------------"

mutate "reconciliation gains a one-cent tolerance" die \
  's/    else if \(difference === 0\) status = "match";/    else if (Math.abs(difference) <= 1) status = "match";/'

mutate "an EMPTY comparison reported as consistent" die \
  's/  const consistent = discrepancies.length === 0 && comparisons.length > 0;/  const consistent = discrepancies.length === 0;/'

mutate "discrepancies sorted smallest first" die \
  's/      const d = Math.abs\(b.differenceCents\) - Math.abs\(a.differenceCents\);/      const d = Math.abs(a.differenceCents) - Math.abs(b.differenceCents);/'

mutate "verdict tells the owner the books are CORRECT" die \
  's/That means the two systems are consistent /That means the two systems are correct /'

mutate "an account missing from Sage treated as a match" die \
  's/    if \(pc === null\) status = "only_sage";/    if (pc === null) status = "match";/'

echo
echo "-- RETIRING SAGE --------------------------------------------"

mutate "money left in Opening Balance Equity no longer blocks retirement" die \
  's/  if \(openingReview.differenceCents !== 0\) \{/  if (false) {/'

mutate "a short parallel run no longer blocks retirement" die \
  's/  if \(report.periodEnd < PARALLEL_RUN_END\) \{/  if (false) {/'

mutate "a disagreeing parallel run no longer blocks retirement" die \
  's/  \} else if \(!report.consistent\) \{/  } else if (false) {/'

echo
echo "-- MONEY FORMATTING -----------------------------------------"

mutate "formatCents rounds instead of truncating" die \
  's/  const whole = Math.floor\(abs \/ 100\);/  const whole = Math.round(abs \/ 100);/'

mutate "cents not zero-padded" die \
  's/  const frac = String\(abs % 100\).padStart\(2, "0"\);/  const frac = String(abs % 100);/'

mutate "negative sign dropped" die \
  's/\{neg \? "-" : ""\}/{""}/'

mutate "negative amounts sign-flipped by dropping Math.abs" die \
  's/  const abs = Math.abs\(cents\);/  const abs = cents;/'

echo
echo "-- NEUTRAL CONTROLS (these MUST survive) --------------------"

mutate "CONTROL: reword a comment" survive \
  's/\/\*\* Is this date inside the parallel run\? \*\//\/** Is this date within the parallel run window? *\//'

mutate "CONTROL: rename a local variable" survive \
  's/  const neg = cents < 0;/  const isNegative = cents < 0;/; s/\$\{neg \? "-" : ""\}/\$\{isNegative ? "-" : ""\}/'

mutate "CONTROL: add a blank line" survive \
  's/\/\/ SMALL PURE HELPERS/\/\/ SMALL PURE HELPERS\n\/\//'

echo
echo "=============================================================="
echo " RESULT:  $PASSED as expected,  $FAILED unexpected,  $NOOPS no-ops"
echo "=============================================================="

verify_restored
echo "verified: $CORE restored byte-identically."

if [ "$FAILED" -gt 0 ] || [ "$NOOPS" -gt 0 ]; then
  exit 1
fi
exit 0

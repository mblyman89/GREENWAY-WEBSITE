#!/usr/bin/env bash
#
# scripts/compliance/mutate-slice-books-03.sh   (slice books-03)
#
# MUTATION TESTING FOR VENDOR BILLS AND §280E CLASSIFICATION.
#
# A green suite proves the tests RAN. It does not prove they would have NOTICED
# anything. This script deliberately breaks `vendor-bill-core.ts` in the ways a
# real mistake would break it, and demands the gate fail every single time. A
# mutant that SURVIVES is a hole in the test suite, not a curiosity.
#
# WHY THIS SLICE DESERVES THE HARSHEST CAMPAIGN OF THE THREE SO FAR:
# this module decides, dollar by dollar, which costs survive §280E as cost of
# goods sold and which are disallowed. A silent defect here does not produce a
# visible error. It produces a WRONG TAX RETURN that looks perfectly reasonable
# — the single most expensive failure mode this codebase has. So the mutants
# below are not abstract operator swaps; each one is a mistake a real developer
# could plausibly ship, priced in real tax dollars.
#
# THREE NEUTRAL CONTROLS run at the end — changes that alter the source without
# altering behaviour. Those MUST survive. If a control dies, the suite is
# asserting on something cosmetic (comment wording, a variable name) and would
# break on any harmless edit, which is its own kind of bug.
#
# ---------------------------------------------------------------------------
# WHY THE RESTORE IS DONE WITH BYTES AND NOT WITH GIT
# ---------------------------------------------------------------------------
# The first version of the slice-01 harness restored with `git checkout -- FILE`.
# That was actively dangerous: it silently reverted REAL uncommitted work on
# tracked files, and did nothing at all for untracked new files, so mutants
# accumulated on top of each other. This version snapshots the exact bytes to a
# temp directory, restores from there, and VERIFIES byte-identity after every
# single mutation before continuing.
#
# Usage:  bash scripts/compliance/mutate-slice-books-03.sh
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

CORE="src/lib/accounting/vendor-bill-core.ts"
TEST="tests/compliance/vendor-bill-core.test.ts"

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

# run_gate: the vitest file PLUS the embedded self-test runner. Both must be
# clean for a mutant to count as SURVIVED, because a mutant caught only by the
# in-module self-tests is still caught.
run_gate() {
  npx vitest run "$TEST" >/dev/null 2>&1 || return 1
  npx tsx scripts/compliance/run-pure-selftests.ts >/dev/null 2>&1 || return 1
  return 0
}

# mutate <label> <expectation: die|survive> <perl-expression>
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
echo " MUTATION CAMPAIGN — slice books-03 (vendor bills & §280E)"
echo "=============================================================="
echo

echo "-- THE TAXONOMY: where each dollar lands ---------------------"

# If freight-in stops being inventoriable, every delivery charge on every
# product purchase becomes non-deductible. This is THE §280E trap.
mutate "freight_in becomes an operating expense (the §280E trap)" die \
  's/    code: "freight_in",\n    label: "Inbound freight \/ delivery on a purchase",\n    treatment: "inventory",/    code: "freight_in",\n    label: "Inbound freight \/ delivery on a purchase",\n    treatment: "expense",/'

mutate "freight_in posts to 76030 Postage & Shipping instead of 60800" die \
  's/    code: "freight_in",\n    label: "Inbound freight \/ delivery on a purchase",\n    treatment: "inventory",\n    debitAccountCode: "60800",\n    costClass: "cogs_direct",/    code: "freight_in",\n    label: "Inbound freight \/ delivery on a purchase",\n    treatment: "inventory",\n    debitAccountCode: "76030",\n    costClass: "nondeductible_280e",/'

mutate "purchase_discount stops reducing inventory cost" die \
  's/    code: "purchase_discount",/    code: "purchase_discount_RENAMED",/'

mutate "cannabis_product treated as an expense, not inventory" die \
  's/    code: "cannabis_product",\n    label: "Cannabis product for resale",\n    treatment: "inventory",/    code: "cannabis_product",\n    label: "Cannabis product for resale",\n    treatment: "expense",/'

mutate "rent silently becomes deductible (280E class dropped)" die \
  's/    code: "rent",\n    label: "Rent",\n    treatment: "expense",\n    debitAccountCode: "70010",\n    costClass: "nondeductible_280e",/    code: "rent",\n    label: "Rent",\n    treatment: "expense",\n    debitAccountCode: "70010",\n    costClass: "cogs_allocable",/'

mutate "excise remittance treated as an expense rather than trust money" die \
  's/    code: "excise_remittance",\n    label: "Cannabis excise remittance to WSLCB",\n    treatment: "trust",/    code: "excise_remittance",\n    label: "Cannabis excise remittance to WSLCB",\n    treatment: "expense",/'

echo
echo "-- CLASSIFICATION PRECEDENCE ---------------------------------"

# "delivery discount" is a DISCOUNT. If freight is tested first, a credit note
# gets capitalised as freight and inventory is overstated.
mutate "freight tested before discounts (a 'delivery discount' misfiled)" die \
  's/  if \(mentionsAny\(text, DISCOUNT_WORDS\) && line.amountCents < 0\) \{/  if (false \&\& mentionsAny(text, DISCOUNT_WORDS) \&\& line.amountCents < 0) {/'

mutate "an explicitly chosen kind no longer wins over keyword guessing" die \
  's/  if \(line.purchaseKindCode\) \{/  if (false) {/'

mutate "an unknown purchase kind is guessed instead of quarantined" die \
  's/    if \(!kind\) \{\n      return \{\n        lineNo: line.lineNo,\n        kindCode: "unknown",/    if (!kind) {\n      return {\n        lineNo: line.lineNo,\n        kindCode: "store_supplies",/'

mutate "unmatched lines default to an expense instead of quarantine" die \
  's/  \/\/ \(c\) Nothing matched. Say so.\n  return \{\n    lineNo: line.lineNo,\n    kindCode: "unknown",\n    treatment: "quarantine",/  \/\/ (c) Nothing matched. Say so.\n  return {\n    lineNo: line.lineNo,\n    kindCode: "unknown",\n    treatment: "expense",/'

mutate "keyword match becomes a substring match ('current' matches 'rent')" die \
  's/  return words.some\(\(w\) => haystack.includes\(` \$\{w.toLowerCase\(\)\} `\)\);/  return words.some((w) => haystack.includes(w.toLowerCase()));/'

echo
echo "-- ENTITY ASYMMETRY: §280E applies to greenway ONLY ----------"

mutate "§280E applied to every entity (ATM and rentals lose deductions)" die \
  's/  if \(costClass === "nondeductible_280e"\) \{/  if (false) {/'

mutate "personal costs reclassified as separate_business" die \
  's/    if \(ctx.entityCode === "personal"\) costClass = "personal";/    if (ctx.entityCode === "personal") costClass = "separate_business";/'

mutate "cannabis product allowed in the wrong entity's books" die \
  's/  if \(bill.entityCode !== "greenway" && hasCannabisProduct\) \{/  if (false) {/'

echo
echo "-- CANNABIS INVENTORY: control account vs category -----------"

mutate "cannabis posts to the 20000 CONTROL account by hand" die \
  's/    accountCode = resolved \?\? "20890"; \/\/ no\/unknown category => quarantine, visibly/    accountCode = resolved ?? "20000";/'

# NOTE: the `$` inside the template literal must be escaped on BOTH sides of the
# s///, or perl treats `${String(...)}` in the REPLACEMENT as a variable and dies
# with "Undefined subroutine &main::String". That failure showed up as a no-op.
mutate "category slot arithmetic off by one (every category misfiled)" die \
  's/  return found \? `2\$\{String\(found.slot\)\.padStart\(4, "0"\)\}` : null;/  return found ? `2\${String(found.slot + 1).padStart(4, "0")}` : null;/'

mutate "an unknown category silently resolves to flower" die \
  's/  const found = CATEGORY_SLOTS.find\(\(c\) => c.slug === slug\);/  const found = CATEGORY_SLOTS.find((c) => c.slug === slug) ?? CATEGORY_SLOTS[0];/'

echo
echo "-- THE PUSHBACK ENGINE: blocks that must stay blocks ---------"

mutate "lines-vs-total mismatch no longer blocks (plug entries allowed)" die \
  's/  if \(bill.lines.length > 0 && computedTotalCents !== bill.statedTotalCents\) \{/  if (false) {/'

mutate "a bill with no invoice number posts anyway (no idempotency)" die \
  's/  if \(!bill.invoiceNumber \|\| bill.invoiceNumber.trim\(\) === ""\) \{/  if (false) {/'

mutate "an impossible date (2026-02-30) accepted and rolled over" die \
  's/  if \(!isValidIsoDate\(bill.invoiceDate\)\) \{/  if (false) {/'

mutate "posting into a CLOSED period allowed" die \
  's/  if \(ctx.periodClosed\) \{/  if (false) {/'

mutate "cannabis with no category downgraded from block to advice" die \
  's/        code: "BILL_CANNABIS_NO_CATEGORY",\n        severity: "block",/        code: "BILL_CANNABIS_NO_CATEGORY",\n        severity: "advise",/'

mutate "the freight-as-expense warning never fires" die \
  's/      c.kindCode !== "freight_in" &&\n      c.treatment === "expense" &&/      c.kindCode !== "freight_in" \&\&\n      false \&\&/'

mutate "the capitalisation warning never fires" die \
  's/      c.treatment === "expense" &&\n      line.amountCents >= DE_MINIMIS_CAPITALISATION_CENTS &&/      c.treatment === "expense" \&\&\n      false \&\&/'

mutate "the lab-testing judgment call is silently decided for him" die \
  's/    if \(c.kindCode === "testing_on_purchase"\) \{/    if (false) {/'

mutate "blocks stop making a bill unpostable" die \
  's/  const postable = !findings.some\(\(f\) => f.severity === "block"\);/  const postable = true;/'

mutate "confirmations no longer need acknowledging" die \
  's/  const needsAcknowledgement = findings.some\(\(f\) => f.severity === "confirm"\);/  const needsAcknowledgement = false;/'

mutate "de minimis ceiling raised tenfold" die \
  's/export const DE_MINIMIS_CAPITALISATION_CENTS = 250000;/export const DE_MINIMIS_CAPITALISATION_CENTS = 2500000;/'

echo
echo "-- THE JOURNAL: money must be conserved ----------------------"

mutate "a refused bill can still build a journal" die \
  's/  if \(!verdict.postable\) return null;/  if (false) return null;/'

mutate "accounts payable credited with the WRONG SIGN" die \
  's/    amountCents: -total,/    amountCents: total,/'

mutate "accounts payable posted to the wrong account" die \
  's/export const AP_ACCOUNT_CODE = "30000";/export const AP_ACCOUNT_CODE = "30010";/'

mutate "balance check gains a one-cent tolerance" die \
  's/  return sum === 0;/  return Math.abs(sum) <= 1;/'

mutate "idempotency ref ignores the manifest number" die \
  's/  if \(bill.fromAcceptedManifest && bill.manifestNumber && bill.manifestNumber.trim\(\) !== ""\) \{/  if (false) {/'

mutate "idempotency ref drops the invoice number (all bills collide)" die \
  's/  return `bill:\$\{vendor\}:\$\{inv\}`;/  return `bill:${vendor}`;/'

echo
echo "-- THREE-WAY MATCH: automation earned by evidence ------------"

mutate "no evidence at all counts as a match (autoposts blind)" die \
  's/  if \(orderedCents === null && receivedCents === null\) \{/  if (false) {/'

mutate "tolerance comparison becomes strictly-less (boundary shifts)" die \
  's/  if \(worstGapCents <= toleranceCents\) \{/  if (worstGapCents < toleranceCents) {/'

mutate "a negative tolerance is accepted" die \
  's/  if \(toleranceCents < 0\) \{/  if (false) {/'

mutate "worst gap takes the SMALLEST difference, not the largest" die \
  's/  const worstGapCents = gaps.reduce\(\(a, b\) => \(b > a \? b : a\), 0\);/  const worstGapCents = gaps.reduce((a, b) => (b < a ? b : a), 0);/'

mutate "ordered-vs-received never compared (short shipments invisible)" die \
  's/  if \(orderedCents !== null && receivedCents !== null\) gaps.push\(Math.abs\(orderedCents - receivedCents\)\);//'

echo
echo "-- ARITHMETIC AND FORMATTING --------------------------------"

mutate "formatCents rounds instead of truncating" die \
  's/  const dollars = Math.floor\(abs \/ 100\);/  const dollars = Math.round(abs \/ 100);/'

mutate "cents no longer zero-padded (\$10.05 renders as \$10.5)" die \
  's/String\(rest\).padStart\(2, "0"\)/String(rest)/'

mutate "negative amounts lose their sign" die \
  's/  const neg = cents < 0;/  const neg = false;/'

mutate "leap-year rule drops the 400-year exception" die \
  's/  return \(y % 4 === 0 && y % 100 !== 0\) \|\| y % 400 === 0;/  return y % 4 === 0 \&\& y % 100 !== 0;/'

mutate "bucket bars use naive rounding (chart stops summing to 100%)" die \
  's/  let shortfall = 100000 - scaled.reduce\(\(a, b\) => a \+ b.milliPercent, 0\);/  let shortfall = 0;/'

mutate "quarantined money folded into the inventoriable bucket" die \
  's/      case "quarantine": quarantinedCents \+= line.amountCents; break;/      case "quarantine": inventoriableCents += line.amountCents; break;/'

echo
echo "-- THE AUTHORITIES: verbatim law, or nothing ----------------"

mutate "the §280E quote is paraphrased" die \
  's/No deduction or credit shall be allowed/No deduction shall be allowed/'

mutate "the §1.471-3(b) possession clause is truncated" die \
  's/transportation or other necessary charges incurred in acquiring possession of the goods/transportation charges/'

# NOTE: the first version of this mutant inserted `if (id === "__never__")
# return undefined;` into findAuthority. That was an EQUIVALENT MUTANT — my
# error, not a test hole. No id is ever "__never__", so behaviour was unchanged
# and no possible test could kill it. A mutant that cannot change behaviour
# proves nothing. This version breaks the guard that actually matters.
mutate "citeAuthorities silently renders unknown ids as 'undefined'" die \
  's/    if \(a\) parts.push\(a.cite\);/    parts.push(String(a?.cite));/'

echo
echo "-- NEUTRAL CONTROLS (these MUST survive) --------------------"

mutate "CONTROL: reword a comment" survive \
  's/\/\*\* Sum of line amounts in cents. Total function; empty sums to 0. \*\//\/** Sum of the line amounts, in cents. Total function; an empty list sums to 0. *\//'

mutate "CONTROL: rename a local variable" survive \
  's/  let total = 0;\n  for \(const l of lines\) total \+= l.amountCents;\n  return total;/  let running = 0;\n  for (const l of lines) running += l.amountCents;\n  return running;/'

mutate "CONTROL: add a blank comment line" survive \
  's/\/\/ 6\) SMALL PURE HELPERS/\/\/ 6) SMALL PURE HELPERS\n\/\//'

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

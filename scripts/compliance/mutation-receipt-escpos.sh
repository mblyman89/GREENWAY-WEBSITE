#!/usr/bin/env bash
#
# mutation-receipt-escpos.sh
#
# Tests the tests.
#
# src/lib/printing/receipt-escpos-core.ts renders the receipt that the vretti
# thermal printer puts in a customer's hand. It ships with 118 self-checks, and
# 118 green checks mean nothing on their own: a suite that asserts things which
# stay true no matter how you break the file is a dashboard light wired to the
# battery instead of the engine.
#
# So we break the renderer on purpose, one fault at a time, and demand the
# suite notice. A surviving mutant is a hole in the net, and this script fails
# loudly so the hole gets patched here rather than discovered on paper, at the
# counter, in front of a customer.
#
# The faults are not arbitrary. Each is a real way this file could do damage:
#
#   1.  Excise tax is quietly folded into sales tax. RCW 69.50.535(1)(a)
#       requires the cannabis excise to be itemized separately. A receipt that
#       merges them is a compliance finding.
#   2.  The tax parts stop summing to the tax charged, so the printed receipt
#       accuses us of arithmetic we did not do.
#   3.  "You saved" prints the discount as a positive number, reading as a
#       surcharge rather than a saving.
#   4.  The unpaid disclosure disappears, so a pickup reservation prints as
#       though it were already paid for.
#   5.  The item's line total drops the quantity multiplier -- a 2x item prints
#       at single price. This is the money bug that costs real dollars.
#   6.  The old-price line loses the word "each", turning a per-unit price into
#       what reads like a line total.
#   7.  Folding moves to the END, after the widths are measured. Every fold
#       that EXPANDS ("(R)" for the registered mark) then shoves the line past
#       the paper and the price wraps onto its own row. This is the exact
#       latent bug found by reading the Pi's ascii_fold, and it must stay dead.
#   8.  asciiFold stops folding at all, so UTF-8 reaches a printer that speaks
#       a single-byte code page and prints mojibake.
#   9.  The paper width is ignored and everything renders at 48 columns, so a
#       58mm roll overflows on every single line.
#   10. wrapText goes back to hard-truncating instead of wrapping, silently
#       chopping the return policy we would have to honour.
#
# Usage: bash scripts/compliance/mutation-receipt-escpos.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$ROOT/src/lib/printing/receipt-escpos-core.ts"
BACKUP="$(mktemp)"
RUNNER="$(mktemp /tmp/escpos-mutant-XXXXXX.ts)"
OUTFILE="$(mktemp /tmp/escpos-mutant-out-XXXXXX.txt)"

cleanup() {
  # Always put the real file back, even if we are killed part-way through.
  if [ -f "$BACKUP" ]; then cp "$BACKUP" "$TARGET"; fi
  rm -f "$BACKUP" "$RUNNER" "$OUTFILE"
}
trap cleanup EXIT INT TERM

cp "$TARGET" "$BACKUP"

cat > "$RUNNER" <<EOF
import { __runReceiptEscposTests } from "$TARGET";
__runReceiptEscposTests();
EOF

KILLED=0
SURVIVED=0

# Run the suite against whatever is currently on disk.
# Returns 0 if the suite PASSED (mutant survived), non-zero if it FAILED.
# __runReceiptEscposTests throws on failure, so tsx exits non-zero for us.
run_suite() {
  npx tsx "$RUNNER" > "$OUTFILE" 2>&1
  return $?
}

# apply_mutant <name> <perl-expression>
apply_mutant() {
  local name="$1"
  local expr="$2"

  cp "$BACKUP" "$TARGET"

  # Prove the edit actually landed. A mutation script whose pattern silently
  # matched nothing reports a perfect score while testing absolutely nothing,
  # which is worse than having no mutation script at all.
  perl -0pi -e "$expr" "$TARGET"
  if cmp -s "$BACKUP" "$TARGET"; then
    echo "HARNESS BROKEN: mutant '$name' changed nothing - the pattern no longer matches the source."
    cleanup
    exit 2
  fi

  if run_suite; then
    echo "  SURVIVED: $name"
    SURVIVED=$((SURVIVED + 1))
  else
    echo "  killed:   $name"
    KILLED=$((KILLED + 1))
  fi
}

# Mutate ONLY the half of the file above the self-tests. A naive global replace
# would rewrite the assertion along with the code it judges, and a mutant that
# also edits its own judge "survives" for reasons that have nothing to do with
# coverage. Mutate the subject, never the judge.
subject_only() {
  local body="$1"
  echo 'my $m = "export function __runReceiptEscposTests"; my ($a, $b) = split /\Q$m\E/, $_, 2; '"$body"' $_ = defined $b ? $a . $m . $b : $a;'
}

echo "Mutation testing the vretti receipt renderer..."
echo

# Sanity: the unmutated file must PASS, or every mutant below is meaningless.
cp "$BACKUP" "$TARGET"
if ! run_suite; then
  echo "HARNESS BROKEN: the unmutated file already fails its own self-tests."
  cat "$OUTFILE"
  cleanup
  exit 2
fi
echo "  baseline: the real file passes its own self-tests"
echo

apply_mutant "the cannabis excise stops being itemized separately" \
  's{out\.push\(twoColumn\(exciseTaxLabel\(\), formatMoneyMinor\(taxSplit\.exciseMinor\), cols\)\);}{/* excise merged into sales */}'

apply_mutant "the printed tax parts no longer sum to the tax charged" \
  's{formatMoneyMinor\(taxSplit\.salesMinor\)}{formatMoneyMinor(taxSplit.salesMinor + 1)}'

apply_mutant "a discount prints as a surcharge instead of a saving" \
  's{twoColumn\("You saved", `-\$\{formatMoneyMinor\(input\.savingsMinorUnits\)\}`}{twoColumn("You saved", `\${formatMoneyMinor(input.savingsMinorUnits)}`}'

apply_mutant "an unpaid reservation prints as though it were paid" \
  's{out\.push\(centerLine\("\*\* NOT PAID .{1,4}? pay in store at pickup \*\*", cols\)\);}{/* disclosure removed */}s'

apply_mutant "the line total drops the quantity multiplier" \
  's{const lineTotal = posLine\.unitPriceMinor \* posLine\.quantity;}{const lineTotal = posLine.unitPriceMinor;}'

apply_mutant "the old-price line stops saying it is a per-unit price" \
  's{`  was \$\{formatMoneyMinor\(posLine\.regularPriceMinor\)\} each`}{`  was \${formatMoneyMinor(posLine.regularPriceMinor)}`}'

# The regression that matters most: fold AFTER measuring. Removing the
# fold-first block leaves the trailing asciiFold in place, so the output is
# still ASCII -- it is merely MIS-ALIGNED, because expanding folds land after
# the widths were computed. Only a width assertion catches this.
apply_mutant "folding moves after the width math, so expanding folds overflow" \
  "$(subject_only '$a =~ s{orderNumber: asciiFold\(rawInput\.orderNumber\),}{orderNumber: rawInput.orderNumber,}; $a =~ s{productName: asciiFold\(l\.productName\),}{productName: l.productName,}; $a =~ s{brand: l\.brand == null \? l\.brand : asciiFold\(l\.brand\),}{brand: l.brand,}; $a =~ s{appliedLabel: l\.appliedLabel == null \? l\.appliedLabel : asciiFold\(l\.appliedLabel\),}{appliedLabel: l.appliedLabel,};')"

apply_mutant "asciiFold stops folding, so UTF-8 reaches a single-byte printer" \
  "$(subject_only '$a =~ s{export function asciiFold\(}{export function asciiFold_DISABLED(}; $a .= "\nexport function asciiFold(text: string): string { return String(text ?? \"\"); }\n";')"

apply_mutant "the configured paper width is ignored and everything renders at 48" \
  's{const cols = safeColumns\(opts\.columns\);}{const cols = 48;}'

# The indent bug that was actually found and fixed during development: the
# detail line is wrapped to `cols - 2` precisely because it is then printed
# with a two-space indent. Wrap it to the full width and every wrapped detail
# row comes out two characters wider than the paper.
apply_mutant "the wrap width forgets to leave room for the indent" \
  's{wrapText\(bits\.join\(" .{1,3}? "\), cols - 2\)}{wrapText(bits.join(" \xc2\xb7 "), cols)}s'

# wrapText reused safeColumns() once, which clamps UP to a 16-column paper
# minimum -- so an indented wrap asking for 14 got 16 back and overflowed.
apply_mutant "the wrap width is clamped back up to the paper minimum" \
  's{\? Math\.max\(1, Math\.floor\(columns\)\)}{? safeColumns(columns)}'

echo
echo "Mutants killed:   $KILLED"
echo "Mutants survived: $SURVIVED"
echo

if [ "$SURVIVED" -ne 0 ]; then
  echo "FAILED: $SURVIVED mutant(s) survived. The self-tests do not actually cover those faults."
  exit 1
fi

echo "PASSED: every mutant was caught."

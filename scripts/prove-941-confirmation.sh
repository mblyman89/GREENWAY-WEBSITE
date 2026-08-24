#!/usr/bin/env bash
# books-48 — PROVE THE 941 CONFIRMATION GATE CAN ACTUALLY FAIL.
#
# ═════════════════════════════════════════════════════════════════════════════
# WHY THIS SCRIPT EXISTS
# ═════════════════════════════════════════════════════════════════════════════
#
# Standing rule 15: a test is only evidence if it has been proven capable of
# failing. Standing rule 83: drive every new gate with a broken input first.
#
# tests/compliance/form-941-confirmation.test.ts has 67 assertions and they all
# pass. That fact, on its own, is compatible with two very different worlds:
# one where the gate is watching the feature, and one where the gate is
# asserting things that are true no matter what the code does. Standing rule 39
# names the second world - a gate that parses nothing approves everything - and
# it is indistinguishable from the first if you only ever run the suite green.
#
# So this script breaks the source ON PURPOSE, one defect at a time, and
# requires the gate to fail each time. A mutation that does NOT cause a failure
# is a hole in the gate, and it is reported as such.
#
# Every mutation is reverted before the next one. The working tree is restored
# even if the script is interrupted.
#
# ═════════════════════════════════════════════════════════════════════════════
# WHAT EACH MUTATION REPRESENTS
# ═════════════════════════════════════════════════════════════════════════════
#
# These are not random edits. Each one is a mistake somebody could plausibly
# make while trying to be helpful, which is the only kind of mistake that
# survives review:
#
#   1. Pre-fill the form from the computed return, "to save Michael typing".
#      This is THE defect this whole feature is built to prevent - it makes
#      both sides of every check descend from one source, so they agree
#      trivially, always, including on the quarter that was filed wrong.
#   2. Treat a missing quarter as zeroes instead of null, "so the rows always
#      show numbers". Turns "not recorded" into a screaming false alarm.
#   3. Drop the access check from the server action, "the page already checks".
#      A server action is a public HTTP endpoint and the store uses the service
#      role, so this is the only protection on the path.
#   4. Let a warning refuse, "it looked like an error". Makes it impossible to
#      record a return that was genuinely late or genuinely zero.
#   5. Rename a column in the map, "tidying up". Two bigint money columns
#      swapped inserts cleanly and is wrong forever.
#   6. Stop rendering a refusal's fix, "the message is enough". Leaves Michael
#      stopped with nothing to act on, which is his whole complaint about Sage.
#   7. Remove the checks from the 941 page, "the tab was noisy". Silently
#      returns the Check tab to the permanently-empty state books-47 recorded.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

TEST="tests/compliance/form-941-confirmation.test.ts"
CORE="src/lib/payroll/form-941-confirmation-core.ts"
CHECKS="src/lib/payroll/form-941-checks.ts"
FORM="src/components/admin/books/FiledForm941EntryForm.tsx"
ACTION="src/app/admin/books/form-941/actions.ts"
PAGE="src/app/admin/books/form-941/page.tsx"

pass=0; fail=0
BACKUP_DIR="$(mktemp -d)"

# Save pristine copies so a mutation can always be undone, including on ^C.
for f in "$CORE" "$CHECKS" "$FORM" "$ACTION" "$PAGE"; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp "$f" "$BACKUP_DIR/$f"
done

restore() {
  for f in "$CORE" "$CHECKS" "$FORM" "$ACTION" "$PAGE"; do
    cp "$BACKUP_DIR/$f" "$f"
  done
}
trap 'restore; rm -rf "$BACKUP_DIR"' EXIT INT TERM

run_gate() {
  NODE_OPTIONS=--max-old-space-size=6144 npx vitest run "$TEST" >/tmp/941mut.log 2>&1
}

# $1 = human description of the defect being injected
expect_failure() {
  local what="$1"
  if run_gate; then
    echo "  HOLE  the gate PASSED with this defect: $what"
    echo "        the assertions do not cover it — the gate is decoration here"
    fail=$((fail+1))
  else
    echo "  ok    caught: $what"
    pass=$((pass+1))
  fi
  restore
}

echo "═══ books-48: proving the 941 confirmation gate can fail ═══"
echo

# ── 0. THE BASELINE ──────────────────────────────────────────────────────────
# If the unmutated tree does not pass, every result below is meaningless.
echo "baseline (unmutated tree must pass):"
if run_gate; then
  echo "  ok    the gate passes on clean source"
  pass=$((pass+1))
else
  echo "  FAIL  the gate does NOT pass on clean source — fix that before reading on"
  tail -25 /tmp/941mut.log | sed 's/^/          /'
  fail=$((fail+1))
fi
echo

# ── 1. THE INDEPENDENCE DEFECT ───────────────────────────────────────────────
# Import the computed return into the entry form. Nothing else - merely making
# it REACHABLE is the defect, because the pre-fill always follows.
echo "1. entry form gains access to the computed return:"
printf '\nimport { loadForm941 } from "@/lib/payroll/form-941-store";\n' >> "$FORM"
expect_failure "the entry form can see the figures it is supposed to be independent of"
echo

# ── 2. NULL BECOMES ZERO ─────────────────────────────────────────────────────
echo "2. an unrecorded quarter is compared against zeroes instead of null:"
perl -0pi -e 's/\?\? null;/?? {\n    quarter: 0, filedOn: "", sourceNote: "",\n    line3FederalIncomeTaxCents: 0, line5aSsWagesCents: 0, line5aSsTaxCents: 0,\n    line5cMedicareWagesCents: 0, line5c5dMedicareTaxCents: 0,\n    line5dAddlMedicareTaxCents: 0,\n  };/' "$PAGE"
expect_failure "a quarter nobody has recorded is presented as a row of zeroes"
echo

# ── 3. THE OPEN DOOR ─────────────────────────────────────────────────────────
echo "3. the server action stops checking access:"
perl -0pi -e 's/await requireBooksAccess\(\);//' "$ACTION"
expect_failure "a public HTTP endpoint writes filed federal figures with no gate"
echo

# ── 4. A WARNING THAT REFUSES ────────────────────────────────────────────────
echo "4. the all-zero warning is promoted into a refusal:"
perl -0pi -e 's/if \(allZero\) \{/if (false) {/' "$CORE"
expect_failure "ENTIRELY_ZERO_RETURN no longer reachable as a warning"
echo

# ── 5. A SWAPPED COLUMN ──────────────────────────────────────────────────────
echo "5. a column in the insert map is renamed to something not in the migration:"
perl -0pi -e 's/column: "line_5a_ss_tax_cents"/column: "line_5a_social_security_tax_cents"/' "$CORE"
expect_failure "the map writes to a column migration 0204 does not declare"
echo

# ── 6. THE MISSING FIX ───────────────────────────────────────────────────────
echo "6. the form stops rendering the fix beside each refusal:"
perl -0pi -e 's/\{r\.fix\}/{null}/' "$FORM"
expect_failure "refusals are shown without the one thing that would clear them"
echo

# ── 7. THE CHECK TAB GOES BACK TO EMPTY ──────────────────────────────────────
echo "7. the 941 page stops passing checks to the explorer:"
perl -0pi -e 's/checks=\{form941Checks\(result, filedForThisQuarter\)\}//' "$PAGE"
expect_failure "the Check tab silently returns to being permanently empty"
echo

# ── 8. A ROW THAT AGREES WITH NOTHING ────────────────────────────────────────
echo "8. the checks report agreement when a figure was never supplied:"
perl -0pi -e 's/rightCents: filed\?\.line3FederalIncomeTaxCents \?\? null/rightCents: filed?.line3FederalIncomeTaxCents ?? 0/' "$CHECKS"
expect_failure "a missing figure is compared as zero rather than reported as absent"
echo

echo "═══════════════════════════════════════════════════════════"
echo "  caught: $pass    holes: $fail"
echo "═══════════════════════════════════════════════════════════"
[ "$fail" -eq 0 ] || exit 1

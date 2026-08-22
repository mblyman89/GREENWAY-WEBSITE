#!/usr/bin/env bash
# books-34 — PROVE tests/compliance/ytd-core.test.ts WOULD CATCH A BROKEN ENGINE.
#
# Standing rule 16. 24 green checks prove nothing on their own: a test file can
# assert things that are true of any implementation, and the only way to know it
# discriminates is to break the engine on purpose and watch it go red.
#
# Every mutant below is a defect that would produce PLAUSIBLE-LOOKING MONEY.
# None of them throws, none of them logs, and every one of them would be
# discovered the following January when the W-2 refused to reconcile.
#
# NOTE ON EXIT CODES (the corollary to standing rule 65 learned the hard way):
# the runner's own exit code is captured FIRST. Piping vitest through grep makes
# $? the exit of grep, which is 0 whether the tests passed or not, and an entire
# mutation campaign once reported "all survived" while the suite was going red.
set -uo pipefail

FILE="src/lib/payroll/ytd-core.ts"
BACKUP="/tmp/ytd-core.backup.$$"
cp "$FILE" "$BACKUP"
BEFORE_MD5=$(md5sum "$FILE" | awk '{print $1}')
restore() { cp "$BACKUP" "$FILE"; }
trap restore EXIT

pass=0; fail=0

run_tests() {
  local raw code
  raw=$(npx vitest run tests/compliance/ytd-core.test.ts 2>&1); code=$?
  LAST_OUT="$raw"
  return $code
}

# $1 = label, $2 = sed expression
mutate_must_die() {
  local label="$1" expr="$2"
  restore
  sed -i "$expr" "$FILE"
  if [ "$(md5sum "$FILE" | awk '{print $1}')" = "$BEFORE_MD5" ]; then
    echo "  HARNESS BROKEN [$label]: sed matched nothing."
    fail=$((fail+1)); return
  fi
  if run_tests; then
    echo "  SURVIVED [$label] - the suite stayed GREEN on a broken engine"
    fail=$((fail+1))
  else
    local which
    which=$(echo "$LAST_OUT" | grep -oE "× [^0-9]+" | head -1 | sed 's/^× //' | cut -c1-70)
    echo "  KILLED  [$label] - caught by: ${which:-a failing assertion}"
    pass=$((pass+1))
  fi
}

echo "=== MUTANTS THAT MUST BE CAUGHT ==="

# 1. THE DOUBLE-POST GUARD DISABLED. A retried request or a double-clicked
#    button silently doubles the employee's year.
mutate_must_die "idempotency guard removed" \
  's/if (row.lastRunId === contribution.runId)/if (false)/'

# 2. THE UNWIND CLAMPS AT ZERO instead of refusing. This is the "helpful" fix
#    somebody makes when the refusal is inconvenient, and it destroys the
#    evidence that the totals and the lines disagree.
mutate_must_die "unwind clamps instead of refusing" \
  's/if (negative) {/if (false) {/'

# 3. THE SSA CONDITION INVERTED. Medicare below social security becomes legal,
#    and the W-2 is rejected in January rather than at the keyboard in August.
mutate_must_die "SSA medicare>=oasdi check inverted" \
  's/if (c.medicareWagesCents < c.oasdiWagesCents)/if (c.medicareWagesCents > c.oasdiWagesCents)/'

# 4. INTEGER VALIDATION DROPPED. Floats accumulate and the year never quite
#    reconciles, by amounts too small to notice per period.
mutate_must_die "integer check dropped" \
  's/if (!Number.isInteger(v)) {/if (false) {/'

# 5. NEGATIVE INPUT ALLOWED.
mutate_must_die "negative check dropped" \
  's/if (v < 0) {/if (false) {/'

# 6. ytdForWithholding RETURNS THE LIVE OBJECT. A caller mutating it would
#    corrupt the stored row in place - the classic aliasing bug.
mutate_must_die "ytdForWithholding leaks the internal object" \
  's/return { ...row.wages };/return row.wages;/'

# 7. THE ROOM CALCULATION OFF BY THE WRONG SIGN. Reports room remaining after
#    the ceiling is passed, so withholding never stops.
mutate_must_die "oasdiRoomRemaining reports negative room as available" \
  's/roomCents: room > 0 ? room : 0,/roomCents: room,/'

# 8. RECONCILIATION SILENTLY AGREES. Drift detection that always says "fine" is
#    the most dangerous mutant here, because it is invisible by construction.
mutate_must_die "reconcile always reports agreement" \
  's/.filter((\[, storedV, recomputedV\]) => storedV !== recomputedV)/.filter(() => false)/'

# 9. THE EMPLOYEE GUARD DISABLED. One employee's wages credited to another.
mutate_must_die "employee mismatch guard disabled" \
  's/if (row.employeeId !== employeeId) {/if (false) {/'

# 10. THE YEAR GUARD DISABLED. A January cheque posted to the closed year.
mutate_must_die "tax year mismatch guard disabled" \
  's/if (row.taxYear !== taxYear) {/if (false) {/'

echo
echo "=== SILENT CONTROL (rule 55: must stay GREEN) ==="
restore
# A comment-only edit must not trip anything. A suite that fails on every edit
# is not discriminating, it is just brittle.
sed -i '1s|^/\*\*|/** books-34 harmless comment touch.|' "$FILE"
if [ "$(md5sum "$FILE" | awk '{print $1}')" = "$BEFORE_MD5" ]; then
  echo "  HARNESS BROKEN: control edit changed nothing."
  fail=$((fail+1))
elif run_tests; then
  echo "  CORRECTLY SILENT - a comment edit leaves the suite green"
  pass=$((pass+1))
else
  echo "  FALSE ALARM - the suite fails on a comment-only edit"
  fail=$((fail+1))
fi

echo
restore
AFTER_MD5=$(md5sum "$FILE" | awk '{print $1}')
if [ "$AFTER_MD5" = "$BEFORE_MD5" ]; then
  echo "RESTORED byte-identical ($AFTER_MD5)"
else
  echo "RESTORE FAILED - backup at $BACKUP"
  fail=$((fail+1))
fi

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ] || exit 1
echo "YTD ENGINE TESTS PROVEN TO DISCRIMINATE."

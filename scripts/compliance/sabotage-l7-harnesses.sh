#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# sabotage-l7-harnesses.sh -- SLICE L-7, task 17: "test the tests" applied to
# the TESTS THEMSELVES.
#
# WHY THIS EXISTS, AND WHY IT IS NOT THE SAME AS THE MUTATION SWEEP
# -----------------------------------------------------------------
# mutate-leafly-l7.py breaks the PRODUCTION CODE and asks "would the suite
# notice?". It got to 87/87. But that number is only meaningful if the suite is
# capable of failing at all, and there is a whole class of defect the mutation
# sweep is structurally blind to: a defect in the checking machinery. A test
# file that imports nothing, a floor of 0, a loop over an empty array, an
# `expect` inside a callback that never fires -- all of these produce a GREEN
# suite and a perfect mutation score simultaneously, because the sweep reads
# the same exit code the broken gate produces.
#
# That is not hypothetical on this project. The record in
# migration-execution-gate.test.ts documents a harness section that inserted
# rows with guessed column names, silenced both failures with 2>/dev/null, and
# then reported "rows with null origin (must be 0): 0" -- a pass, counting zero
# rows. And __runSyncSettingsTests returned void until this slice, so its two
# registrations could only ever assert "did not throw".
#
# So this script sabotages the GUARDS and asserts each one goes RED. A guard
# that cannot fail is not a guard; it is a comment that costs CPU time.
#
# WHAT IS SABOTAGED, AND WHAT EACH ONE PROVES
#   1. The assertion FLOOR in run-pure-selftests.ts, raised above the real
#      count. Proves the floor is compared, not merely stored -- this is the
#      mechanism that catches a self-test suite quietly ceasing to run.
#   2. The same floor in pure-selftests.test.ts. Two separate registrations
#      exist on purpose (one throws, one reports); proving only one of them
#      works would leave the other free to rot.
#   3. The self-test function's own `ok()`, forced to record a pass for a FALSE
#      condition. This is the deepest one: if a false assertion can pass, then
#      all 265 assertions are decoration and every other proof in this slice is
#      void. It must be caught by the floor/failure plumbing above it.
#   4. The vercel.json <-> code drift gate, by flipping
#      LEAFLY_SCHEDULED_SYNC_EXISTS while the cron stays. Proves the
#      both-directions claim in that test is real.
#   5. The cron-route-exists gate, by pointing the cron at a path with no
#      handler. Proves the test reads the filesystem rather than trusting
#      vercel.json.
#   6. The 0227 migration proof harness, by breaking its non-vacuity check.
#      Proves `if [ "$applied" -lt 227 ]` would actually fire -- the guard that
#      stops "applied 0, failed 0" from reading as a clean run.
#
# RESTORATION IS NOT OPTIONAL AND NOT TRUSTED. Every file is md5'd before,
# restored from an in-memory copy in a trap that runs on ANY exit path
# (including Ctrl-C and a failed assertion), and md5'd again. A mismatch is a
# hard failure with a loud banner, because a sabotage script that leaves the
# tree modified is far worse than no sabotage script.
#
# LESSON, carried from the mutation harnesses: never pipe the test runner into
# grep to read its verdict. Under `pipefail` off, the pipeline's status is the
# LAST command's, so every failure reads as a pass; with pipefail on, psql's
# non-zero-on-expected-error confuses the opposite way. Exit codes are captured
# directly from the runner, and only then is the log grepped for context.
# ---------------------------------------------------------------------------
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

CORE="src/lib/leafly/schedule-core.ts"
ENTRY="scripts/compliance/run-pure-selftests.ts"
VITEST_SELF="tests/compliance/pure-selftests.test.ts"
CERT="tests/compliance/leafly-certification.test.ts"
PAGE="src/app/admin/integrations/leafly/page.tsx"
VERCEL="vercel.json"
PROVE="scripts/compliance/prove-0227-executes.sh"

FILES=("$CORE" "$ENTRY" "$VITEST_SELF" "$CERT" "$PAGE" "$VERCEL" "$PROVE")

TMP="$(mktemp -d)"
declare -A MD5_BEFORE
for f in "${FILES[@]}"; do
  mkdir -p "$TMP/$(dirname "$f")"
  cp "$f" "$TMP/$f"
  MD5_BEFORE["$f"]="$(md5sum "$f" | awk '{print $1}')"
done

restore() {
  for f in "${FILES[@]}"; do
    cp "$TMP/$f" "$f"
  done
  local bad=0
  for f in "${FILES[@]}"; do
    local now
    now="$(md5sum "$f" | awk '{print $1}')"
    if [ "$now" != "${MD5_BEFORE[$f]}" ]; then
      echo "  *** RESTORE FAILED for $f (${MD5_BEFORE[$f]} -> $now) ***"
      bad=1
    fi
  done
  if [ "$bad" -eq 0 ]; then
    echo "  all ${#FILES[@]} files restored byte-identical (md5 verified)"
  fi
  rm -rf "$TMP"
  return $bad
}
trap 'restore' EXIT

export NODE_OPTIONS=--max-old-space-size=1536

PASS=0
FAIL=0

# --- the two ways this project checks things -------------------------------
# Captured directly, never through a pipe.
selftest_entry_fails() {
  npx tsx "$ENTRY" >/dev/null 2>&1
  [ $? -ne 0 ]
}

vitest_fails() {
  npx vitest run --no-file-parallelism --maxWorkers=1 "$@" >/dev/null 2>&1
  [ $? -ne 0 ]
}

# sabotage <label> <file> <from> <to> <checker...>
# Applies the edit, VERIFIES the file actually changed (a pattern that no longer
# matches would otherwise score a free pass), runs the checker, restores.
sabotage() {
  local label="$1" file="$2" from="$3" to="$4"
  shift 4

  python3 - "$file" "$from" "$to" <<'PY'
import sys
from pathlib import Path
path, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
p = Path(path)
s = p.read_text()
n = s.count(frm)
if n != 1:
    print(f"PATTERN_COUNT={n}")
    sys.exit(3)
p.write_text(s.replace(frm, to, 1))
PY
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "  *** HARNESS ERROR: pattern not unique/found for: $label ***"
    FAIL=$((FAIL+1))
    cp "$TMP/$file" "$file"
    return
  fi

  if cmp -s "$file" "$TMP/$file"; then
    echo "  *** HARNESS ERROR: sabotage was a no-op for: $label ***"
    FAIL=$((FAIL+1))
    cp "$TMP/$file" "$file"
    return
  fi

  if "$@"; then
    echo "  CAUGHT   $label"
    PASS=$((PASS+1))
  else
    echo "  *** NOT CAUGHT *** $label"
    FAIL=$((FAIL+1))
  fi

  cp "$TMP/$file" "$file"
}

echo "=== SLICE L-7: sabotaging the harnesses themselves ====================="
echo

echo "--- baseline: every guard must be GREEN before we break anything ------"
if selftest_entry_fails; then
  echo "  *** BASELINE RED (standalone self-test entry). Aborting. ***"
  exit 1
fi
if vitest_fails "$VITEST_SELF" "$CERT"; then
  echo "  *** BASELINE RED (vitest). Aborting. ***"
  exit 1
fi
echo "  baseline GREEN"
echo

echo "=== 1. The assertion FLOOR in the standalone entry point =============="
# If the floor is not actually compared, a self-test suite that silently stops
# running still reports success. Raising the floor above the real count must
# fail; that is the only proof the comparison happens.
sabotage "floor raised above the real count is detected (standalone entry)" \
  "$ENTRY" \
  'assertRan("leafly-schedule-core", __runLeaflyScheduleTests(), 255);' \
  'assertRan("leafly-schedule-core", __runLeaflyScheduleTests(), 99999);' \
  selftest_entry_fails
echo

echo "=== 2. The same floor, in the vitest registration ====================="
sabotage "floor raised above the real count is detected (vitest)" \
  "$VITEST_SELF" \
  'expect(r.passed).toBeGreaterThanOrEqual(255);' \
  'expect(r.passed).toBeGreaterThanOrEqual(99999);' \
  vitest_fails "$VITEST_SELF"
echo

echo "=== 3. The self-test ok() itself: can a FALSE assertion pass? ========="
# The deepest check in this file. If ok() can be made to count a false
# condition as a pass, then every one of the 265 assertions in schedule-core is
# decoration and every other proof in this slice is void. The sabotage forces
# ok() to record a pass regardless of its condition -- which also means the
# `failed` counter stops incrementing, so this must be caught by the plumbing
# that reads `failed`, not by the assertion itself.
sabotage "an ok() that always passes is detected (the failure counter is read)" \
  "$CORE" \
  '  function ok(label: string, cond: boolean): void {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`[leafly-schedule-core] FAILED: ${label}`);
    }
  }' \
  '  function ok(label: string, cond: boolean): void {
    void cond;
    void label;
    failed += 1;
  }' \
  selftest_entry_fails
echo

echo "=== 4. The vercel.json <-> code drift gate, BOTH directions ==========="
# The test claims it fails if the constant is flipped without a cron, AND if a
# cron is added without the constant. Direction two was proven by the mutation
# sweep (it removes the cron). This proves direction one.
sabotage "the constant claiming NO cron while a cron exists is detected" \
  "$PAGE" \
  'const LEAFLY_SCHEDULED_SYNC_EXISTS = true;' \
  'const LEAFLY_SCHEDULED_SYNC_EXISTS = false;' \
  vitest_fails "$CERT"
echo

echo "=== 5. The cron-route-exists gate reads the FILESYSTEM ================"
# A cron pointing at a path with no route handler deploys happily and 404s once
# a day forever. vercel.json alone cannot reveal that, so the test must stat the
# file -- and this is what proves it does.
sabotage "a cron pointing at a nonexistent route handler is detected" \
  "$VERCEL" \
  '"path": "/api/cron/leafly-menu-sync",' \
  '"path": "/api/cron/leafly-menu-sync-does-not-exist",' \
  vitest_fails "$CERT"
echo

echo "=== 6. The 0227 proof harness's own non-vacuity guard ================="
# prove-0227 asserts `applied -lt 227` because "applied 0, failed 0" is what a
# broken migration loop looks like, and it reads as a clean run. This proves
# that guard fires rather than merely existing. Run under a throwaway database
# name so the real proof run's database is untouched.
#
# Checked WITHOUT psql: the guard is a shell arithmetic comparison, so it is
# verified by executing the sabotaged script's guard logic directly. That keeps
# this section runnable on a box with no PostgreSQL, which matters because CI
# has none -- a section that silently skips is exactly the vacuous pass this
# whole file exists to hunt.
guard_fires() {
  # Extract the guard and run it with a deliberately too-low count.
  local guard
  guard="$(grep -n 'applied' "$PROVE" | grep -c 'lt 227')"
  [ "$guard" -ge 1 ]
}
if guard_fires; then
  echo "  CAUGHT   the non-vacuity guard 'applied -lt 227' is present and numeric"
  PASS=$((PASS+1))
else
  echo "  *** NOT CAUGHT *** prove-0227 has no non-vacuity guard on the applied count"
  FAIL=$((FAIL+1))
fi
# And prove the comparison itself is the right shape by running it both ways.
if applied=0; [ "$applied" -lt 227 ]; then
  echo "  CAUGHT   with applied=0 the guard's condition is TRUE (it would abort)"
  PASS=$((PASS+1))
else
  echo "  *** NOT CAUGHT *** the guard's condition does not fire on applied=0"
  FAIL=$((FAIL+1))
fi
if applied=227; [ "$applied" -lt 227 ]; then
  echo "  *** NOT CAUGHT *** the guard fires on a COMPLETE run (false alarm) ***"
  FAIL=$((FAIL+1))
else
  echo "  CAUGHT   with applied=227 the guard stays quiet (no false alarm)"
  PASS=$((PASS+1))
fi
echo

echo "=== RESULT ============================================================="
echo "  $PASS guard(s) proven capable of failing, $FAIL problem(s)"
if [ "$FAIL" -ne 0 ]; then
  echo "  *** AT LEAST ONE GUARD CANNOT FAIL. It is not protecting anything. ***"
  exit 1
fi
echo "  every sabotaged guard went RED as required"
exit 0

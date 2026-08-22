#!/usr/bin/env bash
# ===========================================================================
# books-35 phase D - MUTATION CAMPAIGN for the sick-leave and garnishment
# mentor layers.
#
# WHY THIS EXISTS. Both suites passed on their first run. That is exactly the
# condition standing rule 50 warns about: a check that has never failed is
# indistinguishable from a check that is not wired to anything. So this script
# breaks the source on purpose, in ways a real careless edit would break it,
# and requires the suite to go RED.
#
# THE SILENT CONTROL. The last mutation is one that SHOULD be invisible -
# a comment change. If the suite goes red on that too, the suite is not
# discriminating, it is just brittle, and its red means nothing (rule 55).
#
# Every mutation is applied to a COPY of the file and reverted in a trap, so
# an interrupted run cannot leave the tree dirty.
# ===========================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

MENTOR_S="src/lib/payroll/sick-leave-mentor.ts"
GATES_S="src/lib/payroll/sick-leave-mentor-gates.ts"
MENTOR_G="src/lib/payroll/garnishment-mentor.ts"
GATES_G="src/lib/payroll/garnishment-mentor-gates.ts"
TEST_S="tests/compliance/sick-leave-mentor.test.ts"
TEST_G="tests/compliance/garnishment-mentor.test.ts"

BACKUP_DIR=$(mktemp -d)
for f in "$MENTOR_S" "$GATES_S" "$MENTOR_G" "$GATES_G"; do
  cp "$f" "$BACKUP_DIR/$(basename "$f")"
done

restore() {
  for f in "$MENTOR_S" "$GATES_S" "$MENTOR_G" "$GATES_G"; do
    cp "$BACKUP_DIR/$(basename "$f")" "$f"
  done
}
trap 'restore; rm -rf "$BACKUP_DIR"' EXIT

PASS=0
FAIL=0

# run_suite <testfile> -> echoes "GREEN" or "RED"
run_suite() {
  local out code
  out=$(npx vitest run "$1" 2>&1)
  code=$?
  if [ "$code" -eq 0 ]; then echo "GREEN"; else echo "RED"; fi
}

# expect_red <label> <testfile>
expect_red() {
  local label="$1" testfile="$2" result
  result=$(run_suite "$testfile")
  if [ "$result" = "RED" ]; then
    echo "  PASS  [$label] suite went RED as required"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  [$label] suite stayed GREEN - the gate is not wired"
    FAIL=$((FAIL + 1))
  fi
  restore
}

# expect_green <label> <testfile>
expect_green() {
  local label="$1" testfile="$2" result
  result=$(run_suite "$testfile")
  if [ "$result" = "GREEN" ]; then
    echo "  PASS  [$label] suite stayed GREEN as required"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  [$label] suite went RED on a harmless change - not discriminating"
    FAIL=$((FAIL + 1))
  fi
  restore
}

echo "=========================================================="
echo " BASELINE - both suites must be green before mutating"
echo "=========================================================="
b1=$(run_suite "$TEST_S")
b2=$(run_suite "$TEST_G")
echo "  sick-leave  : $b1"
echo "  garnishment : $b2"
if [ "$b1" != "GREEN" ] || [ "$b2" != "GREEN" ]; then
  echo "BASELINE NOT GREEN - mutation results would be meaningless. Stopping."
  exit 1
fi

echo
echo "=========================================================="
echo " MUTATION 1 - delete a field lesson (sick leave)"
echo " A column loses its explanation. The commonest real"
echo " regression: somebody tidies the file."
echo "=========================================================="
python3 - "$MENTOR_S" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
# Remove the whole lesson object for sick_leave_policy.usage_increment_minutes.
i = s.index('field: "sick_leave_policy.usage_increment_minutes"')
start = s.rindex("  {", 0, i)
end = s.index("\n  },", i) + len("\n  },")
open(p, "w").write(s[:start] + s[end:])
PY
expect_red "delete field lesson" "$TEST_S"

echo
echo "=========================================================="
echo " MUTATION 2 - widen the structural exemption list to hide"
echo " a money column (garnishment). THIS IS THE BOOKS-34 BUG,"
echo " transplanted. There it left the whole suite green."
echo "=========================================================="
python3 - "$GATES_G" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace('  "wage_orders.id",',
              '  "wage_orders.id",\n  "wage_orders.amount_cents_per_period",', 1)
open(p, "w").write(s)
PY
expect_red "hide a money column behind an exemption" "$TEST_G"

echo
echo "=========================================================="
echo " MUTATION 3 - drop a refusal lesson (garnishment)"
echo " A code the engine can still emit reaches Michael as a"
echo " bare string with no explanation."
echo "=========================================================="
python3 - "$MENTOR_G" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
i = s.index('code: "PERCENT_OUT_OF_RANGE"')
start = s.rindex("  {", 0, i)
end = s.index("\n  },", i) + len("\n  },")
open(p, "w").write(s[:start] + s[end:])
PY
expect_red "drop a refusal lesson" "$TEST_G"

echo
echo "=========================================================="
echo " MUTATION 4 - break a citation (sick leave)"
echo " A lesson cites an authority that does not exist. The"
echo " reader believes it was checked."
echo "=========================================================="
python3 - "$MENTOR_S" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
i = s.index('authorityIds: [')
j = s.index("]", i)
open(p, "w").write(s[:i] + 'authorityIds: ["rcw-00-00-000-invented"' + s[j:])
PY
expect_red "citation with nothing behind it" "$TEST_S"

echo
echo "=========================================================="
echo " MUTATION 5 - hollow out a lesson (garnishment)"
echo " The lesson still EXISTS, so a count-based gate would be"
echo " satisfied. It just no longer teaches anything."
echo "=========================================================="
python3 - "$MENTOR_G" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
i = s.index('field: "wage_orders.supports_second_family"')
j = s.index("theTrap:", i)
k = s.index("howToBeSure:", j)
open(p, "w").write(s[:j] + 'theTrap: "n/a",\n    ' + s[k:])
PY
expect_red "hollow out a lesson but keep the count right" "$TEST_G"

echo
echo "=========================================================="
echo " MUTATION 6 - reorder the review checklist (garnishment)"
echo " Put a ceiling question before disposable earnings. Every"
echo " step is still present and individually correct; the"
echo " TEACHING is wrong."
echo "=========================================================="
python3 - "$MENTOR_G" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace('key: "disposable-first",\n    order: 1,',
              'key: "disposable-first",\n    order: 3,', 1)
s = s.replace('key: "which-cap-governs",\n    order: 3,',
              'key: "which-cap-governs",\n    order: 1,', 1)
open(p, "w").write(s)
PY
expect_red "reorder the checklist so caps come before the base" "$TEST_G"

echo
echo "=========================================================="
echo " MUTATION 7 - SILENT CONTROL (garnishment)"
echo " Change a COMMENT only. Nothing observable changes, so the"
echo " suite MUST stay green. If it goes red, the suite is"
echo " brittle rather than discriminating and its red means"
echo " nothing (standing rule 55)."
echo "=========================================================="
python3 - "$MENTOR_G" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace(" * THE RULE-26 MENTOR LAYER FOR THE GARNISHMENT ENGINE.",
              " * THE RULE-26 MENTOR LAYER FOR THE GARNISHMENT ENGINE. (comment touched)", 1)
open(p, "w").write(s)
PY
expect_green "silent control: comment-only change" "$TEST_G"

echo
echo "=========================================================="
echo " RESULT: $PASS passed, $FAIL failed"
echo "=========================================================="
[ "$FAIL" -eq 0 ] || exit 1

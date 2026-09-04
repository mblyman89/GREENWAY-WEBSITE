#!/usr/bin/env bash
#
# scripts/slice13/mutate.sh — mutation testing for Slice 13.
#
# THE MANDATE (owner, verbatim): "Test everything you can and test the tests."
#
# A passing test suite proves the tests pass. It does NOT prove the tests would
# NOTICE if the code broke. This script breaks the code on purpose, one change
# at a time, and demands that the suite fail. The rules:
#
#   KILLED   — the suite failed. The tests are doing their job.
#   SURVIVED — the suite still passed with broken code. That is a TEST GAP,
#              not a curiosity. Every survivor must be closed with a new test
#              or explicitly proven equivalent. Never waved away.
#   NOT-APPLIED — the `find` string did not match the source. This is treated
#              as a HARD FAILURE, because a mutant that never got applied would
#              otherwise be scored as a meaningless "killed" and quietly inflate
#              the result. Measured, not assumed.
#
# Usage:  bash scripts/slice13/mutate.sh [mutant-id-substring]
#
set -uo pipefail
cd "$(dirname "$0")/../.."

MUTANTS="scripts/slice13/mutants.json"
FILTER="${1:-}"
TESTS="tests/compliance/slice13-inventory-filtering.test.ts tests/compliance/slice7-lot-enrichment-worklists.test.ts"

BACKUP_DIR="$(mktemp -d)"
trap 'restore_all; rm -rf "$BACKUP_DIR"' EXIT INT TERM

# Back up every file any mutant touches, once, up front.
FILES=$(jq -r '.[].file' "$MUTANTS" | sort -u)
for f in $FILES; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp "$f" "$BACKUP_DIR/$f"
done

restore_all() {
  for f in $FILES; do
    [ -f "$BACKUP_DIR/$f" ] && cp "$BACKUP_DIR/$f" "$f"
  done
}

TOTAL=0; KILLED=0; SURVIVED=0; BROKEN=0; EQUIV_OK=0
SURVIVOR_LIST=""
BROKEN_LIST=""

COUNT=$(jq 'length' "$MUTANTS")
echo "=============================================================="
echo " SLICE 13 MUTATION RUN — $COUNT mutants defined"
echo "=============================================================="

for i in $(seq 0 $((COUNT - 1))); do
  ID=$(jq -r ".[$i].id" "$MUTANTS")
  [ -n "$FILTER" ] && [[ "$ID" != *"$FILTER"* ]] && continue

  FILE=$(jq -r ".[$i].file" "$MUTANTS")
  WHY=$(jq -r ".[$i].why" "$MUTANTS")
  EQUIV=$(jq -r ".[$i].equivalent // false" "$MUTANTS")
  TOTAL=$((TOTAL + 1))

  restore_all

  # Apply the mutant with a literal (non-regex) find/replace done in Node, so
  # that punctuation in the patterns cannot be misread as a pattern.
  APPLIED=$(FILE="$FILE" IDX="$i" MUTANTS="$MUTANTS" node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.env.MUTANTS, "utf8"))[Number(process.env.IDX)];
    const src = fs.readFileSync(m.file, "utf8");
    const n = src.split(m.find).length - 1;
    if (n !== 1) { console.log("NO:" + n); process.exit(0); }
    fs.writeFileSync(m.file, src.replace(m.find, m.replace));
    console.log("YES");
  ')

  if [ "$APPLIED" != "YES" ]; then
    echo "[$((i+1))/$COUNT] $ID"
    echo "        !! NOT APPLIED (find matched ${APPLIED#NO:} times, need exactly 1)"
    BROKEN=$((BROKEN + 1))
    BROKEN_LIST="$BROKEN_LIST\n  - $ID  (matched ${APPLIED#NO:}x in $FILE)"
    continue
  fi

  # Run the Slice 13 suites AND the pure self-test sweep. The self-tests live
  # inside the source files, so they are mutated too and count as tests.
  if npx vitest run $TESTS --reporter=dot >/dev/null 2>&1 \
     && npx tsx scripts/compliance/run-pure-selftests.ts >/dev/null 2>&1; then
    if [ "$EQUIV" = "true" ]; then
      # Expected to survive, and the reason is written down and proven.
      echo "[$((i+1))/$COUNT] $ID ... survived (EQUIVALENT, proof on file)"
      EQUIV_OK=$((EQUIV_OK + 1))
    else
      echo "[$((i+1))/$COUNT] $ID"
      echo "        SURVIVED  <-- TEST GAP"
      echo "        would allow: $WHY"
      SURVIVED=$((SURVIVED + 1))
      SURVIVOR_LIST="$SURVIVOR_LIST\n  - $ID\n      $WHY"
    fi
  else
    if [ "$EQUIV" = "true" ]; then
      # A mutant DECLARED equivalent that actually gets killed means the
      # equivalence proof is now WRONG \u2014 the code changed underneath it. That
      # is a documentation defect and must not pass silently.
      echo "[$((i+1))/$COUNT] $ID"
      echo "        !! KILLED but declared EQUIVALENT \u2014 the proof is stale. Re-verify."
      BROKEN=$((BROKEN + 1))
      BROKEN_LIST="$BROKEN_LIST\n  - $ID  (declared equivalent, but the tests killed it)"
    else
      echo "[$((i+1))/$COUNT] $ID ... killed"
      KILLED=$((KILLED + 1))
    fi
  fi
done

restore_all

echo
echo "=============================================================="
echo " RESULT: $KILLED killed / $EQUIV_OK proven-equivalent / $SURVIVED survived / $BROKEN invalid  (of $TOTAL run)"
echo "=============================================================="
if [ "$BROKEN" -gt 0 ]; then
  echo -e "NOT APPLIED (fix the mutant definition, do not ignore):$BROKEN_LIST"
fi
if [ "$SURVIVED" -gt 0 ]; then
  echo -e "SURVIVORS (each one is a missing test):$SURVIVOR_LIST"
fi

# Verify the working tree really was restored. A mutation script that leaves
# a mutant behind would poison every later run.
if ! git diff --quiet -- $FILES; then
  echo "FATAL: source files were NOT restored cleanly. Inspect git diff."
  exit 2
fi
echo "source tree restored clean."

[ "$BROKEN" -eq 0 ] && [ "$SURVIVED" -eq 0 ]

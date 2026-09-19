#!/usr/bin/env bash
# =============================================================================
#  sabotage-0229-proof.sh -- TEST THE TEST (migration layer)
# =============================================================================
#
#  prove-0229-executes.sh reports "33 passed, 0 failed". On its own that number
#  is worthless. THREE separate times this slice the proof produced a result
#  that reflected a defect in the HARNESS rather than in the migration:
#
#    run 1  the fixture insert was silently rejected (public.orders
#           .customer_first_name is NOT NULL with no default), so every
#           behaviour test below it ran against a table with no rows
#    run 2  `psql -tAc` on `INSERT ... RETURNING` prints the value AND the
#           command tag, so a perfectly good insert compared unequal to its own
#           sentinel  ("inserted\nINSERT 0 1" != "inserted")
#    run 3  the SQLSTATE parser anchored on a "SQLSTATE" label that psql never
#           prints, so BOTH negative tests yielded "" -- failing safely while
#           proving nothing whatsoever
#
#  A green proof means nothing until it has been shown to go RED when the thing
#  it protects is broken. So we damage the migration in the exact ways that
#  would hurt the floor and require the proof to catch every one. Anything that
#  survives is a hole in the proof and is named in the summary.
#
#  The sabotages themselves live in sabotage_0229_edits.py. They used to live
#  here as heredoc'd python that bash re-indented with sed, which silently
#  corrupted every multi-line string literal and produced three phantom
#  "anchor misses"; and one consequence string contained backticks, which bash
#  ran as a command substitution. Keeping the edits in a real Python module
#  removes both classes of harness bug. `selftest` there proves all anchors
#  still bind and that no two sabotages collapse into the same text (which
#  would overstate coverage).
#
#  The migration is restored byte-for-byte on EVERY exit path, including
#  interrupt, and the restore is sha256-verified rather than assumed.
#
#  Usage:  bash scripts/compliance/sabotage-0229-proof.sh
# =============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="$REPO/supabase/migrations/0229_leafly_register_claim.sql"
PROOF="$REPO/scripts/compliance/prove-0229-executes.sh"
EDITS="$REPO/scripts/compliance/sabotage_0229_edits.py"
STAGE=/tmp/gw-proof
BACKUP="$(mktemp /tmp/0229.orig.XXXXXX.sql)"

for f in "$MIG" "$PROOF" "$EDITS"; do
  [ -f "$f" ] || { echo "missing required file: $f"; exit 1; }
done

cp "$MIG" "$BACKUP"
SHA_BEFORE="$(sha256sum "$MIG" | cut -d' ' -f1)"

restore() {
  cp "$BACKUP" "$MIG"
  local after
  after="$(sha256sum "$MIG" | cut -d' ' -f1)"
  if [ "$after" != "$SHA_BEFORE" ]; then
    echo
    echo "*** RESTORE FAILED -- 0229 IS NOT AS IT WAS."
    echo "*** Restore by hand from $BACKUP before doing anything else."
    exit 2
  fi
  rm -f "$BACKUP"
}
trap restore EXIT INT TERM

# Stage the tree and run the proof; echo only its verdict line.
run_proof() {
  mkdir -p "$STAGE/supabase/migrations" "$STAGE/scripts/compliance"
  cp "$REPO"/supabase/migrations/*.sql "$STAGE/supabase/migrations/" 2>/dev/null
  cp "$PROOF" "$STAGE/scripts/compliance/"
  chmod -R a+rX "$STAGE" 2>/dev/null
  sudo -u postgres bash "$STAGE/scripts/compliance/prove-0229-executes.sh" 2>&1 \
    | grep -E '0229 PROOF:' | tail -1
}

echo "========================================================================"
echo "  SABOTAGING 0229 -- the proof must go RED for every case"
echo "========================================================================"
echo
echo "--- step 0: the sabotage catalogue must still bind to 0229 -------------"
# If an anchor has drifted, the run below would report a phantom survivor and
# send me hunting a hole that does not exist. Checked FIRST, and fatally.
if ! python3 "$EDITS" selftest "$MIG"; then
  echo
  echo "  *** REFUSING TO RUN: a sabotage anchor no longer binds to 0229."
  echo "  *** Fix sabotage_0229_edits.py (not the migration) and re-run."
  exit 1
fi

echo
echo "--- step 1: the REAL migration must be green, or a RED means nothing ---"
BASE="$(run_proof)"
echo "  ${BASE:-<no verdict -- the proof did not complete>}"
BASE_FAILS="$(printf '%s' "$BASE" | sed -nE 's/.*, ([0-9]+) failed.*/\1/p')"
if [ "$BASE_FAILS" != "0" ]; then
  echo
  echo "  *** REFUSING TO RUN. The baseline is not green, which would make"
  echo "  *** every sabotage below look 'caught' for the wrong reason."
  exit 1
fi

echo
echo "--- step 2: break it, one way at a time -------------------------------"

CAUGHT=0
SURVIVED=0
SURVIVORS=()
NAMES="$(python3 "$EDITS" names)"

while IFS= read -r name; do
  [ -n "$name" ] || continue
  cp "$BACKUP" "$MIG"

  if ! python3 "$EDITS" apply "$name" "$MIG"; then
    echo "  ANCHOR-MISS  $name (fix the catalogue -- this is not a survivor)"
    SURVIVED=$((SURVIVED + 1)); SURVIVORS+=("$name (anchor miss)")
    continue
  fi

  verdict="$(run_proof)"
  fails="$(printf '%s' "$verdict" | sed -nE 's/.*, ([0-9]+) failed.*/\1/p')"
  why="$(python3 "$EDITS" why "$name")"

  if [ -z "$fails" ]; then
    # No verdict line at all: the migration would not even apply, so the proof
    # aborted. That IS a catch -- the gate refuses a non-executing migration.
    echo "  caught       $name  (migration would not apply at all)"
    echo "               guards: $why"
    CAUGHT=$((CAUGHT + 1))
  elif [ "$fails" -gt 0 ]; then
    echo "  caught       $name  ($fails check(s) went red)"
    echo "               guards: $why"
    CAUGHT=$((CAUGHT + 1))
  else
    echo "  *** SURVIVED $name -- THE PROOF DOES NOT CHECK THIS ***"
    echo "               unguarded: $why"
    SURVIVED=$((SURVIVED + 1)); SURVIVORS+=("$name")
  fi
done <<< "$NAMES"

# Restore now (the trap will also do it) so the post-check is meaningful.
cp "$BACKUP" "$MIG"

echo
echo "--- step 3: the tree must be exactly as we found it --------------------"
SHA_AFTER="$(sha256sum "$MIG" | cut -d' ' -f1)"
if [ "$SHA_AFTER" = "$SHA_BEFORE" ]; then
  echo "  ok   0229 is byte-identical to before the run ($SHA_AFTER)"
else
  echo "  *** 0229 WAS LEFT MODIFIED -- restore from $BACKUP ***"
  SURVIVED=$((SURVIVED + 1)); SURVIVORS+=("tree not restored")
fi

echo
echo "--- step 4: and it must still be green --------------------------------"
FINAL="$(run_proof)"
echo "  ${FINAL:-<no verdict>}"
FINAL_FAILS="$(printf '%s' "$FINAL" | sed -nE 's/.*, ([0-9]+) failed.*/\1/p')"
if [ "$FINAL_FAILS" != "0" ]; then
  echo "  *** the proof is no longer green after the run ***"
  SURVIVED=$((SURVIVED + 1)); SURVIVORS+=("not green after run")
fi

echo
echo "========================================================================"
echo "  SABOTAGE RESULT: $CAUGHT caught, $SURVIVED survived"
if [ "$SURVIVED" -gt 0 ]; then
  echo
  echo "  Holes in the proof (or bad anchors in the catalogue):"
  for x in "${SURVIVORS[@]}"; do echo "    - $x"; done
  echo
  echo "  RESULT: *** THE 0229 PROOF IS NOT TRUSTWORTHY YET ***"
  echo "========================================================================"
  exit 1
fi
echo "  RESULT: every sabotage was caught -- the 0229 proof has teeth"
echo "========================================================================"

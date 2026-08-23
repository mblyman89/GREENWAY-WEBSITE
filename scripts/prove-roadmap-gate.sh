#!/usr/bin/env bash
#
# scripts/prove-roadmap-gate.sh   (books-43, closing)
#
# MUTATION CAMPAIGN FOR THE ROADMAP GATE.
#
# Standing rule 39: a check that cannot fail is not a check. Standing rule 15/16:
# proving a gate EXISTS is not proving it FIRES. `tests/compliance/books-roadmap-
# agreed-order.test.ts` makes a strong promise - that the roadmap Michael will
# plan around cannot silently drift from the code. That promise is worth exactly
# as much as this script's kill rate.
#
# Michael's instruction is the reason this file exists:
#
#   "I don't want to miss something and drift from what's important."
#
# Every mutation below is drift somebody could plausibly introduce while editing
# a document in good faith: re-ordering a table, paraphrasing a quote to read
# better, letting a count go stale after refactoring a module, tightening prose
# and losing the sentence that carried the constraint.
#
# ─────────────────────────────────────────────────────────────────────────────
# TWO CONTROLS, AND WHY A CAMPAIGN WITHOUT THEM IS WORTHLESS
# ─────────────────────────────────────────────────────────────────────────────
#
# Standing rule 55: refusal must DISCRIMINATE. A suite that goes red on any edit
# whatsoever would score a perfect 13/13 here and mean absolutely nothing - it
# would be measuring its own brittleness and calling it rigour. So before the
# attacks, two SILENT CONTROLS run: edits that change the documents in ways that
# genuinely do not touch any claim. Both MUST stay GREEN.
#
#   Control 1 - add an ordinary prose sentence to the roadmap.
#   Control 2 - reflow a line in the owner document (prose is not a claim).
#
# If a control goes red, the gate is over-fitted to the current byte layout and
# the kill rate below is noise. That is a failure of THIS script's subject, and
# it is reported as loudly as an uncaught mutation.
#
# ─────────────────────────────────────────────────────────────────────────────
# RESTORATION
# ─────────────────────────────────────────────────────────────────────────────
#
# Standing rule 70d: compare against the BACKUP, not against HEAD. The documents
# under attack are deliberately uncommitted while this slice is in flight, so
# `git diff` would report my own in-progress work as "not restored" and train me
# to ignore the one signal that matters. Every file is restored from a byte-exact
# copy and verified with `cmp`, the way the other prove-* scripts in this repo do
# it.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

DOC="docs/BOOKS_ROADMAP.md"
OWNER="docs/MICHAEL-books-43-the-plan-from-here.md"
TEST="tests/compliance/books-roadmap-agreed-order.test.ts"

BACKUP_DIR="$(mktemp -d)"
cp "$DOC" "$BACKUP_DIR/roadmap.bak"
cp "$OWNER" "$BACKUP_DIR/owner.bak"

restore() {
  cp "$BACKUP_DIR/roadmap.bak" "$DOC"
  cp "$BACKUP_DIR/owner.bak" "$OWNER"
}

cleanup() {
  restore
  # Byte-exact verification, not a diff against the index.
  local bad=0
  cmp -s "$BACKUP_DIR/roadmap.bak" "$DOC" || { echo "!! $DOC NOT RESTORED"; bad=1; }
  cmp -s "$BACKUP_DIR/owner.bak" "$OWNER" || { echo "!! $OWNER NOT RESTORED"; bad=1; }
  [ "$bad" -eq 0 ] && echo "both documents restored byte-exact (cmp)"
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

run_suite() {
  if npx vitest run "$TEST" >/tmp/prove-roadmap.log 2>&1; then
    echo "GREEN"
  else
    echo "RED"
  fi
}

CAUGHT=0
NOOPS=0
MISSED=0
CONTROLS_OK=0
CONTROLS_BROKEN=0

# An attack: the suite MUST go red.
#
# A MUTATION THAT DID NOT LAND IS NOT A SURVIVING MUTANT. Before judging the
# gate, confirm the edit actually changed something on disk. The first run of
# this campaign reported a false "NOT CAUGHT" because a perl substitution
# silently failed to match (see t_owner_order below), and I nearly went looking
# for a hole in an innocent gate. An unapplied mutation is a defect in the
# CAMPAIGN and it must be impossible to mistake for a defect in the subject.
attack() {
  local name="$1"; shift
  restore
  "$@"

  # Did anything actually change? Deletion counts as a change.
  if cmp -s "$BACKUP_DIR/roadmap.bak" "$DOC" 2>/dev/null \
     && cmp -s "$BACKUP_DIR/owner.bak" "$OWNER" 2>/dev/null; then
    echo "  NO-OP       | $name  <-- MUTATION NEVER APPLIED, this line proves nothing"
    NOOPS=$((NOOPS + 1))
    restore
    return
  fi

  if [ "$(run_suite)" = "RED" ]; then
    echo "  CAUGHT      | $name"
    CAUGHT=$((CAUGHT + 1))
  else
    echo "  NOT CAUGHT  | $name"
    MISSED=$((MISSED + 1))
  fi
  restore
}

# A control: the suite MUST stay green (rule 55).
control() {
  local name="$1"; shift
  restore
  "$@"
  if [ "$(run_suite)" = "GREEN" ]; then
    echo "  CORRECT     | control stayed GREEN - $name"
    CONTROLS_OK=$((CONTROLS_OK + 1))
  else
    echo "  BROKEN      | control went RED   - $name  <-- gate fails on anything"
    CONTROLS_BROKEN=$((CONTROLS_BROKEN + 1))
  fi
  restore
}

# ── Controls ────────────────────────────────────────────────────────────────
# Ordinary prose added to the roadmap. Touches no count, no order, no claim.
c_prose() {
  printf '\n<!-- An editorial note added by the control. No claim changes. -->\n' >> "$DOC"
}
# The owner document's ARGUMENT is judgement, not fact (rule 66c). Rewording an
# explanatory sentence must not break the build, or nobody will ever improve it.
c_owner_prose() {
  perl -0pi -e 's/That is exactly the right instinct/That instinct is exactly right/' "$OWNER"
}

# ── Attacks on the roadmap ──────────────────────────────────────────────────

# 1. Re-order the slices: swap B ahead of D. The drift Michael explicitly named.
t_order() { perl -0pi -e 's/(\| \*\*D\*\* \|[^\n]*\n)(\| \*\*B\*\* \|[^\n]*\n)/$2$1/' "$DOC"; }

# 2. Paraphrase Michael's verbatim instruction.
t_quote() { perl -0pi -e "s/then a, then d, then b last as recommended/in the order you suggested/" "$DOC"; }

# 3. Stale lesson count in the recon table (33 -> 34).
t_count() { perl -0pi -e 's/\| 33 \|/\| 34 \|/' "$DOC"; }

# 4. Stale line count (746 -> 747). NOTE: the first version of the gate held this
#    number in the TEST and never read the document's figure, so this mutation
#    survived. Rule 70a.
t_lines() { perl -0pi -e 's/\| 746 \|/\| 747 \|/' "$DOC"; }

# 5. Cross-foot broken: total no longer equals the sum of rows.
t_total() { perl -0pi -e 's/\*\*82\*\*/\*\*81\*\*/' "$DOC"; }

# 6. Drop the Form 7203 blocker that justifies B being last.
t_7203() { perl -0pi -e 's/Form 7203/Form seven-two-oh-three/g' "$DOC"; }

# 7. Lose the box 17 trap.
t_box17() { perl -0pi -e 's/Box 17 must be blank/Box 17 is handled automatically/' "$DOC"; }

# 8. Lose the box 1 > boxes 3/5 trap.
t_box1() { perl -0pi -e 's/box 1 legitimately exceeds boxes 3 and 5/box 1 matches boxes 3 and 5/i' "$DOC"; }

# 9. Lose the instruction to UPDATE rather than delete the reachability probe.
t_probe() { perl -0pi -e 's/UPDATED, not deleted/removed/' "$DOC"; }

# 10. Lose the node:fs constraint that decides slice C's architecture.
t_nodefs() { perl -0pi -e 's/node:fs/nodefs/g' "$DOC"; }

# 11. Drop a module from the recon table entirely.
t_dropmod() { perl -0pi -e 's{\| `reports/payroll-reconciliation-mentor.ts` \|[^\n]*\n}{}' "$DOC"; }

# 12. Lose the RCW ORDER-OF-OPERATIONS claim (fix the router BEFORE fetching).
#     An earlier version of this case replaced only the FIRST "routing bug" and
#     was correctly NOT caught - the assertion targets the sentence stating the
#     dependency, a different line. A tamper must attack what the gate actually
#     claims, or it proves nothing about the gate (rule 70c).
t_rcw() { perl -0pi -e 's/must be fixed \*before\* fetching/can be fixed whenever/' "$DOC"; }

# 13. Erase the diagnosis linking it to the known swallow-the-suffix defect.
t_suffix() { perl -0pi -e 's/swallow-the-suffix/unrelated/' "$DOC"; }

# ── Attacks on the owner document (rule 66) ─────────────────────────────────

# 14. The owner document disagrees with the roadmap about the ORDER. Two
#     documents describing one plan is exactly how a plan forks in half.
#
#     A MUTATION THAT LIED TO ME, TWICE, AND WHAT IT COST TO NOTICE.
#
#     The heading contains `→`, which is three UTF-8 bytes. Attempt one matched
#     each arrow with a single `.`; perl reads the file as BYTES, so `.` could
#     not match a three-byte character and the substitution never applied. The
#     run reported NOT CAUGHT and I nearly went hunting for a hole in a gate
#     that was innocent. Attempt two added `-CSD`, which decodes perl's I/O
#     STREAMS but not the LITERAL inside the one-liner, so pattern and subject
#     were still in different encodings - and it silently failed again, with
#     exit status 0 both times.
#
#     The fix is to stop asserting anything about the encoding: match the rest
#     of the line with `[^\n]*`. Never negotiate with a character set you can
#     route around.
#
#     The general lesson is bigger than perl, and it is why `attack` now
#     verifies the file actually changed: CONFIRM THE MUTATION LANDED BEFORE
#     BELIEVING WHAT THE SUITE SAYS ABOUT IT. A mutation that never applied is
#     indistinguishable, in the output, from a gate that does not work - and it
#     accuses the innocent party.
t_owner_order() { perl -0pi -e 's/## The order we agreed: [^\n]*/## The order we agreed: C, then B/' "$OWNER"; }

# 15. The owner document's lesson total drifts from the code.
t_owner_total() { perl -0pi -e 's/\*\*82\*\*/\*\*80\*\*/' "$OWNER"; }

# 16. The owner document loses the box 17 trap - the one Michael must not let a
#     future bookkeeper "fix".
t_owner_box17() { perl -0pi -e 's/Box 17 must be blank/Box 17 fills itself in/' "$OWNER"; }

# 17. The owner document quietly drops the Form 7203 blocker, so Michael would
#     not know what to go and fetch.
t_owner_7203() { perl -0pi -e 's/Form 7203/the basis form/g' "$OWNER"; }

# 18. The owner document is deleted outright. Rule 66d: a guard that passes on a
#     deleted file is not a guard.
t_owner_gone() { rm -f "$OWNER"; }

echo "=== CONTROLS (rule 55: these MUST stay green) ==="
control "prose added to the roadmap"          c_prose
control "explanatory sentence reworded"       c_owner_prose

echo ""
echo "=== ATTACKS ON docs/BOOKS_ROADMAP.md ==="
attack "slices re-ordered (B jumps ahead of D)"     t_order
attack "Michael's verbatim instruction paraphrased" t_quote
attack "stale lesson count in the recon table"      t_count
attack "stale line count in the recon table"        t_lines
attack "cross-foot broken: total != sum of rows"    t_total
attack "Form 7203 blocker dropped"                  t_7203
attack "box 17 trap lost"                           t_box17
attack "box 1 > boxes 3/5 trap lost"                t_box1
attack "probe instruction changed to 'delete'"      t_probe
attack "node:fs constraint erased"                  t_nodefs
attack "a module dropped from the recon table"      t_dropmod
attack "RCW order-of-operations claim lost"         t_rcw
attack "swallow-the-suffix diagnosis erased"        t_suffix

echo ""
echo "=== ATTACKS ON the owner document ==="
attack "owner doc contradicts the agreed order"     t_owner_order
attack "owner doc lesson total drifts from code"    t_owner_total
attack "owner doc loses the box 17 trap"            t_owner_box17
attack "owner doc drops the Form 7203 blocker"      t_owner_7203
attack "owner doc deleted outright"                 t_owner_gone

echo ""
echo "---------------------------------------------------------------"
echo "CAUGHT   $CAUGHT / $((CAUGHT + MISSED)) mutations that actually applied"
echo "NO-OPS   $NOOPS (mutations that never landed - campaign defects, not gate defects)"
echo "CONTROLS $CONTROLS_OK correct, $CONTROLS_BROKEN broken"
[ "$MISSED" -eq 0 ] || echo "!! $MISSED NOT CAUGHT - those assertions are decorative"
[ "$NOOPS" -eq 0 ] || echo "!! $NOOPS mutation(s) never applied - FIX THE CAMPAIGN, the gate was not tested"
[ "$CONTROLS_BROKEN" -eq 0 ] || echo "!! a control went red - the kill rate above is NOISE (rule 55)"

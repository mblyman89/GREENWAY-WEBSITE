#!/usr/bin/env bash
# ===========================================================================
# MUTATION CAMPAIGN -- slice-books-01 (General Journal + owner-only lockdown)
#
# Michael asked: "Test it, break it, fix it to be better, test the tests."
#
# A passing test suite proves nothing on its own -- a suite of `expect(true)`
# also passes. This script deliberately BREAKS the source in ways that a real
# regression would, and demands the gates NOTICE. Then it applies changes that
# alter nothing meaningful and demands the gates STAY QUIET, so we know the
# suite is detecting behaviour rather than reacting to any edit at all.
#
#   MUTANT  -> a real defect. The gates MUST FAIL. If they pass, the mutant
#              "SURVIVED" and our tests have a hole.
#   CONTROL -> a semantically neutral edit. The gates MUST PASS. If they fail,
#              the suite is brittle and coupled to formatting.
#
# Every mutation is applied to a scratch copy of the file and reverted with
# git checkout, so the working tree is always restored.
# ===========================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."

ADV="src/lib/accounting/journal-advisor-core.ts"
BOOKS="src/lib/accounting/books-view-core.ts"
ROLES="src/lib/auth/roles.ts"

PASS=0
FAIL=0
declare -a FAILURES=()

# Run both gates. Returns 0 if BOTH pass, 1 if EITHER fails.
run_gates() {
  npx tsx scripts/compliance/run-pure-selftests.ts >/tmp/mut_pure.log 2>&1 || return 1
  npx vitest run tests/compliance/journal-advisor-core.test.ts \
                 tests/compliance/books-view-core.test.ts \
                 >/tmp/mut_vitest.log 2>&1 || return 1
  return 0
}

# ---------------------------------------------------------------------------
# SNAPSHOT / RESTORE
#
# The first version of this script restored with `git checkout -- <file>`. That
# was a real bug and it bit hard:
#   * the files under mutation are NEW in this branch and therefore UNTRACKED,
#     so `git checkout` errored ("did not match any file(s) known to git") and
#     the mutation was NEVER REVERTED -- mutants accumulated on top of each
#     other and every later result was garbage;
#   * for the files that WERE tracked, `git checkout` did the opposite damage:
#     it reverted them to HEAD, silently throwing away the real, uncommitted
#     slice work.
#
# So we snapshot the exact bytes ourselves and put those exact bytes back. This
# is correct for tracked and untracked files alike, and it never consults git.
# ---------------------------------------------------------------------------
SNAPDIR="$(mktemp -d)"
trap 'restore_all; rm -rf "$SNAPDIR"' EXIT INT TERM

snapshot() {
  local file="$1"
  mkdir -p "$SNAPDIR/$(dirname "$file")"
  cp -p "$file" "$SNAPDIR/$file"
}

restore() {
  local file="$1"
  cp -p "$SNAPDIR/$file" "$file"
}

restore_all() {
  local f
  for f in "$ADV" "$BOOKS" "$ROLES"; do
    [ -f "$SNAPDIR/$f" ] && cp -p "$SNAPDIR/$f" "$f"
  done
}

for f in "$ADV" "$BOOKS" "$ROLES"; do snapshot "$f"; done

# Prove the snapshot round-trips before we rely on it for anything.
for f in "$ADV" "$BOOKS" "$ROLES"; do
  restore "$f"
  if ! cmp -s "$f" "$SNAPDIR/$f"; then
    echo "FATAL: snapshot/restore does not round-trip for $f"
    exit 1
  fi
done

# expect_dead <label> <file> <sed-expression>
expect_dead() {
  local label="$1" file="$2" expr="$3"
  cp "$file" /tmp/mut_orig
  sed -i "$expr" "$file"
  if cmp -s "$file" /tmp/mut_orig; then
    echo "  !! NO-OP  $label -- sed changed nothing, mutation is invalid"
    FAILURES+=("INVALID(no-op): $label")
    FAIL=$((FAIL + 1))
    restore "$file"
    return
  fi
  if run_gates; then
    echo "  SURVIVED  $label   <-- TEST HOLE"
    FAILURES+=("SURVIVED: $label")
    FAIL=$((FAIL + 1))
  else
    echo "  killed    $label"
    PASS=$((PASS + 1))
  fi
  restore "$file"
  verify_restored "$file" "$label"
}

# After every mutation the file MUST be byte-identical to the snapshot. If it
# is not, every subsequent result in this run is meaningless -- so stop dead
# rather than report numbers that cannot be trusted.
verify_restored() {
  local file="$1" label="$2"
  if ! cmp -s "$file" "$SNAPDIR/$file"; then
    echo "FATAL: $file was not restored after '$label'. Aborting."
    exit 1
  fi
}

# expect_alive <label> <file> <sed-expression>
expect_alive() {
  local label="$1" file="$2" expr="$3"
  cp "$file" /tmp/mut_orig
  sed -i "$expr" "$file"
  if cmp -s "$file" /tmp/mut_orig; then
    echo "  !! NO-OP  $label -- sed changed nothing, control is invalid"
    FAILURES+=("INVALID(no-op): $label")
    FAIL=$((FAIL + 1))
    restore "$file"
    return
  fi
  if run_gates; then
    echo "  survived  $label   (correct: neutral edit)"
    PASS=$((PASS + 1))
  else
    echo "  DIED      $label   <-- BRITTLE TEST"
    FAILURES+=("BRITTLE: $label")
    FAIL=$((FAIL + 1))
  fi
  restore "$file"
  verify_restored "$file" "$label"
}

echo "=== BASELINE (must be green before we start breaking things) ==="
if run_gates; then
  echo "  baseline green"
else
  echo "  BASELINE IS RED -- fix that first"
  tail -20 /tmp/mut_pure.log /tmp/mut_vitest.log
  exit 1
fi

echo
echo "=== MUTANTS: access control (the owner-only lockdown) ==="
expect_dead "canReadBooks re-admits admin" "$BOOKS" \
  's|^  return role === "owner";$|  return role === "owner" \|\| role === "admin";|'
expect_dead "canReadBooks opens to everyone" "$BOOKS" \
  's|^  return role === "owner";$|  return true;|'
expect_dead "canReadBooks closes to nobody" "$BOOKS" \
  's|^  return role === "owner";$|  return false;|'
expect_dead "books.view regains admin in the matrix" "$ROLES" \
  's|^  "books.view": \["owner"\],$|  "books.view": ["owner", "admin"],|'
expect_dead "financials.view regains admin in the matrix" "$ROLES" \
  's|^  "financials.view": \["owner"\],$|  "financials.view": ["owner", "admin"],|'
expect_dead "financials.view leaks to manager" "$ROLES" \
  's|^  "financials.view": \["owner"\],$|  "financials.view": ["owner", "manager"],|'

echo
echo "=== MUTANTS: the balance check (arithmetic must be exact) ==="
expect_dead "isBalanced gains a one-cent tolerance" "$ADV" \
  's|return sumDebits(lines) - sumCredits(lines) === 0;|return Math.abs(sumDebits(lines) - sumCredits(lines)) <= 1;|'
expect_dead "isBalanced always says yes" "$ADV" \
  's|return sumDebits(lines) - sumCredits(lines) === 0;|return true;|'
expect_dead "sumDebits counts credits too" "$ADV" \
  's|for (const l of lines) if (l.amountCents > 0) total += l.amountCents;|for (const l of lines) total += Math.abs(l.amountCents);|'

echo
echo "=== MUTANTS: whole-word matching (the false-positive defect) ==="
expect_dead "mentionsAny reverts to naive substring" "$ADV" \
  's/const matched = isLast ? tokenMatches(token, word) : token === word;/const matched = haystack.includes(needle);/'
expect_dead "tokenise drops the field BARRIER" "$ADV" \
  's/if (ch === BARRIER) out.push(BARRIER);/\/* barrier removed *\//'
expect_dead "tokenMatches accepts any prefix (drawer==draw)" "$ADV" \
  's/if (!token.startsWith(word)) return false;/if (token.startsWith(word)) return true;/'

echo
echo "=== MUTANTS: the statutory thresholds ==="
expect_dead "section 7872 de minimis moved to \$1,000" "$ADV" \
  's/export const SECTION_7872_DE_MINIMIS_CENTS = 1000000;/export const SECTION_7872_DE_MINIMIS_CENTS = 100000;/'
expect_dead "capitalisation safe harbour moved to \$25" "$ADV" \
  's/export const DE_MINIMIS_CAPITALISATION_CENTS = 250000;/export const DE_MINIMIS_CAPITALISATION_CENTS = 2500;/'

echo
echo "=== MUTANTS: the yield contract (pushback must never become rejection) ==="
expect_dead "the excise hard block is quietly downgraded" "$ADV" \
  's|^  "ADV_EXCISE_MISCODED",$|  // "ADV_EXCISE_MISCODED", -- downgraded|'
expect_dead "the closed-period hard block is quietly downgraded" "$ADV" \
  's|^  "ADV_PERIOD_CLOSED",$|  // "ADV_PERIOD_CLOSED", -- downgraded|'
expect_dead "canSubmit waves through unacknowledged confirms" "$ADV" \
  's|^  const blocks = verdict.findings.filter((f) => f.severity === "block");$|  const blocks: AdvisorFinding[] = [];|'

echo
echo "=== CONTROLS: neutral edits that MUST NOT trip the gates ==="
expect_alive "reword a comment in the advisor" "$ADV" \
  's|^// THE MAIN EVALUATION$|// THE MAIN EVALUATION (neutral comment edit)|'
expect_alive "reword a comment in books-view-core" "$BOOKS" \
  's| \* src/lib/accounting/books-view-core.ts   (slice F5-K)| * src/lib/accounting/books-view-core.ts (neutral comment edit)|'
# Whitespace must not matter either: a blank line added between declarations
# changes bytes but changes no behaviour.
expect_alive "insert a blank line in the advisor" "$ADV" \
  's|^// THE MAIN EVALUATION$|\n// THE MAIN EVALUATION|'

echo
echo "==========================================================="
echo "  mutation campaign: $PASS correct, $FAIL incorrect"
if [ "$FAIL" -ne 0 ]; then
  printf '  %s\n' "${FAILURES[@]}"
  echo "==========================================================="
  exit 1
fi
echo "  ALL MUTANTS DIED. ALL CONTROLS SURVIVED."
echo "==========================================================="

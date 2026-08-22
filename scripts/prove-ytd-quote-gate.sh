#!/usr/bin/env bash
# books-34. PROVE THE VERBATIM GATE IS WIRED TO THE NEW YTD QUOTES.
#
# Standing rule 16: a check that has never been seen to fail is not a check,
# it is a decoration. The verbatim checker reports PASSED for these seven
# authorities - but it also reported PASSED when all seven were being SILENTLY
# SKIPPED because their citations matched no corpus route (the "no local copy"
# bucket went 125 -> 132 and the word PASSED never changed). That near miss is
# exactly why this script exists.
#
# Each mutant below alters ONE quote in a way that matters, and the checker
# must fail naming that authority. A silent control mutates a COMMENT, where
# the checker must stay green - because a gate that fails on everything is as
# useless as one that fails on nothing (rule 55).
set -uo pipefail

FILE="src/lib/payroll/ytd-authorities.ts"
BACKUP="/tmp/ytd-authorities.backup.$$"
cp "$FILE" "$BACKUP"
BEFORE_MD5=$(md5sum "$FILE" | awk '{print $1}')

restore() { cp "$BACKUP" "$FILE"; }
trap restore EXIT

pass=0; fail=0

run_checker() {
  # Capture the runner's OWN exit code. Piping through grep would make $?
  # the exit of the LAST stage - the corollary to standing rule 65 that cost
  # a whole mutation campaign last slice.
  local raw code
  raw=$(npx tsx scripts/verify-verbatim-quotes.ts 2>&1); code=$?
  echo "$raw"
  return $code
}

# $1 = label, $2 = sed expression, $3 = authority id that must be named
mutate_must_die() {
  local label="$1" expr="$2" id="$3"
  restore
  sed -i "$expr" "$FILE"
  if [ "$(md5sum "$FILE" | awk '{print $1}')" = "$BEFORE_MD5" ]; then
    echo "  HARNESS BROKEN [$label]: sed changed nothing - the pattern does not exist."
    fail=$((fail+1)); return
  fi
  local out; out=$(run_checker)
  if echo "$out" | grep -q "RULE 24/35 VERIFICATION FAILED" && echo "$out" | grep -q "$id"; then
    echo "  KILLED  [$label] - checker failed and named $id"
    pass=$((pass+1))
  else
    echo "  SURVIVED [$label] - checker did NOT catch a corrupted quote in $id"
    echo "$out" | grep -iE "verified against|PASSED|FAILED" | sed 's/^/      /'
    fail=$((fail+1))
  fi
}

echo "=== MUTANTS THAT MUST BE CAUGHT ==="
# 1. The wage base itself. One digit. This is the number the whole slice exists
#    to respect; if the checker sleeps through this it protects nothing.
mutate_must_die "wage base 184,500 -> 184,600" \
  's/cannot exceed \$184,500/cannot exceed $184,600/' "w2-box3-wage-base-ceiling"

# 2. The IRS worked example - the engine's test oracle. A wrong oracle is worse
#    than no oracle: it certifies the bug.
mutate_must_die "worked example 199,750 -> 199,570" \
  's/\$199,750 in wages/$199,570 in wages/' "w2-worked-example-199750"

# 3. An SSA rejection condition, inverted. "less than" -> "greater than" turns
#    a real filing rule into its opposite while reading perfectly naturally.
mutate_must_die "SSA condition inverted" \
  's/Medicare wages and tips are less than the sum/Medicare wages and tips are greater than the sum/' \
  "ssa-rejection-conditions"

echo
echo "=== THE MUTANT THE VERBATIM CHECKER CANNOT CATCH ==="
# TRUNCATION. Deleting the LAST bullet of a list leaves a quote that is still a
# perfectly valid substring of the source, so a substring check must pass it.
# This is not a hypothetical: the first extraction script in this slice cut the
# SSA quote at the second bullet by accident, and the checker said VERBATIM OK.
#
# So this mutant is expected to SURVIVE the verbatim checker - and it must be
# KILLED by the structural guard in tests/compliance/ytd-authorities.test.ts.
# Running both against the same mutant is the only way to show that the second
# gate covers what the first cannot.
restore
sed -i 's/ • Medicare tax is greater than zero; Medicare wages and tips are equal to zero\.//' "$FILE"
if [ "$(md5sum "$FILE" | awk '{print $1}')" = "$BEFORE_MD5" ]; then
  echo "  HARNESS BROKEN: truncation sed changed nothing."
  fail=$((fail+1))
else
  vout=$(run_checker)
  if echo "$vout" | grep -q "RULE 24/35 VERIFICATION PASSED"; then
    echo "  verbatim checker: PASSED the truncated quote (expected - substring match is blind to truncation)"
  else
    echo "  NOTE: verbatim checker caught it after all; the structural guard is then belt-and-braces"
  fi

  traw=$(npx vitest run tests/compliance/ytd-authorities.test.ts 2>&1); tcode=$?
  if [ "$tcode" -ne 0 ] && echo "$traw" | grep -q "truncated"; then
    echo "  KILLED  [third SSA bullet deleted] - structural guard caught the truncation"
    pass=$((pass+1))
  else
    echo "  SURVIVED [third SSA bullet deleted] - NOTHING detected a dropped legal condition"
    echo "$traw" | grep -E "Tests |Test Files" | sed 's/^/      /'
    fail=$((fail+1))
  fi
fi

echo
echo "=== SILENT CONTROL (must stay GREEN) ==="
restore
sed -i '1s|^/\*\*|/** books-34 harmless comment touch.|' "$FILE"
if [ "$(md5sum "$FILE" | awk '{print $1}')" = "$BEFORE_MD5" ]; then
  echo "  HARNESS BROKEN: control edit changed nothing."
  fail=$((fail+1))
else
  out=$(run_checker)
  if echo "$out" | grep -q "RULE 24/35 VERIFICATION PASSED"; then
    echo "  CORRECTLY SILENT - a comment edit does not trip the quote checker"
    pass=$((pass+1))
  else
    echo "  FALSE ALARM - checker failed on a comment-only edit"
    fail=$((fail+1))
  fi
fi

# RULE 55: the structural guard must DISCRIMINATE. A gate that fires on every
# edit is as useless as one that fires on none, so prove it stays green on the
# untouched file.
restore
traw=$(npx vitest run tests/compliance/ytd-authorities.test.ts 2>&1); tcode=$?
if [ "$tcode" -eq 0 ]; then
  echo "  CORRECTLY SILENT - structural guard is green on the real, untruncated quotes"
  pass=$((pass+1))
else
  echo "  FALSE ALARM - structural guard fails on the unmodified file"
  echo "$traw" | grep -E "Tests |Test Files" | sed 's/^/      /'
  fail=$((fail+1))
fi

echo
restore
AFTER_MD5=$(md5sum "$FILE" | awk '{print $1}')
if [ "$AFTER_MD5" = "$BEFORE_MD5" ]; then
  echo "RESTORED byte-identical ($AFTER_MD5)"
else
  echo "RESTORE FAILED - $FILE DIFFERS FROM ITS ORIGINAL. Backup: $BACKUP"
  fail=$((fail+1))
fi

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ] || exit 1
echo "YTD QUOTE GATE PROVEN WIRED."

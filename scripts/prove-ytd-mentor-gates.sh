#!/usr/bin/env bash
#
# scripts/prove-ytd-mentor-gates.sh   (books-34)
#
# MUTATION CAMPAIGN FOR THE YEAR-TO-DATE MENTOR GATES.
#
# Standing rule 16: proving a gate exists is not proving it is WIRED. The tests
# in tests/compliance/ytd-mentor.test.ts already feed each gate a broken temp
# file. This script attacks the other side - it mutates the REAL mentor and the
# REAL engine on disk, one edit at a time, and requires the suite to go red.
#
# Every mutation is a mistake somebody could actually make while working on this
# code: dropping a lesson, adding a refusal code without explaining it, renaming
# a column, reordering the year-end checklist, weakening a blocking check.
#
# A SILENT CONTROL runs first: an edit that changes a comment and nothing else
# must leave the suite GREEN. Without it, a suite that failed on everything
# would score a perfect kill rate and mean nothing (standing rule 55).
#
# Every file is restored from a byte-exact backup and verified with cmp.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

MENTOR="src/lib/payroll/ytd-mentor.ts"
GATES="src/lib/payroll/ytd-mentor-gates.ts"
CORE="src/lib/payroll/ytd-core.ts"
TEST="tests/compliance/ytd-mentor.test.ts"

BACKUP_DIR="$(mktemp -d)"
cp "$MENTOR" "$BACKUP_DIR/mentor.bak"
cp "$GATES"  "$BACKUP_DIR/gates.bak"
cp "$CORE"   "$BACKUP_DIR/core.bak"

restore() {
  cp "$BACKUP_DIR/mentor.bak" "$MENTOR"
  cp "$BACKUP_DIR/gates.bak"  "$GATES"
  cp "$BACKUP_DIR/core.bak"   "$CORE"
  cmp -s "$BACKUP_DIR/mentor.bak" "$MENTOR" || { echo "FATAL: could not restore $MENTOR"; exit 2; }
  cmp -s "$BACKUP_DIR/gates.bak"  "$GATES"  || { echo "FATAL: could not restore $GATES";  exit 2; }
  cmp -s "$BACKUP_DIR/core.bak"   "$CORE"   || { echo "FATAL: could not restore $CORE";   exit 2; }
}
trap restore EXIT

# Runs the suite and echoes RED or GREEN.
#
# THE EXIT CODE IS CAPTURED FROM THE RUNNER ITSELF, not from a pipeline. Piping
# vitest through grep makes $? the exit status of grep, which is 0 whether the
# tests passed or not - a lesson this repo learned the expensive way.
run_suite() {
  local out
  out="$(npx vitest run "$TEST" 2>&1)"
  local code=$?
  if [ $code -eq 0 ]; then echo "GREEN"; else echo "RED"; fi
}

BASELINE="$(run_suite)"
if [ "$BASELINE" != "GREEN" ]; then
  echo "ABORT: the suite is already red before any mutation. Nothing below would mean anything."
  exit 2
fi
echo "baseline: GREEN"
echo

KILLED=0
SURVIVED=0
TOTAL=0

mutate() {
  local name="$1"; shift
  TOTAL=$((TOTAL + 1))
  restore
  "$@"
  local result
  result="$(run_suite)"
  if [ "$result" = "RED" ]; then
    KILLED=$((KILLED + 1))
    echo "  KILLED   $name"
  else
    SURVIVED=$((SURVIVED + 1))
    echo "  SURVIVED $name   <-- A GATE IS NOT WIRED"
  fi
  restore
}

# ── The silent control ──────────────────────────────────────────────────────
control() {
  TOTAL=$((TOTAL + 1))
  restore
  printf '\n// a comment that changes no behaviour at all\n' >> "$MENTOR"
  local result
  result="$(run_suite)"
  if [ "$result" = "GREEN" ]; then
    KILLED=$((KILLED + 1))
    echo "  CORRECT  silent control stayed GREEN (the suite discriminates)"
  else
    SURVIVED=$((SURVIVED + 1))
    echo "  BROKEN   silent control went RED   <-- the suite fails on anything"
  fi
  restore
}

echo "=== MUTATIONS ==="
control

# 1. Drop a field lesson. The commonest real mistake: a column is added and
#    nobody writes the lesson.
mutate "delete the lni_hundredth_hours accumulator lesson" \
  perl -0pi -e 's/\{\s*field: "payroll_ytd_accumulators\.lni_hundredth_hours".*?\n  \},\n//s' "$MENTOR"

# 2. Teach a column that does not exist - the rename case.
mutate "rename a taught column so its lesson goes stray" \
  perl -0pi -e 's/field: "payroll_ytd_accumulators\.federal_income_tax_cents"/field: "payroll_ytd_accumulators.fed_income_tax_cents"/' "$MENTOR"

# 3. Add a refusal code to the ENGINE and leave it unexplained.
mutate "add an eighth refusal code to the engine with no lesson" \
  perl -0pi -e 's/  \| "YTD_MEDICARE_BELOW_OASDI";/  | "YTD_MEDICARE_BELOW_OASDI"\n  | "YTD_BRAND_NEW_CODE";/' "$CORE"

# 4. Remove a refusal lesson while the code still exists.
mutate "delete the YTD_WOULD_GO_NEGATIVE lesson" \
  perl -0pi -e 's/\{\s*code: "YTD_WOULD_GO_NEGATIVE".*?\n  \},\n//s' "$MENTOR"

# 5. Add an exported function to the engine with no coverage entry.
mutate "add an exported engine function with no explanation" \
  bash -c 'printf "\nexport function anUnexplainedNewFunction(): number {\n  return 0;\n}\n" >> src/lib/payroll/ytd-core.ts'

# 6. Cite an authority that does not exist.
mutate "point a citation at an authority id that was never mirrored" \
  perl -0pi -e 's/"w2-box3-wage-base-ceiling"/"w2-box3-wage-base-ceiling-typo"/' "$MENTOR"

# 7. Move reconciliation out of first place in the year-end checklist.
mutate "reorder the year-end checks so reconciliation is not first" \
  perl -0pi -e 's/    key: "reconcile-to-lines",/    key: "reconcile-to-lines-MOVED",/' "$MENTOR"

# 8. Downgrade an SSA rejection condition from blocking to a warning.
mutate "let the medicare-below-social-security check stop blocking a filing" \
  perl -0pi -e 's/(key: "medicare-not-below-social-security",.*?)blocksFiling: true,/\1blocksFiling: false,/s' "$MENTOR"

# 9. Silence the vacuity guard - make the parser return nothing and check that
#    the gate reports a BROKEN GATE rather than a clean pass.
mutate "break the migration parser so it reads no columns" \
  perl -0pi -e 's/const p = sourcePath \?\? join\(process\.cwd\(\), MIGRATION_0199\);/const p = sourcePath ?? join(process.cwd(), MIGRATION_0199); if (!sourcePath) return [];/' "$GATES"

# 10. Weaken the structural exemption so a real money column is exempted from
#     needing a lesson.
#
#     THIS ONE SURVIVED THE FIRST RUN OF THIS SCRIPT. Every gate still ran, read
#     the migration, and reported full coverage, while box 3 of the W-2 quietly
#     stopped needing an explanation. The fix was not to add a test naming this
#     column - that treats the instance (rule 23). It was to require every
#     exemption to be structural BY ITS TYPE in the migration, so that no
#     numeric column can ever be listed here whatever anybody's reason.
mutate "exempt a real money column as if it were structural" \
  perl -0pi -e 's/  "payroll_ytd_accumulators\.updated_at",/  "payroll_ytd_accumulators.updated_at",\n  "payroll_ytd_accumulators.oasdi_wages_cents",/' "$GATES"

# 10b. The same hole from the other side: exempt the HOURS column, which is a
#      bigint holding hundredth-hours and drives the L&I quarterly report.
mutate "exempt the L&I hours column as if it were structural" \
  perl -0pi -e 's/  "payroll_ytd_accumulators\.updated_at",/  "payroll_ytd_accumulators.updated_at",\n  "payroll_ytd_accumulators.lni_hundredth_hours",/' "$GATES"

# 10c. A stale exemption - a column that no longer exists. It protects nothing
#      today and silently widens the moment a column is renamed into its place.
mutate "leave an exemption for a column that does not exist" \
  perl -0pi -e 's/  "payroll_ytd_accumulators\.updated_at",/  "payroll_ytd_accumulators.updated_at",\n  "payroll_ytd_accumulators.a_column_that_was_dropped",/' "$GATES"

# 10d. Widen the allowed structural TYPES to include bigint. The exemption list
#      would then be free to swallow any figure in the table.
mutate "widen the structural type list to include bigint" \
  perl -0pi -e 's/const STRUCTURAL_TYPES: readonly string\[\] = \["uuid", "timestamptz"\];/const STRUCTURAL_TYPES: readonly string[] = ["uuid", "timestamptz", "bigint"];/' "$GATES"

# 11. Break the duplicate-field guard by teaching one column twice.
mutate "duplicate a field lesson" \
  perl -0pi -e 's/(\{\s*field: "payroll_ytd_accumulators\.tax_year".*?\n  \},\n)/\1\1/s' "$MENTOR"

echo
echo "=== RESULT ==="
echo "mutations run : $TOTAL"
echo "killed        : $KILLED"
echo "survived      : $SURVIVED"

restore
echo
echo "all files restored byte-identical:"
cmp "$BACKUP_DIR/mentor.bak" "$MENTOR" && echo "  $MENTOR ok"
cmp "$BACKUP_DIR/gates.bak"  "$GATES"  && echo "  $GATES ok"
cmp "$BACKUP_DIR/core.bak"   "$CORE"   && echo "  $CORE ok"

[ "$SURVIVED" -eq 0 ] || exit 1

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/slice18g/mutate.sh
#
# MUTATION TESTING FOR SLICE 18G (DEFECT 3).
#
# Owner's instruction for this round: "Test everything including the tests."
# A test that cannot fail is not a test, it is decoration. So every guard this
# slice adds is checked by BREAKING the code it guards and requiring the suite
# to notice.
#
# The proposed scope in docs/slice-18e-defect3.md was explicit about this:
#   "Mutation-test the guard by deleting each column from the carry list and
#    confirming the suite goes red for each one."
#
# That is what runs below. Each mutant removes or corrupts ONE column in ONE
# layer, then the relevant suites run. A mutant that SURVIVES is a test gap,
# and the rule that has held since 18B applies: strengthen the suite, never
# soften the mutant.
#
# Every mutation is applied to a COPY-ON-DISK and reverted from a pristine
# backup afterwards, and the script verifies byte-for-byte restoration at the
# end. Run from the repo root.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

CORE="src/lib/pos/intake-menu-staging-core.ts"
DB="src/lib/pos/intake-menu-staging.ts"
REC="src/lib/pos/classification-recovery-core.ts"
RECSCRIPT="scripts/slice18g/recover-classifications.ts"
GUARD="tests/compliance/classification-survives-restage.test.ts"
BACKUP_DIR="$(mktemp -d)"
cp "$CORE" "$BACKUP_DIR/core.ts"
cp "$DB"   "$BACKUP_DIR/db.ts"

restore() {
  cp "$BACKUP_DIR/core.ts" "$CORE"
  cp "$BACKUP_DIR/db.ts"   "$DB"
  # The later rounds back these up before touching them; restore them too if
  # they exist, so an interrupted run cannot leave a mutated tree behind.
  [[ -f "$BACKUP_DIR/rec.ts" ]] && cp "$BACKUP_DIR/rec.ts" "src/lib/pos/classification-recovery-core.ts"
  [[ -f "$BACKUP_DIR/recscript.ts" ]] && cp "$BACKUP_DIR/recscript.ts" "scripts/slice18g/recover-classifications.ts"
  [[ -f "$BACKUP_DIR/guard.ts" ]] && cp "$BACKUP_DIR/guard.ts" "tests/compliance/classification-survives-restage.test.ts"
  return 0
}
trap 'restore; rm -rf "$BACKUP_DIR"' EXIT

killed=0
survived=0

SUITES="tests/compliance/classification-survives-restage.test.ts tests/compliance/restage-plumbing.test.ts tests/compliance/intake-menu-staging-core.test.ts tests/compliance/classification-recovery.test.ts"

# run_suites -> 0 if all green (mutant SURVIVED), non-zero if red (KILLED)
run_suites() {
  npx vitest run $SUITES >/dev/null 2>&1
}

# A mutant is only meaningful if it actually changed the file.
assert_changed() {
  local file="$1" label="$2" ref="$3"
  if cmp -s "$file" "$ref"; then
    echo "  !! MUTATION DID NOT APPLY: $label"
    echo "     The sed/python edit matched nothing, so this round tested"
    echo "     NOTHING. Fix the mutation, do not ignore this."
    return 1
  fi
  return 0
}

report() {
  local label="$1" rc="$2"
  if [[ "$rc" != "0" ]]; then
    killed=$((killed+1))
    echo "  KILLED   $label"
  else
    survived=$((survived+1))
    echo "  SURVIVED $label   <-- TEST GAP. Strengthen the suite."
  fi
}

echo "==========================================================="
echo " SLICE 18G mutation testing (DEFECT 3)"
echo "==========================================================="
echo

# ---------------------------------------------------------------------------
# ROUND 1 - delete each column from carryForward(). This is the literal
# mutation the 18G scope document asked for.
# ---------------------------------------------------------------------------
echo "-- Round 1: drop one column at a time from carryForward() --"
for col in low_thc_liquid unit_thc_mg otherwise_taken units_per_package; do
  restore
  python3 - "$CORE" "$col" <<'PY'
import re, sys
path, col = sys.argv[1], sys.argv[2]
s = open(path).read()
# carryForward assigns from `item.`; masteredToSnapshot from `it.`. Target only
# the carryForward assignment so the two producers are mutated independently.
needle = f"    {col}: item.{col} ?? null,\n"
assert s.count(needle) == 1, f"expected exactly 1 {needle!r}, got {s.count(needle)}"
open(path, "w").write(s.replace(needle, ""))
PY
  if [[ $? -ne 0 ]]; then echo "  !! could not build mutant for $col"; continue; fi
  assert_changed "$CORE" "carryForward drops $col" "$BACKUP_DIR/core.ts" || continue
  run_suites; report "carryForward() drops $col" "$?"
done
echo

# ---------------------------------------------------------------------------
# ROUND 2 - same for masteredToSnapshot(), the producer the 18E writeup missed.
# ---------------------------------------------------------------------------
echo "-- Round 2: drop one column at a time from masteredToSnapshot() --"
for col in low_thc_liquid unit_thc_mg otherwise_taken units_per_package; do
  restore
  python3 - "$CORE" "$col" <<'PY'
import sys
path, col = sys.argv[1], sys.argv[2]
s = open(path).read()
needle = f"    {col}: it.{col},\n"
assert s.count(needle) == 1, f"expected exactly 1 {needle!r}, got {s.count(needle)}"
open(path, "w").write(s.replace(needle, ""))
PY
  if [[ $? -ne 0 ]]; then echo "  !! could not build mutant for $col"; continue; fi
  assert_changed "$CORE" "masteredToSnapshot drops $col" "$BACKUP_DIR/core.ts" || continue
  run_suites; report "masteredToSnapshot() drops $col" "$?"
done
echo

# ---------------------------------------------------------------------------
# ROUND 3 - the SUBTLE mutations. These are the ones that matter, because they
# leave the column name in place and would survive any naive grep-based guard.
# ---------------------------------------------------------------------------
echo "-- Round 3: subtle value corruption (name stays, value is wrong) --"

# 3a. Hard-code null: the exact shape of the original defect's OUTCOME.
restore
python3 - "$CORE" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "    otherwise_taken: item.otherwise_taken ?? null,"
new = "    otherwise_taken: null,"
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$CORE" "hard-code null" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "carryForward() hard-codes otherwise_taken to null" "$?"; }

# 3b. `||` instead of `??`: silently converts a human's FALSE into "unanswered".
#     This is the single most dangerous plausible regression in this slice,
#     because it looks like a harmless style change.
restore
python3 - "$CORE" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "    otherwise_taken: item.otherwise_taken ?? null,"
new = "    otherwise_taken: item.otherwise_taken || null,"
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$CORE" "|| instead of ??" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "carryForward() uses || (false becomes null)" "$?"; }

# 3c. Invent an answer nobody gave.
restore
python3 - "$CORE" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "    otherwise_taken: item.otherwise_taken ?? null,"
new = "    otherwise_taken: item.otherwise_taken ?? false,"
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$CORE" "default to false" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "carryForward() defaults null to false" "$?"; }

# 3d. Cross the wires: carry the NEW card's answer onto the CARRIED row. A
#     mapper can be fully populated and still be wrong.
restore
python3 - "$CORE" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "    units_per_package: item.units_per_package ?? null,"
new = "    units_per_package: item.servings_per_pack ?? null,"
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$CORE" "crossed wires" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "carryForward() reads servings_per_pack as units_per_package" "$?"; }
echo

# ---------------------------------------------------------------------------
# ROUND 4 - the DB boundary layers. Only the plumbing guard can catch these,
# which is precisely why that (weaker) guard exists.
# ---------------------------------------------------------------------------
echo "-- Round 4: the DB read and write mappings --"
for col in low_thc_liquid unit_thc_mg otherwise_taken units_per_package; do
  restore
  python3 - "$DB" "$col" <<'PY'
import sys
path, col = sys.argv[1], sys.argv[2]
s = open(path).read()
# The READ mapping is indented 4 spaces; the INSERT payload 6. A plain
# substring search for the 4-space form ALSO matches inside the 6-space line,
# so the first run of this harness found 2 matches and aborted the round --
# testing nothing. Match whole lines instead, so read and write are targeted
# independently and exactly.
needle = f"    {col}: it.{col},"
lines = s.split("\n")
hits = [i for i, ln in enumerate(lines) if ln == needle]
assert len(hits) == 1, f"expected exactly 1 read-mapping line {needle!r}, got {len(hits)}"
del lines[hits[0]]
open(path, "w").write("\n".join(lines))
PY
  if [[ $? -ne 0 ]]; then echo "  !! could not build read mutant for $col"; continue; fi
  assert_changed "$DB" "read drops $col" "$BACKUP_DIR/db.ts" || continue
  run_suites; report "loadCarryForwardItems() drops $col" "$?"
done

for col in low_thc_liquid unit_thc_mg otherwise_taken units_per_package; do
  restore
  python3 - "$DB" "$col" <<'PY'
import sys
path, col = sys.argv[1], sys.argv[2]
s = open(path).read()
needle = f"      {col}: it.{col},"          # the INSERT payload (6-space indent)
lines = s.split("\n")
hits = [i for i, ln in enumerate(lines) if ln == needle]
assert len(hits) == 1, f"expected exactly 1 insert line {needle!r}, got {len(hits)}"
del lines[hits[0]]
open(path, "w").write("\n".join(lines))
PY
  if [[ $? -ne 0 ]]; then echo "  !! could not build write mutant for $col"; continue; fi
  assert_changed "$DB" "write drops $col" "$BACKUP_DIR/db.ts" || continue
  run_suites; report "persistSnapshotItems() drops $col" "$?"
done

# 4c. Narrow the select. The fix depends on the query providing the values; if
#     someone lists columns explicitly and forgets these, the mapping reads
#     undefined and every carried row silently blanks again.
#
#     NOTE: this mutant SURVIVED the first run of this harness. The guard
#     searched the whole function body for select("*"), and
#     loadCarryForwardItems issues a SECOND query (menu_variants) that also
#     selects "*" -- so the assertion stayed green while the menu_items query
#     had stopped returning the classification. The guard was scoped to the
#     menu_items query chain rather than the mutation being softened.
restore
python3 - "$DB" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
i = s.index("async function loadCarryForwardItems")
j = s.index('.select("*")', i)          # the FIRST select in the body = menu_items
open(path, "w").write(s[:j] + '.select("id, source_item_id, name")' + s[j+len('.select("*")'):])
PY
assert_changed "$DB" "narrow the select" "$BACKUP_DIR/db.ts" \
  && { run_suites; report "loadCarryForwardItems() narrows menu_items select away from *" "$?"; }

# 4d. CONTROL MUTANT -- this one is SUPPOSED to survive.
#
#     A guard that fails on every edit is not precise, it is merely noisy, and
#     a noisy guard gets deleted by the next person who trips it. Narrowing the
#     select is legitimate SO LONG AS the four columns are still named. If this
#     reports KILLED, the guard is pinning today's spelling rather than the
#     actual requirement, and it would block a correct future refactor.
restore
python3 - "$DB" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
i = s.index("async function loadCarryForwardItems")
j = s.index('.select("*")', i)
good = ('.select("id, source_item_id, name, low_thc_liquid, unit_thc_mg, '
        'otherwise_taken, units_per_package")')
open(path, "w").write(s[:j] + good + s[j+len('.select("*")'):])
PY
if assert_changed "$DB" "narrow but keep the four columns" "$BACKUP_DIR/db.ts"; then
  run_suites
  rc=$?
  if [[ "$rc" == "0" ]]; then
    echo "  EXPECTED-SURVIVOR  narrowed select that still names all four columns"
  else
    survived=$((survived+1))
    echo "  FALSE POSITIVE  guard rejects a CORRECT narrowed select   <-- guard is too rigid"
  fi
fi
echo

# ---------------------------------------------------------------------------
# ROUND 4e - THE RECOVERY MODULE. Fixing the code stops the bleeding; this is
# the part that gives back what was already lost, and a wrong recovery is more
# dangerous than no recovery: a wrong non-null value makes a statutory limit
# engage on the wrong products, silently, with no blank left to investigate.
# ---------------------------------------------------------------------------
echo "-- Round 4e: the recovery planner --"
cp "$REC" "$BACKUP_DIR/rec.ts"

rec_restore() { cp "$BACKUP_DIR/rec.ts" "$REC"; }

# 4e-i. THE TRUTHINESS TRAP. `!== null` becomes a truthiness test, so a
#       recovered `false` (and a measured 0 mg) is thrown away as "missing".
rec_restore
python3 - "$REC" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "        .filter((entry): entry is { row: HistoricalRow; value: boolean | number } =>\n          entry.value !== null,\n        );"
new = "        .filter((entry): entry is { row: HistoricalRow; value: boolean | number } =>\n          Boolean(entry.value),\n        );"
assert s.count(old) == 1, "filter not found verbatim"
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$REC" "truthiness instead of !== null" "$BACKUP_DIR/rec.ts" \
  && { run_suites; report "recovery treats false/0 as unrecoverable" "$?"; }

# 4e-ii. OVERWRITE A LIVE ANSWER. Drop the "already answered" guard so the
#        report proposes clobbering a classification a human just gave.
rec_restore
python3 - "$REC" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "      if (valueAt(current, column) !== null) {"
new = "      if (false) {"
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$REC" "drop the already-answered guard" "$BACKUP_DIR/rec.ts" \
  && { run_suites; report "recovery overwrites a live answer" "$?"; }

# 4e-iii. OLDEST WINS. Flip the sort so a superseded classification beats the
#         manager's correction.
rec_restore
python3 - "$REC" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "    list.sort((a, b) => (a.version_created_at < b.version_created_at ? 1 : -1));"
new = "    list.sort((a, b) => (a.version_created_at < b.version_created_at ? -1 : 1));"
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$REC" "oldest answer wins" "$BACKUP_DIR/rec.ts" \
  && { run_suites; report "recovery prefers the stalest answer" "$?"; }

# 4e-iv. INVENT AN ANSWER. Turn a never-classified product into a hard false.
rec_restore
python3 - "$REC" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = '        gaps.push({ source_item_id: current.source_item_id, column, reason: "history-all-null" });\n        continue;'
new = '        recovered.push({ source_item_id: current.source_item_id, column, value: false, fromVersionId: "", fromVersionCreatedAt: "", hadConflictingHistory: false });\n        continue;'
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$REC" "invent false for unclassified" "$BACKUP_DIR/rec.ts" \
  && { run_suites; report "recovery invents an answer nobody gave" "$?"; }

# 4e-v. DROP THE SQL SAFETY GUARD. Without `is null` the proposed SQL can
#       overwrite an answer given between report and run.
rec_restore
python3 - "$REC" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = '    const guards = entries.map((e) => `${e.column} is null`).join("\\n    and ");'
new = '    const guards = entries.map((e) => `${e.column} is not null`).join("\\n    and ");'
assert s.count(old) == 1, "guard-rendering line not found verbatim"
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$REC" "remove the is-null guard from the SQL" "$BACKUP_DIR/rec.ts" \
  && { run_suites; report "proposed SQL loses its is-null guard" "$?"; }

# 4e-vi. SILENCE THE CONFLICT FLAG. A genuine mis-classification stops being
#        visible to the owner reviewing the report.
rec_restore
python3 - "$REC" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "        hadConflictingHistory: older.some((entry) => entry.value !== newest.value),"
new = "        hadConflictingHistory: false,"
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$REC" "silence the conflict flag" "$BACKUP_DIR/rec.ts" \
  && { run_suites; report "recovery hides conflicting history" "$?"; }

# 4e-vii. IGNORE THE PAIRED CHECK CONSTRAINT. Propose otherwise_taken=true
#         with no units_per_package. Postgres rejects this row outright, so the
#         owner's transaction would die halfway through. Found by RUNNING the
#         SQL against a real PG15, not by reading the code.
rec_restore
python3 - "$REC" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "    if (partnerLive || partnerRecovered) {"
new = "    if (true) {"
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$REC" "ignore the paired CHECK constraint" "$BACKUP_DIR/rec.ts" \
  && { run_suites; report "recovery proposes a row Postgres would reject" "$?"; }

# 4e-viii. BLOCK A FALSE TOO. Over-correcting the constraint rule would refuse
#          a perfectly legal recovery and leave the dock asking a question that
#          was already answered. Precision cuts both ways.
rec_restore
python3 - "$REC" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "    if (!pair || entry.value !== true) {"
new = "    if (!pair) {"
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$REC" "block false as well as true" "$BACKUP_DIR/rec.ts" \
  && { run_suites; report "recovery refuses a legal false" "$?"; }

# 4e-ix. SPLIT THE PAIRED UPDATE. Emit one statement per column again -- the
#        exact SQL a real Postgres refused with
#        menu_items_otherwise_taken_needs_units.
rec_restore
python3 - "$REC" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
old = "    const assignments = entries.map((e) => `${e.column} = ${String(e.value)}`).join(\", \");"
new = "    const assignments = `${entries[0].column} = ${String(entries[0].value)}`;"
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY
assert_changed "$REC" "split the paired update" "$BACKUP_DIR/rec.ts" \
  && { run_suites; report "proposed SQL sets only one column of a pair" "$?"; }

rec_restore
echo

# ---------------------------------------------------------------------------
# ROUND 4f - THE READ-ONLY PROMISE. The repair script must never write.
# ---------------------------------------------------------------------------
echo "-- Round 4f: the recovery report's read-only promise --"
cp "$RECSCRIPT" "$BACKUP_DIR/recscript.ts"
python3 - "$RECSCRIPT" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
anchor = "  console.log(`Published version ${published.id} (${published.created_at})`);"
assert s.count(anchor) == 1
inject = '  await db.from("menu_items").update({ otherwise_taken: true }).eq("id", "x");\n'
open(path, "w").write(s.replace(anchor, inject + anchor))
PY
assert_changed "$RECSCRIPT" "inject a real write into the report script" "$BACKUP_DIR/recscript.ts" \
  && { run_suites; report "recovery report performs a real UPDATE" "$?"; }
cp "$BACKUP_DIR/recscript.ts" "$RECSCRIPT"
echo

# ---------------------------------------------------------------------------
# ROUND 5 - TEST OF THE TEST OF THE TEST.
# Corrupt the GUARD's own contract list and confirm the class-of-bug assertion
# notices. If ENFORCEMENT_COLUMNS could be quietly emptied, every green run
# above would mean nothing.
# ---------------------------------------------------------------------------
echo "-- Round 5: attack the guard itself --"
restore
cp "$GUARD" "$BACKUP_DIR/guard.ts"
python3 - "$GUARD" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
# Remove otherwise_taken from the declared contract, simulating someone
# "cleaning up" the list. The cross-check against live-menu.ts must catch it.
old = """  {
    column: "otherwise_taken" as const,
    draftField: "chosen_otherwise_taken" as const,
    carried: true,
    approved: true,
    statute: "WAC 314-55-095(1)(d)(i)(D) — ten-unit bucket",
  },
"""
assert s.count(old) == 1, "contract entry not found verbatim"
open(path, "w").write(s.replace(old, ""))
PY
if [[ $? -eq 0 ]]; then
  npx vitest run "$GUARD" >/dev/null 2>&1
  report "ENFORCEMENT_COLUMNS silently loses otherwise_taken" "$?"
fi
cp "$BACKUP_DIR/guard.ts" "$GUARD"
echo

# ---------------------------------------------------------------------------
restore
echo "-- verifying pristine restoration --"
if cmp -s "$CORE" "$BACKUP_DIR/core.ts" && cmp -s "$DB" "$BACKUP_DIR/db.ts" \
   && cmp -s "$GUARD" "$BACKUP_DIR/guard.ts" \
   && cmp -s "$REC" "$BACKUP_DIR/rec.ts" \
   && cmp -s "$RECSCRIPT" "$BACKUP_DIR/recscript.ts"; then
  echo "   all sources byte-identical to pre-mutation state"
else
  echo "   !! RESTORATION FAILED - do not commit; inspect the working tree"
  exit 2
fi

echo
echo "==========================================================="
echo "  KILLED: $killed    SURVIVED: $survived"
echo "==========================================================="
if [[ "$survived" != "0" ]]; then
  echo "A survivor is a TEST GAP, not an acceptable mutation."
  echo "Strengthen the suite. Never soften the mutant."
  exit 1
fi
echo "Every mutant was killed."

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/slice18f/mutate.sh
#
# MUTATION TESTING FOR SLICE 18F (classification memory / Option B).
#
# Owner's instruction, carried across every slice since 18B and repeated for
# this one: "Test everything including the tests."
#
# A green suite proves nothing on its own -- it is equally consistent with
# "the code is right" and "the tests cannot fail". This script settles which
# one we have by BREAKING the code on purpose, one property at a time, and
# requiring the suite to notice. A mutant that SURVIVES is a test gap, and the
# standing rule applies: strengthen the suite, never soften the mutant.
#
# The properties under test are the ones that can hurt Michael if they rot:
#
#   1. the memory key must be built from IDENTITY, not pos_product_key
#      (which is `sku ?? lot_code` and changes every delivery);
#   2. `machine_default` and `unanswered` must never be recallable -- only a
#      human's own answer may be replayed to them;
#   3. a literal `false` must survive (a human saying "no" is an answer);
#   4. Option B must not silently become Option C: the pre-fill is a
#      SUGGESTION, the 18-0 gate must still demand a human click;
#   5. provenance must be re-derived SERVER-SIDE and never trusted from the
#      form -- otherwise a crafted POST could claim "remembered";
#   6. the newest prior answer wins, deterministically.
#
# Every mutation is applied to a copy-on-disk and reverted from a pristine
# backup; byte-for-byte restoration is verified at the end. There is also a
# deliberate CONTROL mutant that MUST survive -- if a cosmetic change kills
# the suite, the suite is over-fitted to spelling rather than behaviour, and
# that is its own kind of defect.
#
# Run from anywhere; the script cd's to the repo root.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

CORE="src/lib/inventory/classification-memory-core.ts"
STORE="src/lib/inventory/catalog-drafts.ts"
PAGE="src/app/admin/inventory/drafts/page.tsx"

SUITES="tests/compliance/classification-memory.test.ts tests/compliance/classification-memory-plumbing.test.ts tests/compliance/receiving-pipeline-plumbing.test.ts"

BACKUP_DIR="$(mktemp -d)"
cp "$CORE"  "$BACKUP_DIR/core.ts"
cp "$STORE" "$BACKUP_DIR/store.ts"
cp "$PAGE"  "$BACKUP_DIR/page.tsx"

restore() {
  cp "$BACKUP_DIR/core.ts"  "$CORE"
  cp "$BACKUP_DIR/store.ts" "$STORE"
  cp "$BACKUP_DIR/page.tsx" "$PAGE"
  return 0
}
trap 'restore; rm -rf "$BACKUP_DIR"' EXIT

killed=0
survived=0
unapplied=0

# run_suites -> 0 if all green (mutant SURVIVED), non-zero if red (KILLED)
run_suites() {
  npx vitest run $SUITES >/dev/null 2>&1
}

# The pure self-test runner is a second, independent line of defence: it runs
# in CI outside vitest. Some mutants should be caught by it too.
run_selftests() {
  npx tsx scripts/compliance/run-pure-selftests.ts >/dev/null 2>&1
}

# A mutant that did not change the file tested NOTHING. That must be loud.
assert_changed() {
  local file="$1" label="$2" ref="$3"
  if cmp -s "$file" "$ref"; then
    echo "  !! MUTATION DID NOT APPLY: $label"
    echo "     The edit matched nothing, so this round proved NOTHING."
    unapplied=$((unapplied+1))
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

# Apply a literal string replacement, asserting it matches exactly once.
mutate() {
  local file="$1" from="$2" to="$3"
  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
n = s.count(frm)
if n != 1:
    sys.stderr.write(f"expected exactly 1 occurrence of {frm!r}, got {n}\n")
    sys.exit(1)
open(path, "w").write(s.replace(frm, to))
PY
}

echo "==========================================================="
echo " SLICE 18F mutation testing (classification memory)"
echo "==========================================================="
echo

# ---------------------------------------------------------------------------
# ROUND 1 - the recall gate. Only a human's own answer may be replayed.
# ---------------------------------------------------------------------------
echo "-- Round 1: widen RECALLABLE_PROVENANCE (replay a machine guess as fact) --"
for bad in machine unanswered; do
  restore
  mutate "$CORE" \
    "  CLASSIFICATION_MEMORY_PROVENANCE.remembered,
]" \
    "  CLASSIFICATION_MEMORY_PROVENANCE.remembered,
  CLASSIFICATION_MEMORY_PROVENANCE.${bad},
]" || { echo "  !! could not build mutant for ${bad}"; unapplied=$((unapplied+1)); continue; }
  assert_changed "$CORE" "recall ${bad}" "$BACKUP_DIR/core.ts" || continue
  run_suites; report "RECALLABLE_PROVENANCE also accepts ${bad}" "$?"
done
echo

echo "-- Round 1b: drop the recall gate entirely --"
restore
mutate "$CORE" \
  '  if (!RECALLABLE_PROVENANCE.includes(clean(row.provenance))) return false;' \
  '  // mutant: provenance gate removed' \
  && assert_changed "$CORE" "gate removed" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "isRecallable() no longer checks provenance" "$?"; }
echo

# ---------------------------------------------------------------------------
# ROUND 2 - the false-survival property. `??` preserves false; `||` destroys it.
# This is the exact class of bug 18-0 and 18E were written to prevent.
# ---------------------------------------------------------------------------
echo "-- Round 2: swap ?? for || so a human's 'no' is forgotten --"
restore
mutate "$CORE" \
  '  const ot = row.otherwiseTaken ?? null;' \
  '  const ot = row.otherwiseTaken || null;' \
  && assert_changed "$CORE" "otherwiseTaken ||" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "isRecallable() uses || on otherwiseTaken (false lost)" "$?"; }

restore
mutate "$CORE" \
  '  const low = row.lowThcLiquid ?? null;' \
  '  const low = row.lowThcLiquid || null;' \
  && assert_changed "$CORE" "lowThcLiquid ||" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "isRecallable() uses || on lowThcLiquid (false lost)" "$?"; }
echo

# ---------------------------------------------------------------------------
# ROUND 3 - Option B must not become Option C (auto-apply without confirming).
# ---------------------------------------------------------------------------
echo "-- Round 3: downgrade Option B to Option C (silent auto-apply) --"
restore
python3 - "$CORE" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
n = s.count("      stillRequiresConfirmation: true,")
assert n == 1, f"expected 1 indented occurrence, got {n}"
s = s.replace("      stillRequiresConfirmation: true,", "      stillRequiresConfirmation: false,")
open(path, "w").write(s)
PY
if [[ $? -eq 0 ]]; then
  assert_changed "$CORE" "no-memory branch auto-applies" "$BACKUP_DIR/core.ts" \
    && { run_suites; report "prefillFromMemory() no-memory branch drops confirmation" "$?"; }
fi

restore
python3 - "$CORE" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
n = s.count("    stillRequiresConfirmation: true,")
# The 4-space form appears in the remembered branch; the 6-space form is a
# substring of it, so count only lines that are exactly 4-space indented.
lines = [l for l in s.split("\n") if l == "    stillRequiresConfirmation: true,"]
assert len(lines) == 1, f"expected 1 four-space occurrence, got {len(lines)}"
s = s.replace("\n    stillRequiresConfirmation: true,", "\n    stillRequiresConfirmation: false,", 1)
open(path, "w").write(s)
PY
if [[ $? -eq 0 ]]; then
  assert_changed "$CORE" "remembered branch auto-applies" "$BACKUP_DIR/core.ts" \
    && { run_suites; report "prefillFromMemory() remembered branch drops confirmation" "$?"; }
fi

echo '-- Round 3b: strip the required attribute from the picker (gate stops demanding an answer) --'
restore
python3 - "$PAGE" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
n = s.count('name="otherwise_taken"')
assert n == 1, f"expected 1 otherwise_taken control, got {n}"
i = s.index('name="otherwise_taken"')
# Remove `required` from THIS control's opening tag only.
#
# An earlier version of this mutant searched FORWARD from `defaultValue=`,
# but in the real source `required` is declared BEFORE `defaultValue`, so it
# deleted the word "required" out of a COMMENT thirty lines below
# ("PROMPTED, never required") and the mutant survived for a reason that had
# nothing to do with the guard. Scope to the opening tag, and assert the
# deletion actually happened inside it.
tag_start = s.rindex("<", 0, i)
tag_end = s.index(">", i)
tag = s[tag_start:tag_end]
assert "required" in tag, "no `required` in the otherwise_taken opening tag"
mutated = tag.replace("required", "", 1)
s = s[:tag_start] + mutated + s[tag_end:]
open(path, "w").write(s)
PY
if [[ $? -eq 0 ]]; then
  assert_changed "$PAGE" "required stripped" "$BACKUP_DIR/page.tsx" \
    && { run_suites; report "approval picker loses its required attribute after pre-fill" "$?"; }
fi
echo

# ---------------------------------------------------------------------------
# ROUND 4 - the memory KEY. Built from identity, and case-collapsed.
# ---------------------------------------------------------------------------
echo "-- Round 4: corrupt the identity key --"
restore
mutate "$CORE" \
  '  const categoryPart = collapseFamilyKeyPart(groupingCategoryAxis(clean(candidate.category)));' \
  '  const categoryPart = groupingCategoryAxis(clean(candidate.category));' \
  && assert_changed "$CORE" "category case not collapsed" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "key stops case-collapsing the category (silent forget)" "$?"; }

restore
mutate "$CORE" \
  '  return [collapseFamilyKeyPart(vendor), categoryPart, familyPart].join("|");' \
  '  return [categoryPart, familyPart].join("|");' \
  && assert_changed "$CORE" "vendor dropped from key" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "key drops the vendor (two vendors collide)" "$?"; }

restore
mutate "$CORE" \
  '  if (familyPart === "") return "";' \
  '  if (familyPart === "zzz-never") return "";' \
  && assert_changed "$CORE" "empty-family guard defeated" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "key no longer refuses an empty family (matches everything)" "$?"; }
echo

# ---------------------------------------------------------------------------
# ROUND 5 - determinism: the NEWEST prior answer must win.
# ---------------------------------------------------------------------------
echo "-- Round 5: reverse the recency sort --"
restore
mutate "$CORE" \
  '    .sort((a, b) => decidedAtMs(b) - decidedAtMs(a));' \
  '    .sort((a, b) => decidedAtMs(a) - decidedAtMs(b));' \
  && assert_changed "$CORE" "sort reversed" "$BACKUP_DIR/core.ts" \
  && { run_suites; report "recall returns the OLDEST answer instead of the newest" "$?"; }
echo

# ---------------------------------------------------------------------------
# ROUND 6 - the write path. Provenance re-derived server-side, always written.
# ---------------------------------------------------------------------------
echo "-- Round 6: break the server-side provenance derivation --"
restore
mutate "$STORE" \
  '  update.chosen_classification_provenance = classificationProvenance;' \
  '  // mutant: provenance no longer written' \
  && assert_changed "$STORE" "provenance write removed" "$BACKUP_DIR/store.ts" \
  && { run_suites; report "approval stops writing chosen_classification_provenance" "$?"; }

restore
mutate "$STORE" \
  '    if (remembered !== null && remembered.otherwiseTaken === compliance.otherwiseTaken) {' \
  '    if (remembered !== null) {' \
  && assert_changed "$STORE" "agreement check dropped" "$BACKUP_DIR/store.ts" \
  && { run_suites; report "marks 'remembered' even when the human CHANGED the answer" "$?"; }

echo "-- Round 6b: the store read stops selecting an identity column --"
for col in brand_name vendor_name; do
  restore
  mutate "$STORE" \
    "\"name, brand_name, vendor_name, category," \
    "\"name, $( [[ $col == brand_name ]] && echo 'vendor_name,' || echo 'brand_name,' ) category," \
    || { echo "  !! could not build mutant for ${col}"; unapplied=$((unapplied+1)); continue; }
  assert_changed "$STORE" "select drops $col" "$BACKUP_DIR/store.ts" || continue
  run_suites; report "listPriorClassifications() stops selecting $col" "$?"
done
echo

# ---------------------------------------------------------------------------
# ROUND 7 - the vocabulary. `remembered` must be a distinct FOURTH value and
# must not redefine any of the three that rows already depend on.
# ---------------------------------------------------------------------------
echo "-- Round 7: collapse the new provenance value into an existing one --"
restore
mutate "$CORE" \
  '  remembered: "remembered",' \
  '  remembered: "human",' \
  && assert_changed "$CORE" "remembered aliased to human" "$BACKUP_DIR/core.ts" \
  && { run_suites || run_selftests; report "remembered collapses onto 'human' (indistinguishable)" "$?"; }
echo

# ---------------------------------------------------------------------------
# CONTROL - this mutant MUST SURVIVE.
#
# It changes only a comment. If the suite goes red here, the tests are pinned
# to prose rather than behaviour, and every "KILLED" above becomes suspect.
# ---------------------------------------------------------------------------
echo "-- Control: a comment-only change (MUST SURVIVE) --"
restore
python3 - "$CORE" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
marker = "// ---------------------------------------------------------------------------\n// Types"
assert s.count(marker) == 1
s = s.replace(marker, "// ---------------------------------------------------------------------------\n// Types (control mutant: this comment changed and nothing else)")
open(path, "w").write(s)
PY
if [[ $? -eq 0 ]]; then
  assert_changed "$CORE" "control comment" "$BACKUP_DIR/core.ts"
  if run_suites; then
    echo "  SURVIVED control (comment-only)   <-- CORRECT"
  else
    echo "  KILLED   control (comment-only)   <-- BAD: tests are pinned to prose,"
    echo "           not behaviour. Every KILLED above is now suspect."
    survived=$((survived+1))   # count as a problem, deliberately
  fi
fi
echo

# ---------------------------------------------------------------------------
restore
echo "==========================================================="
echo " Verifying byte-for-byte restoration"
for pair in "$CORE:$BACKUP_DIR/core.ts" "$STORE:$BACKUP_DIR/store.ts" "$PAGE:$BACKUP_DIR/page.tsx"; do
  f="${pair%%:*}"; b="${pair##*:}"
  if cmp -s "$f" "$b"; then echo "  clean   $f"; else echo "  DIRTY   $f  <-- RESTORE FAILED"; fi
done
echo "-----------------------------------------------------------"
echo " KILLED:    $killed"
echo " SURVIVED:  $survived   (must be 0; the control is reported separately)"
echo " UNAPPLIED: $unapplied   (must be 0)"
echo "==========================================================="
[[ "$survived" -eq 0 && "$unapplied" -eq 0 ]] || exit 1
exit 0

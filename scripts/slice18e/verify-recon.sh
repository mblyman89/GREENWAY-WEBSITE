#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Verifies every factual citation in docs/slice-18e-recon.md against source.
# Read-only. Reports a pass/fail count and exits non-zero if anything failed.
#
# WHY THIS RUNS AGAINST A PINNED COMMIT AND NOT THE WORKING TREE
# --------------------------------------------------------------
# The recon document describes the code **as it stood before Slice 18E was
# built**. Several of its findings are statements about things that were
# WRONG at the time and have since been FIXED — F5 ("the onboarding answer
# never reaches the lot row") most obviously, since closing that gap was the
# entire point of the slice.
#
# So after the build, checking the recon's citations against the working tree
# produces failures that mean "we fixed it", not "the recon lied". Rewriting
# the recon to match the new code would be falsifying the record: it would
# make a document dated before the work appear to describe the work.
#
# The honest arrangement is to verify the historical claim against the
# historical tree. BASELINE below is the commit the recon was written against
# (18D, the tip of main when 18E was cut). The script materialises that tree
# into a temp directory and asserts there. If a citation fails, the recon was
# genuinely wrong and must be corrected.
#
# To re-point this at a future baseline, change BASELINE. Do not "fix" it by
# nudging line numbers until it passes.
# ---------------------------------------------------------------------------
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)" || exit 1
cd "$REPO_ROOT" || exit 1

BASELINE="${SLICE18E_RECON_BASELINE:-f2b7c6c917075aeb200044f3f372da5a655002d7}"

if ! git -C "$REPO_ROOT" cat-file -e "${BASELINE}^{commit}" 2>/dev/null; then
  echo "FATAL: baseline commit $BASELINE is not present in this clone."
  echo "       The recon citations cannot be verified. Refusing to report a"
  echo "       pass, because an unverified pass is worse than a failure."
  exit 2
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
git -C "$REPO_ROOT" archive "$BASELINE" | tar -x -C "$WORKDIR" || {
  echo "FATAL: could not materialise baseline tree $BASELINE"; exit 2; }

echo "Verifying docs/slice-18e-recon.md against baseline ${BASELINE:0:8}"
echo "(the tree as it stood BEFORE slice 18E was built)"
echo

cd "$WORKDIR" || exit 1

pass=0; fail=0
chk() { # chk <label> <file> <line> <needle>
  local label="$1" file="$2" line="$3" needle="$4" got
  got=$(sed -n "${line}p" "$file" 2>/dev/null)
  if [[ "$got" == *"$needle"* ]]; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); echo "FAIL $label"; echo "   $file:$line"
    echo "   want substring: $needle"; echo "   got:            $got"
  fi
}
grepq() { # grepq <label> <pattern> <expected-count> <files...>
  local label="$1" pat="$2" want="$3"; shift 3
  local n; n=$(grep -rn "$pat" "$@" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$n" == "$want" ]]; then pass=$((pass+1));
  else fail=$((fail+1)); echo "FAIL $label — want $want match(es), got $n"; fi
}

echo "── F1: columns on inventory_lots ──────────────────────────────"
chk "0216 menu low_thc"   supabase/migrations/0216_low_thc_liquid_limit.sql 96  "add column if not exists low_thc_liquid boolean"
chk "0216 lot low_thc"    supabase/migrations/0216_low_thc_liquid_limit.sql 101 "add column if not exists low_thc_liquid boolean"
chk "0216 lot unit_mg"    supabase/migrations/0216_low_thc_liquid_limit.sql 103 "unit_thc_mg    numeric(10,3)"
chk "0217 lot ot"         supabase/migrations/0217_otherwise_taken_limit.sql 168 "add column if not exists otherwise_taken   boolean"
chk "0217 lot upp"        supabase/migrations/0217_otherwise_taken_limit.sql 170 "units_per_package numeric(10,3)"
chk "0217 order_lines"    supabase/migrations/0217_otherwise_taken_limit.sql 281 "low_thc_liquid    boolean"

echo "── F2: enforcement reads the MENU row, never the lot ──────────"
chk "live-menu lowThc"    src/lib/pos/live-menu.ts 94  "lowThcLiquid: row.low_thc_liquid ?? null"
chk "live-menu otherwise" src/lib/pos/live-menu.ts 99  "otherwiseTaken: row.otherwise_taken ?? null"
chk "sale-flow carries"   src/lib/pos/sale-flow-core.ts 431 "otherwiseTaken: entry.product.otherwiseTaken ?? null"
chk "core doctrine"       src/lib/inventory/classification-status-core.ts 22 "is the ONLY surface the register enforces from."
# Exactly two lot-side reads exist. select("*") in store.ts is counted separately.
grepq "one dock select of lot flags" "otherwise_taken\"," 1 src/lib/inventory/intake-store.ts
chk "getLotById select*" src/lib/inventory/store.ts 431 '.select("*").eq("id", id)'

echo "── F3: 18A already made the decision ──────────────────────────"
chk "page hides lot col"  "src/app/admin/inventory/[id]/page.tsx" 157 "We deliberately do NOT show lot.otherwise_taken here"
chk "status from menu"    "src/app/admin/inventory/[id]/page.tsx" 174 "otherwiseTaken: menuFlags?.otherwiseTaken ?? null"
# history lives in the real clone, not in the extracted archive
if git -C "$REPO_ROOT" log --oneline -S"updateLotComplianceClassificationAction" -- src/app/admin/inventory/actions.ts | grep -q "SLICE 18A"; then
  pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: action not introduced by 18A"; fi

echo "── F4: the correction path already ships ──────────────────────"
chk "panel anchor"        "src/app/admin/inventory/[id]/page.tsx" 887 'id="classification"'
chk "form bound"          "src/app/admin/inventory/[id]/page.tsx" 959 "<form action={complianceAction}"
chk "menu write FIRST"    src/app/admin/inventory/actions.ts 759 "const applied = await applyClassificationToMenu(key, {"
chk "lot mirror second"   src/app/admin/inventory/actions.ts 777 '.from("inventory_lots")'
chk "mirror best-effort"  src/app/admin/inventory/actions.ts 816 "lot_row_write_failed: lotWriteError"

echo "── F5: DEFECT 1 — onboarding answer never reaches the lot ─────"
chk "parser nulls (1)"    src/lib/inventory/intake-parser.ts 432 "otherwise_taken: null"
chk "parser nulls (2)"    src/lib/inventory/intake-parser.ts 506 "otherwise_taken: null"
chk "receiving inserts"   src/lib/inventory/intake-store.ts 564 "otherwise_taken: line.otherwise_taken"
chk "onboarding->draft"   src/lib/inventory/catalog-drafts.ts 631 "update.chosen_otherwise_taken = compliance.otherwiseTaken"
chk "draft->menu map"     src/lib/pos/draft-injection-core.ts 499 "otherwise_taken: d.chosen_otherwise_taken ?? null"
chk "draft->menu insert"  src/lib/pos/draft-injection.ts 278 "otherwise_taken: it.otherwise_taken"
chk "dock selects lot"    src/lib/inventory/intake-store.ts 1470 "unit_cost_minor_units, otherwise_taken"
chk "warning condition"   src/lib/inventory/intake-review-core.ts 158 "if (line.otherwise_taken == null && suspectsOtherwiseTaken({"
chk "intent stated"       src/lib/inventory/intake-review-core.ts 156 "already considered it and said no"
# THE decisive negative: approval never writes back to inventory_lots.
n=$(awk 'NR>=560 && NR<=740' src/lib/inventory/catalog-drafts.ts | grep -c "inventory_lots")
if [[ "$n" == "0" ]]; then pass=$((pass+1));
else fail=$((fail+1)); echo "FAIL: approval DOES touch inventory_lots ($n) — F5 premise wrong"; fi
# And only ONE code path can ever set a non-null lot flag.
n=$(grep -rn -B2 "otherwise_taken: choice.otherwiseTaken" src/ --include=*.ts --include=*.tsx | grep -c 'from("inventory_lots")')
if [[ "$n" == "1" ]]; then pass=$((pass+1));
else fail=$((fail+1)); echo "FAIL: expected exactly 1 lot-flag writer, got $n"; fi

echo "── F6: 18A correction never touches the draft row ─────────────"
n=$(grep -c "catalog_product_drafts" src/app/admin/inventory/actions.ts src/lib/inventory/classification-status-store.ts 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
if [[ "$n" == "0" ]]; then pass=$((pass+1));
else fail=$((fail+1)); echo "FAIL: expected 0 draft refs, got $n"; fi

echo "── F7: columns are NOT dead — constraints exist ───────────────"
grepq "lot 4mg ceiling"   "inventory_lots_low_thc_unit_ceiling"      2 supabase/migrations/0216_low_thc_liquid_limit.sql
grepq "lot needs units"   "inventory_lots_otherwise_taken_needs_units" 2 supabase/migrations/0217_otherwise_taken_limit.sql
grepq "lot traceability"  "Traceable to the source invoice via lot_code" 1 supabase/migrations/0217_otherwise_taken_limit.sql

echo "── F8/F9: test surface + baseline ─────────────────────────────"
for t in classification-status-parity receiving-classification-parity \
         otherwise-taken-truth-surfaces otherwise-taken-receiving \
         migration-execution-gate; do
  if [[ -f "tests/compliance/$t.test.ts" ]]; then pass=$((pass+1));
  else fail=$((fail+1)); echo "FAIL: missing tests/compliance/$t.test.ts"; fi
done
# These two are BASELINE facts, i.e. the counts as the recon found them. 18E
# added migration 0219 on the owner's instruction, so the live tree is at 219;
# that is expected and is asserted separately by
# tests/compliance/migration-execution-gate.test.ts. Do not "update" these to
# 219 — they are pinned to the pre-18E tree this script extracts.
m=$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')
[[ "$m" == "218" ]] && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL: baseline migrations=$m want 218"; }
t=$(wc -l < todo.md | tr -d ' ')
[[ "$t" == "3577" ]] && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL: baseline todo=$t want 3577"; }

echo
echo "════════════════════════════════════════════════"
echo "  recon citations verified: $pass passed, $fail failed"
echo "════════════════════════════════════════════════"
[[ "$fail" == "0" ]] || exit 1

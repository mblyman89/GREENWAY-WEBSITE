#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/slice18e/verify-defect3.sh   (SLICE 18E recon addendum)
#
# Machine-verifies DEFECT 3: the intake auto-publish path drops the four
# sales-limit classification columns, so an approved onboarding classification
# (or a manager's correction on the lot page) is ERASED from the live menu the
# next time any product is received.
#
# Every claim in docs/slice-18e-defect3.md is asserted here against the real
# files. Run from the repo root. Exit 0 = every citation holds.
#
# Standing rule: do not guess, do not assume. Build from fact, not memory.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

pass=0
fail=0

# chk <label> <file> <line> <needle>
# Asserts the EXACT line number contains the needle (fixed-string).
chk() {
  local label="$1" file="$2" line="$3" needle="$4"
  local got
  got=$(sed -n "${line}p" "$file" 2>/dev/null)
  if printf '%s' "$got" | grep -qF -- "$needle"; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    echo "FAIL: $label"
    echo "      $file:$line"
    echo "      expected to contain: $needle"
    echo "      actual:              $got"
  fi
}

# absent <label> <file> <start> <end> <pattern>
# Asserts the pattern does NOT occur in the line range. This is the decisive
# NEGATIVE evidence: proving an absence is what makes a "silently dropped"
# claim real rather than rhetorical.
absent() {
  local label="$1" file="$2" start="$3" end="$4" pat="$5"
  local n
  n=$(awk -v a="$start" -v b="$end" 'NR>=a && NR<=b' "$file" 2>/dev/null | grep -cE "$pat")
  if [[ "$n" == "0" ]]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    echo "FAIL: $label"
    echo "      $file:$start-$end unexpectedly contains $n match(es) for /$pat/"
  fi
}

# present <label> <file> <start> <end> <pattern> <expected_count>
present() {
  local label="$1" file="$2" start="$3" end="$4" pat="$5" want="$6"
  local n
  n=$(awk -v a="$start" -v b="$end" 'NR>=a && NR<=b' "$file" 2>/dev/null | grep -cE "$pat")
  if [[ "$n" == "$want" ]]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    echo "FAIL: $label"
    echo "      $file:$start-$end matched /$pat/ $n time(s), expected $want"
  fi
}

echo "=== DEFECT 3: the intake auto-publish path erases classifications ==="
echo

# ---------------------------------------------------------------------------
# LINK 1 - The four columns exist on menu_items and are the ENFORCEMENT source.
# ---------------------------------------------------------------------------
echo "-- Link 1: menu_items is what the register enforces from --"
chk "0216 adds menu_items.low_thc_liquid" \
  supabase/migrations/0216_low_thc_liquid_limit.sql 96 "add column if not exists low_thc_liquid boolean;"
chk "0216 adds menu_items.unit_thc_mg" \
  supabase/migrations/0216_low_thc_liquid_limit.sql 98 "add column if not exists unit_thc_mg    numeric(10,3);"
chk "0217 adds menu_items.otherwise_taken" \
  supabase/migrations/0217_otherwise_taken_limit.sql 163 "add column if not exists otherwise_taken   boolean;"
chk "0217 adds menu_items.units_per_package" \
  supabase/migrations/0217_otherwise_taken_limit.sql 165 "add column if not exists units_per_package numeric(10,3);"

chk "live-menu reads lowThcLiquid from the menu row" \
  src/lib/pos/live-menu.ts 94 "lowThcLiquid: row.low_thc_liquid ?? null,"
chk "live-menu reads unitThcMg from the menu row" \
  src/lib/pos/live-menu.ts 95 "unitThcMg: row.unit_thc_mg ?? null,"
chk "live-menu reads otherwiseTaken from the menu row" \
  src/lib/pos/live-menu.ts 99 "otherwiseTaken: row.otherwise_taken ?? null,"
chk "live-menu reads unitsPerPackage from the menu row" \
  src/lib/pos/live-menu.ts 100 "unitsPerPackage: row.units_per_package ?? null,"

# NULL is the fail-open: an unclassified row is treated as a normal liquid /
# not-otherwise-taken, so the special bucket never engages.
chk "0216 states NULL means not-yet-classified" \
  supabase/migrations/0216_low_thc_liquid_limit.sql 106 "NULL = not yet classified"

# ---------------------------------------------------------------------------
# LINK 2 - Classifications DO get written to menu_items (so there is something
#          real to lose).
# ---------------------------------------------------------------------------
echo "-- Link 2: classifications really are written to menu_items --"
chk "applyClassificationToMenu writes otherwise_taken" \
  src/lib/inventory/classification-status-store.ts 223 "otherwise_taken: flags.otherwiseTaken,"
chk "applyClassificationToMenu writes units_per_package" \
  src/lib/inventory/classification-status-store.ts 224 "units_per_package: flags.unitsPerPackage,"
chk "applyClassificationToMenu writes low_thc_liquid" \
  src/lib/inventory/classification-status-store.ts 225 "low_thc_liquid: flags.lowThcLiquid,"
chk "applyClassificationToMenu writes unit_thc_mg" \
  src/lib/inventory/classification-status-store.ts 226 "unit_thc_mg: flags.unitThcMg,"

chk "draft injection writes low_thc_liquid onto the new row" \
  src/lib/pos/draft-injection.ts 276 "low_thc_liquid: it.low_thc_liquid,"
chk "draft injection writes otherwise_taken onto the new row" \
  src/lib/pos/draft-injection.ts 278 "otherwise_taken: it.otherwise_taken,"

# ---------------------------------------------------------------------------
# LINK 3 - THE DEFECT. The intake staging path carries a published item forward
#          field by field, and the four columns are NOT among the fields.
# ---------------------------------------------------------------------------
echo "-- Link 3: the carry-forward loses the four columns (3 places) --"

# 3a. The DB READ that loads the published rows.
chk "loadCarryForwardItems is the published-row reader" \
  src/lib/pos/intake-menu-staging.ts 528 "async function loadCarryForwardItems"
# It selects "*", so the data IS available - the loss is in the mapping, not
# the query. That distinction matters: it means the fix is cheap and local.
present "loadCarryForwardItems selects * for items+variants (data IS available)" \
  src/lib/pos/intake-menu-staging.ts 528 558 '\.select\("\*"\)' 2
absent "READ MAPPING drops all four columns" \
  src/lib/pos/intake-menu-staging.ts 559 599 'low_thc_liquid|unit_thc_mg|otherwise_taken|units_per_package'
# Control: the SLICE 62 structured facts ARE carried, proving the mapping is
# an explicit allowlist and the omission is a gap, not a style.
present "control: servings_per_pack IS carried in the same mapping" \
  src/lib/pos/intake-menu-staging.ts 559 599 'servings_per_pack' 1

# 3b. The TYPE that models a carried row.
chk "CarryForwardItem is the carried-row type" \
  src/lib/pos/intake-menu-staging-core.ts 71 "export type CarryForwardItem = {"
absent "TYPE has no field for any of the four columns" \
  src/lib/pos/intake-menu-staging-core.ts 71 119 'low_thc_liquid|unit_thc_mg|otherwise_taken|units_per_package'
chk "StagedSnapshotItem is the staged-row type" \
  src/lib/pos/intake-menu-staging-core.ts 120 "export type StagedSnapshotItem = {"
absent "STAGED TYPE has no field for any of the four columns" \
  src/lib/pos/intake-menu-staging-core.ts 120 163 'low_thc_liquid|unit_thc_mg|otherwise_taken|units_per_package'

# 3c. The PURE mapper.
chk "carryForward() is the verbatim-carry mapper" \
  src/lib/pos/intake-menu-staging-core.ts 264 "function carryForward(item: CarryForwardItem, sortOrder: number)"
absent "carryForward() copies none of the four columns" \
  src/lib/pos/intake-menu-staging-core.ts 264 307 'low_thc_liquid|unit_thc_mg|otherwise_taken|units_per_package'

# 3d. The DB WRITE that inserts the new version's rows.
chk "persistSnapshotItems is the staged-row writer" \
  src/lib/pos/intake-menu-staging.ts 615 "async function persistSnapshotItems"
absent "WRITE omits all four columns -> new rows are NULL" \
  src/lib/pos/intake-menu-staging.ts 615 660 'low_thc_liquid|unit_thc_mg|otherwise_taken|units_per_package'
present "control: servings_per_pack IS written by the same insert" \
  src/lib/pos/intake-menu-staging.ts 615 660 'servings_per_pack' 1

# ---------------------------------------------------------------------------
# LINK 4 - The damage is LIVE, not staged: this version auto-publishes.
# ---------------------------------------------------------------------------
echo "-- Link 4: the lossy snapshot is published automatically --"
chk "the lossy rows are inserted under the new version" \
  src/lib/pos/intake-menu-staging.ts 327 "await persistSnapshotItems(version.id, plan.items);"
chk "and the new version is auto-published" \
  src/lib/pos/intake-menu-staging.ts 362 "const publishedOk = await autoPublishIntakeVersion(version.id, actorId, manifestId);"

# ---------------------------------------------------------------------------
# LINK 5 - The trigger is routine, not exotic: approving ANY draft fires it.
# ---------------------------------------------------------------------------
echo "-- Link 5: routine actions trigger it --"
chk "approving a catalog draft stages+publishes a new version" \
  src/lib/inventory/catalog-drafts.ts 806 "await stageIntakeMenuVersionForManifest(row.manifest_id, actorId);"
present "receiving a manifest also stages a new version" \
  src/lib/inventory/intake-store.ts 1263 1263 'stageIntakeMenuVersionForManifest\(manifestId, actorId\)' 1

# ---------------------------------------------------------------------------
# LINK 6 - Nothing downstream repairs it.
# ---------------------------------------------------------------------------
echo "-- Link 6: no compensating repair exists --"
# The POS import path never writes the four columns either, so a subsequent
# Cultivera import cannot restore them.
absent "import-service.ts never writes the four columns" \
  src/lib/pos/import-service.ts 1 900 'low_thc_liquid|unit_thc_mg|otherwise_taken|units_per_package'
# Only ONE module re-applies a classification, and it is human-triggered from
# the lot page - there is no automatic reconciler.
present "exactly one caller of applyClassificationToMenu (human-triggered)" \
  src/app/admin/inventory/actions.ts 759 759 'applyClassificationToMenu' 1

echo
echo "-------------------------------------------------------------"
echo "PASS: $pass    FAIL: $fail"
echo "-------------------------------------------------------------"
if [[ "$fail" != "0" ]]; then
  echo "VERIFICATION FAILED - do not trust the writeup until this is 0."
  exit 1
fi
echo "All DEFECT 3 citations verified against primary source."

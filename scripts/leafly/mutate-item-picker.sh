#!/usr/bin/env bash
#
# scripts/leafly/mutate-item-picker.sh  (SLICE L-18)
#
# TESTING THE TESTS for the Leafly item picker.
#
# A passing suite proves the code runs. It does NOT prove the suite would
# notice if the code became dangerous. This harness deliberately reintroduces
# each hazard the picker exists to prevent and asserts the suite goes red.
#
# THE RULE THAT MAKES THIS HONEST:
#   A mutation whose target string cannot be found is reported as a FAILURE,
#   not a pass. An unapplied mutation has tested nothing, and scoring it green
#   would be a lie. This has caught a real problem before — a target split
#   across two lines by a reformat — and it is why every mutant below verifies
#   its own application.
#
# Usage:  bash scripts/leafly/mutate-item-picker.sh
# Exit 0 = every mutant was caught.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

CORE="src/lib/leafly/selection-core.ts"
SERVER="src/lib/leafly/selection-server.ts"
ACTIONS="src/app/admin/integrations/leafly/selection-actions.ts"
PAGE="src/app/admin/integrations/leafly/page.tsx"
CLIENT="src/app/admin/integrations/leafly/leafly-picker-client.tsx"
TEST="tests/compliance/leafly-item-picker.test.ts"
RUNNER="scripts/compliance/run-pure-selftests.ts"

# EVERY file this harness can mutate must be backed up and restored, INCLUDING
# the test file itself.
#
# This list was originally missing $TEST, and the x-a mutant (which rewrites the
# comment stripper inside the test) therefore left the suite permanently
# sabotaged after the run — six tests began failing against untouched source.
# A mutation harness that does not perfectly restore is worse than no harness:
# it silently corrupts the thing it was built to protect.
BACKUP_DIR="$(mktemp -d)"
cp "$CORE" "$BACKUP_DIR/core.ts"
cp "$SERVER" "$BACKUP_DIR/server.ts"
cp "$ACTIONS" "$BACKUP_DIR/actions.ts"
cp "$PAGE" "$BACKUP_DIR/page.tsx"
cp "$CLIENT" "$BACKUP_DIR/client.tsx"
cp "$TEST" "$BACKUP_DIR/test.ts"
cp "$RUNNER" "$BACKUP_DIR/runner.ts"

restore() {
  cp "$BACKUP_DIR/core.ts" "$CORE"
  cp "$BACKUP_DIR/server.ts" "$SERVER"
  cp "$BACKUP_DIR/actions.ts" "$ACTIONS"
  cp "$BACKUP_DIR/page.tsx" "$PAGE"
  cp "$BACKUP_DIR/client.tsx" "$CLIENT"
  cp "$BACKUP_DIR/test.ts" "$TEST"
  cp "$BACKUP_DIR/runner.ts" "$RUNNER"
}
trap 'restore; rm -rf "$BACKUP_DIR"' EXIT

CAUGHT=0
SURVIVED=0
UNAPPLIED=0

# mutate <id> <description> <file> <python-replacement-expression>
#
# Python is used rather than sed because several targets span multiple lines
# and contain characters sed would need escaping for.
mutate() {
  local id="$1" desc="$2" file="$3" old="$4" new="$5"

  restore

  python3 - "$file" "$old" "$new" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding="utf-8").read()
if old not in src:
    sys.exit(42)
open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
PY
  local rc=$?

  if [ $rc -eq 42 ]; then
    # THE HONEST FAILURE. The mutation never applied, so it proved nothing.
    echo "  [FAIL] $id ($desc)"
    echo "         anchor not found; the mutation never applied, so it proved nothing."
    UNAPPLIED=$((UNAPPLIED + 1))
    return
  fi

  if npx vitest run "$TEST" >/dev/null 2>&1; then
    echo "  [SURVIVED] $id ($desc)"
    echo "             the suite still passed with this defect in place."
    SURVIVED=$((SURVIVED + 1))
  else
    echo "  [caught]   $id ($desc)"
    CAUGHT=$((CAUGHT + 1))
  fi
}

echo "Mutating the Leafly item picker to check the tests actually bite."
echo

echo "HAZARD 1 — a partial POST would delete the rest of the menu"
mutate "h1-a" "method coercion removed entirely" "$CORE" \
  '  if (input.requested === "POST" && !isWholeFeed) {
    return { method: "PUT", coerced: true };
  }' \
  '  // mutant: coercion removed'

mutate "h1-b" "coercion silently not reported" "$CORE" \
  'return { method: "PUT", coerced: true };' \
  'return { method: "PUT", coerced: false };'

mutate "h1-c" "off-by-one lets a near-complete selection POST" "$CORE" \
  'const isWholeFeed = input.feedCount > 0 && input.selectedCount >= input.feedCount;' \
  'const isWholeFeed = input.feedCount > 0 && input.selectedCount >= input.feedCount - 1;'

mutate "h1-d" "empty feed mistaken for the whole feed" "$CORE" \
  'const isWholeFeed = input.feedCount > 0 && input.selectedCount >= input.feedCount;' \
  'const isWholeFeed = input.selectedCount >= input.feedCount;'

mutate "h1-e" "transmission-boundary assertion removed" "$SERVER" \
  '  if (plan.method !== "PUT" && !plan.isWholeFeed) {
    throw new Error(
      "Refusing to send a partial selection as POST: Leafly treats POST as a full menu replacement.",
    );
  }' \
  '  // mutant: boundary assertion removed'

echo
echo "HAZARD 2 — a targeted push must not write sync state"
mutate "h2-a" "partial plan claims it writes sync state" "$CORE" \
  '    writesSyncState: isWholeFeed,' \
  '    writesSyncState: true,'

mutate "h2-b" "sync state actually written after a targeted push" "$SERVER" \
  '  const payload: LeaflyItemsPayload = { items: leaflyItems };
  const result = await authedFetch(menuItemsUrl(), "PUT", payload, {' \
  '  const payload: LeaflyItemsPayload = { items: leaflyItems };
  await saveSyncState("leafly", new Map(), null);
  const result = await authedFetch(menuItemsUrl(), "PUT", payload, {'

echo
echo "HAZARD 3 — a targeted push must never issue DELETE"
mutate "h3-a" "plan claims it emits deletes" "$CORE" \
  '    emitsDeletes: false,' \
  '    emitsDeletes: true,'

mutate "h3-b" "an actual DELETE request added to the targeted push" "$SERVER" \
  '  const config = getLeaflyConfig();
  const waitHint =' \
  '  await authedFetch(menuItemsUrl(), "DELETE", { ids: [] });
  const config = getLeaflyConfig();
  const waitHint ='

mutate "h3-c" "result stops testifying that nothing was deleted" "$SERVER" \
  '    deletesIssued: false,' \
  '    deletesIssued: false as unknown as false, // mutant marker
    // deletesIssued removed from the honest record'

echo
echo "Refusals and caps"
mutate "r-a" "empty selection silently allowed" "$CORE" \
  '  if (itemCount === 0) {
    refusals.push({
      code: "empty-selection",' \
  '  if (false) {
    refusals.push({
      code: "empty-selection",'

mutate "r-b" "targeted cap removed" "$CORE" \
  '  if (itemCount > TARGETED_PUSH_MAX_ITEMS) {' \
  '  if (itemCount > 100000) {'

mutate "r-c" "refused plan transmitted anyway" "$SERVER" \
  '  if (!plan.ok) {
    throw new SelectionRefusedError(plan);
  }' \
  '  // mutant: refusal ignored'

echo
echo "Correctness of the selection logic itself"
mutate "s-a" "exclude no longer beats include" "$CORE" \
  '    if (excluded.has(id)) return false;
    if (forced.has(id)) return true;' \
  '    if (forced.has(id)) return true;
    if (excluded.has(id)) return false;'

mutate "s-b" "unparseable potency treated as zero" "$CORE" \
  '    const thc = parsePercent(item.thc);
    if (thc === null) return false;' \
  '    const thc = parsePercent(item.thc) ?? 0;'

mutate "s-c" "filters become OR instead of AND" "$CORE" \
  '  const brands = nonEmpty(spec.brands);
  if (brands.length > 0 && !brands.includes(norm(item.brand))) return false;' \
  '  const brands = nonEmpty(spec.brands);'

mutate "s-d" "sampler degrades to 'take the first N'" "$CORE" \
  '  const noveltyOf = (item: SyndicationItem): number => {' \
  '  const noveltyOf = (_unusedItem: SyndicationItem): number => {
    return 0;
  };
  const _origNoveltyOf = (item: SyndicationItem): number => {'

mutate "s-e" "sampler becomes non-deterministic" "$CORE" \
  '  const pool = [...items].sort((a, b) => a.id.localeCompare(b.id));' \
  '  const pool = [...items].sort(() => Math.random() - 0.5);'

mutate "s-f" "search matches ANY word instead of all" "$CORE" \
  '    if (score === 0) return 0;
    total += score;' \
  '    total += score;'

mutate "s-g" "brand match outranks an exact name match" "$CORE" \
  '  if (name === term) return 900;' \
  '  if (name === term) return 150;'

echo
echo "Coverage reporting must not become wallpaper"
mutate "c-a" "coverage gaps reported even for a rich selection" "$CORE" \
  '  const gaps: CoverageGap[] = [];
  if (items.length > 0) {' \
  '  const gaps: CoverageGap[] = [];
  if (true) {'

mutate "c-b" "coverage never reports any gap at all" "$CORE" \
  '    if (withMultipleVariants === 0) {' \
  '    if (false) {'

echo
echo "Wiring, permissions and confirmation"
mutate "w-a" "picker removed from the page" "$PAGE" \
  '      <LeaflyItemPicker configured={preview.readiness.configured} />' \
  '      {/* mutant: picker removed */}'

mutate "w-b" "push action no longer requires confirmation" "$ACTIONS" \
  '  if (!input.confirm) {
    return { ok: false, error: "Confirmation required for a targeted Leafly push." };
  }' \
  '  // mutant: confirmation no longer required'

mutate "w-c" "server push no longer requires confirmation" "$SERVER" \
  '  if (!input.confirm) {
    throw new Error("A targeted Leafly push requires explicit confirmation.");
  }' \
  '  // mutant: confirmation removed'

mutate "w-d" "audit stops recording the safety facts" "$ACTIONS" \
  '        syncStateWritten: result.syncStateWritten,
        deletesIssued: result.deletesIssued,' \
  '        // mutant: safety facts no longer audited'

mutate "w-e" "core loses its purity (a fetch appears)" "$CORE" \
  'export function parsePercent(value: string | null | undefined): number | null {' \
  'export async function __leak(u: string) {
  return fetch(u);
}
export function parsePercent(value: string | null | undefined): number | null {'

# w-f family: the stale-preview guard. The original single mutant deleted an
# effect. That effect was replaced by a DERIVATION (a preview carries the
# selection key it was built for), so the family grew to cover each way the
# derivation can be defeated -- including two that an effect never protected
# against at all.
mutate "w-f" "stale preview no longer invalidated on selection change" "$CLIENT" \
  '    preview && preview.builtFor === selectionKey ? preview.value : null;' \
  '    preview ? preview.value : null;'

mutate "w-f2" "arming survives a selection change (confirm without a live preview)" "$CLIENT" \
  '  const isArmed = armed && livePreview !== null;' \
  '  const isArmed = armed;'

mutate "w-f3" "selection key becomes order-dependent" "$CLIENT" \
  '    () => Array.from(selected).sort().join(","),' \
  '    () => Array.from(selected).join(","),'

mutate "w-f4" "preview tag computed from a different set than the ids sent" "$CLIENT" \
  '      const builtFor = [...ids].sort().join(",");' \
  '      const builtFor = selectionKey;'

mutate "w-g" "targeted payload built by a different path than the full sync" "$SERVER" \
  '  assertLeaflyPayloadValid({ items: leaflyItems });' \
  '  // mutant: contract validation skipped'

echo
echo "CI's second, independent gate (the pure self-test runner)"
# These two are deliberately different failures. The first is the obvious one
# (the core is dropped from CI entirely). The second is the one that actually
# happens in real repositories: the registration is left in place but its floor
# is lowered to something meaningless, so a core whose assertions have all been
# deleted still "passes". A floor of 1 is not a floor.
mutate "r-a" "picker core dropped from the CI self-test runner" "$RUNNER" \
  '  assertRan("leafly-selection-core", __runLeaflySelectionTests(), 100);' \
  '  // mutant: core no longer run by CI'

mutate "r-b" "registration kept but the floor lowered to a meaningless value" "$RUNNER" \
  '  assertRan("leafly-selection-core", __runLeaflySelectionTests(), 100);' \
  '  assertRan("leafly-selection-core", __runLeaflySelectionTests(), 1);'

echo
echo "The comment stripper the guards rely on"
mutate "x-a" "stripper would return nothing (guards pass vacuously)" "$TEST" \
  '  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<!:)\/\/[^\n]*/g, " ");' \
  '  return "";'

restore

echo
echo "=================================================="
echo "caught:    $CAUGHT"
echo "survived:  $SURVIVED"
echo "unapplied: $UNAPPLIED  (counted as failures — they proved nothing)"
echo "=================================================="

if [ "$SURVIVED" -eq 0 ] && [ "$UNAPPLIED" -eq 0 ]; then
  echo "All mutants caught."
  exit 0
fi
exit 1

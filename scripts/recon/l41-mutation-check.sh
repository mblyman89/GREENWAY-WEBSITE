#!/usr/bin/env bash
# =============================================================================
# L-41 — TESTING THE TESTS THAT GUARD "AUTO SYNC ACTUALLY TURNS ON AND SENDS"
# =============================================================================
#
# Each mutation undoes one L-41 fix (or breaks one planner invariant) and
# requires the guarding suite to go RED. A mutant that stays green is a fix
# nobody guards. Exact-string replacements that must match exactly once;
# every file is restored byte-for-byte and verified with cmp on exit.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"

TESTS=(
  tests/compliance/pure-selftests.test.ts
  tests/compliance/leafly-l34-menu-sync-runtime.test.ts
  tests/compliance/leafly-l41-auto-sync.test.ts
)
FILES=(
  src/lib/leafly/auto-sync-core.ts
  src/lib/leafly/auto-sync-server.ts
  src/lib/leafly/schedule-core.ts
  src/lib/leafly/schedule-server.ts
  src/lib/syndication/sync-settings-core.ts
  src/app/admin/integrations/leafly/actions.ts
  src/components/admin/syndication/LeaflySchedulePanel.tsx
)

BAK=$(mktemp -d)
for f in "${FILES[@]}"; do mkdir -p "$BAK/$(dirname "$f")"; cp "$f" "$BAK/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BAK/$f" "$f"; done; }
verify_restore() {
  local bad=0
  for f in "${FILES[@]}"; do cmp -s "$BAK/$f" "$f" || { echo "RESTORE FAILED: $f"; bad=1; }; done
  return $bad
}
trap 'restore; verify_restore' EXIT

run_suite() { npx vitest run "${TESTS[@]}" >/tmp/l41mut.out 2>&1; }

replace() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding="utf-8").read()
n = src.count(old)
if n != 1:
    sys.stderr.write(f"MUTATION TARGET MATCHED {n} TIMES in {path}: {old!r}\n")
    sys.exit(3)
open(path, "w", encoding="utf-8").write(src.replace(old, new))
PY
}

KILLED=0; SURVIVED=0; BROKEN=0
mutate() {
  local name="$1" file="$2" old="$3" new="$4"
  restore
  if ! replace "$file" "$old" "$new"; then
    echo "  TARGET-MISSING $name"; BROKEN=$((BROKEN + 1)); restore; return
  fi
  if run_suite; then
    echo "  SURVIVED  $name"; SURVIVED=$((SURVIVED + 1))
  else
    echo "  killed    $name"; KILLED=$((KILLED + 1))
  fi
  restore
}

echo "BASELINE (must be GREEN):"
if run_suite; then echo "  green"; else echo "  BASELINE RED — aborting"; tail -40 /tmp/l41mut.out; exit 1; fi

AC=src/lib/leafly/auto-sync-core.ts
AS=src/lib/leafly/auto-sync-server.ts
SC=src/lib/leafly/schedule-core.ts
SS=src/lib/leafly/schedule-server.ts
SET=src/lib/syndication/sync-settings-core.ts
ACT=src/app/admin/integrations/leafly/actions.ts
PANEL=src/components/admin/syndication/LeaflySchedulePanel.tsx

echo "MUTANTS (each must be KILLED):"
# Defect 1 — the read.
mutate "1: scheduler reads the whole blob again (the owner's bug)" "$SS" \
  'return readStoredLeaflySchedule(raw);' \
  'return readStoredLeaflySchedule({ schedule: raw } as never);'
mutate "1: reader looks at the top level" "$SET" \
  '  return resolveLeaflySettings(raw).schedule;' \
  '  return resolveScheduleSettings(raw);'
mutate "1: save action drops repairSizes" "$ACT" \
  'repairSizes: readBool("repairSizes"),' \
  'repairSizes: false,'
mutate "1: panel never sends repairSizes" "$PANEL" \
  'fd.set("repairSizes", repairSizes ? "true" : "false");' \
  ''
mutate "1: repairSizes accepts truthy strings" "$SC" \
  'repairSizes: r.repairSizes === true,' \
  'repairSizes: Boolean(r.repairSizes),'
mutate "1: describeSchedule ignores repair" "$SC" \
  '  const repair = s.repairSizes' \
  '  const repair = false'
# Defect 2 — the send.
mutate "2: scheduler ignores the stored repair choice" "$SS" \
  'pushLeaflyAutomatic({ kind, repair: settings.repairSizes })' \
  'pushLeaflyAutomatic({ kind, repair: false })'
mutate "2: every run treated as daily" "$SS" \
  'const kind = decision.code === "daily_full" ? "daily_full" : "intraday_delta";' \
  'const kind = "daily_full" as const;'
mutate "2: refusal recorded as a quiet skip" "$SS" \
  'const disposition = result.skipped ? "skipped" : result.ok ? "success" : "failed";' \
  'const disposition = result.skipped || result.refused ? "skipped" : result.ok ? "success" : "failed";'
mutate "2: family protection unplugged" "$AS" \
  'familyOf: (id) => splitParentId(id) ?? id,' \
  'familyOf: (id) => id,'
mutate "2: delete even when the send failed" "$AS" \
  'if (sendOk && plan.action === "put" && plan.deleteIds.length > 0) {' \
  'if (plan.action === "put" && plan.deleteIds.length > 0) {'
# Planner invariants.
mutate "A1: POST even with products held back" "$AC" \
  'if (input.kind === "daily_full" && withheld.length === 0) {' \
  'if (input.kind === "daily_full") {'
mutate "A2b: held family not protected" "$AC" \
  '    if (heldFamilies.has(familyOf(id))) familyProtected.push(id);' \
  '    if (false) familyProtected.push(id);'
mutate "A4: refusal falls through to a send" "$AC" \
  '  if (!input.planProceeds) {' \
  '  if (false) {'
mutate "A5: daily POST sends only the delta" "$AC" \
  '      postIds: sendIds,' \
  '      postIds: [...creates, ...updates],'
mutate "A6: forced resend is skipped" "$AC" \
  '  if (nothingChanged && !input.forceResend) {' \
  '  if (nothingChanged) {'
mutate "state: failed DELETE still forgets the ids" "$AC" \
  '  if (input.deleteSucceeded) {' \
  '  if (true) {'
# Evidence rule.
mutate "E: downgraded daily PUT not evidence (core)" "$SC" \
  '  if (row.decisionCode === "daily_full" && row.disposition === "success") return true;' \
  ''
mutate "E: downgraded daily PUT not evidence (filter)" "$SC" \
  'and(method.eq.POST,disposition.eq.success),and(decision_code.eq.daily_full,disposition.eq.success),and(' \
  'and(method.eq.POST,disposition.eq.success),and('

echo "DOCUMENTED EQUIVALENT MUTANTS (expected GREEN — no observable behaviour):"
# The explicit `withheldSet.has(id)` skip in the delete loop is REDUNDANT with
# the A2b family rule: every held-back id is a member of its own family
# (`familyOf` returns the id itself when there is no split suffix, and falls
# back to the id on junk), so a held-back id that reaches the family check is
# always moved to `protectedIds` rather than `deleteIds`, and it lands in
# `protectedIds` either way (the list is de-duplicated). Removing the skip
# therefore changes nothing a test can observe. It is kept in the source as
# the plain statement of rule A3. The family rule that makes it redundant IS
# guarded: "A2b: held family not protected" above is killed. If this ever
# turns RED, the family rule has changed: re-read A2b/A3.
equivalent() {
  local name="$1" file="$2" old="$3" new="$4"
  restore
  if ! replace "$file" "$old" "$new"; then
    echo "  TARGET-MISSING $name"; BROKEN=$((BROKEN + 1)); restore; return
  fi
  if run_suite; then echo "  equivalent (green, as reasoned)  $name"
  else echo "  NOW OBSERVABLE (red) — reclassify as guarded  $name"; fi
  restore
}
equivalent "A3: explicit held-back skip removed (covered by A2b)" "$AC" \
  '    if (send.has(id) || withheldSet.has(id)) continue;' \
  '    if (send.has(id)) continue;'
# And with BOTH removed, a held-back product really is deleted -- proof the
# pair is what guards A3, not neither.
mutate "A3: held-back product deleted (skip AND family rule removed)" "$AC" \
  '    if (send.has(id) || withheldSet.has(id)) continue;
    if (heldFamilies.has(familyOf(id))) familyProtected.push(id);' \
  '    if (send.has(id)) continue;
    if (false) familyProtected.push(id);'

echo
echo "RESULT: $KILLED killed / $SURVIVED survived / $BROKEN target-missing"
[ "$SURVIVED" -eq 0 ] && [ "$BROKEN" -eq 0 ]

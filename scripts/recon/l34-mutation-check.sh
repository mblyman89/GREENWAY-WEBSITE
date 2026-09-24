#!/usr/bin/env bash
# =============================================================================
# L-34 — TESTING THE TESTS THAT GUARD THE VERCEL PRO CADENCE FIXES
# =============================================================================
#
# Raising the Leafly crons from once a day to every 2 / 15 minutes exposed
# seven defects (A–G, see docs + AGENTS.md rule 12). Each fix is guarded by
# tests. Those tests are only worth something if they FAIL when the fix is
# undone. This script undoes each fix, one at a time, and requires the suite
# to go RED every time. A mutation that stays green is a fix nobody guards.
#
# Every mutation is an exact-string replacement that must match exactly once
# (so a refactor that moves the code aborts the script instead of silently
# "killing" nothing), and every file is restored from a byte-for-byte copy and
# VERIFIED with cmp before the script exits.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"

TESTS=(
  tests/compliance/pure-selftests.test.ts
  tests/compliance/leafly-l34-sweep-concurrency.test.ts
  tests/compliance/leafly-l34-menu-sync-runtime.test.ts
  tests/compliance/leafly-l33-auto-acknowledge.test.ts
  tests/compliance/leafly-order-webhooks.test.ts
)
FILES=(
  src/lib/leafly/schedule-core.ts
  src/lib/leafly/schedule-server.ts
  src/lib/leafly/auto-ack-sweep-core.ts
  src/lib/leafly/auto-ack-server.ts
  src/lib/leafly/webhook-parse-core.ts
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

run_suite() { npx vitest run "${TESTS[@]}" >/tmp/l34mut.out 2>&1; }

# replace FILE OLD NEW — exact string, must occur exactly once.
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
if run_suite; then echo "  green"; else echo "  BASELINE RED — aborting"; tail -40 /tmp/l34mut.out; exit 1; fi

SC=src/lib/leafly/schedule-core.ts
SS=src/lib/leafly/schedule-server.ts
SWC=src/lib/leafly/auto-ack-sweep-core.ts
AAS=src/lib/leafly/auto-ack-server.ts
WPC=src/lib/leafly/webhook-parse-core.ts

echo "MUTATIONS (each must be RED):"
# Defect A — tick jitter starves the intraday cadence.
mutate "A: drop intraday due tolerance" "$SC" \
  'sinceLastRun < s.intradayMinutes - INTRADAY_DUE_TOLERANCE_MINUTES' \
  'sinceLastRun < s.intradayMinutes'
# Defect A' — refusals reset the cadence clock.
mutate "A': refusals count as runs again" "$SC" \
  'if (row.disposition === "refused") continue;' \
  ';'
# Defect B — sweep acknowledges canceled orders / alarms forever.
mutate "B: ignore canceledAt" "$SWC" \
  'if (candidate.canceledAt != null && String(candidate.canceledAt).trim() !== "") {' \
  'if (false) {'
mutate "B: server stops filtering canceled rows" "$AAS" \
  '.is("canceled_at", null)' \
  '.not("leafly_order_id", "is", null)'
mutate "B: unbounded expired-deadline reporting" "$SWC" \
  'if (msUntilDeadline !== null && msUntilDeadline < -SWEEP_EXPIRED_REPORT_MS) {' \
  'if (false) {'
mutate "B: unbounded null-deadline age" "$SWC" \
  'if (deadlineMs === null && ageMs > SWEEP_NULL_DEADLINE_MAX_AGE_MS) {' \
  'if (false) {'
# Defect C — sweep window filter (historic rows hide the live order).
mutate "C: window filter loses null-deadline branch" "$AAS" \
  '`and(acknowledge_by.is.null,first_seen_at.gte."${firstSeenFloorIso}")`' \
  '`acknowledge_by.gte."${firstSeenFloorIso}"`'
mutate "C: window filter unquoted timestamps" "$AAS" \
  '`acknowledge_by.gte."${deadlineFloorIso}",` +' \
  '`acknowledge_by.gte.${deadlineFloorIso},` +'
# Defect D — quiet-day full-sync evidence.
mutate "D: skipped daily_full no longer evidence (core)" "$SC" \
  'return row.decisionCode === "daily_full" && row.disposition === "skipped";' \
  'return false;'
mutate "D: evidence filter only counts POSTs (server)" "$SS" \
  '.or(FULL_SYNC_EVIDENCE_FILTER)' \
  '.or("and(method.eq.POST,disposition.eq.success)")'
# Defect E — refusal log flood.
mutate "E: record every refusal" "$SS" \
  'shouldRecordRefusal({ decision, lastRecorded: facts.lastRecorded, nowIso: now })' \
  'true'
# cancelReason spec field.
mutate "cancelReason fallback removed" "$WPC" \
  'cancelationReasonCode = readString(body, "cancelReason");' \
  'cancelationReasonCode = null;'
# Defect F — concurrent sweep runs double-press.
mutate "F: sweep claim ignored" "$AAS" \
  'if (!claimPermitsAcknowledge(claim)) {' \
  'if (false) {'
# Defect G — duplicate menu-sync tick delivery.
mutate "G: start-race tie-break ignored" "$SS" \
  'if (race !== null && !wonRunStartRace({ ownId: runId, rows: race, nowIso: now })) {' \
  'if (false) {'

echo "DOCUMENTED EQUIVALENT MUTANTS (expected GREEN — no observable behaviour):"
# The server's `.neq("disposition", "refused")` on the history query is an
# OPTIMISATION: the pure core `summarizeRunHistory` skips refusals itself (the
# mutation "A': refusals count as runs again" above proves that rule is
# guarded). Dropping the query filter can only matter if more than 50 refusal
# rows (the query limit) are newer than the last real run. Even in the worst
# case, where EVERY 15-minute tick wrote a refusal (the heartbeat rule says
# otherwise), 50 rows cover 12.5 hours. That is far past the longest backoff
# (BACKOFF_MINUTES_MAX = 240 min = 16 ticks) and every intraday setting, so
# "no real run in the window" and "last real run 12.5h+ ago" both simply mean
# "due", with the failure streak already irrelevant. No test can tell the
# difference, so this script does not claim one exists. If this
# ever turns RED, something now depends on the query filter: re-read it.
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
equivalent "A': server stops excluding refusals (query optimisation)" "$SS" \
  '.neq("disposition", "refused")' \
  '.neq("disposition", "__none__")'

echo
echo "RESULT: $KILLED killed / $SURVIVED survived / $BROKEN target-missing"
[ "$SURVIVED" -eq 0 ] && [ "$BROKEN" -eq 0 ]

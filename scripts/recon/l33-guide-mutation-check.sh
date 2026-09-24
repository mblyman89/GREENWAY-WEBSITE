#!/usr/bin/env bash
# =============================================================================
# L-33 — TESTING THE TESTS THAT PIN THE OWNER'S OPERATING GUIDE
# =============================================================================
#
# §8 of leafly-l33-auto-acknowledge.test.ts claims that
# docs/l33-auto-acknowledge-operating-guide.md cannot silently become a lie.
# That claim is worth exactly as much as the proof that the assertions FAIL
# when the guide is wrong. A documentation test that passes no matter what is
# worse than no test, because it advertises a guarantee it does not provide.
#
# So: break the guide (and the code the guide describes) several ways, each one a
# realistic drift that would send the owner to the wrong switch during an
# incident, and require the suite to go RED every time.
#
# SAFETY NOTE, learned the hard way during this slice: several L-33 files are
# still UNTRACKED, so `git checkout` cannot restore them. A mutation applied
# with sed and "restored" with git silently stayed in the source. Every
# mutation here is therefore restored from a byte-for-byte copy taken before
# the run, and the restore is VERIFIED with cmp before the script exits.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."

TEST=tests/compliance/leafly-l33-auto-acknowledge.test.ts
GUIDE=docs/l33-auto-acknowledge-operating-guide.md
CORE=src/lib/leafly/auto-ack-core.ts
VERCEL=vercel.json

BAK=$(mktemp -d)
cp "$GUIDE" "$BAK/guide"; cp "$CORE" "$BAK/core"; cp "$VERCEL" "$BAK/vercel"

restore() {
  cp "$BAK/guide" "$GUIDE"; cp "$BAK/core" "$CORE"; cp "$BAK/vercel" "$VERCEL"
}
trap 'restore' EXIT

# Runs the suite, returns 0 if GREEN, 1 if RED.
run_suite() { npx vitest run "$TEST" >/tmp/l33guide.out 2>&1; }

KILLED=0; SURVIVED=0

mutate() {
  local name="$1"; shift
  restore
  "$@"
  if run_suite; then
    echo "  SURVIVED  $name"
    SURVIVED=$((SURVIVED + 1))
  else
    echo "  killed    $name"
    KILLED=$((KILLED + 1))
  fi
  restore
}

echo "BASELINE (must be GREEN):"
if run_suite; then echo "  green"; else echo "  BASELINE RED — aborting"; exit 1; fi

echo "MUTATIONS (each must be RED):"

# 1. The guide names a switch that does not exist. The owner sets it during an
#    incident, nothing happens, and he concludes the kill switch is broken.
mutate "guide names the wrong env var" \
  sed -i 's/LEAFLY_AUTO_ACKNOWLEDGE/LEAFLY_AUTOACK_ENABLED/g' "$GUIDE"

# 2. The single most consequential sentence in the document, inverted.
mutate "guide claims the default is OFF" \
  sed -i 's/unset means the feature is ON/unset means the feature is OFF/' "$GUIDE"

# 3. The honesty pin. (L-34: rewritten for Vercel Pro. On Hobby this mutation
#    made the guide claim a per-minute cadence it did not have. On Pro the
#    guide states the real two-minute cadence; the realistic drift is now the
#    guide quoting a cadence or a chance count the schedule does not produce.)
mutate "guide misstates the sweeper's cadence" \
  sed -i 's/That is \*\*every two minutes\*\*/That is **every minute**/' "$GUIDE"

# 3b. The chance count is inflated — overselling the net.
mutate "guide oversells the chances per order" \
  sed -i 's/roughly \*\*six$/roughly **twelve/' "$GUIDE"

# 3c. The best-effort caveat is deleted — the guide implies guaranteed delivery.
mutate "guide drops the best-effort caveat" \
  sed -i 's/cron delivery as best effort/cron delivery as reliable/' "$GUIDE"

# 4. Drift in the OTHER direction: the code is reworded and the guide is left
#    behind. The owner looks for a badge that is no longer rendered.
mutate "badge reworded in code, guide stale" \
  sed -i 's/export const LEAFLY_AUTO_ACK_BADGE = "Accepted automatically";/export const LEAFLY_AUTO_ACK_BADGE = "Auto-accepted";/' "$CORE"

# 5. The schedule moves and the upgrade instruction now names a line that is
#    not in vercel.json.
mutate "cron schedule changed, guide stale" \
  sed -i 's|"\*/2 \* \* \* \*"|"*/3 * * * *"|' "$VERCEL"

# 6. The schedule is put back to daily (e.g. a revert) while the guide still
#    describes a two-minute net. Must fail rather than silently oversell.
mutate "cron reverted to daily, guide still claims a net" \
  sed -i 's|"\*/2 \* \* \* \*"|"0 13 * * *"|' "$VERCEL"

restore
echo "VERIFYING RESTORE (byte-for-byte):"
cmp -s "$BAK/guide" "$GUIDE" && echo "  guide  ok" || { echo "  guide  CORRUPT"; exit 1; }
cmp -s "$BAK/core" "$CORE"   && echo "  core   ok" || { echo "  core   CORRUPT"; exit 1; }
cmp -s "$BAK/vercel" "$VERCEL" && echo "  vercel ok" || { echo "  vercel CORRUPT"; exit 1; }

echo "FINAL (must be GREEN again):"
if run_suite; then echo "  green"; else echo "  RED AFTER RESTORE"; exit 1; fi

echo "RESULT: $KILLED killed / $SURVIVED survived"
[ "$SURVIVED" -eq 0 ] || exit 1

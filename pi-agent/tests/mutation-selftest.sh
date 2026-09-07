#!/usr/bin/env bash
# Mutation round for greenway_announcer.py
# Each mutation injects a REAL bug that would hurt Michael in the shop.
# The self-test must FAIL for every one. An escaped mutation = a coverage gap.
set -u
SRC="$(cd "$(dirname "$0")" && pwd)/../greenway_announcer.py"
WORK="/tmp/gw-mutate.py"
PASS=0
ESCAPED=0

run_mutation () {
  local name="$1"; shift
  local desc="$1"; shift
  cp "$SRC" "$WORK"
  python3 - "$WORK" "$@" <<'PYEOF'
import sys
path = sys.argv[1]
old = sys.argv[2]
new = sys.argv[3]
text = open(path).read()
if old not in text:
    print("MUTATION-NOT-APPLIED")
    sys.exit(9)
count = text.count(old)
open(path, "w").write(text.replace(old, new, 1))
sys.exit(0)
PYEOF
  local applied=$?
  if [ $applied -ne 0 ]; then
    echo "  !! $name  COULD NOT APPLY (pattern not found) -- $desc"
    ESCAPED=$((ESCAPED+1))
    return
  fi
  # Confirm the mutation really changed the file (guard against no-op edits)
  if cmp -s "$SRC" "$WORK"; then
    echo "  !! $name  NO-OP MUTATION -- $desc"
    ESCAPED=$((ESCAPED+1))
    return
  fi
  out="$(python3 "$WORK" selftest 2>&1)"
  if echo "$out" | grep -q "ALL CHECKS PASSED"; then
    echo "  ESCAPED  $name -- $desc"
    ESCAPED=$((ESCAPED+1))
  else
    local nf
    nf="$(echo "$out" | grep -oE '[0-9]+ failed' | head -1)"
    echo "  CAUGHT   $name ($nf) -- $desc"
    PASS=$((PASS+1))
  fi
}

echo "=== MUTATION ROUND: pi-agent/greenway_announcer.py ==="

run_mutation "M1" "junk volume becomes 0 (silent speaker)" \
  '    default = 70' '    default = 0'

run_mutation "M2" "backoff grows without a cap (Pi stays dead after an outage)" \
  '    index = min(consecutive_failures - 1, len(POLL_BACKOFF_SECONDS) - 1)
    return POLL_BACKOFF_SECONDS[index]' \
  '    return 60 * consecutive_failures'

run_mutation "M3" "a filename with a dot is treated as a built-in (custom sounds never play)" \
  '    return "/" not in s and "." not in s' \
  '    return "/" not in s'

run_mutation "M4" "one malformed job crashes the whole poll" \
  '        if not isinstance(item, dict):
            continue' \
  '        if not isinstance(item, dict):
            raise ValueError("bad job")'

run_mutation "M5" "missing sound defaults to empty instead of chime (nothing plays)" \
  '"sound": item.get("sound") if isinstance(item.get("sound"), str) else "chime",' \
  '"sound": item.get("sound") if isinstance(item.get("sound"), str) else "",'

run_mutation "M6" "cache filename keeps path separators (download breaks)" \
  '        cleaned.append(ch if (ch.isalnum() or ch in "-_.") else "_")' \
  '        cleaned.append(ch)'

run_mutation "M7" "401 no longer tells the owner to re-pair" \
  '    if status == 401:' '    if status == 4010:'

run_mutation "M8" "zero failures still forces a wait (first poll delayed)" \
  '    if consecutive_failures <= 0:
        return 0' \
  '    if consecutive_failures < 0:
        return 0'

run_mutation "M9" "volume percentage is not clamped (ALSA gets 150%)" \
  '    return f"{max(0, min(100, int(volume)))}%"' \
  '    return f"{int(volume)}%"'

run_mutation "M10" "a job with a blank id is accepted (unackable job loops forever)" \
  '        if job_id is None or str(job_id).strip() == "":
            continue' \
  '        if job_id is None:
            continue'

run_mutation "M11" "volume clamps to 0..10 instead of 0..100" \
  '    return max(0, min(100, int(round(value))))' \
  '    return max(0, min(10, int(round(value))))'

run_mutation "M12" "boolean True is read as volume 1 (near-silent speaker)" \
  '    if isinstance(raw, bool):
        return default' \
  '    if isinstance(raw, bool) and False:
        return default'

rm -f "$WORK"
echo "======================================================"
echo "CAUGHT: $PASS    ESCAPED: $ESCAPED"
[ $ESCAPED -eq 0 ] && echo "MUTATION ROUND CLEAN" || echo "COVERAGE GAPS FOUND -- close them"

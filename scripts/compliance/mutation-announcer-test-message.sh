#!/usr/bin/env bash
#
# Testing the tests: describeTestOutcome()
#
# The owner reported "the back office test speaker button does nothing, it
# hangs". It was not hanging -- it was silent. describeTestOutcome() is the
# sentence that fixes that, so the self-tests guarding it have to be real.
#
# This breaks that function on purpose, one way at a time, and demands the
# self-test sweep FAILS each time. A mutant that survives is a hole in the
# tests, not a curiosity: it is a change someone could make next year that
# would put the owner back in front of a button that says nothing.
#
#   bash scripts/compliance/mutation-announcer-test-message.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC="$ROOT/src/lib/announcer/announcer-fanout-core.ts"
BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"

restore () { cp "$BACKUP" "$SRC"; }
trap 'restore; rm -f "$BACKUP"' EXIT

CAUGHT=0
SURVIVED=0

# Run the sweep and report whether it FAILED (which is what we want).
sweep_fails () {
  ( cd "$ROOT" && npx tsx scripts/compliance/run-pure-selftests.ts >/dev/null 2>&1 )
  # Non-zero exit, or the success banner missing, both mean "caught".
  return $?
}

mutate () {
  local label="$1" from="$2" to="$3"
  restore
  # Confirm the text we intend to break is really there. A mutation harness
  # that silently patches nothing reports a perfect score while testing
  # nothing at all -- that exact failure has bitten this repo before.
  if ! grep -qF "$from" "$SRC"; then
    echo "  HARNESS BROKEN: could not find the code to mutate for: $label"
    SURVIVED=$((SURVIVED + 1))
    return
  fi
  python3 - "$SRC" "$from" "$to" <<'PY'
import sys
path, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path, encoding="utf-8").read()
open(path, "w", encoding="utf-8").write(s.replace(frm, to, 1))
PY

  if sweep_fails; then
    echo "  SURVIVED: $label"
    SURVIVED=$((SURVIVED + 1))
  else
    echo "  caught:   $label"
    CAUGHT=$((CAUGHT + 1))
  fi
}

echo "============================================================"
echo "MUTATING describeTestOutcome() - the sentence the Test button prints"
echo "============================================================"

# 1. Drop the wait warning. This is the exact regression that recreates the
#    original complaint: a test is queued, nothing explains the 25s silence.
mutate "the wait warning is dropped from a queued test" \
  'if (skipped > 0) {
    return `${lead} ${skipped} skipped. ${wait}`;
  }
  return `${lead} ${wait}`;' \
  'if (skipped > 0) {
    return `${lead} ${skipped} skipped.`;
  }
  return lead;'

# 2. Hardcode the hold. Looks right today, lies the moment POLL_HOLD_SECONDS moves.
mutate "the hold time is hardcoded instead of reported" \
  'Listen for up to ${holdSeconds} seconds - speakers check in on a ${holdSeconds}-second cycle.' \
  'Listen for up to 25 seconds - speakers check in on a 25-second cycle.'

# 3. Claim success when the fan-out failed.
mutate "a failed send is reported as if it worked" \
  'if (!ok) {
    return "Could not send the test. Nothing was queued - check the speaker list below.";
  }' \
  ''

# 4. Claim a sound is coming when every speaker was skipped.
mutate "an all-skipped test claims a sound is coming" \
  '${what} were skipped, so nothing will play. The reason is on the speaker cards below.' \
  'Test sent to the speakers.'

# 5. Silence on the empty-fleet path. Returning "" is the literal original bug.
mutate "the no-speakers case says nothing at all" \
  'return "There are no speakers paired yet, so there was nothing to test.";' \
  'return "";'

# 6. Break the singular/plural so one speaker reads "1 speakers".
mutate "pluralisation is broken (1 speakers)" \
  'const noun = queued === 1 ? "speaker" : "speakers";' \
  'const noun = "speakers";'

# 7. Stop reporting the skipped count on a partial success, so a half-broken
#    shop reads as a fully working one.
mutate "a partial success hides the speakers it skipped" \
  'return `${lead} ${skipped} skipped. ${wait}`;' \
  'return `${lead} ${wait}`;'

# 8. Report the count without ever saying the test was sent.
mutate "the queued count is dropped from the message" \
  'const lead = `Test sent to ${queued} ${noun}.`;' \
  'const lead = "Test sent.";'

restore

echo ""
echo "============================================================"
echo "caught: $CAUGHT   survived: $SURVIVED"
if [ "$SURVIVED" -eq 0 ]; then
  echo "MUTATION TESTING PASSED - every break in the Test message is caught"
  exit 0
fi
echo "MUTATION TESTING FAILED - the self-tests have a hole"
exit 1

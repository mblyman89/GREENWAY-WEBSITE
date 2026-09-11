#!/usr/bin/env bash
#
# Mutation harness for the announcer quickstart's doc assertions.
#
# The whole point of tests/compliance/announcer-docs.test.ts is that the manual
# cannot quietly drift from the software. That claim is worthless unless the
# assertions actually fail when drift happens. This script creates the drift on
# purpose -- one change at a time, in the SOURCE and in the DOC -- and demands a
# failure each time.
#
# A survivor means the manual could tell the owner something untrue and the
# build would stay green.
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

TEST_FILE="tests/compliance/announcer-docs.test.ts"
DOC="docs/announcer/06-copy-paste-quickstart.md"
AGENT="pi-agent/greenway_announcer.py"
INSTALLER="pi-agent/install.sh"
PANEL="src/components/admin/orders/AnnouncerPanel.tsx"
CORE="src/lib/announcer/announcer-core.ts"

BACKUP="$(mktemp -d)"
trap 'for f in "$DOC" "$AGENT" "$INSTALLER" "$PANEL" "$CORE"; do
        [ -f "$BACKUP/$(basename "$f")" ] && cp "$BACKUP/$(basename "$f")" "$f"
      done; rm -rf "$BACKUP"' EXIT

for f in "$DOC" "$AGENT" "$INSTALLER" "$PANEL" "$CORE"; do
  cp "$f" "$BACKUP/$(basename "$f")"
done

restore () {
  for f in "$DOC" "$AGENT" "$INSTALLER" "$PANEL" "$CORE"; do
    cp "$BACKUP/$(basename "$f")" "$f"
  done
}

run_tests () {
  npx vitest run "$TEST_FILE" >/tmp/mut-announcer-docs.log 2>&1
}

CAUGHT=0
SURVIVED=0

echo "Baseline: the real files must pass."
if ! run_tests; then
  echo "BASELINE FAILED - fix the suite before trusting this harness."
  tail -30 /tmp/mut-announcer-docs.log
  exit 1
fi
echo "baseline OK"
echo ""

mutate () {
  local label="$1" file="$2" from="$3" to="$4"
  restore
  if ! python3 - "$file" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
if old not in text:
    sys.exit(3)
open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
PY
  then
    echo "  SKIPPED (pattern not found): $label"
    SURVIVED=$((SURVIVED + 1))
    return
  fi
  if run_tests; then
    echo "  SURVIVED: $label"
    SURVIVED=$((SURVIVED + 1))
  else
    echo "  caught:   $label"
    CAUGHT=$((CAUGHT + 1))
  fi
}

echo "--- Drift in the SOFTWARE that the manual quotes ---"
mutate "installer renames a step banner" "$INSTALLER" \
  'step "Step 5 of 7: connecting this speaker to your website"' \
  'step "Step 5 of 7: linking this speaker to your website"'
mutate "installer changes its DONE banner" "$INSTALLER" \
  "================ DONE ================" \
  "=============== FINISHED ==============="
mutate "installer changes the journal cap" "$INSTALLER" \
  "SystemMaxUse=50M" "SystemMaxUse=80M"
mutate "agent changes the test-command header" "$AGENT" \
  "Playing each built-in sound. You should hear six different tones." \
  "Playing each built-in sound. You should hear several tones."
mutate "agent changes the status success line" "$AGENT" \
  "OK. The website answered and this speaker is checked in." \
  "OK. The site answered and this speaker is checked in."
mutate "agent drops a built-in sound" "$AGENT" \
  'for kind in ("chime", "bell", "ding", "alert", "cash", "voice"):' \
  'for kind in ("chime", "bell", "ding", "alert", "cash"):'
mutate "agent stops diagnosing the gateway" "$AGENT" \
  "instead of handling the speaker request" \
  "which was not what we wanted"
mutate "panel renames the pairing button" "$PANEL" \
  "Get pairing code" "Create pairing code"
mutate "panel renames the test button" "$PANEL" \
  "Test all speakers" "Test every speaker"
mutate "panel changes the Room name limit" "$PANEL" \
  "maxLength={60}" "maxLength={40}"
mutate "panel rewords the Add-a-speaker explanation" "$PANEL" \
  "Name the room first, then press the button." \
  "Name the room, then press the button."
mutate "panel drops the master-switch hint" "$PANEL" \
  "The master switch for every speaker." \
  "Turns the speakers on and off."
mutate "core shortens the pairing TTL" "$CORE" \
  "export const PAIRING_TTL_MINUTES = 60;" \
  "export const PAIRING_TTL_MINUTES = 15;"
mutate "core changes the online grace window" "$CORE" \
  "export const DEVICE_ONLINE_GRACE_SECONDS = 90;" \
  "export const DEVICE_ONLINE_GRACE_SECONDS = 120;"
mutate "core renames a device health label" "$CORE" \
  'return "Never connected";' 'return "Never seen";'

echo ""
echo "--- Drift in the MANUAL itself ---"
mutate "manual states the wrong code lifetime" "$DOC" \
  "**It lasts 60 minutes.**" "**It lasts 30 minutes.**"
mutate "manual states the wrong expiry in the error table" "$DOC" \
  "**Codes expire after 60 minutes.**" "**Codes expire after 20 minutes.**"
mutate "manual states the wrong online window" "$DOC" \
  "last **90 seconds**" "last **30 seconds**"
mutate "manual states the wrong Room name limit" "$DOC" \
  "up to 60 characters" "up to 80 characters"
mutate "manual misquotes the journal cap" "$DOC" \
  "Log size capped at 50MB to protect the SD card" \
  "Log size capped at 20MB to protect the SD card"
mutate "manual misquotes the DONE banner" "$DOC" \
  "================ DONE ================" \
  "=============== DONE ==============="
mutate "manual invents a subcommand" "$DOC" \
  "greenway-announcer selftest" "greenway-announcer diagnose"
mutate "manual invents an installer flag" "$DOC" \
  "--audio-device plughw:1,0" "--sound-device plughw:1,0"
mutate "manual points the install at the blocked live domain" "$DOC" \
  "sudo ./install.sh --site https://greenwaywebsite1.vercel.app --code ABCD2345" \
  "sudo ./install.sh --site https://greenwaymarijuana.com --code ABCD2345"
mutate "manual drops the volume-knob advice" "$DOC" \
  "is its volume knob turned up?" "is it configured?"
mutate "manual puts alsamixer before the volume knob" "$DOC" \
  "First the obvious two, because they are the usual answer: **is the speaker
switched on, and is its volume knob turned up?**" \
  "Run \`alsamixer\` first."
mutate "manual drops the exec-bit explanation" "$DOC" \
  "sudo: ./install.sh: command not found" "sudo: install failed"
mutate "manual loses a numbered step" "$DOC" \
  "## Step 11 " "## Step 111 "
mutate "manual points 'go to step' at a step that does not exist" "$DOC" \
  "go to step 9." "go to step 19."
mutate "manual shortens the code example below 8 characters" "$DOC" \
  '`ABCD-2345`' '`ABC-234`'
mutate "manual drops the six sounds column" "$DOC" \
  "  voice  OK" "  vocal  OK"
mutate "manual points at a document that does not exist" "$DOC" \
  "docs/announcer/30-wall-card.md" "docs/announcer/40-nonexistent.md"

restore
echo ""
echo "==============================================="
echo "  caught:   $CAUGHT"
echo "  survived: $SURVIVED"
echo "==============================================="
if [ "$SURVIVED" -ne 0 ]; then
  echo "MUTATION TESTING FAILED: $SURVIVED mutant(s) survived."
  exit 1
fi
echo "MUTATION TESTING PASSED: every mutant was caught."

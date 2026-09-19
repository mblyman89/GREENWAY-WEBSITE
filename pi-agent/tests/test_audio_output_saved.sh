#!/usr/bin/env bash
#
# When `test` finds a working output, it must SAVE it -- not print it and
# forget it.
#
# THE REAL FAILURE THIS COMES FROM
# --------------------------------
# A shop owner's Pi reported everything green. Pairing succeeded, the website
# could see the speaker, the panel showed a green dot. And every order was
# silent.
#
#   sudo greenway-announcer status
#     audio out: (system default)
#
#   sudo greenway-announcer test
#     default output  FAILED - aplay: audio open error: Unknown error 524
#     plughw:1,0     bcm2835 Headphones           WORKS
#     All six sounds played.
#
# The program found the working output, printed "Found a working output", and
# then DISCARDED it -- telling the human to re-run the entire installer to
# apply it. The background service carried on using the broken HDMI default,
# so the speaker stayed silent while every screen said it was fine.
#
# A tool that discovers the fix and refuses to apply it is not diagnosing, it
# is nagging. These tests hold it to actually fixing things.
#
# A fake `aplay` reproduces his exact hardware: the default and HDMI fail with
# error 524, plughw:1,0 works. No real sound card is involved.
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# AGENT_UNDER_TEST lets the mutation harness point this file at a deliberately
# broken COPY of the agent. Some rules here -- notably "save only the address
# you actually proved" -- live in cmd_test(), which the Python selftest never
# executes. Without this hook those rules could be deleted and every mutation
# would still come back green, which is precisely the kind of decorative
# testing this project treats as a defect.
AGENT="${AGENT_UNDER_TEST:-$HERE/../greenway_announcer.py}"
WORK="$(mktemp -d)"
chmod 755 "$WORK"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
pass () { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail () { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

mkdir -p "$WORK/bin"

# --- his exact hardware, faked ---------------------------------------------
# aplay -l output copied from the layout his Pi reports: one bcm2835 card with
# an HDMI output and a Headphones output.
cat > "$WORK/bin/aplay" <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do
  if [ "$a" = "-l" ]; then
    cat <<'LIST'
**** List of PLAYBACK Hardware Devices ****
card 0: vc4hdmi [vc4-hdmi], device 0: MAI PCM i2s-hifi-0 [MAI PCM i2s-hifi-0]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
card 1: Headphones [bcm2835 Headphones], device 0: bcm2835 Headphones [bcm2835 Headphones]
  Subdevices: 8/8
  Subdevice #0: subdevice #0
LIST
    exit 0
  fi
done

# Which device was asked for?
DEV=""
prev=""
for a in "$@"; do
  [ "$prev" = "-D" ] && DEV="$a"
  prev="$a"
done

# No -D means the system default, which on this headless Pi is HDMI: it fails
# exactly the way his did.
if [ -z "$DEV" ] || [ "$DEV" = "plughw:0,0" ] || [ "$DEV" = "plughw:CARD=vc4hdmi,DEV=0" ]; then
  echo "aplay: main:850: audio open error: Unknown error 524" >&2
  exit 1
fi
# Real ALSA accepts BOTH spellings of the same output. The earlier fake only
# accepted the card number, which quietly hid whether the program saved a
# reboot-proof name or a positional one.
if [ "$DEV" = "plughw:1,0" ] || [ "$DEV" = "plughw:CARD=Headphones,DEV=0" ]; then
  # Optionally simulate a card whose stable name cannot be opened, to prove a
  # working output is never rejected just because its preferred spelling fails.
  if [ "${STABLE_NAME_BROKEN:-0}" = "1" ] && [ "$DEV" = "plughw:CARD=Headphones,DEV=0" ]; then
    echo "aplay: audio open error: No such file or directory" >&2
    exit 1
  fi
  exit 0
fi
echo "aplay: device not found" >&2
exit 1
EOF
chmod 755 "$WORK/bin/aplay"

# amixer and systemctl must not do anything real.
cat > "$WORK/bin/amixer" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod 755 "$WORK/bin/amixer"

cat > "$WORK/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "$@" >> "$SYSTEMCTL_LOG"
exit 0
EOF
chmod 755 "$WORK/bin/systemctl"

export SYSTEMCTL_LOG="$WORK/systemctl.log"

CONFIG="$WORK/config.json"
CACHE="$WORK/cache"

write_config () {
  # $1 = the audioDevice value to start from
  cat > "$CONFIG" <<EOF
{
  "siteUrl": "https://greenwaywebsite1.vercel.app",
  "deviceId": "030bfd33-26ea-4c43-8274-4a0d52df4c00",
  "deviceKey": "fake-key-for-testing",
  "deviceName": "Sales Floor",
  "audioDevice": "$1",
  "mixerControl": ""
}
EOF
}

run_agent () {
  PATH="$WORK/bin:$PATH" python3 "$AGENT" --config "$CONFIG" --cache-dir "$CACHE" "$@" \
    >"$WORK/out.txt" 2>&1
  echo $?
}

saved_device () {
  python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('audioDevice',''))" "$CONFIG"
}

echo "1. his exact situation: default is broken, a real output works"
write_config ""
: > "$SYSTEMCTL_LOG"
CODE=$(run_agent test)

if [ "$CODE" = "0" ]; then
  pass "the test still succeeds by finding a working output"
else
  fail "the test failed even though plughw:1,0 works (exit $CODE)"
fi

if grep -q "Headphones" "$WORK/out.txt" && grep -q "WORKS" "$WORK/out.txt"; then
  pass "it reports which output works"
else
  fail "it does not report the working output"
fi

# THE POINT OF THIS WHOLE FILE
if [ "$(saved_device)" = "plughw:CARD=Headphones,DEV=0" ]; then
  pass "the working output was SAVED to the config"
else
  fail "the working output was found and thrown away (config says '$(saved_device)')"
fi

# ...and it must be the REBOOT-PROOF spelling. Saving "plughw:1,0" pins the
# shop to a card position; ALSA hands out those numbers in probe order, so a
# power cut or a replugged dongle can point it at a different device. That is
# a speaker that works for weeks and then goes silent with nothing touched.
case "$(saved_device)" in
  plughw:CARD=*|hw:CARD=*)
    pass "the saved name survives a reboot (CARD= form, not a card number)" ;;
  *)
    fail "the saved name is positional ('$(saved_device)') and will break on reboot" ;;
esac

# The saved address must be one the program actually PLAYED THROUGH. Saving a
# name that was never proven is how a config ends up looking correct and
# working nowhere.
if PATH="$WORK/bin:$PATH" "$WORK/bin/aplay" -D "$(saved_device)" /dev/null 2>/dev/null; then
  pass "the saved output is one that was proven to make a sound"
else
  fail "it saved '$(saved_device)', an address that cannot actually be opened"
fi

if grep -qi "saved" "$WORK/out.txt"; then
  pass "it tells the user the setting was saved"
else
  fail "it saved the setting without saying so"
fi

echo ""
echo "2. saving must take effect immediately, not at the next reboot"
if grep -q "restart greenway-announcer" "$SYSTEMCTL_LOG"; then
  pass "the announcer service was restarted"
else
  fail "the service was not restarted, so the old broken output stays live"
fi

echo ""
echo "3. it must NOT tell the user to re-run the whole installer"
# Re-running the installer to change one setting is a heavy, frightening ask,
# and it is what the old code did instead of just saving the value.
if grep -q "install.sh" "$WORK/out.txt"; then
  fail "it still sends the user back to the installer to apply the fix"
else
  pass "it applies the fix itself instead of sending the user to the installer"
fi

echo ""
echo "3b. a working output is never rejected because of its preferred spelling"
# Preferring the reboot-proof name must not become a NEW way to fail. If the
# CARD= form cannot be opened on some card, the output still works and must
# still be found and saved -- just under the spelling that actually opened.
write_config ""
: > "$SYSTEMCTL_LOG"
CODE=$(STABLE_NAME_BROKEN=1 run_agent test)
if [ "$CODE" = "0" ]; then
  pass "the working output is still found when the CARD= spelling fails"
else
  fail "preferring the stable name made a working output unusable (exit $CODE)"
fi
if [ "$(saved_device)" = "plughw:1,0" ]; then
  pass "it falls back to the spelling that actually opened"
else
  fail "it saved '$(saved_device)', which is not the spelling that worked"
fi

echo ""
echo "4. an already-correct config is left alone"
write_config "plughw:1,0"
: > "$SYSTEMCTL_LOG"
BEFORE="$(md5sum "$CONFIG")"
run_agent test >/dev/null
AFTER="$(md5sum "$CONFIG")"
if [ "$BEFORE" = "$AFTER" ]; then
  pass "no needless rewrite when the output is already right"
else
  fail "it rewrote a config that was already correct"
fi
if [ -s "$SYSTEMCTL_LOG" ]; then
  fail "it restarted the service for no reason"
else
  pass "no needless restart"
fi

echo ""
echo "5. an explicitly requested device does not overwrite the saved one"
# Somebody experimenting with --audio-device is not asking to change the
# permanent setting.
write_config "plughw:1,0"
run_agent test --audio-device plughw:1,0 >/dev/null
if [ "$(saved_device)" = "plughw:1,0" ]; then
  pass "an explicit --audio-device leaves the config as it was"
else
  fail "a one-off experiment overwrote the saved setting"
fi

echo ""
echo "6. use-output sets it directly, without the installer"
write_config ""
: > "$SYSTEMCTL_LOG"
CODE=$(run_agent use-output plughw:1,0)
if [ "$CODE" = "0" ] && [ "$(saved_device)" = "plughw:1,0" ]; then
  pass "use-output saves the chosen output"
else
  fail "use-output did not save the output (exit $CODE, config '$(saved_device)')"
fi
if grep -q "restart greenway-announcer" "$SYSTEMCTL_LOG"; then
  pass "use-output restarts the service so it applies now"
else
  fail "use-output did not restart the service"
fi

echo ""
echo "7. use-output refuses an output this Pi does not have"
write_config "plughw:1,0"
CODE=$(run_agent use-output plughw:9,9)
if [ "$CODE" = "0" ]; then
  fail "it accepted an output that does not exist"
else
  pass "a non-existent output is refused (exit $CODE)"
fi
if grep -q "Headphones" "$WORK/out.txt"; then
  pass "it lists the outputs this Pi actually has"
else
  fail "it refuses without saying what the real options are"
fi
# That list is the next thing a stuck owner will copy. If it offers card
# numbers he pastes one, it works today, and the next power cut renumbers the
# cards and silences the shop -- so the refusal message must recommend the
# reboot-proof spelling too.
if grep -q "plughw:CARD=Headphones,DEV=0" "$WORK/out.txt"; then
  pass "the options it offers are reboot-proof CARD= names"
else
  fail "it offers card numbers that will break on the next reboot"
fi
if [ "$(saved_device)" = "plughw:1,0" ]; then
  pass "the previous good setting was not clobbered"
else
  fail "a rejected value still changed the config"
fi

echo ""
echo "8. use-output accepts the reboot-proof name the tool itself recommends"
# `greenway-announcer audio` prints plughw:CARD=... names and tells the owner
# to use them. If use-output only understood card numbers, the tool would
# reject the exact string it had just handed him -- a dead end with no way out
# except editing JSON as root.
write_config "plughw:1,0"
: > "$SYSTEMCTL_LOG"
CODE=$(run_agent use-output plughw:CARD=Headphones,DEV=0)
if [ "$CODE" = "0" ] && [ "$(saved_device)" = "plughw:CARD=Headphones,DEV=0" ]; then
  pass "the CARD= name the report recommends is accepted and saved"
else
  fail "it rejected its own recommended name (exit $CODE, saved '$(saved_device)')"
fi

# The old numbered spelling must keep working: upgrading must not strand a Pi
# that was configured before stable names existed.
write_config ""
CODE=$(run_agent use-output plughw:1,0)
if [ "$CODE" = "0" ] && [ "$(saved_device)" = "plughw:1,0" ]; then
  pass "the older numbered spelling is still accepted"
else
  fail "upgrading broke the spelling that used to work (exit $CODE)"
fi

# Negative control: widening what we accept must not mean accepting anything.
# Without this, "accept every spelling" could be implemented as "accept all".
write_config "plughw:1,0"
CODE=$(run_agent use-output plughw:CARD=Nonexistent,DEV=0)
if [ "$CODE" = "0" ]; then
  fail "a plausible-looking CARD= name for a missing device was accepted"
else
  pass "a CARD= name for a device this Pi does not have is still refused"
fi
if [ "$(saved_device)" = "plughw:1,0" ]; then
  pass "the good setting survived the rejected CARD= name"
else
  fail "a rejected CARD= name still changed the config"
fi

echo ""
echo "============================================================"
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] && { echo "THE WORKING OUTPUT IS SAVED"; exit 0; }
echo "THE OUTPUT IS STILL BEING THROWN AWAY"
exit 1

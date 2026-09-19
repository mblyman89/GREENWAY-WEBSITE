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

saved_mode () {
  python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('audioMode',''))" "$CONFIG"
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
echo "9. use-output auto stops pinning one socket"
# The owner's words: "make it auto pick, so i can change the dongle if needed,
# or if i decide to use the aux jack for whatever reason." Pinning is right
# until the hardware changes; then the pin names a card that is gone.
write_config "plughw:1,0"
: > "$SYSTEMCTL_LOG"
CODE=$(run_agent use-output auto)
if [ "$CODE" = "0" ]; then
  pass "use-output auto is accepted"
else
  fail "use-output auto was refused (exit $CODE)"
fi
if [ -z "$(saved_device)" ]; then
  pass "the pin was actually cleared from the config"
else
  fail "the pin is still there ('$(saved_device)') after asking for auto"
fi
# Clearing alone is not enough -- see test 10. The INTENT has to be recorded.
if [ "$(saved_mode)" = "auto" ]; then
  pass "auto-pick is recorded as a deliberate choice, not an empty field"
else
  fail "auto was not recorded (audioMode is '$(saved_mode)'), so test will re-pin"
fi
if grep -q "restart greenway-announcer" "$SYSTEMCTL_LOG"; then
  pass "use-output auto restarts the service so it applies now"
else
  fail "use-output auto did not restart the service"
fi
# "It is cleared" is a claim. Showing which socket sound will come out of is
# the proof, and it is the only way to check without walking to the speaker.
if grep -q "3.5 mm jack" "$WORK/out.txt"; then
  pass "it shows which output auto-pick actually lands on"
else
  fail "it cleared the pin without saying what will be used instead"
fi
# ...and the ORDER it will fall back through, which is the actual "both usb
# and aux" promise. Naming only the winner proves nothing about what happens
# when that one is unplugged -- which is the whole reason for going auto.
if grep -q "1. plughw:CARD=Headphones,DEV=0" "$WORK/out.txt" \
   && grep -q "2. plughw:CARD=vc4hdmi,DEV=0" "$WORK/out.txt"; then
  pass "it shows the fallback order auto-pick will work through"
else
  fail "it does not show what auto-pick falls back to if the first output dies"
fi
if grep -q "install.sh" "$WORK/out.txt"; then
  fail "it sends the user back to the installer"
else
  pass "it does not send the user to the installer"
fi

echo ""
echo "10. running test after going auto must NOT silently re-pin"
# THE TRAP AUTO-PICK SETS, AND THE REASON audioMode EXISTS.
# `test` saves the output it proves works -- the fix for a shop that was
# silent while every screen said green. Run it once after switching to auto
# and that same save writes the dongle back into the config, turning auto
# back into pinned. The next dongle swap is then ignored and nothing on any
# screen explains why. Quietly reversing a decision the owner made by hand is
# worse than never having offered the option.
#
# This rule lives in cmd_test(), which the Python selftest never executes, so
# without this check it could be deleted and everything would still be green.
run_agent use-output auto >/dev/null
: > "$SYSTEMCTL_LOG"
run_agent test >/dev/null
if [ -z "$(saved_device)" ]; then
  pass "test left the speaker on auto-pick"
else
  fail "test silently re-pinned the speaker to '$(saved_device)'"
fi
if [ "$(saved_mode)" = "auto" ]; then
  pass "the auto choice survived a test run"
else
  fail "the auto choice was erased by a test run (mode now '$(saved_mode)')"
fi
# NEGATIVE CONTROL. The guard must block 'auto' and nothing else. If it were
# implemented as "never save", it would delete the silent-shop fix that the
# whole top half of this file exists to protect -- and tests 1-3 would still
# pass, because they run against a config written before the guard existed.
write_config ""
python3 - "$CONFIG" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d.pop("audioMode", None)          # a speaker installed before auto existed
json.dump(d, open(p, "w"))
PY
run_agent test >/dev/null
if [ -n "$(saved_device)" ]; then
  pass "a never-configured speaker still gets its working output saved"
else
  fail "the auto guard also killed the silent-shop fix: nothing was saved"
fi

echo ""
echo "11. going auto and back to pinned both work, repeatedly"
# Swapping hardware is not a one-way trip. "or if i decide to use the aux jack
# for whatever reason" means going back must be as easy as leaving.
run_agent use-output auto >/dev/null
CODE=$(run_agent use-output plughw:CARD=Headphones,DEV=0)
if [ "$CODE" = "0" ] && [ "$(saved_device)" = "plughw:CARD=Headphones,DEV=0" ]; then
  pass "pinning again after auto works"
else
  fail "could not pin again after going auto (exit $CODE, '$(saved_device)')"
fi
# A leftover audioMode=auto next to a real device is a self-contradictory
# config. The device wins either way, but a human reading the file is told
# two different things, and the next person to trust the flag writes a bug.
if [ "$(saved_mode)" = "pinned" ]; then
  pass "pinning clears the stale auto flag"
else
  fail "the config now says pinned AND auto (mode '$(saved_mode)')"
fi
run_agent use-output auto >/dev/null
if [ -z "$(saved_device)" ] && [ "$(saved_mode)" = "auto" ]; then
  pass "going back to auto a second time still works"
else
  fail "auto was not idempotent ('$(saved_device)' / '$(saved_mode)')"
fi
# Asking for auto when already auto must be a no-op that still succeeds,
# not an error -- somebody will run it twice to be sure.
CODE=$(run_agent use-output auto)
if [ "$CODE" = "0" ]; then
  pass "asking for auto when already auto succeeds"
else
  fail "running auto twice failed (exit $CODE)"
fi

echo ""
echo "12. the other spellings of auto, and the things that are NOT auto"
for WORD in AUTO clear none default reset best; do
  write_config "plughw:1,0"
  CODE=$(run_agent use-output "$WORD")
  if [ "$CODE" = "0" ] && [ -z "$(saved_device)" ]; then
    pass "'$WORD' is understood as auto-pick"
  else
    fail "'$WORD' was not understood as auto-pick (exit $CODE, '$(saved_device)')"
  fi
done
# NEGATIVE CONTROL. Being generous about what 'auto' means must not turn into
# accepting anything: a typo has to stay an error, or a mistyped device name
# silently unpins the shop's speaker instead of telling anyone.
write_config "plughw:1,0"
CODE=$(run_agent use-output atuo)
if [ "$CODE" = "0" ]; then
  fail "a typo'd 'atuo' was swallowed as auto instead of being refused"
else
  pass "a typo is still refused rather than silently unpinning"
fi
if [ "$(saved_device)" = "plughw:1,0" ]; then
  pass "the typo left the existing setting alone"
else
  fail "a refused typo still changed the config to '$(saved_device)'"
fi

echo ""
echo "13. status reports the three states differently"
# `status` used to print "(system default)" whenever no device was saved. On a
# headless Pi the system default is HDMI and cannot open at all, so that line
# named the one behaviour that produces silence -- on a Pi that was in fact
# picking the right output.
run_agent use-output auto >/dev/null
run_agent status >/dev/null
if grep -q "system default" "$WORK/out.txt"; then
  fail "an auto speaker is still reported as using the system default"
else
  pass "an auto speaker is not mislabelled as the system default"
fi
if grep -qi "automatic" "$WORK/out.txt"; then
  pass "status says the speaker is on automatic"
else
  fail "status does not report that auto-pick is in force"
fi
write_config "plughw:CARD=Headphones,DEV=0"
run_agent status >/dev/null
if grep -q "plughw:CARD=Headphones,DEV=0" "$WORK/out.txt"; then
  pass "status names the device a pinned speaker is pinned to"
else
  fail "status does not show the pinned device"
fi

echo ""
echo "============================================================"
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] && { echo "THE WORKING OUTPUT IS SAVED"; exit 0; }
echo "THE OUTPUT IS STILL BEING THROWN AWAY"
exit 1

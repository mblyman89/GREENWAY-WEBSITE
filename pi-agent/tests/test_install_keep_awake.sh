#!/usr/bin/env bash
#
# "I feel like the pi keeps turning itself off"
#
# THE REAL REPORT THIS COMES FROM
# -------------------------------
# The shop owner said, verbatim:
#
#   "I feel like the pi keeps turning itself off after a little bit of time, is
#    there a way to make it stay on at full power always so it never
#    disconnects or goes into power saving mode or something."
#
# That one sentence covers three different faults with three different fixes,
# and before this work the installer addressed NONE of them. Grepping the whole
# agent and installer for power_save / powersave / consoleblank found nothing.
#
#   1. The Wi-Fi radio dozes between packets. The Pi is running perfectly; the
#      website simply stops hearing from it and marks the speaker offline. This
#      is the one that actually matches "it disconnects".
#   2. The system suspends. Everything stops.
#   3. The screen blanks. Nothing is wrong at all, but a black screen on a Pi
#      is indistinguishable from a Pi that has switched off, and that confusion
#      costs a shop an afternoon.
#
# Step 7 of the installer fixes all three, permanently and on every boot.
#
# WHAT THIS TEST GUARANTEES
# -------------------------
# It reads the installer as text and proves the step is present, correct, and
# durable. It deliberately does NOT execute the installer: doing so would mask
# sleep.target and rewrite NetworkManager configuration on whatever machine the
# suite runs on. A test must never change the machine it runs on.
#
# The state of this machine is snapshotted at the start and compared at the end,
# so if that principle is ever violated, this test says so.
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="$HERE/../install.sh"
AGENT="$HERE/../greenway_announcer.py"

# Snapshot: prove at the end that this test installed nothing.
BEFORE="$(systemctl is-enabled greenway-keep-awake 2>&1; ls -l /usr/local/bin/greenway-keep-awake /etc/NetworkManager/conf.d/99-greenway-no-wifi-powersave.conf 2>&1)"

PASS=0
FAIL=0
pass () { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail () { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

# has <description> <pattern>   -- fixed-string search of the installer
has () {
  if grep -qF -- "$2" "$INSTALLER"; then pass "$1"; else fail "$1 (missing: $2)"; fi
}

echo ""
echo "=== The Pi is told to stay awake ==========================="
echo ""

echo "1. The step exists and is part of the numbered walkthrough"
has "there is a 'keeping this Pi awake' step" 'Step 7 of 8: keeping this Pi awake and online'
has "the installer still ends with the verification step" 'Step 8 of 8: making sure it really is running'

# Every banner must agree on the total, or the installer counts to eight while
# telling the reader it is counting to seven.
TOTAL_MISMATCH="$(grep -oE 'step "Step [0-9] of ([0-9])' "$INSTALLER" | grep -oE '[0-9]$' | sort -u | wc -l)"
if [ "$TOTAL_MISMATCH" -eq 1 ]; then
  pass "every step banner agrees on the total"
else
  fail "step banners disagree about how many steps there are"
fi

STEP_COUNT="$(grep -cE 'step "Step [0-9] of 8:' "$INSTALLER")"
if [ "$STEP_COUNT" -eq 8 ]; then
  pass "there are exactly 8 steps, numbered 1..8"
else
  fail "expected 8 steps, found $STEP_COUNT"
fi

echo ""
echo "2. Wi-Fi power saving is switched off - the 'it disconnects' fault"
has "NetworkManager is configured" '/etc/NetworkManager/conf.d/99-greenway-no-wifi-powersave.conf'
has "power saving is set to 2 (disabled)" 'wifi.powersave = 2'
has "a drop-in is used, so an OS update cannot revert it" 'mkdir -p /etc/NetworkManager/conf.d'
has "the radio is also set directly, for non-NetworkManager setups" 'set power_save off'
has "a helper program is installed" '/usr/local/bin/greenway-keep-awake'
has "it is made executable" 'chmod 755 /usr/local/bin/greenway-keep-awake'

echo ""
echo "3. It survives a reboot - otherwise it fixes nothing by tomorrow"
has "a boot service is installed" '/etc/systemd/system/greenway-keep-awake.service'
has "the service is enabled at boot" 'systemctl enable greenway-keep-awake'
has "it is applied now, not only after a reboot" 'systemctl start greenway-keep-awake'
has "it is wanted by the normal boot target" 'WantedBy=multi-user.target'
has "it runs once and stays satisfied" 'RemainAfterExit=yes'
# Bringing an interface down and up restores the driver default, so the unit
# must be ordered around the network rather than racing it.
has "it is ordered after the network" 'After=network.target'

echo ""
echo "4. The Pi never suspends"
has "sleep, suspend and hibernate are masked" 'systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target'
# Masking, not disabling: a disabled unit can still be started by something
# else deciding the machine looks idle. A masked one cannot be started at all.
if grep -qE 'systemctl +disable +sleep\.target' "$INSTALLER"; then
  fail "sleep is only disabled, not masked - something can still start it"
else
  pass "sleep is masked, not merely disabled"
fi

echo ""
echo "5. The screen does not go black and look like a dead Pi"
has "console blanking is turned off" 'consoleblank'
has "the terminal is told not to blank or power down" 'setterm --blank 0 --powerdown 0'

echo ""
echo "6. Missing optional tools must not fail the install"
# A Pi on ethernet has no wireless interface, and 'iw' may not be installed.
# Neither is a reason to abort an install that is otherwise fine.
has "the 'iw' tool is checked for, not assumed" 'command -v iw >/dev/null 2>&1'
has "its absence is explained, with the fix" "sudo apt install -y iw"
has "NetworkManager's absence is tolerated" '[ -d /etc/NetworkManager ]'

echo ""
echo "7. The owner can tell the two remaining faults apart"
# If the Pi is genuinely losing power, none of the above helps: that is the
# power supply. Uptime is what distinguishes a rebooting Pi from a dozing one.
has "the installer points at status afterwards" 'sudo greenway-announcer status'
has "it explains what a resetting uptime means" 'losing POWER'
if grep -q 'def read_uptime_seconds' "$AGENT" && grep -q 'Up for:' "$AGENT"; then
  pass "status really does report uptime"
else
  fail "status does not report uptime, so the advice above is useless"
fi
if grep -q 'def power_save_state' "$AGENT"; then
  pass "status really does report Wi-Fi power saving"
else
  fail "status does not report Wi-Fi power saving"
fi

echo ""
echo "8. Uninstalling puts the machine back"
# Leaving a service and a masked sleep target behind on a Pi that has been
# uninstalled is rude, and worse, invisible.
has "the keep-awake service is removed on uninstall" 'rm -f /etc/systemd/system/greenway-keep-awake.service'
has "the helper program is removed" 'rm -f /usr/local/bin/greenway-keep-awake'
has "the NetworkManager drop-in is removed" 'rm -f /etc/NetworkManager/conf.d/99-greenway-no-wifi-powersave.conf'
has "the reader is told how to restore sleep" 'systemctl unmask'

echo ""
echo "9. The installer is still valid shell"
if bash -n "$INSTALLER" 2>/dev/null; then
  pass "install.sh parses"
else
  fail "install.sh has a syntax error"
fi

echo ""
echo "10. This test changed nothing on this machine"
AFTER="$(systemctl is-enabled greenway-keep-awake 2>&1; ls -l /usr/local/bin/greenway-keep-awake /etc/NetworkManager/conf.d/99-greenway-no-wifi-powersave.conf 2>&1)"
if [ "$BEFORE" = "$AFTER" ]; then
  pass "nothing was installed, enabled or masked by running this test"
else
  fail "this test modified the machine it ran on"
fi

echo ""
echo "------------------------------------------------------------"
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then
  echo "  THE PI IS TOLD TO STAY AWAKE"
  echo "------------------------------------------------------------"
  exit 0
fi
echo "  SOMETHING IS WRONG - see the FAIL lines above"
echo "------------------------------------------------------------"
exit 1

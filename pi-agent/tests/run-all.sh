#!/usr/bin/env bash
#
# Runs every test for the Pi announcer agent, in order of cost.
#
#   bash pi-agent/tests/run-all.sh          # logic + end-to-end
#   sudo bash pi-agent/tests/run-all.sh --full   # also installs/removes the real service
#
# --full needs root and systemd. It installs the service against a throwaway
# fake website on localhost, kills it, proves it recovers, then removes it.
# It never touches the real site.
#
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
FULL="no"
[ "${1:-}" = "--full" ] && FULL="yes"
FAILED=0

banner () { echo ""; echo "############################################################"; echo "# $1"; echo "############################################################"; }

banner "1/10 Agent self-test (the checks that ship on the Pi)"
python3 "$HERE/../greenway_announcer.py" selftest || FAILED=1

banner "2/10 End-to-end against a real HTTP server"
python3 "$HERE/test_e2e.py" || FAILED=1

banner "3/10 Testing the tests: mutating the pure logic"
bash "$HERE/mutation-selftest.sh" | tail -4
bash "$HERE/mutation-selftest.sh" | grep -q "MUTATION ROUND CLEAN" || FAILED=1

banner "4/10 Testing the tests: mutating end-to-end behaviour"
bash "$HERE/mutation-e2e.sh" | tail -4
bash "$HERE/mutation-e2e.sh" | grep -q "MUTATION ROUND 2 CLEAN" || FAILED=1

banner "5/10 Testing the tests: mutating the gateway/CAPTCHA diagnosis"
bash "$HERE/mutation-announcer-gateway.sh" | tail -5
bash "$HERE/mutation-announcer-gateway.sh" | grep -q "MUTATION TESTING PASSED" || FAILED=1

banner "6/10 Testing the tests: mutating the audio diagnosis and sudo handling"
bash "$HERE/mutation-announcer-audio.sh" | tail -5
bash "$HERE/mutation-announcer-audio.sh" | grep -q "MUTATION TESTING PASSED" || FAILED=1

# Which SOCKET the sound comes out of. A shop bought a USB audio adapter to
# escape the hiss of the Pi's own 3.5 mm jack, and the agent ignored it: the
# saved device was read once at startup and never reconsidered. These mutations
# hold the fix in place -- USB is preferred, the aux jack still works as a
# fallback, and the address survives the cards being renumbered at boot.
banner "6b/10 Testing the tests: mutating USB-vs-aux output selection"
bash "$HERE/mutation-announcer-usb.sh" | tail -5
bash "$HERE/mutation-announcer-usb.sh" | grep -q "MUTATION TESTING PASSED" || FAILED=1

# Step 2 of the installer once hung forever on a real shop's Pi, with no output
# at all. FAST=1 shrinks the installer's own apt timeouts so the same guarantees
# are proven in seconds; the slow, fully-realistic run is:
#   bash pi-agent/tests/test_install_apt_hang.sh
banner "7/10 Installer step 2 never hangs and never goes silent"
FAST=1 bash "$HERE/test_install_apt_hang.sh" | tail -4
FAST=1 bash "$HERE/test_install_apt_hang.sh" | grep -q "STEP 2 IS SAFE" || FAILED=1

# A mistyped --site (the colon after https is easy to miss) must be refused
# instantly, not four steps later after the packages and self-test have run.
banner "8/10 A mistyped website address is caught before anything is done"
bash "$HERE/test_install_site_typo.sh" | tail -4
bash "$HERE/test_install_site_typo.sh" | grep -q "SITE TYPOS ARE CAUGHT EARLY" || FAILED=1

# A real shop ran `test`, watched it find a working output, and stayed silent
# anyway -- because the discovery was printed and then thrown away. The service
# kept using the broken default. Green screens, no sound. This proves the answer
# is SAVED and the service restarted, using a fake aplay that reproduces that
# exact Pi (HDMI default fails with error 524, plughw:1,0 works).
banner "9/10 A working sound output is saved, not just discovered"
bash "$HERE/test_audio_output_saved.sh" | tail -4
bash "$HERE/test_audio_output_saved.sh" | grep -q "THE WORKING OUTPUT IS SAVED" || FAILED=1

# The owner reported the Pi "keeps turning itself off". Nothing in the installer
# or the agent had ever switched off Wi-Fi power saving, suspend, or screen
# blanking -- so a Pi that was working perfectly could still drop off the back
# office and look dead. This proves the installer now switches off all three,
# permanently and on every boot, and tidies up after itself on uninstall.
banner "10/10 The Pi is told to stay awake and never power-save"
bash "$HERE/test_install_keep_awake.sh" | tail -4
bash "$HERE/test_install_keep_awake.sh" | grep -q "THE PI IS TOLD TO STAY AWAKE" || FAILED=1

if [ "$FULL" = "yes" ]; then
  banner "EXTRA  Real installer + real systemd + crash recovery"
  bash "$HERE/test_install_systemd.sh" || FAILED=1
else
  echo ""
  echo "(Skipping the installer test. Run with: sudo bash $0 --full)"
fi

echo ""
echo "============================================================"
if [ $FAILED -eq 0 ]; then
  echo "EVERYTHING PASSED"
else
  echo "SOMETHING FAILED - see the output above"
fi
exit $FAILED

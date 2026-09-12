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

banner "1/7  Agent self-test (the checks that ship on the Pi)"
python3 "$HERE/../greenway_announcer.py" selftest || FAILED=1

banner "2/7  End-to-end against a real HTTP server"
python3 "$HERE/test_e2e.py" || FAILED=1

banner "3/7  Testing the tests: mutating the pure logic"
bash "$HERE/mutation-selftest.sh" | tail -4
bash "$HERE/mutation-selftest.sh" | grep -q "MUTATION ROUND CLEAN" || FAILED=1

banner "4/7  Testing the tests: mutating end-to-end behaviour"
bash "$HERE/mutation-e2e.sh" | tail -4
bash "$HERE/mutation-e2e.sh" | grep -q "MUTATION ROUND 2 CLEAN" || FAILED=1

banner "5/7  Testing the tests: mutating the gateway/CAPTCHA diagnosis"
bash "$HERE/mutation-announcer-gateway.sh" | tail -5
bash "$HERE/mutation-announcer-gateway.sh" | grep -q "MUTATION TESTING PASSED" || FAILED=1

banner "6/7  Testing the tests: mutating the audio diagnosis and sudo handling"
bash "$HERE/mutation-announcer-audio.sh" | tail -5
bash "$HERE/mutation-announcer-audio.sh" | grep -q "MUTATION TESTING PASSED" || FAILED=1

# Step 2 of the installer once hung forever on a real shop's Pi, with no output
# at all. FAST=1 shrinks the installer's own apt timeouts so the same guarantees
# are proven in seconds; the slow, fully-realistic run is:
#   bash pi-agent/tests/test_install_apt_hang.sh
banner "7/7  Installer step 2 never hangs and never goes silent"
FAST=1 bash "$HERE/test_install_apt_hang.sh" | tail -4
FAST=1 bash "$HERE/test_install_apt_hang.sh" | grep -q "STEP 2 IS SAFE" || FAILED=1

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

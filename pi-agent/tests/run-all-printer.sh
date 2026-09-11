#!/usr/bin/env bash
#
# Runs every test for the Pi RECEIPT PRINTER agent, in order of cost.
#
#   bash pi-agent/tests/run-all-printer.sh          # logic + end-to-end + mutations
#   sudo bash pi-agent/tests/run-all-printer.sh --full   # also installs/removes the real service
#
# --full needs root and systemd. It installs the service against a throwaway
# fake website on localhost, kills it seven times, proves it comes back, then
# removes it. It never touches the real site and never needs a real printer.
#
# NOTE ON COST: each mutation harness reboots the thing it is testing once per
# mutation, so stage 3 and 4 take a couple of minutes. Unlike the announcer's
# runner, each harness here is executed ONCE and its output reused -- running a
# mutation round twice just to read its last line doubles the slowest stage.
#
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FULL="no"
[ "${1:-}" = "--full" ] && FULL="yes"
FAILED=0
SUMMARY=()

banner () {
  echo ""
  echo "############################################################"
  echo "# $1"
  echo "############################################################"
}

record () { # record <label> <exit-code>
  if [ "$2" -eq 0 ]; then
    SUMMARY+=("PASS  $1")
  else
    SUMMARY+=("FAIL  $1")
    FAILED=1
  fi
}

banner "1/5  Agent self-test (the 128 checks that ship on the Pi)"
python3 "$HERE/../greenway_printer.py" selftest
record "agent self-test" $?

banner "2/5  End-to-end against a real HTTP server and a real device file"
python3 "$HERE/test_printer_e2e.py"
record "end-to-end" $?

banner "3/5  Testing the tests: mutating the agent (20 ways)"
MUT_LOG="$(mktemp)"
bash "$HERE/mutation-printer.sh" >"$MUT_LOG" 2>&1
MUT_RC=$?
tail -12 "$MUT_LOG"
# Demand the explicit clean verdict, not just exit 0: a harness that dies early
# could exit 0 from a `tail` in a pipeline and look like success.
if [ $MUT_RC -eq 0 ] && grep -q "MUTATION ROUND CLEAN" "$MUT_LOG"; then
  record "agent mutation round" 0
else
  record "agent mutation round" 1
fi
rm -f "$MUT_LOG"

banner "4/5  Testing the tests: mutating the manual and the unit file (20 ways)"
if [ -f "$REPO/scripts/recon/mutation-printer-docs.sh" ] && [ -d "$REPO/node_modules/vitest" ]; then
  DOC_LOG="$(mktemp)"
  bash "$REPO/scripts/recon/mutation-printer-docs.sh" >"$DOC_LOG" 2>&1
  DOC_RC=$?
  tail -8 "$DOC_LOG"
  if [ $DOC_RC -eq 0 ] && grep -q "MUTATION ROUND CLEAN" "$DOC_LOG"; then
    record "docs mutation round" 0
  else
    record "docs mutation round" 1
  fi
  rm -f "$DOC_LOG"
else
  echo "(Skipped: needs the website repo's node_modules. Not required on the Pi.)"
  SUMMARY+=("SKIP  docs mutation round (no node_modules)")
fi

banner "5/5  Real installer + real systemd + crash recovery"
if [ "$FULL" = "yes" ]; then
  bash "$HERE/test_install_printer_systemd.sh"
  record "installer + systemd" $?
else
  echo "(Skipped. Run with: sudo bash $0 --full)"
  SUMMARY+=("SKIP  installer + systemd (needs --full and root)")
fi

echo ""
echo "============================================================"
for line in "${SUMMARY[@]}"; do echo "  $line"; done
echo "============================================================"
if [ $FAILED -eq 0 ]; then
  echo "EVERYTHING PASSED"
else
  echo "SOMETHING FAILED - see the output above"
fi
exit $FAILED

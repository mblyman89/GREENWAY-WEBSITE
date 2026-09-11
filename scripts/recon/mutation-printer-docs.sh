#!/usr/bin/env bash
#
# scripts/recon/mutation-printer-docs.sh
#
# Test the docs-truth tests.
#
# WHY THIS EXISTS
# ---------------
# tests/compliance/printer-docs.test.ts shipped with two assertions that were
# GREEN on a broken premise and RED on correct files:
#
#   * the "[Unit] section" check sliced the file from indexOf("[Unit]") to
#     indexOf("[Service]") -- and a COMMENT saying the key "belongs in [Unit],
#     NOT [Service]" ended the slice early, hiding the directive.
#   * the PrivateDevices check used a plain substring, so the five-line comment
#     explaining why PrivateDevices must never be enabled tripped it.
#
# Worse than the false alarms: after the naive slice, moving
# StartLimitIntervalSec into [Service] (where systemd IGNORES it) would not have
# been caught reliably, because the string was still "somewhere before
# [Service]" depending on comment wording. A test that cannot fail for the
# right reason is decoration.
#
# So this harness breaks the real files, one change at a time, and demands the
# suite go red. Every mutation is reverted afterwards, always, even on Ctrl-C.
#
# Usage: bash scripts/recon/mutation-printer-docs.sh
# Exit 0 only if EVERY mutation was caught.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"

UNIT="pi-agent/systemd/greenway-printer.service"
DOC="docs/printer/05-first-printer-walkthrough.md"
AGENT="pi-agent/greenway_printer.py"
INSTALLER="pi-agent/install-printer.sh"
PUB_AGENT="public/printer/greenway_printer.py"
TEST="tests/compliance/printer-docs.test.ts"

TARGETS=("$UNIT" "$DOC" "$AGENT" "$INSTALLER" "$PUB_AGENT")

BACKUP_DIR="$(mktemp -d)"
restore_all() {
  for f in "${TARGETS[@]}"; do
    if [ -f "$BACKUP_DIR/$(basename "$f")" ]; then
      cp "$BACKUP_DIR/$(basename "$f")" "$ROOT/$f"
    fi
  done
}
cleanup() {
  restore_all
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT INT TERM

for f in "${TARGETS[@]}"; do
  [ -f "$f" ] || { echo "MISSING TARGET: $f"; exit 1; }
  cp "$f" "$BACKUP_DIR/$(basename "$f")"
done

CAUGHT=0
SURVIVED=0
SURVIVOR_NAMES=()

run_suite() {
  npx vitest run "$TEST" >/tmp/mpd-vitest.log 2>&1
  return $?
}

# Baseline: the suite must pass on untouched files, or every "caught" result
# below is meaningless.
echo "--- baseline (untouched files must PASS) ---"
if ! run_suite; then
  echo "BASELINE FAILED -- the suite is red before any mutation."
  sed 's/\x1b\[[0-9;]*m//g' /tmp/mpd-vitest.log | tail -30
  exit 1
fi
echo "baseline PASS"
echo

# mutate <name> <file> <perl-expression>
mutate() {
  local name="$1" file="$2" expr="$3"
  local before after
  before="$(md5sum "$ROOT/$file" | cut -d' ' -f1)"
  perl -0pi -e "$expr" "$ROOT/$file"
  after="$(md5sum "$ROOT/$file" | cut -d' ' -f1)"

  if [ "$before" = "$after" ]; then
    # A mutation that changed nothing proves nothing. Treat as a harness bug.
    echo "  [HARNESS BUG] $name -- no-op mutation, pattern did not match"
    SURVIVED=$((SURVIVED + 1))
    SURVIVOR_NAMES+=("$name (no-op)")
    restore_all
    return
  fi

  if run_suite; then
    echo "  [SURVIVED] $name"
    SURVIVED=$((SURVIVED + 1))
    SURVIVOR_NAMES+=("$name")
  else
    echo "  [caught]   $name"
    CAUGHT=$((CAUGHT + 1))
  fi
  restore_all
}

echo "--- mutations ---"

# ---------------------------------------------------------------- systemd unit
# The exact regression the naive slice could not see: the key is still present,
# still spelled right, but in the section where systemd ignores it.
mutate "start limit moved to [Service] (systemd ignores it there)" "$UNIT" \
  's/StartLimitIntervalSec=0\nStartLimitBurst=0\n//; s/\[Service\]\nType=simple/[Service]\nStartLimitIntervalSec=0\nStartLimitBurst=0\nType=simple/'

mutate "start limit deleted entirely (5 crashes = dead printer)" "$UNIT" \
  's/StartLimitIntervalSec=0\n//'

mutate "start burst deleted" "$UNIT" \
  's/StartLimitBurst=0\n//'

mutate "start limit re-enabled with systemd default" "$UNIT" \
  's/StartLimitIntervalSec=0/StartLimitIntervalSec=10s/'

mutate "Restart=always downgraded to on-failure" "$UNIT" \
  's/^Restart=always$/Restart=on-failure/m'

# PrivateDevices, every spelling systemd accepts as true.
mutate "PrivateDevices=yes added (hides /dev/usb/lp0)" "$UNIT" \
  's/^MemoryMax=256M$/PrivateDevices=yes\nMemoryMax=256M/m'

mutate "PrivateDevices=true added (same effect, different spelling)" "$UNIT" \
  's/^MemoryMax=256M$/PrivateDevices=true\nMemoryMax=256M/m'

mutate "PrivateDevices=1 added (same effect, numeric spelling)" "$UNIT" \
  's/^MemoryMax=256M$/PrivateDevices=1\nMemoryMax=256M/m'

mutate "DevicePolicy=closed added (also masks the printer node)" "$UNIT" \
  's/^MemoryMax=256M$/DevicePolicy=closed\nMemoryMax=256M/m'

mutate "the warning comment about PrivateDevices deleted" "$UNIT" \
  's/# PrivateDevices is deliberately NOT set\./# hardening notes:/'

# -------------------------------------------------------------------- the docs
mutate "manual promises a restart behaviour it no longer has" "$DOC" \
  's/restarts forever/gives up eventually/'

mutate "manual drops the 'no port forwarding' promise" "$DOC" \
  's/no port forwarding/some port forwarding/'

mutate "manual quotes a 401 message the agent never prints" "$DOC" \
  "s/The website refused this Pi's printer token \\(401\\)/The website rejected the token/"

# ------------------------------------------------------------------- the agent
mutate "agent confirms the job BEFORE printing it" "$AGENT" \
  's/ok, detail = self\.print_text\(text\)\n(\s+)/confirm_error = self.confirm_job(token)\n$1ok, detail = self.print_text(text)\n$1/'

mutate "agent loses its oversized-receipt guard" "$AGENT" \
  's/if len\(raw\) > MAX_RECEIPT_BYTES:/if False:/'

mutate "agent loses the accent fold" "$AGENT" \
  's/ascii_fold\(body_text\)/(body_text)/'

mutate "agent loses its log throttle (spams the SD card)" "$AGENT" \
  's/self\.consecutive_failures % 20 == 0/True/'

mutate "agent grows an inbound HTTP listener" "$AGENT" \
  's/^import json$/import json\nfrom http.server import HTTPServer/m'

# ------------------------------------------------- installer + published copy
mutate "installer targets a different service name than the unit" "$INSTALLER" \
  's/SERVICE="greenway-printer"/SERVICE="greenway-receipt"/'

mutate "published agent drifts from the source of truth (D-67)" "$PUB_AGENT" \
  's/^AGENT_VERSION = "1\.0\.0"$/AGENT_VERSION = "9.9.9"/m'

echo
echo "================ RESULT ================"
echo "caught:   $CAUGHT"
echo "survived: $SURVIVED"
if [ "$SURVIVED" -ne 0 ]; then
  echo
  echo "SURVIVORS (the suite did not notice these):"
  for s in "${SURVIVOR_NAMES[@]}"; do echo "  - $s"; done
  echo
  echo "MUTATION ROUND FAILED"
  exit 1
fi
echo "MUTATION ROUND CLEAN"
exit 0

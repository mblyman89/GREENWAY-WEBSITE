#!/usr/bin/env bash
#
# Testing the tests for installer step 2.
#
# The step-2 tests take several minutes because they deliberately wait out real
# timeouts. That cost is only worth paying if the tests would actually FAIL when
# the protection is removed. This breaks each guarantee and demands a failure.
#
# Run directly (not part of run-all.sh, which must stay quick):
#   bash pi-agent/tests/mutation-install-apt.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="$HERE/../install.sh"
BACKUP="$(mktemp)"
cp "$INSTALLER" "$BACKUP"
restore () { cp "$BACKUP" "$INSTALLER"; }
trap 'restore; rm -f "$BACKUP"' EXIT

CAUGHT=0
SURVIVED=0

# FAST=1 shrinks the installer's own apt timeouts (via the GREENWAY_APT_*
# environment variables it honours) so the same guarantees are proven in
# seconds instead of minutes. The slow, fully-realistic run is the default
# when the test is executed on its own.
probe () {
  FAST=1 bash "$HERE/test_install_apt_hang.sh" 2>&1 | tail -40
}

mutate () {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$INSTALLER" "$from" "$to" <<'PY'
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
  # A mutant is caught when the suite stops reporting itself safe. Matching on
  # the overall verdict rather than one message keeps this honest: it cannot
  # pass by accident if a message is reworded.
  if probe | grep -q "STEP 2 IS SAFE"; then
    echo "  SURVIVED: $label"
    SURVIVED=$((SURVIVED + 1))
  else
    echo "  caught:   $label"
    CAUGHT=$((CAUGHT + 1))
  fi
}

echo "baseline: the real installer must pass step 2's tests"
if ! probe | grep -q "STEP 2 IS SAFE"; then
  echo "BASELINE FAILED - fix the installer before trusting these results."
  exit 1
fi
echo "baseline OK"
echo ""

echo "Mutating step 2:"

# 1. Go back to always touching apt, even when nothing is missing. This is
#    exactly the case that left a real shop owner staring at a frozen screen.
#    `if false` is used rather than an undefined variable on purpose: the
#    installer runs under `set -u`, so an unbound variable would abort the
#    script and the mutant would look "caught" for the wrong reason. This way
#    the installer really does take the old apt path, and the tests must be
#    what stops it.
mutate "apt is run even when nothing is missing" \
  'if [ -z "$MISSING" ]; then
  ok "Sound tools and Python libraries are already installed"' \
  'if false; then
  ok "Sound tools and Python libraries are already installed"'

# 2. Remove the timeout from the install -> hangs forever again. This is the
#    exact defect that left a shop owner watching a frozen "Step 2 of 7".
mutate "install timeout removed" \
  'if timeout "$APT_INSTALL_TIMEOUT" apt-get $APT_LOCK_OPTS install' \
  'if apt-get $APT_LOCK_OPTS install'

# 2b. Remove the timeout from the refresh, which is where his Pi actually hung:
#     his output never reached the "Installing:" line.
mutate "update timeout removed" \
  'if timeout "$APT_UPDATE_TIMEOUT" apt-get $APT_LOCK_OPTS update' \
  'if apt-get $APT_LOCK_OPTS update'

# 3. Silence apt's error output again.
mutate "apt errors hidden from the user" \
  '      tail -5 "$APT_LOG" >&2' \
  '      true'

# 4. Drop the command that lets somebody reproduce the failure by hand.
mutate "no command given to reproduce the error" \
  "Try 'sudo apt-get install -y\$MISSING' to see the full error." \
  "Installation failed."

# 5. Stop saying what is about to be installed.
mutate "packages no longer named before installing" \
  'echo "  Need to install:$MISSING"' \
  'true'

# 6. Stop announcing the refresh -> silent wait returns.
mutate "silent refresh (no message before the wait)" \
  'echo "  Refreshing the software list (up to 2 minutes)..."' \
  'true'

# 7. Remove the success message.
mutate "success message removed" \
  'ok "Sound tools and Python libraries are ready"' \
  'true'

echo ""
echo "============================================================"
echo "caught: $CAUGHT    survived: $SURVIVED"
if [ "$SURVIVED" -eq 0 ]; then
  echo "MUTATION TESTING PASSED - every broken version was caught."
  exit 0
fi
echo "MUTATION TESTING FAILED - $SURVIVED mutant(s) slipped through."
exit 1

#!/usr/bin/env bash
#
# Step 2 of the installer must never hang forever, and must never go silent.
#
# THE REAL FAILURE THIS COMES FROM
# --------------------------------
# A shop owner ran the installer and it printed:
#
#     ==> Step 2 of 7: installing the pieces it needs
#
# ...and then nothing at all, for a very long time. There was no way to tell
# whether it was working, stuck, or dead.
#
# The cause: Raspberry Pi OS runs apt-daily in the background, which holds the
# same apt lock. `apt-get update` then waits for it -- with no timeout, and
# with its output sent to /dev/null so the waiting was invisible.
#
# These tests use a fake apt-get on PATH, so they prove the behaviour without
# touching the real package system.
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="$HERE/../install.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
pass () { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail () { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

# --- a fake apt-get whose behaviour we control ------------------------------
# HANG_SECONDS: how long `update` and `install` pretend to be stuck.
make_fake_apt () {
  local hang="$1" install_result="${2:-0}"
  mkdir -p "$WORK/bin"
  cat > "$WORK/bin/apt-get" <<EOF
#!/usr/bin/env bash
# Support the capability probe the installer does: apt-get -o ... --version
for a in "\$@"; do
  [ "\$a" = "--version" ] && { echo "apt 2.6.1 (fake)"; exit 0; }
done
for a in "\$@"; do
  if [ "\$a" = "update" ]; then sleep $hang; exit 0; fi
  if [ "\$a" = "install" ]; then
    sleep $hang
    echo "E: fake apt failure" >&2
    exit $install_result
  fi
done
exit 0
EOF
  chmod 755 "$WORK/bin/apt-get"

  # dpkg -s must report the packages MISSING, otherwise step 2 skips apt
  # entirely and the test proves nothing.
  cat > "$WORK/bin/dpkg" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  chmod 755 "$WORK/bin/dpkg"
}

# Run only step 2 by stopping the installer right after it: we point --site at
# nothing and let it fail later; we only read the step-2 output.
run_step2 () {
  local timeout_s="$1"
  # Optional 2nd/3rd args shrink the installer's own apt timeouts so the
  # timeout path can be exercised in seconds rather than minutes.
  local upd="${2:-}" ins="${3:-}"
  cd "$WORK"
  timeout "$timeout_s" env PATH="$WORK/bin:$PATH" \
    ${upd:+GREENWAY_APT_UPDATE_TIMEOUT="$upd"} \
    ${ins:+GREENWAY_APT_INSTALL_TIMEOUT="$ins"} \
    bash "$INSTALLER" --site https://example.invalid >"$WORK/out.txt" 2>&1
  echo $?
}

# The hang test waits out the installer's real timeouts, so it takes about
# seven minutes. FAST=1 skips it for the quick checks, which is what the
# mutation harness uses; the full run is the default.
FAST="${FAST:-0}"

if [ "$FAST" = "1" ]; then
  echo "1. apt hanging must NOT hang the installer forever (fast variant)"
  # Same guarantee, with the installer's own timeouts shrunk to 2s/3s: apt
  # hangs for 600s, so only a working cap can bring this back quickly.
  make_fake_apt 600 0
  START=$(date +%s)
  CODE=$(run_step2 60 2 3)
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$CODE" = "124" ]; then
    fail "the installer itself had to be killed - step 2 still hangs forever"
  else
    pass "step 2 gave up on its own instead of hanging (exit $CODE, ${ELAPSED}s)"
  fi
else
  echo "1. apt hanging must NOT hang the installer forever"
  # 600s of fake hanging, but the installer caps update at 120s and install at
  # 300s. If the cap works it returns well before our 500s outer limit.
  make_fake_apt 600 0
  START=$(date +%s)
  CODE=$(run_step2 500)
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$CODE" = "124" ]; then
    fail "the installer itself had to be killed - step 2 still hangs forever"
  else
    pass "step 2 gave up on its own instead of hanging (exit $CODE, ${ELAPSED}s)"
  fi
fi

echo ""
echo "2. it must SAY it is waiting, not go silent"
if grep -q "Refreshing the software list" "$WORK/out.txt"; then
  pass "it announces the refresh before waiting"
else
  fail "no message before the long wait - the user sees a frozen screen"
fi
if grep -qE "up to [0-9]+ (minute|minutes)" "$WORK/out.txt"; then
  pass "it states how long it is willing to wait"
else
  fail "it never says how long the wait might be"
fi
if grep -q "Need to install:" "$WORK/out.txt"; then
  pass "it names the packages before installing them"
else
  fail "it does not say what it is installing"
fi

echo ""
echo "3. when apt times out it must explain WHY and what to do"
if grep -q "background updater" "$WORK/out.txt"; then
  pass "it names the real cause (the Pi's own background updater)"
else
  fail "it does not explain why apt stalled"
fi
if grep -q "safe to re-run" "$WORK/out.txt"; then
  pass "it says the installer can simply be run again"
else
  fail "it does not tell the user what to do next"
fi

echo ""
echo "4. a fast apt must not be slowed down or made noisy"
make_fake_apt 0 0
START=$(date +%s)
run_step2 120 >/dev/null
ELAPSED=$(( $(date +%s) - START ))
if [ "$ELAPSED" -le 30 ]; then
  pass "a healthy apt still finishes promptly (${ELAPSED}s)"
else
  fail "the new waiting logic slowed down the normal case (${ELAPSED}s)"
fi
if grep -q "Sound tools and Python libraries are ready" "$WORK/out.txt"; then
  pass "it still reports success normally"
else
  fail "the success message disappeared"
fi

echo ""
echo "5. nothing missing => apt is not touched at all"
# This is the case Michael is actually in: he already installed successfully
# once, so the packages are present and there is no reason to wait on apt.
make_fake_apt 600 0
cat > "$WORK/bin/dpkg" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod 755 "$WORK/bin/dpkg"
START=$(date +%s)
run_step2 120 >/dev/null
ELAPSED=$(( $(date +%s) - START ))
if [ "$ELAPSED" -le 30 ]; then
  pass "already-installed packages skip apt entirely (${ELAPSED}s)"
else
  fail "it still waited on apt with nothing to install (${ELAPSED}s)"
fi
if grep -q "already installed" "$WORK/out.txt"; then
  pass "it says everything was already there"
else
  fail "it does not report the already-installed case"
fi

echo ""
echo "6. a genuine apt failure must show apt's own error"
make_fake_apt 0 100
cat > "$WORK/bin/dpkg" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod 755 "$WORK/bin/dpkg"
run_step2 120 >/dev/null
if grep -q "E: fake apt failure" "$WORK/out.txt"; then
  pass "apt's real error is shown, not swallowed"
else
  fail "apt's error was hidden - the user cannot tell what went wrong"
fi
if grep -q "to see the full error" "$WORK/out.txt"; then
  pass "it gives a command to reproduce the error by hand"
else
  fail "no way for the user to dig further"
fi

echo ""
echo "============================================================"
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] && { echo "STEP 2 IS SAFE"; exit 0; }
echo "STEP 2 HAS PROBLEMS"
exit 1

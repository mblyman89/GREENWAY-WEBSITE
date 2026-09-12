#!/usr/bin/env bash
#
# A mistyped --site must be caught INSTANTLY, before the pairing code is spent.
#
# THE REAL FAILURE THIS COMES FROM
# --------------------------------
# A shop owner deleted his speaker in the back office, generated a fresh pairing
# code, and was about to run:
#
#     sudo ./install.sh --site https//greenwaywebsite1.vercel.app --code 28C6P3UU
#
# The colon after "https" is missing. The eye reads the word "https" and moves
# straight past it.
#
# Why that wastes his time: he runs the installer from a git clone, so step 3
# uses the LOCAL copy of the agent and never downloads anything. The bad address
# therefore survives all the way to step 5 (pairing) -- after the package step,
# the install step and the self-test have all run.
#
# VERIFIED, so that this file does not overstate the harm: with a missing colon
# the HTTP request never leaves the Pi (requests raises MissingSchema, and the
# single-slash form raises InvalidURL "No host supplied"). The pairing code is
# therefore NOT consumed. What is lost is time -- and pairing codes expire after
# 60 minutes, so burning minutes on a typo can still cost him the code.
#
# The address is known to be wrong the moment it is typed. There is no excuse
# for discovering it four steps later.
#
# These tests never touch the network: the installer must reject the address
# before it tries to use it.
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="$HERE/../install.sh"
WORK="$(mktemp -d)"
# mktemp -d creates mode 700. The installer is deliberately run unprivileged
# below, so the unprivileged user must be able to enter this directory and
# write the captured output.
chmod 755 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# Snapshot the installed state up front, so section 5 can prove this test did
# not change the machine it is running on.
BEFORE="$(ls -l --time-style=+%s /usr/local/bin/greenway-announcer /etc/systemd/system/greenway-announcer.service 2>/dev/null | md5sum)"

PASS=0
FAIL=0
pass () { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail () { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

# Run the installer with a given --site and capture everything it says.
# We are not root in every environment, and we do not want the network touched,
# so we only care about output produced before anything real happens.
# Always run UNPRIVILEGED. The address check runs before the root check, so the
# typo message still appears exactly as it would for a real user -- but if the
# address check were ever bypassed (which is precisely what the mutation harness
# does) the installer stops at "needs to run as root" instead of installing
# itself on whatever machine the suite happens to be running on. A test must not
# be able to change the machine it runs on, even when it is testing a mutant.
# NOTE: `timeout` is an external program, so it cannot run a shell function.
# The timeout therefore lives inside this helper, not in front of it.
as_unprivileged () {
  if command -v setpriv >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
    timeout 60 setpriv --reuid=65534 --regid=65534 --clear-groups "$@"
  else
    timeout 60 "$@"
  fi
}

run_site () {
  local site="$1"
  cd "$WORK"
  as_unprivileged bash "$INSTALLER" --site "$site" --code 28C6P3UU \
    >"$WORK/out.txt" 2>&1
  echo $?
}

echo "1. the exact address he was about to run must be rejected"
CODE=$(run_site "https//greenwaywebsite1.vercel.app")
if [ "$CODE" = "0" ]; then
  fail "the installer accepted an address with no ':' after https"
else
  pass "it refused to continue (exit $CODE)"
fi

if grep -q "https//greenwaywebsite1.vercel.app" "$WORK/out.txt"; then
  pass "it quotes back exactly what was typed"
else
  fail "it does not show the address that was typed, so the typo stays invisible"
fi

if grep -q "You want:   https://greenwaywebsite1.vercel.app$" "$WORK/out.txt"; then
  pass "it shows the corrected address, ready to copy"
else
  fail "it does not show the fixed address - the user has to work it out"
fi
# Naming the ACTUAL fault is the point. A generic "does not look like a web
# address" would stop him, but would not tell him that one character is
# missing -- which is exactly the thing he cannot see.
if grep -q "missing the ':' after 'https'" "$WORK/out.txt"; then
  pass "it names the exact fault (the missing colon)"
else
  fail "it does not say WHAT is wrong, only that something is"
fi

echo ""
echo "2. it must be caught BEFORE anything else is done"
# Reaching step 5 means the whole install ran before the address was checked.
if grep -q "Step 5 of 7" "$WORK/out.txt"; then
  fail "it ran all the way to pairing before noticing the address was wrong"
else
  pass "it never reached pairing, so no time was wasted"
fi
if grep -q "Step 2 of 7" "$WORK/out.txt"; then
  fail "it started installing packages before checking the address"
else
  pass "it stopped before touching the package system"
fi

echo ""
echo "3. the single-slash form must be caught too"
CODE=$(run_site "https:/greenwaywebsite1.vercel.app")
if [ "$CODE" = "0" ]; then
  fail "an address with one slash was accepted"
else
  pass "https:/ (one slash) is rejected (exit $CODE)"
fi
if grep -q "You want:   https://greenwaywebsite1.vercel.app$" "$WORK/out.txt"; then
  pass "it offers the corrected address for the one-slash case"
else
  fail "no correction offered for the one-slash case"
fi
if grep -q "only one '/' after 'https:'" "$WORK/out.txt"; then
  pass "it names the exact fault (one slash instead of two)"
else
  fail "it does not say what is wrong with the one-slash form"
fi

echo ""
echo "4. an address with no scheme at all must be caught"
CODE=$(run_site "greenwaywebsite1.vercel.app")
if [ "$CODE" = "0" ]; then
  fail "a bare domain with no https:// was accepted"
else
  pass "a bare domain is rejected (exit $CODE)"
fi
# Complaining is not the same as stopping. If the address check only warned, the
# installer would carry on and fail later for an unrelated reason -- so require
# that it stopped AT the address, before the root check that follows it.
if grep -q "needs to run as root" "$WORK/out.txt"; then
  fail "it complained about the address but carried on anyway"
else
  pass "it stopped at the address instead of merely warning"
fi
if grep -q "https://greenwaywebsite1.vercel.app" "$WORK/out.txt"; then
  pass "it suggests the https:// form"
else
  fail "it does not suggest how to fix a bare domain"
fi
if grep -q "does not look like a web address" "$WORK/out.txt"; then
  pass "it says plainly that the address is not usable"
else
  fail "it does not explain why a bare domain was refused"
fi

echo ""
echo "5. a CORRECT address must NOT be rejected"
# The guard against over-eager validation: the fix must not break the command
# that actually works.
#
# These runs must NOT perform a real install. Running the installer as root with
# a good address would install the service on whatever machine the suite runs
# on, which is an unacceptable side effect for a test. So the address check is
# exercised in isolation: run the installer with --site but WITHOUT --code as a
# non-root user, so it stops at the root check immediately after the address
# check. If the address were rejected we would see the typo complaint instead.
check_accepted () {
  local site="$1" label="$2"
  cd "$WORK"
  as_unprivileged bash "$INSTALLER" --site "$site" >"$WORK/out.txt" 2>&1
  if grep -qi "does not look like a web address\|missing the\|only one" "$WORK/out.txt"; then
    fail "$label"
    return
  fi
  # Prove it got PAST the address check rather than failing before it.
  if grep -q "needs to run as root" "$WORK/out.txt"; then
    pass "$label"
  else
    fail "$label (did not reach the root check - it stopped somewhere unexpected)"
  fi
}

check_accepted "https://greenwaywebsite1.vercel.app" \
  "a correct https:// address is accepted"
check_accepted "http://192.168.1.50:3000" \
  "plain http:// with a port is accepted (local testing still works)"
check_accepted "https://greenwaywebsite1.vercel.app/" \
  "a trailing slash is accepted"

# Nothing above may have installed anything. Compared against a snapshot taken
# at the very start, so a pre-existing install on the machine is not blamed on
# this test -- only a change caused by it.
AFTER="$(ls -l --time-style=+%s /usr/local/bin/greenway-announcer /etc/systemd/system/greenway-announcer.service 2>/dev/null | md5sum)"
if [ "$AFTER" = "$BEFORE" ]; then
  pass "no real install happened while testing"
else
  fail "the test changed the announcer install on this machine - tests must not do that"
fi

echo ""
echo "============================================================"
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] && { echo "SITE TYPOS ARE CAUGHT EARLY"; exit 0; }
echo "SITE TYPO CHECK HAS PROBLEMS"
exit 1

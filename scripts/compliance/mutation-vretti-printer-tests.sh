#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Mutation probe for tests/compliance/vretti-printer.test.ts
#
# The rule is "test it, test the tests". A green suite is worthless until you
# have watched it go red for the RIGHT reason, so this script reintroduces --
# one at a time -- the exact defects the owner hit on his own Pi, and asserts
# the suite notices. A mutant that SURVIVES is a hole in the tests.
#
# Mutate the subject, never the judge: only the source files are touched, the
# test file is restored byte-for-byte, and every original is put back even if
# the run is interrupted.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

TEST="tests/compliance/vretti-printer.test.ts"
CORE="src/lib/printing/vretti-setup-core.ts"
SH="pi-agent/install-printer.sh"

TMP="$(mktemp -d)"
cp "$CORE" "$TMP/core.orig"
cp "$SH" "$TMP/sh.orig"
cp "$TEST" "$TMP/test.orig"

restore() {
  cp "$TMP/core.orig" "$CORE"
  cp "$TMP/sh.orig" "$SH"
  cp "$TMP/test.orig" "$TEST"
}
trap 'restore; rm -rf "$TMP"' EXIT

KILLED=0; SURVIVED=0; TOTAL=0

# run_mutant <name> <file> <perl-expr>
run_mutant() {
  local name="$1" file="$2" expr="$3"
  TOTAL=$((TOTAL + 1))
  restore
  perl -0777 -pi -e "$expr" "$file"

  # A mutant that changed nothing tests nothing -- that is a BROKEN HARNESS,
  # not a passing result, so fail loudly instead of reporting a false kill.
  local orig
  case "$file" in
    "$CORE") orig="$TMP/core.orig" ;;
    "$SH")   orig="$TMP/sh.orig" ;;
  esac
  if cmp -s "$file" "$orig"; then
    printf '  \033[31mHARNESS BROKEN\033[0m  %s (pattern matched nothing)\n' "$name"
    restore
    exit 2
  fi

  if npx vitest run "$TEST" >/dev/null 2>&1; then
    printf '  \033[31mSURVIVED\033[0m  %s\n' "$name"
    SURVIVED=$((SURVIVED + 1))
  else
    printf '  \033[32mkilled\033[0m    %s\n' "$name"
    KILLED=$((KILLED + 1))
  fi
  restore
}

echo "Mutating the setup guide and the installer..."

# --- Defect 1: the factory-default login that is not his Pi ----------------
run_mutant "Pi addressed as the factory default pi@raspberrypi" "$CORE" \
  's{DEFAULT_PI_USER = "greenway-office"}{DEFAULT_PI_USER = "pi"};
   s{DEFAULT_PI_HOST = "greenway-office\.local"}{DEFAULT_PI_HOST = "raspberrypi.local"}'

# --- Defect 2: back to piping a download into a root shell -----------------
run_mutant "install reverts to curl-pipe-bash" "$CORE" \
  's{sudo \./install-printer\.sh}{curl -fsSL \${siteForCommands}/printer/install-printer.sh | sudo bash -s --}'

# --- The "which folder am I in" question: drop the cd entirely -------------
run_mutant "the cd-into-the-folder step disappears" "$CORE" \
  's{\`cd \$\{agentDir\}\`}{`cd /`}'

# --- `~` under sudo is root's home, not the Pi user's ----------------------
run_mutant "absolute clone path becomes a tilde path" "$CORE" \
  's{/home/greenway-office/GREENWAY-WEBSITE}{~/GREENWAY-WEBSITE}'

# --- Defect 4: the update section that answers "how do I make it stick" ----
run_mutant "update section stops re-running install.sh" "$CORE" \
  's{sudo \./install\.sh --site}{echo skip --site}'

run_mutant "update section stops proving keep-awake is enabled" "$CORE" \
  's{systemctl is-enabled greenway-keep-awake}{systemctl is-enabled greenway-printer}'

run_mutant "update section stops installing the iw dependency" "$CORE" \
  's{sudo apt install -y iw}{sudo apt update}'

# --- Re-running WITH --code would re-pair and break the existing setup -----
run_mutant "update re-runs install.sh with --code" "$CORE" \
  's{(sudo \./install\.sh --site \$\{siteForCommands\})}{$1 --code 123456}'

# --- A step silently loses its troubleshooting ------------------------------
#
# Mutate a real STEP OBJECT, not the interface. Renaming the field on the
# `interface` at the top of the file only changes a compile-time type, and
# Vitest does not typecheck, so every step still carries the property at
# runtime and the mutant is invisible by construction. Skip the declaration
# (`ifItGoesWrong: string | null;`) and hit the first step that actually
# supplies the text.
run_mutant "a command step loses its if-it-goes-wrong safety net" "$CORE" \
  's{ifItGoesWrong:(?!\s*string)}{ifItGoesWrong_disabled:}'

# The sibling field, so a step cannot quietly stop saying what success is.
run_mutant "a command step loses its expected-result line" "$CORE" \
  's{\n(\s*)expect:(?!\s*string)}{\n$1expect_disabled:}'

# --- Defect 3: the malformed-URL guard the printer installer lacked --------
run_mutant "installer drops the missing-colon guard" "$SH" \
  's{    https//\*\|http//\*\)}{    __never_matches__)}'

run_mutant "installer guard runs AFTER the download instead of before" "$SH" \
  's{^([ \t]*)DL_URL=}{$1DL_URL=}m; s{is missing the .:. after}{is missing the colon after}'

echo
echo "-----------------------------------------------------------"
printf 'mutants: %d   killed: %d   survived: %d\n' "$TOTAL" "$KILLED" "$SURVIVED"
if [ "$SURVIVED" -ne 0 ]; then
  echo "RESULT: FAILED -- the tests did not notice a real regression."
  exit 1
fi
echo "RESULT: every mutant was caught."

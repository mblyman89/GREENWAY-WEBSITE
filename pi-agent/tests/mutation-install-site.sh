#!/usr/bin/env bash
#
# Testing the tests for the --site typo check.
#
# A validation check is worthless if the tests around it would still pass after
# the check is removed or weakened. This breaks the guard in each plausible way
# and demands that test_install_site_typo.sh notices.
#
# Run directly:
#   bash pi-agent/tests/mutation-install-site.sh
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

probe () {
  bash "$HERE/test_install_site_typo.sh" 2>&1 | tail -30
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
  # Caught means the suite stops declaring itself safe. Judging on the overall
  # verdict rather than one phrase keeps this honest if wording changes.
  if probe | grep -q "SITE TYPOS ARE CAUGHT EARLY"; then
    echo "  SURVIVED: $label"
    SURVIVED=$((SURVIVED + 1))
  else
    echo "  caught:   $label"
    CAUGHT=$((CAUGHT + 1))
  fi
}

echo "baseline: the real installer must pass the site-typo tests"
if ! probe | grep -q "SITE TYPOS ARE CAUGHT EARLY"; then
  echo "BASELINE FAILED - fix the installer before trusting these results."
  exit 1
fi
echo "baseline OK"
echo ""

echo "Mutating the --site check:"

# 1. Remove the check entirely -> back to discovering the typo at step 5.
mutate "the whole site check is removed" \
  'if [ -n "$SITE" ]; then
  case "$SITE" in' \
  'if false; then
  case "$SITE" in'

# 2. Accept the missing-colon form, which is the exact thing he nearly ran.
mutate "missing colon accepted" \
  '    https//*|http//*)' \
  '    __never_matches_https_slashslash__)'

# 3. Accept the single-slash form.
mutate "single slash accepted" \
  '    https:/*|http:/*)' \
  '    __never_matches_single_slash__)'

# 4. Accept anything that is not recognised, instead of refusing.
mutate "unrecognised addresses waved through" \
  "      die \"'\$SITE' does not look like a web address." \
  "      warn \"'\$SITE' does not look like a web address."

# 5. Stop quoting back what was typed -> the typo stays invisible.
mutate "typed address no longer shown" \
  '  You typed:  $SITE
  You want:   ${SCHEME}://${SITE#*//}' \
  '  Something is wrong with the address.'

# 6. Stop showing the corrected address.
mutate "correction no longer offered" \
  '  You want:   ${SCHEME}://${SITE#*//}' \
  '  Fix it.'

# 7. Move the check AFTER the install work, so it is found too late. This is
#    the defect in its original form: correct logic, useless position.
mutate "check happens too late (after step 2)" \
  'if [ -n "$SITE" ]; then
  case "$SITE" in
    https://?*|http://?*)' \
  'if [ -n "${SITE_CHECK_DISABLED:-}" ]; then
  case "$SITE" in
    https://?*|http://?*)'

# 8. Break the good-address case: reject everything. The suite must catch an
#    over-eager guard just as fast as a missing one.
mutate "valid https:// addresses also rejected" \
  '    https://?*|http://?*)
      : ;;' \
  '    __no_address_is_ever_valid__)
      : ;;'

echo ""
echo "============================================================"
echo "caught: $CAUGHT    survived: $SURVIVED"
if [ "$SURVIVED" -eq 0 ]; then
  echo "MUTATION TESTING PASSED - every broken version was caught."
  exit 0
fi
echo "MUTATION TESTING FAILED - $SURVIVED mutant(s) slipped through."
exit 1

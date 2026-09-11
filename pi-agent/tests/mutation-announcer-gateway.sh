#!/usr/bin/env bash
#
# Mutation harness for the announcer's gateway/CAPTCHA diagnosis.
#
# A test that cannot fail is not a test. This deliberately breaks each new
# behaviour in greenway_announcer.py and demands that the agent's own selftest
# notices. A surviving mutant means the selftest is decoration.
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$HERE/../greenway_announcer.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CAUGHT=0
SURVIVED=0

# Baseline: the real file must pass, otherwise every result below is noise.
if ! python3 "$AGENT" selftest >/dev/null 2>&1; then
  echo "BASELINE FAILED: the real agent does not pass its own selftest."
  exit 1
fi
echo "baseline OK - the unmutated agent passes"
echo ""

mutate () {
  local label="$1" from="$2" to="$3"
  local target="$WORK/mutant.py"
  cp "$AGENT" "$target"
  if ! python3 - "$target" "$from" "$to" <<'PY'
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
  if python3 "$target" selftest >/dev/null 2>&1; then
    echo "  SURVIVED: $label"
    SURVIVED=$((SURVIVED + 1))
  else
    echo "  caught:   $label"
    CAUGHT=$((CAUGHT + 1))
  fi
}

echo "Mutating the gateway diagnosis:"
# 1. Drop 202 from the gateway branch -> back to "Unexpected response (202)".
mutate "202 removed from the gateway status list" \
  "if status in (202, 302, 303, 307, 308):" \
  "if status in (302, 303, 307, 308):"
# 2. Stop naming the gateway.
mutate "gateway message no longer says 'gateway'" \
  "gateway or CAPTCHA, which blocks automated requests before they reach" \
  "problem, which blocks automated requests before they reach"
# 3. Stop naming CAPTCHA in the dedicated gateway branch only.
mutate "gateway message no longer says 'CAPTCHA'" \
  "gateway or CAPTCHA, which blocks" \
  "gateway, which blocks"
# 4. Reintroduce the unhelpful wording.
mutate "gateway message reverts to 'Unexpected'" \
  "The website answered {status} instead of handling the speaker request. " \
  "Unexpected response from the website ({status}). "
# 5. Break the generic 2xx branch.
mutate "2xx branch no longer says 'could not use'" \
  "which the speaker could not use" \
  "which the speaker ignored"

echo ""
echo "Mutating the HTML/CAPTCHA sniffer:"
# 6. Miss the <html marker.
mutate "sniffer forgets the '<html' marker" \
  '("<html", "<!doctype html", "sgcaptcha", "<meta")' \
  '("<!doctype html", "sgcaptcha", "<meta")'
# 7. Miss the sgcaptcha marker.
mutate "sniffer forgets the 'sgcaptcha' marker" \
  '("<html", "<!doctype html", "sgcaptcha", "<meta")' \
  '("<html", "<!doctype html", "<meta")'
# 8. Flag everything as HTML, including real JSON.
mutate "sniffer says every body is HTML" \
  "return any(marker in head for marker in" \
  "return True or any(marker in head for marker in"
# 9. Only look at the first byte, so a real page slips through.
mutate "sniffer only inspects 1 character" \
  '(text or "")[:400].lower()' \
  '(text or "")[:1].lower()'

echo ""
echo "Mutating the site-address typo hint:"
# 10. Stop detecting the missing colon.
mutate "typo hint ignores 'https//host'" \
  'if lower.startswith(scheme + "//"):' \
  'if False and lower.startswith(scheme + "//"):'
# 11. Stop detecting the single slash.
mutate "typo hint ignores 'https:/host'" \
  'if lower.startswith(scheme + ":/") and not lower.startswith(scheme + "://"):' \
  'if False:'
# 12. Stop showing the corrected address.
mutate "typo hint no longer prints the fix" \
  'You want:\n  {fixed}' \
  'Check the address.'
# 13. Nag about a perfectly good address.
mutate "typo hint fires on a correct address" \
  "    if not isinstance(raw, str):
        return \"\"
    shown = raw.strip()
    if not shown:
        return \"\"" \
  "    if not isinstance(raw, str):
        return \"\"
    shown = raw.strip()
    if not shown:
        return \"\"
    return \"\\nYou typed:  \" + shown + \" missing something\""
# 14. Stop quoting the input back.
mutate "typo hint stops quoting what was typed" \
  'You typed:  {shown}' \
  'A website address'

echo ""
echo "==============================================="
echo "  caught:   $CAUGHT"
echo "  survived: $SURVIVED"
echo "==============================================="
if [ "$SURVIVED" -ne 0 ]; then
  echo "MUTATION TESTING FAILED: $SURVIVED mutant(s) survived."
  exit 1
fi
echo "MUTATION TESTING PASSED: every mutant was caught."

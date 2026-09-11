#!/usr/bin/env bash
#
# mutation-printer.sh — "test the tests" for the receipt printer agent.
#
# A green test suite proves the tests RAN. It does not prove they would NOTICE
# if the agent broke. This harness deliberately breaks greenway_printer.py one
# change at a time and demands that the suite go RED for every single one. A
# mutation the suite still passes is a SURVIVOR: a hole in the tests.
#
# The mutations are the realistic regressions for a receipt printer:
# confirming a job that never printed (lost receipts), skipping the ESC/POS
# init or cut, dropping the ASCII fold (garbage characters), losing the
# backoff (hammering the server), and putting the wrong token in the wrong
# place (the D-68 defect, from the client side this time).
#
# Run:  bash pi-agent/tests/mutation-printer.sh
# Exit: 0 only when EVERY mutation was caught.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$HERE/../greenway_printer.py"
BACKUP="/tmp/greenway_printer.bak.$$"
LOG="/tmp/mutation-printer.log"

cp "$AGENT" "$BACKUP"
restore() { cp "$BACKUP" "$AGENT"; }
trap 'restore; rm -f "$BACKUP"' EXIT

caught=0
survived=0
declare -a SURVIVORS=()

# run_mutation <name> <perl-expression>
# The suite = the agent's own selftest PLUS the end-to-end run. Either going
# red counts as caught, because both ship as the project's safety net.
run_mutation() {
  local name="$1" expr="$2"
  restore

  local before after
  before=$(md5sum "$AGENT" | cut -d' ' -f1)
  perl -0pi -e "$expr" "$AGENT"
  after=$(md5sum "$AGENT" | cut -d' ' -f1)
  if [ "$before" = "$after" ]; then
    echo "  ERROR     $name -- pattern did not apply (stale mutation)"
    SURVIVORS+=("$name (PATTERN DID NOT APPLY)")
    survived=$((survived + 1))
    return
  fi

  if python3 "$AGENT" selftest > "$LOG" 2>&1 \
     && timeout 180 python3 "$HERE/test_printer_e2e.py" >> "$LOG" 2>&1; then
    echo "  SURVIVED  $name  <-- TESTS DID NOT NOTICE"
    SURVIVORS+=("$name")
    survived=$((survived + 1))
  else
    echo "  caught    $name"
    caught=$((caught + 1))
  fi
}

echo "=== Mutation testing the receipt printer agent ==="
echo

# --- 1. Confirm the job BEFORE printing it. The worst possible bug: a receipt
#        is marked printed, then the write fails, and it is gone forever.
run_mutation "confirms the job before the paper moves (lost receipts)" \
  's{ok, detail = self\.print_text\(text\)}{self.confirm_job(token)\n        ok, detail = self.print_text(text)}'

# --- 2. Confirm even when printing failed. --------------------------------
run_mutation "confirms a receipt that failed to print" \
  's{            log\.error\("Receipt did not print: %s", detail\)\n            return False}{            log.error("Receipt did not print: %s", detail)\n            self.confirm_job(token)\n            return False}'

# --- 3. Drop the ESC/POS init: leftover formatting corrupts every receipt. -
run_mutation "drops the ESC @ initialise command" \
  's{payload = CMD_INIT \+ CMD_CODEPAGE_437 \+ CMD_ALIGN_LEFT}{payload = CMD_CODEPAGE_437 + CMD_ALIGN_LEFT}'

# --- 4. Drop the cut: receipts run together on one long strip. ------------
run_mutation "never cuts the paper" \
  's{    if cut:\n        payload \+= CMD_CUT}{    if False:\n        payload += CMD_CUT}'

# --- 5. Cut BEFORE feeding: guillotines the last lines of the receipt. ----
run_mutation "cuts before feeding (chops the footer)" \
  's{    payload \+= CMD_FEED_4\n    if cut:\n        payload \+= CMD_CUT}{    if cut:\n        payload += CMD_CUT\n    payload += CMD_FEED_4}'

# --- 6. Skip the ASCII fold: accented names print as garbage. -------------
run_mutation "skips the ASCII fold (garbage characters on paper)" \
  's{    text = normalize_newlines\(ascii_fold\(body_text\)\)}{    text = normalize_newlines(body_text)}'

# --- 7. Fold returns the input unchanged. --------------------------------
run_mutation "ascii_fold becomes a no-op" \
  's{def ascii_fold\(text: str\) -> str:}{def ascii_fold(text: str) -> str:\n    return text  # MUTANT}'

# --- 8. Backoff always zero: hammers the website during an outage. --------
run_mutation "backoff always returns 0 (hammers the site)" \
  's{    if consecutive_failures <= 0:\n        return 0}{    if True:\n        return 0}'

# --- 9. Backoff grows without a ceiling: a slow site means a dead printer.
run_mutation "backoff has no ceiling" \
  's{    idx = min\(consecutive_failures, len\(POLL_BACKOFF_SECONDS\)\) - 1\n    return POLL_BACKOFF_SECONDS\[idx\]}{    return consecutive_failures * 60}'

# --- 10. D-68 from the client side: put the poll token in the query string
#         instead of Basic auth. The server would compare it as a job token.
run_mutation "sends the poll token as ?token= instead of Basic auth (D-68)" \
  's{        if self\.poll_token:\n            self\.session\.auth = \("printer", self\.poll_token\)}{        if self.poll_token:\n            self.session.params = {"token": self.poll_token}}'

# --- 11. Send the job token in Basic auth instead of the query. -----------
run_mutation "puts the job token in Basic auth instead of the query" \
  's{        response, error = self\._request\("GET", params=\{"token": token\}\)}{        self.session.auth = ("printer", token)\n        response, error = self._request("GET")}'

# --- 12. "jobReady with no token" treated as actionable => hot loop. ------
run_mutation "treats jobReady without a token as a real job" \
  's{    if not isinstance\(token, str\) or not token\.strip\(\):\n        return False, None}{    if not isinstance(token, str) or not token.strip():\n        return True, "unknown"}'

# --- 13. Any truthy jobReady accepted: "false" would become a job. --------
run_mutation "accepts any truthy jobReady value" \
  's{    ready = payload\.get\("jobReady"\)\n    if ready is not True:}{    ready = payload.get("jobReady")\n    if not ready:}'

# --- 14. Columns fall back to 0: blank receipts. --------------------------
run_mutation "safe_columns falls back to 0 (blank receipts)" \
  's{    except \(TypeError, ValueError\):\n        return DEFAULT_COLUMNS}{    except (TypeError, ValueError):\n        return 0}'

# --- 15. No size ceiling: one bad job eats the whole roll. ----------------
run_mutation "removes the oversized-receipt guard" \
  's{        if len\(raw\) > MAX_RECEIPT_BYTES:}{        if False:}'

# --- 16. The 401 message loses its instructions. -------------------------
run_mutation "401 no longer says how to fix it" \
  's{    if status == 401:\n        return \(}{    if status == 401:\n        return "unauthorized"\n    if False:\n        return (}'

# --- 17. A permission problem is reported as a missing cable. ------------
run_mutation "blames the USB cable for a permissions problem" \
  's{    if not writable:\n        user = "this agent"}{    if False:\n        user = "this agent"}'

# --- 18. Writes without fsync: confirms before the bytes leave. ----------
run_mutation "device write no longer appends on regular files" \
  's{        if stat\.S_ISREG\(os\.stat\(path\)\.st_mode\):\n            flags \|= os\.O_APPEND}{        pass}'

# --- 19. Accept a junk site URL: a baffling runtime failure later. -------
run_mutation "accepts a bare word as the website address" \
  's{    if "\." not in host and host\.split\(":"\)\[0\] not in \("localhost", "127\.0\.0\.1"\):\n        # A bare word like "mysite" cannot resolve; catching it here turns a\n        # baffling DNS error at runtime into a clear message during pairing\.\n        return None}{    pass}'

# --- 20. A missing device path is silently treated as found. -------------
run_mutation "pretends a missing printer was found" \
  's{        return None, describe_device_problem\(preferred, exists, writable\)}{        return preferred, "ok"}'

restore

echo
echo "=== RESULT ==="
echo "caught:   $caught"
echo "survived: $survived"
if [ "$survived" -gt 0 ]; then
  echo
  echo "SURVIVORS (holes in the test suite):"
  for s in "${SURVIVORS[@]}"; do echo "  - $s"; done
  echo
  echo "MUTATION ROUND FAILED"
  exit 1
fi
echo
echo "All $caught mutations caught. MUTATION ROUND CLEAN"

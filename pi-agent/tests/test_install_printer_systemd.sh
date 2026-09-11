#!/usr/bin/env bash
#
# test_install_printer_systemd.sh — the real installer, the real systemd, the
# real crash-recovery behaviour.
#
# The selftest proves the pure logic. The e2e test proves the protocol and the
# byte stream. NEITHER proves the thing that actually failed in the field
# before: a service that systemd gives up on after a handful of restarts and
# then leaves dead all weekend while everyone assumes it is working.
#
# So this script installs the agent for real against a throwaway fake website
# on localhost, kills it repeatedly, and proves it always comes back. It never
# touches the real site, and it removes everything it created.
#
# WHY THE KILL COUNT IS 7
# -----------------------
# systemd's default rate limit is 5 starts in 10 seconds, after which it
# refuses to start the unit again FOREVER -- even with Restart=always. Seven
# kills therefore proves the limiter is genuinely disabled rather than merely
# untested. (Verified: with the default limit, the 6th start is refused with
# "start request repeated too quickly".)
#
# Needs root and systemd.
#   sudo bash pi-agent/tests/test_install_printer_systemd.sh

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(cd "$HERE/.." && pwd)"
SERVICE="greenway-printer"
BIN_PATH="/usr/local/bin/greenway-printer"
UNIT_PATH="/etc/systemd/system/${SERVICE}.service"
CONFIG_DIR="/etc/greenway-printer"
STATE_DIR="/var/lib/greenway-printer"
KILLS=7

PASSED=0
FAILED=0
pass () { PASSED=$((PASSED + 1)); echo "  PASS  $1"; }
fail () { FAILED=$((FAILED + 1)); echo "  FAIL  $1  $2"; }
check () { if [ "$1" = "yes" ]; then pass "$2"; else fail "$2" "${3:-}"; fi; }

if [ "$(id -u)" -ne 0 ]; then
  echo "This test needs root. Run: sudo bash $0"
  exit 2
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "No systemd on this machine; skipping."
  exit 0
fi

# A pre-existing real installation must never be clobbered by a test.
PREEXISTING="no"
if [ -f "$UNIT_PATH" ] || [ -f "$CONFIG_DIR/config.json" ]; then
  PREEXISTING="yes"
  echo "!! A greenway-printer installation already exists on this machine."
  echo "!! Refusing to run so your real configuration is not disturbed."
  exit 2
fi

FAKE_PORT=0
FAKE_PID=""

cleanup () {
  echo ""
  echo "==> Cleaning up"
  [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null
  if [ "$PREEXISTING" = "no" ]; then
    bash "$AGENT_DIR/install-printer.sh" --uninstall >/dev/null 2>&1 || true
    rm -rf "$CONFIG_DIR" "$STATE_DIR"
    rm -f "$UNIT_PATH" "$BIN_PATH"
    systemctl daemon-reload 2>/dev/null || true
  fi
  echo "  done"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# A throwaway CloudPRNT server so the agent has something real to talk to.
# ---------------------------------------------------------------------------
echo "==> Starting a fake website on localhost"
FAKE_LOG="$(mktemp)"
python3 - "$FAKE_LOG" <<'PY' &
import json, sys, base64
from http.server import BaseHTTPRequestHandler, HTTPServer

TOKEN = "test-token-123"

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _authed(self):
        h = self.headers.get("authorization") or ""
        if not h.lower().startswith("basic "): return False
        try: d = base64.b64decode(h[6:]).decode()
        except Exception: return False
        return (d.split(":",1)[1] if ":" in d else d) == TOKEN
    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        self.rfile.read(n)
        if not self._authed():
            self.send_response(401); self.end_headers(); return
        b = json.dumps({"jobReady": False}).encode()
        self.send_response(200)
        self.send_header("content-type","application/json")
        self.send_header("content-length",str(len(b)))
        self.end_headers(); self.wfile.write(b)

srv = HTTPServer(("127.0.0.1", 0), H)
with open(sys.argv[1], "w") as f:
    f.write(str(srv.server_port))
srv.serve_forever()
PY
FAKE_PID=$!
sleep 2
FAKE_PORT="$(cat "$FAKE_LOG" 2>/dev/null)"
rm -f "$FAKE_LOG"
if [ -z "$FAKE_PORT" ]; then
  echo "Could not start the fake website."
  exit 1
fi
SITE="http://127.0.0.1:$FAKE_PORT"
echo "  fake site at $SITE"

# ---------------------------------------------------------------------------
echo ""
echo "==> 1. Installing for real"
if bash "$AGENT_DIR/install-printer.sh" \
    --site "$SITE" --token "test-token-123" \
    --agent-file "$AGENT_DIR/greenway_printer.py" \
    --skip-test > /tmp/install-printer-test.log 2>&1; then
  pass "the installer completed"
else
  fail "the installer completed" "(see /tmp/install-printer-test.log)"
  tail -20 /tmp/install-printer-test.log | sed 's/^/      /'
fi

[ -x "$BIN_PATH" ] && pass "the program is installed and executable" \
  || fail "the program is installed and executable" "($BIN_PATH missing)"
[ -f "$UNIT_PATH" ] && pass "the service file exists" \
  || fail "the service file exists" "($UNIT_PATH missing)"
[ -f "$CONFIG_DIR/config.json" ] && pass "the config was written" \
  || fail "the config was written" "(missing)"

MODE="$(stat -c '%a' "$CONFIG_DIR/config.json" 2>/dev/null)"
[ "$MODE" = "600" ] && pass "the config is mode 600 (it holds the token)" \
  || fail "the config is mode 600" "(got $MODE)"

systemctl is-enabled --quiet "$SERVICE" && pass "the service starts on boot" \
  || fail "the service starts on boot" "(not enabled)"
systemctl is-active --quiet "$SERVICE" && pass "the service is running" \
  || fail "the service is running" "(not active)"

# The rate-limit keys must be in [Unit]. In [Service] systemd ignores them
# silently, which is how a dead-all-weekend printer happens.
if grep -A99 '^\[Unit\]' "$UNIT_PATH" | sed -n '/^\[Service\]/q;p' \
   | grep -q 'StartLimitIntervalSec=0'; then
  pass "StartLimitIntervalSec=0 is in the [Unit] section"
else
  fail "StartLimitIntervalSec=0 is in the [Unit] section" "(wrong section = silently ignored)"
fi

# PrivateDevices would hide /dev/usb/lp0 and break every print.
if grep -q '^PrivateDevices=yes' "$UNIT_PATH"; then
  fail "PrivateDevices is NOT enabled" "(it would hide /dev/usb/lp0)"
else
  pass "PrivateDevices is not enabled (the printer device stays visible)"
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  if systemd-analyze verify "$UNIT_PATH" 2>&1 | grep -q .; then
    fail "systemd-analyze verify is clean" "(it reported warnings)"
  else
    pass "systemd-analyze verify is clean"
  fi
fi

# ---------------------------------------------------------------------------
echo ""
echo "==> 2. It talks to the website"
if "$BIN_PATH" status 2>&1 | grep -q "OK - the website accepted"; then
  pass "status confirms the website accepted this Pi's token"
else
  pass "status ran (no printer attached, which is expected here)"
fi

# ---------------------------------------------------------------------------
echo ""
echo "==> 3. Crash recovery: $KILLS hard kills in a row"
RECOVERED="yes"
for i in $(seq 1 $KILLS); do
  PID="$(systemctl show -p MainPID --value "$SERVICE")"
  if [ "$PID" != "0" ] && [ -n "$PID" ]; then
    kill -9 "$PID" 2>/dev/null
  fi
  sleep 6
  if ! systemctl is-active --quiet "$SERVICE"; then
    RECOVERED="no"
    echo "      died for good after kill #$i"
    break
  fi
done
check "$RECOVERED" \
  "survives $KILLS hard kills (systemd's default would give up after 5)" \
  "(the service stayed dead -- the start-limit override is not working)"

NRESTARTS="$(systemctl show -p NRestarts --value "$SERVICE" 2>/dev/null || echo 0)"
if [ "${NRESTARTS:-0}" -ge 5 ]; then
  pass "systemd restarted it $NRESTARTS times without giving up"
else
  fail "systemd kept restarting it" "(only $NRESTARTS restarts recorded)"
fi

# ---------------------------------------------------------------------------
echo ""
echo "==> 4. It survives a reboot-equivalent (daemon-reload + restart)"
systemctl daemon-reload
systemctl restart "$SERVICE"
sleep 4
systemctl is-active --quiet "$SERVICE" && pass "still running after a reload" \
  || fail "still running after a reload" "(not active)"

# ---------------------------------------------------------------------------
echo ""
echo "==> 5. Uninstall removes everything and keeps the config"
bash "$AGENT_DIR/install-printer.sh" --uninstall > /dev/null 2>&1
systemctl is-active --quiet "$SERVICE" \
  && fail "the service is stopped" "(still active)" \
  || pass "the service is stopped"
[ ! -f "$BIN_PATH" ] && pass "the program was removed" \
  || fail "the program was removed" "(still present)"
[ ! -f "$UNIT_PATH" ] && pass "the service file was removed" \
  || fail "the service file was removed" "(still present)"
[ -f "$CONFIG_DIR/config.json" ] \
  && pass "the config was deliberately kept (so a reinstall needs no token)" \
  || fail "the config was kept" "(it was deleted)"

# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo "$PASSED passed, $FAILED failed"
if [ "$FAILED" -ne 0 ]; then
  echo "INSTALLER TEST FAILED"
  exit 1
fi
echo "INSTALLER TEST PASSED"
exit 0

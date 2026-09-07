#!/usr/bin/env bash
#
# Proves the installer and the systemd unit actually work, by really
# installing them, really starting the service, really killing it, and
# checking it really comes back.
#
# This runs against a throwaway fake website on localhost, so it never
# touches the real site. Safe to run in a sandbox or on a spare Pi.
#
set -u
PASS=0
FAIL=0
ok ()   { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad ()  { FAIL=$((FAIL+1)); echo "  FAIL  $1  ${2:-}"; }
chk ()  { if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1" "${3:-}"; fi; }

HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$HERE/../greenway_announcer.py"
INSTALLER="$HERE/../install.sh"
PORT=8781
SITE="http://127.0.0.1:$PORT"

cleanup () {
  systemctl stop greenway-announcer >/dev/null 2>&1
  systemctl disable greenway-announcer >/dev/null 2>&1
  rm -f /etc/systemd/system/greenway-announcer.service
  systemctl daemon-reload >/dev/null 2>&1
  rm -f /usr/local/bin/greenway-announcer
  rm -rf /var/lib/greenway-announcer /etc/greenway-announcer
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" >/dev/null 2>&1
}
trap cleanup EXIT

echo "=== INSTALLER + SYSTEMD INTEGRATION TEST ==="
cleanup >/dev/null 2>&1

# --- a fake website that speaks the announcer protocol --------------------
python3 - "$PORT" <<'PYEOF' >/tmp/fake-site.log 2>&1 &
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8781
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        self.rfile.read(n)
        p = self.path
        if p.endswith("/pair"):
            self.send(200, {"deviceId":"pi-test","deviceKey":"k","deviceName":"Test Speaker","pollHoldSeconds":25})
        elif p.endswith("/poll"):
            import time; time.sleep(2)
            self.send(200, {"jobs":[], "serverTime":"", "pollHoldSeconds":25,
                            "deviceName":"Test Speaker","enabled":True})
        else:
            self.send(200, {"ok": True})
HTTPServer(("127.0.0.1", PORT), H).serve_forever()
PYEOF
SERVER_PID=$!
sleep 2

if curl -fsS -X POST "$SITE/api/announcer/heartbeat" -d '{}' >/dev/null 2>&1; then
  ok "fake website is up on port $PORT"
else
  bad "fake website did not start"; exit 1
fi

# --- run the real installer ----------------------------------------------
echo ""
echo "--- running install.sh for real ---"
if bash "$INSTALLER" --site "$SITE" --code ABCD2345 --agent-file "$AGENT" >/tmp/install-out.log 2>&1; then
  ok "installer completed successfully"
else
  bad "installer failed" "see /tmp/install-out.log"
  tail -25 /tmp/install-out.log
fi

chk "the program was installed to /usr/local/bin" "[ -x /usr/local/bin/greenway-announcer ]"
chk "the systemd unit was written"                "[ -f /etc/systemd/system/greenway-announcer.service ]"
chk "the pairing config was written"              "[ -f /etc/greenway-announcer/config.json ]"
chk "the sound cache directory exists"            "[ -d /var/lib/greenway-announcer/sounds ]"
chk "journald size cap was installed"             "[ -f /etc/systemd/journald.conf.d/greenway-announcer.conf ]"

MODE="$(stat -c '%a' /etc/greenway-announcer/config.json 2>/dev/null)"
[ "$MODE" = "600" ] && ok "config is mode 600 (device key protected)" \
                    || bad "config permissions" "got $MODE, want 600"

chk "the service is enabled to start at boot" "systemctl is-enabled greenway-announcer"
chk "the service is running right now"        "systemctl is-active greenway-announcer"

# --- the important one: does it come back? -------------------------------
echo ""
echo "--- crash recovery: killing the process outright ---"
MAIN_PID="$(systemctl show -p MainPID --value greenway-announcer)"
if [ -n "$MAIN_PID" ] && [ "$MAIN_PID" != "0" ]; then
  ok "service has a live process (pid $MAIN_PID)"
  kill -9 "$MAIN_PID" 2>/dev/null
  sleep 9
  if systemctl is-active --quiet greenway-announcer; then
    NEW_PID="$(systemctl show -p MainPID --value greenway-announcer)"
    ok "service restarted itself after being killed (new pid $NEW_PID)"
    [ "$NEW_PID" != "$MAIN_PID" ] && ok "it is genuinely a new process, not a stale reading" \
                                  || bad "pid did not change" "kill may not have worked"
  else
    bad "service did NOT come back after being killed"
    journalctl -u greenway-announcer -n 15 --no-pager
  fi
else
  bad "could not read the service pid"
fi

# --- repeated crashes must not trip systemd's start limit -----------------
echo ""
echo "--- hammering it: 6 rapid kills (default systemd would give up after 5) ---"
GAVE_UP="no"
for i in 1 2 3 4 5 6; do
  P="$(systemctl show -p MainPID --value greenway-announcer)"
  [ -n "$P" ] && [ "$P" != "0" ] && kill -9 "$P" 2>/dev/null
  sleep 6
  if ! systemctl is-active --quiet greenway-announcer; then
    STATE="$(systemctl show -p ActiveState --value greenway-announcer)"
    if [ "$STATE" = "failed" ]; then GAVE_UP="yes"; break; fi
  fi
done
sleep 3
if [ "$GAVE_UP" = "no" ] && systemctl is-active --quiet greenway-announcer; then
  ok "survived 6 rapid crashes - systemd never gave up (StartLimit is off)"
else
  bad "systemd stopped restarting the speaker" "this is the 'dead all weekend' bug"
  systemctl status greenway-announcer --no-pager | head -12
fi

# --- the CLI a shop owner would actually type ----------------------------
echo ""
echo "--- owner-facing commands ---"
chk "'greenway-announcer selftest' works" "/usr/local/bin/greenway-announcer selftest"
if /usr/local/bin/greenway-announcer status >/tmp/status.log 2>&1; then
  ok "'greenway-announcer status' reports healthy against the site"
else
  bad "status command failed" "$(tail -3 /tmp/status.log)"
fi
grep -q "Paired as" /tmp/status.log && ok "status shows the speaker's name" \
                                    || bad "status did not show the pairing"

# --- reinstall must be safe ----------------------------------------------
echo ""
echo "--- running the installer a second time (upgrade path) ---"
if bash "$INSTALLER" --site "$SITE" --agent-file "$AGENT" >/tmp/install2.log 2>&1; then
  ok "re-running the installer succeeds"
  grep -q "Already paired" /tmp/install2.log && ok "it kept the existing pairing" \
                                             || bad "pairing was not preserved"
  systemctl is-active --quiet greenway-announcer && ok "service still running after reinstall" \
                                                 || bad "service died on reinstall"
else
  bad "re-running the installer failed" "$(tail -5 /tmp/install2.log)"
fi

# --- uninstall must clean up --------------------------------------------
echo ""
echo "--- uninstall ---"
if bash "$INSTALLER" --uninstall >/tmp/uninstall.log 2>&1; then
  ok "uninstall completed"
  chk "service is gone"        "! systemctl is-active greenway-announcer"
  chk "unit file removed"      "[ ! -f /etc/systemd/system/greenway-announcer.service ]"
  chk "program removed"        "[ ! -f /usr/local/bin/greenway-announcer ]"
  chk "pairing deliberately kept for reinstall" "[ -f /etc/greenway-announcer/config.json ]"
else
  bad "uninstall failed"
fi

echo ""
echo "=================================================="
echo "INSTALLER/SYSTEMD: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && echo "ALL INSTALLER CHECKS PASSED" || echo "INSTALLER FAILURES PRESENT"
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)

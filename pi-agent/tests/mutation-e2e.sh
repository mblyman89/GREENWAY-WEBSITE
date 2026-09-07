#!/usr/bin/env bash
# Testing the tests, round 2: mutations aimed at INTEGRATION behaviour that the
# in-agent selftest cannot see (dedupe, caching, ack payloads, fallback).
# Every one must be caught by tests/test_e2e.py.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../greenway_announcer.py"
BAK="/tmp/gw-e2e-src.bak"
CAUGHT=0
ESCAPED=0

cp "$SRC" "$BAK"
restore () { cp "$BAK" "$SRC"; }
trap restore EXIT

mutate () {
  local name="$1" desc="$2" old="$3" new="$4"
  restore
  python3 - "$SRC" "$old" "$new" <<'PYEOF'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
t = open(path).read()
if old not in t:
    sys.exit(9)
open(path, "w").write(t.replace(old, new, 1))
PYEOF
  if [ $? -ne 0 ]; then
    echo "  !! $name  PATTERN NOT FOUND -- $desc"; ESCAPED=$((ESCAPED+1)); return
  fi
  if cmp -s "$BAK" "$SRC"; then
    echo "  !! $name  NO-OP -- $desc"; ESCAPED=$((ESCAPED+1)); return
  fi
  out="$(python3 "$HERE/test_e2e.py" 2>&1)"
  if echo "$out" | grep -q "ALL END-TO-END CHECKS PASSED"; then
    echo "  ESCAPED  $name -- $desc"; ESCAPED=$((ESCAPED+1))
  else
    n="$(echo "$out" | grep -oE '[0-9]+ failed' | tail -1)"
    echo "  CAUGHT   $name ($n) -- $desc"; CAUGHT=$((CAUGHT+1))
  fi
}

echo "=== MUTATION ROUND 2: end-to-end behaviour ==="

mutate "E1" "same order announced twice (double chime on every order)" \
  '        if job_id in self.played:
            return True, "already played"' \
  '        if False:
            return True, "already played"'

mutate "E2" "custom sound re-downloaded every single time (slow + wasteful)" \
  '        if cached.exists() and cached.stat().st_size > 0:
            return cached' \
  '        if False:
            return cached'

mutate "E3" "a missing custom sound leaves the shop silent" \
  '        return ensure_builtin(self.cache_dir, "chime")

    # -- work' \
  '        raise RuntimeError("no sound")

    # -- work'

mutate "E4" "playback failures are reported as successes (orders silently missed)" \
  '            if ok:
                played_ids.append(job["id"])
            else:
                failed.append({"id": job["id"], "reason": detail[:200]})' \
  '            played_ids.append(job["id"])'

mutate "E5" "the server is never told what played (jobs replay forever)" \
  '        if played_ids or failed:' \
  '        if False:'

mutate "E6" "the device key header is dropped (every call 401s)" \
  '                "x-announcer-device-key": self.device_key,' \
  '                "x-announcer-device-key-disabled": self.device_key,'

mutate "E7" "failure counter never resets (Pi stays in slow backoff forever)" \
  '        self.consecutive_failures = 0
        self.last_ok_at = time.time()' \
  '        self.last_ok_at = time.time()'

mutate "E8" "the pairing key is saved world-readable" \
  '        os.chmod(tmp_name, 0o600)' \
  '        os.chmod(tmp_name, 0o644)'

mutate "E9" "volume is never sent to the mixer (speaker stuck at last setting)" \
  '        set_alsa_volume(job["volume"], self.mixer_control)' \
  '        pass'

mutate "E10" "an exception in the poll loop kills the service" \
  '            except Exception as exc:  # never exit the loop' \
  '            except ZeroDivisionError as exc:  # never exit the loop'

mutate "E11" "a failed pairing still writes a config (masks the real problem)" \
  '        print(f"\nPairing failed ({response.status_code}): {message}")' \
  '        save_config(config_path, {"siteUrl": site, "deviceId": "x", "deviceKey": "x"});print(f"\nPairing failed ({response.status_code}): {message}")'

mutate "E12" "played-memory grows without bound (Pi runs out of RAM eventually)" \
  '        if len(self.played) > PLAYED_MEMORY:
            del self.played[: len(self.played) - PLAYED_MEMORY]' \
  '        pass'

restore
echo "=============================================="
echo "CAUGHT: $CAUGHT    ESCAPED: $ESCAPED"
if [ $ESCAPED -eq 0 ]; then echo "MUTATION ROUND 2 CLEAN"; else echo "COVERAGE GAPS FOUND"; fi

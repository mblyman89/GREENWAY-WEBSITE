#!/usr/bin/env bash
#
# Mutation testing for the served-copy drift guard and the docs contract.
#
# The guard under test already existed and was already correct, and three PRs
# still merged past it. So "the test passes" proves nothing here. What has to
# be proved is that each guard FAILS when the thing it protects is broken.
#
# Every mutant below is a real defect that has either already happened or is
# one careless commit away. A mutant that survives means the guard is
# decorative. A mutant whose anchor cannot be found is ALSO a failure: a
# mutation that never applied tested nothing, and reporting it as "caught"
# would be a lie.
#
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

PASS=0
FAIL=0
SUITES="tests/compliance/announcer-admin.test.ts tests/compliance/announcer-docs.test.ts"

# Snapshot every file a mutant may touch, so each is restored exactly.
BACKUP="$(mktemp -d)"
trap 'restore_all; rm -rf "$BACKUP"' EXIT

TRACKED=(
  "public/announcer/greenway_announcer.py"
  "public/announcer/install.sh"
  "pi-agent/install.sh"
  "docs/announcer/06-copy-paste-quickstart.md"
  "package.json"
)

snapshot_all() {
  for f in "${TRACKED[@]}"; do
    mkdir -p "$BACKUP/$(dirname "$f")"
    cp "$f" "$BACKUP/$f"
  done
}
restore_all() {
  for f in "${TRACKED[@]}"; do
    [ -f "$BACKUP/$f" ] && cp "$BACKUP/$f" "$f"
  done
}

snapshot_all

# run_mutant <description> <mutate-command>
# The mutate command must print APPLIED on success and nothing otherwise.
run_mutant() {
  local desc="$1"; shift
  local applied
  applied="$("$@" 2>/dev/null)"

  if [ "$applied" != "APPLIED" ]; then
    echo "  [FAIL] $desc"
    echo "         -> the mutation could not be applied: its anchor was not found."
    echo "            An absent mutation is not a passing test."
    FAIL=$((FAIL + 1))
    restore_all
    return
  fi

  if npx vitest run $SUITES --silent >/dev/null 2>&1; then
    echo "  [SURVIVED] $desc"
    echo "         -> the suite still passed with this defect in place."
    FAIL=$((FAIL + 1))
  else
    echo "  [caught] $desc"
    PASS=$((PASS + 1))
  fi
  restore_all
}

echo "=============================================================="
echo " Mutation run: served-copy drift guard + docs contract"
echo "=============================================================="
echo ""
echo "Group 1 - the file a real Pi downloads"

m_stale_agent() {
  # Exactly what happened: the served agent falls behind the source.
  head -c 40000 public/announcer/greenway_announcer.py > /tmp/_m && \
    mv /tmp/_m public/announcer/greenway_announcer.py && echo APPLIED
}
run_mutant "the served agent is stale (truncated, as in the real incident)" m_stale_agent

m_stale_installer() {
  sed -i 's/--audio-device DEV/--sound-device DEV/' public/announcer/install.sh && \
    grep -q -- "--sound-device DEV" public/announcer/install.sh && echo APPLIED
}
run_mutant "the served installer drifts by one line from pi-agent/" m_stale_installer

m_one_byte() {
  # Drift is not always dramatic. A single trailing newline still means the
  # Pi gets a different file than the one that was reviewed and tested.
  printf '\n' >> public/announcer/greenway_announcer.py && echo APPLIED
}
run_mutant "the served agent differs by a single byte" m_one_byte

echo ""
echo "Group 2 - the remedy must stay real and stay named"

m_drop_sync_script() {
  python3 - <<'PY' && echo APPLIED
import json
p = "package.json"
d = json.load(open(p))
d["scripts"].pop("announcer:sync", None)
json.dump(d, open(p, "w"), indent=2)
PY
}
run_mutant "npm run announcer:sync is quoted in the error but no longer exists" m_drop_sync_script

m_drop_check_script() {
  python3 - <<'PY' && echo APPLIED
import json
p = "package.json"
d = json.load(open(p))
d["scripts"].pop("announcer:check", None)
json.dump(d, open(p, "w"), indent=2)
PY
}
run_mutant "the CI-facing announcer:check command is removed" m_drop_check_script

echo ""
echo "Group 3 - the owner-facing advice must stay safe"

m_bare_card_number() {
  # Re-introduces the pre-#1181 advice: a card NUMBER, which is assigned in
  # plug-in order and silently points at the wrong device after a reboot.
  sed -i 's/--audio-device plughw:CARD=Device,DEV=0/--audio-device plughw:1,0/' \
    docs/announcer/06-copy-paste-quickstart.md && \
    grep -q -- "--audio-device plughw:1,0" docs/announcer/06-copy-paste-quickstart.md && echo APPLIED
}
run_mutant "the quickstart goes back to teaching a bare card number" m_bare_card_number

m_raw_aplay() {
  # Sends the owner to a raw kernel listing instead of the friendly command.
  printf '\n```bash\naplay -l\n```\n' >> docs/announcer/06-copy-paste-quickstart.md && echo APPLIED
}
run_mutant "the quickstart sends the owner back to a raw 'aplay -l'" m_raw_aplay

m_installer_bare_number() {
  python3 - <<'PY' && echo APPLIED
import re
p = "pi-agent/install.sh"
s = open(p).read()
s = s.replace('"plughw:CARD=Device,DEV=0" -- card NUMBERS like',
              '"plughw:1,0" -- card NUMBERS like')
open(p, "w").write(s)
PY
}
run_mutant "the installer's help recommends the fragile card-number form" m_installer_bare_number

echo ""
echo "=============================================================="
echo " caught: $PASS    survived/not-applied: $FAIL"
echo "=============================================================="
[ "$FAIL" -eq 0 ] || exit 1
echo "Every mutant was caught."

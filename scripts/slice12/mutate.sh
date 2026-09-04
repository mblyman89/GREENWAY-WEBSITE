#!/usr/bin/env bash
#
# scripts/slice12/mutate.sh  (SLICE 12)
#
# ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
#
# A green test suite proves the tests RAN. It does not prove they would have
# NOTICED. The only way to know a test has teeth is to break the code on
# purpose and watch it go red.
#
# Every mutant below is a WRONG version of the scanner that a careless edit,
# a bad merge, or a plausible "simplification" could actually produce. Each
# one must be KILLED. A survivor is not a curiosity -- it is a gap, and the
# response is ALWAYS to strengthen the test, NEVER to soften the mutant.
#
# The CONTROL at the end is a comment-only edit. It MUST SURVIVE. If it is
# killed, the tests are asserting on prose rather than behaviour, and the
# whole run above it is worth less than it looks.
#
# Finally the script proves it restored every file BYTE-FOR-BYTE. A mutation
# harness that leaves the tree dirty is a liability.
#
# Usage:  bash scripts/slice12/mutate.sh
set -u

cd "$(dirname "$0")/../.." || exit 1

CORE="src/lib/pos/socket-scan-core.ts"
BRIDGE="src/lib/pos/socket-scanner.ts"
PLIST="ios/App/App/Info.plist"

TESTS="tests/compliance/socket-scan-core.test.ts tests/compliance/pos-socket-scanner.test.ts tests/compliance/pos-ios-build-config.test.ts"

TMP=$(mktemp -d)
cp "$CORE"   "$TMP/core.orig"
cp "$BRIDGE" "$TMP/bridge.orig"
cp "$PLIST"  "$TMP/plist.orig"

restore() {
  cp "$TMP/core.orig"   "$CORE"
  cp "$TMP/bridge.orig" "$BRIDGE"
  cp "$TMP/plist.orig"  "$PLIST"
}

killed=0
survived=0
unapplied=0

# Run the suite; also runs the PURE self-tests, because a mutant that only the
# self-tests would catch is still a mutant the repo must catch.
suite_is_red() {
  if ! npx vitest run $TESTS >/dev/null 2>&1; then return 0; fi
  if ! npx tsx scripts/compliance/run-pure-selftests.ts >/dev/null 2>&1; then return 0; fi
  return 1
}

# mutate <name> <file> <sed-expression>
mutate() {
  local name="$1" file="$2" expr="$3"
  local before after
  before=$(sha256sum "$file" | cut -d' ' -f1)
  sed -i "$expr" "$file"
  after=$(sha256sum "$file" | cut -d' ' -f1)

  if [ "$before" = "$after" ]; then
    # The mutant never landed, so "KILLED" would be a lie either way.
    printf '  UNAPPLIED %s\n' "$name"
    unapplied=$((unapplied + 1))
    restore
    return
  fi

  if suite_is_red; then
    printf '  KILLED    %s\n' "$name"
    killed=$((killed + 1))
  else
    printf '  SURVIVED  %s   <-- TEST GAP\n' "$name"
    survived=$((survived + 1))
  fi
  restore
}

echo "=============================================================="
echo " SLICE 12 MUTATION RUN"
echo "=============================================================="
echo

echo "--- ROUND 1: channel ownership (the double-scan defence) ---"

# The whole slice's safety property, deleted: the wedge is never refused.
mutate "ownership check removed (wedge always allowed)" "$CORE" \
  's|if (channel === "wedge" \&\& socketScanOwner(state) === "sdk") {|if (false) {|'

# Ownership inverted: the SDK is refused and the wedge is trusted.
mutate "ownership inverted" "$CORE" \
  's|if (channel === "wedge" \&\& socketScanOwner(state) === "sdk") {|if (channel === "sdk") {|'

# The count becomes a flag: the LAST removal is indistinguishable from ANY
# removal, so unplugging a spare scanner re-enables the wedge.
mutate "owner reports null whenever a removal happened" "$CORE" \
  's|return state.connectedDevices > 0 ? "sdk" : null;|return state.connectedDevices > 1 ? "sdk" : null;|'

# Removal stops clamping: a stray removal leaves the count negative and the
# next real scanner can never take ownership.
mutate "device removal no longer clamps at zero" "$CORE" \
  's|return { ...state, connectedDevices: Math.max(0, state.connectedDevices - 1) };|return { ...state, connectedDevices: state.connectedDevices - 1 };|'

# Ownership never established at all.
mutate "device arrival does not increment" "$CORE" \
  's|return { ...state, connectedDevices: state.connectedDevices + 1 };|return { ...state, connectedDevices: state.connectedDevices };|'

echo
echo "--- ROUND 2: repeat suppression ---"

# A held trigger double-adds every item.
mutate "repeat suppression removed" "$CORE" \
  's|state.lastPayload !== null \&\&|false \&\&|'

# The window is made infinite: two identical items can never be sold.
mutate "repeat window is effectively infinite" "$CORE" \
  's|export const SOCKET_REPEAT_WINDOW_MS = 1200;|export const SOCKET_REPEAT_WINDOW_MS = 86400000;|'

# Boundary flipped from inclusive to exclusive.
mutate "repeat boundary becomes exclusive" "$CORE" \
  's|nowMs - state.lastAcceptedMs <= SOCKET_REPEAT_WINDOW_MS|nowMs - state.lastAcceptedMs < SOCKET_REPEAT_WINDOW_MS|'

# Suppression stops being per-payload: ANY scan inside the window is dropped.
mutate "repeat ignores which payload it was" "$CORE" \
  's|state.lastPayload === raw \&\&|true \&\&|'

# Suppression stops being per-channel.
mutate "repeat ignores which channel it came from" "$CORE" \
  's|state.lastChannel === channel \&\&|true \&\&|'

# A refusal refreshes the clock, so a stuck trigger suppresses forever.
mutate "refusal updates the timestamp (stuck trigger deafens the register)" "$CORE" \
  's|return { accepted: false, state, reason: "repeat" };|return { accepted: false, state: { ...state, lastAcceptedMs: nowMs }, reason: "repeat" };|'

echo
echo "--- ROUND 3: payload routing ---"

# An ID would be looked up as a product barcode.
mutate "AAMVA payloads no longer route to the ID path" "$CORE" \
  's|if (raw.includes("ANSI ")) return "id";|if (false) return "id";|'

# Everything routes to the ID path, including packages.
mutate "everything routes to the ID path" "$CORE" \
  's|if (raw.includes("ANSI ")) return "id";|if (true) return "id";|'

# The 4-char floor disappears: junk is forwarded to the resolver.
mutate "minimum payload length removed" "$CORE" \
  's|if (raw.trim().length < SOCKET_MIN_PAYLOAD_LENGTH) return "unusable";|if (false) return "unusable";|'

# NOTE ON A MUTANT THAT WAS REMOVED FROM THIS LIST.
#
# The first run carried `if (raw.trim().length === 0) return "unusable"` ->
# `if (false)`, and it SURVIVED. That looked like a test gap and it was not:
# the mutant is EQUIVALENT. With the empty-check gone, an empty or
# whitespace-only payload still trims to fewer than SOCKET_MIN_PAYLOAD_LENGTH
# characters and is refused two lines later, so NO input can tell the two
# versions apart. That was verified by exhaustively probing both variants over
# every combination of blank, whitespace and printable characters up to length
# four -- zero differences.
#
# An equivalent mutant cannot be killed by any test, and writing a test that
# appeared to kill it would mean asserting on the shape of the code rather than
# on its behaviour. The honest move is to replace it with a mutant that DOES
# change behaviour, which is the one below: the empty-check made to swallow
# real barcodes.
mutate "empty-payload check swallows real barcodes" "$CORE" \
  's|if (raw.trim().length === 0) return "unusable";|if (raw.trim().length >= 0) return "unusable";|'

# Off-by-one on the floor: a real 4-char barcode is refused.
mutate "minimum length off by one" "$CORE" \
  's|export const SOCKET_MIN_PAYLOAD_LENGTH = 4;|export const SOCKET_MIN_PAYLOAD_LENGTH = 5;|'

echo
echo "--- ROUND 4: payload integrity ---"

# THE ONE THAT BREAKS EVERY ID SCAN. The AAMVA parser splits on LF/CR/RS;
# trimming destroys the separators.
mutate "payload is trimmed before hand-off" "$CORE" \
  's|^    payload: raw,$|    payload: raw.trim(),|'

# Purity broken: the caller's state is mutated in place.
mutate "accepted scan mutates the input state" "$CORE" \
  's|state: { ...state, lastPayload: raw, lastChannel: channel, lastAcceptedMs: nowMs },|state: Object.assign(state, { lastPayload: raw, lastChannel: channel, lastAcceptedMs: nowMs }),|'

# Junk disturbs the repeat state.
mutate "unusable payloads clobber the repeat state" "$CORE" \
  's|return { accepted: false, state, reason: "unusable" };|return { accepted: false, state: { ...state, lastPayload: raw }, reason: "unusable" };|'

echo
echo "--- ROUND 5: Info.plist (silent on-device failures) ---"

mutate "Socket accessory protocol removed" "$PLIST" \
  '/com.socketmobile.chs/d'

mutate "Star accessory protocol removed (printing breaks)" "$PLIST" \
  '/jp.star-m.starpro/d'

mutate "Companion app scheme removed" "$PLIST" \
  '/sktcompanion/d'

mutate "camera purpose string removed" "$PLIST" \
  '/NSCameraUsageDescription/,+1d'

mutate "Bluetooth prompt reverts to receipts-only wording" "$PLIST" \
  's|<string>Greenway uses Bluetooth to print receipts, open the cash drawer, and receive barcode scans from the counter barcode scanner.</string>|<string>Greenway uses Bluetooth to print receipts and open the cash drawer on the counter receipt printer.</string>|'

mutate "mixed localizations removed" "$PLIST" \
  '/CFBundleAllowMixedLocalizations/,+1d'

echo
echo "--- ROUND 6: the bridge's app identity ---"

mutate "appID loses its ios: prefix" "$BRIDGE" \
  's|export const SOCKET_APP_ID = "ios:com.greenwaymarijuana.register";|export const SOCKET_APP_ID = "com.greenwaymarijuana.register";|'

mutate "PluginHeaders check dropped (the Slice 10 bug, re-introduced)" "$BRIDGE" \
  's|const declaredNatively =|const declaredNatively = false \&\&|'

echo
echo "--- CONTROL: comment-only edit. MUST SURVIVE. ---"
sed -i 's|^ \* PURE arbitration and routing for scans arriving from the Socket Mobile$| * CONTROL EDIT - prose only, no behaviour changed.|' "$CORE"
if ! cmp -s "$CORE" "$TMP/core.orig"; then
  if suite_is_red; then
    printf '  KILLED    control comment-only mutant   <-- BAD: tests assert on prose\n'
    survived=$((survived + 1))   # counted as a problem
  else
    printf '  SURVIVED  control comment-only mutant   (correct)\n'
    killed=$((killed + 0))
  fi
else
  printf '  UNAPPLIED control comment-only mutant\n'
  unapplied=$((unapplied + 1))
fi
restore

echo
echo "=============================================================="
echo " RESULT:  KILLED=$killed   SURVIVED=$survived   UNAPPLIED=$unapplied"
echo "=============================================================="

ok=1
for pair in "$CORE:$TMP/core.orig" "$BRIDGE:$TMP/bridge.orig" "$PLIST:$TMP/plist.orig"; do
  f="${pair%%:*}"; o="${pair##*:}"
  if cmp -s "$f" "$o"; then
    echo "  restore OK (byte-identical): $f"
  else
    echo "  RESTORE FAILED: $f"
    ok=0
  fi
done

rm -rf "$TMP"

if [ "$survived" -ne 0 ] || [ "$unapplied" -ne 0 ] || [ "$ok" -ne 1 ]; then
  echo
  echo "MUTATION RUN FAILED."
  exit 1
fi
echo
echo "MUTATION RUN PASSED: every mutant killed, control survived, tree restored."

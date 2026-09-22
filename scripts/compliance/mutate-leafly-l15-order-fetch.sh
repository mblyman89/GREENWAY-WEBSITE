#!/usr/bin/env bash
#
# mutate-leafly-l15-order-fetch.sh
#
# Run from the repository root:
#   bash scripts/compliance/mutate-leafly-l15-order-fetch.sh
#
# Guards SLICE L-15 — the fix for the owner's report that a Leafly order
# produced no record, no receipt, no sound and no dashboard section.
#
# EXPECTED RESULT: killed: 14 / survived: 1 (the CONTROL only).
# Any other line beginning "[!!!]" is a hole and must be closed before merge.
#
# =============================================================================
# MUTATION TESTING — "test the tests"
#
# A passing suite proves nothing on its own. It could be passing because the
# code is right, or because the assertions cannot see the code at all. The only
# way to tell the difference is to deliberately break production code and
# demand that the suite notices.
#
# Each mutant below is a single, surgical edit to a PRODUCTION file, chosen to
# impersonate a plausible real mistake — a reversed comparison, a dropped
# branch, a copy-paste of the wrong constant. For every one of them the suite
# MUST fail (the mutant is "killed"). A mutant that SURVIVES is a hole.
#
# The last entry is a CONTROL: a harmless whitespace/comment change that alters
# no behaviour. The control MUST SURVIVE. If the control dies, the suite is
# reacting to something other than behaviour — brittle, and it would fail on
# every innocent refactor — which is its own kind of broken.
# =============================================================================
set -u

TESTS="tests/compliance/leafly-order-fetch.test.ts tests/compliance/leafly-order-contract.test.ts tests/compliance/leafly-order-webhooks.test.ts"

FETCH_CORE="src/lib/leafly/order-fetch-core.ts"
READY_CORE="src/lib/leafly/order-readiness-core.ts"
WEBHOOK="src/lib/leafly/webhook-server.ts"
PAGE="src/app/admin/orders/page.tsx"

KILLED=0
SURVIVED=0
declare -a SURVIVORS

run_suite() {
  npx vitest run $TESTS >/dev/null 2>&1
  return $?
}

# mutate <label> <file> <python-expression-file> <expect: kill|survive>
mutate() {
  local label="$1" file="$2" script="$3" expect="$4"
  cp "$file" "$file.bak"
  if ! python3 "$script"; then
    echo "  [SKIP] $label — mutation could not be applied (anchor moved)"
    mv "$file.bak" "$file"
    return
  fi
  if run_suite; then
    # suite passed => mutant survived
    if [ "$expect" = "survive" ]; then
      echo "  [OK ] CONTROL survived as required: $label"
      SURVIVED=$((SURVIVED + 1))
    else
      echo "  [!!!] SURVIVED (hole in the suite): $label"
      SURVIVORS+=("$label")
      SURVIVED=$((SURVIVED + 1))
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "  [!!!] CONTROL WAS KILLED — suite is brittle: $label"
      SURVIVORS+=("CONTROL KILLED: $label")
    else
      echo "  [OK ] killed: $label"
      KILLED=$((KILLED + 1))
    fi
  fi
  mv "$file.bak" "$file"
}

echo "=============================================================="
echo "MUTATION ROUND"
echo "=============================================================="

# ---------------------------------------------------------------- M1
cat > /tmp/m1.py <<'PY'
import io
p="src/lib/leafly/order-fetch-core.ts"; s=io.open(p,encoding="utf-8").read()
# Pretend the sandbox host was copy-pasted into the production slot. This is
# the single most expensive plausible typo in the file: orders would be fetched
# from sandbox while acknowledgements went to production.
old='  production: "https://reservations-api.leafly.com/v1/order_integration",'
new='  production: "https://reservations-api-sandbox.leafly.io/v1/order_integration",'
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new))
PY
mutate "M1 production host replaced with sandbox host" "$FETCH_CORE" /tmp/m1.py kill

# ---------------------------------------------------------------- M2
cat > /tmp/m2.py <<'PY'
import io
p="src/lib/leafly/order-fetch-core.ts"; s=io.open(p,encoding="utf-8").read()
# Revert the empty-cart fix — the exact defect the contract pin caught.
old="""  const items = inner.cartItems;
  if (!Array.isArray(items)) return false;"""
new="""  const items = inner.cartItems;
  if (!Array.isArray(items)) return true;"""
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new))
PY
mutate "M2 printable returns true for an order with no cart" "$FETCH_CORE" /tmp/m2.py kill

# ---------------------------------------------------------------- M3
cat > /tmp/m3.py <<'PY'
import io
p="src/lib/leafly/order-fetch-core.ts"; s=io.open(p,encoding="utf-8").read()
# Go silent on a failed fetch. This is the bug that would lose a real order:
# the shop is never told an order it could not read has arrived.
old="""  // Every remaining case is a failed fetch. The bell still rings.
  return {
    announce: true,"""
new="""  // Every remaining case is a failed fetch. The bell still rings.
  return {
    announce: false,"""
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new))
PY
mutate "M3 a failed fetch goes silent instead of ringing" "$FETCH_CORE" /tmp/m3.py kill

# ---------------------------------------------------------------- M4
cat > /tmp/m4.py <<'PY'
import io
p="src/lib/leafly/order-fetch-core.ts"; s=io.open(p,encoding="utf-8").read()
# Treat a credential failure as retryable. A 401 retried forever looks healthy
# in a dashboard -- the queue keeps draining and refilling -- while every
# single order is quietly lost and nobody is ever told to fix the secret.
old='''  if (status === 401) {
    return {
      disposition: "fix_credentials",'''
new='''  if (status === 401) {
    return {
      disposition: "retry",'''
assert old in s, "401 branch anchor moved"
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M4 a 401 is reported as retryable instead of a credentials fault" "$FETCH_CORE" /tmp/m4.py kill

# --------------------------------------------------------------- M4b
cat > /tmp/m4b.py <<'PY'
import io
p="src/lib/leafly/order-fetch-core.ts"; s=io.open(p,encoding="utf-8").read()
# The whole 401 branch becomes unreachable, so an expired/!wrong secret falls
# through to the undocumented tail. The operator is told "something odd
# happened" instead of "your credentials are wrong" -- a diagnosis that sends
# the shop looking in the wrong place while the fifteen-minute clock runs out.
old='  if (status === 401) {'
assert old in s, "401 guard anchor moved"
io.open(p,"w",encoding="utf-8").write(s.replace(old,'  if (false) {',1))
PY
mutate "M4b the 401 branch is unreachable" "$FETCH_CORE" /tmp/m4b.py kill

# ---------------------------------------------------------------- M5
cat > /tmp/m5.py <<'PY'
import io
p="src/lib/leafly/order-fetch-core.ts"; s=io.open(p,encoding="utf-8").read()
# Print on a failed fetch — hand the printer a payload it cannot render, which
# is the original vanished-receipt bug wearing a different hat.
old='''  if (input.fetch === "success" && input.printable) {'''
new='''  if (input.printable) {'''
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new))
PY
mutate "M5 prints whenever printable, even on a failed fetch" "$FETCH_CORE" /tmp/m5.py kill

# ---------------------------------------------------------------- M6
cat > /tmp/m6.py <<'PY'
import io
p="src/lib/leafly/order-fetch-core.ts"; s=io.open(p,encoding="utf-8").read()
# Drop the knownLocally split, making "expired" indistinguishable from
# "never existed" — two opposite diagnoses from one status code.
old='''  if (status === 404) {'''
assert old in s
i=s.index(old)
s=s[:i]+'''  if (false) {'''+s[i+len(old):]
io.open(p,"w",encoding="utf-8").write(s)
PY
mutate "M6 the 404 branch becomes unreachable" "$FETCH_CORE" /tmp/m6.py kill

# ---------------------------------------------------------------- M7
cat > /tmp/m7.py <<'PY'
import io
p="src/lib/leafly/order-readiness-core.ts"; s=io.open(p,encoding="utf-8").read()
# Typo one webhook path. Leafly would POST to a 404 forever and NOTHING would
# report an error — the silent failure this whole slice exists to end.
old='{ event: "order_cancel", path: "/api/webhooks/leafly/order-cancel", requirement: "required" },'
new='{ event: "order_cancel", path: "/api/webhooks/leafly/order-cancelled", requirement: "required" },'
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new))
PY
mutate "M7 one of the six webhook paths is misspelled" "$READY_CORE" /tmp/m7.py kill

# ---------------------------------------------------------------- M8
cat > /tmp/m8.py <<'PY'
import io
p="src/lib/leafly/order-readiness-core.ts"; s=io.open(p,encoding="utf-8").read()
# Accept a localhost origin. The six URLs would go into an email to Leafly
# pointing at a machine Leafly cannot reach.
old='  if (/localhost|127\\.0\\.0\\.1|\\.local(?::|\\/|$)/i.test(raw)) {'
new='  if (false) {'
assert old in s, "localhost guard anchor moved"
io.open(p,"w",encoding="utf-8").write(s.replace(old,new))
PY
mutate "M8 the localhost guard is removed" "$READY_CORE" /tmp/m8.py kill

# ---------------------------------------------------------------- M9
cat > /tmp/m9.py <<'PY'
import io
p="src/lib/leafly/order-readiness-core.ts"; s=io.open(p,encoding="utf-8").read()
# Claim the webhook step is done because a key is saved. This is the
# overclaiming bug: it would tell the owner setup is finished when the one
# un-checkable step has not been done.
old="      done: input.verifiedDeliveryEverReceived,"
new="      done: input.orderIntegrationKeyPresent,"
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M9 webhook readiness inferred from the key instead of evidence" "$READY_CORE" /tmp/m9.py kill

# --------------------------------------------------------------- M10
cat > /tmp/m10.py <<'PY'
import io
p="src/lib/leafly/order-readiness-core.ts"; s=io.open(p,encoding="utf-8").read()
# Re-hide the panel during setup — literally the owner's fourth symptom.
old="  const anyProgress ="
i=s.index(old)
j=s.index(";", s.index("input.anyOrderEverReceived", i))
s=s[:i]+"  const anyProgress = false"+s[j:]
io.open(p,"w",encoding="utf-8").write(s)
PY
mutate "M10 the setup panel hides again mid-setup" "$READY_CORE" /tmp/m10.py kill

# --------------------------------------------------------------- M11
cat > /tmp/m11.py <<'PY'
import io
p="src/lib/leafly/order-readiness-core.ts"; s=io.open(p,encoding="utf-8").read()
# Make the speaker step blocking. Would nag the shop about a speaker while
# orders were being dropped, and would report "not ready" for a shop whose
# orders arrive fine.
old='''      done: input.speakerReady,
      blocking: false,'''
new='''      done: input.speakerReady,
      blocking: true,'''
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new))
PY
mutate "M11 the speaker becomes a blocking step" "$READY_CORE" /tmp/m11.py kill

# --------------------------------------------------------------- M12
cat > /tmp/m12.py <<'PY'
import io
p="src/lib/leafly/webhook-server.ts"; s=io.open(p,encoding="utf-8").read()
# Unwire the fetch entirely. This restores the ORIGINAL BUG exactly: the
# webhook metadata is stored, the bridge reads it, and the receipt can never
# print. If the suite does not catch this, it does not protect the fix at all.
import re
s2=re.sub(r'const collected = await collectLeaflyOrder\(', 'const collected = await Promise.resolve(', s, count=1)
assert s2 != s, "collect call anchor moved"
io.open(p,"w",encoding="utf-8").write(s2)
PY
mutate "M12 collectLeaflyOrder is no longer called (the original bug)" "$WEBHOOK" /tmp/m12.py kill

# --------------------------------------------------------------- M13
cat > /tmp/m13.py <<'PY'
import io
p="src/app/admin/orders/page.tsx"; s=io.open(p,encoding="utf-8").read()
# Unmount the setup panel. Reproduces "there is nothing in the online orders
# dashboard page that has a Leafly orders section" precisely.
old="          <LeaflyOrderSetupPanel setup={leaflySetup} compact={leaflySetup.readiness.ready} />"
new="          <div />"
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new))
PY
mutate "M13 the setup panel is unmounted from the orders page" "$PAGE" /tmp/m13.py kill

# --------------------------------------------------------- CONTROL
cat > /tmp/mc.py <<'PY'
import io
p="src/lib/leafly/order-fetch-core.ts"; s=io.open(p,encoding="utf-8").read()
# Behaviour-preserving: a comment and a blank line. MUST SURVIVE.
s=s.replace("export type LeaflyFetchEnvironment",
            "// CONTROL MUTANT: this comment changes nothing.\n\nexport type LeaflyFetchEnvironment",1)
io.open(p,"w",encoding="utf-8").write(s)
PY
mutate "CONTROL harmless comment (must survive)" "$FETCH_CORE" /tmp/mc.py survive

echo "=============================================================="
echo "killed:   $KILLED"
echo "survived: $SURVIVED  (1 expected: the control)"
if [ ${#SURVIVORS[@]+${#SURVIVORS[@]}} ] && [ ${#SURVIVORS[@]-0} -gt 0 ]; then
  echo "PROBLEMS:"
  for s in "${SURVIVORS[@]}"; do echo "  - $s"; done
fi
echo "=============================================================="

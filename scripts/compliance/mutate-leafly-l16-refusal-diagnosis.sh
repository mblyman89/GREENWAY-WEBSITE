#!/usr/bin/env bash
#
# mutate-leafly-l16-refusal-diagnosis.sh
#
# Run from the repository root:
#   bash scripts/compliance/mutate-leafly-l16-refusal-diagnosis.sh
#
# Guards SLICE L-16 — the fix for the back-office panel telling the owner
#
#   "Deliveries we refused: 6 — Leafly is reaching us but the signature didn't
#    match. That almost always means the webhook HMAC key here doesn't match
#    the one Leafly issued. Orders are being turned away."
#
# when in fact all six refusals were `missing_header` (unsigned probes, several
# of them run by hand during diagnosis), the integration was healthy, and the
# recommended remedy — re-copy or rotate the HMAC key — would have broken a
# working credential.
#
# EXPECTED RESULT: killed: 16 / survived: 1 (the CONTROL only).
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
# impersonate a plausible real mistake. For every one of them the suite MUST
# fail (the mutant is "killed"). A mutant that SURVIVES is a hole.
#
# The last entry is a CONTROL: a comment-only change that alters no behaviour.
# The control MUST SURVIVE. If the control dies, the suite is reacting to
# something other than behaviour — brittle, and it would fail on every innocent
# refactor — which is its own kind of broken.
# =============================================================================
set -u

TESTS="tests/compliance/leafly-refusal-diagnosis.test.ts tests/compliance/leafly-order-fetch.test.ts"

DIAG="src/lib/leafly/refusal-diagnosis-core.ts"
READY="src/lib/leafly/order-readiness-core.ts"
ORDERABILITY="src/lib/leafly/orderability-core.ts"

KILLED=0
SURVIVED=0
declare -a SURVIVORS

run_suite() {
  npx vitest run $TESTS >/dev/null 2>&1
  return $?
}

# mutate <label> <file> <python-script> <expect: kill|survive>
mutate() {
  local label="$1" file="$2" script="$3" expect="$4"
  cp "$file" "$file.bak"
  if ! python3 "$script"; then
    echo "  [SKIP] $label — mutation could not be applied (anchor moved)"
    mv "$file.bak" "$file"
    return
  fi
  if run_suite; then
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
echo "MUTATION ROUND — SLICE L-16 (refusal diagnosis / empty cart)"
echo "=============================================================="

# ---------------------------------------------------------------- M1
# THE ORIGINAL BUG, REINSTATED. Make every unsigned probe blame Leafly. This is
# literally what the old panel did, so if the suite cannot kill this mutant it
# cannot detect the defect it was written for.
cat > /tmp/l16m1.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="""    case "missing_header":
    case "empty_header":
    case "empty_body":
    case "malformed_header":
      return "not_leafly";"""
new="""    case "missing_header":
    case "empty_header":
    case "empty_body":
    case "malformed_header":
      return "leafly";"""
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M1 unsigned probes blame Leafly again (the original defect)" "$DIAG" /tmp/l16m1.py kill

# ---------------------------------------------------------------- M2
# The inverse: a genuine mismatch stops implicating Leafly. The owner would
# never be told to contact them about a real key rotation.
cat > /tmp/l16m2.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="""    case "mismatch":
      return "leafly";"""
new="""    case "mismatch":
      return "not_leafly";"""
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M2 a real mismatch no longer points at Leafly" "$DIAG" /tmp/l16m2.py kill

# ---------------------------------------------------------------- M3
# Break agreement with hmac-core about whose fault a missing key is. hmac-core
# uses the same judgement to choose 503 over 401; a disagreement puts two
# different answers about one delivery on two different screens.
cat > /tmp/l16m3.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="""    case "missing_key":
    case "digest_unavailable":
      return "us";"""
new="""    case "missing_key":
    case "digest_unavailable":
      return "not_leafly";"""
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M3 our own missing key is no longer ours to fix" "$DIAG" /tmp/l16m3.py kill

# ---------------------------------------------------------------- M4
# Drop a reason from the pinned vocabulary. Guards the drift pin: a reason
# hmac-core can emit but this module has never heard of must not slip through.
cat > /tmp/l16m4.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old='  "malformed_header",\n  "digest_unavailable",\n  "mismatch",\n] as const;'
new='  "digest_unavailable",\n  "mismatch",\n] as const;'
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M4 a reason is dropped from the pinned vocabulary" "$DIAG" /tmp/l16m4.py kill

# ---------------------------------------------------------------- M5
# Reverse the precedence so an unsaved key sends the owner to email Leafly.
# With no key saved every signature ALSO fails to match, so both buckets fill;
# this is the wild-goose-chase the ordering exists to prevent.
cat > /tmp/l16m5.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="  if (!input.hmacKeyPresent || b.oursCount > 0) {"
new="  if (false && (!input.hmacKeyPresent || b.oursCount > 0)) {"
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M5 our-config no longer outranks key_mismatch" "$DIAG" /tmp/l16m5.py kill

# ---------------------------------------------------------------- M6
# Make the "healthy" branch unreachable, so zero refusals reports a fault.
cat > /tmp/l16m6.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="  if (b.total === 0) {"
new="  if (b.total === -1) {"
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M6 a clean log no longer reads healthy" "$DIAG" /tmp/l16m6.py kill

# ---------------------------------------------------------------- M7
# Let the noise_only verdict tell the owner to contact Leafly. This is the
# precise sentence that cost the owner a day.
cat > /tmp/l16m7.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="""    verdict: "noise_only",
    headline: "Nothing here was actually Leafly.","""
new="""    verdict: "noise_only",
    contactLeafly: true,
    headline: "Nothing here was actually Leafly.","""
assert old in s
s=s.replace(old,new,1)
# remove the later, now-duplicate, false assignment
s=s.replace("""    contactLeafly: false,
    actionIsOurs: false,
    breakdown: b,
  };
}

/* ---""","""    actionIsOurs: false,
    breakdown: b,
  };
}

/* ---""",1)
io.open(p,"w",encoding="utf-8").write(s)
PY
mutate "M7 noise-only refusals advise contacting Leafly" "$DIAG" /tmp/l16m7.py kill

# ---------------------------------------------------------------- M8
# Fold an absent reason into a known one, so "(no reason recorded)" is guessed
# at instead of reported. Guards "never guess".
cat > /tmp/l16m8.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old='    const key = raw === "" ? "(no reason recorded)" : raw;'
new='    const key = raw === "" ? "mismatch" : raw;'
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M8 a missing reason is guessed as a mismatch" "$DIAG" /tmp/l16m8.py kill

# ---------------------------------------------------------------- M9
# Break the deterministic bucket ordering, which is what stops the panel
# flickering between renders on equal counts.
cat > /tmp/l16m9.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="    .sort((a, b) => (b.count - a.count) || a.reason.localeCompare(b.reason));"
new="    .sort((a, b) => (a.count - b.count) || a.reason.localeCompare(b.reason));"
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M9 buckets sorted smallest-first, so the panel reorders" "$DIAG" /tmp/l16m9.py kill

# ---------------------------------------------------------------- M10
# Let an unsigned probe block checkout. This reintroduces the false alarm in
# its most damaging form: the system would declare checkout broken because a
# scanner touched a public URL.
cat > /tmp/l16m10.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old='    if (owner === "leafly" || owner === "us") return true;'
new='    if (owner === "leafly" || owner === "us" || owner === "not_leafly") return true;'
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M10 unsigned scanner hits block checkout" "$DIAG" /tmp/l16m10.py kill

# ---------------------------------------------------------------- M11
# Treat an untimestamped refusal as old and drop it, deciding it is ancient on
# no evidence at all.
cat > /tmp/l16m11.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="""    if (!Number.isFinite(at)) {
      kept.push(row);
      continue;
    }"""
new="""    if (!Number.isFinite(at)) {
      continue;
    }"""
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M11 an untimestamped refusal is assumed to be old" "$DIAG" /tmp/l16m11.py kill

# ---------------------------------------------------------------- M12
# Flip the window boundary from >= to >, the classic off-by-one.
cat > /tmp/l16m12.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="    if (at >= cutoff) kept.push(row);"
new="    if (at > cutoff + 60_000) kept.push(row);"
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M12 the recency boundary is shifted by a minute" "$DIAG" /tmp/l16m12.py kill

# ---------------------------------------------------------------- M13
# Shrink the recency window below Leafly's own 15-minute auto-cancel, so a
# live order's refusal could age out while the owner is still reading about it.
cat > /tmp/l16m13.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="export const REFUSAL_RECENCY_MINUTES = 120;"
new="export const REFUSAL_RECENCY_MINUTES = 5;"
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M13 recency window shrinks below Leafly's 15-minute cancel" "$DIAG" /tmp/l16m13.py kill

# ---------------------------------------------------------------- M14
# Stop naming the pickup toggle as an empty-cart cause. This is the trap that
# empties a cart while every indicator reads green.
cat > /tmp/l16m14.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="  if (!input.pickupAvailabilityEnabled) {"
new="  if (false) {"
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M14 pickup-disabled is no longer named as an empty-cart cause" "$DIAG" /tmp/l16m14.py kill

# ---------------------------------------------------------------- M15
# Tick off the pickup step when the setting could not be READ, which is how a
# shop that cannot sell would read READY again.
cat > /tmp/l16m15.py <<'PY'
import io
p="src/lib/leafly/order-readiness-core.ts"; s=io.open(p,encoding="utf-8").read()
old="      done: input.pickupAvailabilityEnabled === true,"
new="      done: input.pickupAvailabilityEnabled !== false,"
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M15 an unreadable pickup setting is ticked off as done" "$READY" /tmp/l16m15.py kill

# ---------------------------------------------------------------- M16
# THE SAFETY MUTANT. Make the pickup toggle outrank the WAC 246-70 statutory
# block, so a DOH High-THC product becomes orderable. This is the mutant that
# matters most: slice L-16 deliberately did NOT "fix" the empty cart in the
# preview route precisely because these two removals are indistinguishable, and
# this asserts the ordering that makes the statutory block win when it applies.
cat > /tmp/l16m16.py <<'PY'
import io
p="src/lib/leafly/orderability-core.ts"; s=io.open(p,encoding="utf-8").read()
old="""  if (isDohCategoryBlockedFromPickup(input.dohCategory)) {
    return { availableForPickup: false, reason: "doh_restricted" };
  }"""
new="""  if (false && isDohCategoryBlockedFromPickup(input.dohCategory)) {
    return { availableForPickup: false, reason: "doh_restricted" };
  }"""
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "M16 a DOH High-THC product becomes orderable (WAC 246-70)" "$ORDERABILITY" /tmp/l16m16.py kill

# ---------------------------------------------------------------- CONTROL
# A comment-only change. Behaviour is identical, so the suite MUST still pass.
cat > /tmp/l16ctl.py <<'PY'
import io
p="src/lib/leafly/refusal-diagnosis-core.ts"; s=io.open(p,encoding="utf-8").read()
old="export const REFUSAL_RECENCY_MINUTES = 120;"
new="// CONTROL MUTANT: comment only, no behaviour change.\nexport const REFUSAL_RECENCY_MINUTES = 120;"
assert old in s
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
mutate "CONTROL comment-only edit (must survive)" "$DIAG" /tmp/l16ctl.py survive

echo "=============================================================="
echo "killed: $KILLED / survived: $SURVIVED"
if [ "${#SURVIVORS[@]}" -gt 0 ] 2>/dev/null; then
  echo "HOLES FOUND:"
  for s in "${SURVIVORS[@]}"; do echo "  - $s"; done
  exit 1
fi
echo "No holes. Every mutant killed; the control survived."
echo "=============================================================="

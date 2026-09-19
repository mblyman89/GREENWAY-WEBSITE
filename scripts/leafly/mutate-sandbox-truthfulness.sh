#!/usr/bin/env bash
#
# Mutation testing for the three Leafly sandbox defects fixed in this branch.
#
# Each mutant below RESTORES one of the original defects exactly as it shipped.
# All three were defects of TRUTHFULNESS, not of crashing: the system was
# working correctly and reporting that it was not, or reporting a pass it had
# not earned. Nothing threw, nothing 500'd, and every existing test stayed
# green - which is precisely why they survived to be found by eye in a
# screenshot review.
#
# So the bar here is: if the original wording/logic comes back, something must
# go red. A mutant that survives means the fix is unprotected. A mutant whose
# anchor cannot be found is ALSO a failure - an unapplied mutation tested
# nothing, and scoring it as "caught" would be a lie.
#
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

PASS=0
FAIL=0

EVID="src/lib/leafly/evidence-core.ts"
CERT="src/lib/leafly/certification-core.ts"
PAGE="src/app/admin/integrations/leafly/page.tsx"

BACKUP="$(mktemp -d)"
trap 'restore; rm -rf "$BACKUP"' EXIT
for f in "$EVID" "$CERT" "$PAGE"; do
  mkdir -p "$BACKUP/$(dirname "$f")"; cp "$f" "$BACKUP/$f"
done
restore() { for f in "$EVID" "$CERT" "$PAGE"; do [ -f "$BACKUP/$f" ] && cp "$BACKUP/$f" "$f"; done; }

# The pure self-tests are the fast, precise net. The vitest suites are the
# backstop for anything the cores do not model.
verify() {
  cat > scripts/_mutcheck.ts <<'EOF'
import { __runLeaflyEvidenceTests } from "@/lib/leafly/evidence-core";
import { __runLeaflyCertificationTests } from "@/lib/leafly/certification-core";
const a = __runLeaflyEvidenceTests();
const b = __runLeaflyCertificationTests();
if (a.failed || b.failed) process.exit(1);
EOF
  local rc=0
  npx tsx scripts/_mutcheck.ts >/dev/null 2>&1 || rc=1
  rm -f scripts/_mutcheck.ts
  return $rc
}

run_mutant() {
  local desc="$1"; shift
  local applied
  applied="$("$@" 2>/dev/null)"
  if [ "$applied" != "APPLIED" ]; then
    echo "  [FAIL] $desc"
    echo "         -> anchor not found; the mutation never applied, so it proved nothing."
    FAIL=$((FAIL + 1)); restore; return
  fi
  if verify; then
    echo "  [SURVIVED] $desc"
    FAIL=$((FAIL + 1))
  else
    echo "  [caught] $desc"
    PASS=$((PASS + 1))
  fi
  restore
}

echo "=================================================================="
echo " Leafly sandbox truthfulness - mutation run"
echo "=================================================================="
echo ""
echo "Defect (a): an unsigned probe was reported as a key problem"

m_a1() {
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
old = '  if (isUnsignedRequest(reason as LeaflyHmacFailureReason)) return "rejected_unsigned";\n'
assert old in s, "anchor"
open(p, "w").write(s.replace(old, ""))
PY
}
run_mutant "missing_header collapses back into 'bad signature'" m_a1

m_a2() {
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
old = 'return reason === "missing_header";'
assert old in s, "anchor"
open(p, "w").write(s.replace(old, 'return reason === "empty_header";', 1))
PY
}
run_mutant "the unsigned test points at the wrong reason" m_a2

m_a3() {
  # The advice is the deliverable. Put the key-rotation instruction back into
  # the unsigned explanation and the owner is told to change a working secret.
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
old = '"and must NOT be changed because of these."'
assert old in s, "anchor"
open(p, "w").write(s.replace(old, '"so re-copy the HMAC key from Leafly to be safe."', 1))
PY
}
run_mutant "unsigned advice tells the owner to re-copy a working HMAC key" m_a3

m_a4() {
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
old = '''    case "rejected_unsigned":
      // Deliberately "info", not "bad".'''
assert old in s, "anchor"
s = s.replace('''    case "rejected_unsigned":
      // Deliberately "info", not "bad". An unsigned request turned away is the
      // door being locked, not the lock being broken. Painting routine internet
      // background noise red is how a dashboard teaches its owner that red
      // means nothing.
      return "info";''', '''    case "rejected_unsigned":
      return "bad";''', 1)
open(p, "w").write(s)
PY
}
run_mutant "routine scanner traffic is painted red again" m_a4

echo ""
echo "Defect (b): reachability passed on traffic that was not Leafly"

m_b1() {
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
old = 'status: summary.verified > 0 ? "pass" : "unknown",'
assert old in s, "anchor"
open(p, "w").write(s.replace(old, 'status: summary.total === 0 ? "unknown" : "pass",', 1))
PY
}
run_mutant "ANY logged request proves 'Leafly can reach us' (the original bug)" m_b1

m_b2() {
  # Subtler: counts unsigned traffic as reachability by using total, not verified.
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
old = 'status: summary.verified > 0 ? "pass" : "unknown",'
assert old in s, "anchor"
open(p, "w").write(s.replace(old, 'status: summary.total > 0 ? "pass" : "unknown",', 1))
PY
}
run_mutant "reachability keys off total instead of verified" m_b2

m_b3() {
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
old = 'status: signedAttempts === 0 ? "unknown" : badlySigned === 0 ? "pass" : "fail",'
assert old in s, "anchor"
open(p, "w").write(s.replace(old, 'status: summary.total === 0 ? "unknown" : summary.unverified === 0 ? "pass" : "fail",', 1))
PY
}
run_mutant "refused scanners make HMAC handling look broken again" m_b3

echo ""
echo "Defect (c): a successful status check did not count as authentication"

m_c1() {
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/certification-core.ts"
s = open(p).read()
old = '  if (attempts.some((a) => isSuccess(a.httpStatus))) return true;'
assert old in s, "anchor"
open(p, "w").write(s.replace(old, '  if (attempts.some((a) => isSuccess(a.httpStatus) && a.kind === "menu push")) return true;', 1))
PY
}
run_mutant "only a menu push counts as proof (the original bug)" m_c1

m_c2() {
  # A 500 reported as a credential failure sends the owner to rotate a good key.
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/certification-core.ts"
s = open(p).read()
old = '  if (attempts.some((a) => a.httpStatus === 401 || a.httpStatus === 403)) return false;\n\n  return null;'
assert old in s, "anchor"
open(p, "w").write(s.replace(old, '  return false;', 1))
PY
}
run_mutant "any non-2xx is blamed on our credentials" m_c2

m_c3() {
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/certification-core.ts"
s = open(p).read()
old = '  if (attempts.length === 0) return null;'
assert old in s, "anchor"
open(p, "w").write(s.replace(old, '  if (attempts.length === 0) return false;', 1))
PY
}
run_mutant "never having called Leafly is reported as a FAILED login" m_c3

m_c4() {
  # The remedy must name the control that actually clears the criterion.
  python3 - <<'PY' && echo APPLIED
p = "src/lib/leafly/certification-core.ts"
s = open(p).read()
old = "Press 'Check integration status' on this page."
assert old in s, "anchor"
open(p, "w").write(s.replace(old, "Push the menu once to prove authentication.", 1))
PY
}
run_mutant "the untested remedy stops naming the button that clears it" m_c4

echo ""
echo "=================================================================="
echo " caught: $PASS    survived/not-applied: $FAIL"
echo "=================================================================="
[ "$FAIL" -eq 0 ] || exit 1
echo "Every mutant was caught."

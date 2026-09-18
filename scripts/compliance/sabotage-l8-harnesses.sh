#!/usr/bin/env bash
# scripts/compliance/sabotage-l8-harnesses.sh   (SLICE L-8)
#
# ── "TEST THE TESTS", ONE LEVEL UP ──────────────────────────────────────────
# The mutation sweep (mutate-leafly-l8.py) proves the SELF-TESTS can catch a
# defect in the core. This script proves the GUARDS THEMSELVES can fail --
# i.e. that the assertion floors, the compliance gate and the privacy refusal
# are load-bearing rather than decorative.
#
# The distinction matters. A gate that cannot fail is worse than no gate: it
# occupies the space where a real check should be and reports success forever.
# The only way to know a guard works is to break the thing it guards and watch
# it complain.
#
# Every sabotage is applied to a backup-protected copy and reverted
# immediately. Every file is md5-verified byte-identical at the end.
#
# USAGE:  bash scripts/compliance/sabotage-l8-harnesses.sh
# EXIT :  0 = every guard proved able to fail;  non-zero = a guard is dead.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

PASS=0
FAIL=0
TMP="$(mktemp -d)"
declare -A ORIG_MD5

CORE="src/lib/leafly/evidence-core.ts"
SERVER="src/lib/leafly/evidence-server.ts"
PANEL="src/components/admin/syndication/LeaflyEvidencePanel.tsx"
ROUTE="src/app/admin/integrations/leafly/evidence-export/route.ts"
PAGE="src/app/admin/integrations/leafly/page.tsx"
REGISTRY="scripts/compliance/run-pure-selftests.ts"
GATE="tests/compliance/leafly-evidence-readable.test.ts"

FILES=("$CORE" "$SERVER" "$PANEL" "$ROUTE" "$PAGE" "$REGISTRY" "$GATE")

backup() {
  for f in "${FILES[@]}"; do
    cp "$f" "$TMP/$(echo "$f" | tr '/' '_')"
    ORIG_MD5["$f"]="$(md5sum "$f" | cut -d' ' -f1)"
  done
}

restore() {
  for f in "${FILES[@]}"; do
    cp "$TMP/$(echo "$f" | tr '/' '_')" "$f"
  done
}

verify_restored() {
  local bad=0
  for f in "${FILES[@]}"; do
    local now
    now="$(md5sum "$f" | cut -d' ' -f1)"
    if [[ "$now" != "${ORIG_MD5[$f]}" ]]; then
      echo "  !! $f NOT restored byte-identically (${ORIG_MD5[$f]} -> $now)"
      bad=1
    fi
  done
  return $bad
}

trap 'restore; rm -rf "$TMP"' EXIT

# run_gate <testfile> -> 0 if the vitest gate PASSES
run_gate() {
  npx vitest run "$1" --no-file-parallelism --maxWorkers=1 --reporter=dot >/dev/null 2>&1
}

# run_registry -> 0 if the pure self-test registry PASSES
run_registry() {
  npx tsx "$REGISTRY" >/dev/null 2>&1
}

# expect_fail <label> <command...>
# The command MUST fail. If it passes, the guard is dead.
expect_fail() {
  local label="$1"; shift
  if "$@"; then
    echo "  FAIL: $label -- the guard PASSED while sabotaged (it cannot fail)"
    FAIL=$((FAIL + 1))
  else
    echo "  ok:   $label -- guard correctly failed"
    PASS=$((PASS + 1))
  fi
}

# expect_pass <label> <command...>
expect_pass() {
  local label="$1"; shift
  if "$@"; then
    echo "  ok:   $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label -- expected a PASS on the untouched tree"
    FAIL=$((FAIL + 1))
  fi
}

backup

echo "======================================================================"
echo "L-8 HARNESS SABOTAGE"
echo "======================================================================"

echo
echo "[0] Baseline -- everything must pass BEFORE we break anything."
echo "    Without this, every 'guard correctly failed' below could be a"
echo "    pre-existing failure rather than a reaction to the sabotage."
expect_pass "pure self-test registry passes untouched" run_registry
expect_pass "evidence compliance gate passes untouched" run_gate "$GATE"

echo
echo "[1] Sabotage the ASSERTION FLOOR."
echo "    The registry floors leafly-evidence-core at 300. If the suite were"
echo "    gutted to a handful of assertions, the floor is the only thing that"
echo "    notices. Raise it above the real count and it must complain."
python3 - <<'PY'
p = "scripts/compliance/run-pure-selftests.ts"
s = open(p).read()
frm = 'assertRan("leafly-evidence-core", __runLeaflyEvidenceTests(), 300);'
to  = 'assertRan("leafly-evidence-core", __runLeaflyEvidenceTests(), 99999);'
assert s.count(frm) == 1, "floor line not found"
open(p, "w").write(s.replace(frm, to))
PY
expect_fail "registry floor rejects an impossible minimum" run_registry
restore

echo
echo "[2] Sabotage the SELF-TESTS' OWN ok() FUNCTION."
echo "    Force ok() to count a FALSE condition as a pass. Every assertion in"
echo "    the core becomes meaningless, the reported count stays high, and the"
echo "    floor is satisfied. Only a real assertion about a real value catches"
echo "    this -- so the gate must fail."
python3 - <<'PY'
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
frm = """  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else failures.push(msg);
  };"""
to = """  const ok = (cond: boolean, msg: string) => {
    void cond; void msg;
    passed += 1;
  };"""
assert s.count(frm) == 1, "ok() not found"
open(p, "w").write(s.replace(frm, to))
PY
# With ok() neutered, the core's own suite can no longer fail. The proof that
# this is DETECTED has to come from the mutation sweep's baseline, so here we
# assert the more subtle property: a neutered ok() plus a broken rule must be
# caught by the INDEPENDENT vitest gate, which checks real values.
python3 - <<'PY'
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
frm = """  const n = normalizeEvidenceKey(key);
  return EVIDENCE_FORBIDDEN_KEYS.some((bad) => n.includes(bad));"""
to = """  const n = normalizeEvidenceKey(key);
  void n;
  return false;"""
assert s.count(frm) == 1, "privacy guard not found"
open(p, "w").write(s.replace(frm, to))
PY
expect_fail "compliance gate catches a disabled privacy guard even with ok() neutered" run_gate "$GATE"
restore

echo
echo "[3] Sabotage the PRIVACY AUDIT in the bundle builder."
echo "    Add a real PII column to the export. The gate must refuse."
python3 - <<'PY'
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
frm = '      { key: "bodySha256", header: "Body SHA-256" },'
to  = '      { key: "bodySha256", header: "Body SHA-256" },\n      { key: "phoneNumber", header: "Customer phone" },'
assert s.count(frm) == 1, "deliveries columns not found"
open(p, "w").write(s.replace(frm, to))
PY
expect_fail "compliance gate catches a PII column added to the export" run_gate "$GATE"
restore

echo
echo "[4] Sabotage the READER -- unmount the panel."
echo "    This is the EXACT regression L-8 exists to prevent: the evidence log"
echo "    going write-only again. Remove the render and the gate must fail."
python3 - <<'PY'
p = "src/app/admin/integrations/leafly/page.tsx"
s = open(p).read()
frm = "      <LeaflyEvidencePanel view={evidence} nowIso={nowIso} />"
to  = "      {/* unmounted by sabotage */}"
assert s.count(frm) == 1, "panel mount not found"
open(p, "w").write(s.replace(frm, to))
PY
expect_fail "compliance gate catches the evidence panel being unmounted" run_gate "$GATE"
restore

echo
echo "[5] Sabotage the SERVER -- reintroduce select(*)."
echo "    select(*) on leafly_orders would pull raw_order, which per Leafly's"
echo "    own schema contains the customer's name, email and phone."
python3 - <<'PY'
p = "src/lib/leafly/evidence-server.ts"
s = open(p).read()
frm = '        .select(EVIDENCE_ORDER_COLUMNS)\n        .order("first_seen_at", { ascending: false })\n        .limit(EVIDENCE_ORDER_LIMIT),'
to  = '        .select("*")\n        .order("first_seen_at", { ascending: false })\n        .limit(EVIDENCE_ORDER_LIMIT),'
assert s.count(frm) >= 1, "order select not found"
open(p, "w").write(s.replace(frm, to, 1))
PY
expect_fail "compliance gate catches select(*) in the evidence server" run_gate "$GATE"
restore

echo
echo "[6] Sabotage the APPEND-ONLY promise -- give the reader a write."
echo "    The delivery log is evidence. A reader that can mutate it is not a"
echo "    reader, and the gate must say so."
python3 - <<'PY'
p = "src/lib/leafly/evidence-server.ts"
s = open(p).read()
frm = "    const admin = createSupabaseAdminClient();\n\n    const [eventsRes, ordersRes, totalRes, unverifiedRes] = await Promise.all(["
to  = '    const admin = createSupabaseAdminClient();\n    await admin.from("leafly_webhook_events").update({ processed_at: null }).eq("id", "x");\n\n    const [eventsRes, ordersRes, totalRes, unverifiedRes] = await Promise.all(['
assert s.count(frm) == 1, "admin client block not found"
open(p, "w").write(s.replace(frm, to))
PY
expect_fail "compliance gate catches a write added to the read-only reader" run_gate "$GATE"
restore

echo
echo "[7] Sabotage the EXPORT ROUTE's fail-closed refusal."
echo "    Remove the privacyViolations check and the route would happily serve"
echo "    a file containing customer data. The gate must fail."
python3 - <<'PY'
p = "src/app/admin/integrations/leafly/evidence-export/route.ts"
s = open(p).read()
frm = "  if (built.bundle.privacyViolations.length > 0) {"
to  = "  if (false) {"
assert s.count(frm) == 1, "privacy refusal not found"
open(p, "w").write(s.replace(frm, to))
PY
expect_fail "compliance gate catches the export's privacy refusal being removed" run_gate "$GATE"
restore

echo
echo "[8] Sabotage the SPEC CROSS-CHECK."
echo "    The gate reads Leafly's vendored OpenAPI spec and asserts every"
echo "    personal Order field is forbidden. Drop one from our list and it"
echo "    must notice -- this is what makes the guard survive a spec update."
python3 - <<'PY'
p = "src/lib/leafly/evidence-core.ts"
s = open(p).read()
frm = '  "dateofbirth",\n  "dob",'
to  = '  "dob",'
assert s.count(frm) == 1, "dob entries not found"
open(p, "w").write(s.replace(frm, to))
PY
expect_fail "compliance gate catches dateOfBirth dropped from the forbidden list" run_gate "$GATE"
restore

echo
echo "[9] Sabotage the REGISTRY REGISTRATION."
echo "    A core that is not registered runs nowhere in CI. The gate asserts"
echo "    the assertRan() line exists; remove it and it must fail."
python3 - <<'PY'
p = "scripts/compliance/run-pure-selftests.ts"
s = open(p).read()
frm = '  assertRan("leafly-evidence-core", __runLeaflyEvidenceTests(), 300);'
to  = "  // deregistered by sabotage"
assert s.count(frm) == 1, "registration not found"
open(p, "w").write(s.replace(frm, to))
PY
expect_fail "compliance gate catches the core being deregistered" run_gate "$GATE"
restore

echo
echo "[10] Confirm the tree is clean and everything passes again."
expect_pass "registry passes after all sabotage reverted" run_registry
expect_pass "compliance gate passes after all sabotage reverted" run_gate "$GATE"

echo
echo "======================================================================"
echo "Byte-identical restoration check"
echo "======================================================================"
if verify_restored; then
  echo "  ok: all ${#FILES[@]} files restored byte-identically"
  PASS=$((PASS + 1))
else
  echo "  FAIL: at least one file was not restored"
  FAIL=$((FAIL + 1))
fi

echo
echo "======================================================================"
echo "RESULT: $PASS passed, $FAIL failed"
echo "======================================================================"
if [[ "$FAIL" -ne 0 ]]; then
  echo "At least one guard could not be made to fail, or a file was not restored."
  exit 1
fi
# Non-vacuity: this script must actually have run its sections.
if [[ "$PASS" -lt 14 ]]; then
  echo "FATAL: only $PASS checks ran; expected at least 14. Did a section exit early?"
  exit 2
fi
echo "Every L-8 guard was proven able to fail, and every file was restored."
exit 0

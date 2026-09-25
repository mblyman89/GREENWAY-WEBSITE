#!/usr/bin/env bash
# SLICE L-45 mutation check: each mutation MUST make the pinned tests fail.
# Run from repo root. Restores every file afterwards.
#
# "Test it, test the tests." A green suite proves the tests RAN; this proves
# they BITE. Every anchor must appear exactly once, so a silently-missed edit
# is reported as SKIP (a failure), never as a false "killed".
#
# The pure self-tests also run through the standalone entry point, which
# enforces the assertion floors, because some mutations are designed to be
# caught by the embedded self-test rather than by a vitest case.
set -u
TESTS="tests/compliance/leafly-l45-retailer-key.test.ts tests/compliance/pure-selftests.test.ts tests/compliance/leafly-l43-hmac.test.ts tests/compliance/leafly-setup-panel-render.test.tsx"
pass=0; fail=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/l45-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a[:80]); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/l45-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/l45-mut.log 2>&1 && npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/l45-mut-pure.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/l45-mut-backup "$file"
}

C=src/lib/leafly/retailer-key-core.ts
W=src/lib/leafly/webhook-server.ts
S=src/lib/leafly/order-readiness-server.ts
P=src/components/admin/orders/LeaflyOrderSetupPanel.tsx
E=src/app/admin/integrations/CredentialsEditor.tsx

# -- the core: resolution ----------------------------------------------------
mutate "core: no menu fallback"                 $C '  if (menu !== null) return { key: menu, source: "menu_key", agreement };' '  if (false) return { key: menu, source: "menu_key", agreement };'
mutate "core: menu key wins over order box"     $C '  if (order !== null) return { key: order, source: "order_key", agreement };' '  if (order !== null && menu === null) return { key: order, source: "order_key", agreement };'
mutate "core: whitespace not trimmed"           $C '  const v = value.trim();' '  const v = value;'
mutate "core: case-folded"                      $C '  const v = value.trim();' '  const v = value.trim().toLowerCase();'
mutate "core: sameKey always true"              $C '  if (a === null || b === null) return false;
  return timingSafeStringEqual(a, b);' '  if (a === null || b === null) return false;
  return true;'
mutate "core: agreement never different"        $C 'agreement = sameKey(order, menu) ? "same" : "different";' 'agreement = "same";'

# -- the core: webhook check -------------------------------------------------
mutate "core: action becomes drop"              $C 'export const WEBHOOK_KEY_CHECK_ACTION = "process" as const;' 'export const WEBHOOK_KEY_CHECK_ACTION = "drop" as const;'
mutate "core: mismatch not an alarm"            $C '  return make(
    "mismatch",
    true,' '  return make(
    "mismatch",
    false,'
mutate "core: body_missing not an alarm"        $C '      "body_missing",
      true,' '      "body_missing",
      false,'
mutate "core: match_other_box collapses"        $C '  if (sameKey(body, other)) {' '  if (false) {'
mutate "core: note leaks the body key"          $C '    "retailer key: Leafly sent an orderIntegrationKey that matches NEITHER saved key - re-copy it from Leafly; processed anyway",' '    `retailer key: Leafly sent ${body} which matches NEITHER saved key - processed anyway`,'

# -- the core: evidence ------------------------------------------------------
mutate "core: unverified rows counted"          $C '    if (row.signatureVerified !== true) continue;' '    void row.signatureVerified;'
mutate "core: mismatch never warns"             $C '  if (counts.mismatch > 0) {' '  if (false) {'
mutate "core: wrong box named"                  $C '    const wrongBox = resolved.source === "order_key" ? "fix_order_box" : "fix_menu_box";' '    const wrongBox = resolved.source === "order_key" ? "fix_menu_box" : "fix_order_box";'

# -- the handler -------------------------------------------------------------
mutate "handler: loader ignores menu key"       $W '    const menuKey = leafly.menuIntegrationKey ?? null;
    return' '    const menuKey = null;
    return'
mutate "handler: note never logged"             $W '  if (keyCheck.alarm) notes.push(keyCheck.note);' '  void keyCheck;'
mutate "handler: mismatch drops the delivery"   $W '  if (keyCheck.alarm) notes.push(keyCheck.note);' '  if (keyCheck.outcome === "mismatch") return { status: 200, admission: admission.action, parsed, duplicate: false, logLine: keyCheck.note };'
mutate "handler: second credentials read"       $W '  const { verdict, bodySha256, retailerKeys } = await verifyInboundLeaflyWebhook(rawBody, headers);' '  const { verdict, bodySha256 } = await verifyInboundLeaflyWebhook(rawBody, headers);
  const _rk = await loadLeaflyRetailerKey();
  const retailerKeys = { orderKey: _rk.orderKey, menuKey: _rk.menuKey };'
mutate "handler: menu key stands in for HMAC"   $W '    hmacKey = leafly.hmacKey?.trim() || null;' '    hmacKey = leafly.hmacKey?.trim() || leafly.menuIntegrationKey?.trim() || null;'
mutate "handler: order box stands in for HMAC"  $W '    hmacKey = leafly.hmacKey?.trim() || null;' '    hmacKey = leafly.hmacKey?.trim() || leafly.orderIntegrationKey?.trim() || null;'
mutate "handler: store throw fails open"        $W '  } catch {
    /* fail closed: hmacKey stays null */
  }' '  } catch {
    hmacKey = "l45-test-hmac-key";
  }'

# -- evidence reader + panel + editor ----------------------------------------
mutate "reader: stops selecting the key"        $S '.select("event_type, signature_verified, received_at, rejection_reason, order_integration_key")' '.select("event_type, signature_verified, received_at, rejection_reason")'
mutate "reader: invents a verdict without keys" $S '        : null,
      problem: "",' '        : summarizeRetailerKeyEvidence({ rows: [], orderKey: null, menuKey: null }),
      problem: "",'
mutate "panel: warning never shown"             $P '        {evidence.retailerKey?.warn ? (' '        {false ? ('
mutate "panel: shown even when all match"       $P '        {evidence.retailerKey?.warn ? (' '        {evidence.retailerKey ? ('
mutate "editor: old both-required copy"         $E 'integration key box blank and the Menu key is used.' 'integration key box blank and the Menu key is used. Both of these are required'
mutate "editor: agreement line dropped"         $E '        {keyAgreement ? (' '        {false && keyAgreement ? ('

echo "L-45 mutations: killed=$pass survived_or_skipped=$fail"
[ "$fail" -eq 0 ]

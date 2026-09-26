#!/usr/bin/env bash
# SLICE L-48 mutation check: each mutation MUST make the pinned tests fail.
# Run from repo root. Restores every file afterwards.
#
# "Test it, test the tests." A green suite proves the tests RAN; this proves
# they BITE. Every anchor must appear exactly once, so a silently-missed edit
# is reported as SKIP (a failure), never as a false "killed".
set -u
TESTS="tests/compliance/leafly-l48-cart-server.test.ts tests/compliance/leafly-l48-cart-register.test.ts"
for t in $TESTS; do [ -f "$t" ] || { echo "missing test file $t"; exit 2; }; done
pass=0; fail=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/l48-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a[:80]); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/l48-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/l48-mut.log 2>&1 && npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/l48-mut-pure.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/l48-mut-backup "$file"
}

# BASELINE GATE: if the pinned tests are not green unmutated, every mutation
# would look "killed". Refuse to run rather than report false kills.
if ! npx vitest run $TESTS > /tmp/l48-mut-base.log 2>&1 || ! npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/l48-mut-base-pure.log 2>&1; then
  echo "BASELINE NOT GREEN - fix the tests first (see /tmp/l48-mut-base*.log)"; exit 2
fi
echo "baseline green"

C=src/lib/leafly/order-cart-core.ts
S=src/lib/leafly/order-cart-server.ts
A=src/lib/leafly/order-ack-server.ts
R=src/app/api/pos/pickup/route.ts
P=src/lib/pos/pickup-store.ts
X=src/app/admin/orders/leafly-actions.ts
E=src/components/admin/orders/LeaflyCartEditor.tsx
W=src/components/admin/orders/LeaflyOrderWorkflow.tsx
G=src/app/pos/RegisterCartEditor.tsx
H=src/app/pos/RegisterShell.tsx

# -- the pure core (gates) --------------------------------------------------------
mutate "core: unacknowledged order allowed"        $C '  if ((input.acknowledgedAt ?? "").trim() === "") {' '  if (false) {'
mutate "core: delivery order allowed"              $C '  if (mech === "delivery") {' '  if (false) {'
mutate "core: register hold ignored"               $C '  if (input.registerHolds) {' '  if (false) {'
mutate "core: stale screen accepted"               $C '  if (input.expectedSignature !== null && input.expectedSignature !== cartSignature(input.current.lines)) {' '  if (false) {'
mutate "core: out-of-stock item accepted"          $C '      if (!(f.inventoryLevel >= 1)) return refuse(' '      if (false) return refuse('
mutate "core: not-orderable item accepted"         $C '      if (!f.orderable) return refuse(' '      if (false) return refuse('
mutate "core: unapproved price override sent"      $C '  if (summary.priceOverrides > 0 && input.priceOverridesApproved === false) {' '  if (false) {'
mutate "core: override never flagged for a PIN"    $C '    needsManagerApproval: summary.priceOverrides > 0,
  };' '    needsManagerApproval: false,
  };'
mutate "core: addition sent with an id"            $C '    body.cartItems.push({ id: existing?.cartItemId ?? null,' '    body.cartItems.push({ id: existing?.cartItemId ?? "new",'
mutate "core: leftover line not reported"          $C '    if (!sentVariants.has(l.integratorVariantId)) problems.push(' '    if (false) problems.push('

# -- the server -------------------------------------------------------------------
mutate "server: wrong deadline budget"             $A '  return orderApiPost(url, body, "cart_update");' '  return orderApiPost(url, body, "status_push");'
mutate "server: unknown outcome reported as OK"    $S '      ok: landed.applied === true,' '      ok: landed.applied !== false,'
mutate "server: re-read success not rebuilt"       $S '    if (landed.applied === true) {
      warning = await rebuildLocalOrderFromStored' '    if (false) {
      warning = await rebuildLocalOrderFromStored'
mutate "server: insert failure still deletes"      $S '    if (insErr) return `The register copy still shows the old items' '    if (false) return `The register copy still shows the old items'
mutate "server: old lines never deleted"           $S '    if (oldIds.length > 0) {' '    if (false) {'
mutate "server: item_count not updated"            $S '        item_count: d.lines.reduce((a, l) => a + l.quantity, 0),' ''
mutate "server: closed local order overwritten"    $S '    if (!LOCAL_ACTIVE.has(order.status)) {' '    if (false) {'
mutate "server: ledger row mislabelled"            $S '    operation: "cart",
    requestBody: body,
    responseStatus: raw.status,' '    operation: "status_push",
    requestBody: body,
    responseStatus: raw.status,'

# -- the register route + store --------------------------------------------------
mutate "route: review sends for real"              $R '    if (body.cart.review === true) {' '    if (false) {'
mutate "route: PIN gate skipped"                   $R '    if (review.needsManagerApproval) {' '    if (false) {'
mutate "route: approval always granted"            $R '      priceOverridesApproved: approverName !== null,' '      priceOverridesApproved: true,'
mutate "route: budtender PIN accepted"             $R '      if (!CANCEL_APPROVER_ROLES.has(approver.job_role)) {
        return NextResponse.json(
          {
            error: `${approver.full_name} is not a manager or lead - a hand-set price' '      if (false) {
        return NextResponse.json(
          {
            error: `${approver.full_name} is not a manager or lead - a hand-set price'
mutate "route: wrong PIN not throttled"            $R '        await notePinFailure(throttleScope);
        return NextResponse.json({ error: "No active employee for that PIN.", needsManagerApproval: true }' '        return NextResponse.json({ error: "No active employee for that PIN.", needsManagerApproval: true }'
mutate "store: website order allowed"              $P '  if (!isMarketplaceOrigin(toOrderOrigin(order.origin))) {' '  if (false) {'
mutate "store: approver not named"                 $P '    ? `${input.employeeName} at ${input.deviceName} (price approved by ${input.approverName})`' '    ? `${input.employeeName} at ${input.deviceName}`'
mutate "store: failure audited as success"         $P '    action: result.ok ? "order.cart_updated_at_register" : "order.register_cart_failed",' '    action: "order.cart_updated_at_register",'

# -- the dashboard + register UI wiring ------------------------------------------
mutate "actions: update unguarded"                 $X '      priceOverridesApproved: true,' '      priceOverridesApproved: undefined,'
mutate "editor: edit keeps a stale review"         $E '  function edit(next: Row[]) {
    setRows(next);
    setReviewed(null);' '  function edit(next: Row[]) {
    setRows(next);'
mutate "editor: posts live rows, not reviewed"     $E 'value={JSON.stringify(reviewed.lines)}' 'value={JSON.stringify(rows)}'
mutate "workflow: editor on unacknowledged order"  $W '    !!order.acknowledged_at &&' ''
mutate "register: PIN sent always"                 $G 'reviewed.review.needsManagerApproval ? { pin } : {}' '{ pin }'
mutate "register: handover while editing"          $H 'disabled={busy || cancelOpen || cartOpen}' 'disabled={busy || cancelOpen}'

echo "--------------------------------------------------"
echo "killed: $pass   survived/skipped: $fail"
[ "$fail" -eq 0 ]

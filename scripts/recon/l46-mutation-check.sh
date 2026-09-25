#!/usr/bin/env bash
# SLICE L-46 mutation check: each mutation MUST make the pinned tests fail.
# Run from repo root. Restores every file afterwards.
#
# "Test it, test the tests." A green suite proves the tests RAN; this proves
# they BITE. Every anchor must appear exactly once, so a silently-missed edit
# is reported as SKIP (a failure), never as a false "killed".
#
# The standalone pure runner also runs, because it enforces the assertion
# floors and some mutations are designed to be caught by an embedded self-test.
set -u
TESTS="tests/compliance/leafly-l46-inbound-budget.test.ts tests/compliance/leafly-staff-alert.test.ts tests/compliance/leafly-l45-retailer-key.test.ts tests/compliance/leafly-l43-hmac.test.ts tests/compliance/leafly-l44-preview-tax.test.ts tests/compliance/leafly-order-webhooks.test.ts"
pass=0; fail=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/l46-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a[:80]); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/l46-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/l46-mut.log 2>&1 && npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/l46-mut-pure.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/l46-mut-backup "$file"
}

C=src/lib/leafly/inbound-budget-core.ts
B=src/lib/leafly/inbound-budget.ts
W=src/lib/leafly/webhook-server.ts
BR=src/lib/leafly/bridge-server.ts
SA=src/lib/leafly/staff-alert-core.ts
PV=src/app/api/webhooks/leafly/order-preview/route.ts
F=src/app/api/webhooks/leafly/route-factory.ts
ST=src/app/api/webhooks/leafly/order-status/route.ts

# -- the core ------------------------------------------------------------------
mutate "core: budget = Leafly's full 9s"          $C 'export const LEAFLY_INBOUND_BUDGET_MS = 6_000;' 'export const LEAFLY_INBOUND_BUDGET_MS = 9_000;'
mutate "core: remaining ignores elapsed"          $C '  return Math.max(0, Math.floor(budgetMs - elapsed));' '  return Math.floor(budgetMs);'
mutate "core: non-finite budget waits forever"    $C '  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(budgetMs)) {
    return 0;' '  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(budgetMs)) {
    return 1e9;'
mutate "core: worst case summed, not max"         $C '  return Math.max(v, b) + s;' '  return v + b + s;'
mutate "core: headroom ignored in proof"          $C '    worstCaseResponseMs(input) + LEAFLY_INBOUND_MIN_HEADROOM_MS <=' '    worstCaseResponseMs(input) <='
mutate "core: activate assumed retried"           $C '  order_activate: {
    retried: null,' '  order_activate: {
    retried: true,'
mutate "core: preview assumed retried"            $C '  order_preview: {
    retried: false,' '  order_preview: {
    retried: true,'
mutate "core: 9s boundary off by one"             $C '  if (!Number.isFinite(elapsedMs) || elapsedMs > LEAFLY_INBOUND_RESPONSE_LIMIT_MS) {' '  if (!Number.isFinite(elapsedMs) || elapsedMs >= LEAFLY_INBOUND_RESPONSE_LIMIT_MS) {'
mutate "core: over-limit warning dropped"         $C '  if (verdict === "over_leafly_limit") {' '  if (false) {'

# -- the race / after() -----------------------------------------------------------
mutate "race: always waits for the work"          $W '  const race = await raceLeaflyBudget(work, remaining());' '  const race = { finished: true as const, value: await work };'
mutate "race: after() never called"               $B '    after(() => settled);' '    void settled;'
mutate "race: loser not kept alive"               $W '  keepLeaflyWorkAlive(
    work.then(' '  void (
    work.then('
mutate "race: deferred finish never logged"       $W '      console.log(
        describeDeferredFinish({' '      void (
        describeDeferredFinish({'
mutate "race: key note lost when deferred"        $W '  if (keyCheck.alarm) earlyNotes.push(keyCheck.note);' '  void earlyNotes;'
mutate "race: refusal record awaited"             $W '    const refusalRace = await raceLeaflyBudget(refusalRecord, remaining());
    if (!refusalRace.finished) keepLeaflyWorkAlive(refusalRecord);' '    await refusalRecord;'
mutate "race: test hook works in production"      $B '  if (process.env.NODE_ENV !== "test") return;' '  void 0;'
mutate "race: override ignored"                   $B '  return budgetOverrideMs ?? LEAFLY_INBOUND_BUDGET_MS;' '  return LEAFLY_INBOUND_BUDGET_MS;'
mutate "factory: clock not passed"                $F '      expectedEvent,
      startedAtMs,
    });' '      expectedEvent,
    });'
mutate "route: maxDuration removed (status)"      $ST 'export const maxDuration = 300;' ''

# -- preview ----------------------------------------------------------------------
mutate "preview: menu read not raced"             $PV '    const lookupRace = await raceLeaflyBudget(lookupWork, pricingLeft);' '    const lookupRace = { finished: true as const, value: await lookupWork };'
mutate "preview: bookkeeping gets whole budget"   $PV '    budgetMs: LEAFLY_PREVIEW_BOOKKEEPING_MS,' ''
mutate "preview: timeout returns empty cart"      $PV '      return NextResponse.json(echoCartUnchanged(lines), { status: 200 });
    }
    const { lookup, loaded, variantCount } = lookupRace.value;' '      return NextResponse.json({ cartItems: [], taxes: [] }, { status: 200 });
    }
    const { lookup, loaded, variantCount } = lookupRace.value;'

# -- F5 ---------------------------------------------------------------------------
mutate "F5: webhook never passes the flag"        $W '        arrivalAlreadyHandled: bridged.ok && bridged.alreadyHandled === true,' '        arrivalAlreadyHandled: false,'
mutate "F5: failed bridge counts as handled"      $W '        arrivalAlreadyHandled: bridged.ok && bridged.alreadyHandled === true,' '        arrivalAlreadyHandled: bridged.alreadyHandled === true,'
mutate "F5: core ignores the flag"                $SA '  if (alreadyHandled) {' '  if (false) {'
mutate "F5: core accepts truthy junk"             $SA '  const alreadyHandled = input.arrivalAlreadyHandled === true;' '  const alreadyHandled = Boolean(input.arrivalAlreadyHandled);'
mutate "F5: flag also silences collection"        $SA '  if (collectionFailed) reasons.push("collection_failed");' '  if (collectionFailed && !alreadyHandled) reasons.push("collection_failed");'
mutate "F5: bridge claim path not marked"         $BR '        ok: true,
        alreadyHandled: true,
        summary: `${id}: already announced by another delivery`,' '        ok: true,
        summary: `${id}: already announced by another delivery`,'
mutate "F5: bridge defaults to handled"           $BR '    alreadyHandled: partial.alreadyHandled ?? false,' '    alreadyHandled: partial.alreadyHandled ?? true,'

echo
echo "killed=$pass not-killed=$fail"
[ "$fail" -eq 0 ]

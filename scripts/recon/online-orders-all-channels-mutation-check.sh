#!/usr/bin/env bash
# Online Orders report (all channels) mutation check: each mutation MUST make
# the pinned tests fail. Run from repo root. Restores every file. Anchors must
# appear exactly once (else SKIP = failure); a baseline gate refuses a red start.
set -u
TESTS="tests/compliance/online-orders-all-channels.test.ts tests/compliance/leafly-online-orders-report.test.ts"
pass=0; fail=0
mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/ooac-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a[:80]); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/ooac-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/ooac-mut.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/ooac-mut-backup "$file"
}
if ! npx vitest run $TESTS > /tmp/ooac-mut-base.log 2>&1; then echo "BASELINE NOT GREEN"; exit 2; fi
echo "baseline green"
C=src/lib/reports/online-orders-channels-core.ts
L=src/lib/leafly/online-orders-report-core.ts
W=src/lib/leafly/webhook-parse-core.ts
WS=src/lib/leafly/webhook-server.ts
S=src/lib/leafly/online-orders-report-server.ts
P=src/app/admin/reports/online-orders/page.tsx
# --- the 100x defect ---
mutate "leafly core back to decimal parser"   $L 'reportIntegerMinor(r.totalMinorUnits)' 'reportMoneyToMinor(r.totalMinorUnits)'
mutate "payload reads totalWithTip"            $C 'totalMinor: intMinorOrNull(o.total),' 'totalMinor: intMinorOrNull(o.totalWithTip ?? o.total),'
mutate "payload scales total x100"             $C 'totalMinor: intMinorOrNull(o.total),' 'totalMinor: intMinorOrNull(o.total) === null ? null : (o.total as number) * 100,'
mutate "envelope treated as collected"         $C '  if (nonBlank(o.id) === null) return { ...EMPTY_FACTS, lines: [] };' ''
mutate "int reader accepts decimals"           $C 'return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) ? value : null;' 'return typeof value === "number" && Number.isFinite(value) ? value : null;'
# --- classification ---
mutate "POS note not excluded"                 $C '  if (typeof row.staffNote === "string" && row.staffNote.startsWith(POS_SALE_NOTE_PREFIX)) return false;' ''
mutate "pos_client_uuid not excluded"          $C '  if (nonBlank(row.posClientUuid) !== null) return false;' ''
mutate "leafly copies counted as website"      $C '  if (origin !== "greenway") return false;' '  if (origin === "register") return false;'
mutate "register pickup reads as cancelled"    $C 'if (s === "cancelled") return registerPickedUp ? "fulfilled" : "cancelled";' 'if (s === "cancelled") return "cancelled";'
mutate "lost-to-clock merged into cancelled"   $C '  if (reason === LEAFLY_AUTO_CANCEL_CODE) return "lost_to_clock";' ''
mutate "local pickup does not rescue"          $C 'if (status === "picked_up" || input.localFulfilled === true) return "fulfilled";' 'if (status === "picked_up") return "fulfilled";'
# --- stats ---
mutate "average over all orders"               $C 'averageOrderMinor: totals.length > 0 ? Math.round(placedValueMinor / totals.length) : null,' 'averageOrderMinor: rows.length > 0 ? Math.round(placedValueMinor / rows.length) : null,'
mutate "rates over all orders incl. open"      $C '  const finished = rows.length - outcomes.open;' '  const finished = rows.length;'
mutate "fulfilled value counts everything"     $C '      if (outcome === "fulfilled") fulfilledValueMinor += total;' '      fulfilledValueMinor += total;'
mutate "leader direction inverted"             $C 'return betterWhen === "higher" ? (websiteBigger ? "website" : "leafly") : websiteBigger ? "leafly" : "website";' 'return betterWhen === "higher" ? (websiteBigger ? "leafly" : "website") : websiteBigger ? "website" : "leafly";'
mutate "daily not gap-filled"                  $C '  for (const d of keys) dayMap.set(d, { date: d, websiteOrders: 0, leaflyOrders: 0, websiteValueMinor: 0, leaflyValueMinor: 0 });' ''
mutate "value source miscounted"               $C '    else if (r.totalSource === "register_copy") leaflyValueSources.registerCopy += 1;' ''
mutate "phone not normalised"                  $C '  if (digits.length >= 10) return `p:${digits.slice(-10)}`;' '  if (digits.length >= 10) return `p:${digits}`;'
# --- webhook clobber ---
mutate "gate opens to every event"             $W 'return eventType === "order_submit";' 'return true;'
mutate "server ignores the gate"               $WS 'if (parsed.body && webhookMayWriteRawOrder(parsed.eventType)) patch.raw_order = parsed.body;' 'if (parsed.body) patch.raw_order = parsed.body;'
# --- server / page wiring ---
mutate "server stops excluding POS uuid"       $S '          .is("pos_client_uuid", null)' ''
mutate "server drops decimal-free total"       $S '        totalMinorUnits: totalMinor,' '        totalMinorUnits: null,'
mutate "page does not pass fromDate"           $P '    fromDate: range.fromDate,' ''
mutate "page drops comparison table"           $P '              {channels.comparison.map((row) => (' '              {[].map((row: ComparisonRow) => ('
mutate "page drops daily charts"               $P '        <OnlineOrdersDailyCharts daily={channels.daily} />' ''
mutate "lifecycle hint loses denominator"      $P 'hint={`${report.lifecycle.reachedReady} of ${report.lifecycle.acknowledged} acknowledged' 'hint={`${report.lifecycle.reachedReady} orders'
echo "RESULT: $pass killed, $fail survived/skipped"
[ $fail -eq 0 ]

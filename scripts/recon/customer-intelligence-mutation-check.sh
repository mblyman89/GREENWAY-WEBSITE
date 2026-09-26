#!/usr/bin/env bash
# Slice 3 — customer intelligence mutation check: each mutation MUST make the
# pinned tests fail. Run from repo root. Restores every file. Anchors must
# appear exactly once (else SKIP = failure); a baseline gate refuses a red start.
set -u
TESTS="tests/compliance/customer-intelligence.test.ts"
pass=0; fail=0
mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/ci-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a[:80]); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/ci-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/ci-mut.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/ci-mut-backup "$file"
}
if ! npx vitest run $TESTS > /tmp/ci-mut-base.log 2>&1; then echo "BASELINE NOT GREEN"; exit 2; fi
echo "baseline green"
S=src/lib/customers/customer-insights-server.ts
I=src/lib/customers/customer-insights-core.ts
G=src/lib/customers/customer-segments-core.ts
M=supabase/migrations/0232_customer_rollups.sql
IM=src/lib/customers/import.ts
DP='src/app/admin/customers/[id]/page.tsx'
LP=src/app/admin/customers/page.tsx
IP=src/app/admin/customers/insights/page.tsx
A=src/app/admin/customers/actions.ts
N=src/components/admin/admin-nav-data.ts
R=scripts/compliance/run-pure-selftests.ts
# --- connection: fallback fold ---
mutate "fold ignores refunds"                 $S 'c.netSpendMinor += num(o.total_minor_units) - (refundByOrder.get(o.id) ?? 0);' 'c.netSpendMinor += num(o.total_minor_units);'
mutate "fold not floored at zero"             $S 'netSpendMinor: Math.max(0, c.netSpendMinor) }));' 'netSpendMinor: c.netSpendMinor }));'
mutate "fold uses placed_at only"             $S 'const at = o.completed_at ?? o.placed_at;' 'const at = o.placed_at;'
mutate "link overwrites other customers"      $S '.update({ customer_id: customer.id }).eq("id", id).is("customer_id", null).select("id");' '.update({ customer_id: customer.id }).eq("id", id).select("id");'
mutate "link proceeds on partial read"        $S '  if (partial.length > 0) return { ok: false, error: `Could not finish reading' '  if (false) return { ok: false, error: `Could not finish reading'
# --- connection: migration ---
mutate "migration counts every status"        $M "       and o.status = 'completed'" "       and o.status is not null"
mutate "migration copies on every run"        $M "      add column imported_spend_minor_units integer not null default 0;
    update public.customers" "      add column imported_spend_minor_units integer not null default 0;
  end if;
  if true then
    update public.customers"
mutate "migration drops returns trigger"      $M 'create trigger customer_returns_customer_rollup' 'create trigger customer_returns_rollup_disabled'
mutate "migration leaves compute public"      $M 'revoke all on function public.customer_rollup_compute(uuid) from public, anon, authenticated;' '-- (no revoke)'
mutate "migration update trigger narrowed"    $M 'after update of status, customer_id, total_minor_units, completed_at, placed_at' 'after update of status, customer_id'
# --- connection: importer ---
mutate "import writes lifetime again"         $IM 'imported_spend_minor_units: row.lifetime_spend_minor_units' 'lifetime_spend_minor_units: row.lifetime_spend_minor_units'
mutate "import fallback on any error"         $IM 'return (err.code === "PGRST204" || err.code === "42703") && msg.includes("imported_spend_minor_units");' 'return true;'
# --- intelligence: one customer ---
mutate "net spend ignores refunds"            $I '  const net = gross - refunds;' '  const net = gross;'
mutate "AOV over net"                         $I 'avgOrderMinor: visits > 0 ? Math.round(gross / visits) : 0,' 'avgOrderMinor: visits > 0 ? Math.round(net / visits) : 0,'
mutate "cadence mean not median"              $I 'gap = Math.max(1, Math.round(medianOf(gaps) as number));' 'gap = Math.max(1, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length + 1));'
mutate "overdue band widened"                 $I 'else if (since > gap * 1.25) status = "overdue";' 'else if (since > gap * 1.5) status = "overdue";'
mutate "due-now band dropped"                 $I 'else if (since >= gap * 0.8) status = "due_now";' ''
mutate "confidence thresholds shifted"        $I 'confidence = gaps.length >= 6 ? "high" : gaps.length >= 3 ? "medium" : "low";' 'confidence = gaps.length >= 6 ? "high" : gaps.length >= 4 ? "medium" : "low";'
mutate "custom lines become favourites"       $I '      if (l.isCustom) continue;' ''
mutate "share of zero total"                  $I 'spendShare: totalSpend > 0 ? t.spend / totalSpend : 0,' 'spendShare: totalSpend > 0 ? t.spend / (totalSpend + 1) : 0,'
# --- intelligence: the whole base ---
mutate "quintile tie handling off"            $G 'const pct = ((higherIsBetter ? below : above) + equal / 2) / n;' 'const pct = ((higherIsBetter ? below : above) + equal) / n;'
mutate "champions rule loosened"              $G 'if (r >= 4 && f >= 4 && m >= 4) return "champions";' 'if (r >= 4 && f >= 4) return "champions";'
mutate "cant-lose rule dropped"               $G 'if (r <= 2 && f >= 4 && m >= 4) return "cant_lose";' ''
mutate "store gap mean per visit"             $G '    gaps.push(span / (c.visits - 1));' '    gaps.push(span / c.visits);'
mutate "one-day products are staples"         $G '    if (g.days.size < 2) continue;' ''
mutate "stock watch due window ignored"       $G 's.typicalGapDays - s.daysSinceLast <= DUE_WINDOW_DAYS,' 'false,'
mutate "sold-out champion staple only watch"  $G 'urgency = due.size > 0 || valuable.size > 0 ? "reorder_now" : "watch";' 'urgency = "watch";'
mutate "lift inverted"                        $G 'lift: allShare > 0 ? groupShare / allShare : null,' 'lift: allShare > 0 ? allShare / groupShare : null,'
mutate "overdue window has no ceiling"        $G 'if (since > gap * 1.25 && since <= gap * 2.5 && since <= 180) overdue.push(row);' 'if (since > gap * 1.25) overdue.push(row);'
mutate "due gap from visits not intervals"    $G 'const gap = Math.max(1, Math.round(span / (c.visits - 1)));' 'const gap = Math.max(1, Math.round(span / c.visits));'
mutate "identification not clamped"           $G 'const linked = Math.max(0, Math.min(allSales, linkedSales));' 'const linked = linkedSales;'
# --- wiring ---
mutate "profile page drops the loader"        "$DP" 'const profile = await loadCustomerProfile(customer);' 'const profile = null as Awaited<ReturnType<typeof loadCustomerProfile>>;'
mutate "profile page drops link form"         "$DP" 'const linkAction = linkCustomerOrdersAction.bind(null, id);' 'const linkAction = async () => {};'
mutate "profile page hides partial warning"   "$DP" '{profile && profile.partial.length > 0 && (' '{false && ('
mutate "profile page drops LoyaltyPanel"      "$DP" '        <LoyaltyPanel customerId={id} canManage={canManageLoyalty} />' ''
mutate "list page back to dead columns"       $LP '                  const f = figuresFor(c);' '                  const f = { visits: c.visit_count, spend: c.lifetime_spend_minor_units, last: c.last_visit_at };'
mutate "list page loses segment read"         $LP '    loadSegmentMap(),' '    Promise.resolve(null),'
mutate "dashboard ungated"                    $IP '  await requirePermission("customers.manage");' ''
mutate "dashboard drops win-back"             $IP 'title={`Win-back list (${d.overdue.length})`}' 'title={`Later (${d.overdue.length})`}'
mutate "action skips orders permission"       $A '!can(session.profile.role, "orders.manage")' 'false'
mutate "nav entry removed"                    $N '  { label: "Customer Insights", href: "/admin/customers/insights",' '  { label: "Customer Insights", href: "/admin/customers/insight",'
mutate "runner drops segments suite"          $R '  assertRan("customer-segments-core", __runCustomerSegmentsCoreTests(), 105);' ''
echo "RESULT: $pass killed, $fail survived/skipped"
[ $fail -eq 0 ]

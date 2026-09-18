#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# prove-0225-executes.sh — SLICE L-5
#
# The repo's migration gate (tests/compliance/migration-execution-gate.test.ts)
# requires every migration to be PROVEN to execute, not assumed to. This applies
# all migrations in order to a real PostgreSQL, re-applies 0225 to prove it is
# idempotent, and then INSPECTS the result rather than trusting that the DDL
# "looked right".
#
# 0225 adds the receiving side of the Leafly Order API:
#   * integration_credentials.leafly_hmac_key + leafly_order_integration_key
#   * public.leafly_webhook_events — the append-only delivery log, whose UNIQUE
#     body_sha256 is the idempotency guard
#   * public.leafly_orders — our own copy of each order
#
# The properties checked live, because each one is load-bearing and each one
# fails SILENTLY if the DDL is wrong:
#
#   1. The unique index on body_sha256 really rejects a duplicate. Leafly
#      retries deliveries; if this constraint is missing, a retry is processed a
#      SECOND time and the customer's order is duplicated. The test inserts the
#      same hash twice and checks the error code is 23505, which is exactly what
#      the route's duplicate detection branches on — so this also proves the
#      code the app checks for is the code the database emits.
#
#   2. event_type and order_id are NULLABLE. The activation/deactivation
#      webhooks carry no orderId, and Leafly's spec permits only a 200/201
#      response, so a NOT NULL constraint here would make a legitimate signed
#      delivery impossible to store AND impossible to answer correctly.
#
#   3. signature_verified defaults to FALSE. A default of true would mean a row
#      inserted before verification completes reads as authenticated.
#
#   4. The new credential columns exist as `text not null default ''`. This
#      MATCHES the established local convention for leafly_menu_integration_key
#      rather than inventing a nullable variant for a sibling field, and it is
#      safe here only because the HMAC core treats an empty key as ABSENT:
#      verified live in this slice, `hmacKey: ""` returns
#      `{ ok: false, reason: "missing_key" }`, i.e. it refuses rather than
#      comparing against an empty key. The column shape and the code's
#      fail-closed behaviour are therefore checked together, because either one
#      alone would be misleading.
#
#   5. The factory-reset door (0209) can actually empty both tables. 0209 is
#      `create or replace`, and this slice added two DELETEs to it; if either
#      table name were wrong the reset would abort partway through, which is the
#      D-62 failure mode.
#
# Usage: sudo -u postgres bash scripts/compliance/prove-0225-executes.sh
# ---------------------------------------------------------------------------
set -uo pipefail

DB=greenway_migtest_0225
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../supabase/migrations" && pwd)"

psql -q -c "drop database if exists $DB;" >/dev/null
psql -q -c "create database $DB;" >/dev/null

# Supabase supplies these; a bare Postgres does not. Created up front so the
# migrations run against the shape they were written for.
psql -q -d "$DB" >/dev/null 2>&1 <<'SQL'
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create role anon;
create role authenticated;
create role service_role;
SQL

# ---------------------------------------------------------------------------
# expect_error <label> <expected-token> <sql>
#
# Asserts that a statement RAISES, and that the raised message contains a
# specific token. Written as a function after the first version of sections 7-8
# reported a pass AND a failure banner for the same check: the idiom
#     psql ... | grep -oE "TOKEN" | head -1 || echo "*** FAILED ***"
# looks right but cannot work under `set -o pipefail`, because psql exits
# non-zero whenever the query raises -- which here is the SUCCESS case. pipefail
# then propagates that to the whole pipeline and the `||` branch fires even
# though grep matched. So the output is captured FIRST and tested afterwards,
# and the two distinct outcomes ("did not raise at all" vs "raised the wrong
# error") are reported separately, because they are different defects.
expect_error() {
  local label="$1" token="$2" sql="$3" out rc
  out=$(psql -d "$DB" -v ON_ERROR_STOP=1 -tAc "$sql" 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "  $label: *** NO ERROR RAISED -- the guard did not hold ***"
    return 1
  fi
  if echo "$out" | grep -q "$token"; then
    echo "  $label: refused -> $(echo "$out" | grep -oE "${token}[^\"]*" | head -1)"
    return 0
  fi
  echo "  $label: *** raised, but NOT with $token: $(echo "$out" | head -1) ***"
  return 1
}

applied=0; failed=0; failures=()
for f in "$DIR"/[0-9][0-9][0-9][0-9]_*.sql; do
  name=$(basename "$f")
  if out=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" 2>&1); then
    applied=$((applied+1))
  else
    failed=$((failed+1)); failures+=("$name")
    echo "FAILED  $name"
    echo "$out" | grep -E "^psql:.*ERROR" | head -2
  fi
done

echo "----------------------------------------------------------------"
echo "applied $applied, failed $failed"
[ "$failed" -gt 0 ] && { echo "first failures: ${failures[*]:0:8}"; }

echo
echo "=== 0225 re-applied for idempotency ==="
if psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/0225_leafly_order_webhooks.sql" 2>&1; then
  echo "0225 re-apply: OK (idempotent)"
else
  echo "0225 re-apply: FAILED"
fi

echo
echo "=== 1. the two new tables, as the database actually sees them ==="
psql -d "$DB" -c "
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and table_name in ('leafly_webhook_events','leafly_orders')
  and column_name in ('event_type','order_id','body_sha256','signature_verified',
                      'received_at','leafly_order_id','raw_order','local_order_id')
order by table_name, column_name;"

echo "=== 2. the UNIQUE index on body_sha256 exists ==="
psql -d "$DB" -c "
select indexname, indexdef
from pg_indexes
where schemaname='public' and tablename='leafly_webhook_events'
order by indexname;"

echo "=== 3. a duplicate body hash is REFUSED, with SQLSTATE 23505 ==="
# This is the assertion the whole idempotency design rests on. The route
# branches on '23505' to turn a retry into a no-op, so the code the app looks
# for must be the code the database actually raises. Proven, not assumed.
psql -d "$DB" -tc "
insert into public.leafly_webhook_events (body_sha256, event_type, order_id)
values ('dup-hash-aaaa', 'order_submit', 'ord-1');" >/dev/null 2>&1
dup_out=$(psql -d "$DB" -tc "
insert into public.leafly_webhook_events (body_sha256, event_type, order_id)
values ('dup-hash-aaaa', 'order_submit', 'ord-1');" 2>&1)
echo "$dup_out" | grep -qE "duplicate key|23505" \
  && echo "  duplicate REFUSED (as required): $(echo "$dup_out" | grep -oE 'duplicate key value violates unique constraint .*' | head -1)" \
  || echo "  *** DUPLICATE WAS ACCEPTED — idempotency is NOT enforced ***"
# The exact SQLSTATE, read from the database rather than quoted from the docs.
# The route branches on the string '23505'; if PostgreSQL ever raised something
# else here the duplicate-suppression branch would never run and a Leafly retry
# would be processed twice. Fed on STDIN so `\set VERBOSITY verbose` and the
# INSERT share one session -- an earlier draft passed them as two separate -c
# flags, which psql treats as independent statements, so VERBOSITY never applied
# and this line printed nothing at all.
# MEASURED, not guessed. Under `\set VERBOSITY verbose` psql renders the code as
#     ERROR:  23505: duplicate key value violates unique constraint "..."
# There is no literal word "SQLSTATE" in the output. A first draft grepped for
# /SQLSTATE[: ]+[0-9A-Z]+/ and printed "<none captured>", which then tripped the
# mismatch banner -- a harness defect that looked exactly like a schema defect.
# The pattern below was written after reading real psql output.
echo -n "  SQLSTATE reported: "
sqlstate=$(psql -d "$DB" 2>&1 <<'SQL' | grep -oE "ERROR:[[:space:]]+[0-9A-Z]{5}" | grep -oE "[0-9A-Z]{5}$" | head -1
\set VERBOSITY verbose
insert into public.leafly_webhook_events (body_sha256) values ('dup-hash-aaaa');
SQL
)
echo "${sqlstate:-<none captured>}"
if echo "$sqlstate" | grep -q "23505"; then
  echo "  matches the '23505' the route branches on"
else
  echo "  *** the route branches on 23505; the database raised something else ***"
fi

echo "=== 4. an activation webhook with NO order id and NO event type stores fine ==="
# Leafly's activation/deactivation webhooks carry no orderId. A NOT NULL here
# would reject a genuine, correctly signed delivery -- and the spec gives us no
# way to report that rejection, because only 200/201 are permitted.
psql -d "$DB" -tc "
insert into public.leafly_webhook_events (body_sha256) values ('activation-no-order')
returning body_sha256, event_type is null as event_type_null,
          order_id is null as order_id_null, signature_verified;"

echo "=== 5. signature_verified defaults to FALSE, never true ==="
psql -d "$DB" -tc "
select count(*) filter (where signature_verified is false) as defaulted_false,
       count(*) filter (where signature_verified is true)  as defaulted_true,
       count(*) as total
from public.leafly_webhook_events;"

echo "=== 6. the new credential columns: text not null default '' ==="
# CORRECTED AFTER MEASURING. The first draft of this section asserted "nullable,
# no default", on the reasoning that NULL must stay distinguishable from '' so
# that an absent key cannot be compared against an empty one. That reasoning was
# sound but the premise was wrong: 0225 writes `text not null default ''`,
# because that is what the SIBLING column leafly_menu_integration_key already
# does (0219). Inventing a nullable variant for one member of a set of three
# credential columns would be a local inconsistency nobody reading the table
# could explain.
#
# It is safe here only because the refusal lives in the CODE, not in the column:
# verified live in this slice, verifyLeaflySignature({ hmacKey: "" }) returns
# { ok: false, reason: "missing_key" } -- it declines to verify rather than
# comparing a signature against an empty key. So the column shape and that
# fail-closed behaviour are printed together below, because either one alone
# would mislead a reader into thinking the other was different.
psql -d "$DB" -c "
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='integration_credentials'
  and column_name in ('leafly_hmac_key','leafly_order_integration_key',
                      'leafly_menu_integration_key')
order by column_name;"

echo "=== 7. the owner guard on the factory reset is REAL ==="
# Checked BEFORE proving the reset works, and deliberately in that order.
#
# The first run of this harness called gl_factory_reset() with no session
# identity at all and got:
#     ERROR: RESET_NOT_OWNER: only the owner may run the factory reset.
# The tempting reading of that is "the harness is broken, work around it". The
# correct reading is that it is the guard in 0209 doing its job, and it is worth
# an assertion of its own -- because a reset that anyone can call is a far worse
# defect than a reset that empties the wrong table.
#
# public.is_owner() (0185) resolves identity through auth.uid(), which this
# harness stubs as current_setting('request.jwt.claim.sub'). So the refusal is
# pinned first with NO claim set, then again as a non-owner, and only then is a
# real owner established. Bypassing the guard -- e.g. redefining is_owner() to
# return true -- would have "proved" the DELETEs against a function that no
# longer resembles the one in production.
guard_failures=0
expect_error "no session identity at all" "RESET_NOT_OWNER" \
  "select public.gl_factory_reset('ERASE ALL TEST DATA', true);" \
  || guard_failures=$((guard_failures+1))

# A staff member who is NOT the owner must be refused too. staff_profiles.role
# defaults to 'readonly' (0001) and staff_profiles.id is FK'd to auth.users, so
# both rows are created properly rather than poked straight into the table.
psql -q -d "$DB" >/dev/null 2>&1 <<'SQL'
insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'notowner@greenwaymarijuana.com')
on conflict (id) do nothing;
insert into public.staff_profiles (id, email, full_name, role, active)
values ('11111111-1111-1111-1111-111111111111', 'notowner@greenwaymarijuana.com',
        'Not The Owner', 'manager', true)
on conflict (id) do update set role = 'manager', active = true;
SQL
expect_error "an ACTIVE manager" "RESET_NOT_OWNER" \
  "set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
   select public.gl_factory_reset('ERASE ALL TEST DATA', true);" \
  || guard_failures=$((guard_failures+1))

# An INACTIVE owner must also be refused: is_owner() requires active = true, and
# that clause is the one that makes deactivating a departed owner actually mean
# something. Asserted separately because role and active are two conditions and
# a single test would not tell us which one held.
psql -q -d "$DB" >/dev/null 2>&1 <<'SQL'
insert into auth.users (id, email)
values ('22222222-2222-2222-2222-222222222222', 'owner@greenwaymarijuana.com')
on conflict (id) do nothing;
insert into public.staff_profiles (id, email, full_name, role, active)
values ('22222222-2222-2222-2222-222222222222', 'owner@greenwaymarijuana.com',
        'Greenway Owner', 'owner', false)
on conflict (id) do update set role = 'owner', active = false;
SQL
expect_error "an INACTIVE owner" "RESET_NOT_OWNER" \
  "set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
   select public.gl_factory_reset('ERASE ALL TEST DATA', true);" \
  || guard_failures=$((guard_failures+1))

# The confirmation phrase is a separate gate from identity. Pinned as the owner,
# so that a pass below cannot be explained away as "the identity was wrong".
psql -q -d "$DB" -c "update public.staff_profiles set active = true
  where id = '22222222-2222-2222-2222-222222222222';" >/dev/null 2>&1
expect_error "the ACTIVE owner, phrase in lowercase" "RESET_BAD_CONFIRMATION" \
  "set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
   select public.gl_factory_reset('erase all test data', true);" \
  || guard_failures=$((guard_failures+1))

# The retention guard is the third independent gate and the one with statutory
# weight (WAC 314-55-087(1), five-year retention). Proven by giving the database
# something that looks like real trade -- one COMPLETED order -- and calling the
# reset as the owner with the correct phrase but WITHOUT the acknowledgement.
# It must refuse. This matters to this slice specifically: a Leafly rehearsal
# produces completed orders, so the owner will meet this guard in practice.
# orders.customer_first_name is `text not null` with NO default (0007), so a
# bare `insert into public.orders (status)` fails. Checked the migration; a
# silent failure here would leave v_orders at 0 and the retention guard would
# then "pass" by never being triggered at all -- a false negative, which is the
# worst kind in a harness.
psql -d "$DB" -v ON_ERROR_STOP=1 -q -c "
insert into public.orders (status, customer_first_name)
values ('completed', 'Retention Guard Probe');" \
  || echo "  *** could not seed a completed order; the next check is VACUOUS ***"
echo -n "  completed orders now on file: "
psql -d "$DB" -tAc "select count(*) from public.orders where status = 'completed';"
expect_error "owner + right phrase, but no retention acknowledgement" "RETENTION GUARD" \
  "set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
   select public.gl_factory_reset('ERASE ALL TEST DATA');" \
  || guard_failures=$((guard_failures+1))

echo -n "  guard verdict: "
if [ "$guard_failures" -eq 0 ]; then
  echo "all 5 refusals held (no identity, manager, inactive owner, bad phrase, retention)"
else
  echo "*** $guard_failures GUARD(S) DID NOT HOLD ***"
fi

echo
echo "=== 8. the factory-reset door can really empty both tables ==="
# 0209 is create-or-replace and this slice added two DELETEs to it. If either
# table name were misspelled the reset would abort partway through, leaving the
# books half-cleared -- the D-62 failure mode. Called FOR REAL, as the active
# owner established in section 7, against rows that actually exist.
#
# Both tables are seeded first. leafly_webhook_events already holds rows from
# sections 3-5, but they are topped up explicitly so this section does not
# depend on an earlier section's leftovers: a reported count of 0 must mean
# "the DELETE did not fire", never "there was nothing there anyway".
psql -q -d "$DB" >/dev/null 2>&1 <<'SQL'
insert into public.leafly_orders (leafly_order_id) values
  ('ord-reset-test-1'), ('ord-reset-test-2')
on conflict do nothing;
insert into public.leafly_webhook_events (body_sha256, event_type, order_id) values
  ('reset-seed-1', 'order_submit', 'ord-reset-test-1'),
  ('reset-seed-2', 'order_cancel', 'ord-reset-test-2')
on conflict do nothing;
SQL
echo -n "  rows before reset: "
before=$(psql -d "$DB" -tAc "
select (select count(*) from public.leafly_webhook_events) || ' events, ' ||
       (select count(*) from public.leafly_orders) || ' orders';")
echo "$before"

reset_out=$(psql -d "$DB" -tAc "
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.gl_factory_reset('ERASE ALL TEST DATA', true);" 2>&1)

if echo "$reset_out" | grep -q "leafly_webhook_events"; then
  echo "  reset ran and reported BOTH Leafly tables in its own counts:"
  echo "$reset_out" | tr ',{}' '\n' | grep -i leafly | sed 's/^/    /'
else
  echo "  *** the reset did not report the Leafly tables ***"
  echo "$reset_out" | head -5 | sed 's/^/    /'
fi

echo -n "  rows after reset:  "
after=$(psql -d "$DB" -tAc "
select (select count(*) from public.leafly_webhook_events) || ' events, ' ||
       (select count(*) from public.leafly_orders) || ' orders';")
echo "$after"

# The count the FUNCTION reports and the count the TABLE actually has are two
# different claims. A DELETE aimed at the wrong table could still report a
# plausible number. Both are checked.
echo -n "  verdict: "
if [ "$after" = "0 events, 0 orders" ] && [ "$before" != "0 events, 0 orders" ]; then
  echo "both tables held rows and both are now empty -- the two new DELETEs execute"
else
  echo "*** MISMATCH -- before='$before' after='$after' ***"
fi

echo
echo "=== 9. the reset did NOT touch anything it was not asked to ==="
# The risk with editing a create-or-replace reset function is not only that a
# DELETE misses; it is that one lands somewhere it should not. integration_
# credentials holds the owner's Leafly keys, and wiping those during a
# rehearsal reset would silently de-authenticate the integration. 0209 is not
# supposed to clear it. Asserted, because "not supposed to" is not a proof.
# NOTE ON `id`: integration_credentials.id is a BOOLEAN primary key defaulting
# to true, with `constraint integration_credentials_singleton check (id = true)`
# (0053). It is a one-row table by construction. A first draft of this section
# wrote `values (1, ...)`, the shape nearly every other table in this schema
# uses, which would have failed here. Read the migration; did not assume.
psql -q -d "$DB" >/dev/null 2>&1 <<'SQL'
insert into public.integration_credentials (id, leafly_hmac_key, leafly_order_integration_key)
values (true, 'survives-the-reset', 'order-key-survives')
on conflict (id) do update set leafly_hmac_key = 'survives-the-reset',
                               leafly_order_integration_key = 'order-key-survives';
SQL
echo -n "  credentials seeded: "
psql -d "$DB" -tAc "select count(*) || ' row(s)' from public.integration_credentials;"
psql -d "$DB" -tAc "
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.gl_factory_reset('ERASE ALL TEST DATA', true);" >/dev/null 2>&1
echo -n "  the Leafly credentials after a reset: "
psql -d "$DB" -tAc "
select coalesce(nullif(leafly_hmac_key, ''), '<EMPTIED>') || ' / ' ||
       coalesce(nullif(leafly_order_integration_key, ''), '<EMPTIED>')
from public.integration_credentials where id = true;"
echo "  (both must still read their seeded values: a reset clears rehearsal"
echo "   ORDERS, never the keys that authenticate the integration)"

echo
echo "=== 10. the empty HMAC key REFUSES rather than comparing ==="
# Section 6 prints the column as `not null default ''`. That is only safe
# because the code treats '' as ABSENT. Proven here against the real core, in
# the same run, so the column shape and the behaviour that justifies it are
# never reported apart.
# Uses the REAL production digester (nodeHmacDigest, node:crypto HMAC-SHA-256),
# not a stub, so this cannot pass by virtue of a fake that never computes
# anything. The control case immediately below signs the same body with a real
# key and must SUCCEED -- otherwise "refused" would prove nothing, since a core
# that refuses everything would also pass the first assertion.
# $DIR is .../supabase/migrations, so the project root is two levels up. Probed
# rather than hardcoded, because this harness is normally run from a COPY of the
# tree under /tmp (the `postgres` user cannot read /workspace), and that copy may
# or may not include src/. If it does not, the section says so plainly instead
# of reporting a pass it never performed.
PROJ="$(cd "$DIR/../.." && pwd)"
if [ ! -f "$PROJ/src/lib/leafly/hmac-core.ts" ]; then
  echo "  SKIPPED: no src/ under $PROJ (copy the whole tree, not just supabase/)"
  echo "  This section must not be reported as passing when it did not run."
else
( cd "$PROJ" && npx --yes tsx -e "
import { createHmac } from 'node:crypto';
import { verifyLeaflySignature } from './src/lib/leafly/hmac-core';

// The digester is reproduced here as ONE line rather than imported from
// webhook-server.ts, and that is a deliberate, narrow exception worth stating.
// webhook-server.ts begins with \`import \"server-only\"\` and pulls three \`@/\`
// path aliases (supabase/admin, supabase/env, integration-credentials-store),
// none of which resolve under a bare \`tsx -e\` outside the Next.js build. It
// cannot be imported here at all. hmac-core.ts, by contrast, has NO imports
// whatsoever -- that is the point of the pure-core house rule -- so it loads
// cleanly. The line below is byte-for-byte the body of nodeHmacDigest:
//     return createHmac(\"sha256\", key).update(body, \"utf8\").digest(encoding);
// This is NOT a stub: it is the same node:crypto computation, so a real
// signature really is computed and really is compared.
const digest = (body: string, key: string, encoding: 'base64' | 'hex') =>
  createHmac('sha256', key).update(body, 'utf8').digest(encoding);
const nodeHmacDigest = digest as Parameters<typeof verifyLeaflySignature>[0]['digest'];

const body = JSON.stringify({ orderId: 'ord-1' });
const realKey = 'a-real-key-for-the-control-case';
const goodSig = nodeHmacDigest(body, realKey, 'base64');

const empty = verifyLeaflySignature({
  rawBody: body, headerValue: goodSig, hmacKey: '', digest: nodeHmacDigest,
});
console.log('  hmacKey=\"\"      ->', JSON.stringify({ ok: empty.ok, reason: empty.reason }));

const control = verifyLeaflySignature({
  rawBody: body, headerValue: goodSig, hmacKey: realKey, digest: nodeHmacDigest,
});
console.log('  hmacKey=real    ->', JSON.stringify({ ok: control.ok, reason: control.reason ?? null }));

if (empty.ok === false && empty.reason === 'missing_key' && control.ok === true) {
  console.log('  PASS: an empty key refuses, a real key still verifies');
} else {
  console.log('  *** FAIL: empty key did not fail closed, or the control did not verify ***');
}
" 2>&1 | grep -E "^  " ) || echo "  *** section 10 could not execute (tsx/runtime error above) ***"
fi

echo
echo "----------------------------------------------------------------"
echo "0225 proof complete. Read the verdict lines, not just the absence"
echo "of errors: sections 3, 7, 8, 9 and 10 each print an explicit"
echo "PASS/refused/verdict line, and any line containing '***' is a"
echo "FAILURE that must be fixed before this migration is trusted."

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# prove-0229-executes.sh — SLICE L-14
#
# The repo's migration gate (tests/compliance/migration-execution-gate.test.ts)
# requires every migration to be PROVEN to execute, not assumed to. READING SQL
# IS NOT RUNNING SQL. This applies all migrations in order to a real
# PostgreSQL, re-applies 0229 to prove it is idempotent, and then INSPECTS the
# behaviour rather than trusting that the DDL "looked right".
#
# 0229 is the migration behind the register claim and the blocking cancel
# modal. It adds:
#   * leafly_orders.register_device_id / _device_name / _employee_name /
#     _claimed_at            — which till is holding the order, and since when
#   * leafly_register_interrupts — the durable record of a Leafly cancellation
#     that collided with a live sale, and of how a human disposed of it
#
# WHAT THIS HARNESS IS ACTUALLY DEFENDING
# ---------------------------------------
# Every property below fails SILENTLY if the DDL is wrong, and every one of
# them is load-bearing for a real customer standing at a counter:
#
#   1. The file applies, and RE-APPLIES. The owner applies migrations BY HAND
#      (AGENTS rule 6), one paste at a time, sometimes twice when a paste looks
#      like it failed. A migration that throws on the second application is one
#      that will eventually be half-applied on the live shop.
#
#   2. THE PARTIAL UNIQUE INDEX REALLY IS UNIQUE, AND REALLY IS PARTIAL.
#      This is the whole anti-duplicate-modal guarantee. Leafly retries
#      webhooks, and `order_cancel` can arrive several times for one order.
#      Without uniqueness, three retries produce three modals and a budtender
#      learns to dismiss modals without reading them — which defeats the entire
#      point of a blocking dialog. Proven by INSERTING TWICE and demanding a
#      23505, not by reading the word "unique".
#      And it must be PARTIAL: once an interrupt is resolved, a LATER
#      cancellation of the same order must be able to raise a new one. A
#      non-partial unique index would silently block that forever — the second
#      cancellation would simply never reach the floor. Proven by resolving the
#      first row and inserting a second.
#
#   3. THE DISPOSITION CHECK IS AN ALLOWLIST. Our own outbound values are
#      constrained; an unanticipated value must be REJECTED rather than stored.
#      Proven by trying to insert 'complete' and demanding 23514.
#
#   4. cancel_reason_code IS UNCONSTRAINED. The opposite asymmetry, and it is
#      deliberate: that column holds an INBOUND fact from Leafly, who can add a
#      reason code whenever they like. A CHECK here would reject the truth. A
#      comment saying "we chose not to constrain this" and an accident look
#      identical six months later, so it is asserted by inserting a code that
#      does not exist today.
#
#   5. resolution columns are NULLABLE with NO default. `resolved_at is null`
#      IS the definition of "still blocking a register". If resolved_at
#      defaulted to now(), every interrupt would be born already resolved, the
#      poll would return nothing, and NO modal would ever appear — while every
#      text-reading test in the repo stayed green.
#
#   6. ON DELETE CASCADE on local_order_id. An interrupt pointing at a deleted
#      order is an unresolvable modal nobody can ever clear. Proven by deleting
#      the order and counting the interrupts.
#
#   7. register_device_id has NO foreign key to pos_devices, and IS nullable.
#      Deliberate on both counts: a null device means "any register" (used when
#      the claim went stale), and retiring a till must never block the delete
#      or orphan the audit trail.
#
#   8. RLS is ENABLED with no anon/authenticated policy, so the table is
#      unreachable from a browser. A table with RLS enabled and no policies is
#      closed; a table with RLS forgotten is wide open to any logged-in user.
#
#   9. The claim columns land on leafly_orders as nullable with no default —
#      an order is UNCLAIMED until a till takes it, and a default would make
#      every order look held by a device that does not exist.
#
#  10. 0209's factory reset still runs afterwards, with is_owner() asserted
#      TRUE first so the reset assertions cannot pass vacuously.
#
# The harness defects learned on 0225/0226/0227/0228 are carried across rather
# than rediscovered: the `\set VERBOSITY verbose` heredoc that keeps VERBOSITY
# and the statement in ONE psql session (a separate -c captures the word "SET"
# instead of the SQLSTATE, which presents as a missing constraint), the fact
# that 0127's trigger already creates the staff_profiles row readonly/inactive
# so the fixture must UPDATE rather than insert, and the anchored
# case-sensitive reset grep.
#
# Usage:  sudo -u postgres bash scripts/compliance/prove-0229-executes.sh
# ---------------------------------------------------------------------------
set -uo pipefail

DB=greenway_migtest_0229
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../supabase/migrations" && pwd)"

# `-d postgres` explicitly. WITHOUT it psql connects to a database named after
# the invoking user, which exists on some machines and not others -- this
# harness failed with `FATAL: database "root" does not exist` after a sandbox
# restart, and reported it as "43 checks failed", i.e. as a MIGRATION defect.
# A proof that cannot tell a missing database from a broken migration is not a
# proof. `postgres` is present on every Postgres install and on both documented
# invocations of this script.
psql -q -d postgres -c "drop database if exists $DB;" >/dev/null
psql -q -d postgres -c "create database $DB;" >/dev/null

# And REFUSE to continue if the database is not actually there, rather than
# running 43 checks against nothing and blaming the migration for the result.
if ! psql -d "$DB" -tAc "select 1" >/dev/null 2>&1; then
  echo "FATAL: could not create or connect to $DB. This is an ENVIRONMENT"
  echo "problem, not a migration problem. Nothing about 0229 has been proven."
  psql -d "$DB" -tAc "select 1" 2>&1 | sed 's/^/  /'
  exit 2
fi

# Supabase supplies these; a bare Postgres does not. Lifted verbatim from
# prove-0228-executes.sh so the harnesses cannot diverge in their fixture.
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

q() { psql -d "$DB" -tAc "$1" 2>&1; }

# `psql -tAc` on an `INSERT/UPDATE ... RETURNING` prints the returned value AND
# the command tag ("INSERT 0 1"). Capturing both is the defect the 0228 harness
# header records as the costliest one on 0225/0226/0227. Take ONLY the line
# that is exactly the sentinel we asked for.
qv() { # qv <sql> <sentinel>
  psql -d "$DB" -tAc "$1" 2>&1 | grep -xF "$2" | head -1
}

# Run a statement and print ONLY its SQLSTATE. The heredoc keeps VERBOSITY and
# the statement in one session; a separate -c would capture the word "SET".
# Returns the five-character SQLSTATE of a statement that is EXPECTED to fail.
#
# Two things here were learned the hard way and must not be "tidied" away.
#
# 1. THE FORMAT. The statement is fed on STDIN, so psql's error line carries no
#    `psql:` prefix (that appears only when reading from a file), and with
#    VERBOSITY verbose the code is printed immediately after `ERROR:` with NO
#    "SQLSTATE" label:
#        ERROR:  23514: new row for relation "x" violates check constraint ...
#    Anchoring on `^psql:` or on a `SQLSTATE` label matches nothing. Both were
#    tried; both silently produced "" and cost a full run each.
#
# 2. NEVER RETURN EMPTY. "" is what let defect (1) survive two runs: a negative
#    test expecting '23505' that receives '' fails safely but is ambiguous
#    between "the database wrongly ALLOWED the write" (a real migration defect)
#    and "my parser is broken" (a harness defect). Those demand opposite
#    responses, so the two cases are now named explicitly.
sqlstate() {
  local out code
  out=$(psql -d "$DB" 2>&1 <<SQL
\set VERBOSITY verbose
$1
SQL
)
  code=$(printf '%s\n' "$out" | sed -nE 's/^.*ERROR: +([0-9A-Z]{5}):.*$/\1/p' | head -1)
  if [ -n "$code" ]; then
    printf '%s' "$code"
  elif printf '%s\n' "$out" | grep -q 'ERROR'; then
    # It DID fail, but the code did not parse -> harness defect, say so.
    printf 'UNPARSED'
  else
    # It did NOT fail at all -> the constraint is missing. Migration defect.
    printf 'NO_ERROR'
  fi
}

PASS=0
FAIL=0
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1 ($2)"
    PASS=$((PASS+1))
  else
    echo "  *** FAIL $1 — got '$2', expected '$3' ***"
    FAIL=$((FAIL+1))
  fi
}

echo "=== 1. Apply every migration in order ==================================="
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
echo "applied $applied, failed $failed"
if [ "$failed" -ne 0 ]; then
  echo "*** MIGRATIONS DID NOT ALL APPLY: ${failures[*]} ***"
  FAIL=$((FAIL+1))
fi
# Non-vacuity: if the glob matched nothing, every section below would "pass"
# against an empty database.
if [ "$applied" -lt 229 ]; then
  echo "*** only $applied migrations applied; expected at least 229 — is \$DIR right? ***"
  FAIL=$((FAIL+1))
else
  PASS=$((PASS+1))
fi

echo
echo "=== 2. Re-apply 0229 (idempotency — the owner applies these by hand) ===="
if out=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/0229_leafly_register_claim.sql" 2>&1); then
  echo "  ok   re-apply succeeded"
  PASS=$((PASS+1))
else
  echo "  *** RE-APPLY FAILED — 0229 is NOT idempotent ***"
  echo "$out" | grep -E "ERROR" | head -3
  FAIL=$((FAIL+1))
fi

echo
echo "=== 3. The claim columns on leafly_orders ==============================="
for col in register_device_id register_device_name register_employee_name register_claimed_at; do
  check "$col exists" \
    "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name='$col';")" "1"
  check "$col is nullable (an order is UNCLAIMED until a till takes it)" \
    "$(q "select is_nullable from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name='$col';")" "YES"
  check "$col has NO default" \
    "$(q "select coalesce(column_default,'<none>') from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name='$col';")" "<none>"
done

echo
echo "=== 4. leafly_register_interrupts exists, with RLS ======================"
check "table exists" \
  "$(q "select count(*) from information_schema.tables where table_schema='public' and table_name='leafly_register_interrupts';")" "1"
check "RLS is ENABLED (service-role only; unreachable from a browser)" \
  "$(q "select relrowsecurity from pg_class where oid='public.leafly_register_interrupts'::regclass;")" "t"
check "no anon/authenticated policy exists (RLS on + no policy = closed)" \
  "$(q "select count(*) from pg_policies where schemaname='public' and tablename='leafly_register_interrupts';")" "0"

echo
echo "=== 5. resolved_at must be NULL-by-default =============================="
# If resolved_at defaulted to now(), every interrupt would be born already
# resolved, the register's poll would return nothing, and NO modal would ever
# appear. Every text-reading test in the repo would still be green.
check "resolved_at is nullable" \
  "$(q "select is_nullable from information_schema.columns where table_schema='public' and table_name='leafly_register_interrupts' and column_name='resolved_at';")" "YES"
check "resolved_at has NO default (this IS what 'still blocking' means)" \
  "$(q "select coalesce(column_default,'<none>') from information_schema.columns where table_schema='public' and table_name='leafly_register_interrupts' and column_name='resolved_at';")" "<none>"
check "disposition is nullable while unresolved" \
  "$(q "select is_nullable from information_schema.columns where table_schema='public' and table_name='leafly_register_interrupts' and column_name='disposition';")" "YES"

echo
echo "=== 5b. The indexes carry their PREDICATES, not just their names ========"
# Found by sabotage-0229-proof.sh: this section did not exist, and removing the
# `where resolved_at is null` predicate from the hot poll index was caught by
# NOTHING. Asserting an index exists is not asserting it is the index we
# designed. information_schema has no view for an index predicate, so this
# reads pg_indexes.indexdef. Verified against a real psql 15 that a partial
# index matches and a non-partial one does NOT (so this cannot pass vacuously).
check "the per-device poll index is PARTIAL on resolved_at is null" \
  "$(q "select count(*) from pg_indexes where schemaname='public' and tablename='leafly_register_interrupts' and indexname='leafly_register_interrupts_open_idx' and indexdef ilike '%where (resolved_at is null)%';")" "1"
check "the one-open-per-order index is UNIQUE and PARTIAL" \
  "$(q "select count(*) from pg_indexes where schemaname='public' and tablename='leafly_register_interrupts' and indexname='leafly_register_interrupts_one_open_per_order' and indexdef ilike 'create unique index%' and indexdef ilike '%where (resolved_at is null)%';")" "1"

echo
echo "=== 5c. OUTBOUND values are constrained; the modal text cannot be null =="
# The asymmetry that runs through 0226/0229: values LEAFLY sends us are stored
# verbatim (cancel_reason_code, tested in section 8), values WE invent are
# constrained, because an unexpected one of ours is our own bug and the
# register has no branch to render it.
check "kind is constrained to values we designed" \
  "$(q "select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and t.relname='leafly_register_interrupts' and c.contype='c' and pg_get_constraintdef(c.oid) ilike '%kind%' and pg_get_constraintdef(c.oid) ilike '%leafly_cancel%';")" "1"
# A blocking modal with no text is a blank box the budtender cannot act on.
check "title is NOT NULL (a modal must say something)" \
  "$(q "select is_nullable from information_schema.columns where table_schema='public' and table_name='leafly_register_interrupts' and column_name='title';")" "NO"
check "message is NOT NULL (same reason)" \
  "$(q "select is_nullable from information_schema.columns where table_schema='public' and table_name='leafly_register_interrupts' and column_name='message';")" "NO"
# And the flag the register keys its branch off must never be indeterminate.
check "disposition_required is NOT NULL" \
  "$(q "select is_nullable from information_schema.columns where table_schema='public' and table_name='leafly_register_interrupts' and column_name='disposition_required';")" "NO"

echo
echo "=== 6. BEHAVIOUR: one open interrupt per order (Leafly retries) ========="
# Fixtures. The orders table is the only hard dependency.
#
# customer_first_name is NOT NULL with no default, so it MUST be supplied --
# omitting it rejects the insert, the order never exists, and all eight
# behaviour assertions below fail in a way that reads exactly like a broken
# migration. That is a harness defect, not a migration defect, and it is
# recorded here so it is not rediscovered.
#
# Errors are shown rather than swallowed: a harness that cannot build its own
# fixture must say so in ONE line, near the cause.
if ! fixout=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" 2>&1 <<'SQL'
insert into public.orders (id, order_number, status, customer_first_name)
values ('11111111-1111-1111-1111-111111111111', 'GW-T0229', 'preparing', 'Test')
on conflict (id) do nothing;
SQL
); then
  echo "  *** FIXTURE INSERT FAILED (harness problem, not a migration problem) ***"
  echo "$fixout" | grep -E "ERROR|DETAIL" | head -3
fi
ORDERS_OK=$(q "select count(*) from public.orders where id='11111111-1111-1111-1111-111111111111';")
check "fixture order exists (so the tests below are not vacuous)" "$ORDERS_OK" "1"

FIRST=$(qv "insert into public.leafly_register_interrupts (leafly_order_id, local_order_id, title, message) values ('L-1','11111111-1111-1111-1111-111111111111','t','m') returning 'inserted';" "inserted")
check "the first interrupt inserts" "$FIRST" "inserted"

# THE RETRY. Must be rejected by the database, not by call-site discipline.
DUP=$(sqlstate "insert into public.leafly_register_interrupts (leafly_order_id, local_order_id, title, message) values ('L-1','11111111-1111-1111-1111-111111111111','t','m');")
check "a SECOND open interrupt for the same order is REJECTED (23505)" "$DUP" "23505"

# THE PARTIAL-NESS. Resolve the first, then a later cancellation must be able
# to raise a new one. A non-partial unique index would block this forever and
# the second cancellation would never reach the floor.
psql -q -d "$DB" >/dev/null 2>&1 <<'SQL'
update public.leafly_register_interrupts
   set resolved_at = now(), disposition = 'void', resolved_by_employee = 'Sam'
 where local_order_id = '11111111-1111-1111-1111-111111111111';
SQL
SECOND=$(qv "insert into public.leafly_register_interrupts (leafly_order_id, local_order_id, title, message) values ('L-1','11111111-1111-1111-1111-111111111111','t2','m2') returning 'inserted';" "inserted")
check "after resolving, a NEW interrupt CAN be raised (index is partial)" "$SECOND" "inserted"

echo
echo "=== 7. BEHAVIOUR: disposition is an ALLOWLIST ==========================="
BAD=$(sqlstate "update public.leafly_register_interrupts set disposition='complete' where leafly_order_id='L-1';")
check "an undesigned disposition is REJECTED (23514)" "$BAD" "23514"
for good in void walk_in; do
  OK=$(qv "update public.leafly_register_interrupts set disposition='$good' where title='t' returning 'ok';" "ok")
  check "'$good' is accepted" "$OK" "ok"
done

echo
echo "=== 8. BEHAVIOUR: cancel_reason_code is UNCONSTRAINED (inbound fact) ===="
# Leafly can add a reason code at any time. A CHECK here would reject the truth.
NEW=$(qv "update public.leafly_register_interrupts set cancel_reason_code='a_code_leafly_invents_in_2027' where title='t' returning 'ok';" "ok")
check "an unknown Leafly reason code is STORED, not rejected" "$NEW" "ok"

echo
echo "=== 9. BEHAVIOUR: deleting the order clears its interrupts =============="
# An interrupt pointing at a deleted order is a modal nobody can ever clear.
psql -q -d "$DB" >/dev/null 2>&1 <<'SQL'
delete from public.orders where id = '11111111-1111-1111-1111-111111111111';
SQL
check "interrupts cascade away with the order" \
  "$(q "select count(*) from public.leafly_register_interrupts where local_order_id='11111111-1111-1111-1111-111111111111';")" "0"

echo
echo "=== 10. register_device_id has NO FK, and is nullable ==================="
# A null device means 'any register'. Retiring a till must never block the
# delete or orphan the audit trail.
check "register_device_id is nullable" \
  "$(q "select is_nullable from information_schema.columns where table_schema='public' and table_name='leafly_register_interrupts' and column_name='register_device_id';")" "YES"
check "register_device_id has NO foreign key (deliberate, not forgotten)" \
  "$(q "select count(*) from information_schema.table_constraints tc join information_schema.key_column_usage k on k.constraint_name=tc.constraint_name where tc.table_name='leafly_register_interrupts' and tc.constraint_type='FOREIGN KEY' and k.column_name='register_device_id';")" "0"

echo
echo "=== 11. The factory reset still works ==================================="
OWNER=$(psql -d "$DB" -tAc "insert into auth.users (email) values ('owner0229@example.com') returning id;" 2>&1 | grep -oE '^[0-9a-f-]{36}$' | tail -1)
# 0127's trigger already creates the staff_profiles row readonly/inactive, so
# this must UPDATE rather than insert — an `on conflict do nothing` does
# nothing and is_owner() returns f, which presents as "the reset is broken".
psql -q -d "$DB" >/dev/null 2>&1 <<SQL
update public.staff_profiles set role='owner', active=true, full_name='0229 Owner'
  where id='$OWNER';
SQL
isowner=$(psql -d "$DB" -tAc "set request.jwt.claim.sub = '$OWNER'; select public.is_owner();" 2>&1 \
  | grep -E '^[tf]$' | tail -1)
check "is_owner() is TRUE first (so the reset below cannot pass vacuously)" "$isowner" "t"
# Seed BOTH shapes of interrupt so section 12 below can prove the reset
# actually empties this table and reports a truthful count. Section 9 deleted
# the earlier fixture order, so a fresh parent is needed.
#
# TWO rows on purpose:
#   * one attached to a real order  -> would ALSO vanish via the FK cascade
#   * one with a NULL local_order_id -> cascades from nothing, so ONLY the
#     explicit `delete from public.leafly_register_interrupts` can remove it.
# A row of the second kind surviving is an unclearable modal on a register.
psql -q -d "$DB" >/dev/null 2>&1 <<'SQL'
insert into public.orders (id, order_number, status, customer_first_name)
values ('22222222-2222-2222-2222-222222222222', 'GW-T0229B', 'preparing', 'Reset')
on conflict (id) do nothing;
insert into public.leafly_register_interrupts
  (leafly_order_id, local_order_id, title, message)
values ('L-RESET-1', '22222222-2222-2222-2222-222222222222', 'attached', 'm');
insert into public.leafly_register_interrupts
  (leafly_order_id, local_order_id, title, message)
values ('L-RESET-2', null, 'orphan', 'm');
SQL
SEEDED=$(q "select count(*) from public.leafly_register_interrupts;")
check "two interrupts seeded (so the reset below is not vacuous)" "$SEEDED" "2"

RESET=$(psql -d "$DB" -tAc "set request.jwt.claim.sub = '$OWNER'; select public.gl_factory_reset('ERASE ALL TEST DATA', true);" 2>&1)
# POSITIVE assertion, not the absence of the word ERROR: "no error appeared" is
# also true when the function never ran and when the output was empty.
if echo "$RESET" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true'; then
  echo "  ok   factory reset ran and reported ok:true"
  PASS=$((PASS+1))
else
  echo "  *** FAIL factory reset did not report ok:true — $(echo "$RESET" | grep -vE '^SET$' | head -2 | tr '\n' ' ') ***"
  FAIL=$((FAIL+1))
fi

echo
echo "=== 12. The reset really EMPTIES the interrupts, and says so truthfully =="
# Section 11 only proved the reset returns ok:true, which it would also do if
# it never touched this table. These two checks are what make the WIPE
# classification in factory-reset-core.ts a fact rather than a comment.
check "no interrupt survives the reset" \
  "$(q "select count(*) from public.leafly_register_interrupts;")" "0"

# THE COUNT, not just the emptiness. If the delete were moved BELOW
# `delete from public.orders`, the attached row would vanish via the cascade,
# the table would still be empty, an emptiness-only test would still pass --
# and yet the reset would under-report what it destroyed AND the null-parent
# row would have leaked into go-live. Only the count distinguishes those.
RESET_N=$(printf '%s' "$RESET" | grep -oE '"leafly_register_interrupts"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | head -1)
if [ -z "$RESET_N" ]; then
  echo "  *** FAIL the reset did not report a leafly_register_interrupts count at all ***"
  FAIL=$((FAIL+1))
elif [ "$RESET_N" -ge 2 ]; then
  echo "  ok   the reset reports destroying $RESET_N interrupts (count is truthful,"
  echo "       and the NULL-parent row was covered by the explicit delete)"
  PASS=$((PASS+1))
else
  echo "  *** FAIL reset reported only $RESET_N interrupts, expected 2 — the delete is"
  echo "  *** below the orders delete, so the cascade is silently doing the work ***"
  FAIL=$((FAIL+1))
fi

echo
echo "========================================================================"
echo "  0229 PROOF: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then
  echo "  RESULT: 0229 APPLIES, RE-APPLIES, AND BEHAVES AS DESIGNED"
else
  echo "  RESULT: *** 0229 HAS PROBLEMS — SEE ABOVE ***"
fi
echo "========================================================================"

# `-d postgres` for the same reason as the create above. Without it the
# teardown printed a FATAL to stderr AFTER a clean "42 passed, 0 failed",
# which reads to a human as though the proof failed. A proof whose last line
# contradicts its verdict is a proof nobody trusts.
psql -q -d postgres -c "drop database if exists $DB;" >/dev/null
exit "$FAIL"

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# prove-0228-executes.sh — SLICE L-10
#
# The repo's migration gate (tests/compliance/migration-execution-gate.test.ts)
# requires every migration to be PROVEN to execute, not assumed to. READING SQL
# IS NOT RUNNING SQL. This applies all migrations in order to a real
# PostgreSQL, re-applies 0228 to prove it is idempotent, and then INSPECTS the
# result rather than trusting that the DDL "looked right".
#
# 0228 is the migration that lets a Leafly order reach the shop floor. It adds:
#   * leafly_orders.announced_at / printed_at  — the two-stage arrival record
#   * leafly_orders_unannounced_idx            — the partial index behind the
#                                                idempotency claim
#   * four announcer_settings columns          — per-origin sounds
#
# WHAT THIS HARNESS IS ACTUALLY DEFENDING
# ---------------------------------------
# Every property below fails SILENTLY if the DDL is wrong, and every one of
# them is load-bearing for a real customer's order:
#
#   1. The file applies, and re-applies. The owner applies migrations BY HAND
#      (AGENTS rule 6), one paste at a time, sometimes twice when a paste looks
#      like it failed. A migration that throws on the second application is a
#      migration that will eventually be half-applied on the live shop.
#
#   2. announced_at is NULLABLE with NO default. This is not a style
#      preference, it is the entire idempotency guarantee. The bridge claims
#      arrival work with:
#
#          .update({announced_at: now}).is("announced_at", null)
#
#      If the column had a default of now(), every row would be born already
#      "announced", the claim would match zero rows forever, and NO Leafly
#      order would ever ring the bell or print a ticket. Every text-reading
#      test in the repo would still pass. Only executing it can catch that.
#
#   3. The claim is genuinely ATOMIC under concurrency. Leafly retries
#      webhooks. Two deliveries racing must produce ONE printed ticket, not
#      two — two tickets for one order is how one customer's bag gets built
#      twice. Proven here with two REAL concurrent transactions, not by
#      reasoning about it.
#
#   4. The partial index exists AND has the right predicate. A partial index
#      with the wrong predicate still exists, still shows up in \d, and still
#      silently fails to serve the query it was built for.
#
#   5. first_seen_at — the column the index is ordered by — actually exists.
#      An index on a non-existent column fails at apply time, which is exactly
#      the failure this harness is for.
#
#   6. The four announcer_settings columns are nullable. NULL is the signal
#      that means "use the origin default", which is what makes an existing
#      shop's settings survive this migration unchanged.
#
#   7. announcer_settings' existing row survives. This migration runs against a
#      live shop that already chose its quiet hours and volume; adding columns
#      must not disturb them.
#
#   8. The custom sound path columns have NO foreign key to announcer_sounds.
#      Deliberate: a deleted upload must degrade to a built-in sound, never
#      block the delete or wedge the announcer. Asserted rather than left as a
#      comment, because "we chose not to add an FK" and "we forgot to add an
#      FK" look identical six months later.
#
#   9. 0209's factory reset still works afterwards, and is_owner() is asserted
#      TRUE first so the reset assertions cannot pass vacuously by the reset
#      having been refused. (Learned on 0225/0226 — carried across as a fixture
#      rather than rewritten.)
#
# The three harness defects that cost the most on 0225/0226/0227 are carried
# across rather than rediscovered: the `\set VERBOSITY verbose` heredoc that
# keeps VERBOSITY and the statement in ONE psql session (a separate -c captures
# the word "SET" instead of the SQLSTATE, which presents as a missing
# constraint), the knowledge that 0127's trigger already creates the
# staff_profiles row readonly/inactive so the fixture must UPDATE rather than
# insert (an `on conflict do nothing` does nothing and is_owner() returns f,
# which presents as "the reset is broken"), and the anchored case-sensitive
# reset grep (an unanchored /ERROR|RESET_/i matches `reset_at` inside the
# SUCCESS json and prints a failure banner over a perfect run).
#
# Usage:  sudo -u postgres bash scripts/compliance/prove-0228-executes.sh
# ---------------------------------------------------------------------------
set -uo pipefail

DB=greenway_migtest_0228
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../supabase/migrations" && pwd)"

psql -q -c "drop database if exists $DB;" >/dev/null
psql -q -c "create database $DB;" >/dev/null

# Supabase supplies these; a bare Postgres does not. Created up front so the
# migrations run against the shape they were written for. Lifted verbatim from
# prove-0227-executes.sh so the harnesses cannot diverge in their fixture.
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
if [ "$applied" -lt 228 ]; then
  echo "*** only $applied migrations applied; expected at least 228 — is \$DIR right? ***"
  FAIL=$((FAIL+1))
else
  PASS=$((PASS+1))
fi

echo
echo "=== 2. Re-apply 0228 (idempotency — the owner applies these by hand) ===="
if out=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/0228_leafly_bridge_to_the_floor.sql" 2>&1); then
  echo "  ok   re-apply succeeded"
  PASS=$((PASS+1))
else
  echo "  *** RE-APPLY FAILED — 0228 is NOT idempotent ***"
  echo "$out" | grep -E "ERROR" | head -3
  FAIL=$((FAIL+1))
fi

echo
echo "=== 3. THE IDEMPOTENCY GUARANTEE: announced_at must be NULL-by-default =="
# If this column had a default, the bridge's "where announced_at is null" claim
# would match zero rows forever and no Leafly order would EVER announce or
# print. Every text-reading test would still be green.
check "announced_at exists" \
  "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name='announced_at';")" "1"
check "announced_at is nullable" \
  "$(q "select is_nullable from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name='announced_at';")" "YES"
check "announced_at has NO default (this IS the idempotency guard)" \
  "$(q "select coalesce(column_default,'<none>') from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name='announced_at';")" "<none>"
check "announced_at is a timestamptz, not a boolean" \
  "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name='announced_at';")" "timestamp with time zone"
check "printed_at exists and is nullable" \
  "$(q "select is_nullable from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name='printed_at';")" "YES"
check "printed_at has NO default" \
  "$(q "select coalesce(column_default,'<none>') from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name='printed_at';")" "<none>"
# printed_at is SEPARATE from announced_at on purpose: a shop can have working
# speakers and a jammed printer, and the difference decides which you go fix.
check "announced_at and printed_at are two distinct columns" \
  "$(q "select count(distinct column_name) from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name in ('announced_at','printed_at');")" "2"

echo
echo "=== 4. The column the index sorts by actually exists ===================="
# An index on a column that does not exist fails at apply time. That is exactly
# the class of failure this whole harness exists to catch.
check "leafly_orders.first_seen_at exists" \
  "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='leafly_orders' and column_name='first_seen_at';")" "1"

echo
echo "=== 5. The partial index exists WITH THE RIGHT PREDICATE ================"
# A partial index with the wrong predicate still exists and still shows up in
# \d — and still silently fails to serve the query it was built for.
check "leafly_orders_unannounced_idx exists" \
  "$(q "select count(*) from pg_indexes where schemaname='public' and indexname='leafly_orders_unannounced_idx';")" "1"
check "…and its predicate is (announced_at IS NULL)" \
  "$(q "select case when indexdef ilike '%where (announced_at is null)%' then 'yes' else 'no: '||indexdef end from pg_indexes where schemaname='public' and indexname='leafly_orders_unannounced_idx';")" "yes"

echo
echo "=== 6. THE RACE: two concurrent webhook deliveries, ONE ticket =========="
# Leafly retries webhooks. This is the property that stops a retry printing a
# second ticket for the same customer. Proven with two REAL overlapping
# transactions rather than by reasoning about it.
psql -q -d "$DB" >/dev/null 2>&1 <<'SQL'
insert into public.leafly_orders (leafly_order_id) values ('race-test-0228');
SQL
# Transaction A claims the row and HOLDS the lock open.
psql -d "$DB" -q >/dev/null 2>&1 <<'SQL' &
begin;
update public.leafly_orders set announced_at = now()
  where leafly_order_id = 'race-test-0228' and announced_at is null;
select pg_sleep(2);
commit;
SQL
RACE_A=$!
sleep 0.7
# Transaction B tries the same claim while A is still open. It must block, then
# find zero rows once A commits.
B_ROWS=$(psql -d "$DB" -tAc "
  with claimed as (
    update public.leafly_orders set announced_at = now()
      where leafly_order_id = 'race-test-0228' and announced_at is null
      returning 1
  ) select count(*) from claimed;" 2>&1)
wait $RACE_A
check "the SECOND concurrent delivery claims 0 rows (no double ticket)" "$B_ROWS" "0"
check "…and exactly one claim landed" \
  "$(q "select count(*) from public.leafly_orders where leafly_order_id='race-test-0228' and announced_at is not null;")" "1"
psql -q -d "$DB" -c "delete from public.leafly_orders where leafly_order_id='race-test-0228';" >/dev/null 2>&1

echo
echo "=== 7. The four per-origin sound columns ================================"
for col in leafly_sound_id leafly_custom_sound_path greenway_sound_id greenway_custom_sound_path; do
  check "announcer_settings.$col exists and is nullable" \
    "$(q "select coalesce(is_nullable,'<missing>') from information_schema.columns where table_schema='public' and table_name='announcer_settings' and column_name='$col';")" "YES"
done
# NULL is not merely allowed, it is the SIGNAL: it means "use the origin
# default". A NOT NULL column here would force every shop to pick a sound.
check "all four default to NULL (NULL = use the origin default)" \
  "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='announcer_settings' and column_name in ('leafly_sound_id','leafly_custom_sound_path','greenway_sound_id','greenway_custom_sound_path') and column_default is null;")" "4"

echo
echo "=== 8. NO foreign key on the custom sound paths (deliberate) ============"
# A deleted upload must degrade to a built-in sound, never block the delete or
# wedge the announcer. Asserted, not commented: "we chose not to" and "we
# forgot to" look identical six months later.
check "no FK from announcer_settings sound paths to announcer_sounds" \
  "$(q "select count(*) from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
        where tc.table_schema='public' and tc.table_name='announcer_settings'
          and tc.constraint_type='FOREIGN KEY'
          and kcu.column_name in ('leafly_custom_sound_path','greenway_custom_sound_path');")" "0"

echo
echo "=== 9. An existing shop's settings survive the migration ================"
# This migration runs against a live shop that already chose its quiet hours
# and volume. Adding columns must not disturb any of it.
psql -q -d "$DB" >/dev/null 2>&1 <<'SQL'
insert into public.announcer_settings (id) values (1)
  on conflict (id) do nothing;
SQL
BEFORE=$(q "select count(*) from public.announcer_settings;")
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/0228_leafly_bridge_to_the_floor.sql" >/dev/null 2>&1
check "the settings row still exists after re-applying 0228" \
  "$(q "select count(*) from public.announcer_settings;")" "$BEFORE"
check "…and its new per-origin columns are NULL, not invented values" \
  "$(q "select count(*) from public.announcer_settings where leafly_sound_id is null and leafly_custom_sound_path is null;")" "$BEFORE"

echo
echo "=== 10. orders.origin still constrains after 0228 ======================="
# 0226 added the CHECK. 0228 must not have disturbed it — the bridge writes
# origin='leafly' and a silently-dropped constraint would let anything through.
ORIGIN_OK=$(psql -d "$DB" 2>&1 <<'SQL' | grep -oE "ERROR:[[:space:]]+[0-9A-Z]{5}" | grep -oE "[0-9A-Z]{5}$" | head -1
\set VERBOSITY verbose
insert into public.orders (customer_first_name, origin) values ('Test', 'not_a_real_origin');
SQL
)
check "orders.origin still rejects an unknown value (23514)" "${ORIGIN_OK:-<accepted>}" "23514"
# And the value the bridge actually writes must be ACCEPTED — a constraint that
# rejects everything would pass the test above while breaking the feature.
# `psql -tAc` on an INSERT ... RETURNING prints the returned value AND the
# "INSERT 0 1" command tag, so this must take the FIRST line. Without the head
# the comparison sees two lines and fails while the insert actually succeeded —
# a harness defect that reads exactly like a broken constraint.
LEAFLY_INSERT=$(q "insert into public.orders (customer_first_name, origin) values ('Leafly customer','leafly') returning 'inserted';" | head -1)
check "…while ACCEPTING origin='leafly', which is what the bridge writes" "$LEAFLY_INSERT" "inserted"

echo
echo "=== 11. The factory reset still works (0209) ============================"
# `| head -1` for the same reason as section 10: INSERT ... RETURNING prints
# the value AND the "INSERT 0 1" tag. Without it $OWNER becomes
# "<uuid> INSERT 0 1", every later query fails with "invalid input syntax for
# type uuid", and the section reports the factory reset as broken. Three
# separate assertions in this harness were bitten by this one psql behaviour.
OWNER=$(q "insert into auth.users (email) values ('owner-0228@greenwaymarijuana.com') returning id;" | head -1)
# 0127's trigger already created the staff_profiles row readonly/inactive, so
# this must UPDATE. An 'on conflict do nothing' does nothing, is_owner() returns
# f, and the whole section presents as "the reset is broken".
# The column is `active`, NOT `is_active` — read out of 0185's is_owner()
# definition rather than guessed. Getting this wrong does not error: the UPDATE
# simply matches nothing, is_owner() returns f, and the whole section presents
# as "the factory reset is broken" when nothing is broken at all. That is the
# third time a fixture defect in this family has masqueraded as a migration
# defect, which is why it is now spelled out here.
psql -q -d "$DB" >/dev/null 2>&1 <<SQL
update public.staff_profiles set role='owner', active=true, full_name='0228 Owner'
  where id='$OWNER';
SQL
# `psql -tAc` with TWO statements prints the SET command tag first, then the
# value. `tail -1` looks right and is wrong: when anything emits a NOTICE or a
# CONTEXT line afterwards, tail grabs that instead and the section reports
# "is_owner() is broken" when is_owner() is perfectly fine. Verified live:
# is_owner() returns t here. Take the last line that is EXACTLY t or f.
isowner=$(psql -d "$DB" -tAc "set request.jwt.claim.sub = '$OWNER'; select public.is_owner();" 2>&1 \
  | grep -E '^[tf]$' | tail -1)
check "is_owner() is TRUE first (so the reset below cannot pass vacuously)" "$isowner" "t"
RESET=$(psql -d "$DB" -tAc "set request.jwt.claim.sub = '$OWNER'; select public.gl_factory_reset('ERASE ALL TEST DATA', true);" 2>&1)
# Anchored and case-sensitive on purpose: an unanchored /ERROR|RESET_/i matches
# `reset_at` inside the SUCCESS json and prints a failure banner over a perfect
# run. That cost an hour on 0225.
# POSITIVE assertion, not the absence of the word ERROR. "no error appeared"
# is also true when the function never ran, when psql printed only "SET", and
# when the output was empty — three different broken states that a negative
# check reports as success. gl_factory_reset returns json containing "ok":
# true, so that is what gets asserted.
if echo "$RESET" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true'; then
  echo "  ok   factory reset ran and reported ok:true"
  PASS=$((PASS+1))
else
  echo "  *** FAIL factory reset did not report ok:true — $(echo "$RESET" | grep -vE '^SET$' | head -2 | tr '\n' ' ') ***"
  FAIL=$((FAIL+1))
fi

echo
echo "========================================================================"
echo "  0228 PROOF: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then
  echo "  RESULT: 0228 APPLIES, RE-APPLIES, AND BEHAVES AS DESIGNED"
else
  echo "  RESULT: *** 0228 HAS PROBLEMS — SEE ABOVE ***"
fi
echo "========================================================================"

psql -q -c "drop database if exists $DB;" >/dev/null
exit "$FAIL"

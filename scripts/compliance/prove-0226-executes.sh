#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# prove-0226-executes.sh — SLICE L-6
#
# The repo's migration gate (tests/compliance/migration-execution-gate.test.ts)
# requires every migration to be PROVEN to execute, not assumed to. This applies
# all migrations in order to a real PostgreSQL, re-applies 0226 to prove it is
# idempotent, and then INSPECTS the result rather than trusting that the DDL
# "looked right".
#
# 0226 adds the SENDING side of the Leafly Order API:
#   * public.leafly_outbound_attempts — the append-only log of every outbound
#     call, INCLUDING the ones the pure core refused to make
#   * public.orders.origin            — greenway | leafly | register
#
# The properties checked live, because each one is load-bearing and each one
# fails SILENTLY if the DDL is wrong:
#
#   1. orders.origin defaults to 'greenway' AND backfills existing rows as
#      'greenway'. This is the owner's question made testable. Before 0226 the
#      table only ever held website orders, so "this is a Greenway order" was
#      implicit in the row existing. If the default were NULL or '', the code
#      that suppresses the customer confirmation email for Leafly orders would
#      be reading an empty value, and toOrderOrigin() resolves the unknown to
#      the LEAST restricted origin — so the failure direction would be
#      "emailed a Leafly shopper", which is the contract breach we are trying
#      to prevent. The test inserts a row WITHOUT naming origin, exactly the
#      way the pre-0226 checkout code does, and checks it reads back 'greenway'.
#
#   2. The CHECK constraint really refuses a fourth value. The valid set comes
#      from ORDER_ORIGINS in order-origin-core.ts; if the constraint were
#      missing, a typo like 'Leafly' (capital L) would be stored, and
#      isMarketplaceOrigin() would not match it — again failing in the
#      email-the-shopper direction. Checked by SQLSTATE 23514, which is the
#      code for a check violation, so the test proves the class of failure and
#      not just that "something went wrong".
#
#   3. A REFUSED attempt is storable with response_status NULL. This is the
#      column that makes the log worth keeping: "we declined to ask" and
#      "Leafly said no" look identical in a naive log and need opposite fixes.
#      If response_status were NOT NULL, refusals could not be recorded at all
#      and the most common class of operator mistake would be invisible.
#
#   4. The operation CHECK accepts exactly the three documented endpoints and
#      refuses a fourth. Unlike 0225's inbound event_type — which must accept
#      anything Leafly invents, because only a 200 may be returned — WE choose
#      what we send, so an unknown operation is our own bug and must be loud.
#      The asymmetry between the two migrations is deliberate and is asserted
#      here rather than left as a comment.
#
#   5. The disposition CHECK accepts all five values the pure core can emit and
#      refuses a sixth. Measured against the core's own OutboundDisposition
#      union, because a constraint that disagrees with the code would reject a
#      legitimate log write from inside a catch block — i.e. it would destroy
#      evidence at exactly the moment evidence matters most.
#
#   6. created_by is a real FK to staff_profiles with ON DELETE SET NULL.
#      Acknowledgement is irreversible per the spec ("you will no longer have
#      access to the customer's ID images"), so who pressed it is load-bearing;
#      but a departed staff member must not make the log undeletable, nor take
#      the evidence with them. SET NULL is the only correct behaviour and it is
#      proven by deleting a staff row and re-reading the attempt.
#
#   7. The factory-reset door (0209) can actually empty the new table. 0209 is
#      `create or replace` and this slice added a DELETE to it; if the table
#      name were wrong the reset would abort partway through, which is the D-62
#      failure mode. Also checked: the reset does NOT clear orders.origin's
#      column definition or the credentials.
#
#   8. The partial "trouble" index really excludes successes. A partial index
#      whose predicate is wrong still answers queries correctly — it is just
#      slower — so this is the one property here that CANNOT fail loudly. It is
#      read out of pg_indexes and matched against the predicate text.
#
# Usage: sudo -u postgres bash scripts/compliance/prove-0226-executes.sh
# ---------------------------------------------------------------------------
set -uo pipefail

DB=greenway_migtest_0226
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../supabase/migrations" && pwd)"

# `-d postgres` EXPLICITLY. Without it, `psql -c` connects to a database named
# after the invoking user -- which exists on some machines and not others. When
# it does not exist, the scratch database below is never created and every
# check in this file then fails with "database does not exist", i.e. THE
# HARNESS REPORTS AN ENVIRONMENT PROBLEM AS A MIGRATION DEFECT. That is the
# most expensive false alarm a proof can raise: it points at correct SQL and
# says it is wrong. `postgres` exists on every PostgreSQL install and is
# reachable by both documented invocations of this script.
psql -q -d postgres -c "drop database if exists $DB;" >/dev/null
psql -q -d postgres -c "create database $DB;" >/dev/null

# REFUSE TO CONTINUE if the scratch database is not actually there. Running the
# checks anyway would produce a page of red that blames the migration for a
# problem the migration cannot cause. Exit 2 is deliberately neither 0
# (proved) nor 1 (a real failure): "not proven" is a third outcome.
if ! psql -d "$DB" -tAc "select 1" >/dev/null 2>&1; then
  echo "FATAL: could not create or connect to $DB."
  echo "This is an ENVIRONMENT problem, not a migration problem."
  echo "NOTHING about this migration has been proven or disproven."
  psql -d "$DB" -tAc "select 1" 2>&1 | sed 's/^/  /'
  exit 2
fi

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
# specific token. Lifted verbatim from prove-0225-executes.sh, including the
# reason it is a function: the idiom
#     psql ... | grep -oE "TOKEN" | head -1 || echo "*** FAILED ***"
# looks right but cannot work under `set -o pipefail`, because psql exits
# non-zero whenever the query raises -- which here is the SUCCESS case. pipefail
# then propagates that to the whole pipeline and the `||` branch fires even
# though grep matched. So the output is captured FIRST and tested afterwards,
# and the two distinct outcomes ("did not raise at all" vs "raised the wrong
# error") are reported separately, because they are different defects.
# ---------------------------------------------------------------------------
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

q() { psql -d "$DB" -tAc "$1" 2>&1; }

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
fi

echo
echo "=== 2. Re-apply 0226 (idempotency) ====================================="
# Run with VERBOSITY default so the "already exists, skipping" notices show.
if out=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/0226_leafly_outbound_orders.sql" 2>&1); then
  echo "  re-apply: OK"
  echo "$out" | grep -cE "already exists, skipping" | sed 's/^/  skip notices: /'
else
  echo "  *** RE-APPLY FAILED -- 0226 is NOT idempotent ***"
  echo "$out" | grep -E "ERROR" | head -3
fi

echo
echo "=== 3. orders.origin: shape, default, and the implicit-history backfill ="
echo "  column:   $(q "select column_name||' '||data_type||' nullable='||is_nullable||' default='||coalesce(column_default,'NONE') from information_schema.columns where table_schema='public' and table_name='orders' and column_name='origin';")"

# A row inserted the PRE-0226 way -- naming no origin at all, exactly as the
# existing checkout code does -- must read back 'greenway'. This is the
# assertion that encodes the owner's question: every pre-existing order IS a
# Greenway order, so the default is a statement of fact about history.
#
# The column list here is MEASURED from 0007_slice7_orders.sql, not guessed. The
# first draft of this harness inserted (order_number, status, subtotal, total)
# and fell back to (order_number) alone, with both attempts redirected to
# /dev/null. BOTH failed -- customer_first_name is `text not null` with no
# default, and `status` is the enum public.order_status whose values do not
# include 'pending'. The section then reported origin = '' and, worse,
# "rows with null/empty origin (must be 0): 0", which READ AS A PASS. It was
# counting zero rows because the insert never happened. That is a vacuous
# assertion -- the exact defect class this repo's house rules exist to prevent
# -- and it is why the insert below is no longer silenced and is followed by a
# row-count check that fails loudly when nothing was written.
echo -n "  legacy-style insert (no origin named): "
ins=$(q "insert into public.orders (customer_first_name) values ('L6 Proof');")
echo "${ins:-INSERT 0 1}"
seeded=$(q "select count(*) from public.orders where customer_first_name='L6 Proof';")
if [ "$seeded" != "1" ]; then
  echo "  *** SEED FAILED: expected 1 row, found $seeded -- sections 3/4 would be vacuous ***"
else
  echo "  seeded 1 order; its order_number was trigger-generated: $(q "select order_number from public.orders where customer_first_name='L6 Proof';")"
  echo "  its origin (must be 'greenway'): '$(q "select origin from public.orders where customer_first_name='L6 Proof';")'"
fi
echo "  rows with null/empty origin (must be 0, over $(q "select count(*) from public.orders;") row(s)): $(q "select count(*) from public.orders where origin is null or origin = '';")"

echo
echo "=== 4. orders.origin CHECK refuses anything outside ORDER_ORIGINS ======"
for good in greenway leafly register; do
  out=$(q "update public.orders set origin='$good' where customer_first_name='L6 Proof';")
  echo "  accepts '$good': $out -> reads back '$(q "select origin from public.orders where customer_first_name='L6 Proof';")'"
done
# 23514 = check_violation. Asserting the SQLSTATE and not merely "it failed"
# proves the CLASS of refusal, the same discipline 0225 applied to 23505.
#
# Fed on STDIN, because `\set VERBOSITY verbose` and the statement must share
# ONE session. An earlier draft of this harness passed VERBOSITY as a separate
# `-c` flag and prefixed the statement with `set client_min_messages to error`;
# psql treats each -c as an independent statement, so VERBOSITY never applied,
# and the captured output was the word "SET" from the leading statement rather
# than the error. Both refusals then reported "raised, but NOT with 23514: SET"
# -- a harness defect that looked exactly like a missing constraint. This is the
# same trap 0225's harness documented for 23505; it was re-walked into here,
# which is why it is now written down twice.
sqlstate_for() {
  psql -d "$DB" 2>&1 <<SQL | grep -oE "ERROR:[[:space:]]+[0-9A-Z]{5}" | grep -oE "[0-9A-Z]{5}$" | head -1
\\set VERBOSITY verbose
update public.orders set origin='$1' where customer_first_name='L6 Proof';
SQL
}
for bad in Leafly doordash ''; do
  code=$(sqlstate_for "$bad")
  label="'$bad'"
  [ -z "$bad" ] && label="'' (empty string)"
  if [ "$code" = "23514" ]; then
    echo "  rejects $label with SQLSTATE 23514 (check_violation)"
  else
    echo "  *** $label WAS ACCEPTED or raised ${code:-<nothing>}, not 23514 ***"
  fi
done
echo "  origin after the rejected updates (must still be 'register'): '$(q "select origin from public.orders where customer_first_name='L6 Proof';")'"
# Put it back so later sections see a valid row.
q "update public.orders set origin='greenway' where customer_first_name='L6 Proof';" >/dev/null

echo
echo "=== 5. leafly_outbound_attempts: a REFUSED attempt is storable =========="
# response_status NULL is the whole point: the core declined before dialling.
q "insert into public.leafly_outbound_attempts
     (leafly_order_id, order_integration_key, operation, refusal_code, message)
   values ('ord-refused-1','key-1','acknowledge','already_acknowledged',
           'Refused: this order was already acknowledged.');" >/dev/null
echo "  refused row stored: $(q "select operation||' refusal='||refusal_code||' response_status='||coalesce(response_status::text,'NULL') from public.leafly_outbound_attempts where leafly_order_id='ord-refused-1';")"

# And a real 204 acknowledge, to prove the success path stores the DIFFERENT
# success code. 204 not 200 -- hard-coding 200 anywhere would break this.
q "insert into public.leafly_outbound_attempts
     (leafly_order_id, order_integration_key, operation, response_status, disposition, message)
   values ('ord-ack-1','key-1','acknowledge',204,'success','Leafly accepted the request (204).');" >/dev/null
q "insert into public.leafly_outbound_attempts
     (leafly_order_id, order_integration_key, operation, requested_status, response_status, disposition, request_body, message)
   values ('ord-ack-1','key-1','status','ready',200,'success','{\"status\":\"ready\"}'::jsonb,'Leafly accepted the request (200).');" >/dev/null
echo "  success rows:"
q "select '    '||operation||' -> '||response_status||' ('||disposition||')' from public.leafly_outbound_attempts where disposition='success' order by operation;"

echo
echo "=== 6. operation CHECK: exactly the three documented endpoints =========="
for op in acknowledge status cart; do
  q "insert into public.leafly_outbound_attempts (leafly_order_id, operation, message) values ('ord-op-$op','$op','probe');" >/dev/null
  echo "  accepts '$op': $(q "select count(*) from public.leafly_outbound_attempts where operation='$op';") row(s)"
done
# Same STDIN/VERBOSITY discipline as section 4 -- see the note there.
insert_sqlstate() {
  psql -d "$DB" 2>&1 <<SQL | grep -oE "ERROR:[[:space:]]+[0-9A-Z]{5}" | grep -oE "[0-9A-Z]{5}$" | head -1
\\set VERBOSITY verbose
insert into public.leafly_outbound_attempts (leafly_order_id, operation, disposition, message)
values ('probe-reject', $1, $2, 'probe');
SQL
}
code=$(insert_sqlstate "'cancel'" "null")
if [ "$code" = "23514" ]; then
  echo "  rejects 'cancel' (not one of the three endpoints) with SQLSTATE 23514"
else
  echo "  *** 'cancel' WAS ACCEPTED or raised ${code:-<nothing>}, not 23514 ***"
fi
# The asymmetry with 0225 asserted directly: inbound event_type must accept an
# unknown value (only a 200 may be returned to Leafly), outbound operation must
# not (we choose what we send, so an unknown value is our own bug).
inbound=$(q "insert into public.leafly_webhook_events (body_sha256, event_type) values ('l6-asym-probe','order_teleport');")
echo "  contrast -- inbound event_type ACCEPTS the unknown 'order_teleport': ${inbound:-INSERT 0 1}"
echo "    (0225 must accept anything Leafly invents; 0226 must not. Both directions proven.)"

echo
echo "=== 7. disposition CHECK matches the core's OutboundDisposition union ==="
for d in success retry fix_config fix_request gone; do
  if q "insert into public.leafly_outbound_attempts (leafly_order_id, operation, disposition, message) values ('ord-disp-$d','status','$d','probe');" | grep -qi error; then
    echo "  *** REJECTED '$d' -- the constraint disagrees with the pure core ***"
  else
    echo "  accepts '$d'"
  fi
done
code=$(insert_sqlstate "'status'" "'maybe'")
if [ "$code" = "23514" ]; then
  echo "  rejects 'maybe' (not in OutboundDisposition) with SQLSTATE 23514"
else
  echo "  *** 'maybe' WAS ACCEPTED or raised ${code:-<nothing>}, not 23514 ***"
fi

echo
echo "=== 8. created_by FK -> staff_profiles, ON DELETE SET NULL ============="
echo "  fk: $(q "select confdeltype from pg_constraint where conrelid='public.leafly_outbound_attempts'::regclass and contype='f';") (n = SET NULL, a = NO ACTION, c = CASCADE)"
# staff_profiles.id is itself a FK to auth.users(id), and `email` is `text not
# null` -- measured from 0001_slice1_foundation.sql, not assumed. The first
# draft inserted (full_name, role, active) and captured the error into $SID,
# so the whole section reported blanks and "attempt still present: 0", which
# looked like a broken FK rather than a broken harness.
SID=33333333-3333-3333-3333-333333333333
q "insert into auth.users (id, email) values ('$SID','l6staff@greenwaymarijuana.com') on conflict do nothing;" >/dev/null
q "insert into public.staff_profiles (id, email, full_name, role, active)
   values ('$SID','l6staff@greenwaymarijuana.com','L6 Proof Staff','manager',true) on conflict do nothing;" >/dev/null
if [ "$(q "select count(*) from public.staff_profiles where id='$SID';")" = "1" ]; then
  q "insert into public.leafly_outbound_attempts (leafly_order_id, operation, created_by, message) values ('ord-fk-1','acknowledge','$SID','by a real staff row');" >/dev/null
  echo "  attempt created_by set: $(q "select coalesce(created_by::text,'NULL') from public.leafly_outbound_attempts where leafly_order_id='ord-fk-1';")"
  q "delete from public.staff_profiles where id='$SID';" >/dev/null
  echo "  after deleting the staff row, attempt survives with created_by = $(q "select coalesce(created_by::text,'NULL') from public.leafly_outbound_attempts where leafly_order_id='ord-fk-1';")"
  echo "  attempt still present (must be 1): $(q "select count(*) from public.leafly_outbound_attempts where leafly_order_id='ord-fk-1';")"
else
  echo "  *** could not seed staff_profiles (id=$SID) -- section 8 would be vacuous ***"
fi

echo
echo "=== 9. The partial 'trouble' index really excludes successes ==========="
q "select '  '||indexname||': '||coalesce(substring(indexdef from 'WHERE.*'),'(not partial)') from pg_indexes where tablename='leafly_outbound_attempts' order by indexname;"
echo "  orders.origin index: $(q "select count(*) from pg_indexes where tablename='orders' and indexname='orders_origin_idx';")"

echo
echo "=== 10. RLS: deny-by-default, no permissive policy ====================="
echo "  rls enabled: $(q "select relrowsecurity from pg_class where oid='public.leafly_outbound_attempts'::regclass;")"
echo "  policy count (must be 0): $(q "select count(*) from pg_policies where tablename='leafly_outbound_attempts';")"
echo "  anon/authenticated grants (must be 0): $(q "select count(*) from information_schema.role_table_grants where table_name='leafly_outbound_attempts' and grantee in ('anon','authenticated');")"

echo
echo "=== 11. Factory reset (0209) empties the new outbound log =============="
BEFORE=$(q "select count(*) from public.leafly_outbound_attempts;")
echo "  attempts before reset: $BEFORE"
if [ "$BEFORE" = "0" ]; then
  echo "  *** nothing seeded -- a reset that clears an empty table proves nothing ***"
fi

# 0209 guards on owner identity + the typed phrase + the WAC 314-55-087(1)
# retention check. A real owner is established via auth.uid() rather than by
# redefining is_owner(), which is the lesson recorded in 0225's harness:
# redefining the guard would "prove" the DELETEs against a function that no
# longer resembles production.
#
# THE PHRASE IS MEASURED, NOT INVENTED. The first draft of this harness called
# gl_factory_reset('RESET GREENWAY DATA') -- a phrase that appears nowhere in
# the repo. 0209 requires exactly 'ERASE ALL TEST DATA', and it takes a SECOND
# argument, acknowledge_wac_314_55_087, which must be true whenever completed
# sales exist. The wrong phrase produced RESET_BAD_CONFIRMATION, the log showed
# "reset raised (guard or retention): SET", and section 11 reported a MISMATCH
# that read as "0209 does not clear the new table" when in fact 0209 was never
# reached. Read the FIRST error, not the loudest banner -- the same lesson as
# D-12 in the L-5 notes.
# MEASURED, not assumed: inserting into auth.users FIRES A TRIGGER
# (trg_on_auth_user_created, re-defined by 0127_staff_profiles_inactive_by_default)
# which already creates the staff_profiles row -- as role 'readonly' and
# active = FALSE, deliberately, so a new sign-up cannot grant itself access.
#
# So the profile must be UPDATED, never inserted. An earlier draft of this
# harness used `insert ... on conflict do nothing` and silenced the output; the
# insert hit staff_profiles_pkey, did nothing, and left the row as
# readonly/inactive. is_owner() then correctly returned false and section 11
# reported RESET_NOT_OWNER -- which reads as "the reset is broken" when in fact
# the reset's owner guard was working perfectly and the HARNESS was wrong. The
# update is now unsilenced and is_owner() is asserted before the reset is
# attempted, so this can never again be mistaken for a schema fault.
OWNER=44444444-4444-4444-4444-444444444444
q "insert into auth.users (id, email) values ('$OWNER','l6owner@greenwaymarijuana.com') on conflict do nothing;" >/dev/null
echo "  trigger-created profile before update: $(q "select role||' active='||active from public.staff_profiles where id='$OWNER';")"
echo -n "  promoting to active owner: "
q "update public.staff_profiles set role='owner', active=true, full_name='L6 Owner' where id='$OWNER';"
isowner=$(psql -d "$DB" -tAc "set request.jwt.claim.sub = '$OWNER'; select public.is_owner();" 2>&1 | tail -1)
echo "  is_owner() (must be t): $isowner"
if [ "$isowner" != "t" ]; then
  echo "  *** owner identity not established -- the rest of section 11 would be vacuous ***"
fi

# Proven as a REFUSAL first: the wrong phrase must not delete anything, even
# for a genuine owner. This turns the harness's own earlier mistake into an
# assertion -- 'RESET GREENWAY DATA' is a phrase that appears nowhere in this
# repo, and 0209 requires exactly 'ERASE ALL TEST DATA'.
#
# The expected code is RESET_BAD_CONFIRMATION specifically. Checking for the
# generic prefix RESET_ would also have matched RESET_NOT_OWNER, which is how
# the earlier draft's real problem stayed hidden: both are refusals, but only
# one of them means the phrase guard was reached.
badphrase=$(psql -d "$DB" -tAc "set request.jwt.claim.sub = '$OWNER'; select public.gl_factory_reset('RESET GREENWAY DATA', true);" 2>&1 | grep -oE "RESET_[A-Z_]+" | head -1)
if [ "$badphrase" = "RESET_BAD_CONFIRMATION" ]; then
  echo "  wrong phrase refused with RESET_BAD_CONFIRMATION (the phrase guard was reached)"
else
  echo "  *** expected RESET_BAD_CONFIRMATION, got: ${badphrase:-<nothing -- THE PHRASE GUARD DID NOT HOLD>} ***"
fi
# And the retention guard: WITHOUT the WAC acknowledgement, a completed sale
# must block the wipe. Seeded here rather than assumed, because section 3's
# order is 'new' -- if nothing were completed, this guard would pass vacuously.
q "insert into public.orders (customer_first_name, status) values ('L6 Completed','completed');" >/dev/null
retention=$(psql -d "$DB" -tAc "set request.jwt.claim.sub = '$OWNER'; select public.gl_factory_reset('ERASE ALL TEST DATA');" 2>&1 | grep -oE "RETENTION GUARD[^\"]*" | head -1)
if [ -n "$retention" ]; then
  echo "  WAC 314-55-087(1) retention guard held: $(echo "$retention" | cut -c1-96)..."
else
  echo "  *** the retention guard did NOT fire despite a completed sale existing ***"
fi
echo "  attempts still intact after the refused reset (must be $BEFORE): $(q "select count(*) from public.leafly_outbound_attempts;")"

# Now the real thing, with the correct phrase and the retention acknowledgement.
RESET=$(psql -d "$DB" -tAc "set request.jwt.claim.sub = '$OWNER'; select public.gl_factory_reset('ERASE ALL TEST DATA', true);" 2>&1)
echo "  reset reported for the new table: $(echo "$RESET" | grep -oE '"leafly_outbound_attempts": *[0-9]+' | head -1)"
echo "  reset reported ok: $(echo "$RESET" | grep -oE '"ok": *(true|false)' | head -1), tables_emptied=$(echo "$RESET" | grep -oE '"tables_emptied": *[0-9]+' | head -1 | grep -oE '[0-9]+')"
# Case-SENSITIVE and anchored. A first draft used `grep -qiE "ERROR|RESET_"`,
# which matched the string "reset_at" inside the SUCCESS payload and printed a
# "*** reset raised ***" banner over a reset that had worked perfectly. A false
# alarm in a proof harness is not harmless: it trains the reader to skim past
# the banners that matter.
if echo "$RESET" | grep -qE "^ERROR:|RESET_NOT_OWNER|RESET_BAD_CONFIRMATION|RETENTION GUARD"; then
  echo "  *** reset raised: $(echo "$RESET" | grep -oE "^ERROR:.*|RESET_[A-Z_]+|RETENTION GUARD" | head -1) ***"
fi
AFTER=$(q "select count(*) from public.leafly_outbound_attempts;")
echo "  attempts after reset: $AFTER"
if [ "$BEFORE" -gt 0 ] && [ "$AFTER" -eq 0 ]; then
  echo "  reset DID empty the outbound log"
elif [ "$BEFORE" = "$AFTER" ]; then
  echo "  *** MISMATCH: before $BEFORE, after $AFTER -- the reset did not clear it ***"
fi
# The reset must NOT de-authenticate the integration, same as 0225 proved.
echo "  integration_credentials rows survive reset: $(q "select count(*) from public.integration_credentials;")"
echo "  orders.origin column survives reset: $(q "select count(*) from information_schema.columns where table_name='orders' and column_name='origin';")"

echo
echo "=== DONE ==============================================================="
# `-d postgres` for the same reason as the create above. Without it the
# teardown prints a FATAL to stderr AFTER the verdict, which reads to a human
# as though the proof had failed.
psql -q -d postgres -c "drop database if exists $DB;" >/dev/null

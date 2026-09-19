#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# prove-0227-executes.sh — SLICE L-7
#
# The repo's migration gate (tests/compliance/migration-execution-gate.test.ts)
# requires every migration to be PROVEN to execute, not assumed to. This applies
# all migrations in order to a real PostgreSQL, re-applies 0227 to prove it is
# idempotent, and then INSPECTS the result rather than trusting that the DDL
# "looked right".
#
# 0227 adds public.leafly_sync_runs — the log of every menu sync attempt from
# BOTH the schedule and the manual button, including the attempts the pure core
# refused to make.
#
# THE PROPERTY THIS MIGRATION EXISTS FOR
# --------------------------------------
# The owner asked for "both automation and a manual push button". The hard part
# is not either one — it is making them coexist without ever sending two menu
# writes at once. A Leafly POST is a FULL sync: it deletes anything omitted from
# its payload. Two of them racing is therefore not a cosmetic problem, it is a
# menu that loses items depending on which request Leafly finishes reading last.
#
# The lock is `finished_at is null` on a real row. Not pg_try_advisory_lock:
# Supabase's pooled HTTP interface gives no session affinity, so a session-scoped
# advisory lock would be taken and released on whichever pooled connection
# answered, i.e. it would not be a lock at all. That reasoning is recorded in
# schedule-server.ts; this harness proves the row-based alternative actually
# holds in the database.
#
# The properties checked live, because each one is load-bearing and each one
# fails SILENTLY if the DDL is wrong:
#
#   1. The table applies, and re-applies (idempotent).
#
#   2. A REFUSED run is storable with disposition='refused', method NULL and
#      http_status NULL. This is the row that makes the log worth keeping: "the
#      cron fired and correctly decided not to push" and "the cron never fired"
#      are indistinguishable without it, and they need opposite fixes. If
#      http_status were NOT NULL, refusals could not be recorded at all — and
#      refusals are the overwhelming majority of ticks.
#
#   3. An IN-FLIGHT run is storable with disposition NULL, and the partial index
#      that finds it exists with the right predicate. The NULL *is* the lock, so
#      a NOT NULL constraint here would break the entire coexistence guarantee
#      while leaving every other test passing.
#
#   4. decision_code's CHECK accepts exactly the eleven values the code can
#      emit — the ten in ALL_SCHEDULED_RUN_CODES plus 'manual_requested' — and
#      refuses a twelfth. Measured against the core's own exported list rather
#      than retyped, because a constraint that disagrees with the code would
#      reject a legitimate log write from inside the scheduler and destroy the
#      evidence of why a sync did not happen.
#
#   5. disposition's CHECK accepts the FOUR storable values and refuses
#      'blocked'. This asymmetry is deliberate and is asserted rather than left
#      as a comment: 'blocked' is returned in memory when no row could be opened
#      at all, so it can never be written. See CloseRunArgs in
#      schedule-server.ts for why widening either side would be a mistake.
#
#   6. leafly_sync_runs_trigger_actor_coherent really refuses a scheduled run
#      that names an actor. Nobody presses anything at 4am; a scheduled row
#      carrying a staff id would be a false attribution in the one log that is
#      meant to answer "who did this".
#
#   7. leafly_sync_runs_pushed_has_method really refuses pushed=true with a NULL
#      method, and pushed=false with a method. Both directions, because either
#      one produces a history that cannot be read: a push with no method, or a
#      refusal that claims to have sent a POST.
#
#   8. created_by is a real FK to staff_profiles with ON DELETE SET NULL. A
#      departed staff member must not take the record of what the integration
#      did with them, nor make the log undeletable.
#
#   9. The factory-reset door (0209) can actually empty the new table. 0209 is
#      `create or replace` and this slice added a DELETE to it; if the table
#      name were wrong the reset would abort partway through. This is the D-62
#      failure mode and the L-6 lesson, so it is proven, not assumed.
#
#  10. RLS is ON with zero policies and zero anon/authenticated grants.
#
#  11. The 'skipped' disposition is storable AND is distinguishable from
#      'failed'. This one is easy to dismiss as a detail and is not: the
#      scheduler counts consecutive failures to decide when to back off, and
#      'skipped' means "nothing had changed, so nothing was sent" — the system
#      working perfectly. If those two collapsed into one value, three efficient
#      no-op days in a row would silently back the scheduler off.
#
# Usage: sudo -u postgres bash scripts/compliance/prove-0227-executes.sh
# ---------------------------------------------------------------------------
set -uo pipefail

DB=greenway_migtest_0227
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../supabase/migrations" && pwd)"
CORE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/src/lib/leafly/schedule-core.ts"

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
# migrations run against the shape they were written for. Lifted from
# prove-0226-executes.sh so the two harnesses cannot diverge in their fixture.
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

# ---------------------------------------------------------------------------
# sqlstate_for <sql> -- run a statement and return only its SQLSTATE.
#
# Fed on STDIN, because `\set VERBOSITY verbose` and the statement must share
# ONE session. prove-0226 records this trap twice, having walked into it twice:
# psql treats each -c as an independent statement, so VERBOSITY never applies
# and the captured output is the word "SET" rather than the error -- a harness
# defect that looks exactly like a missing constraint. Reusing the working form
# rather than reinventing it.
#
# Returns the empty string when the statement SUCCEEDED, which callers must
# treat as a failed assertion: "the guard did not hold" is the interesting case.
# ---------------------------------------------------------------------------
sqlstate_for() {
  psql -d "$DB" 2>&1 <<SQL | grep -oE "ERROR:[[:space:]]+[0-9A-Z]{5}" | grep -oE "[0-9A-Z]{5}$" | head -1
\\set VERBOSITY verbose
$1
SQL
}

# expect_check_violation <label> <sql>
expect_check_violation() {
  local label="$1" sql="$2" code
  code=$(sqlstate_for "$sql")
  if [ "$code" = "23514" ]; then
    echo "  rejects $label with SQLSTATE 23514 (check_violation)"
    return 0
  fi
  echo "  *** $label WAS ACCEPTED or raised ${code:-<nothing>}, not 23514 ***"
  return 1
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
fi
# Non-vacuity: if the glob matched nothing, every section below would "pass"
# against an empty database.
if [ "$applied" -lt 227 ]; then
  echo "*** only $applied migrations applied; expected at least 227 -- is \$DIR right? ***"
fi

echo
echo "=== 2. Re-apply 0227 (idempotency) ====================================="
if out=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/0227_leafly_scheduled_sync.sql" 2>&1); then
  echo "  re-apply: OK"
  echo "$out" | grep -cE "already exists, skipping" | sed 's/^/  skip notices: /'
else
  echo "  *** RE-APPLY FAILED -- 0227 is NOT idempotent ***"
  echo "$out" | grep -E "ERROR" | head -3
fi
echo "  table present: $(q "select count(*) from information_schema.tables where table_schema='public' and table_name='leafly_sync_runs';")"
echo "  channel column type: $(q "select udt_name from information_schema.columns where table_name='leafly_sync_runs' and column_name='channel';") (reuses the 0049 enum, not free text)"

echo
echo "=== 3. A REFUSED run is storable: no method, no HTTP status ============"
# The common case. Most cron ticks correctly do nothing, and a log that cannot
# record that is silent about the difference between "deciding not to push" and
# "never ran".
q "insert into public.leafly_sync_runs
     (trigger_source, decision_code, pushed, disposition, reason, finished_at)
   values ('schedule','not_due',false,'refused',
           'Nothing is due right now.', now());" >/dev/null
echo "  refused row: $(q "select decision_code||' pushed='||pushed||' method='||coalesce(method,'NULL')||' http='||coalesce(http_status::text,'NULL')||' disposition='||coalesce(disposition,'NULL') from public.leafly_sync_runs where decision_code='not_due';")"
if [ "$(q "select count(*) from public.leafly_sync_runs where decision_code='not_due' and method is null and http_status is null;")" != "1" ]; then
  echo "  *** a refusal could not be stored with NULL method/status -- refusals would be unloggable ***"
fi

echo
echo "=== 4. An IN-FLIGHT run is storable, and the NULL is the lock =========="
# disposition NULL + finished_at NULL. If either column were NOT NULL the entire
# coexistence guarantee would be gone while every other test still passed.
q "insert into public.leafly_sync_runs
     (trigger_source, decision_code, pushed, reason)
   values ('schedule','daily_full',false,'Daily full sync starting.');" >/dev/null
echo "  in-flight row: $(q "select decision_code||' disposition='||coalesce(disposition,'NULL')||' finished_at='||coalesce(finished_at::text,'NULL') from public.leafly_sync_runs where decision_code='daily_full';")"
INFLIGHT=$(q "select count(*) from public.leafly_sync_runs where channel='leafly' and finished_at is null;")
echo "  rows the lock query finds (must be 1): $INFLIGHT"
if [ "$INFLIGHT" != "1" ]; then
  echo "  *** the lock query does not see the in-flight run -- two syncs could overlap ***"
fi
echo "  partial in-flight index:"
q "select '    '||indexname||': '||coalesce(substring(indexdef from 'WHERE.*'),'(NOT PARTIAL -- it would scan all history)') from pg_indexes where tablename='leafly_sync_runs' order by indexname;"
# A partial index with the wrong predicate still answers correctly, just slowly,
# so this is the one property here that CANNOT fail loudly. Matched as text.
if q "select indexdef from pg_indexes where indexname='leafly_sync_runs_in_flight_idx';" | grep -q "finished_at IS NULL"; then
  echo "  in-flight index predicate matches the code's condition (finished_at IS NULL)"
else
  echo "  *** the in-flight index predicate does NOT match finished_at IS NULL -- the planner cannot use it ***"
fi
# Close it so later sections are not confused by a stuck lock.
q "update public.leafly_sync_runs set disposition='success', pushed=true, method='POST',
     http_status=200, item_count=147, plan_summary='147 items', finished_at=now()
   where decision_code='daily_full';" >/dev/null
echo "  after closing: $(q "select disposition||' method='||method||' http='||http_status||' items='||item_count from public.leafly_sync_runs where decision_code='daily_full';")"

echo
echo "=== 5. decision_code CHECK matches ALL_SCHEDULED_RUN_CODES + manual ===="
# MEASURED from the pure core, not retyped. If the two ever disagree, the
# scheduler's own log write fails -- destroying the evidence of why a sync did
# not happen, at the moment it is most needed.
CODES=$(grep -A 14 "export const ALL_SCHEDULED_RUN_CODES" "$CORE" \
        | grep -oE '"[a-z_]+"' | tr -d '"' | sort -u)
NCODES=$(echo "$CODES" | grep -c .)
echo "  codes read from schedule-core.ts: $NCODES"
if [ "$NCODES" -ne 10 ]; then
  echo "  *** expected 10 codes in ALL_SCHEDULED_RUN_CODES, parsed $NCODES -- the grep is wrong, section 5 is vacuous ***"
fi
accepted=0
for c in $CODES; do
  if q "insert into public.leafly_sync_runs (trigger_source, decision_code, reason) values ('schedule','$c','probe');" | grep -qi error; then
    echo "  *** REJECTED '$c' -- the CHECK disagrees with the pure core ***"
  else
    accepted=$((accepted+1))
  fi
done
echo "  accepted $accepted of $NCODES schedule-core codes"
# 'manual_requested' is the one value that is NOT a schedule-core code: the
# button does not consult the scheduler's due-ness logic at all.
if q "insert into public.leafly_sync_runs (trigger_source, decision_code, reason, created_by) values ('manual','manual_requested','probe',null);" | grep -qi error; then
  echo "  *** REJECTED 'manual_requested' -- the button could not log its own runs ***"
else
  echo "  accepts 'manual_requested' (the button's own code)"
fi
expect_check_violation "'teleport' (not a real decision code)" \
  "insert into public.leafly_sync_runs (trigger_source, decision_code) values ('schedule','teleport');"
expect_check_violation "'doordash' as a trigger_source" \
  "insert into public.leafly_sync_runs (trigger_source, decision_code) values ('doordash','not_due');"

echo
echo "=== 6. disposition CHECK: four storable values, and NOT 'blocked' ======"
for d in success skipped refused failed; do
  if q "insert into public.leafly_sync_runs (trigger_source, decision_code, disposition, finished_at) values ('schedule','not_due','$d',now());" | grep -qi error; then
    echo "  *** REJECTED '$d' -- a legitimate outcome could not be recorded ***"
  else
    echo "  accepts '$d'"
  fi
done
# The deliberate asymmetry, asserted instead of merely commented. 'blocked' is
# returned in memory when NO row could be opened, so it can never be written;
# widening either side would let a blocked outcome reach an UPDATE that the
# constraint rejects, from inside a catch block.
expect_check_violation "'blocked' (an in-memory-only outcome)" \
  "insert into public.leafly_sync_runs (trigger_source, decision_code, disposition, finished_at) values ('schedule','not_due','blocked',now());"
expect_check_violation "'maybe'" \
  "insert into public.leafly_sync_runs (trigger_source, decision_code, disposition, finished_at) values ('schedule','not_due','maybe',now());"

echo
echo "=== 7. 'skipped' is distinguishable from 'failed' (the backoff input) =="
# Easy to dismiss as a detail, and is not. The scheduler counts consecutive
# 'failed' rows to decide when to back off. 'skipped' means "nothing had
# changed, so nothing was sent" -- the system working. If they collapsed, three
# efficient no-op days would silently slow the scheduler down.
q "insert into public.leafly_sync_runs (trigger_source, decision_code, pushed, disposition, reason, finished_at)
   values ('schedule','intraday_delta',false,'skipped','Nothing had changed.',now());" >/dev/null
q "insert into public.leafly_sync_runs (trigger_source, decision_code, pushed, method, disposition, http_status, error_detail, finished_at)
   values ('schedule','intraday_delta',true,'PUT','failed',500,'Leafly server error (500).',now());" >/dev/null
echo "  skipped rows: $(q "select count(*) from public.leafly_sync_runs where disposition='skipped';")"
echo "  failed rows:  $(q "select count(*) from public.leafly_sync_runs where disposition='failed';")"
echo "  the backoff query (consecutive failures) can isolate them: $(q "select count(*) from public.leafly_sync_runs where disposition='failed' and finished_at is not null;")"
echo "  partial failures index present: $(q "select count(*) from pg_indexes where indexname='leafly_sync_runs_failures_idx';")"

echo
echo "=== 8. trigger_actor_coherent: nobody presses anything at 4am =========="
echo "  constraint present: $(q "select count(*) from pg_constraint where conname='leafly_sync_runs_trigger_actor_coherent';")"
SID=55555555-5555-5555-5555-555555555555
q "insert into auth.users (id, email) values ('$SID','l7staff@greenwaymarijuana.com') on conflict do nothing;" >/dev/null
# MEASURED (prove-0226's lesson): inserting into auth.users FIRES
# trg_on_auth_user_created, which already creates the staff_profiles row as
# readonly/inactive by design (0127). So the profile must be UPDATED, never
# inserted -- an `on conflict do nothing` insert silently does nothing and
# leaves the row inactive, which then looks like a broken FK.
echo -n "  trigger-created profile, promoted: "
q "update public.staff_profiles set role='manager', active=true, full_name='L7 Proof Staff' where id='$SID';"
if [ "$(q "select count(*) from public.staff_profiles where id='$SID';")" != "1" ]; then
  echo "  *** could not seed staff_profiles -- sections 8 and 10 would be vacuous ***"
fi
expect_check_violation "a 'schedule' run that names a staff member" \
  "insert into public.leafly_sync_runs (trigger_source, decision_code, created_by) values ('schedule','daily_full','$SID');"
if q "insert into public.leafly_sync_runs (trigger_source, decision_code, created_by, reason) values ('manual','manual_requested','$SID','pressed the button');" | grep -qi error; then
  echo "  *** REJECTED a manual run WITH an actor -- the button could not be attributed ***"
else
  echo "  accepts a 'manual' run that names a staff member"
fi
# And the permissive half, asserted so the constraint is not accidentally
# stricter than intended: a manual run with no actor must still be storable,
# because beginManualRun is called with a null staff id when the session cannot
# be resolved and must never block the owner's button.
if q "insert into public.leafly_sync_runs (trigger_source, decision_code, created_by, reason) values ('manual','manual_requested',null,'button, actor unknown');" | grep -qi error; then
  echo "  *** REJECTED a manual run with a NULL actor -- the button would fail when the session is unresolved ***"
else
  echo "  accepts a 'manual' run with a NULL actor (the button must never be blocked by logging)"
fi

echo
echo "=== 9. pushed_has_method, in BOTH directions ==========================="
echo "  constraint present: $(q "select count(*) from pg_constraint where conname='leafly_sync_runs_pushed_has_method';")"
expect_check_violation "pushed=true with no method" \
  "insert into public.leafly_sync_runs (trigger_source, decision_code, pushed, method) values ('schedule','daily_full',true,null);"
expect_check_violation "pushed=false that claims a POST" \
  "insert into public.leafly_sync_runs (trigger_source, decision_code, pushed, method) values ('schedule','not_due',false,'POST');"
expect_check_violation "method 'PATCH' (not a Leafly menu write)" \
  "insert into public.leafly_sync_runs (trigger_source, decision_code, pushed, method) values ('schedule','daily_full',true,'PATCH');"
for m in POST PUT DELETE; do
  if q "insert into public.leafly_sync_runs (trigger_source, decision_code, pushed, method, disposition, finished_at) values ('schedule','daily_full',true,'$m','success',now());" | grep -qi error; then
    echo "  *** REJECTED method '$m' -- it is a documented Leafly menu write ***"
  else
    echo "  accepts method '$m'"
  fi
done

echo
echo "=== 10. created_by FK -> staff_profiles, ON DELETE SET NULL ============"
echo "  fk delete action: $(q "select confdeltype from pg_constraint where conrelid='public.leafly_sync_runs'::regclass and contype='f';") (n = SET NULL, a = NO ACTION, c = CASCADE)"
q "insert into public.leafly_sync_runs (trigger_source, decision_code, created_by, reason) values ('manual','manual_requested','$SID','fk probe');" >/dev/null
echo "  before deleting the staff row: created_by = $(q "select coalesce(created_by::text,'NULL') from public.leafly_sync_runs where reason='fk probe';")"
q "delete from public.staff_profiles where id='$SID';" >/dev/null
echo "  after  deleting the staff row: created_by = $(q "select coalesce(created_by::text,'NULL') from public.leafly_sync_runs where reason='fk probe';")"
echo "  the run row survives (must be 1): $(q "select count(*) from public.leafly_sync_runs where reason='fk probe';")"

echo
echo "=== 11. RLS: deny-by-default, no permissive policy ====================="
echo "  rls enabled: $(q "select relrowsecurity from pg_class where oid='public.leafly_sync_runs'::regclass;")"
echo "  policy count (must be 0): $(q "select count(*) from pg_policies where tablename='leafly_sync_runs';")"
echo "  anon/authenticated grants (must be 0): $(q "select count(*) from information_schema.role_table_grants where table_name='leafly_sync_runs' and grantee in ('anon','authenticated');")"

echo
echo "=== 12. Factory reset (0209) empties the new run log ===================="
BEFORE=$(q "select count(*) from public.leafly_sync_runs;")
echo "  run rows before reset: $BEFORE"
if [ "$BEFORE" = "0" ]; then
  echo "  *** nothing seeded -- a reset that clears an empty table proves nothing ***"
fi

# 0209 guards on owner identity + the typed phrase + the WAC 314-55-087(1)
# retention check. The phrase is MEASURED ('ERASE ALL TEST DATA'), and a real
# owner is established via auth.uid() rather than by redefining is_owner() --
# redefining the guard would "prove" the DELETEs against a function that no
# longer resembles production. Both lessons are recorded in prove-0226.
OWNER=66666666-6666-6666-6666-666666666666
q "insert into auth.users (id, email) values ('$OWNER','l7owner@greenwaymarijuana.com') on conflict do nothing;" >/dev/null
echo "  trigger-created profile before update: $(q "select role||' active='||active from public.staff_profiles where id='$OWNER';")"
echo -n "  promoting to active owner: "
q "update public.staff_profiles set role='owner', active=true, full_name='L7 Owner' where id='$OWNER';"
isowner=$(psql -d "$DB" -tAc "set request.jwt.claim.sub = '$OWNER'; select public.is_owner();" 2>&1 | tail -1)
echo "  is_owner() (must be t): $isowner"
if [ "$isowner" != "t" ]; then
  echo "  *** owner identity not established -- the rest of section 12 would be vacuous ***"
fi

RESET=$(psql -d "$DB" -tAc "set request.jwt.claim.sub = '$OWNER'; select public.gl_factory_reset('ERASE ALL TEST DATA', true);" 2>&1)
echo "  reset reported for the new table: $(echo "$RESET" | grep -oE '"leafly_sync_runs": *[0-9]+' | head -1)"
echo "  reset reported ok: $(echo "$RESET" | grep -oE '"ok": *(true|false)' | head -1)"
# Case-SENSITIVE and anchored: prove-0226 records that `grep -qiE "ERROR|RESET_"`
# matches the string "reset_at" inside the SUCCESS payload and raises a false
# alarm over a reset that worked. A false alarm in a proof harness trains the
# reader to skim past the banners that matter.
if echo "$RESET" | grep -qE "^ERROR:|RESET_NOT_OWNER|RESET_BAD_CONFIRMATION|RETENTION GUARD"; then
  echo "  *** reset raised: $(echo "$RESET" | grep -oE "^ERROR:.*|RESET_[A-Z_]+|RETENTION GUARD" | head -1) ***"
fi
AFTER=$(q "select count(*) from public.leafly_sync_runs;")
echo "  run rows after reset: $AFTER"
if [ "$BEFORE" -gt 0 ] && [ "$AFTER" -eq 0 ]; then
  echo "  reset DID empty the sync run log"
elif [ "$BEFORE" = "$AFTER" ]; then
  echo "  *** MISMATCH: before $BEFORE, after $AFTER -- 0209 does not clear leafly_sync_runs ***"
fi
# The reset must NOT de-authenticate the integration, nor forget the owner's
# schedule: a factory reset clears TEST DATA, and the schedule is configuration.
echo "  integration_credentials survive reset: $(q "select count(*) from public.integration_credentials;")"
echo "  syndication_sync_settings table survives reset: $(q "select count(*) from information_schema.tables where table_schema='public' and table_name='syndication_sync_settings';")"

echo
echo "=== DONE ==============================================================="
# `-d postgres` for the same reason as the create above. Without it the
# teardown prints a FATAL to stderr AFTER the verdict, which reads to a human
# as though the proof had failed.
psql -q -d postgres -c "drop database if exists $DB;" >/dev/null

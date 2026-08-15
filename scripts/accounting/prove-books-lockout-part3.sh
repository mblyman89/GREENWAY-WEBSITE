#!/usr/bin/env bash
# scripts/accounting/prove-books-lockout-part3.sh
# =============================================================================
# PART 3: WILL THE PROPOSED FIX ACTUALLY WORK?
#
# The fix for the lockout is to stop calling the books over the service-role
# key (which carries no user, so is_admin() is false and every books function
# refuses) and to call them over the SIGNED-IN USER'S session instead, where
# auth.uid() is really Michael and is_admin() is really true.
#
# Before writing a line of that fix, three things must be checked, because a
# repair that trades one outage for another is not a repair:
#
#   1. Does the `authenticated` role actually have EXECUTE on all the books
#      functions? 0177 contains NO grant statements at all -- gl_override_report
#      and gl_set_owner_override were never granted to anyone. If PostgreSQL's
#      default (EXECUTE to PUBLIC) is in force they will work anyway; if the
#      repo revokes that default, the fix would break the override screen.
#      This is checked, not assumed.
#
#   2. Can a signed-in owner READ gl_accounts through RLS? The chart of accounts
#      currently reads the table over the service-role key, which BYPASSES RLS
#      entirely. That is why it reached the database at all and failed on a
#      column name rather than on permission. Moving to the user's session puts
#      RLS back in the path, so RLS must be proven to admit the owner.
#
#   3. Do the CORRECTED column names actually select cleanly? Part 2 proved
#      three of seven names are wrong. The replacements are checked here as a
#      complete working query, not one column at a time.
#
# Usage:    bash scripts/accounting/prove-books-lockout-part3.sh
# Requires: postgresql server binaries. Never connects to production.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HARNESS="$REPO_ROOT/scripts/accounting/gl-schema-harness.sql"

MIGRATIONS=(
  "$REPO_ROOT/supabase/migrations/0172_gl_foundation.sql"
  "$REPO_ROOT/supabase/migrations/0173_chart_of_accounts.sql"
  "$REPO_ROOT/supabase/migrations/0174_gl_posting_service.sql"
  "$REPO_ROOT/supabase/migrations/0175_gl_trial_balance.sql"
  "$REPO_ROOT/supabase/migrations/0176_opening_balances.sql"
  "$REPO_ROOT/supabase/migrations/0177_owner_override.sql"
  "$REPO_ROOT/supabase/migrations/0178_fixed_assets.sql"
)

PGBIN="${PGBIN:-/usr/lib/postgresql/15/bin}"
PGPORT="${PGPORT:-5473}"
PGDATA_DIR="$(mktemp -d /tmp/lockoutproof3.XXXXXX)"
DB="lockout_proof3"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

echo "=== PROOF PART 3: will the fix work? ==="

AS_ROOT=0
if [ "$(id -u)" -eq 0 ]; then
  chmod 711 "$PGDATA_DIR"; chown -R postgres "$PGDATA_DIR"; AS_ROOT=1
fi
run() { if [ "$AS_ROOT" -eq 1 ]; then su postgres -c "$1"; else bash -c "$1"; fi }

run "$PGBIN/initdb -D '$PGDATA_DIR/data' -U postgres --auth=trust" >/dev/null 2>&1 || { echo "FAILED initdb" >&2; exit 1; }
run "$PGBIN/pg_ctl -D '$PGDATA_DIR/data' -o \"-p $PGPORT -c listen_addresses=localhost -c fsync=off\" -l '$PGDATA_DIR/log' start -w" >/dev/null 2>&1 || { echo "FAILED start" >&2; cat "$PGDATA_DIR/log" >&2; exit 1; }
run "psql -h localhost -p $PGPORT -U postgres -tAc 'select 1'" >/dev/null 2>&1 || { echo "FAILED connect" >&2; exit 1; }
run "psql -h localhost -p $PGPORT -U postgres -c \"create database $DB\"" >/dev/null 2>&1 || { echo "FAILED createdb" >&2; exit 1; }

PSQL="psql -h localhost -p $PGPORT -U postgres -d $DB -v ON_ERROR_STOP=1"
sql() {
  local path="$PGDATA_DIR/$1.sql"; cat > "$path"
  if [ "$AS_ROOT" -eq 1 ]; then chown postgres "$path"; fi
  run "$PSQL -tA -f '$path'" 2>&1 | sed 's/^/  /'
}

run "$PSQL -q -f '$HARNESS'" >/dev/null 2>&1 || { echo "FAILED harness" >&2; exit 1; }
for m in "${MIGRATIONS[@]}"; do
  run "$PSQL -q -f '$m'" >/dev/null 2>&1 || { echo "FAILED $m" >&2; exit 1; }
done

# Supabase's real roles + production-faithful auth, as in part 1.
cat > "$PGDATA_DIR/prod.sql" <<'PRODSQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin;
  end if;
end $$;
grant usage on schema public to authenticated, anon;

create table if not exists public.staff_profiles (
  id uuid primary key, email text, role text not null default 'readonly',
  active boolean not null default true
);
insert into public.staff_profiles (id, email, role, active) values
  ('11111111-1111-1111-1111-111111111111','michael@greenwaymarijuana.com','owner',true),
  ('44444444-4444-4444-4444-444444444444','budtender@greenwaymarijuana.com','staff',true)
on conflict (id) do nothing;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub','')::uuid;
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.staff_profiles
                 where id = auth.uid() and active = true and role in ('owner','admin'));
$$;
-- staff_profiles must be readable by the definer chain; it is security definer
-- so ownership carries it. Grant select for the RLS check on gl_accounts.
grant select on public.staff_profiles to authenticated;
grant select on public.gl_accounts to authenticated;
grant select on public.gl_entities to authenticated;
PRODSQL
if [ "$AS_ROOT" -eq 1 ]; then chown postgres "$PGDATA_DIR/prod.sql"; fi
run "$PSQL -q -f '$PGDATA_DIR/prod.sql'" >/dev/null 2>&1 || { echo "FAILED prod auth" >&2; exit 1; }
echo "--- migrations + production-faithful auth + real supabase roles applied ---"

echo
echo "==========================================================================="
echo " 1. EXECUTE PRIVILEGES ON THE BOOKS FUNCTIONS."
echo "    0177 has no grant statements. Does 'authenticated' get EXECUTE anyway?"
echo "==========================================================================="
sql acl <<'SQLBODY'
select '  ' || rpad(p.proname, 34) ||
       case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
            then 'authenticated CAN execute'
            else 'authenticated CANNOT execute  <-- would break the fix' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public'
   and p.proname in ('gl_trial_balance_check','gl_general_ledger',
                     'gl_opening_balance_summary','gl_override_report',
                     'gl_set_owner_override','gl_open_fiscal_year',
                     'gl_bless_opening_balances','gl_close_opening_balance_equity')
 order by p.proname;
SQLBODY

echo
echo "==========================================================================="
echo " 2. CAN A SIGNED-IN OWNER READ gl_accounts THROUGH RLS?"
echo "    Today the page bypasses RLS via the service-role key. The fix puts RLS"
echo "    back in the path, so it must admit him."
echo "==========================================================================="
sql rls <<'SQLBODY'
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select '  owner: is_admin() = ' || upper(public.is_admin()::text);
select '  owner: rows visible in gl_accounts = ' || count(*)::text from public.gl_accounts;
reset role;
SQLBODY

echo "  -- and a BUDTENDER (role 'staff') must still see nothing --"
sql rls2 <<'SQLBODY'
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select '  staff: is_admin() = ' || upper(public.is_admin()::text);
select '  staff: rows visible in gl_accounts = ' || count(*)::text from public.gl_accounts;
reset role;
SQLBODY

echo "  -- and the trial balance must refuse the budtender --"
sql rls3 <<'SQLBODY'
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
do $$
begin
  perform public.gl_trial_balance_check('greenway', date '2026-01-01', date '2026-12-31');
  raise notice '  staff opened the trial balance  <-- SECURITY FAILURE';
exception when others then
  raise notice '  staff refused: %', split_part(sqlerrm, ':', 1);
end $$;
reset role;
SQLBODY

echo
echo "==========================================================================="
echo " 3. DO THE CORRECTED COLUMN NAMES SELECT CLEANLY?"
echo "    old: code, name, account_type, normal_balance, cost_class, active, entity_id"
echo "    new: code, name, type, normal_balance, default_cost_class, active,"
echo "         allowed_entity_codes"
echo "==========================================================================="
sql cols <<'SQLBODY'
do $$
declare v int;
begin
  execute 'select count(*) from (select code, name, account_type, normal_balance,
           cost_class, active, entity_id from public.gl_accounts) x' into v;
  raise notice '  OLD column list -> OK (% rows)', v;
exception when others then
  raise notice '  OLD column list -> REFUSED: %', sqlerrm;
end $$;
do $$
declare v int;
begin
  execute 'select count(*) from (select code, name, type, normal_balance,
           default_cost_class, active, allowed_entity_codes from public.gl_accounts) x' into v;
  raise notice '  NEW column list -> OK (% rows)', v;
exception when others then
  raise notice '  NEW column list -> REFUSED: %', sqlerrm;
end $$;
SQLBODY

echo
echo "  -- how entity scoping REALLY works (it is an array, not a foreign key) --"
sql ent <<'SQLBODY'
select '  accounts shared by ALL entities (allowed_entity_codes is null) : '
       || count(*)::text from public.gl_accounts where allowed_entity_codes is null;
select '  accounts restricted to specific entities                      : '
       || count(*)::text from public.gl_accounts where allowed_entity_codes is not null;
select '  example restriction: ' || code || ' -> ' || array_to_string(allowed_entity_codes, ',')
  from public.gl_accounts where allowed_entity_codes is not null order by code limit 3;
SQLBODY

echo
echo "=== PART 3 COMPLETE ==="

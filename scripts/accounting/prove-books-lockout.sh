#!/usr/bin/env bash
# scripts/accounting/prove-books-lockout.sh
# =============================================================================
# PROVES THE CAUSE OF TWO LIVE PRODUCTION BUGS REPORTED BY THE OWNER.
#
# Michael reported, from the live site, signed in as himself:
#   (1) "I am logged in as me, the owner, and I am not able to open the books.
#        Is it because I am owner and not admin?"
#   (2) "The chart of accounts page is broken."
#
# His screenshots showed:
#   /admin/books/trial-balance  ->  TB_FORBIDDEN / GL_FORBIDDEN
#   /admin/books/accounts       ->  column gl_accounts.account_type does not exist
#
# THIS SCRIPT DOES NOT ARGUE. IT EXECUTES.
#
# It stands up a real PostgreSQL database, applies the real migrations, then
# replaces the test harness's convenience stand-ins with PRODUCTION-FAITHFUL
# definitions of auth.uid() and is_admin() -- the ones Supabase actually uses,
# which read the JWT claims of the calling connection. Then it asks the
# questions that matter and records the ACTUAL answers (rule 13j).
#
# WHY THE EXISTING TEST SUITES NEVER CAUGHT BUG 1
#   gl-schema-harness.sql defines is_admin() as a session setting:
#       select coalesce(nullif(current_setting('harness.is_admin',true),'')::boolean,false)
#   Every SQL test sets that flag to 'true' and proceeds. That models a logged-in
#   admin perfectly. What it CANNOT model is the thing that is actually broken:
#   the web server calls these functions over the SERVICE-ROLE key, a connection
#   that has no user at all. There is no role to be wrong -- there is no role.
#   A harness that can only express "which user am I" cannot express "there is
#   no user", so the defect was invisible to it. That is a gap in the harness,
#   not bad luck, and it is recorded here as such.
#
# Usage:    bash scripts/accounting/prove-books-lockout.sh
# Requires: postgresql server binaries (initdb, pg_ctl, psql).
# Touches nothing outside a temporary directory. Never connects to production.
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
# A port of its own so this can run alongside the other verify scripts without
# silently connecting to one of their databases.
PGPORT="${PGPORT:-5471}"
PGDATA_DIR="$(mktemp -d /tmp/lockoutproof.XXXXXX)"
DB="lockout_proof"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

echo "=== PROOF: why the owner cannot open the books, and why the chart of accounts errors ==="

for f in "$HARNESS" "${MIGRATIONS[@]}"; do
  [ -f "$f" ] || { echo "MISSING: $f" >&2; exit 1; }
done
[ -x "$PGBIN/initdb" ] || { echo "MISSING initdb at $PGBIN" >&2; exit 1; }

AS_ROOT=0
if [ "$(id -u)" -eq 0 ]; then
  id postgres >/dev/null 2>&1 || { echo "running as root but there is no postgres user" >&2; exit 1; }
  chmod 711 "$PGDATA_DIR"
  chown -R postgres "$PGDATA_DIR"
  AS_ROOT=1
fi

# Run a shell command, as the postgres user when we are root.
run() {
  if [ "$AS_ROOT" -eq 1 ]; then su postgres -c "$1"; else bash -c "$1"; fi
}

echo "--- starting a throwaway PostgreSQL cluster on port $PGPORT ---"
run "$PGBIN/initdb -D '$PGDATA_DIR/data' -U postgres --auth=trust" >/dev/null 2>&1 \
  || { echo "FAILED: initdb" >&2; exit 1; }
run "$PGBIN/pg_ctl -D '$PGDATA_DIR/data' -o \"-p $PGPORT -c listen_addresses=localhost -c fsync=off\" -l '$PGDATA_DIR/log' start -w" >/dev/null 2>&1 \
  || { echo "FAILED: pg_ctl start. Log follows:" >&2; cat "$PGDATA_DIR/log" >&2; exit 1; }

# REFUSE to continue if the database is not genuinely up. A proof that runs
# against a dead database proves nothing, and would exit 0 while doing so.
run "psql -h localhost -p $PGPORT -U postgres -tAc 'select 1'" >/dev/null 2>&1 \
  || { echo "FAILED: cluster did not accept a connection" >&2; cat "$PGDATA_DIR/log" >&2; exit 1; }

run "psql -h localhost -p $PGPORT -U postgres -c \"create database $DB\"" >/dev/null 2>&1 \
  || { echo "FAILED: create database" >&2; exit 1; }

PSQL="psql -h localhost -p $PGPORT -U postgres -d $DB -v ON_ERROR_STOP=1"

# Write a SQL file into the scratch dir and run it, echoing the output indented.
# Files live in $PGDATA_DIR so the postgres user can read them.
sql() {
  local name="$1"
  local path="$PGDATA_DIR/$name.sql"
  cat > "$path"
  if [ "$AS_ROOT" -eq 1 ]; then chown postgres "$path"; fi
  run "$PSQL -tA -f '$path'" 2>&1 | sed 's/^/  /'
}

echo "--- applying harness + migrations 0172..0178 ---"
run "$PSQL -q -f '$HARNESS'" >/dev/null 2>&1 || { echo "FAILED: harness" >&2; exit 1; }
for m in "${MIGRATIONS[@]}"; do
  run "$PSQL -q -f '$m'" >/dev/null 2>&1 || { echo "FAILED applying: $m" >&2; exit 1; }
done
echo "    applied."

# ---------------------------------------------------------------------------
# SWAP THE HARNESS STAND-INS FOR PRODUCTION-FAITHFUL DEFINITIONS.
#
# This is the whole point of the exercise. Up to this line the database has the
# harness's is_admin(), which reads a session flag. Below this line it has the
# REAL one from migration 0001, and the REAL auth.uid(), which reads the JWT
# claims of the calling connection exactly as Supabase does.
# ---------------------------------------------------------------------------
cat > "$PGDATA_DIR/production_auth.sql" <<'PRODAUTH'
-- staff_profiles as defined in 0001_slice1_foundation.sql (the columns that matter).
create table if not exists public.staff_profiles (
  id     uuid primary key,
  email  text,
  role   text not null default 'readonly',
  active boolean not null default true
);

-- The real accounts from Michael's /admin/users screen.
insert into public.staff_profiles (id, email, role, active) values
  ('11111111-1111-1111-1111-111111111111', 'michael@greenwaymarijuana.com',  'owner', true),
  ('22222222-2222-2222-2222-222222222222', 'jimbec@outlook.com',             'admin', true),
  ('33333333-3333-3333-3333-333333333333', 'stephen@greenwaymarijuana.com',  'admin', true),
  ('44444444-4444-4444-4444-444444444444', 'budtender@greenwaymarijuana.com','staff', true)
on conflict (id) do nothing;

-- PRODUCTION auth.uid(): reads the 'sub' claim of the connection's JWT.
-- This is what Supabase actually installs. It is NOT a session flag.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
           current_setting('request.jwt.claims', true)::json ->> 'sub',
           ''
         )::uuid;
$$;

-- PRODUCTION is_admin(), matching 0001_slice1_foundation.sql lines 138-144.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.staff_profiles
    where id = auth.uid() and active = true and role in ('owner','admin')
  );
$$;
PRODAUTH
if [ "$AS_ROOT" -eq 1 ]; then chown postgres "$PGDATA_DIR/production_auth.sql"; fi

run "$PSQL -q -f '$PGDATA_DIR/production_auth.sql'" >/dev/null 2>&1 \
  || { echo "FAILED: installing production-faithful auth" >&2; exit 1; }
echo "--- harness stand-ins replaced with production-faithful auth.uid() / is_admin() ---"

# PROVE THE SWAP ACTUALLY HAPPENED. If is_admin() were still the harness's
# session-flag version, every answer below would be about the wrong function
# and this whole script would be theatre.
echo "--- confirming the swap is real (rule 16: prove the gate is wired) ---"
sql confirm_swap <<'SQLBODY'
select '  is_admin() now reads staff_profiles     : ' ||
       upper((pg_get_functiondef(p.oid) like '%staff_profiles%')::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='is_admin';
select '  is_admin() no longer reads harness flag : ' ||
       upper((pg_get_functiondef(p.oid) not like '%harness.is_admin%')::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='is_admin';
SQLBODY

# An entity must exist or a TB_UNKNOWN_ENTITY refusal could masquerade as the
# permission refusal we are hunting.
run "$PSQL -q -tAc \"insert into public.gl_entities (code, name, tax_form) values ('greenway','Greenway','1120S') on conflict (code) do nothing\"" >/dev/null 2>&1 || true

echo
echo "==========================================================================="
echo " QUESTION 1 - Is the OWNER role excluded from is_admin()?"
echo "              This is Michael's own hypothesis. Test it first."
echo "==========================================================================="
sql q1 <<'SQLBODY'
-- Act as Michael: a real logged-in session carrying his user id as the 'sub'
-- claim, which is exactly what the browser sends after he signs in.
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select '  his role in staff_profiles  : ' || role from public.staff_profiles
  where id = '11111111-1111-1111-1111-111111111111';
select '  auth.uid() sees             : ' || coalesce(auth.uid()::text, 'NULL');
select '  is_admin() returns          : ' || upper(public.is_admin()::text);
do $$
begin
  perform public.gl_trial_balance_check('greenway', date '2026-01-01', date '2026-12-31');
  raise notice '  VERDICT: TRIAL BALANCE OPENS FINE FOR THE OWNER';
exception when others then
  raise notice '  VERDICT: REFUSED -> %', sqlerrm;
end $$;
SQLBODY

echo
echo "==========================================================================="
echo " QUESTION 2 - What happens over the SERVICE-ROLE key?"
echo "              This is the connection the web server actually uses:"
echo "              ledger-store.ts calls createSupabaseAdminClient() for every"
echo "              books RPC. That key carries NO user - there is no 'sub'."
echo "==========================================================================="
sql q2 <<'SQLBODY'
-- The service-role JWT as Supabase issues it: a role claim, and no subject.
set request.jwt.claims = '{"role":"service_role"}';
select '  auth.uid() sees             : ' || coalesce(auth.uid()::text, 'NULL  <-- nobody is logged in');
select '  is_admin() returns          : ' || upper(public.is_admin()::text);
do $$
begin
  perform public.gl_trial_balance_check('greenway', date '2026-01-01', date '2026-12-31');
  raise notice '  VERDICT (trial balance): OPENED';
exception when others then
  raise notice '  VERDICT (trial balance): REFUSED -> %', sqlerrm;
end $$;
do $$
begin
  perform public.gl_general_ledger('greenway', null, date '2026-01-01', date '2026-12-31');
  raise notice '  VERDICT (ledger)       : OPENED';
exception when others then
  raise notice '  VERDICT (ledger)       : REFUSED -> %', sqlerrm;
end $$;
SQLBODY

echo
echo "==========================================================================="
echo " QUESTION 3 - Would signing in as an ADMIN instead of OWNER fix it?"
echo "              If yes, Michael's hypothesis survives. If no, it is refuted."
echo "==========================================================================="
sql q3 <<'SQLBODY'
-- jimbec@outlook.com is role 'admin'. Give him a REAL logged-in session first,
-- to show the role itself is not the problem.
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select '  admin, logged in    -> is_admin() = ' || upper(public.is_admin()::text);
-- Now the same admin, but reached the way the WEB SERVER reaches the database.
set request.jwt.claims = '{"role":"service_role"}';
select '  admin, via web page -> is_admin() = ' || upper(public.is_admin()::text)
       || '   (identity never travels: the admin client is built without one)';
SQLBODY

echo
echo "==========================================================================="
echo " QUESTION 4 - The chart of accounts. What column does the code ask for,"
echo "              and what column actually exists?"
echo "==========================================================================="
sql q4 <<'SQLBODY'
select '  columns on gl_accounts matching %type%:';
select '    - ' || column_name || '  (' || data_type || ')'
  from information_schema.columns
 where table_schema='public' and table_name='gl_accounts' and column_name like '%type%'
 order by column_name;
-- ledger-store.ts listAccounts() selects: code, name, account_type, ...
do $$
declare v_n int;
begin
  execute 'select count(*) from public.gl_accounts where account_type is not null' into v_n;
  raise notice '  asking for account_type -> OK (% rows)', v_n;
exception when others then
  raise notice '  asking for account_type -> REFUSED: %', sqlerrm;
end $$;
do $$
declare v_n int;
begin
  execute 'select count(*) from public.gl_accounts where type is not null' into v_n;
  raise notice '  asking for type         -> OK (% accounts in the chart)', v_n;
exception when others then
  raise notice '  asking for type         -> REFUSED: %', sqlerrm;
end $$;
SQLBODY

echo
echo "==========================================================================="
echo " QUESTION 5 - Is 'account_type' available anywhere else, e.g. on a view?"
echo "              If a view exposes it, the fix might be to read the view"
echo "              instead of renaming. Check rather than assume."
echo "==========================================================================="
sql q5 <<'SQLBODY'
select '  ' || table_name || '.' || column_name
  from information_schema.columns
 where table_schema='public' and column_name='account_type'
 order by table_name;
SQLBODY

echo
echo "=== PROOF COMPLETE ==="

#!/usr/bin/env bash
# scripts/accounting/prove-books-lockout-part2.sh
# =============================================================================
# PART 2 OF THE PRODUCTION BUG INVESTIGATION.
#
# Part 1 proved WHY the two reported pages fail. This part asks the two
# follow-up questions that decide how big the repair actually is, because
# fixing only what the owner happened to click on is how the second outage
# happens the following week.
#
#   A. THE CHART OF ACCOUNTS QUERY ASKS FOR SEVEN COLUMNS.
#      PostgREST reports only the FIRST column it cannot find. `account_type`
#      is confirmed missing -- but if `cost_class` or `active` are also
#      missing, then correcting `account_type` alone would produce a SECOND
#      identical error, and the page would still be broken. Every column in
#      that select list is checked here individually.
#
#   B. HOW MANY OTHER SCREENS CALL AN ADMIN-GUARDED FUNCTION OVER A
#      CONNECTION THAT HAS NO USER? Every `security definer` function in the
#      ledger migrations that calls is_admin() is enumerated, so the blast
#      radius is measured rather than guessed.
#
# Usage:    bash scripts/accounting/prove-books-lockout-part2.sh
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
PGPORT="${PGPORT:-5472}"
PGDATA_DIR="$(mktemp -d /tmp/lockoutproof2.XXXXXX)"
DB="lockout_proof2"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

echo "=== PROOF PART 2: the full blast radius ==="

for f in "$HARNESS" "${MIGRATIONS[@]}"; do
  [ -f "$f" ] || { echo "MISSING: $f" >&2; exit 1; }
done

AS_ROOT=0
if [ "$(id -u)" -eq 0 ]; then
  id postgres >/dev/null 2>&1 || { echo "no postgres user" >&2; exit 1; }
  chmod 711 "$PGDATA_DIR"; chown -R postgres "$PGDATA_DIR"; AS_ROOT=1
fi
run() { if [ "$AS_ROOT" -eq 1 ]; then su postgres -c "$1"; else bash -c "$1"; fi }

run "$PGBIN/initdb -D '$PGDATA_DIR/data' -U postgres --auth=trust" >/dev/null 2>&1 \
  || { echo "FAILED: initdb" >&2; exit 1; }
run "$PGBIN/pg_ctl -D '$PGDATA_DIR/data' -o \"-p $PGPORT -c listen_addresses=localhost -c fsync=off\" -l '$PGDATA_DIR/log' start -w" >/dev/null 2>&1 \
  || { echo "FAILED: pg_ctl start" >&2; cat "$PGDATA_DIR/log" >&2; exit 1; }
run "psql -h localhost -p $PGPORT -U postgres -tAc 'select 1'" >/dev/null 2>&1 \
  || { echo "FAILED: no connection" >&2; exit 1; }
run "psql -h localhost -p $PGPORT -U postgres -c \"create database $DB\"" >/dev/null 2>&1 \
  || { echo "FAILED: createdb" >&2; exit 1; }

PSQL="psql -h localhost -p $PGPORT -U postgres -d $DB -v ON_ERROR_STOP=1"

sql() {
  local path="$PGDATA_DIR/$1.sql"
  cat > "$path"
  if [ "$AS_ROOT" -eq 1 ]; then chown postgres "$path"; fi
  run "$PSQL -tA -f '$path'" 2>&1 | sed 's/^/  /'
}

run "$PSQL -q -f '$HARNESS'" >/dev/null 2>&1 || { echo "FAILED: harness" >&2; exit 1; }
for m in "${MIGRATIONS[@]}"; do
  run "$PSQL -q -f '$m'" >/dev/null 2>&1 || { echo "FAILED: $m" >&2; exit 1; }
done
echo "--- migrations applied ---"

echo
echo "==========================================================================="
echo " A. EVERY COLUMN THE CHART-OF-ACCOUNTS QUERY ASKS FOR, CHECKED ONE BY ONE."
echo "    ledger-store.ts listAccounts() selects:"
echo "      code, name, account_type, normal_balance, cost_class, active, entity_id"
echo "    PostgREST only reports the FIRST missing column, so the rest are"
echo "    checked here individually rather than assumed innocent."
echo "==========================================================================="
sql cols <<'SQLBODY'
with wanted(col) as (
  values ('code'),('name'),('account_type'),('normal_balance'),
         ('cost_class'),('active'),('entity_id')
)
select '  ' || rpad(w.col, 16) ||
       case when c.column_name is null
            then 'MISSING   <-- this breaks the page'
            else 'exists    (' || c.data_type || ')' end
  from wanted w
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name   = 'gl_accounts'
   and c.column_name  = w.col
 order by w.col;
SQLBODY

echo
echo "  -- the FULL real column list, so the correct names are on the record --"
sql allcols <<'SQLBODY'
select '  - ' || column_name || ' (' || data_type || ')'
  from information_schema.columns
 where table_schema='public' and table_name='gl_accounts'
 order by ordinal_position;
SQLBODY

echo
echo "==========================================================================="
echo " B. EVERY LEDGER FUNCTION THAT DEMANDS is_admin()."
echo "    Any screen calling one of these over the service-role key is broken"
echo "    in exactly the same way as the trial balance. This measures the"
echo "    blast radius instead of guessing at it."
echo "==========================================================================="
sql guards <<'SQLBODY'
select '  ' || p.proname || '()'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname like 'gl\_%'
   and pg_get_functiondef(p.oid) like '%is_admin()%'
 order by p.proname;
SQLBODY

echo
echo "  -- and the tables whose RLS policy depends on is_admin() --"
sql policies <<'SQLBODY'
select '  ' || rpad(tablename, 26) || policyname
  from pg_policies
 where schemaname = 'public'
   and tablename like 'gl\_%'
   and (coalesce(qual,'') like '%is_admin%' or coalesce(with_check,'') like '%is_admin%')
 order by tablename, policyname;
SQLBODY

echo
echo "=== PART 2 COMPLETE ==="

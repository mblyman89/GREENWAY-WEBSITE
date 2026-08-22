#!/usr/bin/env bash
# books-34 — PROVE EVERY ORDERING-GUARD BRANCH IN 0199 IS REACHABLE.
#
# Standing rule 43: a refusal code that cannot be reached is not a safety net,
# it is a comment. §0 of 0199 has FIVE branches. Applying the file to an empty
# database only ever proves the FIRST one - the other four are shadowed by it
# and could name the wrong file, or the wrong table, and nobody would know.
#
# So each branch is exercised in isolation: build a database that satisfies
# every dependency EXCEPT one, and confirm the refusal names the missing one.
#
# Standing rule 39: after each refusal, confirm the table was NOT created. A
# guard that raises after doing half the work is worse than no guard.
set -uo pipefail

MIG="supabase/migrations/0199_payroll_ytd_accumulators.sql"
BOOT="/tmp/bootstrap.sql"
DB="gw34branch"
pass=0; fail=0

pq() { sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

# Build a database holding every dependency 0199 needs, except the one named.
# The stubs are deliberately minimal: this proves WHICH CHECK fires, not that
# the real objects behave correctly - that is what the full 199-file apply does.
build_all_but() {
  local omit="$1"
  sudo -u postgres psql -qc "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1
  sudo -u postgres psql -q -d "$DB" -f "$BOOT" >/dev/null 2>&1

  [ "$omit" = "is_owner" ] || pq -c "create or replace function public.is_owner() returns boolean language sql stable as \$\$ select true \$\$;" >/dev/null 2>&1
  [ "$omit" = "set_updated_at" ] || pq -c "create or replace function public.set_updated_at() returns trigger language plpgsql as \$\$ begin new.updated_at = now(); return new; end \$\$;" >/dev/null 2>&1
  [ "$omit" = "employees" ] || pq -c "create table if not exists public.employees (id uuid primary key default gen_random_uuid(), full_name text);" >/dev/null 2>&1
  [ "$omit" = "payroll_runs" ] || pq -c "create table if not exists public.payroll_runs (id uuid primary key default gen_random_uuid());" >/dev/null 2>&1
  [ "$omit" = "payroll_run_lines" ] || pq -c "create table if not exists public.payroll_run_lines (id uuid primary key default gen_random_uuid(), taxes_cents bigint);" >/dev/null 2>&1
}

# $1 = dependency to omit, $2 = text the refusal must contain
check_branch() {
  local omit="$1" expect="$2"
  build_all_but "$omit"
  local out
  out=$(sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG" 2>&1)

  if ! echo "$out" | grep -q "MIGRATION_OUT_OF_ORDER"; then
    echo "  FAIL  omitting $omit did NOT trigger a refusal"
    echo "$out" | head -3 | sed 's/^/          /'
    fail=$((fail+1)); return
  fi
  if ! echo "$out" | grep -q "$expect"; then
    echo "  FAIL  omitting $omit refused, but did not name '$expect'"
    echo "$out" | grep -o "MIGRATION_OUT_OF_ORDER: [^']*" | head -1 | sed 's/^/          /'
    fail=$((fail+1)); return
  fi
  # RULE 39: the refusal must have changed NOTHING.
  local made
  made=$(sudo -u postgres psql -t -A -d "$DB" -c "select coalesce(to_regclass('public.payroll_ytd_accumulators')::text,'ABSENT');" 2>&1)
  if [ "$made" != "ABSENT" ]; then
    echo "  FAIL  omitting $omit refused BUT created the table anyway"
    fail=$((fail+1)); return
  fi
  echo "  PASS  omitting $omit -> names '$expect', table ABSENT"
  pass=$((pass+1))
}

echo "=== EVERY ORDERING-GUARD BRANCH MUST BE INDIVIDUALLY REACHABLE ==="
check_branch "is_owner"          "0185_books_owner_only.sql"
check_branch "set_updated_at"    "0001_slice1_foundation.sql"
check_branch "employees"         "0037_staffing_timeclock.sql"
check_branch "payroll_run_lines" "splits the single taxes_cents column"
check_branch "payroll_runs"      "records which pay run last fed each accumulator"

echo
echo "=== ACCEPT CONTROL (rule 55): all dependencies present -> APPLIES ==="
build_all_but "none"
if out=$(sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG" 2>&1); then
  made=$(sudo -u postgres psql -t -A -d "$DB" -c "select coalesce(to_regclass('public.payroll_ytd_accumulators')::text,'ABSENT');")
  if [ "$made" != "ABSENT" ]; then
    echo "  PASS  with every dependency present the migration APPLIES and creates the table"
    pass=$((pass+1))
  else
    echo "  FAIL  applied without error but the table is absent"
    fail=$((fail+1))
  fi
else
  echo "  FAIL  the guard refuses even when every dependency is present"
  echo "$out" | grep -o "MIGRATION_OUT_OF_ORDER: [^']*" | head -1 | sed 's/^/          /'
  fail=$((fail+1))
fi

sudo -u postgres psql -qc "drop database if exists $DB;" >/dev/null 2>&1
echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ] || exit 1
echo "0199 ORDERING GUARD: EVERY BRANCH REACHABLE."

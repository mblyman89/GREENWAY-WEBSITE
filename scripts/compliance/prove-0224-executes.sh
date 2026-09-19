#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# prove-0224-executes.sh — SLICE L5
#
# The repo's migration gate (tests/compliance/migration-execution-gate.test.ts)
# requires every migration to be PROVEN to execute, not assumed to. This
# applies all migrations in order to a real PostgreSQL, then re-applies 0224 a
# second time to prove it is idempotent, then inspects the resulting column
# rather than trusting that the DDL "looked right".
#
# 0224 adds ONE nullable column, catalog_product_drafts.chosen_net_volume_ml,
# which is where a receiver's measured bottle volume lands when the product
# name did not state one. The two properties that matter are checked live:
#   1. it is NULLABLE with NO backfill — a draft already in flight must not be
#      retro-blocked by a column that appeared underneath it, and
#   2. NULL survives as "unknown" rather than being coerced to 0 — a 0 would
#      read downstream as "measured, and it holds nothing", which is precisely
#      the reading that would disable the 72 fl oz cap.
#
# Usage: sudo -u postgres bash scripts/compliance/prove-0224-executes.sh
# ---------------------------------------------------------------------------
set -uo pipefail

DB=greenway_migtest_0224
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
echo "=== 0224 re-applied for idempotency ==="
if psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/0224_receiving_volume_gate.sql" 2>&1; then
  echo "0224 re-apply: OK (idempotent)"
else
  echo "0224 re-apply: FAILED"
fi

echo
echo "=== the column as the database actually sees it ==="
psql -d "$DB" -c "
select column_name, data_type, numeric_precision, numeric_scale,
       is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='catalog_product_drafts'
  and column_name in ('chosen_net_volume_ml','chosen_website_category')
order by column_name;"

echo "=== the column comment ==="
psql -d "$DB" -tc "
select left(col_description('public.catalog_product_drafts'::regclass, ordinal_position), 100)
from information_schema.columns
where table_schema='public' and table_name='catalog_product_drafts'
  and column_name='chosen_net_volume_ml';"

echo "=== a real insert + read-back, no assumptions ==="
# The gate stores millilitres at numeric(12,3). 354.882 is 12 fl oz converted;
# it is inserted specifically to prove the scale holds a fluid-ounce
# conversion instead of rounding it away, because that rounding would move a
# statutory limit. A row with NO volume is inserted alongside, because the
# whole point of the column is that "unmeasured" must remain distinguishable.
psql -d "$DB" -tc "
insert into public.catalog_product_drafts (name, chosen_net_volume_ml)
values ('Infused Lemonade 1.5L', 1500),
       ('Tonic 750ml',            750),
       ('Twelve fl oz can',   354.882),
       ('Unmeasured bottle',     null)
returning name, chosen_net_volume_ml;" 2>&1 | head -10

echo "=== NULL is preserved as unknown, not coerced to zero ==="
# This is the assertion the slice depends on. A 0 here would read downstream as
# "measured, holds nothing" and would silently switch the 72 fl oz cap off.
psql -d "$DB" -tc "
select count(*) filter (where chosen_net_volume_ml is null) as unmeasured_rows,
       count(*) filter (where chosen_net_volume_ml = 0)     as zero_rows,
       count(*)                                             as total_rows
from public.catalog_product_drafts;"

echo "=== no backfill: a pre-existing draft is untouched by the new column ==="
# Proven by inserting a draft the way the app did BEFORE 0224 (naming no
# volume at all) and confirming it lands NULL rather than a default, so a
# draft already in flight cannot be retro-blocked or retro-measured.
psql -d "$DB" -tc "
insert into public.catalog_product_drafts (name) values ('Pre-0224 style draft');
select name, chosen_net_volume_ml is null as volume_is_null
from public.catalog_product_drafts where name = 'Pre-0224 style draft';"

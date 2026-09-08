#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# prove-0223-executes.sh — SLICE L4
#
# The repo's migration gate (tests/compliance/migration-execution-gate.test.ts)
# requires every migration to be PROVEN to execute, not assumed to. This
# applies all migrations in order to a real PostgreSQL, then re-applies 0223 a
# second time to prove it is idempotent, then inspects the resulting column
# rather than trusting that the DDL "looked right".
#
# Usage: sudo -u postgres bash scripts/compliance/prove-0223-executes.sh
# ---------------------------------------------------------------------------
set -uo pipefail

DB=greenway_migtest
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
echo "=== 0223 re-applied for idempotency ==="
if psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/0223_liquid_volume_ml_snapshot.sql" 2>&1; then
  echo "0223 re-apply: OK (idempotent)"
else
  echo "0223 re-apply: FAILED"
fi

echo
echo "=== the column as the database actually sees it ==="
psql -d "$DB" -c "
select column_name, data_type, numeric_precision, numeric_scale, is_nullable
from information_schema.columns
where table_schema='public' and table_name='order_lines'
  and column_name in ('unit_grams','unit_volume_ml')
order by column_name;"

echo "=== the column comment ==="
psql -d "$DB" -tc "
select left(col_description('public.order_lines'::regclass, ordinal_position), 90)
from information_schema.columns
where table_schema='public' and table_name='order_lines' and column_name='unit_volume_ml';"

echo "=== a real insert + read-back, no assumptions ==="
# order_lines.order_id is a real FK, so a parent order is created first. The
# point is to prove the COLUMN accepts and returns the value the gate depends
# on, at the precision the DDL declares -- not to assume numeric(12,3) rounds
# the way it reads.
psql -d "$DB" -tc "
with o as (
  insert into public.orders (customer_first_name, subtotal_minor_units,
      estimated_tax_minor_units, total_minor_units)
  values ('Test', 2000, 0, 2000) returning id
)
insert into public.order_lines (order_id, product_name, quantity,
    price_minor_units, unit_volume_ml)
select o.id, x.nm, x.q, 1000, x.ml from o,
  (values ('Infused Lemonade 1.5L', 2, 1500::numeric),
          ('Tonic 750ml',           3,  750::numeric),
          ('Precision probe',       1, 354.882::numeric),
          ('Unknown volume',        1, null::numeric)) as x(nm, q, ml)
returning product_name, unit_volume_ml, unit_volume_ml * quantity as line_ml;" 2>&1 | head -10

echo "=== NULL is preserved as unknown, not coerced to zero ==="
psql -d "$DB" -tc "
select count(*) filter (where unit_volume_ml is null)  as unknown_rows,
       count(*) filter (where unit_volume_ml = 0)      as zero_rows
from public.order_lines;"

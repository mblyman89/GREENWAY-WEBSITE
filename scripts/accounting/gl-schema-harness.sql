-- scripts/accounting/gl-schema-harness.sql
-- =============================================================================
-- SUPABASE STAND-IN, FOR LOCAL VERIFICATION ONLY. NOT A MIGRATION.
-- =============================================================================
-- Creates the small set of objects that Supabase provides for us in the real
-- database (the auth schema, the admin-role helpers, and the shared updated_at
-- trigger function) so that migration 0172 can be executed end-to-end against a
-- throwaway local PostgreSQL instance.
--
-- WHY THIS EXISTS: per AGENTS.md, migrations are applied MANUALLY by the owner in
-- the Supabase SQL editor. That makes a failed migration a live, hands-on problem
-- for Michael rather than a CI failure for us. So the migration gets executed and
-- exercised here FIRST, against real PostgreSQL, before he is ever asked to paste
-- it in. This file is deliberately NOT in supabase/migrations/ and must never be
-- run against production.
-- =============================================================================

create extension if not exists pgcrypto;

-- --- auth schema stand-in ----------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- auth.uid() normally reads the JWT claim. Locally we read a session setting so
-- tests can act as a specific user.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('harness.user_id', true), '')::uuid;
$$;

-- --- role helper stand-ins ---------------------------------------------------
-- In production these read the staff table / JWT claims. Locally they read a
-- session setting, defaulting to TRUE so the migration's own seeding works.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('harness.is_admin', true), '')::boolean, true);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('harness.is_staff', true), '')::boolean, true);
$$;

-- --- shared updated_at trigger (mirrors 0001_slice1_foundation.sql) ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

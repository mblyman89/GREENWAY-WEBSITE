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

-- --- role stand-ins ----------------------------------------------------------
-- Supabase creates these roles for us; plain PostgreSQL does not. Without them
-- every `grant ... to authenticated` fails with 'role "authenticated" does not
-- exist' — which is exactly how a real access-control defect in 0175 stayed
-- hidden for a while, because the verify script was swallowing the error.
-- They are NOLOGIN: nothing here can be connected to, they exist only so that
-- grants resolve and so that `set role authenticated` can be used to prove
-- that a budtender genuinely cannot read the books.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to authenticated, anon, service_role;

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
-- session setting.
--
-- THE DEFAULT IS **FALSE**, AND THAT MATTERS. It used to default to TRUE "so the
-- migration's own seeding works", and that one convenience hid a real defect:
-- 0175 called its own admin-guarded gl_open_fiscal_year() from a DO block, which
-- passed here (harness said admin=true) and then FAILED in Michael's Supabase SQL
-- editor with GL_FORBIDDEN, because a hand-applied migration has no logged-in
-- user and auth.uid() is null.
--
-- FALSE is the honest default: it is what the SQL editor actually looks like. A
-- migration that needs to be admin to apply is a migration that will fail when
-- it is applied. Tests that need admin must ask for it explicitly via
-- set_config('harness.is_admin','true',...) -- which is exactly what the real
-- app does by having a logged-in owner.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('harness.is_admin', true), '')::boolean, false);
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
